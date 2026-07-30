import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { openDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { createAuth, migrateAuthSchema } from "../auth/session.js";
import { OrgRepository } from "../repositories/org.js";
import { RepoRepository } from "../repositories/repo.js";
import { MemoryRepository } from "../repositories/memory.js";
import { GithubInstallationRepository } from "../repositories/github-installation.js";
import { clearRepoAccessCache } from "../auth/repo-access.js";

// Super admin surface: org lifecycle. Repo/member onboarding lives in orgs.test.ts.

const realFetch = globalThis.fetch;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  process.env["BETTER_AUTH_SECRET"] = "test-secret-with-plenty-of-entropy-0123456789";
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/access_tokens")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    return new Response(null, { status: 204 }); // everyone is a collaborator
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
});

async function seedApp(login = "alice") {
  clearRepoAccessCache();
  const db = openDatabase(":memory:");
  const auth = createAuth(db, { testMode: true });
  await migrateAuthSchema(auth);
  const app = createApp(db, { auth });
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: login, email: `${login}@example.com`, password: "hunter2hunter2" }),
  });
  return { db, app, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

function send(app: ReturnType<typeof createApp>, method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("super admin creates an org and its admins", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "alice";
  const { db, app, cookie } = await seedApp();
  const res = await send(app, "POST", "/api/admin/orgs", cookie, {
    slug: "beta-corp",
    name: "Beta Corp",
    admin_logins: ["Bob"],
  });
  expect(res.status).toBe(201);

  const orgs = new OrgRepository(db);
  const org = orgs.getBySlug("beta-corp")!;
  expect(org.name).toBe("Beta Corp");
  expect(orgs.roleFor(org.id, "bob")).toBe("admin"); // login normalized

  // Duplicate slug is refused rather than silently merged into another tenant.
  expect((await send(app, "POST", "/api/admin/orgs", cookie, {
    slug: "beta-corp", name: "Other", admin_logins: ["carol"],
  })).status).toBe(409);
});

test("only super admins reach the org surface", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "someone-else";
  const { app, cookie } = await seedApp();
  const body = { slug: "acme", name: "Acme", admin_logins: ["alice"] };
  expect((await send(app, "POST", "/api/admin/orgs", cookie, body)).status).toBe(403);
  expect((await send(app, "GET", "/api/admin/orgs", cookie)).status).toBe(403);

  // No admins configured means nobody holds the role — never "everybody".
  delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
  expect((await send(app, "POST", "/api/admin/orgs", cookie, body)).status).toBe(403);
});

test("bad create body → 400", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "alice";
  const { app, cookie } = await seedApp();
  for (const body of [
    { slug: "Not A Slug", name: "x", admin_logins: ["alice"] },
    { slug: "acme", name: "x", admin_logins: [] }, // an org with no admin is unmanageable
    { slug: "acme" },
    {},
  ]) {
    expect((await send(app, "POST", "/api/admin/orgs", cookie, body)).status).toBe(400);
  }
  expect((await app.request("/api/admin/orgs", {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "not json",
  })).status).toBe(400);
});

test("suspending an org stops its data access and leaves its rows alone", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "alice";
  const { db, app, cookie } = await seedApp();
  await send(app, "POST", "/api/admin/orgs", cookie, { slug: "acme", name: "Acme", admin_logins: ["alice"] });
  const org = new OrgRepository(db).getBySlug("acme")!;

  new GithubInstallationRepository(db).create({
    installation_id: 42, account_type: "org", account_login: "acme", metadata: {},
  });
  const FP = "github.com/acme/widget";
  new RepoRepository(db).create({
    fingerprint: FP, canonical: "acme/widget", github_repo_id: "9001",
    github_installation_id: 42, org_id: org.id, status: "active", metadata: {},
  });
  const aliceId = (db.prepare("SELECT id FROM user WHERE github_login = 'alice'").get() as { id: string }).id;
  new MemoryRepository(db).create({
    id: "mem_1", repo_fingerprint: FP, session_id: null, author_id: aliceId,
    agent: "claude-code", kind: "observation", type: "extracted_learning",
    title: null, content: "note", narrative: null, facts: [], concepts: [],
    files_read: [], files_modified: [], ai_extracted: true, metadata: {},
  });

  const read = () =>
    app.request(`/api/memories?repo_fingerprint=${encodeURIComponent(FP)}`, { headers: { Cookie: cookie } });
  expect((await read()).status).toBe(200);

  expect((await send(app, "PATCH", `/api/admin/orgs/${org.id}`, cookie, { status: "suspended" })).status).toBe(200);
  clearRepoAccessCache();
  expect((await read()).status).toBe(403);
  expect(new MemoryRepository(db).getById("mem_1")).not.toBeNull(); // data untouched

  expect((await send(app, "PATCH", `/api/admin/orgs/${org.id}`, cookie, { status: "active" })).status).toBe(200);
  expect((await read()).status).toBe(200);
});

test("the last org admin cannot be demoted away", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "alice";
  const { db, app, cookie } = await seedApp();
  await send(app, "POST", "/api/admin/orgs", cookie, { slug: "acme", name: "Acme", admin_logins: ["bob"] });
  const org = new OrgRepository(db).getBySlug("acme")!;

  expect((await send(app, "DELETE", `/api/admin/orgs/${org.id}/admins`, cookie, { github_login: "bob" })).status).toBe(409);

  await send(app, "POST", `/api/admin/orgs/${org.id}/admins`, cookie, { github_login: "carol" });
  expect((await send(app, "DELETE", `/api/admin/orgs/${org.id}/admins`, cookie, { github_login: "bob" })).status).toBe(200);
  // Demoted, not removed — they keep member access to the org.
  expect(new OrgRepository(db).roleFor(org.id, "bob")).toBe("member");
});

test("org listing reports repo and member counts; unknown org → 404", async () => {
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "alice";
  const { db, app, cookie } = await seedApp();
  await send(app, "POST", "/api/admin/orgs", cookie, { slug: "acme", name: "Acme", admin_logins: ["alice", "bob"] });
  const org = new OrgRepository(db).getBySlug("acme")!;

  const body = (await (await send(app, "GET", "/api/admin/orgs", cookie)).json()) as any;
  const listed = body.orgs.find((o: any) => o.slug === "acme");
  expect(listed.member_count).toBe(2);
  expect(listed.repo_count).toBe(0);

  expect((await send(app, "PATCH", "/api/admin/orgs/nope", cookie, { name: "x" })).status).toBe(404);
  expect((await send(app, "POST", "/api/admin/orgs/nope/admins", cookie, { github_login: "bob" })).status).toBe(404);
  expect(org.status).toBe("active");
});
