# Aznex setup guide

Aznex is team-shared institutional memory for coding agents. Your Claude Code
and Codex sessions automatically produce durable memories (decisions, learnings, failed
approaches); teammates' agents pull them back in via MCP, and everyone can
browse them in a web viewer.

Two roles below. Devs: you only need the **Developer setup** section (5 minutes).
Admins deploying Aznex for the first time want **Admin setup**. Want to run the
stack locally from a clone instead — to hack on it or just look around? See
[development.md](development.md).

---

## Developer setup (each team member)

**Prereqs:** Claude Code or Codex installed — extraction runs on your own subscription through whichever CLI you have (Claude Code is used when both are present). Bun is installed automatically if missing. You'll get the **service URL** from your admin — that's all; auth happens in your browser.

```sh
curl -fsSL <SERVICE_URL>/install.sh | bash
```

(Installs Bun if you don't have it, installs `@aznex/worker`, and runs setup.
Your browser opens to the Aznex site — sign in with GitHub and click Approve.
No API key to copy; headless machines can pass `--api-key` instead.)

That one command installs **everything**: a background worker (starts at
login, restarts on crash), the capture hooks for each supported agent it finds
on your PATH — Claude Code (`~/.claude/settings.json`) and Codex
(`~/.codex/hooks.json`) — including team-memory injection at session start /
on file reads (global, works in every repo), the `aznex` MCP server for reads
(5 tools) registered with both agents, and your config at
`~/.aznex/config.json`. Nothing to paste afterwards.

**Codex needs one manual step:** Codex only runs hooks you have approved, so
start `codex` once and accept the hook review prompt. Until you do, Codex
sessions capture nothing.

Re-running setup later is safe: it reuses the API key already in
`~/.aznex/config.json` if that key still works (no new key, no browser), and
keeps your tuning settings. Pass `--new-key` to force a fresh key.

**Alternative: plugin channel.** Prefer the pieces visible and toggleable in
Claude Code's `/plugin` UI? Install the plugin **first**, then run setup —
setup detects it and skips its own hook/MCP wiring (the plugin bundles hooks,
the MCP server, and a `mem-search` skill):

```
/plugin marketplace add shashanknidhi/aznex
/plugin install aznex@aznex
```
```sh
curl -fsSL <SERVICE_URL>/install.sh | bash
```

Either channel, not both — same features, different packaging.

### Verify it works

```sh
aznex-worker doctor     # ✓/✗ per component, with a fix per finding
```

All green means capture, context injection, and MCP reads are live. `doctor`
reports the Claude Code and Codex channels separately, and warns per agent, so
a missing Codex wiring is visible without guessing. Then open
a new Claude Code or Codex session in an onboarded repo — a
`SessionStart says: aznex: N team memories injected` banner appears, and the
memories are in your agent's context. Work normally and end the session: your
extracted memories appear in the web viewer (`<SERVICE_URL>`, sign in with
GitHub) within a minute. In an agent, try the `search_memory` MCP tool — or,
on the plugin channel, just ask "did we already solve this?" (the `mem-search`
skill).

### Tune it

The worker serves a local settings page at http://localhost:29639 — coding
agent (Claude Code, Codex, or auto-detect), extraction model (passed as
`--model` to that CLI), context-injection on/off and memory count, file-context
on/off. Both agent and model are dropdowns; the model defaults to the cheapest
tier the chosen agent offers, since extraction is a bulk summarise job.

Note: every captured memory is **visible to everyone with access to the repo** —
that is the point. If one is wrong or leaked something, delete it in the viewer;
deletion is the only way to withdraw a memory.

### Troubleshooting

Run `aznex-worker doctor` first — it diagnoses config, daemon, worker, service,
API key, hooks, and MCP, each with a fix. Beyond that:

| Symptom | Fix |
|---|---|
| `✗ service unreachable` during setup | Check the URL (https, no trailing path); ask your admin if the service is up |
| Sessions produce no memories | `tail -50 ~/.aznex/logs/worker.log` — the worker logs every drop reason. Common: repo not onboarded by admin ("no resolvable git remote" / rejected ingest) |
| No memory banner at session start | Normal for repos with no team memories yet, or repos your admin hasn't onboarded |

### Uninstall

```sh
aznex-worker uninstall
```

---

## Admin setup (once)

### 1. Deploy the service

**Railway:**

- Railway → New Project → Deploy from GitHub → this repo (`railway.json` configures the build)
- Attach a **volume** mounted at `/app/data`
- Settings → Networking → **Generate Domain** — this is your `<SERVICE_URL>`

**Or self-host with Docker**, from the repo root:

```sh
cp .env.example .env         # fill it in using step 3 below
docker compose -f docker/docker-compose.yml up -d
```

The compose file builds from the repo (context `..`), reads `../.env`, publishes
`3000:3000`, and keeps the database on the `aznex-data` volume — it forces
`DATABASE_PATH=/app/data/aznex.db` regardless of what your `.env` says. Put it
behind TLS and set `<SERVICE_URL>` to that public URL. Either way, one service
instance: SQLite means you can't scale this horizontally.

### 2. GitHub credentials

