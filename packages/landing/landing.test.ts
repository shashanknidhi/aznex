import { test, expect } from "bun:test";
import { join } from "path";

const dir = import.meta.dir;
// The page is a React app now: the head lives in the Vite entry, the markup in
// App.tsx, and every static asset ships from public/ verbatim.
const shell = await Bun.file(join(dir, "index.html")).text();
const app = await Bun.file(join(dir, "src/App.tsx")).text();
const css = await Bun.file(join(dir, "public/styles.css")).text();

// The install command is the product's front door: if it drifts from the one
// the service actually serves, every visitor gets a broken install.
test("the install one-liner points at the host that serves install.sh", () => {
  // Absolute by necessity — it's a shell command, not a link — so it has to
  // name the host the service actually answers on, not the apex. One constant
  // now feeds both the installer step and the terminal demo.
  expect(app).toContain("curl -fsSL https://app.aznex.ai/install.sh | bash");
});

test("sign-in links point at the app, which is same-origin under /dashboard", () => {
  expect(app).toContain('href="/dashboard"');
  // An absolute href would break every other deployment of this page. The
  // install one-liner is exempt: a shell command can't be relative.
  expect(app).not.toMatch(/<a[^>]+href="https:\/\/app\.aznex\.ai/);
});

// "No external requests" is why every asset lives in public/ and the only
// bundle is our own — no CDN import, no analytics script, no hosted font.
test("the page loads nothing from a third-party host", () => {
  for (const source of [shell, css]) {
    for (const [, url] of source.matchAll(/(?:src|href|url\()=?["'(]?(https?:\/\/[^"')\s>]+)/g)) {
      // <a href> to GitHub is fine; a loaded subresource is not.
      const isAnchor = new RegExp(`<a[^>]+href="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(
        source,
      );
      const isMetaUrl = new RegExp(`content="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(
        source,
      );
      const isCanonical = source.includes(`rel="canonical" href="${url}"`);
      expect(isAnchor || isMetaUrl || isCanonical).toBe(true);
    }
  }
  // App.tsx must not reach off-origin either: only the module graph may load
  // code, and every import in it has to resolve inside the workspace.
  expect(app).not.toMatch(/from ["']https?:\/\//);
  expect(app).not.toMatch(/import\(["']https?:\/\//);
});

test("assets referenced by the page exist", async () => {
  const refs = [...shell.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]!);
  const cssRefs = [...css.matchAll(/url\("(\/[^"]+)"\)/g)].map((m) => m[1]!);
  // /src/main.tsx is the Vite entry, resolved from the package root, not public/.
  for (const ref of [...refs, ...cssRefs].filter((r) => !r.startsWith("/src/"))) {
    expect(await Bun.file(join(dir, "public", ref)).exists()).toBe(true);
  }
});
