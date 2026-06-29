import { z } from "zod";

export const RepoMemberRoleSchema = z.enum(["admin", "write", "read"]);
export type RepoMemberRole = z.infer<typeof RepoMemberRoleSchema>;

// Cached GitHub collaborator access. Synced periodically — not live-checked per request.
// PRIMARY KEY is (repo_id, user_id).
export const RepoMemberSchema = z.object({
  repo_id: z.string().min(1),
  user_id: z.string().min(1),
  github_role: RepoMemberRoleSchema,
  synced_at_epoch: z.number().int().nonnegative(),
});
export type RepoMember = z.infer<typeof RepoMemberSchema>;
