# WO-FIX-09 Report

## Prechecks

- Observed `git status --porcelain -- artifacts/api-server/src/services/signal-options-worker.ts artifacts/api-server/src/services/signal-options-automation.ts .codex-watch/wo-fix-09-report.md` returned no rows before editing.
- Observed `requestSignalOptionsWorkerScanSoon` had zero repo importers before removal; after removal it appears only in the work-order doc.
- Observed `getResourcePressure` in Signal Options was only the injected/stored worker dependency before removal. Remaining `getResourcePressure` hits are the unrelated Overnight worker path/tests.

## FIX A - Relic kills

What/why:
- Removed the dead Signal Options worker `getResourcePressure` dependency and default resource-pressure import.
- Removed the exported-but-dead `requestSignalOptionsWorkerScanSoon`.
- Removed now-excess Signal Options worker pressure stubs from the worker pressure tests while preserving pressure snapshot setup in scenarios that assert the no-pressure-gate behavior.

```diff
diff --git a/artifacts/api-server/src/services/background-worker-pressure.test.ts b/artifacts/api-server/src/services/background-worker-pressure.test.ts
index b9b68f3b..1a883011 100644
--- a/artifacts/api-server/src/services/background-worker-pressure.test.ts
+++ b/artifacts/api-server/src/services/background-worker-pressure.test.ts
@@ -62,7 +62,7 @@ function signalOptionsDeployment(
 }
 
 test("signal-options worker degrades to a positions-only scan under high resource pressure (does not fully pause)", async () => {
-  const pressure = highFiniteResourcePressureSnapshot();
+  highFiniteResourcePressureSnapshot();
   let maintenanceCount = 0;
   const scanCalls: Record<string, unknown>[] = [];
   const releaseLock = async () => {};
@@ -78,7 +78,6 @@ test("signal-options worker degrades to a positions-only scan under high resourc
       maintenanceCount += 1;
       return {};
     },
-    getResourcePressure: () => pressure,
     acquireTickLock: async () => releaseLock,
     now: () => new Date("2026-06-09T18:41:00.000Z"),
     logger: noopLogger,
@@ -145,7 +144,6 @@ test("signal-options worker scans enabled deployments with bounded action work",
       };
     },
     runMaintenance: async () => ({}),
-    getResourcePressure: normalPressureSnapshot,
     acquireTickLock: async () => async () => {
       releaseCount += 1;
     },
@@ -212,7 +210,6 @@ test("signal-options worker keeps scanning when signal evaluation is passive", a
       maintenanceCount += 1;
       return {};
     },
-    getResourcePressure: normalPressureSnapshot,
     acquireTickLock: async () => releaseLock,
     now: () => new Date("2026-06-09T18:41:00.000Z"),
     logger: noopLogger,
@@ -314,7 +311,7 @@ test("overnight spot worker degrades to an exit-only scan under high resource pr
 });
 
 test("entry work runs on every tick under sustained hard block (no pressure gate)", async () => {
-  const pressure = highFiniteResourcePressureSnapshot();
+  highFiniteResourcePressureSnapshot();
   const scanCalls: Record<string, unknown>[] = [];
   let nowMs = new Date("2026-06-09T18:41:00.000Z").getTime();
 
@@ -325,7 +322,6 @@ test("entry work runs on every tick under sustained hard block (no pressure gate
       return {};
     },
     runMaintenance: async () => ({}),
-    getResourcePressure: () => pressure,
     acquireTickLock: async () => async () => {},
     now: () => new Date(nowMs),
     logger: noopLogger,
diff --git a/artifacts/api-server/src/services/signal-options-worker.ts b/artifacts/api-server/src/services/signal-options-worker.ts
index 63204a89..198a0298 100644
--- a/artifacts/api-server/src/services/signal-options-worker.ts
+++ b/artifacts/api-server/src/services/signal-options-worker.ts
@@ -2,10 +2,6 @@ import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
 import { sharedAdvisoryLockHolder, type AlgoDeployment } from "@workspace/db";
 import { logger } from "../lib/logger";
 import { subscribeAlgoCockpitChanges } from "./algo-cockpit-events";
-import {
-  getApiResourcePressureSnapshot,
-  type ApiResourcePressureSnapshot,
-} from "./resource-pressure";
 import {
   listEnabledSignalOptionsDeployments,
   runSignalOptionsShadowScan,
@@ -68,7 +64,6 @@ type WorkerDependencies = {
     signal?: AbortSignal;
   }) => Promise<unknown>;
   runMaintenance: (input: { source: "worker" }) => Promise<unknown>;
-  getResourcePressure: () => ApiResourcePressureSnapshot;
   acquireTickLock: () => Promise<ReleaseLock | null>;
   setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
   clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
@@ -437,8 +432,6 @@ function defaultDependencies(
       options.listDeployments ?? listEnabledSignalOptionsDeployments,
     scanDeployment: options.scanDeployment ?? runSignalOptionsShadowScan,
     runMaintenance: options.runMaintenance ?? runShadowOptionMaintenance,
-    getResourcePressure:
-      options.getResourcePressure ?? getApiResourcePressureSnapshot,
     acquireTickLock: options.acquireTickLock ?? acquirePostgresAdvisoryLock,
     setTimer: options.setTimer ?? setTimeout,
     clearTimer: options.clearTimer ?? clearTimeout,
@@ -929,8 +922,4 @@ export function stopSignalOptionsWorker(): void {
   defaultWorker.stop();
 }
 
-export function requestSignalOptionsWorkerScanSoon(): void {
-  defaultWorker.requestRunSoon();
-}
-
 export { getSignalOptionsWorkerSnapshot };
```

