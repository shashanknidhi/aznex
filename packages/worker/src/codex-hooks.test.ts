import { test, expect } from "bun:test";
import {
  mergeCodexHooks,
  codexHooksRegistered,
  appendCodexMcpBlock,
  codexMcpRegistered,
} from "./codex-hooks.js";

test("merge into an empty config registers every event", () => {
  const { config, added, updated } = mergeCodexHooks({});
  expect(added.sort()).toEqual(["PostToolUse", "SessionEnd", "SessionStart", "Stop"]);
  expect(updated).toEqual([]);
  expect(codexHooksRegistered(config)).toBe(true);
});

test("capture relays carry ?agent=codex so sessions aren't filed as claude-code", () => {
  const { config } = mergeCodexHooks({});
  const hooks = config["hooks"] as Record<string, { hooks: { command: string }[] }[]>;
  for (const event of ["PostToolUse", "Stop", "SessionEnd"]) {
    expect(hooks[event]![0]!.hooks[0]!.command).toContain("/hook?agent=codex");
  }
  // Context injection is a read — the agent stamp is irrelevant there.
  expect(hooks["SessionStart"]![0]!.hooks[0]!.command).toContain("/context");
});

test("the whole URL is one quoted word — ? must not reach the shell as a glob", () => {
  const { config } = mergeCodexHooks({});
  const hooks = config["hooks"] as Record<string, { hooks: { command: string }[] }[]>;
  const command = hooks["PostToolUse"]![0]!.hooks[0]!.command;
  expect(command).toContain('"${AZNEX_WORKER_URL:-http://localhost:29639}/hook?agent=codex"');
});

test("PostToolUse matcher is a valid regex (Codex rejects Claude Code's bare *)", () => {
  const { config } = mergeCodexHooks({});
  const hooks = config["hooks"] as Record<string, { matcher?: string }[]>;
  const matcher = hooks["PostToolUse"]![0]!.matcher!;
  expect(matcher).toBe(".*");
  expect(() => new RegExp(matcher)).not.toThrow();
});

test("re-running is idempotent", () => {
  const first = mergeCodexHooks({});
  const second = mergeCodexHooks(first.config);
  expect(second.added).toEqual([]);
  expect(second.updated).toEqual([]);
  expect(second.config).toEqual(first.config);
});

test("a stale relay command is replaced, not duplicated", () => {
  const stale = {
    hooks: {
      PostToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: `curl -sf -X POST --data-binary @- "\${AZNEX_WORKER_URL:-http://localhost:1234}"/hook?agent=codex`,
            },
          ],
        },
      ],
    },
  };
  const { config, added, updated } = mergeCodexHooks(stale);
  expect(added).not.toContain("PostToolUse");
  expect(updated).toContain("PostToolUse");
  const entries = (config["hooks"] as Record<string, { hooks: { command: string }[] }[]>)["PostToolUse"]!;
  expect(entries.flatMap((e) => e.hooks)).toHaveLength(1);
});

test("hand-written claude-code-hook.ts wirings are reclaimed, not duplicated", () => {
  const handWired = {
    hooks: {
      PostToolUse: [{ hooks: [{ type: "command", command: "/bun /x/hooks/claude-code-hook.ts" }] }],
      SessionStart: [
        {
          matcher: "startup|clear|compact",
          hooks: [{ type: "command", command: "/bun /x/hooks/claude-code-hook.ts context" }],
        },
      ],
    },
  };
  const { config, added, updated } = mergeCodexHooks(handWired);
  expect(updated.sort()).toEqual(["PostToolUse", "SessionStart"]);
  expect(added.sort()).toEqual(["SessionEnd", "Stop"]);
  const hooks = config["hooks"] as Record<string, { hooks: { command: string }[] }[]>;
  for (const event of ["PostToolUse", "SessionStart"]) {
    const commands = hooks[event]!.flatMap((e) => e.hooks).map((h) => h.command);
    expect(commands).toHaveLength(1); // exactly one relay per event, or events post twice
    expect(commands[0]).toContain("AZNEX_WORKER_URL");
  }
});

test("foreign hooks survive the merge", () => {
  const foreign = {
    hooks: {
      PostToolUse: [{ hooks: [{ type: "command", command: "rtk hook codex" }] }],
    },
  };
  const { config } = mergeCodexHooks(foreign);
  const commands = (config["hooks"] as Record<string, { hooks: { command: string }[] }[]>)["PostToolUse"]!
    .flatMap((e) => e.hooks)
    .map((h) => h.command);
  expect(commands).toContain("rtk hook codex");
  expect(commands.some((c) => c.includes("AZNEX_WORKER_URL"))).toBe(true);
});

test("a partial install reports unregistered", () => {
  const { config } = mergeCodexHooks({});
  delete (config["hooks"] as Record<string, unknown>)["Stop"];
  expect(codexHooksRegistered(config)).toBe(false);
});

test("MCP block is appended once, with the bearer header", () => {
  const first = appendCodexMcpBlock("model = \"gpt-5\"\n", "https://aznex.example", "axk_secret");
  expect(first).not.toBeNull();
  expect(first!).toContain('[mcp_servers.aznex]\nurl = "https://aznex.example/mcp"');
  expect(first!).toContain('Authorization = "Bearer axk_secret"');
  expect(codexMcpRegistered(first!)).toBe(true);
  // Second pass must not double-register — Codex would fail to parse duplicate keys.
  expect(appendCodexMcpBlock(first!, "https://aznex.example", "axk_secret")).toBeNull();
});

test("MCP append keeps a missing trailing newline from fusing two lines", () => {
  const merged = appendCodexMcpBlock('model = "gpt-5"', "https://aznex.example", "k")!;
  expect(merged).toContain('model = "gpt-5"\n');
  expect(merged.split("\n").filter((l) => l.trim() !== "")[0]).toBe('model = "gpt-5"');
});
