import { test, expect } from "bun:test";
import { join } from "path";

const html = await Bun.file(join(import.meta.dir, "index.html")).text();
const css = await Bun.file(join(import.meta.dir, "styles.css")).text();

// The install command is the product's front door: if it drifts from the one
// the service actually serves, every visitor gets a broken install.
test("the install one-liner points at the apex install.sh", () => {
  const matches = html.match(/curl -fsSL https:\/\/aznex\.ai\/install\.sh \| bash/g);
  expect(matches?.length).toBe(2); // hero and closer
});

test("sign-in links go to the app host", () => {
  expect(html).toContain("https://app.aznex.ai");
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
  for (const ref of [...refs, ...cssRefs].filter((r) => r !== "/")) {
    expect(await Bun.file(join(import.meta.dir, ref)).exists()).toBe(true);
  }
});
