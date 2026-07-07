import type { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { apiKeyAuth } from "../middleware/auth.js";
import { UserRepository } from "../repositories/user.js";

// Browser-session auth (#22): better-auth with GitHub OAuth, backed by the
// same SQLite database (its own user/session/account/verification tables).
// The aznex `user` table stays the source of truth for authorship — a
// better-auth session is mapped to it via the github account id.

export function createAuth(db: Database, opts?: { testMode?: boolean }) {
  return betterAuth({
    database: db,
    baseURL: process.env["AZNEX_BASE_URL"] ?? "http://localhost:3000",
    basePath: "/api/auth",
    secret: process.env["BETTER_AUTH_SECRET"] ?? undefined,
    trustedOrigins: [process.env["AZNEX_FRONTEND_ORIGIN"] ?? "http://localhost:5173"],
    // Prefix better-auth tables — `user` and `session` already exist in the
    // aznex schema and mean different things.
    user: { modelName: "auth_user" },
    session: { modelName: "auth_session" },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    // testMode lets tests mint sessions without a live GitHub OAuth roundtrip.
    emailAndPassword: { enabled: opts?.testMode ?? false },
    socialProviders: {
      github: {
        clientId: process.env["GITHUB_OAUTH_CLIENT_ID"] ?? "",
        clientSecret: process.env["GITHUB_OAUTH_CLIENT_SECRET"] ?? "",
        // user.name carries the GitHub login — repo permission checks key on it.
        mapProfileToUser: (profile) => ({ name: profile.login }),
      },
    },
  });
}
export type Auth = ReturnType<typeof createAuth>;

export async function migrateAuthSchema(auth: Auth): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}

/**
 * Accepts either a Bearer API key (workers, MCP clients) or a better-auth
 * browser session cookie (frontend). Sets the aznex user on context.
 */
export function sessionOrApiKeyAuth(auth: Auth | null): MiddlewareHandler<AppEnv> {
  const bearer = apiKeyAuth();
  return async (c, next) => {
    if (c.req.header("Authorization")?.startsWith("Bearer ")) return bearer(c, next);
    if (!auth) return c.json({ error: "unauthorized" }, 401);

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthorized" }, 401);

    const db = c.get("db");
    // github account id for this better-auth user (null in email/password testMode)
    const account = db
      .prepare("SELECT accountId FROM auth_account WHERE userId = ? AND providerId = 'github'")
      .get(session.user.id) as { accountId: string } | null;
    const githubId = account?.accountId ?? `ba:${session.user.id}`;

    const users = new UserRepository(db);
    const user =
      users.getByGithubId(githubId) ??
      users.create({
        github_id: githubId,
        github_login: session.user.name,
        display_name: session.user.name,
        avatar_url: session.user.image ?? null,
        metadata: {},
      });
    c.set("user", user);
    await next();
  };
}
