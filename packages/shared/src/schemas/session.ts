import { z } from "zod";

export const AgentIdSchema = z.union([
  z.enum(["claude-code", "codex", "opencode"]),
  z.string().min(1),
]);
export type AgentId = z.infer<typeof AgentIdSchema>;

export const SessionStatusSchema = z.enum(["active", "completed", "failed"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  id: z.string().min(1),  // client-supplied idempotency key
  repo_fingerprint: z.string().min(1),
  repo_canonical: z.string().min(1),
  author_id: z.string().min(1),
  agent: AgentIdSchema,
  platform_source: z.string().min(1).default("claude-code"),
  status: SessionStatusSchema.default("active"),
  metadata: z.record(z.string(), z.unknown()).default({}),
  started_at_epoch: z.number().int().nonnegative(),
  ended_at_epoch: z.number().int().nonnegative().nullable().default(null),
  created_at_epoch: z.number().int().nonnegative(),
  updated_at_epoch: z.number().int().nonnegative(),
});
export type Session = z.infer<typeof SessionSchema>;

export const CreateSessionSchema = SessionSchema.omit({
  created_at_epoch: true,
  updated_at_epoch: true,
});
export type CreateSession = z.infer<typeof CreateSessionSchema>;
