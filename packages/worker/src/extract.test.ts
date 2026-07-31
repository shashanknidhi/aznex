import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildClaudeArgs,
  buildCodexArgs,
  stripFence,
  parseMemoryArray,
  extractMemories,
  extractionModel,
  resolveExtractionEngine,
  findClaude as findClaudeReal,
  findCodex,
} from "./extract.js";

test("buildClaudeArgs passes --model only when configured", () => {
  const withModel = buildClaudeArgs("/bin/claude", "/p.md", "/obs.jsonl", "claude-haiku-4-5");
  const modelIdx = withModel.indexOf("--model");
  expect(modelIdx).toBeGreaterThan(-1);
  expect(withModel[modelIdx + 1]).toBe("claude-haiku-4-5");

  const withoutModel = buildClaudeArgs("/bin/claude", "/p.md", "/obs.jsonl", null);
  expect(withoutModel).not.toContain("--model");
  // everything else identical
  expect(withoutModel).toEqual(withModel.filter((_, i) => i !== modelIdx && i !== modelIdx + 1));
});

test("buildCodexArgs runs read-only in a throwaway cwd and passes -m only when configured", () => {
  const args = buildCodexArgs("/bin/codex", "/tmp/work", "/tmp/out.txt", null);
  expect(args.slice(0, 2)).toEqual(["/bin/codex", "exec"]);
  expect(args).toContain("--skip-git-repo-check");
  expect(args).toContain("--ephemeral");
  expect(args[args.indexOf("-s") + 1]).toBe("read-only");
  // non-git cwd is the recursion guard: relayed hook events from this run have
  // no repo fingerprint, so the pipeline drops them
  expect(args[args.indexOf("--cd") + 1]).toBe("/tmp/work");
  expect(args[args.indexOf("-o") + 1]).toBe("/tmp/out.txt");
  expect(args.at(-1)).toBe("-"); // prompt on stdin
  expect(args).not.toContain("-m");

  expect(buildCodexArgs("/bin/codex", "/tmp/work", "/tmp/out.txt", "gpt-5")).toContain("-m");
});

test("stripFence unwraps a fenced JSON array and leaves bare JSON alone", () => {
  expect(stripFence('```json\n[{"a":1}]\n```')).toBe('[{"a":1}]');
  expect(stripFence('```\n[]\n```')).toBe("[]");
  expect(stripFence(' [{"a":1}] ')).toBe('[{"a":1}]');
});

const fakeBin = (name: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), "aznex-bin-")), name);
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
};

test("resolveExtractionEngine prefers claude, falls back to codex, throws when neither exists", () => {
  const missing = (what: string) => () => {
    throw new Error(`${what} executable not found`);
  };
  const claude = fakeBin("claude");
  const codex = fakeBin("codex");
  // An explicit empty config, never the default path: resolution reads
  // extractAgent, so a developer whose own ~/.aznex/config.json pins an engine
  // would otherwise fail this test.
  const cfg = tmpConfig({});

  expect(resolveExtractionEngine(cfg, { claude: () => claude, codex: () => codex }))
    .toEqual({ engine: "claude", path: claude });
  expect(resolveExtractionEngine(cfg, { claude: missing("claude"), codex: () => codex }))
    .toEqual({ engine: "codex", path: codex });
  expect(() => resolveExtractionEngine(cfg, { claude: missing("claude"), codex: missing("codex") }))
    .toThrow("neither `claude` nor `codex` found");
});

