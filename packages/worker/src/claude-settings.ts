// Pure merge of the aznex capture hooks into a Claude Code settings.json
// object — setup.ts applies it to ~/.claude/settings.json so capture works in
// every repo without per-project setup. Idempotent: an event that already has
// a hook with the same command is left untouched.

const HOOK_EVENTS = ["PostToolUse", "Stop"] as const;

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

  for (const event of HOOK_EVENTS) {
    const entries = (hooks[event] ??= []);
    const present = entries.some((e) => e.hooks?.some((h) => h.command === hookCommand));
    if (!present) {
      entries.push({ hooks: [{ type: "command", command: hookCommand }] });
      added.push(event);
    }
  }
  return { settings: out, added };
}
