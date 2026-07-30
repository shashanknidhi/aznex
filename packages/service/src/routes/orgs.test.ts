import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { openDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { createAuth, migrateAuthSchema } from "../auth/session.js";
import { OrgRepository } from "../repositories/org.js";
import { RepoRepository } from "../repositories/repo.js";
import { UserRepository } from "../repositories/user.js";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { mintApiKey } from "../auth/mint-key.js";
import { clearRepoAccessCache } from "../auth/repo-access.js";

// Org admin surface. The tests that matter here are the negative ones: an admin
// of org A must not be able to touch org B's members, keys or repos.

const realFetch = globalThis.fetch;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  process.env["BETTER_AUTH_SECRET"] = "test-secret-with-plenty-of-entropy-0123456789";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/repos/acme/newrepo/installation")) return new Response(JSON.stringify({ id: 77 }), { status: 200 });
    if (u.endsWith("/repos/acme/secretrepo/installation")) return new Response(JSON.stringify({ id: 77 }), { status: 200 });
    if (u.includes("/repos/") && u.endsWith("/installation")) return new Response("not installed", { status: 404 });
    if (u.includes("/access_tokens")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    if (u.endsWith("/repos/acme/newrepo")) return new Response(JSON.stringify({ id: 4242 }), { status: 200 });
    if (u.endsWith("/repos/acme/secretrepo")) return new Response(JSON.stringify({ id: 5555 }), { status: 200 });
    // alice is not a collaborator on secretrepo — admin rights must not help.
    if (u.includes("/collaborators/alice") && u.includes("secretrepo")) return new Response(null, { status: 404 });
    if (u.includes("/collaborators/")) return new Response(null, { status: 204 });
    if (u.endsWith("/installation/repositories?per_page=100"))
      return new Response(
        JSON.stringify({
          repositories: [
            { id: 4242, full_name: "acme/newrepo" },
            { id: 5555, full_name: "acme/secretrepo" },
          ],
        }),
        { status: 200 },
      );
    return realFetch(url as string, init);
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
});

// alice: admin of org A. bob: member of A. carol: admin of org B.
async function seedTwoOrgs() {
  clearRepoAccessCache();
  delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
  const db = openDatabase(":memory:");
  const auth = createAuth(db, { testMode: true });
  await migrateAuthSchema(auth);
  const app = createApp(db, { auth });

  const orgs = new OrgRepository(db);
  const a = orgs.create({ slug: "org-a", name: "Org A", status: "active", metadata: {} });
  const b = orgs.create({ slug: "org-b", name: "Org B", status: "active", metadata: {} });
  orgs.setMember(a.id, "alice", "admin");
  orgs.setMember(a.id, "bob", "member");
  orgs.setMember(b.id, "carol", "admin");

  async function signIn(login: string) {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: login, email: `${login}@example.com`, password: "hunter2hunter2" }),
    });
    expect(res.status).toBe(200);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }

  return { db, app, orgA: a.id, orgB: b.id, signIn };
}

