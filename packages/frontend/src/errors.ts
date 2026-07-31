import { ApiError } from "./api.js";

/**
 * Server error codes → sentences a person can act on.
 *
 * The service speaks in snake_case identifiers (`last_admin`, `org_admin_only`)
 * and the old client rendered them verbatim, so a user trying to demote an admin
 * was shown the word "last_admin" and nothing else. Keys here are the exact
 * strings the service emits — see packages/service/src/routes/.
 */
const MESSAGES: Record<string, string> = {
  // auth / access
  unauthorized: "Your session expired. Sign in again to continue.",
  github_login_not_allowed:
    "Your GitHub account isn't a member of any organization on this server. Ask an admin to add your GitHub username.",
  forbidden:
    "You don't have access to this repository. You need to be in the organization that owns it, and GitHub has to list you as a collaborator.",
  unknown_repo: "That repository hasn't been onboarded to Aznex.",
  not_found: "Not found — it may have been deleted, or you may not have access to it.",
  super_admin_only: "Only an Aznex super admin can do that.",
  org_admin_only: "Only an admin of this organization can do that.",
  author_or_org_admin_only:
    "Only the person who captured this memory, or an admin of the organization that owns the repository, can delete it.",
  you_do_not_have_access_to_this_repo:
    "GitHub doesn't list you as a collaborator on that repository, so you can't onboard it.",
  app_missing_members_permission:
    "The Aznex GitHub App is missing the “Members: read” organization permission, so it can't see who has access through your organization. A GitHub organization owner needs to approve the app's permission request.",

  // validation / conflicts
  invalid_request: "Some of those details aren't valid. Check the fields and try again.",
  last_admin: "An organization must keep at least one admin. Promote someone else first.",
  slug_taken: "That short name is already in use. Pick another.",
  not_an_admin: "That person isn't an admin of this organization.",
  "repo_fingerprint required": "No repository was specified.",

  // operations
  sync_failed:
    "GitHub wouldn't say which repositories that installation covers. Try the install link again.",
  onboarding_failed: "That repository couldn't be onboarded.",
  invalid_or_expired_code: "That authorization link expired. Run `aznex-worker setup` again.",

  // transport
  network: "Couldn't reach the Aznex server. Check your connection and try again.",
  internal_error: "Something went wrong on the server. Try again in a moment.",
};

const BY_STATUS: Record<number, string> = {
  400: "That request wasn't valid.",
  403: "You don't have permission to do that.",
  404: "Not found — it may have been deleted, or you may not have access to it.",
  409: "That conflicts with something that already exists.",
  429: "Too many requests. Wait a moment and try again.",
};

/**
 * Turn anything thrown by the API client into a sentence.
 *
 * Never returns a raw error code or a stringified exception: an unknown code
 * falls back to a status-based generic, because "author_or_org_admin_only" tells
 * a user nothing and "TypeError: Failed to fetch" tells them less.
 */
export function errorMessage(e: unknown, context?: string): string {
  if (e instanceof ApiError) {
    if (e.code && MESSAGES[e.code]) return MESSAGES[e.code]!;
    if (e.code) {
      // Worth knowing about — it means the service grew a code we don't cover.
      console.warn(`[aznex] unmapped server error code: ${e.code} (HTTP ${e.status})`);
    }
    if (e.status >= 500) return MESSAGES["internal_error"]!;
    return BY_STATUS[e.status] ?? context ?? "Something went wrong.";
  }
  if (e instanceof DOMException && e.name === "AbortError") return "";
  return context ?? "Something went wrong.";
}

/** The raw code, for a "technical details" disclosure. Never the whole message. */
export function errorDetail(e: unknown): string | null {
  if (e instanceof ApiError) return e.code ? `${e.code} (HTTP ${e.status})` : `HTTP ${e.status}`;
  if (e instanceof Error) return e.message || null;
  return null;
}
