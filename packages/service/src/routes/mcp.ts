import type { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  SearchMemoryParamsSchema,
  GetRecentContextParamsSchema,
  GetMemoryParamsSchema,
  GetMemoriesByPathParamsSchema,
  ListSessionsParamsSchema,
  type Memory,
  type User,
} from "@aznex/shared";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { verifyRepoAccess } from "../auth/repo-access.js";
import { RepoRepository } from "../repositories/repo.js";
import { MemoryRepository, type MemoryFilter } from "../repositories/memory.js";
import { MemoryAnchorRepository } from "../repositories/memory-anchor.js";
import { SessionRepository } from "../repositories/session.js";
import pkg from "../../package.json" with { type: "json" };

// MCP read path (#13/#14). Agent-agnostic: any MCP client with an API key can
// query team memory. Stateless transport — every POST carries a full JSON-RPC
// exchange, so no session bookkeeping server-side.

// Only team-shared knowledge is served; freshness filter is opt-out.
function readFilter(includeStale: boolean): MemoryFilter {
  return includeStale
    ? { promotionState: "team_shared" }
    : { promotionState: "team_shared", freshnessState: "fresh" };
}

async function checkRepoAccess(db: Database, user: User, fingerprint: string): Promise<string | null> {
  const repo = new RepoRepository(db).getActiveByFingerprint(fingerprint);
  if (!repo) return "unknown_repo";
  const access = await verifyRepoAccess({ user, repo, config: loadConfig() });
  return access.allowed ? null : "forbidden";
}

function toolError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function toolResult(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function buildMcpServer(db: Database, user: User): McpServer {
  const server = new McpServer({ name: "aznex", version: pkg.version });
  const memories = new MemoryRepository(db);
  const anchors = new MemoryAnchorRepository(db);

  server.registerTool(
    "search_memory",
    {
      description:
        "Full-text search over this repo's team-shared memory. Returns memories ranked by relevance.",
      inputSchema: SearchMemoryParamsSchema.shape,
    },
    async (params) => {
      const denied = await checkRepoAccess(db, user, params.repo_fingerprint);
      if (denied) return toolError(denied);
      const found = memories.search(
        params.repo_fingerprint,
        params.query,
        params.limit ?? 10,
        readFilter(params.include_stale),
      );
      return toolResult({
        results: found.map((m: Memory) => ({
          id: m.id,
          type: m.type,
          content: m.content,
          freshness_state: m.freshness_state,
          promotion_state: m.promotion_state,
          anchors: anchors.listByMemory(m.id).map((a) => ({ path: a.path })),
          author_id: m.author_id,
          created_at_epoch: m.created_at_epoch,
        })),
      });
    },
  );

  server.registerTool(
    "get_recent_context",
    {
      description:
        "Most recent team-shared memories for a repo — session-start context injection.",
      inputSchema: GetRecentContextParamsSchema.shape,
    },
    async (params) => {
      const denied = await checkRepoAccess(db, user, params.repo_fingerprint);
      if (denied) return toolError(denied);
      const items = memories.listByRepo(
        params.repo_fingerprint,
        params.limit ?? 20,
        readFilter(false),
      );
      return toolResult({
        items: items.map((m: Memory) => ({
          id: m.id,
          type: m.type,
          content: m.content,
          freshness_state: m.freshness_state,
        })),
      });
    },
  );

  server.registerTool(
    "get_memory",
    {
      description:
        "Fetch one memory by id — the full record: narrative, facts, concepts, anchors, provenance. Use after search/context returned an id you need details on.",
      inputSchema: GetMemoryParamsSchema.shape,
    },
    async (params) => {
      const memory = memories.getById(params.id);
      // Authors see their own in any state; others only team_shared — and
      // hidden records look identical to missing ones (don't leak existence).
      if (!memory || (memory.promotion_state !== "team_shared" && memory.author_id !== user.id)) {
        return toolError("not_found");
      }
      const denied = await checkRepoAccess(db, user, memory.repo_fingerprint);
      if (denied) return toolError(denied);
      return toolResult({
        ...memory,
        anchors: anchors.listByMemory(memory.id),
      });
    },
  );

  server.registerTool(
    "get_memories_by_path",
    {
      description:
        "Team-shared memories anchored to a repo-relative file path — what the team knows about a specific file.",
      inputSchema: GetMemoriesByPathParamsSchema.shape,
    },
    async (params) => {
      const denied = await checkRepoAccess(db, user, params.repo_fingerprint);
      if (denied) return toolError(denied);
      const filter = readFilter(params.include_stale);
      const found = anchors
        .listByPath(params.path)
        .map((a) => memories.getById(a.memory_id))
        .filter(
          (m): m is Memory =>
            m !== null &&
            m.repo_fingerprint === params.repo_fingerprint &&
            m.promotion_state === "team_shared" &&
            (filter.freshnessState === undefined || m.freshness_state === filter.freshnessState),
        );
      return toolResult({
        items: found.map((m) => ({
          id: m.id,
          type: m.type,
          content: m.content,
          freshness_state: m.freshness_state,
          created_at_epoch: m.created_at_epoch,
        })),
      });
    },
  );

  server.registerTool(
    "list_sessions",
    {
      description:
        "Recent capture sessions for a repo (timeline) — who worked when, with which agent. Session ids link memories together.",
      inputSchema: ListSessionsParamsSchema.shape,
    },
    async (params) => {
      const denied = await checkRepoAccess(db, user, params.repo_fingerprint);
      if (denied) return toolError(denied);
      const sessions = new SessionRepository(db).listByRepo(
        params.repo_fingerprint,
        Math.min(params.limit ?? 20, 100),
      );
      return toolResult({
        items: sessions.map((s) => ({
          id: s.id,
          agent: s.agent,
          started_at_epoch: s.started_at_epoch,
          ended_at_epoch: s.ended_at_epoch,
        })),
      });
    },
  );

  return server;
}

export function registerMcpRoutes(app: Hono<AppEnv>): void {
  app.post("/", apiKeyAuth(), async (c) => {
    const server = buildMcpServer(c.get("db"), c.get("user"));
    // Stateless mode: no session ids, plain JSON responses. Every POST is a
    // self-contained JSON-RPC exchange against a fresh server instance.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
