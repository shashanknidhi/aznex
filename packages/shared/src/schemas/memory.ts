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

// Every ingested memory is visible to the whole repo. There is no promotion or
// freshness state — deletion is the only way to withdraw a memory.
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
  ai_extracted: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at_epoch: z.number().int().nonnegative(),
  updated_at_epoch: z.number().int().nonnegative(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const CreateMemorySchema = MemorySchema.omit({
  created_at_epoch: true,
  updated_at_epoch: true,
});
export type CreateMemory = z.infer<typeof CreateMemorySchema>;
