#!/usr/bin/env bun
// Daemon installer (#28): `bun daemon/install.ts` installs and starts the
// worker as a login daemon (launchd on macOS, systemd --user on Linux).
// `bun daemon/install.ts --uninstall` stops and removes it.
import { dirname, join } from "path";
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync, renameSync } from "fs";
import {
  launchdPlist, systemdUnit, rotateIfNeeded,
  LOG_DIR, LOG_FILE, PLIST_LABEL, PLIST_PATH, SYSTEMD_UNIT_PATH,
  type DaemonPaths,
} from "./templates.js";

const uninstall = process.argv.includes("--uninstall");
const platform = process.platform;

function run(cmd: string[]): void {
  const proc = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) console.warn(`warning: ${cmd.join(" ")} exited ${proc.exitCode}`);
}

const paths: DaemonPaths = {
  bunPath: process.execPath,
  workerEntry: join(dirname(new URL(import.meta.url).pathname), "..", "src", "index.ts"),
  logFile: LOG_FILE,
};

if (platform === "darwin") {
  if (uninstall) {
    run(["launchctl", "unload", PLIST_PATH]);
    rmSync(PLIST_PATH, { force: true });
    console.log(`removed ${PLIST_PATH}`);
  } else {
    mkdirSync(LOG_DIR, { recursive: true });
    if (existsSync(LOG_FILE)) rotateIfNeeded(statSync(LOG_FILE).size, renameSync);
    mkdirSync(dirname(PLIST_PATH), { recursive: true });
    writeFileSync(PLIST_PATH, launchdPlist(paths));
    run(["launchctl", "unload", PLIST_PATH]); // reload cleanly if already installed
    run(["launchctl", "load", PLIST_PATH]);
    console.log(`installed ${PLIST_PATH} — worker starts at login, restarts on crash`);
    console.log(`logs: ${LOG_FILE}`);
  }
} else if (platform === "linux") {
  if (uninstall) {
    run(["systemctl", "--user", "disable", "--now", "aznex-worker.service"]);
    rmSync(SYSTEMD_UNIT_PATH, { force: true });
    console.log(`removed ${SYSTEMD_UNIT_PATH}`);
  } else {
    mkdirSync(LOG_DIR, { recursive: true });
    if (existsSync(LOG_FILE)) rotateIfNeeded(statSync(LOG_FILE).size, renameSync);
    mkdirSync(dirname(SYSTEMD_UNIT_PATH), { recursive: true });
    writeFileSync(SYSTEMD_UNIT_PATH, systemdUnit(paths));
    run(["systemctl", "--user", "daemon-reload"]);
    run(["systemctl", "--user", "enable", "--now", "aznex-worker.service"]);
    console.log(`installed ${SYSTEMD_UNIT_PATH} — worker starts at login, restarts on crash`);
    console.log(`logs: ${LOG_FILE}`);
  }
} else {
  console.error(`unsupported platform: ${platform}`);
  process.exit(1);
}
