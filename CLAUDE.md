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

Each package has its own `tsconfig.json` extending the root. `shared`, `worker`, and `service` enter at `src/index.ts`; the frontend enters at `src/main.tsx` via `index.html`.

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

## Releasing

`@aznex/shared` and `@aznex/worker` share one version and are published to npm
by `.github/workflows/release.yml` on any `v*` tag push. Service and frontend
auto-deploy to Railway on every push to `main` — they are not versioned.

**Every release needs a `CHANGELOG.md` section.** The workflow extracts the
section for the tag and uses it as the GitHub release body; a missing section
fails the release. Do not let a tag ship without notes.

Release steps:

1. Add a `## [X.Y.Z] — YYYY-MM-DD` section at the top of `CHANGELOG.md`, with
   `### Added` / `### Changed` / `### Fixed` / `### Removed` subsections as
   needed. One bullet per user-visible change, in plain language — what changed
   and why it matters, not the commit subject. Cite the PR number: `(#83)`.
   Add the `[X.Y.Z]: https://github.com/shashanknidhi/aznex/releases/tag/vX.Y.Z`
   link at the bottom.
2. Bump `version` in `packages/shared/package.json` and
   `packages/worker/package.json` to the same `X.Y.Z` (the workflow refuses to
   publish if either disagrees with the tag).
3. Open a `chore: release vX.Y.Z` PR and merge it once CI is green.
4. Tag `main` and push: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. The workflow typechecks, tests, publishes both packages to npm via OIDC
   trusted publishing, then creates the GitHub release from the CHANGELOG
   section.

## Architecture

Two trust zones: **developer machine** (untrusted clients) and **remote server** (trusted tier).

- `@aznex/service` is the **only** component with database credentials. Every read/write passes through it.
- `@aznex/worker` runs as a **persistent background daemon** on each developer's machine. It receives agent hooks, runs LLM extraction by **spawning the developer's local Claude Code CLI (their own subscription — no separate API key)**, scrubs secrets, then POSTs only the final structured memory to the service. Raw tool I/O never leaves the machine. The active agent session is completely unaware of this — it just fires hooks.
- The service is a **dumb authenticated store** for writes — it validates, re-scans for secrets, and persists. All extraction intelligence lives in the worker.
- Reads (MCP) are agent-agnostic. Capture requires thin per-agent hooks (asymmetry is intentional).
- All memory is keyed by `repo_fingerprint`. Every repo-scoped read and write goes through **one** authorizer, `auth/authorize.ts` — never an inline check. It applies two independent gates, both required: (1) the caller is a member of the repo's org and that org is active; (2) the git host still lists them as a collaborator on the repo. Access means **collaborator membership** (`GET /repos/{repo}/collaborators/{user}` → 204), never a permission level: GitHub reports `read` for every login on a public repo, so gating on permission level leaks a public repo's memory to anyone with an account. The org gate is what makes "remove member" and "suspend org" actually cut access — GitHub keeps saying yes.
- The worker must survive crashes and start on login (`launchd` plist on macOS, `systemd` unit on Linux).

### Data flow

```
Write: agent --hooks--> worker [compress → extract via local Claude CLI → scrub] --POST /v1/ingest (structured memory only)--> service [auth+re-scan+persist] --> DB
Read:  agent --MCP query--> service [auth+verify] --> DB --> agent
```

### Data model (core tables)

- `org` — one tenant (company); `status` ∈ `{active, suspended}`. `repo.org_id` names the owner
- `org_membership` — `(org_id, github_login, role)`, `role` ∈ `{admin, member}`. Keyed by **login, not `user_id`**, so an admin can invite someone who has never signed in; the login binds to a `user` row lazily on first login
- `session` — one per agent session; keyed by `repo_fingerprint`
- `memory` — atomic knowledge unit; `type` ∈ `{raw_observation, extracted_learning, summary, negative_result, decision}`. Visible to every repo member as soon as it is ingested
- `memory_anchor` — `(memory_id, path)` — powers path-scoped recall (`get_memories_by_path`)

## Terminology

| Term used in code | Means | Notes |
|---|---|---|
| **Repository** | A class that owns all DB access for one table (e.g. `MemoryRepository`) | GitHub issues may say "DAO module" — same thing |
| **DAL** | Data Access Layer — the `repositories/` directory as a whole | The layer between business logic and the database |
| **DAO** | Data Access Object — synonym for Repository; used in issue descriptions | We use "Repository" in code for consistency |
| **Repo fingerprint** | Canonical git identity: `github.com/owner/name` | Not a local path — must be resolvable by the service for permission checks |
| **FTS5** | SQLite's built-in full-text search extension | Used for keyword search over `memory.content` and related fields |

## Key design decisions (non-obvious)

- **DAL must stay engine-agnostic** — SQLite v1, Postgres+pgvector target. Never let SQLite-specific SQL leak into business logic.
- **Semantic search target: Neo4j (graph + vector) over ChromaDB** — Neo4j's vector index combined with Cypher graph traversal fits Aznex's data model better than a pure vector store. The memory→anchor→file→session→repo graph enables queries like "what does the team know about the files this commit touches" natively. Evaluate after v1 FTS5 proves insufficient in production.
- **Secret scanning is two-pass and mandatory** — client-side (worker, pre-transmission) + server-side (service, at ingestion). Zero leaks is a hard launch gate.
- **Repo fingerprint ≠ local path** — the fingerprint must resolve to a canonical git-host identity (`host/owner/name`) so server-side permission checks can run. Local paths differ per developer and drift.
- **All memory is shared; deletion is the only withdrawal** — there is no promotion state and no staleness state. Access is the only read gate, so every member of the repo's org who can see the repo sees the same context. `DELETE /api/memories/:id` (author, org admin, or super admin) is the safety valve for a memory that is wrong or leaked something. Removing a member or suspending an org cuts access but never deletes rows — the team keeps the knowledge that person built.
- **Multi-tenant on one SQLite database, not one database per org** — isolation is enforced per request by the authorizer, which is stronger than a file boundary (a file boundary only holds if the code always opens the right file). A per-org file would buy per-tenant write locks and `rm`-style deletion at the cost of a connection registry, migration fanout and backup fanout. Revisit on real ingest write contention.
- **Three roles, one env-granted** — super admin comes from `AZNEX_ADMIN_GITHUB_LOGINS` only, so a compromised org admin can never escalate into it. Super admins manage every org but have **no memory-read bypass** (`authorizeRepo` has no super-admin branch); they can delete a memory, for leak response, because deleting is not reading.
- **Cross-tenant requests 404, never 403** — an org admin of A poking at org B's routes gets `not_found`. A 403 would confirm the tenant exists and let anyone enumerate the deployment's customers.
- **Ingest stores every extracted field** — `title`, `narrative`, `facts`, `concepts` and both file lists all cross the wire and are indexed by FTS5. Anchors are derived server-side from `files_read ∪ files_modified`.
- **Hooks must return immediately** — all heavy worker processing (LLM extraction, scrubbing) is async; hooks enqueue and return so the IDE never stalls.
- **Worker owns the full write pipeline; active session is passive** — the active Claude session fires hooks and nothing else. The background worker handles extraction (spawning the local Claude Code CLI on the user's own subscription), scrubbing, and POSTing to the service. This keeps the active session lean and makes capture automatic with no developer effort.
- **Service is a dumb store on the write path** — extraction intelligence stays in the worker. The service only validates auth, re-scans for secrets, and persists. No LLM calls server-side.
- **Worker must run as a daemon** — needs auto-start on login and crash recovery (`launchd` on macOS, `systemd` on Linux). This is the main local infra burden for the worker package.
