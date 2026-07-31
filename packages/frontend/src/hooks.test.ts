import { test, expect } from "bun:test";
import { buildListParams, pageCount, parseListParams } from "./hooks.js";

// Search, filter and page live in the URL so that Back from a memory restores
// the view and a filtered list can be shared. These are the pure parts.

test("parseListParams reads a full query string", () => {
  const p = parseListParams(new URLSearchParams("q=cache+timeout&type=decision&page=3"));
  expect(p).toEqual({ q: "cache timeout", type: "decision", page: 3 });
});

test("parseListParams defaults an empty query string", () => {
  expect(parseListParams(new URLSearchParams(""))).toEqual({ q: "", type: null, page: 1 });
});

test("a hand-edited or stale type is ignored, not passed to the server", () => {
  expect(parseListParams(new URLSearchParams("type=not_a_type")).type).toBeNull();
  expect(parseListParams(new URLSearchParams("type=")).type).toBeNull();
  // Previously unfilterable because the frontend's list of types was incomplete.
  expect(parseListParams(new URLSearchParams("type=raw_observation")).type).toBe("raw_observation");
});

test("page is clamped to a sane integer", () => {
  expect(parseListParams(new URLSearchParams("page=0")).page).toBe(1);
  expect(parseListParams(new URLSearchParams("page=-4")).page).toBe(1);
  expect(parseListParams(new URLSearchParams("page=abc")).page).toBe(1);
  expect(parseListParams(new URLSearchParams("page=2.7")).page).toBe(2);
  expect(parseListParams(new URLSearchParams("page=12")).page).toBe(12);
});

test("buildListParams omits defaults so a clean view has a clean URL", () => {
  expect(buildListParams({ q: "", type: null, page: 1 }).toString()).toBe("");
  expect(buildListParams({ q: "", type: null, page: 2 }).toString()).toBe("page=2");
  expect(buildListParams({ q: "auth", type: null, page: 1 }).toString()).toBe("q=auth");
});

test("params round-trip", () => {
  for (const state of [
    { q: "", type: null, page: 1 },
    { q: "cache timeout", type: null, page: 1 },
    { q: "", type: "negative_result" as const, page: 4 },
    { q: "a b", type: "decision" as const, page: 2 },
  ]) {
    expect(parseListParams(buildListParams(state))).toEqual(state);
  }
});

test("pageCount never reports zero pages", () => {
  expect(pageCount(0, 20)).toBe(1);
  expect(pageCount(1, 20)).toBe(1);
  expect(pageCount(20, 20)).toBe(1);
  expect(pageCount(21, 20)).toBe(2);
  expect(pageCount(412, 20)).toBe(21);
});
