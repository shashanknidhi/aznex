import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { api, authClient } from "../api.js";
import { appUrl } from "../auth.js";
import { useAsync } from "../hooks.js";
import { BareShell } from "../components/Shell.js";
import { ErrorNote, Loading, Note } from "../components/ui.js";

export function Login() {
  const { data: session, isPending } = authClient.useSession();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/";
  const expired = params.get("reason") === "expired";
  const [error, setError] = useState<unknown>(null);

  // A deployment with no GitHub OAuth credentials never registers the provider,
  // so the button silently did nothing. Ask the server first and say so instead.
  // If /api/config itself fails, assume OAuth is fine rather than blocking login.
  const config = useAsync(() => api.config().catch(() => null), []);

  if (isPending) return <Loading />;
  if (session) return <Navigate to={next} replace />;

  const oauthReady = config.data?.github_oauth !== false;

  return (
    <BareShell title="Sign in">
      <div className="center">
        <h1>Aznex</h1>
        <p className="muted">Team-shared institutional memory for coding agents.</p>

        {expired && (
          <Note tone="warn">
            <p>Your session expired. Sign in again to pick up where you left off.</p>
          </Note>
        )}

        {!oauthReady && (
          <Note tone="warn">
            <p>
              This server has no GitHub sign-in configured, so there's no way to log in yet. Whoever
              runs it needs to set <code>GITHUB_OAUTH_CLIENT_ID</code> and{" "}
              <code>GITHUB_OAUTH_CLIENT_SECRET</code>.
            </p>
          </Note>
        )}

        {error != null && <ErrorNote error={error} context="Sign-in couldn't be started." />}

        <button
          type="button"
          className="btn btn-primary"
          disabled={!oauthReady}
          onClick={() => {
            setError(null);
            // Previously unhandled: a rejected sign-in left the page looking
            // like the click hadn't registered.
            void authClient
              // callbackURL leaves the router: better-auth hands it to GitHub
              // and the browser lands on it directly, so it needs the basename.
              .signIn.social({ provider: "github", callbackURL: appUrl(next) })
              .catch((e: unknown) => setError(e));
          }}
        >
          Sign in with GitHub
        </button>

      </div>
    </BareShell>
  );
}
