import { test, expect } from "bun:test";
import { MemoryTypeSchema } from "@aznex/shared";
import {
  countLabel,
  formatDate,
  formatDateTime,
  formatRelative,
  githubFileUrl,
  isMemoryType,
  MEMORY_TYPES,
  plural,
  preview,
  typeLabel,
} from "./format.js";

// The frontend used to hardcode four of the five types, so raw_observation was
// unfilterable. This is the guard against that happening again.
test("every memory type in the shared enum has a human label", () => {
  expect(MEMORY_TYPES.length).toBe(MemoryTypeSchema.options.length);
  for (const type of MemoryTypeSchema.options) {
    const label = typeLabel(type);
    expect(label).not.toBe(type); // a snake_case identifier is not a label
    expect(label).not.toContain("_");
  }
});

test("typeLabel passes through an unknown value rather than throwing", () => {
  expect(typeLabel("something_new")).toBe("something_new");
});

test("isMemoryType accepts the enum and rejects anything else", () => {
  expect(isMemoryType("decision")).toBe(true);
  expect(isMemoryType("raw_observation")).toBe(true);
  expect(isMemoryType("")).toBe(false);
  expect(isMemoryType("DECISION")).toBe(false);
  expect(isMemoryType("'; DROP TABLE memory;--")).toBe(false);
});

test("preview flattens whitespace and truncates", () => {
  expect(preview("a\n\n  b   c")).toBe("a b c");
  const long = "x".repeat(300);
  expect(preview(long).length).toBe(181); // 180 + ellipsis
  expect(preview(long).endsWith("…")).toBe(true);
  expect(preview("short")).toBe("short");
});

// Epochs are milliseconds (the service writes Date.now()).
const NOW = Date.UTC(2026, 6, 30, 12, 0, 0);

test("formatRelative describes recent times and falls back to a date", () => {
  expect(formatRelative(NOW - 5_000, NOW)).toBe("just now");
  expect(formatRelative(NOW - 60_000, NOW)).toBe("1 minute ago");
  expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe("5 minutes ago");
  expect(formatRelative(NOW - 3_600_000, NOW)).toBe("1 hour ago");
  expect(formatRelative(NOW - 26 * 3_600_000, NOW)).toBe("1 day ago");
  expect(formatRelative(NOW - 3 * 86_400_000, NOW)).toBe("3 days ago");
  // Beyond a week, relative stops being informative.
  expect(formatRelative(NOW - 30 * 86_400_000, NOW)).toBe(formatDate(NOW - 30 * 86_400_000));
  // A clock-skewed future timestamp must not read "-4 minutes ago".
  expect(formatRelative(NOW + 60_000, NOW)).toBe(formatDate(NOW + 60_000));
});

test("formatDateTime includes a time, formatDate does not", () => {
  // Without a time, an API key's "last used" can't answer "did it authenticate
  // just now?" — which is the only reason to look at it.
  expect(formatDateTime(NOW)).not.toBe(formatDate(NOW));
  expect(formatDateTime(NOW).length).toBeGreaterThan(formatDate(NOW).length);
});

test("pluralization: the count line used to always say the plural", () => {
  expect(plural(1, "memory", "memories")).toBe("memory");
  expect(plural(2, "memory", "memories")).toBe("memories");
  expect(plural(0, "memory", "memories")).toBe("memories");
  expect(countLabel(1, "memory", "memories")).toBe("1 memory");
  expect(countLabel(3, "match", "matches")).toBe("3 matches");
  expect(countLabel(1, "minute")).toBe("1 minute");
});

test("githubFileUrl builds a blob link, and declines non-GitHub fingerprints", () => {
  expect(githubFileUrl("github.com/acme/api", "src/cache.ts")).toBe(
    "https://github.com/acme/api/blob/HEAD/src/cache.ts",
  );
  expect(githubFileUrl("gitlab.com/acme/api", "src/cache.ts")).toBeNull();
  expect(githubFileUrl("github.com", "src/cache.ts")).toBeNull();
  expect(githubFileUrl("nonsense", "a.ts")).toBeNull();
});
