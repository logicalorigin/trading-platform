# Freshness + Hydration Investigation - 2026-07-07

Investigator: `codex-worker`  
Scope: read-only source + SQL investigation. Only this report was written. DB probes used `BEGIN READ ONLY`.

## UI semantics

Observed source facts:

- `git diff -- artifacts/pyrus/src/features/signals/signalStateFreshness.js` and `git status --short -- artifacts/pyrus/src/features/signals/signalStateFreshness.js` produced no output. Contrary to the prompt, I observed no dirty/unlanded diff for this file in the current worktree, so I could not verify any dirty semantic change versus HEAD.
- `signalStateFreshness.js` renders a direction for `ok`, `idle`, and `stale` states, and hides only non-display statuses: `SIGNAL_DIRECTION_DISPLAY_STATUSES` at `artifacts/pyrus/src/features/signals/signalStateFreshness.js:10`-`13`; `getCurrentSignalDirection` at `:35`-`53`.
- The UI uses the stored response `fresh` boolean. `isCurrentFreshSignalState` is `isSignalStateCurrent(state) && state?.fresh` at `artifacts/pyrus/src/features/signals/signalStateFreshness.js:58`-`59`. It does not compute freshness from `barsSinceSignal` or `currentSignalAt`.
- Row status maps `primaryState.fresh ? activeFresh : activeStale` at `artifacts/pyrus/src/features/signals/signalsRowModel.js:927`-`930`. Summary counts increment `row.fresh` at `:1387`-`1401`.
- On the screen, “Fresh” card computes `aged = active - fresh` and tooltip `${fresh} fresh · ${aged} aged` at `artifacts/pyrus/src/screens/SignalsScreen.jsx:1408`-`1468`.
- Row/cell labels are stored-flag based: `BUY is fresh/aged` at `artifacts/pyrus/src/screens/SignalsScreen.jsx:512`-`518`; `DirectionBadge stale={row.fresh === false}` at `:1595`-`1597`; interval matrix uses `fresh = Boolean(state?.fresh)` and labels `fresh`/`aged` at `:2784`-`2818`.
- The literal “outside freshness” strip is not actually freshness-window logic. It uses `missingCellCount` from matrix hydration coverage at `artifacts/pyrus/src/screens/SignalsScreen.jsx:2999`-`3014`. Hydration considers a cell renderable when status is `ok` or `stale` and it has `latestBarAt`/`currentSignalAt`; it only counts `aged` when status is exactly `stale`, not when `fresh=false`: `artifacts/pyrus/src/features/signals/signalsMatrixHydration.js:16`-`26`, `:216`-`231`.
- Backend `stateToResponse` passes through stored `state.fresh` for current stored signals: `artifacts/api-server/src/services/signal-monitor.ts:1206`-`1268`.

Conclusion: visible “Fresh/Aged” and row tone use the stored `fresh` column. The client does not derive freshness from `bars_since_signal <= fresh_window_bars`. The “outside freshness” phrase in the hydration strip is a UI wording mismatch for missing hydration cells.

## Stored-flag divergence

SQL context:

```sql
BEGIN READ ONLY;
SELECT current_database() AS db, current_user AS db_user, now() AS db_now;
COMMIT;
```

Observed: `db=heliumdb`, `db_user=postgres`, `db_now=2026-07-07 16:44:39.228072+00`.

Active shadow directional cells, stored flag versus bar-window truth:

| timeframe | directional | fresh_true | bar_fresh (`bars_since_signal <= 8`) | bar_fresh but `fresh=false` | bar_stale but `fresh=true` | median bars | newest signal |
|---|---:|---:|---:|---:|---:|---:|---|
| 15m | 2699 | 20 | 1607 | 1587 | 0 | 0 | 2026-07-07 14:45Z |
| 1d | 1050 | 57 | 112 | 55 | 0 | 34 | 2026-07-06 00:00Z |
| 1h | 1301 | 31 | 188 | 157 | 0 | 242 | 2026-07-07 14:00Z |
| 1m | 3422 | 8 | 565 | 557 | 0 | 1267 | 2026-07-07 16:34Z |
| 2m | 3126 | 22 | 2089 | 2067 | 0 | 0 | 2026-07-07 16:34Z |
| 5m | 3109 | 3 | 2023 | 2020 | 0 | 0 | 2026-07-07 16:25Z |

