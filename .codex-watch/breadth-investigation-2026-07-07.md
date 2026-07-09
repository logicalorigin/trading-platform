# Breadth Investigation - 2026-07-07

Investigator: `codex-worker`  
Scope: read-only investigation of current working tree and dev Postgres. No app restarts, no writes except this report.

## Semantics

Observed implementation: the Signals page "Breadth" selector is a **history range selector**, not a signal timeframe selector.

- UI labels are `1H`, `1D`, `1W`, `1M`, mapped from `hour`, `day`, `week`, `month` in `artifacts/pyrus/src/screens/SignalsScreen.jsx:1182`.
- The button group iterates `SIGNALS_BREADTH_HISTORY_RANGES` and calls `onRangeChange(option)` in `artifacts/pyrus/src/screens/SignalsScreen.jsx:1280`-`1294`.
- Valid range values are `["hour", "day", "week", "month"]` in `artifacts/pyrus/src/features/signals/signalsRowModel.js:1441`-`1446`.
- The selected range is stored as `breadthHistoryRange`, default `"day"`, in `artifacts/pyrus/src/screens/SignalsScreen.jsx:3369`.
- The request params are `{ environment, range: breadthHistoryRange }` in `artifacts/pyrus/src/screens/SignalsScreen.jsx:3417`-`3419`.

Backend semantics:

- `SignalMonitorBreadthHistoryRange = "hour" | "day" | "week" | "month"` in `artifacts/api-server/src/services/signal-monitor.ts:109`.
- Bucket sizes are `hour=2m`, `day=15m`, `week=120m`, `month=1440m` in `artifacts/api-server/src/services/signal-monitor.ts:1484`-`1494`.
- Window resolution: `hour = now - 1h`; `day = start of current America/New_York market date`; `week = now - 7 days`; `month = now - 30 days` in `artifacts/api-server/src/services/signal-monitor.ts:1730`-`1755`.
- Formula, snapshot path: recorded standing breadth counts active state rows by `current_signal_direction`, per timeframe and aggregate `all`; see `recordSignalMonitorBreadthSnapshot` in `artifacts/api-server/src/services/signal-monitor.ts:2604`-`2685`.
- Formula, event fallback path: replay buy/sell flip events and seeds to maintain standing direction per `symbol+timeframe`; aggregate uses latest direction per symbol across timeframes; see `buildSignalMonitorBreadthHistoryResponse` in `artifacts/api-server/src/services/signal-monitor.ts:1768`-`1920`.

Exact formula:

- Per-timeframe breadth point: `buy = count(active symbol-state cells or replayed cells where direction='buy')`, `sell = count(... direction='sell')`, `net = buy - sell`, `total = buy + sell`.
- Aggregate breadth point (`timeframe='all'` snapshots / top-level `points` response): one direction per symbol, chosen from the latest signal across that symbol's timeframes; then same `buy/sell/net/total` formula.
- The UI renders current summary `buy/sell` from the state summary, and the sparkline from `breadthHistory.points`; `CompactSignalBreadthPanel` computes `advancingPct = buy / (buy + sell)` in `artifacts/pyrus/src/screens/SignalsScreen.jsx:1201`-`1208`.

## Data Path

UI to API:

1. `SignalsScreen` state defaults to `breadthHistoryRange = "day"`: `artifacts/pyrus/src/screens/SignalsScreen.jsx:3369`.
2. Params are built as `{ environment, range: breadthHistoryRange }`: `artifacts/pyrus/src/screens/SignalsScreen.jsx:3417`-`3419`.
3. React query call: `useListSignalMonitorBreadthHistory(signalMonitorBreadthHistoryParams, ...)`: `artifacts/pyrus/src/screens/SignalsScreen.jsx:3459`-`3468`.
4. Generated client serializes params to `/api/signal-monitor/breadth-history?range=...`: `lib/api-client-react/src/generated/api.ts:10205`-`10222`.
5. Zod allows `environment` and `range` enum values: `lib/api-zod/src/generated/api.ts:5562`-`5565`.
6. Express route parses query, then calls `listSignalMonitorBreadthHistory`; note it overrides `environment` with `resolveSignalSourceEnvironment()`: `artifacts/api-server/src/routes/signal-monitor.ts:305`-`314`.

