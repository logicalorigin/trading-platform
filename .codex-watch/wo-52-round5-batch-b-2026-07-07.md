# WO-52 Round-5 Batch B

Worker: codex-worker for claude-lead session f68a9158
Date: 2026-07-07
Branch: main

## Per-Item Migration Notes

1. `ResearchChartSurface.tsx`
   - Before: chart loading/empty state rendered separate eyebrow, title, and detail inside an elevated bordered card over the skeleton.
   - After: loading/empty state keeps the skeleton and renders a flat centered label, merging eyebrow/title as `{eyebrow}: {title}` with no local border, background, or shadow.

2. `TradeChainPanel.jsx`
   - Before: chain loading with no rows rendered amber `DataUnavailableState`, visually different from chart skeleton loading.
   - After: chain loading renders `ChartSkeleton` with a centered loading label; non-loading empty/error states still use `DataUnavailableState`.

3. `PatternDiscoveryPanel.tsx`
   - Before: `FamilyChip` hand-rolled a static span to carry `title={family.description}`.
   - After: `FamilyChip` renders canonical static `Badge` with title passthrough and scoped style overrides.

4. `PhotonicsObservatory.jsx`
   - Before: period return chip was hand-rolled as a static span because `Pill` is interactive.
   - After: period return chip renders static `Badge`; no interactive `Pill` semantics were introduced.

5. `primitives.jsx`
   - Before: `Badge` accepted only `children`, `color`, and `variant`.
   - After: `Badge` accepts optional `title` and `style` passthrough. It remains a non-interactive `span` with no hover/focus/role/tabIndex affordances.

## Verification

- `node --test artifacts/pyrus/src/features/platform/round5BatchBPrimitiveLoading.source.test.mjs` passed.
- `pnpm --filter @workspace/pyrus test` exited 0.
- `pnpm --filter @workspace/pyrus typecheck` passed.
- `git diff --check` passed for the scoped changed files.
- `pnpm shot "http://127.0.0.1:18747/?screen=trade" --wait-for '[data-testid="trade-options-chain-panel"]' --settle 2500 --out .codex-watch/wo-52-trade-loading-shot.png --json` completed with HTTP 200 and 0 console errors, but the app showed the PYRUS sign-in gate and the selector never appeared. Screenshot path: `.codex-watch/wo-52-trade-loading-shot.png`.

## Scope Check

Touched source files:

- `artifacts/pyrus/src/components/platform/primitives.jsx`
- `artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx`
- `artifacts/pyrus/src/features/trade/TradeChainPanel.jsx`
- `artifacts/pyrus/src/features/backtesting/PatternDiscoveryPanel.tsx`
- `artifacts/pyrus/src/features/research/PhotonicsObservatory.jsx`
- `artifacts/pyrus/src/features/platform/round5BatchBPrimitiveLoading.source.test.mjs`

Out of scope:

- `artifacts/pyrus/src/features/backtesting/BacktestingPanels.tsx` was not touched.
- Replit startup config was not touched.

## Commit

Commit hash: recorded in final response after commit creation.
