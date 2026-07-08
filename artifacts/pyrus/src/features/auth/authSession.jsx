import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";

// Slice 8: one canonical auth-session source for the whole SPA. Historically
// `/api/auth/session` was fetched independently in ~6 places (each redeclaring
// this key); they still share React Query's cache via the same key, but new
// code — starting with the login gate — should read `useAuthSession()` so there
// is a single place that knows "who am I / am I signed in / what can I do".
export const AUTH_SESSION_QUERY_KEY = ["auth-session"];

// `/api/auth/session` always responds 200: `{ user, csrfToken }` when signed in,
// `{ user: null, csrfToken: null }` when signed out. A non-200 means the backend
// is unreachable — surfaced as an error so the gate can fail closed.
export async function readAuthSession({ signal } = {}) {
  const timeout = AbortSignal.timeout(8000);
  const merged = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch("/api/auth/session", {
    headers: { Accept: "application/json" },
    signal: merged,
  });
  if (!response.ok) {
    throw new Error("Auth session unavailable");
  }
  return response.json();
}

// Shared POST helper for the public auth endpoints (login / bootstrap / logout).
// Throws an Error carrying `.data` (the parsed error body) and `.status`.
export async function postAuthJson(path, body, headers = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(
      payload?.detail ||
        payload?.title ||
        payload?.message ||
        `HTTP ${response.status}`,
    );
    error.data = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

const AuthSessionContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: readAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY }),
    [queryClient],
  );

  const value = useMemo(() => {
    const user = query.data?.user ?? null;
    const entitlements = Array.isArray(user?.entitlements)
      ? user.entitlements
      : [];
    const isAdmin = user?.role === "admin";
    return {
      user,
      entitlements,
      csrfToken: query.data?.csrfToken ?? null,
      signedIn: Boolean(user),
      isAdmin,
      // Fetch still in flight on first paint (nothing cached yet).
      isLoading: query.isLoading,
      // Backend unreachable — the gate treats this as "not signed in".
      isError: query.isError,
      // Mirrors the backend `sessionHasEntitlement` (admins hold everything).
      hasEntitlement: (key) => isAdmin || entitlements.includes(key),
      refresh,
    };
  }, [query.data, query.isLoading, query.isError, refresh]);

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within <AuthProvider>");
  }
  return context;
}
