import { AsyncLocalStorage } from "node:async_hooks";

// Request-scoped "which app user is this request acting as" context, used to
// route IBKR calls to that user's hosted Client Portal gateway when they have
// one connected. Set once per authenticated /api request (see app.ts) and read
// lazily by getIbkrClientPortalClient(). Background work (no request) has no
// store and falls back to the global env-configured IBKR runtime.

const store = new AsyncLocalStorage<{ appUserId: string }>();

export function runWithIbkrPortalUser<T>(appUserId: string, fn: () => T): T {
  return store.run({ appUserId }, fn);
}

export function getIbkrPortalUserId(): string | null {
  return store.getStore()?.appUserId ?? null;
}
