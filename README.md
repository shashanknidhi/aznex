# Aznex

**Team-shared institutional memory for your codebase, accessible from any coding agent.**

Coding agents (Claude Code, Codex, opencode, etc.) accumulate valuable knowledge as they work — build quirks, architectural decisions, dead ends, the "why" behind the code. Today that knowledge is siloed on each developer's machine and locked to a single vendor. Aznex moves it into a centralized, repo-scoped store and exposes it back to **any** coding agent through a standard MCP server.

> *The right context for the right repo, regardless of which agent is asking.*

---

## What it does

- **Captures** durable knowledge from coding-agent sessions automatically via thin hook adapters
- **Stores** that knowledge centrally, scoped strictly to a single repository
- **Serves** memories to any MCP-compatible agent via one standard endpoint
- **Flags staleness** when anchored code has changed since a memory was written
- **Keeps secrets off the wire** — two-pass scrubbing (client + server) before anything is shared

## Architecture

```
Developer machine                   Remote server
─────────────────────────           ─────────────────────────
Coding agent (any)                  Single service
   │                                   ├── Ingestion API  ─── Database
   ├──hooks──▶ Background worker ──POST──▶  (secret re-scan,   (SQLite → Postgres
   │                                   │   auth, persist)       + pgvector)
   └──MCP query──────────────────────▶ └── MCP endpoint
                                   │
Frontend (browser)─────────────────▶ Frontend API
```

The service is the only tier that touches the database. Every read and write passes through it — where authentication, repo-permission checks against the git host, and authoritative secret scanning happen.

## Packages

| Package | Description |
|---|---|
| `@aznex/shared` | Shared TypeScript types, data model, API contracts |
| `@aznex/worker` | Local background daemon: hook adapter → extract (local Claude Code CLI, your subscription) → scrub → POST |
| `@aznex/service` | Single deployable: ingestion API + MCP endpoint + frontend API |
| `@aznex/frontend` | Read-only React SPA: browse, search, inspect team memory |

## Tech stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Service:** Hono
- **MCP:** `@modelcontextprotocol/sdk`
- **DB (v1):** SQLite + FTS5 → Postgres + pgvector; Neo4j for graph+vector semantic search
- **Worker extraction:** spawns your local Claude Code CLI (uses your Claude subscription — no separate API key)
- **Auth:** `better-auth`
- **Frontend:** React + Vite
- **Self-host:** Docker + docker-compose

## Install

### For developers

One command. Get the **service URL** from your admin — that's all you need:

```sh
curl -fsSL <SERVICE_URL>/install.sh | bash
```

It installs Bun if you don't have it, installs `@aznex/worker`, and runs
setup: your browser opens for GitHub sign-in (no API key to copy), then it
writes `~/.aznex/config.json`, installs the background worker daemon (starts
at login, restarts on crash), wires the Claude Code hooks — capture **and**
team-memory context injection at session start — and registers the `aznex`
MCP server for reads. Works in every repo on the machine; sessions in repos
your admin hasn't onboarded are skipped automatically.

**Requirements:** Claude Code (installed and logged in — extraction runs on
your own subscription). Bun is auto-installed if missing. Headless/CI
machines: pass a pre-minted key via `--api-key`.

> **Note:** `bun install -g @aznex/worker` alone installs the binary only —
> it does not authenticate, install the daemon, or register hooks/MCP. Always
> go through `install.sh` (or run `aznex-worker setup` yourself).

Verify anytime:

```sh
aznex-worker doctor    # ✓/✗ checks: config, daemon, worker, service, key, hooks, MCP
```

First success: open a Claude Code session in an onboarded repo — a
`# Team memory (aznex)` block appears at session start. End the session and
your extracted memories show up in the viewer (`<SERVICE_URL>`) within a
minute. Tune the worker (extraction model, context-injection knobs) at
http://localhost:29639.

**Alternative: plugin channel.** Prefer hooks via `/plugin` instead of
`~/.claude/settings.json`? Install the plugin, then run setup for auth +
daemon (pick **one** hook channel — both at once doubles the injected
context):

```
/plugin marketplace add shashanknidhi/aznex
/plugin install aznex@aznex
```
```sh
npx aznex-worker setup
```

See [plugin/README.md](plugin/README.md).

**Troubleshooting** — run `aznex-worker doctor` first; it diagnoses the
common cases with a fix per finding. Beyond that:

| Symptom | Fix |
|---|---|
| Sessions produce no memories | `tail -50 ~/.aznex/logs/worker.log` — the worker logs every drop reason (most common: repo not onboarded by admin) |
| Memories are team-visible / private unexpectedly | Deployment default is `AZNEX_DEFAULT_PROMOTION` (pilot: `team_shared`); flip individual memories in the viewer |
| Uninstall | `aznex-worker uninstall` |

### For admins (once per team)

1. **Deploy the service** — Railway: New Project → Deploy from GitHub → this
   repo (`railway.json` configures the build); attach a volume at `/app/data`;
   generate a domain — that's your `<SERVICE_URL>`. Self-host instead:
   `docker compose -f docker/docker-compose.yml up` (env in `.env`).
2. **GitHub credentials** — a **GitHub App** (repo *Metadata: read*; install it
   on your org; note App ID, private key, and set its Setup URL to
   `<SERVICE_URL>/github/setup` with "Redirect on update" on) and a **GitHub
   OAuth app** (callback `<SERVICE_URL>/api/auth/callback/github`).
3. **Environment variables** on the service:

   ```
   DATABASE_PATH=/app/data/aznex.db
   GITHUB_APP_ID=…            GITHUB_APP_PRIVATE_KEY=…
   GITHUB_OAUTH_CLIENT_ID=…   GITHUB_OAUTH_CLIENT_SECRET=…
   BETTER_AUTH_SECRET=…       # openssl rand -hex 32
   AZNEX_BASE_URL=<SERVICE_URL>
   AZNEX_FRONTEND_ORIGIN=<SERVICE_URL>
   AZNEX_ALLOWED_GITHUB_LOGINS=alice,bob    # who may sign in
   AZNEX_ADMIN_GITHUB_LOGINS=alice          # who may onboard repos
   AZNEX_GITHUB_APP_SLUG=<app-slug>
   ```

   Redeploy; `curl <SERVICE_URL>/health` → `{"ok":true}`.
4. **Onboard repos** — sign in to the viewer as an admin and use
   "Install / pick repos on GitHub" (or onboard one repo by name). Then send
   developers the `<SERVICE_URL>` — they self-serve from there.

## Status

Early development.

## Inspiration

Architecture and capture pipeline modelled after [claude-mem](https://github.com/thedotmack/claude-mem) — the single-user local memory tool that Aznex extends to the team.

## License

Apache 2.0
