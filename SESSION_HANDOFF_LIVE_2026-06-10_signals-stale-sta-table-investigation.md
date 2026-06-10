# Live Session Handoff - Signals Stale / STA Table Not Picking Up Signals

- Last Updated (MT): `2026-06-10 (in progress)`
- Session ID: `claude:e3f9c442-f60a-448f-9b8f-2f6eeb90c4c3`
- CWD: `/home/runner/workspace`
- Status: INVESTIGATION — grounding phase

## User Request

Top priority: investigate why signals are not being picked up / the signals-to-actions
(STA) table is stale. Suspected regression is around recent `signal-options` /
`signal-monitor` changes. Review prior work to find where things went wrong. No cheap
fixes — only permanent, quality root-cause solutions. Target architecture: SSE push to
deliver signal data derived from Massive ticker price data.

## Approach

1. Ground in prior signal work (handoffs + recent commits) and current pipeline code.
2. Trace path: Massive ticker price -> signal-monitor eval -> SSE push -> STA table.
3. Diff uncommitted signal-monitor / signal-options changes vs HEAD for regressions.
4. Ask targeted clarifying questions before proposing/implementing a fix.

## Relevant Prior Work

- Commit `8db5372` fix: hydrate signal bubbles from stored monitor state
- LIVE notes: signals-to-actions-density, signals-table-matrix-audit,
  native-signal-matrix-hydration, signal-bubbles-matrix-diagnosis
- Modified (uncommitted): signal-monitor.ts, signal-options-automation.ts,
  signal-options-worker.ts, signal-options-worker-state.ts, massive/market-data.ts,
  signal-monitor-stream.test.ts

## Findings (root cause, evidence-backed)

ROOT CAUSE: an in-flight, **uncommitted, undocumented "passive signal source" migration**
is half-built and LIVE. The old active path was disabled before the new passive/SSE-push
path was finished, so STA goes stale.

Evidence:
- dist/index.mjs rebuilt 2026-06-10T08:33:06 (after the Jun 9 working-tree edits) →
  the uncommitted signal-options/signal-monitor changes ARE compiled into running API
  (pid 7848). The regression is live, not hypothetical.
- Runtime probe `/api/signal-monitor/state?environment=paper`: 3000 states,
  **2697 stale (90%)**, 248 ok, 55 unavailable, cacheStatus all null, refreshing=false.
- Runtime probe `/api/signal-monitor/events`: latest event has `eventKey: null`,
  `createdAt: null` (needs field-shape re-verify, but strong lead).

Mechanism (3 layers, observed/inferred):
1. PRODUCER OFF: `PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED` unset (default off).
   Uncommitted `signal-options-worker.ts` now gates ALL stream eval behind that flag →
   worker tears down stream evaluator; `loadSignalOptionsMonitorState` returns
   stored-only ("passive_signal_source"). No live recompute in the options path.
2. CONSUMER HARD-GATES: uncommitted `signal-options-automation.ts` now requires a
   persisted canonical `signalMonitorEventsTable` row (requireEventMetadata default-on +
   canonicalSignalKeys filter, eventKey-matched). If events lack usable eventKey, every
   snapshot/action is filtered out → empty/stale STA.
3. NO BRIDGE + NO PUSH: the ticker-emitted event WRITER that should persist canonical
   rows on Massive bar-close is not delivering usable rows; AND the frontend STA table
   POLLS a 60s/5min-cached REST endpoint (`POST /signal-monitor/matrix`) — it never
   subscribes to the EXISTING backend SSE matrix stream (`GET /signal-monitor/matrix/stream`).
   Backend SSE Path A is fully built but dead (no client; gated by subscriber count).

Intended end-state (per docs/backend-data-map.md + signal-bubbles-sse-push-hydration-plan.md)
== the user's stated target: Massive tick/bar-close → evaluate → persist canonical event →
**SSE push** → STA table. The migration toward this was started but left incomplete.

