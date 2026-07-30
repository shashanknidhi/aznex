import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { openDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { UserRepository } from "../repositories/user.js";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { RepoRepository } from "../repositories/repo.js";
import { GithubInstallationRepository } from "../repositories/github-installation.js";
import { MemoryRepository } from "../repositories/memory.js";
import { MemoryAnchorRepository } from "../repositories/memory-anchor.js";
import { hashToken } from "../middleware/auth.js";
import { clearRepoAccessCache } from "../auth/repo-access.js";
import { seedOrg } from "../test-support.js";
import { OrgRepository } from "../repositories/org.js";

const TOKEN = "read-token";
const FP = "github.com/acme/widget";
const realFetch = globalThis.fetch;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/access_tokens")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

function seed(memoryCount = 3) {
  clearRepoAccessCache();
  const db = openDatabase(":memory:");
  const user = new UserRepository(db).create({
    github_id: "1", github_login: "alice", display_name: "Alice", avatar_url: null, metadata: {},
  });
  new ApiKeyRepository(db).create({
    user_id: user.id, name: "k", key_hash: hashToken(TOKEN), prefix: "axk_",
    scopes: ["ingest"], status: "active", last_used_at_epoch: null, expires_at_epoch: null, metadata: {},
  });
  new GithubInstallationRepository(db).create({
    installation_id: 42, account_type: "org", account_login: "acme", metadata: {},
  });
  const orgId = seedOrg(db, { alice: "member", mallory: "member" });
  new RepoRepository(db).create({
    fingerprint: FP, canonical: "acme/widget",
    github_repo_id: "9001", github_installation_id: 42, org_id: orgId, status: "active", metadata: {},
  });

  const memories = new MemoryRepository(db);
  for (let i = 1; i <= memoryCount; i++) {
    memories.create({
      id: `mem_${i}`, repo_fingerprint: FP, session_id: null, author_id: user.id,
      agent: "claude-code", kind: "observation", type: "extracted_learning",
      title: null, content: `note number ${i} about caching`, narrative: null,
      facts: [], concepts: [], files_read: [], files_modified: [], ai_extracted: true, metadata: {},
    });
    db.prepare("UPDATE memory SET created_at_epoch = ? WHERE id = ?").run(i * 1000, `mem_${i}`);
  }
  // a teammate's memory — visible to everyone, but not deletable by the caller
  const other = new UserRepository(db).create({
    github_id: "2", github_login: "mallory", display_name: "Mallory", avatar_url: null, metadata: {},
  });
  memories.create({
    id: "mem_mallory", repo_fingerprint: FP, session_id: null, author_id: other.id,
    agent: "claude-code", kind: "observation", type: "extracted_learning",
    title: null, content: "mallory's caching note", narrative: null,
    facts: [], concepts: [], files_read: [], files_modified: [], ai_extracted: true, metadata: {},
  });
  db.prepare("UPDATE memory SET created_at_epoch = ? WHERE id = ?").run(50, "mem_mallory");
  new MemoryAnchorRepository(db).upsert({ memory_id: "mem_1", path: "src/cache.ts" });
  return { db, app: createApp(db), user };
}

function get(app: ReturnType<typeof createApp>, path: string, token = TOKEN) {
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } });
}

test("unauthenticated → 401", async () => {
  const { app } = seed();
  const res = await get(app, `/api/memories?repo_fingerprint=${FP}`, "wrong");
  expect(res.status).toBe(401);
});

test("list: every memory in the repo, whoever captured it", async () => {
  const { app } = seed();
  const res = await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.total).toBe(4);
  expect(body.items.map((m: any) => m.id)).toEqual(["mem_3", "mem_2", "mem_1", "mem_mallory"]);
  const mine = body.items.find((m: any) => m.id === "mem_1");
  expect(mine.mine).toBe(true);
  expect(mine.author_login).toBe("alice"); // humans see github usernames, not ids
  const theirs = body.items.find((m: any) => m.id === "mem_mallory");
  expect(theirs.mine).toBe(false);
  expect(theirs.author_login).toBe("mallory");
});

test("pagination slices and reports total", async () => {
  const { app } = seed(25);
  const p1 = (await (await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}&page=1`)).json()) as any;
  const p2 = (await (await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}&page=2`)).json()) as any;
  expect(p1.items.length).toBe(20);
  expect(p2.items.length).toBe(6); // 25 own + 1 teammate's
  expect(p2.total).toBe(26);
  expect(p2.page).toBe(2);
});

test("q= search covers the whole repo", async () => {
  const { app } = seed();
  const res = await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}&q=caching`);
  const body = (await res.json()) as any;
  expect(body.total).toBe(4);
  expect(body.items.map((m: any) => m.id)).toContain("mem_mallory");
});

test("missing repo_fingerprint → 400; unknown repo → 403", async () => {
  const { app } = seed();
  expect((await get(app, "/api/memories")).status).toBe(400);
  expect((await get(app, "/api/memories?repo_fingerprint=github.com/none/none")).status).toBe(403);
});

test("detail returns full record with anchors", async () => {
  const { app } = seed();
  const res = await get(app, "/api/memories/mem_1");
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.content).toBe("note number 1 about caching");
  expect(body.anchors).toEqual([{ memory_id: "mem_1", path: "src/cache.ts" }]);
});

test("unknown id → 404; a teammate's memory → 200", async () => {
  const { app } = seed();
  expect((await get(app, "/api/memories/nope")).status).toBe(404);
  expect((await get(app, "/api/memories/mem_mallory")).status).toBe(200);
});

test("context: newest first, capped by limit", async () => {
  const { app } = seed();
  const res = await get(app, `/api/memories/context?repo_fingerprint=${encodeURIComponent(FP)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.items.map((m: any) => m.id)).toEqual(["mem_3", "mem_2", "mem_1", "mem_mallory"]);

  const limited = (await (
    await get(app, `/api/memories/context?repo_fingerprint=${encodeURIComponent(FP)}&limit=1`)
  ).json()) as any;
  expect(limited.items.length).toBe(1);
});

