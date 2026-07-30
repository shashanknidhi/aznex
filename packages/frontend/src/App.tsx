import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  authClient,
  api,
  type MemoryItem,
  type MemoryDetail,
  type RepoInfo,
  type OrgInfo,
  type OrgMember,
  type OrgKey,
  type OrgRole,
} from "./api.js";
import { filterMemories, formatDate, preview } from "./lib.js";

const TYPES = ["extracted_learning", "summary", "decision", "negative_result"];

// ── auth shell ────────────────────────────────────────────────────────────────

function useSession() {
  const { data, isPending } = authClient.useSession();
  return { session: data, loading: isPending };
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSession();
  const loc = useLocation();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  return <>{children}</>;
}

function Login() {
  const { session } = useSession();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  if (session) return <Navigate to={next} replace />;
  return (
    <div className="center">
      <h1>Aznex</h1>
      <p className="muted">Team-shared institutional memory for coding agents.</p>
      <button
        onClick={() => authClient.signIn.social({ provider: "github", callbackURL: next })}
      >
        Sign in with GitHub
      </button>
    </div>
  );
}

// ── CLI device authorization (aznex-worker setup) ─────────────────────────────

function CliAuth() {
  const [params] = useSearchParams();
  const port = Number(params.get("port"));
  const state = params.get("state") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const valid = Number.isInteger(port) && port >= 1024 && port <= 65535 && state.length > 0;

  async function approve() {
    try {
      const res = await fetch("/api/cli-auth/approve", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`approve failed: ${res.status}`);
      const { code } = (await res.json()) as { code: string };
      setApproved(true);
      window.location.href = `http://127.0.0.1:${port}/callback?code=${code}&state=${encodeURIComponent(state)}`;
    } catch (e) {
      setError(String(e));
    }
  }

  if (!valid) return <p className="error">Invalid authorization request (missing port/state).</p>;
  if (approved) return <p>✓ Authorized — you can close this tab and return to your terminal.</p>;
  return (
    <div className="center">
      <h2>Authorize this device?</h2>
      <p className="muted">
        <code>aznex-worker setup</code> on this machine (localhost:{port}) is asking for an API
        key tied to your account. Only approve if you just ran setup yourself.
      </p>
      {error && <p className="error">{error}</p>}
      <button onClick={approve}>Approve</button>
    </div>
  );
}

// ── repo selector (#22) ───────────────────────────────────────────────────────

function OnboardRepoForm({ orgId, onAdded }: { orgId: string; onAdded: () => void }) {
  const [fingerprint, setFingerprint] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      await api.addRepo(orgId, { fingerprint: fingerprint.trim() });
      setStatus("✓ onboarded");
      setFingerprint("");
      onAdded();
    } catch (err) {
      setStatus(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="toolbar" onSubmit={submit}>
      <input required placeholder="github.com/org/repo" value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} />
      <button type="submit" disabled={busy}>{busy ? "Onboarding…" : "Onboard"}</button>
      {status && <span className="muted">{status}</span>}
    </form>
  );
}

