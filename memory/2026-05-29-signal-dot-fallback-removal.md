# Signal Dot Fallback Removal

- Date: 2026-05-29
- Scope: Pyrus signal interval bubbles, header interval context, and watchlist signal sort/pill selection.

## Root Cause

The UI mixed two signal sources inside one visual contract. The 2m/5m/15m bubbles were supposed to prove hydration from the shared signal matrix, but `SignalDots` accepted a `fallbackState` and defaulted missing fallback timeframes to `5m`. That let 5m appear hydrated from the legacy `/signal-monitor/state` path while 2m and 15m still waited on matrix hydration.

The same pattern existed in header interval context and watchlist signal sorting/pill selection: legacy single-signal state could stand in when matrix state was missing.

## Fix

- `SignalDots` now reads only `statesByTimeframe`.
- Watchlist, Algo table, and Algo Monitor sidebar no longer pass interval fallback state into `SignalDots`.
- Header signal tape no longer turns the pill item into interval state.
- Watchlist signal sort/pill selection now ignores legacy monitor state when matrix state is missing.
- Suggested signal rows remain sourced from `/signal-monitor/state` for row discovery, but their 2m/5m/15m bubbles must hydrate through the matrix.

## Validation

- `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/headerBroadcastModel.validation.js src/features/platform/watchlistModel.validation.js src/features/platform/signalMatrixScheduler.validation.js`
- `pnpm --filter @workspace/pyrus exec node JS validation runner --validation-name-pattern "shared signal dots preserve watchlist behavior after extraction|algo signal table builds matrix" src/screens/algo/OperationsSignalRow.validation.js`
- `pnpm --filter @workspace/pyrus run typecheck`
- `git diff --check --` on the touched fallback-removal files
