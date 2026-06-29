import { z } from "zod";

export const AgentEventSourceTypeSchema = z.enum([
  "hook",
  "worker",
  "provider",
  "server",
  "api",
]);
export type AgentEventSourceType = z.infer<typeof AgentEventSourceTypeSchema>;

export const AgentEventSchema = z.object({
  id: z.string().min(1),
  repo_fingerprint: z.string().min(1),
  session_id: z.string().min(1).nullable().default(null),
  source_type: AgentEventSourceTypeSchema,
  event_type: z.string().min(1),
  payload: z.unknown().default({}),
  idempotency_key: z.string().min(1),  // for safe worker retries
  occurred_at_epoch: z.number().int().nonnegative(),
  created_at_epoch: z.number().int().nonnegative(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const CreateAgentEventSchema = AgentEventSchema.omit({
  created_at_epoch: true,
});
export type CreateAgentEvent = z.infer<typeof CreateAgentEventSchema>;
