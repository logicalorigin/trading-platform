# Live Session Handoff - Signals Table Matrix Audit

- Session ID: pending
- CWD: `/home/runner/workspace`
- Saved At (MT): `2026-06-03 18:30:56 MDT`
- User request: pick up the last session auditing the Signals table and how data comes in, is cached, and is saved in the matrix.

## 2026-06-03 GEX Overlay Anchor Follow-Up

- User asked whether the start of the GEX overlay should line up with the latest spot price.
- Finding: yes. `buildGexProjectionConeSvgOverlay()` was anchoring the projection cone start to `overlay.spot` from the GEX payload before considering the rendered chart's latest bar/quote. That can make the cone start visibly off the current spot when the GEX payload spot is delayed or sampled separately.
- Fix in `artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx`:
  - Added an optional `anchorPrice` input to the GEX projection SVG builder.
  - The cone start now anchors by priority: `latestQuotePrice`, then latest chart bar close, then GEX payload `overlay.spot` as a final fallback.
  - Added `latestQuotePrice` to the overlay sync effect dependencies so quote-only changes rebuild the cone position.
- Guard in `artifacts/pyrus/src/features/gex/gexProjectionChartWiring.test.js`:
  - Added assertions for the quote/bar/payload fallback order and the `latestQuotePrice` dependency.
- Validation:
  - PASS: focused chart/GEX suite, 140/140 tests.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
- No Replit startup, artifact, workflow, env, runtime-setting, or live broker/data-line actions were changed.

## 2026-06-03 6-3 API Diagnosis Follow-Up - Active Matrix Cadence

- User accepted the remaining caveat that the active STA Signal Matrix snapshot still reported `pollMs: 60000` under high pressure and asked to fix it.
- Root cause:
  - The high-pressure cap table was no longer forcing 60s; `appWorkScheduler.js` has `signalMatrixPollMinMs: 0` for high.
  - `PlatformApp.jsx` still computed `signalMatrixPollMs` from `signalMonitorPollMs`, so the active STA matrix inherited the backend Signal Monitor evaluator profile interval, usually 60s and potentially 5m.
- Fix in `artifacts/pyrus/src/features/platform/PlatformApp.jsx`:
  - Added `signalMatrixForegroundPollMs = signalMonitorDisplayPollMs`.
  - Added `signalMatrixBackgroundPollMs = signalMonitorPollMs`.
  - Active Signals/Algo matrix requests now use the foreground display cadence as their base poll; background matrix work keeps the profile poll interval.
  - Existing pressure floors still apply afterward, so critical pressure can still raise the floor.
- Guard in `artifacts/pyrus/src/features/platform/platformRootSource.test.js`:
  - Added source-level assertions that active matrix polling uses foreground display cadence and background matrix polling uses the profile poll interval.
  - RED confirmed before the implementation patch; the focused test failed on the missing `signalMatrixForegroundPollMs` contract.
- Updated `docs/backend-data-map.md`:
  - Matrix refresh cadence now explicitly says active Signals/STA matrix polling must not inherit the backend evaluator profile poll interval.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js src/features/platform/signalMatrixScheduler.test.js` - 100/100.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: scoped `git diff --check`.
  - PASS: safe browser STA sample at `http://127.0.0.1:18747/?pyrusQa=safe` showed Signal Matrix snapshot `pressureLevel: "high"`, `serverPressureLevel: "high"`, and `pollMs: 15000` instead of 60000; follow-up sample saw `/api/signal-monitor/matrix` return `200` with `sourceStrategy: "native_timeframes_live_retry"`, STA `lastPlanExactCellLimit: 120`, no freshness warning, and no console/page errors.
- Runtime note:
  - The table header can still show `ready to scan` as Signal Options action-scan status text after-hours. That is separate from the matrix polling cadence; this fix removed the 60s active matrix cadence inheritance.
- No Replit startup, artifact, workflow, env, or runtime-setting control-plane files were changed.

## 2026-06-03 6-3 API Diagnosis Implementation - Matrix Pressure And Candle-Close Pickup

- User asked to implement the plan after the `/bars`, high-pressure, Massive ingestion, and STA pickup diagnosis.
- Implemented the Signal Matrix scheduler fix in `artifacts/pyrus/src/features/platform/signalMatrixScheduler.js`:
  - Hydrated intraday cells now requeue at `latestBar + timeframe + grace` instead of waiting for a stale 2x timeframe window.
  - Added coverage for immediate 1m candle-close pickup, no pre-grace requeue, and 5m close pickup.
- Implemented frontend pressure/cap fixes in `artifacts/pyrus/src/features/platform/PlatformApp.jsx`:
  - Unknown server pressure now falls back to `normal`, not artificial `high`.
  - Foreground exact-cell high-pressure limits now preserve useful visible hydration instead of shrinking active work to the old generic 20-cell path.
  - Matrix cap rejections now read exposed API error `data.maxCells`, store a short-lived retry cap, and immediately retry inside the server-admitted limit.
- Implemented backend Signal Monitor matrix fixes in `artifacts/api-server/src/services/signal-monitor.ts` and `artifacts/api-server/src/app.ts`:
  - Generic exact-cell high-pressure cap remains 20.
  - Foreground `leader` + `startup`/`poll` exact-cell requests are admitted up to 60 under high pressure.
  - STA visible-page requests remain admitted up to 120 under high pressure.
  - Critical pressure remains capped at 10.
  - Foreground exact-cell leaders stay source-backed under high pressure instead of cache-only.
  - Exact-cell leaders can await a fresh matrix refresh under normal/watch and protected high-pressure foreground/STA request classes.
  - Matrix live-edge evaluation uses Massive aggregate stream/cache bars with `includeProvisionalLiveEdge: true` and `allowHistoricalFallback: false`; when live-edge history is not warm, stored state is preserved and historical REST is not used for live pickup.
  - API problem JSON exposes `error.data` for exposed `HttpError`s so the client can honor the backend cap response.
  - Tightened the exact-cell cap helper type so the foreground `cells` contract is explicit.
- Updated `docs/backend-data-map.md` with the 6-3 API diagnosis rules:
  - Signal matrix pickup is candle-close + short grace, not a 5m polling/stale-window gate.
  - Live STA matrix pickup should use Massive WebSocket aggregate/cache data; `/bars` is chart/backtest/historical and must not be the live Signal Monitor trigger.
  - Pressure caps are documented by request class: generic high 20, foreground high 60, STA visible high 120, critical 10.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/signalMatrixScheduler.test.js src/features/platform/platformRootSource.test.js` - 100/100.
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts` - 77/77.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: scoped `git diff --check`.
  - PASS: backend data-map fence check: 28 fences, 13 Mermaid blocks, even fence count.
  - PASS: health checks on `http://127.0.0.1:18747/api/healthz` and `http://127.0.0.1:8080/api/healthz`.
  - PASS: runtime matrix smoke against `http://127.0.0.1:18747/api/signal-monitor/matrix` returned `200` in about 3.8s for a `leader` + `poll` exact-cell request with `sourceStrategy: "native_timeframes_live_retry"` and no cap/503 failure. The after-hours sample returned zero states, consistent with no-REST live-edge behavior when stream cache history is not warmed.
  - PASS: safe browser STA table sample at `http://127.0.0.1:18747/?pyrusQa=safe` rendered `Signals to Actions · All 248 of 248 signals`, 20 visible rows, no freshness warning, no `ready to scan` empty state, no console/page errors, 120 visible-row signal dots with 70 active buy/sell dots, and two `/api/signal-monitor/matrix` responses at `200` with `sourceStrategy: "native_timeframes_live_retry"` and 29/67 returned states.
  - Note: the safe browser Signal Matrix snapshot reported high pressure with `pollMs: 60000`, `activeScreenRequestTaskLimit: 60`, and STA `lastPlanExactCellLimit: 120`. This is the high-pressure periodic floor, not the old 5m stale wait; visible STA request revisions still queue immediate matrix evaluation when the visible row payload changes.
- No Replit startup, artifact, workflow, env, or runtime-setting control-plane files were changed.

## 2026-06-03 Post-Restart Radar Verification + Matrix Admission Guard

- User restarted the app and asked to check the cleanup.
- Radar removal verification:
  - PASS: live API JSON scan across `/api/settings/ibkr-line-usage?detail=full`, `/api/settings/ibkr-lanes`, and `/api/diagnostics/latest` on ports `18747` and `8080` found `radarHitCount: 0`.
  - PASS: active-code scan found no `radar|Radar|RADAR` matches in `artifacts/api-server/src`, `artifacts/pyrus/src/features/platform`, `artifacts/pyrus/src/screens/algo`, `AlgoScreen.jsx`, or `DiagnosticsScreen.jsx`.
  - PASS: safe Algo browser check at `http://127.0.0.1:18747/?pyrusQa=safe` rendered `algo-screen` and `algo-operations-signal-table` with `radarTextCount: 0`, `pageErrorCount: 0`, and no console warnings/errors.
- QA found and fixed an unrelated Signal Monitor matrix startup issue:
  - Symptom before the fix: under API pressure `high`, the generic startup matrix request could send 48 cells before the frontend had observed server pressure; backend admission correctly rejected it with `signal_monitor_matrix_cells_limit_exceeded` because generic high-pressure requests are capped at 20 cells.
  - Fix in `artifacts/pyrus/src/features/platform/PlatformApp.jsx`: active-screen matrix requests now use a conservative high-pressure admission cap until server pressure is observed; live reevaluation recomputes the exact-cell cap immediately before request dispatch. The explicit STA visible-page path still keeps the 120-cell high-pressure exception for `clientRole: "algo-sta"` and `requestOrigin: "sta-visible-page"`.
  - Guard updated in `artifacts/pyrus/src/features/platform/platformRootSource.test.js`.
  - Post-fix live safe Algo check: `/api/signal-monitor/matrix` returned `200`; `window.__PYRUS_SIGNAL_MATRIX_SNAPSHOT__` reported `pressureLevel: "high"`, `serverPressureLevel: "high"`, `lastPlanTaskCount: 20`, and `lastPlanExactCellLimit: 20`.
- Line-usage check after restart:
  - Runtime budget remains `bridgeLineBudget: 200`.
  - Dedicated app consumers are active: account-monitor, shadow-account, visible, and automation option lines.
  - Flow scanner allocation is not currently filling because the market session is `after` with `quietReason: "market_session_quiet"`; runtime shows `scannerPlannedHorizonCount: 0`, `scannerEffectiveConcurrency: 8`, and `scannerMaxDeepScanLines: 187`.
  - This is an after-hours quiet-session pause, not the old 8-10-line scanner underfill or ticker grouping path.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/signalMatrixScheduler.test.js src/features/platform/platformRootSource.test.js` - 95/95.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: `git diff --check`.
  - PASS: post-restart safe Algo Playwright check described above.
- No Replit startup, artifact, workflow, env, or runtime-setting control-plane changes were made.

### Second Restart Check - 2026-06-03T23:20:36Z

- User restarted again and asked to check.
- Health:
  - PASS: `http://127.0.0.1:18747/api/healthz` returned `200`.
  - PASS: `http://127.0.0.1:8080/api/healthz` returned `200`.
  - Runtime diagnostics were normal-action with `bridgeLineBudget: 200`.
- Radar verification:
  - PASS: live JSON scan across line-usage, lanes, latest diagnostics, and runtime diagnostics on ports `18747` and `8080` found `radarHitCount: 0`.
  - PASS: active-code radar scan still has no matches in scanner/backend/UI paths.
  - PASS: safe Algo browser check rendered the operations signal table with `radarTextCount: 0`, `pageErrorCount: 0`, and no console warnings/errors.
- Matrix verification:
  - Generic startup matrix request was `20` cells (`clientRole: "leader"`, `requestOrigin: "startup"`), proving the high-pressure startup cap is active.
  - STA visible-page matrix request was `101` cells (`clientRole: "algo-sta"`, `requestOrigin: "sta-visible-page"`), inside the 120-cell exception.
- Line usage:
  - After Algo load: `bridgeLineBudget: 200`, `activeLineCount: 12`, `scannerLineCount: 0`, `scannerEffectiveLineCap: 188`.
  - Runtime session remains `after` with `quietReason: "market_session_quiet"`, so scanner fill is intentionally quiet and RTH is required to prove full scanner line fill.
- No Replit startup, artifact, workflow, env, or runtime-setting control-plane changes were made.

## 2026-06-03 Options-Flow Radar Concept Removal

- User clarified the radar icons/concept should be gone and there should be no intentional scanner mention left.
- Removed the active backend radar scanner path:
  - Deleted `artifacts/api-server/src/services/options-flow-radar-scanner.ts`.
  - Removed radar runtime config, diagnostics, coverage, settings compaction, lane override bounds, test-only exports, quote backoff state, and aggregate fallback reads from `platform.ts`, `flow-universe.ts`, `settings.ts`, and `ibkr-lanes.ts`.
  - Direct flow scanner coverage now reports only `blocked`, `deep`, or `idle`; aggregate seeding uses lane/current-batch symbols, not radar promotions.
- Cleaned tests and frontend:
  - Removed obsolete radar scanner/promotion/fallback tests and kept direct scanner, backfill, and generic priority ordering coverage.
  - Replaced active scanner `Radar` lucide icons with `ScanLine` in `OperationsSignalRow.jsx`, `PipelineStrip.jsx`, and `PlatformAlgoMonitorSidebar.jsx`.
  - Removed frontend runtime-model compatibility reads for `scanner.radar`/`radarDegradedReason`, and renamed active synthetic activity fallback helpers in `headerBroadcastModel.js` and `useLiveMarketFlow.js`.
- Search result:
  - PASS: no `radar|Radar|RADAR` matches in active scanner/backend/UI paths: `artifacts/api-server/src`, `artifacts/pyrus/src/features/platform`, `artifacts/pyrus/src/screens/algo`, `AlgoScreen.jsx`, `DiagnosticsScreen.jsx`.
  - Remaining repo matches are static research/defense datasets where radar is literal company/theme content, not the scanner concept.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/options-flow-scanner.test.ts` - 70/70.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/account-positions.test.ts src/services/watchlist-prewarm.test.ts src/routes/settings.test.ts src/services/market-data-admission.test.ts src/services/ibkr-line-usage.test.ts src/services/flow-universe-planner.test.ts` - 115/115.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/runtimeControlModel.test.js src/features/platform/headerBroadcastModel.test.js` - 60/60.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/algo/OperationsSignalRow.test.js src/features/platform/platformRootSource.test.js` - 91/91.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: `git diff --check`.
- No Replit startup, artifact, workflow, or env control-plane files were changed for this cleanup.

## 2026-06-03 STA Source Stability + Visible Matrix Hydration

- User reported the Algo STA table symptoms as one cluster: GLW/SYM showing 5m care, missing signal bubbles, missing sparklines, mostly empty Move column, and SPY appearing then disappearing.
- Implemented stable STA action source handling:
  - `artifacts/pyrus/src/screens/algo/algoHelpers.js`: added `resolveStableStaActionSnapshot`.
  - `artifacts/pyrus/src/screens/AlgoScreen.jsx`: resolves Signal Options cockpit/state rows as one whole source, keeps the last successful action snapshot when a source error would shrink the table, and passes `signalOptionsSourceHealth` downstream.
  - `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx` and `OperationsSignalTable.jsx`: carry and display compact stale/degraded source health.
- Implemented visible-page STA matrix hydration:
  - `OperationsSignalTable.jsx`: visible-page matrix requests now include `clientRole: "algo-sta"` and `requestOrigin: "sta-visible-page"`.
  - `artifacts/pyrus/src/features/platform/PlatformApp.jsx`: preserves that request metadata, recomputes the STA request limits under live pressure, and sends the metadata to `/api/signal-monitor/matrix`.
  - `artifacts/pyrus/src/features/platform/signalMatrixScheduler.js`: generic high-pressure matrix planning remains capped at 20 cells, but the STA visible-page request class can plan up to 120 cells; critical remains capped at 10.
- Implemented backend admission:
  - `artifacts/api-server/src/services/signal-monitor.ts`: `resolveSignalMonitorMatrixExactCells` now allows the 120-cell high-pressure cap only for `algo-sta` + `sta-visible-page`; generic high-pressure exact-cell requests still throw above 20.
  - Updated OpenAPI/generated request enums in `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated/api.ts`, `lib/api-zod/src/generated/types/*`, and `lib/api-client-react/src/generated/api.schemas.ts`.
- Updated `docs/backend-data-map.md` during the work:
  - Signal Options flow now includes the STA stable action snapshot.
  - Handling rules document source-health stale/degraded behavior, the STA request metadata, and the backend exact-cell exception.
- Validation:
  - PASS: `git diff --check -- ...` scoped to touched STA/API/docs files.
  - PASS: `node --import tsx --test src/screens/algo/algoHelpers.test.js src/screens/algo/OperationsSignalRow.test.js src/features/platform/platformRootSource.test.js src/features/platform/signalMatrixScheduler.test.js` from `artifacts/pyrus` - 159/159.
  - PASS: `node --import tsx --test src/services/signal-monitor.test.ts` from `artifacts/api-server` - 71/71.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: backend data map fence check: 28 fences, 13 Mermaid blocks, even fence count.
  - RESOLVED later in this session: `pnpm --filter @workspace/api-server run typecheck` now passes after the options-flow radar cleanup above.

## 2026-06-03 Backend Data Map Property Sketch