Observed invariant violation: no false positives (`fresh=true` outside the bar window), but 6,443 active directional cells are false negatives (`bars_since_signal <= fresh_window_bars AND fresh=false`).

Writer path:

- New signal evaluation computes `barsSinceSignal` then `fresh = signalMonitorFresh(...)`: `artifacts/api-server/src/services/signal-monitor.ts:7479`-`7501`, `:8137`-`8181`, `:8461`-`8516`.
- No-new-signal latch preserves the old direction, recomputes `barsSinceSignal`, and forces `fresh:false`: `artifacts/api-server/src/services/signal-monitor.ts:6331`-`6428`.
- Preserve-existing-signal path also recomputes `barsSinceSignal` against newer bar metadata and forces `fresh:false`: `artifacts/api-server/src/services/signal-monitor.ts:6464`-`6514`.
- The stream actionability helper documents the current semantic conflict: “fresh stays as authored ... deliberately not fresh even when its bar age is inside the fresh window” at `artifacts/api-server/src/services/signal-monitor.ts:9273`-`9287`.
- Reconciliation only clears stale true flags, never re-marks false flags to true: `freshCleared` update at `artifacts/api-server/src/services/signal-monitor.ts:11251`-`11267`.
- Event-anchor backfill is already hooked after reconciliation when startup reconciliation is enabled: `artifacts/api-server/src/services/signal-monitor.ts:11320`-`11329`, but startup reconciliation is opt-in via `PYRUS_SIGNAL_MONITOR_STATE_RECONCILE_ON_STARTUP` at `:11343`-`11356`.

Intended invariant per leader: `fresh ⇔ bars_since_signal <= fresh_window_bars` for current directional, `status='ok'` cells. Current code intentionally violates that for latched/preserved signals. That is the main stored-flag bug.

## Evaluation cadence

Source facts:

- Worker wakeup is 5s, uses advisory lock, polls enabled profiles, and rotates batches: `artifacts/api-server/src/services/signal-monitor-evaluation-worker.ts:35`-`39`, `:776`-`840`.
- Profile evaluation capacity is not reduced under high pressure: `cappedSignalMonitorEvaluationProfile` returns configured `maxSymbols`/`evaluationConcurrency` with `capped:false` at `artifacts/api-server/src/services/signal-monitor.ts:1080`-`1107`; test asserts high pressure keeps capacity at `artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts:981`-`1001`.
- Exact matrix requests are not capped by pressure: `resolveSignalMonitorMatrixExactCellCap` returns `null` at `artifacts/api-server/src/services/signal-monitor.ts:939`-`947`; tested at `artifacts/api-server/src/services/signal-monitor-completed-bars.test.ts:1163`-`1178`.
- Pressure does skip deep-history backfill, not the live edge/evaluation itself: `shouldSkipSignalMonitorBackfillForPressure(resourceLevel === "high")` and comments at `artifacts/api-server/src/services/signal-monitor.ts:5039`-`5046`, `:5118`-`5144`.
- Server-owned producer is started in background workers: `artifacts/api-server/src/index.ts:294`-`315`, and refreshes producer/backfill at `artifacts/api-server/src/services/signal-monitor.ts:10116`-`10188`.

SQL timestamp evidence:

| timeframe | directional | latest_bar >= 16:00Z | evaluated >= 16:00Z | max latest_bar_at | max last_evaluated_at |
|---|---:|---:|---:|---|---|
| 15m | 2699 | 172 | 173 | 2026-07-07 16:30Z | 2026-07-07 16:37:36Z |
| 1d | 1050 | 0 | 118 | 2026-07-06 00:00Z | 2026-07-07 16:37:36Z |
| 1h | 1301 | 172 | 172 | 2026-07-07 16:00Z | 2026-07-07 16:37:36Z |
| 1m | 3422 | 1916 | 1916 | 2026-07-07 16:37Z | 2026-07-07 16:37:36Z |
| 2m | 3126 | 1635 | 1635 | 2026-07-07 16:34Z | 2026-07-07 16:34:59Z |
| 5m | 3109 | 1646 | 1647 | 2026-07-07 16:35Z | 2026-07-07 16:37:36Z |

Profile row at the same probe: `shadow`, `timeframe=5m`, `fresh_window_bars=8`, `poll_interval_seconds=60`, `max_symbols=2000`, `evaluation_concurrency=6`, `last_evaluated_at=2026-07-07 16:35:37.914Z`, `last_error=NULL`.

For 15m specifically: newest signal at 14:45Z is consistent with evaluations having run for later bars on at least part of the universe: 172 directional 15m cells had `latest_bar_at >= 16:00Z` and newest `latest_bar_at=16:30Z`. It is also evidence of incomplete full-universe freshness: only 172/2699 15m cells had advanced to >=16:00Z by 16:44Z.

Unknown: I did not prove whether the 2527 older 15m cells are waiting on rotation, missing stream coverage, backfill skipped under pressure, or inactive producer coverage. That link needs worker/runtime logs or stream diagnostics, which I did not mutate or restart to collect.

## Verdict-B (quantified)

Observed contributors:

- Stored-fresh-flag bug: confirmed. 6,443 active directional cells are bar-fresh but display as aged because stored `fresh=false`: 15m 1587, 1d 55, 1h 157, 1m 557, 2m 2067, 5m 2020.
- Correct standing-signal aging: confirmed, also large. Cells outside the bar window and `fresh=false`: 15m 1092, 1d 938, 1h 1113, 1m 2857, 2m 1037, 5m 1086, plus no observed stale true false-positive rows.
- Evaluation pipeline stall: not globally confirmed. Current evaluations are happening (`last_evaluated_at` and `latest_bar_at` advanced through 16:37Z for many cells), but coverage is partial for 15m/1h and older rows remain. So the right label is “partial coverage/rotation or producer/backfill gap,” not total stall.
- UI dirty change: refuted in this worktree. There is no observed dirty diff for `signalStateFreshness.js`. Existing UI semantics do depend on stored `fresh`.

Verdict: (ii) is the biggest actionable freshness bug for what the owner sees. (i) is also real and expected for true standing-signal aging. (iii) is a possible secondary contributor for older, not-advanced cells, but only partially verified. (iv) was not observed.

## Hydration profile

Source facts:

- Breadth route has no cache; it parses and directly calls `listSignalMonitorBreadthHistory`: `artifacts/api-server/src/routes/signal-monitor.ts:305`-`314`.
- The neighboring state route already uses an in-flight-deduped short TTL cache and serialized RawJson payload: `artifacts/api-server/src/routes/signal-monitor.ts:244`-`302`.
- Breadth service reads all snapshot rows in the window ordered by `captured_at`, then buckets in JS: `artifacts/api-server/src/services/signal-monitor.ts:14303`-`14335`, `buildSignalMonitorBreadthFromSnapshots` at `:1941`-`2012`.
- Snapshot interval is 5 minutes: `artifacts/api-server/src/services/signal-monitor.ts:1931`-`1932`.

SQL evidence:

- Snapshot rows as of 16:44Z: hour 98, day 854, week 11340, month 33292. Latest snapshot 2026-07-07 16:40:18Z.
- Current month raw query uses `signal_monitor_breadth_snapshots_env_captured_idx`, touches 873 shared buffers, returns 33,292 rows, and took 861 ms in `EXPLAIN ANALYZE` while emitting all rows to the client.
- SQL bucket reduction count: month raw 33,292 rows -> 161 rows; week raw 11,347 rows -> 476 rows.

