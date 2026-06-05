# Live Session Handoff: Native Signal Matrix Hydration

- Session ID: pending
- Saved (MT): 2026-05-29 15:50:56 MDT
- Saved (UTC): 2026-05-29T21:50:56Z
- CWD: /home/runner/workspace
- User request: Implement the native-first signal matrix hydration plan after confirming Massive serves 1m/2m/5m/15m aggregate bars, then audit every signal bubble for shared hydration and API-source reuse.

## Current Status

- Core implementation patch applied and validated.
- Existing worktree is already heavily dirty from other workstreams; this session must avoid reverting unrelated changes.
- Provider now includes native `2m` Massive/Polygon aggregates.
- Platform `2m` bars now resolve as native provider bars instead of forced `1m` rollup.
- Signal matrix loading now requests each bubble timeframe independently and uses rollup helpers only as fallback for `2m`/`15m`.
- API generated source-strategy enum updated to `native_timeframes`.
- Post-implementation audit found the Algo Monitor Signals to Actions dots were only using the single signal record fallback. They now receive the shared `signalMatrixStates` path on desktop and mobile, map by symbol with `buildSignalMatrixBySymbol`, and hydrate the 2m/5m/15m dots without adding another API source.
- Frontend signal-bubble consumers audited:
  - Watchlist rows use `signalMatrixSnapshot.states` via `PlatformShell`/`PlatformWatchlist` and `SignalDots`.
  - Algo live signal rows use `signalMatrixSnapshot.states` via `PlatformScreenRouter`/`AlgoScreen`/`AlgoLivePage`/`OperationsSignalTable`.
  - Header signal tape uses `signalMatrixSnapshot.states` via `AppHeader`/`HeaderBroadcastScrollerStack` and only attaches interval context to existing signal pills.
  - Algo Monitor sidebar now uses the same matrix state and keeps the cockpit signal record as fallback only.
- API availability guardrails confirmed: only `PlatformApp` owns `useEvaluateSignalMonitorMatrix`; followers are cache-only; automatic duplicate requests are debounced; `/signal-monitor/state` polling is a stale-fast persisted-state read and does not fetch bars.
- Algo Monitor action signals come from `getSignalMonitorState` filtered by deployment universe in `signal-options-automation.ts`, so active action symbols that appear in the sidebar are already represented in `signalMonitorSymbols` and join the matrix universe; stale fallback candidates still render their single recorded signal without creating source calls.
- Browser audit found a real remaining UI hydration gap: under Replit/API pressure the matrix endpoint worked, but the frontend scheduler was only asking for tiny batches and treating stale partial cache responses as complete. Visible 2m/15m dots could stay unhydrated/pending while 5m fell back to the legacy persisted signal state.
- Scheduler now mirrors the backend matrix caps (`normal:8`, `watch:6`, `high:4`, `:2`) instead of starving the frontend at `3/2/1/1`, and it no longer fills spare matrix capacity with already-fresh background symbols.
- `SignalDots` now distinguishes truly missing matrix state as `pending` instead of rendering it as `none/no signal - unknown`, matching the header interval context and making hydration gaps visible.
- `PlatformApp` now queues a bounded matrix follow-up when a symbol-set change arrives while a matrix request is in flight, when the API truncates/skips a matrix batch, or when a stale partial cache payload returns fewer states than the request should have produced. Partial/truncated follow-ups are delayed/cooldown-bound to avoid hammering Massive/API availability.
- Added `window.__PYRUS_SIGNAL_MATRIX_SNAPSHOT__` dev diagnostics with last plan, pressure level, queue state, states, skipped/truncated flags, and coverage for future visual QA.
- Important live validation fact: during browser QA the app/API entered `high` pressure and the Replit dev app process relaunched at about `2026-05-29T21:25:09Z` (`dev:replit` PID changed to 60262). Frontend/API health checks were 200 afterward. This means further browser reload/soak should use safe QA/admission shedding and avoid repeated full reloads while matrix requests are in flight.
- Follow-up pass found why watchlist suggestion rows were still weaker: they are monitored-only rows from `/api/signal-monitor/state`, which is a 5m persisted fallback, but their 2m/15m dots need matrix hydration. The matrix priority order also allowed open-position spillover to consume the pressure-capped priority slots before signal suggestions.
- Added `buildSignalMatrixSymbolSets` and moved suggested signal symbols (`signalMonitorSymbols` not already in the active watchlist) ahead of open-position spillover in matrix universe/priority ordering. `window.__PYRUS_SIGNAL_MATRIX_SNAPSHOT__` now includes `suggestedSignalSymbols`.
- Non-browser live check with current Core watchlist confirmed high-pressure priority now starts with active watchlist symbols followed by suggested signals: `SPY,NVDA,DIA,AAPL,MSFT,TSLA,TQQQ,SQQQ,LMT,CCJ,ISRG,CEG,ALAB,ACHR,COHR,PLTR`.
- Removed the legacy 5m fallback from all interval bubble paths. `SignalDots` now reads only `statesByTimeframe`; watchlist, Algo table, and Algo Monitor sidebar no longer pass a fallback state; header interval context no longer backfills from the pill item; watchlist signal sorting/pill selection ignores legacy monitor state when matrix state is missing.
- Second visual pass found the fallback removal exposed several delivery bugs:
  - `PlatformApp` diagnostics read new signal bootstrap flags before declaration, which could break render and leave all dots pending.
  - Backend matrix settings still clamped to the signal monitor profile `maxSymbols`, so the live profile could truncate an 18-symbol startup matrix batch to 6 despite larger pressure caps.
  - Backend matrix concurrency was too low for available historical-bars capacity; a cold 18-symbol x 3-timeframe request took about 56s at concurrency 2.
  - Header signal lane recency order did not match matrix priority order, so visible signal-lane pills could miss early matrix batches.
  - Lower-priority startup streams were not gated while signal profile/state bootstrap was still pending, so signal state and matrix calls could sit behind heavier startup work.
  - Matrix `inFlight` could remain stuck after HMR/network interruption.
