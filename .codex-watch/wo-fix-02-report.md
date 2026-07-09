# WO-FIX-02 Report

## What / Why

Added a separate `contentStamp` to the signal-monitor backfilled-base entry so the completed-bars cache key tracks external base content changes instead of scheduler freshness. Stream promotion still bumps `refreshedAt` to keep the async backfill scheduler quiet, but preserves the existing `contentStamp` so same-bucket cache hits survive promotion churn. Backfill-sourced refreshes set `contentStamp` from their refresh timestamp, so genuine external content refreshes still bust the cache.

## Unified Diff

```diff
--- a/artifacts/api-server/src/services/signal-monitor.ts
+++ b/artifacts/api-server/src/services/signal-monitor.ts
@@ -5215,6 +5215,7 @@
 // base (cold start / disabled) falls back to the prior live-ring behavior.
 type SignalMonitorBackfilledBaseEntry = {
   bars: SignalMonitorBarSnapshot[];
+  contentStamp: number;
   refreshedAt: number;
 };
 const signalMonitorBackfilledBaseByCell = new Map<
@@ -5363,18 +5364,23 @@
   timeframe: SignalMonitorMatrixTimeframe;
   bars: SignalMonitorBarSnapshot[];
   refreshedAtMs: number;
+  source: "backfill" | "stream-promotion";
 }): void {
   if (!input.bars.length) {
     return;
   }
   ensureSignalMonitorBackfilledBaseInvalidationSubscription();
-  signalMonitorBackfilledBaseByCell.set(
-    signalMonitorBackfillCellKey(input.symbol, input.timeframe),
-    {
-      bars: input.bars.slice(-SIGNAL_MONITOR_MATRIX_BARS_LIMIT),
-      refreshedAt: input.refreshedAtMs,
-    },
-  );
+  const key = signalMonitorBackfillCellKey(input.symbol, input.timeframe);
+  const existing = signalMonitorBackfilledBaseByCell.get(key);
+  const contentStamp =
+    input.source === "stream-promotion"
+      ? existing?.contentStamp ?? input.refreshedAtMs
+      : input.refreshedAtMs;
+  signalMonitorBackfilledBaseByCell.set(key, {
+    bars: input.bars.slice(-SIGNAL_MONITOR_MATRIX_BARS_LIMIT),
+    contentStamp,
+    refreshedAt: input.refreshedAtMs,
+  });
 }
 
 function promoteSignalMonitorBackfilledBaseFromStream(input: {
@@ -5404,6 +5410,7 @@
     timeframe: input.timeframe,
     bars: input.completedBars,
     refreshedAtMs: input.evaluatedAt.getTime(),
+    source: "stream-promotion",
   });
 }
 
@@ -5618,6 +5625,7 @@
                       timeframe,
                       bars: snapshot.bars,
                       refreshedAtMs: input.evaluatedAt.getTime(),
+                      source: "backfill",
                     });
                   }
                 } catch {
@@ -8420,7 +8428,7 @@
 // its output (the merged completedBars) is a pure function of just three inputs:
 //   1. the completed-bucket boundary for the timeframe (clock-driven; advances
 //      once per minute for 1m, every 5m for 5m, etc. — see signalMonitorCompletedBarsQueryTo),
-//   2. the async backfilled base for the cell (signalMonitorBackfilledBaseByCell.refreshedAt),
+//   2. the async backfilled base content for the cell (signalMonitorBackfilledBaseByCell.contentStamp),
 //   3. any out-of-order aggregate that corrects an already-completed minute (revision below).
 // When none changed since the last evaluation, the merged bars cannot have
 // changed, so we reuse them and skip load/filter/merge. We still run the
@@ -9773,7 +9781,7 @@
 }): SignalMonitorMatrixStateResult | null {
   // #2 upstream dirty-track (see signalMonitorStreamCompletedBarsCache above):
   // the merged completedBars are a pure function of the completed-bucket boundary,
-  // the backfilled base refresh, and any out-of-order completed-minute correction.
+  // the backfilled base content, and any out-of-order completed-minute correction.
   // Skip the load/filter/merge when none changed; ALWAYS run the downstream eval
   // so staleness/age recompute from the live evaluatedAt.
   const cellKey = signalMonitorBackfillCellKey(input.symbol, input.timeframe);
@@ -9781,7 +9789,7 @@
   const dirtyKey = `${signalMonitorCompletedBarsQueryTo({
     timeframe: input.timeframe,
     evaluatedAt: input.evaluatedAt,
-  }).getTime()}:${baseEntry?.refreshedAt ?? 0}:${getSignalMonitorAggregateRevision(
+  }).getTime()}:${baseEntry?.contentStamp ?? 0}:${getSignalMonitorAggregateRevision(
     input.symbol,
   )}`;
   let completedBars: SignalMonitorBarSnapshot[];
@@ -14087,14 +14095,7 @@
   selectSignalMonitorBackfillDueCells,
   groupSignalMonitorBackfillDueCellsByTimeframe,
   promoteSignalMonitorBackfilledBaseFromStream,
-  seedSignalMonitorBackfilledBaseForTests(input: {
-    symbol: string;
-    timeframe: SignalMonitorMatrixTimeframe;
-    bars: SignalMonitorBarSnapshot[];
-    refreshedAtMs: number;
-  }) {
-    rememberSignalMonitorBackfilledBaseBars(input);
-  },
+  seedSignalMonitorBackfilledBaseForTests: rememberSignalMonitorBackfilledBaseBars,
   getSignalMonitorBackfilledBaseForTests(input: {
     symbol: string;
     timeframe: SignalMonitorMatrixTimeframe;
--- a/artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts
+++ b/artifacts/api-server/src/services/signal-monitor-stream-completed-bars-cache.test.ts
@@ -26,6 +26,7 @@
   resetSignalMonitorMatrixHeavyEvaluationCache: resetCaches,
   resetSignalMonitorMatrixStreamForTests: resetStream,
   seedSignalMonitorBackfilledBaseForTests: seedBackfilledBase,
+  getSignalMonitorBackfilledBaseForTests: getBackfilledBase,
 } = __signalMonitorInternalsForTests;
 
 after(async () => {
@@ -189,6 +190,80 @@
   assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });
 });
 
+test("stream-base promotion preserves cache hits while backfill refreshes bust the cell", () => {
+  const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
+  primeRing(evaluatedAt.toISOString());
+
+  const completedBars = loadSignalMonitorStreamCompletedBars({
+    symbol: SYMBOL,
+    timeframe: "1m",
+    evaluatedAt,
+    limit: 240,
+  });
+  assert.ok(completedBars.length > 0, "test setup should have completed bars");
+
+  const initialBackfillStamp = Date.parse("2026-06-09T14:00:00.000Z");
+  seedBackfilledBase({
+    symbol: SYMBOL,
+    timeframe: "1m",
+    bars: toBackfilledBaseBars(completedBars as never),
+    refreshedAtMs: initialBackfillStamp,
+    source: "backfill",
+  });
+
+  const first = evalAt(evaluatedAt.toISOString());
+  assert.ok(first, "first evaluation should produce a state");
+  assert.deepEqual(barsCacheStats(), { size: 1, hits: 0, misses: 1 });
+
+  const promoted = getBackfilledBase({
+    symbol: SYMBOL,
+    timeframe: "1m",
+  }) as
+    | {
+        bars?: Array<{ timestamp: Date }>;
+        contentStamp?: number;
+        refreshedAt?: number;
+      }
+    | undefined;
+  assert.equal(
+    promoted?.refreshedAt,
+    evaluatedAt.getTime(),
+    "promotion should still bump scheduler freshness",
+  );
+  assert.equal(
+    promoted?.contentStamp,
+    initialBackfillStamp,
+    "promotion should not dirty the completed-bars cache input",
+  );
+  assert.equal(
+    promoted?.bars?.at(-1)?.timestamp.toISOString(),
+    completedBars.at(-1)?.timestamp.toISOString(),
+    "promotion should keep the same latest completed bar",
+  );
+
+  const second = evalAt(evaluatedAt.toISOString());
+  assert.ok(second, "second evaluation should produce a state");
+  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });
+
+  const nextBackfillStamp = Date.parse("2026-06-09T14:30:00.000Z");
+  seedBackfilledBase({
+    symbol: SYMBOL,
+    timeframe: "1m",
+    bars: toBackfilledBaseBars(completedBars as never),
+    refreshedAtMs: nextBackfillStamp,
+    source: "backfill",
+  });
+  const backfilled = getBackfilledBase({
+    symbol: SYMBOL,
+    timeframe: "1m",
+  }) as { contentStamp?: number } | undefined;
+  assert.equal(backfilled?.contentStamp, nextBackfillStamp);
+
+  const third = evalAt(evaluatedAt.toISOString());
+  assert.ok(third, "third evaluation should produce a state");
+  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 2 });
+});
+
 test("crossing the completed-bar boundary busts the cell (re-aggregates)", () => {
   primeRing("2026-06-09T15:00:00.000Z");
 
@@ -263,6 +338,7 @@
     timeframe: "1m",
     bars: staleBase,
     refreshedAtMs: evaluatedAt.getTime() - 60 * 60_000,
+    source: "backfill",
   });
 
   const gapFilled = evalStreamBars({
@@ -296,6 +372,7 @@
     timeframe: "1m",
     bars: baseBars,
     refreshedAtMs: evaluatedAt.getTime() - 60_000,
+    source: "backfill",
   });
 
   const streamBars = loadSignalMonitorStreamCompletedBars({
--- a/artifacts/api-server/src/services/signal-monitor-backfill-base.test.ts
+++ b/artifacts/api-server/src/services/signal-monitor-backfill-base.test.ts
@@ -117,6 +117,7 @@
     timeframe: "5m",
     bars: baseBars,
     refreshedAtMs,
+    source: "backfill",
   });
   promoteSignalMonitorBackfilledBaseFromStream({
     symbol: "AAPL",
@@ -147,6 +148,7 @@
     timeframe: "1d",
     bars: baseBars,
     refreshedAtMs,
+    source: "backfill",
   });
   promoteSignalMonitorBackfilledBaseFromStream({
     symbol: "AAPL",
```

