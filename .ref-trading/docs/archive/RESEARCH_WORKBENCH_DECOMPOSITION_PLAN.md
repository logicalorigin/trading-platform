# Research Workbench Decomposition Plan (Historical Snapshot)

Updated: 2026-03-11T02:28:57Z

Historical status: superseded by the March 20, 2026 Research cleanup pass.

## Purpose

This document records the March 10-11, 2026 decomposition state for the Research backtesting workspace. It is not the source of truth for the current shell.

Current shell note:

- `src/components/ResearchWorkbench.jsx` now composes `ResearchWorkbenchTopControls`, `ResearchWorkbenchChartPanel`, `ResearchWorkbenchOptionPanel`, and `ResearchWorkbenchInsightsPanel`.
- The later March 20, 2026 cleanup removed `src/research/data/syntheticSpotBars.js`, `src/components/research/ResearchWorkbenchHeader.jsx`, `src/components/research/ResearchWorkbenchSidebar.jsx`, `src/components/research/ResearchWorkbenchTradeRail.jsx`, and the extracted `src/components/research/sidebar/*.jsx` section files.
- Use live source files rather than this snapshot when auditing current architecture.

It answers two questions:

1. What did `src/components/ResearchWorkbench.jsx` do at that point in the decomposition?
2. What was the safest order to split it into app-native research modules without breaking the working backtest area?

This is narrower than the broader integration plan. It is specifically about understanding and decomposing the workbench snapshot from that time.

## Status At That Time

Completed on 2026-03-10:

- Phase 1 is done.
- the duplicate local pricing/backtest/optimizer block was removed from `src/components/ResearchWorkbench.jsx`
- the extracted runtime in `src/research/engine/runtime.js` is now the only active engine implementation
- the unreachable internal settings subtree was removed from `src/components/ResearchWorkbench.jsx`
- the real option replay controls were surfaced into the visible workspace and linked back to Accounts-managed credentials
- the results and analysis surface was extracted into `src/components/research/ResearchWorkbenchInsights.jsx`
- `recharts` was split out of the main workbench path and the 500 kB build warning is gone
- ET market-time utilities now live in `src/research/market/time.js`
- runtime session gating and option-history normalization now use ET/DST-aware market-local timestamps instead of fixed UTC session assumptions
- broker-backed `getMarketBars` is now the primary Research spot-history path, with Yahoo retained only as a fallback
- credential hydration, spot-history loading, and option replay loading are now extracted into:
  - `src/research/hooks/useResearchApiCreds.js`
  - `src/research/hooks/useResearchSpotHistory.js`
  - `src/research/hooks/useResearchOptionReplay.js`
