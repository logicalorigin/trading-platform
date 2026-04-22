# Research Backtesting Integration Plan

Updated: 2026-03-10T21:30:49Z

## Objective

End state:

- no separate legacy engine concept in the product
- one native Research backtesting area inside the app
- broader strategy definition than the current fixed strategy list
- real-data workflows for both spot and options
- integrated compare/combined and optimization tooling on the same run model

This is not just a rename. It is a product and architecture consolidation.

## What Exists Today

### Current strengths

- `Research` now has one integrated top-level backtest workspace in `src/App.jsx`.
- The repo already has a working in-browser backtest engine in `src/components/ResearchWorkbench.jsx`.
- The app already exposes:
  - spot bars via `/api/market/bars`
  - option chain data via `/api/options/chain`
  - option contract lookup via `/api/options/contracts`
  - historical option bars via `/api/backtest/options/massive/bars`

### Current blockers

1. The workbench is still the only real research runtime.
   - It owns controls, data loading, pricing, backtest logic, optimizer logic, recommendation logic, and rendering.

2. Strategies are hard-coded.
   - The current engine switches between a fixed list of strategy names such as `momentum_breakout`, `sweep_reversal`, `ema_stack`, and `bb_squeeze`.
   - That is useful for presets, but it is not a broader strategy-definition system.

3. The current engine is still mostly spot-driven.
   - It evaluates signals on underlying bars and prices options with a model.
   - That means it is not yet a first-class spot-plus-options research system.

4. Compare and optimize are still too tightly embedded in the main workbench.
   - The old top-level tabs are gone, but these capabilities still need cleaner internal boundaries and reusable run contracts.

5. The Trade workspace no longer consumes separate static backtest data.
   - The stale `src/data/v4_results.json` overlay path was removed from `src/components/MarketDashboardTab.jsx`.

6. The workbench is still too monolithic in code structure.
   - Naming cleanup is complete, but the runtime still needs deeper extraction into app-native modules.

## Product Target

The Research area should become a single cohesive backtesting product with five capabilities:

1. Strategy definition
   - define a broad strategy, not just choose one preset
   - preserve current presets as templates

2. Dataset definition
   - choose symbol, date range, resolution, broker/provider, and backtest mode
   - make source provenance explicit

3. Backtest execution
   - run against real spot data first
   - support real option-history mode where data exists

4. Analysis and comparison
   - review trades, equity, exits, regimes, attribution, and saved snapshots

5. Optimization
   - sweep parameter ranges on the same strategy and dataset
   - apply a selected optimizer result back into the same research session

## Target UX

The final Research area should read like one product, for example:

- `Backtesting`
  - `Strategy`
  - `Data`
  - `Results`
  - `Compare`
  - `Optimize`

Or, if you want to keep the current top-level labels:

- `Backtest`
  - run builder + results
- `Combined`
  - comparison and saved runs
- `Optimizer`
  - parameter sweep and apply-back flow

Either way, these must sit on one shared research model. The user should never wonder whether they are viewing a different engine.

## Canonical Domain Model

### `ResearchSession`

Own one canonical session for the entire Research area:

- `strategySpec`
- `datasetSpec`
- `executionSpec`
- `latestBacktestRun`
- `latestOptimizationRun`
- `savedSnapshots`
- `publishedOverlay`

### `StrategySpec`

This is the major product upgrade.

Instead of only selecting a named strategy, define a strategy in structured blocks:

- signal family
  - trend
  - reversal
  - breakout
  - custom composite
- entry conditions
  - EMA relationships
  - RSI thresholds
  - VWAP dislocation
  - structure / sweep / order block / FVG filters
  - volume filters
- contract selection
  - DTE target or range
  - call / put / both
  - ATM / delta-target / strike offset
- exits
  - stop loss
  - take profit
  - trailing logic
  - time exit
  - expiry enforcement
- sizing
  - fixed
  - Kelly-based
  - max capital allocation
- filters
  - regime
  - session window
  - weekdays
  - volatility bucket

Current named strategies become saved presets that populate this model.

### `DatasetSpec`

