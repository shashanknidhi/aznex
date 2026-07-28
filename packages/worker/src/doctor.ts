import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { CONFIG_PATH, loadWorkerConfig } from "./config.js";
import { extractionModel, resolveExtractionEngine } from "./extract.js";
import { codexHooksRegistered, codexMcpRegistered } from "./codex-hooks.js";
import { LOG_FILE, PLIST_PATH, SYSTEMD_UNIT_PATH } from "../daemon/templates.js";

// `aznex-worker doctor` — read-only install diagnostics (claude-mem pattern).
// Every check reports ok/warn/fail with a remediation hint; exit 1 only on
// fails, so warns don't break CI use.

export interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail?: string;
  fix?: string;
}

export interface DoctorDeps {
  configPath?: string;
  claudeSettingsPath?: string;
  claudeJsonPath?: string;
  codexHome?: string;
  pluginDirs?: string[];
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
}

const HOOK_EVENTS = ["PostToolUse", "Stop", "SessionEnd", "SessionStart", "PreToolUse"];
// Where an installed aznex plugin would live (marketplace clone or version cache).
export const DEFAULT_PLUGIN_DIRS = [
  join(homedir(), ".claude", "plugins", "marketplaces", "aznex"),
  join(homedir(), ".claude", "plugins", "cache", "aznex"),
];