Inference: route hydration time is mostly redundant DB/row-transfer/serialization and JS bucketing for week/month. The first ponytail fix is reuse the existing route-level cache/in-flight pattern. SQL-side bucket reduction is next if cold week/month still matter after caching.

Other Signals screen load fetches observed in `artifacts/pyrus/src/screens/SignalsScreen.jsx:3436`-`3468`: profile, state, events, and breadth history. State has a 15s server cache; events poll every 15s; breadth polls every 30s. If breadth becomes cheap, state/matrix payload and sparkline seed/runtime snapshots are likely the next hydration share, but I did not deep-dive them per scope.

## Proposed diffs

### Freshness option A: writer invariant + one-time repair (ponytail recommendation)

This is the root fix if product meaning is the leader’s invariant: current directional `status='ok'` freshness is bar-window freshness. It changes the user-visible result by turning thousands of currently amber “aged” cells green/fresh when their stored `bars_since_signal` is within the configured window.

```diff
diff --git a/artifacts/api-server/src/services/signal-monitor.ts b/artifacts/api-server/src/services/signal-monitor.ts
--- a/artifacts/api-server/src/services/signal-monitor.ts
+++ b/artifacts/api-server/src/services/signal-monitor.ts
@@
 function applyStoredSignalDirectionLatch<
   V extends {
@@
     barsSinceSignal: number | null;
     fresh: boolean;
   },
 >(input: {
+  freshWindowBars?: number | null;
   existing: Pick<
@@
   const currentSignalAt =
     input.existing?.currentSignalAt ?? input.values.currentSignalAt;
+  const barsSinceSignal = resolveLatchedSignalBarsSinceSignal({
+    timeframe: input.values.timeframe,
+    currentSignalAt,
+    latestBarAt: input.values.latestBarAt,
+    existingBarsSinceSignal: input.existing?.barsSinceSignal,
+    candidateBarsSinceSignal: input.values.barsSinceSignal,
+  });
   return {
@@
-    barsSinceSignal: resolveLatchedSignalBarsSinceSignal({
-      timeframe: input.values.timeframe,
-      currentSignalAt,
-      latestBarAt: input.values.latestBarAt,
-      existingBarsSinceSignal: input.existing?.barsSinceSignal,
-      candidateBarsSinceSignal: input.values.barsSinceSignal,
-    }),
-    fresh: false,
+    barsSinceSignal,
+    fresh: signalMonitorFresh({
+      barsSinceSignal: barsSinceSignal ?? Number.POSITIVE_INFINITY,
+      freshWindowBars: input.freshWindowBars,
+      stale: input.values.status !== "ok",
+    }),
   };
 }
@@
 type SignalMonitorSymbolStateUpsertInput = {
@@
   fresh: boolean;
+  freshWindowBars?: number | null;
   status: SignalMonitorStatus;
@@
   const effectiveValues = applyStoredSignalDirectionLatch({
+    freshWindowBars: input.freshWindowBars,
     existing: input.allowStoredSignalLatch === false ? null : existing,
     values,
   });
@@
 function mergeFreshBarMetadataOntoPreservedSignalRow(
   existing: DbSignalMonitorSymbolState,
   candidate: typeof signalMonitorSymbolStatesTable.$inferInsert,
+  freshWindowBars?: number | null,
 ): typeof signalMonitorSymbolStatesTable.$inferInsert | null {
@@
-    fresh: false,
+    fresh: signalMonitorFresh({
+      barsSinceSignal: barsSinceSignal ?? Number.POSITIVE_INFINITY,
+      freshWindowBars,
+      stale: candidate.status !== "ok",
+    }),
     barsSinceSignal,
   };
 }
@@
     const merged = mergeFreshBarMetadataOntoPreservedSignalRow(
       existing,
       effectiveValues,
+      input.freshWindowBars,
     );
@@
   const freshClearWhere = sql`
@@
   const freshCleared = dryRun
@@
       );