- underlying symbol
- date range
- bar resolution
- spot data source
- option data source
- mode
  - `spot_proxy`
  - `option_history`

### `BacktestRun`

- strategy spec snapshot
- dataset spec snapshot
- mode
- source metadata
- trades
- equity curve
- metrics
- attribution
- chart overlays

### `OptimizationRun`

- base strategy spec
- sweep dimensions
- ranked result rows
- selected row
- comparison metrics

## Data Architecture Plan

### Spot data

Use the existing market bars route as the primary app-native spot source:

- `GET /api/market/bars`
- client wrapper: `getMarketBars()` in `src/lib/brokerClient.js`

This should replace the current browser-only Yahoo path as the preferred research default where broker data is available.

### Option metadata

Use the existing option discovery routes:

- `GET /api/options/chain`
- `GET /api/options/contracts`
- `GET /api/options/contracts/:id`

This gives the backtesting area contract identity, strikes, expiries, and chain context.

### Historical option prices

Use Massive as the first real option-history backend:

- `GET /api/backtest/options/massive/bars`
- client wrapper: `getMassiveOptionBars()`

This is the clearest path to real option-history backtesting without waiting for every broker adapter to support historical option candles.

### New backend work likely required

The app will need one research-oriented backend layer above the existing primitives:

- resolve a strategy's contract-selection rule into specific contract sequences over time
- map underlying timestamps to option instruments for the selected DTE/strike rule
- fetch and cache the relevant option bars
- return one normalized dataset payload to the frontend engine

Without that layer, the UI will stay fragmented across separate spot, chain, and option-history APIs.

## Execution Model Plan

Support two explicit backtest modes.

### Mode 1: `spot_proxy`

Use real underlying bars plus option pricing/model assumptions.

Purpose:

- faster iteration
- broader strategy exploration
- works even when historical option bars are not available for every contract path

This is the natural evolution of the current engine.

### Mode 2: `option_history`

Use real underlying bars for signals plus real option bars for entry/exit valuation.

Purpose:

- higher-fidelity validation
- real contract path testing
- realistic spread / fill / decay behavior

This should become the premium validation mode.

### Why two modes

You want both breadth and realism:

- broad strategy exploration is easier and cheaper in `spot_proxy`
- serious validation should graduate into `option_history`

The optimizer should be able to run in both modes, with clear warnings about cost and runtime.

## Naming And Product Integration

Goal:

- remove the old engine branding from user-facing language
- move the implementation onto app-native research modules after extraction is complete

Recommended sequence:

1. extract the runtime and state first
2. move the UI onto app-native research modules
3. rename the component/file last

Do not start with a blind file rename. That creates churn without solving the integration problem.

Probable final names:

- component: `ResearchWorkbench.jsx`
- shared state: `ResearchProvider`
- engine modules:
  - `research/engine/backtestEngine.js`
  - `research/engine/optimizerEngine.js`
  - `research/engine/strategyCompiler.js`
  - `research/data/*`

## Recommended Phases

### Phase 0: Freeze the product target

- Lock the vocabulary:
  - `Research`
  - `Backtesting`
  - `Compare`
  - `Optimize`
- Decide whether `Combined` remains a label or becomes `Compare`.
- Keep current presets as templates, not as the only strategy system.

Exit criteria:

- agreed product names
- agreed tab structure
- agreed distinction between `spot_proxy` and `option_history`

### Phase 1: Extract the engine from `ResearchWorkbench`

- Pull pure logic out of `src/components/ResearchWorkbench.jsx`:
  - pricing helpers
  - regime detection
  - strategy evaluation
  - backtest execution
  - optimization execution
  - metrics
- Keep the existing UI behavior intact while doing this.

Exit criteria:

- `ResearchWorkbench.jsx` becomes an orchestrator, not the engine itself
- core research logic is reusable by other surfaces

### Phase 2: Introduce shared Research state

- Add a `ResearchProvider` scoped to the Research area.
- Store:
  - current strategy spec
  - current dataset spec
  - current execution mode
  - latest run
  - latest optimizer results
  - saved snapshots

Exit criteria:

- backtest, compare, and optimizer tabs all see the same active session