- User asked to revisit the backend data map and draw a ReadMe-style property/data-flow sketch showing how data moves around the app.
- User clarified the desired output should look like a wireframe map, citing `https://mcpmarket.com/tools/skills/wireframe-ui-generator` as an example of ASCII/text-based wireframes and flow diagrams.
- Updated `docs/backend-data-map.md` with:
  - New comprehensive backend spec section with system boundaries, route-family contracts, state ownership, backend invariants, and validation requirements grounded in the current API route/service/schema layout.
  - All visual diagrams are now embedded inline inside `docs/backend-data-map.md`, not linked as sidecar SVG files. The inline diagrams are: comprehensive spec overview, routing map, data wiring diagnostic map, and data-use rules map.
  - Visual review proof: extracted the four inline SVG blocks from `docs/backend-data-map.md`, rendered them to PNGs with ImageMagick, and inspected them; fixed a clipped routing-map title, removed a misleading cross-lane connector, shortened rules-map labels that crowded the right edge, and removed a decorative overview connector that crossed text.
  - A diagnostic front door: `How To Diagnose A Data Wiring Issue`, including a six-step protocol for tracing where identity/source/freshness/actionability/failure reason disappears.
  - A concrete STA example for `Monitor only · Awaiting scan · now`: actionable Signal Options rows require backend candidate shells and explicit contract-selection state; UI may project that state, but must not relabel a missing actionable candidate as benign monitor-only state.
  - A plain-text wireframe routing map visible without Mermaid rendering. It lays out ingest sources, ingest adapters, backend routing hubs, state/cache, API surfaces, client state, and app usage.
  - A design/formatting pass that makes the map lane-card based, adds a legend/read order, labels Mermaid as a rendering companion, replaces the duplicate plain-text summary with a Route Index table, and promotes waterfall labels to section headings.
  - Mermaid companion wording/syntax adjusted after the user supplied `https://blog.starmorph.com/blog/mermaid-js-tutorial`: left-to-right flowchart, subgraphs for zones, labeled solid runtime arrows, and labeled dotted generated-contract arrows.
  - An explicit line-based backend data-flow wiring diagram showing UI commands, IBKR, Massive, research/reference sources, backend services, DB/cache, workers, REST/SSE, generated/client state, and final Pyrus screens connected with labeled arrows.
  - A simple top-down property flow sketch from provider/runtime inputs and durable state through backend read models, route payloads, generated clients/UI state, and visible screens.
  - A property-class table covering identity, freshness/trust, actionability, value payload, diagnostics, and UI-derived properties.
  - A focused Signal Options property flow sketch from signal monitor state through signal snapshots, candidate shells, execution events, state payloads, dashboard candidates, table joins, and row status.
  - Signal-options handling rules that codify the recent blocker: `Monitor only` is valid only for non-actionable rows; actionable rows require candidate shells and explicit contract-selection status.
  - Route, diagnostic, use-rule, and better-use indexes to make wiring issues diagnosable before code edits.
  - No-guess API audit sections: `No-Guess API Rules`, `Exact API Surface Inventory`, and `API Consumer And Ingestion Matrix`.
  - Exact API inventory now lists all 165 Express route handlers inline. Validation compared the MD inventory to `artifacts/api-server/src/routes/*.ts` and found 165/165 rows with no missing or extra routes. OpenAPI method coverage is 159/165, with the 6 manual/direct surfaces explicitly listed.
  - A bug-hunting readiness audit matrix that drills common failures and proves where the spec points first: STA candidate missing, rounded STA signal time, disappearing STA sparkline, empty STA Move, stale prices/bars, matrix holes, account lag, order/fill mismatch, Flow/GEX stale, research missing, pressure, backtest stuck, generated-client drift, SSE readiness misuse, and provider failure/no-data confusion.
  - Targeted `First Files To Inspect` rows for STA signal time restoration, STA sparkline disappearance, and empty STA Move diagnosis.
  - Waterfall-style Mermaid sketches for the basic route path, styled app property path, Signal Options, live market data, order/execution, and backtest flows.
- Validation:
  - PASS: no trailing whitespace in `docs/backend-data-map.md`, `SESSION_HANDOFF_CURRENT.md`, or this handoff.
  - PASS: scoped handoff `git diff --check -- SESSION_HANDOFF_CURRENT.md SESSION_HANDOFF_LIVE_2026-06-03_signals-table-matrix-audit.md`.
  - PASS: extracted inline SVG block 1 renders to 1800x1180 PNG via ImageMagick.
  - PASS: extracted inline SVG block 2 renders to 1600x1080 PNG via ImageMagick.
  - PASS: extracted inline SVG block 3 renders to 1800x1380 PNG via ImageMagick.
  - PASS: extracted inline SVG block 4 renders to 1600x1080 PNG via ImageMagick.
  - PASS: no `docs/backend-data-*.svg` sidecar files remain.
  - PASS: API route inventory check: 165 route handlers in source, 165 rows in the Markdown inventory, no missing or extra routes.
  - PASS: API coverage check: 159 OpenAPI/generated route methods and 6 explicit manual/direct surfaces.
  - BLOCKED by pre-existing docs references: `pnpm run audit:markdown-paths` fails on `REPO_CLEANUP_INVENTORY.md` polygon provider paths and `scripts/README.md: scripts/reports/shadow-massive-options-audit/`, not on `docs/backend-data-map.md`.
  - Mermaid CLI `mmdc` is not installed locally, so render validation was limited to simple Mermaid syntax review plus scoped diff checks.
- No runtime/startup/Replit control-plane files were touched for this docs update.

## 2026-06-03 STA Contract-Selection Blocker Work

- `2026-06-03T20:05:24Z` Agent: User asked to implement the plan that treats `Monitor only · Awaiting scan · now` as a symptom of missing contract-selection state. Work has started in default mode.
- Current intended shape:
  - Backend: add durable Signal Options candidate shells for fresh actionable STA signals and explicit contract-selection status (`pending` / `selected` / `blocked` / `deferred`) without doing live execution in cache-only summary paths.
  - Frontend: render that status in STA rows/drill instead of benign monitor-only fallback for actionable signals.
- Important repo state:
  - Worktree already contains unrelated prior modifications across signal monitor, signal-options, flow scanner, Massive quote, Replit guardrail, and handoff files. Do not revert those.
  - Existing signal-options files already include prior live-edge/no-historical-fallback changes.
- Implemented at `2026-06-03T20:21:09Z`:
  - `artifacts/api-server/src/services/signal-options-automation.ts`: added explicit Signal Options contract-selection status, candidate shell builder, event/merge status propagation, cache-refresh candidate shell hydration, and fast-summary candidates/data-quality.
  - `artifacts/api-server/src/services/signal-options-automation.test.ts`: added RED/GREEN coverage for pending shell candidates, blocked skipped events, selected contract-selection events, and fast-summary source guard against `candidates: []`.
  - `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx`: STA rows now show `Contract pending`, `Action deferred`, blocked contract-selection reasons, and `Candidate missing` for actionable signals with no candidate; `Monitor only` is reserved for non-actionable signals.
  - `artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js`: added render coverage for pending shells and missing actionable candidates.
- Validation for this task:
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts` - 138/138.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/algo/OperationsSignalRow.test.js` - 26/26.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
- Post-restart runtime check at `2026-06-03T20:27:33Z`:
  - PASS: `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state?view=summary` returned 2 actionable signals and 2 matching candidates with `missingActionableCandidateCount: 0`; sample candidates carried `contractSelectionStatus: "deferred"`.
  - PASS: follow-up cache-only state sample returned 23 signals, 3 actionable signals, 3 candidates, and `missingActionableCandidateCount: 0`; sample candidates carried `contractSelectionStatus: "pending"`.
  - PASS: safe browser check at `http://127.0.0.1:18747/?pyrusQa=safe` reached `algo-screen`, `algo-live-content`, `algo-operations-signal-table`, and `algo-signal-table-body`; STA table text reported 22 rows, rendered `Action deferred`, and did not contain `Monitor only · Awaiting scan`.
  - Screenshot: `/tmp/pyrus-sta-check.png`.

## Current Status

- 2026-06-03 12:50 MT IBKR helper v6 launch regression forward fix:
  - Root cause: the frontend launch selector had been changed to always use `/api/ibkr/remote-launch`. With no online desktop agent, the API correctly returned 409 `ibkr_remote_desktop_unavailable`, but the browser never attempted the local Windows `pyrus-ibkr://` protocol helper, leaving the UI at `Preparing`.
  - Fix: `shouldUseRemoteIbkrLaunchBrowser()` now takes `desktopAgentOnline`; Windows browsers use local protocol until a desktop agent is online, while non-Windows browsers still route through remote launch.
  - Fix: header auto-login retries remote 409 to local Windows protocol when possible and treats stale/terminal 404 launch errors as state-clearing failures instead of continuing to show in-flight launch state.
  - Live sanity at `2026-06-03T18:50:52Z`: IBKR still reports `configured=false`, `desktopAgentOnline=false`, expected helper `2026-06-03.ib-async-sidecar-v6`, no active activation, `streamState=offline`; `/api/ibkr/desktops` still only has the stale offline v5 registration from `2026-06-02T14:00:11.483Z`.
  - Scanner planning in the compact runtime sample is no longer the old 8-line symptom: `scannerState=planned`, `scannerEffectiveConcurrency=8`, `scannerMaxDeepScanLines=200`.
  - Validation: `node --test artifacts/pyrus/src/features/platform/ibkrBridgeSession.test.js` passed 8/8; `pnpm --filter @workspace/pyrus typecheck` passed; `pnpm --filter @workspace/pyrus build` passed; `git diff --check` passed.

- 2026-06-03 12:47 MT shadow account first-paint follow-up:
  - Post-restart live check showed the running bundle was patched enough for `/api/accounts/shadow/positions?mode=paper&liveQuotes=false` to return 25 rows with negative unrealized PnL around `-1.98k`, but the account-page SSE still did not emit `critical` within a 14s cap.
  - Root cause: the shadow account-page critical path still let fast risk call a full `ensureFreshShadowState(true)` because totals were not injected, and it also waited on shadow orders before writing the first event.
  - Source/build fix: `getShadowAccountRisk()` now derives totals from an injected positions response; shadow account-page critical returns positions-derived summary/allocation/risk with deferred closed trades and a stale deferred orders slice; `fetchAccountPageLivePayload()` refreshes real shadow orders after the critical event.
  - Direct changed-code proof: `fetchAccountPageCriticalPayload({ accountId: "shadow", mode: "paper", orderTab: "working" })` returned in `1628ms` with 25 positions, `unrealizedPnl: -1980.4528`, `netLiquidation: 172699.7372`, non-degraded summary/positions/risk, and deferred orders. `fetchAccountPageLivePayload()` returned in `2448ms` with real non-stale orders and the same PnL.
  - Validation: `node --import tsx --test src/services/account-page-streams.test.ts src/services/shadow-account.test.ts` passed 127/127; `pnpm --filter @workspace/api-server typecheck` passed; `pnpm --filter @workspace/api-server build` passed; scoped `git diff --check` passed.
  - Runtime caveat: current live API PID `76118` started at `2026-06-03 12:39:16 MDT`; rebuilt `artifacts/api-server/dist/index.mjs` is `2026-06-03 12:48:11 MDT`, so the final SSE proof requires one default Run Replit App restart.

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

## Footer Pressure Pill Consolidation - 2026-06-03

- User clarified the desired footer layout: one main footer pill with exactly four compact bars: `IBKR`, `Massive`, `Cache`, and `App` runtime.
- Implemented:
  - `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx`
    - Added `buildFooterPressureBars({ signal, runtimeControl })` with the ordered bar model: provider-source `IBKR`, provider-source `Massive`, query `Cache`, runtime-store `App`.
    - Removed the visible `Memory` label and visible level/status text from the compact footer pill; color now comes from the maximum level across those four visible bars.
    - Removed the stale separate `FooterApiSourcePressureIndicator` component so the footer source reflects a single-pill layout.
    - Browser/process memory remains available in the button title/popover diagnostics, but is not a compact footer bar.
  - `artifacts/pyrus/src/features/platform/PlatformShell.jsx`
    - Desktop footer now passes `apiSourcePressureSnapshot` into `FooterMemoryPressureIndicator` instead of rendering a separate API source sibling.
  - `artifacts/pyrus/src/features/platform/MobileMoreSheet.jsx`
    - Mobile More sheet now uses the same single pressure pill.
  - `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.test.js`
    - Tests now assert the `IBKR`, `Massive`, `Cache`, `App` order, provider fallback slots, Massive degradation mapping, no browser/runtime compact slots, and no visible `Memory` or level text.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/FooterMemoryPressureIndicator.test.js` - 7/7.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus build`.
  - PASS: scoped `git diff --check` for the four touched Pyrus files.

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

## 2026-06-03 Pickup - Account P&L Calendar

- User asked to resume the session correcting the errant P&L in the Account P&L Calendar.
- Current pickup step: verify the prior source-lineage/account-P&L patches are present in the current tree, rerun targeted account/P&L validation, and then recheck the live Account API/UI if the rebuilt app bundle is active.
- Pickup result:
  - Confirmed source patches are present in `artifacts/api-server/src/services/account.ts`, `artifacts/api-server/src/services/account-position-model.ts`, `artifacts/pyrus/src/screens/account/accountPnlCalendarModel.js`, `artifacts/pyrus/src/screens/account/IntradayPnlPanel.jsx`, and `artifacts/pyrus/src/features/account/positionDisplayModel.js`.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/account-positions.test.ts src/services/platform-quote-snapshot.test.ts src/services/shadow-account.test.ts` - 142/142.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/account/accountPnlCalendarModel.test.js src/screens/account/IntradayPnlPanel.test.js src/features/account/positionDisplayModel.test.js src/screens/account/AccountReturnsPanel.test.js src/screens/account/accountCalendarData.test.js src/screens/account/AccountHeroBlock.test.js` - 66/66.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - Live API check: `GET /api/accounts/combined/summary?mode=live&source=account-page` returned `dayPnl.value` about `-472.90`, `source: "LOCAL_LEDGER"`, `field: "EquityHistoryMarketDayPnl:2026-06-03"`; no `23.6k` class value.
  - Live positions check: `GET /api/accounts/combined/positions?mode=live&source=account-page` returned stock/equity rows with `quoteSource: "massive"` and non-flat day P&L samples.
  - Safe-QA browser probe on Account showed no visible `23.6k` class value, no failed account requests, and no console errors.
  - Runtime caveat: `/api/diagnostics/latest` currently reports `status: "down"` and the summary route can exceed a short 12s timeout under API pressure, though it returned 200 with a longer timeout.

## 2026-06-03 Strict Verification - Account P&L Calendar

- User asked to check the work and prove the fix is done and proper.
- Proof points:
  - Working tree has no dirty product-code diff for the account/P&L source files; the account/P&L files are included in local commit `90eb7a0`.
  - Built API bundle contains `calculateLatestMarketDayPnlFromHistory`, `LOCAL_LEDGER`, and `EquityHistoryMarketDayPnl`, so the built server artifact includes the P&L source-lineage fix.
  - Direct model proof: applying `{ value: 23600, source: "IBKR_POSITIONS" }` to the calendar leaves the existing `-472.9` day unchanged; applying `{ value: -472.9, source: "LOCAL_LEDGER" }` sets `pnlSource: "account-summary"`.
  - PASS: focused backend proof tests for account summary day P&L, false flat day P&L, and Massive quote preservation - 3/3.
  - PASS: focused frontend proof tests for calendar override rejection/acceptance, intraday latest-market-date baseline, and Massive equity source label - 4/4.
  - PASS: `pnpm --filter @workspace/api-server run build`.
  - PASS: scoped `git diff --check` for touched account/P&L files.
- Residual risk separated from the P&L fix:
  - Current runtime pressure is high. Flight recorder showed dominant slow route `GET /accounts/shadow/equity-history` with p95 around `57s`, and lower-priority diagnostics were shed with 429.
  - Under this pressure, live Account summary/positions curl checks can time out even though a prior live summary returned the correct ledger-sourced P&L. This is a route/runtime pressure issue, not evidence that the calendar still accepts the bad `IBKR_POSITIONS` source.

## 2026-06-03 Shadow Equity-History Latency Repair

- User asked to fix the remaining API pressure issue discovered while proving the Account P&L Calendar repair.
- Baseline live timing against the running API before this patch:
  - Warm `GET /api/accounts/shadow/equity-history?mode=paper&range=1D&source=account-page`: about `1.9s`.
  - Warm `range=ALL`: about `1.9s`.
  - Cold/fanout range calls showed the bug: `1M`, `3M`, and `YTD` timed out at `70s`; `1Y` took about `64s`; benchmark variants took about `52s` to `90s`.
  - Flight recorder still showed high API pressure driven by `GET /accounts/shadow/equity-history`, p95 about `75s`.
- Root cause:
  - `filterShadowEquityHistoryRowsToLiveLedger` recomputed ledger totals by rescanning all fills for every snapshot row, making cold history O(snapshot rows x fills).
  - Benchmark shadow equity-history requests rebuilt the same ledger history before applying benchmark overlays, so Account page derived payload fanout repeated the cold work for SPY/QQQ/DIA.
- Repairs implemented:
  - `artifacts/api-server/src/services/shadow-account.ts` now reconciles ledger rows with one sorted forward fill cursor.
  - Benchmark shadow equity-history requests normalize benchmark keys, reuse the base no-benchmark shadow history, and only overlay benchmark percents.
  - Medium ranges (`1M`, `3M`, `6M`, `YTD`) reuse a warmed one-year base history and then slice/rebase transfer-adjusted returns for the requested window.
  - `artifacts/api-server/src/services/shadow-account.test.ts` has regression guards for benchmark base-history reuse, medium-range reuse/rebase, and one-pass reconciliation.
- Validation:
  - RED confirmed before patch: the new focused regression tests failed before the corresponding implementation.
  - PASS after patch: focused benchmark/cursor regression run, 2/2.
  - PASS after patch: focused medium-range reuse regression run.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account.test.ts src/services/signal-options-automation.test.ts src/services/route-admission.test.ts` - 267/267.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run build`.
  - PASS: scoped `git diff --check`.
  - Built artifact proof: `artifacts/api-server/dist/index.mjs` contains `normalizeShadowBenchmarkSymbol`, `buildLiveShadowLedgerTotalsCursor`, `shadowReusableEquityHistoryRange`, and `sliceShadowAccountEquityHistoryToRange`.
