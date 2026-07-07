import type { HookPayload } from "./queue.js";

// Pipeline stages (#16): compress → extract → scrub → POST.
// Stubs for now — filled in by #18 (compress), #19 (extract), #20 (scrub),
// #21 (ingest POST). The queue only ever calls processHookPayload.
export async function processHookPayload(payload: HookPayload): Promise<void> {
  void payload;
}
