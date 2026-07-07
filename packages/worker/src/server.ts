import { HookQueue, type HookPayload } from "./queue.js";
import { processHookPayload } from "./pipeline.js";

export interface WorkerServer {
  server: ReturnType<typeof Bun.serve>;
  queue: HookQueue;
  stop(): Promise<void>;
}

export function startWorkerServer(opts?: {
  port?: number;
  process?: (payload: HookPayload) => Promise<void>;
}): WorkerServer {
  const queue = new HookQueue(opts?.process ?? processHookPayload);

  const server = Bun.serve({
    port: opts?.port ?? Number(process.env["AZNEX_WORKER_PORT"] ?? 3001),
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/health") {
        return Response.json({ ok: true, queued: queue.size });
      }
      if (req.method === "POST" && url.pathname === "/hook") {
        const payload = (await req.json().catch(() => null)) as HookPayload | null;
        if (payload === null || typeof payload !== "object") {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        queue.enqueue(payload); // synchronous — response goes out before any processing
        return Response.json({ queued: true });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });

  return {
    server,
    queue,
    // Graceful shutdown: stop accepting hooks, then drain what's queued.
    async stop() {
      server.stop();
      await queue.flush();
    },
  };
}
