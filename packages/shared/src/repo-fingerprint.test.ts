import { test, expect } from "bun:test";
import { normalizeRemoteUrl, computeRepoFingerprint } from "./repo-fingerprint.js";

test("all remote variants normalize to the same fingerprint", () => {
  const want = "github.com/acme/api";
  for (const url of [
    "git@github.com:acme/api.git",
    "git@github.com:Acme/api",
    "ssh://git@github.com/acme/api.git",
    "https://github.com/acme/api",
    "https://github.com/ACME/api.git",
    "https://user:token@github.com/acme/api.git",
    "git://github.com/acme/api.git",
    "https://GitHub.com/acme/api/",
  ]) {
    expect(normalizeRemoteUrl(url)).toBe(want);
  }
});

test("repo name case is preserved, host and owner lowercased", () => {
  expect(normalizeRemoteUrl("git@GitHub.com:Acme/MyRepo.git")).toBe("github.com/acme/MyRepo");
});

test("non-github hosts and nested groups work", () => {
  expect(normalizeRemoteUrl("https://gitlab.com/group/subgroup/proj.git")).toBe(
    "gitlab.com/group/subgroup/proj",
  );
  expect(normalizeRemoteUrl("ssh://git@bitbucket.org:2222/team/repo.git")).toBe(
    "bitbucket.org/team/repo",
  );
});

test("garbage input returns null", () => {
  expect(normalizeRemoteUrl("")).toBe(null);
  expect(normalizeRemoteUrl("not a url")).toBe(null);
  expect(normalizeRemoteUrl("https://github.com/only-owner")).toBe(null);
  expect(normalizeRemoteUrl("/local/path/repo.git")).toBe(null);
});

test("computeRepoFingerprint returns null outside a git repo", async () => {
  expect(await computeRepoFingerprint("/tmp")).toBe(null);
});

test("computeRepoFingerprint resolves this repo's origin", async () => {
  const fp = await computeRepoFingerprint(import.meta.dir);
  expect(fp).toMatch(/^[^/]+\/[^/]+\/aznex$/);
});
