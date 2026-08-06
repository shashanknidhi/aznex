# Landing page

The static marketing site served at the site root. Hand-written HTML and CSS —
no build step, no framework, no dependency. `@aznex/service` copies this
directory verbatim and serves it at `/`; the app SPA lives under `/dashboard`
(vite `base`, matching `BrowserRouter basename`). One host, one origin, so the
session cookie and `/api` are shared.

`/install.sh`, `/api/*`, `/v1/*`, `/mcp/*` and `/health` are registered above
the static branch, so they still win. Any other path this directory doesn't own
redirects to `/dashboard<path>` — load-bearing, because published worker
versions open `${serviceUrl}/cli-auth` and the GitHub App's setup URL still
points at `/github/setup`.

Positioning, voice, palette, type and the "never" list live in
[`docs/brand.md`](../../docs/brand.md). This directory is that document's
reference rendering — if the two disagree, one of them is a bug.

## Rules

- **No external requests.** Fonts are self-hosted, SVGs are inline, there is no
  analytics script. The page must render with nothing but this directory.
- **No JS beyond the copy button, the theme toggle and one IntersectionObserver.**
  Everything else works with JS disabled — the page stays dark, the toggle hides
  itself, and the hero diagram shows its finished frame. Same under
  `prefers-reduced-motion`.
- **Dark is the default for every visitor.** Light is an explicit choice stored
  in `localStorage` and applied as `data-theme="light"` by an inline head script,
  before first paint.
- **Every claim must be true today.** Trace it to the README, `CLAUDE.md` or
  working code. Roadmap items (Postgres + pgvector, Neo4j) do not appear here.
- **No call to action a visitor cannot complete.** The hosted instance is
  invite-only (`middleware/auth.ts:32` refuses any login without an org
  membership), so the primary CTA asks for pilot access. The install one-liner
  lives in the Getting started step, after you have a service URL.
- Page weight: ~108 KB uncompressed, of which 69 KB is the two woff2 fonts
  (already compressed) and 38 KB is HTML + CSS that gzips to 11 KB.
  So ~79 KB over the wire, against a 100 KB budget. If the HTML and CSS grow
  much past this, subset the fonts harder before cutting content.

## Fonts

Bricolage Grotesque and JetBrains Mono, both SIL Open Font License 1.1
(`assets/OFL.txt`). The committed files are latin-only subsets:

```sh
pyftsubset <font>.woff2 --output-file=<font>-latin.woff2 --flavor=woff2 \
  --layout-features='kern,liga,calt' \
  --unicodes='U+0020-007E,U+00A0,U+00A9,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026,U+2192,U+00B7'
```

## Preview

```sh
python3 -m http.server 8899 --directory packages/landing
```

Or through the service, which is what production does:

```sh
bun run --cwd packages/frontend build   # the service only mounts /dashboard if dist exists
bun run --cwd packages/service dev
curl -s localhost:3000/            # landing
curl -s localhost:3000/dashboard   # app
```
