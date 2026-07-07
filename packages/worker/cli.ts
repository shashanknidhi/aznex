#!/usr/bin/env bun
// aznex-worker — the npm-installed entry point.
//
//   aznex-worker setup --service-url <url> --api-key <axk_…>   one-command install
//   aznex-worker serve                                          run the worker in the foreground
//   aznex-worker hook                                           forward a hook event from stdin
//   aznex-worker uninstall                                      remove the daemon

export {}; // top-level await needs module context

const [cmd = "help", ...rest] = process.argv.slice(2);

switch (cmd) {
  case "serve": {
    (await import("./src/index.js")).serve();
    break;
  }
  case "setup": {
    await (await import("./setup.js")).runSetup(rest);
    break;
  }
  case "uninstall": {
    await (await import("./setup.js")).runSetup(["--uninstall"]);
    break;
  }
  case "hook": {
    await (await import("./hooks/claude-code-hook.js")).forwardHook();
    process.exit(0);
    break;
  }
  default: {
    console.log(`aznex-worker — Aznex local capture worker

usage:
  aznex-worker setup --service-url <url> --api-key <axk_…>   install (daemon + hooks + config)
  aznex-worker serve                                          run the worker in the foreground
  aznex-worker hook                                           forward a hook event from stdin
  aznex-worker uninstall                                      remove the daemon`);
    process.exit(cmd === "help" ? 0 : 1);
  }
}
