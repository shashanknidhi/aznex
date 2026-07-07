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

const TOKEN = "read-token";
const FP = "github.com/acme/widget";
const realFetch = globalThis.fetch;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/access_tokens")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    return new Response(JSON.stringify({ permission: "write" }), { status: 200 });
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
  new RepoRepository(db).create({
    fingerprint: FP, canonical: "acme/widget",
    github_repo_id: "9001", github_installation_id: 42, status: "active", metadata: {},
  });

  const memories = new MemoryRepository(db);
  for (let i = 1; i <= memoryCount; i++) {
    memories.create({
      id: `mem_${i}`, repo_fingerprint: FP, session_id: null, author_id: user.id,
      agent: "claude-code", kind: "observation", type: "extracted_learning",
      title: null, content: `note number ${i} about caching`, narrative: null,
      facts: [], concepts: [], files_read: [], files_modified: [],
      confirmed_commit: null, ai_extracted: true, metadata: {},
    });
    db.prepare("UPDATE memory SET created_at_epoch = ? WHERE id = ?").run(i * 1000, `mem_${i}`);
    memories.setPromotion(`mem_${i}`, "team_shared");
  }
  // another user's private memory must never appear to the caller
  const other = new UserRepository(db).create({
    github_id: "2", github_login: "mallory", display_name: "Mallory", avatar_url: null, metadata: {},
  });
  memories.create({
    id: "mem_private", repo_fingerprint: FP, session_id: null, author_id: other.id,
    agent: "claude-code", kind: "observation", type: "extracted_learning",
    title: null, content: "private caching note", narrative: null,
    facts: [], concepts: [], files_read: [], files_modified: [],
    confirmed_commit: null, ai_extracted: true, metadata: {},
  });
  db.prepare("UPDATE memory SET created_at_epoch = ? WHERE id = ?").run(50, "mem_private");
  // the caller's own private memory IS visible (review-and-promote flow)
  memories.create({
    id: "mem_own_private", repo_fingerprint: FP, session_id: null, author_id: user.id,
    agent: "claude-code", kind: "observation", type: "extracted_learning",
    title: null, content: "my own private caching note", narrative: null,
    facts: [], concepts: [], files_read: [], files_modified: [],
    confirmed_commit: null, ai_extracted: true, metadata: {},
  });
  db.prepare("UPDATE memory SET created_at_epoch = ? WHERE id = ?").run(10, "mem_own_private");
  new MemoryAnchorRepository(db).upsert({ memory_id: "mem_1", path: "src/cache.ts", commit_sha: "abc" });
  return { db, app: createApp(db) };
}

function get(app: ReturnType<typeof createApp>, path: string, token = TOKEN) {
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } });
}

test("unauthenticated → 401", async () => {
  const { app } = seed();
  const res = await get(app, `/api/memories?repo_fingerprint=${FP}`, "wrong");
  expect(res.status).toBe(401);
});

test("list: team_shared + caller's own private, never others' private", async () => {
  const { app } = seed();
  const res = await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as any;
  expect(body.total).toBe(4);
  expect(body.items.map((m: any) => m.id)).toEqual(["mem_3", "mem_2", "mem_1", "mem_own_private"]);
  const own = body.items.find((m: any) => m.id === "mem_own_private");
  expect(own.mine).toBe(true);
  expect(own.promotion_state).toBe("private");
});

test("pagination slices and reports total", async () => {
  const { app } = seed(25);
  const p1 = (await (await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}&page=1`)).json()) as any;
  const p2 = (await (await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}&page=2`)).json()) as any;
  expect(p1.items.length).toBe(20);
  expect(p2.items.length).toBe(6); // 25 shared + own private
  expect(p2.total).toBe(26);
  expect(p2.page).toBe(2);
});

test("q= search: includes own private, excludes others' private", async () => {
  const { app } = seed();
  const res = await get(app, `/api/memories?repo_fingerprint=${encodeURIComponent(FP)}&q=caching`);
  const body = (await res.json()) as any;
  expect(body.total).toBe(4);
  expect(body.items.map((m: any) => m.id)).not.toContain("mem_private");
  expect(body.items.map((m: any) => m.id)).toContain("mem_own_private");
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
  expect(body.anchors).toEqual([{ memory_id: "mem_1", path: "src/cache.ts", commit_sha: "abc" }]);
});

test("unknown or others'-private id → 404; own private → 200", async () => {
  const { app } = seed();
  expect((await get(app, "/api/memories/nope")).status).toBe(404);
  expect((await get(app, "/api/memories/mem_private")).status).toBe(404);
  expect((await get(app, "/api/memories/mem_own_private")).status).toBe(200);
});

function post(app: ReturnType<typeof createApp>, path: string, token = TOKEN) {
  return app.request(path, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

test("author promotes own private memory; teammate-visibility flips", async () => {
  const { db, app } = seed();
  const res = await post(app, "/api/memories/mem_own_private/promote");
  expect(res.status).toBe(200);
  expect(new MemoryRepository(db).getById("mem_own_private")?.promotion_state).toBe("team_shared");
});

test("promote of someone else's memory → 403; revoke by author works", async () => {
  const { db, app } = seed();
  expect((await post(app, "/api/memories/mem_private/promote")).status).toBe(403);

  const rev = await post(app, "/api/memories/mem_1/revoke"); // mem_1 authored by caller
  expect(rev.status).toBe(200);
  expect(new MemoryRepository(db).getById("mem_1")?.promotion_state).toBe("private");
});
