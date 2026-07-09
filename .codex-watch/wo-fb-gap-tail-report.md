# WO-FB-GAP-TAIL Report

## Design Implemented

- Detection: `signal-monitor.ts` now builds a gap-fetch candidate only after the normal base/live merge plus Stage 2 local-memory fill still leaves a timestamp hole in the merged eval input, or the merged input ends before the current completed target.
- Window math: the candidate records the exact missing `(symbol, timeframe, from..to)` span closest to the live/recent edge. `from = left edge + timeframe`; `to = right edge` for an internal hole, or latest completed target when the series ends stale. The fetch limit is `min(240, eval limit, bars in window)`.
- Fetch path: durable reads use `loadStoredMarketBars` with projected columns, `from`, `to`, `recentWindowMinutes: 0`, and a new optional `order: "desc"` so the bounded query returns the newest useful bars inside the exact window. Results merge by timestamp and promote into `signalMonitorBackfilledBaseByCell`; no fetched bars are kept in a separate long-lived cache.
- Budget: `SIGNAL_MONITOR_GAP_FETCH_MAX_CELLS_PER_CYCLE = 8`, `SIGNAL_MONITOR_GAP_FETCH_DRAIN_INTERVAL_MS = 1000`, `SIGNAL_MONITOR_GAP_FETCH_MAX_BARS = 240`, retry throttle `5m` per same cell/window. With two `storeSourceNames()` sources, worst sustained rate is 8 cells/sec * 2 source reads = 16 durable bar-cache reads/sec, still under the shared background DB gate.
- Hot path: evaluation only enqueues candidates. It does not await the durable read. While a gap candidate exists, the gapped eval input is not stream-promoted or cached; the later durable promotion changes the base content stamp and the next tick recomputes.

## Changed Files

- `artifacts/api-server/src/services/market-data-store.ts:496` adds optional descending order for the existing narrow stored-bar reader.
- `artifacts/api-server/src/services/signal-monitor.ts:5021` adds gap-fetch constants and candidate types.
- `artifacts/api-server/src/services/signal-monitor.ts:5174` detects remaining merged-series holes after memory gap fill.
- `artifacts/api-server/src/services/signal-monitor.ts:5528` loads bounded durable gap bars through the existing projected reader.
- `artifacts/api-server/src/services/signal-monitor.ts:5583` queues candidates with retry throttling.
- `artifacts/api-server/src/services/signal-monitor.ts:5609` processes async fetches and promotes fetched bars into the backfilled base.
- `artifacts/api-server/src/services/signal-monitor.ts:10455` wires candidate enqueue into stream evaluation without awaiting it.
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts:563` adds fetched-gap identity coverage for 1m.
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts:632` adds fetched-gap identity coverage for 1h.
- `artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts:694` adds no-gap coverage proving fetch is not queued.

## Verification

`pnpm --filter @workspace/api-server run typecheck` exit 0 tail:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```

`pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts` exit 0 tail:

```text
ℹ tests 445
ℹ suites 0
ℹ pass 445
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 154926.643865
```

Focused new-test run exit 0 included:

```text
✔ stale backfilled base gap is filled from durable history without changing signal output
✔ stale 1h backfilled base gap is filled from durable history without changing signal output
✔ contiguous base plus live edge is unchanged and never queues durable gap fetch
```

## Diff Stat

Start service-file `git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/market-data-store.ts`: no output.

End service-file `git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/market-data-store.ts`:

```text
 .../api-server/src/services/market-data-store.ts   |   7 +-
 .../api-server/src/services/signal-monitor.ts      | 535 +++++++++++++++++++--
 2 files changed, 511 insertions(+), 31 deletions(-)
```

End full touched-files stat:

```text
 .../api-server/src/services/market-data-store.ts   |   7 +-
 ...nal-monitor-stream-completed-bars-cache.test.ts | 224 ++++++++-
 .../api-server/src/services/signal-monitor.ts      | 535 +++++++++++++++++++--
 3 files changed, 733 insertions(+), 33 deletions(-)
```

## Risks

- Normal market-session timestamp gaps can still produce candidates if they appear in the limited eval input; the 8-cell/sec cap, 240-bar window, and 5-minute same-window throttle bound the cost.
- The default durable loader reads both configured stored sources for parity with existing stored-bar merge behavior, so the read-rate math assumes two sources.
