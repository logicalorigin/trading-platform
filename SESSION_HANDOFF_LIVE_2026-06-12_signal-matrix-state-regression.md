# Live Handoff: Signal Matrix State Regression

- Last Updated (MT): `2026-06-12 14:25:31 MDT`
- Last Updated (UTC): `2026-06-12T20:25:31Z`
- Native Codex Session ID: `pending-signal-matrix-state-regression`
- Scope: Signal Matrix/STA table state repair and validation for stale/impossible matrix cells, table jumping, runtime-fallback contamination, stored stream bootstrap, and frontend merge churn.

## User Request

- Debug Signal Matrix/table startup ticker rotation and pressure behavior.
- Investigate table sparklines that appear to redraw every few seconds.
- Diagnose impossible cell display such as CEG 5m showing `1b` with `38m`/`45m`.
- User explicitly redirected away from UI text fixes and asked for the real state/data issue.
- User requested an additional agent review against app history/regression context.

## Latest Implementation Update

- Implemented the incremental state repair slice after the read-only diagnosis:
  - `signalMatrixStateMerge.js` now treats runtime-fallback event history as non-canonical matrix input, recomputes intraday signal age from signal/latest timestamps, preserves signal identity over directionless metadata refreshes, and reuses the current cell object for equivalent incoming state.
  - `signalMatrixScheduler.js` now returns the current state array when the merge result contains the same state objects, avoiding table-wide React churn for equivalent SSE/REST updates.
  - `PlatformApp.jsx` now uses the SSE/cache matrix snapshot as the stable base and applies REST state as incoming fill/newer data; equivalent stream pushes no-op the snapshot setter; pushed matrix state also counts as enough signal state to stop the bootstrap gate from suppressing sparklines.
  - `AlgoScreen.jsx` no longer recombines raw REST state with the canonical published matrix state before STA display.
  - `SignalsScreen.jsx` removed the old UI-side matrix hydration request/priority-symbol path and no longer shows sparkline point count as “bars” in interval tooltips. The table loading placeholder now waits only when there is no usable state source, so pushed matrix state can render while `/signal-monitor/state` is slow.
  - `signal-monitor.ts` now returns `stateSource` on public state/evaluate responses so runtime-fallback state is visible instead of being dropped before the UI can reason about it.
  - Follow-up agent review found a valid P1: runtime-fallback stored state could still enter matrix truth through stored stream bootstrap and frontend REST state rows. Fixed by carrying `stateSource` through `getSignalMonitorStoredState()`, emitting zero matrix bootstrap states for runtime-fallback stored snapshots, and excluding runtime-fallback REST states/universe from PlatformApp published matrix state and SignalsScreen row input.
- Runtime observations after the patch source edits, against the already-running Replit dev app:
  - `/api/healthz` returned OK.
  - `/api/signal-monitor/events?limit=1` returned `sourceStatus: "database"` when called directly on the API prefix.
  - `/api/signal-monitor/state` timed out at 8s in the live process, and diagnostics reported `/signal-monitor/state` p95 about `37.9s` and `/signal-monitor/events` p95 about `30.5s`.
  - The live API process was running `dist/index.mjs` built before these TypeScript edits, so runtime probes confirm the existing pressure/timeout symptom but do not validate the new bundle until the normal Replit app restart/rebuild occurs.
