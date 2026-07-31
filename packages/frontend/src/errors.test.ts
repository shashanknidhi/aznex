import { test, expect } from "bun:test";
import { ApiError } from "./api.js";
import { errorDetail, errorMessage } from "./errors.js";

// The regression this file exists for: users were shown raw server codes like
// "last_admin" and stringified exceptions like "Error: request failed: 403".

test("known server codes become sentences", () => {
  expect(errorMessage(new ApiError(409, "last_admin", "x"))).toContain("at least one admin");
  expect(errorMessage(new ApiError(409, "slug_taken", "x"))).toContain("already in use");
  expect(errorMessage(new ApiError(403, "org_admin_only", "x"))).toContain("admin of this organization");
  expect(errorMessage(new ApiError(403, "forbidden", "x"))).toContain("collaborator");
  expect(errorMessage(new ApiError(404, "unknown_repo", "x"))).toContain("onboarded");
  expect(errorMessage(new ApiError(401, "unauthorized", "x"))).toContain("expired");
});

test("no message is a bare error code, and none look like identifiers", () => {
  const codes = [
    "unauthorized", "github_login_not_allowed", "forbidden", "unknown_repo", "not_found",
    "super_admin_only", "org_admin_only", "author_or_org_admin_only",
    "you_do_not_have_access_to_this_repo", "invalid_request", "last_admin", "slug_taken",
    "not_an_admin", "sync_failed", "onboarding_failed", "invalid_or_expired_code",
    "network", "internal_error",
  ];
  for (const code of codes) {
    const msg = errorMessage(new ApiError(400, code, "x"));
    expect(msg).not.toBe(code);
    // snake_case leaking into prose is the exact defect being guarded against.
    expect(msg).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
    expect(msg.length).toBeGreaterThan(10);
  }
});

test("an unmapped code never reaches the user verbatim", () => {
  const msg = errorMessage(new ApiError(403, "some_brand_new_code", "x"));
  expect(msg).not.toContain("some_brand_new_code");
  expect(msg).toBe("You don't have permission to do that.");
});

test("status fallbacks cover the codes the service can return without a body", () => {
  expect(errorMessage(new ApiError(403, null, "x"))).toContain("permission");
  expect(errorMessage(new ApiError(404, null, "x"))).toContain("Not found");
  expect(errorMessage(new ApiError(409, null, "x"))).toContain("conflicts");
  expect(errorMessage(new ApiError(429, null, "x"))).toContain("Too many");
  // Any 5xx is the server's problem, not the user's to decode.
  for (const status of [500, 502, 503, 504]) {
    expect(errorMessage(new ApiError(status, null, "x"))).toContain("went wrong on the server");
  }
});

test("a network failure is named as one, not as 'TypeError: Failed to fetch'", () => {
  const msg = errorMessage(new ApiError(0, "network", "network request failed"));
  expect(msg).toContain("Couldn't reach");
  expect(msg).not.toContain("TypeError");
});

test("an unrecognised throw uses the caller's context instead of leaking internals", () => {
  expect(errorMessage(new TypeError("Failed to fetch"), "Repos couldn't load.")).toBe("Repos couldn't load.");
  expect(errorMessage("some string")).toBe("Something went wrong.");
  expect(errorMessage(null)).toBe("Something went wrong.");
});

test("an aborted request produces no message — it is not a failure", () => {
  expect(errorMessage(new DOMException("aborted", "AbortError"))).toBe("");
});

test("the raw code stays available for a technical-details disclosure", () => {
  expect(errorDetail(new ApiError(409, "last_admin", "x"))).toBe("last_admin (HTTP 409)");
  expect(errorDetail(new ApiError(500, null, "x"))).toBe("HTTP 500");
  expect(errorDetail(new Error("boom"))).toBe("boom");
  expect(errorDetail(42)).toBeNull();
});
