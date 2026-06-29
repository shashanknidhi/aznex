# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Aznex** — team-shared institutional memory for coding agents. Repo-scoped, agent-agnostic, MCP-served. See `.idea/v0/aznex-prd.md` and `.idea/v0/aznex-technical-design.md` for the full product and technical spec.

Inspired by and architecturally modelled after [claude-mem](https://github.com/thedotmack/claude-mem) (cloned at `.idea/repo/claude-mem`).

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Bun |
| Language | TypeScript (strict, ESNext) |
| Service framework | Hono |
| MCP | `@modelcontextprotocol/sdk` |
| Auth | `better-auth` |
| DB (v1) | SQLite via `bun:sqlite` + FTS5 |
| DB (target) | Postgres + pgvector |
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
- `@aznex/worker` runs on each developer's machine: receives agent hooks, processes locally (compress → LLM extract → secret scrub → repo fingerprint), then POSTs to the service.
- Reads (MCP) are agent-agnostic. Capture requires thin per-agent hooks (asymmetry is intentional).
- All memory is keyed by `repo_fingerprint`. The service verifies the caller's access to that repo against the git host on every request — this is the load-bearing security step.

### Data flow

```
Write: agent --hooks--> worker [compress→extract→scrub] --POST /v1/ingest--> service [auth+re-scan+persist] --> DB
Read:  agent --MCP query--> service [auth+verify] --> DB --> agent
```

### Data model (core tables)

- `session` — one per agent session; keyed by `repo_fingerprint`
- `memory` — atomic knowledge unit; `type` ∈ `{raw_observation, extracted_learning, summary, negative_result, decision}`; `promotion_state` ∈ `{private, pending, team_shared}`; `freshness_state` ∈ `{fresh, stale_suspected}`
- `memory_anchor` — `(memory_id, path, commit_sha)` — powers the staleness engine

## Key design decisions (non-obvious)

- **DAL must stay engine-agnostic** — SQLite v1, Postgres+pgvector target. Never let SQLite-specific SQL leak into business logic.
- **Secret scanning is two-pass and mandatory** — client-side (worker, pre-transmission) + server-side (service, at ingestion). Zero leaks is a hard launch gate.
- **Repo fingerprint ≠ local path** — the fingerprint must resolve to a canonical git-host identity (`host/owner/name`) so server-side permission checks can run. Local paths differ per developer and drift.
- **`promotion_state = private` default** — captured memory is author-private until explicitly promoted to `team_shared`. Only `team_shared` records are returned by team reads.
- **Hooks must return immediately** — all heavy worker processing (LLM extraction, scrubbing) is async; hooks enqueue and return so the IDE never stalls.
