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
| `@aznex/worker` | Local background daemon: hook adapter → extract (Claude Agent SDK, your subscription) → scrub → POST |
| `@aznex/service` | Single deployable: ingestion API + MCP endpoint + frontend API |
| `@aznex/frontend` | Read-only React SPA: browse, search, inspect team memory |

## Tech stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Service:** Hono
- **MCP:** `@modelcontextprotocol/sdk`
- **DB (v1):** SQLite + FTS5 → Postgres + pgvector; Neo4j for graph+vector semantic search
- **Worker extraction:** Claude Agent SDK (uses your Claude subscription — no separate API key)
- **Auth:** `better-auth`
- **Frontend:** React + Vite
- **Self-host:** Docker + docker-compose

## Quick start (coming soon)

```sh
docker compose up
```

## Status

Early development.

## Inspiration

Architecture and capture pipeline modelled after [claude-mem](https://github.com/thedotmack/claude-mem) — the single-user local memory tool that Aznex extends to the team.

## License

Apache 2.0
