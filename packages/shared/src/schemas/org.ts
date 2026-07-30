import { z } from "zod";

// An org is a tenant: one company on a shared Aznex deployment. Repos belong to
// exactly one org (`repo.org_id`), and every request for a repo's memory needs
// both an org membership row and GitHub access to the repo itself.

export const OrgStatusSchema = z.enum(["active", "suspended"]);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

// Lowercase, url-safe: it appears in admin paths and is the human handle.
export const OrgSlugSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "expected lowercase letters, digits and dashes");

export const OrgSchema = z.object({
  id: z.string().min(1),
  slug: OrgSlugSchema,
  name: z.string().min(1).max(120),
  status: OrgStatusSchema.default("active"),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at_epoch: z.number().int().nonnegative(),
  updated_at_epoch: z.number().int().nonnegative(),
});
export type Org = z.infer<typeof OrgSchema>;

export const CreateOrgSchema = OrgSchema.omit({
  id: true,
  created_at_epoch: true,
  updated_at_epoch: true,
});
export type CreateOrg = z.infer<typeof CreateOrgSchema>;

export const OrgRoleSchema = z.enum(["admin", "member"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

// Membership is keyed by GitHub login, not user_id: an org admin invites people
// who have never signed in. The login binds to a `user` row lazily on first login.
export const GithubLoginSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/, "expected a GitHub login");

export const OrgMembershipSchema = z.object({
  org_id: z.string().min(1),
  github_login: z.string().min(1), // stored lowercase
  role: OrgRoleSchema,
  invited_by_login: z.string().nullable().default(null),
  created_at_epoch: z.number().int().nonnegative(),
  updated_at_epoch: z.number().int().nonnegative(),
});
export type OrgMembership = z.infer<typeof OrgMembershipSchema>;
