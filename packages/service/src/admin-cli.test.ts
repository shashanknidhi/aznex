import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { openDatabase } from "./db/connection.js";
import { createApp } from "./app.js";
import { addOrg, addRepo, addKey, moveRepo } from "./admin-cli.js";
import { OrgRepository } from "./repositories/org.js";
import { RepoRepository } from "./repositories/repo.js";
import { GithubInstallationRepository } from "./repositories/github-installation.js";
import { ApiKeyRepository } from "./repositories/api-key.js";
import { hashToken } from "./middleware/auth.js";

test("addRepo onboards installation + repo idempotently, under an org", () => {
  const db = openDatabase(":memory:");
  const orgId = addOrg(db, { slug: "acme", name: "Acme", adminLogins: ["alice"] }).id;
  const repo = addRepo(db, { fingerprint: "github.com/acme/api", githubRepoId: "9001", installationId: 42, orgId });
  expect(repo.canonical).toBe("acme/api");
  expect(repo.github_installation_id).toBe(42);
  expect(repo.org_id).toBe(orgId);
  // second call is a no-op returning the same row
  const again = addRepo(db, { fingerprint: "github.com/acme/api", githubRepoId: "9001", installationId: 42, orgId });
  expect(again.id).toBe(repo.id);
});

// Re-onboarding must never move a repo — and its team's memory — to another tenant.
test("addRepo refuses a repo already owned by another org", () => {
  const db = openDatabase(":memory:");
  const a = addOrg(db, { slug: "acme", name: "Acme", adminLogins: ["alice"] }).id;
  const b = addOrg(db, { slug: "beta", name: "Beta", adminLogins: ["bob"] }).id;
  addRepo(db, { fingerprint: "github.com/acme/api", githubRepoId: "9001", installationId: 42, orgId: a });
  expect(() =>
    addRepo(db, { fingerprint: "github.com/acme/api", githubRepoId: "9001", installationId: 42, orgId: b }),
  ).toThrow("another org");
});

// GitHub's numeric id is the stable identity; the fingerprint is not. Matching
// only on fingerprint meant a renamed repo hit the github_repo_id UNIQUE
// constraint and surfaced as an opaque "skipped" during installation sync.
test("addRepo recognises a renamed repo by github_repo_id and adopts the new name", () => {
  const db = openDatabase(":memory:");
  const orgId = addOrg(db, { slug: "acme", name: "Acme", adminLogins: ["alice"] }).id;
  const first = addRepo(db, { fingerprint: "github.com/acme/api", githubRepoId: "9001", installationId: 42, orgId });

  const renamed = addRepo(db, { fingerprint: "github.com/acme/gateway", githubRepoId: "9001", installationId: 42, orgId });
  expect(renamed.id).toBe(first.id); // same repo, and its memories stay attached
  expect(renamed.fingerprint).toBe("github.com/acme/gateway");
  expect(renamed.canonical).toBe("acme/gateway");
  expect(new RepoRepository(db).getByFingerprint("github.com/acme/api")).toBeNull();
});

// Same defect, subtler trigger: fingerprints preserve the repo name's case, so a
// case change would otherwise collide instead of matching.
test("addRepo recognises a case-changed repo name rather than colliding", () => {
  const db = openDatabase(":memory:");
  const orgId = addOrg(db, { slug: "acme", name: "Acme", adminLogins: ["alice"] }).id;
  const first = addRepo(db, { fingerprint: "github.com/acme/nodecraft", githubRepoId: "77", installationId: 42, orgId });
  const recased = addRepo(db, { fingerprint: "github.com/acme/NodeCraft", githubRepoId: "77", installationId: 42, orgId });
  expect(recased.id).toBe(first.id);
  expect(recased.fingerprint).toBe("github.com/acme/NodeCraft");
});

// A repo onboarded into the wrong tenant used to be unfixable without SQL:
// addRepo refuses to re-home, and de-boarding leaves org_id set.
test("moveRepo re-homes a repo between orgs and reactivates it", () => {
  const db = openDatabase(":memory:");
  const a = addOrg(db, { slug: "acme", name: "Acme", adminLogins: ["alice"] }).id;
  const b = addOrg(db, { slug: "beta", name: "Beta", adminLogins: ["bob"] }).id;
  addRepo(db, { fingerprint: "github.com/acme/api", githubRepoId: "9001", installationId: 42, orgId: a });

  const moved = moveRepo(db, { fingerprint: "github.com/acme/api", orgId: b });
  expect(moved.org_id).toBe(b);
  expect(moved.status).toBe("active");
  // And now the other org can onboard it without the ownership throw.
  expect(() =>
    addRepo(db, { fingerprint: "github.com/acme/api", githubRepoId: "9001", installationId: 42, orgId: b }),
  ).not.toThrow();
});

