import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api, authClient, setUnauthorizedHandler, type Me } from "./api.js";
import { Loading } from "./components/ui.js";

/**
 * Who is signed in, fetched once from /api/me and shared.
 *
 * /api/repos also carries identity, but it does one GitHub collaborator check
 * per repo — far too heavy for a header on every route, and it fails exactly
 * when the header most needs to render (so the user can sign out).
 */
interface SessionValue {
  me: Me | null;
  /** Set when /api/me itself failed — e.g. the caller belongs to no org. */
  error: unknown;
  loading: boolean;
  reload: () => void;
}

const SessionContext = createContext<SessionValue>({
  me: null,
  error: null,
  loading: true,
  reload: () => {},
});

export function useMe(): SessionValue {
  return useContext(SessionContext);
}

/** Sign out and land on the login page. */
export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } finally {
    // Hard navigation, not a client-side one: it throws away every component's
    // cached state along with the session.
    window.location.assign("/login");
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // A 401 anywhere means the cookie died. better-auth keeps serving its cached
  // session, so RequireAuth would keep letting the user through to a page where
  // every request fails — with no sign-out button, that was inescapable.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void authClient.signOut().finally(() => {
        const next = window.location.pathname + window.location.search;
        window.location.assign(`/login?reason=expired&next=${encodeURIComponent(next)}`);
      });
    });
  }, []);

  useEffect(() => {
    if (isPending) return;
    if (!session) {
      setMe(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api.me(controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return;
        setMe(value);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (controller.signal.aborted) return;
        setMe(null);
        setError(e);
        setLoading(false);
      },
    );
    return () => controller.abort();
  }, [session, isPending, nonce]);

  const value = useMemo<SessionValue>(
    () => ({ me, error, loading: isPending || loading, reload: () => setNonce((n) => n + 1) }),
    [me, error, isPending, loading],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Gate for every authenticated route. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  const loc = useLocation();
  if (isPending) return <Loading label="Loading…" />;
  if (!session) {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  return <>{children}</>;
}
