// Back-compat shim. The canonical request-scoped app-user context now lives in
// app-user-context.ts; these IBKR-named exports are kept so existing IBKR
// gateway-routing call sites (app.ts, ibkr-client-runtime.ts) keep working
// without change. They share the single underlying AsyncLocalStorage store.
import { getCurrentAppUserId, runAsAppUser } from "./app-user-context";

export function runWithIbkrPortalUser<T>(appUserId: string, fn: () => T): T {
  return runAsAppUser(appUserId, fn);
}

export function getIbkrPortalUserId(): string | null {
  return getCurrentAppUserId();
}
