import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  setCsrfTokenGetter,
} from "@workspace/api-client-react";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

// Slice 8: one canonical auth-session source for the whole SPA. Historically
// `/api/auth/session` was fetched independently in ~6 places (each redeclaring
// this key); they still share React Query's cache via the same key, but new
// code — starting with the login gate — should read `useAuthSession()` so there
// is a single place that knows "who am I / am I signed in / what can I do".
export const AUTH_SESSION_QUERY_KEY = ["auth-session"];

function isAuthSessionQuery(query) {
  return (
    query.queryKey.length === AUTH_SESSION_QUERY_KEY.length &&
    query.queryKey[0] === AUTH_SESSION_QUERY_KEY[0]
  );
}

function authSessionIdentity(session) {
  return session?.user?.id ?? null;
}

export function clearUserScopedQueryCache(queryClient) {
  queryClient.removeQueries({
    predicate: (query) => !isAuthSessionQuery(query),
  });
}

export function applyAuthSessionTransition(queryClient, session) {
  clearUserScopedQueryCache(queryClient);
  queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, session);
}

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

// Auth mutations deliberately have no client deadline. Aborting after the API
// commits a session would turn a successful mutation into an ambiguous failure.
// The shared transport only installs default deadlines on idempotent GETs.
export function postAuthJson(path, body, headers = {}) {
  return customFetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    responseType: "json",
    timeoutMs: null,
  });
}

const AuthSessionContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const initialSession = queryClient.getQueryData(AUTH_SESSION_QUERY_KEY);
  const observedIdentityRef = useRef(
    initialSession === undefined
      ? undefined
      : authSessionIdentity(initialSession),
  );
  const readAttachedAuthSession = useCallback(
    async (context) => {
      const session = await readAuthSession(context);
      const nextIdentity = authSessionIdentity(session);
      const cachedSession = queryClient.getQueryData(AUTH_SESSION_QUERY_KEY);
      const previousIdentity =
        cachedSession === undefined
          ? observedIdentityRef.current
          : authSessionIdentity(cachedSession);
      if (
        previousIdentity !== undefined &&
        previousIdentity !== nextIdentity
      ) {
        clearUserScopedQueryCache(queryClient);
      }
      observedIdentityRef.current = nextIdentity;
      return session;
    },
    [queryClient],
  );
  const query = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: readAttachedAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type !== "updated" ||
          event.action.type !== "success" ||
          !isAuthSessionQuery(event.query)
        ) {
          return;
        }
        const nextIdentity = authSessionIdentity(event.query.state.data);
        const previousIdentity = observedIdentityRef.current;
        observedIdentityRef.current = nextIdentity;
        if (
          previousIdentity !== undefined &&
          previousIdentity !== nextIdentity
        ) {
          clearUserScopedQueryCache(queryClient);
        }
      }),
    [queryClient],
  );

  const refresh = useCallback(
    ({ clearUserCache = false } = {}) => {
      if (clearUserCache) {
        clearUserScopedQueryCache(queryClient);
      }
      return queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
    },
    [queryClient],
  );

  const adoptSession = useCallback(
    (session) => {
      observedIdentityRef.current = authSessionIdentity(session);
      applyAuthSessionTransition(queryClient, session);
    },
    [queryClient],
  );

  const csrfToken = query.data?.csrfToken ?? null;
  useEffect(() => {
    setCsrfTokenGetter(() => csrfToken);
    return () => setCsrfTokenGetter(null);
  }, [csrfToken]);

  const value = useMemo(() => {
    const user = query.data?.user ?? null;
    const entitlements = Array.isArray(user?.entitlements)
      ? user.entitlements
      : [];
    const isAdmin = user?.role === "admin";
    return {
      user,
      entitlements,
      csrfToken,
      signedIn: Boolean(user),
      isAdmin,
      // Fetch still in flight on first paint (nothing cached yet).
      isLoading: query.isLoading,
      // Backend unreachable — the gate treats this as "not signed in".
      isError: query.isError,
      // Mirrors the backend `sessionHasEntitlement` (admins hold everything).
      hasEntitlement: (key) => isAdmin || entitlements.includes(key),
      adoptSession,
      refresh,
    };
  }, [
    adoptSession,
    csrfToken,
    query.data,
    query.isError,
    query.isLoading,
    refresh,
  ]);
  const authBoundaryIdentity = authSessionIdentity(query.data);
  const authBoundaryKey =
    query.data === undefined
      ? "pending"
      : authBoundaryIdentity !== null
        ? `user:${authBoundaryIdentity}`
        : "anonymous";

  return (
    <AuthSessionContext.Provider value={value}>
      <Fragment key={authBoundaryKey}>{children}</Fragment>
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