Backend route to SQL:

1. `listSignalMonitorBreadthHistory` resolves `environment` and window: `artifacts/api-server/src/services/signal-monitor.ts:14192`-`14201`.
2. It first reads `signal_monitor_breadth_snapshots` for `environment` and `captured_at BETWEEN window.from AND window.to`: `artifacts/api-server/src/services/signal-monitor.ts:14213`-`14229`.
3. It trusts snapshots only if `earliestSnapshot <= window.from + 2 * bucketMinutes`: `artifacts/api-server/src/services/signal-monitor.ts:14239`-`14249`.
4. If snapshots do not cover the window start, it falls back to event replay:
   - Seed SQL from `signal_monitor_events` before `window.from`: `artifacts/api-server/src/services/signal-monitor.ts:14252`-`14264`.
   - Window event query from `signal_monitor_events` inside the window: `artifacts/api-server/src/services/signal-monitor.ts:14266`-`14281`.
   - Response builder: `artifacts/api-server/src/services/signal-monitor.ts:14283`.

Schema:

- `signal_monitor_symbol_states`: state table, unique `(profile_id, symbol, timeframe)`: `lib/db/src/schema/signal-monitor.ts:45`-`103`.
- `signal_monitor_events`: event table, unique `event_key`: `lib/db/src/schema/signal-monitor.ts:106`-`143`.
- `signal_monitor_breadth_snapshots`: forward cache of standing breadth, indexed by `(environment, captured_at)` and `(environment, timeframe, captured_at)`: `lib/db/src/schema/signal-monitor.ts:146`-`172`.

## DB Ground Truth

DB query setup: all DB probes used `BEGIN READ ONLY`. I did not print credentials.

Database clock:

```sql
BEGIN READ ONLY;
SELECT current_database() AS db, current_user AS db_user, now() AS db_now;
COMMIT;
```

Observed:

```text
db=heliumdb, db_user=postgres, db_now=2026-07-07 15:20:51.585458+00
```

Snapshot distribution:

```sql
SELECT environment, timeframe, count(*)::int AS rows,
       min(captured_at), max(captured_at), min(total), max(total)
FROM signal_monitor_breadth_snapshots
GROUP BY 1,2
ORDER BY 1,2;
```

Observed shadow rows:

```text
shadow 15m rows=4737 min=2026-06-14 16:34:30.47+00 max=2026-07-07 15:18:20.176+00 max_total=2699
shadow 1d  rows=4737 min=2026-06-14 16:34:30.47+00 max=2026-07-07 15:18:20.176+00 max_total=1050
shadow 1h  rows=4737 min=2026-06-14 16:34:30.47+00 max=2026-07-07 15:18:20.176+00 max_total=1301
shadow 1m  rows=4737 min=2026-06-14 16:34:30.47+00 max=2026-07-07 15:18:20.176+00 max_total=3472
shadow 2m  rows=4737 min=2026-06-14 16:34:30.47+00 max=2026-07-07 15:18:20.176+00 max_total=3126
shadow 5m  rows=4737 min=2026-06-14 16:34:30.47+00 max=2026-07-07 15:18:20.176+00 max_total=3045
shadow all rows=4737 min=2026-06-14 16:34:30.47+00 max=2026-07-07 15:18:20.176+00 max_total=3474
```

Snapshot coverage by UI range:

```sql
WITH windows(range, from_at, to_at, bucket_minutes) AS (
  VALUES
    ('hour', now() - interval '1 hour', now(), 2),
    ('day', (date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York'), now(), 15),
    ('week', now() - interval '7 days', now(), 120),
    ('month', now() - interval '30 days', now(), 1440)
)
SELECT w.range, count(b.*)::int AS snapshot_rows, min(b.captured_at) AS earliest_snapshot,
       max(b.captured_at) AS latest_snapshot,
       min(b.captured_at) <= w.from_at + (w.bucket_minutes * interval '1 minute' * 2) AS snapshots_cover_window
FROM windows w
LEFT JOIN signal_monitor_breadth_snapshots b
  ON b.environment='shadow'
 AND b.captured_at >= w.from_at
 AND b.captured_at <= w.to_at
GROUP BY w.range,w.from_at,w.to_at,w.bucket_minutes;
```

