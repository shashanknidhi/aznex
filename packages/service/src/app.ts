import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { User } from "@aznex/shared";
import pkg from "../package.json" with { type: "json" };
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerRepoRoutes } from "./routes/repos.js";
import { registerCliAuthRoutes } from "./routes/cli-auth.js";
import type { Auth } from "./auth/session.js";

// Context shared across all handlers. `user` is set by the auth middleware (#10).
export interface AppEnv {
  Variables: {
    db: Database;
    user: User;
  };
}

export function createApp(
  db: Database,
  opts?: { auth?: Auth; staticDir?: string },
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = opts?.auth ?? null;

  // Make the DB available to every handler without a module-level singleton.
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true, version: pkg.version }));

  // Developer one-liner: curl -fsSL <url>/install.sh | bash -s -- --api-key …
  // The script is templated with this deployment's public URL so devs never
  // type it. Unauthenticated by design — it contains no secrets.
  app.get("/install.sh", async (c) => {
    const script = await Bun.file(new URL("./install.sh", import.meta.url).pathname).text();
    const origin = process.env["AZNEX_BASE_URL"] ?? new URL(c.req.url).origin;
    return c.text(script.replaceAll("__SERVICE_URL__", origin.replace(/\/+$/, "")));
  });

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
  registerCliAuthRoutes(api, auth); // browser login for aznex-worker setup
  app.route("/api", api);

  // Production frontend: serve the built SPA (vite dist) from the service so
  // the whole app is one same-origin deployable. API groups above win; any
  // other GET falls back to index.html for client-side routing.
  const staticDir = opts?.staticDir;
  if (staticDir) {
    app.get("*", async (c) => {
      const path = new URL(c.req.url).pathname;
      if (!path.includes("..")) {
        const file = Bun.file(`${staticDir}${path}`);
        if (path !== "/" && (await file.exists())) return new Response(file);
      }
      return new Response(Bun.file(`${staticDir}/index.html`), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
  }

  app.onError((err, c) => {
    console.error("unhandled error:", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
