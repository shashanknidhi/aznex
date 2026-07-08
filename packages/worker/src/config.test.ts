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
  delete process.env["AZNEX_EXTRACT_MODEL"];
  const path = tmpConfig(JSON.stringify({
    serviceUrl: "https://svc", apiKey: "axk_x", workerPort: 4000, claudePath: "/opt/claude",
    extractModel: "claude-haiku-4-5", contextEnabled: false, contextMemoryCount: 5, fileContextEnabled: false,
  }));
  const cfg = loadWorkerConfig(path);
  expect(cfg).toEqual({
    serviceUrl: "https://svc", apiKey: "axk_x", workerPort: 4000, claudePath: "/opt/claude",
    extractModel: "claude-haiku-4-5", contextEnabled: false, contextMemoryCount: 5, fileContextEnabled: false,
  });
});

test("AZNEX_EXTRACT_MODEL env wins over the config file", () => {
  process.env["AZNEX_EXTRACT_MODEL"] = "claude-sonnet-5";
  const path = tmpConfig(JSON.stringify({ extractModel: "claude-haiku-4-5" }));
  expect(loadWorkerConfig(path).extractModel).toBe("claude-sonnet-5");
  delete process.env["AZNEX_EXTRACT_MODEL"];
});

test("env vars win over the config file", () => {
  process.env["AZNEX_SERVICE_URL"] = "https://env-svc";
  const path = tmpConfig(JSON.stringify({ serviceUrl: "https://file-svc", apiKey: "axk_x" }));
  expect(loadWorkerConfig(path).serviceUrl).toBe("https://env-svc");
  delete process.env["AZNEX_SERVICE_URL"];
});

test("missing or malformed config file degrades to nulls and defaults", () => {
  const missing = loadWorkerConfig("/nonexistent/config.json");
  expect(missing).toEqual({
    serviceUrl: null, apiKey: null, workerPort: 29639, claudePath: null,
    extractModel: null, contextEnabled: true, contextMemoryCount: 10, fileContextEnabled: true,
  });
  const malformed = loadWorkerConfig(tmpConfig("not json{"));
  expect(malformed.serviceUrl).toBe(null);
});

test("mergeClaudeSettings adds all hook events with matchers and is idempotent", () => {
  const cmd = "/usr/local/bin/bun /repo/hooks/claude-code-hook.ts";
  const first = mergeClaudeSettings({}, cmd);
  expect(first.added).toEqual(["PostToolUse", "Stop", "SessionEnd", "SessionStart", "PreToolUse"]);
  const hooks = first.settings["hooks"] as Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  expect(hooks["PostToolUse"]![0]!.hooks[0]!.command).toBe(cmd);
  expect(hooks["SessionStart"]![0]!.matcher).toBe("startup|clear|compact");
  expect(hooks["SessionStart"]![0]!.hooks[0]!.command).toBe(`${cmd} context`);
  expect(hooks["PreToolUse"]![0]!.matcher).toBe("Read");
  expect(hooks["PreToolUse"]![0]!.hooks[0]!.command).toBe(`${cmd} file-context`);

  const second = mergeClaudeSettings(first.settings, cmd);
  expect(second.added).toEqual([]);
  expect(second.settings).toEqual(first.settings);
});

test("re-running setup on a pre-context install adds only the new events", () => {
  const cmd = "/bun /repo/hooks/claude-code-hook.ts";
  // simulate an install that only had the original two events
  const old = { hooks: {
    PostToolUse: [{ hooks: [{ type: "command", command: cmd }] }],
    Stop: [{ hooks: [{ type: "command", command: cmd }] }],
  } };
  const { added, updated } = mergeClaudeSettings(old, cmd);
  expect(added).toEqual(["SessionEnd", "SessionStart", "PreToolUse"]);
  expect(updated).toEqual([]);
});

test("setup from a different install path repoints hooks instead of duplicating", () => {
  const oldCmd = "/bun /old-install/hooks/claude-code-hook.ts";
  const first = mergeClaudeSettings({}, oldCmd);
  const newCmd = "/bun /new-install/hooks/claude-code-hook.ts";
  const { settings, added, updated } = mergeClaudeSettings(first.settings, newCmd);

  expect(added).toEqual([]);
  expect(updated).toEqual(["PostToolUse", "Stop", "SessionEnd", "SessionStart", "PreToolUse"]);
  const hooks = settings["hooks"] as Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  for (const event of Object.keys(hooks)) {
    const commands = hooks[event]!.flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands.length).toBe(1); // no duplicates
    expect(commands[0]).toStartWith(newCmd);
  }
  expect(hooks["SessionStart"]![0]!.matcher).toBe("startup|clear|compact"); // matcher survives rewrite
});

test("duplicated entries from older setups collapse to one", () => {
  const cmd = "/bun /a/hooks/claude-code-hook.ts";
  const damaged = { hooks: {
    Stop: [
      { hooks: [{ type: "command", command: "/bun /a/hooks/claude-code-hook.ts" }] },
      { hooks: [{ type: "command", command: "/bun /b/hooks/claude-code-hook.ts" }] },
      { hooks: [{ type: "command", command: "other-tool" }] },
    ],
  } };
  const { settings, updated } = mergeClaudeSettings(damaged, cmd);
  const stop = (settings["hooks"] as Record<string, { hooks: { command: string }[] }[]>)["Stop"]!;
  const commands = stop.flatMap((e) => e.hooks.map((h) => h.command));
  expect(updated).toContain("Stop");
  expect(commands.filter((c) => c.includes("claude-code-hook.ts"))).toEqual([cmd]);
  expect(commands).toContain("other-tool"); // foreign hooks untouched
});

test("mergeClaudeSettings preserves existing unrelated hooks", () => {
  const existing = {
    hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "other-tool" }] }] },
    theme: "dark",
  };
  const { settings, added } = mergeClaudeSettings(existing, "aznex-hook");
  expect(added).toEqual(["PostToolUse", "Stop", "SessionEnd", "SessionStart", "PreToolUse"]);
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
