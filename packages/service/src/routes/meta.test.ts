import { test, expect, beforeEach, afterEach } from "bun:test";
import { openDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { UserRepository } from "../repositories/user.js";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { hashToken } from "../middleware/auth.js";
import { seedOrg } from "../test-support.js";

// These endpoints exist so the UI can distinguish a misconfigured deployment
// from an empty one. The tests therefore care most about the unset case.

const ENV = ["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "AZNEX_GITHUB_APP_SLUG", "AZNEX_ADMIN_GITHUB_LOGINS"] as const;

// Both hooks, deliberately: other test files set these in their own beforeAll and
// never clear them, so "unconfigured" has to be established, not assumed.
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

const TOKEN = "meta-token";

function seed(members: Record<string, "admin" | "member"> = { alice: "member" }) {
  const db = openDatabase(":memory:");
  const user = new UserRepository(db).create({
    github_id: "1", github_login: "alice", display_name: "Alice", avatar_url: null, metadata: {},
  });
  new ApiKeyRepository(db).create({
    user_id: user.id, name: "k", key_hash: hashToken(TOKEN), prefix: "axk_",
    scopes: [], status: "active", last_used_at_epoch: null, expires_at_epoch: null, metadata: {},
  });
  seedOrg(db, members);
  return { db, app: createApp(db) };
}

function get(app: ReturnType<typeof createApp>, path: string) {
  return app.request(path, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

test("GET /api/config reports everything unconfigured on a bare deployment", async () => {
  const { app } = seed();
  const body = (await (await app.request("/api/config")).json()) as Record<string, unknown>;
  expect(body["github_oauth"]).toBe(false);
  expect(body["github_app"]).toBe(false);
  expect(body["install_url"]).toBeNull();
  expect(typeof body["version"]).toBe("string");
});

test("GET /api/config reflects configured credentials without leaking them", async () => {
  process.env["GITHUB_OAUTH_CLIENT_ID"] = "cid";
  process.env["GITHUB_OAUTH_CLIENT_SECRET"] = "csecret";
  process.env["GITHUB_APP_ID"] = "42";
  process.env["GITHUB_APP_PRIVATE_KEY"] = "pem";
  process.env["AZNEX_GITHUB_APP_SLUG"] = "aznex-ai";
  const { app } = seed();
  const res = await app.request("/api/config");
  const raw = await res.text();
  const body = JSON.parse(raw) as Record<string, unknown>;
  expect(body["github_oauth"]).toBe(true);
  expect(body["github_app"]).toBe(true);
  expect(body["install_url"]).toBe("https://github.com/apps/aznex-ai/installations/new");
  // The whole response must be safe to serve unauthenticated.
  expect(raw).not.toContain("csecret");
  expect(raw).not.toContain("pem");
});

test("GET /api/config needs no session — the sign-in page reads it before login", async () => {
  const { app } = seed();
  expect((await app.request("/api/config")).status).toBe(200);
});

test("GET /api/me returns identity and orgs with roles", async () => {
  const { app } = seed({ alice: "admin" });
  const body = (await (await get(app, "/api/me")).json()) as {
    login: string;
    is_super_admin: boolean;
    orgs: { slug: string; role: string }[];
  };
  expect(body.login).toBe("alice");
  expect(body.is_super_admin).toBe(false);
  expect(body.orgs).toEqual([expect.objectContaining({ slug: "acme", role: "admin" })]);
});

test("GET /api/me marks a super admin", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "alice";
  const { app } = seed();
  const body = (await (await get(app, "/api/me")).json()) as { is_super_admin: boolean };
  expect(body.is_super_admin).toBe(true);
});

test("GET /api/me requires auth", async () => {
  const { app } = seed();
  expect((await app.request("/api/me")).status).toBe(401);
});

test("GET /api/me makes no GitHub calls, so it works when the App is unconfigured", async () => {
  // /repos does one collaborator check per repo and throws without App
  // credentials; the shell must still be able to render an identity.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("GET /api/me must not call GitHub");
  }) as unknown as typeof fetch;
  try {
    const { app } = seed();
    expect((await get(app, "/api/me")).status).toBe(200);
  } finally {
    globalThis.fetch = realFetch;
  }
});
