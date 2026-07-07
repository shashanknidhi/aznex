import { join } from "path";
import { homedir } from "os";

// Daemon templates (#28). Pure string builders so they're unit-testable;
// install.ts does the filesystem/launchctl work.

export interface DaemonPaths {
  bunPath: string; // absolute path to the bun binary
  workerEntry: string; // absolute path to packages/worker/src/index.ts
  logFile: string;
}

export const LOG_DIR = join(homedir(), ".aznex", "logs");
export const LOG_FILE = join(LOG_DIR, "worker.log");
export const PLIST_LABEL = "ai.aznex.worker";
export const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
export const SYSTEMD_UNIT_PATH = join(
  homedir(), ".config", "systemd", "user", "aznex-worker.service",
);

export function launchdPlist(p: DaemonPaths): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${p.bunPath}</string>
    <string>${p.workerEntry}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>${p.logFile}</string>
  <key>StandardErrorPath</key><string>${p.logFile}</string>
</dict>
</plist>
`;
}

export function systemdUnit(p: DaemonPaths): string {
  return `[Unit]
Description=Aznex background worker

[Service]
ExecStart=${p.bunPath} ${p.workerEntry}
Restart=always
RestartSec=2
StandardOutput=append:${p.logFile}
StandardError=append:${p.logFile}

[Install]
WantedBy=default.target
`;
}

// ponytail: rotation runs at daemon (re)start only — a very long-lived worker
// can outgrow the cap between restarts. Move rotation in-process if that bites.
export const MAX_LOG_BYTES = 10 * 1024 * 1024;

export function rotateIfNeeded(
  size: number,
  rename: (from: string, to: string) => void,
  logFile = LOG_FILE,
): boolean {
  if (size < MAX_LOG_BYTES) return false;
  rename(logFile, `${logFile}.1`); // keep one generation
  return true;
}
