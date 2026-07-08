// Pure merge of the aznex hooks into a Claude Code settings.json object —
// setup.ts applies it to ~/.claude/settings.json so capture works in every
// repo without per-project setup. Idempotent: an event that already has a
// hook with the same command is left untouched, so re-running setup on an
// older install only adds the new events.

// Mirrors plugin/hooks/hooks.json — keep the two in sync.
const HOOKS = [
  { event: "PostToolUse" },
  { event: "Stop" },
  { event: "SessionEnd" }, // pipeline already finalizes on it; registration was the only gap
  { event: "SessionStart", matcher: "startup|clear|compact", arg: "context" },
  { event: "PreToolUse", matcher: "Read", arg: "file-context" },
] as const;

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string }[];
}

// An entry is "ours" if it invokes our hook script with the same trailing arg
// — regardless of install location. Re-running setup from a different install
// (npm global vs clone) must UPDATE the path, not append a duplicate hook
// (duplicates double capture and context injection).
function isOurs(command: string, arg: string | undefined): boolean {
  const match = command.match(/claude-code-hook\.ts(?: (context|file-context))?$/);
  return match !== null && match[1] === arg;
}

export function mergeClaudeSettings(
  settings: Record<string, unknown>,
  hookCommand: string,
): { settings: Record<string, unknown>; added: string[]; updated: string[] } {
  const out = structuredClone(settings);
  const hooks = (out["hooks"] ??= {}) as Record<string, HookEntry[]>;
  const added: string[] = [];
  const updated: string[] = [];

  for (const hook of HOOKS) {
    const arg = "arg" in hook ? hook.arg : undefined;
    const command = arg ? `${hookCommand} ${arg}` : hookCommand;
    const entries = (hooks[hook.event] ??= []);

    const ours = entries.flatMap((e) => e.hooks ?? []).filter((h) => isOurs(h.command, arg));
    const alreadyExact = ours.length === 1 && ours[0]!.command === command;
    if (alreadyExact) continue;

    // Remove every entry of ours (stale paths, duplicates), keep foreign hooks.
    hooks[hook.event] = entries
      .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !isOurs(h.command, arg)) }))
      .filter((e) => e.hooks.length > 0);
    hooks[hook.event]!.push({
      ...("matcher" in hook ? { matcher: hook.matcher } : {}),
      hooks: [{ type: "command", command }],
    });
    (ours.length > 0 ? updated : added).push(hook.event);
  }
  return { settings: out, added, updated };
}
