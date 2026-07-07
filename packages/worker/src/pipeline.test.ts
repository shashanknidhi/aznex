import { test, expect } from "bun:test";
import { IngestRequestSchema } from "@aznex/shared";
import { compressToolEvent, SKIP_TOOLS } from "./compress.js";
import { scrubContent } from "./scrub.js";
import { extractMemories, EXTRACTION_PROMPT_VERSION } from "./extract.js";
import { postIngest } from "./ingest-client.js";
import { createPipeline } from "./pipeline.js";

// ── compress (#18) ────────────────────────────────────────────────────────────

test("noisy tools and trivial shell commands are dropped", () => {
  expect(compressToolEvent({ tool_name: "Read", tool_input: { file_path: "a.ts" } })).toBeNull();
  expect(compressToolEvent({ tool_name: "Grep", tool_input: {} })).toBeNull();
  expect(compressToolEvent({ tool_name: "Bash", tool_input: { command: "ls -la" } })).toBeNull();
  expect(compressToolEvent({ tool_name: "Bash", tool_input: { command: "cat foo.txt" } })).toBeNull();
  expect(SKIP_TOOLS.has("Read")).toBe(true); // skip-list is an exported constant
});

test("signal tools compress into raw_observation records", () => {
  const obs = compressToolEvent({
    tool_name: "Edit",
    tool_input: { file_path: "src/auth.ts", old_string: "a", new_string: "b" },
    tool_response: "ok",
  });
  expect(obs?.type).toBe("raw_observation");
  expect(obs?.title).toBe("Edit: src/auth.ts");
  expect(obs?.files_modified).toEqual(["src/auth.ts"]);
  expect(obs?.content).toContain("src/auth.ts");
});

test("long tool output is truncated", () => {
  const obs = compressToolEvent({
    tool_name: "Bash",
    tool_input: { command: "bun test" },
    tool_response: "x".repeat(10_000),
  });
  expect(obs!.content.length).toBeLessThan(5_000);
  expect(obs!.content).toContain("[truncated");
});

// ── scrub (#20) ───────────────────────────────────────────────────────────────

test("credential in content is redacted", () => {
  const out = scrubContent("deploy key is ghp_" + "a".repeat(36) + " for CI");
  expect(out).not.toBeNull();
  expect(out).toContain("[REDACTED]");
  expect(out).not.toContain("ghp_");
});

test("<private> blocks are stripped entirely", () => {
  const out = scrubContent("before <private>token ghp_" + "a".repeat(36) + "</private> after");
  expect(out).toBe("before  after");
});

test("clean memory passes through unchanged", () => {
  expect(scrubContent("uses BM25 ranking over FTS5")).toBe("uses BM25 ranking over FTS5");
});

test("content that is only a secret is excluded (null)", () => {
  expect(scrubContent("<private>everything is secret</private>")).toBeNull();
});

// ── extract (#19) ─────────────────────────────────────────────────────────────

const FAKE_RECORD = {
  type: "extracted_learning",
  title: "JWT expiry",
  content: "Tokens expire after 24h; refresh handled in middleware.",
  narrative: null,
  facts: ["JWT tokens expire after 24 hours."],
  concepts: ["auth"],
  files_read: ["src/auth.ts"],
  files_modified: [],
};

test("extraction outputs validate against Memory schema with provenance", async () => {
  let receivedPromptPath = "";
  const memories = await extractMemories(
    [{ type: "raw_observation", title: "t", content: "c", files_read: [], files_modified: [] }],
    { repoFingerprint: "github.com/acme/api", sessionId: "sess_1" },
    async (promptPath) => {
      receivedPromptPath = promptPath;
      return JSON.stringify([FAKE_RECORD]);
    },
  );
  expect(memories.length).toBe(1);
  const m = memories[0]!;
  expect(m.type).toBe("extracted_learning");
  expect(m.repo_fingerprint).toBe("github.com/acme/api");
  expect(m.session_id).toBe("sess_1");
  expect(m.ai_extracted).toBe(true);
  expect(m.metadata["prompt_version"]).toBe(EXTRACTION_PROMPT_VERSION);
  expect(receivedPromptPath).toContain("extraction.md");
  expect(EXTRACTION_PROMPT_VERSION).toBe("extraction-v1"); // pinned constant
});

test("non-array extraction output throws", async () => {
  await expect(
    extractMemories(
      [{ type: "raw_observation", title: "t", content: "c", files_read: [], files_modified: [] }],
      { repoFingerprint: "github.com/acme/api", sessionId: "s" },
      async () => JSON.stringify({ not: "an array" }),
    ),
  ).rejects.toThrow("not a JSON array");
});

test("no observations → no extraction call", async () => {
  let called = false;
  const memories = await extractMemories(
    [],
    { repoFingerprint: "github.com/acme/api", sessionId: "s" },
    async () => {
      called = true;
      return "[]";
    },
  );
  expect(memories).toEqual([]);
  expect(called).toBe(false);
});

