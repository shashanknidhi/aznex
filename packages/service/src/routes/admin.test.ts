import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { openDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { createAuth, migrateAuthSchema } from "../auth/session.js";
import { RepoRepository } from "../repositories/repo.js";

const realFetch = globalThis.fetch;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  process.env["BETTER_AUTH_SECRET"] = "test-secret-with-plenty-of-entropy-0123456789";
  // Fake GitHub: installation lookup, token mint, repo read.
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/repos/acme/newrepo/installation")) return new Response(JSON.stringify({ id: 77 }), { status: 200 });
    if (u.includes("/repos/") && u.endsWith("/installation")) return new Response("not installed", { status: 404 });
    if (u.includes("/access_tokens")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    if (u.endsWith("/repos/acme/newrepo")) return new Response(JSON.stringify({ id: 4242 }), { status: 200 });
    return realFetch(url as string, init);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
});

async function seedApp() {
  const db = openDatabase(":memory:");
  const auth = createAuth(db, { testMode: true });
  await migrateAuthSchema(auth);
  const app = createApp(db, { auth });
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "alice", email: "alice@example.com", password: "hunter2hunter2" }),
  });
  return { db, app, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

const BODY = JSON.stringify({ fingerprint: "github.com/acme/newrepo" });

test("admin onboards by name alone — ids resolved via the GitHub App", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "alice";
  const { db, app, cookie } = await seedApp();
  const res = await app.request("/api/admin/repos", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: BODY,
  });
  expect(res.status).toBe(201);
  const repo = new RepoRepository(db).getByFingerprint("github.com/acme/newrepo");
  expect(repo?.canonical).toBe("acme/newrepo");
  expect(repo?.github_repo_id).toBe("4242");
  expect(repo?.github_installation_id).toBe(77);
});

test("repo the App is not installed on → clear 400", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "alice";
  const { app, cookie } = await seedApp();
  const res = await app.request("/api/admin/repos", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ fingerprint: "github.com/other/repo" }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as any).error).toContain("not installed");
});

test("non-admin gets 403; no admins configured means nobody is admin", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "someone-else";
  const { app, cookie } = await seedApp();
  const post = (c: string) =>
    app.request("/api/admin/repos", {
      method: "POST",
      headers: { Cookie: c, "Content-Type": "application/json" },
      body: BODY,
    });
  expect((await post(cookie)).status).toBe(403);

  delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
  expect((await post(cookie)).status).toBe(403);
});

test("admin with bad body gets 400", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "alice";
  const { app, cookie } = await seedApp();
  for (const body of [JSON.stringify({ fingerprint: "not-a-fingerprint" }), "not json", JSON.stringify({})]) {
    const res = await app.request("/api/admin/repos", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBe(400);
  }
});
