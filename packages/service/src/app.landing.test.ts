import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createApp } from "./app.js";
import { openDatabase } from "./db/connection.js";
import { parseLandingHosts } from "./config.js";

// A service with both a built SPA and a static landing directory, the way it
// looks in Docker.
function bothDirs() {
  const staticDir = mkdtempSync(join(tmpdir(), "aznex-spa-"));
  writeFileSync(join(staticDir, "index.html"), "<html>spa</html>");
  const landingDir = mkdtempSync(join(tmpdir(), "aznex-landing-"));
  writeFileSync(join(landingDir, "index.html"), "<html>landing</html>");
  mkdirSync(join(landingDir, "assets"));
  writeFileSync(join(landingDir, "assets", "f.woff2"), "font");
  return { staticDir, landingDir };
}

const get = (app: ReturnType<typeof createApp>, path: string, host: string) =>
  app.request(path, { headers: { host } });

afterEach(() => {
  delete process.env["AZNEX_BASE_URL"];
});

test("parseLandingHosts normalizes case, ports and whitespace", () => {
  expect(parseLandingHosts(undefined)).toEqual([]);
  expect(parseLandingHosts("")).toEqual([]);
  expect(parseLandingHosts(" AZNEX.AI:443 , www.aznex.ai ")).toEqual(["aznex.ai", "www.aznex.ai"]);
});

test("with no landing hosts configured, every host still gets the SPA", async () => {
  const { staticDir, landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), { staticDir, landingDir, landingHosts: [] });
  for (const host of ["aznex.ai", "app.aznex.ai", "localhost:3000"]) {
    expect(await (await get(app, "/", host)).text()).toBe("<html>spa</html>");
  }
});

test("the landing host gets the landing page, the app host gets the SPA", async () => {
  const { staticDir, landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), {
    staticDir,
    landingDir,
    landingHosts: ["aznex.ai"],
  });
  expect(await (await get(app, "/", "aznex.ai")).text()).toBe("<html>landing</html>");
  expect(await (await get(app, "/", "app.aznex.ai")).text()).toBe("<html>spa</html>");
  // case and port are normalized on the request side too
  expect(await (await get(app, "/", "AZNEX.AI:443")).text()).toBe("<html>landing</html>");
  // landing assets are served from the landing dir
  expect(await (await get(app, "/assets/f.woff2", "aznex.ai")).text()).toBe("font");
});

test("/install.sh answers on both the apex and the app host", async () => {
  process.env["AZNEX_BASE_URL"] = "https://app.aznex.ai";
  const { staticDir, landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), {
    staticDir,
    landingDir,
    landingHosts: ["aznex.ai"],
  });
  for (const host of ["aznex.ai", "app.aznex.ai"]) {
    const res = await get(app, "/install.sh", host);
    expect(res.status).toBe(200);
    const script = await res.text();
    expect(script).toContain('SERVICE_URL="https://app.aznex.ai"');
    expect(script).not.toContain("__SERVICE_URL__");
  }
});

test("API routes win over the landing page on the apex host", async () => {
  const { staticDir, landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), {
    staticDir,
    landingDir,
    landingHosts: ["aznex.ai"],
  });
  expect((await get(app, "/health", "aznex.ai")).headers.get("content-type")).toContain(
    "application/json",
  );
  expect((await get(app, "/api/memories", "aznex.ai")).status).toBe(401);
});

test("unknown apex paths redirect into the app instead of showing marketing", async () => {
  process.env["AZNEX_BASE_URL"] = "https://app.aznex.ai/";
  const { staticDir, landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), {
    staticDir,
    landingDir,
    landingHosts: ["aznex.ai"],
  });
  const res = await get(app, "/repo/abc?q=1", "aznex.ai");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("https://app.aznex.ai/repo/abc?q=1");
});

test("landing dir alone still serves the apex and 404s other hosts", async () => {
  const { landingDir } = bothDirs();
  const app = createApp(openDatabase(":memory:"), { landingDir, landingHosts: ["aznex.ai"] });
  expect(await (await get(app, "/", "aznex.ai")).text()).toBe("<html>landing</html>");
  expect((await get(app, "/", "app.aznex.ai")).status).toBe(404);
});
