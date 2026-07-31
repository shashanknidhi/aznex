import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type OrgInfo, type SkippedRepo, type SyncResult } from "../api.js";
import { Shell } from "../components/Shell.js";
import { AsyncButton, Empty, ErrorNote, Loading, Note } from "../components/ui.js";

/**
 * Where GitHub sends you after installing or updating the App (its Setup URL),
 * with ?installation_id=…. We onboard every selected repo the caller can access.
 */
export function GithubSetup() {
  const [params] = useSearchParams();
  const installationId = Number(params.get("installation_id"));
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
  // GitHub tells us the installation, not which tenant owns it. One admin org is
  // unambiguous; several means the admin has to choose.
  const [adminOrgs, setAdminOrgs] = useState<OrgInfo[] | null>(null);

  const sync = (orgId: string) =>
    api.syncInstallation(orgId, installationId).then(setResult, (e: unknown) => setError(e));

  useEffect(() => {
    if (!Number.isInteger(installationId) || installationId <= 0) {
      setInvalid(true);
      return;
    }
    api.orgs().then(
      (r) => {
        const mine = r.orgs.filter((o) => o.role === "admin");
        setAdminOrgs(mine);
        if (mine.length === 1) void sync(mine[0]!.id);
      },
      (e: unknown) => setError(e),
    );
  }, [installationId]);

  if (invalid) {
    return (
      <Shell title="GitHub setup" crumbs={[["Repositories", "/"]]}>
        <h1>This link is missing its installation</h1>
        <p className="muted">
          GitHub didn't include an installation id. Start from the install link on the repositories
          page.
        </p>
        <Link className="btn" to="/">
          Go to repositories
        </Link>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell title="GitHub setup" crumbs={[["Repositories", "/"]]}>
        <h1>GitHub setup</h1>
        <ErrorNote error={error} context="Those repositories couldn't be onboarded." />
        <Link className="btn" to="/">
          Go to repositories
        </Link>
      </Shell>
    );
  }

  if (!result && adminOrgs && adminOrgs.length === 0) {
    return (
      <Shell title="GitHub setup" crumbs={[["Repositories", "/"]]}>
        <h1>You don't administer any organization</h1>
        <p className="muted">
          Repositories are onboarded into an organization, and only its admins can do that. Ask an
          admin of yours to onboard these, or to make you an admin.
        </p>
        <Link className="btn" to="/">
          Go to repositories
        </Link>
      </Shell>
    );
  }

  if (!result && adminOrgs && adminOrgs.length > 1) {
    return (
      <Shell title="GitHub setup" crumbs={[["Repositories", "/"]]}>
        <h1>Which organization owns these repositories?</h1>
        <p className="muted">You administer more than one, so GitHub's answer is ambiguous.</p>
        <ul className="list">
          {adminOrgs.map((o) => (
            <li key={o.id} className="row">
              <span>{o.name}</span>
              <div className="row-actions">
                <AsyncButton className="btn btn-sm" onClick={() => sync(o.id)} busyLabel="Onboarding…">
                  Onboard here
                </AsyncButton>
              </div>
            </li>
          ))}
        </ul>
      </Shell>
    );
  }

  if (!result) {
    return (
      <Shell title="GitHub setup" crumbs={[["Repositories", "/"]]}>
        <h1>GitHub setup</h1>
        <Loading label="Onboarding the repositories you selected…" />
      </Shell>
    );
  }

  const nothingHappened = result.onboarded.length === 0 && result.skipped.length === 0;

  return (
    <Shell title="GitHub setup" crumbs={[["Repositories", "/"], ["GitHub setup", null]]}>
      <h1>GitHub App installation synced</h1>

      {nothingHappened && (
        <Empty
          title="That installation covers no repositories"
          body="Nothing was selected on GitHub, or the selection didn't save. Open the install link again and pick the repositories you want."
        />
      )}

      {result.onboarded.length > 0 && (
        <>
          <h2>Onboarded</h2>
          <ul className="files">
            {result.onboarded.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
        </>
      )}

      {result.skipped.length > 0 && (
        <>
          <h2>Not onboarded</h2>
          {/* One heading used to claim every skip was a GitHub access problem,
              including repos that were simply owned by another organization. */}
          <ul className="list">
            {result.skipped.map((s) => (
              <li key={s.canonical} className="row">
                <div className="row-main">
                  <code>{s.canonical}</code>
                  <span className="muted">{skipReason(s)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {result.skipped.some((s) => s.reason === "owned_by_another_org") && (
        <Note tone="warn">
          <p>
            A repository can only belong to one organization at a time — Aznex won't move it silently,
            because that would hand one team's memories to another. An admin of the organization that
            owns it can remove it there first.
          </p>
        </Note>
      )}

      <p>
        <Link className="btn" to="/">
          Go to repositories
        </Link>
      </p>
    </Shell>
  );
}

function skipReason(s: SkippedRepo): string {
  switch (s.reason) {
    case "no_github_access":
      // Naming the login is the whole point: with two GitHub accounts, "you don't
      // have access" is unactionable until you know which identity was checked.
      return `GitHub doesn't list ${s.checked_login} as a collaborator on this repository`;
    case "owned_by_another_org":
      return s.owner_org_name
        ? `Already onboarded by ${s.owner_org_name}`
        : "Already onboarded by another organization";
    case "error":
      return `Couldn't be onboarded: ${s.detail}`;
  }
}
