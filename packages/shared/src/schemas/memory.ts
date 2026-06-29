import { z } from "zod";
import { AgentIdSchema } from "./session.js";

export const MemoryKindSchema = z.enum(["observation", "summary", "manual"]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

export const MemoryTypeSchema = z.enum([
  "raw_observation",
  "extracted_learning",
  "summary",
  "negative_result",
  "decision",
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const FreshnessStateSchema = z.enum(["fresh", "stale_suspected"]);
export type FreshnessState = z.infer<typeof FreshnessStateSchema>;

export const PromotionStateSchema = z.enum(["private", "pending", "team_shared"]);
export type PromotionState = z.infer<typeof PromotionStateSchema>;

export const MemorySchema = z.object({
  id: z.string().min(1),
  repo_fingerprint: z.string().min(1),
  session_id: z.string().min(1).nullable().default(null),
  author_id: z.string().min(1),
  agent: AgentIdSchema,
  kind: MemoryKindSchema,
  type: MemoryTypeSchema,
  title: z.string().nullable().default(null),
  content: z.string().min(1),  // post-scrub main text
  narrative: z.string().nullable().default(null),
  facts: z.array(z.string()).default([]),
  concepts: z.array(z.string()).default([]),
  files_read: z.array(z.string()).default([]),
  files_modified: z.array(z.string()).default([]),
  freshness_state: FreshnessStateSchema.default("fresh"),
  promotion_state: PromotionStateSchema.default("private"),
  confirmed_commit: z.string().nullable().default(null),
  ai_extracted: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at_epoch: z.number().int().nonnegative(),
  updated_at_epoch: z.number().int().nonnegative(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const CreateMemorySchema = MemorySchema.omit({
  freshness_state: true,
  promotion_state: true,
  created_at_epoch: true,
  updated_at_epoch: true,
});
export type CreateMemory = z.infer<typeof CreateMemorySchema>;
