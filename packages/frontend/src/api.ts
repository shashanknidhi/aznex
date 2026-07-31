import { createAuthClient } from "better-auth/react";
import { MEMORIES_PAGE_SIZE, type MemoryType } from "@aznex/shared";

export const authClient = createAuthClient({ basePath: "/api/auth" });
export { MEMORIES_PAGE_SIZE };

/**
 * A failed request, with the server's own error code preserved.
 *
 * The previous client threw `new Error("request failed: 403")` and dropped the
 * JSON body, so every read failure reached the user as a bare status code. The
 * code lives here; errors.ts turns it into a sentence.
 *
 * `status: 0` means the request never reached the server.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Set by auth.tsx. A 401 means the cookie died mid-session; without this the app
// kept rendering a stale better-auth session and stranded the user on a broken
// page with no way out.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "include", ...init });
  } catch (e) {
    // An aborted request is control flow, not a failure — let callers ignore it.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "network", "network request failed");
  }

  if (res.status === 401) {
    onUnauthorized?.();
    throw new ApiError(401, "unauthorized", "unauthorized");
  }

  const isJson = res.headers.get("content-type")?.includes("json");
  const body = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? null, `HTTP ${res.status}`);
  }
  return body as T;
}

function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, signal ? { signal } : undefined);
}

function send<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── wire types ───────────────────────────────────────────────────────────────

export interface MemoryItem {
  id: string;
  type: MemoryType;
  title: string | null;
  content: string;
  mine?: boolean;
  /** Server-computed: author, org admin, or super admin. */
  can_delete?: boolean;
  author_id: string;
  author_login?: string;
  created_at_epoch: number;
}

export interface MemoryDetail extends MemoryItem {
  repo_fingerprint: string;
  narrative: string | null;
  facts: string[];
  concepts: string[];
  files_read: string[];
  files_modified: string[];
  ai_extracted: boolean;
  metadata: Record<string, unknown>;
  anchors: { path: string }[];
}

export interface RepoInfo {
  fingerprint: string;
  canonical: string;
  org_id: string | null;
}

export type OrgRole = "admin" | "member";

export interface OrgInfo {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
}

export interface OrgMember {
  github_login: string;
  role: OrgRole;
  invited_by_login: string | null;
  created_at_epoch: number;
  signed_in: boolean;
}

export interface OrgKey {
  id: string;
  github_login: string;
  name: string;
  prefix: string;
  status: string;
  created_at_epoch: number;
  last_used_at_epoch: number | null;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  status: string;
  created_at_epoch: number;
  last_used_at_epoch: number | null;
}

export interface Me {
  login: string;
  display_name: string;
  avatar_url: string | null;
  is_super_admin: boolean;
  orgs: OrgInfo[];
}

export interface ServerConfig {
  version: string;
  github_oauth: boolean;
  github_app: boolean;
  install_url: string | null;
}

/** Why a repo in a GitHub App installation was not onboarded. */
export type SkippedRepo =
  | { canonical: string; reason: "no_github_access"; checked_login: string }
  | { canonical: string; reason: "owned_by_another_org"; owner_org_name: string | null }
  | { canonical: string; reason: "error"; detail: string };

export interface SyncResult {
  onboarded: string[];
  skipped: SkippedRepo[];
}

const org = (id: string) => `/api/orgs/${encodeURIComponent(id)}`;

export const api = {
  config: () => get<ServerConfig>("/api/config"),
  me: (signal?: AbortSignal) => get<Me>("/api/me", signal),

  repos: (signal?: AbortSignal) =>
    get<{
      repos: RepoInfo[];
      orgs: OrgInfo[];
      user: { login: string; is_super_admin: boolean };
      github_app_install_url: string | null;
    }>("/api/repos", signal),

  // ── org admin ───────────────────────────────────────────────────────────────
  orgs: (signal?: AbortSignal) => get<{ orgs: OrgInfo[]; is_super_admin: boolean }>("/api/orgs", signal),
  orgMembers: (id: string, signal?: AbortSignal) =>
    get<{ members: OrgMember[] }>(`${org(id)}/members`, signal),
  addMember: (id: string, body: { github_login: string; role: OrgRole }) =>
    send<unknown>(`${org(id)}/members`, body),
  setMemberRole: (id: string, login: string, role: OrgRole) =>
    send<unknown>(`${org(id)}/members/${encodeURIComponent(login)}`, { role }, "PATCH"),
  removeMember: (id: string, login: string) =>
    send<unknown>(`${org(id)}/members/${encodeURIComponent(login)}`, {}, "DELETE"),
  orgKeys: (id: string, signal?: AbortSignal) => get<{ keys: OrgKey[] }>(`${org(id)}/keys`, signal),
  revokeOrgKey: (id: string, keyId: string) =>
    send<unknown>(`${org(id)}/keys/${encodeURIComponent(keyId)}/revoke`, {}),
  addRepo: (id: string, body: { fingerprint: string }) => send<unknown>(`${org(id)}/repos`, body),
  removeRepo: (id: string, fingerprint: string) =>
    send<unknown>(`${org(id)}/repos`, { fingerprint }, "DELETE"),
  syncInstallation: (id: string, installation_id: number) =>
    send<SyncResult>(`${org(id)}/installations/sync`, { installation_id }),

  // ── super admin ─────────────────────────────────────────────────────────────
  allOrgs: (signal?: AbortSignal) =>
    get<{
      orgs: { id: string; slug: string; name: string; status: string; member_count: number; repo_count: number }[];
    }>("/api/admin/orgs", signal),
  createOrg: (body: { slug: string; name: string; admin_logins: string[] }) =>
    send<unknown>("/api/admin/orgs", body),
  setOrgStatus: (id: string, status: "active" | "suspended") =>
    send<unknown>(`/api/admin/orgs/${encodeURIComponent(id)}`, { status }, "PATCH"),

  // ── memories ────────────────────────────────────────────────────────────────
  memories: (
    fingerprint: string,
    opts?: { q?: string; page?: number; type?: MemoryType | null },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ repo_fingerprint: fingerprint });
    if (opts?.q) params.set("q", opts.q);
    if (opts?.page && opts.page > 1) params.set("page", String(opts.page));
    if (opts?.type) params.set("type", opts.type);
    return get<{ items: MemoryItem[]; total: number; page: number; page_size: number }>(
      `/api/memories?${params}`,
      signal,
    );
  },
  memory: (id: string, signal?: AbortSignal) =>
    get<MemoryDetail>(`/api/memories/${encodeURIComponent(id)}`, signal),
  // The only way to withdraw a memory — author, org admin, or super admin.
  deleteMemory: (id: string) => send<unknown>(`/api/memories/${encodeURIComponent(id)}`, {}, "DELETE"),

  // ── own API keys ────────────────────────────────────────────────────────────
  keys: (signal?: AbortSignal) => get<{ keys: ApiKeyInfo[] }>("/api/keys", signal),
  revokeKey: (id: string) => send<unknown>(`/api/keys/${encodeURIComponent(id)}/revoke`, {}),

  approveCliAuth: () => send<{ code: string }>("/api/cli-auth/approve", {}),
};
