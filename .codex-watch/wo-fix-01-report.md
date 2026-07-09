# WO-FIX-01 Report

Added an early return at the top of `enqueueRollups` when live-aggregate persistence is disabled, so incoming aggregates update the same skip diagnostics cheaply and avoid the recent-window scan plus rollup work. `queuePersist` remains guarded for any future caller. Added a regression test for the disabled-persistence path and updated the existing scan-bound test to opt into live persistence because it intentionally measures scan work.

## Fix-Hunk Unified Diff

```diff
--- a/artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts
+++ b/artifacts/api-server/src/services/signal-monitor-local-bar-cache.ts
@@ -1295,6 +1295,12 @@
 }
 
 function enqueueRollups(symbol: string, evaluatedAt: Date): void {
+  if (!liveAggregatePersistEnabled()) {
+    liveAggregatePersistSkipCount += 1;
+    lastLiveAggregatePersistSkippedAt = new Date();
+    lastEnqueueScannedBarCount = 0;
+    return;
+  }
   const symbolBars = minuteBarsBySymbol.get(symbol);
   if (!symbolBars?.size) {
     lastEnqueueScannedBarCount = 0;
```

```diff
--- a/artifacts/api-server/src/services/signal-monitor-local-bar-cache-rollup.test.ts
+++ b/artifacts/api-server/src/services/signal-monitor-local-bar-cache-rollup.test.ts
@@ -1,7 +1,10 @@
 import assert from "node:assert/strict";
 import test from "node:test";
 
-import { __signalMonitorLocalBarCacheInternalsForTests } from "./signal-monitor-local-bar-cache";
+import {
+  __signalMonitorLocalBarCacheInternalsForTests,
+  getSignalMonitorLocalBarCacheDiagnostics,
+} from "./signal-monitor-local-bar-cache";
 import type { MassiveDelayedStockAggregate } from "./massive-stock-aggregate-stream";
 
 const internals = __signalMonitorLocalBarCacheInternalsForTests;
@@ -188,6 +191,40 @@
   }
 });
 
+test("disabled live aggregate persistence skips per-aggregate rollup scan work", () => {
+  const previousPersist =
+    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
+  delete process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
+  internals.reset();
+  try {
+    internals.ingest(
+      aggregateAtMinute("SKIPSCAN", Date.now() - MINUTE_MS, 0, {
+        open: 100,
+        high: 101,
+        low: 99,
+        close: 100.5,
+        volume: 10,
+      }),
+    );
+
+    const diagnostics = getSignalMonitorLocalBarCacheDiagnostics();
+    assert.equal(diagnostics.liveAggregatePersistEnabled, false);
+    assert.equal(internals.lastEnqueueScannedBarCount, 0);
+    assert.equal(diagnostics.pendingPersistBarCount, 0);
+    assert.equal(diagnostics.liveAggregatePersistSkipCount, 1);
+    assert.notEqual(diagnostics.lastLiveAggregatePersistSkippedAt, null);
+  } finally {
+    internals.reset();
+    if (previousPersist === undefined) {
+      delete process.env
+        .PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
+    } else {
+      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES =
+        previousPersist;
+    }
+  }
+});
+
 test("bound: per-aggregate scan is bounded by the recent session window, not deep history", () => {
   // The rollup scan window is session-aware: intra-session it is the 4h recent
   // window, but right after a weekend/holiday reopen it reaches back across the
@@ -198,9 +235,12 @@
   // history. Retain far more than the deep block so nothing is pruned.
   const previousRetention =
     process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
+  const previousPersist =
+    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
   process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS = String(
     400 * 60 * 60_000,
   );
+  process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES = "1";
   internals.reset();
   try {
     const symbol = "DEEP";
@@ -282,5 +322,12 @@
       process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS =
         previousRetention;
     }
+    if (previousPersist === undefined) {
+      delete process.env
+        .PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
+    } else {
+      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES =
+        previousPersist;
+    }
   }
 });
```

## Test Output

Command:

```sh
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-local-bar-cache-rollup.test.ts src/services/signal-monitor-local-bar-cache.test.ts
```

Output:

```text
✔ behavior preserved: deterministic multi-hour ingest rolls up exactly across timeframes (23.784697ms)
✔ disabled live aggregate persistence skips per-aggregate rollup scan work (2.168896ms)
✔ bound: per-aggregate scan is bounded by the recent session window, not deep history (272.544074ms)
✔ default memory retention spans a holiday weekend (>= 89.5h) (1.30017ms)
✔ signal monitor local bar cache warms from durable massive history (0.40741ms)
✔ signal monitor local bar cache rolls up sparse completed hourly buckets (4.50089ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4962.876149
```

## Out Of Scope

Observed pre-existing dirty hunks in both requested target files before editing. Observed `artifacts/api-server/src/services/signal-monitor-local-bar-cache.test.ts` already modified in `git status`; it was included in the required test command and was not edited for this fix.
