# WO-FR-02 Regression Review

## Findings

### artifacts/api-server/src/services/signal-monitor.ts:9841 | P1 | hot-path regression | Stream-base promotion dirties the completed-bars cache every evaluation

Evidence:

- Observed the uncommitted diff adds `promoteSignalMonitorBackfilledBaseFromStream(...)` after `completedBars` is resolved in `evaluateSignalMonitorMatrixStateFromStreamBars` at `artifacts/api-server/src/services/signal-monitor.ts:9841`.
- Observed that the stream completed-bars cache dirty key includes `baseEntry?.refreshedAt` at `artifacts/api-server/src/services/signal-monitor.ts:9780`.
- Observed `promoteSignalMonitorBackfilledBaseFromStream` only rejects older output (`nextLatestMs < existingLatestMs`) at `artifacts/api-server/src/services/signal-monitor.ts:5396`; equal latest bars still call `rememberSignalMonitorBackfilledBaseBars`, which writes `refreshedAt: input.refreshedAtMs` at `artifacts/api-server/src/services/signal-monitor.ts:5375`.
- Observed the exact hot functions in the profile cluster are still the stream miss path: `stockMinuteAggregateToSignalMonitorBar` at `artifacts/api-server/src/services/signal-monitor.ts:4619`, `aggregateStockMinuteBarsForTimeframe` at `artifacts/api-server/src/services/signal-monitor.ts:4662`, and `loadSignalMonitorStreamSourceMinuteBars` at `artifacts/api-server/src/services/signal-monitor.ts:4899`.
- Refutation checked: the hot helper bodies themselves are not materially changed versus `HEAD`, and the default stream flush was slowed from 300 ms to 1000 ms at `artifacts/api-server/src/services/signal-monitor.ts:488`, which should reduce baseline work. The issue is not more flushes; it is that this hunk makes the cache key unstable once a backfilled base exists.

Failure scenario:

A base-backed cell evaluates at time T, misses the completed-bars cache, loads source minute bars, converts stock aggregates, aggregates the timeframe, caches the result under a dirty key containing the old base `refreshedAt`, then promotes the same completed series back into the base with `refreshedAt = T`. On the next stream flush inside the same completed-bar bucket, the only changed input can be `baseEntry.refreshedAt`, but the dirty key no longer matches, so the cell re-runs `loadSignalMonitorStreamCompletedBars -> loadSignalMonitorStreamSourceMinuteBars -> stockMinuteAggregateToSignalMonitorBar -> aggregateStockMinuteBarsForTimeframe`. Across a large live matrix this directly matches the new aggregation-cluster self-time and creates fresh arrays/maps/bar objects that can plausibly explain the GC increase.

Lazy fix:

Make stream-base promotion a no-op when the completed series has not advanced, at minimum requiring `nextLatestMs > existingLatestMs` or preserving the prior `refreshedAt` on equal-latest promotion so the dirty key stays stable inside a completed bucket.

Confidence: high.

### artifacts/api-server/src/services/signal-monitor.ts:5074 | P2 | hot-path/allocation | Gap-fill adds a second local-memory rollup on stream cache misses

Evidence:

- Observed the diff adds `loadSignalMonitorLocalMemoryGapFillBars`, which reads 1m memory bars at `artifacts/api-server/src/services/signal-monitor.ts:5080` and then calls `aggregateStockMinuteBarsForTimeframe` at `artifacts/api-server/src/services/signal-monitor.ts:5092`.
- Observed that `mergeCompletedBarsWithLocalMemoryGapFill` calls that gap-fill path at `artifacts/api-server/src/services/signal-monitor.ts:5119`, and the stream evaluation miss path now calls `mergeCompletedBarsWithLocalMemoryGapFill` at `artifacts/api-server/src/services/signal-monitor.ts:9818`.
- Observed the local memory reader materializes retained minute bars with `Array.from(...)` at `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts:894`, sorts them in `rollupMinuteBars` at `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts:805`, and the same diff increases default retention from 72h to 120h at `artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts:68`.
- Refutation checked: this is guarded by `shouldFillSignalMonitorCompletedBarsGapFromLocalMemory` at `artifacts/api-server/src/services/signal-monitor.ts:5033`; contiguous base plus live edge still takes the old merge path. By itself this is not unconditional per tick.