Key files: signal-options-automation.ts, signal-options-worker.ts, signal-monitor.ts
(emit-gate removals), routes/signal-monitor.ts (SSE route exists), frontend
PlatformApp.jsx (poll loop, no SSE), signalMatrixScheduler.js.

## Verified contract verdict (agent ac2dfdff)

- WRITER eventKey = `buildSignalMonitorEventKey` (signal-monitor.ts:4005-4019):
  profileId:SYMBOL:timeframe:direction:floor(signalBarAt/1000).
- READER (uncommitted signal-options-automation.ts) uses the SAME builder
  (loadCanonicalSignalOptionsSignalKeys:2813, resolveSignalMonitorEventLookupKeys) and is
  MORE tolerant (multiple anchor candidates). Key shapes MATCH. No keying bug.
- No TTL/age filter on canonical lookup. Staleness-filter ruled out.
- VERDICT: failure is (i) PRODUCER GAP. In passive mode (bar-eval flag off, default),
  ALL writer paths short-circuit -> signalMonitorEventsTable gets no fresh rows -> reader
  gate drops every signal -> STA 90% stale.
- Uncommitted signal-monitor.ts removes the flag-guards from the live-stream writer path
  (intended producer fix), BUT live writer still gated by
  `signalMonitorMatrixStreamSubscribers.size > 0` (signal-monitor.ts:6160, :6288). That
  set only fills when a UI SSE client connects -> with no UI client, producer still never
  runs. KEYSTONE: producer must run server-side, independent of UI clients.
- Frontend never opens GET /signal-monitor/matrix/stream; STA polls cached REST. (push gap)

## Algo monitor "idle" — EMPIRICALLY DETERMINED (browser-driven) — SAME ROOT as stale signals

CORRECTION: earlier source-only agent (a7f61466) said "idle = collapsed panel, separate
cosmetic issue." That was WRONG. User pushed back; browser observation disproved it.

Empirical (gstack headless browser, live app at 127.0.0.1:18747):
- Loaded app as workspace LEADER (claimed pyrus:workspace-leader key). On Market screen,
  Algo Monitor shows placeholder "Algo monitor idle" / "Open Algo Monitor when you need...".
- Navigated to Algo screen: STILL idle. Saw "Loading Algo route module ... deployment
  controls, signal candidates, and operations state - 8.8s" (route warmup stalled).
- Console FLOODED with HTTP 429 "Too Many Requests".
- 429 body: {"code":"api-resource-pressure-high","routeClass":"deferred-analytics",
  "pressureLevel":"high","detail":"API under resource pressure and shed lower-priority work"}.
- 429s were 31x /api/bars (whole ETF/sector universe: SPY,QQQ,VXX,XL* ... 720 1m bars,
  outsideRth, source=trades) + /api/algo/events. TWO /api/bars requests took 86 SECONDS.
- Bars fan-out source: MarketDataSubscriptionProvider.jsx:475 (REST bars for universe).

Why idle: PlatformAlgoMonitorSidebar idle = !queryEnabled = !(isVisible && dataEnabled).
dataEnabled requires frameAuxiliaryDataEnabled (PlatformApp.jsx:1426), a 7-cond AND
including screenWarmupPhase==="ready" && !startupProtectionActive. Under high pressure the
Algo route's data (deployments/candidates/bars) is 429-shed/86s-queued -> warmup never
reaches "ready" -> frameAuxiliaryDataEnabled false -> idle placeholder.

UNIFIED ROOT CAUSE (both symptoms): API pinned at pressureLevel "high".
- resource-pressure.ts:260 level = maxLevel(rssLevel, heapLevel, slowRouteLevel, clientLevel,
  cacheLevel). RSS only 2113 MB (normal; cgroup 16GB, thresholds watch 6144/high 8192).
  So "high" is driven by SLOW-ROUTE p95 (the 86s /api/bars + 41-77s shadow positions) and/or
  heap >=80% -> slowRouteLevel/heapLevel = high. (inferred-strong from observed 86s latencies)
