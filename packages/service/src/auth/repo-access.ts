import { createSign } from "crypto";
import type { Repo, User } from "@aznex/shared";
import type { Config } from "../config.js";

// GitHub repo access verification — the load-bearing security step. Given a resolved
// user and the repo they're writing to, confirm they hold read/collaborator access
// via the repo's GitHub App installation.
//
// We gate on read/member/collaborator access, NOT on PR-ability: on a public repo
// anyone can fork and open a PR without being a collaborator, so keying on PR-ability
// would expose that repo's team memory to the world (PRD §9).

export interface RepoAccess {
  allowed: boolean;
  role?: string;
}

// ponytail: in-process Map cache. Fine for a single service instance; move to a
// shared cache (Redis) only if we run multiple instances and the GitHub API rate
// limit or latency actually bites.
interface CacheEntry {
  value: RepoAccess;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

export function clearRepoAccessCache(): void {
  cache.clear();
}

type FetchImpl = typeof fetch;

export interface VerifyOpts {
  user: User;
  repo: Repo;
  config: Config;
  fetchImpl?: FetchImpl;
  now?: number; // injectable clock for tests
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

// App-authentication JWT (RS256), valid ~9 min, used only to mint installation tokens.
function appJwt(appId: string, privateKey: string, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: appId }));
  const data = `${header}.${payload}`;
  const sig = createSign("RSA-SHA256").update(data).sign(privateKey);
  return `${data}.${b64url(sig)}`;
}

const GH_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

/**
 * Resolve a repo's GitHub numeric id and App installation id from its
 * canonical "owner/name" — so admins onboard by name alone. Uses the same
 * GitHub App credentials as access verification.
 */
export async function resolveRepoInstallation(
  canonical: string,
  config: Config,
  fetchImpl: FetchImpl = fetch,
): Promise<{ githubRepoId: string; installationId: number }> {
  if (!config.githubAppId || !config.githubAppPrivateKey) {
    throw new Error("GitHub App credentials not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)");
  }
  const jwt = appJwt(config.githubAppId, config.githubAppPrivateKey, Math.floor(Date.now() / 1000));

  // 1. Which installation covers this repo? (also proves the App is installed on it)
  const instRes = await fetchImpl(`https://api.github.com/repos/${canonical}/installation`, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` },
  });
  if (!instRes.ok) {
    throw new Error(`GitHub App is not installed on ${canonical} (or repo not found)`);
  }
  const { id: installationId } = (await instRes.json()) as { id: number };

  // 2. Repo numeric id, via a short-lived installation token.
  const tokenRes = await fetchImpl(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    { method: "POST", headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` } },
  );
  if (!tokenRes.ok) throw new Error(`could not mint installation token for ${canonical}`);
  const { token } = (await tokenRes.json()) as { token: string };

  const repoRes = await fetchImpl(`https://api.github.com/repos/${canonical}`, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!repoRes.ok) throw new Error(`could not read ${canonical}`);
  const { id: repoId } = (await repoRes.json()) as { id: number };

  return { githubRepoId: String(repoId), installationId };
}

export async function verifyRepoAccess(opts: VerifyOpts): Promise<RepoAccess> {
  const { user, repo, config } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();

  const key = `${repo.github_installation_id}:${repo.canonical}:${user.github_login}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const result = await resolve();
  cache.set(key, { value: result, expiresAt: now + config.repoAccessTtlMs });
  return result;

  async function resolve(): Promise<RepoAccess> {
    if (!config.githubAppId || !config.githubAppPrivateKey) {
      // Misconfiguration must fail closed, never open.
      throw new Error("GitHub App credentials not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)");
    }

    // 1. App JWT → installation access token.
    const jwt = appJwt(config.githubAppId, config.githubAppPrivateKey, Math.floor(now / 1000));
    const tokenRes = await doFetch(
      `https://api.github.com/app/installations/${repo.github_installation_id}/access_tokens`,
      { method: "POST", headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` } },
    );
    if (!tokenRes.ok) return { allowed: false };
    const { token } = (await tokenRes.json()) as { token: string };

    // 2. Check the user's permission level on the repo.
    const permRes = await doFetch(
      `https://api.github.com/repos/${repo.canonical}/collaborators/${user.github_login}/permission`,
      { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } },
    );
    if (!permRes.ok) return { allowed: false }; // 404 = not a collaborator
    const { permission } = (await permRes.json()) as { permission: string };

    // admin | maintain | write | triage | read → has access; none → denied.
    const allowed = ["admin", "maintain", "write", "triage", "read"].includes(permission);
    return { allowed, role: permission };
  }
}
