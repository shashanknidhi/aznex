# @aznex/worker

Local long-running background worker that runs on each developer's machine.

Receives lifecycle hook payloads from a coding agent (Claude Code, Codex, etc.), compresses raw tool output into structured observations, runs LLM extraction to distill durable learnings, performs client-side secret scrubbing, and POSTs the processed memory to the Aznex service.

Hooks always return immediately — payloads are queued on `POST /hook` and processed by an async drain loop, so the agent/IDE never waits on processing.

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