- **GitHub App** (powers repo-access checks — required): create one with
  repository *Metadata: read* **and** organization *Members: read*, install it
  on your org/repos. Note the **App ID**, generate a **private key**, and note
  the **installation id** (from the installation page URL).

  *Members: read* is not optional for organization repositories. Access checks
  ask GitHub whether a user is a collaborator on the repo, and on an org repo
  most people are collaborators through the organization — a team, the default
  member permission, or organization ownership — rather than through a direct
  invite. An installation holding only *Metadata: read* cannot see any of those,
  so every one of those users is reported as having no access. Personal-account
  repositories are unaffected: they have no organization permissions, and every
  collaborator there is a direct one.

  Adding the permission to an App that is already installed raises a request
  each organization owner must approve; until they do, that installation keeps
  its old permissions. Aznex names this case explicitly instead of blaming the
  user's GitHub access.
- **GitHub OAuth app** (powers browser login): callback URL
  `<SERVICE_URL>/api/auth/callback/github`.

### 3. Environment variables on the service

```
DATABASE_PATH=/app/data/aznex.db
GITHUB_APP_ID=…
GITHUB_APP_PRIVATE_KEY=…          # PEM; newlines may be \n-escaped
GITHUB_OAUTH_CLIENT_ID=…
GITHUB_OAUTH_CLIENT_SECRET=…
BETTER_AUTH_SECRET=…              # openssl rand -hex 32
AZNEX_BASE_URL=<SERVICE_URL>
AZNEX_FRONTEND_ORIGIN=<SERVICE_URL>
AZNEX_ADMIN_GITHUB_LOGINS=alice         # super admins: create orgs, appoint org admins
AZNEX_GITHUB_APP_SLUG=<app-slug>        # powers the "Install / pick repos on GitHub" button
```

See [`.env.example`](../.env.example) at the repo root for the full annotated
list, including the optional knobs omitted here.

Redeploy, then `curl <SERVICE_URL>/health` → `{"ok":true,…}`.

**Set `AZNEX_ADMIN_GITHUB_LOGINS` before your first sign-in.** A fresh database
deliberately starts with no organizations, and signing in requires either super
admin or membership in an active org — so with that variable unset there is no
admin surface and nobody can get in. Listing your GitHub username there is the
bootstrap. (`admin-cli.ts add-org` over `railway ssh` is the alternative; see
step 4.)

`/health` stays `ok: true` but adds `"degraded":"repos_without_org"` if any
active repo has no owning organization — those repos deny every request until
one is assigned. (It does not fail the health check: Railway would roll the
deploy back over a handful of repos.)

### 4. Create an organization

One deployment hosts several companies. Sign in as a super admin and open
**Manage organizations**: give the org a slug, a display name, and the GitHub
usernames of its admins. Those admins then run their own tenant — repos,
members, and their members' API keys — with no further server configuration.

Sign-in itself requires an org membership, which is what replaced the old
`AZNEX_ALLOWED_GITHUB_LOGINS` allowlist: adding a teammate is now an org-admin
action in the UI, not a redeploy.

Suspending an org (same screen) stops all of its ingest, MCP and reads
immediately while leaving its data in place. Resuming restores access.

### 5. Onboard repos

Sign in as an **org admin** — the repo selector shows admin controls for each
org you administer:

- **"Install / pick repos on GitHub"** opens GitHub's own install page for
  your App; select repositories there and you're redirected back — everything
  you selected (and can access) onboards automatically. Requires
  `AZNEX_GITHUB_APP_SLUG` set and the App's **Setup URL** pointed at
  `<SERVICE_URL>/github/setup` with "Redirect on update" enabled.
- Or onboard one repo by name (`github.com/<org>/<repo>`); ids resolve
  automatically.
- Each listed repo has a **de-board** button: it deactivates the repo
  (memories preserved, reads/writes rejected); onboarding it again reactivates.

Onboarding always verifies *you* have GitHub access to the repo — no admin
role of any kind reaches repos GitHub says you can't see. (`railway ssh` +
`admin-cli.ts add-org` / `add-repo --org <slug>` remains as a break-glass
fallback, and is how you bootstrap the first org on an empty database.)

### 6. Add members

On **Members & keys** for your org, add teammates by GitHub username — an
invite may precede their first sign-in. You can promote them to admin, remove
them (which cuts access on the next request but leaves the memories they
captured with the team), and revoke their API keys.

**Removing a member does not revoke their API keys.** Membership removal denies
their next request, so a key alone grants nothing — but the key rows stay valid.
When someone leaves for good, revoke their keys explicitly on the same screen.

Then just send developers `<SERVICE_URL>` and point them at the Developer
setup above — they authorize themselves in the browser. (For headless/CI
machines only, `admin-cli.ts add-key --github-login <dev> --github-id <id>`
still mints a key manually.)

---

## What's running where

- **Dev machine:** background worker + the per-agent hooks (Claude Code and/or
  Codex; optionally the Claude Code plugin packaging the same pieces). Raw tool
  output never leaves the machine — extraction (spawning the dev's own `claude`
  or `codex` CLI, on their own subscription) and
  secret-scrubbing happen locally; only clean structured memories are sent.
  Reads flow back in three ways: automatic session-start injection,
  file-anchored injection on Read, and the 5 MCP tools on demand.
- **Railway:** the service (ingest API + MCP + web viewer + SQLite on the
  volume). Every request re-verifies two things: that the caller is a member of
  the repo's organization, and that GitHub still lists them as a collaborator
  on that repo. Either one failing denies the request.

Known limits: file-anchored injection on read is Claude Code-only; a single
service instance (SQLite).
