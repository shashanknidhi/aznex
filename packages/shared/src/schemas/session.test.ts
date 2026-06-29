import { expect, test } from "bun:test";
import { SessionSchema } from "./session.js";

const base = {
  id: "sess_1",
  repo_fingerprint: "github.com/acme/api",
  repo_canonical: "acme/api",
  author_id: "user_1",
  agent: "claude-code",
  started_at_epoch: 1000,
  created_at_epoch: 1000,
  updated_at_epoch: 1000,
} as const;

test("valid session parses with status defaulting to active", () => {
  const s = SessionSchema.parse(base);
  expect(s.status).toBe("active");
  expect(s.ended_at_epoch).toBeNull();
  expect(s.platform_source).toBe("claude-code");
});

test("missing repo_fingerprint is rejected", () => {
  const { repo_fingerprint, ...without } = base;
  expect(() => SessionSchema.parse(without)).toThrow();
});

test("unknown agent string is accepted", () => {
  const s = SessionSchema.parse({ ...base, agent: "opencode-nightly" });
  expect(s.agent).toBe("opencode-nightly");
});
