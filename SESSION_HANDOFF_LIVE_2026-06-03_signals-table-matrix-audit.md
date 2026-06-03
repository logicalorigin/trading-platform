# Live Session Handoff - Signals Table Matrix Audit

- Session ID: pending
- CWD: `/home/runner/workspace`
- Saved At (MT): `2026-06-03 07:09:23 MDT`
- User request: pick up the last session auditing the Signals table and how data comes in, is cached, and is saved in the matrix.

## Current Status

- Recovered `SESSION_HANDOFF_2026-06-02_019e8afa-5620-70f1-a4b6-bf40e41e7aa5.md` and `reports/signals-table-audit-2026-06-03.md`.
- Continued the audit from the post-restart Signals hydration failure and settled-unavailable patch.
- Fixed the known Signals action-column bug:
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx`
  - `artifacts/pyrus/src/screens/SignalsScreen.table-cells.test.js`
  - `artifacts/pyrus/src/features/platform/platformRootSource.test.js`
- Updated `reports/signals-table-audit-2026-06-03.md` with the continuation data-flow audit, runtime exact-cell probe, and validation results.

## Data Flow Summary

- `SignalsScreen.jsx` computes missing visible-row matrix cells via `buildSignalsMatrixHydrationPlan`.
- `PlatformApp.jsx` owns `useEvaluateSignalMonitorMatrix`, merges incoming states, and writes the local warm-start cache.
- `signalMatrixScheduler.js` chooses exact missing `(symbol, timeframe)` cells under pressure caps.
- `signal-monitor.ts` normalizes exact cells, reads durable stored rows for fast responses, schedules background refresh for automatic requests, caches clean response payloads in memory, and persists only clean `ok`/`stale` matrix cells to `signal_monitor_symbol_states`.
- Settled `unavailable` cells count as evaluated coverage and are response-cacheable, but are not durably persisted; timeout/error rows remain retryable.

## Validation

- PASS: Pyrus Signals row/hydration/cache/table tests, 34/34.
- PASS: Pyrus signal matrix scheduler focused tests, 29/29.
- PASS: API signal-monitor focused matrix/cache tests, 63/63.
- PASS: focused Signals route source guard, 1/1.
- PASS: Pyrus typecheck.
- PASS: API typecheck.
- PASS: scoped `git diff --check`.
- Runtime exact-cell probe: first CEG/APH request returned stored stale response with background refresh; follow-up after 3s returned cache hit with `sourceRequestCount: 2` and refreshed `ok` rows.
- Runtime safe browser probe: first bounded 180s run reached 16/21 visible rows at `6/6` with distribution `{"3":1,"4":2,"5":2,"6":16}` and header `Intervals 200/540`; no console errors.
- Warm follow-up browser sample after the background/catch-up work had continued found no visible rows below `data-matrix-hydrated-count=6`.

## Next Step

- Investigate why cold safe browser convergence still misses some visible rows within 180s even though the warm follow-up reaches `6/6`; likely focus areas are automatic fast-return timing, catch-up cadence, and high API pressure from account/shadow routes.

## Restart Check - 2026-06-03

- User restarted the app and asked to verify Signals table hydration/data-source wiring.
- Post-restart diagnostics initially showed API/resource pressure normal and storage/IBKR/Massive reachable.
- Cold safe browser probe with `pyrus:state:v1` set to `signals` and local `pyrus:signal-matrix-snapshot:v1` cleared did not produce a valid final sample because the Playwright page/browser closed during polling; diagnostics afterward showed API pressure had risen to `high`, dominated by account/shadow routes.
- Current safe browser sample after restart:
  - 21 visible rows.
  - Distribution `{"1":7,"2":2,"4":3,"6":9}`.
  - Header `Intervals 140/540`.
  - Matrix responses were `200` with `sourceStrategy: native_timeframes_live_retry`, but automatic responses were stale stored payloads with `sourceRequestCount: 0`, `refreshing: true`, and partial state counts.
- Direct backend exact-cell probe for the visible short symbols (`META`, `UUP`, `ARM`, `APLD`, `AMD`, `PLTR`, `VXX`, `VIXY`, `NVDA`, `MSFT`, `CGNX`, `GLD`) requested 72 cells in pressure-capped chunks:
  - All chunks returned `200`.
  - `sourceStrategy: native_timeframes_live_retry`.
  - `sourceRequestCount` matched requested cells in each chunk.
  - All 72 returned states were `status: ok`; no missing cells.
- Follow-up safe browser sample after that direct backend warming still was not fully hydrated:
  - 21 visible rows.
  - Distribution `{"1":9,"4":1,"6":11}`.
  - Header `Intervals 143/540`.
- Delayed safe browser sample later regressed:
  - 21 visible rows.
  - Distribution `{"1":21}`.
  - Header `Intervals 87/540`.
- Conclusion: backend/data-source wiring is healthy for direct matrix requests, but the Signals table UI automatic hydration path is not fully hydrated after restart. The likely issue remains automatic fast stored responses/background catch-up not reliably merging/filling visible rows under live app pressure.

## Fix Implemented - 2026-06-03

- Root cause: `evaluateSignalMonitorMatrix` still fast-returned stored rows for every automatic matrix request. Foreground Signals exact-cell leader requests with incomplete stored coverage returned partial stale rows and only scheduled background refresh; the browser did not receive those fresh cells reliably before the visible row set rotated or pressure changed.
- Backend fix in `artifacts/api-server/src/services/signal-monitor.ts`:
  - Added `hasCompleteSignalMonitorMatrixCoverage`.
  - Automatic exact-cell requests now check stored coverage.
  - If stored exact-cell coverage is incomplete, the request awaits `withSignalMonitorMatrixEvaluationCache(buildFreshMatrixResponse)` and returns the source-backed response to the browser.
  - Complete stored exact-cell responses can still fast-return and refresh in the background.
- Frontend fix in `artifacts/pyrus/src/features/platform/PlatformApp.jsx`:
  - Raised `SIGNAL_MATRIX_REQUEST_TIMEOUT_MS` from `12_000` to `30_000`, because live source-backed exact-cell chunks were observed at ~16.6s.
- Regression coverage:
  - `artifacts/api-server/src/services/signal-monitor.test.ts` now asserts incomplete exact-cell automatic leaders are source-backed and complete stored exact-cell responses remain fast-return eligible.
  - `artifacts/pyrus/src/features/platform/platformRootSource.test.js` now guards the 30s matrix request timeout.
- Validation passed:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts --test-name-pattern "automatic signal matrix|coverage detects|matrix coverage|stored hydration"` - 64/64.
  - `pnpm --filter @workspace/api-server run typecheck`.
  - `pnpm --filter @workspace/pyrus run typecheck`.
  - `pnpm --filter @workspace/api-server run build`.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/signalMatrixScheduler.test.js src/features/signals/signalsMatrixHydration.test.js src/screens/SignalsScreen.table-cells.test.js` - 41/41.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test --test-name-pattern "signal monitor display refreshes separately|signals screen is registered" src/features/platform/platformRootSource.test.js` - 2/2.
  - Scoped `git diff --check`.
