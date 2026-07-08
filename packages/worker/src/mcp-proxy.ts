import { loadWorkerConfig } from "./config.js";

// `aznex-worker mcp` — stdio→HTTP MCP proxy so the Claude Code plugin can
// declare an MCP server without shipping the Bearer key: the key stays in
// ~/.aznex/config.json and this process bridges newline-delimited JSON-RPC
// on stdio to the service's stateless HTTP transport.
// ponytail: raw line proxy, no MCP SDK — the service transport is stateless
// JSON-RPC-per-POST, so bridging is just forwarding bytes.

export interface ProxyDeps {
  fetchImpl?: typeof fetch;
  configPath?: string;
}

export async function proxyLine(line: string, deps: ProxyDeps = {}): Promise<string | null> {
  const config = loadWorkerConfig(deps.configPath);
  if (!config.serviceUrl || !config.apiKey) {
    const id = (JSON.parse(line) as { id?: unknown }).id ?? null;
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: "aznex not configured — run: npx aznex-worker setup" },
    });
  }
  const res = await (deps.fetchImpl ?? fetch)(`${config.serviceUrl}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: line,
  });
  const text = await res.text();
  // Notifications get 202 + empty body from the stateless transport — nothing
  // to write back on stdio either.
  return text.trim() === "" ? null : text;
}

export async function runMcpProxy(deps: ProxyDeps = {}): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const out = await proxyLine(line, deps);
        if (out !== null) process.stdout.write(out + "\n");
      } catch {
        // service unreachable mid-session: drop the message; the client times
        // out and reports the tool call failed, which is the honest signal.
      }
    }
  }
}
