import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { dirname } from "path";
import { CONFIG_PATH, loadWorkerConfig, type WorkerConfig } from "./config.js";

// Settings surface for the worker's local page. Only worker-tuning fields are
// writable — serviceUrl/apiKey/claudePath belong to `aznex-worker setup` and
// the API never returns the apiKey at all.

const EDITABLE = ["extractModel", "workerPort", "contextEnabled", "contextMemoryCount", "fileContextEnabled"] as const;
type EditableKey = (typeof EDITABLE)[number];

const ENV_FOR: Partial<Record<EditableKey, string>> = {
  extractModel: "AZNEX_EXTRACT_MODEL",
  workerPort: "AZNEX_WORKER_PORT",
};

function withoutSecrets(config: WorkerConfig): Omit<WorkerConfig, "apiKey"> {
  const { apiKey: _apiKey, ...rest } = config;
  return rest;
}

export function getSettings(configPath = CONFIG_PATH): object {
  return {
    effective: withoutSecrets(loadWorkerConfig(configPath)),
    // fields the page shouldn't bother editing because an env var pins them
    envOverridden: EDITABLE.filter((k) => {
      const env = ENV_FOR[k];
      return env !== undefined && process.env[env] !== undefined;
    }),
  };
}

export function updateSettings(body: Record<string, unknown>, configPath = CONFIG_PATH): object {
  let file: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      file = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // malformed file: rebuild from the editable fields only
    }
  }
  for (const key of EDITABLE) {
    if (!(key in body)) continue;
    const value = body[key];
    // null or "" clears the override back to the default
    if (value === null || value === "") delete file[key];
    else file[key] = value;
  }
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(file, null, 2) + "\n");
  chmodSync(configPath, 0o600); // may hold the apiKey
  return getSettings(configPath);
}