- Runtime note: current API process PID `11921` started at `2026-06-03 07:31:27 MT`, before rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 07:36:08 MT`. A default Run Replit App restart is required before live browser QA can prove the fix.

## Follow-up Fix - 2026-06-03

- User restarted and asked to check again.
- Confirmed the rebuilt API bundle was loaded after restart, but live safe browser probing still did not hydrate the matrix.
- Browser probe showed the Signals screen did issue profile/state requests, but the matrix gate stayed blocked at `profileBootstrapPending: true` while the API was under high pressure. In one sample, state had completed and carried a profile, but the standalone profile query was still pending.
- Frontend fix in `artifacts/pyrus/src/features/platform/PlatformApp.jsx`:
  - Seeds the generated signal-monitor profile query cache from `signalMonitorStateQuery.data.profile` when the state response arrives first.
  - This prevents matrix bootstrap from depending exclusively on the standalone profile request when state already contains the same profile data.
- Backend safety refinement in `artifacts/api-server/src/services/signal-monitor.ts`:
  - Incomplete exact-cell automatic leader requests only await source-backed matrix evaluation under `normal` or `watch` API pressure.
  - Under `high`/`critical` pressure, they fall back to stored hydration plus background refresh/catch-up instead of adding blocking foreground source work.
- Validation passed:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts --test-name-pattern "automatic signal matrix|coverage detects|matrix coverage|stored hydration"` - 64/64.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test --test-name-pattern "signal monitor display refreshes separately|signals screen is registered|paper profile" src/features/platform/platformRootSource.test.js` - 3/3.
  - `pnpm --filter @workspace/api-server run typecheck`.
  - `pnpm --filter @workspace/pyrus run typecheck`.
  - `pnpm --filter @workspace/api-server run build`.
- Runtime note: current API remains high-pressure/CPU-bound and is still running the previous bundle until the next default Run Replit App restart. Live hydration needs to be rechecked after that restart.

## Signal Options Freshness 5 Whys - 2026-06-03

- User reported the live banner: `Signal scan freshness is outside the expected window. Last scan 3m. Latest bar 7m.`
- Runtime evidence:
  - Market-data diagnostics were not the primary failure: `market-data` was `ok`, stream state `live`, no reconnect/data-gap, and IBKR live market data was available.
  - API diagnostics showed severe route pressure: API status `down/critical`, p95 around 10s, event-loop p95 around 507ms, and slow routes including signal-options shadow scan, account shadow/flex, flow aggregate, signal-monitor profile/events, and repeated `/api/bars` 429s.
  - Signal Options state route timed out with `signal_options_state_route_timeout`.
  - Cockpit `scan_universe` showed `signalSourcePolicy: "massive-primary"`, `heavyWorkDeferred: true`, `resourcePressureLevel: "high"`, `lastBatchSize: 0`, `lastBatchCapacity: 12`, and a stale `latestSignalBarAt`.
- 5 Whys:
  1. Why did the UI show late signals? `scan_universe.lastSignalScanAt` and `latestSignalBarAt` aged outside the table's expected freshness window.
  2. Why were those timestamps late? The Signal Options worker was reporting stored signal monitor state while no stale/missing monitor rows were being refreshed in its batch.
  3. Why was it only using stored state? `loadSignalOptionsMonitorState` allowed stale stored rows to short-circuit when stream-first monitor data was available or `preferStoredMonitorState` was true; the worker always passes `preferStoredMonitorState: true`.
  4. Why was that shortcut unsafe? It assumed the stream/signal-monitor path kept stored rows current. In this runtime, stream consumers were idle, signal matrix refresh was pressure-capped, and the API was under high pressure, so stored rows could be stale/missing while the stream looked healthy.
  5. Why did pressure make it user-visible? The API has no fully protected lightweight freshness lane; expensive low-priority and mixed-priority routes can keep the worker in pressure-deferred/stored-state mode, and the UI previously labeled high-pressure deferral as a generic stale-source warning.
- Repair:
  - `artifacts/api-server/src/services/signal-options-automation.ts`: worker scans no longer take the stale stored-state shortcut. If stored monitor coverage needs refresh, the worker proceeds to the existing bounded batch path; manual/non-worker lightweight paths can still use stored state.
  - `artifacts/api-server/src/services/signal-options-automation.test.ts`: added source guards for `monitorStateNeedsRefresh`, worker exclusion from the stored shortcut, and batch refresh routing.
  - `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`: pressure-deferred scans now classify only `high` and `critical` as action-work blockers.
  - `artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js`: added a source guard for the high/critical pressure behavior and existing queued-action banner.
- Validation passed:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts --test-name-pattern "signal-options scans|fresh signal state|cockpit scan stage|contract stage|default paper signal-options startup"` - 136/136.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test --test-name-pattern "signal table|scan|pressure" src/screens/algo/OperationsSignalRow.test.js` - 5/5.
  - `pnpm --filter @workspace/api-server run typecheck`.
  - `pnpm --filter @workspace/pyrus run typecheck`.
  - `pnpm --filter @workspace/api-server run build`.
- Runtime note:
  - Live API/web supervisor is Replit-owned. The running API process is still the pre-fix in-memory `dist/index.mjs`; local diagnostics/cockpit requests to `127.0.0.1:18747` timed out after 8s under existing pressure.
  - Do not start a competing full app from Codex. Restart with the default Run Replit App entry so the API reloads the rebuilt bundle, then recheck `scan_universe.lastBatchSize`, `latestSignalBarAt`, and matrix hydration.
- Optimization follow-up:
  - Add a protected Signal Options freshness lane that always refreshes a small current-bar batch even when action work is pressure-deferred.
  - Keep heavy contract/action work deferrable, but keep symbol/bar freshness independent from shadow-account, flex, flow aggregate, and diagnostics routes.
  - Add a cockpit metric that distinguishes `freshness_refreshed`, `action_deferred`, and `stored_state_only` so future banners point at the actual bottleneck.

## API Line Audit + Massive Watchlist Quote Repair - 2026-06-03

- User reported renewed late signals, a Signal Options scan appearing to run over itself, suspected IBKR/Massive pressure mix-up, an artificially low critical pressure cap, and missing watchlist prices that looked like a Massive issue.
- Live audit evidence:
  - IBKR was healthy and not line-saturated. Line usage samples showed bridge active lines far below the 200-line budget and `signalOptions.activeLineCount: 0`.
  - Massive aggregate WebSocket was connected/authenticated and subscribed to roughly the watchlist universe.
  - API pressure was route-work driven, not provider-capacity driven. Slow routes included `/bars`, Signal Options state timeouts, `/signal-monitor/matrix`, `/universe/logos`, `/settings/ibkr-line-usage`, and later `/accounts/shadow/positions`.
  - `/api/settings/ibkr-line-usage` default payload was too large for frequent polling, around 239 KB before compaction.
  - Direct `/api/quotes/snapshot` for 40-90 watchlist symbols returned 200 with `quotes: []`, confirming the watchlist price symptom and pointing at REST/snapshot behavior.
  - Normal foreground watchlist quote SSE was still wired to `subscribeBridgeQuoteSnapshots`, while only position quotes switched to Massive under Massive realtime. This was the IBKR/Massive pressure mix-up.
- Repairs implemented:
  - `artifacts/api-server/src/services/bridge-streams.ts`: normal quote SSE now uses `subscribeMassiveStockQuoteSnapshots` when Massive realtime stocks are configured; bridge stream remains fallback.
  - `artifacts/api-server/src/services/platform.ts`: Massive realtime quote snapshots now seed from live Massive Q/T quote socket cache and stock aggregate socket cache, then call Massive REST only for still-missing symbols. REST empty/failure no longer wipes existing socket prices.
  - `artifacts/api-server/src/routes/settings.ts`: default `/settings/ibkr-line-usage` response is compact, with `detail=full` preserved for drill-down; SSE also honors the detail mode.
  - `artifacts/pyrus/src/features/platform/useRuntimeControlSnapshot.js`: default line usage polling requests compact detail; `lineUsageDetail: "full"` is supported.
  - `artifacts/pyrus/src/screens/SettingsScreen.jsx`: Data Broker settings requests full line usage only when that tab is active.
  - `artifacts/api-server/src/services/diagnostics.ts`: decorative routes remain visible in slow-route diagnostics but no longer drive API resource-pressure escalation.
  - `artifacts/api-server/src/services/resource-pressure.ts`: raised API RSS thresholds. On a 16 GB container, watch/high/critical moved to `6144/8192/12288 MB`; hard block moved to about `13926 MB`. Route latency remains capped below critical.
  - `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx`: frontend fallback RSS thresholds aligned to the raised backend fallback.
- Regression coverage added/updated:
  - `artifacts/api-server/src/services/platform-quote-snapshot.test.ts`: Massive socket quote cache and aggregate cache preserve prices when REST returns empty.
  - `artifacts/api-server/src/services/bridge-streams-source.test.ts`: normal foreground quote SSE now expects Massive under realtime config.
  - `artifacts/api-server/src/routes/settings.test.ts`: line-usage route compaction/full-detail contract.
  - `artifacts/api-server/src/services/diagnostics.test.ts`: decorative routes do not drive API pressure.
  - `artifacts/api-server/src/services/resource-pressure.test.ts`: raised RSS thresholds and hard block.
  - `artifacts/api-server/src/services/signal-options-worker.test.ts`: critical RSS test now uses resolved critical threshold instead of stale low constant.
- Validation passed:
  - `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/resource-pressure.test.ts src/services/diagnostics.test.ts src/routes/settings.test.ts src/services/signal-options-worker.test.ts src/services/platform-quote-snapshot.test.ts src/services/bridge-streams-source.test.ts src/routes/platform-streams-source.test.ts src/services/massive-stock-quote-stream.test.ts src/services/stock-aggregate-stream.test.ts` - 102/102.
  - `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js src/features/platform/runtimeControlModel.test.js src/features/platform/useMemoryPressureSignal.test.js src/features/platform/FooterMemoryPressureIndicator.test.js` - 119/119.
  - `pnpm --filter @workspace/api-server typecheck`.
  - `pnpm --filter @workspace/pyrus typecheck`.
  - `pnpm --filter @workspace/api-server build`.
- Live post-build checks:
  - Running API process still started at `2026-06-03 08:28:00 UTC` and had not reloaded the new quote-stream repair.
  - Compact line usage was active in the running process: latest sample around 40 KB, `detail: "compact"`, heavy `recentEvents` and `lineStates` absent.
  - Raised RSS thresholds were active in diagnostics: `{ watch: 6144, high: 8192, critical: 12288 }`.
  - Direct `/api/quotes/snapshot` still returned zero quotes in the running process, so a default Run Replit App restart is required before validating the quote-stream repair live.
- Real-time API usage audit while validating:
  - Four low-cadence samples used only `/api/diagnostics/latest` and compact `/api/settings/ibkr-line-usage?detail=compact`.
  - API remained `down/critical` from latency, with pressure driver `api-latency`.
  - Dominant pressure route was `/accounts/shadow/equity-history`, p95 around `60-74s`.
  - IBKR stayed `ok`; market-data stayed `ok`; bridge lines ranged roughly `26-46/200`; Signal Options line usage stayed `0`; Massive provider stayed `massive-websocket` with about `95` symbols.
  - Conclusion: after the repairs, remaining live pressure is heavy account/shadow/history route work plus stale running bundle for quote snapshot behavior, not provider line pressure.
- Next runtime checks after restart:
  - Open app with `?pyrusQa=safe` and confirm watchlist prices populate from Massive stream within one quote rotation cycle.
  - Recheck `/api/quotes/snapshot` for a 40-symbol watchlist batch after the stream has had time to seed; it should return socket-backed Massive prices when REST is empty.
  - Recheck diagnostics: API pressure may still be high if `/bars` or `/accounts/shadow/positions` dominate, but it should not be due to IBKR line pressure or decorative logo routes.
  - Recheck Signal Options cockpit/state freshness after quote stream and line-usage pressure fixes are live.

## Footer API Source Pressure Bars - 2026-06-03

- User asked to separate API pressure bars by source in the footer.
- Implemented a separate provider-pressure cluster beside the existing memory pressure widget:
  - `FooterApiSourcePressureIndicator` renders stable `IBKR` and `Massive` compact bars.
  - IBKR uses real line usage utilization from the runtime-control snapshot.
  - Massive uses provider health/activity pressure only; no fake quota denominator is shown because runtime diagnostics do not expose a Massive rate/quota cap yet.
  - Desktop footer and mobile More sheet both receive the same `apiSourcePressureSnapshot`.
- Follow-up correction:
  - Removed the old compact `API` process-memory mini bar from the `Memory` cluster so the footer no longer shows two API-looking bars.
  - The `Memory` cluster now shows Browser, Cache, and Runtime; API/process RSS/heap detail remains available through the memory indicator title/popover diagnostics.
  - The visible footer API surface is now only the provider-source cluster: `IBKR` and `Massive`.
- Runtime data wiring:
  - `PlatformApp` now creates a footer-scoped `useRuntimeControlSnapshot` with 15s runtime/line-usage polling, disabled outside visible workspace-leader work and safe QA mode.
  - `PlatformShell` threads the snapshot into the footer and mobile More sheet.
- Regression coverage:
  - `FooterMemoryPressureIndicator.test.js` covers separate IBKR/Massive slots, fallback slots, and Massive degraded mapping.
  - Added `FooterMemoryPressureIndicator.test.js` to `artifacts/pyrus/scripts/runUnitTests.mjs` so the footer tests run in the normal unit manifest.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx src/features/platform/FooterMemoryPressureIndicator.test.js` - 8/8.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx src/features/platform/runtimeControlModel.test.js` - 42/42.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx src/features/platform/platformRootSource.test.js` - 64/64.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - FULL UNIT BLOCKED: `pnpm --filter @workspace/pyrus test:unit` fails in unrelated `src/screens/TradeScreen.search-handlers.test.mjs` source-regex assertion for `listFlowEventsRequest(...)`; footer tests had passed before that suite-level failure.

