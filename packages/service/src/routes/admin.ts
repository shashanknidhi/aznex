import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { isAdminGithubLogin } from "../middleware/auth.js";
import { resolveRepoInstallation } from "../auth/repo-access.js";
import { addRepo } from "../admin-cli.js";

// Admin surface (env-var RBAC): AZNEX_ADMIN_GITHUB_LOGINS lists the GitHub
// users who may onboard repos from the web UI — replacing `railway ssh` as
// the day-to-day admin path. Admins supply only "github.com/owner/name";
// the repo id and installation id are resolved via the GitHub App.

const AddRepoBody = z.object({
  fingerprint: z
    .string()
    .min(1)
    .regex(/^[^/\s]+\/[^/\s]+\/[^/\s]+$/, "expected host/owner/name"),
});

export function registerAdminRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  app.post("/admin/repos", sessionOrApiKeyAuth(auth), async (c) => {
    if (!isAdminGithubLogin(c.get("user").github_login)) {
      return c.json({ error: "admin_only" }, 403);
    }
    const parsed = AddRepoBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    // Convention (schemas/repo.ts): lowercase host+owner, preserve repo-name case
    const [host, owner, ...name] = parsed.data.fingerprint.split("/");
    const fingerprint = `${host!.toLowerCase()}/${owner!.toLowerCase()}/${name.join("/")}`;
    const canonical = fingerprint.split("/").slice(1).join("/");

    try {
      const { githubRepoId, installationId } = await resolveRepoInstallation(canonical, loadConfig());
      const repo = addRepo(c.get("db"), { fingerprint, githubRepoId, installationId });
      return c.json({ fingerprint: repo.fingerprint, canonical: repo.canonical }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "onboarding_failed" }, 400);
    }
  });
}