## FIX B - Scoped reader for worker signal_refresh

What/why:
- Added a worker-only stored-state reader path so `source: "worker"` + `preferStoredMonitorState: true` uses `listSignalOptionsStoredSignalStatesFast` for the deployment universe instead of `getSignalMonitorStoredState`.
- Preserved manual/cockpit reads by leaving non-worker/non-preferred paths on `getSignalMonitorStoredState`.
- Extended the fast reader return shape with the profile object and `stateSource`, because downstream worker scan code consumes `profile.timeframe`, `profile.freshWindowBars`, and `profile.pyrusSignalsSettings`.
- Added a PGlite-backed test proving the worker refresh returns only deployment-scoped stored states, uses the `limit(500)` fast query seam, and keeps fields needed by worker summary/action candidate consumers.

```diff
diff --git a/artifacts/api-server/src/services/signal-options-automation.test.ts b/artifacts/api-server/src/services/signal-options-automation.test.ts
index b4b476d7..a1ae204a 100644
--- a/artifacts/api-server/src/services/signal-options-automation.test.ts
+++ b/artifacts/api-server/src/services/signal-options-automation.test.ts
@@ -2,7 +2,13 @@ import assert from "node:assert/strict";
 import { readFileSync } from "node:fs";
 import test from "node:test";
 
-import type { ExecutionEvent } from "@workspace/db";
+import {
+  signalMonitorSymbolStatesTable,
+  type AlgoDeployment,
+  type ExecutionEvent,
+} from "@workspace/db";
+import { withTestDb } from "@workspace/db/testing";
+import { sql } from "drizzle-orm";
 import {
   __signalOptionsAutomationInternalsForTests,
   evaluateMtfPatternGate,
@@ -326,6 +332,161 @@ test("Signal Options performance refresh avoids full dashboard hydration", () =>
   assert.doesNotMatch(body, /getSignalOptionsDashboardSnapshot/);
 });
 
+test("Signal Options worker signal_refresh uses the deployment-scoped stored-state reader", async () => {
+  const fastReaderStart = source.indexOf(
+    "async function listSignalOptionsStoredSignalStatesFast",
+  );
+  const fastReaderEnd = source.indexOf(
+    "\nfunction resolveSignalOptionsMonitorFullRefresh",
+    fastReaderStart,
+  );
+  assert.notEqual(fastReaderStart, -1, "Missing fast stored-state reader");
+  assert.notEqual(fastReaderEnd, -1, "Missing fast reader boundary");
+  const fastReader = source.slice(fastReaderStart, fastReaderEnd);
+  assert.match(
+    fastReader,
+    /inArray\(signalMonitorSymbolStatesTable\.symbol, universeSymbols\)/,
+    "fast reader must scope signal states to the deployment universe",
+  );
+  assert.match(fastReader, /\.limit\(500\)/, "fast reader must keep the row cap");
+
+  await withTestDb(async ({ db }) => {
+    let symbolStateSelects = 0;
+    let symbolStateLimit: unknown = null;
+    const realSelect = db.select.bind(db);
+    (db as unknown as { select: (...args: unknown[]) => unknown }).select = (
+      ...args: unknown[]
+    ) => {
+      const builder = realSelect(...(args as [])) as {
+        from: (...fromArgs: unknown[]) => unknown;
+      };
+      const realFrom = builder.from.bind(builder);
+      builder.from = (...fromArgs: unknown[]) => {
+        const query = realFrom(...fromArgs) as {
+          limit?: (...limitArgs: unknown[]) => unknown;
+        };
+        if (fromArgs[0] === signalMonitorSymbolStatesTable) {
+          symbolStateSelects += 1;
+          if (typeof query.limit === "function") {
+            const realLimit = query.limit.bind(query);
+            query.limit = (...limitArgs: unknown[]) => {
+              symbolStateLimit = limitArgs[0];
+              return realLimit(...limitArgs);
+            };
+          }
+        }
+        return query;
+      };
+      return builder;
+    };
+
+    const profileId = "00000000-0000-4000-8000-000000000909";
+    const evaluatedAt = new Date();
+    const latestBarAt = new Date(evaluatedAt.getTime() - 5 * 60_000);
+    const deployment = {
+      id: "00000000-0000-4000-8000-000000000919",
+      name: "Scoped Signal Options Worker",
+      enabled: true,
+      mode: "shadow",
+      providerAccountId: "shadow",
+      symbolUniverse: ["AAPL"],
+      config: { signalOptions: {} },
+      updatedAt: evaluatedAt,
+    } as unknown as AlgoDeployment;
+
+    await db.execute(sql`
+      INSERT INTO signal_monitor_profiles
+        (id, environment, enabled, timeframe, pyrus_signals_settings, fresh_window_bars, last_evaluated_at)
+      VALUES
+        (${profileId}, 'shadow', true, '5m', ${JSON.stringify({ alpha: "kept" })}::jsonb, 3, ${evaluatedAt.toISOString()}::timestamptz)
+    `);
+    await db.execute(sql`
+      INSERT INTO signal_monitor_symbol_states
+        (id, profile_id, symbol, timeframe, current_signal_direction, current_signal_at, current_signal_price,
+         latest_bar_at, bars_since_signal, fresh, status, active, last_evaluated_at)
+      VALUES
+        ('00000000-0000-4000-8000-000000000910', ${profileId}, 'AAPL', '5m', 'buy',
+         ${latestBarAt.toISOString()}::timestamptz, 187.12, ${latestBarAt.toISOString()}::timestamptz,
+         0, true, 'ok', true, ${evaluatedAt.toISOString()}::timestamptz),
+        ('00000000-0000-4000-8000-000000000911', ${profileId}, 'MSFT', '5m', 'sell',
+         ${latestBarAt.toISOString()}::timestamptz, 412.34, ${latestBarAt.toISOString()}::timestamptz,
+         0, true, 'ok', true, ${evaluatedAt.toISOString()}::timestamptz)
+    `);
+
+    const universe = new Set(["AAPL"]);
+    const result =
+      await __signalOptionsAutomationInternalsForTests.loadSignalOptionsMonitorState({
+        deployment,
+        universe,
+        preferStoredMonitorState: true,
+        source: "worker",
+      });
+    const states = result.states as Record<string, unknown>[];
+    const state = states[0] ?? {};
+    const profile = result.profile as Record<string, unknown>;
+
+    assert.equal(symbolStateSelects, 1);
+    assert.equal(symbolStateLimit, 500);
+    assert.deepEqual(
+      states.map((entry) => entry["symbol"]),
+      ["AAPL"],
+      "worker refresh must not return out-of-deployment stored states",
+    );
+    assert.equal(state["profileId"], profileId);
+    assert.equal(state["currentSignalDirection"], "buy");
+    assert.equal(state["currentSignalPrice"], 187.12);
+    assert.equal(state["barsSinceSignal"], 0);
+    assert.equal(state["fresh"], true);
+    assert.equal(state["status"], "ok");
+    assert.ok(state["currentSignalAt"], "currentSignalAt is needed for signal keys");
+    assert.ok(state["latestBarAt"], "latestBarAt is needed for worker summaries");
+    assert.ok(
+      state["lastEvaluatedAt"],
+      "lastEvaluatedAt is needed for refresh currentness checks",
+    );
+    assert.equal(profile["timeframe"], "5m");
+    assert.equal(profile["freshWindowBars"], 3);
+    assert.equal(
+      (profile["pyrusSignalsSettings"] as Record<string, unknown>)["alpha"],
+      "kept",
+    );
+
+    const summary =
+      __signalOptionsAutomationInternalsForTests.buildWorkerScanSummary({
+        states: states as never,
+        universe,
+        candidateCount: 0,
+        blockedCandidateCount: 0,
+        activeScanPhase: "signal_refresh",
+      });
+    assert.equal(summary.signalCount, 1);
+    assert.equal(summary.freshSignalCount, 1);
+    assert.equal(summary.latestSignalBarAt, latestBarAt.toISOString());
+
+    const ordered =
+      __signalOptionsAutomationInternalsForTests.orderSignalOptionsActionStates({
+        states: states as never,
+        universe,
+        timeframe: profile["timeframe"] as never,
+      });
+    const signalAt =
+      state["currentSignalAt"] instanceof Date
+        ? state["currentSignalAt"].toISOString()
+        : String(state["currentSignalAt"]);
+    const candidate =
+      __signalOptionsAutomationInternalsForTests.buildCandidateFromSignal({
+        deployment,
+        state: ordered[0] as never,
+        signalAt,
+        freshWindowBars: profile["freshWindowBars"] as number,
+      });
+    assert.equal(candidate.symbol, "AAPL");
+    assert.ok(candidate.signal);
+    assert.equal(candidate.signal.latestBarAt, latestBarAt.toISOString());
+    assert.equal(candidate.signal.freshWindowBars, 3);
+  });
+});
+
 test("Signal Options backfill requires explicit bar-evaluation opt-in", async () => {
   const previousPyrusFlag =
     process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"];
diff --git a/artifacts/api-server/src/services/signal-options-automation.ts b/artifacts/api-server/src/services/signal-options-automation.ts
index aa237b54..3c303ef5 100644
--- a/artifacts/api-server/src/services/signal-options-automation.ts
+++ b/artifacts/api-server/src/services/signal-options-automation.ts
@@ -5919,18 +5919,49 @@ function signalOptionsDirectionOrNull(value: unknown): SignalDirection | null {
   return value === "buy" || value === "sell" ? value : null;
 }
 
+function signalOptionsMonitorProfileResponse(profile: SignalMonitorProfileRow) {
+  return {
+    id: profile.id,
+    environment: profile.environment,
+    enabled: profile.enabled,
+    watchlistId: profile.watchlistId ?? null,
+    timeframe: resolveSignalMonitorTimeframe(profile.timeframe),
+    pyrusSignalsSettings: asRecord(profile.pyrusSignalsSettings),
+    freshWindowBars: profile.freshWindowBars,
+    pollIntervalSeconds: profile.pollIntervalSeconds,
+    maxSymbols: profile.maxSymbols,
+    evaluationConcurrency: profile.evaluationConcurrency,
+    lastEvaluatedAt: profile.lastEvaluatedAt ?? null,
+    lastError: profile.lastError ?? null,
+    createdAt: profile.createdAt,
+    updatedAt: profile.updatedAt,
+  };
+}
+
 async function listSignalOptionsStoredSignalStatesFast(input: {
   deployment: AlgoDeployment;
   universe: Set<string>;
+  profile?: SignalMonitorProfileRow | null;
 }) {
-  const [profile] = await db
-    .select()
-    .from(signalMonitorProfilesTable)
-    .where(eq(signalMonitorProfilesTable.environment, resolveSignalSourceEnvironment()))
-    .limit(1);
+  const profile =
+    input.profile ??
+    (
+      await db
+        .select()
+        .from(signalMonitorProfilesTable)
+        .where(
+          eq(
+            signalMonitorProfilesTable.environment,
+            resolveSignalSourceEnvironment(),
+          ),
+        )
+        .limit(1)
+    )[0];
   if (!profile) {
     return {
       states: [] as SignalMonitorState[],
+      profile: null,
+      stateSource: "database" as const,
       timeframe: null as SignalMonitorTimeframe | null,
       freshWindowBars: null as number | null,
     };
@@ -6039,6 +6070,8 @@ async function listSignalOptionsStoredSignalStatesFast(input: {
 
   return {
     states,
+    profile: signalOptionsMonitorProfileResponse(profile),
+    stateSource: "database" as const,
     timeframe,
     freshWindowBars: optionalFiniteNumber(profile.freshWindowBars),
   };
@@ -6269,6 +6302,35 @@ function shouldUseStoredMonitorStateForWorkerReadiness(input: {
   return Boolean(input.source === "worker" && input.readinessReason);
 }
 
+function shouldUseScopedSignalOptionsWorkerStoredState(input: {
+  source?: "manual" | "worker";
+  preferStoredMonitorState?: boolean;
+}) {
+  return (
+    input.source === "worker" && input.preferStoredMonitorState === true
+  );
+}
+
+async function readSignalOptionsStoredMonitorState(input: {
+  deployment: AlgoDeployment;
+  universe: Set<string>;
+  profile: SignalMonitorProfileRow;
+  preferStoredMonitorState?: boolean;
+  source?: "manual" | "worker";
+}) {
+  if (shouldUseScopedSignalOptionsWorkerStoredState(input)) {
+    return listSignalOptionsStoredSignalStatesFast({
+      deployment: input.deployment,
+      universe: input.universe,
+      profile: input.profile,
+    });
+  }
+  return getSignalMonitorStoredState({
+    environment: resolveSignalSourceEnvironment(),
+    markNonCurrentStale: true,
+  });
+}
+
 async function loadSignalOptionsMonitorState(input: {
   deployment: AlgoDeployment;
   universe: Set<string>;
@@ -6296,9 +6358,12 @@ async function loadSignalOptionsMonitorState(input: {
       const symbols = normalizeSignalOptionsMonitorUniverseSymbols(
         input.universe,
       );
-      const evaluated = await getSignalMonitorStoredState({
-        environment: resolveSignalSourceEnvironment(),
-        markNonCurrentStale: true,
+      const evaluated = await readSignalOptionsStoredMonitorState({
+        deployment: input.deployment,
+        universe: input.universe,
+        profile,
+        preferStoredMonitorState: input.preferStoredMonitorState,
+        source: input.source,
       });
       throwIfSignalOptionsScanAborted(input.signal);
       return {
@@ -6314,9 +6379,12 @@ async function loadSignalOptionsMonitorState(input: {
     const symbols = normalizeSignalOptionsMonitorUniverseSymbols(
       input.universe,
     );
-    const stored = await getSignalMonitorStoredState({
-      environment: resolveSignalSourceEnvironment(),
-      markNonCurrentStale: true,
+    const stored = await readSignalOptionsStoredMonitorState({
+      deployment: input.deployment,
+      universe: input.universe,
+      profile,
+      preferStoredMonitorState: input.preferStoredMonitorState,
+      source: input.source,
     });
     throwIfSignalOptionsScanAborted(input.signal);
     const monitorStateNeedsRefresh = shouldRefreshSignalOptionsMonitorState({
@@ -21440,6 +21508,7 @@ export const __signalOptionsAutomationInternalsForTests = {
   resolveSignalOptionsMonitorFullRefresh,
   shouldBatchSignalOptionsWorkerMonitorRefresh,
   shouldRefreshSignalOptionsMonitorState,
+  loadSignalOptionsMonitorState,
   hasPendingSignalOptionsActionableState,
   hasUnseenSignalOptionsActionableState,
   orderSignalOptionsActionStates,
```

