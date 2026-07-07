import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { ApiKeyRepository } from "../repositories/api-key.js";

// Self-service API key management: every user sees and revokes only their
// own keys (setup mints a fresh key per browser-auth run, so stale ones
// accumulate). Revocation is permanent per the data lifecycle — a revoked
// worker just re-runs setup.
export function registerKeyRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  app.get("/keys", sessionOrApiKeyAuth(auth), (c) => {
    const keys = new ApiKeyRepository(c.get("db")).listByUser(c.get("user").id);
    return c.json({
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        status: k.status,
        created_at_epoch: k.created_at_epoch,
        last_used_at_epoch: k.last_used_at_epoch,
      })),
    });
  });

  app.post("/keys/:id/revoke", sessionOrApiKeyAuth(auth), (c) => {
    const repo = new ApiKeyRepository(c.get("db"));
    const key = repo.getById(c.req.param("id"));
    if (!key || key.user_id !== c.get("user").id) return c.json({ error: "not_found" }, 404);
    repo.revoke(key.id);
    return c.json({ id: key.id, status: "revoked" });
  });
}
