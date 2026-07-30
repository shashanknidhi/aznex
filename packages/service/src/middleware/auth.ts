import type { Database } from "bun:sqlite";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { OrgRepository } from "../repositories/org.js";
import { UserRepository } from "../repositories/user.js";

// API keys are stored hashed — we only ever persist and look up sha256(plaintext).
export function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

// Deployment operators. AZNEX_ADMIN_GITHUB_LOGINS is a comma-separated list of
// GitHub usernames who may create orgs and appoint org admins. Env-based on
// purpose: it is the one role that cannot be granted through the API, so a
// compromised org admin can never escalate to it.
export function isSuperAdmin(login: string): boolean {
  const raw = process.env["AZNEX_ADMIN_GITHUB_LOGINS"];
  if (!raw?.trim()) return false; // no admins configured = no admin surface
  return raw
    .split(",")
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean)
    .includes(login.toLowerCase());
}

// Sign-in gate. Replaces the AZNEX_ALLOWED_GITHUB_LOGINS env allowlist, which
// needed a redeploy per new pilot-org member: membership in any active org is
// now the credential, and org admins manage that themselves. Repo-level
// authorization is still authorizeRepo's job — this only decides who may hold
// a session at all.
export function loginAllowed(db: Database, login: string): boolean {
  if (isSuperAdmin(login)) return true;
  return new OrgRepository(db).listActiveForLogin(login).length > 0;
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

    if (!loginAllowed(db, user.github_login)) {
      return c.json({ error: "github_login_not_allowed" }, 403);
    }

    new ApiKeyRepository(db).touchLastUsed(key.id, Date.now());
    c.set("user", user);
    await next();
  };
}
