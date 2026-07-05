# Pyrus Passive ELU Watch - 2026-07-02

## Scope

- Request: passive 3-minute watch for other ELU-type issues after the Checkpoint B performance fixes.
- Window: `2026-07-02T23:23:03.511Z` to `2026-07-02T23:26:05.499Z`.
- Runtime: API process pid `341187`.
- Evidence source: `.pyrus-runtime/flight-recorder/api-events-2026-07-02.jsonl`, filtered by pid and timestamp.
- Method: read-only runtime watch. No app restart, browser navigation, or synthetic traffic.

## Summary

No `flow_events` insert hotspot reappeared during the watch. The Checkpoint B duplicate-flow symptom was not observed.

Two remaining ELU/pool-pressure issues did show up:

1. Background `bar_cache` batch writes still hold DB pool slots for long periods.
2. Signal-monitor matrix SSE backpressure can accumulate `ServerResponse` listeners under slow-client/backpressure conditions.

## Observed Runtime Signals

| Signal | Observed |
| --- | --- |
| API CPU | `141.35s` CPU over `182s` wall time, about `77.7%` of one core |
| Recorder pressure | `high` before and after the window |
| ELU | `0.985` before, `0.987` after |
| Event-loop delay p95 | `266.5ms` before, `152.2ms` after |
| Total recorder events | `294` |
| Slow DB queries | `140`, about `46.2/min` |
| Slow DB pool acquires | `141`, about `46.5/min` |
| DB pool pressure events | `9`, about `3.0/min` |
| Max observed pool waiting | `15` |
| Node warnings | `4` |

## Top Remaining SQL Offenders

| Offender | Count | Rate | p95 | Max | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `insert-bar-cache` | `24` | `7.9/min` | `16204ms` | `16205ms` | Longest named DB holder in this window |
| `bar-cache-read` | `46` | `15.2/min` | `3153ms` | `5129ms` | Improved from earlier samples, but still recurring |
| `shadow-orders-read` | `20` | `6.6/min` | `3366ms` | `3507ms` | SnapTrade/shadow read path remains on the watch list |
| signal-monitor profile update | `10` | `3.3/min` | `2841ms` | `2841ms` | Background signal-monitor writes |
| `execution-events-read` | `6` | `2.0/min` | `3164ms` | `3164ms` | Smaller but still slow |

## Stored-Bar Cache State

| Counter | Start | End |
| --- | ---: | ---: |
| `maxCells` | `30000` | `30000` |
| `cellCount` | `6000` | `10000` |
| `hitCount` | `0` | `0` |
| `missCount` | `8000` | `12000` |
| `fullReadCount` | `4` | `6` |
| `evictionCount` | `0` | `0` |

Observed: the cache-cap fix stopped immediate eviction churn. `evictionCount` remained `0`.

Inferred: this sample was still mostly cold/new keys, so the cache did not yet show repeat-cycle hits. A longer watch should confirm whether `hitCount` rises once the same prefetch shape repeats.

## Signal-Monitor SSE Warning

Observed four `MaxListenersExceededWarning` events during the window:

- `11 close listeners added to [ServerResponse]`
- `11 drain listeners added to [ServerResponse]`

The stack points at `artifacts/api-server/src/routes/signal-monitor.ts:82-83`, inside the signal-monitor matrix SSE backpressure helper.

Relevant source shape:

- `res.write(chunk)` returns false.
- The helper awaits a new promise.
- Each promise attaches `res.once("drain", done)` and `res.once("close", done)`.
- Under slow-client/backpressure conditions, multiple pending writes can attach multiple listener pairs to the same response.

Inferred impact: this is a separate ELU/memory-risk issue from the DB write pressure. It may not be the main pool saturation driver, but it is real runtime evidence and should be fixed before it becomes a slow-client leak or warning spam source.

## What Was Not Observed

- No `flow_events` insert hotspot in this window.
- No stored-bar cache eviction churn after the `30000` cell cap loaded.
- No app restart or supervisor churn during this watch.

## Follow-Up Targets

1. Investigate background `insert-bar-cache` batch latency and pool occupancy. The queue reduced fanout, but individual batch upserts still held slots for about `12-16s`.
2. Harden `artifacts/api-server/src/routes/signal-monitor.ts` SSE backpressure handling so one response cannot accumulate per-write `drain` and `close` listeners.
3. Improve DB acquire-slow attribution. Most acquire-slow events still surfaced as `no-sql | null`, which limits route/background ownership analysis.
4. Re-run a longer passive watch after another signal-monitor cycle and check whether `storedBarsCache.hitCount > 0` while `evictionCount = 0`.
