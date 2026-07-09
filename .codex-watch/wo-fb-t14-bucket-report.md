# WO-FB-T14 Bucket Report

## Option chosen

Chosen: **(a) direct O(tail) derivation from the ring tail**.

Why: this is the smaller diff and avoids adding a producer-maintained per-(symbol,timeframe) cache with new invalidation/state risks. The implementation keeps the existing bounded source-minute ring read and memo path, then walks newest-to-oldest only until it proves the latest completed bucket. It removes the per-state-row full timeframe aggregation path through `aggregateStockMinuteBarsForTimeframe`.

## Semantics preservation

- `1d` remains `null`.
- Source data still comes through `loadSignalMonitorStreamSourceMinuteBars`, preserving the existing symbol normalization, history/current merge, source-minute memo, history-limit window, and aggregate revision dirtying.
- `1m` walks backward and accepts only bars with `partial !== true` and `isSignalMonitorBarComplete({ timeframe: "1m" })`; it returns the same `dataUpdatedAt ?? timestamp` close used by the old path.
- Higher timeframes walk backward by bucket, count distinct completed 1m child buckets for only the active tail bucket, require the full child count, and then call `isSignalMonitorBarComplete` on the aggregate bucket start/end before returning the bucket end. This matches the old non-provisional aggregate bar `dataUpdatedAt = bucketEndMs`.
- Delayed metadata is not treated as a separate completion rule because the current implementation does not do that; delayed/future-close/provisional tail bars are excluded by the same `isSignalMonitorBarComplete` dataUpdatedAt rule.

## Parity coverage

Added a parity test comparing the new tail helper with an inline old aggregation derivation over:

- Empty ring.
- Mid-bucket live edge.
- Delayed/provisional future-close tail bars.
- Exact bucket boundary.
- Gapped tail.
- Additional 1m provisional-tail case for the separate 1m branch.

RED check before implementation:

```text
TypeError: laneLatestCompletedBarAtFromTail is not a function
```

Focused GREEN check:

```text
✔ tail latest-completed derivation matches the aggregation path (3.587945ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

## What changed

- `artifacts/api-server/src/services/signal-monitor.ts:5013` extracts the source-minute history-limit calculation shared by the old loader and the new tail path.
- `artifacts/api-server/src/services/signal-monitor.ts:5309` adds `signalMonitorStreamLaneLatestCompletedBarAtFromTail`.
- `artifacts/api-server/src/services/signal-monitor.ts:5412` changes `signalMonitorStreamLaneLatestCompletedBarAt` to delegate to the tail derivation.
- `artifacts/api-server/src/services/signal-monitor.ts:14994` exposes the tail helper to tests.
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts:44` adds reset/old-path fixture helpers.
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts:453` adds the parity test.

## Verification

Typecheck:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit

exit 0
```

Signal monitor/options tests:

```text
ℹ tests 446
ℹ suites 0
ℹ pass 446
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 175052.885447

exit 0
```

## Diff stat

Start:

```text
git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts
# no output
```

End:

```text
.../api-server/src/services/signal-monitor.ts      | 125 ++++++++++++++++++---
1 file changed, 109 insertions(+), 16 deletions(-)
```

## Risks / follow-up

- CPU profile was not run in this headless work order. Orchestrator should re-profile with `scripts/diag/cpu-profile-running-api.mjs` and confirm `signalMonitorStreamLaneLatestCompletedBarAt` stack-inclusive share is below 3%.
- The existing source-minute ring load remains; this slice removes the full timeframe bucket materialization from the hot state-read path.
