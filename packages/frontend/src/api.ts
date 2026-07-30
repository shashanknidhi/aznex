import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ basePath: "/api/auth" });

export interface MemoryItem {
  id: string;
  type: string;
  title: string | null;
  content: string;
  mine?: boolean;
  author_id: string;
  author_login?: string;
  created_at_epoch: number;
}

export interface MemoryDetail extends MemoryItem {
  narrative: string | null;
  facts: string[];
  concepts: string[];
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include" });
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return (await res.json()) as T;
}

async function adminPost<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `failed: ${res.status}`);
  return (await res.json()) as T;
}

const org = (id: string) => `/api/orgs/${encodeURIComponent(id)}`;

export const api = {
  repos: () =>
    get<{
      repos: RepoInfo[];
      orgs: OrgInfo[];
      user: { login: string; is_super_admin: boolean };
      github_app_install_url: string | null;
    }>("/api/repos"),

  // ── org admin ───────────────────────────────────────────────────────────────
  orgs: () => get<{ orgs: OrgInfo[]; is_super_admin: boolean }>("/api/orgs"),
  orgMembers: (id: string) => get<{ members: OrgMember[] }>(`${org(id)}/members`),
  addMember: (id: string, body: { github_login: string; role: OrgRole }) =>
    adminPost<unknown>(`${org(id)}/members`, body),
  setMemberRole: (id: string, login: string, role: OrgRole) =>
    adminPost<unknown>(`${org(id)}/members/${encodeURIComponent(login)}`, { role }, "PATCH"),
  removeMember: (id: string, login: string) =>
    adminPost<unknown>(`${org(id)}/members/${encodeURIComponent(login)}`, {}, "DELETE"),
  orgKeys: (id: string) => get<{ keys: OrgKey[] }>(`${org(id)}/keys`),
  revokeOrgKey: (id: string, keyId: string) =>
    adminPost<unknown>(`${org(id)}/keys/${encodeURIComponent(keyId)}/revoke`, {}),
  addRepo: (id: string, body: { fingerprint: string }) => adminPost<unknown>(`${org(id)}/repos`, body),
  removeRepo: (id: string, fingerprint: string) =>
    adminPost<unknown>(`${org(id)}/repos`, { fingerprint }, "DELETE"),
  syncInstallation: (id: string, installation_id: number) =>
    adminPost<{ onboarded: string[]; skipped: string[] }>(`${org(id)}/installations/sync`, { installation_id }),

  // ── super admin ─────────────────────────────────────────────────────────────
  allOrgs: () =>
    get<{
      orgs: { id: string; slug: string; name: string; status: string; member_count: number; repo_count: number }[];
    }>("/api/admin/orgs"),
  createOrg: (body: { slug: string; name: string; admin_logins: string[] }) =>
    adminPost<unknown>("/api/admin/orgs", body),
  setOrgStatus: (id: string, status: "active" | "suspended") =>
    adminPost<unknown>(`/api/admin/orgs/${encodeURIComponent(id)}`, { status }, "PATCH"),

  memories: (fingerprint: string, opts?: { q?: string; page?: number }) => {
    const params = new URLSearchParams({ repo_fingerprint: fingerprint });
    if (opts?.q) params.set("q", opts.q);
    if (opts?.page) params.set("page", String(opts.page));
    return get<{ items: MemoryItem[]; total: number; page: number }>(`/api/memories?${params}`);
  },
  memory: (id: string) => get<MemoryDetail>(`/api/memories/${encodeURIComponent(id)}`),
  // The only way to withdraw a memory — author, org admin, or super admin.
  deleteMemory: (id: string) =>
    adminPost<unknown>(`/api/memories/${encodeURIComponent(id)}`, {}, "DELETE"),
  keys: () =>
    get<{ keys: { id: string; name: string; prefix: string; status: string; created_at_epoch: number; last_used_at_epoch: number | null }[] }>(
      "/api/keys",
    ),
  revokeKey: (id: string) => adminPost<unknown>(`/api/keys/${encodeURIComponent(id)}/revoke`, {}),
};
