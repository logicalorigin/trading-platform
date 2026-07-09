artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts:1344 | P1 | allocation/performance | Live aggregate rollups run even when persistence is disabled

Evidence (observed): `liveAggregatePersistEnabled()` is true only when `PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES` is `"1"` or `"true"` (lines 234-238), but `handleMassiveAggregate` always calls `enqueueRollups` after storing the minute bar (lines 1335-1344). `enqueueRollups` scans recent bars, rolls up every intraday timeframe, and schedules a persist flush (lines 1297-1332), while `queuePersist` immediately returns when live persistence is disabled and allocates a fresh `Date` for skip diagnostics (lines 741-744).

Failure scenario: During market hours, a broad aggregate stream can repeatedly scan, sort, group, and allocate 1m/2m/5m/15m/1h rollups only to discard them, plausibly feeding the observed aggregation CPU and GC even when live aggregate persistence is off.

Laziest fix: Add a single `!liveAggregatePersistEnabled()` guard before `enqueueRollups` does any scan/rollup/schedule work, preserving only cheap aggregate-level skip diagnostics if needed.

Confidence: 0.97

artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts:805 | P1 | allocation/performance | Rollup code clones and sorts the same recent slice once per timeframe

Evidence (observed): `enqueueRollups` builds one `minuteBars` slice (lines 1306-1313) and then calls `rollupMinuteBars` for each intraday timeframe (lines 1317-1323). Each call clones and sorts `input.bars` (lines 805-807); non-1m rollups then allocate grouped arrays, sort groups, spread `last`, create `Date` objects, and build high/low arrays with `bars.map` plus `Math.max`/`Math.min` (lines 827-883).

Failure scenario: One incoming aggregate can perform up to five repeated scans/sorts over the same recent bars for the same symbol; across a large symbol universe this is a direct match for the profile's minute-bar aggregation cluster and allocation churn.

Laziest fix: Sort the recent slice once in `enqueueRollups` and compute all intraday rollups in one pass with mutable bucket accumulators instead of per-timeframe clones, grouped arrays, and `bars.map` spreads.

Confidence: 0.94

artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts:722 | P2 | performance | Retention pruning scans each symbol's retained minute map on every aggregate

Evidence (observed): The memory retention default is 120 hours (line 68). Every `storeMinuteBar` call computes a retention boundary and iterates every key in that symbol's `Map`, deleting expired entries one by one (lines 713-727).

Failure scenario: With thousands of retained minute bars per active symbol, every new aggregate pays an O(retained bars for that symbol) pruning pass even when almost no entries expire, adding steady event-loop work during the same market-hours stream.

Laziest fix: Track per-symbol prune state and delete only expired head entries on a coarse cadence, falling back to a full scan only when out-of-order inserts are detected.

Confidence: 0.86

artifacts/api-server/src/services/stock-aggregate-stream.ts:421 | P2 | allocation/performance | Recent aggregate history is re-filtered, re-sorted, and cloned on every read

Evidence (observed): `recordAggregateHistory` maintains each symbol history in start-time order by replacing the last same-minute entry, appending later entries, or inserting older entries in order (lines 234-255). `getRecentStockMinuteAggregateHistory` still creates a filtered array, sorts it again, slices it, and clones every returned message on each call (lines 421-425).

Failure scenario: A signal scan that asks for recent history per symbol repeatedly allocates arrays and sorts already ordered history, matching the profiled `getRecentStockMinuteAggregateHistory` hot path.

Laziest fix: Use the existing sorted history with a tail scan or binary-search bounds and clone only the final returned rows.

Confidence: 0.91

artifacts/api-server/src/services/signal-options-worker.ts:563 | P1 | timeout/recovery | Timed-out scans can wedge a deployment if the scan does not settle after abort

Evidence (observed): The worker passes an `AbortSignal` into `scanDeployment` (lines 441-450), aborts that controller when the timeout fires (lines 459-468), and races the scan with the timeout (lines 473-479). On timeout, it marks the runtime `timed_out_unsettled` and leaves the deployment in `activeDeploymentIds` until the original scan promise's `finally` runs (lines 563-605); subsequent attempts return early while the deployment remains active (lines 489-496).

Failure scenario: If the underlying scan is waiting on DB work or otherwise does not honor the abort signal promptly, the worker intentionally prevents detached duplicate scans but can leave that deployment stuck in `timed_out_unsettled`, causing repeated `scan_running`/stale behavior until the original promise settles or the process restarts.

Laziest fix: Make the scan implementation honor the passed `AbortSignal` at every DB/action boundary so the existing timeout path settles and clears `activeDeploymentIds` without starting a duplicate scan.

Confidence: 0.84

artifacts/api-server/src/services/massive-stock-quote-stream.ts:196 | P2 | allocation/performance | Quote fanout still allocates a matched-symbol array per subscriber per flush

Evidence (observed): `flushSnapshotNotifications` memoizes payloads and serialization by matched-symbol key (lines 194-220), but every subscriber first runs `symbols.filter(...)` over the pending-symbol array and joins the result before memoization can help (lines 196-202).

Failure scenario: With many SSE subscribers and broad pending quote batches, fanout still does O(subscribers x pending symbols) filtering and array allocation even when many subscribers share the same subset, leaving avoidable work in the same stream path where SSE serialization is already visible in the profile.

Laziest fix: Maintain a symbol-to-subscribers index or iterate the smaller `subscriber.symbols` set to build/cache matched keys without allocating a full filtered array for every subscriber.

Confidence: 0.74

Coverage note: Read fully, with line-numbered source, all five scoped files: `stock-aggregate-stream.ts`, `sse-stream-diagnostics.ts`, `massive-stock-quote-stream.ts`, `signal-options-worker.ts`, and `signal-monitor-local-bar-cache.ts`. Re-read the cited ranges before writing. Did not run tests, builds, the app, runtime probes, or git commands. No defensible finding was reported in `sse-stream-diagnostics.ts`; observed `serializeSseEventData` is a direct JSON.stringify counter wrapper, so the actionable reduction is at callers/fanout rather than in that helper.

Verdict: Inference: these files can plausibly account for the profile's GC and aggregation dominance. The strongest source-backed path is `handleMassiveAggregate` -> `enqueueRollups` -> `rollupMinuteBars`: it performs repeated array clones, sorts, grouping, object spreads, `Date` construction, and high/low array builds on every aggregate, and the first finding shows that work can happen even when the persist sink is disabled and will drop the result. Inference: the `getRecentStockMinuteAggregateHistory` read path and quote fanout filtering add secondary allocation pressure, while the signal-options timeout path plausibly explains stale worker incidents when downstream scan cancellation is not cooperative.