+
+  const freshMarkWhere = sql`
+    WHERE s.profile_id = ${profile.id}
+      AND s.fresh = false
+      AND s.status = 'ok'
+      AND s.current_signal_direction IN ('buy', 'sell')
+      AND s.bars_since_signal IS NOT NULL
+      AND s.bars_since_signal <= ${profile.freshWindowBars}`;
+  const freshMarked = dryRun
+    ? await countOf(
+        sql`SELECT count(*) AS count FROM signal_monitor_symbol_states AS s ${freshMarkWhere}`,
+      )
+    : countReturnedRows(
+        await db.execute(sql`
+          UPDATE signal_monitor_symbol_states AS s
+          SET fresh = true, updated_at = now()
+          ${freshMarkWhere}
+          RETURNING 1
+        `),
+      );
@@
     freshCleared,
+    freshMarked,
     eventAnchorsInserted: 0,
   };
 }
```

The real patch must pass `freshWindowBars: input.profile.freshWindowBars` at the `upsertSymbolState`/`resolveSignalMonitorSymbolStateUpsert` call sites around `artifacts/api-server/src/services/signal-monitor.ts:7396`, `:7458`, `:7546`, `:7576`, `:7640`, and `:8874`. I did not expand every hunk here to keep the proposal readable.

### Freshness option B: read/display-time freshness

Smaller user-visible diff, larger semantic debt: change `stateToResponse`/`stateToResponseForSnapshot` to compute response `fresh` from `barsSinceSignal` and profile `freshWindowBars`, leaving storage inconsistent. This would fix the Signals page without repairing writer invariants, but every non-UI consumer of `signal_monitor_symbol_states.fresh` remains exposed. Ponytail recommendation: skip this unless product wants display-only mitigation.

### Hydration option A: breadth route TTL + in-flight dedupe (ponytail recommendation)

```diff
diff --git a/artifacts/api-server/src/routes/signal-monitor.ts b/artifacts/api-server/src/routes/signal-monitor.ts
--- a/artifacts/api-server/src/routes/signal-monitor.ts
+++ b/artifacts/api-server/src/routes/signal-monitor.ts
@@
 const signalMonitorStateCache = new Map<string, { json: string; at: number }>();
 const signalMonitorStateInFlight = new Map<string, Promise<string>>();
+const SIGNAL_MONITOR_BREADTH_HISTORY_CACHE_MS = 5_000;
+const signalMonitorBreadthHistoryCache = new Map<string, { json: string; at: number }>();
+const signalMonitorBreadthHistoryInFlight = new Map<string, Promise<string>>();
@@
 router.get("/signal-monitor/breadth-history", async (req, res) => {
   const query = ListSignalMonitorBreadthHistoryQueryParams.parse(req.query);
-  const data = ListSignalMonitorBreadthHistoryResponse.parse(
-    await listSignalMonitorBreadthHistory({
-      ...query,
-      environment: resolveSignalSourceEnvironment(),
-    }),
-  );
+  const environment = resolveSignalSourceEnvironment();
+  const cacheKey = `${environment}:${query.range ?? "day"}`;
+  const cached = signalMonitorBreadthHistoryCache.get(cacheKey);
+  if (cached && Date.now() - cached.at < SIGNAL_MONITOR_BREADTH_HISTORY_CACHE_MS) {
+    res.json(new RawJson(cached.json));
+    return;
+  }
+  let pending = signalMonitorBreadthHistoryInFlight.get(cacheKey);
+  if (!pending) {
+    const compute = (async () => {
+      const json = JSON.stringify(
+        ListSignalMonitorBreadthHistoryResponse.parse(
+          await listSignalMonitorBreadthHistory({ ...query, environment }),
+        ),
+      );
+      signalMonitorBreadthHistoryCache.set(cacheKey, { json, at: Date.now() });
+      return json;
+    })();
+    pending = compute;
+    signalMonitorBreadthHistoryInFlight.set(cacheKey, compute);
+    void compute.finally(() => {
+      if (signalMonitorBreadthHistoryInFlight.get(cacheKey) === compute) {
+        signalMonitorBreadthHistoryInFlight.delete(cacheKey);
+      }
+    }).catch(() => {});
+  }
 
-  res.json(data);
+  res.json(new RawJson(await pending));
 });
