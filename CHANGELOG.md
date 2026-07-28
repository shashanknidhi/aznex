# Changelog

All notable changes to this project are documented here.

Versions cover the published npm packages `@aznex/shared` and `@aznex/worker`
(they share one version number). The service and frontend ship continuously to
Railway on every push to `main` and are not versioned separately.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning is [SemVer](https://semver.org/spec/v2.0.0.html). Pre-1.0, minor
bumps stay at `0.1.x` and patch numbers carry both features and fixes.

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
