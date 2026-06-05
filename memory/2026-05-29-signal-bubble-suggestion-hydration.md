# Signal Bubble Suggestion Hydration Debug Report

- Date: 2026-05-29
- Area: Pyrus platform signal matrix hydration

## Symptom

Some watchlist suggestion rows, especially monitored-only signal rows with an add-to-watchlist action, showed 5m signal state while 2m and 15m dots stayed pending much longer.

## Root Cause

There are two related causes:

1. The 5m dot has a persisted fallback path from `/api/signal-monitor/state`, whose profile timeframe is currently `5m`. The 2m and 15m dots do not have that fallback; they require `/api/signal-monitor/matrix`.
2. Matrix symbol ordering treated signal-monitor suggestion rows as ordinary monitor symbols after visible watchlist and open-position symbols. Under pressure, `signalMatrixNarrowSymbolLimit` caps the priority list and the scheduler caps each request (`watch: 6`, `high: 4`, etc.), so suggested rows beyond the cap did not get matrix work until pressure relaxed or the long rotation reached them.

## Fix

- Added `buildSignalMatrixSymbolSets` in `artifacts/pyrus/src/features/platform/signalMatrixScheduler.js`.
- The new symbol set builder promotes signal-monitor symbols that are not already in the active watchlist as `suggestedSignalSymbols`.
- `PlatformApp` now builds the matrix universe/priority sets through that helper, placing suggested signal rows before open-position spillover.
- The signal matrix diagnostic snapshot now includes `suggestedSignalSymbols`.

## Evidence

Current live payload facts without browser reload:

- `/api/signal-monitor/state?environment=paper` profile timeframe is `5m`.
- Default Core watchlist symbols: `SPY,NVDA,DIA,AAPL,MSFT,TSLA,TQQQ,SQQQ`.
- First signal-monitor suggested symbols include `LMT,CCJ,ISRG,CEG,ALAB,ACHR,COHR,PLTR`.
- With `narrowLimit: 16`, priority is now:
  `SPY,NVDA,DIA,AAPL,MSFT,TSLA,TQQQ,SQQQ,LMT,CCJ,ISRG,CEG,ALAB,ACHR,COHR,PLTR`.

## Regression Test

- `signal matrix symbol sets prioritize suggested signal rows before open-position spillover` in `artifacts/pyrus/src/features/platform/signalMatrixScheduler.validation.js`.

## Validation

- `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/signalMatrixScheduler.validation.js src/features/platform/watchlistModel.validation.js src/features/platform/headerBroadcastModel.validation.js`
- `pnpm --filter @workspace/pyrus run typecheck`
- `git diff --check -- artifacts/pyrus/src/features/platform/signalMatrixScheduler.js artifacts/pyrus/src/features/platform/signalMatrixScheduler.validation.js artifacts/pyrus/src/features/platform/PlatformApp.jsx artifacts/pyrus/src/components/platform/signal-language/SignalDots.jsx SESSION_HANDOFF_LIVE_2026-05-29_native-signal-matrix-hydration.md SESSION_HANDOFF_MASTER.md`

## Status

DONE_WITH_CONCERNS: The ordering bug is fixed and tested. The perceived 2m/15m lag versus 5m remains architecturally expected while 5m has a persisted fallback and 2m/15m depend on matrix evaluation under pressure caps.
