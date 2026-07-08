import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runChecks, printReport, type CheckResult } from "./doctor.js";
import { parseAgents, buildMcpAddArgs } from "../setup.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "aznex-doctor-"));
}

function tmpFile(name: string, content: object): string {
  const path = join(tmpDir(), name);
  writeFileSync(path, JSON.stringify(content));
  return path;
}

const GOOD_CONFIG = { serviceUrl: "https://svc", apiKey: "axk_x", claudePath: "/bin/sh" }; // any existing file works as claudePath

const ALL_HOOKS = Object.fromEntries(
  ["PostToolUse", "Stop", "SessionEnd", "SessionStart", "PreToolUse"].map((e) => [
    e,
    [{ hooks: [{ type: "command", command: "/bun /x/hooks/claude-code-hook.ts" }] }],
  ]),
);

const okFetch = (async () => Response.json({ ok: true })) as unknown as typeof fetch;

function get(results: CheckResult[], name: string): CheckResult {
  const r = results.find((x) => x.name === name);
  if (!r) throw new Error(`no check named ${name}`);
  return r;
}

test("missing config → fail with setup hint; service checks skipped", async () => {
  const results = await runChecks({
    configPath: "/nonexistent/config.json",
    claudeSettingsPath: "/nonexistent/settings.json",
    claudeJsonPath: "/nonexistent/claude.json",
    pluginDirs: ["/nonexistent"],
    fetchImpl: (async () => { throw new Error("down"); }) as unknown as typeof fetch,
  });
  const config = get(results, "config");
  expect(config.status).toBe("fail");
  expect(config.fix).toContain("aznex-worker setup");
  expect(results.find((r) => r.name === "service reachable")).toBeUndefined();
});

test("healthy install → everything ok, exit code 0", async () => {
  const results = await runChecks({
    configPath: tmpFile("config.json", GOOD_CONFIG),
    claudeSettingsPath: tmpFile("settings.json", { hooks: ALL_HOOKS }),
    claudeJsonPath: tmpFile("claude.json", { mcpServers: { aznex: { url: "https://svc/mcp" } } }),
    pluginDirs: ["/nonexistent"],
    fetchImpl: okFetch,
    platform: process.platform,
  });
  // daemon check inspects the real machine — ignore it here
  const rest = results.filter((r) => r.name !== "daemon installed");
  expect(rest.every((r) => r.status === "ok")).toBe(true);
});

test("401 from service → API key fail with re-auth hint", async () => {
  const results = await runChecks({
    configPath: tmpFile("config.json", GOOD_CONFIG),
    claudeSettingsPath: "/nonexistent",
    claudeJsonPath: "/nonexistent",
    pluginDirs: ["/nonexistent"],
    fetchImpl: (async (url: string | URL | Request) =>
      String(url).includes("/api/repos")
        ? new Response("{}", { status: 401 })
        : Response.json({ ok: true })) as typeof fetch,
  });
  const key = get(results, "API key");
  expect(key.status).toBe("fail");
  expect(key.fix).toContain("re-run setup");
});

test("partial hooks → warn naming the missing events", async () => {
  const partial = { PostToolUse: ALL_HOOKS["PostToolUse"], Stop: ALL_HOOKS["Stop"] };
  const results = await runChecks({
    configPath: tmpFile("config.json", GOOD_CONFIG),
    claudeSettingsPath: tmpFile("settings.json", { hooks: partial }),
    claudeJsonPath: "/nonexistent",
    pluginDirs: ["/nonexistent"],
    fetchImpl: okFetch,
  });
  const hooks = get(results, "hooks");
  expect(hooks.status).toBe("warn");
  expect(hooks.detail).toContain("SessionStart");
});

test("no settings hooks but plugin installed → hooks ok via plugin", async () => {
  const pluginDir = tmpDir();
  mkdirSync(join(pluginDir, "hooks"), { recursive: true });
  const results = await runChecks({
    configPath: tmpFile("config.json", GOOD_CONFIG),
    claudeSettingsPath: "/nonexistent",
    claudeJsonPath: "/nonexistent",
    pluginDirs: [pluginDir],
    fetchImpl: okFetch,
  });
  const hooks = get(results, "hooks");
  expect(hooks.status).toBe("ok");
  expect(hooks.detail).toContain("plugin");
});

test("MCP registered only project-scope → warn suggesting user scope", async () => {
  const results = await runChecks({
    configPath: tmpFile("config.json", GOOD_CONFIG),
    claudeSettingsPath: "/nonexistent",
    claudeJsonPath: tmpFile("claude.json", {
      mcpServers: {},
      projects: { "/some/repo": { mcpServers: { aznex: { url: "https://svc/mcp" } } } },
    }),
    pluginDirs: ["/nonexistent"],
    fetchImpl: okFetch,
  });
  const mcp = get(results, "MCP (reads)");
  expect(mcp.status).toBe("warn");
  expect(mcp.detail).toContain("1 project(s)");
  expect(mcp.fix).toContain("-s user");
});

test("MCP unregistered → warn including the add command", async () => {
  const results = await runChecks({
    configPath: tmpFile("config.json", GOOD_CONFIG),
    claudeSettingsPath: "/nonexistent",
    claudeJsonPath: "/nonexistent",
    pluginDirs: ["/nonexistent"],
    fetchImpl: okFetch,
  });
  const mcp = get(results, "MCP (reads)");
  expect(mcp.status).toBe("warn");
  expect(mcp.fix).toContain("claude mcp add aznex -s user");
});

test("printReport exit code: fail → 1, warn-only → 0", () => {
  const silent = console.log;
  console.log = () => {};
  try {
    expect(printReport([{ name: "a", status: "ok" }, { name: "b", status: "warn" }])).toBe(0);
    expect(printReport([{ name: "a", status: "fail" }])).toBe(1);
  } finally {
    console.log = silent;
  }
});

test("parseAgents: default claude-code, planned agents error as coming soon", () => {
  expect(parseAgents(undefined)).toEqual(["claude-code"]);
  expect(parseAgents("claude-code")).toEqual(["claude-code"]);
  expect(() => parseAgents("codex")).toThrow("coming soon");
  expect(() => parseAgents("vim")).toThrow("unknown agent");
});

test("buildMcpAddArgs produces the user-scope http registration", () => {
  const args = buildMcpAddArgs("/bin/claude", "https://svc", "axk_x");
  expect(args).toEqual([
    "/bin/claude", "mcp", "add", "aznex",
    "-s", "user",
    "--transport", "http",
    "https://svc/mcp",
    "--header", "Authorization: Bearer axk_x",
  ]);
});
