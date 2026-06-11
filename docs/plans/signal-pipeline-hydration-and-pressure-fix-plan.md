# Signal Pipeline — Hydration, STA Dedup, Pressure & Speed Fix Plan

Status: in progress · Owner: signals/algo · Created 2026-06-10 (MT)
Scope: signal bubbles, STA table, algo monitor, signal-options pipeline, API pressure.
Related: `docs/plans/signal-bubbles-sse-push-hydration-plan.md`,
`SESSION_HANDOFF_LIVE_2026-06-10_signals-stale-sta-table-investigation.md`.

## TL;DR

The trading-pipeline zeros the user saw (received/actions/orders/positions/P&L = 0) are
**mostly the market being closed**, not a backend bug. Real backend issues exist underneath:
an API-pressure freeze that throttles action scans even during market hours, a STA table that
renders historical signals as duplicate rows, and signal bubbles that don't hydrate because the
matrix cache isn't seeded from received signals. This plan fixes those.

## What is NOT broken (verified after-hours)

- **"Signal Cycle 500 → 0 received" / 0 actions / 0 orders / 0 positions / P&L $0.**
  The "received" counter (`artifacts/api-server/src/services/signal-options-automation.ts:7497`,
  gate `isSignalOptionsActionableSignalState` ~:2435) counts only signals that are `fresh === true`
  AND `barsSinceSignal <= 1` (SIGNAL_OPTIONS_MAX_ACTIONABLE_BARS_SINCE_SIGNAL = 1). Market closed
  20:00 UTC; live check at 23:08 UTC across 3000 cells: fresh=73, fresh+directional+within-1-bar=5.
  With no new bars closing, ~nothing is fresh → the whole downstream chain is legitimately 0.
  This is expected after-hours behavior; it should populate during market hours.
- **STA "duplicates" are not data corruption.** Canonical events are clean: 0 duplicate eventKeys
  across 1000 events; the multi-timestamp groups are distinct real signals over time
  (e.g. USO 1m buy fired 19:34 / 21:17 / 22:25).
- **Record 142W/170L, PF 1.48** = historical paper stats, not a fault.

## Confirmed root causes (real bugs)

### 1. Signal bubbles not hydrated — matrix cache isn't a latch / isn't seeded
- The matrix stores a direction per (symbol, timeframe). A re-evaluation that finds no fresh
  signal emitted `direction: null` and **overwrote** the cached buy/sell because it had a newer
  `latestBarAt` (`shouldPreserveExistingSignalMonitorSymbolState` ranks by activity).
  Frontend `preferSignalMatrixCellState` (`signalMatrixStateMerge.js:111`) had the same flaw.
- Result gradient (live): 1m/2m ~100% null, 5m ~76% null, 1h ~0%, 1d ~1% (short TFs rarely have a
  *fresh* signal in-window, so they kept getting wiped).
- The durable record of received signals (canonical events) DOES cover most cells
  (1m: 97 symbols, 2m: 116, 5m: 309), but the cache never seeded from it.

### 2. Algo monitor not displaying — API pressure freeze
- Pressure level = "watch", driven by API latency. Culprit route: `GET /accounts/shadow/positions`
  p95 ~50s (a few samples) dragging overall p95 to ~5–6.5s.
- At "watch", `getApiResourcePressureCaps` (`resource-pressure.ts:196-234`) sets
  `signalOptions.actionScansAllowed = false` → action/deployment scans frozen → algo monitor empty.
- (Frontend gate also requires workspace-leader + panel visible + warmup primaryReady, but the
  backend freeze is the active blocker.)

### 3. STA table shows duplicate rows
- `buildVisibleSignalRows` (`artifacts/pyrus/src/screens/algo/algoHelpers.js:713-778`) merges
  signals + candidates + (when `includeSignalHistory`) history rows, deduped by
  `symbol|timeframe|direction|signalAt` with `signalAt` as a raw timestamp
  (`signalRowIdentityKey` :564-576). Each historical same-direction signal for a cell becomes its
  own row → "multiples of each signal." Became visible once signals actually started flowing.

