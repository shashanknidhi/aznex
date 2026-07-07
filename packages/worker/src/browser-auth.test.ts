import { test, expect } from "bun:test";
import { browserAuth } from "./browser-auth.js";

// Simulates the browser: visits the CLI's callback URL the way the web app's
// approve page would, then the CLI exchanges the code via fetchImpl.

test("happy path: callback with matching state → code exchanged for key", async () => {
  const exchanged: unknown[] = [];
  const fetchImpl = (async (_url: unknown, init: RequestInit) => {
    exchanged.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ apiKey: "axk_from_exchange" }), { status: 200 });
  }) as unknown as typeof fetch;

  const apiKey = await browserAuth("https://svc.example", {
    fetchImpl,
    openBrowser: (url) => {
      const u = new URL(url);
      const port = u.searchParams.get("port");
      const state = u.searchParams.get("state");
      expect(u.origin).toBe("https://svc.example");
      // "browser" approves instantly and hits the localhost callback
      void fetch(`http://127.0.0.1:${port}/callback?code=onetime123&state=${state}`);
    },
  });

  expect(apiKey).toBe("axk_from_exchange");
  expect(exchanged[0]).toMatchObject({ code: "onetime123" });
});

test("state mismatch on callback rejects the flow", async () => {
  await expect(
    browserAuth("https://svc.example", {
      fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
      openBrowser: (url) => {
        const port = new URL(url).searchParams.get("port");
        void fetch(`http://127.0.0.1:${port}/callback?code=x&state=WRONG`);
      },
    }),
  ).rejects.toThrow("state mismatch");
});

test("times out when the browser never calls back", async () => {
  await expect(
    browserAuth("https://svc.example", {
      fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
      openBrowser: () => {},
      timeoutMs: 100,
    }),
  ).rejects.toThrow("timed out");
});
