import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type ApiKeyInfo, type OrgInfo, type RepoInfo } from "../api.js";
import { formatDateTime, formatRelative, isoDate } from "../format.js";
import { useAsync, useFlash } from "../hooks.js";
import { useMe } from "../auth.js";
import { Shell } from "../components/Shell.js";
import {
  AsyncButton,
  Badge,
  Empty,
  ErrorNote,
  Flash,
  Loading,
  Note,
  useConfirm,
} from "../components/ui.js";

/**
 * Home: the repos you can read, grouped by the org that owns them.
 *
 * Grouped because rights are per-org — you may be an admin in one and a reader
 * in another, and the available actions differ.
 */
export function RepoSelect() {
  const { me, error: meError } = useMe();
  const { confirm, dialog } = useConfirm();
  const [actionError, setActionError] = useState<unknown>(null);
  const [flash, setFlash] = useFlash();
  const { data, error, loading, reload } = useAsync((signal) => api.repos(signal), []);
  const config = useAsync(() => api.config().catch(() => null), []);

  async function deboard(org: OrgInfo, repo: RepoInfo) {
    const ok = await confirm({
      title: `Remove ${repo.canonical} from ${org.name}?`,
      body: "Agents stop reading and writing its memories. Nothing is deleted — onboarding it again brings everything back.",
      confirmLabel: "Remove repository",
      tone: "danger",
    });
    if (!ok) return;
    setActionError(null);
    try {
      await api.removeRepo(org.id, repo.fingerprint);
      setFlash(`${repo.canonical} removed from ${org.name}`);
      reload();
    } catch (e) {
      setActionError(e);
    }
  }

  // A 403 on /api/me means the account belongs to no org — the one case where
  // the friendly explanation used to be unreachable, because every call failed.
  if (meError) {
    return (
      <Shell title="Repositories">
        <h1>Repositories</h1>
        <ErrorNote error={meError} context="Your account isn't set up on this server yet." />
        <Empty
          title="You're signed in, but not a member of any organization"
          body="Aznex groups repositories by organization. Ask an admin to add your GitHub username to theirs, then reload this page."
        />
      </Shell>
    );
  }

  return (
    <Shell title="Repositories">
      <h1>Repositories</h1>
      <Flash message={flash} />

      {config.data?.github_app === false && (
        <Note tone="warn">
          <p>
            This server has no GitHub App configured, so it can't check who has access to a
            repository. Until that's set up, repositories won't appear here.
          </p>
        </Note>
      )}

      {actionError != null && <ErrorNote error={actionError} />}

      {error ? (
        <ErrorNote error={error} onRetry={reload} context="Your repositories couldn't be loaded." />
      ) : loading && !data ? (
        <Loading label="Loading repositories…" />
      ) : (
        <>
          {data!.orgs.length === 0 && (
            <Empty
              title="You aren't a member of any organization yet"
              body="Ask an admin to add your GitHub username to their organization, then reload this page."
            />
          )}

          {data!.orgs.map((org) => {
            const owned = data!.repos.filter((r) => r.org_id === org.id);
            const isAdmin = org.role === "admin";
            return (
              <section key={org.id}>
                <h2>
                  {org.name} <Badge>{org.role}</Badge>
                </h2>

                {owned.length === 0 ? (
                  <Empty
                    title="No repositories you can access here"
                    body={
                      isAdmin
                        ? "Onboard one below. You'll only see repositories GitHub lists you as a collaborator on."
                        : "Either nothing has been onboarded yet, or GitHub doesn't list you as a collaborator on the repositories that have been. An admin of this organization can check."
                    }
                  />
                ) : (
                  <ul className="list">
                    {owned.map((r) => (
                      <li key={r.fingerprint} className="row">
                        <Link to={`/repo/${encodeURIComponent(r.fingerprint)}`}>{r.canonical}</Link>
                        {isAdmin && (
                          <div className="row-actions">
                            <AsyncButton
                              className="btn btn-sm btn-danger"
                              onClick={() => deboard(org, r)}
                            >
                              Remove
                            </AsyncButton>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {isAdmin && (
                  <>
                    <p>
                      <Link to={`/org/${encodeURIComponent(org.id)}`}>Members and API keys →</Link>
                    </p>
                    {data!.github_app_install_url ? (
                      <p>
                        {/* A styled anchor, not a <button> inside an <a> — that
                            nesting is invalid and double-announces. */}
                        <a
                          className="btn"
                          href={data!.github_app_install_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Pick repositories on GitHub →
                        </a>{" "}
                        <span className="muted">
                          Select them there; GitHub sends you back and they onboard automatically.
                        </span>
                      </p>
                    ) : (
                      <Note tone="warn">
                        <p>
                          This server doesn't know its GitHub App's name, so the one-click install
                          link is unavailable. Onboard repositories by name below, or ask whoever runs
                          the server to set <code>AZNEX_GITHUB_APP_SLUG</code>.
                        </p>
                      </Note>
                    )}
                    <OnboardRepoForm
                      orgId={org.id}
                      onAdded={(fingerprint) => {
                        setFlash(`${fingerprint} onboarded`);
                        reload();
                      }}
                    />
                  </>
                )}
              </section>
            );
          })}
        </>
      )}

      <ApiKeys superAdmin={me?.is_super_admin ?? false} />
      {dialog}
    </Shell>
  );
}

// ── onboarding one repo by name ──────────────────────────────────────────────

const FINGERPRINT = /^[^/\s]+\/[^/\s]+\/[^/\s]+$/;

function OnboardRepoForm({ orgId, onAdded }: { orgId: string; onAdded: (fingerprint: string) => void }) {
  const [fingerprint, setFingerprint] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = fingerprint.trim().replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/\/+$/, "");
    setError(null);
    // Caught here rather than after a round-trip that answers with a code.
    if (!FINGERPRINT.test(value)) {
      setHint("Use the full form: github.com/owner/repo");
      return;
    }
    setHint(null);
    setBusy(true);
    try {
      await api.addRepo(orgId, { fingerprint: value });
      setFingerprint("");
      onAdded(value);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="toolbar" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`onboard-${orgId}`}>Onboard a repository by name</label>
          <input
            id={`onboard-${orgId}`}
            required
            disabled={busy}
            placeholder="github.com/owner/repo"
            value={fingerprint}
            onChange={(e) => setFingerprint(e.target.value)}
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Onboarding…" : "Onboard"}
          </button>
        </div>
      </form>
      {hint && (
        <p className="note note-warn" role="alert">
          {hint}
        </p>
      )}
      {error != null && <ErrorNote error={error} context="That repository couldn't be onboarded." />}
    </>
  );
}

// ── your own API keys ────────────────────────────────────────────────────────

function ApiKeys({ superAdmin }: { superAdmin: boolean }) {
  const { confirm, dialog } = useConfirm();
  const [actionError, setActionError] = useState<unknown>(null);
  const { data, error, loading, reload } = useAsync((signal) => api.keys(signal), []);

  async function revoke(key: ApiKeyInfo) {
    const ok = await confirm({
      title: `Revoke ${key.prefix}…?`,
      body: "Any worker using this key stops immediately and can't be restored. Running `aznex-worker setup` again mints a new one.",
      confirmLabel: "Revoke key",
      tone: "danger",
    });
    if (!ok) return;
    setActionError(null);
    try {
      await api.revokeKey(key.id);
      reload();
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <>
      <h2>Your API keys</h2>
      <p className="muted">
        One key is created each time you run <code>aznex-worker setup</code>. Revoking is permanent.
      </p>

      {actionError != null && <ErrorNote error={actionError} context="That key couldn't be revoked." />}

      {error ? (
        // The section used to vanish entirely on failure, so you couldn't tell
        // "no keys" from "the request failed".
        <ErrorNote error={error} onRetry={reload} context="Your API keys couldn't be loaded." />
      ) : loading && !data ? (
        <Loading label="Loading keys…" />
      ) : data!.keys.length === 0 ? (
        <Empty
          title="No API keys yet"
          body={
            <>
              Keys are created by the worker, not here. Run <code>aznex-worker setup</code> on your
              machine and approve it in the browser.
            </>
          }
          action={
            <Link className="btn" to="/get-started">
              How to set that up
            </Link>
          }
        />
      ) : (
        <ul className="list">
          {data!.keys.map((k) => (
            <li key={k.id} className="row">
              <div className="row-main">
                <span>
                  <code>{k.prefix}…</code> {k.name}
                  {k.status === "revoked" && <> <Badge tone="warn">revoked</Badge></>}
                </span>
                <span className="muted">
                  Created <time dateTime={isoDate(k.created_at_epoch)}>{formatDateTime(k.created_at_epoch)}</time>
                  {" · "}
                  {k.last_used_at_epoch
                    ? `last used ${formatRelative(k.last_used_at_epoch)}`
                    : "never used"}
                </span>
              </div>
              {k.status === "active" && (
                <div className="row-actions">
                  <AsyncButton className="btn btn-sm btn-danger" onClick={() => revoke(k)}>
                    Revoke
                  </AsyncButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {superAdmin && (
        <p className="muted">
          As a super admin you can also <Link to="/admin/orgs">manage organizations</Link>.
        </p>
      )}
      {dialog}
    </>
  );
}
