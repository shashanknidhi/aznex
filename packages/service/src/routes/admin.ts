import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { loadConfig } from "../config.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { isAdminGithubLogin } from "../middleware/auth.js";
import {
  resolveRepoInstallation,
  listInstallationRepos,
  verifyRepoAccess,
} from "../auth/repo-access.js";
import { addRepo } from "../admin-cli.js";
import { RepoRepository } from "../repositories/repo.js";
import type { MiddlewareHandler } from "hono";

// Admin surface (env-var RBAC): AZNEX_ADMIN_GITHUB_LOGINS lists the GitHub
// users who may onboard/de-board repos from the web UI. Every onboarding also
// requires the caller to have GitHub access to the repo itself — being an
// aznex admin doesn't grant reach into repos GitHub says you can't see.

function adminOnly(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!isAdminGithubLogin(c.get("user").github_login)) {
      return c.json({ error: "admin_only" }, 403);
    }
    await next();
  };
}

const AddRepoBody = z.object({
  fingerprint: z
    .string()
    .min(1)
    .regex(/^[^/\s]+\/[^/\s]+\/[^/\s]+$/, "expected host/owner/name"),
});

const SyncBody = z.object({ installation_id: z.number().int().positive() });

const RemoveBody = z.object({ fingerprint: z.string().min(1) });

async function callerCanAccess(
  c: { get: (k: "user" | "db") => any },
  canonical: string,
  installationId: number,
): Promise<boolean> {
  const access = await verifyRepoAccess({
    user: c.get("user"),
    // verifyRepoAccess only reads canonical + installation id from the repo.
    repo: { canonical, github_installation_id: installationId } as any,
    config: loadConfig(),
  }).catch(() => ({ allowed: false }));
  return access.allowed;
}

export function registerAdminRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  // Onboard one repo by name; ids resolved via the GitHub App.
  app.post("/admin/repos", sessionOrApiKeyAuth(auth), adminOnly(), async (c) => {
    const parsed = AddRepoBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    // Convention (schemas/repo.ts): lowercase host+owner, preserve repo-name case
    const [host, owner, ...name] = parsed.data.fingerprint.split("/");
    const fingerprint = `${host!.toLowerCase()}/${owner!.toLowerCase()}/${name.join("/")}`;
    const canonical = fingerprint.split("/").slice(1).join("/");

    try {
      const { githubRepoId, installationId } = await resolveRepoInstallation(canonical, loadConfig());
      if (!(await callerCanAccess(c, canonical, installationId))) {
        return c.json({ error: "you_do_not_have_access_to_this_repo" }, 403);
      }
      const repo = addRepo(c.get("db"), { fingerprint, githubRepoId, installationId });
      return c.json({ fingerprint: repo.fingerprint, canonical: repo.canonical }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "onboarding_failed" }, 400);
    }
  });

  // GitHub App post-install callback support: onboard every repo the owner
  // selected on GitHub's install page — filtered to repos the caller can
  // actually access (installation ids are guessable; caller access is the gate).
  app.post("/admin/installations/sync", sessionOrApiKeyAuth(auth), adminOnly(), async (c) => {
    const parsed = SyncBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

    try {
      const repos = await listInstallationRepos(parsed.data.installation_id, loadConfig());
      const onboarded: string[] = [];
      const skipped: string[] = [];
      for (const r of repos) {
        if (await callerCanAccess(c, r.canonical, parsed.data.installation_id)) {
          const [o, n] = r.canonical.split("/");
          const fingerprint = `github.com/${o!.toLowerCase()}/${n}`;
          addRepo(c.get("db"), {
            fingerprint,
            githubRepoId: r.githubRepoId,
            installationId: parsed.data.installation_id,
          });
          onboarded.push(fingerprint);
        } else {
          skipped.push(r.canonical);
        }
      }
      return c.json({ onboarded, skipped });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "sync_failed" }, 400);
    }
  });

  // De-board: soft-deactivate. Memories are preserved; reads/writes reject the
  // repo until it's onboarded again (which reactivates it).
  app.delete("/admin/repos", sessionOrApiKeyAuth(auth), adminOnly(), async (c) => {
    const parsed = RemoveBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const repos = new RepoRepository(c.get("db"));
    const repo = repos.getByFingerprint(parsed.data.fingerprint);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);
    repos.update(repo.id, { status: "inactive" });
    return c.json({ fingerprint: repo.fingerprint, status: "inactive" });
  });
}
