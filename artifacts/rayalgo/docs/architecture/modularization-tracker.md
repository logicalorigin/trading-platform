# RayAlgo Modularization Tracker

## Current Hotspots

- `src/features/platform/PlatformApp.jsx` is the current frontend orchestration owner. The legacy `src/RayAlgoPlatform.jsx` entry file has been retired; app boot now lazy-loads the platform feature module directly.
- `api-server/src/services/platform.ts` and `api-server/src/services/account.ts` remain backend route-facing aggregators. Phase 5 split low-level runtime, market-data, account, order, risk, equity-history, and Flex helpers behind unchanged route contracts.
- `ibkr-bridge` no longer imports `api-server/src`; bridge/API shared contracts now live in `@workspace/ibkr-contracts`.

## Dependency Direction

- App shell may import screens and platform runtimes.
- Screens may import feature modules, shared UI, shared formatting, generated API clients, and app state helpers.
- Feature modules must not import root app entry files.
- Bridge package must not import `api-server/src/*` after the bridge-contract phase.
- Generated API client files remain generated-only.

## Phase Checklist

- Phase 0: Capture current architecture and test gates. Complete.
- Phase 1: Extract shared frontend utilities, workspace persistence, and generic UI primitives. Complete.
- Phase 2: Move app shell providers/navigation/runtime composition out of `RayAlgoPlatform.jsx`. Complete.
- Phase 3: Move Market, Flow, Trade, Account, Settings, and Diagnostics exports to owning feature folders. Complete.
- Phase 4: Split charting and Trade internals after existing chart regression tests are stable. Complete.
- Phase 5: Split backend `platform.ts` and `account.ts` behind unchanged route contracts. Complete.
- Phase 6: Introduce shared bridge contracts and remove bridge imports from server internals. Complete.
- Phase 7: Drain remaining frontend orchestration support code from `RayAlgoPlatform.jsx`. Complete.
- Phase 8: Retire `RayAlgoPlatform.jsx` and make the platform feature module the app root. Complete.

## Phase 2 Notes

- `src/features/platform/screenRegistry.jsx` owns lazy screen imports, memoized screen wrappers, screen metadata, mounted-screen state construction, and shared screen loading fallback.
- `src/features/platform/PlatformShell.jsx` owns the visual app frame: top nav, KPI/header controls, broadcast scrollers, watchlist rail, active screen host, bottom status, toast stack, and live dock.
- `src/features/platform/PlatformScreenRouter.jsx` owns per-screen JSX routing and screen-specific prop handoff.
- `src/features/platform/platformContexts.jsx` and `PlatformProviders.jsx` own platform context definitions and provider composition.
- `src/features/platform/PlatformRuntimeLayer.jsx` owns runtime composition around market subscriptions and shared flow scanners.
- `src/app/App.tsx` lazy-loads `src/features/platform/PlatformApp.jsx` directly.
- Platform app orchestration now lives in the platform feature folder alongside shell, providers, runtime layers, contexts, and screen routing.

## Current-State Replan

This replan is based on current workspace files only. No separate untracked transcript for the earlier planning conversation was found.

### Phase 2: Platform shell extraction

- Keep `PlatformApp.jsx` as the orchestration owner for provider implementations, account/session state derivation, and handler construction until those areas have narrower owning hooks.
- Keep the extracted shell files in `src/features/platform` as the app-frame boundary: `PlatformShell.jsx`, `PlatformScreenRouter.jsx`, `PlatformProviders.jsx`, `PlatformRuntimeLayer.jsx`, `platformContexts.jsx`, and `screenRegistry.jsx`.
- Current validation passed: RayAlgo typecheck, production build, diff-check, and `e2e/platform-shell.spec.ts`.
- Current status: complete.

### Phase 3: Move screen-owned exports to feature folders

