# Running Aznex from a clone

For hacking on Aznex, or just looking around without deploying anything. If you
only want to *use* an Aznex your team already runs, you want
[setup.md](setup.md) instead.

## Prerequisites

[Bun](https://bun.sh) 1.1 or newer. Nothing else — no database server, no API
key, no GitHub credentials for a first boot.

## Boot the service

```sh
git clone https://github.com/shashanknidhi/aznex && cd aznex
bun install
cp .env.example .env          # fine to leave the credentials blank
bun run dev:service           # http://localhost:3000
```

In another shell:

```sh
curl localhost:3000/health    # → {"ok":true,...}
```

The service starts with **no GitHub credentials configured**. SQLite creates
`./aznex.db` on first open and applies the schema and migrations automatically,
so there is no separate migration step.

Two things are switched off in that state, by design:

- **Browser sign-in is disabled.** Without `GITHUB_OAUTH_CLIENT_ID` /
  `GITHUB_OAUTH_CLIENT_SECRET` the GitHub provider is not registered. The
  service only logs a warning at startup, so this looks like a broken login
  rather than a missing config — it isn't.
- **Every repo-scoped read and write is denied.** Repo authorization asks the
  GitHub App whether you are a collaborator; with no App configured that call
  fails, and failures deny. This is deliberate — a misconfigured deployment must
  never fall open.

So a bare local boot gets you the health endpoint, the schema, the test suite,
and the frontend shell. For an end-to-end run with real memories you need the
GitHub App and OAuth app from [setup.md](setup.md#2-github-credentials),
pointing `AZNEX_BASE_URL` at `http://localhost:3000`.

## Frontend

```sh
bun run --cwd packages/frontend dev    # http://localhost:5173
```

`AZNEX_FRONTEND_ORIGIN` defaults to `http://localhost:5173`, which is the only
cross-origin the service trusts, so the Vite dev server works against a local
service unchanged. In production the service serves the built SPA same-origin.

## Worker

```sh
bun run dev:worker            # http://localhost:29639
```

The worker binds to loopback only and serves a settings page at that address.
It needs a service URL and an API key in `~/.aznex/config.json` before it can
do anything useful — see [setup.md](setup.md#developer-setup-each-team-member).
Note that `bun run dev:worker` runs the worker in the foreground for
development; it does not install the daemon or wire up any agent hooks. Use
`aznex-worker setup` for that.

## Seed demo data

```sh
bun run --cwd packages/service seed
```

Writes one org, repo, user, session, and a handful of memories straight to the
database — enough to see the frontend and the MCP tools return something without
running a capture session. Respects `DATABASE_PATH`.

## Tests and typecheck

```sh
bun run typecheck            # all four packages
bun test                     # all tests
bun test packages/shared     # one package
```

This is what CI runs, per package. Both must pass before a PR merges.

## Admin CLI

Bootstrapping a local database — creating the first org, onboarding a repo,
minting a key by hand:

```sh
bun packages/service/src/admin-cli.ts add-org acme --admins yourlogin
bun packages/service/src/admin-cli.ts add-key --github-login yourlogin --github-id 12345
```

Full command reference in
[packages/service/README.md](../packages/service/README.md#admin-cli).

## Docker

```sh
cp .env.example .env         # fill in credentials first — compose needs them
docker compose -f docker/docker-compose.yml up
```

Run from the repo root: the compose file's build context is `..` and its
`env_file` is `../.env`. It publishes `3000:3000` and keeps the database on the
`aznex-data` volume, forcing `DATABASE_PATH=/app/data/aznex.db` regardless of
what your `.env` says. The image builds the frontend, so the SPA is served
same-origin.

## Repo layout

| Path | What |
|---|---|
| `packages/shared` | Types, data model, API contracts — imported by everything |
| `packages/worker` | Local daemon: hooks → extract → scrub → POST |
| `packages/service` | The only deployable: ingest API + MCP + frontend API + SPA hosting |
| `packages/frontend` | React SPA memory viewer |
| `plugin/` | Claude Code plugin packaging the hooks, MCP server, and `mem-search` skill |
| `docker/` | `Dockerfile.service` and `docker-compose.yml` |

Architecture and the non-obvious design decisions live in
[CLAUDE.md](../CLAUDE.md); entity state machines in
[data-lifecycle.md](data-lifecycle.md).