- Focused validation passed:
  - `pnpm --filter @workspace/pyrus exec tsx --test src/features/signals/signalMatrixStateMerge.test.mjs src/features/platform/signalMatrixScheduler.test.mjs`
  - `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/PlatformWatchlist.test.mjs src/features/signals/signalsRowModel.test.mjs src/screens/SignalsScreen.state-contract.test.mjs`
  - `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/OperationsSignalTable.test.mjs src/screens/algo/algoHelpers.test.mjs`
  - `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/algoSignalSparklinePressure.test.mjs src/screens/algo/OperationsSignalRow.test.mjs src/screens/algo/AlgoLivePage.test.mjs`
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-completed-bars.test.ts`
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-stream.test.ts src/services/signal-monitor-diagnostics.test.ts`
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-completed-bars.test.ts src/services/signal-monitor-stream.test.ts src/services/signal-monitor-diagnostics.test.ts`
  - `pnpm --filter @workspace/pyrus typecheck`
  - `pnpm --filter @workspace/api-server typecheck`
- Browser watch status:
  - App processes are already running through the expected Replit dev path.
  - This shell has no Playwright package and no Chromium binary on PATH, so no one-minute browser watch was completed in this final slice.

## Pickup Validation Update — 2026-06-12 14:19 MDT

- Resumed this workstream in the current Codex thread after the user explicitly selected the STA Table / Signal Matrix slice.
- Confirmed there is no staged Signal Matrix diff; current work is in unstaged tracked files plus untracked focused tests.
- Focused validation passed in the current tree:
  - `pnpm --filter @workspace/pyrus exec tsx --test src/features/signals/signalMatrixStateMerge.test.mjs src/features/platform/signalMatrixScheduler.test.mjs` — `28/28`.
  - `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/PlatformWatchlist.test.mjs src/features/signals/signalsRowModel.test.mjs src/screens/SignalsScreen.state-contract.test.mjs` — `18/18`.
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor-completed-bars.test.ts src/services/signal-monitor-stream.test.ts src/services/signal-monitor-diagnostics.test.ts` — `47/47`.
  - `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/OperationsSignalTable.test.mjs src/screens/algo/algoHelpers.test.mjs` — `26/26`.
  - `pnpm --filter @workspace/pyrus exec tsx --test src/screens/algo/algoSignalSparklinePressure.test.mjs src/screens/algo/OperationsSignalRow.test.mjs src/screens/algo/AlgoLivePage.test.mjs` — `16/16`.
  - `pnpm --filter @workspace/pyrus typecheck` passed.
  - `pnpm --filter @workspace/api-server typecheck` passed.
- Runtime check:
  - `node artifacts/pyrus/scripts/checkDevRuntime.mjs` found the expected Vite server on `18747` and API server on `8080`.
  - Runtime warning remains: API PID `3259` started at `2026-06-12T20:14:45.979Z`, before `artifacts/api-server/dist/index.mjs` rebuild at `2026-06-12T20:14:47.352Z`; live API behavior is not proof that the latest backend bundle is loaded until normal Replit Run App restart.
  - `/api/healthz` returned OK.
  - `/api/signal-monitor/events?environment=paper&limit=1` returned `sourceStatus: "database"`.
  - `/api/signal-monitor/state?environment=paper` returned persisted profile `a5721cf5-16e1-4221-81d1-f2064e997d98`, `stateSource: "database"`, and 500-symbol universe state.

## Post-Restart Runtime Check — 2026-06-12 14:25 MDT

- The user restarted the app and requested a check.
- `node artifacts/pyrus/scripts/checkDevRuntime.mjs` observed:
  - Vite dev server on `http://127.0.0.1:18747/`.
  - API server listening on `http://127.0.0.1:8080/api/healthz`.
  - Postgres reachable at `helium:5432/heliumdb`.
  - API PID `7678` and Vite PID `7795`.
  - Warning still present: API PID `7678` started at `2026-06-12T20:22:37.071Z`, before `artifacts/api-server/dist/index.mjs` rebuild at `2026-06-12T20:22:39.579Z`; the doctor still recommends a Replit Run App restart before treating backend bundle freshness as proven.
- Web/API live checks:
  - `curl http://127.0.0.1:18747/?pyrusQa=safe` returned the PYRUS Vite HTML.
  - `/api/healthz` returned `{"status":"ok"}`.
  - `/api/signal-monitor/events?environment=paper&limit=1` returned `sourceStatus: "database"` with a recent persisted event.
  - `/api/signal-monitor/state?environment=paper` returned `stateSource: "database"`, profile `a5721cf5-16e1-4221-81d1-f2064e997d98`, and `3000` states.
  - A focused state parser found `493` directional 5m states and `0` impossible 5m rows by the elapsed-time-vs-`barsSinceSignal` check used for this regression.
  - `/api/signal-monitor/matrix/stream?environment=paper&symbols=SPY,NVDA&timeframes=5m&requestOrigin=startup` returned SSE `bootstrap` first, not an empty bootstrap. The bootstrap had `stateCount: 2`; SPY and NVDA 5m both had concrete directional states, and stream coverage reported `requestedSymbols: 2`, `activeScopeSymbols: 2`, `taskCount: 2`, `source: "massive-websocket"`, `truncated: false`.