- Live proof after the Replit-owned API loaded the rebuilt bundle in PID `21688`:
  - `range=6M`: 200 in 7.706s, 2981 points, 1675 events, first return 0.
  - `range=6M&benchmark=SPY`: 200 in 2.016s, 2981 points, 1 event, first return 0.
  - `range=3M`: 200 in 2.091s, 2981 points, 1675 events, first return 0.
  - `range=3M&benchmark=SPY`: 200 in 1.410s, 2981 points, 1 event, first return 0.
  - `range=1M`: 200 in 1.517s, 1545 points, 817 events, first return 0.
  - `range=1M&benchmark=SPY`: 200 in 1.013s, 1545 points, 1 event, first return 0.
  - Diagnostics after timing showed pressure `watch`, no recent failures, and shadow equity-history was no longer the dominant pressure route. A later watch sample pointed at shadow risk and `/bars`, which is a separate performance workstream.

## 2026-06-03 Shadow P&L Source Audit

- User reported the shadow Account page initially loads a plausible daily P&L around `-1.5k`, then refreshes to the old erroneous `+22.5k` class value.
- Live reproduction against the Replit-owned API:
  - `/api/accounts/shadow/summary?mode=paper&source=account-page` returned `dayPnl.value: 22448.8773`, `source: "SHADOW_LEDGER"`, `field: "DailyMarkChange"`.
  - `/api/accounts/shadow/equity-history?mode=paper&range=1D&source=account-page` showed a market-day NAV move around `-2372.26`.
  - Cached/stream positions (`liveQuotes=false`) had 23 open rows, summed `dayChange` around `+22439.12`, and 15 same-day rows where `dayChange === marketValue`.
  - Live-quote positions (`liveQuotes=true`) had 23 open rows, summed `dayChange` around `-1843.72`, and 0 rows where `dayChange === marketValue`.
  - Example bad cached row: `COHR` had market value `5369.39`, dayChange `+5369.39`, and unrealized P&L `-522.05`.
- Corrected 5-whys root cause:
  1. Why does the UI flip to `+22.5k`? A later shadow summary/positions refresh carried `DailyMarkChange` around `+22.5k`.
  2. Why was daily mark change `+22.5k`? Cached/stream stock rows reported full market value as dayChange.
  3. Why full market value? Their baseline market value was `0`, so `currentMarketValue - baselineMarketValue` became full market value.
  4. Why was zero accepted? `readShadowPositionDayChanges` treated zero baseline mark rows as authoritative for open nonzero-cost positions, including overnight/pre-day-start rows.
  5. Why did this overwrite the calendar? Shadow summary exposed account-level day P&L as position `DailyMarkChange`, and the calendar accepted `SHADOW_LEDGER` summaries.
- Repairs implemented:
  - `artifacts/api-server/src/services/shadow-account.ts`: shadow account summary day P&L now resolves from 1D shadow equity-history market-day NAV movement and labels the metric as `EquityHistoryMarketDayPnl:<marketDate>`.
  - `artifacts/api-server/src/services/shadow-account.ts`: zero baseline marks are not authoritative for open nonzero-cost positions; cached/stream dayChange falls back to entry cost basis instead of full market value.
  - `artifacts/api-server/src/services/shadow-account.test.ts`: added regressions for same-day zero-baseline positions, overnight/pre-day-start zero-baseline positions, and summary day P&L using equity history instead of position day-change totals.
- Validation:
  - RED before fix: same-day baseline test failed before helper export/behavior; overnight zero-baseline test failed with baseline `0`; summary-source test failed because `getShadowAccountSummary` used `readShadowPositionDayChanges`.
  - PASS: focused baseline/source tests, 3/3.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/shadow-account.test.ts` - 119/119.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run build`.
  - PASS: scoped `git diff --check`.
  - Built artifact proof: `artifacts/api-server/dist/index.mjs` contains `resolveShadowAccountSummaryReturnMetrics`, `EquityHistoryMarketDayPnl`, and zero-baseline entry-cost-basis handling.
- Final live proof after Replit Run App recycled to API PID `34270`:
  - Summary: 200 in 1.926s, `dayPnl.value: -2272.8557`, `source: "SHADOW_LEDGER"`, `field: "EquityHistoryMarketDayPnl:2026-06-03"`.
  - Cached/stream positions (`liveQuotes=false`): 23 rows, sum dayChange `-2998.17`, sum unrealized `-2917.17`, `badMarketValueDayChange: 0`.
  - Live positions (`liveQuotes=true`): 23 rows, sum dayChange `-3006.09`, sum unrealized `-2925.09`, `badMarketValueDayChange: 0`.
  - The old failure signature is gone: no audited position row has `dayChange === marketValue` with nonzero unrealized P&L, and summary no longer exposes `DailyMarkChange` as calendar P&L.

## 2026-06-03 API Ingestion Soak And Freshness Repair

- User asked to treat all data endpoints as symptoms, soak for 5 minutes, and ground expected behavior from the pre-overnight baseline around commit `58916f2`.
- Pre-fix soak output was written to `/tmp/pyrus-api-soak-2026-06-03T15-46-29-778Z.json`.
- Findings:
  - `signal-matrix-tiny` succeeded only 3/7 times, with p95 around 15s.
  - `shadow-positions-live-quotes` succeeded only 1/7 times.
  - `shadow-positions-no-live-quotes` still timed out, proving the non-live positions path was still blocked by quote hydration.
  - Diagnostics showed API pressure high/critical and signal-options worker scan timeout after `120000ms`.
  - Bar hydration inventory showed `signal-matrix` dominating misses/in-flight work.
  - A dev restart occurred during soak; user clarified restarts are expected dev noise unless they directly contribute to runtime issues.
- Code changes in progress:
  - `artifacts/api-server/src/services/signal-options-automation.ts`: worker monitor refreshes now use the existing batch path under high/critical API pressure instead of full-universe refresh.
  - `artifacts/api-server/src/services/shadow-account.ts`: equity position display quote hydration is bounded to 750ms and skipped entirely when `liveQuotes=false`.
  - `artifacts/api-server/src/services/route-admission.ts`: diagnostics runtime/client-metrics and visible option expirations are active-screen routes so pressure handling does not blind the next soak.
  - Targeted source-regression tests added in signal-options automation, shadow account, and route admission test files.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts src/services/shadow-account.test.ts src/services/route-admission.test.ts` - 264/264.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run build`.
  - PASS: scoped `git diff --check`.
  - Built `artifacts/api-server/dist/index.mjs` contains `shouldBatchSignalOptionsWorkerMonitorRefresh`, `SHADOW_EQUITY_POSITION_QUOTE_MAX_WAIT_MS`, `/diagnostics/runtime` as active-screen, and `/options/expirations` as visible-classifiable.
- Live runtime caveat:
  - Current Replit-owned API process remained the pre-patch process after build, so `/api/diagnostics/runtime` still shed/timed out from the old classifier.
  - Did not kill/restart the Replit-owned process from Codex. Use the normal Run Replit App recycle, then rerun the endpoint soak.
  - If shadow positions still time out after the restart, next root-cause target is the base shadow read path (`ensureFreshShadowState` / totals), separate from the quote hydration bug fixed here.

## 2026-06-03 STA Signal Cadence Repair

- User reported that signals were still arriving in the Signal Trading Automation table on 5-minute increments instead of as soon as Massive stream bars fired and the Pyrus indicator detected them.
- Live proof before the final patch:
  - `GET /api/signal-monitor/state?environment=paper&staleFast=false` showed fresh stored signal-monitor rows through the `16:40` and `16:45` bars.
  - The Signal Options deployment `7e2e4e6f-749f-4e65-a011-87d3559a23b0` was still `last_evaluated_at = 2026-06-03T16:35:14.047Z`, `last_signal_at = 2026-06-03T16:30:00Z`.
  - `GET /api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state?view=summary` returned `signalCount: 0` while the DB had fresh rows such as `GOOGL`, `VST`, `GEV`, `VIXY`, `CORZ`, and `ANET`.
- Root causes:
  - `signal-options-worker.ts` dropped `signal_monitor_event_created` wakeups while a worker tick was already active. If an indicator event arrived during maintenance/action work, Signal Options waited for the next deployment poll instead of scanning immediately after the active tick settled.
  - `buildSignalOptionsFastSummarySnapshot` still used `staleFast: true` plus the 750ms signal-refresh timeout. Under active scan/pressure it could read stale memory-cache state, time out, and convert the STA summary to `signals: []` even though durable `signal_monitor_symbol_states` rows were fresh.
- Repairs implemented:
  - `artifacts/api-server/src/services/signal-options-worker.ts` now queues post-tick wakeups and reapplies `nextScanDueAt` after the current tick finishes, avoiding both dropped signal events and zero-delay timer loops.
  - `artifacts/api-server/src/services/signal-options-automation.ts` now has a direct, deployment-scoped fast stored-state reader for STA summary signals. It reads `signal_monitor_profiles` + `signal_monitor_symbol_states`, filters to the deployment universe and current lane rows, skips event metadata and contract previews, and no longer wraps the fast summary signal read in the 750ms refresh timeout.
  - Fast summary now calls `listSignalOptionsSignalSnapshots(..., { preferStoredMonitorState: true, includeEventMetadata: false })` instead of `staleFast: true`.
- Validation:
  - PASS: `node --import tsx --test src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts src/services/algo-cockpit-streams.test.ts src/services/signal-monitor.test.ts src/services/trade-monitor-worker.test.ts` - 245/245.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`.
  - PASS: scoped `git diff --check`.
  - Patched-source DB proof without restarting the app: direct call to `listSignalOptionsAutomationState({ deploymentId, view: "summary" })` returned `signalCount: 11`, including `CORZ` `signalAt: 2026-06-03T16:40:00Z`, `latestBarAt: 2026-06-03T16:45:00Z`.
- Live runtime caveat:
  - Current Replit-owned API process `36395` started at `2026-06-03 10:49:22 MDT`; rebuilt `artifacts/api-server/dist/index.mjs` with the final direct stored-state fix was written at `2026-06-03 10:51:58 MDT`.
  - Did not kill or shell-restart the Replit-owned process. Use normal Replit Run App recycle, then recheck the summary endpoint; expected behavior is that STA summary should return the durable fresh signal rows immediately, independent of a running worker signal refresh.

## 2026-06-03 STA Summary, Positions, And Line Usage Follow-Up

- User added two symptoms while continuing the ingestion investigation:
  - Account/shadow position data lines were not staying consistent.
  - Header IBKR connection line count and footer IBKR line count did not match, even though they should read the same source.
- Additional live evidence before the latest patch loaded:
  - Replit-owned API PID `39813` stayed hot at about `89%` CPU and about `2.1 GB` RSS.
  - `/api/diagnostics/latest` showed API `down/critical`, `/accounts/shadow/positions` as the dominant slow route, and `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state` as the dominant error route.
  - Before the latest cache patch, repeated summary calls could still 504 at the 7s route budget in the old process, while full-state was shed as deferred analytics under high API pressure.
  - Warm shadow automation positions improved after earlier patches: `liveQuotes=true` returned 23 rows, 3 option rows, and 3 option bid/ask rows in roughly 1.5-2.4s when stale-protected cache was warm.
  - Line-usage diagnostics showed API active line count and bridge active line count can differ by a few leases during reconciliation; that is separate from the header/footer UI mismatch.
- Latest repairs implemented:
  - `artifacts/api-server/src/routes/automation.ts`
    - Split Signal Options state route budgets: summary `7_000ms`, full `9_000ms`.
  - `artifacts/api-server/src/services/signal-options-automation.ts`
    - Fast summary checks `signalOptionsSummaryDashboardCache` before doing DB work.
    - Fast summary reuses in-flight summary builds instead of multiplying DB reads under pressure.
    - Fast summary writes a short-lived summary cache after successful stored-state reads.
    - Fast summary still prefers full dashboard cached signals when a full dashboard cache is present.
    - Final follow-up after partial soak: stale/expired useful summary cache is now served immediately while `startSignalOptionsFastSummaryRefresh()` refreshes in the background, avoiding a route-timeout miss after the stale window expires.
  - `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx`
    - Header runtime control line usage now enables the shared line-usage SSE stream.
  - `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
    - Footer runtime control line usage now enables the same line-usage SSE stream.
  - Existing position-line repairs in this slice:
    - Account option quote stream owner is stable instead of per-underlying.
    - Shadow/account reads are source-scoped.
    - `liveQuotes=false` skips live quote hydration.
    - Shadow visible/day-change/Greek quote owners are stable.
    - Shadow summary P&L stays equity-history based instead of position day-change based.
- Why the header/footer mismatch happened:
  - Header and footer were both reading line usage, but they did so on separate polling cadences (`10s/2s` header vs `15s` footer).
  - Flow-scanner line count rotates frequently, so independent polls could display different valid snapshots.
  - Both surfaces now subscribe to the same SSE stream, so they should render the same canonical snapshot.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/automation.test.ts` - 1/1.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/account-positions.test.ts src/services/signal-options-automation.test.ts src/services/shadow-account.test.ts src/services/route-admission.test.ts` - 292/292 before the final fast-summary cache patch.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/automation.test.ts src/services/account-positions.test.ts src/services/signal-options-automation.test.ts src/services/shadow-account.test.ts src/services/route-admission.test.ts` - 293/293 after the final fast-summary cache patch.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run build`.
  - PASS after final summary-expiry patch: `pnpm --filter @workspace/api-server exec tsx --test src/services/signal-options-automation.test.ts` - 137/137.
  - PASS after final summary-expiry patch: `pnpm --filter @workspace/api-server exec tsx --test src/services/automation.test.ts` - 1/1.
  - PASS after final summary-expiry patch: `pnpm --filter @workspace/api-server typecheck`.
  - PASS after final summary-expiry patch: `pnpm --filter @workspace/api-server run build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03T17:17:39Z`.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js src/features/platform/runtimeControlModel.test.js src/features/platform/IbkrConnectionStatus.test.js` - 153/153.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus run build`.
- Live validation blocker:
  - `artifacts/api-server/dist/index.mjs` was rebuilt at `2026-06-03T17:05:19Z`, but the Replit-owned API process remained PID `39813` from before the rebuild.
  - The API dev script builds once, then executes `dist/index.mjs`; it does not hot-reload the compiled API bundle.
  - Partial live soak after the first restart showed hot-cache STA summary responses were non-empty and fast, but the first post-stale-window summary request still 504'd once after about `7.5s`; this is what the final summary-expiry/background-refresh patch addresses.
  - After the final patch build, Replit-owned API PID `45312` still predates the rebuilt bundle and is hot at about `90%` CPU / `1.9 GB` RSS. A new default Run Replit App restart is required for live proof.
  - Do not start a competing full app from Codex. Use the default Replit Run App restart/recycle, then run the 5-minute soak.
- Post-restart expected checks:
  - `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state?view=summary` should return non-empty signals without 504s and should serve cached/stale fast summaries under pressure instead of empty rows.
  - `/api/accounts/shadow/positions?mode=paper&assetClass=all&source=automation&liveQuotes=false` and `liveQuotes=true` should keep non-empty rows stable; option rows should keep bid/ask.
  - Header/footer IBKR line counts should match after the UI reloads because both consume the same line-usage stream.

## 2026-06-03 STA Event Wake And 5-Minute Candidate Cadence

- User reported two live symptoms after restart:
  - Algo page banner: `Signal scan freshness is outside the expected window. Last scan 9m`.
  - STA table candidates/signals were arriving at clean 5-minute intervals instead of as soon as the Massive/indicator path produced stored signal rows.
- Live proof:
  - 5-minute monitor showed Massive websocket `ok`, `real-time`, about 95 subscribed symbols, and signal monitor rows updating.
  - Signal table endpoint kept current rows, e.g. `profile.lastEvaluatedAt = 2026-06-03T17:06:11.328Z`.
  - Direct DB read at `2026-06-03T17:03:01Z` showed fresh stored signal rows through `17:02:58Z`, while deployment `last_evaluated_at` remained `2026-06-03T16:46:53.691Z`.
  - Live cockpit on old PID `39813` showed worker stuck in `signal_refresh` from `2026-06-03T17:06:32.730Z`; deployment `last_evaluated_at` stayed `16:46:53.691Z`.
  - `/signal-options/state?view=summary` intermittently 504'd in the old process, but when cache was warm returned stored signals quickly. That confirms DB stored rows are available and the remaining delay was the worker/route path, not Massive or Postgres row reads.
- Root cause:
  - The Signal Options worker passed `preferStoredMonitorState: true`, but `loadSignalOptionsMonitorState()` ignored that preference for `source === "worker"`.
  - When any stored monitor row looked lagging/missing, worker scans still performed a full deployment-universe monitor refresh before publishing deployment scan freshness and before action work. With a 5m signal-monitor timeframe, that pushed the STA/action path back onto clean 5-minute bar cadence and aged actionable signals out (`barsSinceSignal > 0`) before candidate work.
- Latest repair implemented:
  - `artifacts/api-server/src/services/signal-options-automation.ts`
    - Added `signalOptionsStoredMonitorBatch()`.
    - Worker scans now respect `preferStoredMonitorState: true` when Massive stream-first monitor data is available, returning stored signal-monitor state with `reason: "stream_live_primary"` before the full-universe refresh branch.
    - Manual/forced scans can still perform full refreshes.
  - `artifacts/api-server/src/services/signal-options-automation.test.ts`
    - Source regressions assert the worker stored-state stream-primary branch appears before the full-refresh branch and that the stored-state batch helper is present.
- Validation:
  - PASS: `node --import tsx --test src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts src/services/algo-cockpit-streams.test.ts src/services/signal-monitor.test.ts` - 229/229.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: scoped `git diff --check`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at about `2026-06-03T17:08:53Z`.