- shared strategy labels, presets, and recommendation lists now live in `src/research/config/strategyPresets.js`
- control/preset/storage state now lives in `src/research/hooks/useResearchControls.js`
- backtest, optimizer, recommendation, and derived analysis orchestration now live in `src/research/hooks/useResearchExecution.js`
- chart display-model construction now lives in `src/research/chart/displayModel.js`
- executed trade overlays are now precomputed in the workbench layer as `tradeOverlays`, `entriesByBarIndex`, and `exitsByBarIndex`
- `TVSpotChart` now renders precomputed overlay groups instead of doing raw `ts` exact-match lookup against displayed candles
- runtime trade timestamps are now parsed via shared market-local timestamp helpers, preserving the ET/DST semantics already established in Research
- the synthetic fallback dataset and intraday generator now live in `src/research/data/syntheticSpotBars.js`
- the full left control rail now lives in `src/components/research/ResearchWorkbenchSidebar.jsx`
- spot-history auto-load no longer waits on research credential hydration, and synthetic bars are now used only as an initial placeholder instead of silently replacing failed live history
- the top header/status strip now lives in `src/components/research/ResearchWorkbenchHeader.jsx`
- the chart toolbar/container shell now lives in `src/components/research/ResearchWorkbenchChartPanel.jsx`
- chart/source selection, freshness labels, and tf detection now live in `useResearchBarModel`, while post-run chart display-model composition now lives in `useResearchChartModel`, both in `src/research/hooks/useResearchChartModel.js`
- the custom chart subsystem is now extracted into `src/components/research/TVSpotChart.jsx`
- workbench hook composition now lives in `src/research/hooks/useResearchWorkbenchViewModel.js`
- the lazy insights/suspense wrapper now lives in `src/components/research/ResearchWorkbenchInsightsPanel.jsx`
- sidebar and chart-panel props are now grouped into domain models instead of one long flat contract
- `ResearchWorkbench.jsx` is now a composition shell at 40 lines
- `ResearchWorkbenchInsights.jsx` is now an 85-line composition shell over extracted section components in `src/components/research/insights/`
- `ResearchWorkbenchSidebar.jsx` is now a 38-line composition shell over extracted section components in `src/components/research/sidebar/`
- runtime verification passed again after the composition extraction and grouped prop-API pass
- full-stack browser smoke tests also passed again after the insights and sidebar section splits
- the built `ResearchWorkbench` chunk is `140.00 kB`, with `ResearchWorkbenchInsights` at `23.99 kB`, `d3-vendor` at `62.84 kB`, and `recharts-core` at `473.97 kB`

Next target:

- retire Yahoo fallback once broker coverage is proven
- the remaining large section components are now:
  - `src/components/research/sidebar/ResearchSidebarDataReplaySection.jsx`
  - `src/components/research/insights/ResearchInsightsRecommendationTab.jsx`
  - `src/components/research/TVSpotChart.jsx`
- decide whether to keep the sidebar/insights section files as the stable boundary or continue splitting their largest subsections
- keep shrinking `ResearchWorkbench.jsx` until it is only a composition shell over hooks and child panels

## Current Shape

Primary files:

- `src/components/ResearchWorkbench.jsx` — 40 lines
- `src/research/hooks/useResearchWorkbenchViewModel.js` — 253 lines
- `src/components/research/ResearchWorkbenchInsightsPanel.jsx` — 38 lines
- `src/components/research/ResearchWorkbenchInsights.jsx` — 85 lines
- `src/components/research/insights/` — extracted summary, highlight, tab-panel, and tab-body sections
- `src/components/research/ResearchWorkbenchHeader.jsx` — top status strip and live source summary
- `src/components/research/ResearchWorkbenchChartPanel.jsx` — 176 lines for chart toolbar, timeframe/range toggles, grouped chart status, and chart container
- `src/components/research/ResearchWorkbenchSidebar.jsx` — 38 lines
- `src/components/research/sidebar/` — extracted data/replay, strategy, sizing-costs, schedule, and shared UI atoms
- `src/components/research/TVSpotChart.jsx` — 1,079 lines
- `src/research/hooks/useResearchChartModel.js` — `useResearchBarModel` for source/tf derivation plus `useResearchChartModel` for post-run display-model composition
- `src/research/engine/runtime.js` — 1,146 lines
- `src/research/chart/displayModel.js` — chart bars, chart bar ranges, and executed-trade overlay mapping
- `src/research/data/syntheticSpotBars.js` — synthetic fallback daily dataset and intraday generator
- `src/research/config/strategyPresets.js` — shared strategy labels, presets, and recommendation lists
- `src/research/hooks/useResearchControls.js` — strategy/risk/schedule/chart control state and storage persistence
- `src/research/hooks/useResearchExecution.js` — backtest run, optimizer run, recommendation matrix, and derived analytics
- `src/research/hooks/useResearchApiCreds.js` — credential hydration and Accounts bridge
- `src/research/hooks/useResearchSpotHistory.js` — broker-backed spot history, quote polling, and Yahoo fallback
- `src/research/hooks/useResearchOptionReplay.js` — option replay inputs, Massive load path, and runtime contract shaping
- `src/research/market/time.js` — ET market-time helpers shared by runtime and UI
- `src/research/options/history.js` — 104 lines
- `src/research/options/optionTicker.js` — 51 lines

