# Current Session Handoff

This is a pointer to the active durable handoff. Do not use this file as the full session narrative.

- Last Updated (MT): `2026-06-03 18:42:19 MDT`
- Last Updated (UTC): `2026-06-04T00:42:19Z`
- Native Codex Session ID: `pending`
- Summary: 2026-06-03 18:42:19 MDT | pending | Reused shadow all-positions cache for filtered position views to reduce account route pressure
- Handoff: `SESSION_HANDOFF_LIVE_2026-06-03_signals-table-matrix-audit.md`
- Master Index: `SESSION_HANDOFF_MASTER.md`

## Current Status

- Continued the larger API pressure list after `/bars`; live diagnostics showed `/accounts/shadow/positions` remained the dominant route-latency driver at about `16s` p95.
  - Direct probes showed shadow all-positions/no-live-quotes could serve stale in about `2.25s`, but a cold `assetClass=Options&liveQuotes=false` key still rebuilt the ledger path and took about `9.5s`.
  - Root cause: `getShadowAccountPositions()` used independent cache keys for `all`, `Options`, and `Stocks`, so filtered views could miss and recompute even when the all-positions response for the same source/live-quote mode was already cached.
  - `shadow-account.ts` now lets filtered views reuse the all-positions cache: fresh all-cache satisfies filtered reads immediately; stale all-cache satisfies filtered reads only under high/critical API pressure and preserves stale/degraded flags.
  - Updated `docs/backend-data-map.md` with the shadow position filter/cache invariant.
  - Validation passed: focused shadow/account cache tests 7/7 and API typecheck.
- Continued the 6-3 API diagnosis larger list with the remaining `/bars` hot spot:
  - Root cause for one pressure feedback loop: stale `/bars` cache hits served immediately, but still scheduled background refresh work whenever chart hydration background refresh was enabled.
  - Under live high route-latency pressure this could keep adding provider/bridge work after the user had already received stale data, matching the high `backgroundRefresh` and `providerFetch` counters.
  - `platform.ts` now gates stale-hit background refresh by API pressure: normal/watch refreshes as before, high pressure only refreshes active-priority requests (`priority >= 8`), and critical pressure suppresses stale-hit refresh entirely.
  - Added `backgroundRefreshPressureSkipped` diagnostics counter and an internal policy test hook.
  - Updated `docs/backend-data-map.md` with the `/bars` stale refresh pressure invariant.
  - Validation passed for this slice: focused `option-chain-batch.test.ts` stale/pressure tests 3/3 and API typecheck. A mis-scoped broader `option-chain-batch.test.ts` run still hit existing failures outside this slice; the two new high-pressure tests passed in that run.
- Fixed the Action Cockpit `last batch 0/90 symbols` copy:
  - Root cause was Signal Options worker monitor-refresh diagnostics leaking into operator-facing cockpit text.
  - `lastBatchSize: 0` with a positive universe means no monitor-refresh symbols were evaluated in that worker pass while signal state was current/stored, not that STA had zero signals.
  - Cockpit copy now renders zero-size current-state paths as `signal state current`; non-empty refreshes render `last refresh N/N symbols`.
  - Diagnostic fields remain in the backend payload for debugging.
- Fixed the STA history QA guard:
  - `qaStaSignalHistory.mjs` now waits for the visible STA table total to hydrate before judging same-day event coverage.
  - After Signal Monitor DB backoff cleared, the guard passed with API same-day events `248`, visible total `249`, 20 rendered rows, and pagination `Rows 1-20 of 249`.
- Root-cause finding for transient missing STA history:
  - Signal Monitor briefly served runtime fallback profile `runtime-fallback-paper` with `Postgres is unavailable; using runtime-only signal monitor evaluation.`
  - Storage later recovered, the real paper profile returned, and `/signal-monitor/events` returned `515` rows for the 36-hour sample window.
  - Treat empty event history during fallback as an operational persistence/backoff signal, not clean no-data.