export function aznexPluginInstalled(dirs: string[] = DEFAULT_PLUGIN_DIRS): boolean {
  return dirs.some((d) => existsSync(d));
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export async function runChecks(deps: DoctorDeps = {}): Promise<CheckResult[]> {
  const configPath = deps.configPath ?? CONFIG_PATH;
  const settingsPath = deps.claudeSettingsPath ?? join(homedir(), ".claude", "settings.json");
  const claudeJsonPath = deps.claudeJsonPath ?? join(homedir(), ".claude.json");
  const doFetch = deps.fetchImpl ?? fetch;
  const platform = deps.platform ?? process.platform;
  const results: CheckResult[] = [];
  const config = loadWorkerConfig(configPath);

  // 1. config
  if (!config.serviceUrl || !config.apiKey) {
    results.push({
      name: "config",
      status: "fail",
      detail: `${configPath} missing or incomplete`,
      fix: "run: npx aznex-worker setup",
    });
  } else {
    results.push({ name: "config", status: "ok", detail: config.serviceUrl });
  }

  // 2. extraction engine + model (configured agent, or claude-then-codex)
  try {
    const { engine, path } = resolveExtractionEngine(configPath);
    results.push({
      name: "extraction engine",
      status: "ok",
      detail: `${engine} ${extractionModel(engine, configPath)} (${path})`,
    });
  } catch {
    const pinned = config.extractAgent;
    results.push({
      name: "extraction engine",
      status: "fail",
      detail: pinned === "auto" ? "neither claude nor codex found" : `${pinned} pinned but not found`,
      fix: "install Claude Code or Codex, or export CLAUDE_CODE_PATH / CODEX_PATH",
    });
  }

  // 3. daemon installed
  const unitPath = platform === "darwin" ? PLIST_PATH : SYSTEMD_UNIT_PATH;
  results.push(
    existsSync(unitPath)
      ? { name: "daemon installed", status: "ok", detail: unitPath }
      : { name: "daemon installed", status: "fail", detail: `${unitPath} not found`, fix: "run: npx aznex-worker setup" },
  );

  // 4. worker running
  const workerUrl = `http://localhost:${config.workerPort}`;
  const health = await doFetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
  results.push(
    health?.ok
      ? { name: "worker running", status: "ok", detail: workerUrl }
      : {
          name: "worker running",
          status: "fail",
          detail: `no response on ${workerUrl}/health`,
          fix:
            platform === "darwin"
              ? `launchctl kickstart -k gui/$(id -u)/ai.aznex.worker  (logs: ${LOG_FILE})`
              : `systemctl --user restart aznex-worker  (logs: ${LOG_FILE})`,
        },
  );

  // 5+6. service reachable / API key valid (skip when unconfigured)
  if (config.serviceUrl && config.apiKey) {
    const svc = await doFetch(`${config.serviceUrl}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    results.push(
      svc?.ok
        ? { name: "service reachable", status: "ok", detail: config.serviceUrl }
        : { name: "service reachable", status: "fail", detail: `${config.serviceUrl}/health unreachable`, fix: "check the URL; ask your admin if the service is up" },
    );

    const authed = await doFetch(`${config.serviceUrl}/api/repos`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (authed?.ok) {
      results.push({ name: "API key", status: "ok" });
    } else if (authed?.status === 401) {
      results.push({ name: "API key", status: "fail", detail: "rejected (401)", fix: "re-run setup to re-authorize this device" });
    } else {
      results.push({ name: "API key", status: "warn", detail: `check inconclusive (${authed?.status ?? "no response"})` });
    }
  }

  // 7. hooks registered (settings.json channel, plugin channel as fallback)
  const settings = readJson(settingsPath);
  const hooks = (settings?.["hooks"] ?? {}) as Record<string, { hooks?: { command?: string }[] }[]>;
  const registered = HOOK_EVENTS.filter((e) =>
    hooks[e]?.some((entry) => entry.hooks?.some((h) => h.command?.includes("claude-code-hook.ts"))),
  );
  if (registered.length === HOOK_EVENTS.length) {
    results.push({ name: "Claude Code hooks", status: "ok", detail: "all events registered" });
  } else if (aznexPluginInstalled(deps.pluginDirs)) {
    results.push({ name: "Claude Code hooks", status: "ok", detail: "via aznex plugin" });
  } else if (registered.length > 0) {
    const missing = HOOK_EVENTS.filter((e) => !registered.includes(e));
    results.push({ name: "Claude Code hooks", status: "warn", detail: `missing: ${missing.join(", ")}`, fix: "re-run setup to add the new hook events" });
  } else {
    results.push({ name: "Claude Code hooks", status: "fail", detail: "no aznex hooks in settings.json", fix: "run: npx aznex-worker setup (or install the aznex plugin)" });
  }

  // 8. MCP registered (warn-only — reads still work via other agents)
  const claudeJson = readJson(claudeJsonPath);
  const mcpServers = (claudeJson?.["mcpServers"] ?? {}) as Record<string, unknown>;
  const projects = (claudeJson?.["projects"] ?? {}) as Record<string, { mcpServers?: Record<string, unknown> }>;
  const projectScoped = Object.keys(projects).filter((p) => projects[p]?.mcpServers?.["aznex"]);
  if (mcpServers["aznex"]) {
    results.push({ name: "Claude Code MCP (reads)", status: "ok" });
  } else if (aznexPluginInstalled(deps.pluginDirs)) {
    results.push({ name: "Claude Code MCP (reads)", status: "ok", detail: "via aznex plugin (stdio proxy)" });
  } else if (projectScoped.length > 0) {
    // pre-v0.1.4 setups registered project-scope; memory then only reaches those repos
    results.push({
      name: "Claude Code MCP (reads)",
      status: "warn",
      detail: `registered only for ${projectScoped.length} project(s), not user-wide`,
      fix: `claude mcp remove aznex; then: claude mcp add aznex -s user --transport http ${config.serviceUrl}/mcp --header "Authorization: Bearer <your key>"`,
    });
  } else {
    results.push({
      name: "Claude Code MCP (reads)",
      status: "warn",
      detail: "aznex not in Claude Code's user-scope MCP servers",
      fix: config.serviceUrl
        ? `claude mcp add aznex -s user --transport http ${config.serviceUrl}/mcp --header "Authorization: Bearer <your key>"`
        : "run: npx aznex-worker setup",
    });
  }

  // 9. Codex integration — skipped entirely when Codex isn't installed, so a
  // Claude-Code-only machine sees no noise.
  const codexHome = deps.codexHome ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex");
  if (existsSync(codexHome)) {
    const codexHooks = readJson(join(codexHome, "hooks.json"));
    if (codexHooks !== null && codexHooksRegistered(codexHooks)) {
      results.push({
        name: "Codex hooks",
        status: "ok",
        // Trust is per-machine state we can't read; say so rather than imply capture is proven.
        detail: "registered (approve once in `codex` if Codex sessions capture nothing)",
      });
    } else {
      results.push({
        name: "Codex hooks",
        status: "warn",
        detail: `no aznex relays in ${join(codexHome, "hooks.json")}`,
        fix: "run: npx aznex-worker setup --agents claude-code,codex",
      });
    }

    const codexConfig = join(codexHome, "config.toml");
    const codexToml = existsSync(codexConfig) ? readFileSync(codexConfig, "utf-8") : "";
    results.push(
      codexMcpRegistered(codexToml)
        ? { name: "Codex MCP (reads)", status: "ok" }
        : {
            name: "Codex MCP (reads)",
            status: "warn",
            detail: "aznex not in Codex's mcp_servers",
            fix: "run: npx aznex-worker setup --agents claude-code,codex",
          },
    );
  }

  return results;
}

const ICONS = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m" };

export function printReport(results: CheckResult[]): number {
  for (const r of results) {
    console.log(`${ICONS[r.status]} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    if (r.fix && r.status !== "ok") console.log(`    \x1b[2m${r.fix}\x1b[0m`);
  }
  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;
  console.log(
    fails > 0
      ? `\n${fails} check(s) failed`
      : warns > 0
        ? `\nall required checks passed (${warns} warning(s))`
        : "\nall checks passed",
  );
  return fails > 0 ? 1 : 0;
}
