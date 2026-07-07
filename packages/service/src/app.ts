import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { User } from "@aznex/shared";
import pkg from "../package.json" with { type: "json" };
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerMcpRoutes } from "./routes/mcp.js";
<<<<<<< HEAD
import { registerMemoryRoutes } from "./routes/memories.js";
=======
>>>>>>> origin/main

// Context shared across all handlers. `user` is set by the auth middleware (#10).
export interface AppEnv {
  Variables: {
    db: Database;
    user: User;
  };
}

export function createApp(db: Database): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

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
<<<<<<< HEAD
  const api = new Hono<AppEnv>();
  registerMemoryRoutes(api); // #15 frontend read API
  app.route("/api", api);
=======
  app.route("/api", new Hono<AppEnv>()); // #15 frontend read API
>>>>>>> origin/main

  app.onError((err, c) => {
    console.error("unhandled error:", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
