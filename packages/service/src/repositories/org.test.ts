import { test, expect } from "bun:test";
import { openDatabase } from "../db/connection.js";
import { OrgRepository } from "./org.js";

function repo() {
  return new OrgRepository(openDatabase(":memory:"));
}

test("slug is unique and lookups are case-insensitive on it", () => {
  const orgs = repo();
  const acme = orgs.create({ slug: "acme", name: "Acme", status: "active", metadata: {} });
  expect(orgs.getBySlug("ACME")?.id).toBe(acme.id);
  expect(() => orgs.create({ slug: "acme", name: "Other", status: "active", metadata: {} })).toThrow();
});

// GitHub logins are case-insensitive; two spellings must never become two members.
test("membership normalizes the login on write and read", () => {
  const orgs = repo();
  const org = orgs.create({ slug: "acme", name: "Acme", status: "active", metadata: {} });
  orgs.setMember(org.id, "  Alice  ", "admin");
  expect(orgs.roleFor(org.id, "alice")).toBe("admin");
  expect(orgs.roleFor(org.id, "ALICE")).toBe("admin");
  expect(orgs.listMembers(org.id).map((m) => m.github_login)).toEqual(["alice"]);

  orgs.setMember(org.id, "ALICE", "member"); // upsert, not a second row
  expect(orgs.listMembers(org.id).length).toBe(1);
  expect(orgs.roleFor(org.id, "alice")).toBe("member");
});

test("countAdmins backs the last-admin guard", () => {
  const orgs = repo();
  const org = orgs.create({ slug: "acme", name: "Acme", status: "active", metadata: {} });
  orgs.setMember(org.id, "alice", "admin");
  orgs.setMember(org.id, "bob", "member");
  expect(orgs.countAdmins(org.id)).toBe(1);
  orgs.setMember(org.id, "bob", "admin");
  expect(orgs.countAdmins(org.id)).toBe(2);
});

test("removeMember drops only that membership", () => {
  const orgs = repo();
  const a = orgs.create({ slug: "org-a", name: "A", status: "active", metadata: {} });
  const b = orgs.create({ slug: "org-b", name: "B", status: "active", metadata: {} });
  orgs.setMember(a.id, "alice", "member");
  orgs.setMember(b.id, "alice", "admin");
  orgs.removeMember(a.id, "alice");
  expect(orgs.roleFor(a.id, "alice")).toBeNull();
  expect(orgs.roleFor(b.id, "alice")).toBe("admin");
});

// Suspension must read as "no access", never as read-only: listActiveForLogin is
// what the sign-in gate and the repo selector both use.
test("listActiveForLogin hides suspended orgs", () => {
  const orgs = repo();
  const a = orgs.create({ slug: "org-a", name: "A", status: "active", metadata: {} });
  const b = orgs.create({ slug: "org-b", name: "B", status: "active", metadata: {} });
  orgs.setMember(a.id, "alice", "admin");
  orgs.setMember(b.id, "alice", "member");
  expect(orgs.listActiveForLogin("Alice").map((m) => m.org.slug).sort()).toEqual(["org-a", "org-b"]);

  orgs.update(b.id, { status: "suspended" });
  const active = orgs.listActiveForLogin("alice");
  expect(active.map((m) => m.org.slug)).toEqual(["org-a"]);
  expect(active[0]!.role).toBe("admin");
  // The membership row survives, so resuming restores access.
  expect(orgs.roleFor(b.id, "alice")).toBe("member");
});

test("an invalid role never reaches the database", () => {
  const orgs = repo();
  const org = orgs.create({ slug: "acme", name: "Acme", status: "active", metadata: {} });
  expect(() => orgs.setMember(org.id, "alice", "owner" as any)).toThrow();
});