- Live validation blocker:
  - Running Replit-owned API PID `39813` still has the pre-patch bundle loaded. The API dev command builds once and then executes `dist/index.mjs`; it does not hot-reload after `pnpm --filter @workspace/api-server build`.
  - Do not shell-kill or start a competing app from Codex. Use default Run Replit App restart/recycle to load the rebuilt bundle, then run the post-restart 5-minute STA monitor.

## 2026-06-03 Massive Footer Diagnostics Follow-Up

- User asked for more Massive API diagnostics than visible `OK` and wanted each footer pressure item to update independently in real time.
- Implemented:
  - `artifacts/api-server/src/services/platform.ts`
    - Massive runtime WebSocket diagnostics now preserve per-feed `lastMessageAt` and top-level latest `lastMessageAt` in addition to existing age/counter fields.
    - Built API bundle proof: `artifacts/api-server/dist/index.mjs` contains the new Massive `lastMessageAt` propagation.
  - `artifacts/pyrus/src/features/platform/runtimeControlModel.js`
    - Normalized Massive diagnostics now preserve `observedAt`, `websocket.lastMessageAt`, and normalized per-feed counters/timestamps.
    - Existing line-usage stream fallback now also preserves stock aggregate/Massive message timestamps from compact line-usage snapshots.
  - `artifacts/pyrus/src/features/platform/FooterMemoryPressureIndicator.jsx`
    - Massive footer bar label now shows symbol count plus live age, e.g. `Massive 95 · 2s`, instead of visible `Massive OK`.
    - Massive detail/title includes REST summary plus WebSocket mode, channels, symbol count, event count, and last-message age.
    - Massive bar fill/level is now age/error driven: fresh messages stay normal with low fill, stale messages move to watch/high.
    - Added a one-second local footer clock so age labels/fill advance between network snapshots.
  - `artifacts/pyrus/src/features/platform/PlatformApp.jsx`
    - Footer runtime diagnostics refresh cadence is now `3_000ms`; IBKR line usage remains on its separate 2s SSE/polling source; Cache/App bars continue to come from the memory-pressure monitor.
- Validation:
  - PASS: `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/FooterMemoryPressureIndicator.test.js src/features/platform/runtimeControlModel.test.js` - 50/50.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/runtime-diagnostics.test.ts` - 13/13.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run build`.
  - PASS: `pnpm --filter @workspace/pyrus build`.
  - PASS: scoped `git diff --check` for the touched API/Pyrus files.

## 2026-06-03 Post-Restart Massive Diagnostics Audit

- User restarted the app and asked to check the new Massive API pressure diagnostics.
- Live restart proof:
  - Replit-owned app recycled after the rebuild: supervisor PID `48614`, API runner PID `48622`, API process PID `48635`, web runner PID `48697`, Vite PID `48720`, started around `2026-06-03 11:21:29 MDT`.
  - `artifacts/api-server/dist/index.mjs` was rebuilt at `2026-06-03 11:20:52 MDT`; `artifacts/pyrus/dist/public/index.html` at `2026-06-03 11:21:03 MDT`.
- What the new diagnostics taught:
  - Massive is not the current API-pressure driver. Latest `/api/diagnostics/runtime` showed Massive WebSocket `ok`, `real-time`, 95 subscribed symbols, fresh messages, 0 reconnects.
  - The initial live data exposed a misleading diagnostic: raw `AM` WebSocket aggregate counters and socket-wide `lastMessageAt` were being treated like app aggregate-stream freshness.
  - Fixed this in source/build/live:
    - `artifacts/api-server/src/services/massive-stock-websocket.ts` now tracks last data message timestamp per requested channel while preserving socket-level `lastSocketMessageAt`.
    - `artifacts/api-server/src/services/platform.ts` now reports `stock-aggregates` using the actual app aggregate stream counters (`lastAggregateAt`, aggregate event count, consumers) and keeps raw AM WebSocket counters under `rawWebSocket*`.
    - `artifacts/pyrus/src/features/platform/runtimeControlModel.js` line-usage fallback now prefers aggregate-stream counters over raw AM counters.
  - Live corrected payload at `2026-06-03T17:26:17Z`: `stock-aggregates.eventCount: 40,731,866`, `rawWebSocketEventCount: 457`, `rawWebSocketLastMessageAt: 2026-06-03T17:26:01.512Z`, and fresh aggregate `lastMessageAt: 2026-06-03T17:26:16.223Z`.
  - `/api/diagnostics/latest` current pressure instead points at shadow/account routes: `/accounts/shadow/risk` p95 about `26.6s`, `/accounts/shadow/summary` about `18.1s`, `/accounts/shadow/positions` about `14.4s`, `/accounts/shadow/equity-history` about `6.2s`.
- Browser/footer proof:
  - Safe-QA mode proved static layout only because `PlatformApp` intentionally disables footer runtime-control work while `pyrusQa=safe` is active.
  - Normal-mode read-only Playwright probe showed footer slots as `IBKR 32/200`, `Massive 95 · 4s`, `Cache 41`, `App 29`; later samples showed Massive age/fill advancing independently and Cache/App values changing independently. Browser console showed six unrelated `429 Too Many Requests` resource errors from current API pressure.
- Validation:
  - FAIL first, as intended: `pnpm --filter @workspace/api-server exec tsx --test src/services/massive-stock-websocket.test.ts` caught `AM` freshness becoming non-null after only `Q/T` messages.
  - PASS after fix: `pnpm --filter @workspace/api-server exec tsx --test src/services/massive-stock-websocket.test.ts` - 3/3.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/massive-stock-websocket.test.ts src/services/runtime-diagnostics.test.ts src/services/stock-aggregate-stream.test.ts src/services/massive-stock-quote-stream.test.ts src/services/massive-stock-aggregate-stream.test.ts` - 33/33.
  - PASS: `pnpm --filter @workspace/pyrus exec tsx --test src/features/platform/runtimeControlModel.test.js src/features/platform/FooterMemoryPressureIndicator.test.js` - 50/50.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run build`.
  - PASS: `pnpm --filter @workspace/pyrus build`.
  - PASS: scoped `git diff --check` for the Massive diagnostics files.

## 2026-06-03 Shadow Route Latency Follow-Up In Progress

- User asked to flesh out the remaining finding after Massive diagnostics showed Massive was healthy and current pressure was shadow/account route latency.
- Current step:
  - Sampling `/api/diagnostics/latest`, shadow summary/positions/risk/allocation/equity-history, and combined account routes against current Replit API PID `48635`.
  - Mapping slow route behavior back to `artifacts/api-server/src/services/shadow-account.ts`, `account.ts`, and route admission/cache paths.
- Expected output:
  - Identify which shadow routes are slow because of duplicate ledger/equity-history/account fanout, which are live quote hydration, and which are cache/admission policy issues.
  - Add regression tests before behavior changes where a root cause is confirmed.
- Validation status:
  - Superseded by the completed slice below.

## 2026-06-03 Shadow Route Latency Staging Fix

- Root cause framing:
  - Massive was healthy; pressure was from shadow/account route fanout.
  - Account page fallback can fire after 1s if the account-page stream is not fresh.
  - Shadow critical work was doing summary P&L history, allocation, quote-hydrated positions, orders, and full risk.
  - Full risk can include live Greek quote/underlying hydration and Python scenario work, so it is the wrong dependency for first critical paint.
- Source fixes implemented:
  - `artifacts/api-server/src/services/shadow-account.ts`
    - Added `detail: "fast" | "full"` to `getShadowAccountRisk`.
    - Fast risk still uses cached Greek snapshots and cached positions, but skips live underlying quote hydration, live Greek quote hydration, and Python scenario execution.
    - Fast risk returns a normal risk payload with `greekScenarios.status = "disabled"` and warning `Deferred during the account-page critical read.`
  - `artifacts/api-server/src/services/shadow-account-streams.ts`
    - Shadow account snapshot stream now requests `getShadowAccountRisk({ positionsResponse, closedTrades, detail: "fast" })`.
  - `artifacts/api-server/src/services/account-page-streams.ts`
    - Shadow account-page critical payload now requests `getAccountPositions(... liveQuotes: false)` and injects those positions plus closed trades into `getShadowAccountRisk(... detail: "fast")`.
    - Non-shadow account-page critical behavior is unchanged.
  - `artifacts/pyrus/src/screens/AccountScreen.jsx`
    - Shadow account positions fallback/prefetch now sends `liveQuotes: false`, matching the stream's first-paint path and avoiding a second visible-live quote-hydrated positions route while the stream warms.
- One-off service-level proof from changed source code:
  - `shadow positions cached`: `1123ms`, 25 positions, 5 option positions, `degraded=false`.
  - `shadow closed trades`: `1060ms`.
  - `shadow risk fast injected`: `49ms`, `greekScenarios.status="disabled"`, 5/5 option positions matched to cached Greek snapshots.
  - `account page critical shadow`: `1933ms`, 25 positions, net liquidation `172189.0525`, day P&L `-2400.3851`, 5/5 option Greek snapshot coverage from cache, fast risk scenario warning present.
  - Full injected risk after warm cached positions/quotes completed in `98ms` with Python scenarios `completed`; setup positions/trades took `2095ms`.
- Validation:
  - PASS: `node --import tsx --test src/services/shadow-account.test.ts src/services/account-page-streams.test.ts` from `artifacts/api-server` - 125/125.
  - PASS: `node --test artifacts/pyrus/src/screens/account/accountCalendarData.test.js` - 11/11.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 12:00:26 MDT`.
  - PASS: `pnpm --filter @workspace/pyrus build`; rebuilt Pyrus dist at `2026-06-03 12:00:38 MDT`.
  - Broad package unit runners ignore file filters and still hit unrelated existing failures in other test areas; focused touched-file tests above pass.
- Runtime caveat:
  - Current Replit-owned API PID `57014` started at `2026-06-03 11:45:13 MDT`, before the `12:00:26 MDT` API rebuild.
  - Current HTTP server will not reflect this API-side staging fix until restarted with the default Replit Run Replit App entry.
  - `/api/diagnostics/latest` responded during this handoff update, but returned `status="down"` with empty route latency payload, so it was not useful for proving post-fix route pressure.
- Expected post-restart proof:
  - Reopen/restart via default Replit Run Replit App.
  - Account-page critical shadow stream should complete around low-single-digit seconds instead of waiting on full risk/scenario hydration.
  - `/api/accounts/shadow/positions` requests from AccountScreen should include `liveQuotes=false` in shadow mode.
  - Footer API pressure should stop attributing first-load pressure to quote-hydrated shadow positions/full risk fanout once the stream is fresh before fallback.

## 2026-06-03 STA 5-Minute Cadence Follow-Up

- User reported another live symptom: STA table candidates arriving at clean 5-minute intervals.
- Live facts from the current running API process:
  - Replit-owned API PID `48635` started around `2026-06-03 11:21:29 MDT`.
  - Latest API rebuild happened after that, at `2026-06-03 11:25:24 MDT`, so PID `48635` is still running the previous bundle.
  - There is no supported Replit workflow restart command exposed in this shell (`replit workflows` is unavailable); per repo rules, do not shell-kill PID `48635` or start a duplicate app runner.
  - Active paper STA deployment: `7e2e4e6f-749f-4e65-a011-87d3559a23b0`.
  - Active paper Signal Monitor profile: `a5721cf5-16e1-4221-81d1-f2064e997d98`, `timeframe = 5m`, `poll_interval_seconds = 60`, `max_symbols = 250`.
  - DB monitor profile is evaluating frequently: profile/deployment `last_evaluated_at` advanced around `2026-06-03T17:26Z`/`17:27Z`.
  - `signal_monitor_events` is stale for the relevant symbols: newest global paper event remained `CORZ` at `2026-06-03T16:46:43Z`; no new `HEI`/`CGNX` event rows existed for their current stored-state changes.
  - Stored state can change without a new `signal_monitor_event_created`, proving event-only STA worker wakeups are insufficient.
- Refined interpretation:
  - 5-minute `signal_at` values are expected for the primary STA profile because the deployment strategy timeframe is `5m`.
  - The bug is not the timestamp boundary itself. The bug is any delay between stored monitor state updating and STA/cockpit summary/action scans seeing that state.
  - Current old runtime showed exactly that class of issue: the summary endpoint temporarily returned stale HEI data (`signalAt 2026-06-03T17:05:00Z`) while DB state for HEI 5m was already old/not fresh and only CGNX/INDI were the fresh 5m rows. A later request dropped stale HEI and returned only CGNX.
- Final source fixes already implemented for this symptom:
  - `signal-options-worker.ts` queues post-tick signal-event wakeups and also wakes an idle worker on `signal_monitor_state_refreshed`.
  - `signal-monitor.ts` emits `signal_monitor_state_refreshed` after stored evaluation metadata persists, covering state changes without inserted events.
  - `signal-options-automation.ts` lets worker scans honor `preferStoredMonitorState: true` and treats stale summary/cockpit cache as fallback-only in summary mode instead of the default answer.
- Validation after the final STA patch:
  - PASS: `node --import tsx --test src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts src/services/signal-monitor.test.ts src/services/algo-cockpit-streams.test.ts` - 230/230.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 11:25:24 MDT`.
  - PASS: scoped `git diff --check` for `signal-options-automation`, `signal-options-worker`, and `signal-monitor` source/tests.
- Required runtime proof:
  - Restart once with the default Replit Run Replit App entry so PID `48635` is replaced by a process started after the `11:25:24 MDT` API build.
  - Then run the 5-minute STA monitor again and check that 5m stored rows move into `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state?view=summary` and `/cockpit?view=summary` promptly after state refresh, without stale HEI-like candidates lingering and without the stale-scan freshness banner.

## 2026-06-03 STA Burst Action Cap Follow-Up

- Replit auto-recycled after the state-refresh/stale-summary patch and loaded API PID `53811`.
- Post-recycle 5-minute monitor:
  - 20/20 `/signal-options/state?view=summary` samples returned HTTP 200.
  - Cockpit summary samples returned HTTP 200.
  - The old stale-scan freshness issue cleared: cockpit scan stage showed `lastSignalScanAt = 2026-06-03T17:37:20.688Z`, `latestSignalBarAt = 2026-06-03T17:37:00.328Z`, readiness ready, and no stale scan banner condition.
  - USO proved the fixed signal visibility path: signal/profile state appeared around `2026-06-03T17:34:45Z`; STA state/cockpit showed it by `2026-06-03T17:35:00Z` with `barsSinceSignal = 0` and `actionEligible = true`. Stored display later normalized to the `17:30:00Z` 5m bar, but the signal was visible while current-bar actionable.
  - ACHR proved the pre-fix delay class: event existed at `17:28:50Z`, but stored 5m profile did not update until `17:32:53Z`; once stored state updated, STA/cockpit saw it within the same sample. This points to monitor/profile evaluation cadence for that older event, not summary-cache lag.
- Remaining live symptom found during the monitor:
  - Cockpit briefly showed fresh/actionable USO in signals while `candidates = 0` and `shadowExecutionSlo.signalPickup` failed.
  - Execution events then proved action processing did run: `signal_options_candidate_created` for USO at `2026-06-03T17:36:40Z`, followed by skipped candidate events at `17:36:51Z`, `17:37:00Z`, `17:37:13Z`, and `17:37:29Z` for option liquidity (`missing_bid_ask`, then `spread_too_wide`).
  - Source root cause for the candidate delay: the worker action cap was `SIGNAL_OPTIONS_WORKER_ACTION_BUDGET_MS = 5_000` and `SIGNAL_OPTIONS_WORKER_ACTION_ITEM_LIMIT = 1`, so a burst of fresh current-bar signals got serialized one candidate per worker action tick. That matches the user's artificial-cap suspicion.
- Burst-cap fix implemented:
  - `artifacts/api-server/src/services/signal-options-worker.ts`
    - Raised worker action budget from `5_000ms`/`1` item to `60_000ms`/`4` items.
  - `artifacts/api-server/src/services/signal-options-automation.ts`
    - Raised worker default fallback action budget to the same `60_000ms`/`4` items.
  - Tests updated:
    - `signal-options-worker.test.ts` now asserts worker scans pass `actionWorkBudgetMs = 60_000` and `actionWorkItemLimit = 4`.
    - `signal-options-automation.test.ts` now asserts worker default budget helper returns deadline `61_000` from `nowMs = 1_000` and item limit `4`.
