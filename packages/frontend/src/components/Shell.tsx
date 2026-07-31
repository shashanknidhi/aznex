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
  const { me } = useMe();
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
              <span className="badge badge-neutral">{roleSummary(me)}</span>
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

function roleSummary(me: { is_super_admin: boolean; orgs: { role: string }[] }): string {
  if (me.is_super_admin) return "super admin";
  const admin = me.orgs.filter((o) => o.role === "admin").length;
  if (admin > 0) return admin === 1 ? "org admin" : `admin of ${admin} orgs`;
  return "member";
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
