import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { MemoryType } from "@aznex/shared";
import { api, MEMORIES_PAGE_SIZE } from "../api.js";
import { countLabel, formatRelative, isoDate, MEMORY_TYPES, preview, typeLabel } from "../format.js";
import { buildListParams, pageCount, parseListParams, useAsync, useDebounced } from "../hooks.js";
import { Shell } from "../components/Shell.js";
import { AsyncButton, Badge, Empty, ErrorNote, Skeleton, useConfirm } from "../components/ui.js";

export function MemoryList() {
  const { fingerprint = "" } = useParams();
  const repo = decodeURIComponent(fingerprint);
  const [params, setParams] = useSearchParams();
  const { q, type, page } = parseListParams(params);
  const { confirm, dialog } = useConfirm();

  // The input is local so typing feels immediate; the URL follows once the value
  // settles. Search/filter/page live in the URL so Back from a memory restores
  // the view and a filtered list can be shared.
  const [queryInput, setQueryInput] = useState(q);
  const debouncedQuery = useDebounced(queryInput, 300);

  useEffect(() => {
    if (debouncedQuery === q) return;
    // replace, not push: typing shouldn't fill the history stack with keystrokes.
    setParams(buildListParams({ q: debouncedQuery, type, page: 1 }), { replace: true });
  }, [debouncedQuery]);

  // Keep the box in step when the URL changes underneath us (Back/Forward).
  useEffect(() => {
    setQueryInput(q);
  }, [q]);

  const update = (next: Partial<{ q: string; type: MemoryType | null; page: number }>) => {
    setParams(buildListParams({ q, type, page, ...next }));
  };

  const { data, error, loading, reload } = useAsync(
    (signal) => api.memories(repo, { q: q || undefined, page, type }, signal),
    [repo, q, type, page],
  );

  // Landing at the bottom of a fresh page is disorienting after clicking "Next".
  useEffect(() => {
    if (page > 1) window.scrollTo({ top: 0 });
  }, [page]);

  const [deleteError, setDeleteError] = useState<unknown>(null);

  const total = data?.total ?? 0;
  const pages = pageCount(total, data?.page_size ?? MEMORIES_PAGE_SIZE);
  const filtered = Boolean(q || type);

  async function remove(id: string) {
    const ok = await confirm({
      title: "Delete this memory?",
      body: "It disappears for everyone on the team, and deletion can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteMemory(id);
      reload();
    } catch (e) {
      // Previously this had no catch at all: a failed delete after a confirmed
      // dialog produced no message whatsoever.
      setDeleteError(e);
    }
  }

  return (
    <Shell
      title={repo}
      crumbs={[
        ["Repositories", "/"],
        [repo, null],
      ]}
    >
      <h1>{repo}</h1>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="memory-search">Search</label>
          <input
            id="memory-search"
            type="search"
            placeholder="Search memories…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="memory-type">Type</label>
          <select
            id="memory-type"
            value={type ?? ""}
            // Resetting the page matters: page 7 of an unfiltered list is rarely
            // a valid page of the filtered one.
            onChange={(e) => update({ type: (e.target.value || null) as MemoryType | null, page: 1 })}
          >
            <option value="">All types</option>
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {deleteError != null && (
        <ErrorNote error={deleteError} context="That memory couldn't be deleted." />
      )}

      {error ? (
        // Not an empty list: a 403 or an outage used to render as "0 memories",
        // which is a lie the user can't diagnose.
        <ErrorNote error={error} onRetry={reload} context="These memories couldn't be loaded." />
      ) : loading && !data ? (
        <Skeleton />
      ) : (
        <>
          <p className="muted" role="status" aria-live="polite">
            {filtered ? `${countLabel(total, "match", "matches")}` : countLabel(total, "memory", "memories")}
            {filtered && total > 0 ? " for the current filters" : ""}
          </p>

          {total === 0 &&
            (filtered ? (
              <Empty
                title="No memories match those filters"
                body="Try a shorter search, or clear the filters to see everything in this repository."
                action={
                  <button type="button" className="btn" onClick={() => update({ q: "", type: null, page: 1 })}>
                    Clear filters
                  </button>
                }
              />
            ) : (
              <Empty
                title="No memories captured yet"
                body={
                  <>
                    This page is read-only — memories appear here after the Aznex worker runs on a
                    teammate's machine and their agent finishes a session.
                  </>
                }
                action={
                  <Link className="btn btn-primary" to="/get-started">
                    Set up the worker
                  </Link>
                }
              />
            ))}

          <ul className="list">
            {(data?.items ?? []).map((m) => (
              <li key={m.id} className="card">
                <Link className="card-link" to={`/memory/${encodeURIComponent(m.id)}`}>
                  <Badge tone="type">{typeLabel(m.type)}</Badge>
                  {m.title && <p className="card-title card-preview">{m.title}</p>}
                  <p className="card-preview">{preview(m.content)}</p>
                  <p className="card-meta">
                    <span>{m.author_login ?? "unknown"}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={isoDate(m.created_at_epoch)}>{formatRelative(m.created_at_epoch)}</time>
                  </p>
                </Link>
                {m.can_delete && (
                  <div className="card-actions">
                    <AsyncButton
                      className="btn btn-sm btn-danger"
                      onClick={() => remove(m.id)}
                    >
                      Delete
                    </AsyncButton>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav className="pager" aria-label="Pagination">
              <button
                type="button"
                className="btn btn-sm"
                disabled={page <= 1}
                onClick={() => update({ page: page - 1 })}
              >
                Previous
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={page >= pages}
                onClick={() => update({ page: page + 1 })}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
      {dialog}
    </Shell>
  );
}
