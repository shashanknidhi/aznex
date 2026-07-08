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

export function mergeClaudeSettings(
  settings: Record<string, unknown>,
  hookCommand: string,
): { settings: Record<string, unknown>; added: string[] } {
  const out = structuredClone(settings);
  const hooks = (out["hooks"] ??= {}) as Record<string, HookEntry[]>;
  const added: string[] = [];

  for (const hook of HOOKS) {
    const command = "arg" in hook ? `${hookCommand} ${hook.arg}` : hookCommand;
    const entries = (hooks[hook.event] ??= []);
    const present = entries.some((e) => e.hooks?.some((h) => h.command === command));
    if (!present) {
      entries.push({
        ...("matcher" in hook ? { matcher: hook.matcher } : {}),
        hooks: [{ type: "command", command }],
      });
      added.push(hook.event);
    }
  }
  return { settings: out, added };
}
