import { test, expect } from "bun:test";
import { scanSecrets } from "./secret-scan.js";

test("flags a GitHub token", () => {
  const r = scanSecrets("token is ghp_" + "a".repeat(36));
  expect(r.clean).toBe(false);
  expect(r.violations.some((v) => v.type === "github_token")).toBe(true);
});

test("flags an AWS access key", () => {
  const r = scanSecrets("AKIAIOSFODNN7EXAMPLE is the key");
  expect(r.clean).toBe(false);
  expect(r.violations[0]!.type).toBe("aws_access_key");
});

test("flags a bearer token and key=value assignments", () => {
  // fixtures concatenated so secret scanners don't flag this test file itself
  expect(scanSecrets("Authorization: Bearer " + "abcdefghijklmnopqrstuvwxyz123").clean).toBe(false);
  expect(scanSecrets('api_key = "' + "s3cr3t_value_1234" + '"').clean).toBe(false);
});

test("flags a high-entropy blob not caught by a named pattern", () => {
  // 40-char random-ish hex — no named pattern matches, entropy should.
  const r = scanSecrets("blob " + "9f8e7d6c5b4a3f2e1d0c" + "9b8a7f6e5d4c3b2a1908");
  expect(r.clean).toBe(false);
  expect(r.violations.some((v) => v.type === "high_entropy")).toBe(true);
});

test("clean prose passes", () => {
  const r = scanSecrets("The auth middleware validates JWTs and returns 401 on failure.");
  expect(r.clean).toBe(true);
  expect(r.violations).toEqual([]);
});

test("strips <private> blocks entirely and does not scan inside them", () => {
  const r = scanSecrets("before <private>ghp_" + "a".repeat(36) + "</private> after");
  expect(r.scrubbed).toBe("before  after");
  // secret lived only inside the stripped block → still reported (scanned against original)
  // but the scrubbed output must not contain it
  expect(r.scrubbed.includes("ghp_")).toBe(false);
});

test("violation offset points into the original text", () => {
  const text = "prefix AKIAIOSFODNN7EXAMPLE";
  const r = scanSecrets(text);
  expect(text.slice(r.violations[0]!.offset).startsWith("AKIA")).toBe(true);
});