- Move Market exports used by `MarketScreen.jsx` into Market/platform feature modules.
- Move Flow exports used by `FlowScreen.jsx` into Flow/platform feature modules.
- Move Trade exports used by `TradeScreen.jsx` and `features/trade/TradeChainPanel.jsx` into Trade feature modules.
- Move Algo, Account, Settings, and Diagnostics dependencies after the high-traffic Market/Flow/Trade exports are stable.
- Success gate: screens no longer import reusable helpers/components from `RayAlgoPlatform.jsx`; `RayAlgoPlatform.jsx` imports screens, not the other way around.
- Current progress:
  - Moved platform-neutral helper exports into `src/features/platform/tickerIdentity.js`, `src/features/platform/queryDefaults.js`, and `src/features/platform/bridgeRuntimeModel.js`.
  - Moved market reference arrays and breadth/rates summaries into `src/features/market/marketReferenceData.js`.
  - Moved `MarketActivityPanel` and its lane/row helpers into `src/features/market/MarketActivityPanel.jsx`.
  - Moved flow order-flow visuals and provider color presentation into `src/features/flow/OrderFlowVisuals.jsx` and `src/features/flow/flowPresentation.js`.
  - Moved flow analytics/model builders into `src/features/flow/flowAnalytics.js`.
  - Moved the flow event UI mapper into `src/features/flow/flowEventMapper.js`.
  - Moved the runtime ticker store/hooks into `src/features/platform/runtimeTickerStore.js`.
  - Moved chart timeframe favorites into `src/features/charting/useChartTimeframeFavorites.js`.
  - Moved shared chart hydration/runtime helpers into `src/features/charting/chartHydrationRuntime.js`.
  - Moved the option-chain API row normalizer into `src/features/trade/optionChainRows.js`.
  - Moved `ContractDetailInline` into `src/features/flow/ContractDetailInline.jsx`.
  - Moved the trade tab strip and compact ticker header into `src/features/trade/TradeWorkspaceChrome.jsx`.
  - Moved the trade strategy greeks panel into `src/features/trade/TradeStrategyGreeksPanel.jsx`.
  - Cleared `features/trade/TradeChainPanel.jsx` of `RayAlgoPlatform.jsx` imports.
  - Moved ticker search UI, persisted search-row helpers, ticker universe search, and ticker search lab into `src/features/platform/tickerSearch/TickerSearch.jsx`.
  - Moved market flow polling runtime into `src/features/platform/useLiveMarketFlow.js`.
  - Moved `MultiChartGrid` and market mini-chart helpers into `src/features/market/MultiChartGrid.jsx`.
  - Moved `TradeEquityPanel`, `TradeL2Panel`, `TradeOrderTicket`, and `TradePositionsPanel` into `src/features/trade/TradePanels.jsx`.
  - Moved shared account position/risk display row helpers into `src/features/account/accountPositionRows.js` so Trade feature modules no longer import from `screens/account`.
  - Removed the legacy root exports for the moved ticker, market-grid, and trade-panel components from `RayAlgoPlatform.jsx`.
  - Validation passed after closure: RayAlgo typecheck, production build, diff-check, no `RayAlgoPlatform.jsx` screen imports, and `e2e/platform-shell.spec.ts`.
- Remaining root imports: none.
- Current status: complete.

### Phase 4: Split charting and Trade internals

