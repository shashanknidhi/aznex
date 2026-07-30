import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import type { Database } from "bun:sqlite";
import { openDatabase } from "../db/connection.js";
import { loadConfig } from "../config.js";
import { authorizeRepo, isDenial } from "./authorize.js";
import { clearRepoAccessCache } from "./repo-access.js";
import { OrgRepository } from "../repositories/org.js";
import { RepoRepository } from "../repositories/repo.js";
import { UserRepository } from "../repositories/user.js";
import { GithubInstallationRepository } from "../repositories/github-installation.js";

// The gate every repo-scoped read and write funnels through. One test per denial
// branch, because a single missing branch is a cross-tenant leak.

const FP = "github.com/acme/widget";
const realFetch = globalThis.fetch;
let githubAllows = true;
let githubThrows = false;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  globalThis.fetch = (async (url: string) => {
    if (githubThrows) throw new Error("github is down");
    if (String(url).includes("/access_tokens")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    return new Response(null, { status: githubAllows ? 204 : 404 });
  }) as unknown as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

function fixture(opts: { orgStatus?: "active" | "suspended"; member?: boolean; repoActive?: boolean; orphanRepo?: boolean } = {}) {
  clearRepoAccessCache();
  githubAllows = true;
  githubThrows = false;
  const db = openDatabase(":memory:");
  const user = new UserRepository(db).create({
    github_id: "1", github_login: "Alice", display_name: null, avatar_url: null, metadata: {},
  });
  const orgs = new OrgRepository(db);
  const org = orgs.create({
    slug: "acme", name: "Acme", status: opts.orgStatus ?? "active", metadata: {},
  });
  if (opts.member ?? true) orgs.setMember(org.id, "alice", "member");
  new GithubInstallationRepository(db).create({
    installation_id: 42, account_type: "org", account_login: "acme", metadata: {},
  });
  new RepoRepository(db).create({
    fingerprint: FP, canonical: "acme/widget", github_repo_id: "9001", github_installation_id: 42,
    org_id: opts.orphanRepo ? null : org.id,
    status: (opts.repoActive ?? true) ? "active" : "inactive",
    metadata: {},
  });
  return { db, user, org };
}

function run(db: Database, user: any, fingerprint = FP) {
  return authorizeRepo({ db, user, fingerprint, config: loadConfig() });
}

test("all conditions met → repo, org and role", async () => {
  const { db, user, org } = fixture();
  const result = await run(db, user);
  expect(isDenial(result)).toBe(false);
  if (isDenial(result)) return;
  expect(result.repo.fingerprint).toBe(FP);
  expect(result.org.id).toBe(org.id);
  expect(result.role).toBe("member"); // login matched case-insensitively
});

test("a fingerprint this deployment never onboarded → unknown_repo", async () => {
  const { db, user } = fixture();
  expect(await run(db, user, "github.com/nobody/nothing")).toBe("unknown_repo");
});

test("de-boarded repo behaves as unknown", async () => {
  const { db, user } = fixture({ repoActive: false });
  expect(await run(db, user)).toBe("unknown_repo");
});

test("repo with no owning org is denied, not open", async () => {
  const { db, user } = fixture({ orphanRepo: true });
  expect(await run(db, user)).toBe("forbidden");
});

test("suspended org denies its own members", async () => {
  const { db, user } = fixture({ orgStatus: "suspended" });
  expect(await run(db, user)).toBe("forbidden");
});

// The gate that makes "remove member" mean something: GitHub still says yes.
test("non-member is denied even though GitHub grants collaborator access", async () => {
  const { db, user } = fixture({ member: false });
  githubAllows = true;
  expect(await run(db, user)).toBe("forbidden");
});

test("member is denied when GitHub says they are not a collaborator", async () => {
  const { db, user } = fixture();
  githubAllows = false;
  expect(await run(db, user)).toBe("forbidden");
});

test("removing the membership revokes access on the next request", async () => {
  const { db, user, org } = fixture();
  expect(isDenial(await run(db, user))).toBe(false);
  new OrgRepository(db).removeMember(org.id, "alice");
  expect(await run(db, user)).toBe("forbidden");
});

test("a member of another org cannot reach this repo", async () => {
  const { db, user } = fixture({ member: false });
  const orgs = new OrgRepository(db);
  const other = orgs.create({ slug: "beta", name: "Beta", status: "active", metadata: {} });
  orgs.setMember(other.id, "alice", "admin"); // admin, but of the wrong tenant
  expect(await run(db, user)).toBe("forbidden");
});

// A GitHub outage or missing credentials must never resolve to "allowed".
test("a GitHub failure propagates instead of passing", async () => {
  const { db, user } = fixture();
  githubThrows = true;
  await expect(run(db, user)).rejects.toThrow();
});

test("missing GitHub App credentials fail closed", async () => {
  const { db, user } = fixture();
  const appId = process.env["GITHUB_APP_ID"];
  delete process.env["GITHUB_APP_ID"];
  try {
    await expect(run(db, user)).rejects.toThrow(/credentials not configured/);
  } finally {
    process.env["GITHUB_APP_ID"] = appId;
  }
});
