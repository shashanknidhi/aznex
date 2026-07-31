import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { formatDateTime, githubFileUrl, isoDate, typeLabel } from "../format.js";
import { useAsync } from "../hooks.js";
import { Shell } from "../components/Shell.js";
import { AsyncButton, Badge, ErrorNote, Loading, useConfirm } from "../components/ui.js";

export function MemoryView() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const { data: memory, error, loading, reload } = useAsync((signal) => api.memory(id, signal), [id]);

  if (error) {
    return (
      <Shell title="Memory" crumbs={[["Repositories", "/"]]}>
        <ErrorNote error={error} onRetry={reload} context="This memory couldn't be loaded." />
        <Link className="btn" to="/">
          Go to repositories
        </Link>
      </Shell>
    );
  }
  if (loading || !memory) {
    return (
      <Shell title="Memory" crumbs={[["Repositories", "/"]]}>
        <Loading />
      </Shell>
    );
  }

  const repoPath = `/repo/${encodeURIComponent(memory.repo_fingerprint)}`;
  const files = [...new Set([...memory.files_read, ...memory.files_modified])];

  async function remove() {
    const ok = await confirm({
      title: "Delete this memory?",
      body: "It disappears for everyone on the team, and deletion can't be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteMemory(memory!.id);
      navigate(repoPath, { replace: true });
    } catch (e) {
      setDeleteError(e);
    }
  }

  return (
    <Shell
      title={memory.title ?? "Memory"}
      // Back goes to the repo it belongs to, not to the repo list — and the
      // list's own query/page survive in the history entry.
      crumbs={[
        ["Repositories", "/"],
        [memory.repo_fingerprint, repoPath],
        [memory.title ?? "Memory", null],
      ]}
    >
      <Badge tone="type">{typeLabel(memory.type)}</Badge>
      {/* No title: the content paragraph below is the headline. An "Untitled
          memory" heading only pushed the real text down. Matches the list,
          which already omits the title line when there isn't one. */}
      {memory.title && <h1>{memory.title}</h1>}

      {deleteError != null && <ErrorNote error={deleteError} context="This memory couldn't be deleted." />}

      <p className="memory-content">{memory.content}</p>
      {memory.narrative && <p className="memory-narrative">{memory.narrative}</p>}

      {memory.facts.length > 0 && (
        <>
          <h2>Facts</h2>
          <ul className="plain-list">
            {memory.facts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </>
      )}

      {memory.concepts.length > 0 && (
        <>
          <h2>Topics</h2>
          <ul className="tags">
            {memory.concepts.map((c) => (
              <li key={c}>
                <Badge>{c}</Badge>
              </li>
            ))}
          </ul>
        </>
      )}

      {files.length > 0 && (
        <>
          <h2>Files this memory is about</h2>
          <ul className="files">
            {files.map((path) => {
              const href = githubFileUrl(memory.repo_fingerprint, path);
              return (
                <li key={path}>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      <code>{path}</code>
                    </a>
                  ) : (
                    <code>{path}</code>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h2>History</h2>
      <p className="muted">
        Captured by {memory.author_login ?? "unknown"} on{" "}
        <time dateTime={isoDate(memory.created_at_epoch)}>{formatDateTime(memory.created_at_epoch)}</time>
        {memory.ai_extracted ? " · extracted automatically from an agent session" : " · added manually"}
      </p>

      {memory.can_delete && (
        <AsyncButton className="btn btn-danger" onClick={remove}>
          Delete this memory
        </AsyncButton>
      )}
      {dialog}
    </Shell>
  );
}
