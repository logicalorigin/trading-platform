# Synthetic/Fallback Data Inventory (2026-03-06)

This is a code-level audit of synthetic, fallback, and derived data paths that can affect UI values.

## Priority 0: Account Equity / PnL Accuracy (must remove first)

1. Runtime account summary math in store (hardcoded baseline values)
   - `server/state/store.js:806`
   - `buildAccountSummary()` computes:
     - `equity = 25000 + unrealizedPnl`
     - `buyingPower` fallback from `100000`
   - Impact: if broker summary is unavailable, account values become synthetic.

2. Broker summary fallback to store summary
   - `server/brokers/etradeAdapter.js:218`
   - `server/brokers/ibkrAdapter.js:99`
   - `server/brokers/webullAdapter.js:268`
   - Each path can return `super.getAccountSummary(account)` (store-based synthetic baseline) when live calls fail.

3. Derived ledgers/trades in performance model
   - `server/services/performanceModel.js:62`
   - `server/services/performanceModel.js:72`
   - `server/services/performanceModel.js:365`
   - `server/services/performanceModel.js:430`
   - If native cash ledger/closed trades are absent, app derives:
     - cash ledger from equity deltas
     - synthetic closed trades (`tradeId: derived-*`, symbol `"MULTI"`)
   - Impact: can show non-broker historical PnL/trade rows.

4. Benchmark fallback series normalization
   - `server/services/performanceModel.js:730`
   - Uses fallback series when benchmark payload is empty.
   - Impact: benchmark can render from substituted series, not true benchmark feed.

5. Direct summary endpoint can still expose fallback summaries
   - `server/routes/api.js:770`
   - `/api/accounts/:id/summary` calls adapter summary directly, no strict live-source guard.

6. Live positions can remain stale when broker returns empty/timeout
   - `server/brokers/etradeAdapter.js:206`
   - `server/brokers/ibkrAdapter.js:86`
   - `server/brokers/webullAdapter.js:231`
   - Each adapter falls back to `super.getPositions(account)` (persisted runtime state).
   - `server/routes/api.js:2438`
     - `syncPositionsForRequest()` keeps existing persisted positions for live/authenticated accounts when normalized live rows are empty (`keepExistingRows`).
   - Impact: can show old positions that are not current broker state.

## Priority 1: Market/Options Data Synthetic Paths (feeds charts and chain)

7. Base synthetic market/chain generator
   - `server/brokers/BrokerAdapter.js:96`
   - `server/brokers/BrokerAdapter.js:115`
   - `server/brokers/BrokerAdapter.js:194`
   - `server/brokers/BrokerAdapter.js:222`
   - `server/brokers/BrokerAdapter.js:251`
   - `server/brokers/BrokerAdapter.js:294`
   - `server/brokers/BrokerAdapter.js:364`
   - Includes synthetic:
     - spot quote
     - OHLCV bars
     - depth/ticks/footprint/order-flow
     - option chain pricing/greeks/oi/volume

8. E*TRADE fallbacks
   - `server/brokers/etradeAdapter.js:525` (`etrade-fallback` spot)
   - `server/brokers/etradeAdapter.js:547` (`etrade-fallback` option chain)
   - `server/brokers/etradeAdapter.js:662` (`etrade-fallback-bars`)
   - `server/brokers/etradeAdapter.js:588` (`etrade-live-anchored` bars still based on synthetic bar scaffold)

9. IBKR fallbacks (spot/bars remain) + native-only options chain
   - `server/brokers/ibkrAdapter.js:250` (`ibkr-fallback` spot)
   - `server/brokers/ibkrAdapter.js:445` (`ibkr-fallback-bars`)
   - `server/brokers/ibkrAdapter.js:255` (`getOptionChain`) now returns:
     - `ibkr-live-options` (native secdef + snapshot quotes)
     - `ibkr-live-options-contracts` (native contract rows with incomplete quote fields)
     - `ibkr-live-options-unavailable` (empty rows; no synthetic `super.getOptionChain` fallback)

10. Webull fallbacks (spot/bars/depth/ticks/footprint remain) + native-only options chain
   - `server/brokers/webullAdapter.js:473` (`webull-fallback-spot`)
   - `server/brokers/webullAdapter.js:506` (`webull-fallback-bars`)
   - `server/brokers/webullAdapter.js:614` (`webull-fallback-depth`)
   - `server/brokers/webullAdapter.js:664` (`webull-fallback-ticks`)
   - `server/brokers/webullAdapter.js:700` (`webull-fallback-footprint`)
   - `server/brokers/webullAdapter.js:523` (`getOptionChain`) now returns:
     - `webull-live-options` (native chain rows with quotes)
     - `webull-live-options-contracts` (native contract rows with incomplete quote fields)
     - `webull-live-options-unavailable` (empty rows; no synthetic `super.getOptionChain` fallback)

