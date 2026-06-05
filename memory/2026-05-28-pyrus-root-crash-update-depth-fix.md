# Pyrus Root Crash: Maximum Update Depth

Date: 2026-05-28

## Symptom

The Pyrus workspace root crashed during boot with `Maximum update depth exceeded`. Early stacks showed Radix tooltip `setRef` / `TooltipTrigger`; later stacks named `src/screens/AlgoScreen.jsx:771` and `src/features/platform/PlatformApp.jsx:2529`.

## Root Cause

This was not one tooltip-only issue.

1. `HeaderStatusCluster.jsx` rendered an `AppTooltip` around `header-ibkr-line-usage` inside the outer IBKR header button. That put Radix tooltip trigger/ref composition inside an existing button and produced the invalid nested-button/ref loop seen in the first crash stacks.
2. `AlgoScreen.jsx` used fresh `[]` fallbacks for unresolved signal-options collections. The selected-candidate cleanup effect depended on `signalOptionsCandidates`; while data was unresolved, that dependency changed every render and kept dispatching `setSelectedCandidateId(null)`.
3. `PlatformApp.jsx` used fresh `[]` fallbacks for signal-monitor state/events. That destabilized derived signal-matrix symbol arrays. The signal-matrix pruning effect then called `setSignalMatrixSnapshot` with a fresh `states` array even when the logical state was unchanged.

## Fix

- Replaced the inline IBKR line-usage tooltip with native `title` and `aria-label`.
- Kept `AppTooltip` on Radix for safe primitive triggers, with guards that bypass Radix for interactive/composite triggers.
- Added stable frozen startup fallback arrays in `AlgoScreen.jsx` and idempotent null resets for selected candidate / focused deployment.
- Added stable signal-monitor fallback arrays in `PlatformApp.jsx`.
- Added `signalMatrixStatesEqual` and used it so signal-matrix pruning returns the current snapshot on no-op merges.

## Evidence

Targeted tests passed:

- `pnpm --filter @workspace/pyrus exec node JS validation runner src/screens/algo/algoHelpers.validation.js`
- `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/signalMatrixScheduler.validation.js`
- `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/platformRootSource.validation.js`
- `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/charting/ResearchChartSurface.validation.ts`
- `pnpm --filter @workspace/pyrus run typecheck`
- `pnpm --filter @workspace/pyrus run build`

Live headed-browser verification against the reported Replit URL loaded the app without the root crash. Boot reached 100%. Console errors remaining after load were backend `/api/gex/*` 503s, not React update-depth errors or Radix tooltip ref errors.

## Regression Tests

- `src/screens/algo/algoHelpers.validation.js` checks stable Algo startup fallbacks and idempotent cleanup setters.
- `src/features/platform/signalMatrixScheduler.validation.js` checks no-op signal-matrix state equality.
- `src/features/platform/platformRootSource.validation.js` checks the signal-matrix no-op guard, stable signal-monitor fallbacks, guarded tooltip behavior, and the IBKR line-usage native title/ARIA call site.

## Status

DONE. The React root crash is fixed and verified in browser. Remaining GEX 503s are separate backend/runtime failures.
