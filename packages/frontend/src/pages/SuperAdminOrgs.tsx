import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAsync, useFlash } from "../hooks.js";
import { Shell } from "../components/Shell.js";
import { AsyncButton, Badge, Empty, ErrorNote, Flash, Loading, useConfirm } from "../components/ui.js";

export function SuperAdminOrgs() {
  const { confirm, dialog } = useConfirm();
  const [actionError, setActionError] = useState<unknown>(null);
  const [flash, setFlash] = useFlash();
  const { data, error, loading, reload } = useAsync((signal) => api.allOrgs(signal), []);

  async function run(action: Promise<unknown>): Promise<boolean> {
    setActionError(null);
    try {
      await action;
      reload();
      return true;
    } catch (e) {
      setActionError(e);
      return false;
    }
  }

  async function toggle(org: { id: string; name: string; status: string }) {
    const next = org.status === "active" ? "suspended" : "active";
    if (next === "suspended") {
      const ok = await confirm({
        title: `Suspend ${org.name}?`,
        body: "Every agent in this organization stops reading and writing immediately. Nothing is deleted, and resuming restores access.",
        confirmLabel: "Suspend organization",
        tone: "danger",
      });
      if (!ok) return;
    }
    await run(api.setOrgStatus(org.id, next));
  }

  if (error) {
    return (
      <Shell title="Organizations" crumbs={[["Repositories", "/"]]}>
        <h1>Organizations</h1>
        <ErrorNote error={error} onRetry={reload} context="Organizations couldn't be loaded." />
      </Shell>
    );
  }

  return (
    <Shell title="Organizations" crumbs={[["Repositories", "/"], ["Organizations", null]]}>
      <h1>Organizations</h1>
      <Flash message={flash} />
      {actionError != null && <ErrorNote error={actionError} />}

      {loading && !data ? (
        <Loading label="Loading organizations…" />
      ) : data!.orgs.length === 0 ? (
        <Empty
          title="No organizations yet"
          body="Create the first one below. Its admins can then onboard their own repositories and members without further server configuration."
        />
      ) : (
        <ul className="list">
          {data!.orgs.map((o) => (
            <li key={o.id} className="row">
              <div className="row-main">
                <span>
                  <Link to={`/org/${encodeURIComponent(o.id)}`}>{o.name}</Link>{" "}
                  {o.status === "suspended" && <Badge tone="warn">suspended</Badge>}
                </span>
                <span className="muted">
                  <code>{o.slug}</code> · {o.member_count} members · {o.repo_count} repositories
                </span>
              </div>
              <div className="row-actions">
                <AsyncButton
                  className={o.status === "active" ? "btn btn-sm btn-danger" : "btn btn-sm"}
                  onClick={() => toggle(o)}
                >
                  {o.status === "active" ? "Suspend" : "Resume"}
                </AsyncButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2>New organization</h2>
      <p className="muted">
        The admins you name here onboard their own repositories and members — no further server
        configuration needed.
      </p>
      <CreateOrgForm
        onSubmit={(body) => run(api.createOrg(body)).then((ok) => {
          if (ok) setFlash(`${body.name} created`);
          return ok;
        })}
      />
      {dialog}
    </Shell>
  );
}

function CreateOrgForm({
  onSubmit,
}: {
  onSubmit: (body: { slug: string; name: string; admin_logins: string[] }) => Promise<boolean>;
}) {
  const [form, setForm] = useState({ slug: "", name: "", admins: "" });
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="toolbar"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void onSubmit({
          slug: form.slug.trim(),
          name: form.name.trim(),
          admin_logins: form.admins.split(",").map((l) => l.trim()).filter(Boolean),
        })
          // Reset only on success — a taken slug used to discard the whole form,
          // including a hand-typed list of admin usernames.
          .then((ok) => {
            if (ok) setForm({ slug: "", name: "", admins: "" });
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="field">
        <label htmlFor="org-slug">Short name</label>
        <input
          id="org-slug"
          required
          disabled={busy}
          placeholder="acme-corp"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="org-name">Display name</label>
        <input
          id="org-name"
          required
          disabled={busy}
          placeholder="Acme Corp"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="org-admins">Admin GitHub usernames</label>
        <input
          id="org-admins"
          required
          disabled={busy}
          placeholder="octocat, hubot"
          value={form.admins}
          onChange={(e) => setForm({ ...form, admins: e.target.value })}
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
