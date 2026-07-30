import { z } from "zod";

export const RepoStatusSchema = z.enum(["active", "inactive"]);
export type RepoStatus = z.infer<typeof RepoStatusSchema>;

export const RepoSchema = z.object({
  id: z.string().min(1),
  // Normalized "github.com/owner/name" — lowercase, no protocol, no .git.
  // Computable locally by the worker from `git remote get-url origin`.
  fingerprint: z.string().min(1),
  canonical: z.string().min(1),          // display form "owner/name"
  github_repo_id: z.string().min(1),     // GitHub's numeric repo ID — stable across renames
  github_installation_id: z.number().int().positive(),
  // Owning tenant. Nullable only for rows written before the org migration —
  // authorizeRepo denies a repo with no org, so this is never a soft state.
  org_id: z.string().min(1).nullable().default(null),
  status: RepoStatusSchema.default("active"),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at_epoch: z.number().int().nonnegative(),
  updated_at_epoch: z.number().int().nonnegative(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const CreateRepoSchema = RepoSchema.omit({
  id: true,
  created_at_epoch: true,
  updated_at_epoch: true,
});
export type CreateRepo = z.infer<typeof CreateRepoSchema>;