- Shared chart hydration helpers are now extracted: `buildChartBarScopeKey`, measured chart-model construction, progressive bar limits, visible-range expansion, and chart request timing.
- `MultiChartGrid` now lives under `src/features/market/MultiChartGrid.jsx`; Phase 4 should split its chart runtime helpers, grid track sizing, and premium-flow overlay model into narrower chart/market modules.
- Keep flow inspection option-chart smoke coverage around the extracted `ContractDetailInline`.
- Trade panels now live under `src/features/trade/TradePanels.jsx`; Phase 4 should split that module into equity chart, order ticket, L2/flow, positions/orders, and shared broker-confirmation helpers.
- Success gate: `RayAlgoPlatform.jsx` owns platform orchestration only; chart/trade components live under `features/charting`, `features/market`, `features/flow`, and `features/trade`.
- Current progress:
  - Moved broker action confirmation UI and timeout/error formatting into `src/features/trade/BrokerActionConfirmDialog.jsx`.
  - Moved shared API bar normalization, broker chart source/status labels, and display-price fallback querying into `src/features/charting/chartApiBars.js`.
  - `TradePanels.jsx` no longer owns the broker-confirmation JSX at module bottom, which also fixed the missing `Fragment` import risk found during the Phase 3 audit.
  - Moved shared indicator-preset and ray-replica persistence helpers into `src/features/charting/chartIndicatorPersistence.js` so trade and market charts share one implementation.
  - Moved market grid track sizing/session persistence into `src/features/market/marketGridTrackState.js`, including the missing `clampNumber` dependency found during the audit.
  - Split market mini-chart rendering into `src/features/market/MiniChartCell.jsx` and premium-flow overlay rendering into `src/features/market/MiniChartPremiumFlowIndicator.jsx`; `MultiChartGrid.jsx` now owns orchestration.
  - Moved broker execution/order helpers into `src/features/trade/tradeBrokerRequests.js`, fixing the missing execution/status helper risks found during the audit.
  - Split `src/features/trade/TradePanels.jsx` into `PayoffDiagram.jsx`, `TradeOrderTicket.jsx`, `TradeL2Panel.jsx`, `TradePositionsPanel.jsx`, and `TradeEquityPanel.jsx`; `TradePanels.jsx` is now a compatibility barrel.
  - Removed stale embedded trade option chart/chain code that was no longer exported after the Phase 3 screen move.
  - Follow-up audit fixed runtime-only missing imports/helpers in the split modules: trade mutations/value flash/platform JSON requests, market grid viewport persistence helpers, mini-chart study normalization, and premium-flow symbol/time formatting.
  - Moved `platformJsonRequest` into `src/features/platform/platformJsonRequest.js` and re-exported it from `RayAlgoPlatform.jsx` to avoid duplicate request-helper drift.
  - Review cleanup removed nonfunctional inline chart-frame timeframe buttons from `ResearchChartWidgetHeader`; chart frames now rely on the timeframe dropdown as the single visible interval selector.
- Validation passed after closure: targeted JS undefined-name scan for Phase 4 split files, RayAlgo typecheck, RayAlgo unit suite, production build, diff-check, no `RayAlgoPlatform.jsx` screen imports, and `e2e/platform-shell.spec.ts`.
- Post-Phase-6 alignment review removed the `features/platform/RayAlgoApp.tsx` wrapper so feature modules no longer import `RayAlgoPlatform.jsx`; `App.tsx` now owns that root lazy import.
- Current status: complete.

### Phase 5: Split backend platform/account aggregators

