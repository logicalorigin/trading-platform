# WO-FIX-13 Report

## Scope / Clean Check

Observed clean before edits:

```text
git status --porcelain -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-options-automation.ts artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx
# no output
```

`OperationsSignalRow.jsx` stayed unchanged. The row delegates sparkline coloring to `artifacts/pyrus/src/features/signals/signalSparklineModel.js`, so Fix B was made at that shared helper.

## Fix A - Matrix SSE bootstrap serves stale-present cache immediately

What/why:

- `createSignalMonitorStreamBootstrapSnapshotReader` now returns a cached snapshot even after TTL expiry when a stale entry exists.
- It starts one background refresh if no refresh is already in flight.
- First-ever bootstrap still awaits the stored-state read, and runtime-fallback snapshots still do not populate the cache.

Diff:

```diff
diff --git a/artifacts/api-server/src/services/signal-monitor.ts b/artifacts/api-server/src/services/signal-monitor.ts
@@
   const inFlight = new Map<
     string,
     Promise<SignalMonitorStreamBootstrapSnapshot>
   >();
-  return async (environment?: RuntimeMode) => {
-    const key = resolveEnvironment(environment);
-    const cached = cache.get(key);
-    if (cached && cached.expiresAtMs > now()) {
-      return cached.snapshot;
-    }
-    const pending = inFlight.get(key);
-    if (pending) {
-      return pending;
-    }
+  const startRead = (environment: RuntimeMode | undefined, key: string) => {
     const compute = read(environment)
@@
     inFlight.set(key, compute);
     return compute;
   };
+
+  return async (environment?: RuntimeMode) => {
+    const key = resolveEnvironment(environment);
+    const cached = cache.get(key);
+    if (cached && cached.expiresAtMs > now()) {
+      return cached.snapshot;
+    }
+    const pending = inFlight.get(key);
+    if (cached) {
+      if (!pending) {
+        void startRead(environment, key).catch(() => {});
+      }
+      return cached.snapshot;
+    }
+    if (pending) {
+      return pending;
+    }
+    return startRead(environment, key);
+  };
 };
```

```diff
diff --git a/artifacts/api-server/src/services/signal-monitor-stream-bootstrap.test.ts b/artifacts/api-server/src/services/signal-monitor-stream-bootstrap.test.ts
@@
-test("bootstrap snapshot is served from cache within the TTL and re-read after", async () => {
+test("bootstrap snapshot is served from cache within the TTL and refreshed after stale reuse", async () => {
@@
+  const stalePromise = reader("shadow" as never);
+  let staleSettled = false;
+  stalePromise.then(() => {
+    staleSettled = true;
+  });
+  await Promise.resolve();
+  assert.equal(staleSettled, true);
+  assert.equal(await stalePromise, first);
   assert.equal(reads, 2);
+  releaseRefresh();
+  await refreshDone;
+  await new Promise<void>((resolve) => {
+    setImmediate(resolve);
+  });
 
   const refreshed = await reader("shadow" as never);
   assert.notEqual(refreshed, first);
 });
```

Test output:

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream-bootstrap.test.ts

