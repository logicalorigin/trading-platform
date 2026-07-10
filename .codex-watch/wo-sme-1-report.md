# WO-SME-1 — `/signal-monitor/events` bounded-read report

## Status

Implemented the minimum EXPLAIN-proven change in the route's service query. No migration was added or applied. No app reload/restart/signal or database write was performed.

## Which world was found

Observed live at `2026-07-10 00:50:51Z`:

- `signal_monitor_events`: **89,269 rows**, **146 MB** total; the dispatch's older 83,271-row/134-MB snapshot is no longer current.
- Planner `reltuples`: 88,152. `pg_stat_user_tables.last_analyze` and `last_autoanalyze` were null in this session, despite the current reltuples estimate.
- Canonical `shadow` rows: 56,588.
- Real main-consumer window (`now - 36h` through `now + 5m`): **4,764 rows**, so the product performs five non-synthetic pages at its 1,000-row page size.

The old **13.2 s route p95 was not reproduced as SQL execution time**. The current first-page SQL completed in 4.090 ms. The remaining defect was narrower but real: the OR-form cursor predicate did not become an index range bound. A real fifth-page cursor scanned/filter-tested rows from the top of the window. A later read-only equivalence probe timed out at 20 s during live contention, so current endpoint p95 remains unknown; this report does not infer route/pool latency from the earlier quiet EXPLAIN alone.

## Route and exact query shape

- `artifacts/api-server/src/routes/signal-monitor.ts:378-387` parses `ListSignalMonitorEventsQueryParams`, overwrites any client environment with canonical `shadow`, calls `listSignalMonitorEvents`, validates the response, and returns JSON.
- There is **no inline evaluation** on this GET. Evaluation is the separate POST route at `routes/signal-monitor.ts:162-168`.
- `artifacts/api-server/src/services/signal-monitor.ts:16767-16860` filters canonical environment plus optional symbol, inclusive `from`/`to`, and cursor.
- `services/signal-monitor.ts:15851-15901` projects exactly the 11 response fields: `id`, `profile_id`, `environment`, `symbol`, `timeframe`, `direction`, `signal_at`, `signal_price`, `close`, `emitted_at`, `source`. It does **not** read `payload`, `event_key`, or timestamps used only for persistence.
- Ordering is `signal_at DESC, id DESC`; SQL reads `limit + 1`, then the service returns at most the requested page and derives `hasMore`/`nextCursor`.
- Default page size is 100; maximum is 1,000.

## Real consumer evidence

The main PYRUS consumer is `artifacts/pyrus/src/features/platform/PlatformApp.jsx:239-287,3160-3167,3313-3331`:

- page size 1,000;
- rolling lookback 36 h and lookahead 5 min;
- follows every `nextCursor` until `hasMore` is false;
- polls while signal-monitor display work is active outside Algo/Trade screens.

Other consumers do not traverse deep pages: `SignalsScreen.jsx:3272-3315` requests one 250-row fallback page (normally disabled when PlatformApp supplies data), and `SettingsScreen.jsx:775-802` requests 20 rows and renders the recent-event count.

The accumulated main feed is folded/rendered using `id`, `symbol`, `direction`, `timeframe`, `signalAt`/`emittedAt`, `signalPrice`/`close`, while the shared store compares complete event objects. The existing 11-field response contract therefore remains unchanged.

## Live `EXPLAIN (ANALYZE, BUFFERS)`

All plans used the exact 11-column route projection, canonical `shadow`, the real 36 h/+5 min window, `ORDER BY signal_at DESC, id DESC`, and `LIMIT 1001`. The deep cursor came from the actual row at offset 3,999, not a synthetic timestamp/UUID.

### First page, current source shape

- Plan: backward scan on `signal_monitor_events_signal_at_idx` plus incremental sort.
- Index condition: the consumer `from`/`to` time window.
- Returned: 1,001 rows.
- Buffers: 3,196 shared hits.
- Rows removed by environment filter: 3,659.
- Execution: **4.090 ms**.

### Real fifth page, old OR-only cursor

- Cursor remained a filter: `signal_at < cursorAt OR (signal_at = cursorAt AND id < cursorId)`.
- Index condition contained only the broad consumer `from`/`to` window.
- Returned: 764 rows.
- Buffers: **15,084 hits + 708 reads**.
- Rows removed by filter: **23,161**.
- Execution: **63.168 ms** in this run.

### Same real cursor with the implemented range bound

- Added index condition: `signal_at <= cursorAt` while retaining the UUID tie-break OR.
- Same existing `signal_monitor_events_signal_at_idx`; no new index.
- Returned: the same 764 rows.
- Buffers: **2,218 shared hits** (7.1x fewer total buffers than the measured OR-only plan).
- Rows removed by filter: 2,472.
- Execution: **2.856 ms** in this run.

Timing comparisons are cache/load sensitive; the buffer reduction and the moved `signal_at <= cursorAt` condition in the index scan are the plan-level proof. A composite route index would add write cost to this firehose table while the existing index already serves the corrected query in low single-digit milliseconds, so no manual-apply migration is justified.

## Change and response identity

`artifacts/api-server/src/services/signal-monitor.ts` now adds the cursor timestamp as an explicit `lte(signal_at, cursor.signalAt)` condition before the unchanged OR tie-break.

This is byte-preserving for identical data and parameters:

- the existing OR predicate already implies `signal_at <= cursorAt`;
- selected rows, ordering, page size, `hasMore`, cursor encoding, fallback behavior, and all projected fields are unchanged;
- no default server window was added, because that would change responses for the one-page callers that omit `from`/`to`.

## Regression and validation

Regression added to `artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts` using the suite's existing source-shape style. It locks:

- the exact 11-column payload-free projection;
- caller `from`/`to` bounds;
- `limit + 1` pagination;
- the explicit cursor timestamp range bound before the UUID tie-break OR.

TDD evidence:

- Before service edit: targeted regression **0 pass / 1 fail** (missing cursor range bound).
- After service edit: targeted regression **1 pass / 0 fail**.

Mandated validations:

1. `pnpm --filter @workspace/api-server run typecheck`
   - first attempt: exit 75 shared validation lock; waited 30 s as directed;
   - retry reached an unrelated, concurrently-created untracked IBKR websocket test error;
   - final retry after that work settled: **EXIT 0**.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/signal-monitor*.test.ts`
   - exact live environment (`PYRUS_SIGNALS_INCREMENTAL_EVAL=shadow`): **242 pass / 1 fail**; the only failure expected mode `off` while the process environment supplied `shadow`; this query regression passed;
   - controlled subprocess with only that flag unset (no Replit environment mutation): **219 pass / 0 fail**.

No target-file conflicts were observed. Unrelated IBKR worktree changes were preserved and excluded from the commit.
