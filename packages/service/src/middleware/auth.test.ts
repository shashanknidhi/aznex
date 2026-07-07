import { test, expect } from "bun:test";
import { Hono } from "hono";
import { openDatabase } from "../db/connection.js";
import type { AppEnv } from "../app.js";
import { UserRepository } from "../repositories/user.js";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { apiKeyAuth, hashToken } from "./auth.js";

function appWithKey(opts: { expires?: number | null; status?: "active" | "revoked" } = {}) {
  const db = openDatabase(":memory:");
  const user = new UserRepository(db).create({
    github_id: "1", github_login: "alice", display_name: "Alice", avatar_url: null, metadata: {},
  });
  new ApiKeyRepository(db).create({
    user_id: user.id, name: "k", key_hash: hashToken("plaintext-token"), prefix: "axk_",
    scopes: ["ingest"], status: opts.status ?? "active",
    last_used_at_epoch: null, expires_at_epoch: opts.expires ?? null, metadata: {},
  });
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("db", db); await next(); });
  app.get("/protected", apiKeyAuth(), (c) => c.json({ user: c.get("user").github_login }));
  return app;
}

async function call(app: Hono<AppEnv>, token?: string) {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  return app.request("/protected", { headers });
}

test("valid token passes and attaches user", async () => {
  const res = await call(appWithKey(), "plaintext-token");
  expect(res.status).toBe(200);
  expect(((await res.json()) as { user: string }).user).toBe("alice");
});

test("missing header → 401", async () => {
  expect((await call(appWithKey())).status).toBe(401);
});

test("wrong token → 401", async () => {
  expect((await call(appWithKey(), "nope")).status).toBe(401);
});

test("revoked key → 401", async () => {
  expect((await call(appWithKey({ status: "revoked" }), "plaintext-token")).status).toBe(401);
});

test("expired key → 401", async () => {
  const res = await call(appWithKey({ expires: Date.now() - 1000 }), "plaintext-token");
  expect(res.status).toBe(401);
});

import { githubLoginAllowed } from "./auth.js";

test("allowlist: unset means open, set means exact-match (case-insensitive)", () => {
  delete process.env["AZNEX_ALLOWED_GITHUB_LOGINS"];
  expect(githubLoginAllowed("anyone")).toBe(true);

  process.env["AZNEX_ALLOWED_GITHUB_LOGINS"] = "Alice, bob ,carol";
  expect(githubLoginAllowed("alice")).toBe(true);
  expect(githubLoginAllowed("BOB")).toBe(true);
  expect(githubLoginAllowed("mallory")).toBe(false);
  expect(githubLoginAllowed("ali")).toBe(false);

  process.env["AZNEX_ALLOWED_GITHUB_LOGINS"] = "  ";
  expect(githubLoginAllowed("anyone")).toBe(true); // blank = unset
  delete process.env["AZNEX_ALLOWED_GITHUB_LOGINS"];
});
