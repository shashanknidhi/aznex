import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { openDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { createAuth, migrateAuthSchema } from "../auth/session.js";
import { clearCliAuthCodes } from "./cli-auth.js";

const realFetch = globalThis.fetch;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  process.env["BETTER_AUTH_SECRET"] = "test-secret-with-plenty-of-entropy-0123456789";
});
afterAll(() => { globalThis.fetch = realFetch; });
beforeEach(() => clearCliAuthCodes());

async function seed() {
  const db = openDatabase(":memory:");
  const auth = createAuth(db, { testMode: true });
  await migrateAuthSchema(auth);
  const app = createApp(db, { auth });
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "dev", email: "dev@example.com", password: "hunter2hunter2" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  return { app, cookie };
}

test("approve (session) → exchange (code) → key that authenticates", async () => {
  const { app, cookie } = await seed();

  const approve = await app.request("/api/cli-auth/approve", {
    method: "POST",
    headers: { Cookie: cookie },
  });
  expect(approve.status).toBe(200);
  const { code } = (await approve.json()) as { code: string };
  expect(code.length).toBe(32);

  const exchange = await app.request("/api/cli-auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, name: "cli-test" }),
  });
  expect(exchange.status).toBe(200);
  const { apiKey } = (await exchange.json()) as { apiKey: string };
  expect(apiKey.startsWith("axk_")).toBe(true);

  // The minted key works as a Bearer token.
  const authed = await app.request("/api/repos", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  expect(authed.status).toBe(200);
});

test("codes are single-use and garbage codes are rejected", async () => {
  const { app, cookie } = await seed();
  const { code } = (await (
    await app.request("/api/cli-auth/approve", { method: "POST", headers: { Cookie: cookie } })
  ).json()) as { code: string };

  const first = await app.request("/api/cli-auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  expect(first.status).toBe(200);

  for (const body of [JSON.stringify({ code }), JSON.stringify({ code: "nope" }), "not json"]) {
    const res = await app.request("/api/cli-auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBe(400);
  }
});

test("approve without a session → 401", async () => {
  const { app } = await seed();
  expect((await app.request("/api/cli-auth/approve", { method: "POST" })).status).toBe(401);
});
