import { createSign } from "crypto";
import type { Repo, User } from "@aznex/shared";
import type { Config } from "../config.js";

// GitHub repo access verification — the load-bearing security step. Given a resolved
// user and the repo they're writing to, confirm they are a collaborator on it via the
// repo's GitHub App installation.
//
// We gate on collaborator membership, NOT on a permission level and NOT on PR-ability.
// Both of the latter are universal on a public repo and would expose that repo's team
// memory to the world (PRD §9):
//   - anyone can fork and open a PR without being a collaborator;
//   - GET /collaborators/{user}/permission answers "read" for *any* GitHub login,
//     because everyone can read a public repo. Verified against a live public repo:
//     octocat and torvalds both come back "read".
// GET /collaborators/{user} is the honest signal — 204 for a real collaborator
// (including org members who inherit access through a team), 404 for everyone else.
//
// It is only honest, though, if the installation holds the organization
// "Members: read" permission, which GitHub documents as required for this
// endpoint. Without it an installation sees direct collaborators and nothing
// else, so team access, the org's default member permission and org ownership
// all read as 404 — which is how an owner with admin on every repo in the org
// was told they were not a collaborator on one.

// Why access was denied. "Not a collaborator" was the only answer this could
// give, and it was wrong for the most common org case: a metadata-only App
// installation cannot see org-derived access at all (see resolve() below), so
// an org owner with admin on every repo came back looking like a stranger.
export type DenialReason =
  | "not_collaborator"
  | "app_missing_members_permission"
  | "installation_unavailable"
  | "github_error";

export interface RepoAccess {
  allowed: boolean;
  reason?: DenialReason;
  /** Owning org login, set only for `app_missing_members_permission`. */
  orgLogin?: string;
}

// ponytail: in-process Map cache. Fine for a single service instance; move to a
// shared cache (Redis) only if we run multiple instances and the GitHub API rate
// limit or latency actually bites.
interface CacheEntry {
  value: RepoAccess;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const DENIAL_TTL_MS = 30 * 1000;

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

interface InstallationInfo {
  accountLogin: string;
  isOrg: boolean;
  permissions: Record<string, string>;
}

/** Who the App is installed on, and with which permissions. App JWT only. */
async function getInstallation(
  installationId: number | string,
  jwt: string,
  doFetch: FetchImpl,
): Promise<InstallationInfo | null> {
  const res = await doFetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    account?: { login?: string; type?: string };
    permissions?: Record<string, string>;
  };
  return {
    accountLogin: body.account?.login ?? String(installationId),
    isOrg: body.account?.type === "Organization",
    permissions: body.permissions ?? {},
  };
}

/**
 * List all repos covered by a GitHub App installation (owner picked them on
 * GitHub's install page). ponytail: first 100 repos per installation — add
 * pagination when a pilot org selects more.
 */
export async function listInstallationRepos(
  installationId: number,
  config: Config,
  fetchImpl: FetchImpl = fetch,
): Promise<{ canonical: string; githubRepoId: string }[]> {
  if (!config.githubAppId || !config.githubAppPrivateKey) {
    throw new Error("GitHub App credentials not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)");
  }
  const jwt = appJwt(config.githubAppId, config.githubAppPrivateKey, Math.floor(Date.now() / 1000));
  const tokenRes = await fetchImpl(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    { method: "POST", headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` } },
  );
  if (!tokenRes.ok) throw new Error(`unknown installation ${installationId}`);
  const { token } = (await tokenRes.json()) as { token: string };

  const reposRes = await fetchImpl("https://api.github.com/installation/repositories?per_page=100", {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  });
  if (!reposRes.ok) throw new Error("could not list installation repositories");
  const { repositories } = (await reposRes.json()) as {
    repositories: { id: number; full_name: string }[];
  };
  return repositories.map((r) => ({ canonical: r.full_name, githubRepoId: String(r.id) }));
}

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
  // Denials expire fast. A repo that was just added to the installation, or a
  // membership that was just granted, otherwise stays "no access" for the full
  // TTL — and the obvious response, pressing the button again, returns the same
  // stale verdict without touching GitHub.
  const ttl = result.allowed ? config.repoAccessTtlMs : Math.min(config.repoAccessTtlMs, DENIAL_TTL_MS);
  cache.set(key, { value: result, expiresAt: now + ttl });
  return result;

  async function resolve(): Promise<RepoAccess> {
    if (!config.githubAppId || !config.githubAppPrivateKey) {
      // Misconfiguration must fail closed, never open.
      throw new Error("GitHub App credentials not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)");
    }

    // 0. Personal repos: the owner is not always returned by the collaborator
    //    endpoint reachable from a metadata-only installation, and asking GitHub
    //    whether you have access to your own repo is a network call for a
    //    question the fingerprint already answers.
    const owner = repo.canonical.split("/")[0] ?? "";
    if (owner.toLowerCase() === user.github_login.toLowerCase()) return { allowed: true };

    // 1. App JWT → installation access token.
    const jwt = appJwt(config.githubAppId, config.githubAppPrivateKey, Math.floor(now / 1000));
    const tokenRes = await doFetch(
      `https://api.github.com/app/installations/${repo.github_installation_id}/access_tokens`,
      { method: "POST", headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` } },
    );
    if (!tokenRes.ok) {
      // A revoked or suspended installation looks exactly like "no access" to
      // every caller, so say which it was here.
      console.warn(
        `[repo-access] ${repo.canonical}: could not mint installation token ` +
          `${repo.github_installation_id} (${tokenRes.status})`,
      );
      return { allowed: false, reason: "installation_unavailable" };
    }
    const { token } = (await tokenRes.json()) as { token: string };

    // 2. Is the user a collaborator on the repo? 204 = yes, 404 = no. Any other
    //    status (rate limit, outage, revoked installation) fails closed.
    const collabRes = await doFetch(
      `https://api.github.com/repos/${repo.canonical}/collaborators/${encodeURIComponent(user.github_login)}`,
      { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` } },
    );
    if (collabRes.status === 204) return { allowed: true };

    // 3. Denied — but by whom? On an organization-owned repo, four of the five
    //    ways to have access (team membership, org base permission, org
    //    ownership, and hence most real users) are only visible to an
    //    installation that holds the `members` organization permission; GitHub
    //    documents it as required for this endpoint. Without it every one of
    //    those users looks like a stranger, and the honest report is "the App
    //    is underpowered", not "you have no access".
    const installation = await getInstallation(repo.github_installation_id, jwt, doFetch);
    if (installation?.isOrg && !installation.permissions["members"]) {
      console.warn(
        `[repo-access] ${repo.canonical}: installation ${repo.github_installation_id} lacks ` +
          `the 'members' organization permission — cannot see org-derived access for ${user.github_login}`,
      );
      return {
        allowed: false,
        reason: "app_missing_members_permission",
        orgLogin: installation.accountLogin,
      };
    }

    // 404 is a real answer ("not a collaborator"). Anything else non-204 means
    // GitHub could not answer, which is a different problem with a different
    // fix — and it is invisible once collapsed into a boolean.
    if (collabRes.status !== 404) {
      console.warn(
        `[repo-access] ${repo.canonical}: collaborator check for ${user.github_login} ` +
          `returned ${collabRes.status} — failing closed`,
      );
      return { allowed: false, reason: "github_error" };
    }
    return { allowed: false, reason: "not_collaborator" };
  }
}