- Split `api-server/src/services/platform.ts` behind unchanged route contracts in this order: session/runtime status, market-data health, market-data admission, account snapshots, then diagnostics payload assembly.
- Split `api-server/src/services/account.ts` behind unchanged route contracts in this order: account summary, positions, orders/executions, risk, and equity history.
- Add focused service tests at each split boundary before regenerating API clients.
- Regenerate API clients only after the route contract is stable for the slice and frontend callers still typecheck.
- Current progress:
  - Audited backend hotspots: `api-server/src/services/platform.ts` is about 11.2k lines, `api-server/src/services/account.ts` is about 4.2k lines, and `api-server/src/routes/platform.ts` is the route-contract boundary to preserve.
  - Started the first slice by moving pure IBKR runtime stream/strict readiness resolution into `api-server/src/services/platform-runtime-status.ts`.
  - Kept the existing `platform.ts` test exports (`__resolveIbkrRuntimeStreamStateForTests` and `__resolveIbkrRuntimeStrictReasonForTests`) as re-exports so current tests and route callers do not change.
  - Moved IBKR bridge client factory, bridge-health cache, health annotation, session health refresh, runtime diagnostics health state, and trading-guard health refresh into `api-server/src/services/platform-bridge-health.ts`.
  - Kept `platform.ts` route-facing behavior unchanged: `/api/session`, runtime diagnostics, and live trading readiness still call the same exported service functions and return the same payload shapes.
  - Moved runtime market-data stream/admission diagnostics assembly into `api-server/src/services/platform-market-data-diagnostics.ts`, preserving the existing `ibkr.streams.bridgeQuote`, `ibkr.streams.stockAggregates`, and `ibkr.streams.marketDataAdmission` response shape.
  - Added runtime diagnostics assertions for the extracted market-data diagnostics payload.
  - Moved pure account position filtering, reference-symbol resolution, signed-notional math, and quote-hydration modeling into `api-server/src/services/account-position-model.ts`, preserving the existing account service test exports.
  - Moved account numeric aggregation, NAV-weighted averages, and IBKR margin fallback field mapping into `api-server/src/services/account-summary-model.ts` so account summary and risk share one margin model.
  - Moved equity-history return math, external-transfer classification, snapshot compaction/filtering, and persisted snapshot conversion into `api-server/src/services/account-equity-history-model.ts`.
  - Moved order tab/status classification, trade asset-class labeling, and position/order grouping keys into `api-server/src/services/account-trade-model.ts` with focused order-helper coverage.
  - Moved risk/Greek model helpers into `api-server/src/services/account-risk-model.ts`: sector/beta metadata, exposure math, nullable totals, option-chain contract matching/merging, and expiry concentration buckets.
  - Moved Flex XML record extraction, Flex env config parsing, and backfill-window planning into `api-server/src/services/account-flex-model.ts`.
  - Validation passed for the slices: API server typecheck, API server build, focused runtime diagnostics/order gateway readiness/market-data admission tests, account position/margin focused tests, account equity-history focused tests, account order-helper focused tests, account risk-helper focused tests, and account Flex-helper focused tests.
- Closure validation passed: API server typecheck, API server build, diff-check, focused runtime diagnostics/order gateway readiness/market-data admission tests, and focused account position/margin/equity-history/order/risk/Flex tests.
- Current status: complete.

### Phase 6: Introduce shared bridge contracts

- Add shared broker/bridge contract types that can be consumed by both `api-server` and `ibkr-bridge`.
- Move health, session, market-data, account, order, and diagnostics payload shapes into the shared contract package/module.
- Replace `api-server/src/*` imports of `ibkr-bridge` internals with shared contracts plus adapter functions.
- Keep runtime diagnostics and connection-health payloads backward compatible while both sides migrate.
- Success gate: dependency direction is `api-server -> shared contracts` and `ibkr-bridge -> shared contracts`, with no `api-server/src/* -> ibkr-bridge/*` coupling.
- Current progress:
  - Created shared workspace package `@workspace/ibkr-contracts` with shared `HttpError`/`isHttpError`, IBKR value coercion/normalization utilities, TWS runtime config contracts/resolution, and IBKR broker snapshot/input contract types.
  - Moved `ibkr-bridge` imports off `api-server/src/lib/errors`, `api-server/src/lib/values`, `api-server/src/lib/runtime`, and `api-server/src/providers/ibkr/client`.
  - Removed the `ibkr-bridge` tsconfig include of `../api-server/src/**/*.ts`; `rg "api-server/src" artifacts/ibkr-bridge` now returns no matches.
  - Updated `api-server/src/providers/ibkr/client.ts` to re-export the shared broker contract types from `@workspace/ibkr-contracts`.
  - Fixed the bridge `getOptionActivitySnapshots` timeout calculation to use an in-scope normalized symbol list, which was exposed by Phase 6 bridge typecheck.
  - Added Knip workspace coverage for `lib/ibkr-contracts` so dead-code checks include the shared contracts package.
  - Validation passed: `pnpm run typecheck:libs`, API server typecheck/build, bridge typecheck/build, dead-code scan, and 65 focused backend/bridge tests.