## Algo & Execution Scan Overlap Fix - 2026-06-03

- User saw a fresh toast: "Signal-options scan already running / The active signal-options scan will finish before another one starts."
- Root cause:
  - Backend single-flight behavior is correct: `runSignalOptionsShadowScan` serializes scans per deployment and returns `already_running` when a worker/manual/backfill scan is active.
  - The Algo screen also had an auto-initial scan path for empty signal surfaces. That path POSTed a manual scan even when the cockpit `scan_universe` stage already reported a worker scan running.
  - The UI then surfaced the expected backend collision as a visible toast, making it look like Signal Options was trying to run over itself.
- Repairs implemented:
  - `artifacts/pyrus/src/screens/AlgoScreen.jsx`: added `isAlgoExecutionScanStageRunning` and derives `algoExecutionScanRunning` from the cockpit `scan_universe` stage.
  - Auto-initial scans now wait while the Algo & Execution scan stage is already running.
  - Auto-initial scan requests carry `requestSource: "auto"` locally, so any remaining race with backend single-flight is quiet instead of producing user-facing toast noise.
  - Manual scan collisions now use parent/child nomenclature: `Algo & Execution scan already running` with an `options strategy` detail.
  - `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`: Scan button, header wave, and status label now include backend worker activity via `scanOperationRunning`, not only local mutation pending state. The button is disabled while the worker is already scanning.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/algo/algoHelpers.test.js src/screens/algo/AlgoLivePage.regression-1.test.js` - 38/38.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: `git diff --check -- artifacts/pyrus/src/screens/AlgoScreen.jsx artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx artifacts/pyrus/src/screens/algo/algoHelpers.test.js artifacts/pyrus/src/screens/algo/AlgoLivePage.regression-1.test.js`.
- Live API sampling:
  - `curl http://127.0.0.1:5000/api/diagnostics/latest` could not connect from this shell after this patch, so there was no runtime API process available to sample.
  - Did not start a competing full app; Replit default Run App remains the source of truth for full app bring-up.

