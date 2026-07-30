import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { verifyRepoAccess } from "../auth/repo-access.js";
import { RepoRepository } from "../repositories/repo.js";
import { OrgRepository } from "../repositories/org.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { isSuperAdmin } from "../middleware/auth.js";

// Repo selector data (#22): the onboarded repos this user can actually read.
// Candidates are narrowed to the caller's active orgs *before* any GitHub call,
// so the per-page-load fanout is O(their orgs' repos) rather than O(every repo
// on the deployment) — the /api/repos item in #50.
export function registerRepoRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  app.get("/repos", sessionOrApiKeyAuth(auth), async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const config = loadConfig();

    const memberships = new OrgRepository(db).listActiveForLogin(user.github_login);
    const repos = new RepoRepository(db)
      .listByOrgs(memberships.map((m) => m.org.id))
      .filter((r) => r.status === "active");

    const accessible = [];
    for (const repo of repos) {
      const access = await verifyRepoAccess({ user, repo, config }).catch(() => ({ allowed: false }));
      if (access.allowed) {
        accessible.push({
          fingerprint: repo.fingerprint,
          canonical: repo.canonical,
          org_id: repo.org_id,
        });
      }
    }
    return c.json({
      repos: accessible,
      orgs: memberships.map((m) => ({
        id: m.org.id,
        slug: m.org.slug,
        name: m.org.name,
        role: m.role,
      })),
      user: {
        login: user.github_login,
        display_name: user.display_name,
        is_super_admin: isSuperAdmin(user.github_login),
      },
      // GitHub's own install/select-repos page (org admins onboard from there).
      github_app_install_url: process.env["AZNEX_GITHUB_APP_SLUG"]
        ? `https://github.com/apps/${process.env["AZNEX_GITHUB_APP_SLUG"]}/installations/new`
        : null,
    });
  });
}
