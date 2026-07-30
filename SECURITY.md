# Security policy

## Reporting a vulnerability

**Please do not open a public issue.**

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. That creates a private advisory only
maintainers can see.

Include what you need to make the problem reproducible — affected component,
version or commit, and the steps. If you have a proof of concept, attach it to
the advisory rather than posting it anywhere public.

Aznex is early-stage and maintained by a very small team. Expect a first
response within a few days. We'll confirm the report, agree on a fix and a
disclosure timeline with you, and credit you in the advisory and changelog
unless you'd rather stay anonymous.

## Supported versions

Only the latest release of `@aznex/shared` and `@aznex/worker` gets fixes, and
the service and frontend are deployed from `main`. There are no long-term
support branches.

## What we consider highest severity

Aznex stores private repository knowledge and moves it between developer
machines and a shared server, so the sensitive classes are:

- **Repo authorization bypass** — reading or writing memory for a repository you
  should not have access to. Access is gated twice on every request (`auth/authorize.ts`):
  membership in the repo's organization, *and* GitHub still listing you as a
  collaborator on that repo. Anything that defeats either gate, makes a failed
  check fall open, or reintroduces gating on GitHub *permission level* rather
  than collaborator membership is critical.
- **Cross-tenant leakage** — one organization observing another's existence,
  repos, members, or memory. Cross-tenant requests are meant to return 404, never
  403, precisely so the deployment's customer list can't be enumerated.
- **Secret scrubbing bypass** — getting a credential past both scanning passes
  (worker, pre-transmission; service, at ingestion) and into stored memory.
- **API key handling** — key leakage, forgeable keys, or a revoked or
  unauthorized key still being accepted. Keys are stored as SHA-256 hashes and
  returned exactly once at mint time.
- **Privilege escalation** — an org admin reaching another tenant, or reaching
  super admin. Super admin is granted only through the
  `AZNEX_ADMIN_GITHUB_LOGINS` environment variable, specifically so a compromised
  org admin cannot escalate into it, and super admins have no memory-read bypass.

## Out of scope

- Anything requiring the attacker to already control the developer's machine.
  The worker holds an API key and spawns the local coding-agent CLI by design.
- Missing hardening in a self-hosted deployment the operator controls — an
  unauthenticated database volume, a public service with no GitHub App
  configured, secrets committed to your own fork.
- Findings against `.idea/` or `docs/superpowers/`, which are local artifacts,
  not shipped code.
