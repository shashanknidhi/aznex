import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  useParams,
  useNavigate,
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
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Login() {
  const { session } = useSession();
  if (session) return <Navigate to="/" replace />;
  return (
    <div className="center">
      <h1>Aznex</h1>
      <p className="muted">Team-shared institutional memory for coding agents.</p>
      <button
        onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/" })}
      >
        Sign in with GitHub
      </button>
    </div>
  );
}

// ── repo selector (#22) ───────────────────────────────────────────────────────

function RepoSelect() {
  const [repos, setRepos] = useState<RepoInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.repos().then((r) => setRepos(r.repos)).catch((e) => setError(String(e)));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!repos) return <p className="muted">Loading repos…</p>;
  return (
    <div>
      <h2>Your repositories</h2>
      {repos.length === 0 && <p className="muted">No Aznex-enabled repos you can access yet.</p>}
      <ul className="list">
        {repos.map((r) => (
          <li key={r.fingerprint}>
            <Link to={`/repo/${encodeURIComponent(r.fingerprint)}`}>{r.canonical}</Link>
          </li>
        ))}
      </ul>
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
          <Route path="/" element={<RequireAuth><RepoSelect /></RequireAuth>} />
          <Route path="/repo/:fingerprint" element={<RequireAuth><MemoryList /></RequireAuth>} />
          <Route path="/memory/:id" element={<RequireAuth><MemoryView /></RequireAuth>} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
