## FIX A

What/why: Added a scan-abort checkpoint inside the signal-options monitor universe readiness loop and threaded the existing scan `AbortSignal` into that helper. Observed the main action loops already checkpoint per position and per signal in `runSignalOptionsShadowScanUnlocked`, so this hunk avoids duplicating those checks and covers the remaining scan-local per-symbol loop.

Unified diff:

```diff
--- a/artifacts/api-server/src/services/signal-options-automation.ts
+++ b/artifacts/api-server/src/services/signal-options-automation.ts
@@ -6137,6 +6137,7 @@
   evaluated: unknown;
   universe: Set<string>;
   now?: Date;
+  signal?: AbortSignal;
 }) {
   const evaluated = asRecord(input.evaluated);
   const profile = asRecord(evaluated.profile);
@@ -6171,6 +6172,7 @@
         .filter(Boolean),
     );
     for (const symbol of input.universe) {
+      throwIfSignalOptionsScanAborted(input.signal);
       if (!stateSymbols.has(symbol)) {
         return true;
       }
@@ -6288,6 +6290,7 @@
     const monitorStateNeedsRefresh = shouldRefreshSignalOptionsMonitorState({
       evaluated: stored,
       universe: input.universe,
+      signal: input.signal,
     });
     if (
       input.forceEvaluate !== true &&
--- a/artifacts/api-server/src/services/signal-options-automation.test.ts
+++ b/artifacts/api-server/src/services/signal-options-automation.test.ts
@@ -569,6 +569,40 @@
   );
 });
 
+test("Signal Options monitor refresh stops mid-universe scan when aborted", () => {
+  const { shouldRefreshSignalOptionsMonitorState } =
+    __signalOptionsAutomationInternalsForTests;
+  const controller = new AbortController();
+  const now = "2026-06-09T16:40:00.000Z";
+  const universe = {
+    size: 3,
+    has: () => true,
+    *[Symbol.iterator]() {
+      yield "AAA";
+      controller.abort(new Error("mid-batch abort"));
+      yield "BBB";
+    },
+  } as unknown as Set<string>;
+
+  assert.throws(
+    () =>
+      shouldRefreshSignalOptionsMonitorState({
+        evaluated: {
+          profile: { id: "runtime-fallback-test", timeframe: "5m" },
+          states: [
+            signalState("AAA", now),
+            signalState("BBB", now),
+            signalState("CCC", now),
+          ],
+        },
+        universe,
+        now: new Date(now),
+        signal: controller.signal,
+      }),
+    /mid-batch abort/,
+  );
+});
+
 test("Signal Options action states require canonical signal monitor events", () => {
   const states = [
     signalState("AERO", "2026-06-09T16:35:00.000Z", "sell"),
```

Test output:

```text
$ pnpm --filter @workspace/api-server exec tsx --test --test-name-pattern "Signal Options monitor refresh stops mid-universe scan when aborted" src/services/signal-options-automation.test.ts
✔ Signal Options monitor refresh stops mid-universe scan when aborted (1.617481ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4090.065312
```

Touched automation suite output:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts
✔ Signal Options monitor refresh stops mid-universe scan when aborted (0.346769ms)
✔ Signal Options monitor batch cursor resumes at the first unprocessed symbol after abort (3.808073ms)
ℹ tests 47
ℹ suites 0
ℹ pass 46
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6210.932771

✖ failing tests:

✖ MTF entry gate honors configured requiredCount instead of forcing unanimity (9.779763ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  3 !== 2

      at TestContext.<anonymous> (/home/runner/workspace/artifacts/api-server/src/services/signal-options-automation.test.ts:1359:10)
```

## FIX B

What/why: Kept `SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS` and explicit `scanTimeoutMs` as absolute overrides, but when unset the default timeout now scales from the deployment runtime's last active-position count. This preserves timeout classification/backoff behavior while giving open-position scans more time under load, capped at 300 seconds.

Unified diff:

```diff
--- a/artifacts/api-server/src/services/signal-options-worker.ts
+++ b/artifacts/api-server/src/services/signal-options-worker.ts
@@ -37,6 +37,8 @@
   1_000,
 );
 const DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS = 120_000;
+const DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MAX_MS = 300_000;
+const DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_POSITION_MS = 3_000;
 const SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MIN_MS = 1_000;
 const SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MAX_MS = 3_600_000;
 const SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_REASON = "worker_scan_timeout";
@@ -72,7 +74,7 @@
   clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
   now: () => Date;
   logger: WorkerLogger;
-  scanTimeoutMs: number | null;
+  scanTimeoutMs?: number | null | false;
   subscribeCockpitChanges: typeof subscribeAlgoCockpitChanges;
 };
 
@@ -294,14 +296,30 @@
     : fallback;
 }
 
