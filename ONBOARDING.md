# Aznex pilot — setup guide

Aznex is team-shared institutional memory for coding agents. Your Claude Code
sessions automatically produce durable memories (decisions, learnings, failed
approaches); teammates' agents pull them back in via MCP, and everyone can
browse them in a web viewer.

Two roles below. Devs: you only need the **Developer setup** section (5 minutes).

---

## Developer setup (each team member)

**Prereqs:** [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`) and Claude Code installed. You'll get an **API key** (`axk_…`) and the **service URL** from your admin.

```sh
git clone https://github.com/shashanknidhi/aznex && cd aznex
bun install
bun packages/worker/setup.ts --service-url <SERVICE_URL> --api-key <YOUR_KEY>
```

That one command validates your key against the live service, then installs
everything: a background worker (starts at login, restarts on crash), the
Claude Code capture hooks (global — works in every repo), and your config at
`~/.aznex/config.json`.

Last step — wire **reads** into Claude Code (paste your full key):

```sh
claude mcp add aznex --transport http <SERVICE_URL>/mcp --header "Authorization: Bearer <YOUR_KEY>"
```

### Verify it works

```sh
curl -s localhost:3001/health          # → {"ok":true,"queued":0}
```

Then use Claude Code normally in an onboarded repo and end the session. Your
extracted memories appear in the web viewer (`<SERVICE_URL>`, sign in with
GitHub) within a minute of session end. In an agent, try the `search_memory`
MCP tool.

Note: captured memories start **private** to you; only ones promoted to
`team_shared` are visible to teammates.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `✗ service unreachable` during setup | Check the URL (https, no trailing path); ask your admin if the service is up |
| `✗ API key rejected (401)` | Ask your admin to mint a fresh key |
| `✗ claude executable not found` | Install Claude Code, or `export CLAUDE_CODE_PATH=/path/to/claude` |
| Sessions produce no memories | `tail -50 ~/.aznex/logs/worker.log` — the worker logs every drop reason. Common: repo not onboarded by admin ("no resolvable git remote" / rejected ingest) |
| Worker not running | `launchctl load ~/Library/LaunchAgents/ai.aznex.worker.plist` (macOS) / `systemctl --user restart aznex-worker` (Linux) |

### Uninstall

```sh
bun packages/worker/setup.ts --uninstall
```

---

## Admin setup (once)

### 1. Deploy the service on Railway

- Railway → New Project → Deploy from GitHub → this repo (`railway.json` configures the build)
- Attach a **volume** mounted at `/app/data`
- Settings → Networking → **Generate Domain** — this is your `<SERVICE_URL>`

### 2. GitHub credentials

- **GitHub App** (powers repo-access checks — required): create one with
  repository *Metadata: read* permission, install it on your org/repos.
  Note the **App ID**, generate a **private key**, and note the
  **installation id** (from the installation page URL).
- **GitHub OAuth app** (powers browser login): callback URL
  `<SERVICE_URL>/api/auth/callback/github`.

### 3. Environment variables on the Railway service

```
DATABASE_PATH=/app/data/aznex.db
GITHUB_APP_ID=…
GITHUB_APP_PRIVATE_KEY=…          # PEM; newlines may be \n-escaped
GITHUB_OAUTH_CLIENT_ID=…
GITHUB_OAUTH_CLIENT_SECRET=…
BETTER_AUTH_SECRET=…              # openssl rand -hex 32
AZNEX_BASE_URL=<SERVICE_URL>
AZNEX_FRONTEND_ORIGIN=<SERVICE_URL>
```

Redeploy, then `curl <SERVICE_URL>/health` → `{"ok":true,…}`.

### 4. Onboard repos and mint keys

```sh
railway ssh
bun packages/service/src/admin-cli.ts add-repo github.com/<org>/<repo> \
  --github-repo-id <numeric repo id> --installation-id <installation id>
bun packages/service/src/admin-cli.ts add-key --github-login <dev> --github-id <dev's numeric id>
```

(Repo id: `gh api repos/<org>/<repo> --jq .id`. User id: `gh api users/<login> --jq .id`.)

Each `add-key` prints the token **once** — send it to that developer along
with `<SERVICE_URL>`, and point them at the Developer setup above.

---

## What's running where

- **Dev machine:** background worker + hook script. Raw tool output never
  leaves the machine — extraction (using each dev's own Claude subscription)
  and secret-scrubbing happen locally; only clean structured memories are sent.
- **Railway:** the service (ingest API + MCP + web viewer + SQLite on the
  volume). Every request re-verifies the caller's GitHub access to the repo.

Known pilot limits: capture is Claude Code-only (Codex adapter is
[#45](https://github.com/shashanknidhi/aznex/issues/45)); single service
instance (SQLite); memories need manual promotion to `team_shared` before
teammates see them.
