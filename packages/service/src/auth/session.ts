import type { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { apiKeyAuth, loginAllowed } from "../middleware/auth.js";
import { UserRepository } from "../repositories/user.js";

// Browser-session auth (#22): better-auth with GitHub OAuth, backed by the
// same SQLite database (its own user/session/account/verification tables).
// The aznex `user` table stays the source of truth for authorship — a
// better-auth session is mapped to it via the github account id.

// Browser login needs a configured GitHub OAuth app; without one we skip the
// provider entirely (tests use email/password testMode; the bootstrap warns).
export function githubOAuthConfigured(): boolean {
  return Boolean(process.env["GITHUB_OAUTH_CLIENT_ID"] && process.env["GITHUB_OAUTH_CLIENT_SECRET"]);
}

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
    verification: { modelName: "auth_verification" },
    // testMode lets tests mint sessions without a live GitHub OAuth roundtrip.
    emailAndPassword: { enabled: opts?.testMode ?? false },
    // Implicit linking is off. better-auth defaults it ON, which means a second
    // GitHub account whose verified primary email matches an existing user is
    // folded into that user's row — silently inheriting its aznex identity, org
    // roles and super-admin status. Every gate here keys on one github_login, so
    // one aznex user must mean exactly one GitHub identity.
    account: {
      modelName: "auth_account",
      accountLinking: { disableImplicitLinking: true },
    },
    socialProviders: githubOAuthConfigured()
      ? {
          github: {
            clientId: process.env["GITHUB_OAUTH_CLIENT_ID"]!,
            clientSecret: process.env["GITHUB_OAUTH_CLIENT_SECRET"]!,
            // user.name carries the GitHub login — repo permission checks key on it.
            mapProfileToUser: (profile) => ({ name: profile.login }),
            // Refresh it on every sign-in. Otherwise a GitHub rename leaves
            // auth_user.name frozen at the old login forever, and the
            // collaborator check below asks GitHub about a name that no longer
            // exists.
            overrideUserInfoOnSignIn: true,
          },
        }
      : {},
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
    // github account id for this better-auth user (null in email/password
    // testMode). ORDER BY is not cosmetic: without it SQLite may return either
    // row when an auth user somehow has two github accounts, so the identity —
    // and therefore the authorization decision — would be non-deterministic.
    // Oldest wins, so a verdict never flips between requests.
    const account = db
      .prepare(
        `SELECT accountId FROM auth_account
          WHERE userId = ? AND providerId = 'github'
          ORDER BY createdAt ASC, accountId ASC
          LIMIT 1`,
      )
      .get(session.user.id) as { accountId: string } | null;
    const githubId = account?.accountId ?? `ba:${session.user.id}`;

    const users = new UserRepository(db);
    let user =
      users.getByGithubId(githubId) ??
      users.create({
        github_id: githubId,
        github_login: session.user.name,
        display_name: session.user.name,
        avatar_url: session.user.image ?? null,
        metadata: {},
      });
    // github_login used to be write-once, so a GitHub rename left every gate
    // below asking about a login that no longer exists — denying access the
    // account has, and honouring memberships and allowlist entries it no longer
    // matches. github_id is the stable key; the login is a mutable label.
    if (session.user.name && session.user.name !== user.github_login) {
      console.warn(`[auth] github_login changed for ${user.id}: ${user.github_login} → ${session.user.name}`);
      user = users.update(user.id, { github_login: session.user.name, display_name: session.user.name }) ?? user;
    }
    // The aznex user row is created above before this gate runs, on purpose: an
    // uninvited login still 403s, and the row is what a later org invite binds to.
    if (!loginAllowed(db, user.github_login)) {
      return c.json({ error: "github_login_not_allowed" }, 403);
    }
    c.set("user", user);
    await next();
  };
}