## Test output

Command:

```sh
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts src/services/background-worker-pressure.test.ts src/services/signal-options-mtf-alignment.test.ts
```

Output:

```text
✔ signal-options worker degrades to a positions-only scan under high resource pressure (does not fully pause) (2.359454ms)
✔ signal-options worker scans enabled deployments with bounded action work (1.465376ms)
✔ signal-options worker default scan timeout scales with active positions unless overridden (0.134022ms)
✔ signal-options worker keeps scanning when signal evaluation is passive (0.969172ms)
✔ signal monitor worker stays idle in passive mode (0.323315ms)
✔ overnight spot worker degrades to an exit-only scan under high resource pressure (outside RTH) (2.028216ms)
✔ entry work runs on every tick under sustained hard block (no pressure gate) (7.635884ms)
✔ resolveSameScanEntryAction: a symbol opened earlier this scan defers (no duplicate entry); block/flip/proceed preserved (1.364222ms)
✔ evaluateMtfPatternGate requires an EXACT per-timeframe match (divergence-aware) (0.764571ms)
✔ classifySignalOptionsEntryQuality uses calibrated expected-move-v2 directional features before setup quality (0.817953ms)
✔ classifySignalOptionsEntryQuality keeps setup-quality fallback without directional features (0.235677ms)
✔ Signal Options does not evaluate Signal Matrix directly (1.123035ms)
✔ Signal Options default state endpoint bypasses cached fast-summary state (0.828635ms)
✔ Signal Options default cockpit summary bypasses cached fast-summary state (0.607234ms)
✔ Signal Options performance pressure predicate follows API headline pressure (0.770934ms)
✔ Signal Options performance serves fallback and refreshes in background under pressure (1.033043ms)
✔ Signal Options performance refresh avoids full dashboard hydration (0.853298ms)
✔ Signal Options worker signal_refresh uses the deployment-scoped stored-state reader (8103.018713ms)
✔ Signal Options backfill requires explicit bar-evaluation opt-in (1.517911ms)
✔ Signal Options cockpit treats after-hours execution gate as info (0.290181ms)
✔ Signal Options cockpit keeps real gateway failures as warnings (0.0734ms)
✔ Signal Options position_marking rule composes detail from only nonzero clauses (0.627915ms)
✔ Signal Options gateway blocker: shadow deployments bypass broker readiness but keep the RTH gate (0.139936ms)
✔ Signal Options action states stay on configured execution timeframe (0.244203ms)
✔ Signal Options monitor refresh stops mid-universe scan when aborted (0.292495ms)
✔ Signal Options monitor batch cursor resumes at the first unprocessed symbol after abort (0.35671ms)
✔ Signal Options action states require canonical signal monitor events (0.234779ms)
✔ Signal Options keeps one-bar monitor signals executable even after matrix freshness flips false (1.02821ms)
✔ shadow fallback marks older than 60s cannot trigger stop exits (0.364922ms)
✔ Signal Options snapshot blocks non-ok signal states regardless of bar age (0.162438ms)
✔ Signal Options still rejects signals outside the actionable execution window (0.086196ms)
✔ Signal Options cockpit signal snapshots require canonical event metadata (0.526876ms)
✔ Signal Options cockpit signal stage counts received signals, not stale candidates (0.828016ms)
✔ Signal Options dashboard candidates use deterministic display tie-breakers (0.21057ms)
✔ Signal Options position mark keeps stale quote distinct from missing bid/ask (0.231564ms)
✔ Signal Options stale position mark summary names stale quote (0.068104ms)
✔ realized P&L uses the contract multiplier, not a hardcoded 100 (0.076572ms)
✔ a position's exit can only be claimed once (duplicate-exit race guard) (0.08464ms)
✔ deriveCandidateActionStatus: a resolved shadow link marks an open position shadow_filled even when its entry event aged out of the view window (0.143733ms)
✔ reconcileActivePositionsWithShadowLedger reuses a provided shadow index instead of rebuilding it (fix A) (0.42898ms)
✔ Signal Options reconcile takes an optional shadow index and buildStatePayload passes the one it built (fix A) (0.618564ms)
✔ Signal Options summary snapshot serves a fresh cache in normal mode before rebuilding (fix C) (0.389501ms)
✔ Signal Options flags cold rebuilds freshlyBuilt and skips the refresh only for them, not cache hits (fix B) (0.530046ms)
✔ MTF entry gate honors configured requiredCount instead of forcing unanimity (2.233431ms)
✔ greek selector scores only configured call strike slots (3.181961ms)
✔ greek selector scores only configured put strike slots (1.077928ms)
✔ greek selector proceeds with remaining slot matches when configured slots collapse on a thin chain (1.004636ms)
✔ zero slot-matching greek candidates follows the existing fallback_legacy no-candidate path (1.372462ms)
✔ slot-excluded greek contracts are absent from scored attempts and the selection payload (1.814004ms)
✔ C1 selectSignalOptionsExpiration: DTE counts NY trading days, not UTC calendar days (0.537129ms)
✔ C2 session gates are holiday/early-close aware (0.771079ms)
✔ C3 daily-loss halt keys off the NY trading day, not the UTC calendar day (0.367803ms)
✔ C4 latestCompletedBackfillMarketDate skips holidays, not just weekends (0.250473ms)
✔ D1 candidateFromEvent maps payload.entryGate onto the candidate (0.461627ms)
✔ D1 mergeSignalOptionsCandidate keeps the freshest non-null entryGate (0.226693ms)
✔ matrix MTF: blocks a buy when a configured frame (1d) actually disagrees (0.84393ms)
✔ matrix MTF: passes a buy when all configured frames agree (12.558897ms)
✔ matrix MTF: a frame with no signal yet counts as not-aligned (cannot satisfy) (0.314275ms)
✔ legacy fallback (no matrix) wrongly passes — proves why the matrix source is needed (0.269644ms)
✔ effective MTF frames use only the configured MTF selection (0.782781ms)
✔ matrix MTF: every configured frame must align (0.221773ms)
✔ matrix MTF: passes only when every configured frame aligns (0.245762ms)
ℹ tests 62
ℹ suites 0
ℹ pass 62
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 38817.881427
```

Extra validation:

```text
> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```

Exit code: 0.
