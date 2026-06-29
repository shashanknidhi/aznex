import { z } from "zod";

export const ApiKeyStatusSchema = z.enum(["active", "revoked"]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

// User-scoped (not repo-scoped). Access to a specific repo is verified against
// repo_members at request time — a single key works across all repos the user can access.
export const ApiKeySchema = z.object({
  id: z.string().min(1),
  user_id: z.string().min(1),
  name: z.string().min(1),     // human label, e.g. "my laptop worker"
  key_hash: z.string().min(1), // stored hashed — never the plain key
  prefix: z.string().nullable().default(null),   // e.g. "axk_" for display
  scopes: z.array(z.string()).default([]),        // e.g. ['ingest', 'read']
  status: ApiKeyStatusSchema.default("active"),
  last_used_at_epoch: z.number().int().nonnegative().nullable().default(null),
  expires_at_epoch: z.number().int().nonnegative().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at_epoch: z.number().int().nonnegative(),
  updated_at_epoch: z.number().int().nonnegative(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

export const CreateApiKeySchema = ApiKeySchema.omit({
  id: true,
  created_at_epoch: true,
  updated_at_epoch: true,
});
export type CreateApiKey = z.infer<typeof CreateApiKeySchema>;