- Updated `docs/backend-data-map.md` with Signal Monitor persistence/fallback handling, the Action Cockpit worker status-copy rule, and bug-hunting rows for same-day history disappearance and zero-batch copy.
- Validation passed for this slice: `node --check artifacts/pyrus/scripts/qaStaSignalHistory.mjs`; `pnpm --filter @workspace/pyrus run qa:sta-history`; focused Signal Options automation test 140/140; worker/automation/monitor suite 244/244; API typecheck; scoped `git diff --check`; backend data-map fence check.
- Runtime caveat: the running API process predates this source/dist fix, so the live endpoint can still show old `last batch` copy until a normal Replit Run App reload. No supervisor process was killed and no Replit startup/control-plane config was touched.
- Continued the 6-3 API diagnosis larger list with `/bars`/Signal Matrix pressure:
  - Live diagnostics showed API pressure `high` was real route-latency pressure, not memory pressure: `/accounts/shadow/positions`, `/signal-monitor/state`, and `/bars` dominated; `/api/bars` browser timings showed 87 samples, p95 about 34s, and 27 errors.
  - STA-marked `/bars` requests are correctly admitted as `active-screen` under high pressure; background sparkline `/bars` requests are correctly shed.
  - Root cause for remaining late-pickup risk was backend ordering: `evaluateSignalMonitorMatrixSymbol()` had a stream evaluator but waited on `loadSignalMonitorCompletedBars()` first, using stream-only state only after a 12s timeout or warm-cache merge.
  - `signal-monitor.ts` now evaluates live-edge Massive aggregate WebSocket/cache bars first and immediately returns only a fresh buy/sell stream state. Non-signal/stale stream states still fall through to the existing no-REST/stored-state path so historical context is not erased.
  - Added guards in `signal-monitor.test.ts`; updated `docs/backend-data-map.md`.
- Fixed the remaining active STA Signal Matrix cadence issue:
  - Root cause was not the high-pressure cap table; `signalMatrixPollMs` still inherited `signalMonitorPollMs`, so active STA matrix polling used the backend evaluator profile interval, usually 60s and potentially 5m.
  - `PlatformApp.jsx` now uses `signalMonitorDisplayPollMs` for active Signals/Algo matrix polling and keeps `signalMonitorPollMs` for background matrix work.
  - Critical pressure can still raise the poll floor through the existing pressure cap.
  - Guard added in `platformRootSource.test.js`.
  - Safe browser check showed high-pressure Signal Matrix `pollMs: 15000`, STA exact-cell limit 120, matrix response `200`, `sourceStrategy: "native_timeframes_live_retry"`, no freshness warning, and no console/page errors.
- Implemented the 6-3 API diagnosis plan for STA Signal Matrix pickup:
  - `signalMatrixScheduler.js` now requeues hydrated intraday cells at `latestBar + timeframe + short grace`, removing the old effective 2x-timeframe stale wait.
  - `PlatformApp.jsx` no longer treats unknown server pressure as artificial `high`; cap rejections expose `data.maxCells` to the client and trigger an immediate retry inside the admitted backend cap.
  - Signal Monitor backend caps are request-classed: generic high exact cells 20, foreground leader startup/poll high exact cells 60, STA visible-page high exact cells 120, critical 10.
  - Foreground exact-cell leaders stay source-backed under high pressure; cache-only remains for followers/non-protected high-pressure automatic requests.
  - Matrix live pickup uses Massive aggregate stream/cache bars with no historical REST fallback for the live-edge matrix path.