### Phase 3: Replace hard-coded strategy selection with a strategy builder

- Represent strategies as structured config, not string switches.
- Preserve current strategies as:
  - templates
  - examples
  - optimizer seeds

This is the step that unlocks "test out a broader strategy."

Exit criteria:

- a user can define or edit entry, exit, contract-selection, and filter rules without adding a new hard-coded strategy branch

### Phase 4: Build the real-data layer for backtesting

- Replace the Research area's default data path with app-native services.
- Spot path:
  - use `/api/market/bars`
- Option metadata path:
  - use `/api/options/chain` and `/api/options/contracts`
- Option history path:
  - use `/api/backtest/options/massive/bars`

Add source metadata to every run:

- provider
- account/broker if relevant
- live-native vs fallback/demo
- valuation mode

Exit criteria:

- every run reports exactly what data source it used
- Research no longer silently falls back to ambiguous datasets

### Phase 5: Support both backtest execution modes

- Stabilize `spot_proxy` first using the extracted engine.
- Add `option_history` execution on top of the same run model.
- Make the UI explicit about the tradeoff:
  - speed vs fidelity

Exit criteria:

- a strategy can be run in fast proxy mode and then validated in real option-history mode

### Phase 6: Rebuild Compare and Optimize on the shared model

- Replace `CombinedDashboard.jsx` static arrays.
- Replace `OptimizerDashboard.jsx` static arrays.
- Feed both from `ResearchProvider`.

Compare should support:

- latest run vs pinned snapshot
- run A vs run B
- mode A vs mode B
- source A vs source B

Optimize should support:

- parameter ranges over a structured strategy spec
- apply selected row back into the active strategy spec

Exit criteria:

- Compare and Optimize are no longer separate demo dashboards

### Phase 7: Publish research outputs into the Trade workspace

- Completed cleanup step: removed the stale `v4_results.json` path from `MarketDashboardTab.jsx`.
- Replace it with the selected/published research run overlay.
- Allow the user to publish:
  - latest run
  - pinned snapshot
  - selected optimizer result

Exit criteria:

- the Trade workspace reflects the same run produced in Research

### Phase 8: Remove legacy engine references completely

- rename the component/file
- rename lazy imports in `src/App.jsx`
- remove old comments, labels, docs, and recovery references
- delete dead static/demo paths no longer used

Exit criteria:

- no leftover legacy engine naming remains

## Risks To Avoid

1. Do not start with a UI rewrite.
   - The hard part is the model, not the paint.

2. Do not mistake naming cleanup for architecture cleanup.
   - The harder problem is decomposition, not the filename.

3. Do not skip the strategy-spec layer.
   - Without it, the backtesting area stays limited to a fixed strategy menu.

4. Do not pretend proxy pricing and real option-history backtests are the same thing.
   - Both are useful, but they must be clearly labeled.

5. Do not leave Trade and Research on separate backtest data models.
   - The overlay path must be fed from the same run object.

## Recommended First Implementation Slice

If we want the safest path that moves directly toward your end goal:

1. extract the engine and run contracts from `ResearchWorkbench.jsx`
2. add `ResearchProvider`
3. change Backtest, Combined/Compare, and Optimizer to consume shared state
4. convert current named strategies into structured preset objects
5. wire spot data through `/api/market/bars`
6. then build the option-history mode using Massive

That gives you a real integrated backtesting area before we spend time on final naming cleanup.

## Definition Of Done

The project is done when all of this is true:

- Research contains one cohesive backtesting product
- there is no separate legacy engine concept in code or UI
- strategies are defined through a broader strategy model, not only a fixed switch statement
- runs can use real spot data and, where available, real option-history data
- compare and optimize operate on the same research session and run objects
- Trade overlays come from a published research run, not static JSON

## Immediate Open Decisions

1. Keep `Combined` as the label, or rename it to `Compare`?
2. Should `option_history` be optional beta at first, with `spot_proxy` as the default?
3. Should published overlays update the Trade workspace automatically, or only on explicit publish?
4. Do you want the first strategy-builder pass to be:
   - guided form-based only
   - or form-based plus raw JSON/advanced editor?
