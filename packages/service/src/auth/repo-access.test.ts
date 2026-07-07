import { test, expect, beforeEach } from "bun:test";
import { generateKeyPairSync } from "crypto";
import type { Repo, User } from "@aznex/shared";
import type { Config } from "../config.js";
import { verifyRepoAccess, clearRepoAccessCache } from "./repo-access.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config: Config = {
  defaultPromotion: "team_shared",
  port: 0,
  githubAppId: "12345",
  githubAppPrivateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
  repoAccessTtlMs: 60_000,
};

const user = { id: "u1", github_login: "alice" } as User;
const repo = { canonical: "acme/widget", github_installation_id: 42 } as Repo;

// Fake GitHub: first fetch = mint installation token, second = permission check.
function fakeGitHub(permission: string, permOk = true) {
  let calls = 0;
  const fetchImpl = (async (url: string) => {
    calls++;
    if (String(url).includes("/access_tokens")) {
      return new Response(JSON.stringify({ token: "ghs_installtoken" }), { status: 200 });
    }
    if (!permOk) return new Response("Not Found", { status: 404 });
    return new Response(JSON.stringify({ permission }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

beforeEach(() => clearRepoAccessCache());

test("collaborator with read access → allowed", async () => {
  const gh = fakeGitHub("read");
  const r = await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  expect(r.allowed).toBe(true);
  expect(r.role).toBe("read");
});

test("non-collaborator (404 on permission) → denied", async () => {
  const gh = fakeGitHub("none", false);
  const r = await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  expect(r.allowed).toBe(false);
});

test("permission 'none' → denied", async () => {
  const gh = fakeGitHub("none");
  expect((await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl })).allowed).toBe(false);
});

test("cache hit within TTL → GitHub not called a second time", async () => {
  const gh = fakeGitHub("write");
  await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  const callsAfterFirst = gh.calls();
  await verifyRepoAccess({ user, repo, config, fetchImpl: gh.fetchImpl });
  expect(gh.calls()).toBe(callsAfterFirst); // no additional fetches
});

test("missing app credentials fails closed (throws)", async () => {
  const badConfig = { ...config, githubAppId: null };
  expect(verifyRepoAccess({ user, repo, config: badConfig, fetchImpl: fakeGitHub("read").fetchImpl })).rejects.toThrow();
});