// Repos are grouped by owning org, because admin rights are per-org: you may
// de-board in one org and only read in another.
function RepoSelect() {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  const [orgs, setOrgs] = useState<OrgInfo[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api.repos().then((r) => {
      setRepos(r.repos);
      setOrgs(r.orgs);
      setIsSuperAdmin(r.user.is_super_admin);
      setInstallUrl(r.github_app_install_url);
    }).catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, []);

  async function deboard(orgId: string, fingerprint: string) {
    try {
      await api.removeRepo(orgId, fingerprint);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (error) return <p className="error">{error}</p>;
  if (!repos) return <p className="muted">Loading repos…</p>;
  return (
    <div>
      <h2>Your repositories</h2>
      {isSuperAdmin && <p><Link to="/admin/orgs">Manage organizations →</Link></p>}
      {orgs.length === 0 && (
        <p className="muted">
          You aren't a member of any organization yet — ask an admin to add your GitHub username.
        </p>
      )}
      {orgs.map((org) => {
        const owned = repos.filter((r) => r.org_id === org.id);
        return (
          <section key={org.id}>
            <h3>
              {org.name} <span className="muted">· {org.role}</span>
            </h3>
            {owned.length === 0 && <p className="muted">No repos you can access in this org yet.</p>}
            <ul className="list">
              {owned.map((r) => (
                <li key={r.fingerprint} className="repo-row">
                  <Link to={`/repo/${encodeURIComponent(r.fingerprint)}`}>{r.canonical}</Link>
                  {org.role === "admin" && (
                    <button className="danger small" onClick={() => void deboard(org.id, r.fingerprint)}>
                      de-board
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {org.role === "admin" && (
              <>
                <p>
                  <Link to={`/org/${encodeURIComponent(org.id)}`}>Members &amp; keys →</Link>
                </p>
                {installUrl && (
                  <p>
                    <a href={`${installUrl}`}>
                      <button type="button">Install / pick repos on GitHub →</button>
                    </a>{" "}
                    <span className="muted">
                      select repos there; you'll be redirected back and they'll onboard automatically
                    </span>
                  </p>
                )}
                <p className="muted">Or onboard one by name:</p>
                <OnboardRepoForm orgId={org.id} onAdded={() => void load()} />
              </>
            )}
          </section>
        );
      })}
      <ApiKeys />
    </div>
  );
}

// ── org admin: members and their keys ─────────────────────────────────────────

function OrgAdmin() {
  const { orgId = "" } = useParams();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [keys, setKeys] = useState<OrgKey[]>([]);
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.orgMembers(orgId), api.orgKeys(orgId)])
      .then(([m, k]) => {
        setMembers(m.members);
        setKeys(k.keys);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, [orgId]);

  const act = (p: Promise<unknown>) => p.then(load).catch((e) => setError(String(e)));

  if (error && !members) return <p className="error">{error} — <Link to="/">back</Link></p>;
  if (!members) return <p className="muted">Loading…</p>;
  return (
    <div>
      <p><Link to="/">← repos</Link></p>
      <h2>Members</h2>
      {error && <p className="error">{error}</p>}
      <p className="muted">
        Members sign in with GitHub and see this org's repos they have GitHub access to. Removing
        someone cuts their access on the next request; memories they captured stay with the team.
      </p>
      <ul className="list">
        {members.map((m) => (
          <li key={m.github_login} className="repo-row">
            <span>
              <code>{m.github_login}</code>{" "}
              <span className="muted">
                {m.role}
                {m.signed_in ? "" : " · never signed in"}
                {m.invited_by_login ? ` · invited by ${m.invited_by_login}` : ""}
              </span>
            </span>
            <span>
              <button
                className="small"
                onClick={() =>
                  void act(api.setMemberRole(orgId, m.github_login, m.role === "admin" ? "member" : "admin"))
                }
              >
                make {m.role === "admin" ? "member" : "admin"}
              </button>{" "}
              <button
                className="danger small"
                onClick={() => {
                  if (!confirm(`Remove ${m.github_login} from this organization?`)) return;
                  void act(api.removeMember(orgId, m.github_login));
                }}
              >
                remove
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void act(api.addMember(orgId, { github_login: login.trim(), role })).then(() => setLogin(""));
        }}
      >
        <input required placeholder="github username" value={login} onChange={(e) => setLogin(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit">Add member</button>
      </form>

      <h2>Member API keys</h2>
      {keys.length === 0 && <p className="muted">No keys minted by this org's members yet.</p>}
      <ul className="list">
        {keys.map((k) => (
          <li key={k.id} className="repo-row">
            <span>
              <code>{k.github_login}</code> <code>{k.prefix}…</code>{" "}
              <span className="muted">
                {k.name} · created {formatDate(k.created_at_epoch)} ·{" "}
                {k.last_used_at_epoch ? `last used ${formatDate(k.last_used_at_epoch)}` : "never used"}
              </span>{" "}
              {k.status === "revoked" && <span className="badge revoked">revoked</span>}
            </span>
            {k.status === "active" && (
              <button className="danger small" onClick={() => void act(api.revokeOrgKey(orgId, k.id))}>
                revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── super admin: org lifecycle ────────────────────────────────────────────────

function SuperAdminOrgs() {
  const [orgs, setOrgs] = useState<Awaited<ReturnType<typeof api.allOrgs>>["orgs"] | null>(null);
  const [form, setForm] = useState({ slug: "", name: "", admins: "" });
  const [error, setError] = useState<string | null>(null);
  const load = () => api.allOrgs().then((r) => { setOrgs(r.orgs); setError(null); }).catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, []);
  const act = (p: Promise<unknown>) => p.then(load).catch((e) => setError(String(e)));

  if (error && !orgs) return <p className="error">{error} — <Link to="/">back</Link></p>;
  if (!orgs) return <p className="muted">Loading…</p>;
  return (
    <div>
      <p><Link to="/">← repos</Link></p>
      <h2>Organizations</h2>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {orgs.map((o) => (
          <li key={o.id} className="repo-row">
            <span>
              <Link to={`/org/${encodeURIComponent(o.id)}`}>{o.name}</Link>{" "}
              <span className="muted">
                {o.slug} · {o.member_count} members · {o.repo_count} repos
              </span>{" "}
              {o.status === "suspended" && <span className="badge revoked">suspended</span>}
            </span>
            <button
              className={o.status === "active" ? "danger small" : "small"}
              onClick={() => {
                const next = o.status === "active" ? "suspended" : "active";
                if (next === "suspended" && !confirm(`Suspend ${o.name}? All their agents stop reading and writing.`)) return;
                void act(api.setOrgStatus(o.id, next));
              }}
            >
              {o.status === "active" ? "suspend" : "resume"}
            </button>
          </li>
        ))}
      </ul>
      <h3>New organization</h3>
      <p className="muted">
        The admins you name here onboard their own repos and members — no further server config.
      </p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            api.createOrg({
              slug: form.slug.trim(),
              name: form.name.trim(),
              admin_logins: form.admins.split(",").map((l) => l.trim()).filter(Boolean),
            }),
          ).then(() => setForm({ slug: "", name: "", admins: "" }));
        }}
      >
        <input required placeholder="slug (acme-corp)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        <input required placeholder="Display name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input required placeholder="admin github usernames, comma separated" value={form.admins} onChange={(e) => setForm({ ...form, admins: e.target.value })} />
        <button type="submit">Create</button>
      </form>
    </div>
  );
}

// GitHub redirects here after App install/update (Setup URL) with
// ?installation_id=…; we onboard every selected repo the caller can access.
function GithubSetup() {
  const [params] = useSearchParams();
  const installationId = Number(params.get("installation_id"));
  const [result, setResult] = useState<{ onboarded: string[]; skipped: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // GitHub tells us the installation, not which tenant it belongs to. One
  // admin org: obvious. Several: the admin has to say.
  const [adminOrgs, setAdminOrgs] = useState<OrgInfo[] | null>(null);

  const sync = (orgId: string) =>
    api.syncInstallation(orgId, installationId).then(setResult).catch((e) => setError(String(e)));

  useEffect(() => {
    if (!Number.isInteger(installationId) || installationId <= 0) {
      setError("missing installation_id");
      return;
    }
    api
      .orgs()
      .then((r) => {
        const mine = r.orgs.filter((o) => o.role === "admin");
        setAdminOrgs(mine);
        if (mine.length === 1) void sync(mine[0]!.id);
      })
      .catch((e) => setError(String(e)));
  }, [installationId]);

  if (error) return <p className="error">{error} — <Link to="/">back to repos</Link></p>;
  if (!result && adminOrgs && adminOrgs.length === 0) {
    return <p className="error">You don't administer any organization — <Link to="/">back to repos</Link></p>;
  }
  if (!result && adminOrgs && adminOrgs.length > 1) {
    return (
      <div>
        <h2>Which organization owns these repositories?</h2>
        <ul className="list">
          {adminOrgs.map((o) => (
            <li key={o.id} className="repo-row">
              <span>{o.name}</span>
              <button className="small" onClick={() => void sync(o.id)}>onboard here</button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (!result) return <p className="muted">Onboarding selected repositories…</p>;
  return (
    <div>
      <h2>GitHub App installation synced</h2>
      {result.onboarded.length > 0 && (
        <>
          <h3>Onboarded</h3>
          <ul>{result.onboarded.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
        </>
      )}
      {result.skipped.length > 0 && (
        <>
          <h3>Skipped (you don't have GitHub access)</h3>
          <ul>{result.skipped.map((f) => <li key={f}><code>{f}</code></li>)}</ul>
        </>
      )}
      <p><Link to="/">← back to repositories</Link></p>
    </div>
  );
}

function ApiKeys() {
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof api.keys>>["keys"] | null>(null);
  const load = () => api.keys().then((r) => setKeys(r.keys)).catch(() => setKeys([]));
  useEffect(() => {
    void load();
  }, []);
  if (!keys || keys.length === 0) return null;
  return (
    <>
      <h3>Your API keys</h3>
      <p className="muted">One is minted per setup run. Revoking is permanent — a revoked worker just re-runs setup.</p>
      <ul className="list">
        {keys.map((k) => (
          <li key={k.id} className="repo-row">
            <span>
              <code>{k.prefix}…</code> <span className="muted">{k.name} · created {formatDate(k.created_at_epoch)} ·{" "}
              {k.last_used_at_epoch ? `last used ${formatDate(k.last_used_at_epoch)}` : "never used"}</span>{" "}
              {k.status === "revoked" && <span className="badge revoked">revoked</span>}
            </span>
            {k.status === "active" && (
              <button className="danger small" onClick={() => void api.revokeKey(k.id).then(load)}>
                revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

// ── memory viewer (#23) ───────────────────────────────────────────────────────

function MemoryList() {
  const { fingerprint = "" } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const refresh = () =>
    api
      .memories(fingerprint, { q: debounced || undefined, page })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch(() => setItems([]));
  useEffect(() => {
    void refresh();
  }, [fingerprint, debounced, page]);

  const visible = filterMemories(items, { type: typeFilter });

  return (
    <div>
      <p>
        <Link to="/">← repos</Link> <strong>{decodeURIComponent(fingerprint)}</strong>
      </p>
      <div className="toolbar">
        <input
          placeholder="Search memories…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <select value={typeFilter ?? ""} onChange={(e) => setTypeFilter(e.target.value || null)}>
          <option value="">all types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <p className="muted">{total} memories</p>
      <ul className="list">
        {visible.map((m) => (
          <li
            key={m.id}
            className="card"
            onClick={() => navigate(`/memory/${encodeURIComponent(m.id)}`)}
          >
            <span className="badge type">{m.type}</span>{" "}
            <p>{m.title ? <strong>{m.title} — </strong> : null}{preview(m.content)}</p>
            <p className="muted">
              {m.author_login ?? m.author_id} · {formatDate(m.created_at_epoch)}
              {m.mine && (
                <button
                  className="danger small"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Deleting is the only way to withdraw a memory, so confirm.
                    if (!confirm("Delete this memory for everyone on the team?")) return;
                    void api.deleteMemory(m.id).then(refresh);
                  }}
                >
                  delete
                </button>
              )}
            </p>
          </li>
        ))}
      </ul>
      {total > 20 && (
        <p>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>prev</button>{" "}
          page {page} of {Math.ceil(total / 20)}{" "}
          <button disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(page + 1)}>next</button>
        </p>
      )}
    </div>
  );
}

function MemoryView() {
  const { id = "" } = useParams();
  const [memory, setMemory] = useState<MemoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.memory(id).then(setMemory).catch((e) => setError(String(e)));
  }, [id]);
  if (error) return <p className="error">{error}</p>;
  if (!memory) return <p className="muted">Loading…</p>;
  return (
    <div>
      <p><Link to="/">← repos</Link></p>
      <span className="badge type">{memory.type}</span>
      {memory.title && <h2>{memory.title}</h2>}
      <p>{memory.content}</p>
      {memory.narrative && <p className="muted">{memory.narrative}</p>}
      {memory.facts.length > 0 && (
        <>
          <h3>Facts</h3>
          <ul>{memory.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </>
      )}
      {memory.anchors.length > 0 && (
        <>
          <h3>Anchors</h3>
          <ul>
            {memory.anchors.map((a) => (
              <li key={a.path}>
                <code>{a.path}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Provenance</h3>
      <p className="muted">
        by {memory.author_login ?? memory.author_id} on {formatDate(memory.created_at_epoch)}
        {typeof memory.metadata["prompt_version"] === "string" &&
          ` · prompt ${memory.metadata["prompt_version"]}`}
      </p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <main className="container">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cli-auth" element={<RequireAuth><CliAuth /></RequireAuth>} />
          <Route path="/github/setup" element={<RequireAuth><GithubSetup /></RequireAuth>} />
          <Route path="/" element={<RequireAuth><RepoSelect /></RequireAuth>} />
          <Route path="/org/:orgId" element={<RequireAuth><OrgAdmin /></RequireAuth>} />
          <Route path="/admin/orgs" element={<RequireAuth><SuperAdminOrgs /></RequireAuth>} />
          <Route path="/repo/:fingerprint" element={<RequireAuth><MemoryList /></RequireAuth>} />
          <Route path="/memory/:id" element={<RequireAuth><MemoryView /></RequireAuth>} />
          <Route
            path="*"
            element={
              <p className="error">
                Page not found: <code>{window.location.pathname}</code> — <Link to="/">go to repositories</Link>
              </p>
            }
          />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
