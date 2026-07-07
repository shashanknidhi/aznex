import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { isAdminGithubLogin } from "../middleware/auth.js";
import { verifyRepoAccess } from "../auth/repo-access.js";
import { RepoRepository } from "../repositories/repo.js";
import { MemoryRepository, type MemoryFilter } from "../repositories/memory.js";
import { MemoryAnchorRepository } from "../repositories/memory-anchor.js";

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
    return c.json({ items: items.map((m) => ({ ...m, mine: m.author_id === user.id })), total, page });
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
    return c.json({ ...memory, anchors, mine: memory.author_id === c.get("user").id });
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
