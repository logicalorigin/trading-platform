# Signal Age Late Discovery Audit - 2026-05-29

## Layman Summary

The Age column in the Signals to Actions table is not quote age. It is how many completed chart bars have passed since the underlying Pyrus signal bar.

The main bug was a double wait:

1. The signal monitor already loaded only completed bars.
2. It then called the signal engine with `includeProvisionalSignals: false`.
3. The signal engine treated the newest completed bar as off limits.
4. Result: a signal could not show up at Age 0. The earliest normal table appearance was Age 1, one full bar late.

On a 5 minute profile, that meant the table often saw a signal about 10-15 minutes after the signal bar started, instead of shortly after the signal bar closed.

## Live Audit Findings

- Paper signal monitor profile was using `timeframe: 5m`, `freshWindowBars: 8`, `pollIntervalSeconds: 60`, `maxSymbols: 60`, `evaluationConcurrency: 2`.
- Recent Signals to Actions rows were all marked fresh, but their ages ranged from 1 to 8 bars.
- Recent entry events included trades as old as Age 8.
- Entry event lag by bars:
  - Age 1: average about 15 minutes after signalAt.
  - Age 4: average about 30 minutes after signalAt.
  - Age 8: average about 49 minutes after signalAt.
- Signal monitor events showed most normal events had `latestBarAt = signalAt + one bar`, proving the one-bar wait.

## Code Fix

- `artifacts/api-server/src/services/signal-monitor.ts`
  - Signal monitor now evaluates the newest completed bar by passing `includeProvisionalSignals: true`.
  - This is safe because the monitor has already filtered out active/incomplete bars before calling the signal engine.

- `artifacts/api-server/src/services/signal-options-automation.ts`
  - Split table visibility from trading eligibility.
  - Fresh signals remain visible in the table for audit.
  - Only Age 0 signals are eligible for new action candidates.
  - Older fresh signals carry `actionEligible: false` and `actionBlocker: "signal_too_old"`.
  - API now carries `freshWindowBars` through to the UI so `5/8 bars` displays against the real profile window instead of the frontend fallback.

- `artifacts/pyrus/src/screens/algo/OperationsSignalRow.jsx`
  - Old fresh signals are no longer presented as if they are just waiting for a scan.
  - They show the signal-age blocker and lose the hot/fresh visual treatment.

## Validation

- `pnpm --filter @workspace/api-server exec node JS validation runner src/services/signal-monitor.validation.ts src/services/signal-options-automation.validation.ts`
- `pnpm --filter @workspace/pyrus exec node JS validation runner src/screens/algo/algoHelpers.validation.js src/screens/algo/OperationsSignalRow.validation.js`
- `pnpm --filter @workspace/api-server typecheck`
- `pnpm --filter @workspace/pyrus typecheck`

All passed.

## Remaining Watch Item

This fixes the extra bar wait in the code. If live rows still arrive at Age 1 or higher after restart, the next likely cause is operational delay: too many symbols for the monitor cadence/concurrency, worker deferral under resource pressure, or stale broker history. The specific metric to watch is the share of new signal monitor events where `barsSinceSignal` is 0.
