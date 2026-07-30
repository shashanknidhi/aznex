#!/usr/bin/env bun
// Admin CLI — the missing onboarding path. Runs against DATABASE_PATH (or a
// --db override), so on Railway use `railway run` / `railway ssh`.
//
//   bun src/admin-cli.ts add-org acme --name "Acme Inc" --admins alice,bob
//   bun src/admin-cli.ts add-repo github.com/acme/api --github-repo-id 9001 --installation-id 42 --org acme
//   bun src/admin-cli.ts add-key --github-login alice --github-id 12345
//
// ponytail: argv parsing by hand. This is now only the bootstrap path — the
// first org on an empty database, since signing in requires an org membership.
// Day-to-day onboarding lives in the org admin API (routes/orgs.ts).
import type { Database } from "bun:sqlite";
import { openDatabase } from "./db/connection.js";
import { RepoRepository } from "./repositories/repo.js";
import { OrgRepository } from "./repositories/org.js";
import { GithubInstallationRepository } from "./repositories/github-installation.js";
import { UserRepository } from "./repositories/user.js";
import { mintApiKey } from "./auth/mint-key.js";

export interface AddRepoOpts {
  fingerprint: string; // host/owner/name
  githubRepoId: string;
  installationId: number;
  orgId: string; // owning tenant — required: a repo with no org is denied
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
    // Re-onboarding reactivates. A repo already owned by another org is not
    // silently stolen — the caller's route must have checked ownership first.
    if (existing.org_id && existing.org_id !== opts.orgId) {
      throw new Error(`${opts.fingerprint} already belongs to another org`);
    }
    repos.update(existing.id, { status: "active", org_id: opts.orgId });
    return repos.getByFingerprint(opts.fingerprint)!;
  }
  return repos.create({
    fingerprint: opts.fingerprint,
    canonical,
    github_repo_id: opts.githubRepoId,
    github_installation_id: opts.installationId,
    org_id: opts.orgId,
    status: "active",
    metadata: {},
  });
}

export interface AddOrgOpts {
  slug: string;
  name: string;
  adminLogins: string[];
}

// Bootstrap path: the first org on an empty database, before anyone can sign in
// (sign-in itself now requires an org membership).
export function addOrg(db: Database, opts: AddOrgOpts) {
  const orgs = new OrgRepository(db);
  const org = orgs.getBySlug(opts.slug) ?? orgs.create({ slug: opts.slug, name: opts.name, status: "active", metadata: {} });
  for (const login of opts.adminLogins) orgs.setMember(org.id, login, "admin");
  return org;
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

  if (cmd === "add-org") {
    const slug = args[0];
    const name = flag(args, "name") ?? slug;
    const adminLogins = (flag(args, "admins") ?? "").split(",").map((l) => l.trim()).filter(Boolean);
    if (!slug || adminLogins.length === 0) {
      console.error("usage: add-org <slug> [--name <display name>] --admins <login,login>");
      process.exit(1);
    }
    const org = addOrg(db, { slug, name: name!, adminLogins });
    console.log(`org ready: ${org.slug} (${org.id}) — admins: ${adminLogins.join(", ")}`);
  } else if (cmd === "add-repo") {
    const fingerprint = args[0];
    const githubRepoId = flag(args, "github-repo-id");
    const installationId = Number(flag(args, "installation-id"));
    const orgSlug = flag(args, "org");
    if (!fingerprint || !githubRepoId || !installationId || !orgSlug) {
      console.error(
        "usage: add-repo <host/owner/name> --github-repo-id <id> --installation-id <n> --org <slug>",
      );
      process.exit(1);
    }
    const org = new OrgRepository(db).getBySlug(orgSlug);
    if (!org) {
      console.error(`unknown org: ${orgSlug} (create it with add-org first)`);
      process.exit(1);
    }
    const repo = addRepo(db, { fingerprint, githubRepoId, installationId, orgId: org.id });
    console.log(`repo onboarded: ${repo.fingerprint} → org ${org.slug} (installation ${repo.github_installation_id})`);
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
    console.error("usage: admin-cli.ts <add-org|add-repo|add-key> …");
    process.exit(1);
  }
}
