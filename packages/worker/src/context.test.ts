import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { computeRepoFingerprint } from "@aznex/shared";
import { createContextHandlers } from "./context.js";

// This repo's own fingerprint — the handlers resolve it from cwd via git.
const CWD = process.cwd();

function tmpConfig(content: object): string {
  const dir = mkdtempSync(join(tmpdir(), "aznex-ctx-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

function stubFetch(items: { id: string; type: string; content: string }[], calls: string[] = []) {
  return (async (url: string | URL | Request) => {
    calls.push(String(url));
    return Response.json({ items });
  }) as typeof fetch;
}

const CONFIGURED = { serviceUrl: "https://svc", apiKey: "axk_x" };

test("sessionStartContext returns hookSpecificOutput with formatted memories", async () => {
  const calls: string[] = [];
  const { sessionStartContext } = createContextHandlers({
    configPath: tmpConfig(CONFIGURED),
    fetchImpl: stubFetch([{ id: "m1", type: "decision", content: "we use bun" }], calls),
  });
  const out = (await sessionStartContext({ session_id: "s1", cwd: CWD, source: "startup" })) as any;
  expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(out.hookSpecificOutput.additionalContext).toContain("- [decision] we use bun");
  const fingerprint = await computeRepoFingerprint(CWD);
  expect(calls[0]).toContain(`repo_fingerprint=${encodeURIComponent(fingerprint!)}`);
  expect(calls[0]).toContain("limit=10");
});

test("sessionStartContext: unconfigured → setup pointer; disabled or empty → null", async () => {
  const unconfigured = createContextHandlers({ configPath: "/nonexistent/config.json" });
  expect(await unconfigured.sessionStartContext({ cwd: CWD })).toEqual({
    systemMessage: "aznex not configured — run: npx aznex-worker setup",
  });

  const disabled = createContextHandlers({
    configPath: tmpConfig({ ...CONFIGURED, contextEnabled: false }),
    fetchImpl: stubFetch([{ id: "m1", type: "decision", content: "x" }]),
  });
  expect(await disabled.sessionStartContext({ cwd: CWD })).toBe(null);

  const empty = createContextHandlers({
    configPath: tmpConfig(CONFIGURED),
    fetchImpl: stubFetch([]),
  });
  expect(await empty.sessionStartContext({ cwd: CWD })).toBe(null);
});

test("sessionStartContext: service error or non-repo cwd → null, never throws", async () => {
  const failing = createContextHandlers({
    configPath: tmpConfig(CONFIGURED),
    fetchImpl: (async () => { throw new Error("boom"); }) as unknown as typeof fetch,
  });
  expect(await failing.sessionStartContext({ cwd: CWD })).toBe(null);

  const nonRepo = createContextHandlers({
    configPath: tmpConfig(CONFIGURED),
    fetchImpl: stubFetch([{ id: "m", type: "decision", content: "x" }]),
  });
  expect(await nonRepo.sessionStartContext({ cwd: "/tmp" })).toBe(null);
});

test("fileContext relativizes the path, dedups per session, and caches", async () => {
  const calls: string[] = [];
  const { fileContext } = createContextHandlers({
    configPath: tmpConfig(CONFIGURED),
    fetchImpl: stubFetch([{ id: "m1", type: "extracted_learning", content: "cache gotcha" }], calls),
  });
  const payload = { session_id: "s1", cwd: CWD, tool_input: { file_path: join(CWD, "src/cache.ts") } };

  const first = (await fileContext(payload)) as any;
  expect(first.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(first.hookSpecificOutput.additionalContext).toContain("src/cache.ts");
  expect(calls[0]).toContain(`path=${encodeURIComponent("src/cache.ts")}`);

  // same session re-read: memory already injected → null, and served from cache
  expect(await fileContext(payload)).toBe(null);
  expect(calls.length).toBe(1);

  // different session: injected again without a second fetch (cache hit)
  const second = (await fileContext({ ...payload, session_id: "s2" })) as any;
  expect(second.hookSpecificOutput.additionalContext).toContain("cache gotcha");
  expect(calls.length).toBe(1);
});

test("fileContext: disabled, unconfigured, or file outside cwd → null", async () => {
  const disabled = createContextHandlers({
    configPath: tmpConfig({ ...CONFIGURED, fileContextEnabled: false }),
    fetchImpl: stubFetch([{ id: "m", type: "decision", content: "x" }]),
  });
  const payload = { session_id: "s", cwd: CWD, tool_input: { file_path: join(CWD, "a.ts") } };
  expect(await disabled.fileContext(payload)).toBe(null);

  const unconfigured = createContextHandlers({ configPath: "/nonexistent/config.json" });
  expect(await unconfigured.fileContext(payload)).toBe(null);

  const outside = createContextHandlers({
    configPath: tmpConfig(CONFIGURED),
    fetchImpl: stubFetch([{ id: "m", type: "decision", content: "x" }]),
  });
  expect(await outside.fileContext({ session_id: "s", cwd: CWD, tool_input: { file_path: "/etc/hosts" } })).toBe(null);
});
