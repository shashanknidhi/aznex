import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { openDatabase } from "./db/connection.js";
import { createApp } from "./app.js";
import { addRepo, addKey } from "./admin-cli.js";
import { ApiKeyRepository } from "./repositories/api-key.js";
import { hashToken } from "./middleware/auth.js";

test("addRepo onboards installation + repo idempotently", () => {
  const db = openDatabase(":memory:");
  const repo = addRepo(db, { fingerprint: "github.com/acme/api", githubRepoId: "9001", installationId: 42 });
  expect(repo.canonical).toBe("acme/api");
  expect(repo.github_installation_id).toBe(42);
  // second call is a no-op returning the same row
  const again = addRepo(db, { fingerprint: "github.com/acme/api", githubRepoId: "9001", installationId: 42 });
  expect(again.id).toBe(repo.id);
});

test("addRepo rejects a non-fingerprint", () => {
  const db = openDatabase(":memory:");
  expect(() => addRepo(db, { fingerprint: "acme/api", githubRepoId: "1", installationId: 1 })).toThrow(
    "host/owner/name",
  );
});

test("addKey mints a token whose hash authenticates, and reuses the user", () => {
  const db = openDatabase(":memory:");
  const first = addKey(db, { githubLogin: "alice", githubId: "12345" });
  expect(first.token.startsWith("axk_")).toBe(true);
  const stored = new ApiKeyRepository(db).getByHash(hashToken(first.token));
  expect(stored?.user_id).toBe(first.userId);

  const second = addKey(db, { githubLogin: "alice", githubId: "12345", name: "laptop" });
  expect(second.userId).toBe(first.userId); // same user, new key
  expect(second.token).not.toBe(first.token);
});

test("staticDir serves files and falls back to index.html for SPA routes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aznex-static-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<html>spa</html>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");

  const app = createApp(openDatabase(":memory:"), { staticDir: dir });

  expect(await (await app.request("/assets/app.js")).text()).toBe("console.log(1)");
  for (const path of ["/", "/repo/github.com%2Facme%2Fapi", "/nope"]) {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>spa</html>");
  }
  // API groups still win over the static fallback
  expect((await app.request("/health")).headers.get("content-type")).toContain("application/json");
  expect((await app.request("/api/memories")).status).toBe(401);
  // traversal outside the dir is refused (falls back to index)
  expect(await (await app.request("/../etc/passwd")).text()).toBe("<html>spa</html>");
});
