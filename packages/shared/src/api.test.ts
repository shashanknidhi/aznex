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
  // Extraction fields default, so an older worker's payload still parses.
  expect(req.memories[0].title).toBeNull();
  expect(req.memories[0].facts).toEqual([]);
  expect(req.memories[0].files_read).toEqual([]);
  expect(req.memories[0].metadata).toEqual({});
});

test("extraction fields survive the wire", () => {
  const req = IngestRequestSchema.parse({
    repo_fingerprint: "github.com/acme/api",
    repo_canonical: "acme/api",
    session: baseSession,
    memories: [
      {
        ...baseMemory,
        title: "Migrations are transactional",
        narrative: "Checked the migration runner.",
        facts: ["runMigrations wraps every step in one transaction"],
        concepts: ["how-it-works"],
        files_read: ["src/db/migrations.ts"],
        files_modified: ["src/db/schema.ts"],
        metadata: { prompt_version: "1", model: "sonnet" },
      },
    ],
  });
  const m = req.memories[0]!;
  expect(m.title).toBe("Migrations are transactional");
  expect(m.facts).toHaveLength(1);
  expect(m.concepts).toEqual(["how-it-works"]);
  expect(m.files_modified).toEqual(["src/db/schema.ts"]);
  expect(m.metadata["model"]).toBe("sonnet");
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
