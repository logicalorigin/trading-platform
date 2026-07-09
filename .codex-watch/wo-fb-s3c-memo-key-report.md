# WO-FB-S3C memo key report

## Summary

Status: DONE.

Observed root cause: `signalMonitorStreamCompletedBarsCache` used the stream cell as the outer Map key, then compared an inner dirty key built from:

```text
signalMonitorCompletedBarsQueryTo({ timeframe, evaluatedAt }).getTime()
baseEntry?.contentStamp ?? 0
getSignalMonitorAggregateRevision(symbol)
```

The first field was clock bucket state, not completed-bar content. It can advance when the cached cell's completed-bar series has the same last bar and count, so unchanged cells missed and rebuilt.

## Key composition

Old outer key:

```text
cellKey = `${normalizeSymbol(symbol).toUpperCase()}:${timeframe}`
```

Old inner key:

```text
completedBoundaryMs:baseContentStamp:aggregateRevision
```

New outer key: unchanged `cellKey`.

New inner key:

```text
baseContentStamp:aggregateRevision:completedBars.length:latestBarTimestampMs
```

The hit path also checks stream aggregate high-water progress for the cell. If the latest possible completed bucket from aggregate progress is not newer than the cached latest bar timestamp, the cached series is current and can hit. If no aggregate progress has been recorded, it falls back to the existing serve-side bar-behind guard for correctness.

Kept invalidation fields:

- `baseContentStamp`: async backfill content identity. Stream promotion still preserves it, while backfill-sourced refreshes still bust.
- `aggregateRevision`: out-of-order completed-minute corrections still bust. The queue now passes `observedAtMs` so same-start updates after the minute is closed are treated as completed-minute corrections.
- `completedBars.length` and `latestBarTimestampMs`: the actual cached completed-bar series shape.

Removed field:

- `completedBoundaryMs` from `signalMonitorCompletedBarsQueryTo({ timeframe, evaluatedAt })`: this was per-eval/per-clock noise for unchanged cells. It is no longer part of the cache key.

Not included:

- Profile/settings identity. The completed-bar series is profile-independent in this stream path; profile settings are consumed by downstream signal evaluation caches.

## Hit/miss evidence

Targeted regression added in `signal-monitor-stream-completed-bars-cache.test.ts`:

```text
a hit holds when the clock boundary advances but stream inputs do not
first eval stats:  { size: 1, hits: 0, misses: 1 }
second eval stats: { size: 1, hits: 1, misses: 1 }
```

Genuine input-change guard still works:

```text
a new completed stream bar busts the cell (re-aggregates)
misses after first eval: 1
misses after new completed aggregate: 2
hits: 0
```

Backfill invalidation pathway remains covered by the existing test:

```text
stream-base promotion preserves cache hits while backfill refreshes bust the cell
after promotion: { size: 1, hits: 1, misses: 1 }
after backfill refresh: { size: 1, hits: 1, misses: 2 }
```

## Verification tails

Start diff stat:

```text
$ git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts
(no output)
```

Focused cache test:

```text
✔ a hit holds when the clock boundary advances but stream inputs do not (4.510175ms)
✔ a new completed stream bar busts the cell (re-aggregates) (7.549091ms)
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

Typecheck:

```text
$ pnpm --filter @workspace/api-server run typecheck
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```

Required test sweep:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts
ℹ tests 443
ℹ suites 0
ℹ pass 443
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 154855.460993
```

End diff stat:

```text
$ git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts
 .../api-server/src/services/signal-monitor.ts      | 175 ++++++++++++++++++---
 1 file changed, 150 insertions(+), 25 deletions(-)
```

## Risks

- Direct/manual stream evaluations that have no aggregate high-water record use the existing conservative bar-behind guard. That may still miss rather than hit, but avoids serving stale bars when the caller bypassed the normal aggregate queue.
- Sparse higher-timeframe input can make aggregate high-water progress overestimate that a completed output bucket may exist. This produces a conservative miss and rebuild, not a stale hit.
