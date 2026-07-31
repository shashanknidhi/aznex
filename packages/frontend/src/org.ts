import type { OrgInfo } from "./api.js";

/**
 * The one org the UI is showing.
 *
 * Every page used to render every org you belong to, stacked. With a `member`
 * org above an `admin` one, the onboarding controls at the bottom looked
 * unattached — nothing next to them said which org a repository would land in.
 */

export const ACTIVE_ORG_KEY = "aznex.org";

/** Stored id wins if you're still a member of it; otherwise the first org. */
export function resolveActiveOrg(orgs: OrgInfo[], stored: string | null): OrgInfo | null {
  return orgs.find((o) => o.id === stored) ?? orgs[0] ?? null;
}

export function readStoredOrg(): string | null {
  // Safari in private mode throws on access, and a broken switcher is worse
  // than a forgetful one.
  try {
    return localStorage.getItem(ACTIVE_ORG_KEY);
  } catch {
    return null;
  }
}

export function writeStoredOrg(id: string): void {
  try {
    localStorage.setItem(ACTIVE_ORG_KEY, id);
  } catch {
    // ponytail: the choice still holds for this session via React state.
  }
}