Observed:

```text
hour  snapshot_rows=77    earliest=2026-07-07 14:22:58.356+00 latest=2026-07-07 15:18:20.176+00 cover=true
day   snapshot_rows=721   earliest=2026-07-07 04:02:47.485+00 latest=2026-07-07 15:18:20.176+00 cover=true
week  snapshot_rows=11207 earliest=2026-07-01 18:21:14.31+00  latest=2026-07-07 15:18:20.176+00 cover=false
month snapshot_rows=33159 earliest=2026-06-14 16:34:30.47+00  latest=2026-07-07 15:18:20.176+00 cover=false
```

Current shadow snapshot totals:

```sql
SELECT DISTINCT ON (environment,timeframe)
  environment,timeframe,captured_at,buy,sell,total
FROM signal_monitor_breadth_snapshots
WHERE environment='shadow'
ORDER BY environment,timeframe,captured_at DESC;
```

Observed latest shadow:

```text
15m buy=2175 sell=524  total=2699
1d  buy=657  sell=393  total=1050
1h  buy=777  sell=524  total=1301
1m  buy=1828 sell=1594 total=3422
2m  buy=2491 sell=635  total=3126
5m  buy=2519 sell=526  total=3045
all buy=1902 sell=1562 total=3464
```

Event distribution exists for all signal timeframes, but it is sparse/incomplete versus state:

```sql
SELECT environment, timeframe, direction, count(*)::int, min(signal_at), max(signal_at)
FROM signal_monitor_events
GROUP BY 1,2,3
ORDER BY 1,2,3;
```

Observed shadow examples:

```text
shadow 1d buy=143 sell=132 max_signal_at=2026-07-06 00:00:00+00
shadow 1h buy=429 sell=582 max_signal_at=2026-07-07 14:00:00+00
shadow 1m buy=10020 sell=9370 max_signal_at=2026-07-07 15:10/13:50+00
shadow 2m buy=4574 sell=4055 max_signal_at=2026-07-07 13:50/15:14+00
shadow 5m buy=6437 sell=6006 max_signal_at=2026-07-07 13:45/15:15+00
shadow 15m buy=1474 sell=1194 max_signal_at=2026-07-07 13:45/14:45+00
```

Active state versus latest event anchor coverage:

```sql
WITH active_cells AS (
  SELECT s.profile_id, s.symbol, s.timeframe,
         s.current_signal_direction AS state_direction, s.current_signal_at
  FROM signal_monitor_symbol_states s
  JOIN signal_monitor_profiles p ON s.profile_id=p.id
  WHERE p.environment='shadow'
    AND p.enabled=true
    AND s.active=true
    AND s.current_signal_direction IN ('buy','sell')
),
latest_events AS (
  SELECT DISTINCT ON (e.profile_id,e.symbol,e.timeframe)
    e.profile_id,e.symbol,e.timeframe,e.direction,e.signal_at
  FROM signal_monitor_events e
  JOIN signal_monitor_profiles p ON e.profile_id=p.id
  WHERE e.environment='shadow'
    AND p.environment='shadow'
    AND p.enabled=true
    AND e.direction IN ('buy','sell')
  ORDER BY e.profile_id,e.symbol,e.timeframe,e.signal_at DESC
)
SELECT ac.timeframe, count(*)::int AS active_cells,
       count(le.*)::int AS cells_with_event,
       count(*) FILTER (WHERE le.symbol IS NULL)::int AS cells_missing_event,
       count(*) FILTER (WHERE le.symbol IS NOT NULL AND le.direction <> ac.state_direction)::int AS direction_mismatch
FROM active_cells ac
LEFT JOIN latest_events le
  ON le.profile_id=ac.profile_id AND le.symbol=ac.symbol AND le.timeframe=ac.timeframe
GROUP BY ac.timeframe;
```