- Applied second-pass fixes:
  - Moved signal bootstrap declarations before diagnostics reads.
  - Raised scheduler caps to `normal:24`, `watch:18`, `high:12`, `:6`.
  - Decoupled backend matrix caps from profile `maxSymbols`; matrix now uses pressure caps directly.
  - Raised backend matrix concurrency to `normal/watch:4`, `high:2`, `:1`.
  - Ordered matrix signal priorities from `buildHeaderSignalContextSymbols` so visible header signal-lane symbols are requested early.
  - Added signal profile/state bootstrap gating before low-priority streams and histories start.
  - Added a 90s request timeout plus watchdog grace path to clear stuck matrix `inFlight` and retry.
  - Cleared stale `skippedSymbols` and `truncated` diagnostics after successful non-truncated matrix responses.
- Live browser verification after final settle: fresh navigation to `http://127.0.0.1:18747/?pyrusQa=off` had no console errors, `bootstrapComplete: true`, `stateCount: 54`, coverage `requestedSymbols: 18`, `hydratedSymbols: 18`, `missingSymbols: 0`, and 51 active dots after 35s. Screenshot saved at `/tmp/pyrus-signal-dots-final.png`.
- Replit note: live verification triggered app-supervisor restarts while rebuilding/reloading. Lifecycle logs classified them as same-container supervisor restarts, not container reboots. Avoid `pnpm --filter @workspace/api-server run build` against the active Replit workflow during routine visual QA; use temporary API ports for backend probes and one final app reload only after edits settle.

## Active Files

- artifacts/api-server/src/providers/polygon/market-data.ts
- artifacts/api-server/src/providers/polygon/market-data.validation.ts
- artifacts/api-server/src/services/platform.ts
- artifacts/api-server/src/services/signal-monitor.ts
- artifacts/api-server/src/services/signal-monitor.validation.ts
- artifacts/pyrus/src/features/platform/MobileActivitySheet.jsx
- artifacts/pyrus/src/features/platform/PlatformAlgoMonitorSidebar.jsx
- artifacts/pyrus/src/features/platform/PlatformShell.jsx
- artifacts/pyrus/src/features/platform/PlatformWatchlist.jsx
- artifacts/pyrus/src/features/platform/headerBroadcastModel.js
- artifacts/pyrus/src/features/platform/headerBroadcastModel.validation.js
- artifacts/pyrus/src/features/platform/watchlistModel.js
- artifacts/pyrus/src/features/platform/watchlistModel.validation.js
- artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx
- artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx
- artifacts/pyrus/src/screens/algo/OperationsSignalRow.validation.js
- artifacts/pyrus/src/features/platform/platformRootSource.validation.js
- lib/api-spec/openapi.yaml
- lib/api-zod/src/generated/api.ts
- lib/api-zod/src/generated/types/signalMonitorMatrixResponseCoverageSourceStrategy.ts
- lib/api-client-react/src/generated/api.schemas.ts