Failure scenario:

When the backfilled base is stale by more than one timeframe for 1m/2m/5m/15m, each affected stream cache miss reads and rolls up local 1m memory, then runs the signal-monitor aggregate rollup again before merging. If finding 1 keeps the cache miss path hot, this guarded gap-fill becomes repeat work across symbols/timeframes and adds allocation pressure from retained-memory arrays, sorted copies, grouped maps, and merged arrays.

Lazy fix:

Cache the gap-fill result by symbol/timeframe/base-latest/target/revision or repair the base off the synchronous stream path so the hot merge consumes one precomputed completed-bar array.

Confidence: medium.

### artifacts/api-server/src/services/signal-monitor.ts:10103 | P1 | correctness regression | Persist dirty key drops status and exact latest-bar changes

Evidence:

- Observed `signalMonitorMatrixStreamPersistDirtyKey` now includes only symbol, timeframe, a 5-minute `latestBarAt` bucket, `currentSignalAt`, and direction at `artifacts/api-server/src/services/signal-monitor.ts:10103`.
- Observed `status` was removed from that dirty key in the diff, and exact `latestBarAt` was replaced with `signalMonitorMatrixStreamPersistFreshnessBucket(...)` at `artifacts/api-server/src/services/signal-monitor.ts:10094`.
- Observed the new test codifies this behavior: a delta with `latestBarAt: 2026-06-09T15:01:00.000Z` and `status: "stale"` emits SSE but enqueues no persist at `artifacts/api-server/src/services/signal-monitor-stream.test.ts:384`.
- Refutation checked: the hunk is intentional write reduction, and a 5-minute heartbeat persists later at `artifacts/api-server/src/services/signal-monitor-stream.test.ts:400`. The risk is the bounded window where stored-state readers lag the live SSE status.

Failure scenario:

For up to one heartbeat bucket, the live stream can show a cell as stale while the persisted `signal_monitor_symbol_states` row still shows the previous status/actionability. Any bootstrap, REST, STA, or downstream reader that uses stored state during that window can consume wrong user-visible state even though the stream already observed the transition.

Lazy fix:

Keep the latest-bar heartbeat bucket for write volume, but put status and last-error transitions back into the persist dirty key so safety-relevant state changes persist immediately.

Confidence: medium.

## Plausibility Verdict

Verdict: high plausibility that the uncommitted diff can explain the new aggregation-cluster plus GC dominance. The strongest attribution is the stream-base promotion hunk: it mutates `baseEntry.refreshedAt`, which is part of the stream completed-bars dirty key, after every evaluation with an existing base; that plausibly turns what should be cache hits inside a completed bucket into repeated misses that execute the exact profiled functions (`loadSignalMonitorStreamSourceMinuteBars`, `stockMinuteAggregateToSignalMonitorBar`, `aggregateStockMinuteBarsForTimeframe`). The local-memory gap-fill hunk is a secondary amplifier when bases lag. Counter-evidence: the diff also slows the default stream flush from 300 ms to 1000 ms and the core aggregation helper bodies are not the changed code, so the attribution depends on the cache-miss churn being active in the live profile.

## Coverage Note

Observed `git status --porcelain -- 'artifacts/api-server/src/services/signal-monitor*'` listed modified `signal-monitor.ts`, `signal-monitor-local-bar-cache.ts`, `signal-monitor-actionability.ts`, eight modified signal-monitor test files, and untracked `signal-monitor-db-demand.test.ts`. Reviewed diffs for the changed source files and signal-monitor test files, plus the untracked test file. No tests, builds, app runs, or git state-changing commands were run per instruction. Unknown: live cache hit/miss counters and whether the profiled process had warmed backfilled bases for most cells during the captured market-hours profile.
