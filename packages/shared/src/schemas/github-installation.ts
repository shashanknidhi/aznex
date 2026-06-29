import { z } from "zod";

export const GithubAccountTypeSchema = z.enum(["org", "user"]);
export type GithubAccountType = z.infer<typeof GithubAccountTypeSchema>;

export const GithubInstallationSchema = z.object({
  id: z.string().min(1),
  installation_id: z.number().int().positive(),
  account_type: GithubAccountTypeSchema,
  account_login: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at_epoch: z.number().int().nonnegative(),
  updated_at_epoch: z.number().int().nonnegative(),
});
export type GithubInstallation = z.infer<typeof GithubInstallationSchema>;

export const CreateGithubInstallationSchema = GithubInstallationSchema.omit({
  id: true,
  created_at_epoch: true,
  updated_at_epoch: true,
});
export type CreateGithubInstallation = z.infer<typeof CreateGithubInstallationSchema>;
