import { useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell.js";
import { Note } from "../components/ui.js";

const WORKER_SETTINGS = "http://localhost:29639";

/**
 * How to actually get memories into Aznex.
 *
 * Nothing in the app used to say that this site is read-only, or that capture
 * happens in a worker on your own machine — so a new user who reached an empty
 * repository had no next step at all.
 */
export function GetStarted() {
  const install = `curl -fsSL ${window.location.origin}/install.sh | bash`;

  return (
    <Shell title="Get started" crumbs={[["Repositories", "/"], ["Get started", null]]}>
      <h1>Get started</h1>

      <Note>
        <p>
          <strong>This site only reads.</strong> Memories are captured by the Aznex worker running on
          your own machine, from your coding agent's sessions. Until you install it, your
          repositories here stay empty.
        </p>
      </Note>

      <h2>1. Install the worker</h2>
      <p className="muted">
        Run this on your development machine. It installs the worker, starts it as a background
        service, and opens a browser tab for you to approve.
      </p>
      <Copyable text={install} />

      <h2>2. Approve the device</h2>
      <p className="muted">
        Setup opens a page here asking you to authorize the machine. Approving mints an API key tied
        to your account — you'll see it under{" "}
        <Link to="/">your API keys</Link>. Nothing works until this step completes.
      </p>

      <h2>3. Use your agent normally</h2>
      <p className="muted">
        That's it. Claude Code and Codex both fire hooks the worker listens for. After a session
        ends, the worker extracts what was learned using your own agent subscription, strips secrets,
        and sends only the finished memory here. Raw tool output never leaves your machine.
      </p>

      <h2>Checking on it</h2>
      <ul className="plain-list">
        <li>
          <code>aznex-worker doctor</code> — checks the daemon, the hooks, and the API key, and says
          what's wrong.
        </li>
        <li>
          The worker's own settings page runs at{" "}
          <a href={WORKER_SETTINGS} target="_blank" rel="noopener noreferrer">
            <code>{WORKER_SETTINGS}</code>
          </a>{" "}
          while the daemon is up. That link only works on the machine the worker is installed on.
        </li>
      </ul>

      <h2>Nothing is appearing</h2>
      <ul className="plain-list">
        <li>
          A repository has to be onboarded by an admin of your organization before its memories are
          stored. If it isn't in <Link to="/">your list</Link>, ask them.
        </li>
        <li>
          GitHub has to list you as a collaborator on it. Being in the GitHub organization is not
          always enough — private repositories need actual collaborator access.
        </li>
        <li>
          Memories arrive after a session ends, not while it runs. Give it a session or two.
        </li>
      </ul>
    </Shell>
  );
}

function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="command">
      <code>{text}</code>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          // clipboard is unavailable on insecure origins; the text is selectable
          // either way, so a failure just means no confirmation.
          void navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            },
            () => {},
          );
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
