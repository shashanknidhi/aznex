#!/usr/bin/env bun
// Admin CLI — the missing onboarding path. Runs against DATABASE_PATH (or a
// --db override), so on Railway use `railway run` / `railway ssh`.
//
//   bun src/admin-cli.ts add-repo github.com/acme/api --github-repo-id 9001 --installation-id 42
//   bun src/admin-cli.ts add-key --github-login alice --github-id 12345
//
// ponytail: argv parsing by hand, two subcommands. Grows into a real admin
// API/UI only when non-operators need to onboard repos.
import type { Database } from "bun:sqlite";
import { openDatabase } from "./db/connection.js";
import { RepoRepository } from "./repositories/repo.js";
import { GithubInstallationRepository } from "./repositories/github-installation.js";
import { UserRepository } from "./repositories/user.js";
import { mintApiKey } from "./auth/mint-key.js";

export interface AddRepoOpts {
  fingerprint: string; // host/owner/name
  githubRepoId: string;
  installationId: number;
}

export function addRepo(db: Database, opts: AddRepoOpts) {
  const parts = opts.fingerprint.split("/");
  if (parts.length < 3) throw new Error(`fingerprint must be host/owner/name, got: ${opts.fingerprint}`);
  const canonical = parts.slice(1).join("/");

  const installations = new GithubInstallationRepository(db);
  if (!installations.getByInstallationId(opts.installationId)) {
    installations.create({
      installation_id: opts.installationId,
      account_type: "org",
      account_login: parts[1]!,
      metadata: {},
    });
  }
  const repos = new RepoRepository(db);
  const existing = repos.getByFingerprint(opts.fingerprint);
  if (existing) {
    if (existing.status !== "active") repos.update(existing.id, { status: "active" });
    return repos.getByFingerprint(opts.fingerprint)!;
  }
  return repos.create({
    fingerprint: opts.fingerprint,
    canonical,
    github_repo_id: opts.githubRepoId,
    github_installation_id: opts.installationId,
    status: "active",
    metadata: {},
  });
}

export interface AddKeyOpts {
  githubLogin: string;
  githubId: string;
  name?: string;
}

export function addKey(db: Database, opts: AddKeyOpts): { token: string; userId: string } {
  const users = new UserRepository(db);
  const user =
    users.getByGithubId(opts.githubId) ??
    users.create({
      github_id: opts.githubId,
      github_login: opts.githubLogin,
      display_name: opts.githubLogin,
      avatar_url: null,
      metadata: {},
    });

  const token = mintApiKey(db, user.id, opts.name ?? "worker");
  return { token, userId: user.id };
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  const db = openDatabase(flag(args, "db"));

  if (cmd === "add-repo") {
    const fingerprint = args[0];
    const githubRepoId = flag(args, "github-repo-id");
    const installationId = Number(flag(args, "installation-id"));
    if (!fingerprint || !githubRepoId || !installationId) {
      console.error("usage: add-repo <host/owner/name> --github-repo-id <id> --installation-id <n>");
      process.exit(1);
    }
    const repo = addRepo(db, { fingerprint, githubRepoId, installationId });
    console.log(`repo onboarded: ${repo.fingerprint} (installation ${repo.github_installation_id})`);
  } else if (cmd === "add-key") {
    const githubLogin = flag(args, "github-login");
    const githubId = flag(args, "github-id");
    if (!githubLogin || !githubId) {
      console.error("usage: add-key --github-login <login> --github-id <numeric id> [--name <label>]");
      process.exit(1);
    }
    const { token } = addKey(db, { githubLogin, githubId, name: flag(args, "name") });
    console.log(`API key for ${githubLogin} (shown once, store it now):\n${token}`);
  } else {
    console.error("usage: admin-cli.ts <add-repo|add-key> …");
    process.exit(1);
  }
}
