import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";

// Worker config: env vars win; ~/.aznex/config.json (written by setup.ts) is
// the fallback so the daemonized worker works without shell env — launchd and
// systemd user units don't inherit your dotfiles.

export const CONFIG_PATH = join(homedir(), ".aznex", "config.json");

export interface WorkerConfig {
  serviceUrl: string | null;
  apiKey: string | null;
  workerPort: number;
  claudePath: string | null;
}

export function loadWorkerConfig(configPath = CONFIG_PATH): WorkerConfig {
  let file: { serviceUrl?: string; apiKey?: string; workerPort?: number; claudePath?: string } = {};
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
  };
}