- Updated `docs/backend-data-map.md` with the 6-3 API diagnosis rules: candle-close pickup, pressure caps, live-edge WebSocket/cache source, `/bars` as chart/backtest/historical rather than the live STA trigger, and cap-error metadata exposure.
- Validation for the latest stream-first slice passed: API Signal Monitor tests 78/78; focused Pyrus platform/scheduler/STA tests 127/127; API typecheck. Prior implementation validation also passed: focused Pyrus scheduler/platform tests 100/100; API Signal Monitor tests 77/77; Pyrus typecheck; API typecheck; scoped `git diff --check`; backend data-map fence check; health checks on ports `18747` and `8080`; runtime matrix smoke returned `200` with `sourceStrategy: "native_timeframes_live_retry"`; safe browser STA sample rendered `All 248 of 248 signals`, 20 visible rows, no freshness warning, no `ready to scan` empty state, no console/page errors, and 70 active buy/sell dots across the 120 visible-row signal dots.
- Backend data-map/spec package is now self-contained in `docs/backend-data-map.md`: all four visual diagrams are embedded inline as SVG blocks inside the Markdown, with no sidecar SVG dependencies.
- Expanded `docs/backend-data-map.md` into a comprehensive backend data spec with system boundaries, route-family contracts, state ownership, backend invariants, and validation requirements grounded in the current route/service/schema layout.
- Added no-guess API coverage to `docs/backend-data-map.md`: `No-Guess API Rules`, `Exact API Surface Inventory`, and `API Consumer And Ingestion Matrix`.
- Verified the exact API inventory against `artifacts/api-server/src/routes/*.ts`: 165 route handlers, 165 inventory rows, no missing or extra rows. OpenAPI method coverage is 159/165; the 6 manual/direct surfaces are explicitly listed in the doc.
- Completed bug-hunting readiness audit in `docs/backend-data-map.md`: added a scenario matrix proving the spec can route common failures before implementation inspection, including STA candidate missing, rounded STA signal time, disappearing STA sparkline, empty STA Move, stale prices/bars, matrix holes, account lag, order/fill mismatch, pressure, backtest stuck, generated-client drift, SSE readiness misuse, and provider failure/no-data confusion.
- Added targeted `First Files To Inspect` rows for STA signal time restoration, STA sparkline disappearance, and empty STA Move diagnosis.
- Added the diagnostic front door: `How To Diagnose A Data Wiring Issue`, an STA `Monitor only · Awaiting scan · now` example, the six-field data-line contract, and `Better-Use Guidance` for identifying whether the real fix belongs in backend selection, API/schema, generated clients, cache identity, source freshness, or UI projection.
- Visual review completed by extracting the four inline SVG blocks from `docs/backend-data-map.md`, rendering them with ImageMagick, and inspecting PNGs: comprehensive spec overview `1800x1180`, routing map `1600x1080`, diagnostic map `1800x1380`, rules map `1600x1080`. Fixed earlier clipped labels, a misleading cross-lane connector, right-edge SVG text crowding, and a crossing decorative connector before handoff.
- Validation for the backend data map/spec: no trailing whitespace in `docs/backend-data-map.md`, inline SVG blocks render to PNGs, sidecar `docs/backend-data-*.svg` files were removed, and scoped handoff `git diff --check` passed. `pnpm run audit:markdown-paths` remains blocked by the same unrelated stale markdown references.
- Implemented the STA symptom plan: `AlgoScreen` now resolves Signal Options cockpit/state rows through a stable whole-source snapshot, keeps the last successful STA rows when an action source errors and would shrink the table, and passes source-health metadata to the STA table.
- Implemented STA visible-page matrix hydration: `OperationsSignalTable` marks visible-page requests as `clientRole: "algo-sta"` and `requestOrigin: "sta-visible-page"`; `PlatformApp` preserves those fields and lets the scheduler request up to 20 visible rows x 6 timeframes under high pressure.
- Implemented the backend counterpart: Signal Monitor exact-cell admission still caps generic high-pressure requests at 20 cells, but admits up to 120 cells only for `algo-sta` + `sta-visible-page`; critical pressure remains capped at 10.
- Updated `docs/backend-data-map.md` as work progressed. It now documents the STA stable action snapshot rule, source-health handling, frontend request metadata, and backend exact-cell exception.
- Validation passed: scoped `git diff --check`; Pyrus focused STA/platform/scheduler tests 159/159; API signal-monitor focused tests 71/71; `pnpm --filter @workspace/pyrus run typecheck`; backend data-map fence check `28` fences / `13` Mermaid blocks / even fences.
- Options-flow radar cleanup complete: deleted the old backend radar scanner module/path, stripped radar config/diagnostics/settings fields, replaced active scanner radar icons with `ScanLine`, and renamed active frontend fallback helpers to generic synthetic activity filtering.
- Active scanner/backend/UI search is clean for `radar|Radar|RADAR` across `artifacts/api-server/src`, `artifacts/pyrus/src/features/platform`, `artifacts/pyrus/src/screens/algo`, `AlgoScreen.jsx`, and `DiagnosticsScreen.jsx`. Remaining matches are static research/defense data where radar is a literal industry term.
- Validation passed after cleanup: API scanner test 70/70; adjacent API guards 115/115; Pyrus runtime/header tests 60/60; Pyrus algo/platform tests 91/91; API typecheck; Pyrus typecheck; `git diff --check`.
- Post-restart safe QA check passed: `http://127.0.0.1:18747/?pyrusQa=safe` loaded Algo, rendered the operations signal table, showed `radarTextCount: 0`, no page errors, and no console warnings/errors.
- Fixed an unrelated post-restart Signal Monitor matrix issue found during QA: generic active-screen startup requests now use a conservative high-pressure exact-cell cap until server pressure is observed, while the explicit `algo-sta` + `sta-visible-page` 120-cell exception remains intact. Live matrix request returned `200` with `lastPlanTaskCount: 20` and `lastPlanExactCellLimit: 20` under high pressure.
- Live line usage after restart: budget remains 200, dedicated app usage is consuming account/visible/automation lines, and the flow scanner has `scannerPlannedHorizonCount: 0` because XNYS is in `after` session with `quietReason: market_session_quiet`; this is not the old 8-10-line underfill path.
- Second restart verification at `2026-06-03T23:20:36Z`: health OK on ports `18747` and `8080`; live JSON radar scan still `0`; safe Algo QA still shows no radar text, page errors, or console warnings/errors. Startup matrix request was `20` cells as intended; STA visible-page request was `101` cells, inside the 120-cell exception. Line usage after Algo load: `bridgeLineBudget: 200`, `activeLineCount: 12`, `scannerLineCount: 0`, `scannerEffectiveLineCap: 188`, after-hours `market_session_quiet`.
- Radar-style UI icon cleanup complete after the IBKR header miss: removed `RadioTower` from active Pyrus UI source, including IBKR header/status, AppHeader, PlatformShell, CommandPalette, MobileMoreSheet, NotificationsDrawer, PortfolioPulseZone, ToastStack, HeaderBroadcastScrollerStack, FlowScannerStatusPanel, and Algo HaltStrip.
- Added source guards in `platformRootSource.test.js`: the IBKR connection header cannot use `RadioTower`/`radioTower` or the old `radioTower` gateway key, and active non-test Pyrus source cannot import `RadioTower`.
- Post-restart check at `2026-06-03T23:38:00Z`: frontend served on `18747`; `/api/healthz` returned `{"status":"ok"}`; `/api/readiness` returned `appReadiness.status: "ready"` with diagnostics warning from latency/browser samples and broker trading blocked by after-hours `market_session_quiet`.
- Post-restart IBKR UI QA passed in `?pyrusQa=safe`: app mounted with no boot loader or root crash, IBKR trigger rendered, IBKR dialog opened, `radarTextCount: 0`, no page errors, and no console warnings/errors.
- Served runtime source check passed for `HeaderStatusCluster.jsx`, `IbkrConnectionStatus.jsx`, `AppHeader.jsx`, and `PlatformShell.jsx`: HTTP `200` and no `RadioTower`/`radioTower` matches.
- Existing dirty worktree contains prior signal monitor, signal-options, Massive quote, flow scanner, Replit guardrail, and handoff changes; do not revert unrelated changes.
- Flow scanner source now uses the direct one-live-option-line-per-ticker model without the removed radar promotion layer.
- After-hours `scannerLineCount: 0` was explained by explicit `market_session_quiet` fallback events from `bridge-option-quote-stream`; RTH is required to prove retained scanner quote line fill.
- STA same-day history fix implemented: `PlatformScreenRouter` passes already-fetched `signalMonitorEvents` into `AlgoScreen`; `buildVisibleSignalRows` now merges same-day Signal Monitor event rows with current Signal Options action rows; current action rows overlay matching history rows by signal key; historical rows are non-actionable unless a current candidate/action row exists.
- Backend data map updated to record the corrected STA ownership model; the former 500-row event endpoint total cap has now been superseded by cursor pagination.
- Existing dirty worktree contains prior signal monitor, signal-options, Massive quote, flow scanner, Replit guardrail, and handoff changes; do not revert unrelated changes.
- Existing dirty worktree contains prior signal monitor, signal-options, Massive quote, flow scanner, Replit guardrail, and handoff changes; do not revert unrelated changes.
- SkillsMP/Massive skill pass complete: installed third-party `foreztgump/massive-skill` as `~/.codex/skills/massive`, then installed Massive-owned `massive-debug`, `massive-discover`, `massive-options`, and `massive-dashboard` from `massive-com/codex-plugin`. Restart Codex to load them as active skills.
- Applied Massive-owned debug guidance to the platform Massive connection: REST diagnostics now read our actual `HttpError.statusCode`, classify failures as `auth`, `entitlement`, `rate_limit`, `not_found`, `invalid_request`, `network`, `upstream`, or `unknown`, and attach a diagnostic hint for the UI/debugging path.
- Fixed a Massive timestamp diagnostics bug found during validation: nanosecond `timestamp.gte`/`timestamp.lte` trade URLs now use the existing timestamp scaler instead of `new Date(<nanoseconds>)`, so diagnostics no longer break historical option trade hydration.
- Pyrus runtime Massive summary now exposes `lastHttpStatus`, `lastErrorKind`, `lastDiagnosticHint`, and renders failed REST activity as actionable copy such as `option chain snapshot SPY · entitlement (403)`.
- Validation passed for this Massive pass: `pnpm --filter @workspace/api-server exec node --import tsx --test src/providers/massive/market-data.test.ts`; `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/runtimeControlModel.test.js`; `pnpm --filter @workspace/api-server run typecheck`.
- STA Signal Monitor event history cap follow-up complete: `/signal-monitor/events` is cursor-paged with `from`/`to`, `nextCursor`, and `hasMore`; `PlatformApp` follows all pages for a rolling 36-hour STA window; `OperationsSignalTable` has `Current` and `History` row-source filters; `docs/backend-data-map.md` documents the new contract.
- New safe browser guard `pnpm --filter @workspace/pyrus run qa:sta-history` passed against `http://127.0.0.1:18747/?pyrusQa=safe`: API same-day events `243`, STA visible total `244`, pagination `Rows 1-20 of 244`.
- Validation passed for STA pagination follow-up: API event tests 5/5; Pyrus focused STA/platform/algo tests 135/135; Pyrus typecheck; API typecheck; scoped `git diff --check`; data-map fence check. `pnpm run audit:api-codegen` remains blocked only by the hot-runtime `typecheck:libs` refusal after regenerating outputs.

