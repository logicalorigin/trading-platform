# Signals To Actions Density Handoff

- Last Updated (MT): `2026-05-29 17:56:27 MDT`
- Last Updated (UTC): `2026-05-29T23:56:27Z`
- Native Codex Session ID: `pending`
- Scope: Dense Signals to Actions table treatment and drilldown removal.

## Status

- Implemented dense Signals row/header layout matching the Positions table treatment:
  - `SIGNAL_TABLE_ROW_HEIGHT = 34`
  - `SIGNAL_TABLE_HEADER_HEIGHT = 24`
  - `1px 4px` cell padding, `1px 2px` action-cell padding
  - alternating row treatment via `ra-position-table-row--alt`
- Removed Signals table drilldown access from this surface:
  - no `TableExpandableRow`
  - no desktop inline drill content
  - no mobile `BottomSheet`
  - no `renderDrill` prop from `AlgoLivePage`
  - no blocked-row `Why?` drill action
- Kept in scope:
  - sorting, filters, pagination, column chooser
  - row submit action for opening the trade ticket
  - runtime quote/ticker hydration for Move and quote columns
- Follow-up implemented for signal row sparklines:
  - the first platform-level signal-monitor pin attempt was replaced
  - `OperationsSignalTable` now fetches `/api/bars` history for its current visible row symbols
  - fetched bars are thinned and published through `publishRuntimeTickerSnapshot(symbol, symbol, { sparkBars })`
  - existing row rendering now receives sparkline history through the runtime ticker cache for the actual visible table rows
- Follow-up implemented for Signals table content cleanup:
  - removed internal filler such as `not in action queue`, `monitor signal only`, and `blocked before quote`
  - Plan no longer appends Contract fallback/detail text
  - missing Contract, Quote, Greeks, clear Gate, and inactive Act cells render quietly
  - Signal hides the duplicate move value when the Move column is visible
  - Sync remains available in the column chooser but is migrated out of the default visible columns
  - table title corrected to `Signals to Actions`
- Follow-up implemented for signal-only blocked row presentation:
  - `Ready` now requires an actual unblocked action candidate
  - signal-level blockers such as `signal_too_old` classify under `Blocked`
  - missing spread data now renders as `--` instead of synthetic `0.0%`
  - blocked Plan cells are visually subdued instead of green/actionable-looking
- Follow-up implemented for read-only contract visibility:
  - API state now attaches `signal.contractPreview` for blocked signal-only Signals rows without creating executable candidates/events/orders
  - preview candidates reuse the same expiration, chain, strike-slot fallback, quote, liquidity, and order-plan logic as execution
  - current-bar actionability remains strict: only current-bar signals enter `state.candidates`; older fresh signals can still show a preview contract
  - preview lookups are capped at 12 blocked visible signals per state build and respect option bridge backoff instead of bypassing it
  - live post-restart check found a HOOD preview miss could hold the state endpoint for ~51s; preview resolution now aborts after 2s and backs off that signal for 60s
  - follow-up live check showed 2s per blocked signal is still too slow on a cold payload; preview attachment now has a 2s total state-payload budget, and remaining rows fall back with `contract_preview_timeout` plus backoff instead of paying 2s each
  - Signals rows use preview contract/quote/liquidity only when no real candidate contract exists, and render it muted with `Preview` detail
- Follow-up implemented for active preview quote hydration and scroll behavior:
  - Algo live quote grouping now includes `visibleSignalRows[].contractPreview.selectedContract` in addition to candidates, positions, and ledger positions
  - preview quote streams use `signal-options-preview:<deployment>:<underlying>` owners so IBKR admission/diagnostics classify them under signal-options line usage
  - duplicate preview contracts already covered by primary candidate/position streams are skipped
  - Signals table horizontal scrolling now lives on a dedicated `algo-signal-table-scroll` strip containing both header and rows; controls/footer stay outside the horizontal scroller
  - `AlgoScreen` now prefers non-empty cockpit arrays but falls back to non-empty automation state arrays so transient empty cockpit refreshes do not mask row/candidate data and flash contract cells back to selection

## Files Touched

- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/services/signal-options-automation.ts`
- `artifacts/api-server/src/services/signal-options-automation.validation.ts`
- `artifacts/api-server/src/services/market-data-admission.validation.ts`
- `artifacts/pyrus/src/features/platform/platformRootSource.validation.js`
- `artifacts/pyrus/src/screens/AlgoScreen.jsx`
- `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx`
- `artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx`
- `artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx`
- `artifacts/pyrus/src/screens/algo/OperationsSignalRow.validation.js`

## Validation

- Passed: `pnpm --filter @workspace/pyrus exec node JS validation runner src/screens/algo/OperationsSignalRow.validation.js src/screens/algo/algoHelpers.validation.js`
- Passed: `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "hidden-mounted Algo and Backtest queries require visible screen ownership" src/features/platform/platformRootSource.validation.js`
- Passed: `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "signal monitor symbols only join|visible watchlist" src/features/platform/platformRootSource.validation.js`
- Passed: `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "visible watchlist and open position" src/features/platform/platformRootSource.validation.js`
- Passed: `pnpm --filter @workspace/pyrus exec node JS validation runner src/screens/algo/OperationsSignalRow.validation.js`
- Passed: `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "signal table classifies|signal row spread display|signal row presents dense customizable|algo signal table builds matrix" src/screens/algo/OperationsSignalRow.validation.js`
- Passed: `pnpm --filter @workspace/pyrus exec node JS validation runner src/screens/algo/OperationsSignalRow.validation.js`
- Passed: `pnpm --filter @workspace/api-server exec tsx validation runner src/services/signal-options-automation.validation.ts --validation-name-pattern "fresh-but-aged signal snapshots|current-bar signal snapshots|signal-options state shows fresh signals"`
- Passed: `pnpm --filter @workspace/api-server run typecheck`
- Passed: `pnpm --filter @workspace/api-server run build`
- Passed: `pnpm --filter @workspace/pyrus run typecheck`
- Passed: `git diff --check -- artifacts/api-server/src/services/platform.ts artifacts/api-server/src/services/signal-options-automation.ts artifacts/api-server/src/services/signal-options-automation.validation.ts artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx artifacts/pyrus/src/screens/algo/OperationsSignalRow.validation.js SESSION_HANDOFF_LIVE_2026-05-29_signals-to-actions-density.md SESSION_HANDOFF_MASTER.md`
- Passed: dev-server source check for Signals content cleanup and Sync visibility migration.
- Blocked: `pnpm run typecheck` currently stops on an unrelated API-server error in `artifacts/api-server/src/services/sp500-constituents.ts`.
- Passed: targeted `git diff --check` for touched files.
- Dev-server source check at `http://127.0.0.1:18747` showed updated Signals row/table/live page source being served.
- Dev-server source check showed updated table-local `algo-signal-row-sparklines` query and `publishRuntimeTickerSnapshot` path being served.
- Dev-server source check showed updated Signals padding constants: regular cells `1px 4px`, action cells `1px 2px`.
- Browser DOM check showed Signals to Actions filters `All 1`, `Ready 0`, `Blocked 1`, `Unavailable 0`; row rendered `Policy / Signal Too Old`; Quote, Spread, and Greeks rendered `--`; Move hydrated to `+0.3% / +1.79` after quote hydration settled.
- Live API check after user restart hit `/api/algo/deployments/:id/signal-options/state?view=full`: response returned 2 signals (`HOOD` blocked, `AMBA` actionable) in ~51s before the timeout/backoff patch. HOOD preview returned unavailable `no_contract_for_strike_slot`, so no contract surfaced from that option-chain response.
- Live API follow-up on `PORT=8080` showed `view=summary` could still take ~10.2s with five blocked signals because the first patch applied 2s per signal. The source and rebuilt API dist now use a 2s total state-payload preview budget; the running API process appears to predate that rebuild and needs another Replit Run App restart for live verification.
- Post-restart verification at `2026-05-29 17:33:50 MDT`: rebuilt `dist/index.mjs` contains `SIGNAL_OPTIONS_CONTRACT_PREVIEW_STATE_BUDGET_MS`; `/api/algo/deployments` returned in 34ms; `/signal-options/state?view=summary` returned in 4ms then 1.236s after cache/backoff churn; `/signal-options/state?view=full` returned in 26ms; Vite proxy `/api/algo/deployments/:id/signal-options/state` returned the updated state shape. Current rows showed one actionable COHR candidate after refresh and blocked stale rows with preview timeout/backoff placeholders instead of spinning.
- Post-restart route check: default cockpit summary returned in 35ms; cockpit full returned in 2.269s; performance returned in 4ms; events returned in 13ms.
- Passed: `node JS validation runner src/screens/algo/OperationsSignalRow.validation.js src/screens/algo/algoHelpers.validation.js` from `artifacts/pyrus`.
- Passed: `node JS validation runner src/services/market-data-admission.validation.ts` from `artifacts/api-server`.
- Passed: `pnpm --filter @workspace/pyrus typecheck`.
- Passed: `pnpm --filter @workspace/pyrus build`.
- Passed: `git diff --check -- artifacts/pyrus/src/screens/algo/AlgoLivePage.jsx artifacts/pyrus/src/screens/algo/OperationsSignalTable.jsx artifacts/pyrus/src/screens/AlgoScreen.jsx artifacts/pyrus/src/screens/algo/algoHelpers.validation.js artifacts/pyrus/src/screens/algo/OperationsSignalRow.validation.js artifacts/api-server/src/services/market-data-admission.validation.ts`.

## Notes

- Running the entire `platformRootSource.validation.js` still has unrelated pre-existing failures in platform scheduler/trade assertions. The Signals-specific tests in that run passed.
- No Replit startup config files were touched.
- The restarted API is serving the total preview-budget change. `gstack browse` is not set up in this workspace (`NEEDS_SETUP`), so this post-restart pass used live API/Vite-proxy probes rather than a browser DOM snapshot.
- Broad package `unit validation` commands currently run much more than the requested file arguments in this workspace; direct `node validation runner` invocations were used for the touched files. The broad runs still show unrelated pre-existing failures outside this Signals work.
