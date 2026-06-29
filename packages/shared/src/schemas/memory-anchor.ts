import { z } from "zod";

// Staleness primitive. Anchors a memory to a file path + commit SHA so the
// staleness engine can flag the memory when the anchored code changes.
// PRIMARY KEY is (memory_id, path).
export const MemoryAnchorSchema = z.object({
  memory_id: z.string().min(1),
  path: z.string().min(1),         // repo-relative file path
  commit_sha: z.string().nullable().default(null),
});
export type MemoryAnchor = z.infer<typeof MemoryAnchorSchema>;
