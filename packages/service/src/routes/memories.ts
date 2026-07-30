import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { isSuperAdmin } from "../middleware/auth.js";
import { authorizeRepo, isDenial } from "../auth/authorize.js";
import { MemoryRepository } from "../repositories/memory.js";
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
    const user = c.get("user");
    const auth = await authorizeRepo({ db, user, fingerprint, config: loadConfig() });
    if (isDenial(auth)) return c.json({ error: auth }, 403);

    const memories = new MemoryRepository(db);
    const offset = (page - 1) * PAGE_SIZE;
    const [items, total] = q
      ? [memories.search(fingerprint, q, PAGE_SIZE, offset), memories.countSearch(fingerprint, q)]
      : [memories.listByRepo(fingerprint, PAGE_SIZE, offset), memories.countByRepo(fingerprint)];
    const logins = authorLogins(db, items);
    return c.json({
      items: items.map((m) => ({ ...m, mine: m.author_id === user.id, author_login: logins.get(m.author_id) })),
      total,
      page,
    });
  });

  // Worker read path for hook-driven context injection (SessionStart). REST
  // twin of the MCP get_recent_context tool.
  app.get("/memories/context", sessionOrApiKeyAuth(auth), async (c) => {
    const fingerprint = c.req.query("repo_fingerprint");
    if (!fingerprint) return c.json({ error: "repo_fingerprint required" }, 400);
    const limit = Math.min(Math.max(1, Number(c.req.query("limit") ?? 10) || 10), 50);

    const db = c.get("db");
    const auth = await authorizeRepo({ db, user: c.get("user"), fingerprint, config: loadConfig() });
    if (isDenial(auth)) return c.json({ error: auth }, 403);

    const items = new MemoryRepository(db).listByRepo(fingerprint, limit);
    return c.json({ items: items.map((m) => ({ id: m.id, type: m.type, content: m.content })) });
  });

  // Worker read path for PreToolUse(Read) file-context: memories anchored to a
  // repo-relative path. Anchors aren't repo-scoped, so filter by fingerprint here.
  app.get("/memories/by-path", sessionOrApiKeyAuth(auth), async (c) => {
    const fingerprint = c.req.query("repo_fingerprint");
    const path = c.req.query("path");
    if (!fingerprint || !path) return c.json({ error: "repo_fingerprint and path required" }, 400);

    const db = c.get("db");
    const auth = await authorizeRepo({ db, user: c.get("user"), fingerprint, config: loadConfig() });
    if (isDenial(auth)) return c.json({ error: auth }, 403);

    const memories = new MemoryRepository(db);
    const items = new MemoryAnchorRepository(db)
      .listByPath(path)
      .map((a) => memories.getById(a.memory_id))
      .filter((m): m is Memory => m !== null && m.repo_fingerprint === fingerprint);
    return c.json({ items: items.map((m) => ({ id: m.id, type: m.type, content: m.content })) });
  });

  app.get("/memories/:id", sessionOrApiKeyAuth(auth), async (c) => {
    const db = c.get("db");
    const memory = new MemoryRepository(db).getById(c.req.param("id"));
    if (!memory) return c.json({ error: "not_found" }, 404);
    const auth = await authorizeRepo({
      db,
      user: c.get("user"),
      fingerprint: memory.repo_fingerprint,
      config: loadConfig(),
    });
    if (isDenial(auth)) return c.json({ error: auth === "unknown_repo" ? "not_found" : "forbidden" }, auth === "unknown_repo" ? 404 : 403);

    const anchors = new MemoryAnchorRepository(db).listByMemory(memory.id);
    return c.json({
      ...memory,
      anchors,
      mine: memory.author_id === c.get("user").id,
      author_login: authorLogins(db, [memory]).get(memory.author_id),
    });
  });

  // Deletion is the only way to withdraw a memory — the safety valve for one
  // that is wrong, misleading, or leaked something past the secret scanners.
  //
  // Author, the org's admins, or a super admin. The super-admin path skips
  // authorizeRepo deliberately: incident response must work on any tenant's
  // leaked secret, and deleting is not reading. Everyone else must still hold
  // live access to the repo — losing org membership loses the ability to delete.
  app.delete("/memories/:id", sessionOrApiKeyAuth(auth), async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const memories = new MemoryRepository(db);
    const memory = memories.getById(c.req.param("id"));
    if (!memory) return c.json({ error: "not_found" }, 404);

    if (!isSuperAdmin(user.github_login)) {
      const repoAuth = await authorizeRepo({
        db,
        user,
        fingerprint: memory.repo_fingerprint,
        config: loadConfig(),
      });
      if (isDenial(repoAuth)) return c.json({ error: "forbidden" }, 403);
      if (repoAuth.role !== "admin" && memory.author_id !== user.id) {
        return c.json({ error: "author_or_org_admin_only" }, 403);
      }
    }

    memories.delete(memory.id);
    return c.json({ id: memory.id, deleted: true });
  });
}
