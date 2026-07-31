import { Link, useLocation } from "react-router-dom";
import { BareShell } from "../components/Shell.js";

export function NotFound() {
  // useLocation, not window.location: on a client-side navigation to a bad route
  // the window value can still be the previous path.
  const { pathname } = useLocation();
  return (
    <BareShell title="Page not found">
      <h1>Page not found</h1>
      <p className="muted">
        Nothing lives at <code>{pathname}</code>.
      </p>
      <Link className="btn" to="/">
        Go to repositories
      </Link>
    </BareShell>
  );
}
