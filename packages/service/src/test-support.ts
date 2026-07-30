import type { Database } from "bun:sqlite";
import type { OrgRole } from "@aznex/shared";
import { OrgRepository } from "./repositories/org.js";

// Test-only convenience: every repo needs an owning org and every caller needs a
// membership in it, so almost every route test starts here.
export function seedOrg(
  db: Database,
  members: Record<string, OrgRole> = { alice: "member" },
  slug = "acme",
): string {
  const orgs = new OrgRepository(db);
  const org = orgs.getBySlug(slug) ?? orgs.create({ slug, name: slug, status: "active", metadata: {} });
  for (const [login, role] of Object.entries(members)) orgs.setMember(org.id, login, role);
  return org.id;
}
