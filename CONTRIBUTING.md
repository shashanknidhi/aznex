# Contributing to Aznex

Thanks for looking. Aznex is early — issues, bug reports, and PRs are all
welcome.

## Getting set up

See [docs/development.md](docs/development.md). Short version: Bun 1.1+, then

```sh
bun install
bun run typecheck
bun test
```

No database server, no credentials needed to run the tests.

## Before you open a PR

CI runs typecheck and tests **per package** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
Reproduce it locally:

```sh
bun run typecheck                                   # all four packages
bun test                                            # all tests
bunx tsc --noEmit -p packages/service/tsconfig.json # or just one package
bun test packages/service
```

## Tests

**New logic needs a unit test.** Tests live alongside the source they cover, in
the same package — `packages/shared/src/foo.ts` → `packages/shared/src/foo.test.ts`.
Bun's built-in runner, no framework:

```ts
import { test, expect } from "bun:test";
```

Every non-trivial function — a branch, a parser, a data transformation, anything
on a security path — needs at least one test that fails if the logic breaks.
Trivial one-liners don't.

## Things worth knowing before you change them

A few decisions in this codebase are deliberate and load-bearing. Changing them
without knowing why they're there will get a PR sent back. The full list is in
[CLAUDE.md](CLAUDE.md); the ones that bite most often:

- **The data access layer stays engine-agnostic.** SQLite today, Postgres +
  pgvector later. Don't let SQLite-specific SQL leak out of `repositories/`.
- **Repo authorization goes through one function**, `auth/authorize.ts` — never
  an inline check. It applies two independent gates, and both must pass: org
  membership, and GitHub collaborator status. Access means *collaborator
  membership*, never a permission level — GitHub reports `read` for every login
  on a public repo, so gating on permission level leaks a public repo's memory
  to anyone with an account.
- **Authorization failures deny.** A misconfigured or unreachable GitHub App
  must never fall open.
- **Secret scanning is two-pass and mandatory** — worker before transmission,
  service at ingestion. Don't remove either pass.
- **Cross-tenant requests return 404, not 403.** A 403 confirms the tenant
  exists and lets anyone enumerate the deployment's customers.
- **The service is a dumb store on the write path.** No LLM calls server-side;
  extraction intelligence belongs in the worker.
- **Hooks return immediately.** Anything slow happens async in the worker, or
  the developer's IDE stalls.

## Commits and PRs

Conventional commit prefixes, matching the existing history:

```
feat: multi-tenant orgs with per-org RBAC
fix(service): gate repo access on collaborator membership, not permission level
chore: release v0.1.12
docs: ...
```

Keep PRs focused. Explain *why* in the description, not just what.

## Releases

`@aznex/shared` and `@aznex/worker` share one version and publish to npm on a
`v*` tag. Every release needs a `CHANGELOG.md` section or the workflow fails.
Full steps are in [CLAUDE.md](CLAUDE.md#releasing) — maintainers only.

## Security

Please don't open a public issue for a vulnerability. See
[SECURITY.md](SECURITY.md).