Observed:

```text
15m active=2699 with_event=563  missing=2136 mismatch=152
1d  active=1050 with_event=241  missing=809  mismatch=1
1h  active=1301 with_event=436  missing=865  mismatch=65
1m  active=3422 with_event=1143 missing=2279 mismatch=477
2m  active=3126 with_event=748  missing=2378 mismatch=269
5m  active=3096 with_event=644  missing=2452 mismatch=222
```

Sample mismatches/missing anchors:

```text
15m ACM state=buy current_signal_at=2026-06-26 19:45:00+00 latest_event=NULL reason=missing_event_anchor
15m A   state=sell current_signal_at=2026-06-30 13:30:00+00 latest_event=buy@2026-06-24 14:30:00+00 reason=latest_direction_mismatch
```

Conclusion: non-1d signal timeframe data does exist. The storage problem is not "only 1d rows exist." The verified storage problem is that the durable event log does not anchor many current state cells, and the breadth reader falls back to that incomplete log for ranges whose snapshot coverage does not span the window start.

## Freshness

Code rule:

- Profile has `fresh_window_bars`, default 3 in schema: `lib/db/src/schema/signal-monitor.ts:31`.
- Signal freshness is bar-based: `signalMonitorFresh` uses `barsSinceSignal <= freshWindowBars`, referenced from `artifacts/api-server/src/services/signal-monitor.ts:7484`, `8164`, and `8499`.
- `shouldPersistCanonicalSignalMonitorEvent` only persists canonical events when `fresh=true`, `barsSinceSignal <= freshWindowBars`, source bar is not partial, source bar is trusted, and lag is nonnegative: `artifacts/api-server/src/services/signal-monitor.ts:6280`-`6299`.
- Stored state latch deliberately preserves direction when no new signal arrives and forces `fresh:false`: `artifacts/api-server/src/services/signal-monitor.ts:6318`-`6415`.
- Daily bar aging is explicitly timeframe-aware and uses trading weekdays, not wall-clock days: `artifacts/api-server/src/services/signal-monitor.ts:7644`-`7700`.

Where freshness is enforced:

- Writer/state path: state rows store `fresh` and `bars_since_signal`.
- UI path: overview renders fresh/aged counts, but breadth itself is not filtered by freshness.
- Breadth reader path: `recordSignalMonitorBreadthSnapshot` filters active buy/sell state rows only, not `fresh`: `artifacts/api-server/src/services/signal-monitor.ts:2619`-`2626`. Event replay filters `direction IN ('buy','sell')`, not freshness: `artifacts/api-server/src/services/signal-monitor.ts:14255`-`14281`.

DB counts outside freshness window:

```sql
SELECT p.environment, s.timeframe, p.fresh_window_bars,
       count(*) FILTER (WHERE s.current_signal_direction IN ('buy','sell'))::int AS directional,
       count(*) FILTER (WHERE s.current_signal_direction IN ('buy','sell') AND s.fresh=true)::int AS fresh_true,
       count(*) FILTER (WHERE s.current_signal_direction IN ('buy','sell') AND (s.bars_since_signal IS NULL OR s.bars_since_signal > p.fresh_window_bars))::int AS outside_bar_window
FROM signal_monitor_symbol_states s
JOIN signal_monitor_profiles p ON p.id=s.profile_id
WHERE p.enabled=true AND s.active=true
GROUP BY 1,2,3
ORDER BY 1,2;
```

Observed shadow:

```text
shadow fresh_window_bars=8
15m directional=2699 fresh_true=49 outside_bar_window=1064
1d  directional=1050 fresh_true=57 outside_bar_window=938
1h  directional=1301 fresh_true=21 outside_bar_window=1123
1m  directional=3422 fresh_true=7  outside_bar_window=2861
2m  directional=3126 fresh_true=0  outside_bar_window=1059
5m  directional=3096 fresh_true=2  outside_bar_window=1028
```

