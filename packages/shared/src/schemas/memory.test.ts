import { expect, test } from "bun:test";
import { MemorySchema } from "./memory.js";

const base = {
  id: "mem_1",
  repo_fingerprint: "github.com/acme/api",
  author_id: "user_1",
  agent: "claude-code",
  kind: "observation",
  type: "extracted_learning",
  content: "The migration runs in a transaction by default.",
  ai_extracted: true,
  created_at_epoch: 1000,
  updated_at_epoch: 1000,
} as const;

test("valid memory parses with all defaults applied", () => {
  const m = MemorySchema.parse(base);
  expect(m.promotion_state).toBe("private");
  expect(m.freshness_state).toBe("fresh");
  expect(m.facts).toEqual([]);
  expect(m.concepts).toEqual([]);
  expect(m.files_read).toEqual([]);
  expect(m.files_modified).toEqual([]);
  expect(m.session_id).toBeNull();
  expect(m.title).toBeNull();
  expect(m.narrative).toBeNull();
  expect(m.confirmed_commit).toBeNull();
});

test("invalid type enum is rejected", () => {
  expect(() => MemorySchema.parse({ ...base, type: "not_a_type" })).toThrow();
});

test("invalid promotion_state is rejected", () => {
  expect(() =>
    MemorySchema.parse({ ...base, promotion_state: "public" })
  ).toThrow();
});

test("ai_extracted is required — missing field throws", () => {
  const { ai_extracted, ...without } = base;
  expect(() => MemorySchema.parse(without)).toThrow();
});