function send(app: ReturnType<typeof createApp>, method: string, path: string, cookie: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("org admin manages their own members; a member cannot", async () => {
  const { db, app, orgA, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  const bob = await signIn("bob");

  expect((await send(app, "POST", `/api/orgs/${orgA}/members`, alice, { github_login: "dave" })).status).toBe(201);
  expect(new OrgRepository(db).roleFor(orgA, "dave")).toBe("member");

  // A member may read the roster but not change it.
  expect((await send(app, "GET", `/api/orgs/${orgA}/members`, bob)).status).toBe(200);
  expect((await send(app, "POST", `/api/orgs/${orgA}/members`, bob, { github_login: "eve" })).status).toBe(403);
  expect((await send(app, "DELETE", `/api/orgs/${orgA}/members/dave`, bob)).status).toBe(403);

  // Promotion and removal.
  expect((await send(app, "PATCH", `/api/orgs/${orgA}/members/dave`, alice, { role: "admin" })).status).toBe(200);
  expect(new OrgRepository(db).roleFor(orgA, "dave")).toBe("admin");
  expect((await send(app, "DELETE", `/api/orgs/${orgA}/members/dave`, alice)).status).toBe(200);
  expect(new OrgRepository(db).roleFor(orgA, "dave")).toBeNull();

  // Unknown member is a 404, not a silent success.
  expect((await send(app, "DELETE", `/api/orgs/${orgA}/members/nobody`, alice)).status).toBe(404);
});

test("an org cannot be left without an admin", async () => {
  const { app, orgA, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  expect((await send(app, "DELETE", `/api/orgs/${orgA}/members/alice`, alice)).status).toBe(409);
  expect((await send(app, "PATCH", `/api/orgs/${orgA}/members/alice`, alice, { role: "member" })).status).toBe(409);
});

test("org A's admin sees org B as if it did not exist", async () => {
  const { app, orgB, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  // 404 everywhere, never 403: a 403 would confirm the tenant exists.
  for (const [method, path, body] of [
    ["GET", `/api/orgs/${orgB}`, undefined],
    ["GET", `/api/orgs/${orgB}/members`, undefined],
    ["POST", `/api/orgs/${orgB}/members`, { github_login: "mallory" }],
    ["DELETE", `/api/orgs/${orgB}/members/carol`, undefined],
    ["GET", `/api/orgs/${orgB}/keys`, undefined],
    ["POST", `/api/orgs/${orgB}/repos`, { fingerprint: "github.com/acme/newrepo" }],
  ] as const) {
    const res = await send(app, method, path, alice, body);
    expect({ path, status: res.status }).toEqual({ path, status: 404 });
  }
});

test("org admin sees and revokes only their own members' keys", async () => {
  const { db, app, orgA, orgB, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  const bobCookie = await signIn("bob");
  // The aznex user row is created on the first authenticated request, not at sign-up.
  await app.request("/api/keys", { headers: { Cookie: bobCookie } });
  const carolUser = new UserRepository(db).create({
    github_id: "3", github_login: "carol", display_name: "Carol", avatar_url: null, metadata: {},
  });
  const bobUser = new UserRepository(db).getByGithubLogin("bob")!;
  const bobToken = mintApiKey(db, bobUser.id, "bob-laptop");
  mintApiKey(db, carolUser.id, "carol-laptop");

  const listed = (await (await send(app, "GET", `/api/orgs/${orgA}/keys`, alice)).json()) as any;
  expect(listed.keys.map((k: any) => k.github_login).sort()).toEqual(["bob"]);
  expect(listed.keys[0].name).toBe("bob-laptop");
  // Never the secret itself.
  expect(JSON.stringify(listed)).not.toContain(bobToken);

  // Bob's key works, then alice revokes it.
  expect((await app.request("/api/keys", { headers: { Authorization: `Bearer ${bobToken}` } })).status).toBe(200);
  expect((await send(app, "POST", `/api/orgs/${orgA}/keys/${listed.keys[0].id}/revoke`, alice)).status).toBe(200);
  expect((await app.request("/api/keys", { headers: { Authorization: `Bearer ${bobToken}` } })).status).toBe(401);

  // Carol's key belongs to org B: invisible, and unrevokable by guessing its id.
  const carolKey = new ApiKeyRepository(db).listByUser(carolUser.id)[0]!;
  expect((await send(app, "POST", `/api/orgs/${orgA}/keys/${carolKey.id}/revoke`, alice)).status).toBe(404);
  expect((await send(app, "POST", `/api/orgs/${orgB}/keys/${carolKey.id}/revoke`, alice)).status).toBe(404);
  expect(new ApiKeyRepository(db).getById(carolKey.id)?.status).toBe("active");
});

test("org admin onboards a repo by name into their org", async () => {
  const { db, app, orgA, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  const res = await send(app, "POST", `/api/orgs/${orgA}/repos`, alice, {
    fingerprint: "github.com/acme/newrepo",
  });
  expect(res.status).toBe(201);
  const repo = new RepoRepository(db).getByFingerprint("github.com/acme/newrepo")!;
  expect(repo.org_id).toBe(orgA);
  expect(repo.github_repo_id).toBe("4242");
  expect(repo.github_installation_id).toBe(77);
});

test("being an org admin does not override GitHub: no access, no onboarding", async () => {
  const { db, app, orgA, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  const res = await send(app, "POST", `/api/orgs/${orgA}/repos`, alice, {
    fingerprint: "github.com/acme/secretrepo",
  });
  expect(res.status).toBe(403);
  expect(new RepoRepository(db).getByFingerprint("github.com/acme/secretrepo")).toBeNull();
});

test("repo the App is not installed on → 400; bad body → 400", async () => {
  const { app, orgA, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  const notInstalled = await send(app, "POST", `/api/orgs/${orgA}/repos`, alice, {
    fingerprint: "github.com/other/repo",
  });
  expect(notInstalled.status).toBe(400);
  expect(((await notInstalled.json()) as any).error).toContain("not installed");

  for (const body of [{ fingerprint: "not-a-fingerprint" }, {}]) {
    expect((await send(app, "POST", `/api/orgs/${orgA}/repos`, alice, body)).status).toBe(400);
  }
});

test("installation sync onboards what the caller can access, skips the rest", async () => {
  const { db, app, orgA, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  const res = await send(app, "POST", `/api/orgs/${orgA}/installations/sync`, alice, { installation_id: 77 });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { onboarded: string[]; skipped: string[] };
  expect(body.onboarded).toEqual(["github.com/acme/newrepo"]);
  expect(body.skipped).toEqual(["acme/secretrepo"]);
  expect(new RepoRepository(db).getActiveByFingerprint("github.com/acme/newrepo")?.org_id).toBe(orgA);
});

test("de-board hides the repo; another org cannot de-board it; re-onboarding reactivates", async () => {
  const { db, app, orgA, orgB, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  const carol = await signIn("carol");
  const FP = "github.com/acme/newrepo";
  const onboard = () => send(app, "POST", `/api/orgs/${orgA}/repos`, alice, { fingerprint: FP });
  expect((await onboard()).status).toBe(201);

  // Org B's admin cannot reach org A's repo, through either org's path.
  expect((await send(app, "DELETE", `/api/orgs/${orgB}/repos`, carol, { fingerprint: FP })).status).toBe(404);
  expect((await send(app, "DELETE", `/api/orgs/${orgA}/repos`, carol, { fingerprint: FP })).status).toBe(404);
  expect(new RepoRepository(db).getActiveByFingerprint(FP)).not.toBeNull();

  expect((await send(app, "DELETE", `/api/orgs/${orgA}/repos`, alice, { fingerprint: FP })).status).toBe(200);
  const repos = new RepoRepository(db);
  expect(repos.getActiveByFingerprint(FP)).toBeNull();
  expect(repos.getByFingerprint(FP)?.status).toBe("inactive");

  // Hidden from the selector and rejected by reads.
  const list = (await (await app.request("/api/repos", { headers: { Cookie: alice } })).json()) as any;
  expect(list.repos).toEqual([]);
  const read = await app.request(`/api/memories?repo_fingerprint=${encodeURIComponent(FP)}`, {
    headers: { Cookie: alice },
  });
  expect(read.status).toBe(403);

  expect((await onboard()).status).toBe(201);
  expect(repos.getActiveByFingerprint(FP)).not.toBeNull();
});

test("a repo already owned by another org is never re-homed by sync", async () => {
  const { db, app, orgA, orgB, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  const carol = await signIn("carol");
  new OrgRepository(db).setMember(orgB, "alice", "admin"); // alice legitimately in both

  expect((await send(app, "POST", `/api/orgs/${orgA}/repos`, alice, { fingerprint: "github.com/acme/newrepo" })).status).toBe(201);
  // Carol syncs the same installation into org B. She has GitHub access to both
  // repos, but newrepo already belongs to org A and must be left there.
  const res = await send(app, "POST", `/api/orgs/${orgB}/installations/sync`, carol, { installation_id: 77 });
  const body = (await res.json()) as { onboarded: string[]; skipped: string[] };
  expect(body.skipped).toContain("acme/newrepo");
  expect(body.onboarded).toEqual(["github.com/acme/secretrepo"]);
  expect(new RepoRepository(db).getByFingerprint("github.com/acme/newrepo")?.org_id).toBe(orgA);
  expect(new RepoRepository(db).getByFingerprint("github.com/acme/secretrepo")?.org_id).toBe(orgB);
});

test("GET /orgs lists only the caller's orgs", async () => {
  const { app, orgA, signIn } = await seedTwoOrgs();
  const alice = await signIn("alice");
  const body = (await (await app.request("/api/orgs", { headers: { Cookie: alice } })).json()) as any;
  expect(body.orgs).toEqual([{ id: orgA, slug: "org-a", name: "Org A", role: "admin" }]);
  expect(body.is_super_admin).toBe(false);
});

test("a super admin can act on any org without being a member", async () => {
  const { app, orgB, signIn } = await seedTwoOrgs();
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "root";
  const root = await signIn("root");
  try {
    expect((await send(app, "POST", `/api/orgs/${orgB}/members`, root, { github_login: "dave" })).status).toBe(201);
    expect((await send(app, "GET", `/api/orgs/${orgB}/members`, root)).status).toBe(200);
  } finally {
    delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
  }
});
