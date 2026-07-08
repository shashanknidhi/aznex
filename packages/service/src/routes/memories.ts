import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { isAdminGithubLogin } from "../middleware/auth.js";
import { verifyRepoAccess } from "../auth/repo-access.js";
import { RepoRepository } from "../repositories/repo.js";
import { MemoryRepository, type MemoryFilter } from "../repositories/memory.js";
import { MemoryAnchorRepository } from "../repositories/memory-anchor.js";
import { UserRepository } from "../repositories/user.js";
import type { Database } from "bun:sqlite";
import type { Memory } from "@aznex/shared";

// Humans read GitHub usernames, not internal user ids.
function authorLogins(db: Database, memories: Memory[]): Map<string, string> {
  const users = new UserRepository(db);
  const logins = new Map<string, string>();
  for (const id of new Set(memories.map((m) => m.author_id))) {
    logins.set(id, users.getById(id)?.github_login ?? "unknown");
  }
  return logins;
}

const PAGE_SIZE = 20;

// Frontend read API (#15). Accepts a better-auth browser session (#22) or a
// Bearer API key.
export function registerMemoryRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  app.get("/memories", sessionOrApiKeyAuth(auth), async (c) => {
    const fingerprint = c.req.query("repo_fingerprint");
    if (!fingerprint) return c.json({ error: "repo_fingerprint required" }, 400);
    const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
    const q = c.req.query("q")?.trim();

    const db = c.get("db");
    const repo = new RepoRepository(db).getActiveByFingerprint(fingerprint);
    if (!repo) return c.json({ error: "unknown_repo" }, 403);
    const access = await verifyRepoAccess({ user: c.get("user"), repo, config: loadConfig() });
    if (!access.allowed) return c.json({ error: "forbidden" }, 403);

    // Team knowledge plus the caller's own private/pending memories — so
    // authors can review and promote what their sessions captured.
    const user = c.get("user");
    const visible: MemoryFilter = { visibleTo: user.id };
    const memories = new MemoryRepository(db);
    const offset = (page - 1) * PAGE_SIZE;
    const [items, total] = q
      ? [
          memories.search(fingerprint, q, PAGE_SIZE, visible, offset),
          memories.countSearch(fingerprint, q, visible),
        ]
      : [
          memories.listByRepo(fingerprint, PAGE_SIZE, visible, offset),
          memories.countByRepo(fingerprint, visible),
        ];
    const logins = authorLogins(db, items);
    return c.json({
      items: items.map((m) => ({ ...m, mine: m.author_id === user.id, author_login: logins.get(m.author_id) })),
      total,
      page,
    });
  });

  // Worker read path for hook-driven context injection (SessionStart). REST
  // twin of the MCP get_recent_context tool: team_shared + fresh only.
  app.get("/memories/context", sessionOrApiKeyAuth(auth), async (c) => {
    const fingerprint = c.req.query("repo_fingerprint");
    if (!fingerprint) return c.json({ error: "repo_fingerprint required" }, 400);
    const limit = Math.min(Math.max(1, Number(c.req.query("limit") ?? 10) || 10), 50);

    const db = c.get("db");
    const repo = new RepoRepository(db).getActiveByFingerprint(fingerprint);
    if (!repo) return c.json({ error: "unknown_repo" }, 403);
    const access = await verifyRepoAccess({ user: c.get("user"), repo, config: loadConfig() });
    if (!access.allowed) return c.json({ error: "forbidden" }, 403);

    const items = new MemoryRepository(db).listByRepo(fingerprint, limit, {
      promotionState: "team_shared",
      freshnessState: "fresh",
    });
    return c.json({ items: items.map((m) => ({ id: m.id, type: m.type, content: m.content })) });
  });

  // Worker read path for PreToolUse(Read) file-context: memories anchored to a
  // repo-relative path. Anchors aren't repo-scoped, so filter by fingerprint here.
  app.get("/memories/by-path", sessionOrApiKeyAuth(auth), async (c) => {
    const fingerprint = c.req.query("repo_fingerprint");
    const path = c.req.query("path");
    if (!fingerprint || !path) return c.json({ error: "repo_fingerprint and path required" }, 400);

    const db = c.get("db");
    const repo = new RepoRepository(db).getActiveByFingerprint(fingerprint);
    if (!repo) return c.json({ error: "unknown_repo" }, 403);
    const access = await verifyRepoAccess({ user: c.get("user"), repo, config: loadConfig() });
    if (!access.allowed) return c.json({ error: "forbidden" }, 403);

    const memories = new MemoryRepository(db);
    const items = new MemoryAnchorRepository(db)
      .listByPath(path)
      .map((a) => memories.getById(a.memory_id))
      .filter(
        (m): m is Memory =>
          m !== null &&
          m.repo_fingerprint === fingerprint &&
          m.promotion_state === "team_shared" &&
          m.freshness_state === "fresh",
      );
    return c.json({ items: items.map((m) => ({ id: m.id, type: m.type, content: m.content })) });
  });

  app.get("/memories/:id", sessionOrApiKeyAuth(auth), async (c) => {
    const db = c.get("db");
    const memory = new MemoryRepository(db).getById(c.req.param("id"));
    // Authors see their own memories in any state; others only team_shared.
    // Hide the rest the same way as missing ones — don't leak existence.
    if (!memory || (memory.promotion_state !== "team_shared" && memory.author_id !== c.get("user").id)) {
      return c.json({ error: "not_found" }, 404);
    }
    const repo = new RepoRepository(db).getActiveByFingerprint(memory.repo_fingerprint);
    if (!repo) return c.json({ error: "not_found" }, 404);
    const access = await verifyRepoAccess({ user: c.get("user"), repo, config: loadConfig() });
    if (!access.allowed) return c.json({ error: "forbidden" }, 403);

    const anchors = new MemoryAnchorRepository(db).listByMemory(memory.id);
    return c.json({
      ...memory,
      anchors,
      mine: memory.author_id === c.get("user").id,
      author_login: authorLogins(db, [memory]).get(memory.author_id),
    });
  });

  // Promotion lifecycle (data-lifecycle.md): author promotes private → team_shared;
  // author or admin revokes team_shared → private (the safety valve).
  app.post("/memories/:id/promote", sessionOrApiKeyAuth(auth), async (c) => {
    const db = c.get("db");
    const memories = new MemoryRepository(db);
    const memory = memories.getById(c.req.param("id"));
    if (!memory) return c.json({ error: "not_found" }, 404);
    if (memory.author_id !== c.get("user").id) return c.json({ error: "author_only" }, 403);
    memories.setPromotion(memory.id, "team_shared");
    return c.json({ id: memory.id, promotion_state: "team_shared" });
  });

  app.post("/memories/:id/revoke", sessionOrApiKeyAuth(auth), async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const memories = new MemoryRepository(db);
    const memory = memories.getById(c.req.param("id"));
    if (!memory) return c.json({ error: "not_found" }, 404);
    if (memory.author_id !== user.id && !isAdminGithubLogin(user.github_login)) {
      return c.json({ error: "author_or_admin_only" }, 403);
    }
    memories.setPromotion(memory.id, "private");
    return c.json({ id: memory.id, promotion_state: "private" });
  });
}
