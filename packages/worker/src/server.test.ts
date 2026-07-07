import { test, expect } from "bun:test";
import { startWorkerServer } from "./server.js";
import { HookQueue, type HookPayload } from "./queue.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

test("POST /hook responds before the payload is processed", async () => {
  const gate = deferred();
  const processed: HookPayload[] = [];
  const worker = startWorkerServer({
    port: 0,
    process: async (p) => {
      await gate.promise;
      processed.push(p);
    },
  });
  try {
    const res = await fetch(`http://localhost:${worker.server.port}/hook`, {
      method: "POST",
      body: JSON.stringify({ event: "PostToolUse", tool: "Bash" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queued: true });
    expect(processed.length).toBe(0); // response arrived while processing is still gated

    gate.resolve();
    await worker.queue.flush();
    expect(processed).toEqual([{ event: "PostToolUse", tool: "Bash" }]);
  } finally {
    await worker.stop();
  }
});

test("queue drains to zero across multiple payloads, in order", async () => {
  const seen: unknown[] = [];
  const queue = new HookQueue(async (p) => {
    seen.push(p["n"]);
  });
  for (let n = 1; n <= 5; n++) queue.enqueue({ n });
  await queue.flush();
  expect(seen).toEqual([1, 2, 3, 4, 5]);
  expect(queue.size).toBe(0);
});

test("a throwing payload is dropped, later payloads still process", async () => {
  const seen: unknown[] = [];
  const queue = new HookQueue(async (p) => {
    if (p["boom"]) throw new Error("stage failed");
    seen.push(p["n"]);
  });
  queue.enqueue({ n: 1 });
  queue.enqueue({ boom: true });
  queue.enqueue({ n: 2 });
  await queue.flush();
  expect(seen).toEqual([1, 2]);
});

test("invalid JSON → 400, unknown route → 404, health reports queue size", async () => {
  const worker = startWorkerServer({ port: 0, process: async () => {} });
  try {
    const base = `http://localhost:${worker.server.port}`;
    expect((await fetch(`${base}/hook`, { method: "POST", body: "not json" })).status).toBe(400);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toEqual({ ok: true, queued: 0 });
  } finally {
    await worker.stop();
  }
});

test("stop() drains pending payloads before resolving (graceful shutdown)", async () => {
  const processed: unknown[] = [];
  const worker = startWorkerServer({
    port: 0,
    process: async (p) => {
      await new Promise((r) => setTimeout(r, 5));
      processed.push(p["n"]);
    },
  });
  const base = `http://localhost:${worker.server.port}`;
  await fetch(`${base}/hook`, { method: "POST", body: JSON.stringify({ n: 1 }) });
  await fetch(`${base}/hook`, { method: "POST", body: JSON.stringify({ n: 2 }) });
  await worker.stop();
  expect(processed).toEqual([1, 2]);
});

test("hook adapter script forwards stdin payload to the worker", async () => {
  const received: HookPayload[] = [];
  const worker = startWorkerServer({
    port: 0,
    process: async (p) => {
      received.push(p);
    },
  });
  try {
    const payload = JSON.stringify({ hook_event_name: "Stop", session_id: "s1" });
    const proc = Bun.spawn(["bun", `${import.meta.dir}/../hooks/claude-code-hook.ts`], {
      env: { ...process.env, AZNEX_WORKER_URL: `http://localhost:${worker.server.port}` },
      stdin: new TextEncoder().encode(payload),
    });
    expect(await proc.exited).toBe(0);
    await worker.queue.flush();
    expect(received).toEqual([{ hook_event_name: "Stop", session_id: "s1" }]);
  } finally {
    await worker.stop();
  }
});

test("hook adapter exits 0 even when the worker is unreachable", async () => {
  const proc = Bun.spawn(["bun", `${import.meta.dir}/../hooks/claude-code-hook.ts`], {
    env: { ...process.env, AZNEX_WORKER_URL: "http://localhost:1" },
    stdin: new TextEncoder().encode("{}"),
  });
  expect(await proc.exited).toBe(0);
});
