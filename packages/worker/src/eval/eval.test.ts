import { test, expect } from "bun:test";
import { injectStubs, validateRecord } from "./eval.js";

const VALID_EXTRACTED = {
  type: "extracted_learning",
  title: "JWT tokens must include expiresIn",
  content: "Signing JWT without expiresIn makes tokens immortal; fix is at the sign call site.",
  narrative: "The jsonwebtoken verify() correctly rejects expired tokens, but only if exp is present.",
  facts: ["jwt.sign without expiresIn produces non-expiring tokens", "Fix belongs at sign site, not verify site"],
  concepts: ["gotcha", "security"],
  files_read: ["packages/service/src/auth/token.ts"],
  files_modified: ["packages/service/src/auth/token.ts"],
};

test("injectStubs adds all required infra fields", () => {
  const result = injectStubs(VALID_EXTRACTED);
  expect(result).toMatchObject({
    id: expect.any(String),
    repo_fingerprint: expect.any(String),
    author_id: expect.any(String),
    agent: "claude-code",
    kind: "observation",
    ai_extracted: true,
    created_at_epoch: expect.any(Number),
    updated_at_epoch: expect.any(Number),
  });
});

test("validateRecord succeeds on valid combined object", () => {
  const withStubs = injectStubs(VALID_EXTRACTED);
  const result = validateRecord(withStubs);
  expect(result.type).toBe("extracted_learning");
  expect(result.content).toBe(VALID_EXTRACTED.content);
  expect(result.ai_extracted).toBe(true);
});

test("validateRecord throws when content is empty", () => {
  const bad = injectStubs({ ...VALID_EXTRACTED, content: "" });
  expect(() => validateRecord(bad)).toThrow();
});

test("validateRecord throws on invalid type", () => {
  const bad = injectStubs({ ...VALID_EXTRACTED, type: "bugfix" });
  expect(() => validateRecord(bad)).toThrow();
});

test("validateRecord accepts null narrative", () => {
  const withNull = injectStubs({ ...VALID_EXTRACTED, narrative: null });
  const result = validateRecord(withNull);
  expect(result.narrative).toBeNull();
});

test("validateRecord defaults facts and concepts to [] when omitted", () => {
  const { facts, concepts, ...rest } = VALID_EXTRACTED;
  const withoutArrays = injectStubs(rest);
  const result = validateRecord(withoutArrays);
  expect(result.facts).toEqual([]);
  expect(result.concepts).toEqual([]);
});
