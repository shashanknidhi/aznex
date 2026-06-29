import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().min(1),
  github_id: z.string().min(1),     // GitHub's numeric user ID — stable across login renames
  github_login: z.string().min(1),  // GitHub username — display only, can change
  display_name: z.string().nullable().default(null),
  avatar_url: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at_epoch: z.number().int().nonnegative(),
  updated_at_epoch: z.number().int().nonnegative(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = UserSchema.omit({
  id: true,
  created_at_epoch: true,
  updated_at_epoch: true,
});
export type CreateUser = z.infer<typeof CreateUserSchema>;
