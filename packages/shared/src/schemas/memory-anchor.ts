import { z } from "zod";

// Path anchor. Ties a memory to the files it is about so agents can ask
// "what does the team know about this file?". PRIMARY KEY is (memory_id, path).
export const MemoryAnchorSchema = z.object({
  memory_id: z.string().min(1),
  path: z.string().min(1),         // repo-relative file path
});
export type MemoryAnchor = z.infer<typeof MemoryAnchorSchema>;
