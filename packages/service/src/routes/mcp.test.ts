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
import { SessionRepository } from "../repositories/session.js";
import { hashToken } from "../middleware/auth.js";
import { clearRepoAccessCache } from "../auth/repo-access.js";

const TOKEN = "mcp-token";
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
    fingerprint: FP, canonical: "acme/widget",
    github_repo_id: "9001", github_installation_id: 42, status: "active", metadata: {},
  });

  // Every memory captured against the repo is readable by every repo member,
  // so these fixtures differ only in recency. created_at_epoch is forced to
  // distinct values so ordering is deterministic.
  const memories = new MemoryRepository(db);
  const mk = (id: string, content: string, epoch: number) => {
    memories.create({
      id, repo_fingerprint: FP, session_id: null, author_id: user.id, agent: "claude-code",
      kind: "observation", type: "extracted_learning", title: null, content, narrative: null,
      facts: [], concepts: [], files_read: [], files_modified: [], ai_extracted: true, metadata: {},
    });
    db.prepare("UPDATE memory SET created_at_epoch = ? WHERE id = ?").run(epoch, id);
  };
  mk("mem_oldest", "auth tokens rotate hourly", 1000);
  mk("mem_middle", "auth middleware verifies bearer tokens", 2000);
  mk("mem_newest", "auth used to be cookie based", 3000);
  new MemoryAnchorRepository(db).upsert({ memory_id: "mem_middle", path: "src/auth.ts" });
  new MemoryAnchorRepository(db).upsert({ memory_id: "mem_newest", path: "src/auth.ts" });
  new SessionRepository(db).create({
    id: "sess_1", repo_fingerprint: FP, repo_canonical: "acme/widget", agent: "claude-code",
    author_id: user.id, platform_source: "hook", status: "completed",
    started_at_epoch: 1000, ended_at_epoch: 2000, metadata: {},
  });

  return { db, app: createApp(db) };
}

let nextId = 1;
async function callTool(
  app: ReturnType<typeof createApp>,
  name: string,
  args: Record<string, unknown>,
  token = TOKEN,
): Promise<Response> {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

async function toolPayload(res: Response): Promise<any> {
  const rpc = (await res.json()) as any;
  expect(rpc.error).toBeUndefined();
  return JSON.parse(rpc.result.content[0].text);
}

test("search_memory returns every memory in the repo", async () => {
  const { app } = seed();
  const res = await callTool(app, "search_memory", { query: "auth", repo_fingerprint: FP });
  expect(res.status).toBe(200);
  const payload = await toolPayload(res);
  const ids = payload.results.map((r: any) => r.id).sort();
  expect(ids).toEqual(["mem_middle", "mem_newest", "mem_oldest"]);
});

test("get_recent_context returns the repo's memories, newest first", async () => {
  const { app } = seed();
  const res = await callTool(app, "get_recent_context", { repo_fingerprint: FP });
  const items = (await toolPayload(res)).items;
  expect(items.map((i: any) => i.id)).toEqual(["mem_newest", "mem_middle", "mem_oldest"]);
});

test("unknown repo fingerprint → tool error", async () => {
  const { app } = seed();
  const res = await callTool(app, "search_memory", {
    query: "auth", repo_fingerprint: "github.com/evil/other",
  });
  const rpc = (await res.json()) as any;
  expect(rpc.result.isError).toBe(true);
});

test("bad token → 401 before any MCP handling", async () => {
  const { app } = seed();
  const res = await callTool(app, "search_memory", { query: "auth", repo_fingerprint: FP }, "wrong");
  expect(res.status).toBe(401);
});

test("tools are listed", async () => {
  const { app } = seed();
  const res = await app.request("/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list", params: {} }),
  });
  const rpc = (await res.json()) as any;
  const names = rpc.result.tools.map((t: any) => t.name).sort();
  expect(names).toEqual([
    "get_memories_by_path",
    "get_memory",
    "get_recent_context",
    "list_sessions",
    "search_memory",
  ]);
});

test("get_memory returns the full record with anchors", async () => {
  const { app } = seed();
  const full = await toolPayload(await callTool(app, "get_memory", { id: "mem_middle" }));
  expect(full.content).toBe("auth middleware verifies bearer tokens");
  expect(full.anchors).toEqual([{ memory_id: "mem_middle", path: "src/auth.ts" }]);

  const missing = (await (await callTool(app, "get_memory", { id: "nope" })).json()) as any;
  expect(missing.result.isError).toBe(true);
});

test("get_memories_by_path returns every memory anchored to the path", async () => {
  const { app } = seed();
  const found = await toolPayload(
    await callTool(app, "get_memories_by_path", { repo_fingerprint: FP, path: "src/auth.ts" }),
  );
  expect(found.items.map((i: any) => i.id).sort()).toEqual(["mem_middle", "mem_newest"]);
});

test("list_sessions returns the repo timeline", async () => {
  const { app } = seed();
  const payload = await toolPayload(await callTool(app, "list_sessions", { repo_fingerprint: FP }));
  expect(payload.items).toEqual([
    { id: "sess_1", agent: "claude-code", started_at_epoch: 1000, ended_at_epoch: 2000 },
  ]);
});
