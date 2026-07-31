import { useCallback, useEffect, useRef, useState } from "react";
import { errorDetail, errorMessage } from "../errors.js";

/**
 * A failure the user can read, and act on.
 *
 * `role="alert"` because a screen reader otherwise gets no announcement that an
 * action failed. The Retry button matters as much as the message: there was
 * previously no way to retry anything in the entire app.
 */
export function ErrorNote({
  error,
  onRetry,
  context,
}: {
  error: unknown;
  onRetry?: () => void;
  context?: string;
}) {
  const detail = errorDetail(error);
  return (
    <div className="note note-danger" role="alert">
      <p>{errorMessage(error, context)}</p>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
      {detail && (
        <details className="note-detail">
          <summary>Technical details</summary>
          <code>{detail}</code>
        </details>
      )}
    </div>
  );
}

/** A neutral or cautionary aside — misconfiguration notices, admin-only hints. */
export function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn";
  children: React.ReactNode;
}) {
  return <div className={`note note-${tone}`}>{children}</div>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className="muted" role="status" aria-live="polite">
      {label}
    </p>
  );
}

/**
 * Placeholder rows for a list that is loading.
 *
 * Only the memory list uses this, and only because its first paint used to
 * assert "0 memories" — telling a user their repo is empty while the request is
 * still in flight.
 */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="card skeleton">
          <span className="skeleton-line skeleton-line-short" />
          <span className="skeleton-line" />
          <span className="skeleton-line skeleton-line-medium" />
        </li>
      ))}
    </ul>
  );
}

/** Nothing here — say why, and what to do about it. */
export function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {body && <div className="empty-body">{body}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "type" | "ok" | "warn" | "danger";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Transient success line, adjacent to the thing that changed. */
export function Flash({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="flash" role="status" aria-live="polite">
      {message}
    </p>
  );
}

// ── confirmation ─────────────────────────────────────────────────────────────

interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  tone?: "danger" | "default";
}

/**
 * Promise-returning confirm on a native `<dialog>`.
 *
 * Replaces `window.confirm`, which can't be styled, can't carry the sentence
 * that actually matters ("this deletes it for everyone on the team"), and is
 * suppressible by the browser. `showModal()` gives a focus trap and Escape for
 * free, so this needs no focus-management code.
 */
export function useConfirm(): {
  confirm: (req: ConfirmRequest) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (request && !el.open) el.showModal();
    if (!request && el.open) el.close();
  }, [request]);

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setRequest(null);
  }, []);

  const confirm = useCallback((req: ConfirmRequest) => {
    setRequest(req);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const dialog = (
    <dialog
      ref={ref}
      className="confirm"
      // Escape and the backdrop both count as "no" — never as "yes".
      onCancel={(e) => {
        e.preventDefault();
        settle(false);
      }}
    >
      {request && (
        <>
          <h2>{request.title}</h2>
          {request.body && <p className="muted">{request.body}</p>}
          <div className="confirm-actions">
            <button type="button" className="btn" onClick={() => settle(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={request.tone === "danger" ? "btn btn-danger" : "btn btn-primary"}
              onClick={() => settle(true)}
              autoFocus
            >
              {request.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </>
      )}
    </dialog>
  );

  return { confirm, dialog };
}

/**
 * A button that disables itself while its action is in flight.
 *
 * No mutation in the app used to disable anything, so every destructive action
 * could be fired twice by an impatient double-click.
 *
 * `busyLabel` is only right for an action that starts immediately. If the
 * handler opens a confirmation first, the button is "busy" while the dialog is
 * merely open — and a button reading "Deleting…" behind a dialog still asking
 * whether to delete is a lie. Leave it off in that case; the disabled state
 * alone does the useful work.
 */
export function AsyncButton({
  onClick,
  children,
  className = "btn",
  busyLabel,
  ...rest
}: {
  onClick: () => Promise<unknown>;
  children: React.ReactNode;
  className?: string;
  busyLabel?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "className">) {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  return (
    <button
      {...rest}
      type="button"
      className={className}
      disabled={busy || rest.disabled}
      aria-busy={busy || undefined}
      onClick={() => {
        setBusy(true);
        void onClick().finally(() => {
          if (alive.current) setBusy(false);
        });
      }}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