- Browser DOM QA was not completed in this shell: no Chromium/Chrome binary and no Playwright/Puppeteer package were available on PATH/node_modules. The completed check is API/SSE/web-serving validation, not a visual Signals table watch.

Current best next step: run safe browser DOM QA on the Signals/STA table with `?pyrusQa=safe` when browser tooling is available. If strict backend bundle freshness is required, restart once more after the API rebuild is quiet and rerun `checkDevRuntime.mjs` until the start-before-bundle warning clears.

## Observed Runtime / DB Facts

- Active paper profile: `a5721cf5-16e1-4221-81d1-f2064e997d98`.
- `/api/signal-monitor/state?environment=paper` returned CEG 5m with:
  - `currentSignalAt=2026-06-12T13:25:00.000Z`
  - `latestBarAt=2026-06-12T17:20:00.000Z`
  - `barsSinceSignal=43`
  - `fresh=false`
- Latest canonical CEG 5m event in `signal_monitor_events` for the same profile was:
  - `direction=buy`
  - `signal_at=2026-06-12T16:25:00Z`
  - payload `latestBarAt=2026-06-12T16:30:00.000Z`
- Therefore current persisted/API state for CEG was stale relative to canonical events before React merged or rendered anything.
- Active paper profile counts:
  - `2454 / 2572` directional intraday state rows undercount elapsed timeframe bars by more than one bar.
  - `301` active state rows lagged their latest canonical event by signal time or direction.
- Exact current low-bar/old-age shape still exists: ADCT 5m had `bars_since_signal=2` with `40` elapsed minutes.
- Headless Signals table watch (`http://127.0.0.1:18747/?pyrusQa=safe`, 65s, CDP/system Chromium) observed the visible table jumping:
  - Initial loading row at ~0.2s; table ready by ~4.9s.
  - Matrix state count ramped `90 -> 221 -> 675 -> 1386 -> 1398 -> 2975`, then dropped to `2867` at ~59s.
  - Visible row order changed at ~59s; `FSS`, `IIIV`, `INN`, `IBUY`, `IEI`, `IPAY`, `HACK`, `IOT` entered the top visible set.
  - Signals screen DOM saw `10329` mutations in 65s; sparkline SVG count changed `467 -> 459`.
  - Network during watch: `/api/bars/batch` `9` calls (`8` success, one aborted), `/api/signal-monitor/events` `6` calls with max `30644ms`, `/api/signal-monitor/state` one completed call plus another still in flight at end (`46854ms` old), matrix SSE streams long-lived/aborted on close.
  - Diagnostics during watch: resource pressure `high`, dominant driver API latency `25795ms`; bars cache hydration breakdown still included `signal-matrix: 49`, `sparkline: 38`, `signals-table-sparkline: 78`.
  - Platform matrix snapshot exposed `priorityCount: 500`; Signals hydration strip can separately show smaller planner priority counts such as the user's `33 priority symbols`.