-function resolveWorkerScanTimeoutMs(value: unknown): number | null {
+function resolveDefaultWorkerScanTimeoutMs(activePositionCount: unknown) {
+  const count = Math.max(0, Math.floor(numeric(activePositionCount) ?? 0));
+  return Math.min(
+    DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MAX_MS,
+    Math.max(
+      DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS,
+      DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS +
+        count * DEFAULT_SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_POSITION_MS,
+    ),
+  );
+}
+
+export function resolveWorkerScanTimeoutMs(
+  value: unknown,
+  activePositionCount = 0,
+  envValue = process.env["SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS"],
+): number | null {
   if (value === null || value === false) {
     return null;
   }
-  const configured =
-    value === undefined
-      ? process.env["SIGNAL_OPTIONS_WORKER_SCAN_TIMEOUT_MS"]
-      : value;
+  const configured = value === undefined ? envValue : value;
+  if (configured === undefined) {
+    return resolveDefaultWorkerScanTimeoutMs(activePositionCount);
+  }
   if (configured === null || configured === "" || configured === "0") {
     return null;
   }
@@ -426,7 +444,7 @@
     clearTimer: options.clearTimer ?? clearTimeout,
     now: options.now ?? (() => new Date()),
     logger: options.logger ?? logger,
-    scanTimeoutMs: resolveWorkerScanTimeoutMs(options.scanTimeoutMs),
+    scanTimeoutMs: options.scanTimeoutMs,
     subscribeCockpitChanges:
       options.subscribeCockpitChanges ?? subscribeAlgoCockpitChanges,
   };
@@ -435,6 +453,7 @@
 async function runDeploymentScanWithTimeout(input: {
   deployment: AlgoDeployment;
   dependencies: WorkerDependencies;
+  activePositionCount: number;
   skipEntryWork?: boolean;
 }): Promise<unknown> {
   const { deployment, dependencies } = input;
@@ -451,7 +470,10 @@
   });
   scanPromise.catch(() => {});
 
-  const timeoutMs = dependencies.scanTimeoutMs;
+  const timeoutMs = resolveWorkerScanTimeoutMs(
+    dependencies.scanTimeoutMs,
+    input.activePositionCount,
+  );
   if (timeoutMs === null) {
     return scanPromise;
   }
@@ -509,6 +531,7 @@
     const scanResult = await runDeploymentScanWithTimeout({
       deployment,
       dependencies,
+      activePositionCount: runtime.lastActivePositionCount,
       skipEntryWork: input.skipEntryWork === true,
     });
     if (isScanAlreadyRunningResult(scanResult)) {
--- a/artifacts/api-server/src/services/background-worker-pressure.test.ts
+++ b/artifacts/api-server/src/services/background-worker-pressure.test.ts
@@ -6,7 +6,10 @@
   __resetApiResourcePressureForTests,
   updateApiResourcePressure,
 } from "./resource-pressure";
-import { createSignalOptionsWorker } from "./signal-options-worker";
+import {
+  createSignalOptionsWorker,
+  resolveWorkerScanTimeoutMs,
+} from "./signal-options-worker";
 import type { OvernightSpotWorkerDeployment } from "./overnight-spot-execution";
 import { createOvernightSpotWorker } from "./overnight-spot-worker";
 import { createSignalMonitorEvaluationWorker } from "./signal-monitor-evaluation-worker";
@@ -183,6 +186,15 @@
   __resetApiResourcePressureForTests();
 });
 
