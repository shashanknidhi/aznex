# Aznex

**Team-shared institutional memory for your codebase, accessible from any coding agent.**

Coding agents (Claude Code, Codex, opencode, etc.) accumulate valuable knowledge as they work — build quirks, architectural decisions, dead ends, the "why" behind the code. Today that knowledge is siloed on each developer's machine and locked to a single vendor. Aznex moves it into a centralized, repo-scoped store and exposes it back to **any** coding agent through a standard MCP server.

> *The right context for the right repo, regardless of which agent is asking.*

---

## What it does

- **Captures** durable knowledge from coding-agent sessions automatically via thin hook adapters
- **Stores** that knowledge centrally, scoped strictly to a single repository
- **Serves** memories to any MCP-compatible agent via one standard endpoint
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

It installs Bun if missing, installs `@aznex/worker`, opens your browser for
GitHub sign-in (no API key to copy), then installs the background daemon, wires
capture hooks for every supported agent it finds — Claude Code and Codex — and
registers the `aznex` MCP server for reads. Verify with `aznex-worker doctor`.

**Requirements:** Claude Code or Codex, installed and logged in — extraction
runs on your own subscription via whichever CLI is present.

> `bun install -g @aznex/worker` alone installs the binary only — it does not
> authenticate, install the daemon, or register hooks/MCP. Go through
> `install.sh` (or run `aznex-worker setup` yourself).

**→ [Full setup guide](docs/setup.md)** — the plugin channel, the one manual
Codex step, tuning, troubleshooting, and uninstall.

### For admins (once per team)

Deploy the service (Railway or Docker), create a GitHub App and OAuth app, set
the environment variables, create an organization, onboard repos, then send
developers the service URL.

**→ [Admin setup](docs/setup.md#admin-setup-once)** — every step with the exact
callback URLs and variables.

One deployment hosts several organizations. Repo memory is gated twice on every
request: membership in the repo's org, and GitHub collaborator access to the
repo itself.

### For contributors

Run the whole stack from a clone — no credentials needed for a first boot:

```sh
git clone https://github.com/shashanknidhi/aznex && cd aznex
bun install
cp .env.example .env
bun run dev:service            # http://localhost:3000
```

**→ [Development guide](docs/development.md)** · **[Contributing](CONTRIBUTING.md)**

## Documentation

| Doc | What |
|---|---|
| [docs/setup.md](docs/setup.md) | Install and deploy Aznex — developer and admin |
| [docs/development.md](docs/development.md) | Run from a clone, tests, seeding, Docker |
| [docs/data-lifecycle.md](docs/data-lifecycle.md) | Entity state machines |
| [packages/service/README.md](packages/service/README.md) | HTTP surface, MCP tools, admin CLI |
| [packages/worker/README.md](packages/worker/README.md) | Worker internals, CLI, hook wiring |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) | How to contribute; reporting vulnerabilities |

## Status

Early development.

## Inspiration

Architecture and capture pipeline modelled after [claude-mem](https://github.com/thedotmack/claude-mem) — the single-user local memory tool that Aznex extends to the team.

## License

Apache 2.0