test("context: missing fingerprint → 400, unknown repo → 403, unauth → 401", async () => {
  const { app } = seed();
  expect((await get(app, "/api/memories/context")).status).toBe(400);
  expect((await get(app, "/api/memories/context?repo_fingerprint=github.com/none/none")).status).toBe(403);
  expect((await get(app, `/api/memories/context?repo_fingerprint=${FP}`, "wrong")).status).toBe(401);
});

test("by-path: anchored memories for this repo only", async () => {
  const { db, app, user } = seed();
  const memories = new MemoryRepository(db);
  // same path anchored from another repo — must not leak in
  memories.create({
    id: "mem_other_repo", repo_fingerprint: "github.com/acme/other", session_id: null, author_id: user.id,
    agent: "claude-code", kind: "observation", type: "extracted_learning",
    title: null, content: "other repo note", narrative: null,
    facts: [], concepts: [], files_read: [], files_modified: [], ai_extracted: true, metadata: {},
  });
  const anchors = new MemoryAnchorRepository(db);
  anchors.upsert({ memory_id: "mem_other_repo", path: "src/cache.ts" });
  // a teammate's memory on the same path does appear
  anchors.upsert({ memory_id: "mem_mallory", path: "src/cache.ts" });

  const res = await get(
    app,
    `/api/memories/by-path?repo_fingerprint=${encodeURIComponent(FP)}&path=${encodeURIComponent("src/cache.ts")}`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.items.map((m: any) => m.id).sort()).toEqual(["mem_1", "mem_mallory"]);

  const none = (await (
    await get(app, `/api/memories/by-path?repo_fingerprint=${encodeURIComponent(FP)}&path=nope.ts`)
  ).json()) as any;
  expect(none.items).toEqual([]);
});

test("by-path: missing params → 400", async () => {
  const { app } = seed();
  expect((await get(app, `/api/memories/by-path?repo_fingerprint=${FP}`)).status).toBe(400);
  expect((await get(app, "/api/memories/by-path?path=x")).status).toBe(400);
});

function del(app: ReturnType<typeof createApp>, path: string, token = TOKEN) {
  return app.request(path, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}

test("author deletes own memory; anchors and FTS row go with it", async () => {
  const { db, app } = seed();
  const res = await del(app, "/api/memories/mem_1"); // authored by the caller
  expect(res.status).toBe(200);
  const memories = new MemoryRepository(db);
  expect(memories.getById("mem_1")).toBeNull();
  expect(new MemoryAnchorRepository(db).listByMemory("mem_1")).toEqual([]);
  expect(memories.search(FP, "note number 1").map((m) => m.id)).not.toContain("mem_1");
});

test("deleting a teammate's memory → 403; unknown id → 404", async () => {
  const { db, app } = seed();
  expect((await del(app, "/api/memories/mem_mallory")).status).toBe(403);
  expect(new MemoryRepository(db).getById("mem_mallory")).not.toBeNull();
  expect((await del(app, "/api/memories/nope")).status).toBe(404);
});

// The org admin is the one who can withdraw a wrong or leaked memory from their
// own repo. Before orgs existed only the author or the global operator could.
test("an org admin deletes any memory in their org", async () => {
  const { db, app } = seed();
  const orgId = new OrgRepository(db).getBySlug("acme")!.id;
  new OrgRepository(db).setMember(orgId, "alice", "admin");
  expect((await del(app, "/api/memories/mem_mallory")).status).toBe(200);
  expect(new MemoryRepository(db).getById("mem_mallory")).toBeNull();
});

// Super admin is manage-only for reads, but must still be able to respond to a
// leak in any tenant — deleting is not reading.
test("a super admin deletes across orgs but cannot read them", async () => {
  const { db, app } = seed();
  new UserRepository(db).create({
    github_id: "9", github_login: "root", display_name: "Root", avatar_url: null, metadata: {},
  });
  const rootUser = new UserRepository(db).getByGithubLogin("root")!;
  new ApiKeyRepository(db).create({
    user_id: rootUser.id, name: "k", key_hash: hashToken("root-token"), prefix: "axk_",
    scopes: [], status: "active", last_used_at_epoch: null, expires_at_epoch: null, metadata: {},
  });
  process.env["AZNEX_ADMIN_GITHUB_LOGINS"] = "root";
  try {
    // Not a member of acme, so the read path denies them.
    const read = await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}`, "root-token");
    expect(read.status).toBe(403);
    // Deletion still works, for leak response.
    expect((await del(app, "/api/memories/mem_mallory", "root-token")).status).toBe(200);
    expect(new MemoryRepository(db).getById("mem_mallory")).toBeNull();
  } finally {
    delete process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
  }
});

test("losing org membership revokes reads and the ability to delete own memories", async () => {
  const { db, app } = seed();
  const orgs = new OrgRepository(db);
  orgs.removeMember(orgs.getBySlug("acme")!.id, "alice");
  clearRepoAccessCache();
  // Still a GitHub collaborator (the stub always says 204) — the org gate is
  // what stops them.
  expect((await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}`)).status).toBe(403);
  expect((await del(app, "/api/memories/mem_1")).status).toBe(403);
  expect(new MemoryRepository(db).getById("mem_1")).not.toBeNull();
});