- getApiResourcePressureCaps("high") (resource-pressure.ts:200) sets signalOptions:
  {maintenanceOnly:true, skipDeploymentScans:true, signalRefreshAllowed:FALSE,
   actionScansAllowed:FALSE, ...}. => signals do not refresh (STA stale) AND no deployment/
   action scans (algo monitor has no candidates + warmup starved). ONE state, BOTH symptoms.
- Feedback loop: slow REST bars/positions -> p95 high -> shed 429 -> frontend retries ->
  saturation -> pressure stays high. Validates user's call to move bars/signals to SSE push.
- API process pid 32436 only ~6 min old => API recently RESTARTED (seen pids 487/121786/7848/
  32436) -> possible crash/OOM loop resetting warmup + in-memory signal state. (flag, verify)

Layering: producer-gap (passive migration) still applies underneath; even once pressure
clears, signals won't flow without the server-side canonical event producer + SSE push.

## CORRECTED pressure drivers (flight-recorder api-current.json, 15:23Z) — more accurate than HTTP probe

- Pressure OSCILLATES watch<->high (was "high" during browser session, "watch" at 15:23Z).
- inputs: rssMb 2587 (normal), heapUsedPercent 11.8 (fine), apiP95 1550, dominantSlowRouteP95 4512,
  cacheLevel "watch". So drivers are API-LATENCY + CACHE, NOT memory/heap.
- caps@watch: signalRefreshAllowed TRUE but actionScansAllowed FALSE, positionMarks FALSE,
  watchlistPrewarm FALSE. caps@high: signalRefresh FALSE too. So at high, signals freeze; at
  watch, action scans (algo) freeze. Oscillation => intermittent freeze of both.
- DOMINANT slow routes (the real latency drivers):
  * GET /positions p95 10896ms (3 samples) <- slowest
  * GET /accounts/U24762790/equity-history p95 4512ms (17) <- == the api-latency driver score
  * GET /signal-monitor/events p95 906ms (12)
  * POST /signal-monitor/matrix p95 1444ms but 101 SAMPLES <- highest VOLUME (frontend poll)
  * GET /api/bars p95 1ms (32) <- now shed instantly; the 86s spikes were transient. Bars
    storm is a load/cache contributor, NOT the current latency driver.
