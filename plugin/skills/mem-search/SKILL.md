---
name: mem-search
description: Search the team's shared aznex memory for this repo. Use when the user asks "did we already solve this?", "why is X built this way?", "what does the team know about this file?", or before re-deriving a decision, workaround, or dead end that a teammate's session may have already captured.
---

# mem-search — query team memory (aznex)

Aznex stores memories your teammates' coding sessions produced for this repo:
decisions, extracted learnings, negative results (dead ends), and summaries.
Query them through the `aznex` MCP tools before re-investigating anything a
teammate may have already figured out.

## Repo fingerprint

Every tool takes `repo_fingerprint`: the canonical git identity
`<host>/<owner>/<name>` (e.g. `github.com/acme/widget`). Derive it from the
repo you're working in:

```sh
git remote get-url origin
```

Strip protocol/`git@`/`.git` and normalize to `host/owner/name`.

## Tools and when to use each

| Tool | Use for |
|---|---|
| `search_memory` | Keyword/full-text search — "did we deal with <topic> before?" Start here. |
| `get_recent_context` | The latest team memories — orientation when starting broad work. |
| `get_memories_by_path` | Everything the team knows about one file (repo-relative path). Use before making significant changes to an unfamiliar file. |
| `get_memory` | Full record by id (narrative, facts, anchors) — after a search hit needs detail. |
| `list_sessions` | Capture timeline — who worked when; useful to scope "recent" questions. |

## Workflow

1. `search_memory` with 2–3 focused keyword variants (it's FTS — try the noun,
   not the sentence). If a result looks relevant, `get_memory` its id for the
   full narrative and anchors.
2. For file-scoped questions, `get_memories_by_path` with the repo-relative
   path.
3. Results are team-shared and freshness-filtered by default; pass
   `include_stale: true` when investigating history (stale = the anchored code
   changed since capture, so verify against current code before relying on it).
4. Cite what you use: mention the memory's type and content when it shapes
   your answer, so the user knows it came from team memory rather than the
   current code.

No results is a real answer — say the team memory has nothing on the topic and
proceed normally. Never invent memories.
