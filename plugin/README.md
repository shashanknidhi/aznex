# Aznex plugin for Claude Code

Team-shared institutional memory. Bundled components:

- **Hooks** — capture (PostToolUse/Stop/SessionEnd) and team-memory injection
  (SessionStart context, file-anchored context on Read)
- **MCP server `aznex`** — 5 read tools (search, recent context, by-id,
  by-file, session timeline) via a local stdio proxy; your API key stays in
  `~/.aznex/config.json`, never in the plugin
- **Skill `mem-search`** — teaches the agent when and how to query team memory

## Install

```
/plugin marketplace add shashanknidhi/aznex
/plugin install aznex@aznex
```

The plugin's components all talk to the local aznex worker/config, so you
still need the one-time worker setup (auth + background daemon):

```
npx aznex-worker setup
```

Requires [Bun](https://bun.sh). Setup authenticates via your browser, writes
`~/.aznex/config.json`, and installs a login daemon (launchd/systemd). Check
the install anytime with `aznex-worker doctor`.

> Install the plugin **before** running setup: when setup detects the plugin
> it skips its own hooks/MCP wiring automatically (the plugin provides both).
> Machines that already used the one-liner don't need the plugin at all —
> same features, different packaging.

## Settings

The worker serves a local settings page at http://localhost:29639 —
extraction model, context-injection knobs, worker port. If you change the
port, export `AZNEX_WORKER_URL` so the hooks can still find the worker.