- Current status: complete.

### Phase 7: Drain remaining frontend orchestration support code

- Move IBKR bridge launcher/session-storage helpers into an owning platform module.
- Move market-data subscription runtime and snapshot normalization into an owning platform module.
- Move header status/KPI/account/watchlist UI modules out of `RayAlgoPlatform.jsx` behind the existing `PlatformShell` component injection boundary.
- Move root-local toast, account-selection, and navigation handler construction into focused hooks once the runtime/provider slices are stable.
- Success gate: `RayAlgoPlatform.jsx` should mostly compose hooks/providers and pass data into `PlatformShell`, with no large embedded UI component families or provider implementations.
- Current progress:
  - Started post-Phase-6 review by removing nonfunctional chart-frame inline interval controls and moving shared account position row helpers to feature code.
  - Moved IBKR launcher/session-storage helpers into `src/features/platform/ibkrBridgeSession.js`.
  - Moved runtime quote snapshot fallback/normalization into `src/features/platform/runtimeMarketDataModel.js`.
  - Moved quote/sparkline subscription ownership into `src/features/platform/MarketDataSubscriptionProvider.jsx`.
  - Moved shared and broad market-flow runtime layers into `src/features/platform/MarketFlowRuntimeLayer.jsx`.
  - Moved header KPI, account, IBKR status/popover, and broadcast scroller UI into focused platform modules.
  - Moved the watchlist rail and watchlist rendering container into `src/features/platform/PlatformWatchlist.jsx`.
  - Deleted stale root-local chart/trade generators, broker request helpers, static market card data, and orphaned order-flow presentation code that no longer had call sites after prior phases.
  - Moved the latency debug strip into `src/features/platform/LatencyDebugStrip.jsx`.
  - Reduced the legacy root platform file from about 6.5k lines at Phase 7 start to about 1.8k lines; it mostly derived session/account/runtime state, owned watchlist mutations, and passed composed data into `PlatformShell` and `PlatformRuntimeLayer`.
  - Validation passed after closure: workspace typecheck, RayAlgo production build, configured root dead-code gate, RayAlgo unit suite, and `e2e/platform-shell.spec.ts`.
- Current status: complete.

### Phase 8: Retire the legacy root app file

- Moved the remaining platform app orchestration into `src/features/platform/PlatformApp.jsx`.
- Updated `src/app/App.tsx` to lazy-load `PlatformApp.jsx` instead of the legacy root file.
- Updated root-source regression tests to inspect `PlatformApp.jsx`.
- Moved watchlist identity payload construction into `src/features/platform/watchlistModel.js`, removing the hidden undefined helper conflict from the app root and deleting duplicate dead helpers from market chart modules.
- Added spot chart hydration hardening in the backend: if Polygon/Massive synthesis is configured but underfills or fails, `/api/bars` now falls back to a full broker history request instead of returning only the recent broker slice.
- Added backend coverage for both no-synthesis and underfilled-synthesis spot history paths.
- Current status: complete.

### Phase 7 Regression hardening plan

- Chart and chart-frame UI:
  - Verify timeframe dropdown selection updates the visible timeframe, issues a new bars request, and preserves favorite-star behavior without stealing the row click.
  - Verify plot drag-panning changes the visible logical range on market mini charts, Trade equity charts, and Trade option charts; chart toolbar/menu clicks must not start a plot pan.
  - Verify chart type, indicators, RayReplica settings, fullscreen/focus/solo, reset/fit/realtime, crosshair mode, drawing tools, legend/status line, viewport persistence, and empty states on market and trade chart frames.
  - Verify no automatic future-axis projection beyond the latest candle from stale `futureExpansionBars`; today is May 1, 2026 in the current environment, so future labels like May 26 must only appear when the user explicitly creates that much future space.
