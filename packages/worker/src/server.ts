import { HookQueue, type HookPayload } from "./queue.js";
import { processHookPayload } from "./pipeline.js";
import { loadWorkerConfig } from "./config.js";
import { createContextHandlers, type ContextDeps } from "./context.js";
import { CONFIG_PATH } from "./config.js";
import { getSettings, updateSettings } from "./settings.js";
import { SETTINGS_PAGE } from "./settings-page.js";

export interface WorkerServer {
  server: ReturnType<typeof Bun.serve>;
  queue: HookQueue;
  stop(): Promise<void>;
}

export function startWorkerServer(opts?: {
  port?: number;
  process?: (payload: HookPayload) => Promise<void>;
  context?: ContextDeps;
}): WorkerServer {
  const queue = new HookQueue(opts?.process ?? processHookPayload);
  const context = createContextHandlers(opts?.context);

  async function contextResponse(req: Request, handler: (p: HookPayload) => Promise<object | null>) {
    const payload = (await req.json().catch(() => null)) as HookPayload | null;
    if (payload === null || typeof payload !== "object") {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    const result = await handler(payload);
    // Empty body → the hook script prints nothing and Claude Code moves on.
    return result === null ? new Response(null, { status: 200 }) : Response.json(result);
  }

  const server = Bun.serve({
    // Local capture surface only — never expose /hook to the network.
    hostname: "127.0.0.1",
    port: opts?.port ?? loadWorkerConfig().workerPort,
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
      // Synchronous read paths: the hook waits for these and relays the body.
      if (req.method === "POST" && url.pathname === "/context") {
        return contextResponse(req, context.sessionStartContext);
      }
      if (req.method === "POST" && url.pathname === "/file-context") {
        return contextResponse(req, context.fileContext);
      }
      // Local settings surface (localhost-only bind is the access control).
      const configPath = opts?.context?.configPath ?? CONFIG_PATH;
      if (req.method === "GET" && url.pathname === "/") {
        return new Response(SETTINGS_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      if (req.method === "GET" && url.pathname === "/api/settings") {
        return Response.json(getSettings(configPath));
      }
      if (req.method === "POST" && url.pathname === "/api/settings") {
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        if (body === null || typeof body !== "object") {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        return Response.json(updateSettings(body, configPath));
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
