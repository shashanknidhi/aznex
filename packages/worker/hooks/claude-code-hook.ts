#!/usr/bin/env bun
// Claude Code hook adapter (#17). Claude Code pipes the hook event JSON to
// stdin; argv[2] picks the worker endpoint. Never blocks the agent: short
// timeout, always exits 0 (a dead worker must not break the IDE).
//
//   (none) / hook  → POST /hook          fire-and-forget capture
//   context        → POST /context       SessionStart injection; body relayed to stdout
//   file-context   → POST /file-context  PreToolUse(Read) injection; body relayed to stdout

const TIMEOUTS_MS: Record<string, number> = { hook: 2000, context: 5000, "file-context": 2000 };

export async function forwardHook(endpoint = "hook"): Promise<void> {
  const workerUrl = process.env["AZNEX_WORKER_URL"] ?? "http://localhost:29639";

  const body = await Bun.stdin.text();
  try {
    const res = await fetch(`${workerUrl}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUTS_MS[endpoint] ?? 2000),
    });
    if (endpoint !== "hook") {
      // Context endpoints return hook-output JSON (or an empty body); whatever
      // we print on stdout is what Claude Code injects.
      const text = await res.text();
      if (text) process.stdout.write(text);
    }
  } catch {
    // Worker down or slow — drop the event silently rather than stall the agent.
  }
}

if (import.meta.main) {
  await forwardHook(process.argv[2]);
  process.exit(0);
}