- Validation after burst-cap fix:
  - PASS: `node --import tsx --test src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts src/services/signal-monitor.test.ts src/services/algo-cockpit-streams.test.ts` - 230/230.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: scoped `git diff --check`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 11:42:34 MDT`.
  - Built artifact proof: `dist/index.mjs` contains `SIGNAL_OPTIONS_WORKER_ACTION_BUDGET_MS = 6e4`, `SIGNAL_OPTIONS_WORKER_ACTION_ITEM_LIMIT = 4`, and matching default automation constants.
- Runtime blocker:
  - Current live PID `53811` started at `2026-06-03 11:29:33 MDT`, before the `11:42:34 MDT` burst-cap build.
  - Do not shell-kill or start a duplicate app from Codex. Restart via default Replit Run Replit App, then rerun a short STA burst monitor. Expected result: if multiple current-bar signals appear together, execution events should be created/skipped for up to 4 candidates in one worker scan instead of one per tick.

## 2026-06-03 IBKR Flow Scanner Line Audit Follow-Up

- User reported that only 8 IBKR lines appeared to be used for flow scanning, and that header/footer line usage counts did not stay synchronized.
- Live diagnosis before the latest source patch:
  - `/api/settings/ibkr-line-usage?detail=full` showed `scannerEffectiveConcurrency = 8`, `scannerLineBudget = 200`, and scanner active lines ranging from about 40 to 194 during the soak.
  - The `8` value was worker concurrency, not the scanner line cap.
  - Root cause for the real cap-like behavior: commit `90eb7a0` introduced `OPTIONS_FLOW_SCANNER_PER_TICKER_LINE_BUDGET` with default `1`, so 8 scanner workers could request only about 8 option lines per wave.
  - Live owner samples after the first patch showed per-symbol scanner owners receiving about 22 lines each, confirming the 1-line cap was removed.
  - Remaining mismatch was not lease TTL: fresh scanner leases had `ttlMs` about `300000`.
  - Remaining mismatch was line generation/audit: runtime has `IBKR_ASYNC_SIDECAR_ROUTING_ENABLED=true`, but `ibkr-line-usage.ts` only rebuilt active subscription counts from generation status when the target was direct `tws-bridge`. With sidecar routing, top-level `bridgeActiveLineCount` could stay at stale bridge diagnostics while `sidecar.bridgeGenerationStatus` showed the authoritative sidecar status.
  - Large sidecar generations also timed out at the 5s default: live old-process samples showed `IBKR async sidecar request to /market-data/generation timed out after 5000ms` for 70+ desired lines.
- Source fixes implemented:
  - `artifacts/api-server/src/services/platform.ts`
    - Default `OPTIONS_FLOW_SCANNER_PER_TICKER_LINE_BUDGET` now falls back to the existing per-scan budget default instead of `1`.
    - Default ticker line budget without a phase cap now uses `resolveOptionsFlowScannerPerScanLineBudget(config, config.scannerLineBudget)`, so current 200-line / 8-worker config yields about 25 lines per scanner symbol.
  - `artifacts/api-server/src/services/ibkr-line-usage.ts`
    - Default generation apply timeout raised from 5s to 30s.
    - Generation-derived subscription counts now include `live` and `subscribing` lines.
    - Active bridge/subscription counts now rebuild from whichever generation status is authoritative, including async-sidecar status when sidecar routing is enabled.
  - `artifacts/api-server/src/services/ibkr-async-sidecar-client.ts`
    - Default sidecar request timeout raised from 5s to 30s.
  - Tests updated:
    - `options-flow-scanner.test.ts` asserts default scanner line budgets are 25 and default symbol scans use the pool-aware line slice.
    - `ibkr-line-usage.test.ts` asserts async-sidecar generation status drives top-level bridge active count and drift reconciliation to `matched`.
- Validation:
  - PASS: `node --import tsx --test src/services/ibkr-line-usage.test.ts` - 20/20.
  - PASS: `node --import tsx --test src/services/options-flow-scanner.test.ts` - 83/83.
  - PASS: `node --import tsx --test src/services/ibkr-async-sidecar-client.test.ts` - 3/3.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 11:49:28 MDT`.
  - PASS: `git diff --check`.
- Runtime caveat:
  - Current live API PID `57014` started at `2026-06-03 11:45:13 MDT`, before the `11:49:28 MDT` rebuild.
  - Replit supervisor did not recycle the API process after the manual build, so live endpoint samples still showed the old `5000ms` timeout.
  - Do not shell-start a duplicate app runner from Codex. Restart through the default Replit Run Replit App entry, then run a short line-usage soak.
- Expected post-restart proof:
  - `/api/settings/ibkr-line-usage?detail=full` should no longer report the old `5000ms` sidecar timeout.
  - When sidecar apply succeeds, `sidecar.bridgeGenerationStatus.source` should be `ib-async-sidecar`, `sidecar.comparison.status` should be `matched`, and top-level `bridgeActiveLineCount`/drift reconciliation should reflect that same sidecar status.
  - Scanner active lines should be limited by actual scanner work, protected line demand, or sidecar apply state, not by the former 1-line-per-worker budget.

## 2026-06-03 STA Post-Restart Control Poll + Fast Summary In-Flight Fix

- User restarted again and asked to check the Signal Options/STA flow.
- Live process/build facts:
  - Current Replit-owned API PID stayed `57014`, started at `2026-06-03 11:45:13 MDT`.
  - `artifacts/api-server/dist/index.mjs` was rebuilt at `2026-06-03 11:54:15 MDT`.
  - Because the running node process started before the rebuild, the live HTTP server cannot include the latest fast-summary fix until the default Run Replit App is restarted again.
- Control-poll observations against the old PID:
  - 5-minute poll from `2026-06-03T17:55:12Z` through `2026-06-03T18:02:58Z`.
  - PID never changed from `57014`.
  - `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state?view=summary` intermittently returned HTTP `200`, but also produced `000` client timeouts during pressure.
  - `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/cockpit?view=summary` repeatedly returned HTTP `504` with `signal_options_dashboard_build_timeout` or `signal_options_cockpit_route_timeout`.
  - This is evidence that the old live bundle still exhibits the summary/cockpit timeout symptom; it is not evidence against the newly rebuilt fix.
- Additional root cause found and fixed in source/build:
  - Fast Signal Options summary refresh shared `signalOptionsSummaryDashboardInFlight` with the slower dashboard/event-metadata build.
  - Under action/route pressure, the fast summary route could wait behind slow dashboard work, hit the route budget, and fall back to stale dashboard cache. This explained stale or empty summary/cockpit responses even while durable stored signal rows were fresh.
  - `artifacts/api-server/src/services/signal-options-automation.ts` now has a dedicated `signalOptionsFastSummaryInFlight` map. Fast summary refresh uses that map, while the heavier dashboard build keeps using the existing summary-dashboard in-flight map.
  - Cache invalidation now clears the fast-summary in-flight map as well.
  - `artifacts/api-server/src/services/signal-options-automation.test.ts` now guards that the fast summary code reads/sets/deletes `signalOptionsFastSummaryInFlight` and does not share `signalOptionsSummaryDashboardInFlight`.
- Validation:
  - PASS: `node --import tsx --test src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts src/services/signal-monitor.test.ts src/services/algo-cockpit-streams.test.ts` - 230/230.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 11:54:15 MDT`.
  - PASS: scoped `git diff --check`.
  - Built artifact proof: `dist/index.mjs` contains `signalOptionsFastSummaryInFlight` plus the `60_000ms` / `4` worker action cap constants.
- Required next runtime proof:
  - Restart once more with the default Run Replit App entry so API PID `57014` is replaced by a process started after `2026-06-03 11:54:15 MDT`.
  - Re-run the same 5-minute monitor.
  - Expected result: summary/cockpit no longer return stale-empty cache or dashboard build timeout under normal Signal Options action pressure; fresh stored monitor rows appear in STA summary promptly and action candidates are processed up to the widened 4-item worker cap.

## 2026-06-03 STA Exact Signal Timestamp Fix

- User correctly rejected the remaining symptom: the STA table still appeared to show candidates arriving on clean 5-minute increments.
- Live DB evidence:
  - `signal_monitor_events` has the real off-boundary Pyrus trigger times, e.g. `MU 2026-06-03T18:06:22.031Z`, `IEF 2026-06-03T18:05:32.473Z`, `COHR 2026-06-03T17:58:10.540Z`, `SMH 2026-06-03T17:43:52.421Z`, `RBLX 2026-06-03T17:37:56.649Z`.
  - `execution_events` candidates created from event/live paths preserved exact times, e.g. `MU` candidate payload `signalAt = 2026-06-03T18:06:22.031Z`.
  - Stored `signal_monitor_symbol_states.current_signal_at` for the same signals was later snapped back to bar anchors, e.g. `MU 2026-06-03T18:05:00Z`, `IEF 2026-06-03T18:05:00Z`, `COHR 2026-06-03T17:55:00Z`, `SMH 2026-06-03T17:40:00Z`, `RBLX 2026-06-03T17:35:00Z`.
  - That means the earlier move toward fast stored-state reads fixed freshness but exposed a timestamp-fidelity bug: stored-state built STA candidates/signals can look like they arrive only at 5-minute bar boundaries even when the indicator fired inside the bar.
- Root cause:
  - `signal-monitor.ts` persisted `current_signal_at` from the evaluated bar close/anchor.
  - Event-backed evaluations inserted `signal_monitor_events` with precise provider `dataUpdatedAt`, but later profile/matrix refreshes without provider `dataUpdatedAt` could overwrite `current_signal_at` with the rounded bar anchor for the same signal.
- Fix implemented:
  - `artifacts/api-server/src/services/signal-monitor.ts`
    - Added `buildSignalMonitorEventKey()` and reused it for `insertSignalEvent()`.
    - `upsertSymbolState()` now resolves `currentSignalAt` through `resolveStoredSignalMonitorSignalAt()`.
    - For UUID-backed profiles with direction + signal time, state upsert looks for an existing `signal_monitor_events.event_key` for the same profile/symbol/timeframe/direction/bar-anchor and preserves that event's precise `signal_at`.
    - Runtime fallback profiles and non-directional rows skip the lookup.
  - `artifacts/api-server/src/services/signal-options-automation.ts`
    - Added read-time enrichment in `listSignalOptionsStoredSignalStatesFast()`.
    - The fast stored-state reader now bulk builds event keys for stored rows, reads matching `signal_monitor_events.event_key` rows, and replaces rounded stored `currentSignalAt` with the exact event `signal_at` before building STA summary signals/candidates.
    - This makes the STA summary/cockpit path show exact off-boundary signal times immediately after load, even before the background stored-state table has been refreshed by the write-time fix.
  - `artifacts/api-server/src/services/signal-monitor.test.ts`
    - Added `signal monitor stored state preserves precise event signal time` guard for event-key construction and the upsert resolver path.
  - `artifacts/api-server/src/services/signal-options-automation.test.ts`
    - Added source guards for `buildSignalOptionsSignalMonitorEventKey`, `signalMonitorEventsTable.eventKey`, and `eventSignalAtByKey` in the fast stored-state path.
- Validation:
  - PASS: `node --import tsx --test src/services/signal-monitor.test.ts src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts src/services/algo-cockpit-streams.test.ts` - 231/231.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 12:23:18 MDT`.
  - PASS: scoped `git diff --check`.
  - Built artifact proof: `dist/index.mjs` contains `resolveStoredSignalMonitorSignalAt`, `buildSignalOptionsSignalMonitorEventKey`, `eventSignalAtByKey`, and `signalMonitorEventsTable.eventKey`.
- Runtime caveat:
  - Current live API PID `68750` started at `2026-06-03 12:20:17 MDT`, before the `12:23:18 MDT` rebuild.
  - Restart via default Run Replit App is required before live stored-state/candidate timestamps can prove this fix.
- Required post-restart proof:
  - Recheck recent `signal_monitor_symbol_states` for symbols with existing precise events; expected `current_signal_at` should remain the precise event time after profile/matrix refreshes, not snap back to `:00` five-minute anchors.
  - Recheck STA candidate rows; expected candidate `signalAt`/nested `signal.signalAt` should be off-boundary when the underlying `signal_monitor_events.signal_at` is off-boundary.

## 2026-06-03 Shadow Account Critical Stream Follow-Up

- User restarted and asked for live verification. The restart did load newer code, but the check found the shadow account SSE still did not emit a `critical` event within a 25s sample; it only sent the SSE retry/ping prelude.
- Live route timings against that process showed the remaining blockers:
  - `/api/accounts/shadow/positions?mode=paper&liveQuotes=false`: about `2.08s`, 25 positions, stale cache response.
  - `/api/accounts/shadow/positions?mode=paper&liveQuotes=true`: about `10.79s`, 25 positions.
  - `/api/accounts/shadow/risk?mode=paper`: about `14.15s`, full Greek scenarios completed.
  - `/api/accounts/shadow/equity-history?mode=paper&range=1D`: about `18.02s`.
  - `/api/accounts/shadow/summary?mode=paper`: about `27.67s`.
  - `/api/accounts/shadow/allocation?mode=paper`: about `13.11s`.
- Root cause of the follow-up miss:
  - The first patch moved shadow positions and risk to the fast path, but `fetchAccountPageCriticalPayload()` still awaited `getAccountSummary()` and `getAccountAllocation()`.
  - For shadow, those wrappers call the full shadow summary/allocation readers, which in turn can force expensive fresh-state/equity-history work before the first stream event.
  - AccountScreen also had a 1s critical fallback. If the stream misses that window, React Query can enable REST summary/allocation/risk queries and recreate the pressure we were trying to avoid.
- Source fixes implemented:
  - `artifacts/api-server/src/services/shadow-account.ts`
    - Added `getShadowAccountSummaryFromPositions()` and `getShadowAccountAllocationFromPositions()`.
    - These derive critical summary/allocation from the already-fetched `liveQuotes=false` positions response.
    - Fast summary does **not** derive day PnL from position day-change totals. It only fills day PnL from a fresh cached `1D` equity-history response when one already exists; otherwise the slower/full path can populate it later without blocking first paint.
  - `artifacts/api-server/src/services/account-page-streams.ts`
    - Shadow critical branch now fetches positions/orders/closed-trades, derives summary/allocation from positions, and computes injected `detail: "fast"` risk.
    - Non-shadow critical path remains unchanged.
  - `artifacts/api-server/src/services/shadow-account-streams.ts`
    - Shadow account snapshot base now uses the same position-derived summary/allocation plus fast risk.
  - `artifacts/pyrus/src/screens/AccountScreen.jsx`
    - Non-shadow critical fallback remains `1_000ms`.
    - Shadow critical fallback is now `4_000ms`, giving the low-single-digit-second stream critical event time to arrive before REST fallbacks start.
- Validation:
  - PASS: `node --import tsx --test src/services/shadow-account.test.ts src/services/account-page-streams.test.ts` from `artifacts/api-server` - 125/125.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 12:24:35 MDT`.
  - PASS: `node --test artifacts/pyrus/src/screens/account/accountCalendarData.test.js` - 11/11.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus build`; rebuilt `artifacts/pyrus/dist/public/index.html` at `2026-06-03 12:24:59 MDT`.
  - PASS: scoped `git diff --check`.
- Changed-code proof without live reload:
  - Direct `fetchAccountPageCriticalPayload({ accountId: "shadow", mode: "paper", orderTab: "working" })` via `node --import tsx` returned in `2666ms`.
  - Payload had 25 positions, 5 option positions, non-degraded/non-stale positions, net liquidation `172508.9511479999`, 3 allocation asset classes, and `risk.greekScenarios.status = "disabled"` with warning `Deferred during the account-page critical read.`
- Post-restart live follow-up:
  - After restart to live API PID `71623`, `/api/streams/accounts/page?accountId=shadow&mode=paper&orderTab=working` did emit `critical`, proving the position-derived summary/allocation patch was loaded.
  - Cold critical still landed around the 10-12s window, not before the 4s fallback, because the shadow critical branch still waited on `getAccountClosedTrades()` for fast risk.
  - Live route timings showed positions `0.90s`, working orders `3.15s`, closed trades `5.73s`, allocation REST `9.14s`.
- Final source fix:
  - `artifacts/api-server/src/services/account-page-streams.ts` now uses `deferredShadowClosedTrades()` for shadow fast risk in the account-page critical payload instead of calling `getAccountClosedTrades(common)`.
  - This keeps realized/all-time closed-trade risk out of the first-paint path; full/derived closed-trade data still loads through the normal derived routes.
  - Direct changed-code proof after this final patch returned in `2497ms` with 25 positions, 0 working orders, non-degraded positions, 3 allocation asset classes, net liquidation `172760.91419999988`, and `risk.greekScenarios.status = "disabled"`.
- Final validation:
  - PASS: `node --import tsx --test src/services/account-page-streams.test.ts src/services/shadow-account.test.ts` from `artifacts/api-server` - 125/125.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 12:31:37 MDT`.
  - PASS: scoped `git diff --check`.
- Runtime caveat:
  - Current live API PID `71623` started at `2026-06-03 12:27:49 MDT`.
  - The final API build with deferred closed-trades was produced at `2026-06-03 12:31:37 MDT`, so final live HTTP/browser proof requires one more restart via the default Replit Run Replit App entry.
- Required post-restart proof:
  - Sample `/api/streams/accounts/page?accountId=shadow&mode=paper&orderTab=working`; expected `critical` event before the 4s shadow fallback window.
  - Open Account shadow page and verify first-paint diagnostics no longer show `/accounts/shadow/summary`, `/accounts/shadow/allocation`, or `/accounts/shadow/risk` as immediate fallback pressure drivers.
  - Recheck `/api/diagnostics/latest`; expected current pressure, if any, should not be dominated by the old shadow critical fanout.

## 2026-06-03 IBKR Post-Restart Line Soak + Bridge Helper v6 Timeout Fix

- User restarted Replit and asked for a check.
- Replit process proof:
  - API PID `68750` started at `2026-06-03 12:20:17 MDT` on `PORT=8080`; `/api/healthz` returned ok.
  - Replit later recycled API to PID `71623` at `2026-06-03 12:27:49 MDT`, also on `PORT=8080`; `/api/healthz` still returned ok.
  - `/api/ibkr/bridge/launcher` now serves helper `2026-06-03.ib-async-sidecar-v6` and a current bundle URL.
  - Runtime diagnostics show connected/strict-ready/fresh stream, but the desktop helper is still `2026-06-02.ib-async-sidecar-v5`; expected is `2026-06-03.ib-async-sidecar-v6`, so `desktopAgentUpgradeRequired: true`.
- Post-restart line-usage evidence:
  - Early samples proved the API-side sidecar accounting fix is live: small generations could match with bridge active equal to desired active and source routed through the async sidecar.
  - Scanner is no longer capped at 8 lines. During the 5-minute soak from `2026-06-03T18:22:57Z` to `18:28:19Z`, scanner demand reached `110`, `132`, and peaked at `176` scanner lines (`active=189`, target `200`).
  - Under those larger generations, `sidecar.applyError` repeatedly reported `IBKR async sidecar returned 502: This operation was aborted`; bridge active lines dropped to `0`, `1`, `12`, or other stale/lagging values while desired generation remained high.
  - The final samples matched only after scanner demand dropped to zero/tiny generations (`active=2`, `bridge=2`, comparison `matched`), proving the failure is generation-size/timeout related rather than a persistent disconnected state.
- Root cause isolated after the soak:
  - API-side apply timeout and async-sidecar client timeout were already raised to `30_000ms`, but the local Node bridge proxy still defaulted `PYRUS_IBKR_SIDECAR_PROXY_TIMEOUT_MS` / `IBKR_ASYNC_SIDECAR_PROXY_TIMEOUT_MS` to `5000ms`.
  - The API therefore waited long enough, but the desktop bridge returned a 502 after its own 5s abort.
- Source fixes implemented:
  - `artifacts/ibkr-bridge/src/app.ts`
    - Added `DEFAULT_ASYNC_SIDECAR_PROXY_TIMEOUT_MS = 30_000`.
    - Bridge proxy now defaults to that value instead of `5000`.
  - `scripts/windows/pyrus-ibkr-helper.ps1`
    - Bumped helper version to `2026-06-03.ib-async-sidecar-v6`.
    - Sets `$env:PYRUS_IBKR_SIDECAR_PROXY_TIMEOUT_MS = '30000'` before starting the local bridge.
  - `artifacts/api-server/src/services/ibkr-bridge-runtime.ts`
    - Expected helper version bumped to `2026-06-03.ib-async-sidecar-v6`.
  - `artifacts/ibkr-bridge/src/app.test.ts` and `artifacts/api-server/src/services/ibkr-bridge-runtime.test.ts`
    - Added/updated guards for the 30s proxy default, helper v6, and helper env setting.
  - Rebuilt `@workspace/ibkr-bridge`, repackaged `artifacts/ibgateway-bridge-windows-current.tar.gz`, and rebuilt `@workspace/api-server`.
- Validation:
  - PASS: `node --import /home/runner/workspace/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs --test src/app.test.ts` from `artifacts/ibkr-bridge` - 4/4.
  - PASS: `node --import tsx --test src/services/ibkr-bridge-runtime.test.ts` from `artifacts/api-server` - 30/30.
  - PASS: `node --import tsx --test src/services/ibkr-line-usage.test.ts` from `artifacts/api-server` - 20/20.
  - PASS: `pnpm --filter @workspace/ibkr-bridge run typecheck`.
  - PASS: `pnpm --filter @workspace/ibkr-bridge run build`.
  - PASS: `node scripts/package-ibkr-bridge-bundle.mjs`.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run build`.
  - PASS: `git diff --check`.
