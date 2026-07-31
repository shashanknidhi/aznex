import { Link, useLocation } from "react-router-dom";
import { signOut, useMe } from "../auth.js";
import { useDocumentTitle } from "../hooks.js";

/** `[label, href]`; a null href is the current page. */
export type Crumb = [string, string | null];

/**
 * The frame every authenticated page renders inside.
 *
 * Before this there was no header, no navigation, no indication of who was
 * signed in, and — worst — no way to sign out at all, so a stale session or the
 * wrong GitHub account was a dead end.
 */
export function Shell({
  title,
  crumbs,
  children,
}: {
  title: string | null;
  crumbs?: Crumb[];
  children: React.ReactNode;
}) {
  const { me, activeOrg, setActiveOrg } = useMe();
  const { pathname } = useLocation();
  useDocumentTitle(title);

  const nav: { label: string; to: string }[] = [
    { label: "Repositories", to: "/" },
    // Only super admins have anywhere to go here. This link used to be a line of
    // text buried in the middle of the repo list.
    ...(me?.is_super_admin ? [{ label: "Organizations", to: "/admin/orgs" }] : []),
    { label: "Get started", to: "/get-started" },
  ];

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell-header">
        <div className="shell-bar">
          <Link to="/" className="wordmark">
            Aznex
          </Link>
          <nav className="shell-nav" aria-label="Main">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="shell-nav-link"
                aria-current={pathname === item.to ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {me && (
            <div className="shell-identity">
              <span className="shell-login">@{me.login}</span>
              {/* The org the whole UI is scoped to. It used to say "org admin"
                  while the page below listed an org you're only a member of. */}
              {me.orgs.length > 1 ? (
                <label className="shell-org">
                  <span className="sr-only">Organization</span>
                  <select
                    value={activeOrg?.id ?? ""}
                    onChange={(e) => setActiveOrg(e.target.value)}
                  >
                    {me.orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                activeOrg && <span className="shell-org-name">{activeOrg.name}</span>
              )}
              {activeOrg && <span className="badge badge-neutral">{activeOrg.role}</span>}
              {me.is_super_admin && <span className="badge badge-neutral">super admin</span>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="container" id="main">
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map(([label, to], i) => (
              <span key={`${label}-${i}`}>
                {i > 0 && <span className="crumb-sep" aria-hidden="true">/</span>}
                {to ? (
                  <Link to={to}>{label}</Link>
                ) : (
                  <span aria-current="page">{label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        {children}
      </main>
    </>
  );
}

/** Stripped frame for the pages you reach without being signed in. */
export function BareShell({ title, children }: { title: string | null; children: React.ReactNode }) {
  useDocumentTitle(title);
  return (
    <main className="container" id="main">
      {children}
    </main>
  );
}
