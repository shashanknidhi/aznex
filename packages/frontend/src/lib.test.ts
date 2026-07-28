import { test, expect } from "bun:test";
import { filterMemories, preview } from "./lib.js";
import type { MemoryItem } from "./api.js";

const mk = (id: string, type: string): MemoryItem => ({
  id, type, title: null, content: "c", author_id: "a", created_at_epoch: 0,
});

const ITEMS = [mk("1", "decision"), mk("2", "summary"), mk("3", "decision")];

test("filterMemories by type", () => {
  expect(filterMemories(ITEMS, { type: "decision" }).map((m) => m.id)).toEqual(["1", "3"]);
  expect(filterMemories(ITEMS, { type: "summary" }).map((m) => m.id)).toEqual(["2"]);
  expect(filterMemories(ITEMS, { type: null }).length).toBe(3);
});

test("preview flattens whitespace and truncates", () => {
  expect(preview("a\n\n  b   c")).toBe("a b c");
  const long = "x".repeat(300);
  expect(preview(long).length).toBe(181); // 180 + ellipsis
  expect(preview(long).endsWith("…")).toBe(true);
});