Freshness hypothesis result:

- Refuted as the direct breadth root cause. Breadth intentionally includes aged directional state; it is standing breadth, not only fresh-signal breadth.
- Freshness is timeframe-aware in the bar-age code, including a daily-specific branch.
- However, freshness indirectly contributes to event sparsity: canonical event persistence is limited to fresh incremental signals (`shouldPersistCanonicalSignalMonitorEvent`), while standing state persists and latches beyond freshness. That creates state/event divergence unless every latched state identity has an event anchor.

Expected behavior today:

- Code intent: out-of-freshness directional signals stay in breadth as aged standing direction; UI separately marks fresh/aged counts.
- Actual: snapshot-backed `hour/day` ranges include aged standing directions correctly. Event-replay-backed `week/month` ranges can undercount or misclassify aged standing directions because the event log lacks anchors for many latched state rows.

## Root Cause (Verified vs Unverified)

Verified:

1. `1D` works because snapshots cover the `day` window start. DB coverage query shows `day snapshots_cover_window=true`.
2. `1W` and `1M` are wrong because snapshots do not cover their window starts. DB coverage query shows `week=false` and `month=false`, so `listSignalMonitorBreadthHistory` falls back to event replay by code at `artifacts/api-server/src/services/signal-monitor.ts:14239`-`14283`.
3. The fallback event replay is not a faithful reconstruction of standing breadth because `signal_monitor_events` is missing/mismatched latest anchors for many active state cells. DB anchor coverage shows, for shadow, `1d missing=809/1050`, `1m missing=2279/3422`, `5m missing=2452/3096`, etc.
4. The event anchor gap is a storage/read-model mismatch:
   - State table is the live standing direction source and is unique per `(profile_id, symbol, timeframe)` (`lib/db/src/schema/signal-monitor.ts:45`-`103`).
   - Events are sparse canonical signals and only persist under the fresh canonical event gate (`artifacts/api-server/src/services/signal-monitor.ts:6280`-`6315`).
   - The state latch preserves prior signal identity across no-signal evaluations (`artifacts/api-server/src/services/signal-monitor.ts:6318`-`6415`).
   - `resolveStoredSignalMonitorSignalAt` returns `input.signalAt` even when no matching event row exists (`artifacts/api-server/src/services/signal-monitor.ts:6704`-`6749`), allowing state identities that have no event anchor.
   - Existing code already includes `buildSignalMonitorEventAnchorBackfillPlan` to create `state-anchor-backfill` event rows for exactly `missing_event_anchor` and `latest_direction_mismatch`: `artifacts/api-server/src/services/signal-monitor.ts:2143`-`2365`, with a CLI wrapper in `scripts/src/signal-monitor-event-anchor-plan.ts:1`-`139`.

Unverified / nuance:

- `1H`: current DB coverage shows `hour snapshots_cover_window=true`, so as of `2026-07-07 15:21Z` the `1H` range should use snapshots and should not hit the broken event fallback. If the product owner saw `1H` broken in the app built around `15:08Z`, that may have been transient snapshot coverage/timing, a frontend rendering issue, or a different interpretation of "other selections." I did not perform browser QA or live API curl because the investigation was source/SQL sufficient and read-only.
- Historical pre-snapshot truth for `1M` before `2026-06-14` cannot be fully reconstructed from current DB if event anchors were never written. A one-time state-anchor backfill fixes current/future standing breadth and improves fallback, but cannot recreate every past flip that was never stored.

Classification:

- Primary bug type: STORAGE/read-model bug in `signal_monitor_events` completeness relative to `signal_monitor_symbol_states`.
- Triggering reader behavior: READ/QUERY fallback bug/fragility in `listSignalMonitorBreadthHistory`: when snapshot coverage is partial, it abandons snapshots and trusts the incomplete event log.
- UI bug: not verified. UI sends valid `range` values and the API supports them.

## Proposed Diff

Do not apply this blindly without product/eng review. It is the minimal root-cause direction I would implement:

1. Make state reconciliation also repair event anchors by applying the existing backfill helper after state reconciliation.
2. Prefer snapshot data when snapshots exist, even if they start after the requested long-range window, because snapshots are exact standing breadth while event reconstruction is known-incomplete until anchors are backfilled. This prevents a partial snapshot gap from forcing the UI onto the broken event path.
3. Add tests for both behaviors.

```diff
diff --git a/artifacts/api-server/src/services/signal-monitor.ts b/artifacts/api-server/src/services/signal-monitor.ts
--- a/artifacts/api-server/src/services/signal-monitor.ts
+++ b/artifacts/api-server/src/services/signal-monitor.ts
@@
 export async function listSignalMonitorBreadthHistory(input: {
   environment?: RuntimeMode;
   range?: SignalMonitorBreadthHistoryRange;
   now?: Date;
 }) {
@@
-    // Only trust snapshots when they actually span the window start; otherwise
-    // (e.g. a long range still mostly older than recording) reconstruct so the
-    // deep history isn't flat-filled.
+    // Prefer exact standing-breadth snapshots whenever present. The event log is
+    // sparse by design and may not contain state anchors for latched cells; using
+    // it for long ranges can undercount breadth badly. If snapshots start after
+    // the requested window, buildSignalMonitorBreadthFromSnapshots carries the
+    // earliest exact point backward rather than switching to incomplete replay.
     const earliestSnapshotMs = snapshotRows.length
       ? dateOrNull(snapshotRows[0].capturedAt)?.getTime() ?? null
       : null;
     const snapshotsCoverWindow =
       earliestSnapshotMs != null &&
       earliestSnapshotMs <= window.from.getTime() + window.bucketMinutes * 60_000 * 2;
-    if (snapshotsCoverWindow) {
+    if (snapshotRows.length > 0) {
       return buildSignalMonitorBreadthFromSnapshots(snapshotRows, window);
     }
 
diff --git a/artifacts/api-server/src/services/signal-monitor.ts b/artifacts/api-server/src/services/signal-monitor.ts
--- a/artifacts/api-server/src/services/signal-monitor.ts
+++ b/artifacts/api-server/src/services/signal-monitor.ts
@@
 export type SignalMonitorStateReconciliationCounts = {
   profileId: string;
   identityAdopted: number;
   signalCloseBackfilled: number;
   filterStateBackfilled: number;
   latestCloseBackfilled: number;
   latestBarAdvanced: number;
   untrustedIdentityCleared: number;
   barsRecomputed: number;
   freshCleared: number;
+  eventAnchorsInserted: number;
 };
@@
-  return {
+  const eventAnchorBackfill = dryRun
+    ? { applied: { insertedEvents: 0 } }
+    : await buildSignalMonitorEventAnchorBackfillPlan({
+        environment: profile.environment,
+        candidateLimit: 10_000,
+        apply: true,
+      });
+
+  return {
     profileId: profile.id,
     identityAdopted,
     signalCloseBackfilled,
     filterStateBackfilled,
     latestCloseBackfilled,
     latestBarAdvanced,
     untrustedIdentityCleared,
     barsRecomputed,
     freshCleared,
+    eventAnchorsInserted: eventAnchorBackfill.applied.insertedEvents,
   };
 }
```

Test additions:

```diff
diff --git a/artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts b/artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts
--- a/artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts
+++ b/artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts
@@
+test("state reconciliation inserts event anchors for active latched cells", async () => {
+  // Seed active signal_monitor_symbol_states rows whose latest signal identity
+  // has no matching signal_monitor_events row.
+  // Run reconcileSignalMonitorSymbolStatesFromCanonicalEvents({ dryRun: false }).
+  // Assert signal_monitor_events contains state-anchor-backfill rows for each
+  // active buy/sell cell and that a second run is idempotent.
+});
+
+test("breadth history uses available snapshots instead of incomplete event replay", async () => {
+  // Seed snapshots that start after the requested week/month window start.
+  // Seed an intentionally incomplete signal_monitor_events table.
+  // Assert listSignalMonitorBreadthHistory({ range: 'week' }) returns snapshot
+  // totals, not event-replay undercounts.
+});
```

