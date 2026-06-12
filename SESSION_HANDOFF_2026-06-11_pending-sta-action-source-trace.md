# STA Action Source Trace - 2026-06-11

- Last Updated (MT): `2026-06-11 13:18:33 MDT`
- Last Updated (UTC): `2026-06-11T19:18:33Z`
- Native Codex Session ID: `pending`
- Scope: Restore the earlier STA signal flow where current Signal Options state drives action rows, Signal Matrix/SSE hydrates row context promptly, and MTF companion timeframes do not become executable STA rows.

## Root Cause

- Live trace showed `/api/algo/deployments/:id/signal-options/state` repeatedly timing out while cockpit summary and direct Signal Matrix evaluation could produce usable signals.
- The STA banner `STA action source is using the last successful snapshot` came from `resolveStableStaActionSnapshot()` in `artifacts/pyrus/src/screens/algo/algoHelpers.js`; the UI fell back to `previousSnapshot` when Signal Options state or cockpit failed/emptied/regressed. That fallback has now been removed.
- A later uncommitted UI change conflated MTF companion timeframes with executable STA action timeframes: `staSignalTimeframes` came from `entryGate.mtfAlignment.timeframes`, then `buildVisibleSignalRows()` used that list to create matrix-derived action rows. This allowed 2m/15m MTF rows to surface as STA action rows when execution timeframe was 5m.
- Stale helper tests in `artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs` asserted the bad behavior: matrix rows beat Signal Options duplicates, and previous snapshots survived empty refresh frames.
- The launch banner `Signal-Options Deployment Data Unavailable` was caused by `listAlgoDeployments()` using a `2.5s` route budget. Deployment list probes often took `2.48s-2.59s`, so startup could return `{ deployments: [], cacheStatus: "unavailable" }` before the real deployment list was available.
- The bad coupling was in `artifacts/api-server/src/routes/automation.ts`: the normal `/signal-options/state` route unconditionally passed `refreshSignalsFromMonitorState: true`, forcing the page-load primary state query to wait on a fresh Signal Monitor state read.
- The cockpit SSE primary payload also used `cacheMode: "cache-only"` plus `refreshSignalsFromMonitorState: true`, which can return a cold empty payload rather than the fast stored summary.

## Changes

- `artifacts/api-server/src/routes/automation.ts`
  - `/algo/deployments/:deploymentId/signal-options/state` now refreshes monitor state only when `?refreshSignals=true` is explicit.
  - Normal summary state reads use the fast stored/cached Signal Options snapshot.
- `artifacts/api-server/src/services/algo-cockpit-streams.ts`
  - Primary cockpit stream now calls `listSignalOptionsAutomationState({ view: "summary" })` without `cacheMode: "cache-only"` or forced monitor refresh.
- `artifacts/api-server/src/services/signal-options-automation.ts`
  - Fixed leftover `pressureCacheMode` reference to use the existing `cacheMode` variable.
- `artifacts/pyrus/src/screens/algo/algoHelpers.js`
  - Added explicit strategy execution-timeframe normalizers.
  - `buildVisibleSignalRows()` now takes `signalActionTimeframes` separately from display/MTF `signalTimeframes`.
  - Signal Options rows and candidates now take precedence over Signal Matrix duplicates.
  - Signal Matrix rows are only a fallback for the configured execution timeframe.
  - Removed previous-snapshot fallback from `resolveStableStaActionSnapshot()`.
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`
  - Main STA table now passes execution timeframe as `signalActionTimeframes` and MTF timeframes only as display/hydration timeframes.
  - Removed `previousStaActionSnapshotRef`.
- `artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx`
  - Sidebar signal action rows now use execution timeframe for action rows and MTF timeframes for bubbles.
  - Removed sidebar `previousStaActionSnapshotRef`.
- `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx`
  - Removed the obsolete buy/sell arrow glyph from the STA signal column.
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`
  - Replaced stale snapshot banner copy with current-source-unavailable copy.
- `artifacts/pyrus/src/screens/algo/algoHelpers.test.mjs`
  - Updated stale tests so matrix-only fallback is execution-timeframe-only, Signal Options beats matrix duplicates, and empty refresh frames do not reuse old rows.
