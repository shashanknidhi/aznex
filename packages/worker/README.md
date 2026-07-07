# @aznex/worker

Local long-running background worker that runs on each developer's machine.

Receives lifecycle hook payloads from a coding agent (Claude Code, Codex, etc.), compresses raw tool output into structured observations, runs LLM extraction to distill durable learnings, performs client-side secret scrubbing, and POSTs the processed memory to the Aznex service.

Hooks always return immediately — payloads are queued on `POST /hook` and processed by an async drain loop, so the agent/IDE never waits on processing.

## One-command developer setup

```sh
bun packages/worker/setup.ts --service-url https://<your-app>.up.railway.app --api-key axk_…
```

Validates the URL + key against the live service, writes `~/.aznex/config.json`
(0600 — the daemon reads this, since launchd/systemd don't see your shell env),
installs the login daemon, wires the Claude Code capture hooks globally in
`~/.claude/settings.json`, and prints the MCP command for reads.
`--uninstall` removes the daemon.

## Run

```sh
bun run --cwd packages/worker dev   # starts on :3001 (AZNEX_WORKER_PORT to change)
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `AZNEX_WORKER_PORT` | `3001` | Port the worker listens on |
| `AZNEX_WORKER_URL` | `http://localhost:3001` | Where hook scripts send events |
| `AZNEX_WORKER_TOKEN` | — | Optional bearer token forwarded by hook scripts |

## Claude Code hook setup

Add to your project's `.claude/settings.json`:

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

Claude Code pipes the hook event JSON to the script's stdin; the script forwards it to the worker with a 2-second timeout and always exits 0, so a stopped worker never stalls the agent. Set `AZNEX_WORKER_URL` / `AZNEX_WORKER_TOKEN` in your shell (or inline in the hook `command`) if the defaults don't fit.

## One-command developer setup

```sh
bun packages/worker/setup.ts --service-url https://<your-app>.up.railway.app --api-key axk_…
```

Validates the URL + key against the live service, writes `~/.aznex/config.json`
(0600 — the daemon reads this, since launchd/systemd don't see your shell env),
installs the login daemon, wires the Claude Code capture hooks globally in
`~/.claude/settings.json`, and prints the MCP command for reads.
`--uninstall` removes the daemon.

## Run as a daemon

```sh
bun packages/worker/daemon/install.ts              # install + start (launchd/systemd --user)
bun packages/worker/daemon/install.ts --uninstall  # stop + remove
```

The worker then starts at login and is restarted within ~2 seconds if it
crashes. Logs go to `~/.aznex/logs/worker.log` (rotated past 10 MB on daemon
restart, one generation kept).
