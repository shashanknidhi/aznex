#!/usr/bin/env bun
// Claude Code hook adapter (#17). Claude Code pipes the hook event JSON to
// stdin; we forward it to the local worker and exit. Never blocks the agent:
// short timeout, always exits 0 (a dead worker must not break the IDE).

export async function forwardHook(): Promise<void> {
  const workerUrl = process.env["AZNEX_WORKER_URL"] ?? "http://localhost:29639";

  const body = await Bun.stdin.text();
  try {
    await fetch(`${workerUrl}/hook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Worker down or slow — drop the event silently rather than stall the agent.
  }
}

if (import.meta.main) {
  await forwardHook();
  process.exit(0);
}
