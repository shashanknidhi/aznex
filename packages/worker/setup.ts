#!/usr/bin/env bun
// aznex-worker setup — one-command developer install.
//
//   aznex-worker setup --service-url https://aznex.up.railway.app [--api-key]
//   aznex-worker setup --uninstall
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
import { mergeClaudeSettings } from "./src/claude-settings.js";
import { findClaude } from "./src/extract.js";
import { browserAuth } from "./src/browser-auth.js";
import { installDaemon, uninstallDaemon } from "./daemon/install.js";
import { LOG_FILE } from "./daemon/templates.js";

const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");

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
  if (authed.status === 401) throw new Error("API key rejected (401) — re-run setup to authorize this device again");
  if (!authed.ok) throw new Error(`API key check failed: ${authed.status}`);
}

export async function runSetup(args: string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  if (args.includes("--uninstall")) {
    console.log(`daemon removed: ${uninstallDaemon()}`);
    console.log(`(kept ${CONFIG_PATH} and Claude hooks — delete manually if wanted)`);
    return;
  }

  // Extraction spawns the local `claude` binary — resolve it NOW, in the
  // user's shell where PATH works, and persist it: the daemon runs under
  // launchd/systemd with a minimal PATH and would never find it.
  let claudePath: string;
  try {
    claudePath = findClaude();
  } catch {
    console.error("✗ `claude` executable not found. Install Claude Code first (or set CLAUDE_CODE_PATH).");
    process.exit(1);
  }

  const serviceUrl = (flag("service-url") ?? (await ask("Aznex service URL: "))).replace(/\/+$/, "");
  if (!serviceUrl) {
    console.error("usage: aznex-worker setup --service-url <url> [--api-key]");
    process.exit(1);
  }

  // Default: browser login (GitHub OAuth on the Aznex web app) mints the key.
  // The api-key flag is the headless/CI fallback.
  let apiKey = flag("api-key");
  if (!apiKey) {
    try {
      apiKey = await browserAuth(serviceUrl);
      console.log("✓ device authorized");
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : err}`);
      console.error("  (headless machine? re-run and pass your key via the api-key flag)");
      process.exit(1);
    }
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
  writeFileSync(CONFIG_PATH, JSON.stringify({ serviceUrl, apiKey, claudePath }, null, 2) + "\n");
  chmodSync(CONFIG_PATH, 0o600);

  console.log("→ installing worker daemon");
  const unit = installDaemon();
  console.log(`  ${unit} (logs: ${LOG_FILE})`);

  console.log(`→ wiring Claude Code hooks in ${CLAUDE_SETTINGS}`);
  // Absolute bun path + absolute script path: hooks and daemons run without
  // your shell PATH, and this works from a global npm/bun install or a clone.
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
    claude mcp add aznex -s user --transport http ${serviceUrl}/mcp --header "Authorization: Bearer ${apiKey}"
    (-s user makes it available in every repo; re-running? \`claude mcp remove aznex\` first)
  Codex / other agents: point their MCP config at ${serviceUrl}/mcp with the same Authorization header.
`);
}

if (import.meta.main) await runSetup(process.argv.slice(2));