### 4. STA page slow (~3s), not instant
- `POST /api/signal-monitor/matrix` ~3.1s, `GET /api/signal-monitor/profile` ~1.8s; the page leans
  on them. Fast path already exists: `GET /api/signal-monitor/state` ~28ms (cached) + the SSE
  matrix stream.

## Fix plan (ordered)

### Step 1 — Bubble cache latch (DONE)
- `artifacts/api-server/src/services/signal-monitor.ts`: `applyStoredSignalDirectionLatch` wired
  into `upsertSymbolState` — a directionless re-eval no longer erases the cached direction.
- `artifacts/pyrus/src/features/signals/signalMatrixStateMerge.js`: `preferSignalMatrixCellState`
  keeps a directional cell over a directionless update; a directional update still wins.
- Tests: `signal-monitor-completed-bars.test.ts`, `signalMatrixStateMerge.test.mjs`. Typecheck + unit pass.
- Limitation: latch can only HOLD a cached direction; it cannot seed cells the old bug already
  nulled (hence still-null after-hours). → Step 2.

### Step 2 — Seed the matrix from received signals (events)  [DONE, pending restart]
- When a cell has no cached direction, seed `currentSignalDirection` (and `currentSignalAt`,
  `fresh:false`) from the most recent canonical event for that (symbol, timeframe).
- Durable, survives restarts/prior corruption; hydrates bubbles immediately, after-hours-proof.
- Does NOT mark signals fresh → does NOT affect the "received"/actions pipeline (display only).
- Verify: 1m/2m/5m null-direction counts collapse toward 0 right after deploy.

### Step 3 — STA dedup: one row per current signal  [DONE]
- Collapse `buildVisibleSignalRows` to one row per (symbol, timeframe) = the current latched
  signal, instead of every historical signalAt. Keep history behind an explicit toggle only.
- Verify: each cell shows a single STA row; no repeated same-direction rows.

### Step 4 — Pressure root cause = event-loop saturation; fix = cooperative yields  [DONE, pending restart]
- Ensure `GET /accounts/shadow/positions` cannot exceed the degraded-fallback budget (extend the
  fallback from session 019eaea5 so it never blocks 50s); and/or add pressure hysteresis so a few
  slow samples don't pin the level at "watch" and freeze action scans.
- Verify: flight-recorder level returns to "normal"; caps `actionScansAllowed` true.

