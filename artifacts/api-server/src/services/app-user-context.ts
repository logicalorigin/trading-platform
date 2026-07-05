import { AsyncLocalStorage } from "node:async_hooks";
import { HttpError } from "../lib/errors";

// Canonical request-scoped "which app user is this request acting as" context.
// Bound once per authenticated /api request in app.ts and read by services that
// must scope data to the current user.
//
// IMPORTANT: this store is ONLY populated on the request path. Background work —
// timers, SSE polling loops, workers — does NOT run inside this scope, so those
// paths must thread `appUserId` explicitly and must never rely on this store
// (see the plan's "isolation mechanism" note). getCurrentAppUserId() returns
// null there; requireCurrentAppUserId() fails closed.

const store = new AsyncLocalStorage<{ appUserId: string }>();

export function runAsAppUser<T>(appUserId: string, fn: () => T): T {
  return store.run({ appUserId }, fn);
}

export function getCurrentAppUserId(): string | null {
  return store.getStore()?.appUserId ?? null;
}

// Fail-closed accessor for user-scoped request reads: throws 401 when there is
// no bound user (anonymous request, or called outside a request scope). It never
// returns a fallback — a missing user must never silently read global data.
export function requireCurrentAppUserId(): string {
  const appUserId = getCurrentAppUserId();
  if (!appUserId) {
    throw new HttpError(401, "Authentication required", {
      code: "auth_required",
    });
  }
  return appUserId;
}
