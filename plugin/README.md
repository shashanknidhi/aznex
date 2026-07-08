# Aznex plugin for Claude Code

Team-shared institutional memory: this plugin wires the Claude Code hooks that
capture your sessions and inject your team's memory back — session-start
context, file-anchored context on Read, and capture on tool use / stop.

## Install

```
/plugin marketplace add shashanknidhi/aznex
/plugin install aznex@aznex
```

The plugin only registers hooks. The hooks talk to the local aznex worker, so
you still need the one-time worker setup (auth + background daemon):

```
npx aznex-worker setup
```

Requires [Bun](https://bun.sh). Setup authenticates via your browser, writes
`~/.aznex/config.json`, and installs a login daemon (launchd/systemd).

> Already ran `aznex-worker setup`? It registers the same hooks globally in
> `~/.claude/settings.json` — the plugin is an alternative channel, you don't
> need both.

## Reads (MCP)

Memory queries go straight to your team's aznex service over HTTP MCP. Your
API key lives in `~/.aznex/config.json` — it is deliberately not bundled here.
Register once:

```
claude mcp add aznex -s user --transport http <serviceUrl>/mcp --header "Authorization: Bearer <apiKey>"
```

(`aznex-worker setup` prints this command with your values filled in.)

## Settings

The worker serves a local settings page at http://localhost:29639 —
extraction model, context-injection knobs, worker port. If you change the
port, export `AZNEX_WORKER_URL` so these hooks can still find the worker.