### Step 5 — STA fast load  [TODO]
- Hydrate STA from cached `GET /signal-monitor/state` (~28ms) + SSE immediately; demote the 3s
  `POST /signal-monitor/matrix` poll to background refresh (don't block first paint on it).
- Verify: STA first paint well under ~1s.

## Validation gates

- `pnpm --filter @workspace/api-server run typecheck` and `pnpm --filter @workspace/pyrus run typecheck`.
- Unit: signal-monitor + signal-options suites; signalMatrixStateMerge; algoHelpers.
- Live (market hours) acceptance: bubbles all directional; STA one row/cell; pressure "normal";
  "received" > 0 with fresh signals; actions/orders flow.

## Notes / non-goals

- Do not fabricate signal directions from trend/structure; direction comes from received signals
  (latched) per product owner ("it's either buy or sell; last signal holds until an opposite one").
- New tickers with no signal history may show pending until their first signal (rare, accepted).
- All changes uncommitted in the working tree alongside the earlier server-owned-producer work.

## Step 4 deep-dive (2026-06-10) — root cause is event-loop saturation, not slow queries

CRITICAL FINDING (verified, not theory):
- GET /algo/events p95 = 25s, overall API p95 = 13.9s — but the DB query is ~1ms
  (EXPLAIN: index backward scan, 671k rows / 1.5GB table, both filtered + unfiltered fast).
- Direct probe: cached /signal-monitor/state (normally ~28ms) intermittently spikes to
  ~770ms while neighbouring calls stay fast = the single Node event loop is BLOCKED ~700ms
  at a time by CPU-bound signal evaluation (whole-universe CHoCH/BOS math). Memory healthy
  (rss ~1.3GB, heap <20%). So pressure 'watch' -> actionScansAllowed=false is downstream of
  this; raising thresholds would only hide it.
- Contributors to the blocking: the Step-0 heavy universe re-eval flag AND the new
  server-owned producer (re-evaluates the universe per tick).

USER DECISION: worker-thread offload (move signal eval off the main thread).

OFFLOAD INFRASTRUCTURE ALREADY EXISTS (Python compute lane):
- `python-compute.ts` spawns a Python subprocess; lane "research" handles jobTypes
  ["benchmark_matrix","signal_matrix"]. Gated by PYRUS_PYTHON_COMPUTE_ENABLED + lane enabled
  + PYRUS_PYTHON_SIGNAL_MATRIX_ENABLED (currently off).
- `python/pyrus_compute/.../jobs.py` has a COMPLETE parity impl: run_signal_matrix,
  _evaluate_signal_cell, passes_choch_filters, BOS/CHoCH, SMA/WMA/ATR/ADX, volatility,
  trend/structure direction (~1606 lines mirroring lib/pyrus-signals-core TS).
- Wired at signal-monitor.ts:7238 in evaluateSignalMonitorMatrixSymbol (the per-symbol
  matrix path). Does NOT cover the universe-batch re-eval or the server-owned producer.
- No app-level TS<->Python parity test (only gstack skill parity tests, unrelated).

OPEN DECISION (next): the user asked for a WORKER THREAD; the built offload is a PYTHON
SUBPROCESS. Two paths:
  (A) Enable + extend the existing Python lane: least new code, but parity risk (Python vs
      TS) in live trading, and must also route the universe/producer eval through it.
  (B) Build a Node worker_threads pool running the EXISTING TS evaluatePyrusSignalsSignals:
      guaranteed parity (same code), no Python; from scratch (no worker infra in api-server).
Either way: parity verification BEFORE enabling for live signals; cover all heavy eval paths,
not just the REST matrix path.

## Step 4 — REVISED approach (user redirect): finish Step-0, don't add a worker

User insight: we already built the event-driven SSE-push producer; the heavy whole-universe
re-eval is a leftover stopgap. So instead of a worker offload, smooth the synchronous bursts
and lean on the event-driven path. Key fact: the bar-eval flag is the master "evaluate" switch
(producer needs it) — NOT a separable redundant path. The redundant heavy thing is the
synchronous whole-universe eval burst.

DONE (cooperative event-loop yields — keeps event-driven design, no worker):
- artifacts/api-server/src/services/signal-monitor.ts:
  - added yieldSignalMonitorEventLoop() + SIGNAL_MONITOR_EVAL_YIELD_EVERY=8.
  - flushSignalMonitorMatrixStreamAggregates() now async, yields every 8 symbols (fixes the
    minute-boundary burst where the whole universe's bars close at once).
  - both matrix eval loops (buildFreshMatrixResponse, buildFreshRuntimeMatrixResponse) now cap
    the sync batch to <=8 and yield between chunks (fixes the soft-bypass concurrency=symbolCount
    ~600ms block from the algo-screen matrix poll).
  - evaluateSymbolsInBatches yields between batches (state-refresh path).

VALIDATION: api typecheck + signal-monitor stream/completed-bars tests. Live: after restart,
re-run the 12x cached /signal-monitor/state probe — the ~770ms spikes should drop toward ~30ms;
overall p95 should fall under the 1s 'watch' threshold so actionScansAllowed returns true.

NOT done yet: confirm live that pressure returns to 'normal' and the spikes are gone (needs restart).
Worker-thread offload deferred — only revisit if yields aren't enough under market-hours load.
