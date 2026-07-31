import { useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError, type OrgKey, type OrgMember, type OrgRole } from "../api.js";
import { formatDateTime, formatRelative, isoDate } from "../format.js";
import { useAsync, useFlash } from "../hooks.js";
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
 * One org's members and their API keys.
 *
 * The two halves load independently on purpose: members are visible to any
 * member, keys only to admins. Loading them in one `Promise.all` meant the
 * admin-only failure took down the whole page for ordinary members.
 */
export function OrgAdmin() {
  const { orgId = "" } = useParams();
  const { confirm, dialog } = useConfirm();
  const [actionError, setActionError] = useState<unknown>(null);
  const [flash, setFlash] = useFlash();

  const members = useAsync((signal) => api.orgMembers(orgId, signal), [orgId]);
  const keys = useAsync((signal) => api.orgKeys(orgId, signal), [orgId]);

  /** Run a mutation, refresh, and report whether it actually succeeded. */
  async function run(action: Promise<unknown>, onOk?: () => void): Promise<boolean> {
    setActionError(null);
    try {
      await action;
      members.reload();
      keys.reload();
      onOk?.();
      return true;
    } catch (e) {
      setActionError(e);
      return false;
    }
  }

  async function setRole(m: OrgMember) {
    const next: OrgRole = m.role === "admin" ? "member" : "admin";
    const ok = await confirm({
      title: next === "admin" ? `Make ${m.github_login} an admin?` : `Make ${m.github_login} a member?`,
      body:
        next === "admin"
          ? "Admins can onboard and remove repositories, add and remove members, and revoke other members' API keys."
          : "They keep read access but lose the ability to manage this organization.",
      confirmLabel: next === "admin" ? "Make admin" : "Make member",
    });
    if (!ok) return;
    await run(api.setMemberRole(orgId, m.github_login, next));
  }

  async function removeMember(m: OrgMember) {
    const ok = await confirm({
      title: `Remove ${m.github_login}?`,
      body: "They lose access on their next request. Memories they captured stay with the team, and their API keys keep working for any other organization they belong to.",
      confirmLabel: "Remove member",
      tone: "danger",
    });
    if (!ok) return;
    await run(api.removeMember(orgId, m.github_login), () => setFlash(`${m.github_login} removed`));
  }

  async function revokeKey(k: OrgKey) {
    const ok = await confirm({
      title: `Revoke ${k.github_login}'s key ${k.prefix}…?`,
      body: "Their worker stops immediately. They can mint a new key by running `aznex-worker setup` again.",
      confirmLabel: "Revoke key",
      tone: "danger",
    });
    if (!ok) return;
    await run(api.revokeOrgKey(orgId, k.id));
  }

  // Whole-page failure only when the member list itself is unreachable.
  if (members.error) {
    return (
      <Shell title="Organization" crumbs={[["Repositories", "/"]]}>
        <h1>Organization</h1>
        <ErrorNote
          error={members.error}
          onRetry={members.reload}
          context="This organization couldn't be loaded."
        />
      </Shell>
    );
  }

  return (
    <Shell title="Members and keys" crumbs={[["Repositories", "/"], ["Members and keys", null]]}>
      <h1>Members and keys</h1>
      <Flash message={flash} />
      {actionError != null && <ErrorNote error={actionError} />}

      <h2>Members</h2>
      <p className="muted">
        Members sign in with GitHub and see this organization's repositories that GitHub lists them as
        a collaborator on. Removing someone cuts their access on the next request; what they captured
        stays with the team.
      </p>

      {members.loading && !members.data ? (
        <Loading label="Loading members…" />
      ) : members.data!.members.length === 0 ? (
        <Empty title="No members yet" body="Add a GitHub username below to invite someone." />
      ) : (
        <ul className="list">
          {members.data!.members.map((m) => (
            <li key={m.github_login} className="row">
              <div className="row-main">
                <span>
                  <code>{m.github_login}</code> <Badge>{m.role}</Badge>
                  {!m.signed_in && <> <Badge tone="warn">never signed in</Badge></>}
                </span>
                {m.invited_by_login && <span className="muted">Invited by {m.invited_by_login}</span>}
              </div>
              <div className="row-actions">
                <AsyncButton className="btn btn-sm" onClick={() => setRole(m)}>
                  Make {m.role === "admin" ? "member" : "admin"}
                </AsyncButton>
                <AsyncButton className="btn btn-sm btn-danger" onClick={() => removeMember(m)}>
                  Remove
                </AsyncButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddMemberForm
        onSubmit={(github_login, role) => run(api.addMember(orgId, { github_login, role }), () => setFlash(`${github_login} added`))}
      />

      <h2>Member API keys</h2>
      {keys.error ? (
        // An ordinary member legitimately can't read these. Say that rather than
        // presenting it as a failure.
        keys.error instanceof ApiError && keys.error.status === 403 ? (
          <Note>
            <p className="muted">Only admins of this organization can see its members' API keys.</p>
          </Note>
        ) : (
          <ErrorNote error={keys.error} onRetry={keys.reload} context="API keys couldn't be loaded." />
        )
      ) : keys.loading && !keys.data ? (
        <Loading label="Loading keys…" />
      ) : keys.data!.keys.length === 0 ? (
        <Empty
          title="No API keys yet"
          body="Keys appear here once a member runs the Aznex worker setup on their machine."
        />
      ) : (
        <ul className="list">
          {keys.data!.keys.map((k) => (
            <li key={k.id} className="row">
              <div className="row-main">
                <span>
                  <code>{k.github_login}</code> <code>{k.prefix}…</code> {k.name}
                  {k.status === "revoked" && <> <Badge tone="warn">revoked</Badge></>}
                </span>
                <span className="muted">
                  Created <time dateTime={isoDate(k.created_at_epoch)}>{formatDateTime(k.created_at_epoch)}</time>
                  {" · "}
                  {k.last_used_at_epoch ? `last used ${formatRelative(k.last_used_at_epoch)}` : "never used"}
                </span>
              </div>
              {k.status === "active" && (
                <div className="row-actions">
                  <AsyncButton className="btn btn-sm btn-danger" onClick={() => revokeKey(k)}>
                    Revoke
                  </AsyncButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </Shell>
  );
}

function AddMemberForm({ onSubmit }: { onSubmit: (login: string, role: OrgRole) => Promise<boolean> }) {
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="toolbar"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        // Only clear the field when the request actually succeeded. The previous
        // version reset unconditionally, so a rejected username was wiped along
        // with whatever the user had typed.
        void onSubmit(login.trim(), role)
          .then((ok) => {
            if (ok) setLogin("");
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="field">
        <label htmlFor="member-login">GitHub username</label>
        <input
          id="member-login"
          required
          disabled={busy}
          placeholder="octocat"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="member-role">Role</label>
        <select id="member-role" value={role} disabled={busy} onChange={(e) => setRole(e.target.value as OrgRole)}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Adding…" : "Add member"}
        </button>
      </div>
    </form>
  );
}
