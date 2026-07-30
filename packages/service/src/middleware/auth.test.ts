import { test, expect } from "bun:test";
import { Hono } from "hono";
import { openDatabase } from "../db/connection.js";
import type { AppEnv } from "../app.js";
import { UserRepository } from "../repositories/user.js";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { apiKeyAuth, hashToken } from "./auth.js";
import { seedOrg } from "../test-support.js";

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
  seedOrg(db, { alice: "member" });
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

import { isSuperAdmin, loginAllowed } from "./auth.js";
import { OrgRepository } from "../repositories/org.js";

test("sign-in gate: org membership, or super admin", () => {
  const db = openDatabase(":memory:");
  delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];

  // No orgs at all: nobody may sign in. The deployment is bootstrapped with
  // admin-cli add-org, not by letting strangers in.
  expect(loginAllowed(db, "alice")).toBe(false);

  const orgId = seedOrg(db, { Alice: "member" });
  expect(loginAllowed(db, "alice")).toBe(true);
  expect(loginAllowed(db, "ALICE")).toBe(true); // GitHub logins are case-insensitive
  expect(loginAllowed(db, "mallory")).toBe(false);

  // Suspending the org locks its members out without deleting anything.
  new OrgRepository(db).update(orgId, { status: "suspended" });
  expect(loginAllowed(db, "alice")).toBe(false);

  // A super admin never depends on membership — they must be able to get in and
  // create the first org.
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "Root, other";
  expect(loginAllowed(db, "root")).toBe(true);
  expect(isSuperAdmin("ROOT")).toBe(true);
  expect(isSuperAdmin("alice")).toBe(false);
  delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
});
