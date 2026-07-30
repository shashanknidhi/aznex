import { z } from "zod";
import type { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { GithubLoginSchema, OrgSlugSchema, OrgStatusSchema } from "@aznex/shared";
import { sessionOrApiKeyAuth, type Auth } from "../auth/session.js";
import { superAdminOnly } from "../middleware/org.js";
import { OrgRepository } from "../repositories/org.js";
import { RepoRepository } from "../repositories/repo.js";
import { addOrg } from "../admin-cli.js";

// Super admin surface (env RBAC via AZNEX_ADMIN_GITHUB_LOGINS): create orgs,
// appoint org admins, suspend a tenant. Deliberately NOT a data surface —
// reading a tenant's memory still requires org membership plus GitHub access
// (see auth/authorize.ts). Deleting a memory is the one exception, for leak
// response, and lives in routes/memories.ts.
//
// Repo and member onboarding is not here: that is the org admin's job
// (routes/orgs.ts), which a super admin can also perform through the same
// routes because the org guards accept them.

const CreateOrgBody = z.object({
  slug: OrgSlugSchema,
  name: z.string().min(1).max(120),
  admin_logins: z.array(GithubLoginSchema).min(1),
});

const UpdateOrgBody = z
  .object({ name: z.string().min(1).max(120).optional(), status: OrgStatusSchema.optional() })
  .refine((b) => b.name !== undefined || b.status !== undefined, "nothing to update");

const AdminBody = z.object({ github_login: GithubLoginSchema });

export function registerAdminRoutes(app: Hono<AppEnv>, auth: Auth | null): void {
  const guards = [sessionOrApiKeyAuth(auth), superAdminOnly()] as const;

  app.post("/admin/orgs", ...guards, async (c) => {
    const parsed = CreateOrgBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const db = c.get("db");
    if (new OrgRepository(db).getBySlug(parsed.data.slug)) {
      return c.json({ error: "slug_taken" }, 409);
    }
    const org = addOrg(db, {
      slug: parsed.data.slug,
      name: parsed.data.name,
      adminLogins: parsed.data.admin_logins,
    });
    return c.json({ id: org.id, slug: org.slug, name: org.name, status: org.status }, 201);
  });

  app.get("/admin/orgs", ...guards, (c) => {
    const db = c.get("db");
    const orgs = new OrgRepository(db);
    const repos = new RepoRepository(db);
    return c.json({
      orgs: orgs.list().map((org) => ({
        id: org.id,
        slug: org.slug,
        name: org.name,
        status: org.status,
        member_count: orgs.listMembers(org.id).length,
        repo_count: repos.listByOrgs([org.id]).filter((r) => r.status === "active").length,
        created_at_epoch: org.created_at_epoch,
      })),
    });
  });

  // Rename, suspend, or resume. Suspension takes effect on the next request:
  // authorizeRepo rejects every repo of a non-active org, so the tenant's
  // ingest, MCP and reads all stop while their data stays put.
  app.patch("/admin/orgs/:orgId", ...guards, async (c) => {
    const parsed = UpdateOrgBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const orgs = new OrgRepository(c.get("db"));
    if (!orgs.getById(c.req.param("orgId"))) return c.json({ error: "not_found" }, 404);
    const updated = orgs.update(c.req.param("orgId"), parsed.data);
    return c.json({ id: updated!.id, slug: updated!.slug, name: updated!.name, status: updated!.status });
  });

  app.post("/admin/orgs/:orgId/admins", ...guards, async (c) => {
    const parsed = AdminBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const orgs = new OrgRepository(c.get("db"));
    const org = orgs.getById(c.req.param("orgId"));
    if (!org) return c.json({ error: "not_found" }, 404);
    const member = orgs.setMember(org.id, parsed.data.github_login, "admin", c.get("user").github_login);
    return c.json({ github_login: member.github_login, role: member.role }, 201);
  });

  // Demote, not delete: a super admin removing the org's last admin would leave
  // the tenant unmanageable, so this drops them to member and refuses the last one.
  app.delete("/admin/orgs/:orgId/admins", ...guards, async (c) => {
    const parsed = AdminBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const orgs = new OrgRepository(c.get("db"));
    const org = orgs.getById(c.req.param("orgId"));
    if (!org) return c.json({ error: "not_found" }, 404);
    if (orgs.roleFor(org.id, parsed.data.github_login) !== "admin") {
      return c.json({ error: "not_an_admin" }, 404);
    }
    if (orgs.countAdmins(org.id) <= 1) return c.json({ error: "last_admin" }, 409);
    const member = orgs.setMember(org.id, parsed.data.github_login, "member");
    return c.json({ github_login: member.github_login, role: member.role });
  });
}
