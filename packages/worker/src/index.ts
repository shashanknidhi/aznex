// @aznex/worker — local background worker
// Receives coding-agent hook payloads, compresses + extracts learnings,
// scrubs secrets client-side, and POSTs processed memory to the service.
import { startWorkerServer } from "./server.js";

export function serve(): void {
  const worker = startWorkerServer();
  console.log(`aznex worker listening on :${worker.server.port}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      console.log(`${signal} received — draining queue (${worker.queue.size} pending)`);
      await worker.stop();
      process.exit(0);
    });
  }
}

if (import.meta.main) serve();
