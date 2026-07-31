# @aznex/frontend

React + Vite SPA for browsing team memory. **Read-only** — capture happens in
`@aznex/worker` on each developer's machine. Served in production by
`@aznex/service` from `dist/`; in dev, Vite proxies `/api` to `localhost:3000`.

```sh
bun run --cwd packages/frontend dev        # vite dev server on :5173
bun run --cwd packages/frontend build      # production bundle into dist/
bun test packages/frontend                 # pure-function tests
```

## Layout

```
src/
  App.tsx            routes only
  api.ts             fetch client; ApiError carries the server's error code
  errors.ts          error code → human sentence (the one place that mapping lives)
  format.ts          dates, labels, pluralisation, GitHub file links
  hooks.ts           useAsync, URL list-params, debounce, flash, document title
  auth.tsx           session context, sign-out, 401 handling, RequireAuth
  components/        Shell (header/nav/breadcrumbs), ui (primitives), ErrorBoundary
  pages/             one file per route
  styles.css         design tokens + all styling
```

Conventions worth keeping:

- **No new runtime dependencies.** Native `<dialog>` over a modal library, CSS
  custom properties over a framework, `useSearchParams` over a state library,
  `useAsync` over react-query.
- **Never render a raw error.** Everything user-facing goes through
  `errorMessage()`; a code the map doesn't know falls back to a generic and logs
  a warning. `errors.test.ts` asserts no code leaks verbatim.
- **Never render a raw enum.** `typeLabel()` for memory types, derived from the
  shared Zod enum so a new type can't be silently missed.
- **A failed request is not an empty list.** `useAsync` distinguishes loading,
  error and empty; each gets its own UI.
- **Confirm before anything destructive**, and say what the consequence is.

## Manual smoke checklist

The pure logic is unit-tested; these are the states that regress precisely
because nobody enumerates them. There is deliberately no DOM test stack, so this
list is the safety net. Walk it before a release that touches the frontend.

Set up: `bun run --cwd packages/service seed` for a repo with memories, then run
the service and the Vite dev server.

**Roles** — for each, check the header shows the right identity and nav:

| Role | Expect |
|---|---|
| Unauthenticated | Any route bounces to `/login` with a working `?next` |
| Signed in, no org | A plain explanation that no org has them, not a raw 403 |
| Org member | Repo list; no Remove, no onboard form, no install link |
| Org member on `/org/:id` | Member list renders; keys section says admins only |
| Org admin | Remove, onboard form, install link, members and keys |
| Super admin | "Organizations" in the nav; suspend/resume; create org |

**Failure modes** — each must say something true and actionable:

- **OAuth unset** (`GITHUB_OAUTH_CLIENT_ID` absent): `/login` explains it and
  disables the button. It must not offer a button that silently does nothing.
- **GitHub App unset**: the repo list says so rather than showing an empty list.
- **Service stopped**: "Couldn't reach the Aznex server" plus a Retry — never
  "0 memories".
- **Session expired** (delete the cookie mid-session, then act): redirect to
  `/login?reason=expired`, not a stranded page.
- **Repo with no memories**: an empty state pointing at Get started.
- **Search with no hits**: "0 matches" and a Clear filters action, visibly
  different from an empty repo.

**Interaction**

- Open a memory, press Back: the search text, type filter and page all return.
- Tab to a memory card and press Enter; cmd-click opens a new tab.
- Every destructive button confirms first, and the confirmation names the
  consequence.
- A rejected form submission keeps what you typed.

**Presentation**

- Toggle OS dark mode: native inputs match the page.
- At ~375px wide nothing scrolls horizontally and the create-org form is usable.
