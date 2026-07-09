# Age Honesty Fix Wave - 2026-07-07

Worker: `codex-worker` for `claude-lead`

## Scope

Implemented audit fix-list items 1, 2, 4, and 6 only. No backend/schema changes, no restarts, no DB writes, no commits, no pushes, no signals.

## Changes

- Item 1, honest Age column:
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx:453` now formats the effective display age.
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx:4306` renames the column to `Trend age`.
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx:4310` renders signal-bars fallback with muted styling and `Signal bars fallback` title.

- Item 2, fallback display with source flag:
  - `artifacts/pyrus/src/features/signals/signalsRowModel.js:378` adds `displayAgeBars` and `displayAgeSource`.
  - `artifacts/pyrus/src/features/signals/signalsRowModel.js:1055` derives the existing effective `barsSinceSignal` before dashboard summary assembly.
  - `artifacts/pyrus/src/features/signals/signalsRowModel.js:1069` passes that value as the display fallback.
  - `artifacts/pyrus/src/features/signals/signalsRowModel.js:1325` sorts Age by `displayAgeBars`, matching the rendered value.
  - `artifacts/pyrus/src/features/signals/signalsRowModel.test.mjs:482` pins trend-age vs signal-bars source flags and matching sort order.

- Item 4, universe truncation indicator:
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx:4562` computes a compact scope coverage label from existing frontend metadata.
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx:4686` renders the compact indicator beside the Intervals pill.
  - `artifacts/pyrus/src/screens/SignalsScreen.state-contract.test.mjs:158` pins indicator presence.
  - Metadata used: existing `signalMatrixUniverse.resolvedSymbols` and `signalMatrixCoverage.activeScopeSymbols`. The screen renders the smaller count over the larger count, e.g. `2,000 of 3,515 symbols in scope`, so it works regardless of which delivered field is the cap vs total.

- Item 6, idle lanes not missing:
  - `artifacts/pyrus/src/features/signals/signalsMatrixHydration.js:16` treats `idle` matrix state as renderable/hydrated when it has bar or signal timing and no error.
  - `artifacts/pyrus/src/features/signals/signalsMatrixHydration.test.mjs:89` pins that idle cells are covered and not counted as awaiting data.
  - `artifacts/pyrus/src/screens/SignalsScreen.jsx:3014` already used the required `N cells awaiting data` wording in the active worktree; this fix keeps that wording.

## Verification

- `pnpm --filter @workspace/pyrus exec node --test src/features/signals/signalsRowModel.test.mjs`
  - 17 tests, 17 pass, 0 fail.
- `pnpm --filter @workspace/pyrus exec node --test src/features/signals/signalsMatrixHydration.test.mjs`
  - 10 tests, 10 pass, 0 fail.
- `pnpm --filter @workspace/pyrus exec node --test src/screens/SignalsScreen.state-contract.test.mjs`
  - 14 tests, 14 pass, 0 fail.
- `pnpm --filter @workspace/pyrus run typecheck`
  - exit 0.