## STA Timeout, Pressure, And Positions Repair - 2026-06-03

- User reported live warning: `Signal action scan is queued by resource pressure. Last scan 1m. Latest bar 6m. Pressure High.` while footer pressure bars showed normal.
- 5-whys/root cause:
  - Why did the STA row say `Pressure High`? `OperationsSignalTable` read `scanStageRecord.resourcePressureLevel` from the Signal Options cockpit `scan_universe` stage.
  - Why did that disagree with footer normal? Footer bars intentionally read memory/provider-source pressure summaries; the STA stage used the worker's last Signal Options resource-pressure summary.
  - Why was that stale/wrong? `buildCockpitPipeline` used `workerState.lastResourcePressureLevel`, so a prior high-pressure/deferred scan could keep painting the row after current API diagnostics were normal.
  - Why did high pressure queue action work at all? `shouldDeferSignalOptionsHeavyWork` used `pressure.level !== "normal"` even though `resource-pressure.ts` caps already allowed `actionScansAllowed: true` and `positionMarksAllowed: true` at `high`.
  - Why did the bad timeout keep coming back? `/signal-options/state?view=summary` still waited on dashboard snapshot build, then signal refresh; cold summary build budget was 4800 ms and route budget was 5000 ms, so the route could 504 before it ever served stored signal rows.