```

### Hydration option B: SQL-side bucket reduction

Use only if cold week/month still matter after the 5s route cache. Reduce rows before JS by selecting the latest snapshot per `(timeframe, bucket)`.

```diff
diff --git a/artifacts/api-server/src/services/signal-monitor.ts b/artifacts/api-server/src/services/signal-monitor.ts
--- a/artifacts/api-server/src/services/signal-monitor.ts
+++ b/artifacts/api-server/src/services/signal-monitor.ts
@@
-      snapshotRows = await db
-        .select({
-          timeframe: signalMonitorBreadthSnapshotsTable.timeframe,
-          capturedAt: signalMonitorBreadthSnapshotsTable.capturedAt,
-          buy: signalMonitorBreadthSnapshotsTable.buy,
-          sell: signalMonitorBreadthSnapshotsTable.sell,
-        })
-        .from(signalMonitorBreadthSnapshotsTable)
-        .where(
-          and(
-            eq(signalMonitorBreadthSnapshotsTable.environment, environment),
-            gte(signalMonitorBreadthSnapshotsTable.capturedAt, window.from),
-            lte(signalMonitorBreadthSnapshotsTable.capturedAt, window.to),
-          ),
-        )
-        .orderBy(signalMonitorBreadthSnapshotsTable.capturedAt);
+      const bucketSeconds = Math.max(1, window.bucketMinutes) * 60;
+      const result = await db.execute(sql`
+        SELECT DISTINCT ON (
+          timeframe,
+          floor(extract(epoch from captured_at) / ${bucketSeconds})
+        )
+          timeframe,
+          captured_at AS "capturedAt",
+          buy,
+          sell
+        FROM signal_monitor_breadth_snapshots
+        WHERE environment = ${environment}
+          AND captured_at >= ${window.from}
+          AND captured_at <= ${window.to}
+        ORDER BY
+          timeframe,
+          floor(extract(epoch from captured_at) / ${bucketSeconds}),
+          captured_at DESC
+      `);
+      snapshotRows = result.rows as typeof snapshotRows;
+      snapshotRows.sort((left, right) =>
+        dateOrNull(left.capturedAt)!.getTime() - dateOrNull(right.capturedAt)!.getTime()
+      );
```

## Test plans

Freshness writer invariant:

- Add a focused test around `applyStoredSignalDirectionLatch` via `__signalMonitorInternalsForTests` (`artifacts/api-server/src/services/signal-monitor.ts:13202` export): existing direction, no new candidate direction, `barsSinceSignal=0`, `freshWindowBars=8`, `status='ok'` should return `fresh=true`.
- Add preserve-path test for `mergeFreshBarMetadataOntoPreservedSignalRow`: stored signal preserved, newer `latestBarAt`, recomputed `barsSinceSignal <= 8`, expect `fresh=true`.
- Add reconciliation test: seed `fresh=false`, `status='ok'`, directional, `bars_since_signal <= fresh_window_bars`; dry-run reports `freshMarked`, write run flips to true; stale/outside-window rows remain false.
- Run targeted: `pnpm --filter @workspace/api-server test -- signal-monitor-completed-bars` or the repo’s equivalent targeted Vitest command after confirming package scripts.

Hydration cache:

- Add route test near existing signal-monitor route tests: two concurrent `/signal-monitor/breadth-history?range=month` calls should invoke service once and return identical JSON.
- Add TTL expiry test with fake timers or exported cache clear, matching the existing state-route cache pattern.
- Add service test for SQL bucketing only if option B lands: seed multiple snapshots in one bucket, assert returned point uses the latest snapshot in that bucket and week/month row volume is reduced.
- Verify manually with read-only timing: cold month, immediate warm month, and post-5s month. Expected warm request avoids service DB read.
