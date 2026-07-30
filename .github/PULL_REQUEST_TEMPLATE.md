<!-- Thanks for contributing. See CONTRIBUTING.md if you haven't already. -->

## What and why

<!-- What changes, and what problem it solves. The "why" is the useful part. -->

Closes #

## Checklist

- [ ] `bun run typecheck` passes
- [ ] `bun test` passes
- [ ] New logic has a unit test alongside the source it covers
- [ ] Touches auth, repo access, or secret scrubbing? Called out below.
- [ ] User-visible change? `CHANGELOG.md` updated under Unreleased.

## Security-relevant?

<!--
Delete this section if not applicable. Otherwise say what changed and why it is
still safe. Note in particular:
  - Repo access still goes through auth/authorize.ts, both gates intact
  - Authorization failures still deny rather than fall open
  - Both secret-scanning passes still run
  - Cross-tenant responses are still 404, not 403
-->