- Repairs implemented:
  - `artifacts/api-server/src/services/signal-options-automation.ts`
    - `shouldDeferSignalOptionsHeavyWork` now defers only for hard API pressure or caps that actually block action scans/position marks.
    - `buildCockpitPipeline` reports `resourcePressureLevel` only when current resource pressure blocks action work; stale `lastResourcePressureLevel` remains diagnostic metadata only.
    - `listSignalOptionsSignalSnapshots` supports `preferStoredMonitorState` and can read `getSignalMonitorStoredState({ markNonCurrentStale: true })`.
    - `listSignalOptionsAutomationState` now uses `buildSignalOptionsFastSummaryState` for summary view: cold state shell plus stored signal-monitor rows, bypassing dashboard build.
  - `artifacts/api-server/src/routes/automation.ts`
    - State route explicitly requests `refreshSignalsFromMonitorState: true`.
  - `artifacts/pyrus/src/screens/AlgoScreen.jsx`
    - Cockpit-stage fallback now derives `lastSignalScanAt`, `latestSignalBarAt`, and `latestSignalAt` from visible STA rows instead of only `focusedDeployment.lastEvaluatedAt`.
  - `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`
    - Frontend pressure blocker no longer treats `high` as queued; only `critical` blocks locally, matching raised caps.
  - `artifacts/api-server/src/services/shadow-account.ts`
    - Shadow read cache now preserves stale non-empty cached values if a refresh returns an empty value that fails the row-preserving `allowStale` policy.
    - `getShadowAccountPositions` always uses the row-preserving stale policy, including unscoped stream reads.
