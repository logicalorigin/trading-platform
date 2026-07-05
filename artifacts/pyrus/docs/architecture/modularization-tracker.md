# Pyrus Modularization Tracker

## Current Hotspots

- `src/features/platform/PlatformApp.jsx` is the current frontend orchestration owner. The legacy `src/PyrusPlatform.jsx` entry file has been retired; app boot now lazy-loads the platform feature module directly.
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
- Phase 2: Move app shell providers/navigation/runtime composition out of `PyrusPlatform.jsx`. Complete.
- Phase 3: Move Market, Flow, Trade, Account, Settings, and Diagnostics exports to owning feature folders. Complete.
- Phase 4: Split charting and Trade internals after existing chart regression tests are stable. Complete.
- Phase 5: Split backend `platform.ts` and `account.ts` behind unchanged route contracts. Complete.
- Phase 6: Introduce shared bridge contracts and remove bridge imports from server internals. Complete.
- Phase 7: Drain remaining frontend orchestration support code from `PyrusPlatform.jsx`. Complete.
- Phase 8: Retire `PyrusPlatform.jsx` and make the platform feature module the app root. Complete.

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
- Current validation passed: Pyrus typecheck, production build, and diff-check.
- Current status: complete.

### Phase 3: Move screen-owned exports to feature folders

- Move Market exports used by `MarketScreen.jsx` into Market/platform feature modules.
- Move Flow exports used by `FlowScreen.jsx` into Flow/platform feature modules.
- Move Trade exports used by `TradeScreen.jsx` and `features/trade/TradeChainPanel.jsx` into Trade feature modules.
- Move Algo, Account, Settings, and Diagnostics dependencies after the high-traffic Market/Flow/Trade exports are stable.
- Success gate: screens no longer import reusable helpers/components from `PyrusPlatform.jsx`; `PyrusPlatform.jsx` imports screens, not the other way around.
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
  - Cleared `features/trade/TradeChainPanel.jsx` of `PyrusPlatform.jsx` imports.
  - Moved ticker search UI, persisted search-row helpers, ticker universe search, and ticker search lab into `src/features/platform/tickerSearch/TickerSearch.jsx`.
  - Moved market flow polling runtime into `src/features/platform/useLiveMarketFlow.js`.
  - Moved `MultiChartGrid` and market mini-chart helpers into `src/features/market/MultiChartGrid.jsx`.
  - Moved `TradeEquityPanel`, `TradeL2Panel`, `TradeOrderTicket`, and `TradePositionsPanel` into `src/features/trade/TradePanels.jsx`.
  - Moved shared account position/risk display row helpers into `src/features/account/accountPositionRows.js` so Trade feature modules no longer import from `screens/account`.
  - Removed the legacy root exports for the moved ticker, market-grid, and trade-panel components from `PyrusPlatform.jsx`.
  - Validation passed after closure: Pyrus typecheck, production build, diff-check, and no `PyrusPlatform.jsx` screen imports.
- Remaining root imports: none.
- Current status: complete.

### Phase 4: Split charting and Trade internals

- Shared chart hydration helpers are now extracted: `buildChartBarScopeKey`, measured chart-model construction, progressive bar limits, visible-range expansion, and chart request timing.
- `MultiChartGrid` now lives under `src/features/market/MultiChartGrid.jsx`; Phase 4 should split its chart runtime helpers, grid track sizing, and premium-flow overlay model into narrower chart/market modules.
- Keep flow inspection option-chart smoke coverage around the extracted `ContractDetailInline`.
- Trade panels now live as dedicated modules under `src/features/trade`; Phase 4 should keep equity chart, order ticket, L2/flow, positions/orders, and shared broker-confirmation helpers split by responsibility.
- Success gate: `PyrusPlatform.jsx` owns platform orchestration only; chart/trade components live under `features/charting`, `features/market`, `features/flow`, and `features/trade`.
- Current progress:
  - Moved broker action confirmation UI and timeout/error formatting into `src/features/trade/BrokerActionConfirmDialog.jsx`.
  - Moved shared API bar normalization, broker chart source/status labels, and display-price fallback querying into `src/features/charting/chartApiBars.js`.
  - `TradePanels.jsx` no longer owns the broker-confirmation JSX at module bottom, which also fixed the missing `Fragment` import risk found during the Phase 3 audit.
  - Moved shared indicator-preset and pyrus-signals persistence helpers into `src/features/charting/chartIndicatorPersistence.js` so trade and market charts share one implementation.
  - Moved market grid track sizing/session persistence into `src/features/market/marketGridTrackState.js`, including the missing `clampNumber` dependency found during the audit.
  - Split market mini-chart rendering into `src/features/market/MiniChartCell.jsx` and premium-flow overlay rendering into `src/features/market/MiniChartPremiumFlowIndicator.jsx`; `MultiChartGrid.jsx` now owns orchestration.
  - Moved broker execution/order helpers into `src/features/trade/tradeBrokerRequests.js`, fixing the missing execution/status helper risks found during the audit.
  - Split `src/features/trade/TradePanels.jsx` into `PayoffDiagram.jsx`, `TradeOrderTicket.jsx`, `TradeL2Panel.jsx`, `TradePositionsPanel.jsx`, and `TradeEquityPanel.jsx`; the temporary compatibility barrel has since been removed after source imports moved direct.
  - Removed stale embedded trade option chart/chain code that was no longer exported after the Phase 3 screen move.
  - Follow-up audit fixed runtime-only missing imports/helpers in the split modules: trade mutations/value flash/platform JSON requests, market grid viewport persistence helpers, mini-chart study normalization, and premium-flow symbol/time formatting.
  - Moved `platformJsonRequest` into `src/features/platform/platformJsonRequest.js` and re-exported it from `PyrusPlatform.jsx` to avoid duplicate request-helper drift.
  - Review cleanup removed nonfunctional inline chart-frame timeframe buttons from `ResearchChartWidgetHeader`; chart frames now rely on the timeframe dropdown as the single visible interval selector.
