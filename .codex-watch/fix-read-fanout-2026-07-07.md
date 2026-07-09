# Work-order C: bars persist accounting + shadow/execution read fan-out

Date: 2026-07-07

Scope observed: worker C files only. No commits, no staging, no app restart/reload.

## C1 - bars persist accounting + bounded/coalesced queue

Change summary:
- `artifacts/api-server/src/services/market-data-store.ts:72` adds `PersistMarketDataBarsResult = boolean | "skipped"`.
- `artifacts/api-server/src/services/market-data-store.ts:466-485` makes pool-contention handling return `"skipped"` and real DB errors return `"failed"`.
- `artifacts/api-server/src/services/market-data-store.ts:1009-1111` returns `"skipped"` for active durable-store backoff and pool-contention catch paths; successful writes still return `true`, other no-op/failure paths still return `false`.
- `artifacts/api-server/src/services/platform.ts:9055-9183` caps pending background persists at 512, coalesces pending duplicate `(symbol, timeframe, sourceName, from, to, limit)` windows by replacement, and splits `skipped`, `coalesced`, and `dropped` diagnostics from `failed`.

Test evidence:
```text
pnpm --filter @workspace/api-server exec tsx --test src/services/platform-bars-background-persist.test.ts
pass 4, fail 0
```

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/market-data-store-batch-equality.test.ts src/services/market-data-store-filter-closed.test.ts src/services/market-data-store-invalidation.test.ts src/services/market-data-store-persist-equality.test.ts src/services/market-data-store-pglite.test.ts src/services/market-data-store-skip-guard.test.ts src/services/market-data-store.test.ts
pass 36, fail 0
```

Estimated reduction:
- Observed duplicate pending windows now replace full bar result sets instead of appending them, so worst-case duplicate queue memory for one key is 1 pending entry.
- Pending queue retained heap is bounded at 512 entries; additional unique entries drop oldest and increment `dropped`.
- The 290 reported "failed" persists called out by the census would now split contention/backoff skips into `skipped`, keeping `failed` for real write errors.

## C2 - sparkline seed DB batching

Change summary:
- `artifacts/api-server/src/routes/platform.ts:737` raises `SPARKLINE_SEED_DB_BATCH_SIZE` from 4 to 64.
- `artifacts/api-server/src/routes/platform.ts:743-746` keeps DB concurrency at 1 and env-overridable.
- `artifacts/api-server/src/services/market-data-store.ts:596-650` is the checked query shape: one `unnest(array[...]::text[])` with a lateral per-symbol `limit`, selecting only `symbol`, `starts_at`, and `close`.

Batch safety:
- Default route limit is 120 (`platform.ts:868-872`), so 64 symbols reads up to 7,680 lean rows per batch.
- Route max is 240 (`platform.ts:747-748`), so the worst normal sparkline seed batch is up to 15,360 lean rows.
- A 96-symbol request now chunks to `[64, 32]`, reducing sequential DB round-trips from 24 to 2 with concurrency still 1.

Test evidence:
```text
pnpm --filter @workspace/api-server exec tsx --test src/routes/platform-sparkline-seed.test.ts
pass 6, fail 1
```

Failure is pre-existing from an unrelated assertion in the same file:
```text
runtime diagnostics route supports compact polling
AssertionError: Missing runtime diagnostics route end marker
```

Estimated reduction:
- 96 symbols at batch 4: 24 sequential DB reads.
- 96 symbols at batch 64: 2 sequential DB reads.
- Estimated round-trip reduction for 96-symbol seed: 22 fewer reads, about 91.7%.

## C3 - bound shadow ledger reads + share bundle/cache

Change summary:
- `artifacts/api-server/src/services/shadow-account.ts:501-505` lengthens `SHADOW_DERIVED_READ_CACHE_TTL_MS` to 30s and adds env-overridable `SHADOW_LEDGER_DASHBOARD_READ_LIMIT` default 20,000.
- `artifacts/api-server/src/services/shadow-account.ts:3142-3154` adds the bounded dashboard fills+orders read: newest fills by `occurredAt`, limited to `shadowLedgerDashboardReadLimit()`, then order lookup only for those fill order ids.
- `artifacts/api-server/src/services/shadow-account.ts:3176-3182` routes dashboard fills+orders through the existing `withShadowReadCache("dashboard:fills-with-orders", ...)` single-flight cache.
- `artifacts/api-server/src/services/shadow-account.ts:3212-3218` bounds `readShadowOrdersForAccount()` with newest-first order and the same 20,000-row default cap.
- `artifacts/api-server/src/services/shadow-account.ts:10005-10009` keeps closed-trades/all-time P&L on the raw full-ledger reader instead of the dashboard-capped reader.

Consumer enumeration:

| Consumer | Cadence/source observed | Needs all-time rows? | Path after change |
|---|---:|---|---|
| `shadow-account-streams.ts` snapshot | 2s | Positions/orders need current display; closed-trades for fast risk can be all-time | Positions/equity use shared ledger/dashboard cache; closed trades uses raw all-time path |
| `account-page-streams.ts` live | 1s | No for live positions/orders display | Account wrappers route to shadow service cache/bounded reads |
| `account-page-streams.ts` derived | 30s | Closed-trades/performance filters may need all-time when no `from` | Closed trades stays raw all-time; equity/cash use dashboard cache |
| `marketing-shadow-dashboard.ts` | 5s | Closed trades/trade stats use all-time by default | Closed trades stays raw all-time; positions/equity/cash/risk share service caches |
| `algo-cockpit-streams.ts` | 5s | Observed no current direct `getShadow*` ledger calls | No C3 code change needed for this stream |
| `computeSignalOptionsLedgerRealizedForDeployment` | internal accounting | Yes, lifetime realized P&L | Keeps `readShadowLedgerBundleForSource("automation")`; automation source order path is not dashboard-capped |

Test evidence:
```text
pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-read-cache.test.ts
pass 16, fail 0
```

```text
pnpm --filter @workspace/api-server exec tsx --test [22 shadow/platform/automation service test files from the requested ls command]
pass 127, fail 0
```

Estimated reduction:
- Dashboard fills+orders cache TTL changed from 10s to 30s, so a hot dashboard ledger scan is capped at about 2/account/minute instead of 6/account/minute: about 67% fewer dashboard cache misses.
- Compared with independent 1s/2s/5s poller fan-out, the shared single-flight + 30s cache bounds the hot dashboard fills+orders read to one in-flight operation per account/cache key and roughly 2/minute while fresh.
- The 20,000-row cap is above the census-observed current all-time shadow order scan size (~1,850 rows/scan) and stops dashboard reads from growing without bound.

## C4 - shared short-TTL cache on `listExecutionEvents`

Change summary:
- `artifacts/api-server/src/services/automation.ts:96-114` adds a 2s module-level cache and in-flight map for execution-event list responses.
- `artifacts/api-server/src/services/automation.ts:1220-1238` normalizes cache keys by `(deploymentId, limit, includePayload)`.
- `artifacts/api-server/src/services/automation.ts:1240-1318` preserves the existing uncached DB read/merge behavior.
- `artifacts/api-server/src/services/automation.ts:1320-1355` wraps `listExecutionEvents` in cache hit, expired delete, and single-flight join behavior.
- `artifacts/api-server/src/services/automation.ts:1371-1377` adds test-only cache reset/reader override hooks.

Invalidation:
- Observed no single cheap write hook in `automation.ts`; execution events are inserted from other services too.
- Cache is TTL-only. Staleness bound is 2 seconds.

Test evidence:
```text
pnpm --filter @workspace/api-server exec tsx --test src/services/automation.merge-events.test.ts
pass 5, fail 0
```

Estimated reduction:
- Cockpit SSE and marketing SSE both poll at about 5s; GET `/algo/events` can overlap them. Identical calls inside the 2s TTL now collapse to one DB read.
- Expected reduction is workload-shape dependent: best case for three near-identical pollers is roughly 2 of 3 reads removed for that key; staggered calls still have a hard 2s staleness/refresh bound.

## Gate evidence

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/automation.merge-events.test.ts
pass 5, fail 0
```

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/platform-bars-background-persist.test.ts
pass 4, fail 0
```

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account-read-cache.test.ts
pass 16, fail 0
```

