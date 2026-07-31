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

test("reads go out as the identity that owns the repo the proxy runs in", async () => {
  const { mkdtempSync } = await import("fs");
  const dir = mkdtempSync(join(tmpdir(), "aznex-proxy-repo-"));
  await Bun.$`git init -q`.cwd(dir).quiet();
  await Bun.$`git remote add origin https://github.com/ukumi-ai/thing.git`.cwd(dir).quiet();

  let auth = "";
  await proxyLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', {
    cwd: dir,
    configPath: tmpConfig({ serviceUrl: "https://svc", apiKey: "axk_personal", apiKeys: { "ukumi-ai": "axk_work" } }),
    fetchImpl: (async (_url: unknown, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>)["Authorization"]!;
      return new Response('{"jsonrpc":"2.0","id":1,"result":{}}');
    }) as unknown as typeof fetch,
  });
  expect(auth).toBe("Bearer axk_work");
});

test("a repo with no per-owner key falls back to the default identity", async () => {
  const { mkdtempSync } = await import("fs");
  const dir = mkdtempSync(join(tmpdir(), "aznex-proxy-repo-"));
  await Bun.$`git init -q`.cwd(dir).quiet();
  await Bun.$`git remote add origin https://github.com/shashanknidhi/thing.git`.cwd(dir).quiet();

  let auth = "";
  await proxyLine('{"jsonrpc":"2.0","id":1,"method":"tools/list"}', {
    cwd: dir,
    configPath: tmpConfig({ serviceUrl: "https://svc", apiKey: "axk_personal", apiKeys: { "ukumi-ai": "axk_work" } }),
    fetchImpl: (async (_url: unknown, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>)["Authorization"]!;
      return new Response('{"jsonrpc":"2.0","id":1,"result":{}}');
    }) as unknown as typeof fetch,
  });
  expect(auth).toBe("Bearer axk_personal");
});