- Required next runtime proof:
  - Relaunch the desktop IBKR bridge helper from the app header so the Windows helper self-updates from v5 to v6 and restarts the local bridge with the 30s proxy timeout.
  - Recheck `/api/diagnostics/runtime`; expected `desktopAgentHelperVersion = 2026-06-03.ib-async-sidecar-v6` and `desktopAgentUpgradeRequired = false`.
  - Rerun a 5-minute `/api/settings/ibkr-line-usage?detail=full` soak while scanner demand is high; expected no 502 aborts under 100+ scanner lines, and bridge active counts should track desired generation instead of collapsing to stale/0.

## 2026-06-03 CLSK/RKLB STA 5-Minute Delay Root Cause + Worker Stream-Poll Fix

- User correctly reported that `CLSK` and `RKLB` still appeared in the STA table about five minutes late.
- Live DB proof:
  - `RKLB buy 5m`: `signal_at = 2026-06-03T18:25:00Z`, `emitted_at = 2026-06-03T18:29:37.067992Z`, lag `277.068s`.
  - `CLSK buy 5m`: `signal_at = 2026-06-03T18:25:00Z`, `emitted_at = 2026-06-03T18:29:54.845564Z`, lag `294.846s`.
  - `SOXX buy 5m` showed the same pattern: `signal_at = 18:25:00Z`, `emitted_at = 18:29:58.968958Z`, lag `298.969s`.
  - `signal_monitor_events` payloads for those rows had `signalBarAt`, `latestBarAt`, and `latestBarAnchorAt` all at `18:25:00Z`, proving these were not off-boundary timestamp display bugs. The indicator was not being evaluated/persisted until the end of the active 5-minute bar.
- First root cause:
  - Massive stock aggregate streaming was live and subscribed, but Signal Options did not evaluate Signal Monitor state from aggregate callbacks.
  - Worker scans used `preferStoredMonitorState: true` and could read stored state, but no per-symbol stream update was forcing Signal Monitor state writes when Massive aggregate data changed.
- First fix implemented:
  - `artifacts/api-server/src/services/signal-options-worker.ts`
    - Added a Massive stock-minute aggregate subscription owned by the Signal Options worker.
    - Aggregate callbacks queue only the changed symbol per active deployment mode.
    - Stream evaluation is debounced at `250ms`, cooldown-limited to `2s` per mode/symbol, and batched to `24` symbols.
    - The stream evaluator calls `evaluateSignalMonitorProfileSymbols()` with `mode: "incremental"`, `pressureCapMode: "bypass-soft"`, `barSourcePolicy: "mixed"`, and bounded concurrency.
  - `artifacts/api-server/src/services/signal-options-worker.test.ts`
    - Added `signal-options worker evaluates changed stream symbols from Massive aggregates`.
- Second live symptom after the first fix:
  - `/api/algo/deployments/.../signal-options/state?view=summary` still produced a route timeout in one live sample.
  - Runtime diagnostics showed API RSS about `1.35GB`, heap about `911MB / 1009MB`, API p95 latency about `8799ms`, dominant slow-route p95 about `41014ms`, storage ping about `5157ms`, and many signal-matrix `/api/bars` provider fetches.
  - Cockpit showed the Signal Options worker in `scan_universe` / `signal_refresh` for over a minute.
  - This identified the regression in the first source fix: removing the worker's stream-primary stored-state shortcut caused the 60s worker poll to fall back into larger REST-backed Signal Monitor refreshes whenever stored state looked behind the expected bar.
- Final source fix implemented:
  - `artifacts/api-server/src/services/signal-options-automation.ts`
    - Restored the worker-only stream-primary stored-state path:
      - applies only when `input.source === "worker"`,
      - `input.preferStoredMonitorState === true`,
      - `SIGNAL_OPTIONS_STREAM_FIRST_MONITOR` is not disabled,
      - `isStockAggregateStreamingAvailable()` is true,
      - and `forceEvaluate` is false.
    - Manual/non-worker paths keep their lightweight stored-state behavior.
    - Worker polls no longer turn into full REST-backed signal monitor refresh loops while Massive stream evaluation owns per-symbol freshness.
- Important live caveats:
  - After the first fix but before this final worker-poll patch, a live `CEG` event proved stream evaluation can emit quickly: `signal_at = 2026-06-03T18:39:13.899Z`, `emitted_at = 18:39:14.648507Z`.
  - That CEG event was later overwritten in current state by another evaluation, so final proof must measure STA-visible stored state/candidate rows, not only `signal_monitor_events`.
  - Current live API PID `76118` started at `2026-06-03 12:39:16 MDT`; the final API bundle was rebuilt at `2026-06-03 12:45:03 MDT`, so the live process cannot include this final worker-poll fix until the next default Replit Run Replit App restart.
- Validation:
  - PASS: `node --import tsx --test src/services/signal-options-worker.test.ts src/services/signal-options-automation.test.ts` - 163/163.
  - PASS: `node --import tsx --test src/services/signal-monitor.test.ts src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts src/services/algo-cockpit-streams.test.ts` - 232/232.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 12:45:03 MDT`.
  - PASS: scoped `git diff --check`.
- Required post-restart proof:
  - Restart with the default Replit Run Replit App entry so API PID `76118` is replaced by a process started after `2026-06-03 12:45:03 MDT`.
  - Watch the next Signal Monitor events and STA summary/cockpit rows for at least five minutes.
  - Expected result: new current-bar signals should be evaluated from Massive aggregate callbacks, written to `signal_monitor_symbol_states`, and picked up by STA without waiting until the clean 5-minute bar boundary or the next full worker poll.
  - Also verify cockpit `scan_universe` no longer sits in `signal_refresh` because worker polls should report `signalOptionsBatch.source = "stored_state"` / `reason = "stream_live_primary"` instead of triggering large REST-backed refreshes.

## 2026-06-03 STA One-Candle Wait Rule Removal

- User clarified the desired invariant: when a signal fires at candle close, STA must pick it up immediately; any rule that waits one more 5m candle is errant.
- Root cause found:
  - `artifacts/api-server/src/services/signal-options-automation.ts` computed `expectedLatestSignalOptionsMonitorBarAt()` from `now - timeframe`, so at `14:00:03` on a 5m profile it still expected `13:55`, not the just-closed `14:00` candle. That made stale stored state look acceptable for one full candle and allowed the worker to regress into 5m-late behavior.
  - Stream-rolled minute aggregates also stamped completed candles at the last child minute's inclusive end (`14:34:59.999`) instead of the exact candle close (`14:35:00.000`), which could make just-closed stream bars look one millisecond behind the expected live edge.
- Fix implemented:
  - `signal-options-automation.ts`: `expectedLatestSignalOptionsMonitorBarAt()` now uses `input.now` directly, so the expected bar is the just-closed candle boundary.
  - `signal-monitor.ts`: stream aggregate bars now normalize inclusive minute ends to exact close boundaries, and completed multi-minute rollups stamp `dataUpdatedAt` at `bucketEndMs`.
  - Added/updated tests in `signal-monitor.test.ts` and `signal-options-automation.test.ts` so `14:00:03` requires `14:00`, and stream bars close exactly on candle boundaries.
- Validation:
  - PASS: `node --import tsx --test src/services/signal-monitor.test.ts src/services/signal-options-automation.test.ts src/services/signal-options-worker.test.ts` - 230/230.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 13:16:37 MDT`.
  - PASS: scoped `git diff --check`.
- Runtime caveat:
  - Live API PID `6175` started at `2026-06-03 13:11:52 MDT`, before the `13:16:37 MDT` rebuild. Restart via default Run Replit App is required before live STA proof.

## 2026-06-03 STA WebSocket-Only Live Pickup Contract

- User reported `UUUU` appeared in STA roughly 7 minutes late and asked to watch STA while fixing the live signal path.
- Live evidence before final patches:
  - Massive stock aggregate WebSocket was active (`activeProvider: "massive-websocket"`), subscribed to `UUUU`, and had sub-100ms aggregate age.
  - `UUUU` signal event: `signal_at = 2026-06-03T19:25:00Z`, `emitted_at = 2026-06-03T19:31:54.305Z`, lag `414.305s`.
  - A watcher reproduced the empty table symptom against the running API: `signalCount: 0`, `reason: "signal_options_state_summary_fast_cache_only_fallback"`, while recent Massive REST aggregate calls still included `UUUU`.
  - Later samples returned `9` rows and `UUUU`, proving stored state existed; the empty STA surface was a cold cache-only summary fallback, not absence of Signal Monitor data.
- Root causes:
  - The Signal Options summary `cache-only` path could return a cold empty snapshot even when `refreshSignalsFromMonitorState: true` requested cheap stored Signal Monitor hydration.
  - The fast summary path could return fresh/stale dashboard cache before honoring the explicit stored-signal refresh request, allowing STA to hold old/empty rows.
  - Stream-triggered Signal Monitor evaluation still had a REST historical-bar fallback if cached history was not warm enough, so the Massive WebSocket path could regress into 5m historical aggregate REST fetches under load.
- Fix implemented:
  - `artifacts/api-server/src/services/signal-options-automation.ts`
    - `buildSignalOptionsFastSummarySnapshot()` now treats `refreshSignalsFromMonitorState: true` as authoritative for summary signals.
    - Fresh/stale summary cache is only a fallback while the fast stored-signal refresh runs.
    - `cache-only + refreshSignalsFromMonitorState` now starts the fast stored-state refresh instead of returning a cold empty snapshot.
  - `artifacts/api-server/src/services/signal-monitor.ts`
    - Added `allowHistoricalFallback?: boolean` through live-edge bar loading, symbol evaluation, batch evaluation, and explicit profile-symbol evaluation.
    - Added `SignalMonitorLiveEdgeHistoryUnavailableError`.
    - When `allowHistoricalFallback === false`, live-edge evaluation can use WebSocket bars alone or cached history plus WebSocket edge, but cannot fall through to REST historical bars.
    - If cached history is not warm, `evaluateSignalMonitorSymbol()` preserves the current stored row instead of upserting `unavailable` and clearing STA-visible state.
  - `artifacts/api-server/src/services/signal-options-worker.ts`
    - Stream aggregate symbol evaluator now passes `includeProvisionalLiveEdge: true` and `allowHistoricalFallback: false`.
  - Additional tightening:
    - Scheduled Signal Options monitor full/batch refresh calls now also pass `allowHistoricalFallback: streamFirstMonitorAvailable ? false : undefined`.
    - This prevents worker/manual Signal Options monitor refreshes from silently falling back to REST historical bars while Massive aggregate streaming is available.
  - `artifacts/api-server/src/routes/automation.ts`
    - Explicit `?cacheMode=cache-only` is honored for state/cockpit/performance diagnostics and pressure fallbacks.
- Regression coverage:
  - `signal-monitor.test.ts`: provisional live-edge path tries cached history before REST, strict no-REST mode exists before recursive base load, and no-history strict mode preserves stored state.
  - `signal-options-worker.test.ts`: stream evaluator asserts `allowHistoricalFallback: false`.
  - `signal-options-automation.test.ts`: fast summary refresh honors `refreshSignalsFromMonitorState` before returning fresh/stale cache or cold cache-only fallback.
  - `automation.test.ts`: route cache-mode override source guard.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts src/services/signal-options-worker.test.ts src/services/signal-options-automation.test.ts src/services/automation.test.ts` - 235/235.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 13:55:22 MDT`.
  - PASS: scoped `git diff --check`.
- Runtime status:
  - Replit-owned API PID `20587` started at `2026-06-03 13:49:36 MDT`, before the final `13:55:22 MDT` build, so the running API still cannot include the strict no-REST scheduled-refresh patch.
  - Live route samples after the earlier rebuild no longer reproduced the 0-row cache-only fallback and returned `8-10` STA rows including `UUUU`.
  - Short watcher found one fast event (`SMCI` lag `8.364s`) and one delayed event (`AMZN` lag `453.373s`) on the boundary process; final proof must be run after the `13:55:22 MDT` build is loaded.
  - Current cache-only state route still returns rows but can be slow (`19.4s` in the latest sample), so route latency remains a separate live pressure issue to monitor.
- Required post-restart proof:
  - Restart only through Replit's default Run Replit App entry.
  - Confirm API PID start time is after `2026-06-03 13:55:22 MDT`.
  - Watch `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state?view=summary&cacheMode=cache-only` and the visible STA table.
  - Expected: `signalCount` remains nonzero through cache-only stream snapshots; UUUU/source rows hydrate from `pyrus-signals`; new current-bar signals emit within seconds of WebSocket aggregate close; stream-triggered Signal Monitor evaluation should not create 5m Massive REST aggregate calls for those symbols.

## 2026-06-03 Flow Scanner Aggregate Timestamp And Line-Usage Audit

- User reported flow scanner lane pills still showing repeated same-ticker runs and asked whether aggregate scanner events are mapped to occurrence time rather than discovery time.
- Root causes found:
  - Pyrus broad flow scanner lane had already been changed to sort pills by event recency, but backend aggregate/background scanner events still usually derived `occurredAt` from quote `dataUpdatedAt`/`updatedAt`.
  - Background aggregate scans use `phase: "seed"` / `phase: "expanded"`, and the old code only hydrated historical option bars for `phase: "manual"`.
  - Historical candidate selection ran the rotating contract selector independently from live candidate selection, so even when historical bars were enabled they could attach to a different contract subset than the rows that published.
- Fix implemented:
  - `artifacts/api-server/src/services/platform.ts`
    - Added local `FlowScannerContract` / `FlowScannerContracts` metadata with optional `flowOccurredAt`.
    - Historical option-bar hydration now stamps `flowOccurredAt` and live quote hydration preserves it.
    - Background/manual scanner paths hydrate a bounded historical subset; historical hydration errors remain user-visible only on manual scans, while background scans fall back silently.
    - Historical candidates are now sliced from the already selected live candidates instead of rerunning the rotating selector over all metadata contracts.
    - Candidate event construction now prefers `flowOccurredAt` before quote/data update timestamps.
  - `artifacts/api-server/src/services/options-flow-scanner.test.ts`
    - Added aggregate regression: seed scanner snapshot with live quote time `14:35` and historical option-bar time `14:31` must publish aggregate `occurredAt = 14:31`.
    - Updated background scanner quote test to assert historical bars are sampled for selected live contracts.
