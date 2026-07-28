import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { dirname } from "path";
import { CONFIG_PATH, loadWorkerConfig, type WorkerConfig } from "./config.js";
import { resolveExtractionEngine } from "./extract.js";
import { MODELS, isKnownModel, resolveModel, type Engine } from "./models.js";

// Settings surface for the worker's local page. Only worker-tuning fields are
// writable — serviceUrl/apiKey/claudePath belong to `aznex-worker setup` and
// the API never returns the apiKey at all.

const EDITABLE = [
  "extractAgent",
  "extractModel",
  "workerPort",
  "contextEnabled",
  "contextMemoryCount",
  "fileContextEnabled",
] as const;
type EditableKey = (typeof EDITABLE)[number];

const ENV_FOR: Partial<Record<EditableKey, string>> = {
  extractAgent: "AZNEX_EXTRACT_AGENT",
  extractModel: "AZNEX_EXTRACT_MODEL",
  workerPort: "AZNEX_WORKER_PORT",
};

function withoutSecrets(config: WorkerConfig): Omit<WorkerConfig, "apiKey"> {
  const { apiKey: _apiKey, ...rest } = config;
  return rest;
}

/**
 * Which engine an "auto" setting actually lands on. Only informational — the
 * page uses it to pick the right model list — so a machine with neither CLI
 * installed falls back to claude's list rather than erroring the whole page.
 */
function activeEngine(configPath: string, agent: WorkerConfig["extractAgent"]): Engine {
  if (agent !== "auto") return agent;
  try {
    return resolveExtractionEngine(configPath).engine;
  } catch {
    return "claude";
  }
}

export function getSettings(configPath = CONFIG_PATH): object {
  const config = loadWorkerConfig(configPath);
  const engine = activeEngine(configPath, config.extractAgent);
  return {
    effective: {
      ...withoutSecrets(config),
      // The page renders a <select>, so it needs a concrete id rather than the
      // null that means "whatever's cheapest".
      extractModel: resolveModel(engine, config.extractModel),
    },
    // catalog for the dropdowns — the page holds no model list of its own
    models: MODELS,
    activeEngine: engine,
    // fields the page shouldn't bother editing because an env var pins them
    envOverridden: EDITABLE.filter((k) => {
      const env = ENV_FOR[k];
      return env !== undefined && process.env[env] !== undefined;
    }),
  };
}

/** Rejected input, as opposed to a bug — the server turns this into a 400. */
export class InvalidSettingError extends Error {}

// The dropdowns can only ever submit valid pairs, but the endpoint is reachable
// with curl, and an engine/model mismatch would break extraction silently
// (`claude --model gpt-5.6-luna` just fails) rather than at save time.
function validate(body: Record<string, unknown>, stored: WorkerConfig, configPath: string): void {
  const submitted = body["extractAgent"];
  // null/"" clears the override, and the cleared default is "auto".
  const agent =
    !("extractAgent" in body) ? stored.extractAgent : submitted === null || submitted === "" ? "auto" : submitted;
  if (agent !== "auto" && agent !== "claude" && agent !== "codex") {
    throw new InvalidSettingError(`extractAgent must be auto, claude, or codex (got ${JSON.stringify(agent)})`);
  }

  const model = body["extractModel"];
  if (model === undefined || model === null || model === "") return; // clearing it = use the cheapest
  const engine = activeEngine(configPath, agent);
  if (typeof model !== "string" || !isKnownModel(engine, model)) {
    throw new InvalidSettingError(`extractModel ${JSON.stringify(model)} is not a known ${engine} model`);
  }
}

export function updateSettings(body: Record<string, unknown>, configPath = CONFIG_PATH): object {
  validate(body, loadWorkerConfig(configPath), configPath);

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
