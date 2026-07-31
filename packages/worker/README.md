# @aznex/worker

Local long-running background worker that runs on each developer's machine.

Receives lifecycle hook payloads from a coding agent (Claude Code, Codex, etc.), compresses raw tool output into structured observations, runs LLM extraction to distill durable learnings, performs client-side secret scrubbing, and POSTs the processed memory to the Aznex service.

Hooks always return immediately — payloads are queued on `POST /hook` and processed by an async drain loop, so the agent/IDE never waits on processing.

## Developer install (no repo clone needed)

One command — installs Bun if missing, installs this package, runs setup.
Auth happens in your browser (GitHub login on the Aznex web app), no key to
copy around:

```sh
curl -fsSL https://<your-app>.up.railway.app/install.sh | bash
```

Or manually with [Bun](https://bun.sh) already installed:

```sh
bun install -g @aznex/worker
aznex-worker setup --service-url https://<your-app>.up.railway.app
```

Headless/CI machines can skip the browser flow by passing their key via the `--api-key` flag.

Prereq either way: Claude Code **or** Codex — extraction spawns whichever CLI
is installed (claude preferred). Setup reuses the API key already in
`~/.aznex/config.json` when it still authenticates (`--new-key` forces a fresh
one), validates the URL + key against the live service, writes
`~/.aznex/config.json` (0600 — the daemon reads this, since launchd/systemd
don't see your shell env), installs the login daemon, wires the capture hooks
for every supported agent on your PATH (`~/.claude/settings.json` and/or
`~/.codex/hooks.json`), and registers the MCP server for reads.
`aznex-worker uninstall` removes the daemon.

## Publishing (maintainers)

CI publishes both packages when you push a version tag (`.github/workflows/release.yml`):

```sh
# bump "version" in packages/shared/package.json AND packages/worker/package.json, then:
git tag v0.1.1 && git push origin v0.1.1
```

The workflow gates on typecheck + tests, refuses a tag that doesn't match the
package versions, and skips versions already on npm (safe to re-run). Auth is
npm **trusted publishing** (OIDC — no token secret): configure each package
once on npmjs.com under Settings → Trusted Publisher (GitHub Actions, repo
`shashanknidhi/aznex`, workflow `release.yml`).
Both packages publish from TS source — no build step; `bun publish` rewrites
the `workspace:*` dependency to the pinned version.

Deployment is separate: Railway auto-deploys every push to `main` (build and
healthcheck come from `railway.json`).

## Updates

The daemon self-updates: on start and daily it checks npm, installs a newer
`@aznex/worker` if one exists, and restarts itself via the daemon manager.
Set `AZNEX_AUTO_UPDATE=off` to pin a version (then update manually with
`bun install -g @aznex/worker@latest`).

Because the check is daily, trailing a fresh release by up to 24h is normal —
a release published just after your daemon started won't land until the next
check. Every check logs its outcome to `~/.aznex/logs/worker.log`
(`self-update: 0.1.12 is current (latest 0.1.12)`), so you can tell "up to
date" from "registry unreachable" instead of guessing at silence.

## Commands

```
aznex-worker setup --service-url <url> [--api-key <key>] [--new-key] [--agents claude-code,codex]
                     install everything: config + daemon + hooks + MCP. Reuses a
                     valid stored key; --new-key forces a fresh one. Without
                     --agents, wires whichever of claude/codex is on PATH.
aznex-worker --version
                     print the installed version. The running daemon may still
                     be on an older one until it restarts — `doctor` compares
                     against npm, and the daemon logs its version at startup
aznex-worker doctor  check the install — read-only, exits 1 on failure
aznex-worker serve   run the worker in the foreground (what the daemon runs)
aznex-worker hook [context|file-context]
                     forward one hook event from stdin; this is what the
                     installed hook scripts invoke
aznex-worker mcp     stdio→HTTP MCP proxy, used by the Claude Code plugin so the
                     plugin's .mcp.json needs no API key in it
aznex-worker uninstall
                     remove the daemon (config and hooks are left in place)
```

## Run

```sh
bun run --cwd packages/worker dev   # starts on :29639 (AZNEX_WORKER_PORT to change)
```

Foreground, for development — no daemon, no hook wiring. Local HTTP surface,
loopback only: `GET /health`, `POST /hook` (`?agent=codex` to tag the source),
`POST /context`, `POST /file-context`, `GET /` (settings page), and
`GET|POST /api/settings`.

## Environment

Env vars win over `~/.aznex/config.json` (written by setup); the daemon reads
the file since it never sees your shell env.

| Variable | Default | Purpose |
|---|---|---|
| `AZNEX_WORKER_PORT` | `29639` | Port the worker listens on (loopback only) |
| `AZNEX_WORKER_URL` | `http://localhost:29639` | Where hook scripts send events |
| `AZNEX_SERVICE_URL` | from config file | Remote service to POST memories to |
| `AZNEX_API_KEY` | from config file | Bearer key for `/v1/ingest` |
| `AZNEX_EXTRACT_AGENT` | `auto` | Which CLI runs extraction: `auto` (Claude Code, else Codex), `claude`, or `codex`. An explicit value fails loud if that CLI is missing. |
| `AZNEX_EXTRACT_MODEL` | cheapest for the agent | Model passed as `--model`. Must be one the settings page lists for the active agent — `claude-haiku-4-5` for Claude Code, `gpt-5.6-luna` for Codex. |

## Two GitHub accounts on one machine

Aznex checks access as *you*, per repo — a work key on a personal repo is
denied and vice versa. If you use two GitHub accounts, give the second one its
own key, keyed by GitHub owner.

Easiest path: mint a key for the second account with `aznex-worker setup
--new-key` (signed into that GitHub account in your browser), put your original
key back as the default, then open <http://localhost:29639/> → **Advanced —
more than one GitHub account** and add the owner + key there.

The equivalent by hand, in `~/.aznex/config.json`:

```json
{
  "serviceUrl": "https://aznex.example.com",
  "apiKey": "axk_personal",
  "apiKeys": { "acme-inc": "axk_work" }
}
```

Anything under `github.com/acme-inc/…` — reads and writes both — goes out as
the work identity; everything else uses `apiKey`. Owner match is
case-insensitive. Nothing to switch: the identity follows the repo, not a
global toggle, so both accounts work in the same session.

The file is re-read on every session, so no daemon restart is needed. The
second account must already be a member of the Aznex org that owns those repos
— a key picks the identity, it doesn't grant access.

Reads follow the same routing **only if** the MCP server goes through the
proxy. The plugin already does; `aznex-worker setup` bakes a single key into
`~/.claude.json` instead, so re-register it once:

```sh
claude mcp remove aznex -s user
claude mcp add aznex -s user -- aznex-worker mcp
```

## Claude Code hook setup

`aznex-worker setup` wires this automatically into your global
`~/.claude/settings.json`. For a manual/per-project install instead, add:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "bun /path/to/aznex/packages/worker/hooks/claude-code-hook.ts" }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "bun /path/to/aznex/packages/worker/hooks/claude-code-hook.ts" }
        ]
      }
    ]
  }
}
```

Claude Code pipes the hook event JSON to the script's stdin; the script forwards it to the worker with a 2-second timeout and always exits 0, so a stopped worker never stalls the agent. Set `AZNEX_WORKER_URL` in your shell (or inline in the hook `command`) if the default doesn't fit.

## Codex hook setup

`aznex-worker setup` wires Codex too whenever the `codex` binary is on your
PATH (or explicitly: `--agents claude-code,codex`). It writes curl relays into
`~/.codex/hooks.json` and an `[mcp_servers.aznex]` block into
`~/.codex/config.toml`.

**One manual step:** Codex refuses to run hooks it has not been told to trust.
Start `codex` once interactively and accept the hook review prompt — until you
do, Codex sessions capture nothing and `hooks.json` is inert. Nothing on the
CLI can grant that trust for you (`--dangerously-bypass-hook-trust` exists but
is per-invocation and, as named, not something setup should do on your behalf).

Codex's hook payloads are contract-compatible with Claude Code's — same
PascalCase `hook_event_name`, same `cwd`/`session_id`/`tool_name`/`tool_input`/
`tool_response` fields, same `hookSpecificOutput.additionalContext` reply — so
the worker endpoints are shared. Two differences the adapter handles:

| | Claude Code | Codex |
|---|---|---|
| Config | `~/.claude/settings.json` | `~/.codex/hooks.json` (+ trust approval) |
| `PostToolUse` matcher | `*` | `.*` (matchers are regexes) |
| Agent identity | implicit | relay URL carries `?agent=codex` |

Capture is registered for `PostToolUse`, `Stop`, `SessionEnd`, and context
injection for `SessionStart`. File-anchored injection (`PreToolUse`) is
Claude-Code-only for now: it keys off `tool_input.file_path`, and Codex reads
files through the shell instead.

Codex plugins can declare hooks in their manifest, but that channel is dead as
of Codex 0.144 (`codex features list` → `plugin_hooks  removed`), which is why
the integration writes `hooks.json` directly.

## Run as a daemon

```sh
bun packages/worker/daemon/install.ts              # install + start (launchd/systemd --user)
bun packages/worker/daemon/install.ts --uninstall  # stop + remove
```

The worker then starts at login and is restarted within ~2 seconds if it
crashes. Logs go to `~/.aznex/logs/worker.log` (rotated past 10 MB on daemon
restart, one generation kept).
