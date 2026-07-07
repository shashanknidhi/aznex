import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({ basePath: "/api/auth" });

export interface MemoryItem {
  id: string;
  type: string;
  title: string | null;
  content: string;
  freshness_state: string;
  promotion_state: string;
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
  anchors: { path: string; commit_sha: string | null }[];
}

export interface RepoInfo {
  fingerprint: string;
  canonical: string;
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

export const api = {
  repos: () =>
    get<{
      repos: RepoInfo[];
      user: { login: string; is_admin: boolean };
      github_app_install_url: string | null;
    }>("/api/repos"),
  addRepo: (body: { fingerprint: string }) => adminPost<unknown>("/api/admin/repos", body),
  removeRepo: (fingerprint: string) => adminPost<unknown>("/api/admin/repos", { fingerprint }, "DELETE"),
  syncInstallation: (installation_id: number) =>
    adminPost<{ onboarded: string[]; skipped: string[] }>("/api/admin/installations/sync", { installation_id }),
  memories: (fingerprint: string, opts?: { q?: string; page?: number }) => {
    const params = new URLSearchParams({ repo_fingerprint: fingerprint });
    if (opts?.q) params.set("q", opts.q);
    if (opts?.page) params.set("page", String(opts.page));
    return get<{ items: MemoryItem[]; total: number; page: number }>(`/api/memories?${params}`);
  },
  memory: (id: string) => get<MemoryDetail>(`/api/memories/${encodeURIComponent(id)}`),
  promote: (id: string) => adminPost<unknown>(`/api/memories/${encodeURIComponent(id)}/promote`, {}),
  keys: () =>
    get<{ keys: { id: string; name: string; prefix: string; status: string; created_at_epoch: number; last_used_at_epoch: number | null }[] }>(
      "/api/keys",
    ),
  revokeKey: (id: string) => adminPost<unknown>(`/api/keys/${encodeURIComponent(id)}/revoke`, {}),
  revoke: (id: string) => adminPost<unknown>(`/api/memories/${encodeURIComponent(id)}/revoke`, {}),
};
