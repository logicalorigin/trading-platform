import { AsyncLocalStorage } from "node:async_hooks";

// Slice 5.5: which shadow (paper-trading) account the current call operates on.
//
// Shadow accounts became per-user, but the ~30 read/write functions in
// shadow-account.ts are DUAL-USE: called by requireUser routes (a user viewing/
// trading their own book) AND by no-user callers (the public marketing dashboard,
// background SSE timers, automation workers). We cannot add requireCurrentAppUserId()
// inside those shared functions — it would 401 the marketing route and crash the
// background timers (fail-closed).
//
// Instead, the dual-use path resolves its target account id from this scope, which
// DEFAULTS to the platform singleton (SHADOW_ACCOUNT_ID = "shadow", the founding-admin
// row). Only trusted, requireUser-gated route boundaries wrap the specific read/write
// call in runWithShadowAccountId(<caller's resolved account id>, ...). Background and
// marketing code never set the scope, so they always resolve the platform account.
//
// Background-platform functions (automation replay, maintenance, resets, mirror
// events) keep SHADOW_ACCOUNT_ID hardcoded rather than reading this scope, so they
// target the platform ledger even if they were ever reached from within a user scope.
const PLATFORM_SHADOW_ACCOUNT_ID = "shadow";

const shadowAccountStore = new AsyncLocalStorage<{ accountId: string }>();

export function runWithShadowAccountId<T>(accountId: string, fn: () => T): T {
  return shadowAccountStore.run({ accountId }, fn);
}

// The shadow account the current call targets. Defaults to the platform singleton
// when no scope is bound (background jobs, marketing, unauthenticated reads).
export function currentShadowAccountId(): string {
  return shadowAccountStore.getStore()?.accountId ?? PLATFORM_SHADOW_ACCOUNT_ID;
}

// The platform/founding-admin shadow account. Background-platform code that must
// never be user-scoped resolves this explicitly.
export function resolvePlatformShadowAccountId(): string {
  return PLATFORM_SHADOW_ACCOUNT_ID;
}
