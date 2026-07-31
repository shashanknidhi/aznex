import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { GithubLoginSchema, OrgRoleSchema } from "@aznex/shared";
import { loadConfig } from "../config.js";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { orgAdminOnly, orgMemberOnly } from "../middleware/org.js";
import { isSuperAdmin } from "../middleware/auth.js";
import {
  listInstallationRepos,
  resolveRepoInstallation,
  verifyRepoAccess,
  type RepoAccess,
} from "../auth/repo-access.js";
import { OrgRepository } from "../repositories/org.js";
import { RepoRepository } from "../repositories/repo.js";
import { ApiKeyRepository } from "../repositories/api-key.js";
import { UserRepository } from "../repositories/user.js";
import { addRepo, RepoOwnedByAnotherOrgError } from "../admin-cli.js";

// Org admin surface: everything about one tenant — its members, their API keys,
// and its repos. Replaces the global env allowlist and the single global
// operator, so onboarding a new pilot company is one super-admin call followed
// by self-service.
//
// Every repo action still requires the *caller's own* GitHub access to that
// repo. Being an org admin (or super admin) is never a substitute — it decides
// which tenant you may act on, not which repos GitHub lets you see.

const MemberBody = z.object({ github_login: GithubLoginSchema, role: OrgRoleSchema.default("member") });
const RoleBody = z.object({ role: OrgRoleSchema });
const RepoBody = z.object({
  fingerprint: z.string().min(1).regex(/^[^/\s]+\/[^/\s]+\/[^/\s]+$/, "expected host/owner/name"),
});
const SyncBody = z.object({ installation_id: z.number().int().positive() });

// Why a repo in the installation was not onboarded. "Skipped" alone sent people
// hunting for a GitHub permissions problem they did not have.
export type SkippedRepo =
  | { canonical: string; reason: "no_github_access"; checked_login: string }
  | { canonical: string; reason: "app_missing_members_permission"; org_login: string }
  | { canonical: string; reason: "owned_by_another_org"; owner_org_name: string | null }
  | { canonical: string; reason: "error"; detail: string };

// Convention (schemas/repo.ts): lowercase host+owner, preserve repo-name case.
function normalizeFingerprint(raw: string): { fingerprint: string; canonical: string } {
  const [host, owner, ...name] = raw.split("/");
  const fingerprint = `${host!.toLowerCase()}/${owner!.toLowerCase()}/${name.join("/")}`;
  return { fingerprint, canonical: fingerprint.split("/").slice(1).join("/") };
}

async function callerCanAccess(
  c: { get: (k: "user") => any },
  canonical: string,
  installationId: number,
): Promise<RepoAccess> {
  return await verifyRepoAccess({
    user: c.get("user"),
    // verifyRepoAccess only reads canonical + installation id from the repo.
    repo: { canonical, github_installation_id: installationId } as any,
    config: loadConfig(),
  }).catch((): RepoAccess => ({ allowed: false, reason: "github_error" }));
}

