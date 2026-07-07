#!/usr/bin/env bun
// aznex-setup — one-command developer install.
//
//   bun packages/worker/setup.ts --service-url https://aznex.up.railway.app --api-key axk_…
//   bun packages/worker/setup.ts --uninstall
//
// Does four things: validates the service URL + API key against the live
// service, writes ~/.aznex/config.json (0600 — the daemon can't see shell
// env), installs the login daemon, and wires the Claude Code capture hooks
// globally. Prints the MCP command for reads at the end.
import { dirname, join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { createInterface } from "readline/promises";
import { CONFIG_PATH } from "./src/config.js";
import { findClaude } from "./src/extract.js";
import { mergeClaudeSettings } from "./src/claude-settings.js";
import { installDaemon, uninstallDaemon } from "./daemon/install.js";
import { LOG_FILE } from "./daemon/templates.js";

const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim();
  rl.close();
  return answer;
}

async function validate(serviceUrl: string, apiKey: string): Promise<void> {
  const health = await fetch(`${serviceUrl}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`service unreachable: ${serviceUrl}/health`);
  const authed = await fetch(`${serviceUrl}/api/repos`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (authed.status === 401) throw new Error("API key rejected (401) — ask your admin for a fresh key");
  if (!authed.ok) throw new Error(`API key check failed: ${authed.status}`);
}

if (import.meta.main) {
  if (process.argv.includes("--uninstall")) {
    console.log(`daemon removed: ${uninstallDaemon()}`);
    console.log(`(kept ${CONFIG_PATH} and Claude hooks — delete manually if wanted)`);
    process.exit(0);
  }

  const serviceUrl = (flag("service-url") ?? (await ask("Aznex service URL: "))).replace(/\/+$/, "");
  const apiKey = flag("api-key") ?? (await ask("API key (axk_…): "));
  if (!serviceUrl || !apiKey) {
    console.error("usage: setup.ts --service-url <url> --api-key <axk_…>");
    process.exit(1);
  }

  // Extraction spawns the local `claude` binary — fail setup loudly now rather
  // than have the daemon silently produce nothing later.
  try {
    findClaude();
  } catch {
    console.error("✗ `claude` executable not found. Install Claude Code first (or set CLAUDE_CODE_PATH).");
    process.exit(1);
  }

  console.log("→ validating against the service…");
  try {
    await validate(serviceUrl, apiKey);
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  console.log(`→ writing ${CONFIG_PATH}`);
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify({ serviceUrl, apiKey }, null, 2) + "\n");
  chmodSync(CONFIG_PATH, 0o600);

  console.log("→ installing worker daemon");
  const unit = installDaemon();
  console.log(`  ${unit} (logs: ${LOG_FILE})`);

  console.log(`→ wiring Claude Code hooks in ${CLAUDE_SETTINGS}`);
  const hookScript = join(dirname(new URL(import.meta.url).pathname), "hooks", "claude-code-hook.ts");
  const hookCommand = `${process.execPath} ${hookScript}`;
  const existing = existsSync(CLAUDE_SETTINGS)
    ? (JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf-8")) as Record<string, unknown>)
    : {};
  const { settings, added } = mergeClaudeSettings(existing, hookCommand);
  if (added.length > 0) {
    mkdirSync(dirname(CLAUDE_SETTINGS), { recursive: true });
    writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n");
    console.log(`  added hooks: ${added.join(", ")}`);
  } else {
    console.log("  hooks already present — unchanged");
  }

  console.log(`
✓ setup complete. Capture is live for Claude Code sessions.

For reads (any MCP-capable agent):
  Claude Code:
    claude mcp add aznex --transport http ${serviceUrl}/mcp --header "Authorization: Bearer ${apiKey.slice(0, 8)}…"
    (use your full key)
  Codex / other agents: point their MCP config at ${serviceUrl}/mcp with the same Authorization header.
`);
}