Key observation:

- the workbench no longer imports the runtime directly
- the workbench no longer composes domain hooks directly either
- workbench hook orchestration now flows through `src/research/hooks/useResearchWorkbenchViewModel.js`
- runtime ownership now flows through `src/research/hooks/useResearchExecution.js`
- control ownership now flows through `src/research/hooks/useResearchControls.js`
- chart overlay/bucketing ownership now flows through `src/research/chart/displayModel.js`
- synthetic fallback ownership now flows through `src/research/data/syntheticSpotBars.js`
- sidebar UI ownership now flows through `src/components/research/ResearchWorkbenchSidebar.jsx`
- chart data freshness/source labeling now flows through `useResearchBarModel` in `src/research/hooks/useResearchChartModel.js`
- header/status UI ownership now flows through `src/components/research/ResearchWorkbenchHeader.jsx`
- chart-shell UI ownership now flows through `src/components/research/ResearchWorkbenchChartPanel.jsx`
- analysis-shell lazy loading now flows through `src/components/research/ResearchWorkbenchInsightsPanel.jsx`
- insights body ownership now flows through `src/components/research/insights/`
- sidebar section ownership now flows through `src/components/research/sidebar/`

## What The Workbench Owns Today

### 1. Synthetic fallback plus domain hooks

Research data, control state, and runtime orchestration are no longer inline in the main component.

It now lives in:

- `src/research/data/syntheticSpotBars.js`
- `src/research/config/strategyPresets.js`
- `src/research/hooks/useResearchControls.js`
- `src/research/hooks/useResearchExecution.js`
- `src/research/chart/displayModel.js`
- `src/research/hooks/useResearchApiCreds.js`
- `src/research/hooks/useResearchSpotHistory.js`
- `src/research/hooks/useResearchOptionReplay.js`
- `src/research/hooks/useResearchWorkbenchViewModel.js`

Inside `src/components/ResearchWorkbench.jsx`:

- child shell composition

Implication:

- the component no longer owns the synthetic fallback dataset
- provider, control, runtime, and shell-view composition are now separated from the workbench shell
- the next decomposition target is breaking down the larger child shells, not thinning the parent further

### 2. Runtime ownership is now centralized

The active run path now uses the extracted runtime only, but through a dedicated hook boundary:

- `src/research/hooks/useResearchExecution.js`
- composed into the workbench at `src/components/ResearchWorkbench.jsx:216`

Implication:

- pricing, regime detection, backtesting, and optimization now have one source of truth
- the next problem is UI-shell decomposition, not engine duplication

### 3. Custom charting surface

The chart subsystem is now extracted into `src/components/research/TVSpotChart.jsx`.

Responsibilities inside that chart:

- resize handling
- zoom/pan state
- custom candle rendering
- VWAP/BB/MACD overlays
- SMC structure rendering
- entry/exit marker rendering
- strategy-aware regime shading
- floating tooltip and navigator
- strategy dashboard mini-panel

Implication:

- the chart is now a separate rendering subsystem
- the next chart-level decision is whether to keep custom SVG maintenance or replace parts of it with a smaller reusable chart package later

### 4. Main workbench state

The main component now starts at `src/components/ResearchWorkbench.jsx:29`.

It no longer owns the full state blob directly.

The largest state groups now live in:

- `src/research/hooks/useResearchControls.js`
- `src/research/hooks/useResearchExecution.js`
- `src/research/hooks/useResearchSpotHistory.js`
- `src/research/hooks/useResearchOptionReplay.js`

State categories mixed together:

- shell-level prop wiring
- lazy analysis panel composition

Implication:

- stable domain boundaries now exist for controls, data loading, and execution
- the remaining problem is that the workbench still acts as the top-level composition shell

