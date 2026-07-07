#!/usr/bin/env bun
// Daemon installer (#28): `bun daemon/install.ts` installs and starts the
// worker as a login daemon (launchd on macOS, systemd --user on Linux).
// `bun daemon/install.ts --uninstall` stops and removes it.
// setup.ts calls installDaemon()/uninstallDaemon() as part of one-command setup.
import { dirname, join } from "path";
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync, renameSync } from "fs";
import {
  launchdPlist, systemdUnit, rotateIfNeeded,
  LOG_DIR, LOG_FILE, PLIST_PATH, SYSTEMD_UNIT_PATH,
  type DaemonPaths,
} from "./templates.js";

function run(cmd: string[]): void {
  const proc = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) console.warn(`warning: ${cmd.join(" ")} exited ${proc.exitCode}`);
}

function defaultPaths(): DaemonPaths {
  return {
    bunPath: process.execPath,
    workerEntry: join(dirname(new URL(import.meta.url).pathname), "..", "src", "index.ts"),
    logFile: LOG_FILE,
  };
}

export function installDaemon(paths: DaemonPaths = defaultPaths()): string {
  mkdirSync(LOG_DIR, { recursive: true });
  if (existsSync(paths.logFile)) rotateIfNeeded(statSync(paths.logFile).size, renameSync, paths.logFile);

  if (process.platform === "darwin") {
    mkdirSync(dirname(PLIST_PATH), { recursive: true });
    writeFileSync(PLIST_PATH, launchdPlist(paths));
    run(["launchctl", "unload", PLIST_PATH]); // reload cleanly if already installed
    run(["launchctl", "load", PLIST_PATH]);
    return PLIST_PATH;
  }
  if (process.platform === "linux") {
    mkdirSync(dirname(SYSTEMD_UNIT_PATH), { recursive: true });
    writeFileSync(SYSTEMD_UNIT_PATH, systemdUnit(paths));
    run(["systemctl", "--user", "daemon-reload"]);
    run(["systemctl", "--user", "enable", "--now", "aznex-worker.service"]);
    return SYSTEMD_UNIT_PATH;
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}

export function uninstallDaemon(): string {
  if (process.platform === "darwin") {
    run(["launchctl", "unload", PLIST_PATH]);
    rmSync(PLIST_PATH, { force: true });
    return PLIST_PATH;
  }
  if (process.platform === "linux") {
    run(["systemctl", "--user", "disable", "--now", "aznex-worker.service"]);
    rmSync(SYSTEMD_UNIT_PATH, { force: true });
    return SYSTEMD_UNIT_PATH;
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}

if (import.meta.main) {
  if (process.argv.includes("--uninstall")) {
    console.log(`removed ${uninstallDaemon()}`);
  } else {
    const installed = installDaemon();
    console.log(`installed ${installed} — worker starts at login, restarts on crash`);
    console.log(`logs: ${LOG_FILE}`);
  }
}
