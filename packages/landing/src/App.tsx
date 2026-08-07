import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DRIFT } from "./drift.js";
import { motionOK, runMotion } from "./effects.js";

const REPO = "https://github.com/shashanknidhi/aznex";
const PILOT_MAILTO =
  "mailto:shashank@aznex.ai?subject=Aznex%20pilot%20access&body=GitHub%20login%3A%0ARepo%20(github.com%2Fowner%2Fname)%3A%0APeople%20on%20the%20team%3A%0AAgents%20you%20use%3A%0A";
const INSTALL_CMD = "curl -fsSL https://app.aznex.ai/install.sh | bash";

function Mark() {
  return (
    <svg className="mark" viewBox="4.5 7 23.5 18" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" opacity="0.75">
        <path d="M6 9h9" />
        <path d="M6 16h6" />
        <path d="M6 23h9" />
      </g>
      <rect x="19" y="12" width="8" height="8" fill="var(--ochre)" />
    </svg>
  );
}

/** The label names the theme you get by pressing it. */
function ThemeToggle() {
  const [light, setLight] = useState(
    () => document.documentElement.dataset.theme === "light",
  );
  const label = `Switch to ${light ? "dark" : "light"} theme`;
  return (
    <button
      className="theme"
      type="button"
      id="theme"
      aria-label={label}
      title={label}
      onClick={() => {
        if (light) delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = "light";
        localStorage.setItem("aznex-theme", light ? "dark" : "light");
        setLight(!light);
      }}
    >
      {/* Half-filled square: the contrast glyph, squared to match the mark. */}
      <svg className="theme-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M1 1h7v14H1z" fill="currentColor" />
        <path d="M1.5 1.5h13v13h-13z" fill="none" stroke="currentColor" />
      </svg>
    </button>
  );
}

/** Everything else on this page works without an interaction handler. */
function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("Copy");
  useEffect(() => {
    if (label === "Copy") return;
    const t = setTimeout(() => setLabel("Copy"), 2000);
    return () => clearTimeout(t);
  }, [label]);
  return (
    <button
      className="install-copy"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setLabel("Copied");
        } catch {
          setLabel("Press ⌘C");
        }
      }}
    >
      {label}
    </button>
  );
}

