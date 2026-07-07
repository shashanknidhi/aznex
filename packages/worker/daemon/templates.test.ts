import { test, expect } from "bun:test";
import {
  launchdPlist, systemdUnit, rotateIfNeeded, MAX_LOG_BYTES,
  type DaemonPaths,
} from "./templates.js";

const P: DaemonPaths = {
  bunPath: "/usr/local/bin/bun",
  workerEntry: "/repo/packages/worker/src/index.ts",
  logFile: "/home/dev/.aznex/logs/worker.log",
};

test("launchd plist runs at load, keeps alive, logs to the log file", () => {
  const plist = launchdPlist(P);
  expect(plist).toContain("<string>ai.aznex.worker</string>");
  expect(plist).toContain("<string>/usr/local/bin/bun</string>");
  expect(plist).toContain("<string>/repo/packages/worker/src/index.ts</string>");
  expect(plist).toContain("<key>RunAtLoad</key><true/>");
  expect(plist).toContain("<key>KeepAlive</key><true/>");
  expect(plist.match(/worker\.log/g)?.length).toBe(2); // stdout + stderr
});

test("systemd unit restarts always with 2s backoff and appends to log", () => {
  const unit = systemdUnit(P);
  expect(unit).toContain("ExecStart=/usr/local/bin/bun /repo/packages/worker/src/index.ts");
  expect(unit).toContain("Restart=always");
  expect(unit).toContain("RestartSec=2");
  expect(unit).toContain("append:/home/dev/.aznex/logs/worker.log");
  expect(unit).toContain("WantedBy=default.target");
});

test("rotateIfNeeded rotates only past the cap, keeping one generation", () => {
  const moves: [string, string][] = [];
  const rename = (a: string, b: string) => moves.push([a, b]);

  expect(rotateIfNeeded(MAX_LOG_BYTES - 1, rename, "/l/worker.log")).toBe(false);
  expect(moves.length).toBe(0);

  expect(rotateIfNeeded(MAX_LOG_BYTES, rename, "/l/worker.log")).toBe(true);
  expect(moves).toEqual([["/l/worker.log", "/l/worker.log.1"]]);
});
