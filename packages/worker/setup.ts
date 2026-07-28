#!/usr/bin/env bun
// aznex-worker setup — one-command developer install.
//
//   aznex-worker setup --service-url https://aznex.up.railway.app [--api-key] [--agents claude-code]
//   aznex-worker setup --uninstall
//
// Everything in one shot: validates the service URL + API key against the
// live service, writes ~/.aznex/config.json (0600 — the daemon can't see
// shell env), installs the login daemon, wires the per-agent integration
// (Claude Code: capture hooks + MCP registration), and smoke-tests the
// worker. `curl <SERVICE_URL>/install.sh | bash` wraps this.
import { dirname, join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { createInterface } from "readline/promises";
import { CONFIG_PATH, loadWorkerConfig } from "./src/config.js";
import { mergeClaudeSettings } from "./src/claude-settings.js";
import { mergeCodexHooks, appendCodexMcpBlock } from "./src/codex-hooks.js";
import { findClaude } from "./src/extract.js";
import { browserAuth } from "./src/browser-auth.js";
import { installDaemon, uninstallDaemon } from "./daemon/install.js";
import { LOG_FILE } from "./daemon/templates.js";

const CLAUDE_SETTINGS = join(homedir(), ".claude", "settings.json");

// One integration per coding agent. A future multi-select prompt slots in here
// without restructuring setup.
export const SUPPORTED_AGENTS = ["claude-code", "codex"] as const;
const PLANNED_AGENTS = ["cursor", "gemini-cli"];

export function parseAgents(value: string | undefined): string[] {
  const agents = (value ?? "claude-code").split(",").map((a) => a.trim()).filter(Boolean);
  for (const agent of agents) {
    if (!(SUPPORTED_AGENTS as readonly string[]).includes(agent)) {
      const hint = PLANNED_AGENTS.includes(agent) ? "coming soon" : "unknown agent";
      throw new Error(`--agents ${agent}: ${hint}. Supported today: ${SUPPORTED_AGENTS.join(", ")}`);
    }
  }
  return agents;
}

export function buildMcpAddArgs(claudePath: string, serviceUrl: string, apiKey: string): string[] {
  return [
    claudePath, "mcp", "add", "aznex",
    "-s", "user",
    "--transport", "http",
    `${serviceUrl}/mcp`,
    "--header", `Authorization: Bearer ${apiKey}`,
  ];
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

  let agents: string[];
  try {
    agents = parseAgents(flag("agents"));
    // No explicit --agents and Codex is installed → wire it too. Capture is
    // per-agent, so an unwired Codex silently produces no memories.
    if (flag("agents") === undefined && Bun.which("codex") !== null) agents.push("codex");
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
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

  const followUps: string[] = [];
  for (const agent of agents) {
    if (agent === "claude-code") await integrateClaudeCode(claudePath, serviceUrl, apiKey);
    if (agent === "codex") followUps.push(...integrateCodex(serviceUrl, apiKey));
  }

  await smokeTestWorker();

  console.log(`
✓ setup complete for ${agents.join(", ")} — capture, context injection, and MCP reads are live.

First success:
  1. Open a Claude Code session in a repo your admin onboarded — a
     "# Team memory (aznex)" block appears at session start.
  2. Work normally, end the session — your extracted memories show up in the
     viewer (${serviceUrl}) within a minute.
${followUps.length > 0 ? `\nOne manual step left:\n${followUps.map((s) => `  - ${s}`).join("\n")}\n` : ""}
Tune the worker (extraction model, context injection): http://localhost:${loadWorkerConfig().workerPort}
Check the install anytime: aznex-worker doctor

Other agents (Cursor, Gemini CLI, …): point their MCP config at ${serviceUrl}/mcp
with the same Authorization header — capture hooks for them are coming soon.
`);
}

/**
 * Wire Codex capture + reads (#45). Returns follow-up steps the user must do
 * by hand — Codex refuses to run hooks until they are approved once in the
 * interactive TUI review, and nothing on the CLI can grant that for them.
 */
export function integrateCodex(serviceUrl: string, apiKey: string): string[] {
  const codexHome = process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
  const hooksPath = join(codexHome, "hooks.json");
  const configPath = join(codexHome, "config.toml");
  const followUps: string[] = [];

  console.log(`→ wiring Codex hooks in ${hooksPath}`);
  const existing = existsSync(hooksPath)
    ? (JSON.parse(readFileSync(hooksPath, "utf-8")) as Record<string, unknown>)
    : {};
  const { config, added, updated } = mergeCodexHooks(existing);
  if (added.length > 0 || updated.length > 0) {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(hooksPath, JSON.stringify(config, null, 2) + "\n");
    if (added.length > 0) console.log(`  added hooks: ${added.join(", ")}`);
    if (updated.length > 0) console.log(`  updated hooks to this install: ${updated.join(", ")}`);
    followUps.push(
      "Codex only runs hooks you have approved: start `codex` once and accept the\n" +
        "  hook review prompt (aznex relays). Until then Codex sessions capture nothing.",
    );
  } else {
    console.log("  hooks already present — unchanged");
  }

  console.log("→ registering MCP server (reads)");
  const toml = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const merged = appendCodexMcpBlock(toml, serviceUrl, apiKey);
  if (merged === null) {
    console.log("  [mcp_servers.aznex] already present — unchanged");
  } else {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(configPath, merged);
    console.log(`  ✓ MCP registered (aznex → ${serviceUrl}/mcp)`);
  }
  return followUps;
}

async function integrateClaudeCode(claudePath: string, serviceUrl: string, apiKey: string): Promise<void> {
  const { aznexPluginInstalled } = await import("./src/doctor.js");
  if (aznexPluginInstalled()) {
    // Plugin machines get hooks + MCP from the plugin bundle — wiring them
    // here too would double hook fire and duplicate the MCP server.
    console.log("→ aznex Claude Code plugin detected — it provides hooks + MCP; skipping settings.json wiring");
    return;
  }

  console.log(`→ wiring Claude Code hooks in ${CLAUDE_SETTINGS}`);
  // Absolute bun path + absolute script path: hooks and daemons run without
  // your shell PATH, and this works from a global npm/bun install or a clone.
  const hookScript = join(dirname(new URL(import.meta.url).pathname), "hooks", "claude-code-hook.ts");
  const hookCommand = `${process.execPath} ${hookScript}`;
  const existing = existsSync(CLAUDE_SETTINGS)
    ? (JSON.parse(readFileSync(CLAUDE_SETTINGS, "utf-8")) as Record<string, unknown>)
    : {};
  const { settings, added, updated } = mergeClaudeSettings(existing, hookCommand);
  if (added.length > 0 || updated.length > 0) {
    mkdirSync(dirname(CLAUDE_SETTINGS), { recursive: true });
    writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n");
    if (added.length > 0) console.log(`  added hooks: ${added.join(", ")}`);
    if (updated.length > 0) console.log(`  updated hooks to this install: ${updated.join(", ")}`);
  } else {
    console.log("  hooks already present — unchanged");
  }

  console.log("→ registering MCP server (reads)");
  const mcp = (args: string[]) => Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  let result = mcp(buildMcpAddArgs(claudePath, serviceUrl, apiKey));
  if (result.exitCode !== 0 && result.stderr.toString().includes("already exists")) {
    // Re-run or key rotation: replace the stale registration.
    mcp([claudePath, "mcp", "remove", "aznex", "-s", "user"]);
    result = mcp(buildMcpAddArgs(claudePath, serviceUrl, apiKey));
  }
  if (result.exitCode === 0) {
    console.log(`  ✓ MCP registered (aznex → ${serviceUrl}/mcp)`);
  } else {
    // Fail open — capture still works; hand the user the manual command.
    console.warn(`  ! MCP registration failed: ${result.stderr.toString().trim().slice(0, 200)}`);
    console.warn(`  register manually:\n    claude mcp add aznex -s user --transport http ${serviceUrl}/mcp --header "Authorization: Bearer ${apiKey}"`);
  }
}

async function smokeTestWorker(): Promise<void> {
  const port = loadWorkerConfig().workerPort;
  console.log("→ verifying worker…");
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (res?.ok) {
      console.log(`  ✓ worker ready at http://localhost:${port}`);
      return;
    }
    await Bun.sleep(500);
  }
  console.warn(`  ! worker not responding yet on port ${port} — it may still be starting.`);
  console.warn(`    check: tail ${LOG_FILE}  ·  restart: launchctl kickstart -k gui/$(id -u)/ai.aznex.worker (macOS) / systemctl --user restart aznex-worker (Linux)`);
}

if (import.meta.main) await runSetup(process.argv.slice(2));
