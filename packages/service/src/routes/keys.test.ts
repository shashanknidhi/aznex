import { test, expect, beforeAll } from "bun:test";
import { generateKeyPairSync } from "crypto";
import { openDatabase } from "../db/connection.js";
import { createApp } from "../app.js";
import { createAuth, migrateAuthSchema } from "../auth/session.js";
import { mintApiKey } from "../auth/mint-key.js";
import { UserRepository } from "../repositories/user.js";

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env["GITHUB_APP_ID"] = "12345";
  process.env["GITHUB_APP_PRIVATE_KEY"] = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  process.env["BETTER_AUTH_SECRET"] = "test-secret-with-plenty-of-entropy-0123456789";
});

async function seed() {
  const db = openDatabase(":memory:");
  const auth = createAuth(db, { testMode: true });
  await migrateAuthSchema(auth);
  const app = createApp(db, { auth });
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "alice", email: "alice@example.com", password: "hunter2hunter2" }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  // resolve alice's aznex user id by touching an authed endpoint once
  await app.request("/api/keys", { headers: { Cookie: cookie } });
  const alice = db.prepare("SELECT id FROM user WHERE github_login = 'alice'").get() as { id: string };
  const mallory = new UserRepository(db).create({
    github_id: "666", github_login: "mallory", display_name: "Mallory", avatar_url: null, metadata: {},
  });
  const aliceToken = mintApiKey(db, alice.id, "laptop");
  mintApiKey(db, alice.id, "old-laptop");
  const malloryToken = mintApiKey(db, mallory.id, "mallory-key");
  return { db, app, cookie, aliceToken, malloryToken };
}

test("users list only their own keys, with prefix and usage metadata", async () => {
  const { app, cookie } = await seed();
  const body = (await (await app.request("/api/keys", { headers: { Cookie: cookie } })).json()) as any;
  expect(body.keys.length).toBe(2);
  expect(body.keys.map((k: any) => k.name).sort()).toEqual(["laptop", "old-laptop"]);
  expect(body.keys[0].prefix.startsWith("axk_")).toBe(true);
});

test("revoking own key kills it for auth; someone else's key → 404", async () => {
  const { app, cookie, aliceToken, malloryToken } = await seed();
  const keys = ((await (await app.request("/api/keys", { headers: { Cookie: cookie } })).json()) as any).keys;
  const target = keys.find((k: any) => k.name === "laptop");

  // key works before revocation
  expect((await app.request("/api/keys", { headers: { Authorization: `Bearer ${aliceToken}` } })).status).toBe(200);

  const rev = await app.request(`/api/keys/${target.id}/revoke`, { method: "POST", headers: { Cookie: cookie } });
  expect(rev.status).toBe(200);
  expect((await app.request("/api/keys", { headers: { Authorization: `Bearer ${aliceToken}` } })).status).toBe(401);

  // mallory's key is invisible to alice
  const malloryKeys = ((await (await app.request("/api/keys", { headers: { Authorization: `Bearer ${malloryToken}` } })).json()) as any).keys;
  const res = await app.request(`/api/keys/${malloryKeys[0].id}/revoke`, { method: "POST", headers: { Cookie: cookie } });
  expect(res.status).toBe(404);
});
