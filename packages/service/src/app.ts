import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { User } from "@aznex/shared";
import pkg from "../package.json" with { type: "json" };
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerRepoRoutes } from "./routes/repos.js";
import type { Auth } from "./auth/session.js";

// Context shared across all handlers. `user` is set by the auth middleware (#10).
export interface AppEnv {
  Variables: {
    db: Database;
    user: User;
  };
}

export function createApp(db: Database, opts?: { auth?: Auth }): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = opts?.auth ?? null;

  // Make the DB available to every handler without a module-level singleton.
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true, version: pkg.version }));

  // Route groups — handlers registered by their respective issues.
  const v1 = new Hono<AppEnv>();
  registerIngestRoutes(v1); // #12 POST /v1/ingest
  app.route("/v1", v1);

  const mcp = new Hono<AppEnv>();
  registerMcpRoutes(mcp); // #13/#14 MCP tools
  app.route("/mcp", mcp);

  const api = new Hono<AppEnv>();
  if (auth) {
    // better-auth handles the whole OAuth flow under /api/auth/* (#22)
    api.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
  }
  registerMemoryRoutes(api, auth); // #15 frontend read API
  registerRepoRoutes(api, auth); // #22 repo selector
  app.route("/api", api);

  app.onError((err, c) => {
    console.error("unhandled error:", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