- Step-1 runtime-fallback check on `2026-06-12T18:19-18:27Z`:
  - `node artifacts/pyrus/scripts/checkDevRuntime.mjs` showed Postgres reachable on `helium:5432/heliumdb`; `/api/diagnostics/runtime` storage status was `ok`, `transient=false`, with ping around `314-463ms`.
  - Live `/api/signal-monitor/events?environment=paper&limit=5` returned `sourceStatus: "database"` and event rows; live `/api/signal-monitor/profile?environment=paper` returned the persisted profile `a5721cf5-16e1-4221-81d1-f2064e997d98`, not `runtime-fallback-paper`.
  - Live `/api/signal-monitor/state?environment=paper` returned `3000` states, persisted profile, `fallbackUsed=false`, and no runtime-fallback `stateSource`.
  - Direct Postgres checks confirmed `signal_monitor_events` and `signal_monitor_symbol_states` exist; the latest-events query plan completed in about `0.092ms`; 36-hour paper event count was `7990`.
  - Runtime pressure was still present above the DB: `/api/signal-monitor/events` samples took `9.35s`, `2.94s`, and `13.08s`; `/api/signal-monitor/state` sampled at `5.06s`, one 30s client timeout, and one empty reply during a supervisor restart.
  - Flight recorder showed repeated `api-memory-pressure` and API RSS rising above `2GB` shortly after restart; current slow-route driver was `GET /bars`, with `GET /signal-monitor/events` also slow.
  - Lifecycle logs classified restarts as `same-container-supervisor-abrupt` and showed `/run/replit` env/toolchain file mtimes changing just before restarts, so the empty reply should not be attributed to Signal Monitor state without more evidence.
  - DB server capacity was not exhausted in the sampled moment: `max_connections=112`, about `20` connections observed. This does not rule out the API pool of `12` being locally saturated, but rules out global Postgres connection exhaustion.

## Historical / Regression Evidence

- `SESSION_HANDOFF_2026-06-11_pending-sta-action-source-trace.md` documents the earlier exact class: ADBG `1b, 35m`.
- Commit `c30c536 fix(signal-monitor): gap-aware barsSinceSignal for thin/gappy feeds` added `signalMonitorBarsSinceSignal(...)` specifically because sparse bars could make a 35-minute-old 5m signal read as 1 bar.
- Commit `e507395 fix(signals): latch signal-matrix direction + server-owned producer` then added the latch behavior whose commit text explicitly says a directionless re-eval keeps cached `signalAt/price/barsSinceSignal` while refreshing `latestBarAt/lastEvaluatedAt/status`.
- Commit `81ffd29 fix: stabilize pyrus startup and signal rows` changed `/signal-monitor/state` from `getSignalMonitorState({ ...query, staleFast: true })` to `getSignalMonitorState(query)`.
- Current dirty changes also set several signal monitor caches/TTLs to `0`, remove state-cache warmup/backoff machinery, remove active Signals screen matrix hydration callbacks, and make Signal Matrix bootstrap complete unconditionally in `PlatformApp`.

## Root Cause Hypothesis

This is a state-model regression/surfacing problem, not a table text bug.

1. Producer path still has sparse-bar counting in `evaluateSignalMonitorSymbolFromCompletedBars` (`chartBars.length - 1 - signal.barIndex`) while the gap-aware helper exists elsewhere.
2. `applyStoredSignalDirectionLatch` preserves old `barsSinceSignal` when a no-signal re-evaluation advances `latestBarAt`.
3. `shouldPreserveExistingSignalMonitorSymbolState` orders by `max(currentSignalAt, latestBarAt)`, so an existing row with newer `latestBarAt` can reject an incoming row with a newer actual signal.
4. Direction seeding from `signal_monitor_events` only updates null/empty directions; it does not repair non-null stale signal identity or recompute `bars_since_signal`.
5. Frontend merge paths can splice event signal identity, stored latest-bar metadata, and stale `barsSinceSignal` together.
6. Startup now depends more on stored state/SSE bootstrap/cache because current dirty changes removed active matrix hydration and warm state behavior, surfacing stale persisted rows faster.
7. The Signals/STA UI still has a leftover pull-hydration/priority-symbol concept:
   - `SignalsScreen.jsx` builds `priorityHydrationSymbols` from selected/expanded/top filtered rows and computes `matrixHydrationPlan`.
   - `signalsMatrixHydration.js` computes missing/aged/request cells and priority missing symbols.
   - `signalMatrixScheduler.js` still models exact-cell priority batches and pressure limits.
   - `PlatformApp.jsx` keeps the matrix SSE scoped to a 500-symbol universe even under watch/high pressure, while `/api/bars/batch` still hydrates `signal-matrix` and `signals-table-sparkline` families.
   - The old assumption in `live-streams.ts` says SSE runs alongside REST/poll and the merge is idempotent; observed state proves it is not idempotent because fields from different producers can be combined.