### 5. Hidden or dead settings/data surface

This status changed on 2026-03-10.

What is true now:

- the dead internal settings branch has been removed from `src/components/ResearchWorkbench.jsx`
- provider credentials are managed in Accounts, not inside Research
- the active sidebar now exposes:
  - symbol loading
  - modeled vs replay execution mode
  - option contract inputs
  - historical option contract loading
  - a direct jump back to Accounts for credential management

Implication:

- the replay path is now product-visible
- the remaining issue is decomposition, not reachability

## What The User Can Actually Do Today

In the active dashboard branch:

- choose strategy and risk parameters in the left sidebar
- switch between modeled execution and real option-history replay
- load broker-backed spot bars for a selected symbol, with Yahoo fallback if broker history is unavailable
- load a specific historical option contract for replay pricing
- adjust schedule and trading-day filters
- inspect the custom chart
- review KPIs, equity, analysis, recommendations, optimizer output, and the trade log through the extracted results panel

What the user cannot reliably do from the active branch:

- configure provider credentials from this surface
- run connection tests from this surface

That means the workspace is now functionally integrated enough to use the replay path, but it is still structurally too large.

## Architecture Mismatches

### Product mismatch

The product goal is one comprehensive backtesting area.

The current code still mixes:

- research product UI
- market data shell wiring
- header/chart composition
- chart rendering

These should not all live in one React component.

### Runtime mismatch

The runtime extraction is effectively complete.

The remaining runtime-adjacent coupling is:

- chart-range aggregation decisions in the UI file
- recommendations/optimizer presentation decisions in the results panel

### Navigation mismatch

The app-level Research navigation is already simplified to one top-level `Backtest` workspace in `src/App.jsx:53`.

But inside the workbench there is still an internal mental model of:

- dashboard
- recommendations
- optimizer
- log

Those are now active analysis panes, not dead top-level workbench modes.

### Ownership mismatch

The header says settings moved to Positions & Accounts at `src/components/ResearchWorkbench.jsx:278`.

That ownership is now correct in the product, but the workbench still holds some account-adjacent data-loading concerns that should move into dedicated hooks.

## Current Dependency Boundaries

The active workbench depends on:

- `src/research/engine/runtime.js`
- `src/research/options/history.js`
- `src/research/options/optionTicker.js`
- `src/lib/brokerClient.js`
- `window.storage`
- browser `fetch`
- `corsproxy.io` for Yahoo access
- `recharts`

Important implication:

- spot data loading is still browser-driven and proxy-dependent
- option replay is provider-backed and now exposed in the active workspace
- credentials are sourced from Accounts, but the workbench still hydrates them at runtime

## Safe Decomposition Target

The workbench should become a thin composition shell over explicit research modules.

### Target domain contracts

Add explicit app-native contracts:

- `StrategySpec`
- `StrategyTemplate`
- `DatasetSpec`
- `ExecutionSpec`
- `BacktestRun`
- `OptimizationRun`
- `RecommendationMatrix`

Recommended folder:

- `src/research/contracts/`

### Target hook boundaries

Recommended hooks:

- `useResearchControls`
- `useResearchStorage`
- `useSpotDataset`
- `useOptionReplayDataset`
- `useBacktestRun`
- `useOptimizerRun`
- `useRecommendationMatrix`

Recommended folder:

- `src/research/hooks/`

### Target UI boundaries

Recommended component split:

- `src/components/research/ResearchWorkbenchShell.jsx`
- `src/components/research/StrategyControlsPanel.jsx`
- `src/components/research/DataControlsPanel.jsx`
- `src/components/research/ChartPanel.jsx`
- `src/components/research/EquityPanel.jsx`
- `src/components/research/AnalysisTabs.jsx`
- `src/components/research/OptimizerPanel.jsx`
- `src/components/research/TradeLogPanel.jsx`

### Target infrastructure ownership

Move out of the workbench:

- credentials editing
- provider connection tests
- env export helpers

These belong in Accounts or a shared integration settings area, not in the research workspace component.

## Recommended Phases

### Phase 1: Remove dead duplicate engine code

Status:

- completed on 2026-03-10

Goal:

- make the extracted runtime the only engine implementation

Work:

- remove the duplicate local engine/math block from `src/components/ResearchWorkbench.jsx`
- keep only synthetic data helpers that are still intentionally UI-owned
- import any still-needed helpers from `src/research/engine/runtime.js`

Exit criteria:

- there is one source of truth for pricing, regime detection, backtesting, and optimization

### Phase 2: Make the data path reachable in the active workspace

Status:

- completed on 2026-03-10

Goal:

- expose real data and real option replay controls in the actual active UI

Work:

- remove the dead `appTab` branch model
- pull the useful parts of the unreachable settings/data section into an active `Data` panel
- leave credentials management out of this phase unless absolutely required for option replay

Exit criteria:

- users can actually choose execution mode and load an option replay contract from the visible research workspace

### Phase 3: Split state by domain

Goal:

- replace the 51-state local blob with grouped domain hooks

Work:

- move strategy/risk/schedule inputs into `useResearchControls`
- move storage persistence into `useResearchStorage`
- move spot/quote loading into `useSpotDataset`
- move option replay loading into `useOptionReplayDataset`

Exit criteria:

- `ResearchWorkbench` mostly composes hook outputs instead of owning raw state

### Phase 4: Extract the chart subsystem

Goal:

- isolate the 700+ line chart surface as its own component package

Work:

- move `TVSpotChartInner`, `ChartErrorBoundary`, and `TVSpotChart` out of the workbench file
- keep the chart API narrow:
  - `bars`
  - `trades`
  - `strategy`
  - `studies`
  - `symbol`

Exit criteria:

- the workbench no longer embeds low-level SVG rendering logic

### Phase 5: Split results and analysis panels

Status:

- partially completed on 2026-03-10

Goal:

- separate execution from analysis presentation

Work:

- extract KPI/equity panel
- extract tabbed analysis panel
- extract optimizer results panel
- extract trade log panel
- remove `recharts` from the main `ResearchWorkbench` module path

Exit criteria:

- result surfaces become presentational consumers of a shared `BacktestRun`

### Phase 6: Remove settings/test infrastructure from Research

Goal:

- align ownership with product intent

Work:

- delete the unreachable settings tab branch
- move credential editing and provider testing to Accounts or a shared integration settings module
- keep only data selection and run configuration inside Research

Exit criteria:

- the research workspace contains research functionality, not platform administration

### Phase 7: Introduce canonical run/session contracts

Goal:

- make analysis, optimization, publishing, and future compare flows operate on the same model

Work:

- formalize `BacktestRun`, `OptimizationRun`, and `DatasetSpec`
- route current tabs/panels through those contracts
- prepare publish-to-Trade integration on the same run object

Exit criteria:

- Trade overlays and Research analysis can consume the same run model later without another rewrite

## Recommended Implementation Order

If we want the least risky path, the order should be:

1. split hooks by domain
2. extract the chart package
3. extract the remaining shell panels
4. add canonical run/session contracts
5. keep shrinking the remaining shell ownership footprint

That order matters because the engine duplication is already gone; the next risk is hidden and mixed UI ownership.

## Non-Goals For The Next Slice

Do not combine these with the first decomposition slice:

- full strategy builder
- run history library
- saved snapshot system redesign
- Trade workspace publish integration
- backend migration for Yahoo or provider orchestration

Those are valuable, but they should come after the workbench is structurally legible.

## Immediate Next Step

The next implementation slice should be:

- extract the custom chart subsystem into `src/components/research/`
- preserve the current visible dashboard behavior
- then begin splitting the remaining state into data, controls, and execution hooks

That keeps the workbench behavior stable while attacking the largest remaining inline subsystem.