11. API endpoints that directly surface these synthetic/fallback payloads
    - `server/routes/api.js:1523` (`/api/market/spot`)
    - `server/routes/api.js:1540` (`/api/market/bars`)
    - `server/routes/api.js:1571` (`/api/market/depth`)
    - `server/routes/api.js:1593` (`/api/market/ticks`)
    - `server/routes/api.js:1615` (`/api/market/footprint`)
    - `server/routes/api.js:1642` (`/api/market/order-flow`)
    - `server/routes/api.js:1675` (`/api/options/chain`)

## Priority 2: UI/Frontend Static or Synthetic Data

12. Portfolio workspace static backtest dataset was removed from the live UI
    - `src/components/MarketDashboardTab.jsx` no longer imports bundled result JSON for chart overlays.

13. Historical Research synthetic generator + fallback mode was removed from the mounted UI on 2026-03-20
    - `src/research/data/syntheticSpotBars.js` was deleted during dead-code cleanup.
    - `src/components/ResearchWorkbench.jsx` no longer defines `generateBars` or a default `"synthetic"` data source.
    - Remaining non-live Research behavior should now be audited in hook/service fallbacks instead of a bundled synthetic chart dataset.

14. Static data files
    - `src/data/v4_results.json` and `src/data/v3_results.json` were removed during dead-code cleanup.

15. Backtest tab in the main app still mounts `ResearchWorkbench`, but not bundled static result files or synthetic chart arrays
    - `src/App.jsx`
    - `Backtest` loads `ResearchWorkbench` (`src/components/ResearchWorkbench.jsx`) through the current hook-driven workbench shell.
    - Static `src/data/v3_results.json`, `src/data/v4_results.json`, and the old synthetic spot-bar fallback are no longer part of the mounted Backtest surface.

## Priority 3: AI/Decision Context Synthetic Mode

16. AI fusion dry-run mode and fallback
    - `server/state/store.js:34` (default provider `"dry-run"`)
    - `server/services/aiFusionWorker.js:249`
    - `server/services/aiFusionWorker.js:267`
    - `server/services/aiFusionProvider.js:497`
    - Impact: synthetic context for AI fusion outputs when dry-run or fallback is active.

## Persisted Runtime State Findings

From `server/data/runtime-state.json` source-tag count scan:

- `2142` rows: `etrade-summary` (legacy/non-current source tag; provenance unclear)
- `1948` rows: `ibkr-summary` (legacy/non-current source tag; provenance unclear)
- `628` rows: `etrade-live-summary`
- `492` rows: `webull-derived-options` (derived from synthetic option chain scaffold)
- `488` rows: `etrade-fallback`
- `262` rows: `etrade-live`
- `10` rows: `dry-run`

Notes:
- `webull-derived-options`, `etrade-fallback`, and `dry-run` are non-live/synthetic-derived categories.
- `etrade-summary` and `ibkr-summary` do not appear as active source literals in current adapter code and should be treated as legacy data requiring cleanup/revalidation.

## Commands Used (for reproducibility)

- `rg` scans across `server/` and `src/` for `synthetic|fallback|dry-run|derived|seed|mock|sample|dummy`
- focused `nl -ba` reads of:
  - `server/brokers/*.js`
  - `server/services/performanceModel.js`
  - `server/state/store.js`
  - `server/routes/api.js`
  - `src/components/*.jsx`
  - `src/lib/*.js`
- runtime-state source tag count via `node -e` JSON walk

## Recommended De-Syntheticization Order

1. Remove/disable store summary hardcoded baselines and adapter summary fallbacks for live-mode account routes.
2. Disable derived closed-trade/cash-ledger substitution in performance payloads unless explicitly requested.
3. Complete broker-native option chains:
   - Webull + IBKR native-only path is now in place (no `super.getOptionChain` synthetic fallback).
   - E*TRADE still has `etrade-fallback` option chain path to remove next.
4. Add strict route-level guard: reject/flag any payload whose source includes `synthetic|fallback|derived|dry-run` for live account/performance endpoints.
5. Keep static result bundles and synthetic chart datasets out of mounted workspace views; the stale `v4_results` overlay path and the old Research synthetic fallback were already removed during cleanup.
6. Purge/rebuild persisted runtime rows with legacy/non-live source tags.
