# WO-FIX-04 Report

## What / Why

Bounded the minute-bar retention prune in `signal-monitor-local-bar-cache.ts`.
`storeMinuteBar` no longer scans every retained key after every insert. It now runs the existing full timestamp scan only when a per-symbol 5-minute cadence is due, when the symbol has never been pruned, or when the map crosses a retention-sized pressure bound.

Because physical deletion can now lag the insert that makes an old bar expire, `readMemoryBars` filters by the same retention boundary before rollup. That keeps stale memory bars from being served while allowing the cache to defer deletion.

## Diff

```diff
--- /tmp/wo-fix-04-signal-monitor-local-bar-cache.ts.before	2026-07-08 13:35:02.540122077 -0600
+++ artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts	2026-07-08 13:38:10.622353269 -0600
@@ -67,6 +67,7 @@
 // bounded separately; this only widens the per-symbol minute retention.)
 const DEFAULT_MEMORY_RETENTION_MS = 120 * 60 * 60_000;
 const DEFAULT_PERSIST_FLUSH_MS = 5_000;
+const MINUTE_BAR_RETENTION_PRUNE_INTERVAL_MS = 5 * 60_000;
 // A normal full-universe prefetch is 2,000 symbols * 6 local timeframes * 2
 // sources = 24,000 cells. Keep the default above that footprint so the LRU does
 // not scan-evict the same universe it just loaded and turn every cycle into a
@@ -153,6 +154,7 @@
 let storedBarsPrefetchFallbackMismatchCount = 0;
 
 const minuteBarsBySymbol = new Map<string, Map<number, CachedBar>>();
+const minuteBarLastPrunedAtMsBySymbol = new Map<string, number>();
 const trackedSymbols = new Set<string>();
 const pendingPersistBars = new Map<string, PendingPersistBar>();
 const persistedBarSignatures = new Map<string, string>();
@@ -168,6 +170,8 @@
 let lastPersistError: string | null = null;
 let lastPersistErrorAt: Date | null = null;
 let lastEnqueueScannedBarCount = 0;
+let minuteBarRetentionPruneRunCount = 0;
+let lastMinuteBarRetentionPruneScannedBarCount = 0;
 let liveAggregatePersistSkipCount = 0;
 let lastLiveAggregatePersistSkippedAt: Date | null = null;
 
@@ -204,6 +208,17 @@
   );
 }
 
+function minuteBarRetentionBoundaryMs(nowMs: number): number {
+  return nowMs - memoryRetentionMs();
+}
+
+function minuteBarRetentionPruneSizeLimit(): number {
+  return (
+    Math.ceil(memoryRetentionMs() / TIMEFRAME_MS["1m"]) +
+    Math.ceil(MINUTE_BAR_RETENTION_PRUNE_INTERVAL_MS / TIMEFRAME_MS["1m"])
+  );
+}
+
 function persistFlushMs(): number {
   return readPositiveIntegerEnv(
     "PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_FLUSH_MS",
@@ -710,6 +725,42 @@
   return result;
 }
 
+function shouldPruneMinuteBarsForSymbol(
+  symbol: string,
+  symbolBars: Map<number, CachedBar>,
+  nowMs: number,
+): boolean {
+  const lastPrunedAtMs = minuteBarLastPrunedAtMsBySymbol.get(symbol);
+  return (
+    lastPrunedAtMs == null ||
+    nowMs - lastPrunedAtMs >= MINUTE_BAR_RETENTION_PRUNE_INTERVAL_MS ||
+    symbolBars.size > minuteBarRetentionPruneSizeLimit()
+  );
+}
+
+function pruneMinuteBarsForSymbol(
+  symbol: string,
+  symbolBars: Map<number, CachedBar>,
+  nowMs: number,
+): void {
+  const retentionBoundary = minuteBarRetentionBoundaryMs(nowMs);
+  let scanned = 0;
+  for (const key of symbolBars.keys()) {
+    scanned += 1;
+    if (key < retentionBoundary) {
+      symbolBars.delete(key);
+    }
+  }
+  minuteBarRetentionPruneRunCount += 1;
+  lastMinuteBarRetentionPruneScannedBarCount = scanned;
+  if (symbolBars.size) {
+    minuteBarLastPrunedAtMsBySymbol.set(symbol, nowMs);
+  } else {
+    minuteBarsBySymbol.delete(symbol);
+    minuteBarLastPrunedAtMsBySymbol.delete(symbol);
+  }
+}
+
 function storeMinuteBar(bar: CachedBar): void {
   const timestamp = dateOrNull(bar.timestamp);
   if (!timestamp) {
@@ -719,11 +770,9 @@
   symbolBars.set(timestamp.getTime(), bar);
   minuteBarsBySymbol.set(bar.symbol, symbolBars);
 
-  const retentionBoundary = Date.now() - memoryRetentionMs();
-  for (const key of symbolBars.keys()) {
-    if (key < retentionBoundary) {
-      symbolBars.delete(key);
-    }
+  const nowMs = Date.now();
+  if (shouldPruneMinuteBarsForSymbol(bar.symbol, symbolBars, nowMs)) {
+    pruneMinuteBarsForSymbol(bar.symbol, symbolBars, nowMs);
   }
 }
 
@@ -891,7 +940,10 @@
   includeProvisional?: boolean;
 }): CachedBar[] {
   const symbol = normalizeSymbol(input.symbol).toUpperCase();
-  const minuteBars = Array.from(minuteBarsBySymbol.get(symbol)?.values() ?? []);
+  const retentionBoundary = minuteBarRetentionBoundaryMs(Date.now());
+  const minuteBars = Array.from(
+    minuteBarsBySymbol.get(symbol)?.values() ?? [],
+  ).filter((bar) => bar.timestamp.getTime() >= retentionBoundary);
   if (!minuteBars.length) {
     return [];
   }
@@ -1477,6 +1529,7 @@
     subscriptionSignature = "";
     trackedSymbols.clear();
     minuteBarsBySymbol.clear();
+    minuteBarLastPrunedAtMsBySymbol.clear();
     storedBarsCrossCycleCache.clear();
     storedBarsCacheKeysByBase.clear();
     pendingPersistBars.clear();
@@ -1493,6 +1546,8 @@
     lastPersistError = null;
     lastPersistErrorAt = null;
     lastEnqueueScannedBarCount = 0;
+    minuteBarRetentionPruneRunCount = 0;
+    lastMinuteBarRetentionPruneScannedBarCount = 0;
     liveAggregatePersistSkipCount = 0;
     lastLiveAggregatePersistSkippedAt = null;
     storedBarsCacheHitCount = 0;
@@ -1533,4 +1588,10 @@
   get lastEnqueueScannedBarCount(): number {
     return lastEnqueueScannedBarCount;
   },
+  get minuteBarRetentionPruneRunCount(): number {
+    return minuteBarRetentionPruneRunCount;
+  },
+  get lastMinuteBarRetentionPruneScannedBarCount(): number {
+    return lastMinuteBarRetentionPruneScannedBarCount;
+  },
 };
--- /tmp/wo-fix-04-signal-monitor-local-bar-cache.test.ts.before	2026-07-08 13:35:02.647247915 -0600
+++ artifacts/api-server/src/services/signal-monitor-local-bar-cache.test.ts	2026-07-08 13:37:52.246353269 -0600
@@ -7,6 +7,32 @@
 } from "./signal-monitor-local-bar-cache";
 import type { MassiveDelayedStockAggregate } from "./massive-stock-aggregate-stream";
 
+const MINUTE_MS = 60_000;
+
+function aggregateAtMs(
+  symbol: string,
+  startMs: number,
+): MassiveDelayedStockAggregate {
+  return {
+    eventType: "AM",
+    symbol,
+    open: 100,
+    high: 101,
+    low: 99,
+    close: 100.5,
+    volume: 10,
+    accumulatedVolume: null,
+    vwap: null,
+    sessionVwap: null,
+    officialOpen: null,
+    averageTradeSize: null,
+    startMs,
+    endMs: startMs + MINUTE_MS,
+    delayed: false,
+    source: "massive-websocket",
+  };
+}
+
 test("default memory retention spans a holiday weekend (>= 89.5h)", () => {
   // Fri 16:00 close -> Tue 09:30 open across a Monday holiday = 89.5h; the old 72h
   // default did not span it. The default applies only with the env override unset.
@@ -28,6 +54,91 @@
     }
   }
 });
+
+test("minute retention pruning is cadence-bound without serving stale memory bars", () => {
+  const internals = __signalMonitorLocalBarCacheInternalsForTests;
+  const previousRetention =
+    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
+  const previousPersist =
+    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
+  const realDateNow = Date.now;
+  const baseNowMs = Math.floor(realDateNow() / MINUTE_MS) * MINUTE_MS;
+
+  process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS = String(
+    2 * MINUTE_MS,
+  );
+  delete process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
+  internals.reset();
+  try {
+    const symbol = "PRUNECAD";
+
+    Date.now = () => baseNowMs;
+    internals.ingest(aggregateAtMs(symbol, baseNowMs - MINUTE_MS));
+    assert.equal(internals.minuteBarRetentionPruneRunCount, 1);
+    assert.equal(internals.lastMinuteBarRetentionPruneScannedBarCount, 1);
+
+    internals.ingest(aggregateAtMs(symbol, baseNowMs));
+    assert.equal(
+      internals.minuteBarRetentionPruneRunCount,
+      1,
+      "second insert inside the cadence window must not full-scan retained bars",
+    );
+    assert.equal(internals.lastMinuteBarRetentionPruneScannedBarCount, 1);
+
+    Date.now = () => baseNowMs + 3 * MINUTE_MS;
+    internals.ingest(aggregateAtMs(symbol, baseNowMs + 3 * MINUTE_MS));
+    assert.equal(
+      internals.minuteBarRetentionPruneRunCount,
+      1,
+      "expired bars may remain physically cached until the prune cadence fires",
+    );
+    assert.equal(getSignalMonitorLocalBarCacheDiagnostics().minuteBarCount, 3);
+
+    const visibleBeforeCadence = internals.readMemoryBars({
+      symbol,
+      timeframe: "1m",
+      evaluatedAt: new Date(baseNowMs + 4 * MINUTE_MS),
+      limit: 10,
+    });
+    assert.deepEqual(
+      visibleBeforeCadence.map((bar) => bar.timestamp.getTime()),
+      [baseNowMs + 3 * MINUTE_MS],
+    );
+
+    Date.now = () => baseNowMs + 5 * MINUTE_MS;
+    internals.ingest(aggregateAtMs(symbol, baseNowMs + 5 * MINUTE_MS));
+    assert.equal(internals.minuteBarRetentionPruneRunCount, 2);
+    assert.equal(internals.lastMinuteBarRetentionPruneScannedBarCount, 4);
+    assert.equal(getSignalMonitorLocalBarCacheDiagnostics().minuteBarCount, 2);
+
+    const visibleAfterCadence = internals.readMemoryBars({
+      symbol,
+      timeframe: "1m",
+      evaluatedAt: new Date(baseNowMs + 6 * MINUTE_MS),
+      limit: 10,
+    });
+    assert.deepEqual(
+      visibleAfterCadence.map((bar) => bar.timestamp.getTime()),
+      [baseNowMs + 3 * MINUTE_MS, baseNowMs + 5 * MINUTE_MS],
+    );
+  } finally {
+    Date.now = realDateNow;
+    internals.reset();
+    if (previousRetention === undefined) {
+      delete process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
+    } else {
+      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS =
+        previousRetention;
+    }
+    if (previousPersist === undefined) {
+      delete process.env
+        .PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
+    } else {
+      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES =
+        previousPersist;
+    }
+  }
+});
 
 test("signal monitor local bar cache warms from durable massive history", () => {
   const sources =
```