## Next Recommended Steps

1. After a normal Replit Run App reload, recheck `/api/algo/deployments/:id/cockpit` and the Algo cockpit line; it should not render `last batch 0/90 symbols`.
2. Browser-check the Algo STA table with `?pyrusQa=safe`: visible signal rows should stay stable through action-source failures, Move/sparklines should hydrate, and matrix bubbles should fill the visible page smoothly.
3. During next regular trading hours, watch the scanner line fill and next 5m signal close for smooth STA row/bubble hydration.

## Validation Snapshot

- PASS: `node --check artifacts/pyrus/scripts/qaStaSignalHistory.mjs`.
- PASS: `pnpm --filter @workspace/pyrus run qa:sta-history` after Signal Monitor DB fallback recovery: API same-day events `248`, STA visible total `249`, pagination `Rows 1-20 of 249`.
- PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-options-automation.test.ts` - 140/140.
- PASS: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/signal-options-worker.test.ts src/services/signal-options-automation.test.ts src/services/signal-monitor.test.ts` - 244/244.
- PASS: `pnpm --filter @workspace/api-server run typecheck`.
- PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/options-flow-scanner.test.ts` - 70/70.
- PASS: `pnpm --filter @workspace/api-server exec tsx --test src/services/account-positions.test.ts src/services/watchlist-prewarm.test.ts src/routes/settings.test.ts src/services/market-data-admission.test.ts src/services/ibkr-line-usage.test.ts src/services/flow-universe-planner.test.ts` - 115/115.
- PASS: `pnpm --filter @workspace/api-server run typecheck`.
- PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/runtimeControlModel.test.js src/features/platform/headerBroadcastModel.test.js` - 60/60.
- PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/screens/algo/OperationsSignalRow.test.js src/features/platform/platformRootSource.test.js` - 91/91.
- PASS: `pnpm --filter @workspace/pyrus run typecheck`.
- PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/signalMatrixScheduler.test.js src/features/platform/platformRootSource.test.js` - 95/95.
- PASS: post-restart safe Algo Playwright check: matrix response `200`, no radar text, no page errors, no console warnings/errors.
- PASS: second restart safe Algo Playwright check: startup matrix `20` cells, STA visible-page `101` cells, no radar text, no page errors, no console warnings/errors.
- PASS: active-code `rg -n "radar|Radar|RADAR" ...` returned no matches in scanner/backend/UI paths.
- PASS: `rg -n "\bRadioTower\b|\bradioTower\b" artifacts/pyrus/src ...` now only finds the source guard itself; active non-test UI source is clean.
- PASS: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/platformRootSource.test.js` - 67/67.
- PASS: `pnpm --filter @workspace/pyrus run typecheck`.
- PASS: post-restart Playwright safe QA of IBKR connection popover: trigger present, dialog visible, no radar text, no console/page errors.
- PASS: post-restart `/api/healthz` returned `{"status":"ok"}` and `/api/readiness` returned app ready.
- PASS: `node --import tsx --test src/screens/algo/algoHelpers.test.js src/features/platform/platformRootSource.test.js src/screens/algo/OperationsSignalRow.test.js` - 132/132.
- PASS: expanded focused Pyrus tests - 169/169.
- PASS: Pyrus typecheck.
- PASS: live safe-mode Algo browser check rendered `All 237 of 237 signals` with pagination `Rows 1-20 of 237` and no page/console errors.
- PASS: `git diff --check`.
