import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { UserRepository } from "../repositories/user.js";

// API keys are stored hashed — we only ever persist and look up sha256(plaintext).
export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

// Deployment-level allowlist (pilot gate). AZNEX_ALLOWED_GITHUB_LOGINS is a
// comma-separated list of GitHub usernames; unset/empty means open (the
// self-host default — per-repo GitHub verification still gates all data).
export function isAdminGithubLogin(login: string): boolean {
  const raw = process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
  if (!raw?.trim()) return false; // no admins configured = no admin surface
  return raw
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .includes(login.toLowerCase());
}

export function githubLoginAllowed(login: string): boolean {
  const raw = process.env["AZNEX_ALLOWED_GITHUB_LOGINS"];
  if (!raw?.trim()) return true;
  return raw
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .includes(login.toLowerCase());
}

// Validates `Authorization: Bearer <token>` against the api_key table and attaches
// the resolved user to the context. On any failure returns a flat 401 that never
// reveals which check failed (missing header, bad key, expired, revoked, no user).
export function apiKeyAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const unauthorized = () => c.json({ error: "unauthorized" }, 401);

    const header = c.req.header("Authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/);
    if (!match) return unauthorized();

    const db = c.get("db");
    const key = new ApiKeyRepository(db).getByHash(hashToken(match[1]!));
    if (!key || key.status !== "active") return unauthorized();
    if (key.expires_at_epoch != null && key.expires_at_epoch <= Date.now()) return unauthorized();

    const user = new UserRepository(db).getById(key.user_id);
    if (!user) return unauthorized();

    if (!githubLoginAllowed(user.github_login)) {
      return c.json({ error: "github_login_not_allowed" }, 403);
    }

    new ApiKeyRepository(db).touchLastUsed(key.id, Date.now());
    c.set("user", user);
    await next();
  };
}