- REVISED Phase 0 target: slow ACCOUNT/POSITION routes (/positions, equity-history, shadow
  positions 41-77s) drive api-latency pressure; matrix poll (101 samples) drives volume;
  bars sparkline fan-out drives cache/load. NOTE: IBKR intentionally disconnected -> /positions
  slowness may be broker-timeout (verify; fix = don't block on disconnected broker, not just cache).

## PLAN v2 (pressure-first, user-approved sequencing; awaiting plan approval)

P0 RELIEVE PRESSURE (unfreeze both): cap/degrade slow account-position routes so p95<watch
  (extend shadow-positions degraded-fallback template from session 019eaea5 to /positions +
  equity-history; ensure no 10-86s event-loop/connection holds; check IBKR-disconnect timeouts);
  make matrix poll + bars sparkline fan-out pressure-aware (back off under watch/high).
  EXIT: flight-recorder level steady "normal"; caps signalRefresh+actionScans+deploymentScans all
  true; 429 shedding stops; Algo route warmup reaches "ready"; algo monitor renders live.
P1 PRODUCER: server-owned Massive aggregate subscription persists canonical events w/o UI client;
  decouple eval+persist from SSE-subscriber-count guard. (keeps uncommitted guard-removals)
P2 PUSH: frontend EventSource on /signal-monitor/matrix/stream; demote matrix poll to fallback;
  move sparkline bars off REST fan-out to streaming aggregate path (kills volume+bars drivers).
P3 HARDEN: cold-start warm tolerance; pressure defers only heavy work not canonical persist;
  tests + runtime validation; commit undocumented migration in isolated slices.

## INDEPENDENT REVIEW (agent a595097a) — CONFIRMED-WITH-CORRECTIONS

CONFIRMED: claim1 pressure caps table+formula (resource-pressure.ts:200-233,260-266);
claim2 latency-driven not memory (live: watch, api-latency driver, RSS normal, heap fine;
reproduced GET /accounts/shadow/positions = 16.1s); claim4 producer gap keystone (flag off +
subscriber-gated writer => no canonical events; profile lastEvaluatedAt ~19h stale);
claim5 no frontend SSE consumer of matrix/stream (matrix cache 60s/5min confirmed).

CORRECTIONS (I was wrong):
- CLAIM 3 REFUTED: "Algo monitor idle" is NOT caused by API pressure. Idle gate has NO
  pressure input. Real gates: workspaceLeader (PlatformApp.jsx:841) + panel visibility
  (PlatformShell.jsx:827 requires activeScreen==="algo" or expanded sidebar) + warmup
  primaryReady (:1352/:1364, latches). 429-shed aux data is shed BECAUSE gate is false, not
  the cause. The "ONE state BOTH symptoms" unification was WRONG. Algo-idle needs its own probe.
- IBKR is CONNECTED (flapping connected<->disconnected), NOT intentionally disconnected.
  /positions 16s is slow WITH a live broker => unbounded fan-out / per-position quote
  enrichment, not a disconnect timeout. Flapping is a separate issue.
- RESTART LOOP bigger than flagged: 14 API pids today, all SIGTERM exit(143), oom_kill:0 =>
  Replit SUPERVISOR bouncing (not in-process OOM; resolveApiRssHardBlockMb=Infinity). Each
  restart wipes in-memory signal state + warmup. UNDERMINES a stateful in-memory producer (P1).
- Producer gap = STEADY-STATE cause; pressure = INTERMITTENT aggravator. Fixing pressure alone
  will NOT restore signals. => add Step 0 below.
- Minor: uncommitted PlatformAlgoMonitorSidebar.jsx ledger query assetClass "Options"->"option"
  (tied to commit 48f3ee1) — verify backend accepts lowercase or Algo ledger positions empty.
- Data-corruption risk: P0 degraded account/position/PnL responses MUST be display-only,
  stale-flagged, never feed order sizing / shadow-ledger reconciliation.

## VISIBILITY "CATCH-UP" (agent a414aa40) — user symptom: pauses when hidden, bursts on return

MECHANISM: usePageVisible.ts gates `refetchInterval: pageVisible ? X : false` across ALL
screens. Hidden => polls stop + browser throttles timers/rAF (render freeze) = intended perf.
Return => every gated query simultaneously re-arms AND refetches (stale: staleTime 15-30s <
away time) with NO stagger/coalesce = THUNDERING HERD (the "catch-up"). refetchOnWindowFocus
is OFF (AppProviders.tsx:9) — burst is from refetchInterval re-arm, not focus refetch.
Leadership does NOT drop on hide (single-tab stays leader) — not the cause.
VERDICT: pausing = by design; uncoalesced return-burst = real bug.
IMPACT (source-confirmed chain): return burst hits /bars,/bars/batch,sparklines,quotes,
equity-history,options concurrently => p95 spike (>=1000ms watch, >=10000ms high,
resource-pressure.ts:169-172) => route-admission sheds deferred-analytics 429 (retryAfter 15s)
=> recovers => repeats next focus. THE visibility burst is a primary trigger of the pressure
oscillation + 429 storm. Restart loop = likely independent (supervisor SIGTERM, no OOM path).
FIX: stagger/coalesce visibility-return resume (reuse queueInvalidation ladder PlatformApp.jsx
:2257-2286, trigger on visibility-return, once-per-return); cap return concurrency via
hydrationCoordinator/BARS_REQUEST_PRIORITY; raise staleTime on heavy families; server-side
pressure hysteresis/dwell so sub-second bursts can't toggle 429 caps.

## REVISED PLAN v3 (post-review)
STEP 0 PROVE (near-zero cost): set PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=true (or revert
  requireEventMetadata default off) -> observe if signals flow. Distinguishes producer-gap vs
  pressure empirically; likely restores signals immediately. DO BEFORE building infra.
STEP 1 VISIBILITY HERD: staggered/coalesced visibility-return resume (user symptom + pressure trigger).
STEP 2 SLOW ROUTES: cap/fix /positions (16s live-broker fan-out) + equity-history + shadow-positions;
  display-only degraded contract (no order/ledger consumption).
STEP 3 PRODUCER+SSE: server-owned subscription writes canonical events; frontend SSE push;
  retire poll. (NOTE: the "restart loop" 14 pids/day is the USER ITERATING in dev, NOT a crash
  loop — confirmed by user 2026-06-10. So restart-tolerance is sensible warm-start hygiene, NOT
  a blocker; do NOT spend time "stopping the restarts". Real prod won't bounce every few min.)
STEP 4 ALGO-IDLE: separately probe real gate (workspaceLeader/panel-visibility/primaryReady).
STEP 5 PRESSURE HYSTERESIS: dwell+cooldown on level transitions.

## STEP 1 PLAN v1 REVIEWED (agent a9cc0237) — FLAWED, revised below
- hydrationPressureState already OWNED by PlatformApp.jsx:3003 (from workSchedule.hydrationPressure,
  derived in appWorkScheduler.js:194 maxHydrationPressureState). A ramp setter = 2nd writer -> races.
- Global gate feeds CHARTS (MultiChartGrid/chartHydrationRuntime/useOptionChartBars), NOT the
  sparkline/bars universe (those only set priority headers, don't consult useHydrationGate). So
  ramping backoff gates foreground chart prewarm/flow, not the fan-out, until Step 2 lands.
- Burst already bounded by GLOBAL heavy-request queue cap 6 (custom-fetch.ts HEAVY_GET_CONCURRENCY)
  + in-flight dedupe; sparklines already priority -2 + settleWithConcurrency(4). Gating `enabled`
  only DELAYS enable -> herd re-releases together ~2s later. Real lever = the concurrency cap.
- 429->degraded ALREADY wired: custom-fetch.ts:860 dispatches pyrus:api-pressure on shed/429 ->
  useMemoryPressureSignal.js:214-257,332 (with hold window) -> memoryHydrationPressureState ->
  workSchedule.hydrationPressure -> setHydrationPressureState. Step 3 redundant.
- PREMISE SHAKY: heavy universe queries (BARS_QUERY_DEFAULTS refetchInterval:false, staleTime 5min,
  refetchOnMount:false; queryDefaults.js:17) do NOT self-refetch on return. The /api/bars storm seen
  earlier was the MOUNT queueInvalidation ladder (PlatformApp.jsx:2265, gated once-per-mount by
  startupRefreshQueuedRef) = navigation/boot, NOT tab-return. Real tab-return bursters = ~24
  screen-level `enabled:isVisible`+refetchInterval queries; only ACTIVE screen's fire on return.
- COLLATERAL invariant: order/account/signals reads must NEVER be gated (currently aren't — by
  accident, not design; state it explicitly).

## STEP 1 PLAN v2 (revised, lower-risk):
1. EMPIRICALLY pin the tab-return burst (browser: dispatch visibilitychange hidden->visible,
   capture network) — distinguish from mount/navigation burst. Don't fix until confirmed.
2. Raise staleTime on the real bursters (the ~24 screen-level isVisible queries) so return-within-
   window doesn't refetch. Lowest-risk, highest-yield.
3. If concurrency change wanted: lower HEAVY_GET_CONCURRENCY or add a low-priority lane cap in
   lib/api-client-react/src/custom-fetch.ts (the one true bound). 
4. DROP new 429 listener; just verify server shed/429 path stamps x-pyrus-pressure-level + hold ok.
5. If visibility ramp still wanted: fold into appWorkScheduler maxHydrationPressureState (degraded->
   normal, NEVER backoff), land WITH Step 2. Keep order/account/signals off the gate (invariant).

## "DISPLAY PAUSES WHEN NOT VIEWED" — ROOT CAUSE (verified 2026-06-10)
- usePageVisible has EXACTLY ONE consumer (PlatformApp.jsx:835); nearly all its uses are
  telemetry (useRuntimeWorkloadFlag = workloadStats diagnostics only, NOT a gate) + the
  diagnostic warmup snapshot. The ONLY functional visibility gate is session refetch (:1216).
- Screen-level `isVisible` props are IN-APP screen switching (screen==="market", PlatformScreenRouter
  :96-106), NOT browser-tab visibility. (Earlier reviewer a414aa40 misread these as tab-visibility.)
- Live SSE/WS streams do NOT gate on visibility (live-streams.ts: no visibility refs) — they stay open.
- Signal matrix POLL (PlatformApp ~4866 setInterval) is NOT visibility-gated either.
=> The app barely gates on tab visibility. The "pause" is the BROWSER throttling background tabs:
   setInterval/setTimeout slowed to ~1/min + requestAnimationFrame/paint paused for any hidden tab.
   App code cannot override browser background-tab throttling.
- CONSEQUENCE: stream-fed data stays live while hidden; POLL-fed data (the signal matrix / STA, and
  REST polls) gets browser-throttled while hidden -> goes stale -> "catch-up" jump on return.
- THE FIX for the signals pause = make signals STREAM-based (SSE push): EventSource delivery is NOT
  timer-throttled, so signals stay current while hidden and paint instantly on return (no catch-up).
  This is exactly the planned PUSH work (wire frontend to existing GET /signal-monitor/matrix/stream).
  Chart canvas (rAF) pausing while hidden is a browser policy — repaints current data on return, not
  app-fixable. So "fix the pause" for live data == build the SSE push (was Step 2/3).

## SSE PUSH CONSUMER — IMPLEMENTED + VERIFIED (2026-06-10) — fixes "display pauses when not viewed"
- WHY: signal matrix was REST-poll (setInterval) -> browser throttles to ~1/min while tab hidden ->
  freeze + catch-up on return. EventSource is NOT throttled while hidden -> stays live.
- CHANGE (frontend, additive — runs ALONGSIDE poll, idempotent merge):
  * artifacts/pyrus/src/features/platform/live-streams.ts: added getSignalMonitorMatrixStreamUrl +
    useSignalMonitorMatrixStream hook (EventSource on /api/signal-monitor/matrix/stream; handles
    `bootstrap` + `state-delta`; matches existing useAccountPageSnapshotStream idiom; auto-reconnect).
  * artifacts/pyrus/src/features/platform/PlatformApp.jsx: import hook; handleSignalMatrixStreamStates
    merges payload.states into signalMatrixSnapshot via mergeSignalMatrixStates (mirrors poll onSuccess
    :4452); hook enabled when signalsScreenMatrixSymbols.length>0 (NOT gated on pageVisible -> stays
    open while hidden). Inserted after signalsScreenMatrixSymbolsKey (~:3417).
- VALIDATION:
  * pnpm --filter @workspace/pyrus run typecheck = EXIT 0.
  * Backend stream probe (curl -N /api/signal-monitor/matrix/stream?symbols=SPY,QQQ,NVDA,IWM&
    timeframes=1m,5m, 22s): 1 bootstrap (states[] present, 4468 chars) + 6 state-delta (live, e.g.
    NVDA:1m) + 4 stream-status. Producer pushing live deltas confirmed (flag-on Step 0 producer feeds it).
  * Vite dev (HMR) serves the frontend edit; user reloads browser to pick it up.
- STILL ADDITIVE: REST poll still runs (doubles some eval load). FOLLOW-UP: trim/demote the poll to
  fallback/reconnect once SSE proven in the user's browser, to drop the extra load + retire heavy path.
- CAVEAT: chart canvas (rAF) still pauses while hidden (browser policy) — repaints current on return;
  this fix keeps the signal DATA/numbers live, not canvas animation.

## STEP 0 EXPERIMENT RESULT (2026-06-10) — PRODUCER-GAP CONFIRMED
- Change: added PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=true to artifacts/api-server/
  package.json `dev` script. audit:replit-startup = ok. User restarted (Run).
- Flag verified live in new api pid (52369) /proc environ.
- BEFORE (flag off): latest canonical event 2026-06-09T20:05Z (~19h stale); ~90% stale; 0 fresh.
- AFTER (flag on), within 2 min: fresh canonical events today (IWM 15:15Z, NVDA 14:55Z...);
  todayEvents 4->7->10; ok states 242->283 climbing; stale 2733->2692 dropping; refreshing=true.
  => enabling the producer restores signal flow. Diagnosis CONFIRMED.
- Pressure side effect: legacy universe batch-eval is heavier -> level went "high"
  (api-latency 11335ms). BUT signals flowed DURING high pressure => matrix event-writer is NOT
  gated by pressure caps (caps hit signal-OPTIONS/action layer). Permanent passive producer
  (event-driven on bar-close) is much lighter than this universe batch re-eval.
- OPEN DECISION: keep flag ON as interim stopgap (signals work now, +pressure load) vs REVERT
  (clean, signals stale again, build permanent). Flag change is currently UNCOMMITTED in dev script.
- MECHANISM (answer to "rest or sse?"): the Step 0 producer is REST-PULL, not SSE. Historical
  bars come from loadSignalMonitorCompletedBars -> fetchBars -> getBarsWithDebug (Massive REST
  /bars, source=trades outsideRth=true; signal-monitor.ts:4608-4634). WS aggregate push stream
  (loadSignalMonitorStreamCompletedBars) only blended for provisional live-edge when cache warm.
  => stopgap restores signals via REST universe re-eval = WHY pressure hit "high". This is the
  heavy path we want to eliminate. PERMANENT (Step 3) = drive eval from Massive WS aggregate PUSH
  on bar-close (event-driven, no REST fan-out) + persist canonical + SSE to STA.

## Runtime probes (this session)

- dist rebuilt 2026-06-10T08:33:06 (after Jun-9 edits) -> migration is LIVE in pid 7848.
- /api/signal-monitor/state?environment=paper: 3000 states, 2697 stale (90%), cacheStatus null.
- /api/signal-options/state -> HTTP 404 (path/method differs; non-blocking).

## Plan (forward-complete, producer-first) — AWAITING USER APPROVAL

Phase 1 PRODUCER: keep guard-removals; add server-owned aggregate subscription for the
monitored universe so bar-close persists canonical events without a UI client; decouple
canonical eval+persist from the SSE-subscriber-count guard (that guard should gate only
delta PUSH, not persistence). Restores signal flow with NO frontend change.
Phase 2 PUSH: frontend EventSource on /signal-monitor/matrix/stream (bootstrap+delta+status),
merge into signalMatrixSnapshot; demote REST poll to fallback/reconnect only.
Phase 3 CONSUMER: cold-start warm-up tolerance (pending vs empty); ensure pressure-pause
defers heavy action work only, not lightweight canonical persistence.
Phase 4 VERIFY+COMMIT: tests (passive bar-close write w/o UI client; SSE hydrate+delta;
gate passes once events exist) + runtime (stale ratio drop, events populated, SSE-fresh STA)
+ commit the undocumented migration in isolated coherent slices.
