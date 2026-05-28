# Flow Scanner Professional Coverage Fix

- Date: 2026-05-28
- Scope: Pyrus / API flow scanner coverage, diagnostics, and runtime readout.
- Startup config: not touched.
- App processes: not killed or restarted.

## Problem

The flow scanner could still look degraded or inert after the earlier pressure/OOM correction because the broad backend scan path was not operating like a professional scanner:

- Radar-promoted broad scanning was default-off.
- Direct scanner rotation was too slow for a 500-symbol active universe.
- Automation-only global pressure could still label or throttle the flow scanner.
- Radar quote failures had no local containment/readout.
- Scanner diagnostics mixed radar, deep scanner, after-hours quiet, and lagging active-session coverage into ambiguous states.
- The lower-corner runtime readout did not surface coverage progress or lag clearly enough.

## Changes

- Enabled radar-promoted scanning by default.
- Preserved active-session broad coverage target: 30-symbol radar batches every 15 seconds, covering 500 symbols in under 5 minutes by default.
- Added scanner-specific pressure gating:
  - Ignores `automation` pressure drivers for scanner throttling.
  - Still honors hard resource blocks.
  - Still throttles for non-automation high/critical pressure.
- Added radar quote failure containment:
  - Batch quote hydration failures retry per symbol.
  - Full radar quote failure opens a short local radar backoff.
  - The shared quotes governor is not opened by radar sampling failures.
  - Coverage diagnostics expose radar last error/failure count/run duration.
- Expanded coverage diagnostics:
  - `scannerPhase`: `radar`, `deep`, `blocked`, or `idle`.
  - `coverageHealth`: `healthy`, `lagging`, `quiet`, or `blocked`.
  - `marketSessionQuiet`, `lastScanAgeMs`, `coverageTargetMs`, radar cadence, and radar failure metadata.
- Updated Pyrus runtime readouts:
  - After-hours quiet now includes coverage detail.
  - Active-session lag reports coverage count and last scan age.
  - Flow page degrades explicitly on lagging broad scanner coverage.
  - Settings shows scanner coverage and estimated cycle/last scan age.

## Validation

- Passed: `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/options-flow-scanner.test.ts src/services/ibkr-line-usage.test.ts` (`87` tests).
- Passed: `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/platform/runtimeControlModel.test.js src/features/platform/platformRootSource.test.js` (`87` tests).
- Passed: `pnpm --filter @workspace/api-server run typecheck`.
- Passed: `pnpm --filter @workspace/pyrus run typecheck`.
- Passed: `pnpm --filter @workspace/api-server run build`.
- Passed: `pnpm --filter @workspace/pyrus run build`.
- Passed: scoped `git diff --check`.

## Follow-Up

After the app picks up the rebuilt code through the normal Replit runner or dev hot reload:

- Check `/api/diagnostics/runtime` for `optionsFlowScanner.coverage.coverageHealth`.
- Check `/api/settings/ibkr-line-usage` for scanner pressure readout and confirm automation-only pressure does not produce scanner degradation.
- Watch the lower-corner runtime readout:
  - Outside regular trading hours: should show quiet state with coverage detail.
  - During regular trading hours: should only show lagging when estimated broad coverage exceeds the 5-minute target.
