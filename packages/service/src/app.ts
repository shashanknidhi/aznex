import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import type { Org, OrgRole, User } from "@aznex/shared";
import pkg from "../package.json" with { type: "json" };
import { registerIngestRoutes } from "./routes/ingest.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerMemoryRoutes } from "./routes/memories.js";
import { registerRepoRoutes } from "./routes/repos.js";
import { registerOrgRoutes } from "./routes/orgs.js";
import { reposWithoutOrg } from "./db/migrations.js";
import { registerCliAuthRoutes } from "./routes/cli-auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerKeyRoutes } from "./routes/keys.js";
import { registerMetaRoutes } from "./routes/meta.js";
import type { Auth } from "./auth/session.js";

// Context shared across all handlers. `user` is set by the auth middleware (#10);
// `org`/`orgRole` by the org guards in middleware/org.ts on :orgId routes.
export interface AppEnv {
  Variables: {
    db: Database;
    user: User;
    org: Org;
    orgRole: OrgRole;
  };
}

export function createApp(
  db: Database,
  opts?: { auth?: Auth; staticDir?: string; landingDir?: string; landingHosts?: string[] },
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = opts?.auth ?? null;

  // Make the DB available to every handler without a module-level singleton.
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });

  // An active repo with no org is denied by authorizeRepo, so it is an outage
  // for that repo. Report it here so a bad deploy is visible rather than showing
  // up as mysterious 403s.
  //
  // Still 200, deliberately: railway.json health-checks this path, and failing
  // it would roll the deploy back — turning a data-integrity warning about a
  // few repos into a total outage. The `degraded` field is the signal.
  app.get("/health", (c) => {
    const orphans = reposWithoutOrg(c.get("db"));
    return c.json(
      orphans > 0
        ? { ok: true, version: pkg.version, degraded: "repos_without_org", count: orphans }
        : { ok: true, version: pkg.version },
    );
  });

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
  registerOrgRoutes(api, auth); // #50 per-org admin: members, keys, repos
  registerCliAuthRoutes(api, auth); // browser login for aznex-worker setup
  registerAdminRoutes(api, auth); // env-var RBAC: repo onboarding
  registerKeyRoutes(api, auth); // self-service API key management
  registerMetaRoutes(api, auth); // /api/config + /api/me for the app shell
  app.route("/api", api);

  // Production frontend: serve the built SPA (vite dist) from the service so
  // the whole app is one same-origin deployable. API groups above win; any
  // other GET falls back to index.html for client-side routing.
  const staticDir = opts?.staticDir;
  const landingDir = opts?.landingDir;
  const landingHosts = opts?.landingHosts ?? [];
  if (staticDir || landingDir) {
    // A file from `dir`, or null if the path escapes the directory or misses.
    const fileIn = async (dir: string, path: string) => {
      if (path === "/" || path.includes("..")) return null;
      const file = Bun.file(`${dir}${path}`);
      return (await file.exists()) ? new Response(file) : null;
    };
    const html = (path: string) =>
      new Response(Bun.file(path), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });

    app.get("*", async (c) => {
      const path = new URL(c.req.url).pathname;

      // Apex domain (aznex.ai): marketing page. Unknown paths redirect to the
      // app rather than falling back to the landing page, so a shared deep link
      // like aznex.ai/repo/x opens the repo instead of silently showing
      // marketing copy. API groups and /install.sh are registered above and
      // still win here — the install one-liner works on both hosts.
      const host = (c.req.header("host") ?? "").toLowerCase().replace(/:\d+$/, "");
      if (landingDir && landingHosts.includes(host)) {
        if (path === "/") return html(`${landingDir}/index.html`);
        const asset = await fileIn(landingDir, path);
        if (asset) return asset;
        const base = (process.env["AZNEX_BASE_URL"] ?? "").replace(/\/+$/, "");
        return c.redirect(`${base}${path}${new URL(c.req.url).search}`, 302);
      }

      if (!staticDir) return c.notFound();
      return (await fileIn(staticDir, path)) ?? html(`${staticDir}/index.html`);
    });
  }

  app.onError((err, c) => {
    console.error("unhandled error:", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
