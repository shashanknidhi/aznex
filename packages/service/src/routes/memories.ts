import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { verifyRepoAccess } from "../auth/repo-access.js";
import { RepoRepository } from "../repositories/repo.js";
import { MemoryRepository, type MemoryFilter } from "../repositories/memory.js";
import { MemoryAnchorRepository } from "../repositories/memory-anchor.js";

const PAGE_SIZE = 20;
// Read API serves team knowledge only; private/pending stay author-local.
const TEAM_SHARED: MemoryFilter = { promotionState: "team_shared" };

// Frontend read API (#15). ponytail: Bearer API-key auth for now — swapped to
// better-auth browser sessions when the frontend OAuth flow lands (#22).
export function registerMemoryRoutes(app: Hono<AppEnv>): void {
  app.get("/memories", apiKeyAuth(), async (c) => {
    const fingerprint = c.req.query("repo_fingerprint");
    if (!fingerprint) return c.json({ error: "repo_fingerprint required" }, 400);
    const page = Math.max(1, Number(c.req.query("page") ?? 1) || 1);
    const q = c.req.query("q")?.trim();

    const db = c.get("db");
    const repo = new RepoRepository(db).getByFingerprint(fingerprint);
    if (!repo) return c.json({ error: "unknown_repo" }, 403);
    const access = await verifyRepoAccess({ user: c.get("user"), repo, config: loadConfig() });
    if (!access.allowed) return c.json({ error: "forbidden" }, 403);

    const memories = new MemoryRepository(db);
    const offset = (page - 1) * PAGE_SIZE;
    const [items, total] = q
      ? [
          memories.search(fingerprint, q, PAGE_SIZE, TEAM_SHARED, offset),
          memories.countSearch(fingerprint, q, TEAM_SHARED),
        ]
      : [
          memories.listByRepo(fingerprint, PAGE_SIZE, TEAM_SHARED, offset),
          memories.countByRepo(fingerprint, TEAM_SHARED),
        ];
    return c.json({ items, total, page });
  });

  app.get("/memories/:id", apiKeyAuth(), async (c) => {
    const db = c.get("db");
    const memory = new MemoryRepository(db).getById(c.req.param("id"));
    // Hide non-shared records the same way as missing ones — don't leak existence.
    if (!memory || memory.promotion_state !== "team_shared") {
      return c.json({ error: "not_found" }, 404);
    }
    const repo = new RepoRepository(db).getByFingerprint(memory.repo_fingerprint);
    if (!repo) return c.json({ error: "not_found" }, 404);
    const access = await verifyRepoAccess({ user: c.get("user"), repo, config: loadConfig() });
    if (!access.allowed) return c.json({ error: "forbidden" }, 403);

    const anchors = new MemoryAnchorRepository(db).listByMemory(memory.id);
    return c.json({ ...memory, anchors });
  });
}
