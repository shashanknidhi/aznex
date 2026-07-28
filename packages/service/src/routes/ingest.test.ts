import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import type { IngestRequest } from "@aznex/shared";
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

const TOKEN = "worker-token";
const realFetch = globalThis.fetch;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  // Fake GitHub: mint token, then grant write access to any user.
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("/access_tokens")) return new Response(JSON.stringify({ token: "t" }), { status: 200 });
    return new Response(JSON.stringify({ permission: "write" }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

function seed() {
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
    fingerprint: "github.com/acme/widget", canonical: "acme/widget",
    github_repo_id: "9001", github_installation_id: 42, status: "active", metadata: {},
  });
  return { db, app: createApp(db) };
}

function post(app: ReturnType<typeof createApp>, body: unknown, token = TOKEN) {
  return app.request("/v1/ingest", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseReq = (memories: IngestRequest["memories"]): IngestRequest => ({
  repo_fingerprint: "github.com/acme/widget",
  repo_canonical: "acme/widget",
  session: { id: "sess_1", agent: "claude-code" },
  memories,
});

// The wire type is the parsed one, so every field is present here even though
// the schema defaults them for the caller.
const mem = (
  over: Partial<IngestRequest["memories"][number]> & { id: string; content: string },
): IngestRequest["memories"][number] => ({
  type: "raw_observation",
  title: null,
  narrative: null,
  facts: [],
  concepts: [],
  files_read: [],
  files_modified: [],
  metadata: {},
  ai_extracted: false,
  ...over,
});

test("happy path persists session + memory, returns 202", async () => {
  const { db, app } = seed();
  const res = await post(app, baseReq([
    mem({ id: "mem_1", content: "auth uses RS256", files_read: ["src/auth.ts"] }),
  ]));
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ accepted: 1, rejected: [] });
  const stored = new MemoryRepository(db).getById("mem_1");
  expect(stored?.content).toBe("auth uses RS256");
  // Anchors are derived from the file lists, not sent separately.
  expect(new MemoryAnchorRepository(db).listByMemory("mem_1").map((a) => a.path)).toEqual(["src/auth.ts"]);
});

test("every extracted field is stored and searchable", async () => {
  const { db, app } = seed();
  await post(app, baseReq([
    mem({
      id: "mem_rich",
      title: "Migrations are transactional",
      content: "The migration runner wraps each step.",
      narrative: "Traced runMigrations to confirm.",
      facts: ["runMigrations opens one transaction per version"],
      concepts: ["how-it-works"],
      files_read: ["src/db/migrations.ts"],
      files_modified: ["src/db/schema.ts"],
      metadata: { prompt_version: "extraction-v1", model: "sonnet" },
    }),
  ]));
  const memories = new MemoryRepository(db);
  const stored = memories.getById("mem_rich")!;
  expect(stored.title).toBe("Migrations are transactional");
  expect(stored.narrative).toBe("Traced runMigrations to confirm.");
  expect(stored.facts).toEqual(["runMigrations opens one transaction per version"]);
  expect(stored.concepts).toEqual(["how-it-works"]);
  expect(stored.files_modified).toEqual(["src/db/schema.ts"]);
  expect(stored.metadata["model"]).toBe("sonnet");
  // A word that appears only in facts must be findable — memory_fts indexes
  // facts, and this is exactly what the old thin wire payload made impossible.
  expect(memories.search("github.com/acme/widget", "transaction").map((m) => m.id)).toContain("mem_rich");
  // Both file lists become anchors.
  expect(new MemoryAnchorRepository(db).listByMemory("mem_rich").length).toBe(2);
});

test("memory with a secret is rejected individually; clean one accepted", async () => {
  const { db, app } = seed();
  const res = await post(app, baseReq([
    mem({ id: "clean_1", content: "just some notes" }),
    mem({ id: "dirty_1", content: "key is AKIAIOSFODNN7EXAMPLE" }),
  ]));
  const body = (await res.json()) as { accepted: number; rejected: { id: string }[] };
  expect(res.status).toBe(202);
  expect(body.accepted).toBe(1);
  expect(body.rejected.map((r) => r.id)).toEqual(["dirty_1"]);
  expect(new MemoryRepository(db).getById("dirty_1")).toBeNull();
  expect(new MemoryRepository(db).getById("clean_1")).not.toBeNull();
});

test("duplicate session.id + memory.id is idempotent", async () => {
  const { db, app } = seed();
  const req = baseReq([mem({ id: "mem_x", content: "note" })]);
  await post(app, req);
  const res2 = await post(app, req);
  expect(res2.status).toBe(202);
  expect(((await res2.json()) as { accepted: number }).accepted).toBe(1);
  // no duplicate rows
  expect(new MemoryRepository(db).listBySession("sess_1").length).toBe(1);
});

test("a secret in narrative or facts is rejected, not just in content", async () => {
  const { db, app } = seed();
  const res = await post(app, baseReq([
    mem({ id: "leak_narr", content: "clean text", narrative: "key is AKIAIOSFODNN7EXAMPLE" }),
    mem({ id: "leak_fact", content: "clean text", facts: ["token AKIAIOSFODNN7EXAMPLE is in CI"] }),
  ]));
  const body = (await res.json()) as { accepted: number; rejected: { id: string }[] };
  expect(body.accepted).toBe(0);
  expect(body.rejected.map((r) => r.id).sort()).toEqual(["leak_fact", "leak_narr"]);
  expect(new MemoryRepository(db).getById("leak_narr")).toBeNull();
});

test("bad token → 401", async () => {
  const { app } = seed();
  const res = await post(app, baseReq([]), "wrong");
  expect(res.status).toBe(401);
});