export default function App() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => runMotion(root.current!), []);

  // The drift loops by translating the track half its height, so it needs two
  // copies of the list to be seamless. Only worth duplicating if it will move.
  const drift = motionOK ? [...DRIFT, ...DRIFT] : DRIFT;

  return (
    <div ref={root}>
      <a className="skip" href="#main">
        Skip to content
      </a>

      <header className="nav">
        <a className="wordmark" href="/">
          <Mark />
          aznex
        </a>
        <nav className="nav-links">
          <a href={`${REPO}/tree/main/docs`}>Docs</a>
          <a href={REPO}>GitHub</a>
          <ThemeToggle />
        </nav>
      </header>

      <main id="main">
        <section className="section hero">
          <div className="hero-copy">
            <h1 className="hero-title">
              Your agent forgets.
              <br />
              <span className="hero-title-em">Your team shouldn't.</span>
            </h1>
            <p className="hero-sub">
              Aznex is the shared context layer for your repo. One developer's agent works
              something out; every teammate's agent starts from there.
            </p>

            <div className="cta-row">
              <a className="btn btn-solid" href={PILOT_MAILTO}>
                Request pilot access
              </a>
              <a className="btn btn-ghost" href={REPO}>
                Star it on GitHub
              </a>
            </div>
            <p className="install-note">
              The hosted instance is invite-only while we run the pilot — memory is scoped to a
              repo's organisation, so we set yours up by hand. Self-hosting is open to everyone,
              today.
            </p>
          </div>

          {/* The stream, drifting. Hidden on narrow screens and under reduced motion. */}
          <div className="drift" aria-hidden="true">
            <div className="drift-track">
              {drift.map(([type, title], i) => (
                <p className="drift-item" key={i}>
                  <span>{type}</span>
                  {title}
                </p>
              ))}
            </div>
          </div>
        </section>

        {/* Signature: the write path, animated. Raw tool calls stay local (mute),
            one structured memory crosses the wire (ochre). */}
        <section className="section tape-wrap" aria-labelledby="tape-h">
          <h2 className="eyebrow" id="tape-h">
            What happens while you work
          </h2>

          <div className="tape" data-animate="">
            <div className="tape-col tape-raw">
              <p className="tape-label">your session, on your machine</p>
              <ul className="raw-list">
                {(
                  [
                    ["Read", "src/auth/authorize.ts"],
                    ["Bash", "bun test packages/service"],
                    ["Edit", "src/routes/ingest.ts"],
                    ["Read", "docs/data-lifecycle.md"],
                  ] as const
                ).map(([tool, arg], i) => (
                  <li className="raw" style={{ "--i": i } as CSSProperties} key={i}>
                    <span className="raw-tool">{tool}</span>({arg})
                  </li>
                ))}
              </ul>
            </div>

            <div className="wire wire-1" aria-hidden="true"></div>

            <div className="tape-col tape-node">
              <div className="node">
                <span className="node-title">extract</span>
                <span className="node-sub">your Claude&nbsp;Code CLI</span>
              </div>
              <p className="node-foot">raw output stops here</p>
            </div>

            <div className="wire wire-2" aria-hidden="true"></div>

            <div className="tape-col tape-out">
              <article className="memcard">
                <p className="memcard-type">extracted_learning</p>
                <h3 className="memcard-title">
                  Collaborator check must not gate on permission level
                </h3>
                <p className="memcard-body">
                  GitHub reports <code>read</code> for every login on a public repo, so authorize on
                  204 from the collaborators endpoint instead.
                </p>
                <p className="memcard-anchor">src/auth/authorize.ts</p>
              </article>
              <p className="tape-label tape-label-end">shared with the team</p>
            </div>
          </div>
        </section>

        {/* The tape shows one session. This shows why it is worth sharing: the same
            store, written by everyone, read by everyone. */}
        <section className="section" aria-labelledby="team-h">
          <h2 className="eyebrow" id="team-h">
            This week, on three machines
          </h2>

          <div className="team">
            <div className="team-in">
              <ul className="who-list">
                <li className="who">
                  <span className="who-name">maya</span> traced the ingest 413s to a hook payload cap
                </li>
                <li className="who">
                  <span className="who-name">sam</span> found the migration the backfill depends on
                </li>
                <li className="who">
                  <span className="who-name">you</span> gave up on the pgvector spike, twice
                </li>
              </ul>
            </div>

            <div className="wire wire-team" aria-hidden="true"></div>

            <div className="team-store">
              <p className="store-title">this repo's context</p>
              <p className="store-sub">one store, org-gated, no promotion step</p>
            </div>

            <div className="wire wire-team" aria-hidden="true"></div>

            <div className="team-out">
              <p className="out-line">
                Whoever opens an agent next
                <br />
                starts from all three.
              </p>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="privacy-h">
          <div className="claim">
            <h2 className="claim-title" id="privacy-h">
              Extraction runs on your machine.
              <br />
              <span className="claim-title-em">On the subscription you already pay for.</span>
            </h2>
            <p className="claim-body">
              The background worker spawns the coding-agent CLI you are already signed in to — Claude
              Code or Codex — to turn a session into structured memory. There is no separate API key
              and no per-seat LLM bill. File contents, command output and diffs never leave the
              machine; only the finished memory is transmitted.
            </p>
          </div>

          <div className="grid">
            <div className="cell">
              <h3 className="cell-title">Capture is automatic</h3>
              <p className="cell-body">
                Agent hooks fire, return immediately, and enqueue. The session you are in does
                nothing else and never stalls.
              </p>
            </div>
            <div className="cell">
              <h3 className="cell-title">Secrets scrubbed twice</h3>
              <p className="cell-body">
                Once in the worker before transmission, again in the service at ingestion. Both
                passes are mandatory.
              </p>
            </div>
            <div className="cell">
              <h3 className="cell-title">Any agent can read</h3>
              <p className="cell-body">
                One MCP endpoint. Capture needs a thin per-agent hook; reads need nothing but an
                MCP-capable client.
              </p>
            </div>
            <div className="cell">
              <h3 className="cell-title">Access follows the git host</h3>
              <p className="cell-body">
                Membership in the repo's org <em>and</em> a live collaborator check, on every
                request. Remove someone and their access is gone.
              </p>
            </div>
          </div>
        </section>

        {/* The read side, as it actually looks: an MCP tool call and what comes back. */}
        <section className="section" aria-labelledby="recall-h">
          <h2 className="eyebrow" id="recall-h">
            When an agent asks
          </h2>

          <div className="recall">
            <p className="recall-call">
              <span className="recall-arrow">→</span> aznex.get_memories_by_path(
              <span className="recall-arg">"src/auth/authorize.ts"</span>)
            </p>
            <ul className="recall-list">
              {(
                [
                  ["decision", "Authorize on collaborator membership, never permission level"],
                  ["negative_result", "Org membership alone let a removed collaborator keep reading"],
                  ["extracted_learning", "The 204 from the collaborators endpoint is the whole check"],
                ] as const
              ).map(([type, title]) => (
                <li className="recall-row" key={title}>
                  <span className="recall-type">{type}</span>
                  <span>{title}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="prose recall-note">
            No prompt to write, no file to paste. The agent asks about the file it is already editing
            and gets what the team knows about it.
          </p>

          <p className="chips-label">
            Capture needs a hook, so it is Claude Code and Codex today. Reading needs only MCP:
          </p>
          <ul className="chips">
            {(
              [
                ["Claude Code", "capture + read", "chip chip-both"],
                ["Codex", "capture + read", "chip chip-both"],
                ["Cursor", "read", "chip"],
                ["Windsurf", "read", "chip"],
                ["VS Code", "read", "chip"],
                ["Zed", "read", "chip"],
                ["any MCP client", "read", "chip chip-any"],
              ] as const
            ).map(([name, what, cls]) => (
              <li className={cls} key={name}>
                {name}
                <span>{what}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Getting started: a real sequence, so the numbers are earned. */}
        <section className="section" aria-labelledby="start-h">
          <h2 className="eyebrow" id="start-h">
            Getting started
          </h2>
          <div className="start">
            <div className="start-copy">
              <p className="start-title">
                One command.
                <br />
                <span className="start-title-em">Then nothing.</span>
              </p>
              <ol className="steps">
                <li className="step" data-step="1">
                  <span className="step-n">01</span>
                  <div>
                    <h3 className="step-h">Get a service URL</h3>
                    <p className="step-b">
                      <a href="mailto:shashank@aznex.ai?subject=Aznex%20pilot%20access">
                        Ask for pilot access
                      </a>{" "}
                      to the hosted instance, or{" "}
                      <a href={`${REPO}/blob/main/docs/setup.md`}>stand up your own</a>. Either way
                      you end up with a URL and an organisation your repo belongs to.
                    </p>
                  </div>
                </li>
                <li className="step" data-step="2">
                  <span className="step-n">02</span>
                  <div>
                    <h3 className="step-h">Run the installer</h3>
                    <p className="step-b">
                      One command against that URL. It installs the worker, signs you in through
                      GitHub in a browser tab, and starts the daemon. No key to copy anywhere.
                    </p>
                    <div className="cta-row cta-row-tight">
                      <pre className="install-cmd">
                        <code id="cmd">{INSTALL_CMD}</code>
                      </pre>
                      <CopyButton text={INSTALL_CMD} />
                    </div>
                  </div>
                </li>
                <li className="step" data-step="3">
                  <span className="step-n">03</span>
                  <div>
                    <h3 className="step-h">Work as usual</h3>
                    <p className="step-b">
                      Hooks fire on every session, extraction runs on your machine, and your agent
                      queries the team's context over MCP. You are not asked to do anything again.
                    </p>
                  </div>
                </li>
              </ol>
            </div>

            <div className="term" data-term="">
              <div className="term-bar">
                <span className="term-path">~/dev/aznex</span>
              </div>
              {/* These spans are display:block inside a <pre>. JSX drops whitespace
                  that spans a newline, so the line breaks below print nothing. */}
              <pre className="term-body">
                <code>
                  <span className="term-cmd">
                    <span className="term-prompt">$</span>{" "}
                    <span data-type="">{INSTALL_CMD}</span>
                    <span className="caret"></span>
                  </span>
                  <span className="term-out" data-out="2">
                    installing @aznex/worker
                  </span>
                  <span className="term-out" data-out="2">
                    signed in as <b>you</b> — no api key stored
                  </span>
                  <span className="term-out" data-out="2">
                    hooks wired: claude code, codex
                  </span>
                  <span className="term-out" data-out="2">
                    mcp server registered: <b>aznex</b>
                  </span>
                  <span className="term-out term-ok" data-out="3">
                    daemon running — capture on
                  </span>
                </code>
              </pre>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="self-h">
          <h2 className="eyebrow" id="self-h">
            Self-host
          </h2>
          <p className="prose">
            Run the whole thing yourself and the context never touches us. Aznex is one deployable —
            ingestion API, MCP endpoint and viewer in a single container.
          </p>
          <p className="prose">
            <a href={`${REPO}/blob/main/docs/setup.md`}>Setup guide →</a>
          </p>
        </section>

        <section className="section" aria-labelledby="faq-h">
          <h2 className="eyebrow" id="faq-h">
            Questions
          </h2>
          <div className="faq">
            <details>
              <summary>Can I just install it right now?</summary>
              <p>
                Self-hosted, yes — clone it, run the container, and the installer points at your own
                URL. On the hosted instance, not yet: memory is scoped to a repository's
                organisation, and an organisation is created deliberately rather than on signup.
                Signing in with GitHub will work and then every call will be refused until your login
                is in an org, which is why the pilot is a conversation rather than a button.{" "}
                <a href="mailto:shashank@aznex.ai?subject=Aznex%20pilot%20access">Ask for access</a>{" "}
                and it is usually the same day.
              </p>
            </details>
            <details>
              <summary>Does my code leave my machine?</summary>
              <p>
                No. Hooks and extraction run locally. What is transmitted is the extracted memory — a
                title, a narrative, facts, concepts and the paths of the files involved. File
                contents, command output and diffs stay on the machine.
              </p>
            </details>
            <details>
              <summary>Do I need an API key for the LLM?</summary>
              <p>
                No. Extraction spawns whichever coding-agent CLI you already have installed and
                logged in — Claude Code or Codex — so it runs on your own subscription.
              </p>
            </details>
            <details>
              <summary>Which agents does it work with?</summary>
              <p>
                Capture works with Claude Code and Codex today, through thin hook adapters. Reads
                work with any MCP-compatible agent, because the read side is a standard MCP server.
              </p>
            </details>
            <details>
              <summary>Who can see my team's memory?</summary>
              <p>
                Anyone who is a member of the repository's organization in Aznex <em>and</em> whom
                the git host still lists as a collaborator on that repository. Both gates are checked
                on every request; either one failing denies access.
              </p>
            </details>
            <details>
              <summary>How do I remove a memory that is wrong?</summary>
              <p>
                Delete it. The author, an org admin or a super admin can remove any memory from the
                viewer. Deletion is the only withdrawal — there is no archived or deprecated state to
                reason about.
              </p>
            </details>
            <details>
              <summary>Is it open source?</summary>
              <p>
                Yes. The service, worker, viewer and shared types are all in{" "}
                <a href={REPO}>one repository</a>.
              </p>
            </details>
          </div>
        </section>

        <section className="section closer">
          <p className="closer-line">Start with one repo.</p>
          <p className="closer-sub">
            Tell us the repo and who is on it. Pilot teams get set up the same day.
          </p>
          <div className="cta-row">
            <a className="btn btn-solid" href={PILOT_MAILTO}>
              Request pilot access
            </a>
            <a className="btn btn-ghost" href={REPO}>
              Star it on GitHub
            </a>
          </div>
        </section>
      </main>

      <footer className="foot">
        <span className="foot-mark">
          <Mark />
          aznex
        </span>
        <nav className="foot-links">
          <a href={REPO}>GitHub</a>
          <a href={`${REPO}/tree/main/docs`}>Docs</a>
          <a href={`${REPO}/blob/main/SECURITY.md`}>Security</a>
          <a href={`${REPO}/blob/main/LICENSE`}>License</a>
          <a href="/dashboard">Sign in</a>
        </nav>
      </footer>
    </div>
  );
}