+test("signal-options worker default scan timeout scales with active positions unless overridden", () => {
+  assert.equal(resolveWorkerScanTimeoutMs(undefined, 0, undefined), 120_000);
+  assert.equal(resolveWorkerScanTimeoutMs(undefined, 10, undefined), 150_000);
+  assert.equal(resolveWorkerScanTimeoutMs(undefined, 100, undefined), 300_000);
+  assert.equal(resolveWorkerScanTimeoutMs("45000", 100, undefined), 45_000);
+  assert.equal(resolveWorkerScanTimeoutMs(undefined, 100, "45000"), 45_000);
+  assert.equal(resolveWorkerScanTimeoutMs(null, 100, undefined), null);
+});
+
 test("signal-options worker keeps scanning when signal evaluation is passive", async () => {
   normalPressureSnapshot();
   let maintenanceCount = 0;
```

Test output:

```text
$ pnpm --filter @workspace/api-server exec tsx --test --test-name-pattern "signal-options worker default scan timeout scales with active positions unless overridden" src/services/background-worker-pressure.test.ts
✔ signal-options worker default scan timeout scales with active positions unless overridden (0.967245ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2951.964255
```

Touched worker suite output:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/background-worker-pressure.test.ts
✔ signal-options worker degrades to a positions-only scan under high resource pressure (does not fully pause) (10.648355ms)
✔ signal-options worker scans enabled deployments with bounded action work (3.324552ms)
✔ signal-options worker default scan timeout scales with active positions unless overridden (0.159597ms)
✔ signal-options worker keeps scanning when signal evaluation is passive (6.205453ms)
✔ signal monitor worker stays idle in passive mode (0.762151ms)
✔ overnight spot worker degrades to an exit-only scan under high resource pressure (outside RTH) (1.213977ms)
✔ entry work runs on every tick under sustained hard block (no pressure gate) (7.953823ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7037.613168
```

## FIX C

What/why: Changed the monitor batch cursor so planning a batch no longer persists the planned tail as completed; a new helper advances the cursor only when the current cursor symbol is marked processed. Observed `shouldBatchSignalOptionsWorkerMonitorRefresh` currently returns false at `signal-options-automation.ts:6160` and the live path uses `resolveSignalOptionsMonitorFullRefresh` at `:6398`, so this hunk corrects cursor storage without re-enabling dormant batching or changing live trade behavior.

Unified diff:

```diff
--- a/artifacts/api-server/src/services/signal-options-automation.ts
+++ b/artifacts/api-server/src/services/signal-options-automation.ts
@@ -6101,7 +6101,7 @@
   const nextIndex = (startIndex + batchSize) % uniqueSymbols.length;
   signalOptionsMonitorBatchCursors.set(cursorKey, {
     signature,
-    nextIndex,
+    nextIndex: startIndex,
   });
 
   return {
@@ -6114,6 +6114,33 @@
   };
 }
 
+function rememberSignalOptionsMonitorBatchSymbolProcessed(input: {
+  deploymentId: string;
+  universe: Set<string>;
+  symbol: string;
+}) {
+  const uniqueSymbols = normalizeSignalOptionsMonitorUniverseSymbols(
+    input.universe,
+  );
+  if (!uniqueSymbols.length) {
+    return;
+  }
+  const signature = uniqueSymbols.join("|");
+  const current = signalOptionsMonitorBatchCursors.get(input.deploymentId);
+  if (current?.signature !== signature) {
+    return;
+  }
+  const currentIndex = current.nextIndex % uniqueSymbols.length;
+  const symbol = normalizeSymbol(input.symbol).toUpperCase();
+  if (!symbol || uniqueSymbols[currentIndex] !== symbol) {
+    return;
+  }
+  signalOptionsMonitorBatchCursors.set(input.deploymentId, {
+    signature,
+    nextIndex: (currentIndex + 1) % uniqueSymbols.length,
+  });
+}
+
 function resolveSignalOptionsWorkerMonitorBatchCapacity(
   profile: SignalMonitorProfileRow,
 ): number {
@@ -21403,6 +21430,7 @@
   shouldRecordPositionMarkSkip,
   createSignalOptionsActionWorkBudget,
   resolveSignalOptionsMonitorBatch,
+  rememberSignalOptionsMonitorBatchSymbolProcessed,
   resolveSignalOptionsWorkerMonitorBatchCapacity,
   resolveSignalOptionsMonitorFullRefresh,
   shouldBatchSignalOptionsWorkerMonitorRefresh,
--- a/artifacts/api-server/src/services/signal-options-automation.test.ts
+++ b/artifacts/api-server/src/services/signal-options-automation.test.ts
@@ -603,6 +603,42 @@
   );
 });
 
+test("Signal Options monitor batch cursor resumes at the first unprocessed symbol after abort", () => {
+  const {
+    resolveSignalOptionsMonitorBatch,
+    rememberSignalOptionsMonitorBatchSymbolProcessed,
+  } = __signalOptionsAutomationInternalsForTests;
+  const deploymentId = `cursor-resume-${Date.now()}`;
+  const universe = new Set(["AAA", "BBB", "CCC", "DDD"]);
+  const profile = {} as never;
+
+  const planned = resolveSignalOptionsMonitorBatch({
+    deploymentId,
+    universe,
+    profile,
+    capacity: 2,
+  });
+  assert.deepEqual(planned.symbols, ["AAA", "BBB"]);
+  assert.equal(planned.startIndex, 0);
+  assert.equal(planned.nextIndex, 2);
+
+  rememberSignalOptionsMonitorBatchSymbolProcessed({
+    deploymentId,
+    universe,
+    symbol: "AAA",
+  });
+
+  const resumed = resolveSignalOptionsMonitorBatch({
+    deploymentId,
+    universe,
+    profile,
+    capacity: 2,
+  });
+  assert.deepEqual(resumed.symbols, ["BBB", "CCC"]);
+  assert.equal(resumed.startIndex, 1);
+  assert.equal(resumed.nextIndex, 3);
+});
+
 test("Signal Options action states require canonical signal monitor events", () => {
   const states = [
     signalState("AERO", "2026-06-09T16:35:00.000Z", "sell"),
```

Test output:

```text
$ pnpm --filter @workspace/api-server exec tsx --test --test-name-pattern "Signal Options monitor batch cursor resumes at the first unprocessed symbol after abort" src/services/signal-options-automation.test.ts
✔ Signal Options monitor batch cursor resumes at the first unprocessed symbol after abort (2.695568ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7404.69634
```

Touched automation suite output:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts
✔ Signal Options monitor refresh stops mid-universe scan when aborted (0.346769ms)
✔ Signal Options monitor batch cursor resumes at the first unprocessed symbol after abort (3.808073ms)
ℹ tests 47
ℹ suites 0
ℹ pass 46
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6210.932771

✖ failing tests:

✖ MTF entry gate honors configured requiredCount instead of forcing unanimity (9.779763ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  3 !== 2

      at TestContext.<anonymous> (/home/runner/workspace/artifacts/api-server/src/services/signal-options-automation.test.ts:1359:10)
```
