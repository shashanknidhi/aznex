# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Aznex** — team-shared institutional memory for coding agents. Repo-scoped, agent-agnostic, MCP-served. The README covers the product and architecture; `docs/data-lifecycle.md` covers entity state machines.

Inspired by and architecturally modelled after [claude-mem](https://github.com/thedotmack/claude-mem).

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Language | TypeScript (strict, ESNext) |
| Service framework | Hono |
| MCP | `@modelcontextprotocol/sdk` |
| Auth | `better-auth` |
| DB (v1) | SQLite via `bun:sqlite` + FTS5 |
| DB (target) | Postgres + pgvector; Neo4j for graph+vector semantic search |
| DAL pattern | Thin repository/DAO — no ORM, raw SQL, engine-agnostic interface |
| Frontend | React + Vite |
| Monorepo | Bun workspaces |
| Deploy | Docker + docker-compose |

## Repo structure

```
packages/
  shared/    @aznex/shared   — TypeScript types, data model, API contracts
  worker/    @aznex/worker   — local background worker (hooks → extract → scrub → POST)
  service/   @aznex/service  — single deployable (ingestion API + MCP + frontend API)
  frontend/  @aznex/frontend — React SPA memory viewer
docker/
  Dockerfile.service
  docker-compose.yml
```

Each package has `src/index.ts` as its entry point and its own `tsconfig.json` extending the root.

## Commands

```sh
bun install                        # install all workspace deps
bun run typecheck                  # typecheck all packages
bun run --cwd packages/service dev # run service in dev/watch mode
bun run --cwd packages/worker dev  # run worker in dev/watch mode
bun test                           # run all tests
bun test packages/shared           # run tests for one package
docker compose -f docker/docker-compose.yml up  # self-host
```

## Testing

**Always add unit tests for new logic.** Tests live alongside source in the same package (e.g. `packages/shared/src/foo.test.ts`). Use Bun's built-in test runner — no extra framework needed.

```ts
import { test, expect } from "bun:test";
```

Every non-trivial function (a branch, a parser, a data transformation, anything on a security/money path) needs at least one test that fails if the logic breaks. Trivial one-liners don't need tests.

## Architecture

Two trust zones: **developer machine** (untrusted clients) and **remote server** (trusted tier).

- `@aznex/service` is the **only** component with database credentials. Every read/write passes through it.
- `@aznex/worker` runs as a **persistent background daemon** on each developer's machine. It receives agent hooks, runs LLM extraction via the **Claude Agent SDK using the developer's own Claude subscription** (no separate API key needed), scrubs secrets, then POSTs only the final structured memory to the service. Raw tool I/O never leaves the machine. The active agent session is completely unaware of this — it just fires hooks.
- The service is a **dumb authenticated store** for writes — it validates, re-scans for secrets, and persists. All extraction intelligence lives in the worker.
- Reads (MCP) are agent-agnostic. Capture requires thin per-agent hooks (asymmetry is intentional).
- All memory is keyed by `repo_fingerprint`. The service verifies the caller's access to that repo against the git host on every request — this is the load-bearing security step.
- The worker must survive crashes and start on login (`launchd` plist on macOS, `systemd` unit on Linux).

### Data flow

```
Write: agent --hooks--> worker [compress → Claude Agent SDK extract (local) → scrub] --POST /v1/ingest (structured memory only)--> service [auth+re-scan+persist] --> DB
Read:  agent --MCP query--> service [auth+verify] --> DB --> agent
```

### Data model (core tables)

- `session` — one per agent session; keyed by `repo_fingerprint`
- `memory` — atomic knowledge unit; `type` ∈ `{raw_observation, extracted_learning, summary, negative_result, decision}`; `promotion_state` ∈ `{private, pending, team_shared}`; `freshness_state` ∈ `{fresh, stale_suspected}`
- `memory_anchor` — `(memory_id, path, commit_sha)` — powers the staleness engine

## Terminology

| Term used in code | Means | Notes |
|---|---|---|
| **Repository** | A class that owns all DB access for one table (e.g. `MemoryRepository`) | GitHub issues may say "DAO module" — same thing |
| **DAL** | Data Access Layer — the `repositories/` directory as a whole | The layer between business logic and the database |
| **DAO** | Data Access Object — synonym for Repository; used in issue descriptions | We use "Repository" in code for consistency |
| **Repo fingerprint** | Canonical git identity: `github.com/owner/name` | Not a local path — must be resolvable by the service for permission checks |
| **Promotion state** | `private → pending → team_shared` lifecycle of a memory | Only `team_shared` memories are returned to team reads |
| **Freshness state** | `fresh` or `stale_suspected` — whether anchored code has changed since capture | Set by the staleness engine, not by the worker |
| **FTS5** | SQLite's built-in full-text search extension | Used for keyword search over `memory.content` and related fields |

## Key design decisions (non-obvious)

- **DAL must stay engine-agnostic** — SQLite v1, Postgres+pgvector target. Never let SQLite-specific SQL leak into business logic.
- **Semantic search target: Neo4j (graph + vector) over ChromaDB** — Neo4j's vector index combined with Cypher graph traversal fits Aznex's data model better than a pure vector store. The memory→anchor→file→session→repo graph enables queries like "find stale memories touching files changed near this commit" natively. Evaluate after v1 FTS5 proves insufficient in production.
- **Secret scanning is two-pass and mandatory** — client-side (worker, pre-transmission) + server-side (service, at ingestion). Zero leaks is a hard launch gate.
- **Repo fingerprint ≠ local path** — the fingerprint must resolve to a canonical git-host identity (`host/owner/name`) so server-side permission checks can run. Local paths differ per developer and drift.
- **`promotion_state = private` default** — captured memory is author-private until explicitly promoted to `team_shared`. Only `team_shared` records are returned by team reads.
- **Hooks must return immediately** — all heavy worker processing (LLM extraction, scrubbing) is async; hooks enqueue and return so the IDE never stalls.
- **Worker owns the full write pipeline; active session is passive** — the active Claude session fires hooks and nothing else. The background worker handles extraction (via Claude Agent SDK, user's own subscription), scrubbing, and POSTing to the service. This keeps the active session lean and makes capture automatic with no developer effort.
- **Service is a dumb store on the write path** — extraction intelligence stays in the worker. The service only validates auth, re-scans for secrets, and persists. No LLM calls server-side.
- **Worker must run as a daemon** — needs auto-start on login and crash recovery (`launchd` on macOS, `systemd` on Linux). This is the main local infra burden for the worker package.