## Validation Status

- Pre-implementation fact checks confirmed Massive `range/2/minute` and `range/15/minute` return OK, and native/synthetic OHLCV match where both exist.
- `pnpm --filter @workspace/api-server exec node JS validation runner src/providers/polygon/market-data.validation.ts` passed.
- `pnpm --filter @workspace/api-server exec node JS validation runner src/services/signal-monitor.validation.ts` passed.
- `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/signalMatrixScheduler.validation.js src/features/platform/watchlistModel.validation.js` passed.
- `pnpm --filter @workspace/api-server run typecheck` passed.
- `pnpm --filter @workspace/api-client-react run typecheck` passed.
- `pnpm run audit:api-codegen` passed after regenerating clients from the updated OpenAPI spec.
- `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "mobile shell uses bottom navigation|Algo monitor" src/features/platform/platformRootSource.validation.js` passed.
- `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/signalMatrixScheduler.validation.js src/features/platform/watchlistModel.validation.js src/screens/algo/OperationsSignalRow.validation.js src/features/platform/headerBroadcastModel.validation.js` passed.
- `pnpm --filter @workspace/api-server exec node JS validation runner src/services/signal-monitor.validation.ts src/providers/polygon/market-data.validation.ts` passed.
- `pnpm --filter @workspace/pyrus run typecheck` passed.
- `git diff --check -- ...` passed for the touched signal-matrix/API/frontend files.
- Live one-symbol runtime probe passed: `evaluateSignalMonitorMatrix({ symbols: ["SPY"], timeframes: ["2m","5m","15m"] })` returned `status: ok` for all three timeframes, `coverage.sourceStrategy: "native_timeframes"`, `sourceRequestCount: 3`, and `missingSymbols: 0`.
- Full `platformRootSource.validation.js` was not clean as a whole because four unrelated pre-existing source assertions fail against other dirty worktree changes; the focused new Algo Monitor/mobile assertions passed.
- Additional validation after visual audit fixes:
  - `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/signalMatrixScheduler.validation.js src/features/platform/watchlistModel.validation.js src/features/platform/headerBroadcastModel.validation.js` passed.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - `git diff --check -- artifacts/pyrus/src/features/platform/signalMatrixScheduler.js artifacts/pyrus/src/features/platform/signalMatrixScheduler.validation.js artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx artifacts/pyrus/src/features/platform/PlatformApp.jsx` passed.
  - `OperationsSignalRow.validation.js` currently fails on an unrelated pre-existing dirty-worktree mismatch: `DEFAULT_SIGNAL_VISIBLE_COLUMNS` no longer includes `sync` in `OperationsSignalRow.jsx`, while the test still expects it.
- Additional suggestion-row validation:
  - `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/signalMatrixScheduler.validation.js src/features/platform/watchlistModel.validation.js src/features/platform/headerBroadcastModel.validation.js` passed with the new symbol-set regression.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - `memory/2026-05-29-signal-bubble-suggestion-hydration.md` saved the debug report.
- Additional fallback-removal validation:
  - `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/headerBroadcastModel.validation.js src/features/platform/watchlistModel.validation.js src/features/platform/signalMatrixScheduler.validation.js` passed.
  - `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "shared signal dots preserve watchlist behavior after extraction|algo signal table builds matrix" src/screens/algo/OperationsSignalRow.validation.js` passed.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - `git diff --check --` passed for the fallback-removal files.
