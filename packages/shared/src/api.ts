import { z } from "zod";
import { AgentIdSchema } from "./schemas/session.js";
import { MemoryTypeSchema } from "./schemas/memory.js";

// One page of memories. Shared so the service and the frontend cannot disagree
// about page count — the frontend used to hardcode this in four places.
export const MEMORIES_PAGE_SIZE = 20;

// ── Ingestion (worker → POST /v1/ingest) ─────────────────────────────────────

export const IngestSessionSchema = z.object({
  id: z.string().min(1),
  agent: AgentIdSchema,
  started_at_epoch: z.number().int().nonnegative().optional(),
  ended_at_epoch: z.number().int().nonnegative().nullable().optional(),
});
export type IngestSession = z.infer<typeof IngestSessionSchema>;

// Everything the extractor produces crosses the wire — the memory table (and its
// FTS index) covers title/narrative/facts/concepts, so dropping them here made
// four of the five searchable columns permanently empty. Path anchors are derived
// server-side from files_read ∪ files_modified rather than sent twice.
// Defaulted fields keep older workers accepted.
export const IngestMemorySchema = z.object({
  id: z.string().min(1),
  type: MemoryTypeSchema,
  title: z.string().nullable().default(null),
  content: z.string().min(1),
  narrative: z.string().nullable().default(null),
  facts: z.array(z.string()).default([]),
  concepts: z.array(z.string()).default([]),
  files_read: z.array(z.string()).default([]),
  files_modified: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  ai_extracted: z.boolean(),
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
});
export type SearchMemoryParams = z.infer<typeof SearchMemoryParamsSchema>;

export const SearchMemoryResultSchema = z.object({
  id: z.string(),
  type: MemoryTypeSchema,
  title: z.string().nullable(),
  content: z.string(),
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
    })
  ),
});
export type GetRecentContextResponse = z.infer<typeof GetRecentContextResponseSchema>;
