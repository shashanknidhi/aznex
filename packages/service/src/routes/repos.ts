import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { verifyRepoAccess } from "../auth/repo-access.js";
import { RepoRepository } from "../repositories/repo.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { isAdminGithubLogin } from "../middleware/auth.js";

// Repo selector data (#22): the onboarded repos this user can actually read.
// ponytail: checks access repo-by-repo (results are TTL-cached); paginate or
// batch only if an org onboards hundreds of repos.
export function registerRepoRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  app.get("/repos", sessionOrApiKeyAuth(auth), async (c) => {
    const db = c.get("db");
    const user = c.get("user");
    const config = loadConfig();
    const repos = new RepoRepository(db).list();
    const accessible = [];
    for (const repo of repos) {
      const access = await verifyRepoAccess({ user, repo, config }).catch(() => ({ allowed: false }));
      if (access.allowed) {
        accessible.push({ fingerprint: repo.fingerprint, canonical: repo.canonical });
      }
    }
    return c.json({
      repos: accessible,
      user: {
        login: user.github_login,
        display_name: user.display_name,
        is_admin: isAdminGithubLogin(user.github_login),
      },
    });
  });
}
