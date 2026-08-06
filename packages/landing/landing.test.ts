import { test, expect } from "bun:test";
import { join } from "path";

const html = await Bun.file(join(import.meta.dir, "index.html")).text();
const css = await Bun.file(join(import.meta.dir, "styles.css")).text();

// The install command is the product's front door: if it drifts from the one
// the service actually serves, every visitor gets a broken install.
test("the install one-liner points at the apex install.sh", () => {
  const matches = html.match(/curl -fsSL https:\/\/aznex\.ai\/install\.sh \| bash/g);
  // The installer step and the terminal demo. More is fine; fewer means one of
  // them drifted from the command the service actually serves.
  expect(matches?.length).toBeGreaterThanOrEqual(2);
});

test("sign-in links point at the app, which is same-origin under /dashboard", () => {
  expect(html).toContain('href="/dashboard"');
  // An absolute app host would break every other deployment of this page.
  expect(html).not.toContain("https://app.aznex.ai");
});

// "No external requests" is the whole reason this directory has no build step.
test("the page loads nothing from a third-party host", () => {
  for (const source of [html, css]) {
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
});

test("assets referenced by the page exist", async () => {
  const refs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]!);
  const cssRefs = [...css.matchAll(/url\("(\/[^"]+)"\)/g)].map((m) => m[1]!);
  // /dashboard is the service's route, not a file in this directory.
  const local = (r: string) => r !== "/" && !r.startsWith("/dashboard");
  for (const ref of [...refs, ...cssRefs].filter(local)) {
    expect(await Bun.file(join(import.meta.dir, ref)).exists()).toBe(true);
  }
});
