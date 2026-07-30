# @aznex/service

The single remote deployable, and the only component that holds database
credentials. Every read and write passes through it.

Three surfaces over one shared auth/authorization module:

- **`POST /v1/ingest`** — memory writes from workers
- **`POST /mcp`** — MCP endpoint serving five read tools to any coding agent
- **`/api/*`** — frontend API, plus auth, org management, and key management

Run it: `bun run dev` (watch) or `bun run start`. Config comes entirely from the
environment — see [`.env.example`](../../.env.example) for the annotated list.
To run it from a clone, see [docs/development.md](../../docs/development.md).

## HTTP surface

| Path | What |
|---|---|
| `GET /health` | Always 200. Adds `"degraded": "repos_without_org"` if any active repo has no owning org — those repos deny every request until one is assigned. Deliberately not a failure, so Railway won't roll a deploy back over a handful of repos. |
| `GET /install.sh` | The developer install script, with `AZNEX_BASE_URL` baked in |
| `POST /v1/ingest` | Worker writes |
| `POST /mcp` | MCP endpoint |
| `/api/auth/*` | better-auth (GitHub OAuth); callback is `<AZNEX_BASE_URL>/api/auth/callback/github` |
| `/api/*` | memories, repos, orgs, keys, cli-auth, admin |
| `*` | Built SPA, if `packages/frontend/dist` exists |

## MCP

Stateless streamable HTTP — one complete JSON-RPC exchange per POST, no
server-side session bookkeeping. A fresh server instance is built per request.

```
POST <SERVICE_URL>/mcp
Authorization: Bearer <api key>
```

API key only; there is no session-cookie path here. Server identity is `aznex`.
Five tools, each re-checking `authorizeRepo` on every call:

| Tool | Arguments |
|---|---|
| `search_memory` | `query`, `repo_fingerprint`, `limit?` |
| `get_recent_context` | `repo_fingerprint`, `limit?` (default 20) |
| `get_memory` | `id` |
| `get_memories_by_path` | `repo_fingerprint`, `path` |
| `list_sessions` | `repo_fingerprint`, `limit?` (capped at 100) |

`repo_fingerprint` is `<host>/<owner>/<name>` — host and owner lowercased, repo
name case preserved.

Client wiring is handled by `aznex-worker setup`. Manually, for Claude Code:

```sh
claude mcp add aznex -s user --transport http <SERVICE_URL>/mcp \
  --header "Authorization: Bearer <key>"
```

## Authorization

Every repo-scoped read and write goes through one function, `auth/authorize.ts`
— never an inline check. It applies two independent gates and both must pass:

1. The caller is a member of the repo's organization, and that org is `active`.
2. The git host still lists them as a collaborator on the repo.

Gate 2 is collaborator *membership* (`GET /repos/{repo}/collaborators/{user}` →
204), never a permission level: GitHub reports `read` for every login on a public
repo, so gating on level would leak a public repo's memory to anyone with an
account. Gate 1 is what makes "remove member" and "suspend org" actually cut
access, since GitHub keeps saying yes.

A GitHub App failure propagates as a 500 — a misconfigured deployment never
falls open. Cross-tenant requests return 404, not 403, so nobody can enumerate
the deployment's customers.

Sign-in requires super admin or membership in at least one active org. Super
admin comes only from `AZNEX_ADMIN_GITHUB_LOGINS`, and carries no memory-read
bypass.

## Database

SQLite via `bun:sqlite`, WAL, foreign keys on. Path resolves as
`DATABASE_PATH` → `AZNEX_DB_PATH` → `./aznex.db`. Schema and migrations apply
automatically on open, as does the better-auth schema at boot — there is no
separate migration command.

A fresh database is intentionally left with **no organizations**. Since sign-in
requires super admin or an org membership, the first org must come from either
`AZNEX_ADMIN_GITHUB_LOGINS` (which lets a super admin sign in and create one in
the UI) or `admin-cli.ts add-org`. Set one of those up before first sign-in or
nobody can get in.

All DB access lives in `repositories/`, one class per table, raw SQL, no ORM.
Keep it engine-agnostic — SQLite is v1, Postgres + pgvector is the target, and
SQLite-specific SQL must not leak into business logic.

## Admin CLI

Break-glass administration against the database directly — bootstrapping the
first org, or minting a key for a headless machine. Takes `--db <path>`,
otherwise `DATABASE_PATH`.

```sh
bun packages/service/src/admin-cli.ts add-org <slug> [--name "<display name>"] --admins <login,login>
bun packages/service/src/admin-cli.ts add-repo <host/owner/name> --github-repo-id <id> --installation-id <n> --org <slug>
bun packages/service/src/admin-cli.ts add-key --github-login <login> --github-id <numeric id> [--name <label>]
```

- `add-org` is the documented bootstrap path for an empty database. `--admins`
  requires at least one login.
- `add-repo` reactivates an existing repo, and refuses one already owned by
  another org.
- `add-key` prints the plaintext token once — it is stored only as a SHA-256
  hash and cannot be retrieved again.

In production, prefer the UI: org admins onboard repos and manage members
themselves, and onboarding verifies the acting user's own GitHub access to the
repo. No admin role of any kind reaches a repo GitHub says you can't see.

## API keys

`axk_` + 24 random bytes, hex. Stored as a SHA-256 hash, scope `["ingest"]`, no
expiry. Returned exactly once at mint time.

Developers get one through browser device auth: `aznex-worker setup` opens
`<SERVICE_URL>/cli-auth?port=…&state=…`, the signed-in user clicks Approve, and
the CLI exchanges a single-use 5-minute code at `POST /api/cli-auth/exchange`.
That endpoint is unauthenticated by design — the code *is* the credential, and
it is burned even on a failed exchange.

Users manage their own keys at `GET /api/keys` and
`POST /api/keys/:id/revoke`. Org admins see and revoke their members' keys under
`/api/orgs/:orgId/keys`.

**Removing an org member does not revoke their keys.** Membership removal denies
their next request, so the key grants nothing on its own — but the rows stay
valid, and should be revoked explicitly when someone leaves.

## Write path

The service is a **dumb store** on writes. All extraction intelligence lives in
the worker; there are no LLM calls server-side. Ingest validates auth, runs the
authoritative secret re-scan (the second of two mandatory passes), and persists.
Rejection is per-memory, and writes are idempotent on `session.id` and
`memory.id`, so a worker retry can't duplicate anything.

Anchors are derived server-side from `files_read ∪ files_modified`; every
extracted field — `title`, `narrative`, `facts`, `concepts`, both file lists —
is stored and indexed by FTS5.