## Most Relevant Files

- `artifacts/api-server/src/services/signal-monitor.ts`
  - `applyStoredSignalDirectionLatch`
  - `shouldPreserveExistingSignalMonitorSymbolState`
  - `evaluateSignalMonitorSymbolFromCompletedBars`
  - `signalMonitorBarsSinceSignal`
  - `seedSignalMonitorDirectionsFromLatestEvents`
- `artifacts/api-server/src/routes/signal-monitor.ts`
  - `/signal-monitor/matrix/stream` stored bootstrap
  - `/signal-monitor/state`
- `artifacts/pyrus/src/features/signals/signalMatrixStateMerge.js`
  - `preferSignalMatrixCellState`
  - `signalMonitorEventToMatrixState`
  - `mergeSignalEventsIntoMatrixStates`
- `artifacts/pyrus/src/features/signals/signalMatrixSnapshotCache.js`
  - v1 local cache preserves `barsSinceSignal`/`fresh`.
- `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
  - state/query/SSE/event merge into `signalMonitorPublishedStates`.
  - `buildSignalMatrixSymbolSets(...)` currently receives empty Signals-screen symbol props and still drives a 500-symbol SSE universe.
- `artifacts/pyrus/src/screens/SignalsScreen.jsx`
  - table sparkline rows derive from changing `filteredRows`; current dirty diff removed active matrix hydration callback.
  - `priorityHydrationSymbols`, `matrixHydrationPlan`, and `SignalsHydrationStrip` are still visible pull-hydration concepts.
- `artifacts/pyrus/src/features/platform/signalMatrixScheduler.js`
  - priority/exact-cell request planner remains in source; high pressure still leaves wide/narrow symbol limits at `500`.

## Next Recommended Fix Boundary

1. Fix backend state production first:
   - Apply `signalMonitorBarsSinceSignal(...)` to every signal-monitor producer path, including `evaluateSignalMonitorSymbolFromCompletedBars`.
   - In latch/no-signal refresh, preserve signal identity only, not stale derived fields; recompute or clear `barsSinceSignal`/`fresh` when `latestBarAt` advances.
   - Change preserve ordering so newer real signal identity cannot lose to older state with newer bar metadata.
2. Repair/reconcile persisted state:
   - For each `profile_id + symbol + timeframe`, reconcile non-null stale state against latest canonical event, not just null directions.
   - Recompute intraday bars from chosen signal/evaluation data where safe; treat 1d/gap policy explicitly.
3. Normalize read/bootstrap/merge:
   - Stored SSE bootstrap and `/state` should not emit impossible rows.
   - Frontend event overlay must not copy stale `barsSinceSignal` after changing `currentSignalAt`/`latestBarAt`.
   - Invalidate or version local Signal Matrix snapshot cache once state semantics change.
4. Remove the old UI-owned Signal Matrix hydration as a producer:
   - The table can display coverage/freshness, but it should not plan/fetch missing Signal Matrix cells if SSE/server state is the source of truth.
   - Keep only the SSE/server-owned matrix state path for matrix cells; if a REST fallback remains, make it read-only bootstrap/repair and versioned with the same state semantics.
   - Stop feeding bar-batch `signal-matrix` hydration from Signals/STA while the matrix stream is live.
5. Address sparkline redraw after state ownership is fixed:
   - Signals table sparklines still fetch via `/api/bars/batch` (`signals-table-sparkline`) and are tied to changing `filteredRows`; stabilize row identity/cache after removing competing matrix state churn.

## Validation So Far

- Read-only DB/API/source investigation.
- Headless browser watch was run for 65s using system Chromium/CDP, not gstack.
- No test suite was run after the final read-only investigation.
