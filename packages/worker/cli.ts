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
  aznex-worker setup --service-url <url> [--api-key] [--agents claude-code]
                                                              install everything (config + daemon + hooks + MCP)
  aznex-worker doctor                                         check the install (read-only, exit 1 on failure)
  aznex-worker mcp                                            stdio→HTTP MCP proxy (used by the Claude Code plugin)
  aznex-worker serve                                          run the worker in the foreground
  aznex-worker hook [context|file-context]                    forward a hook event from stdin
  aznex-worker uninstall                                      remove the daemon`);
    process.exit(cmd === "help" ? 0 : 1);
  }
}