```text
pnpm --filter @workspace/api-server exec tsx --test [requested shadow/platform/automation service test batch]
pass 127, fail 0
```

```text
pnpm --filter @workspace/api-server exec tsx --test [market-data-store sibling test batch]
pass 36, fail 0
```

```text
pnpm --filter @workspace/api-server exec tsx --test src/routes/platform-sparkline-seed.test.ts
pass 6, fail 1
pre-existing unrelated failure: Missing runtime diagnostics route end marker
```

```text
pnpm --filter @workspace/api-server run typecheck
fail
src/services/diagnostics-write-hygiene.test.ts: severity "critical" is not assignable to DiagnosticSeverity
```

The typecheck failure is in a diagnostics test file, which is outside worker C scope and explicitly not touched.

## Gaps

- Did not change miss-to-refetch TTL semantics for bars; C1 only fixes accounting, coalescing, and queue bounds.
- Dashboard shadow ledger cap is a high row limit, not a semantic date window. It preserves current all-time-sized ledgers observed in the census, but a future account with more than 20,000 relevant dashboard fills/orders may need a source/window-aware query instead.
- Closed-trades/all-time P&L remains a full-ledger read by design. It is cached at the derived TTL but not capped because it is the verified all-time consumer.
- `listExecutionEvents` cache is TTL-only. A cross-service invalidation hook would reduce staleness, but no cheap single insert hook was present in this file.
- Did not edit stream caller files; observed current account-page and marketing callers already route through account/shadow service wrappers, so the service-level cache/bounds cover them.
