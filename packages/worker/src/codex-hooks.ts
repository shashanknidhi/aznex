// Pure merge of the aznex hooks into a Codex hooks.json object (#45) —
// setup.ts applies it to ~/.codex/hooks.json. Codex's hook contract is
// payload-identical to Claude Code's (same PascalCase `hook_event_name`, same
// `cwd`/`session_id`/`tool_*` fields, same `hookSpecificOutput` reply), so the
// worker endpoints are reused as-is; only the config file shape and event set
// differ. Idempotent, same as mergeClaudeSettings.
//
// Two Codex-specific facts drive the shape below:
//  - matchers are regexes, so PostToolUse uses `.*` (Claude Code's `*` is a
//    special case that Codex's regex compiler rejects)
//  - Codex hooks stay inert until the user approves them once in the
//    interactive TUI hook review; setup.ts prints that step.
//
// ponytail: no PreToolUse/file-context entry — context.ts keys off
// tool_input.file_path, which only Claude Code's Read tool provides (Codex
// reads files through the shell). Add when file paths can be recovered from
// Codex shell commands.

// Quoted as one word including the path: `?` is a shell glob character, so
// .../hook?agent=codex must not be left bare.
const workerUrl = (endpoint: string) => `"\${AZNEX_WORKER_URL:-http://localhost:29639}/${endpoint}"`;

// Codex has SessionEnd as well as Stop; the pipeline finalizes on either, and
// registering both is what makes capture survive a session that is closed
// rather than stopped.
const HOOKS = [
  { event: "SessionStart", matcher: "startup|clear|compact|resume", endpoint: "context", timeout: 10 },
  { event: "PostToolUse", matcher: ".*", endpoint: "hook?agent=codex", timeout: 5 },
  { event: "Stop", endpoint: "hook?agent=codex", timeout: 5 },
  { event: "SessionEnd", endpoint: "hook?agent=codex", timeout: 5 },
] as const;

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

function buildCommand(endpoint: string): string {
  // Context injection is synchronous — the agent waits for stdout — so it gets
  // a longer curl budget and a fallback message. Capture is fire-and-forget:
  // a dead worker must never surface an error inside the session.
  if (endpoint === "context") {
    return (
      `curl -sf -m 5 -X POST -H 'Content-Type: application/json' --data-binary @- ${workerUrl("context")}` +
      ` || echo '{"systemMessage":"aznex worker not reachable — run: npx aznex-worker setup"}'`
    );
  }
  return `curl -sf -m 2 -X POST -H 'Content-Type: application/json' --data-binary @- ${workerUrl(endpoint)} >/dev/null || true`;
}

// An entry is "ours" if it relays to the aznex worker for the same endpoint.
// Matching on the endpoint (not the whole command) lets a re-run rewrite an
// older command string in place instead of appending a duplicate relay.
//
// Hand-written wirings that shell out to hooks/claude-code-hook.ts count as
// ours too: people wired Codex that way before this adapter existed, and
// leaving one in place next to the new relay would post every event twice.
function isOurs(command: string, endpoint: string): boolean {
  if (command.includes("AZNEX_WORKER_URL") && command.includes(`/${endpoint}`)) return true;
  const legacy = command.match(/claude-code-hook\.ts(?:\s+(context|file-context))?\s*$/);
  if (legacy === null) return false;
  const legacyEndpoint = legacy[1] ?? "hook?agent=codex"; // bare invocation = capture
  return legacyEndpoint === endpoint;
}

export function mergeCodexHooks(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  added: string[];
  updated: string[];
} {
  const out = structuredClone(config);
  const hooks = (out["hooks"] ??= {}) as Record<string, HookEntry[]>;
  const added: string[] = [];
  const updated: string[] = [];

  for (const hook of HOOKS) {
    const command = buildCommand(hook.endpoint);
    const entries = (hooks[hook.event] ??= []);

    const ours = entries.flatMap((e) => e.hooks ?? []).filter((h) => isOurs(h.command, hook.endpoint));
    if (ours.length === 1 && ours[0]!.command === command) continue;

    // Drop every entry of ours (stale commands, duplicates), keep foreign hooks.
    hooks[hook.event] = entries
      .map((e) => ({ ...e, hooks: (e.hooks ?? []).filter((h) => !isOurs(h.command, hook.endpoint)) }))
      .filter((e) => e.hooks.length > 0);
    hooks[hook.event]!.push({
      ...("matcher" in hook ? { matcher: hook.matcher } : {}),
      hooks: [{ type: "command", command, timeout: hook.timeout }],
    });
    (ours.length > 0 ? updated : added).push(hook.event);
  }
  return { config: out, added, updated };
}

// MCP registration. `codex mcp add` can only pass a bearer token by env-var
// name, which a GUI-launched Codex won't have — so the block is appended to
// config.toml verbatim instead, matching the shape Codex writes itself.
// ponytail: text append, not a TOML parse — an existing block is left alone
// rather than rewritten, so key rotation is a manual edit. Swap in a TOML
// writer if aznex ever needs to update the block in place.
export function codexMcpRegistered(toml: string): boolean {
  return /^\s*\[mcp_servers\.aznex\]\s*$/m.test(toml);
}

export function appendCodexMcpBlock(toml: string, serviceUrl: string, apiKey: string): string | null {
  if (codexMcpRegistered(toml)) return null;
  const block =
    `\n[mcp_servers.aznex]\nurl = "${serviceUrl}/mcp"\n\n` +
    `[mcp_servers.aznex.http_headers]\nAuthorization = "Bearer ${apiKey}"\n`;
  return toml.endsWith("\n") || toml === "" ? toml + block : toml + "\n" + block;
}

/** True once every aznex relay is registered — the doctor's hooks check. */
export function codexHooksRegistered(config: Record<string, unknown>): boolean {
  const hooks = (config["hooks"] ?? {}) as Record<string, HookEntry[] | undefined>;
  return HOOKS.every((hook) =>
    (hooks[hook.event] ?? []).some((entry) =>
      (entry.hooks ?? []).some((h) => isOurs(h.command, hook.endpoint)),
    ),
  );
}
