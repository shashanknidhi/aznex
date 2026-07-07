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

Prereq either way: Claude Code. Setup validates the URL + key
against the live service, writes `~/.aznex/config.json` (0600 — the daemon
reads this, since launchd/systemd don't see your shell env), installs the
login daemon, wires the Claude Code capture hooks globally in
`~/.claude/settings.json`, and prints the MCP command for reads.
`aznex-worker uninstall` removes the daemon.

## Publishing (maintainers)

Both packages publish from TS source — no build step. `bun publish` rewrites
the `workspace:*` dependency to the real version.

```sh
npm login                                   # owner of the aznex npm org
bun publish --cwd packages/shared
bun publish --cwd packages/worker
```

Bump both versions together; the worker pins `@aznex/shared` at publish time.

## Run

```sh
bun run --cwd packages/worker dev   # starts on :3001 (AZNEX_WORKER_PORT to change)
```

## Environment

Env vars win over `~/.aznex/config.json` (written by setup); the daemon reads
the file since it never sees your shell env.

| Variable | Default | Purpose |
|---|---|---|
| `AZNEX_WORKER_PORT` | `3001` | Port the worker listens on (loopback only) |
| `AZNEX_WORKER_URL` | `http://localhost:3001` | Where hook scripts send events |
| `AZNEX_SERVICE_URL` | from config file | Remote service to POST memories to |
| `AZNEX_API_KEY` | from config file | Bearer key for `/v1/ingest` |

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

## Run as a daemon

```sh
bun packages/worker/daemon/install.ts              # install + start (launchd/systemd --user)
bun packages/worker/daemon/install.ts --uninstall  # stop + remove
```

The worker then starts at login and is restarted within ~2 seconds if it
crashes. Logs go to `~/.aznex/logs/worker.log` (rotated past 10 MB on daemon
restart, one generation kept).