export function registerOrgRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  const authed = sessionOrApiKeyAuth(auth);

  // ── Membership ────────────────────────────────────────────────────────────

  app.get("/orgs", authed, (c) => {
    const user = c.get("user");
    return c.json({
      orgs: new OrgRepository(c.get("db")).listActiveForLogin(user.github_login).map((m) => ({
        id: m.org.id,
        slug: m.org.slug,
        name: m.org.name,
        role: m.role,
      })),
      is_super_admin: isSuperAdmin(user.github_login),
    });
  });

  app.get("/orgs/:orgId", authed, orgMemberOnly(), (c) => {
    const org = c.get("org");
    const db = c.get("db");
    return c.json({
      id: org.id,
      slug: org.slug,
      name: org.name,
      status: org.status,
      role: c.get("orgRole"),
      member_count: new OrgRepository(db).listMembers(org.id).length,
      repo_count: new RepoRepository(db).listByOrgs([org.id]).filter((r) => r.status === "active").length,
    });
  });

  app.get("/orgs/:orgId/members", authed, orgMemberOnly(), (c) => {
    const db = c.get("db");
    const users = new UserRepository(db);
    return c.json({
      members: new OrgRepository(db).listMembers(c.get("org").id).map((m) => ({
        github_login: m.github_login,
        role: m.role,
        invited_by_login: m.invited_by_login,
        created_at_epoch: m.created_at_epoch,
        // null until they sign in for the first time — an invite is allowed to
        // precede the account.
        signed_in: users.getByGithubLogin(m.github_login) !== null,
      })),
    });
  });

  app.post("/orgs/:orgId/members", authed, orgAdminOnly(), async (c) => {
    const parsed = MemberBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const orgs = new OrgRepository(c.get("db"));
    const member = orgs.setMember(
      c.get("org").id,
      parsed.data.github_login,
      parsed.data.role,
      c.get("user").github_login,
    );
    return c.json({ github_login: member.github_login, role: member.role }, 201);
  });

  app.patch("/orgs/:orgId/members/:login", authed, orgAdminOnly(), async (c) => {
    const parsed = RoleBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const orgs = new OrgRepository(c.get("db"));
    const org = c.get("org");
    const login = c.req.param("login");
    const current = orgs.roleFor(org.id, login);
    if (!current) return c.json({ error: "not_found" }, 404);
    // Demoting the last admin would leave the org unmanageable.
    if (current === "admin" && parsed.data.role !== "admin" && orgs.countAdmins(org.id) <= 1) {
      return c.json({ error: "last_admin" }, 409);
    }
    const member = orgs.setMember(org.id, login, parsed.data.role);
    return c.json({ github_login: member.github_login, role: member.role });
  });

  // Removal cuts this org's data access on the next request (authorizeRepo
  // requires a membership row) without touching anything they authored —
  // memories are the team's, and deletion is a separate, explicit act.
  //
  // Their API keys are deliberately NOT revoked: the same key may serve another
  // org. Use the key routes below when the key itself should die.
  app.delete("/orgs/:orgId/members/:login", authed, orgAdminOnly(), (c) => {
    const orgs = new OrgRepository(c.get("db"));
    const org = c.get("org");
    const login = c.req.param("login");
    const current = orgs.roleFor(org.id, login);
    if (!current) return c.json({ error: "not_found" }, 404);
    if (current === "admin" && orgs.countAdmins(org.id) <= 1) {
      return c.json({ error: "last_admin" }, 409);
    }
    orgs.removeMember(org.id, login);
    return c.json({ github_login: login, removed: true });
  });

  // ── Member API keys ───────────────────────────────────────────────────────
  // Metadata only — plaintext tokens exist exactly once, at mint time.

  app.get("/orgs/:orgId/keys", authed, orgAdminOnly(), (c) => {
    const db = c.get("db");
    const users = new UserRepository(db);
    const keys = new ApiKeyRepository(db);
    const out = [];
    for (const member of new OrgRepository(db).listMembers(c.get("org").id)) {
      const user = users.getByGithubLogin(member.github_login);
      if (!user) continue;
      for (const key of keys.listByUser(user.id)) {
        out.push({
          id: key.id,
          github_login: member.github_login,
          name: key.name,
          prefix: key.prefix,
          status: key.status,
          created_at_epoch: key.created_at_epoch,
          last_used_at_epoch: key.last_used_at_epoch,
        });
      }
    }
    return c.json({ keys: out });
  });

  app.post("/orgs/:orgId/keys/:keyId/revoke", authed, orgAdminOnly(), (c) => {
    const db = c.get("db");
    const keys = new ApiKeyRepository(db);
    const key = keys.getById(c.req.param("keyId"));
    if (!key) return c.json({ error: "not_found" }, 404);
    // The key must belong to a member of *this* org — otherwise an org admin
    // could revoke another tenant's worker by guessing a key id.
    const owner = new UserRepository(db).getById(key.user_id);
    if (!owner || !new OrgRepository(db).getMember(c.get("org").id, owner.github_login)) {
      return c.json({ error: "not_found" }, 404);
    }
    keys.revoke(key.id);
    return c.json({ id: key.id, status: "revoked" });
  });

  // ── Repos ─────────────────────────────────────────────────────────────────

  app.get("/orgs/:orgId/repos", authed, orgMemberOnly(), (c) => {
    const repos = new RepoRepository(c.get("db")).listByOrgs([c.get("org").id]);
    return c.json({
      repos: repos.map((r) => ({
        fingerprint: r.fingerprint,
        canonical: r.canonical,
        status: r.status,
        created_at_epoch: r.created_at_epoch,
      })),
    });
  });

  // Onboard one repo by name; ids resolved via the GitHub App.
  app.post("/orgs/:orgId/repos", authed, orgAdminOnly(), async (c) => {
    const parsed = RepoBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const { fingerprint, canonical } = normalizeFingerprint(parsed.data.fingerprint);

    try {
      const { githubRepoId, installationId } = await resolveRepoInstallation(canonical, loadConfig());
      const access = await callerCanAccess(c, canonical, installationId);
      if (!access.allowed) {
        // A misconfigured App is the org admin's problem to fix, not a verdict
        // on the caller — saying "you have no access" sends them to GitHub to
        // check a collaborator list that was already correct.
        if (access.reason === "app_missing_members_permission") {
          return c.json({ error: "app_missing_members_permission", org_login: access.orgLogin }, 403);
        }
        return c.json({ error: "you_do_not_have_access_to_this_repo" }, 403);
      }
      const repo = addRepo(c.get("db"), {
        fingerprint,
        githubRepoId,
        installationId,
        orgId: c.get("org").id,
      });
      return c.json({ fingerprint: repo.fingerprint, canonical: repo.canonical }, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "onboarding_failed" }, 400);
    }
  });

  // GitHub App post-install callback support: onboard every repo the owner
  // selected on GitHub's install page — filtered to repos the caller can
  // actually access (installation ids are guessable; caller access is the gate).
  app.post("/orgs/:orgId/installations/sync", authed, orgAdminOnly(), async (c) => {
    const parsed = SyncBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);

    const db = c.get("db");
    const login = c.get("user").github_login;
    try {
      const found = await listInstallationRepos(parsed.data.installation_id, loadConfig());
      const onboarded: string[] = [];
      const skipped: SkippedRepo[] = [];
      for (const r of found) {
        const access = await callerCanAccess(c, r.canonical, parsed.data.installation_id);
        if (!access.allowed) {
          if (access.reason === "app_missing_members_permission") {
            console.warn(`[sync] skip ${r.canonical}: installation lacks the 'members' permission`);
            skipped.push({
              canonical: r.canonical,
              reason: "app_missing_members_permission",
              org_login: access.orgLogin ?? r.canonical.split("/")[0]!,
            });
          } else {
            console.warn(`[sync] skip ${r.canonical}: GitHub does not list ${login} as a collaborator`);
            skipped.push({ canonical: r.canonical, reason: "no_github_access", checked_login: login });
          }
          continue;
        }
        // Same normalizer as the single-repo route: lowercase host+owner, keep
        // the repo name's case. Hand-rolling it here once dropped the owner
        // lowercasing out of step with getByFingerprint's exact match.
        const { fingerprint } = normalizeFingerprint(`github.com/${r.canonical}`);
        try {
          addRepo(db, {
            fingerprint,
            githubRepoId: r.githubRepoId,
            installationId: parsed.data.installation_id,
            orgId: c.get("org").id,
          });
          onboarded.push(fingerprint);
        } catch (err) {
          // Two very different failures used to land here as one opaque
          // "skipped", and the UI blamed the user's GitHub access for both.
          if (err instanceof RepoOwnedByAnotherOrgError) {
            const owner = new OrgRepository(db).getById(err.ownerOrgId);
            console.warn(`[sync] skip ${r.canonical}: already owned by org ${owner?.slug ?? err.ownerOrgId}`);
            skipped.push({
              canonical: r.canonical,
              reason: "owned_by_another_org",
              owner_org_name: owner?.name ?? null,
            });
          } else {
            console.error(`[sync] skip ${r.canonical}: unexpected error`, err);
            skipped.push({
              canonical: r.canonical,
              reason: "error",
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      return c.json({ onboarded, skipped });
    } catch (err) {
      console.error(`[sync] installation ${parsed.data.installation_id} failed`, err);
      return c.json({ error: err instanceof Error ? err.message : "sync_failed" }, 400);
    }
  });

  // De-board: soft-deactivate. Memories are preserved; reads/writes reject the
  // repo until it's onboarded again (which reactivates it).
  app.delete("/orgs/:orgId/repos", authed, orgAdminOnly(), async (c) => {
    const parsed = RepoBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const repos = new RepoRepository(c.get("db"));
    const repo = repos.getByFingerprint(normalizeFingerprint(parsed.data.fingerprint).fingerprint);
    // Not this org's repo: 404, never "exists but not yours".
    if (!repo || repo.org_id !== c.get("org").id) return c.json({ error: "not_found" }, 404);
    repos.update(repo.id, { status: "inactive" });
    return c.json({ fingerprint: repo.fingerprint, status: "inactive" });
  });
}
