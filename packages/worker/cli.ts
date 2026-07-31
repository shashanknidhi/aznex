#!/usr/bin/env bun
// aznex-worker — the npm-installed entry point.
//
//   aznex-worker setup --service-url <url> [--api-key]   one-command install
//   aznex-worker serve                                          run the worker in the foreground
//   aznex-worker hook                                           forward a hook event from stdin
//   aznex-worker uninstall                                      remove the daemon

export {}; // top-level await needs module context

const [cmd = "help", ...rest] = process.argv.slice(2);

switch (cmd) {
  case "--version":
  case "-v":
  case "version": {
    // The *installed* version. The running daemon is whatever it started with,
    // which is why serve() logs its own version too.
    console.log((await import("./package.json", { with: { type: "json" } })).default.version);
    break;
  }
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
    await (await import("./hooks/claude-code-hook.js")).forwardHook(rest[0]);
    process.exit(0);
    break;
  }
  case "mcp": {
    await (await import("./src/mcp-proxy.js")).runMcpProxy();
    break;
  }
  case "doctor": {
    const { runChecks, printReport } = await import("./src/doctor.js");
    process.exit(printReport(await runChecks()));
    break;
  }
  default: {
    console.log(`aznex-worker — Aznex local capture worker

usage:
  aznex-worker --version                                      print the installed version
  aznex-worker setup --service-url <url> [--api-key] [--new-key] [--agents claude-code,codex]
                                                              install everything (config + daemon + hooks + MCP)
                                                              reuses a valid stored key; --new-key forces a fresh one
  aznex-worker doctor                                         check the install (read-only, exit 1 on failure)
  aznex-worker mcp                                            stdio→HTTP MCP proxy (used by the Claude Code plugin)
  aznex-worker serve                                          run the worker in the foreground
  aznex-worker hook [context|file-context]                    forward a hook event from stdin
  aznex-worker uninstall                                      remove the daemon`);
    process.exit(cmd === "help" ? 0 : 1);
  }
}
