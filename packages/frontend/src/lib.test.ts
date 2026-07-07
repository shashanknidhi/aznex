import { test, expect } from "bun:test";
import { filterMemories, preview } from "./lib.js";
import type { MemoryItem } from "./api.js";

const mk = (id: string, type: string, freshness: string): MemoryItem => ({
  id, type, title: null, content: "c", freshness_state: freshness, promotion_state: "team_shared",
  author_id: "a", created_at_epoch: 0,
});

const ITEMS = [
  mk("1", "decision", "fresh"),
  mk("2", "summary", "fresh"),
  mk("3", "decision", "stale_suspected"),
];

test("filterMemories by type, freshness, and both", () => {
  expect(filterMemories(ITEMS, { type: "decision", freshness: null }).map((m) => m.id)).toEqual(["1", "3"]);
  expect(filterMemories(ITEMS, { type: null, freshness: "fresh" }).map((m) => m.id)).toEqual(["1", "2"]);
  expect(filterMemories(ITEMS, { type: "decision", freshness: "stale_suspected" }).map((m) => m.id)).toEqual(["3"]);
  expect(filterMemories(ITEMS, { type: null, freshness: null }).length).toBe(3);
});

test("preview flattens whitespace and truncates", () => {
  expect(preview("a\n\n  b   c")).toBe("a b c");
  const long = "x".repeat(300);
  expect(preview(long).length).toBe(181); // 180 + ellipsis
  expect(preview(long).endsWith("…")).toBe(true);
});
