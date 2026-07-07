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
import { authClient, api, type MemoryItem, type MemoryDetail, type RepoInfo } from "./api.js";
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

function OnboardRepoForm({ onAdded }: { onAdded: () => void }) {
  const [fingerprint, setFingerprint] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    try {
      await api.addRepo({ fingerprint: fingerprint.trim() });
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

function RepoSelect() {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api.repos().then((r) => {
      setRepos(r.repos);
      setIsAdmin(r.user.is_admin);
      setInstallUrl(r.github_app_install_url);
    }).catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, []);

  async function deboard(fingerprint: string) {
    try {
      await api.removeRepo(fingerprint);
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
      {repos.length === 0 && <p className="muted">No Aznex-enabled repos you can access yet.</p>}
      <ul className="list">
        {repos.map((r) => (
          <li key={r.fingerprint} className="repo-row">
            <Link to={`/repo/${encodeURIComponent(r.fingerprint)}`}>{r.canonical}</Link>
            {isAdmin && (
              <button className="danger small" onClick={() => void deboard(r.fingerprint)}>
                de-board
              </button>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <>
          <h3>Onboard repositories (admin)</h3>
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
          <OnboardRepoForm onAdded={() => void load()} />
        </>
      )}
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

  useEffect(() => {
    if (!Number.isInteger(installationId) || installationId <= 0) {
      setError("missing installation_id");
      return;
    }
    api.syncInstallation(installationId).then(setResult).catch((e) => setError(String(e)));
  }, [installationId]);

  if (error) return <p className="error">{error} — <Link to="/">back to repos</Link></p>;
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

// ── memory viewer (#23) ───────────────────────────────────────────────────────

function badgeClass(state: string): string {
  return state === "stale_suspected" ? "badge stale" : "badge";
}

function MemoryList() {
  const { fingerprint = "" } = useParams();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [freshFilter, setFreshFilter] = useState<string | null>(null);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    api
      .memories(fingerprint, { q: debounced || undefined, page })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch(() => setItems([]));
  }, [fingerprint, debounced, page]);

  const visible = filterMemories(items, { type: typeFilter, freshness: freshFilter });

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
        <select value={freshFilter ?? ""} onChange={(e) => setFreshFilter(e.target.value || null)}>
          <option value="">any freshness</option>
          <option value="fresh">fresh</option>
          <option value="stale_suspected">stale suspected</option>
        </select>
      </div>
      <p className="muted">{total} memories</p>
      <ul className="list">
        {visible.map((m) => (
          <li
            key={m.id}
            className={m.freshness_state === "stale_suspected" ? "card stale-card" : "card"}
            onClick={() => navigate(`/memory/${encodeURIComponent(m.id)}`)}
          >
            <span className="badge type">{m.type}</span>{" "}
            <span className={badgeClass(m.freshness_state)}>{m.freshness_state}</span>
            <p>{m.title ? <strong>{m.title} — </strong> : null}{preview(m.content)}</p>
            <p className="muted">
              {m.author_id} · {formatDate(m.created_at_epoch)}
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
      <span className="badge type">{memory.type}</span>{" "}
      <span className={badgeClass(memory.freshness_state)}>{memory.freshness_state}</span>
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
                {a.commit_sha && <span className="muted"> @ {a.commit_sha.slice(0, 8)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Provenance</h3>
      <p className="muted">
        by {memory.author_id} on {formatDate(memory.created_at_epoch)}
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