✔ concurrent bootstrap reads share one underlying stored-state read (1.458217ms)
✔ bootstrap snapshot is served from cache within the TTL and refreshed after stale reuse (63.255655ms)
✔ environments do not share bootstrap snapshots (1.884591ms)
✔ degraded runtime-fallback snapshots are never cached (0.351167ms)
✔ a failed read is not cached and the next call retries (1.001774ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3357.226555
```

## Fix B - Sparkline overlay drops stale/contradicting markers

What/why:

- `buildSignalSparklinePointColors` now treats an active row signal as authoritative when the row timeframe matches the colored timeframe.
- Execution markers older than the row signal, or with the opposite direction, are removed before coloring.
- This prevents audit/event markers from painting against the state signal.

Diff:

```diff
diff --git a/artifacts/pyrus/src/features/signals/signalSparklineModel.js b/artifacts/pyrus/src/features/signals/signalSparklineModel.js
@@
   const rowMatchesColorTimeframe =
     !tradedTimeframe || !rowTimeframe || rowTimeframe === tradedTimeframe;
-  if (
+  const rowSignalIsAuthoritative =
     rowMatchesColorTimeframe &&
     activeStatuses.has(row?.status) &&
     isSignalSparklineDirection(rowSignalDirection) &&
-    rowSignalMs != null
-  ) {
+    rowSignalMs != null;
+  if (rowSignalIsAuthoritative) {
+    for (let index = transitions.length - 1; index >= 0; index -= 1) {
+      const transition = transitions[index];
+      if (
+        transition.ms < rowSignalMs ||
+        transition.direction !== rowSignalDirection
+      ) {
+        transitions.splice(index, 1);
+      }
+    }
     transitions.push({
       direction: rowSignalDirection,
```

```diff
diff --git a/artifacts/pyrus/src/features/signals/signalSparklineModel.test.mjs b/artifacts/pyrus/src/features/signals/signalSparklineModel.test.mjs
@@
+test("row state drops older and opposite-direction execution markers", () => {
+  const events = buildSignalEventsBySymbol([
+    { symbol: "AAPL", direction: "buy", timeframe: "5m", signalAt: at(2000) },
+    { symbol: "AAPL", direction: "sell", timeframe: "5m", signalAt: at(4000) },
+  ]).get("AAPL");
+
+  const colors = buildSignalSparklinePointColors({
+    points: pointsAt([2500, 3500, 4500]),
+    row: {
+      timeframe: "5m",
+      direction: "buy",
+      currentSignalAt: at(3000),
+      status: "active-fresh",
+    },
+    signalEvents: events,
+    colorTimeframe: "5m",
+  });
+  assert.deepEqual(colors, [RED, BLUE, BLUE]);
+});
```

Test output:

```text
pnpm --filter @workspace/pyrus exec node --test src/features/signals/signalSparklineModel.test.mjs

✔ direction color mapping is buy=blue / sell=red / else null (4.321455ms)
✔ buildSignalEventsBySymbol keeps timeframe and sorts by time (1.115908ms)
✔ colorTimeframe colors by the traded timeframe's events only (0.469969ms)
✔ colorTimeframe with no matching events falls back to flat (null) (0.218279ms)
✔ latched row signal is dropped when row tf differs from traded tf (0.21731ms)
✔ latched row signal applies when row tf equals traded tf (0.402253ms)
✔ without colorTimeframe legacy per-row behavior is unchanged (0.286357ms)
✔ transitions over time recolor each point by the active signal (0.266112ms)
✔ row state drops older and opposite-direction execution markers (0.305901ms)
✔ before a buy shows the opposite stance (sell), then flips to buy — never grey (0.409196ms)
✔ fallback color stays muted until signal state hydrates (no launch green flash) (1.601082ms)
✔ fallback color defers to the caller once signal state is hydrated (0.179652ms)
✔ fallback color passes a resolved signal color through unchanged (1.57889ms)
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 443.355103
```

## Fix C - Dashboard realized P&L uses full trading-day event read

Finding:

- Observed `getSignalOptionsSummaryDashboardSnapshot` read only `SIGNAL_OPTIONS_SUMMARY_EVENT_LIMIT = 100` recent events before `buildStatePayload` computed `risk.dailyRealizedPnl`.
- The deployment-tab P&L helper reads the summary dashboard snapshot, so realized P&L could undercount once the current session had more than 100 signal-options events.

What/why:

- Added `readSignalOptionsDashboardEvents`, which combines the existing recent event window with a day-bounded read starting at the current NYSE regular session open.
- Added a 10,000-row day cap with `limit + 1` overflow detection.
- Full and summary dashboard snapshots now compute state/risk from the merged, newest-first, de-duplicated event set while summary responses still compact displayed events.

Diff:

```diff
diff --git a/artifacts/api-server/src/services/signal-options-automation.ts b/artifacts/api-server/src/services/signal-options-automation.ts
@@
 const SIGNAL_OPTIONS_STATE_EVENT_LIMIT = 2_500;
 const SIGNAL_OPTIONS_RECENT_SKIPS_LIMIT = SIGNAL_OPTIONS_STATE_EVENT_LIMIT;
 const SIGNAL_OPTIONS_SUMMARY_EVENT_LIMIT = 100;
+const SIGNAL_OPTIONS_DASHBOARD_DAY_EVENT_LIMIT = 10_000;
 const SIGNAL_OPTIONS_SUMMARY_RESPONSE_EVENT_LIMIT = 20;
@@
+async function listDeploymentEventsSinceWithOverflow(
+  deploymentId: string,
+  since: Date,
+  limit = SIGNAL_OPTIONS_DASHBOARD_DAY_EVENT_LIMIT,
+) {
+  const cappedLimit = Math.min(Math.max(limit, 1), 10_000);
+  const rows = await db
+    .select()
+    .from(executionEventsTable)
+    .where(
+      and(
+        eq(executionEventsTable.deploymentId, deploymentId),
+        sql`${executionEventsTable.eventType} LIKE 'signal_options_%'`,
+        gte(executionEventsTable.occurredAt, since),
+      ),
+    )
+    .orderBy(asc(executionEventsTable.occurredAt))
+    .limit(cappedLimit + 1);
+  return {
+    events: rows.slice(0, cappedLimit),
+    overflow: rows.length > cappedLimit,
+  };
+}
+
+function signalOptionsTodaySessionStartAt(now = new Date()): Date | null {
+  const calendarDay = resolveNyseCalendarDay(now);
+  if (calendarDay?.tradingDay !== true) {
+    return null;
+  }
+  return dateOrNull(calendarDay.regularOpenAt);
+}
+
+function mergeSignalOptionsDashboardEvents(
+  ...eventSets: ExecutionEvent[][]
+): ExecutionEvent[] {
+  const byId = new Map<string, ExecutionEvent>();
+  for (const events of eventSets) {
+    for (const event of events) {
+      byId.set(event.id, event);
+    }
+  }
+  return [...byId.values()].sort(
+    (left, right) =>
+      right.occurredAt.getTime() - left.occurredAt.getTime() ||
+      right.id.localeCompare(left.id),
+  );
+}
+
+async function readSignalOptionsDashboardEvents(input: {
+  deploymentId: string;
+  recentLimit: number;
+  now?: Date;
+}) {
+  const recentEvents = await listDeploymentEvents(
+    input.deploymentId,
+    input.recentLimit,
+  );
+  const sessionStartAt = signalOptionsTodaySessionStartAt(input.now);
+  if (!sessionStartAt) {
+    return {
+      events: recentEvents,
+      recentEvents,
+      dayEvents: [],
+      dayOverflow: false,
+      dayEventLimit: SIGNAL_OPTIONS_DASHBOARD_DAY_EVENT_LIMIT,
+      sessionStartAt,
+    };
+  }
+
+  const dayRead = await listDeploymentEventsSinceWithOverflow(
+    input.deploymentId,
+    sessionStartAt,
+    SIGNAL_OPTIONS_DASHBOARD_DAY_EVENT_LIMIT,
+  );
+  return {
+    events: mergeSignalOptionsDashboardEvents(recentEvents, dayRead.events),
+    recentEvents,
+    dayEvents: dayRead.events,
+    dayOverflow: dayRead.overflow,
+    dayEventLimit: SIGNAL_OPTIONS_DASHBOARD_DAY_EVENT_LIMIT,
+    sessionStartAt,
+  };
+}
@@
-    const ledgerEvents = await listDeploymentEvents(
-      deployment.id,
-      SIGNAL_OPTIONS_SUMMARY_EVENT_LIMIT,
-    );
+    const eventRead = await readSignalOptionsDashboardEvents({
+      deploymentId: deployment.id,
+      recentLimit: SIGNAL_OPTIONS_SUMMARY_EVENT_LIMIT,
+    });
     const events = signalOptionsEventsWithRecentSkips({
       deploymentId: deployment.id,
-      events: ledgerEvents,
-      limit: SIGNAL_OPTIONS_SUMMARY_EVENT_LIMIT,
+      events: eventRead.events,
+      limit: SIGNAL_OPTIONS_DASHBOARD_DAY_EVENT_LIMIT,
     });
```

```diff
diff --git a/artifacts/api-server/src/services/signal-options-automation.test.ts b/artifacts/api-server/src/services/signal-options-automation.test.ts
@@
+test("dashboard event read covers the full trading day for >100-event realized P&L", async () => {
+  const internals = __signalOptionsAutomationInternalsForTests;
+  const uuid = (value: number) =>
+    `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
+  const strategyId = uuid(3100);
+  const deploymentId = uuid(3101);
+  const now = new Date("2026-07-07T18:00:00.000Z");
+  const firstExitAt = new Date("2026-07-07T14:30:00.000Z");
+  ...
+    const read = await internals.readSignalOptionsDashboardEvents({
+      deploymentId,
+      recentLimit: 100,
+      now,
+    });
+    assert.equal(read.recentEvents.length, 100);
+    assert.equal(read.dayEvents.length, 120);
+    assert.equal(read.dayOverflow, false);
+    ...
+    assert.equal(recentOnlyPnl, -100);
+    assert.equal(fullDayPnl, -120);
+  });
+});
```

Test output:

```text
pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts

✔ resolveSameScanEntryAction: a symbol opened earlier this scan defers (no duplicate entry); block/flip/proceed preserved (1.095183ms)
✔ evaluateMtfPatternGate requires an EXACT per-timeframe match (divergence-aware) (0.30161ms)
✔ classifySignalOptionsEntryQuality uses calibrated expected-move-v2 directional features before setup quality (0.779865ms)
✔ classifySignalOptionsEntryQuality keeps setup-quality fallback without directional features (0.171478ms)
✔ Signal Options does not evaluate Signal Matrix directly (1.134899ms)
✔ Signal Options default state endpoint bypasses cached fast-summary state (0.554218ms)
✔ Signal Options default cockpit summary bypasses cached fast-summary state (0.465591ms)
✔ Signal Options performance pressure predicate follows API headline pressure (0.602654ms)
✔ Signal Options performance serves fallback and refreshes in background under pressure (0.408004ms)
✔ Signal Options performance refresh avoids full dashboard hydration (0.507777ms)
✔ Signal Options worker signal_refresh uses the deployment-scoped stored-state reader (8391.622716ms)
✔ Signal Options backfill requires explicit bar-evaluation opt-in (1.811947ms)
✔ Signal Options cockpit treats after-hours execution gate as info (0.276852ms)
✔ Signal Options cockpit keeps real gateway failures as warnings (0.08187ms)
✔ Signal Options position_marking rule composes detail from only nonzero clauses (0.650929ms)
✔ Signal Options gateway blocker: shadow deployments bypass broker readiness but keep the RTH gate (0.127144ms)
✔ Signal Options action states stay on configured execution timeframe (0.240441ms)
✔ Signal Options monitor refresh stops mid-universe scan when aborted (0.336644ms)
✔ Signal Options monitor batch cursor resumes at the first unprocessed symbol after abort (0.372778ms)
✔ Signal Options action states require canonical signal monitor events (0.330196ms)
✔ Signal Options keeps one-bar monitor signals executable even after matrix freshness flips false (1.110434ms)
✔ shadow fallback marks older than 60s cannot trigger stop exits (0.309692ms)
✔ Signal Options snapshot blocks non-ok signal states regardless of bar age (0.158318ms)
✔ Signal Options still rejects signals outside the actionable execution window (0.086467ms)
✔ Signal Options cockpit signal snapshots require canonical event metadata (0.466659ms)
✔ Signal Options cockpit signal stage counts received signals, not stale candidates (0.850451ms)
✔ Signal Options dashboard candidates use deterministic display tie-breakers (0.14055ms)
✔ Signal Options position mark keeps stale quote distinct from missing bid/ask (0.236316ms)
✔ Signal Options stale position mark summary names stale quote (0.076091ms)
✔ realized P&L uses the contract multiplier, not a hardcoded 100 (0.077755ms)
✔ a position's exit can only be claimed once (duplicate-exit race guard) (0.341781ms)
✔ dashboard event read covers the full trading day for >100-event realized P&L (8597.020995ms)
✔ deriveCandidateActionStatus: a resolved shadow link marks an open position shadow_filled even when its entry event aged out of the view window (0.32244ms)
✔ reconcileActivePositionsWithShadowLedger reuses a provided shadow index instead of rebuilding it (fix A) (0.543077ms)
✔ Signal Options reconcile takes an optional shadow index and buildStatePayload passes the one it built (fix A) (0.977277ms)
✔ Signal Options summary snapshot serves a fresh cache in normal mode before rebuilding (fix C) (0.421183ms)
✔ Signal Options flags cold rebuilds freshlyBuilt and skips the refresh only for them, not cache hits (fix B) (0.712548ms)
✔ MTF entry gate honors configured requiredCount instead of forcing unanimity (2.762152ms)
✔ greek selector scores only configured call strike slots (2.552714ms)
✔ greek selector scores only configured put strike slots (1.0637ms)
✔ greek selector proceeds with remaining slot matches when configured slots collapse on a thin chain (0.962331ms)
✔ zero slot-matching greek candidates follows the existing fallback_legacy no-candidate path (1.756573ms)
✔ slot-excluded greek contracts are absent from scored attempts and the selection payload (2.555493ms)
✔ C1 selectSignalOptionsExpiration: DTE counts NY trading days, not UTC calendar days (0.863971ms)
✔ C2 session gates are holiday/early-close aware (1.032269ms)
✔ C3 daily-loss halt keys off the NY trading day, not the UTC calendar day (0.214679ms)
✔ C4 latestCompletedBackfillMarketDate skips holidays, not just weekends (0.291422ms)
✔ D1 candidateFromEvent maps payload.entryGate onto the candidate (0.444806ms)
✔ D1 mergeSignalOptionsCandidate keeps the freshest non-null entryGate (0.229331ms)
ℹ tests 49
ℹ suites 0
ℹ pass 49
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 26506.611441
```

## Additional Checks

```text
pnpm --filter @workspace/api-server run typecheck

> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```

```text
pnpm --filter @workspace/pyrus run typecheck

> @workspace/pyrus@0.0.0 typecheck /home/runner/workspace/artifacts/pyrus
> tsc -p tsconfig.json --noEmit
```

```text
git diff --check -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-monitor-stream-bootstrap.test.ts artifacts/pyrus/src/features/signals/signalSparklineModel.js artifacts/pyrus/src/features/signals/signalSparklineModel.test.mjs artifacts/api-server/src/services/signal-options-automation.ts artifacts/api-server/src/services/signal-options-automation.test.ts
# no output
```

## Final Status

Left unstaged as requested.

```text
git status --porcelain -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-monitor-stream-bootstrap.test.ts artifacts/pyrus/src/features/signals/signalSparklineModel.js artifacts/pyrus/src/features/signals/signalSparklineModel.test.mjs artifacts/api-server/src/services/signal-options-automation.ts artifacts/api-server/src/services/signal-options-automation.test.ts artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx
 M artifacts/api-server/src/services/signal-monitor-stream-bootstrap.test.ts
 M artifacts/api-server/src/services/signal-monitor.ts
 M artifacts/api-server/src/services/signal-options-automation.test.ts
 M artifacts/api-server/src/services/signal-options-automation.ts
 M artifacts/pyrus/src/features/signals/signalSparklineModel.js
 M artifacts/pyrus/src/features/signals/signalSparklineModel.test.mjs
```
