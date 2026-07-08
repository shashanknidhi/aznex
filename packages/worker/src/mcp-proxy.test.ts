import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { proxyLine } from "./mcp-proxy.js";

function tmpConfig(content: object): string {
  const path = join(mkdtempSync(join(tmpdir(), "aznex-proxy-")), "config.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
}

test("forwards JSON-RPC to the service with auth and relays the response", async () => {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const out = await proxyLine('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}', {
    configPath: tmpConfig({ serviceUrl: "https://svc", apiKey: "axk_x" }),
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
        body: String(init?.body),
      });
      return new Response('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
    }) as unknown as typeof fetch,
  });
  expect(out).toBe('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
  expect(seen[0]!.url).toBe("https://svc/mcp");
  expect(seen[0]!.headers["Authorization"]).toBe("Bearer axk_x");
  expect(seen[0]!.body).toContain("tools/list");
});

test("notifications (202 empty body) produce no stdio output", async () => {
  const out = await proxyLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', {
    configPath: tmpConfig({ serviceUrl: "https://svc", apiKey: "axk_x" }),
    fetchImpl: (async () => new Response("", { status: 202 })) as unknown as typeof fetch,
  });
  expect(out).toBe(null);
});

test("unconfigured → JSON-RPC error pointing at setup, preserving the request id", async () => {
  const out = await proxyLine('{"jsonrpc":"2.0","id":7,"method":"tools/list"}', {
    configPath: "/nonexistent/config.json",
  });
  const parsed = JSON.parse(out!);
  expect(parsed.id).toBe(7);
  expect(parsed.error.message).toContain("aznex-worker setup");
});