test("moveRepo refuses an unknown repo", () => {
  const db = openDatabase(":memory:");
  const orgId = addOrg(db, { slug: "acme", name: "Acme", adminLogins: ["alice"] }).id;
  expect(() => moveRepo(db, { fingerprint: "github.com/acme/nope", orgId })).toThrow("unknown repo");
});

test("addOrg is idempotent and appoints admins", () => {
  const db = openDatabase(":memory:");
  const first = addOrg(db, { slug: "acme", name: "Acme", adminLogins: ["Alice"] });
  const again = addOrg(db, { slug: "acme", name: "Acme", adminLogins: ["bob"] });
  expect(again.id).toBe(first.id);
  const orgs = new OrgRepository(db);
  expect(orgs.roleFor(first.id, "alice")).toBe("admin");
  expect(orgs.roleFor(first.id, "bob")).toBe("admin");
});

test("addRepo rejects a non-fingerprint", () => {
  const db = openDatabase(":memory:");
  const orgId = addOrg(db, { slug: "acme", name: "Acme", adminLogins: ["alice"] }).id;
  expect(() => addRepo(db, { fingerprint: "acme/api", githubRepoId: "1", installationId: 1, orgId })).toThrow(
    "host/owner/name",
  );
});

test("addKey mints a token whose hash authenticates, and reuses the user", () => {
  const db = openDatabase(":memory:");
  const first = addKey(db, { githubLogin: "alice", githubId: "12345" });
  expect(first.token.startsWith("axk_")).toBe(true);
  const stored = new ApiKeyRepository(db).getByHash(hashToken(first.token));
  expect(stored?.user_id).toBe(first.userId);

  const second = addKey(db, { githubLogin: "alice", githubId: "12345", name: "laptop" });
  expect(second.userId).toBe(first.userId); // same user, new key
  expect(second.token).not.toBe(first.token);
});

test("staticDir serves files and falls back to index.html for SPA routes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aznex-static-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<html>spa</html>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");

  const app = createApp(openDatabase(":memory:"), { staticDir: dir });

  // The SPA is mounted under /dashboard, so its own paths carry that prefix.
  expect(await (await app.request("/dashboard/assets/app.js")).text()).toBe("console.log(1)");
  for (const path of ["/dashboard", "/dashboard/repo/github.com%2Facme%2Fapi", "/dashboard/nope"]) {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>spa</html>");
  }
  // API groups still win over the static fallback
  expect((await app.request("/health")).headers.get("content-type")).toContain("application/json");
  expect((await app.request("/api/memories")).status).toBe(401);
  // Traversal outside the dir is refused: an encoded separator survives URL
  // normalization, so the handler's own `..` check is what stops it. (A literal
  // `/dashboard/../etc/passwd` never reaches the handler — WHATWG URL collapses
  // it to /etc/passwd, which is outside the SPA prefix and just redirects.)
  expect(await (await app.request("/dashboard/..%2fetc/passwd")).text()).toBe("<html>spa</html>");
});

test("/install.sh serves a valid bash script with the service URL baked in", async () => {
  process.env["AZNEX_BASE_URL"] = "https://aznex.example.com";
  const app = createApp(openDatabase(":memory:"));
  const res = await app.request("/install.sh");
  expect(res.status).toBe(200);
  const script = await res.text();
  expect(script).toContain('SERVICE_URL="https://aznex.example.com"');
  expect(script).not.toContain("__SERVICE_URL__");
  // must be syntactically valid bash
  const proc = Bun.spawn(["bash", "-n"], { stdin: new TextEncoder().encode(script), stderr: "pipe" });
  expect(await proc.exited).toBe(0);
  delete process.env["AZNEX_BASE_URL"];
});

// railway.json health-checks /health; a non-200 here rolls the deploy back, so a
// data warning must never fail it.
test("/health reports repos without an org without failing the check", async () => {
  const db = openDatabase(":memory:");
  const app = createApp(db);
  expect(await (await app.request("/health")).json()).toMatchObject({ ok: true });

  new GithubInstallationRepository(db).create({
    installation_id: 1, account_type: "org", account_login: "x", metadata: {},
  });
  new RepoRepository(db).create({
    fingerprint: "github.com/x/y", canonical: "x/y", github_repo_id: "1",
    github_installation_id: 1, org_id: null, status: "active", metadata: {},
  });
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, degraded: "repos_without_org", count: 1 });
});
