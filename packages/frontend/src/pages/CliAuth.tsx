import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Shell } from "../components/Shell.js";
import { AsyncButton, ErrorNote, Note } from "../components/ui.js";

/**
 * Device-authorization consent for `aznex-worker setup`.
 *
 * The worker opens this in a browser, waits on a localhost callback, and mints
 * an API key from the one-time code we hand back.
 */
export function CliAuth() {
  const [params] = useSearchParams();
  const port = Number(params.get("port"));
  const state = params.get("state") ?? "";
  const [error, setError] = useState<unknown>(null);
  const [approved, setApproved] = useState(false);

  const valid = Number.isInteger(port) && port >= 1024 && port <= 65535 && state.length > 0;

  async function approve() {
    setError(null);
    try {
      const { code } = await api.approveCliAuth();
      setApproved(true);
      window.location.href = `http://127.0.0.1:${port}/callback?code=${code}&state=${encodeURIComponent(state)}`;
    } catch (e) {
      setError(e);
    }
  }

  if (!valid) {
    return (
      <Shell title="Authorize device">
        <h1>That authorization link isn't valid</h1>
        <p className="muted">
          It's missing the port or state that <code>aznex-worker setup</code> adds. Run setup again
          and use the link it opens.
        </p>
        <Link className="btn" to="/">
          Go to repositories
        </Link>
      </Shell>
    );
  }

  if (approved) {
    return (
      <Shell title="Device authorized">
        <h1>Authorized</h1>
        <p className="muted">
          You can close this tab and go back to your terminal. If the terminal doesn't continue, the
          worker may have stopped — run <code>aznex-worker setup</code> again.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Authorize device">
      <div className="center">
        <h1>Authorize this device?</h1>
        <Note>
          <p>
            <code>aznex-worker setup</code> on this machine (localhost:{port}) is asking for an API
            key tied to your account.
          </p>
          <p className="muted">Only approve this if you just ran setup yourself.</p>
        </Note>
        {error != null && <ErrorNote error={error} onRetry={() => void approve()} context="Couldn't authorize this device." />}
        <AsyncButton className="btn btn-primary" onClick={approve} busyLabel="Authorizing…">
          Approve
        </AsyncButton>
      </div>
    </Shell>
  );
}
