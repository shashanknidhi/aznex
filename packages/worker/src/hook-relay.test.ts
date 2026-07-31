import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { forwardHook } from "../hooks/claude-code-hook.js";
import { MAX_LOG_BYTES } from "../daemon/templates.js";

// A dropped hook event used to leave no trace anywhere, which made a whole
// missing session undiagnosable. The relay must still never throw.
// Port 1 is never a worker: connection refused immediately.
const DEAD_WORKER = "http://127.0.0.1:1";

async function withHome(home: string, fn: () => Promise<void>): Promise<void> {
  const orig = { home: process.env["HOME"], url: process.env["AZNEX_WORKER_URL"] };
  process.env["HOME"] = home;
  process.env["AZNEX_WORKER_URL"] = DEAD_WORKER;
  try {
    await fn();
  } finally {
    if (orig.home === undefined) delete process.env["HOME"];
    else process.env["HOME"] = orig.home;
    if (orig.url === undefined) delete process.env["AZNEX_WORKER_URL"];
    else process.env["AZNEX_WORKER_URL"] = orig.url;
  }
}

test("worker unreachable: relay does not throw and records the drop", async () => {
  const home = mkdtempSync(join(tmpdir(), "aznex-hook-"));
  await Bun.write(join(home, ".aznex", "logs", ".keep"), "");
  await withHome(home, () => forwardHook("hook", "{}")); // must resolve, not reject
  const log = join(home, ".aznex", "logs", "hook.log");
  expect(existsSync(log)).toBe(true);
  expect(readFileSync(log, "utf8")).toContain("hook hook dropped");
});

test("hook.log past the cap rotates to one generation before appending", async () => {
  const home = mkdtempSync(join(tmpdir(), "aznex-hook-"));
  const log = join(home, ".aznex", "logs", "hook.log");
  await Bun.write(log, "x".repeat(MAX_LOG_BYTES));
  await withHome(home, () => forwardHook("hook", "{}"));
  expect(statSync(`${log}.1`).size).toBe(MAX_LOG_BYTES);
  const fresh = readFileSync(log, "utf8");
  expect(fresh).toContain("hook hook dropped");
  expect(fresh.length).toBeLessThan(500); // rotated, not appended to the old file
});

test("no logs directory: relay still does not throw", async () => {
  const home = mkdtempSync(join(tmpdir(), "aznex-hook-"));
  // ~/.aznex/logs absent — logging must fail silently. Resolving is the assertion.
  await withHome(home, () => forwardHook("hook", "{}"));
});
