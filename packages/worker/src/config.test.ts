import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadWorkerConfig } from "./config.js";
import { mergeClaudeSettings } from "./claude-settings.js";

function tmpConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aznex-cfg-"));
  const path = join(dir, "config.json");
  writeFileSync(path, content);
  return path;
}

test("config file supplies values when env is unset", () => {
  delete process.env["AZNEX_SERVICE_URL"];
  delete process.env["AZNEX_API_KEY"];
  delete process.env["CLAUDE_CODE_PATH"];
  const path = tmpConfig(JSON.stringify({ serviceUrl: "https://svc", apiKey: "axk_x", workerPort: 4000, claudePath: "/opt/claude" }));
  const cfg = loadWorkerConfig(path);
  expect(cfg).toEqual({ serviceUrl: "https://svc", apiKey: "axk_x", workerPort: 4000, claudePath: "/opt/claude" });
});

test("env vars win over the config file", () => {
  process.env["AZNEX_SERVICE_URL"] = "https://env-svc";
  const path = tmpConfig(JSON.stringify({ serviceUrl: "https://file-svc", apiKey: "axk_x" }));
  expect(loadWorkerConfig(path).serviceUrl).toBe("https://env-svc");
  delete process.env["AZNEX_SERVICE_URL"];
});

test("missing or malformed config file degrades to nulls and default port", () => {
  const missing = loadWorkerConfig("/nonexistent/config.json");
  expect(missing).toEqual({ serviceUrl: null, apiKey: null, workerPort: 3001, claudePath: null });
  const malformed = loadWorkerConfig(tmpConfig("not json{"));
  expect(malformed.serviceUrl).toBe(null);
});

test("mergeClaudeSettings adds both hook events and is idempotent", () => {
  const cmd = "/usr/local/bin/bun /repo/hooks/claude-code-hook.ts";
  const first = mergeClaudeSettings({}, cmd);
  expect(first.added).toEqual(["PostToolUse", "Stop"]);
  const hooks = first.settings["hooks"] as Record<string, unknown[]>;
  expect(hooks["PostToolUse"]!.length).toBe(1);

  const second = mergeClaudeSettings(first.settings, cmd);
  expect(second.added).toEqual([]);
  expect(second.settings).toEqual(first.settings);
});

test("mergeClaudeSettings preserves existing unrelated hooks", () => {
  const existing = {
    hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "other-tool" }] }] },
    theme: "dark",
  };
  const { settings, added } = mergeClaudeSettings(existing, "aznex-hook");
  expect(added).toEqual(["PostToolUse", "Stop"]);
  const post = (settings["hooks"] as Record<string, unknown[]>)["PostToolUse"]!;
  expect(post.length).toBe(2); // other-tool entry untouched, aznex appended
  expect(settings["theme"]).toBe("dark");
  expect(existing.hooks.PostToolUse.length).toBe(1); // input not mutated
});

import { findClaude } from "./extract.js";

test("stale persisted claudePath falls through to discovery instead of throwing", () => {
  delete process.env["CLAUDE_CODE_PATH"];
  const path = tmpConfig(JSON.stringify({ claudePath: "/nonexistent/claude-binary" }));
  // Must NOT throw the stale-path error: either discovery finds a real
  // claude (dev machines) or the generic not-found error surfaces (CI).
  try {
    expect(typeof findClaude(path)).toBe("string");
  } catch (err) {
    expect(String(err)).toContain("claude executable not found");
  }
});

test("explicit CLAUDE_CODE_PATH override fails loud when wrong", () => {
  process.env["CLAUDE_CODE_PATH"] = "/nonexistent/override";
  try {
    expect(() => findClaude()).toThrow("CLAUDE_CODE_PATH set but not found");
  } finally {
    delete process.env["CLAUDE_CODE_PATH"];
  }
});
