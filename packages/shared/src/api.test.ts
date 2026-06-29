import { expect, test } from "bun:test";
import { IngestRequestSchema } from "./api.js";

const baseSession = {
  id: "sess_1",
  agent: "claude-code",
  started_at_epoch: 1000,
} as const;

const baseMemory = {
  id: "mem_1",
  type: "extracted_learning",
  content: "Always run migrations inside a transaction.",
  ai_extracted: true,
} as const;

test("valid IngestRequest with one memory parses", () => {
  const req = IngestRequestSchema.parse({
    repo_fingerprint: "github.com/acme/api",
    repo_canonical: "acme/api",
    session: baseSession,
    memories: [baseMemory],
  });
  expect(req.memories).toHaveLength(1);
  expect(req.memories[0].anchors).toEqual([]);
});

test("empty memories array is accepted", () => {
  const req = IngestRequestSchema.parse({
    repo_fingerprint: "github.com/acme/api",
    repo_canonical: "acme/api",
    session: baseSession,
    memories: [],
  });
  expect(req.memories).toHaveLength(0);
});

test("missing repo_fingerprint is rejected", () => {
  expect(() =>
    IngestRequestSchema.parse({
      repo_canonical: "acme/api",
      session: baseSession,
      memories: [],
    })
  ).toThrow();
});