## Test Output

Command:

```bash
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream-completed-bars-cache.test.ts src/services/signal-monitor-backfill-base.test.ts src/services/signal-monitor-completed-bars.test.ts
```

Output:

```text
✔ merging a deep base under a shallow live edge yields a deeper series (1.044656ms)
✔ the live edge wins on a same-timestamp collision with the base (0.163798ms)
✔ empty base preserves prior live-only behavior (0.572203ms)
✔ stream promotion advances intraday backfilled base with the evaluated series (0.438033ms)
✔ stream promotion does not turn daily stream output into a backfilled base (2.508513ms)
✔ due-cell selection caps per cycle and refreshes the most-overdue first (0.455949ms)
✔ due-cell prefetch grouping keeps symbols scoped to their due timeframe (0.239606ms)
✔ pressure-high skips the backfill cycle; watch/normal keep running (0.082759ms)
✔ idle-session producer backfill skips when no aggregate can consume it (8.082618ms)
✔ active-market producer backfill stays enabled before first aggregate (0.30558ms)
✔ price trace explains daily rows marked stale by the policy window (0.714462ms)
✔ price trace distinguishes current rows from stale stored status (2.002924ms)
✔ backfill cadence is slow and the concurrency budget is small and dedicated (0.153534ms)
{"level":40,"time":1783538279131,"pid":60594,"hostname":"repl","symbol":"AGZ","timeframe":"1m","rejectedCount":1,"samples":[{"source":"massive-websocket","close":76.91,"timestamp":"2026-06-18T08:00:00.000Z","referenceClose":109,"referenceTimestamp":"2026-06-17T20:00:00.000Z","referenceSource":"massive-history","deviationPercent":29.4404,"trusted":false,"reason":"deviates-from-reference"}],"msg":"Signal monitor rejected untrusted live-edge bars"}
✔ quiet market completed bars do not retry solely because wall clock moved (4.238746ms)
✔ quiet market completed bars still retry when far behind the previous close (0.157184ms)
✔ gappy intraday feed counts bars since signal by elapsed time, not present bars (0.325866ms)
✔ thin and liquid symbols with the same signal/latest times report the same bars (0.151493ms)
✔ bars since signal never reads fresher than the present-bar count (0.101212ms)
✔ signal monitor excursion uses bars after the signal close (0.767241ms)
✔ signal monitor excursion is direction-aware for sell signals (0.149429ms)
✔ cross-session intraday signal is counted as very old, not artificially fresh (0.220453ms)
✔ python signal matrix state recomputes elapsed bar age before freshness (1.910766ms)
✔ python signal matrix state keeps signal identity when the cell is stale (0.535076ms)
✔ python signal matrix unavailable cell defers to the JS fallback (0.152433ms)
✔ a delayed bar replay never displaces a live bar for the same bucket (0.219043ms)
✔ signal monitor rejects live-edge bars that conflict with trusted same-symbol history (0.935441ms)
✔ signal monitor does not persist live-edge signal identity without a trusted reference (0.222284ms)
✔ signal monitor still persists live-edge latest-bar metadata without a trusted reference (0.156509ms)
✔ daily bar completeness is consistent across the UTC/NY date boundary (0.263422ms)
✔ reconciliation keeps adopted 1d rows age-less until the next daily eval (2.989907ms)
✔ daily bars do not count weekends/holidays as elapsed bars (0.247833ms)
✔ active-session completed bars still require the expected live edge (0.330569ms)
✔ matrix cache latches the last signal when a re-eval finds no new signal (0.324843ms)
✔ matrix cache advances latched signal bar age from timestamps (0.12973ms)
✔ matrix cache flips direction when an opposite signal arrives (0.073677ms)
✔ matrix cache leaves a never-signaled cell directionless (0.053582ms)
✔ a newer real signal is not rejected by an existing row with newer bar metadata (0.094597ms)
✔ an incoming older signal cannot replace a newer stored signal (0.404491ms)
✔ a latched metadata refresh with newer bars still writes (0.145251ms)
✔ an incoming row with the same signal but older bars is preserved away (0.066285ms)
✔ signal monitor bar evaluation is passive by default (0.200254ms)
✔ signal monitor bar evaluation requires explicit opt-in (0.078191ms)
✔ signal matrix heavy evaluation cache keys identical completed-bar series only (4.820559ms)
✔ non-current signal state snapshots preserve last-known direction for display hydration (3.87035ms)
✔ trend-only signal state snapshots render a non-actionable display direction (0.589875ms)
✔ non-RTH aged signal snapshots are market-idle, not stale (0.497056ms)
✔ RTH aged signal snapshots stay stale (0.452598ms)
✔ matrix evaluation keeps configured capacity under high pressure (0.165443ms)
✔ signal monitor pressure defaults use resource pressure (1.687919ms)
✔ automatic stored-state matrix bootstrap keeps full universe breadth (0.169282ms)
✔ signal monitor evaluation batch keeps existing cursor rotation without priority (0.334653ms)
✔ signal monitor evaluation batch prioritizes visible symbols within the existing cap (0.12352ms)
✔ signal monitor evaluation batch rotates oversized priority symbols without expanding work (0.181368ms)
✔ signal matrix metadata reports pending exact cells from backend coverage (0.568662ms)
✔ signal matrix metadata does not expand broad requests into pending cells (0.706493ms)
✔ exact matrix evaluation is not capped by pressure (0.819782ms)
✔ fresh signal monitor events persist when first observed after the zero bar (0.174663ms)
✔ signal monitor event catch-up does not persist stale or out-of-window signals (0.075702ms)
✔ canonical signal monitor event eligibility is shared by matrix and symbol paths (0.063783ms)
✔ signal monitor event pagination reports source status (0.092689ms)
✔ signal monitor events fallback backoff latches transient read failures (187.61972ms)
✔ signal monitor events read checks fallback latch before retrying the database (1.499599ms)
✔ signal monitor state fallback carries its source through the API contract (47.416393ms)
✔ public signal monitor state responses do not drop state source (5.447667ms)
✔ signal monitor reconciliation trusts event integrity and websocket-backed bar cache rows (1.617003ms)
✔ disabled signal monitor profile symbols do not evaluate bars (0.572035ms)
✔ enabled signal monitor profile symbols stay passive by default (3.517311ms)
✔ signal monitor state snapshots fill missing universe cells as unavailable (0.37046ms)
✔ intraday bar age counts only regular-session bars (SMR regression: wall-clock counted nights, weekends, and the Jul-3 holiday) (0.296703ms)
✔ intraday bar age does not inflate across a single overnight gap (prior-session signals stay actionable at the open) (0.071538ms)
✔ intraday bar age keeps the present-bar floor (never fresher than actual) (0.049984ms)
✔ revision bumps ONLY on out-of-order minutes, not forward/forming updates (1.21907ms)
✔ identical (boundary, base, revision) reuses cached bars and is value-identical (16.723415ms)
✔ a hit holds across sub-minute evaluatedAt drift (same completed boundary) (34.863603ms)
✔ stream-base promotion preserves cache hits while backfill refreshes bust the cell (22.451405ms)
✔ crossing the completed-bar boundary busts the cell (re-aggregates) (6.465509ms)
✔ source minute bars memo reuses same-depth loads across stream timeframes (3.080373ms)
✔ an out-of-order correction busts the cell even within the same boundary (5.260993ms)
✔ stale backfilled base gap is filled from local 1m memory without changing signal output (18.438839ms)
✔ contiguous base plus live edge is unchanged when local memory is available (10.233866ms)
ℹ tests 80
ℹ suites 0
ℹ pass 80
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17832.477711
```

## Out-of-Scope Observations

- No git commands were run. The work order requested a `git status` gate but also prohibited git commands, so the gate was not executed.
- Verified with repository grep that `rememberSignalMonitorBackfilledBaseBars(` now appears at the function definition and exactly two call sites: stream promotion and async backfill.
- Verified with repository grep that remaining `refreshedAt` reads are the backfill scheduler candidate path and scheduler comments, while the completed-bars dirty key reads `contentStamp`.
- No full suite, typecheck, build, or app restart was run.