- Trade UI:
  - Verify the contract option chart owns the top of the chart panel without the old MARK/BID/ASK/IV stat boxes above it.
  - Verify option-chain selection hydrates provider contract IDs, chart bars, flow overlays, order-ticket asset toggles, Shadow/IBKR preview and submit paths, disconnected-gateway blocking, ticker tab switching, drag-reorder persistence after reload, tab close, watchlist-driven ticker changes, and full-width layout.
- Market UI:
  - Verify independent and synced mini-chart timeframes, chart reset, layout buttons, grid resize handles, watchlist add/remove/reorder/filter/sort, signal interval controls, flow scanner controls, premium-flow strip, market heat/pulse/news/calendar empty states, and no stale inline interval buttons.
- Platform shell and shared chrome:
  - Verify nav switching keeps header/status/watchlist chrome mounted, header KPI/account/IBKR/status/broadcast controls stay compact, bottom status reflects active data, preference reloads do not overwrite the active screen/symbol, and screen warmup does not remount visible screens unexpectedly.
- Account, Flow, Research, Algo, Backtest, Diagnostics, Settings:
  - Keep existing smoke/layout tests for screen fill and shared chrome, then add targeted tests as each screen is edited: filter drawers, column controls, presets, account ranges, diagnostic toggles, preference patch/reset flows, and data-provider empty/error states.
- Automated gate strategy:
  - Unit-test pure state helpers for viewport ranges, preference normalization/cache writes, timeframe models, option-chain row modeling, and persistence merges.
  - Playwright-test the operational flows that can regress visually or by event handling: chart dropdowns, panning, chart overlays, Trade option chart placement, tab persistence, order actions, platform nav/chrome, and screen layout fill.
  - For every future UI slice, run the affected Playwright spec plus RayAlgo typecheck, affected unit tests, production build when bundle/runtime code changes, `pnpm run deadcode` when modules move, and `git diff --check`.
- Regression pass completed in this slice:
  - Fixed chart-frame timeframe dropdown selection by making row selection explicit and test-addressable.
  - Fixed chart panning by guarding chart toolbar/menu targets while still consuming real plot drags.
  - Removed the old Trade option-chart MARK/BID/ASK/IV stat boxes and added browser coverage to prevent them returning.
  - Bounded and defaulted chart future-axis expansion so stale settings cannot push the visible axis from May 1, 2026 out to dates like May 26.
  - Fixed preference caching so a settings reload no longer overwrites active workspace routing state such as `screen: "trade"`.
  - Added page-by-page platform smoke coverage for Market, Flow, Trade, Account, Research, Algo, Backtest, Diagnostics, and Settings.
  - Updated stale browser specs for dropdown-only timeframe controls, market-grid viewport identity keys, and non-unusual flow request parameters.
  - Hardened inactive market-chart plot drags so panning does not bubble into card selection, and scoped chart settings-menu assertions to the intended chart frame.
  - Closure validation for the deeper pass: all listed Playwright specs accounted for (76 passed, memory soak intentionally skipped unless `RAYALGO_MEMORY_SOAK=1`), RayAlgo typecheck, RayAlgo unit suite, RayAlgo production build, root dead-code scan, and `git diff --check`.
  - Follow-up pickup validation found two browser specs blocked by the Replit runtime-error overlay treating non-`Error` resource failures as `(unknown runtime error)`; `vite.config.ts` now filters only that generic overlay case while preserving real runtime `Error` overlays.
  - Follow-up validation after that fix: workspace typecheck, RayAlgo unit suite, RayAlgo production build, root dead-code scan, `git diff --check`, focused diagnostics/header specs, and the trade/watchlist Playwright tail passed. A full Playwright rerun passed through the earlier failing diagnostics/header coverage and was interrupted by the runner at test 55 before summary output, so the remaining tail was rerun directly and passed.

## Required Gates Per Slice

- `pnpm typecheck` from the workspace when cross-package boundaries move.
- Package-local typecheck/build when a slice is limited to one package.
- Affected unit tests.
- Playwright smoke for affected UI screens.
- Bundle output review after frontend extraction.