- Live line-usage evidence after restart:
  - `/api/settings/ibkr-line-usage?detail=full` returned `flowScannerLineCount = 154`, `activeScanPhase = "expanded"`, `seedLineBudget = 24`, `expandedLineBudget = 24`.
  - Full lease parsing showed 154 flow-scanner leases across 7 symbols: `AAOI`, `AAPL`, `ALAB`, `DIA`, `SPY`, `COIN`, `AMZN`, with `22` option-contract lines each.
  - Conclusion: current scanner allocation is not one line per ticker. It is one line per selected option contract, capped by a per-ticker contract budget. A true one-line-per-ticker model remains a separate allocation/concurrency redesign; simply setting per-ticker line budget to `1` would recreate the prior 8-10 line underfill because scanner concurrency is capped at 8.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/options-flow-scanner.test.ts` - 85/85.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus exec node --test src/features/platform/marketFlowScannerConfig.test.js` - 12/12.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js` - 65/65.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: scoped `git diff --check`.

## 2026-06-03 Realtime Massive Quote No-REST Tightening

- User reported slow spot prices around the app and asked whether all Massive ingestion is WebSocket-backed rather than REST.
- Answer from source/runtime audit:
  - Not all Massive ingestion can or should be WebSocket-only. Historical bars, backfills, option-chain snapshots, option trade/quote research, logos, and ticker search still use Massive REST where historical/snapshot APIs are the correct tool.
  - Live stock quotes/trades/minute aggregates should be WebSocket-backed. Runtime after restart shows Massive WebSocket `AM`, `Q`, and `T` active against `socket.massive.com`, `92` subscribed symbols, `5` active consumers, and last message age about `22ms` in the sample.
  - Recent Massive REST requests still exist, but the sample families were `stock_aggregates` bars for chart/signal/history work, not live quote snapshots.
- Fix implemented:
  - `artifacts/api-server/src/services/platform.ts`: realtime Massive `getQuoteSnapshots()` no longer calls `getMassiveClient().getQuoteSnapshots()` to fill missing day-change fields. It returns only Massive stock Q/T socket cache plus stock aggregate socket cache.
  - `artifacts/api-server/src/services/platform-quote-snapshot.test.ts`: updated regressions so realtime Massive quote snapshots assert `massiveCalls === 0` and `bridgeCalls === 0`; socket prices and aggregate-cache prices are preserved without REST fallback.
  - `artifacts/pyrus/src/features/charting/useMassiveStockAggregateStream.ts`: frontend live aggregate type now includes `source: "massive-websocket"`.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/platform-quote-snapshot.test.ts` - 7/7.
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts src/services/signal-options-worker.test.ts src/services/signal-options-automation.test.ts src/services/automation.test.ts src/services/platform-quote-snapshot.test.ts` - 242/242.
  - PASS: `pnpm --filter @workspace/api-server typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus typecheck`.
  - PASS: `pnpm --filter @workspace/api-server build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 14:01:17 MDT`.
  - PASS: scoped `git diff --check`.
- Live proof after Replit default Run Replit App restart:
  - Replit workflow restarted at `2026-06-03 14:01:55 MDT`; API PID `25990` started after the `14:01:17 MDT` build, so the no-REST quote fix is loaded.
  - `/api/quotes/snapshot?symbols=SPY,QQQ,UUUU,AMZN` returned `count: 4`, `fallbackUsed: false`, `delayed: false`, `source: "massive"` for all rows.
  - SPY/QQQ/AMZN had sub-second `ageMs` (`190ms`, `171ms`, `119ms` in the sample). UUUU was about `204s` old, consistent with no recent post-close tick and aggregate-cache fallback rather than a REST wait.
  - Diagnostics immediately after restart were healthy (`api p95: 16ms`, `eventLoopP95: 46ms`), then degraded under signal-monitor/bars pressure (`api p95: 4585ms`) while WebSocket provider health remained OK.
- STA live status after restart:
  - Cache-only state route returned `200` and `11` signal rows from `pyrus-signals`; no 0-row cache-only fallback reproduced.
  - Rows were marked `fresh: true` in the sample, with examples including SPY, ROK, AVGO, SMCI, CRWV, AMZN, VXX, TDY, VIXY, USO, UUP.
  - Cockpit cache-only returned `503 signal_options_cockpit_cache_unavailable` under high pressure because no warmed cockpit payload existed after restart. This is a remaining cache-warm/pressure issue, separate from Massive live quote source selection.
- Remaining risk:
  - Route pressure still makes spot updates and STA surfaces feel slow even when the provider WebSocket is fresh. Slow routes after restart included signal-monitor events/profile/state/matrix and `/bars`.
  - The strict no-REST contract is now true for realtime Massive stock quote snapshots, but not for historical/chart/backfill/option research lanes.

## 2026-06-03 Flow Scanner One-Line-Per-Ticker Allocation

- User asked to implement the reviewed plan for scanner line use: one active option quote line per ticker, broad ticker-slot coverage, bounded metadata workers, and app-wide IBKR lane respect.
- Fix implemented:
  - `artifacts/api-server/src/services/market-data-admission.ts`
    - Added flow-scanner per-underlying exclusivity: a new `flow-scanner-live` option lease for a ticker demotes the previous active scanner option lease for that ticker before budget checks.
    - Added `flowScannerTickerSlots` diagnostics with active ticker-slot count, per-ticker contract limit, active underlying sample, and duplicate-underlying count/sample.
  - `artifacts/api-server/src/services/platform.ts`
    - Runtime defaults now use one live contract line per ticker (`seedLineBudget = expandedLineBudget = radarDeepLineBudget = 1`).
    - Scanner/radar batch defaults now target the 200-line scanner pool, while metadata worker concurrency remains capped at 8.
    - Deep queue capacity is ticker-slot capacity, not worker concurrency, so 50-200 tickers can be queued while only bounded workers run.
    - Scanner diagnostics now expose target/active/eligible ticker slots, ticker-slot shortfall, shortfall reason, per-ticker limit, and duplicate-underlying count.
  - `artifacts/api-server/src/services/ibkr-lanes.ts`
    - Runtime setting bounds now allow scanner/radar batch and promotion counts up to 500 while keeping scanner concurrency capped at 8.
  - Tests updated so pool-fill fixtures use many ticker underlyings, while same-underlying fixtures assert rotation/exclusivity.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/market-data-admission.test.ts` - 41/41.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/options-flow-scanner.test.ts` - 86/86.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/flow-universe-planner.test.ts` - 10/10.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/ibkr-lane-policy.test.ts src/services/ibkr-line-usage.test.ts` - 27/27.
  - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/watchlist-prewarm.test.ts` - 21/21.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js src/features/platform/marketFlowScannerConfig.test.js` - 77/77.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: scoped `git diff --check`.
- Runtime note:
  - No Replit startup config, artifact startup command, `.replit`, or environment control-plane changes were made.

## 2026-06-03 STA Signal Time, Sparkline, And Source-Churn Fix

- Implemented regression fixes for the live STA symptoms:
  - Signal Monitor stored state now restores precise event `signalAt` from `signal_monitor_events.event_key` candidates instead of treating a completed 5m bar close as the display time.
  - Signal Options stored-state fast path now uses the same Signal Monitor event-key lookup and no longer carries a local duplicate key builder.
  - Runtime market-data sync now treats omitted/undersized sparkline bars as "no update" instead of clearing existing STA `sparkBars`.
  - Signal Monitor matrix persistence now skips the active profile timeframe so stale matrix/current-bar hydration cannot overwrite the primary state row consumed by Signal Options.
- Live audit findings:
  - The observed "ROKU" row was `ROK`; the paper deployment includes `ROK` and does not include `ROKU`.
  - `ROK` had a real 5m buy event at `2026-06-03T23:07:27.563Z`, but its active 5m state row was later overwritten to `status=stale`, `current_signal_at=NULL`, `latest_bar_at=2026-06-03T20:35:00Z` at `23:08:39.715Z`. That is why it popped out of STA.
  - The same source-churn pattern appeared for `BAH`; fresh/cached Signal Options snapshots could briefly show a row, then the shared stored state row could be nulled by stale matrix persistence.
  - `/signal-monitor/events` had 243 paper events for `2026-06-03`, but STA currently paginates Signal Options' current visible signal snapshots, not the full same-day event log. Showing every same-day signal needs an intentional event-backed STA row source.
- Data map updated:
  - Added rules for signal event timing, STA sparkline ownership, active-timeframe matrix persistence, empty Move diagnosis, and current-vs-all-day STA pagination.
- Validation:
  - PASS: `node --import tsx --test src/services/signal-monitor.test.ts src/services/signal-options-automation.test.ts` from `artifacts/api-server` - 210/210.
  - PASS: `node --import tsx --test src/features/platform/runtimeMarketDataModel.test.js src/screens/algo/OperationsSignalRow.test.js src/screens/algo/algoHelpers.test.js src/features/platform/signalMatrixScheduler.test.js` from `artifacts/pyrus` - 99/99.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: scoped `git diff --check`.
  - Post-restart live check at `2026-06-03T20:49Z` showed the one-line-per-ticker model was loaded: `perTickerLiveContractLimit: 1`, ticker target around `187-188`, `duplicateActiveUnderlyingCount: 0`, and radar scanning broad batches around `187-188` symbols.
  - That check also exposed a remaining underfill in `options-flow-radar-scanner.ts`: radar only used fallback promotions when there were zero hot promotions, so a small hot set still produced only 3-4 deep scanner symbols.
  - Follow-up fix in `artifacts/api-server/src/services/options-flow-radar-scanner.ts`: fallback candidates now top off remaining promotion capacity after hot promotions instead of only running when the hot list is empty.
  - Follow-up validation:
    - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/options-flow-scanner.test.ts` - 87/87, including the new hot-plus-fallback top-off regression.
    - PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/market-data-admission.test.ts src/services/flow-universe-planner.test.ts src/services/ibkr-lane-policy.test.ts src/services/ibkr-line-usage.test.ts` - 78/78.
    - PASS: `pnpm --filter @workspace/api-server run typecheck`.
    - PASS: `pnpm --filter @workspace/api-server run build`; rebuilt `artifacts/api-server/dist/index.mjs` at `2026-06-03 14:50:57 MDT`.
    - PASS: scoped `git diff --check`.
  - Runtime caveat after the follow-up fix: the running API process had loaded the pre-top-off bundle, so live diagnostics still showed radar scanned `187-188` symbols but promoted only `3`. A normal Replit default Run restart is required to load the rebuilt bundle.
  - After-hours caveat: live scanner quote lines were `0` because `bridge-option-quote-stream` intentionally blocks `flow-scanner-live` admissions outside NYSE RTH. Recent admission events showed `action: "fallback"`, `owner: "flow-scanner:AAOI"`, `reason: "market_session_quiet"`. During RTH, expected behavior remains active scanner line count ramping toward `min(scannerSchedulableLineCap, eligibleOptionableTickerCount)` with zero duplicate scanner underlyings.

## 2026-06-03 STA Visible Row Hydration Fix

- User symptoms treated as one STA cluster:
  - GLW/SYM showing 5m increments.
  - Not all STA signal bubbles hydrating.
  - Not all STA sparklines hydrating.
  - Move column mostly empty.
  - SPY was the only fully hydrated row, then SPY appeared/disappeared.
- Investigation evidence:
  - `/api/bars?symbol=NRG&timeframe=1m...` with the table's old `algo-signal-sparkline` background-style request returned `429`, `X-Pyrus-Route-Class: deferred-analytics`, `X-Pyrus-Pressure-Level: high`, `X-Pyrus-Admission-Reason: api-resource-pressure-high`.
  - The same bars request with active STA headers returned `200`, `X-Pyrus-Route-Class: active-screen`, `X-Pyrus-Admission-Action: allow`.
  - `/api/quotes/snapshot` could return current visible-row quotes, so blank Move was a frontend hydration gate/admission issue, not missing quote capability.
  - `OperationsSignalTable` only ran quote/sparkline fallbacks when `backgroundQueriesEnabled` was true; `AlgoScreen` sets that false when the cockpit stream is fresh. That made visible STA rows rely on incidental runtime snapshots from elsewhere.
  - STA bubbles use the separate signal-matrix scheduler. The table does request the visible page immediately, but under high pressure the active-screen exact-cell cap is `20` cells per request, so a 20-row page with six timeframes hydrates progressively across multiple scheduler passes.
- Fix implemented:
  - `artifacts/pyrus/src/screens/AlgoScreen.jsx`: added `algoVisibleRowHydrationQueriesEnabled` independent of derived/background polling and passed it into the Algo live page.
  - `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`: threaded `rowHydrationQueriesEnabled` into `OperationsSignalTable`.
  - `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`: quote/sparkline row fallbacks now use the visible row gate and active request headers (`algo-signal-table`, `algo-signal-sparkline`) instead of the deferred background path.
  - `artifacts/pyrus/src/screens/algo/OperationsSignalRow.test.js` and `artifacts/pyrus/src/features/platform/platformRootSource.test.js`: source-contract tests now assert the dedicated visible-row gate and active request options.
- SPY/source-churn finding:
  - Recent signal-monitor events did include SPY 5m buy events, but Signal Options cockpit/state endpoints were timing out or shed under high pressure during the probe, and the last successful cockpit summary did not include SPY.
  - `buildVisibleSignalRows` already merges Signal Options signal rows with candidate fallbacks; the disappearance occurs before that, when the selected source array changes. No monitor-event-to-STA merge was implemented because that is a product semantics change.
  - Matrix bubble incompleteness remains a pressure/cap tradeoff unless we intentionally raise the active-screen exact-cell cap or add a dedicated visible-page matrix lane.
- Validation:
  - PASS: `node --import tsx --test src/screens/algo/OperationsSignalRow.test.js src/features/platform/platformRootSource.test.js` from `artifacts/pyrus` - 91/91.
  - PASS: `node --import tsx --test src/screens/algo/algoHelpers.test.js` from `artifacts/pyrus` - 36/36.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: scoped `git diff --check`.
  - PASS: `docs/backend-data-map.md` fence check (`8` fences, `4` Mermaid blocks, even fence count).
- Runtime note:
  - No Replit startup config, artifact startup command, `.replit`, or environment control-plane changes were made.

## 2026-06-03 STA Same-Day Signal History Fix

- User challenged the previous conclusion that full-day STA rows required a future event-backed source. Live proof showed that same-day signal data already existed:
  - `/api/signal-monitor/events?environment=paper&limit=500` returned `500` events, including `245` events dated `2026-06-03` in the sample.
  - `/api/algo/deployments/7e2e4e6f-749f-4e65-a011-87d3559a23b0/signal-options/state?view=summary` returned only the current action snapshot set (`10` signals in the sample).
- Root cause:
  - `Signal Options` intentionally collapses to current/fresh monitor states for actionability.
  - `AlgoScreen` fed `OperationsSignalTable` only `buildVisibleSignalRows({ signals: signalOptionsSignals, candidates: signalOptionsCandidates })`.
  - `PlatformApp` already fetched `signalMonitorEvents`, but `PlatformScreenRouter` did not pass them to `AlgoScreen`, and `buildVisibleSignalRows` ignored event history.
- Fix implemented:
  - `artifacts/pyrus/src/screens/algo/algoHelpers.js`
    - Added `buildStaSignalHistoryRows`.
    - Converts same-day `signalMonitorEvents` into STA row-shaped, non-actionable history rows.
    - Uses the New York market date (`America/New_York`) instead of UTC for "same day".
    - Uses the backend-compatible signal key `profileId:symbol:timeframe:direction:signalAt` so current action rows dedupe/overlay matching event rows.
    - Keeps older same-day events visible even when the current Signal Options row ages out.
  - `artifacts/pyrus/src/features/platform/PlatformScreenRouter.jsx`
    - Passes `signalMonitorEvents` and `signalMonitorEventsLoaded` into `MemoAlgoScreen`.
  - `artifacts/pyrus/src/screens/AlgoScreen.jsx`
    - Merges loaded `signalMonitorEvents` into `visibleSignalRows` with `focusedDeployment.symbolUniverse` as the STA universe filter.
  - `docs/backend-data-map.md`
    - Updated STA ownership from "current visible snapshots only / future gap" to "same-day Signal Monitor event history plus current Signal Options action overlay".
    - Documented the then-remaining scale caveat: existing event endpoint capped at 500 rows. Superseded by the `17:57` cursor-pagination section below.
- Validation so far:
  - PASS: `node --import tsx --test src/screens/algo/algoHelpers.test.js` from `artifacts/pyrus` - 40/40.
  - PASS: `node --import tsx --test src/screens/algo/algoHelpers.test.js src/features/platform/platformRootSource.test.js src/screens/algo/OperationsSignalRow.test.js` from `artifacts/pyrus` - 132/132.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: scoped `git diff --check`.
  - PASS: backend data map fence check (`28` fences, `13` Mermaid blocks, even fence count).
  - PASS: focused expanded Pyrus bundle: `node --import tsx --test src/screens/algo/algoHelpers.test.js src/screens/algo/OperationsSignalRow.test.js src/features/platform/platformRootSource.test.js src/features/platform/runtimeMarketDataModel.test.js src/features/platform/signalMatrixScheduler.test.js` - 169/169.
  - PASS: live payload sanity through `buildVisibleSignalRows`: event endpoint returned `500`, Signal Options state returned `8` current signals, merged rows returned `239` (`231` history + `8` current) for `2026-06-03T23:35:00Z`.
  - PASS: safe-mode browser check at `http://127.0.0.1:18747/?pyrusQa=safe`: Algo STA table rendered `All 237 of 237 signals`, pagination `Rows 1-20 of 237`, and no page/console errors after hot reload.
- Superseded caveat:
  - This section originally recorded the `500`-row event endpoint cap as remaining work. The `2026-06-03 STA Event Pagination and Source Filters` section below replaces that caveat with the implemented cursor-paged contract.

## 2026-06-03 Radar-Style UI Icon Cleanup

- User reported radar-looking icons still visible in the IBKR connection area after the earlier radar scanner cleanup.
- Root cause:
  - The earlier cleanup removed literal `radar` strings and the old scanner/radar code path, but active UI still used lucide `RadioTower` under non-radar names.
  - `HeaderStatusCluster.jsx` mapped the IBKR gateway tile key `radioTower`, WebSocket provider icon, and operation-step fallback to `RadioTower`.
- Fix implemented:
  - IBKR connection/header:
    - `HeaderStatusCluster.jsx`: removed `RadioTower` import, changed gateway tile rendering to `MonitorUp`, WebSocket provider rendering to `Network`, and unknown operation-step fallback to `Activity`.
    - `ibkrPopoverModel.js`: changed the Gateway tile `iconKey` from `radioTower` to `gateway`.
    - `IbkrConnectionStatus.jsx`: replaced quiet/standby/default `RadioTower` status glyphs with `Activity`, `CircleOff`, or `PlugZap`.
  - Active non-IBKR UI:
    - Replaced Algo route/monitor/toast/notification/pulse/deploy `RadioTower` glyphs with `Bot`.
    - Replaced active scanner status `RadioTower` with `RefreshCw`.
    - Replaced Algo halt `positionMarkFeed` `RadioTower` with `Activity`.
  - Added `platformRootSource.test.js` guards:
    - IBKR connection header must not contain `RadioTower`/`radioTower` or emit the old gateway `iconKey: "radioTower"`.
    - Active non-test Pyrus source must not import `RadioTower`.