- Additional second-pass validation:
  - `pnpm --filter @workspace/api-server exec node JS validation runner src/services/signal-monitor.validation.ts` passed.
  - `pnpm --filter @workspace/api-server run typecheck` passed.
  - `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/signalMatrixScheduler.validation.js` passed.
  - `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "signal monitor display refreshes separately from evaluator cadence|screen shell warmup preloads top-level code without default hidden page mounting" src/features/platform/platformRootSource.validation.js` passed.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - `git diff --check -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-monitor.validation.ts artifacts/pyrus/src/features/platform/PlatformApp.jsx artifacts/pyrus/src/features/platform/platformRootSource.validation.js artifacts/pyrus/src/features/platform/signalMatrixScheduler.js artifacts/pyrus/src/features/platform/signalMatrixScheduler.validation.js` passed.
  - Temporary rebuilt API on port 18092 returned 54 matrix states for 18 requested symbols with no skipped symbols/truncation in about 11.1s.
  - Browser visual QA passed as noted above.
- Additional "no dots hydrated" pass:
  - Removed the remaining emergency 1m/5m aggregation fallback from `loadSignalMonitorCompletedBars`; matrix hydration now uses native 2m/5m/15m bars only and surfaces missing native data instead of silently switching source.
  - Decoupled signal-matrix scheduling pressure from broader UI memory pressure: signal matrix now uses server/API pressure unless the browser app is truly ``, so chart/cache watch drivers do not shrink the signal universe or slow the matrix poll.
  - Raised signal-matrix historical bar priority from 4/6 to 8/9 so bounded signal hydration preempts visible chart/history backfills during startup.
  - `pnpm --filter @workspace/api-server exec node JS validation runner src/services/signal-monitor.validation.ts` passed after native-only fallback removal and priority bump.
  - `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "signal monitor display refreshes separately from evaluator cadence" src/features/platform/platformRootSource.validation.js` passed.
  - `pnpm --filter @workspace/pyrus run typecheck` passed.
  - `git diff --check -- artifacts/api-server/src/services/signal-monitor.ts artifacts/api-server/src/services/signal-monitor.validation.ts artifacts/pyrus/src/features/platform/PlatformApp.jsx artifacts/pyrus/src/features/platform/platformRootSource.validation.js artifacts/pyrus/src/features/platform/signalMatrixScheduler.js artifacts/pyrus/src/features/platform/signalMatrixScheduler.validation.js` passed.
  - Live browser after frontend hot update showed `pressureLevel: "watch"`, `appPressureLevel: "watch"`, `serverPressureLevel: "watch"`, `pollMs: 60000`, `universeCount: 57`, `priorityCount: 32`, `stateCount: 108`, `coverage.requestedSymbols: 18`, `coverage.hydratedSymbols: 18`, `coverage.sourceStrategy: "native_timeframes"`, `coverage.truncated: false`; visible dot directions counted `buy: 97`, `sell: 140`, `pending: 54`. Remaining pending dots are lower-priority symbols awaiting the next rotation, not a disconnected signal lane.
- Post-restart verification:
  - Running `artifacts/api-server/dist/index.mjs` contains the latest native-only source strategy, `SIGNAL_MONITOR_BARS_PRIORITY = 8`, `SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY = 9`, and `providerTimeframe = input.timeframe`.
  - API health responded `{"status":"ok"}` while matrix hydration was active.
  - Browser run at `http://127.0.0.1:18747/?pyrusQa=off` completed three matrix cycles without a stuck in-flight state.
  - Final browser snapshot: `pressureLevel: "watch"`, `appPressureLevel: "high"`, `serverPressureLevel: "watch"`, `pollMs: 60000`, `runtimeReady: true`, `bootstrapComplete: true`, `stateCount: 204`, `coverage.requestedSymbols: 18`, `coverage.hydratedSymbols: 18`, `coverage.missingSymbols: 0`, `coverage.sourceStrategy: "native_timeframes"`, `durationMs: 36713`, `truncated: false`.
  - Precise visible signal-dot selector `[data-timeframe][data-direction]` counted `330` hydrated dots: `178 sell`, `152 buy`, `0 pending`.
  - Console errors were cleared and rechecked after the final matrix cycle: no console errors.

## Next Step

- Review/commit the native signal matrix hydration, shared signal-bubble hydration, scheduler cap/pending-state fixes, fallback removal, and signal matrix diagnostics together. Keep unrelated dirty worktree changes isolated.
- For any further visual QA, first wait for the app to settle, use safe-QA/admission shedding where possible, and avoid repeated reloads while matrix requests are already pending.
- For future verification, avoid rebuilding the active API dist while Replit Run is live. Use temporary API ports for backend probes, then do one controlled Replit app refresh after edits settle.
