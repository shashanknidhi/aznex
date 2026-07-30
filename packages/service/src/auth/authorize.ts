import type { Database } from "bun:sqlite";
import type { Org, OrgRole, Repo, User } from "@aznex/shared";
import type { Config } from "../config.js";
import { OrgRepository } from "../repositories/org.js";
import { RepoRepository } from "../repositories/repo.js";
import { verifyRepoAccess } from "./repo-access.js";

// The one gate for every repo-scoped read and write (ingest, MCP, memory API).
// It used to be four copy-pasted lines in six handlers; multi-tenancy added a
// second condition, and six copies of a two-condition check is how one of them
// ends up missing a condition.
//
// Two independent gates, both required:
//   1. org membership — local, and what makes "remove member" / "suspend org"
//      actually cut access. Without it a removed member keeps full access,
//      because GitHub still says they are a collaborator.
//   2. GitHub collaborator membership — the original load-bearing check
//      (see repo-access.ts for why it is collaborator membership, not a
//      permission level).
//
// There is deliberately NO super-admin bypass here: super admins manage orgs,
// they do not read tenants' memory through the API.

export type Denial = "unknown_repo" | "forbidden";

export interface RepoAuth {
  repo: Repo;
  org: Org;
  role: OrgRole;
}

export function isDenial(result: RepoAuth | Denial): result is Denial {
  return typeof result === "string";
}

export interface AuthorizeRepoOpts {
  db: Database;
  user: User;
  fingerprint: string;
  config: Config;
}

/**
 * Fail closed. Cheap local checks first, the network call last. Denials collapse
 * to two opaque reasons so a response never reveals whether a repo or an org
 * exists — `unknown_repo` only for a fingerprint this deployment has never
 * onboarded, `forbidden` for everything else.
 *
 * A `verifyRepoAccess` throw (missing GitHub App credentials) propagates: a
 * misconfigured deployment must 500, never pass.
 */
export async function authorizeRepo(opts: AuthorizeRepoOpts): Promise<RepoAuth | Denial> {
  const { db, user, fingerprint, config } = opts;

  const repo = new RepoRepository(db).getActiveByFingerprint(fingerprint);
  if (!repo) return "unknown_repo";

  // No org = written before the org migration and never assigned. Denied, and
  // flagged at startup (reposWithoutOrg) so it reads as a deploy bug.
  if (!repo.org_id) return "forbidden";

  const orgs = new OrgRepository(db);
  const org = orgs.getById(repo.org_id);
  if (!org || org.status !== "active") return "forbidden";

  const role = orgs.roleFor(org.id, user.github_login);
  if (!role) return "forbidden";

  const access = await verifyRepoAccess({ user, repo, config });
  if (!access.allowed) return "forbidden";

  return { repo, org, role };
}