- `artifacts/api-server/src/services/automation.ts`
  - Removed the deployment-list route-budget timeout and the empty `cacheStatus: "unavailable"` fallback. Deployment list requests now await the in-flight DB/cache load; transient DB failures only serve stale cache when one exists, otherwise they throw instead of fabricating an empty deployment list.
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`
  - Empty-unavailable deployment-list payloads no longer settle the setup state while a refetch is in flight.

## Live / Source Validation

- Direct live matrix POST for `TSM,NVDA,SPY` returned in about `0.4s` with signal-bearing matrix states.
- Direct source call to `listSignalOptionsAutomationState({ view: "summary" })` returned in `90ms` with `12` signals and `12` candidates.
- Direct source call to `fetchAlgoCockpitPrimaryPayload()` returned in `498ms` with `11` signals and `11` candidates.
- `pnpm --filter @workspace/api-server run typecheck` passed.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- `pnpm exec tsx --test src/services/automation.test.ts` passed: `5` tests.
- `pnpm exec tsx --test src/screens/algo/algoHelpers.test.mjs` passed: `13` tests.
- Focused helper probe passed: with Signal Matrix states for `TSM` on `2m`, `5m`, and `15m`, MTF display timeframes `2m/5m/15m`, and execution `5m`, `buildVisibleSignalRows()` returns only the `5m` STA row.
- Focused helper probe passed: empty cockpit/state refresh with an old previous snapshot returns `source: "empty"`, `signals: 0`, `candidates: 0`; old rows are not reused.
- Source search returned no remaining UI references to `last successful snapshot`, `previousStaActionSnapshotRef`, `previousSnapshot`, or `Action source cached`.
- Source search returned no remaining references to `DEPLOYMENT_LIST_ROUTE_WAIT_MS`, `DEPLOYMENT_LIST_TIMEOUT`, `deploymentListTimeoutWarningUntilMs`, or an empty deployment-list `cacheStatus: "unavailable"` fallback.
- Live probe after this UI fix:
  - `/api/algo/deployments` returned `200` in `3.489s`.
  - `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state` returned `200` in `0.552s` once, then a follow-up count probe timed out at `8s`.
  - `/cockpit` and `/api/signal-monitor/events?environment=paper&limit=5` timed out at `5s`.

## E2E Audit Addendum (2026-06-11 ~20:30Z) — matrix vs STA "most recent" divergence

- Live ground truth (paper env, the active one; live monitor frozen at 2026-06-01, disabled):
  - Freshest 5m signal = AES buy @ 2026-06-11T20:20Z (barsSince=0, fresh). STA source (signal-options/state) and matrix agree on AES.
  - SPY 5m signal = 2026-06-11T17:25Z (barsSince=36, ~3h old); SPY's 5m `latestBarAt`=20:27Z is the newest bar of any cell (SPY ticks constantly).
- Verified divergence cause (the "matrix shows SPY, STA shows AES" symptom):
  - STA table ranks by SIGNAL-FIRE time: `signalTimestampMs = max(signalAt, currentSignalAt)` — `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx:516-517`; default sort "newest" uses it first (`:1003`). → AES top. CORRECT.
  - Matrix view ranks by CELL-ACTIVITY time: `readSignalMatrixStateActivityMs = max(currentSignalAt, latestBarAt, lastEvaluatedAt)` — `artifacts/pyrus/src/features/signals/signalMatrixStateMerge.js:72`; used as the scheduler order key `readStateTimeMs` (`signalMatrixScheduler.js:194`) and as the cell-merge tiebreak (`signalMatrixStateMerge.js:119-122`). → SPY floats up on bar updates despite a stale signal. MISLEADING.
- Conclusion: SSE→matrix push pipeline delivers correct, identical data to both surfaces. STA table is correct. The matrix view conflates "most recently updated cell" with "most recent signal." Pipeline (ticker→aggregate→matrix SSE→STA filter by execution timeframe) confirmed correct end-to-end; the bug is the matrix view's recency/sort semantics, not the data flow.
- OSS phantom from the prior round was a stale client snapshot (pre-fix `previousStaActionSnapshotRef`); not present in any backend source.

## Upstream SSE-emit root cause (2026-06-11 ~20:41Z) — barsSinceSignal corrupted by gappy stream bars

- Symptom: STA table shows ADBG "1b, 35m" (1 bar since signal, but 35 min elapsed) — bar count and elapsed time do not line up.
- Live proof (paper, evaluatedAt 20:38Z): ADBG 5m and ADBE 5m have IDENTICAL signalAt=20:05Z and IDENTICAL latestBarAt=20:40Z, yet barsSinceSignal = ADBG:1 (wrong) vs ADBE:6 (correct). Same 35-min gap, different counts. ACRS 5m: signalAt 20:05, latestBarAt frozen at 20:21, barsSince=3, fresh=True at 36 min real age (stale signal mislabeled fresh).
- Mechanism (verified in source):
  - SSE delta path evaluates from the in-memory stream-bar cache: `emitSignalMonitorMatrixStreamAggregateDelta` (`signal-monitor.ts:6038`) -> `evaluateSignalMonitorMatrixStreamScopeDelta:6006` -> `evaluateSignalMonitorMatrixStateFromStreamBars:5713` -> `loadSignalMonitorStreamCompletedBars:3099`.
  - `loadSignalMonitorStreamCompletedBars` builds timeframe bars from minute aggregates (`getRecentStockMinuteAggregateHistory` + `getCurrentStockMinuteAggregates`, `:3123-3145`). Thin/gappy feeds skip empty minutes -> sparse (non-contiguous) bar series.
  - `barsSinceSignal = max(0, chartBars.length - 1 - signal.barIndex)` (`:5066`) = ARRAY-INDEX distance over that sparse series, NOT elapsed time. Gaps collapse the count.
  - The delta result is PERSISTED (`emitSignalMonitorMatrixStreamAggregateDelta:6112-6118`), so the corrupted barsSinceSignal flows into the persisted store the STA/signal-options layer reads, and is pushed live over SSE.
- Impact: `fresh = barsSinceSignal <= freshWindowBars` (`:5093`) and signal-options execution-window eligibility both derive from barsSinceSignal. Undercounting => stale signals (e.g. 35-min-old 5m) can be marked fresh/eligible on gappy-feed symbols. This is a trading-correctness risk, not cosmetic.
- Divergence vs authoritative path: full eval `loadSignalMonitorCompletedBars:4357` (DB/broker history) is contiguous; the stream/SSE path is not -> same `evaluateSignalMonitorMatrixStateFromCompletedBars` yields different barsSinceSignal depending on bar source.
- Fix direction (NOT yet applied): compute barsSinceSignal (and the fresh/staleness check) from elapsed time `(latestBarAt - signalAt) / TIMEFRAME_MS[tf]` (gap-aware), or gap-fill the stream bar series to contiguous intervals before counting. Candidate site: `signal-monitor.ts:5066` + fresh calc `:5093`. Needs regression test: gappy-feed symbol must report bars == elapsed-interval count and must not be fresh past the window.

## ROOT CAUSE (unified, 2026-06-11 ~20:55Z) — dual-producer redundancy corrupts the matrix

- The client signal matrix (`signalMatrixSnapshot`, `PlatformApp.jsx:3348`) is written by TWO independent producers, both merging into the same state via `mergeSignalMatrixStates` -> `preferSignalMatrixCellState`:
  1. SSE push: `useSignalMonitorMatrixStream` (`:3899`) -> `handleSignalMatrixStreamStates` (`:3468-3478`). Server-side this is the stream-bar/delta path = GAPPY bars -> wrong barsSinceSignal (ADBG=1).
  2. REST poll: `evaluateSignalMonitorMatrixMutation` (`:4376`, fired `:4835`) -> writers at `:4212,4511,4805`. Server-side this is the full eval = contiguous DB bars -> correct barsSinceSignal (ADBG=6-7).
- Code comment at `PlatformApp.jsx:3894-3898` admits both run: SSE scoped to monitored universe only, "Runs alongside the poll; merge is idempotent." The merge is NOT value-consistent: `preferSignalMatrixCellState` (signalMatrixStateMerge.js:113-126) keeps whichever version has the newer ACTIVITY timestamp (max currentSignalAt/latestBarAt/lastEvaluatedAt). The SSE delta fires every tick with fresh activity stamps, so its WRONG (gappy) cell overwrites the poll's CORRECT cell, and they flip-flop.
- This is the single mechanism behind all observed symptoms: ADBG "1b/35m" (gappy SSE cell wins), matrix-view "SPY most recent" vs STA "AES" (activity-stamp ordering amplified by two producers), stale-looking values that change on refresh.
- Fix order: (1) make the SSE/stream-bar path compute barsSinceSignal/fresh from elapsed time not gappy array index (`signal-monitor.ts:5066,5093`); (2) collapse to ONE producer for the grid — widen SSE scope to the full signals universe (or bootstrap once from `/signal-monitor/state`) and REMOVE the REST poll (`PlatformApp.jsx` evaluateSignalMonitorMatrixMutation + the SignalsScreen hydration-plan poll); (3) with one producer the activity-merge conflict disappears; (4) separately fix matrix-view "most recent" sort to key on signalAt not activity (`signalMatrixScheduler.js:194`).

## Phase 1 IMPLEMENTED + COMMITTED (2026-06-11 ~21:10Z)

- Branch `fix/signal-matrix-gap-aware-bars-since-signal`, commit `c30c536`.
- Added `signalMonitorBarsSinceSignal()` in `signal-monitor.ts` (before `evaluateSignalMonitorMatrixStateFromCompletedBars`); wired at the old `:5066` site (now `presentBarsSinceSignal` + helper). Intraday: `max(present, round((latestBarAt-signalAt)/tfMs))`; 1d keeps present-bar count (weekend-safe). Exported via `__signalMonitorInternalsForTests`.
- 5 new regression tests in `signal-monitor-completed-bars.test.ts`; full file 29/29 pass; `@workspace/api-server` typecheck clean. ADBG case pinned: present=1 -> 7.
- Effect: both producers (SSE stream + REST poll/full-eval) now agree on barsSinceSignal, so the flip-flop is gone even before the redundancy is removed. Running server is built dist (pid 1296) — fix is in source/branch, not yet live until rebuild.
- Commit also carries ~576 lines of pre-existing uncommitted signal-monitor refactor (not mine), bundled per user direction.
- NOT done (gated, need go-ahead): Phase 2 (collapse to single producer: widen SSE scope to full signals universe / bootstrap from /signal-monitor/state, remove REST poll `PlatformApp.jsx:4376` + SignalsScreen hydration plan) and Phase 3 (matrix-view "most recent" sort by signalAt; precise display-sort site still to be confirmed vs scheduler key `signalMatrixScheduler.js:194`).

## Phase 1 PUSHED TO MAIN + Phase 2 re-scoped (2026-06-11 ~21:25Z)

- Phase 1 fast-forwarded onto main and pushed: `origin main ec7b2bf..c30c536`.
- Phase 2 implementation-level investigation (single-producer collapse):
  - Coverage finding: the full Signals grid is already served by the platform full-state GET `signalMonitorStateQuery` (useGetSignalMonitorState, periodic `signalMonitorRuntimePollMs`, returns whole ~3000-cell universe) merged with `signalMatrixSnapshot` at `PlatformApp.jsx:3399 signalMonitorPublishedStates`. The per-cell REST poll (`evaluateSignalMonitorMatrixMutation`) is the REDUNDANT layer -> removing it does NOT blank the grid.
  - BUT scope is XL, not M-L: the poll subsystem is 165 refs / ~21 interconnected identifiers (signalsScreenMatrixRequest, signalMatrixRequestEpochRef, request leases acquire/release, queued-evaluation timers, rotation cursor, catchup delay, exact-cell limits, in-flight refs) spanning `PlatformApp.jsx:873-4939`, plus `signalMatrixScheduler.js` and the SignalsScreen hydration plan + "Hydrating N remaining" UI. Safe removal needs a dedicated, browser-QA'd change; do NOT rush/push blind.
  - Correctness note: Phase 1 already made both producers agree on barsSinceSignal, so the flip-flop is resolved; remaining Phase 2 value is efficiency, and the remaining VISIBLE symptom (matrix "most recent" = SPY) is Phase 3 (display sort), not the redundancy.
- Recommended next: do Phase 3 (small, fixes visible symptom) after precisely tracing the matrix "most recent" display site; treat Phase 2 poll-removal as its own staged + QA'd PR.

## ALL THREE PHASES SHIPPED TO MAIN (2026-06-11 ~22:10Z)

- Phase 1 `c30c536` (pushed): gap-aware barsSinceSignal (`signalMonitorBarsSinceSignal`, signal-monitor.ts) + 5 tests. Fixes ADBG "1b/35m".
- Phase 2 `2591fbb` (pushed): REST signal-matrix poll removed from PlatformApp.jsx (601 lines: evaluateSignalMonitorMatrixMutation, runSignalMatrixEvaluation, firing/timer effects, poll-only refs/imports). SSE + full-state GET are now the sole producers. Option B: kept signalsScreenMatrixRequest/handleRequestSignalMatrixHydration/buildSignalMatrixSymbolSets (they scope the SSE universe). Browser-smoke confirmed grid fills in safe mode (full-state GET alone). NOTE: a concurrent session bundled this change into commit 2591fbb under a boot-overlay message; the change is intact/verified.
- Phase 3 `8452fde` (pushed): Signals table recency ("Latest" sort + default tiebreaker) now ranks by `signalActivityMs` (signal-fire time) not `activityMs` (bar/eval activity), so stale-but-ticking SPY no longer outranks fresh AES. Cell-merge latch untouched. Regression test added.
- Verified each: typecheck + build clean; targeted tests green.
- KNOWN pre-existing failure (NOT ours): test "Signal matrix state index uses evaluated no-signal state over older signal" fails on HEAD too — from in-flight cell-merge latch changes in the uncommitted working tree. Flag for whoever owns the latch work.
- Deferred (user direction): pressure/backoff hardening of the matrix path is a later effort.

## Runtime Note

- Backend action-state endpoints remain intermittently slow during live probes. The UI regression fixed here no longer depends on stale previous snapshots or MTF-derived matrix action rows, but backend timing still needs separate observation if live endpoint timeouts persist after the user's normal app restart.
