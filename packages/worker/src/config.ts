import { join, dirname } from "path";
import { homedir } from "os";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "fs";

// Worker config: env vars win; ~/.aznex/config.json (written by setup.ts) is
// the fallback so the daemonized worker works without shell env — launchd and
// systemd user units don't inherit your dotfiles.

export const CONFIG_PATH = join(homedir(), ".aznex", "config.json");

export interface WorkerConfig {
  serviceUrl: string | null;
  apiKey: string | null;
  workerPort: number;
  claudePath: string | null;
  codexPath: string | null;
  extractModel: string | null;
  contextEnabled: boolean;
  contextMemoryCount: number;
  fileContextEnabled: boolean;
}

export interface ConfigFile {
  serviceUrl?: string;
  apiKey?: string;
  workerPort?: number;
  claudePath?: string;
  codexPath?: string;
  extractModel?: string;
  contextEnabled?: boolean;
  contextMemoryCount?: number;
  fileContextEnabled?: boolean;
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
    // 29639 = "AZNEX" on a phone keypad — high registered range, clear of the
    // 3000-3010 dev-server belt where collisions are silent and confusing.
    workerPort: Number(process.env["AZNEX_WORKER_PORT"] ?? file.workerPort ?? 29639),
    claudePath: process.env["CLAUDE_CODE_PATH"] ?? file.claudePath ?? null,
    codexPath: process.env["CODEX_PATH"] ?? file.codexPath ?? null,
    extractModel: process.env["AZNEX_EXTRACT_MODEL"] ?? file.extractModel ?? null,
    // Context-injection knobs are file-only (set via the settings page) —
    // no env vars until someone actually needs them.
    contextEnabled: file.contextEnabled ?? true,
    contextMemoryCount: file.contextMemoryCount ?? 10,
    fileContextEnabled: file.fileContextEnabled ?? true,
  };
}