- Live observations before repair:
  - 5-minute SSE watch showed `SIGNAL_CHANGE` jumping 0 -> 12 rows at once, proving batch arrival rather than per-row realtime update.
  - Account-page stream positions changed 22 -> 0 -> 22; shadow stream also emitted 0 then 22. This matched unscoped position reads not using stale row protection.
  - Diagnostics could show footer/resource pressure normal while STA row still displayed stale worker `High`.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts src/services/algo-cockpit-streams.test.ts` - 139/139.
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/shadow-account.test.ts` - 113/113.
  - PASS: combined backend targeted run `src/services/signal-options-automation.test.ts src/services/shadow-account.test.ts` - 249/249.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/algo/algoHelpers.test.js src/screens/algo/OperationsSignalRow.test.js src/screens/algo/AlgoLivePage.regression-1.test.js` - 62/62.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: `git diff --check` scoped to touched files.
  - PASS: `pnpm --filter @workspace/api-server run build`.
- Direct service validation after fast-lane repair:
  - Command called `listSignalOptionsAutomationState({ deploymentId: "7e2e4e6f-749f-4e65-a011-87d3559a23b0", view: "summary", refreshSignalsFromMonitorState: true })`.
  - Result returned in `86 ms`.
  - Returned `9` signals, `0` candidates, `0` active positions.
  - Latest sample bars included `AAPL` and `SYM` at `2026-06-03T15:15:00.000Z`, proving seconds-level stored signal data is available without dashboard build.
- Live runtime limitation:
  - Replit-owned API child PID `63153` remained running the old pre-fix bundle after build and was hot at about `90%` CPU and `1.7-1.9 GB` RSS.
  - `/api/healthz` was fast, but live `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state?view=summary` still returned a 504 in the old process.
  - Did not kill the Replit-owned supervisor from Codex. The rebuilt `dist/index.mjs` needs a default Run Replit App restart/recycle before live route verification can pass.

## Account P&L Calendar And Position Source Audit - 2026-06-03

- User reported Account P&L Calendar / positions P&L showing an errant `23.6k`-class today value and asked to treat every account-derived value as suspect until proven.
- Root cause:
  - Account page summary `dayPnl` was still computed from position quote-change totals and labeled `IBKR_POSITIONS`.
  - Account P&L Calendar then accepted that summary value as an unconditional override for today's calendar cell, so quote-source or ledger-contaminated day values could replace the equity-history/calendar result.
  - Account intraday P&L baselined against the first point in the API's rolling 24h series, even though the panel label is session/today.
  - Equity/spot position quotes were not reliably tied to Massive. The account positions route used cache fallback and disabled Massive fallback, while options correctly stayed on the IBKR option-quote path.
  - Massive socket quotes can carry current price without prior-close/change context. The position model converted missing `prevClose`/`change` into false flat `0` day P&L.
- Repairs implemented:
  - `artifacts/api-server/src/services/account.ts`
    - Account summary day P&L now derives from local ledger/equity-history market-day NAV movement via `calculateLatestMarketDayPnlFromHistory`, excluding same-day external transfers.
    - Summary `dayPnl` source is now `LOCAL_LEDGER` with field `EquityHistoryMarketDayPnl:<marketDate>` instead of `IBKR_POSITIONS`.
    - Equity/spot account positions now request quote snapshots with Massive fallback/admission provider enabled.
  - `artifacts/api-server/src/services/account-position-model.ts`
    - Missing/null quote `change` and `prevClose` remain null instead of becoming numeric zero.
    - Position day P&L only reports zero when the quote actually has previous-close/change context; otherwise it stays null instead of inventing flat P&L.
  - `artifacts/api-server/src/services/platform.ts`
    - Massive realtime quote snapshots now merge REST detail day-change context into socket-backed prices when the socket value lacks `change`, `changePercent`, or `prevClose`.
  - `artifacts/pyrus/src/screens/account/accountPnlCalendarModel.js`
    - Calendar today override rejects `dailyPnl.source === "IBKR_POSITIONS"` so quote-change summaries cannot overwrite ledger/equity-history calendar math.
  - `artifacts/pyrus/src/screens/account/IntradayPnlPanel.jsx`
    - Intraday/session series now filters and baselines to the latest New York market date instead of the first rolling-24h sample.
  - `artifacts/pyrus/src/features/account/positionDisplayModel.js`
    - Equity/backend quote source `massive` is preserved in the positions display model; Massive option labels still map back to `option_quote`.
- Live account verification after restart/hot reload:
  - `/api/accounts/combined/summary?mode=live&source=account-page` returned `dayPnl.source: "LOCAL_LEDGER"`, field `EquityHistoryMarketDayPnl:2026-06-03`, and a live value around `-503` instead of the reported `23.6k` class value.
  - `/api/accounts/combined/positions?mode=live&source=account-page` returned stock/equity quote source `massive`.
  - Example live equity day-change values were populated from Massive where prior-close context existed: `FCEL` about `-355.60`, `FRMI` about `-48.00`, and `INDI` about `-37.50`.
  - Options path remains IBKR option-quote based.
- Regression coverage and validation:
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/account-positions.test.ts` - 22/22.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/platform-quote-snapshot.test.ts` - 7/7.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account.test.ts` - 113/113.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/account/accountPnlCalendarModel.test.js` - 27/27.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/account/IntradayPnlPanel.test.js` - 4/4.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx src/features/account/positionDisplayModel.test.js` - 9/9.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/account/AccountReturnsPanel.test.js` - 9/9.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/account/accountCalendarData.test.js` - 11/11.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx src/screens/account/AccountHeroBlock.test.js` - 6/6.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: scoped `git diff --check` for account/P&L touched files.
