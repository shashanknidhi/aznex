import { join, dirname } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";

// Worker config: env vars win; ~/.aznex/config.json (written by setup.ts) is
// the fallback so the daemonized worker works without shell env — launchd and
// systemd user units don't inherit your dotfiles.

export const CONFIG_PATH = join(homedir(), ".aznex", "config.json");

// "auto" = prefer Claude Code, fall back to Codex (the historical behaviour).
// An explicit engine pins it and fails loud if that CLI isn't installed.
export type ExtractAgent = "auto" | "claude" | "codex";

export interface WorkerConfig {
  serviceUrl: string | null;
  apiKey: string | null;
  apiKeys: Record<string, string>;
  workerPort: number;
  claudePath: string | null;
  codexPath: string | null;
  extractAgent: ExtractAgent;
  extractModel: string | null;
  contextEnabled: boolean;
  contextMemoryCount: number;
  fileContextEnabled: boolean;
}

export interface ConfigFile {
  serviceUrl?: string;
  apiKey?: string;
  apiKeys?: Record<string, string>;
  workerPort?: number;
  claudePath?: string;
  codexPath?: string;
  extractAgent?: ExtractAgent;
  extractModel?: string;
  contextEnabled?: boolean;
  contextMemoryCount?: number;
  fileContextEnabled?: boolean;
}

const EXTRACT_AGENTS: readonly ExtractAgent[] = ["auto", "claude", "codex"];

// A typo in the env var or a hand-edited config shouldn't silently pin an
// engine that doesn't exist — fall back to auto-detection instead.
function parseExtractAgent(value: unknown): ExtractAgent | null {
  return EXTRACT_AGENTS.includes(value as ExtractAgent) ? (value as ExtractAgent) : null;
}

// GitHub owner names are case-insensitive; a hand-edited config that says
// "Ukumi-AI" must still match the "ukumi-ai" in a fingerprint.
function normalizeApiKeys(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [owner, key] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === "string" && key !== "") out[owner.toLowerCase()] = key;
  }
  return out;
}

/**
 * Pick the API key to use for a repo. `fingerprint` is `host/owner/name`; an
 * owner with its own key wins, otherwise the default `apiKey` applies.
 */
export function resolveApiKey(config: WorkerConfig, fingerprint: string | null): string | null {
  const owner = fingerprint?.split("/")[1]?.toLowerCase();
  return (owner ? config.apiKeys[owner] : undefined) ?? config.apiKey;
}

/**
 * Merge `patch` into the config file, preserving every field already there.
 * setup used to write the whole object, which wiped the tuning knobs the
 * settings page owns (extractModel, contextEnabled, …) on every re-run.
 */
export function writeWorkerConfig(patch: ConfigFile, configPath = CONFIG_PATH): void {
  let existing: ConfigFile = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // malformed file — the patch replaces it rather than blocking setup
    }
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ ...existing, ...patch }, null, 2) + "\n");
  chmodSync(configPath, 0o600); // holds the API key
}

export function loadWorkerConfig(configPath = CONFIG_PATH): WorkerConfig {
  let file: ConfigFile = {};
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      console.warn(`ignoring malformed config at ${configPath}`);
    }
  }
  return {
    serviceUrl: process.env["AZNEX_SERVICE_URL"] ?? file.serviceUrl ?? null,
    apiKey: process.env["AZNEX_API_KEY"] ?? file.apiKey ?? null,
    // Per-repo-owner keys, for a machine with more than one GitHub account:
    // {"apiKeys": {"ukumi-ai": "axk_work"}} sends anything under that owner as
    // the work identity, everything else as the default apiKey. Keyed by owner
    // rather than a "current account" toggle because the right identity is a
    // property of the repo, not of whatever you last switched to.
    apiKeys: normalizeApiKeys(file.apiKeys),
    // 29639 = "AZNEX" on a phone keypad — high registered range, clear of the
    // 3000-3010 dev-server belt where collisions are silent and confusing.
    workerPort: Number(process.env["AZNEX_WORKER_PORT"] ?? file.workerPort ?? 29639),
    claudePath: process.env["CLAUDE_CODE_PATH"] ?? file.claudePath ?? null,
    codexPath: process.env["CODEX_PATH"] ?? file.codexPath ?? null,
    extractAgent:
      parseExtractAgent(process.env["AZNEX_EXTRACT_AGENT"]) ?? parseExtractAgent(file.extractAgent) ?? "auto",
    // null = "use the engine's cheapest model"; resolved at spawn time in
    // extract.ts, because which model is cheapest depends on the engine.
    extractModel: process.env["AZNEX_EXTRACT_MODEL"] ?? file.extractModel ?? null,
    // Context-injection knobs are file-only (set via the settings page) —
    // no env vars until someone actually needs them.
    contextEnabled: file.contextEnabled ?? true,
    contextMemoryCount: file.contextMemoryCount ?? 10,
    fileContextEnabled: file.fileContextEnabled ?? true,
  };
}