- Validation passed after closure: targeted JS undefined-name scan for Phase 4 split files, Pyrus typecheck, production build, diff-check, and no `PyrusPlatform.jsx` screen imports.
- Post-Phase-6 alignment review removed the `features/platform/PyrusApp.tsx` wrapper so feature modules no longer import `PyrusPlatform.jsx`; `App.tsx` now owns that root lazy import.
- Current status: complete.

### Phase 5: Split backend platform/account aggregators

- Split `api-server/src/services/platform.ts` behind unchanged route contracts in this order: session/runtime status, market-data health, market-data admission, account snapshots, then diagnostics payload assembly.
- Split `api-server/src/services/account.ts` behind unchanged route contracts in this order: account summary, positions, orders/executions, risk, and equity history.
- Regenerate API clients after each split boundary.
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

### Phase 6: Introduce shared broker contracts

- Add shared broker contract types consumed by the app-owned API runtime.
- Move health, session, market-data, account, order, and diagnostics payload shapes into the shared contract package/module.
- Replace `api-server/src/*` imports of `ibkr-bridge` internals with shared contracts plus adapter functions.
- Keep runtime diagnostics and connection-health payloads backward compatible while both sides migrate.
- Success gate: dependency direction is `api-server -> shared contracts` and `ibkr-bridge -> shared contracts`, with no `api-server/src/* -> ibkr-bridge/*` coupling.
- Current progress:
  - Created shared workspace package `@workspace/ibkr-contracts` with shared `HttpError`/`isHttpError`, IBKR value coercion/normalization utilities, TWS runtime config contracts/resolution, and IBKR broker snapshot/input contract types.
  - Moved `ibkr-bridge` imports off `api-server/src/lib/errors`, `api-server/src/lib/values`, `api-server/src/lib/runtime`, and `api-server/src/providers/ibkr/client`.
  - Historical note: the old desktop `ibkr-bridge` artifact was later retired; shared broker contracts remain in `@workspace/ibkr-contracts`.
  - Updated `api-server/src/providers/ibkr/client.ts` to re-export the shared broker contract types from `@workspace/ibkr-contracts`.
  - Fixed the bridge `getOptionActivitySnapshots` timeout calculation to use an in-scope normalized symbol list, which was exposed by Phase 6 bridge typecheck.
  - Added Knip workspace coverage for `lib/ibkr-contracts` so dead-code checks include the shared contracts package.
  - Validation passed: `pnpm run typecheck:libs`, API server typecheck/build, bridge typecheck/build, dead-code scan, and 65 focused backend/bridge tests.
- Current status: complete.

### Phase 7: Drain remaining frontend orchestration support code

- Move IBKR bridge launcher/session-storage helpers into an owning platform module.
- Move market-data subscription runtime and snapshot normalization into an owning platform module.
- Move header status/KPI/account/watchlist UI modules out of `PyrusPlatform.jsx` behind the existing `PlatformShell` component injection boundary.
- Move root-local toast, account-selection, and navigation handler construction into focused hooks once the runtime/provider slices are stable.
- Success gate: `PyrusPlatform.jsx` should mostly compose hooks/providers and pass data into `PlatformShell`, with no large embedded UI component families or provider implementations.
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
  - Validation passed after closure: workspace typecheck, Pyrus production build, and configured root dead-code gate.
- Current status: complete.

### Phase 8: Retire the legacy root app file

- Moved the remaining platform app orchestration into `src/features/platform/PlatformApp.jsx`.
- Updated `src/app/App.tsx` to lazy-load `PlatformApp.jsx` instead of the legacy root file.
- Moved watchlist identity payload construction into `src/features/platform/watchlistModel.js`, removing the hidden undefined helper conflict from the app root and deleting duplicate dead helpers from market chart modules.
- Added spot chart hydration hardening in the backend: if Massive synthesis is configured but underfills or fails, `/api/bars` now falls back to a full broker history request instead of returning only the recent broker slice.
- Current status: complete.
