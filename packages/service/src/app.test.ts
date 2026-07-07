import { test, expect } from "bun:test";
import { openDatabase } from "./db/connection.js";
import { createApp } from "./app.js";

test("GET /health returns ok + version", async () => {
  const app = createApp(openDatabase(":memory:"));
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; version: string };
  expect(body.ok).toBe(true);
  expect(typeof body.version).toBe("string");
});
