#!/usr/bin/env bun
// Claude Code hook adapter (#17). Claude Code pipes the hook event JSON to
// stdin; argv[2] picks the worker endpoint. Never blocks the agent: short
// timeout, always exits 0 (a dead worker must not break the IDE).
//
//   (none) / hook  → POST /hook          fire-and-forget capture
//   context        → POST /context       SessionStart injection; body relayed to stdout
//   file-context   → POST /file-context  PreToolUse(Read) injection; body relayed to stdout

import { appendFileSync, existsSync, renameSync, statSync } from "fs";
import { rotateIfNeeded } from "../daemon/templates.js";

const TIMEOUTS_MS: Record<string, number> = { hook: 2000, context: 5000, "file-context": 2000 };

// A dropped event used to be invisible on both sides — the relay swallowed the
// error and the worker never saw the session, so a whole session going missing
// left no trace anywhere. Append here instead; still never throws.
function logDrop(endpoint: string, err: unknown): void {
  try {
    const line = `${new Date().toISOString()} hook ${endpoint} dropped — ${err instanceof Error ? err.message : err}\n`;
    const path = `${process.env["HOME"]}/.aznex/logs/hook.log`;
    // A down worker means one line per hook event, so this grows faster than
    // any other log we own. Same cap and one-generation policy as worker.log.
    // Safe to rename here (unlike the daemon's stdout): each hook is its own
    // short-lived process holding no long-open handle on the file.
    if (existsSync(path)) rotateIfNeeded(statSync(path).size, renameSync, path);
    appendFileSync(path, line);
  } catch {
    // No home, no logs dir, read-only disk — logging must never break the hook.
  }
}

// bodyOverride exists so tests can drive this without a live stdin.
export async function forwardHook(endpoint = "hook", bodyOverride?: string): Promise<void> {
  const workerUrl = process.env["AZNEX_WORKER_URL"] ?? "http://localhost:29639";

  const body = bodyOverride ?? (await Bun.stdin.text());
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
  } catch (err) {
    // Worker down or slow — drop the event rather than stall the agent, but
    // leave a breadcrumb so "nothing was captured" is diagnosable.
    logDrop(endpoint, err);
  }
}

if (import.meta.main) {
  await forwardHook(process.argv[2]);
  process.exit(0);
}
