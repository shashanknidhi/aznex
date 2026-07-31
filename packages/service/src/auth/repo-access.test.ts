import { test, expect, beforeEach } from "bun:test";
import { generateKeyPairSync } from "crypto";
import type { Repo, User } from "@aznex/shared";
import type { Config } from "../config.js";
import { verifyRepoAccess, clearRepoAccessCache } from "./repo-access.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: Config = {
  port: 0,
  githubAppId: "12345",
  githubAppPrivateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
  repoAccessTtlMs: 60_000,
};

const user = { id: "u1", github_login: "alice" } as User;
const repo = { canonical: "acme/widget", github_installation_id: 42 } as Repo;

// Fake GitHub: first fetch = mint installation token, second = collaborator check.
// `collabStatus` is what GET /collaborators/{user} answers — 204 collaborator,
// 404 not, anything else an error we must fail closed on.
function fakeGitHub(collabStatus: number, body?: unknown, installation?: unknown) {
  let calls = 0;
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls++;
    urls.push(String(url));
    if (String(url).includes("/access_tokens")) {
      return new Response(JSON.stringify({ token: "ghs_installtoken" }), { status: 200 });
    }
    // GET /app/installations/{id} — only reached on the denial path, to tell a
    // real "no access" apart from an App that cannot see org-derived access.
    if (String(url).includes("/app/installations/")) {
      return installation === undefined
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify(installation), { status: 200 });
    }
    return new Response(body === undefined ? null : JSON.stringify(body), { status: collabStatus });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls, urls: () => urls };
}

const ORG_INSTALL_NO_MEMBERS = {
  account: { login: "acme", type: "Organization" },
  permissions: { metadata: "read" },
};

beforeEach(() => clearRepoAccessCache());

test("collaborator (204) → allowed", async () => {
  const gh = fakeGitHub(204);
  expect((await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl })).allowed).toBe(true);
});

test("non-collaborator (404) → denied", async () => {
  const gh = fakeGitHub(404);
  expect((await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl })).allowed).toBe(false);
});

// Regression: the old check read GET /collaborators/{user}/permission and allowed
// anything from "read" up. On a public repo GitHub answers "read" for every login on
// earth, so a stranger passed the gate. Access must not hinge on that endpoint.
test("public-repo 'read' permission for a stranger → denied", async () => {
  const gh = fakeGitHub(200, { permission: "read", role_name: "read" });
  const r = await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  expect(r.allowed).toBe(false);
  expect(gh.urls().some((u) => u.endsWith("/permission"))).toBe(false);
});

test("GitHub error (500) fails closed", async () => {
  const gh = fakeGitHub(500);
  expect((await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl })).allowed).toBe(false);
});

test("login is URL-encoded into the collaborator path", async () => {
  const gh = fakeGitHub(204);
  const odd = { id: "u2", github_login: "a b/../evil" } as User;
  await verifyRepoAccess({ user: odd, repo, config, fetchImpl: gh.fetchImpl });
  const checked = gh.urls().find((u) => !u.includes("/access_tokens"))!;
  expect(checked).toBe("https://api.github.com/repos/acme/widget/collaborators/a%20b%2F..%2Fevil");
});

test("cache hit within TTL → GitHub not called a second time", async () => {
  const gh = fakeGitHub(204);
  await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  const callsAfterFirst = gh.calls();
  await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  expect(gh.calls()).toBe(callsAfterFirst); // no additional fetches
});

test("denials are cached too (no per-request GitHub call for a stranger)", async () => {
  const gh = fakeGitHub(404);
  await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  const callsAfterFirst = gh.calls();
  expect((await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl })).allowed).toBe(false);
  expect(gh.calls()).toBe(callsAfterFirst);
});

// Regression: an org owner has admin on every repo in the org, but that access
// is invisible to an installation holding only `metadata`. It came back as
// "GitHub doesn't list you as a collaborator", which sent people to check a
// collaborator list that was already correct.
test("org installation without 'members' → reported as a missing App permission, not a denial of access", async () => {
  const gh = fakeGitHub(404, undefined, ORG_INSTALL_NO_MEMBERS);
  const r = await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  expect(r.allowed).toBe(false);
  expect(r.reason).toBe("app_missing_members_permission");
  expect(r.orgLogin).toBe("acme");
});

test("org installation WITH 'members' → a 404 is a real non-collaborator", async () => {
  const gh = fakeGitHub(404, undefined, {
    account: { login: "acme", type: "Organization" },
    permissions: { metadata: "read", members: "read" },
  });
  const r = await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  expect(r.allowed).toBe(false);
  expect(r.reason).toBe("not_collaborator");
});

// Personal accounts have no organization permissions at all, so `members` can
// never be granted there — a 404 must stay a plain denial.
test("user-account installation → a 404 is a real non-collaborator", async () => {
  const gh = fakeGitHub(404, undefined, { account: { login: "bob", type: "User" }, permissions: {} });
  const r = await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  expect(r.reason).toBe("not_collaborator");
});

test("the repo's own owner is allowed without asking GitHub", async () => {
  const gh = fakeGitHub(404);
  const own = { canonical: "alice/widget", github_installation_id: 42 } as Repo;
  expect((await verifyRepoAccess({ user, repo: own, config, fetchImpl: gh.fetchImpl })).allowed).toBe(true);
  expect(gh.calls()).toBe(0);
});

test("owner match is case-insensitive (GitHub logins are)", async () => {
  const gh = fakeGitHub(404);
  const own = { canonical: "Alice/Widget", github_installation_id: 42 } as Repo;
  expect((await verifyRepoAccess({ user, repo: own, config, fetchImpl: gh.fetchImpl })).allowed).toBe(true);
});

test("missing app credentials fails closed (throws)", async () => {
  const badConfig = { ...config, githubAppId: null };
  expect(verifyRepoAccess({ user, repo, config: badConfig, fetchImpl: fakeGitHub(204).fetchImpl })).rejects.toThrow();
});
