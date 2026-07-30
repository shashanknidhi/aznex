import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app.js";
import { OrgRepository } from "../repositories/org.js";
import { isSuperAdmin } from "./auth.js";

// Org-scoped RBAC. Three roles, one env-granted and two DB-granted:
//
//   super admin  — AZNEX_ADMIN_GITHUB_LOGINS; manages orgs, admins, members,
//                  repos and keys in any org. No memory-read bypass.
//   org admin    — org_membership.role = 'admin'; everything about their own org.
//   org member   — org_membership.role = 'member'; read/write their org's memory.
//
// Guards run after sessionOrApiKeyAuth, so `user` is already on the context.

export function superAdminOnly(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!isSuperAdmin(c.get("user").github_login)) {
      return c.json({ error: "super_admin_only" }, 403);
    }
    await next();
  };
}

/**
 * Resolves `:orgId` and requires the caller to hold `role` (or better) in it.
 *
 * A caller with no standing in the org gets 404, not 403: 403 would confirm the
 * org exists, letting anyone enumerate the deployment's tenants by id. Members
 * of the org get an honest 403 when they lack the role, since they already know
 * it exists.
 */
function orgGuard(minimum: "admin" | "member"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const orgId = c.req.param("orgId");
    if (!orgId) return c.json({ error: "not_found" }, 404);

    const orgs = new OrgRepository(c.get("db"));
    const org = orgs.getById(orgId);
    const login = c.get("user").github_login;
    const superAdmin = isSuperAdmin(login);
    if (!org) return c.json({ error: "not_found" }, 404);

    const role = orgs.roleFor(org.id, login);
    if (!role && !superAdmin) return c.json({ error: "not_found" }, 404);
    if (minimum === "admin" && role !== "admin" && !superAdmin) {
      return c.json({ error: "org_admin_only" }, 403);
    }

    c.set("org", org);
    // A super admin acting on an org they are not a member of still needs a role
    // on the context; 'admin' is what their management powers amount to.
    c.set("orgRole", role ?? "admin");
    await next();
  };
}

export function orgAdminOnly(): MiddlewareHandler<AppEnv> {
  return orgGuard("admin");
}

export function orgMemberOnly(): MiddlewareHandler<AppEnv> {
  return orgGuard("member");
}
