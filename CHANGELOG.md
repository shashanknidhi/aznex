# Changelog

All notable changes to this project are documented here.

Versions cover the published npm packages `@aznex/shared` and `@aznex/worker`
(they share one version number). The service and frontend ship continuously to
Railway on every push to `main` and are not versioned separately.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [SemVer](https://semver.org/spec/v2.0.0.html). Pre-1.0, minor
bumps stay at `0.1.x` and patch numbers carry both features and fixes.

## Unreleased

## [0.1.13] — 2026-07-31

### Added

- **Two GitHub accounts on one machine** (#97). Aznex checks access as *you*,
  per repo, so a work key on a personal repo is denied and vice versa — a
  developer with two accounts had no working setup. Keys can now be keyed by
  GitHub owner: everything under that owner, reads and writes both, uses that
  identity, and everything else uses the default. Nothing to switch — the
  identity follows the repo. Manage it at <http://localhost:29639/> under
  **Advanced — more than one GitHub account**; keys are only ever written, never
  shown back.
- **`aznex-worker --version`** (#99), and the daemon now logs its own version at
  startup — it can trail the installed one until it restarts. `doctor` compares
  against npm and warns when you are behind.
- **One active organization** (#95). The repositories page used to stack every
  org you belong to, with the onboarding controls sitting below the last one and
  nothing at the point of action naming where a repo would land. You now pick an
  active org in the header (remembered across visits) and the page, the onboard
  form and `/github/setup` all name it.
- **`GET /api/config` and `GET /api/me`** (#94), so a misconfigured deployment
  stops being indistinguishable from an empty one, plus `can_delete` per memory
  so the documented admin deletion path has a UI.
- **`admin-cli move-repo`** (#94) — re-homing a repo onboarded into the wrong
  tenant previously required direct SQL.
- Published the full setup guide as `docs/setup.md`. It had only ever existed on
  one maintainer's machine, excluded from git, so nobody outside the pilot team
  could read it.
- `docs/development.md` — how to run the whole stack from a clone. The service
  boots with no GitHub credentials at all, which makes a local look-around
  possible; that was previously undocumented.
- `CONTRIBUTING.md`, `SECURITY.md` (private vulnerability reporting),
  `CODE_OF_CONDUCT.md`, issue templates, and a pull request template.
- `bun run --cwd packages/service seed` — the demo-data seeder existed but had no
  script, so it could only be run by copying a command out of a source comment.
- Documented the fresh-database bootstrap: a new deployment has no organizations
  and sign-in needs one, so `AZNEX_ADMIN_GITHUB_LOGINS` must be set before the
  first sign-in or nobody can get in.
- Documented that removing an org member does **not** revoke their API keys, and
  the `org` / `org_membership` state machines in `docs/data-lifecycle.md`.

### Changed

- **The GitHub App now needs the `Members: read` organization permission**
  (#96), granted on the App and then approved by each org's owner on their
  installation. Without it GitHub hides org-derived access (team membership,
  default member permission, org ownership) from the collaborator check, so org
  members were told they were not collaborators. Personal-account installations
  are unaffected. No change to the security model: collaborator membership is
  still the gate and permission level is still never trusted.

### Fixed

- **A session is no longer lost when the extraction model answers in prose**
  (#98). Both engines are chat models asked to reply with JSON, not JSON-mode
  APIs, so a preamble like "Based on the session transcript…" is a normal
  output — but it crashed parsing and took the whole session with it, logging a
  stack trace that read like the daemon had died. The reply is now unwrapped
  from a preamble or a code fence, and a genuinely unusable answer drops that
  one session with a warning naming the session and repo.
- **Org members are no longer reported as strangers** (#96). A repo owned by an
  organization could tell an org owner that GitHub doesn't list them as a
  collaborator, pointing at a list that was already correct. The denial now
  names the missing App permission and who has to approve it. A repo's own owner
  is allowed without a round trip — you cannot fail your own access check.
- **"Skipped (you don't have GitHub access)" no longer covers unrelated
  failures** (#94). Two different causes were pushed into one array, so the
  response could not tell them apart and nothing was logged. Sync now reports
  which login was checked, or that the repo is owned by another org, or that the
  check errored.
- **A renamed or re-cased repo reactivates instead of silently failing** (#94) —
  `addRepo` matches on the GitHub repo id as well as the fingerprint, rather
  than colliding on a UNIQUE constraint and surfacing as another opaque "skip".
- **A filtered memory list no longer contradicts its own count** (#94). The type
  filter ran client-side over one page of 20 while the total was global, hiding
  matches on later pages; it is now applied server-side.
- **The header role badge matches the page** (#95) — it showed `org admin` while
  the page below showed you as a member. It now reflects the active org, and
  `super admin` is its own badge.
- `.env.example` advertised `AZNEX_ALLOWED_GITHUB_LOGINS` as a live
  authentication allowlist. No code has read it since org membership replaced it
  in 0.1.12. Removed, and the `AZNEX_ADMIN_GITHUB_LOGINS` description corrected
  to describe super admins.
- `.env.example` now covers every environment variable the code reads —
  `AZNEX_DB_PATH`, `CLAUDE_CODE_PATH`, `CODEX_PATH`, `CODEX_HOME`,
  `AZNEX_EXTRACT_AGENT`, `AZNEX_EXTRACT_MODEL` and `AZNEX_AUTO_UPDATE` were
  missing.
- `packages/service/README.md` listed two MCP tools; there are five.
- `packages/worker/README.md` documented three of the worker's six CLI commands.

## [0.1.12] — 2026-07-30

### Added

- **Organizations — one deployment now hosts several companies.** An `org` owns
  repos and members, so a pilot company's lead runs their own tenant instead of
  waiting on a server config change. Three roles: a **super admin** (from
  `AZNEX_ADMIN_GITHUB_LOGINS`) creates orgs and appoints their admins; an **org
  admin** manages everything inside their own org — members, those members' API
  keys, repos, and deleting any memory in the org; an **org member** reads and
  writes their org's repos they have GitHub access to. Super admins can manage
  every org but cannot read any org's memory through the API.
- **Self-service member management** — org admins add teammates by GitHub
  username in the viewer, including people who have never signed in. Removing
  someone cuts their access on the next request; the memories they captured stay
  with the team.
- **Suspend an org** — stops all of its capture, MCP reads and viewer access
  immediately, leaving its data in place. Resuming restores everything.

### Changed

- **Access is now gated twice on every request**: membership in the repo's
  organization, *and* the existing GitHub collaborator check. Previously GitHub
  alone decided, which meant removing someone from a team changed nothing — the
  git host still called them a collaborator, so their worker kept capturing.
- `@aznex/shared`: `RepoSchema` gains `org_id` (the owning organization).

### Removed

- **`AZNEX_ALLOWED_GITHUB_LOGINS`** — sign-in required editing a deployment
  environment variable and redeploying for every new person. Membership in an
  organization is the credential now, and org admins grant it themselves.

## [0.1.11] — 2026-07-28

### Added

- **Extracted memories are stored in full** — `title`, `narrative`, `facts`,
  `concepts`, `files_read` and `files_modified` now cross the wire and land in
  the database. They were being extracted by the LLM and then thrown away at
  ingestion, so full-text search only ever looked at one of the five columns it
  indexes. Searching for a phrase that appears only in a fact now works.
  Extraction provenance (prompt version and model) is stored too.
- **Delete a memory** — `DELETE /api/memories/:id`, with a delete button in the
  viewer for your own memories (admins can delete anyone's). This is the way to
  pull back a memory that is wrong, misleading, or leaked something past the
  secret scanners.

### Changed

- **All memory is team memory.** `promotion_state` (`private → pending →
  team_shared`) is gone: every memory captured against a repo is visible to
  everyone with access to that repo, from the moment it is ingested. Repo access
  is the only read gate. The promote / "make private" buttons and the
  `AZNEX_DEFAULT_PROMOTION` setting are gone with it.
- **Secret scanning covers every stored field** — client-side scrubbing and the
  server-side re-scan now run over title, narrative and facts as well as
  content, since all of those are now persisted.
- Path anchors are derived at ingestion from the memory's file lists instead of
  being sent as a separate `anchors` field.

### Removed

- **Freshness / staleness.** `freshness_state`, `confirmed_commit`,
  `memory_anchor.commit_sha` and the `include_stale` read parameter are gone.
  The staleness engine that would have set `stale_suspected` was never built, so
  the only thing the machinery did was carry a column and an unused filter.
  Memories describe code as it was when captured — verify against current code.
- The three dropped columns are removed from existing databases by schema
  migration v2 on the next service start. Rows are preserved.

## [0.1.10] — 2026-07-28

### Added

- **Pick your coding agent and extraction model** (#86) — the worker settings
  page now has dropdowns for both. Choose Claude Code, Codex, or leave it on
  auto-detect; pick a model from that agent's list. Picking an agent explicitly
  fails loudly if its CLI isn't installed, instead of quietly using the other
  one. Also settable without the page via `AZNEX_EXTRACT_AGENT` and
  `AZNEX_EXTRACT_MODEL`.
- **Extraction now defaults to the cheapest model** (#86) — `claude-haiku-4-5`
  on Claude Code, `gpt-5.6-luna` on Codex, instead of whatever each CLI defaults
  to. Extraction is a bulk summarise job, so the cheap tier is the right one and
  the expensive tiers are opt-in. Applies to existing installs with no migration.

### Changed

- `aznex-worker doctor` reports the extraction model alongside the engine, and
  says "codex pinned but not found" rather than "neither claude nor codex found"
  when you pinned one that's missing (#86).
- Memories record the model that actually extracted them, instead of the
  placeholder `claude-default` (#86).
- Release notes on GitHub are now taken from this file rather than an
  auto-generated commit list, and a release without notes fails on purpose (#86).

### Fixed

- **`setup` no longer mints a new API key on every re-run** (#85) — a stored key
  that still works is reused, so re-running setup doesn't send you through
  browser auth again. A key the service rejects still falls through to a fresh
  one.
- `setup` no longer overwrites the settings you tuned on the worker page —
  extraction model and context-injection knobs survive a re-run (#85).
- Codex is accepted as the extraction engine, so a Codex-only machine can
  onboard without Claude Code installed (#85).

## [0.1.9] — 2026-07-28

### Added

- **Codex capture adapter** (#83, closes #45) — Codex sessions now feed the same
  capture pipeline as Claude Code. Hook payloads are Claude-compatible; memories
  are attributed with `agent:codex`.
- Injected memories are listed in the visible session banner, so you can see
  exactly which memories were pulled into the context window (#82).

## [0.1.8] — 2026-07-08

### Added

- Claude Code plugin MCP server as a stdio proxy, plus the `mem-search` skill —
  memory search from inside the plugin without a separate MCP registration (#80).

## [0.1.7] — 2026-07-08

### Added

- Visible context-injection banner: the session shows when Aznex injected
  memories instead of doing it silently (#78).
- Richer MCP toolset beyond `search_memory` / `get_recent_context` (#78).

## [0.1.6] — 2026-07-08

### Added

- Single-command install: `aznex-setup` auto-registers the MCP server, and ships
  `aznex doctor` (diagnostics) and a post-install smoke test (#76).

## [0.1.5] — 2026-07-08

### Added

- Claude Code plugin packaging as a first-class install channel (#74).
- Local settings page served on the worker port (#73).
- Context-injection hooks and an expanded hook set (#72).
- Service endpoints for context and by-path reads, powering hook-driven
  injection (#71).

### Fixed

- `extract --model` flag now takes effect (#72).
- Docker: the service container loads `.env` via `env_file` (#70).

## [0.1.4] — 2026-07-08

### Fixed

- Setup registers the MCP server with `-s user` scope, so it persists across
  projects instead of being written into one project's config (#68).

## [0.1.3] — 2026-07-08

### Added

- Self-service API key management in the memory viewer (#65).

### Fixed

- Default worker port moved `3001 → 29639`, out of the range dev servers
  commonly grab (#66).
- Viewer shows the author's GitHub username instead of the internal user id (#64).

## [0.1.2] — 2026-07-08

### Added

- Memory promotion flow, with team-shared-by-default ingestion —
  `AZNEX_DEFAULT_PROMOTION` controls the default `promotion_state` (#60).
- Worker daemon self-updates from npm on a 24-hour interval (#62).

### Fixed

- Worker skips non-onboarded repos before running extraction, and names the
  reason for every dropped payload instead of dropping silently (#61).

## [0.1.1] — 2026-07-08

First published release — the Phase 1 MVP, end to end.

### Added

- **Install and auth without cloning** — npm package, `curl` installer, browser
  login (#48).
- **Worker**: HTTP server, async queue, Claude Code hook adapter (#35); full
  write pipeline `compress → extract → scrub → ingest` (#41); login daemon with
  `launchd`/`systemd` install and crash recovery (#42); `aznex-setup`
  one-command developer install (#44); extraction eval framework (#29).
- **Service**: SQLite DAL behind an engine-agnostic repository layer (#26);
  FTS5 retrieval baseline (#27); authenticated memory write path (#31); MCP
  server exposing `search_memory` and `get_recent_context` (#33); frontend read
  API (#40).
- **Shared**: data models with Zod schemas and API contracts (#2); repo
  fingerprinting utility (#32).
- **Frontend**: React memory viewer with GitHub OAuth via better-auth (#38).
- **Infra**: CI worker job and verified Docker self-host (#37); full CI coverage
  — frontend tests and build, Docker image job, lockfile fix (#46); Railway
  deployment with same-origin SPA and admin onboarding CLI (#43).

[0.1.13]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.13
[0.1.12]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.12
[0.1.11]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.11
[0.1.10]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.10
[0.1.9]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.9
[0.1.8]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.8
[0.1.7]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.7
[0.1.6]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.6
[0.1.5]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.5
[0.1.4]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.4
[0.1.3]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.3
[0.1.2]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.2
[0.1.1]: https://github.com/shashanknidhi/aznex/releases/tag/v0.1.1
