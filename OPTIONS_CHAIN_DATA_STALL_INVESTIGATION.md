# Options Chain Data Stall — Investigation & Fix Plan

**Date:** 2026-06-08
**Area:** Trade page → options chain (`TradeChainPanel` / `TradeOptionChainRuntime`)
**Status:** Root cause confirmed with live probes; fix proposed (not yet implemented)

## Symptom

On the trade page the options chain sometimes renders empty and never hydrates — no rows appear, and because there are no rows there are no greeks/bid-ask to overlay from the quote stream.

## Diagnosis (confirmed against the running API on :8080)

This is **not** a broker/bridge outage and **not** caused by the recent order-ticket/layout work — `<TradeOptionChainRuntime>` still renders and its `enabled` gating is unchanged.

Live evidence:

- `GET /api/readiness` → `brokerTradingReadiness.status: "ready"` (configured / reachable / connected / authenticated all `true`). The bridge is healthy. Readiness also reported `pressureLevel: "watch"`, `"container-replaced"`, `"same-container-supervisor-abrupt"` — i.e. the option caches had recently gone **cold**.
- `GET /api/options/expirations?underlying=SPY` (first call) →
  ```json
  {"expirations":[],"debug":{"upstreamMs":null,"stale":true,"degraded":true,
   "reason":"option_expirations_refresh_deferred"}}
  ```
- The **same call ~2s later returned the full populated list** (`cacheStatus:"hit"`). `AAPL` was already warm and returned data immediately.

### Root cause — defer-then-warm server pattern colliding with a no-retry client cache

- **Server** (`artifacts/api-server/src/services/platform.ts:15305-15317`): the expirations handler starts `refreshOptionExpirationCache` in the background and, if it doesn't finish within the foreground wait, returns an **empty 200 placeholder** with `reason:"option_expirations_refresh_deferred"`, `degraded:true`, `stale:true`. The background refresh lands a second or two later (verified above).
- **Client** (`artifacts/pyrus/src/screens/TradeScreen.jsx`): `useGetOptionExpirations` uses `OPTION_EXPIRATION_QUERY_DEFAULTS` = `staleTime: 5min`, `refetchOnMount/Reconnect/WindowFocus: false`, `retry: false`, `refetchInterval: false`. The deferred response is a **successful** empty 200, so React Query caches `expirations: []` for 5 minutes and **never refetches** to pick up the warmed data.
- **Downstream stall**: with empty expirations, `activeExpiration` stays `null`, so the active chain `useQuery` (enabled requires `activeExpiration?.isoDate && activeChainKey`) and the batch queries **never fire** → no chain rows → nothing for the quote stream to hydrate.

**Net:** any time the option cache is cold when the trade page mounts (fresh load, container swap, or the 5-min cache expiring under pressure), the chain gets stuck empty for ~5 minutes even though the server has the data ready within seconds.

## Fix

Make the option-chain queries treat the server's transient *deferred/degraded* empty responses as non-final and **poll briefly until real data lands**, instead of caching the placeholder. React Query v5.90.21 supports a functional `refetchInterval(query)` returning `number | false`.

All changes are in `artifacts/pyrus/src/screens/TradeScreen.jsx` (the query-defaults block ~lines 214/280 and the `TradeOptionChainRuntime` queries).

### 1. Expirations query (the confirmed root cause)

Add a helper near `OPTION_EXPIRATION_QUERY_DEFAULTS` (~line 280):

```js
const OPTION_DEFERRED_REFETCH_MS = 2000;
// Server returns an empty `degraded`/`stale` placeholder while it warms the
// option cache in the background (cold start / container swap). Poll briefly so
// we pick up the warmed data instead of caching empty for the 5-minute staleTime.
const refetchWhileExpirationsDeferred = (query) => {
  const data = query.state.data;
  if ((data?.expirations?.length ?? 0) > 0) return false;          // got data → stop
  const debug = data?.debug;
  return debug?.degraded || debug?.stale ? OPTION_DEFERRED_REFETCH_MS : false;
};
```

Then add to the expirations query options (`useGetOptionExpirations(... { query: { enabled, ...OPTION_EXPIRATION_QUERY_DEFAULTS } })`, ~line 2585):

```js
refetchInterval: refetchWhileExpirationsDeferred,
```

Branching on `debug.degraded || debug.stale` (set by the deferral/backoff paths per `GetOptionExpirationsResponse` in `lib/api-zod/src/generated/api.ts:3535-3551`) means a *genuinely* empty/clean response (a symbol with no options) returns `false` and does **not** poll forever.

### 2. Active chain query (analogous hardening)

The single `GetOptionChainResponse` does not expose `debug` to the client, so gate on emptiness with a bounded poll to avoid infinite polling for genuinely empty chains. Add to the active chain `useQuery` options (~line 2773):

```js
refetchInterval: (query) => {
  const data = query.state.data;
  if ((data?.contracts?.length ?? 0) > 0) return false;
  // poll a few times while empty (covers a transient deferred/backoff chain),
  // then give up so we don't spin on a legitimately empty chain.
  return query.state.dataUpdateCount < 5 ? OPTION_DEFERRED_REFETCH_MS : false;
},
```

(Leave the batch queries as-is; they're analysis-only prefetch and not on the critical render path.)

### Why frontend, not server

The server's defer-then-warm is intentional (don't block the request thread on a cold bridge call). The correct place to recover is the client, which already polls/streams elsewhere; this is a localized resilience fix that matches existing query-config patterns in the same file.

## Critical files

- `artifacts/pyrus/src/screens/TradeScreen.jsx` — `OPTION_EXPIRATION_QUERY_DEFAULTS` / `OPTION_CHAIN_QUERY_DEFAULTS` block (~214/280), the `useGetOptionExpirations` call (~2585), and the active chain `useQuery` (~2746-2774) inside `TradeOptionChainRuntime`.
- Reference only (no change): `artifacts/api-server/src/services/platform.ts:15305-15317` (deferral source); `lib/api-zod/src/generated/api.ts:3530-3552` (expirations `debug` shape).

## Verification

1. `cd artifacts/pyrus && pnpm typecheck` — clean.
2. Reproduce cold state: `curl "http://localhost:8080/api/options/expirations?underlying=<fresh-symbol>"` — first call returns `reason:"option_expirations_refresh_deferred"` with `expirations:[]`; a repeat ~2s later returns the populated list. Confirms the server warms quickly.
3. In the app, open the trade page on a cold/fresh symbol (or right after a container restart): the chain panel should populate within ~2-4s (one or two background refetches) instead of staying empty. Watch the network tab for the expirations request repeating ~every 2s until it returns rows, then stopping.
4. Confirm greeks/bid-ask hydrate once rows appear (the visible-quote stream overlays onto the now-present rows).
5. Regression check: a symbol with genuinely no options should make at most a bounded number of refetches, then stop (no infinite polling).