// ── ingest client (#21) ───────────────────────────────────────────────────────

const REQUEST = {
  repo_fingerprint: "github.com/acme/api",
  repo_canonical: "acme/api",
  session: { id: "sess_1", agent: "claude-code" as const },
  memories: [
    { id: "m1", type: "decision" as const, content: "use FTS5", anchors: [], ai_extracted: true },
  ],
};

function fakeFetch(statuses: number[]): { fetch: typeof fetch; calls: number[] } {
  const calls: number[] = [];
  const impl = (async () => {
    const status = statuses[Math.min(calls.length, statuses.length - 1)]!;
    calls.push(status);
    return new Response(
      status === 202 ? JSON.stringify({ accepted: 1, rejected: [] }) : "err",
      { status },
    );
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

test("retries on 5xx then succeeds on 202", async () => {
  const { fetch: impl, calls } = fakeFetch([503, 503, 202]);
  const res = await postIngest(REQUEST, {
    serviceUrl: "http://svc", apiKey: "k", fetchImpl: impl, baseDelayMs: 1,
  });
  expect(res).toEqual({ accepted: 1, rejected: [] });
  expect(calls).toEqual([503, 503, 202]);
});

test("401 is not retried", async () => {
  const { fetch: impl, calls } = fakeFetch([401]);
  await expect(
    postIngest(REQUEST, { serviceUrl: "http://svc", apiKey: "bad", fetchImpl: impl, baseDelayMs: 1 }),
  ).rejects.toThrow("ingest rejected: 401");
  expect(calls).toEqual([401]);
});

test("gives up after maxAttempts of 5xx", async () => {
  const { fetch: impl, calls } = fakeFetch([500]);
  await expect(
    postIngest(REQUEST, { serviceUrl: "http://svc", apiKey: "k", fetchImpl: impl, maxAttempts: 3, baseDelayMs: 1 }),
  ).rejects.toThrow("failed after 3 attempts");
  expect(calls.length).toBe(3);
});

// ── end-to-end pipeline ───────────────────────────────────────────────────────

test("PostToolUse events buffer; Stop extracts, scrubs, and POSTs a valid IngestRequest", async () => {
  const posted: unknown[] = [];
  const impl = (async (_url: unknown, init: RequestInit) => {
    posted.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ accepted: 1, rejected: [] }), { status: 202 });
  }) as unknown as typeof fetch;

  const dirtyRecord = {
    ...FAKE_RECORD,
    title: "leaky",
    content: "the token is ghp_" + "b".repeat(36) + " obviously",
  };
  const pipeline = createPipeline({
    runner: async () => JSON.stringify([FAKE_RECORD, dirtyRecord]),
    ingest: { serviceUrl: "http://svc", apiKey: "k", fetchImpl: impl, baseDelayMs: 1 },
    git: async () => "deadbeef",
  });

  // cwd = this repo, so computeRepoFingerprint resolves a real remote.
  await pipeline({ hook_event_name: "PostToolUse", session_id: "s1", cwd: import.meta.dir, tool_name: "Read", tool_input: { file_path: "x" } });
  await pipeline({ hook_event_name: "PostToolUse", session_id: "s1", cwd: import.meta.dir, tool_name: "Edit", tool_input: { file_path: "src/a.ts" }, tool_response: "ok" });
  expect(posted.length).toBe(0); // nothing sent until Stop

  await pipeline({ hook_event_name: "Stop", session_id: "s1" });
  expect(posted.length).toBe(1);

  const req = IngestRequestSchema.parse(posted[0]);
  expect(req.session.id).toBe("s1");
  expect(req.memories.length).toBe(2);
  const dirty = req.memories.find((m) => JSON.stringify(m).includes("[REDACTED]"))!;
  expect(dirty.content).not.toContain("ghp_");
  expect(req.memories[0]!.anchors[0]).toEqual({ path: "src/auth.ts", commit_sha: "deadbeef" });

  // second Stop for the same session is a no-op (buffer consumed)
  await pipeline({ hook_event_name: "Stop", session_id: "s1" });
  expect(posted.length).toBe(1);
});

test("session with only noisy events never POSTs", async () => {
  let fetched = false;
  const pipeline = createPipeline({
    runner: async () => "[]",
    ingest: {
      serviceUrl: "http://svc", apiKey: "k", baseDelayMs: 1,
      fetchImpl: (async () => {
        fetched = true;
        return new Response("{}", { status: 202 });
      }) as unknown as typeof fetch,
    },
  });
  await pipeline({ hook_event_name: "PostToolUse", session_id: "s2", cwd: import.meta.dir, tool_name: "Read", tool_input: {} });
  await pipeline({ hook_event_name: "Stop", session_id: "s2" });
  expect(fetched).toBe(false);
});
