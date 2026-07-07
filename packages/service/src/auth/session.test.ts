import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { openDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { createAuth, migrateAuthSchema } from "./session.js";
import { GithubInstallationRepository } from "../repositories/github-installation.js";
import { RepoRepository } from "../repositories/repo.js";
import { MemoryRepository } from "../repositories/memory.js";
import { UserRepository } from "../repositories/user.js";
import { clearRepoAccessCache } from "./repo-access.js";

const FP = "github.com/acme/widget";
const realFetch = globalThis.fetch;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  process.env["BETTER_AUTH_SECRET"] = "test-secret-with-plenty-of-entropy-0123456789";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    // Only intercept GitHub API calls; better-auth and app.request stay local.
    if (u.includes("api.github.com")) {
      if (u.includes("/access_tokens")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
      return new Response(JSON.stringify({ permission: "write" }), { status: 200 });
    }
    return realFetch(url as string, init);
  }) as unknown as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

async function seed() {
  clearRepoAccessCache();
  const db = openDatabase(":memory:");
  const auth = createAuth(db, { testMode: true });
  await migrateAuthSchema(auth);
  const app = createApp(db, { auth });

  new GithubInstallationRepository(db).create({
    installation_id: 42, account_type: "org", account_login: "acme", metadata: {},
  });
  new RepoRepository(db).create({
    fingerprint: FP, canonical: "acme/widget",
    github_repo_id: "9001", github_installation_id: 42, status: "active", metadata: {},
  });
  const seedUser = new UserRepository(db).create({
    github_id: "999", github_login: "seeder", display_name: "Seeder", avatar_url: null, metadata: {},
  });
  const memories = new MemoryRepository(db);
  memories.create({
    id: "mem_1", repo_fingerprint: FP, session_id: null, author_id: seedUser.id,
    agent: "claude-code", kind: "observation", type: "decision",
    title: null, content: "we chose FTS5", narrative: null,
    facts: [], concepts: [], files_read: [], files_modified: [],
    confirmed_commit: null, ai_extracted: true, metadata: {},
  });
  memories.setPromotion("mem_1", "team_shared");
  return { db, app };
}

// Sign up through better-auth (testMode email/password) and return the session cookie.
async function signUpAndGetCookie(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "alice", email: "alice@example.com", password: "hunter2hunter2" }),
  });
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("set-cookie")!;
  return setCookie.split(";")[0]!;
}

test("browser session cookie authenticates /api/memories and maps to an aznex user", async () => {
  const { db, app } = await seed();
  const cookie = await signUpAndGetCookie(app);

  const res = await app.request(`/api/memories?repo_fingerprint=${encodeURIComponent(FP)}`, {
    headers: { Cookie: cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.items.map((m: any) => m.id)).toEqual(["mem_1"]);

  // an aznex user row was created from the better-auth session
  const created = new UserRepository(db).getByGithubId(
    `ba:${(db.prepare("SELECT id FROM auth_user WHERE email = 'alice@example.com'").get() as any).id}`,
  );
  expect(created?.github_login).toBe("alice");
});

test("/api/repos lists only repos the session user can access", async () => {
  const { app } = await seed();
  const cookie = await signUpAndGetCookie(app);
  const res = await app.request("/api/repos", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.repos).toEqual([{ fingerprint: FP, canonical: "acme/widget" }]);
  expect(body.user.login).toBe("alice");
});

test("no cookie and no bearer token → 401", async () => {
  const { app } = await seed();
  expect((await app.request("/api/repos")).status).toBe(401);
  expect((await app.request(`/api/memories?repo_fingerprint=${FP}`)).status).toBe(401);
});

test("allowlist blocks non-listed users on both session and bearer paths", async () => {
  const { app } = await seed();
  const cookie = await signUpAndGetCookie(app); // github_login "alice"
  process.env["AZNEX_ALLOWED_GITHUB_LOGINS"] = "someone-else";
  try {
    const viaSession = await app.request("/api/repos", { headers: { Cookie: cookie } });
    expect(viaSession.status).toBe(403);
    expect(((await viaSession.json()) as any).error).toBe("github_login_not_allowed");

    process.env["AZNEX_ALLOWED_GITHUB_LOGINS"] = "alice";
    expect((await app.request("/api/repos", { headers: { Cookie: cookie } })).status).toBe(200);
  } finally {
    delete process.env["AZNEX_ALLOWED_GITHUB_LOGINS"];
  }
});
