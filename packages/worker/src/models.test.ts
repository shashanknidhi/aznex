import { test, expect } from "bun:test";
import { MODELS, cheapestModel, isKnownModel, resolveModel } from "./models.js";

test("the cheapest model is the first listed for each engine", () => {
  expect(cheapestModel("claude")).toBe("claude-haiku-4-5");
  expect(cheapestModel("codex")).toBe("gpt-5.6-luna");
});

test("catalog entries are non-empty and have unique ids per engine", () => {
  for (const engine of ["claude", "codex"] as const) {
    const ids = MODELS[engine].map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODELS[engine]) expect(m.label.length).toBeGreaterThan(0);
  }
});

test("isKnownModel is scoped per engine", () => {
  expect(isKnownModel("claude", "claude-opus-5")).toBe(true);
  expect(isKnownModel("claude", "gpt-5.6-luna")).toBe(false);
  expect(isKnownModel("codex", "gpt-5.6-sol")).toBe(true);
  expect(isKnownModel("codex", "claude-opus-5")).toBe(false);
});

test("resolveModel keeps a valid configured model", () => {
  expect(resolveModel("claude", "claude-fable-5")).toBe("claude-fable-5");
  expect(resolveModel("codex", "gpt-5.4-mini")).toBe("gpt-5.4-mini");
});

test("resolveModel falls back to cheapest when unset", () => {
  expect(resolveModel("claude", null)).toBe("claude-haiku-4-5");
  expect(resolveModel("codex", null)).toBe("gpt-5.6-luna");
});

// The mismatch guard: switching agents leaves the other engine's model behind,
// and passing it through would fail at spawn time instead of degrading.
test("resolveModel discards a model belonging to the other engine", () => {
  expect(resolveModel("codex", "claude-haiku-4-5")).toBe("gpt-5.6-luna");
  expect(resolveModel("claude", "gpt-5.6-luna")).toBe("claude-haiku-4-5");
  expect(resolveModel("claude", "some-model-we-dropped")).toBe("claude-haiku-4-5");
});
