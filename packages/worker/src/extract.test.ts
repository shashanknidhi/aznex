import { test, expect } from "bun:test";
import { buildClaudeArgs } from "./extract.js";

test("buildClaudeArgs passes --model only when configured", () => {
  const withModel = buildClaudeArgs("/bin/claude", "/p.md", "/obs.jsonl", "claude-haiku-4-5");
  const modelIdx = withModel.indexOf("--model");
  expect(modelIdx).toBeGreaterThan(-1);
  expect(withModel[modelIdx + 1]).toBe("claude-haiku-4-5");

  const withoutModel = buildClaudeArgs("/bin/claude", "/p.md", "/obs.jsonl", null);
  expect(withoutModel).not.toContain("--model");
  // everything else identical
  expect(withoutModel).toEqual(withModel.filter((_, i) => i !== modelIdx && i !== modelIdx + 1));
});
