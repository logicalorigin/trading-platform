# bar_cache write-contention fix — persist closed bars only (STAGED)

**Status:** STAGED — reviewed change, **NOT applied**. Do not apply live mid-market
(rebuild+restart causes a cold-start storm at the open). Apply after market close.
**Owner workstream:** helium-Postgres app-pool saturation (Layer 2 follow-on to
`docs/plans/db-pool-saturation-index-fix.md`).
**Source of findings:** live watch 2026-06-24 + two code-trace investigations.

## Problem (verified)

The HTTP `/bars` path persists the **currently-forming bar** to `bar_cache` on every
cache-miss fetch. The upsert conflict key is `(instrument_id, timeframe, source, starts_at)`
with `source = "massive-history"`, so concurrent fetches of the same symbol re-upsert the
**same hot row** (the open bucket) with changing OHLCV → `onConflictDoUpdate` rewrites it
each time → concurrent rewrites serialize on a Postgres row lock.

Evidence:
- Live `insert into "bar_cache"` upsert took **6.7s as the statement** while the pool was
  `active 10/12, idle 2` — i.e. statement-bound (lock/contention), NOT pool-acquire-bound.
  Slow-query p50 2.8s, max 19.4s.
- Call site: `artifacts/api-server/src/services/platform.ts:10867` (`void persistMarketDataBars(...)`,
  payload `massiveBars` includes the forming bar — `mapAggregateBar` has no partial/closed flag).
- The signal-monitor writer does NOT have this problem: it persists closed buckets only
  (`signal-monitor-local-bar-cache.ts` `rollupMinuteBars` without `includeProvisional`, ~:446)
  and is signature-deduped + 1s-debounced.

## Already ruled out (do NOT do these)

- **Persist-dedup per (symbol,timeframe):** unnecessary. No live `/bars` caller passes a
  floating `to`; live polling omits `to` (route) or quantizes it to the bar boundary
  (signal-monitor), so the 30s response cache + singleflight already coalesce. The
  cache-bust this would fix is not happening.
- **Batch the sparkline seed:** already batched — `loadSparklineSeedBarsBySymbol`
  (`routes/platform.ts:981-1001`) reads 32-symbol chunks via one `unnest`+lateral SQL at
  concurrency 2 (deliberately throttled). Max 2 pool slots.
- **Raise the pool cap / statement_timeout:** rejected (provider hard-cap 12; raising the
  timeout lets slow queries hold connections longer). See the index-fix plan.

## The fix — persist only closed buckets

Drop the forming bar from the write payload. It stays in memory (the chart response cache +
the WS forming-bar overlay at `platform.ts:10923`); it gets persisted once it closes, on the
next fetch after the bucket boundary.

### Proposed diff

1. Export a closed-bucket filter from `market-data-store.ts` (reuses the existing
   `TIMEFRAME_STEP_MS` / `bucketStartForTimeframe`, ~:85-138):

```ts
// market-data-store.ts (new export, near normalizeBarsToStoreTimeframe)
export function filterClosedBarsForStore<T extends MarketDataStoreBarInput>(
  bars: T[],
  timeframe: MarketDataStoreTimeframe,
  now: Date = new Date(),
): T[] {
  const stepMs = TIMEFRAME_STEP_MS[timeframe];
  // Unknown timeframe → no bucket math available; keep current behavior (persist all).
  if (!stepMs) return bars;
  const nowMs = now.getTime();
  return bars.filter(
    (bar) => bucketStartForTimeframe(bar.timestamp, timeframe).getTime() + stepMs <= nowMs,
  );
}
```

2. Apply it at the HTTP persist call site (`platform.ts:10867-10871`):

```ts
      // This request's response already includes these bars; durable storage is
      // catching up and must not evict the fresh in-memory chart cache entry.
      // Persist CLOSED buckets only — the forming bar is a hot row that concurrent
      // fetches re-upsert under a row lock (6.7s statements at the open). It is
      // served from the in-memory chart cache + WS overlay until it closes, then
      // persisted on the next fetch. Matches the signal-monitor writer invariant.
      const persistableBars = filterClosedBarsForStore(massiveBars, input.timeframe);
      if (persistableBars.length) {
        void persistMarketDataBars({
          request: persistRequest,
          sourceName: historicalStoreSource,
          bars: persistableBars,
        });
      }
```

### Why it's safe

- **Durability preserved:** every bar is still stored once closed (next fetch after the
  bucket boundary includes it as a closed bar and upserts it).
- **Invariant alignment:** the signal-monitor writer already persists closed-only; this makes
  both writers agree rather than inventing a new rule.
- **Read contract (chart path):** the chart `/bars` read already declines to serve the most-recent
  window from the store (`recentWindowMinutes`, default 60m), so the store lagging the live edge by
  one bar interval is consistent with how that read already behaves. **Caveat (corrected by audit):**
  this 60m-decline masking is NOT universal — `recentWindowMinutes:0` callers
  (`signal-monitor-local-bar-cache.ts`, watchlist backtest in `shadow-account.ts`) read up to `now`.
  Their safety rests instead on (a) the signal-monitor closed-only writer being unaffected by this
  filter and (b) a store miss self-healing via `getBars` re-fetch in-memory — not on the 60m mask.
- **No UI regression:** the live edge is owned by the chart response cache + the WS forming-bar
  overlay (`platform.ts:10923`), both downstream of the persist call.
- **Intraday timeframes only (≤1h):** the filter is gated to steps ≤1h, where the UTC epoch-grid
  bucket boundary coincides with actual bar closure. Coarse timeframes (4h/12h/1d/1w/1month/1year)
  persist all bars — their UTC bucket "closes" at 00:00 UTC, not session end, so dropping a
  session-finalized daily bar would withhold it from durable storage for hours; and they are
  low-frequency, so their open bucket is not a churn hotspot (the skip-guard still de-dups them).
- **Unknown timeframe → persist all** (no behavior change for any tf without a step entry).
- **`updated_at` now means "last OHLCV change", not "last write attempt":** the skip-guard stops
  bumping `updated_at` on re-persisted unchanged closed bars. The only consumer is the read-only
  signal-monitor price-trace diagnostic; no control-flow/staleness gate keys off it (reads order and
  return `dataUpdatedAt` from `starts_at`).

## Secondary contributor to evaluate (not in this change)

`signal-monitor-local-bar-cache.ts` reads bars via `loadStoredMarketBars` /
`loadStoredMarketBarsForSymbols` **directly** (`to: input.evaluatedAt`), bypassing the bars
response cache. Under saturation this direct-store read path is a more likely contention
contributor than any cache-bust. Worth a separate look alongside the Layer-2 bar_cache
retention work.

## Apply / verify / rollback

- **Apply (after close):** make the two edits, rebuild the bundle, restart via
  `REPLIT_MODE=workflow pnpm --filter @workspace/pyrus run dev:replit`.
- **Verify (flight recorder):** `bar_cache` insert p95 drops out of multi-second range;
  `api-db-pool-pressure` waiters fall; `/bars` still hydrates at the next open; signal
  freshness recovers (producer reads/writes finish under the 15s budget).
- **Add a test:** unit-test `filterClosedBarsForStore` (forming bar excluded, closed bar
  kept, unknown timeframe passes through).
- **Rollback:** `git revert` — pure code change, no DB migration.
