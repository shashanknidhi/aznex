import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { openDatabase } from "./db/connection.js";
import { createApp } from "./app.js";
import { addOrg, addRepo, addKey } from "./admin-cli.js";
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

  expect(await (await app.request("/assets/app.js")).text()).toBe("console.log(1)");
  for (const path of ["/", "/repo/github.com%2Facme%2Fapi", "/nope"]) {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>spa</html>");
  }
  // API groups still win over the static fallback
  expect((await app.request("/health")).headers.get("content-type")).toContain("application/json");
  expect((await app.request("/api/memories")).status).toBe(401);
  // traversal outside the dir is refused (falls back to index)
  expect(await (await app.request("/../etc/passwd")).text()).toBe("<html>spa</html>");
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
