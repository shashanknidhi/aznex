import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import pkg from "../../package.json" with { type: "json" };
import { loadConfig } from "../config.js";
import { githubOAuthConfigured, sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { isSuperAdmin } from "../middleware/auth.js";
import { OrgRepository } from "../repositories/org.js";

// Two small endpoints that exist so the UI can tell a misconfigured deployment
// apart from an empty one. Without them, missing OAuth credentials render as an
// inert sign-in button and a missing GitHub App renders as "no repositories" —
// both indistinguishable from working-but-empty.
export function registerMetaRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  // Unauthenticated by necessity: the sign-in page needs it *before* anyone can
  // sign in. Booleans only — never the values themselves.
  app.get("/config", (c) => {
    const config = loadConfig();
    const slug = process.env["AZNEX_GITHUB_APP_SLUG"];
    return c.json({
      version: pkg.version,
      github_oauth: githubOAuthConfigured(),
      github_app: Boolean(config.githubAppId && config.githubAppPrivateKey),
      install_url: slug ? `https://github.com/apps/${slug}/installations/new` : null,
    });
  });

  // Identity for the app shell. Deliberately does no GitHub calls — /repos does
  // one collaborator check per repo, which is far too heavy for a header that
  // renders on every route (and must still render when /repos is failing).
  app.get("/me", sessionOrApiKeyAuth(auth), (c) => {
    const user = c.get("user");
    return c.json({
      login: user.github_login,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      is_super_admin: isSuperAdmin(user.github_login),
      orgs: new OrgRepository(c.get("db")).listActiveForLogin(user.github_login).map((m) => ({
        id: m.org.id,
        slug: m.org.slug,
        name: m.org.name,
        role: m.role,
      })),
    });
  });
}
