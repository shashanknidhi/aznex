import { expect, test } from "bun:test";
import type { OrgInfo } from "./api.js";
import { resolveActiveOrg } from "./org.js";

const org = (id: string): OrgInfo => ({ id, slug: id, name: id, role: "member" });

test("resolveActiveOrg prefers the stored org", () => {
  const orgs = [org("pilot"), org("ukumi")];
  expect(resolveActiveOrg(orgs, "ukumi")?.id).toBe("ukumi");
});

test("resolveActiveOrg falls back to the first when the stored org is gone", () => {
  // You were removed from that org, or it was deleted — don't render nothing.
  const orgs = [org("pilot"), org("ukumi")];
  expect(resolveActiveOrg(orgs, "left-this-one")?.id).toBe("pilot");
  expect(resolveActiveOrg(orgs, null)?.id).toBe("pilot");
});

test("resolveActiveOrg returns null when you belong to no org", () => {
  expect(resolveActiveOrg([], "pilot")).toBeNull();
});
