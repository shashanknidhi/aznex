import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApp } from "./app.js";
import { openDatabase } from "./db/connection.js";

// A service with both a built SPA and a static landing directory, the way it
// looks in Docker. The SPA's own assets live under /dashboard/ (vite `base`),
// so they never collide with the landing page's /assets.
function bothDirs() {
  const staticDir = mkdtempSync(join(tmpdir(), "aznex-spa-"));
  writeFileSync(join(staticDir, "index.html"), "<html>spa</html>");
  mkdirSync(join(staticDir, "assets"));
  writeFileSync(join(staticDir, "assets", "app.js"), "spa-bundle");
  const landingDir = mkdtempSync(join(tmpdir(), "aznex-landing-"));
  writeFileSync(join(landingDir, "index.html"), "<html>landing</html>");
  mkdirSync(join(landingDir, "assets"));
  writeFileSync(join(landingDir, "assets", "f.woff2"), "font");
  return { staticDir, landingDir };
}

const get = (app: ReturnType<typeof createApp>, path: string) =>
  app.request(path, { headers: { host: "app.aznex.ai" } });

afterEach(() => {
  delete process.env["AZNEX_BASE_URL"];
});

test("the root is the landing page and /dashboard is the app", async () => {
  const { staticDir, landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), { staticDir, landingDir });
  expect(await (await get(app, "/")).text()).toBe("<html>landing</html>");
  expect(await (await get(app, "/dashboard")).text()).toBe("<html>spa</html>");
  // client-side routes fall back to the SPA shell
  expect(await (await get(app, "/dashboard/repo/abc")).text()).toBe("<html>spa</html>");
});

test("each side serves its own assets from the same path prefix", async () => {
  const { staticDir, landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), { staticDir, landingDir });
  expect(await (await get(app, "/assets/f.woff2")).text()).toBe("font");
  expect(await (await get(app, "/dashboard/assets/app.js")).text()).toBe("spa-bundle");
});

test("pre-move deep links redirect into the app", async () => {
  const { staticDir, landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), { staticDir, landingDir });
  // Worker versions already published open ${serviceUrl}/cli-auth, and the
  // GitHub App's setup URL still points at /github/setup.
  for (const [from, to] of [
    ["/cli-auth?port=1234&state=xyz", "/dashboard/cli-auth?port=1234&state=xyz"],
    ["/github/setup?installation_id=9", "/dashboard/github/setup?installation_id=9"],
    ["/repo/abc?q=1", "/dashboard/repo/abc?q=1"],
  ]) {
    const res = await get(app, from!);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(to!);
  }
});

test("API routes and /install.sh win over the landing page", async () => {
  process.env["AZNEX_BASE_URL"] = "https://app.aznex.ai";
  const { staticDir, landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), { staticDir, landingDir });
  expect((await get(app, "/health")).headers.get("content-type")).toContain("application/json");
  expect((await get(app, "/api/memories")).status).toBe(401);
  const script = await (await get(app, "/install.sh")).text();
  expect(script).toContain('SERVICE_URL="https://app.aznex.ai"');
});

test("with no landing dir the root redirects to the app", async () => {
  const { staticDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), { staticDir });
  const res = await get(app, "/");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/dashboard");
  expect(await (await get(app, "/dashboard")).text()).toBe("<html>spa</html>");
});

test("with no SPA the landing page serves alone and unknown paths 404", async () => {
  const { landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), { landingDir });
  expect(await (await get(app, "/")).text()).toBe("<html>landing</html>");
  expect((await get(app, "/repo/abc")).status).toBe(404);
  expect((await get(app, "/dashboard")).status).toBe(404);
});
