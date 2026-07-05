import { eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { requireCurrentAppUserId } from "./app-user-context";

// Defense-in-depth helpers for per-user data isolation. RLS is skipped for v1
// (the pooling model can't bind SET LOCAL per request), so app-level scoping is
// the sole boundary — these helpers make the filter and the cache key hard to
// forget, and fail closed via requireCurrentAppUserId().

// Composable predicate: restrict a query on a user-scoped table to the current
// request's app user. A route that forgot requireUser (empty ALS store) throws
// 401 here instead of returning another user's rows. Compose into and(...).
export function ownedBy(table: { appUserId: AnyPgColumn }): SQL {
  return eq(table.appUserId, requireCurrentAppUserId());
}

// Prefix a cache key with the current app user so a per-user cache can never
// serve one user's snapshot to another. Use for every cache key that touches
// user-scoped data.
export function userScopedCacheKey(...parts: Array<string | number>): string {
  return [requireCurrentAppUserId(), ...parts].join(":");
}
