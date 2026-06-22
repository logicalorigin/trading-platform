import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

// Reference/structural API paths that are SAFE to persist across reloads.
//
// DEFAULT-DENY: only queries whose key path (queryKey[0]) is in this set are
// written to disk. Everything else is intentionally excluded -- all live market
// data and account financials (quotes, option chains, stock aggregates,
// positions, balances, orders, flow, signal state/events, and the
// stream-backed runtime/account snapshots that live-streams.ts pushes into the
// query cache) must NEVER be restored stale, or a reload would paint old
// prices/positions as if they were live. Account financials live under
// `/api/accounts/${accountId}/...`, so the exact `/api/accounts` match (the
// account LIST used by the switcher) does not capture them.
const PERSISTABLE_QUERY_PATHS = new Set<string>([
  "/api/session",
  "/api/watchlists",
  "/api/accounts",
  "/api/signal-monitor/profile",
  "/api/universe/tickers",
  "/api/algo/deployments",
  "/api/settings/backend",
  "/api/settings/preferences",
]);

export function isPersistableQueryKey(queryKey: unknown): boolean {
  if (!Array.isArray(queryKey) || queryKey.length === 0) return false;
  const path = queryKey[0];
  return typeof path === "string" && PERSISTABLE_QUERY_PATHS.has(path);
}

// Bump when the persisted shape or the allowlist changes -- a buster mismatch
// makes react-query discard the whole persisted cache on restore.
const PERSIST_SCHEMA_VERSION = "pyrus-rq-1";
// Discard the entire persisted cache once it is older than this. Per-query
// staleTime (30s) still triggers a background refetch on mount, so persisted
// data is only ever an instant-paint seed that fresh data replaces.
const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PERSIST_STORAGE_KEY = "pyrus-react-query-cache";

export type PyrusPersistOptions = Omit<PersistQueryClientOptions, "queryClient">;

// Returns the persist options for PersistQueryClientProvider, or null when
// there is no synchronous storage available (SSR / non-DOM test env) so callers
// can fall back to a plain QueryClientProvider.
export function createPyrusPersistOptions(): PyrusPersistOptions | null {
  if (typeof window === "undefined" || !window.localStorage) return null;

  const persister = createSyncStoragePersister({
    storage: window.localStorage,
    key: PERSIST_STORAGE_KEY,
  });

  return {
    persister,
    maxAge: PERSIST_MAX_AGE_MS,
    buster: PERSIST_SCHEMA_VERSION,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        query.state.status === "success" &&
        query.state.data !== undefined &&
        isPersistableQueryKey(query.queryKey),
    },
  };
}