- Validation:
  - PASS: `rg -n "\bRadioTower\b|\bradioTower\b" artifacts/pyrus/src ...` now only finds the source guard itself.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js` - 67/67.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: scoped `git diff --check`.
- Runtime note:
  - No Replit startup config, artifact startup command, `.replit`, environment variables, or Replit control-plane operations were touched.

## 2026-06-03 Post-Restart Radar Icon Check

- Restart validation at `2026-06-03T23:38:00Z`:
  - Frontend served at `http://127.0.0.1:18747/?pyrusQa=safe`.
  - `/api/healthz` returned `{"status":"ok"}`.
  - `/api/readiness` returned `appReadiness.status: "ready"`.
  - Readiness diagnostics remain warning because of latency/browser samples; broker trading is blocked by after-hours `market_session_quiet`.
  - Served runtime source for `HeaderStatusCluster.jsx`, `IbkrConnectionStatus.jsx`, `AppHeader.jsx`, and `PlatformShell.jsx` returned HTTP `200` and no `RadioTower`/`radioTower` matches.
  - Safe Playwright check mounted the app, found the IBKR connection trigger, opened the IBKR dialog, saw `radarTextCount: 0`, and recorded no console warnings/errors or page errors.
  - Focused guard suite still passes: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js` - 67/67.

## 2026-06-03 Massive SkillsMP API Handling Pass

- User provided `https://skillsmp.com/skills/massive-com-codex-plugin-plugins-massive-skills-debug-skill-md` after asking to search SkillsMP for Massive-related skills that could improve the platform Massive API connection.
- Skills installed:
  - Third-party `foreztgump/massive-skill` installed as `~/.codex/skills/massive`.
  - Massive-owned `massive-debug`, `massive-discover`, `massive-options`, and `massive-dashboard` installed from `massive-com/codex-plugin`.
  - Restart Codex to load these installed skills as active skills.
- Guidance applied:
  - Massive debug guidance distinguishes 401 auth, 403 entitlement/plan, 404 ticker or endpoint shape, 429 rate limit, and empty options results/date-window issues.
  - Official Massive docs confirmed REST auth supports `apiKey` query params and `Authorization: Bearer`; stock full-market snapshots are a batch endpoint; option-chain snapshots support `expiration_date` filters, `contract_type`, `order`, `sort`, and `limit`; Options Basic is rate-limited while Starter/Developer/Advanced unlock snapshots/trades/quotes/Greeks by tier.
- Backend fix in `artifacts/api-server/src/providers/massive/market-data.ts`:
  - REST diagnostics now read `HttpError.statusCode` instead of looking only for `error.status`.
  - Added `MassiveRestFailureKind`: `auth`, `entitlement`, `rate_limit`, `not_found`, `invalid_request`, `network`, `upstream`, `unknown`.
  - `MassiveRestActivity` now includes `errorKind` and `diagnosticHint`, while continuing to redact API keys.
  - Fixed diagnostics timestamp parsing for Massive nanosecond trade query params by routing numeric timestamps through the existing `toDate` scaler. Before this, `new Date(<nanoseconds>).toISOString()` could throw and silently drop historical option trade hydration.
- Frontend/runtime fix in `artifacts/pyrus/src/features/platform/runtimeControlModel.js`:
  - Massive REST normalization now exposes `lastHttpStatus`, `lastErrorKind`, and `lastDiagnosticHint`.
  - Failed REST summaries render actionable categories, for example `option chain snapshot SPY · entitlement (403)`.
- Tests added:
  - `artifacts/api-server/src/providers/massive/market-data.test.ts`: provider HTTP failures classify as degraded, preserve `httpStatus: 403`, set `errorKind: entitlement`, and avoid leaking API keys.
  - `artifacts/pyrus/src/features/platform/runtimeControlModel.test.js`: runtime snapshot preserves and renders the Massive REST failure category.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/providers/massive/market-data.test.ts` - 23/23.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/runtimeControlModel.test.js` - 42/42.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
- Worktree note:
  - `runtimeControlModel.js` and `runtimeControlModel.test.js` already had unrelated scanner wording/coverage edits in the dirty worktree. Do not revert those while handling the Massive diagnostics changes.

## 2026-06-03 API Diagnosis Implementation Slice

- Started implementation at `2026-06-03T23:45:19Z`.
- Scope:
  - Remove the artificial unknown-pressure-to-high fallback from the signal matrix foreground admission path.
  - Keep real high pressure protected with explicit caps instead of silent 5-minute-style throttling.
  - Refresh hydrated signal matrix cells at the next candle close plus a small grace window, not after a 2x timeframe stale window.
  - Wire matrix evaluations through the existing live-edge/no-REST bar path so STA pickup uses warmed WebSocket aggregate state first and preserves stored states if cache history is not warm.
  - Update `docs/backend-data-map.md` with the final backend rules once code and tests settle.
- Dirty-worktree rule remains in force: many unrelated files are already modified; do not revert them while handling this slice.

## 2026-06-03 STA Event Pagination and Source Filters

- Implemented the follow-up to remove the `500` total-history cap from Signal Monitor events:
  - `/signal-monitor/events` now accepts `from`, `to`, `cursor`, and page-size `limit`.
  - Response now includes `nextCursor` and `hasMore`.
  - DB ordering is stable on `signalAt desc, id desc`; cursor pagination uses both fields to avoid duplicate/skipped rows when signals share a timestamp.
  - Runtime fallback uses the same filter/page helper and retains `20_000` recent runtime events instead of `500`.
  - OpenAPI and generated zod/react client outputs were regenerated.
- STA frontend changes:
  - `PlatformApp` now fetches Signal Monitor events through a generated-request `useQuery` wrapper that follows every `nextCursor` for a rolling 36-hour window.
  - Invalidation now targets the base Signal Monitor event query key instead of the old `{ limit: 500 }` key.
  - `OperationsSignalTable` adds `Current` and `History` filters; historical rows are identified by `signal.sourceType === "signal_monitor_event"`.
  - Added `artifacts/pyrus/scripts/qaStaSignalHistory.mjs` and package script `qa:sta-history` for safe browser regression checks against an already-running app.
- Backend data map updated:
  - `/signal-monitor/events` is documented as cursor-paged.
  - STA same-day signal visibility rule now says clients must follow `nextCursor` until `hasMore` is false.
  - Added the Signal Monitor event-history contract note: `signalAt`, not `emittedAt`, defines the day window.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test --test-name-pattern "signal monitor event" src/services/signal-monitor.test.ts` - 5/5.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/algo/OperationsSignalRow.test.js src/features/platform/platformRootSource.test.js src/screens/algo/algoHelpers.test.js` - 135/135.
  - PASS: `pnpm --filter @workspace/pyrus run typecheck`.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: `pnpm --filter @workspace/pyrus run qa:sta-history` against `http://127.0.0.1:18747/?pyrusQa=safe`: API same-day events `243`, STA visible total `244`, pagination `Rows 1-20 of 244`.
  - PASS: scoped `git diff --check`.
  - PASS: backend data-map fence check (`28` fences, `13` Mermaid blocks, even fence count).
  - BLOCKED by hot-runtime guard: `pnpm run audit:api-codegen` regenerated generated outputs but failed when `pnpm -w run typecheck:libs` refused to run because the live PYRUS/Replit runtime is hot. Targeted package typechecks passed without forcing `PYRUS_ALLOW_HOT_VALIDATION=1`.
- Runtime/config note:
  - No Replit startup config, artifact startup command, `.replit`, environment variables, or Replit control-plane operations were touched.
  - The worktree had pre-existing staged/dirty changes in several touched files; do not revert or unstage unrelated changes without explicit instruction.

## 2026-06-03 STA History Backoff and Action Cockpit Batch Copy

- User reported Action Cockpit text: `Signals · All 249/249 · Signal 10m · Bar 11m · worker waiting 5s; last batch 0/90 symbols · Massive Primary · Action Cockpit`.
- Root cause:
  - The `batch` wording was an internal Signal Options worker monitor-refresh counter leaking into Action Cockpit copy.
  - `lastBatchSize: 0` with `lastBatchUniverseCount: 90` did not mean STA had zero signals or that the table was capped; it meant that worker pass evaluated zero monitor-refresh symbols while stored/current signal state was already available.
  - The table symptom still mattered because the same debug pass found a transient Signal Monitor DB fallback/backoff window where event history could appear empty.
- Fix implemented:
  - `artifacts/api-server/src/services/signal-options-automation.ts` no longer renders zero-size monitor refreshes as `last batch 0/N symbols`.
  - Zero-size refresh/current-state path now renders `signal state current`.
  - Non-empty worker refresh progress renders `last refresh N/N symbols`, preserving operator useful progress without exposing `batch` terminology.
  - Diagnostic fields `lastBatchSize` and `lastBatchUniverseCount` remain in the backend payload for debugging.
- Tests added in `artifacts/api-server/src/services/signal-options-automation.test.ts`:
  - Zero-size current-state cockpit stage asserts `worker waiting 5s; signal state current` and no `batch` or `0/90` user-facing copy.
  - Non-empty monitor refresh asserts `worker waiting 5s; last refresh 12/90 symbols` and no `batch` wording.
- STA history QA guard fixed:
  - `artifacts/pyrus/scripts/qaStaSignalHistory.mjs` now waits for visible STA history to hydrate instead of checking before the visible total settles.
  - The guard now reports `waitedMs` and fails only after the expected same-day event count should have appeared.
- Runtime finding:
  - During the audit, `/signal-monitor/events` briefly returned empty because Signal Monitor was in runtime fallback profile `runtime-fallback-paper` with `Postgres is unavailable; using runtime-only signal monitor evaluation.`
  - After the DB backoff cleared, storage health returned OK, the real paper profile returned, `/signal-monitor/events` returned `515` rows for the 36-hour sample window, and the STA history guard passed with API same-day events `248` and visible STA total `249`.
  - This means empty STA history during fallback is a real operational signal to sample profile/state/storage health, not a clean no-data state.
- Backend data map updated:
  - Added Signal Monitor persistence/fallback rules.
  - Added the Action Cockpit worker status-copy rule.
  - Added bug-hunting rows for same-day history disappearing and `last batch 0/N symbols` copy.
- Validation:
  - PASS: `node --check artifacts/pyrus/scripts/qaStaSignalHistory.mjs`.
  - PASS: `pnpm --filter @workspace/pyrus run qa:sta-history` after recovery: API same-day events `248`, visible total `249`, rendered rows `20`, pagination `Rows 1-20 of 249`.
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts` - 140/140.
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-options-worker.test.ts src/services/signal-options-automation.test.ts src/services/signal-monitor.test.ts` - 244/244.
  - PASS: `pnpm --filter @workspace/api-server run typecheck`.
  - PASS: scoped `git diff --check`.
  - PASS: backend data-map fence check (`28` fences, `13` Mermaid blocks, even fence count).
- Runtime/config note:
  - The running API process predates this source/dist fix, so the live endpoint can still show old `last batch` copy until a normal Replit Run App reload.
  - No supervisor process was killed and no Replit startup/control-plane configuration was touched.

## 2026-06-03 Signal Matrix Stream-First Fresh Signal Fix

- Continued the larger 6-3 API diagnosis list around `/bars`, pressure, and STA pickup.
- Live runtime evidence at `2026-06-04T00:15-00:16Z`:
  - API pressure was `high` because route latency was high, not because API memory was high. Slow routes included `/accounts/shadow/positions`, `/signal-monitor/state`, and `/bars`.
  - Browser diagnostics showed `/api/bars` as a visible hot spot: `87` timings in 5m, p95 about `34s`, `27` errors.
  - STA-marked `/api/bars` with `x-pyrus-request-family: algo-signal-sparkline` and priority `8` returned `200`, `active-screen`, `allow`; background `sparkline` priority `-2` returned `429`, `deferred-analytics`, `api-resource-pressure-high`.
  - Bars hydration counters showed heavy `signal-matrix` use of the shared bar hydration lane, while Massive aggregate WebSocket was configured and subscribed.
- Root cause:
  - `evaluateSignalMonitorMatrixSymbol()` had `evaluateSignalMonitorMatrixStateFromStreamBars()`, but the normal matrix path still waited on `loadSignalMonitorCompletedBars()` first.
  - Stream-only matrix evaluation was used only after a 12s bar-load timeout, or through the warm-cache merge in `loadSignalMonitorCompletedBars()`.
  - After a restart or under pressure, cache history can be cold, so a just-closed Massive aggregate WebSocket signal could be delayed or dropped to stored-state fallback instead of winning immediately.
- Fix:
  - `artifacts/api-server/src/services/signal-monitor.ts` now evaluates live-edge Massive aggregate WebSocket/cache bars before history loading when matrix calls request provisional live edge.
  - A new `isFreshSignalMonitorMatrixStreamState()` guard short-circuits only for fresh `buy`/`sell` stream states.
  - Non-signal or stale stream states continue into the existing no-REST/stored-state path, so older context is not erased by a short stream window.
  - Timeout fallback reuses the already-computed stream state instead of recomputing it.
  - `docs/backend-data-map.md` now documents the exact invariant: fresh stream buy/sell wins before history; stale/no-signal stream output must not wipe stored context.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-monitor.test.ts` - 78/78.
  - PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js src/features/platform/signalMatrixScheduler.test.js src/screens/algo/OperationsSignalRow.test.js` - 127/127.
  - PASS: `pnpm --filter @workspace/api-server exec tsc --noEmit --pretty false`.
- Restart/runtime note:
  - The running API process will need the normal Replit Run App reload before live STA proof reflects this stream-first backend change.
  - No Replit startup config, artifact startup command, `.replit`, environment variables, or control-plane operations were touched.

## 2026-06-03 `/bars` Stale Refresh Pressure Gate

- Continued the larger 6-3 API diagnosis list after stream-first STA pickup, focusing on why `/bars` still showed high p95 and high provider fetch pressure.
- Runtime evidence from the prior sample:
  - `/api/bars` browser diagnostics showed p95 around `34s` and `27` errors.
  - `barsHydrationCounters` showed high `backgroundRefresh` and `providerFetch`.
  - STA-marked `/bars` requests with active priority were admitted under high pressure, while background sparkline requests were correctly shed by route admission.
- Root cause:
  - Route admission was not the remaining issue for visible STA `/bars` calls.
  - Stale `/bars` cache hits returned immediately, but still scheduled background refresh work whenever chart hydration background refresh was enabled.
  - Under route-latency pressure this created a feedback loop: stale cache protected the response path, while hidden refreshes still competed for provider/bridge work.
- Fix:
  - `artifacts/api-server/src/services/platform.ts` now gates stale-hit background refresh by API pressure.
  - Normal/watch pressure keeps the previous background refresh behavior.
  - High pressure only allows stale-hit background refresh for active-priority requests (`priority >= 8`), preserving visible chart/STA refresh while suppressing low-priority fanout.
  - Critical pressure suppresses stale-hit background refresh entirely.
  - Added `backgroundRefreshPressureSkipped` to bars hydration counters.
  - `docs/backend-data-map.md` now documents `/bars` as a chart/backtest/historical surface and the stale refresh pressure invariant.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test --test-name-pattern "suppresses stale background refresh|refresh policy|marks stale cached" src/services/option-chain-batch.test.ts` - 3/3.
  - PASS: `pnpm --filter @workspace/api-server exec tsc --noEmit --pretty false`.
  - Note: a mis-scoped broader `option-chain-batch.test.ts` run executed unrelated tests and still failed 5 existing cases outside this slice; the new high-pressure stale-refresh tests passed in that broader run.
- Restart/runtime note:
  - The running API process will need a normal Replit Run App reload before live diagnostics include this pressure gate.
  - No Replit startup config, artifact startup command, `.replit`, environment variables, or control-plane operations were touched.

## 2026-06-03 Shadow Positions Filter Cache Reuse

- Continued the larger API pressure list after the `/bars` stale-refresh gate.
- Runtime evidence:
  - New diagnostics at `2026-06-04T00:33Z` showed `/accounts/shadow/positions` remained the dominant route-latency pressure driver, p95 about `16s`.
  - `/bars` counters already showed the stale-refresh gate active in the running process: `backgroundRefreshPressureSkipped` was nonzero and server `/bars` p95 had fallen to about `3.1s`.
  - Direct probes showed shadow all-positions/no-live-quotes serving in about `2.25s`, while a cold `assetClass=Options&liveQuotes=false` key still took about `9.5s`.
- Root cause:
  - `getShadowAccountPositions()` built separate read-cache keys for `all`, `Options`, and `Stocks`.
  - The frontend can request filtered views, so an `Options` key could rebuild the shadow ledger and position enrichment path even when the equivalent all-positions response for the same source/live-quote mode was already cached.
- Fix:
  - `artifacts/api-server/src/services/shadow-account.ts` now reuses all-positions cache for filtered shadow position reads.
  - Fresh all-cache can satisfy filtered `Stocks`/`Options` reads immediately and reweights totals for the filtered rows.
  - Stale all-cache can satisfy filtered reads only under high/critical API pressure, preserving stale/degraded flags; normal pressure still attempts a fresh filtered read.
  - `docs/backend-data-map.md` now documents filtered shadow positions as views over the all-positions ledger response.
- Validation:
  - PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test --test-name-pattern "shadow filtered positions|shadow read cache|shadow account positions route" src/services/shadow-account.test.ts src/services/account-positions.test.ts` - 7/7.
  - PASS: `pnpm --filter @workspace/api-server exec tsc --noEmit --pretty false`.
- Runtime/config note:
  - A direct post-change endpoint probe still returned in about `3.25s` on the running app, likely due to current cache/process contention; source-level tests and typecheck are the proof for this slice.
  - No Replit startup config, artifact startup command, `.replit`, environment variables, or control-plane operations were touched.