const tmpConfig = (content: object): string => {
  const path = join(mkdtempSync(join(tmpdir(), "aznex-cfg-")), "config.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
};

test("extractAgent pins the engine instead of falling back", () => {
  const missing = (what: string) => () => {
    throw new Error(`${what} executable not found`);
  };
  const claude = fakeBin("claude");
  const codex = fakeBin("codex");
  const deps = { claude: () => claude, codex: () => codex };

  // codex pinned wins even though claude resolves fine
  expect(resolveExtractionEngine(tmpConfig({ extractAgent: "codex" }), deps))
    .toEqual({ engine: "codex", path: codex });
  expect(resolveExtractionEngine(tmpConfig({ extractAgent: "claude" }), deps))
    .toEqual({ engine: "claude", path: claude });

  // a pinned-but-missing engine throws rather than quietly using the other one
  expect(() =>
    resolveExtractionEngine(tmpConfig({ extractAgent: "claude" }), { claude: missing("claude"), codex: () => codex }),
  ).toThrow("claude executable not found");
  expect(() =>
    resolveExtractionEngine(tmpConfig({ extractAgent: "codex" }), { claude: () => claude, codex: missing("codex") }),
  ).toThrow("codex executable not found");
});

test("a bogus extractAgent degrades to auto-detection", () => {
  const claude = fakeBin("claude");
  expect(
    resolveExtractionEngine(tmpConfig({ extractAgent: "gemini" }), {
      claude: () => claude,
      codex: () => fakeBin("codex"),
    }),
  ).toEqual({ engine: "claude", path: claude });
});

test("extractionModel defaults to the engine's cheapest and honours a valid override", () => {
  expect(extractionModel("claude", tmpConfig({}))).toBe("claude-haiku-4-5");
  expect(extractionModel("codex", tmpConfig({}))).toBe("gpt-5.6-luna");
  expect(extractionModel("codex", tmpConfig({ extractModel: "gpt-5.6-sol" }))).toBe("gpt-5.6-sol");
  // stale model from the other engine — discarded, not passed to the CLI
  expect(extractionModel("codex", tmpConfig({ extractModel: "claude-opus-5" }))).toBe("gpt-5.6-luna");
});

test("findCodex: env override wins, and fails loud when it doesn't resolve", () => {
  const codex = fakeBin("codex");
  process.env["CODEX_PATH"] = codex;
  try {
    expect(findCodex()).toBe(codex);
    process.env["CODEX_PATH"] = "/nonexistent/codex";
    expect(() => findCodex()).toThrow("CODEX_PATH set but not found");
  } finally {
    delete process.env["CODEX_PATH"];
  }
});

test("a wrong explicit CLAUDE_CODE_PATH fails loud instead of silently using codex", () => {
  process.env["CLAUDE_CODE_PATH"] = "/nonexistent/claude";
  try {
    expect(() => resolveExtractionEngine(tmpConfig({}), { claude: findClaudeReal, codex: () => "/bin/codex" }))
      .toThrow("CLAUDE_CODE_PATH set but not found");
  } finally {
    delete process.env["CLAUDE_CODE_PATH"];
  }
});

// ── tolerating what chat models actually reply with ──────────────────────────

// Both engines are chat models told to answer with JSON, not JSON-mode APIs.
// A pilot machine dropped a whole session to `SyntaxError: Unexpected
// identifier "Based"` when the model opened with a sentence.
test("parseMemoryArray accepts a bare JSON array", () => {
  expect(parseMemoryArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  expect(parseMemoryArray("  []  ")).toEqual([]);
});

test("parseMemoryArray unwraps a fenced array", () => {
  expect(parseMemoryArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
});

test("parseMemoryArray recovers the array from a prose preamble", () => {
  expect(parseMemoryArray('Based on the session transcript, here are the records:\n[{"a":1}]')).toEqual([{ a: 1 }]);
  expect(parseMemoryArray('Here you go:\n```json\n[{"a":1}]\n```\nLet me know if you need more.')).toEqual([{ a: 1 }]);
});

test("parseMemoryArray rejects a JSON object — the contract is an array", () => {
  expect(() => parseMemoryArray('{"a":1}')).toThrow("not a JSON array");
});

test("parseMemoryArray reports what the model said, truncated", () => {
  expect(() => parseMemoryArray("I could not find anything to extract.")).toThrow(
    "I could not find anything to extract.",
  );
  // The transcript being summarised stays on this machine; the log gets a snippet.
  let message = "";
  try {
    parseMemoryArray("x".repeat(5000));
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message.length).toBeLessThan(300);
});

test("extractMemories survives a chatty model and still returns records", async () => {
  const record = {
    type: "extracted_learning",
    title: "t",
    content: "c",
    narrative: null,
    facts: [],
    concepts: [],
    files_read: [],
    files_modified: [],
  };
  const memories = await extractMemories(
    [{ type: "raw_observation", title: "Edit: a.ts", content: "x", files_read: [], files_modified: ["a.ts"] }],
    { repoFingerprint: "github.com/acme/thing", sessionId: "s1" },
    async () => `Based on the transcript, here is the array:\n\`\`\`json\n${JSON.stringify([record])}\n\`\`\``,
  );
  expect(memories.length).toBe(1);
  expect(memories[0]!.content).toBe("c");
});