Why this is root-cause oriented:

- The storage consistency fix makes `signal_monitor_events` contain anchors for state identities that breadth fallback and parity tools need.
- The reader fix removes the immediate bad branch: exact snapshots should not be discarded in favor of a known-incomplete replay source.

Risk:

- The snapshot preference can flat-fill the leading part of a long range when snapshots begin after `window.from`. That is less historically pure than perfect replay, but it is bounded and based on exact standing-breadth rows. Once event anchors are backfilled and snapshot retention is sufficient, the fallback should rarely matter.

## Backfill

Do not run during read-only investigation.

Existing dry-run/write CLI:

```bash
pnpm --filter @workspace/scripts run signal-monitor:event-anchor-plan -- --environment=shadow --candidate-limit=10000 --json
pnpm --filter @workspace/scripts run signal-monitor:event-anchor-plan -- --environment=shadow --candidate-limit=10000 --write --confirm-write
```

Exact SQL equivalent for a one-time backfill, if doing it manually instead of the existing script:

```sql
BEGIN;

WITH active_cells AS (
  SELECT
    p.id AS profile_id,
    p.environment,
    s.id AS state_id,
    s.symbol,
    s.timeframe,
    s.current_signal_direction AS direction,
    s.current_signal_at AS signal_at,
    s.current_signal_price AS signal_price,
    s.current_signal_close AS close,
    s.filter_state,
    latest_events.direction AS latest_event_direction,
    latest_events.signal_at AS latest_event_at
  FROM signal_monitor_symbol_states s
  JOIN signal_monitor_profiles p ON s.profile_id = p.id
  LEFT JOIN LATERAL (
    SELECT e.direction, e.signal_at
    FROM signal_monitor_events e
    WHERE e.profile_id = p.id
      AND e.environment = p.environment
      AND e.symbol = s.symbol
      AND e.timeframe = s.timeframe
      AND e.direction IN ('buy', 'sell')
    ORDER BY e.signal_at DESC
    LIMIT 1
  ) latest_events ON true
  WHERE p.environment = 'shadow'
    AND p.enabled = true
    AND s.active = true
    AND s.current_signal_direction IN ('buy','sell')
    AND s.current_signal_at IS NOT NULL
    AND (
      latest_events.direction IS NULL
      OR latest_events.direction <> s.current_signal_direction
    )
),
inserted AS (
  INSERT INTO signal_monitor_events (
    profile_id, event_key, environment, symbol, timeframe, direction,
    signal_at, signal_price, close, source, payload, emitted_at
  )
  SELECT
    profile_id,
    concat('state-anchor:', profile_id, ':', symbol, ':', timeframe, ':', signal_at::text, ':', direction),
    environment,
    symbol,
    timeframe,
    direction,
    signal_at,
    signal_price,
    close,
    'state-anchor-backfill',
    jsonb_build_object(
      'stateAnchorBackfill',
      jsonb_build_object(
        'reason', CASE WHEN latest_event_direction IS NULL THEN 'missing_event_anchor' ELSE 'latest_direction_mismatch' END,
        'stateId', state_id,
        'latestEventDirection', latest_event_direction,
        'latestEventAt', latest_event_at,
        'plannedAt', now()
      ),
      'filterState', filter_state
    ),
    signal_at
  FROM active_cells
  ON CONFLICT (event_key) DO NOTHING
  RETURNING id
)
SELECT count(*) AS inserted_event_anchors FROM inserted;

COMMIT;
```

Backfill need:

- Yes. Current dev DB has verified missing/mismatched event anchors for active shadow cells:
  - `15m`: missing 2136, mismatch 152
  - `1d`: missing 809, mismatch 1
  - `1h`: missing 865, mismatch 65
  - `1m`: missing 2279, mismatch 477
  - `2m`: missing 2378, mismatch 269
  - `5m`: missing 2452, mismatch 222

## Test Plan

Targeted backend tests:

- Add/extend tests in `artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts`, which already covers breadth parity and event anchors around `artifacts/api-server/src/services/signal-monitor-reconcile-minimal-readset.test.ts:698` and related tests.
- Add a regression in `artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts` or a new `signal-monitor-breadth-history.test.ts` using the exported internals at `artifacts/api-server/src/services/signal-monitor.ts:13172`-`13174`.

Cases:

1. Per-timeframe storage round-trip:
   - Insert active symbol states for all matrix timeframes with current buy/sell directions.
   - Omit matching `signal_monitor_events` for some cells.
   - Run event-anchor repair.
   - Assert one `state-anchor-backfill` event per missing/mismatched cell and idempotency on second run.

2. Breadth read per range:
   - Seed snapshots for `all`, `1m`, `2m`, `5m`, `15m`, `1h`, `1d`.
   - Make snapshot coverage true for `day`, false/partial for `week`.
   - Seed incomplete events that would undercount if replayed.
   - Assert `listSignalMonitorBreadthHistory({ range: 'day' })` and `{ range: 'week' }` return snapshot totals.

3. Freshness:
   - Seed active stale/aged state rows with `fresh=false` and `bars_since_signal > fresh_window_bars`.
   - Assert snapshot recording includes them in buy/sell breadth.
   - Assert UI summary can still show them as aged via state summary, separately from breadth.

4. API contract:
   - Route accepts only `hour/day/week/month` and generated client sends `range`.
   - Existing `artifacts/api-server/src/services/signal-monitor-stream.test.ts:35` checks route presence; extend route/response validation if needed.

## Blast Radius

Same tables/fields are read or written by:

- Breadth snapshots writer: `recordSignalMonitorBreadthSnapshot` reads `signal_monitor_symbol_states` and writes `signal_monitor_breadth_snapshots`: `artifacts/api-server/src/services/signal-monitor.ts:2604`-`2685`.
- Breadth API: `listSignalMonitorBreadthHistory` reads snapshots/events: `artifacts/api-server/src/services/signal-monitor.ts:14192`-`14295`.
- Event-anchor backfill/parity: `buildSignalMonitorEventAnchorBackfillPlan` and `buildSignalMonitorBreadthParityReport`: `artifacts/api-server/src/services/signal-monitor.ts:2143`-`2365`, `2514`-`2601`.
- Signal state writer/upsert: `upsertSymbolState` and related latch logic: `artifacts/api-server/src/services/signal-monitor.ts:6318`-`6631`.
- State reconciliation: `reconcileSignalMonitorSymbolStatesFromCanonicalEvents`: `artifacts/api-server/src/services/signal-monitor.ts:11228`-`11255`.
- Events list route and UI event consumers: `listSignalMonitorEvents` follows the same event table around `artifacts/api-server/src/services/signal-monitor.ts:14309` onward; route is `artifacts/api-server/src/routes/signal-monitor.ts:317`-`324`.
- Signal-options automation reads events/state for candidates and event windows: examples at `artifacts/api-server/src/services/signal-options-automation.ts:2437`-`2511`, `5421`-`5470`, `13653`, `17816`.
- Overnight spot execution reads `signal_monitor_symbol_states`: `artifacts/api-server/src/services/overnight-spot-execution.ts:801`-`807`.
- GEX universe refresh reads `signal_monitor_symbol_states`: `artifacts/api-server/src/services/gex-universe-refresh.ts:995`.
- Retention:
  - `signal_monitor_breadth_snapshots` retention is flat age delete: `lib/db/src/retention.ts:119`-`137`.
  - `signal_monitor_events` retention preserves latest trusted event per cell: `lib/db/src/retention.ts:216`-`240`.
  - inactive symbol state retention never deletes active rows: `lib/db/src/retention.ts:243`-`264`.

Operational caution:

- Backfilling `signal_monitor_events` may affect event-list UI, signal quality KPI calibration, signal-options event-window logic, and retention counts.
- Using source `state-anchor-backfill` makes inserted anchors distinguishable from live `pyrus-signals` events.
