import { z } from "zod";
import { AgentIdSchema } from "./schemas/session.js";
import {
  FreshnessStateSchema,
  MemoryTypeSchema,
  PromotionStateSchema,
} from "./schemas/memory.js";
import { MemoryAnchorSchema } from "./schemas/memory-anchor.js";

// ── Ingestion (worker → POST /v1/ingest) ─────────────────────────────────────

export const IngestSessionSchema = z.object({
  id: z.string().min(1),
  agent: AgentIdSchema,
  started_at_epoch: z.number().int().nonnegative().optional(),
  ended_at_epoch: z.number().int().nonnegative().nullable().optional(),
});
export type IngestSession = z.infer<typeof IngestSessionSchema>;

export const IngestMemorySchema = z.object({
  id: z.string().min(1),
  type: MemoryTypeSchema,
  content: z.string().min(1),
  anchors: z.array(MemoryAnchorSchema.omit({ memory_id: true })).default([]),
  ai_extracted: z.boolean(),
  confirmed_commit: z.string().nullable().optional(),
});
export type IngestMemory = z.infer<typeof IngestMemorySchema>;

export const IngestRequestSchema = z.object({
  repo_fingerprint: z.string().min(1),
  repo_canonical: z.string().min(1),
  session: IngestSessionSchema,
  memories: z.array(IngestMemorySchema),
});
export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const IngestRejectionSchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
});

export const IngestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.array(IngestRejectionSchema),
});
export type IngestResponse = z.infer<typeof IngestResponseSchema>;

// ── MCP tools (agent → service) ──────────────────────────────────────────────

export const SearchMemoryParamsSchema = z.object({
  query: z.string().min(1),
  repo_fingerprint: z.string().min(1),
  limit: z.number().int().positive().optional(),
  include_stale: z.boolean().default(false),
});
export type SearchMemoryParams = z.infer<typeof SearchMemoryParamsSchema>;

export const SearchMemoryResultSchema = z.object({
  id: z.string(),
  type: MemoryTypeSchema,
  content: z.string(),
  freshness_state: FreshnessStateSchema,
  promotion_state: PromotionStateSchema,
  anchors: z.array(z.object({ path: z.string() })),
  author_id: z.string(),
  created_at_epoch: z.number(),
});
export type SearchMemoryResult = z.infer<typeof SearchMemoryResultSchema>;

export const SearchMemoryResponseSchema = z.object({
  results: z.array(SearchMemoryResultSchema),
});
export type SearchMemoryResponse = z.infer<typeof SearchMemoryResponseSchema>;

export const GetRecentContextParamsSchema = z.object({
  repo_fingerprint: z.string().min(1),
  limit: z.number().int().positive().optional(),
});
export type GetRecentContextParams = z.infer<typeof GetRecentContextParamsSchema>;

export const GetMemoryParamsSchema = z.object({
  id: z.string().min(1),
});
export type GetMemoryParams = z.infer<typeof GetMemoryParamsSchema>;

export const GetMemoriesByPathParamsSchema = z.object({
  repo_fingerprint: z.string().min(1),
  path: z.string().min(1),
  include_stale: z.boolean().default(false),
});
export type GetMemoriesByPathParams = z.infer<typeof GetMemoriesByPathParamsSchema>;

export const ListSessionsParamsSchema = z.object({
  repo_fingerprint: z.string().min(1),
  limit: z.number().int().positive().optional(),
});
export type ListSessionsParams = z.infer<typeof ListSessionsParamsSchema>;

export const GetRecentContextResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      type: MemoryTypeSchema,
      content: z.string(),
      freshness_state: FreshnessStateSchema,
    })
  ),
});
export type GetRecentContextResponse = z.infer<typeof GetRecentContextResponseSchema>;