## Test Output

Command:

```sh
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-local-bar-cache-rollup.test.ts src/services/signal-monitor-local-bar-cache.test.ts src/services/signal-monitor-local-bar-cache-persist.test.ts src/services/signal-monitor-local-bar-cache-prefetch.test.ts
```

Output:

```text
{"level":40,"time":1783539522038,"pid":111617,"hostname":"repl","err":{"type":"Error","message":"simulated persist failure","stack":"Error: simulated persist failure\n    at <anonymous> (/home/runner/workspace/artifacts/api-server/src/services/signal-monitor-local-bar-cache-persist.test.ts:264:13)\n    at flushPendingPersistBars (/home/runner/workspace/artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts:1263:28)\n    at Object.flushNow (/home/runner/workspace/artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts:1582:11)\n    at TestContext.<anonymous> (/home/runner/workspace/artifacts/api-server/src/services/signal-monitor-local-bar-cache-persist.test.ts:274:21)\n    at Test.runInAsyncScope (node:async_hooks:214:14)\n    at Test.run (node:internal/test_runner/test:1106:25)\n    at Test.processPendingSubtests (node:internal/test_runner/test:788:18)\n    at Test.postRun (node:internal/test_runner/test:1235:19)\n    at Test.run (node:internal/test_runner/test:1163:12)\n    at async Test.processPendingSubtests (node:internal/test_runner/test:788:7)"},"msg":"Signal monitor local bar cache persist failed"}
✔ live aggregate persistence is opt-in so realtime bars do not write-through to bar_cache by default (1.608485ms)
✔ flush drains the full pending backlog and counts every unique bar (40.918819ms)
✔ flush merges every queued (symbol,timeframe,source) into a single mixed write call (2.737621ms)
✔ flush persists pending bar_cache writes while API pressure is high (1.182692ms)
✔ flush requeues only the failed entries from the single mixed write, no double-count on retry (8.58271ms)
✔ database-backed Signal Matrix evaluation uses the stored-bars prefetch (14486.006523ms)
✔ loadSignalMonitorLocalBarCache is identical with and without the batch prefetch (426.785679ms)
✔ a mismatched evaluatedAt/limit falls through to the per-symbol path identically (222.578951ms)
✔ readStoredBars accounts prefetch hits vs per-symbol fallback by reason (162.587115ms)
✔ the cross-cycle prefetch cache avoids repeated full bar_cache reads (99.999845ms)
✔ above-high-water persisted bars use the delta reader instead of full reload (181.960923ms)
✔ below-high-water persisted changes invalidate the affected source cell (91.564117ms)
✔ high API pressure does not suppress stored-bar DB augmentation (35.15523ms)
✔ stored-bar prefetch chunks broad symbol batches by row budget before reading bar_cache (90.555775ms)
✔ stored-bar prefetch no longer has a fixed 32-symbol ceiling (79.283231ms)
✔ stored-bar prefetch shrinks high-limit full reads down to the 8-symbol floor (88.635537ms)
✔ full-read symbol batch size never drops below the 8-symbol floor (58.564797ms)
✔ default stored-bar cache holds the normal full-universe prefetch footprint (249.097582ms)
✔ delta reads batch by the wide delta constant, not the limit-based full-read size (343.603478ms)
✔ stored-bar prefetch uses bounded concurrency (176.06188ms)
✔ stored-bar prefetch defaults to one durable read at a time (86.519565ms)
✔ behavior preserved: deterministic multi-hour ingest rolls up exactly across timeframes (7.386266ms)
✔ disabled live aggregate persistence skips per-aggregate rollup scan work (0.506894ms)
✔ bound: per-aggregate scan is bounded by the recent session window, not deep history (144.866807ms)
✔ default memory retention spans a holiday weekend (>= 89.5h) (0.801339ms)
✔ minute retention pruning is cadence-bound without serving stale memory bars (1.69365ms)
✔ signal monitor local bar cache warms from durable massive history (0.344066ms)
✔ signal monitor local bar cache rolls up sparse completed hourly buckets (0.431563ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 77084.162343
```

## Correctness Argument

Observed consumers of in-memory minute bars are `readMemoryBars`, `readSignalMonitorLocalMemoryBars`, `loadSignalMonitorLocalBarCache`, and `enqueueRollups`.

`readSignalMonitorLocalMemoryBars` and `loadSignalMonitorLocalBarCache` both flow through `readMemoryBars`; that function now applies the retention boundary before rollup, so delayed physical pruning cannot serve expired bars.

`enqueueRollups` does not rely on retention pruning for correctness: it builds its rollup input from bars whose timestamps are at or after `rollupScanCutoffMs(evaluatedAt)`. Bars older than the rollup window are excluded independently of whether the retention prune has physically deleted them.

The cadence is 5 minutes. With normal one-minute aggregate keys, steady in-order ingest can physically retain only about five extra minutes of stale keys per symbol before the next cadence prune. The size trigger is `ceil(retentionMs / 1m) + ceil(5m / 1m)`, so bursty or out-of-order ingest that grows beyond the expected retention window still forces a scan before the cadence. I kept the scan timestamp-based rather than insertion-order-based because cached bars are keyed by aggregate `startMs`, and ingest can arrive out of timestamp order.
