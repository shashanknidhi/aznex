import { useCallback, useEffect, useRef, useState } from "react";
import { MEMORIES_PAGE_SIZE } from "./api.js";
import { isMemoryType } from "./format.js";
import type { MemoryType } from "@aznex/shared";

/**
 * Load-with-states, in ~40 lines instead of a data-fetching dependency.
 *
 * Every page used to hand-roll this and each got it slightly wrong: some
 * swallowed errors into an empty list, some initialised to a value that made an
 * in-flight request look like a finished empty one. `data === null && !error`
 * means loading — never "empty".
 */
export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  // Keep the latest fetcher without making it a dependency, so callers can pass
  // an inline closure without re-fetching on every render.
  const ref = useRef(fetcher);
  ref.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    ref.current(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (e) => {
        // An abort means a newer request superseded this one; its result is not
        // ours to report, and reporting it would clobber the newer state.
        if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e);
        setLoading(false);
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

/** Per-route document title. Every screen used to share one. */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · Aznex` : "Aznex";
  }, [title]);
}

/**
 * A short-lived confirmation line for mutations whose result isn't visible in
 * the list next to them (adding a member, onboarding a repo).
 */
export function useFlash(ms = 4000): [string | null, (msg: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const flash = useCallback(
    (msg: string) => {
      setMessage(msg);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), ms);
    },
    [ms],
  );
  return [message, flash];
}

// ── memory list URL state ────────────────────────────────────────────────────
// Search, filter and page belong in the URL. They used to live in useState, so
// browser Back from a memory detail dropped the user's query and put them on
// page 1, and a filtered view could not be shared or bookmarked.

export interface ListParams {
  q: string;
  type: MemoryType | null;
  page: number;
}

export function parseListParams(params: URLSearchParams): ListParams {
  const rawPage = Number(params.get("page") ?? 1);
  const rawType = params.get("type") ?? "";
  return {
    q: params.get("q") ?? "",
    // An unknown type in a hand-edited URL is ignored rather than sent onward
    // for the server to reject.
    type: isMemoryType(rawType) ? rawType : null,
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1,
  };
}

/** Only non-default values are written, so a clean view has a clean URL. */
export function buildListParams({ q, type, page }: ListParams): URLSearchParams {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (type) params.set("type", type);
  if (page > 1) params.set("page", String(page));
  return params;
}

export function pageCount(total: number, size = MEMORIES_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** Debounce a value, for search-as-you-type. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
