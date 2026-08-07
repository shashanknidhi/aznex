# Landing page

The marketing site served at the site root. A React + Vite app: `index.html` is
the entry shell, `src/App.tsx` is the page, and everything in `public/` ships
verbatim. `@aznex/service` serves the built `dist/` at `/`; the app SPA lives
under `/dashboard` (vite `base`, matching `BrowserRouter basename`). One host,
one origin, so the session cookie and `/api` are shared.

Build it before the service can serve it — `bun run --cwd packages/landing
build`. Without a `dist/`, the landing branch is simply off and `/` redirects to
the app.

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
- **The page renders client-side.** It is React, so JS is required — there is no
  server render and no static fallback. Under `prefers-reduced-motion` the CSS
  still paints every finished state, so the page reads identically without the
  assembly (`src/effects.ts` is additive and no-ops).
- **Dark is the default for every visitor.** Light is an explicit choice stored
  in `localStorage` and applied as `data-theme="light"` by an inline head script,
  before first paint.
- **Every claim must be true today.** Trace it to the README, `CLAUDE.md` or
  working code. Roadmap items (Postgres + pgvector, Neo4j) do not appear here.
- **No call to action a visitor cannot complete.** The hosted instance is
  invite-only (`middleware/auth.ts:32` refuses any login without an org
  membership), so the primary CTA asks for pilot access. The install one-liner
  lives in the Getting started step, after you have a service URL.
- Page weight: ~69 KB of woff2 fonts (already compressed), ~11 KB of gzipped
  CSS + HTML, and a 213 KB JS bundle that gzips to 66 KB — ~146 KB over the
  wire. React is the bulk of it. If this needs to come down, dropping the
  framework buys back more than any amount of content cutting.

## Fonts

Bricolage Grotesque and JetBrains Mono, both SIL Open Font License 1.1
(`public/assets/OFL.txt`). The committed files are latin-only subsets:

```sh
pyftsubset <font>.woff2 --output-file=<font>-latin.woff2 --flavor=woff2 \
  --layout-features='kern,liga,calt' \
  --unicodes='U+0020-007E,U+00A0,U+00A9,U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2026,U+2192,U+00B7'
```

## Preview

```sh
bun run --cwd packages/landing dev   # :5174, with the annotation toolbar
```

Or through the service, which is what production does:

```sh
bun run --cwd packages/frontend build   # the service only mounts /dashboard if dist exists
bun run --cwd packages/landing build    # ...and only mounts / if landing/dist exists
bun run --cwd packages/service dev
curl -s localhost:3000/            # landing
curl -s localhost:3000/dashboard   # app
```
