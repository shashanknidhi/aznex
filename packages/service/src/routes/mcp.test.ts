import { test, expect, beforeAll, afterAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { openDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { UserRepository } from "../repositories/user.js";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { RepoRepository } from "../repositories/repo.js";
import { GithubInstallationRepository } from "../repositories/github-installation.js";
import { MemoryRepository } from "../repositories/memory.js";
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
    fingerprint: FP, canonical: "acme/widget",
    github_repo_id: "9001", github_installation_id: 42, status: "active", metadata: {},
  });

  // Mixed visibility fixtures. created_at_epoch is forced to distinct values
  // so recency ordering is deterministic.
  const memories = new MemoryRepository(db);
  const mk = (id: string, content: string, epoch: number) => {
    memories.create({
      id, repo_fingerprint: FP, session_id: null, author_id: user.id, agent: "claude-code",
      kind: "observation", type: "extracted_learning", title: null, content, narrative: null,
      facts: [], concepts: [], files_read: [], files_modified: [],
      confirmed_commit: null, ai_extracted: true, metadata: {},
    });
    db.prepare("UPDATE memory SET created_at_epoch = ? WHERE id = ?").run(epoch, id);
  };
  mk("shared_fresh_old", "auth tokens rotate hourly", 1000);
  mk("shared_fresh_new", "auth middleware verifies bearer tokens", 2000);
  mk("shared_stale", "auth used to be cookie based", 3000);
  mk("private_fresh", "auth secret note", 4000);
  memories.setPromotion("shared_fresh_old", "team_shared");
  memories.setPromotion("shared_fresh_new", "team_shared");
  memories.setPromotion("shared_stale", "team_shared");
  memories.setFreshness("shared_stale", "stale_suspected");
  // private_fresh stays promotion_state=private

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

test("search_memory returns only team_shared + fresh by default", async () => {
  const { app } = seed();
  const res = await callTool(app, "search_memory", { query: "auth", repo_fingerprint: FP });
  expect(res.status).toBe(200);
  const payload = await toolPayload(res);
  const ids = payload.results.map((r: any) => r.id).sort();
  expect(ids).toEqual(["shared_fresh_new", "shared_fresh_old"]);
});

test("search_memory include_stale=true adds stale_suspected records", async () => {
  const { app } = seed();
  const res = await callTool(app, "search_memory", {
    query: "auth", repo_fingerprint: FP, include_stale: true,
  });
  const ids = (await toolPayload(res)).results.map((r: any) => r.id);
  expect(ids).toContain("shared_stale");
  expect(ids).not.toContain("private_fresh");
});

test("get_recent_context returns team_shared+fresh, newest first", async () => {
  const { app } = seed();
  const res = await callTool(app, "get_recent_context", { repo_fingerprint: FP });
  const items = (await toolPayload(res)).items;
  expect(items.map((i: any) => i.id)).toEqual(["shared_fresh_new", "shared_fresh_old"]);
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
  expect(names).toEqual(["get_recent_context", "search_memory"]);
});
