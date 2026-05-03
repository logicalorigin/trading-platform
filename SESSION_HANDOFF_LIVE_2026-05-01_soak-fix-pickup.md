# Live Handoff: Soak/Fix Pickup

Session ID: pending
Repo root: `/home/runner/workspace`
Date: 2026-05-01
Source handoff: `SESSION_HANDOFF_2026-05-01_019de569-be8f-7541-8294-a3baac70962d.md`

## User Request

Pick up the soak/fix session identified by `019de569-be8f-7541-8294-a3baac70962d`.

Follow-up regression callout: Flow scanner only continued scanning while the user stayed on Flow/Market. Restore the prior behavior where the broad scanner keeps running globally while the page is visible.

## Current Findings

- Referenced handoff is the post-modularization regression soak and UI review follow-up thread.
- Main carry-forward issues:
  - Missing unusual-options-activity display on charts.
  - Market chart-frame panning/history regression compared with Trade chart-frame behavior.
  - Major pages, especially Account, should stay lazy loaded/hydrated better across screen switches.
  - Soak-observed UI/runtime issues: `PhotonicsObservatory.jsx` missing `userPreferences`, Trade render-phase update warning, and Backtest strategy-definition `400`.
- Newer session `019de5d4-7629-74f1-a291-d77bb7376926` documents a later crashout with in-flight Flow/platform edits and failed Playwright artifacts. Treat that newer cluster as unvalidated user/session work and do not revert it.
- Current worktree is dirty with broad existing edits; product changes must be tightly scoped and preserve unrelated edits.
- Flow scanner regression root cause: `RayAlgoPlatform.jsx` passed `broadFlowRuntimeEnabled={sessionMetadataSettled && pageVisible && (marketScreenActive || flowScreenActive)}`, so the broad scanner runtime unmounted/stopped on non-Market/non-Flow screens even though the header/global flow surfaces still subscribe to the broad flow store.
- Flow scanner fix applied: `broadFlowRuntimeEnabled` now only requires `sessionMetadataSettled && pageVisible`; the shared watchlist market-flow runtime remains gated to Market/Flow.
- Chart UOA root cause: `ResearchChartSurface.tsx` treated `trading.showExecutionMarkers === false` as a reason to hide all `chartEvents`. Current chart events are UOA/earnings events, not execution markers, so this suppressed UOA overlays.
- Chart UOA fix applied: `resolveVisibleChartEvents` always keeps supplied chart events visible; the execution-marker preference no longer hides UOA/earnings overlays.
- Market chart panning/history wiring was inspected. Current `MiniChartCell.jsx` uses controlled viewport snapshots, debounced visible-range expansion, and prependable historical bars; focused Market viewport/panning tests pass.
- Runtime warning carry-forwards were rechecked. Photonics already reads user preferences locally, option hydration diagnostics defer external-store listener notifications to a microtask, and the platform screen-switch test passes.
- Backtest strategy metadata contract is covered by `backtesting-strategies.test.ts`; API typecheck passes.

## Active Files

- `artifacts/rayalgo/src/RayAlgoPlatform.jsx`
  - Narrow fix: broad flow scanner runtime enabled whenever session metadata is settled and the page is visible.
- `artifacts/rayalgo/e2e/flow-layout.spec.ts`
  - Regression test now leaves Flow for Account, not Market, so it catches page-coupling regressions.
- `artifacts/rayalgo/src/features/charting/ResearchChartSurface.tsx`
  - Added `resolveVisibleChartEvents`; removed the execution-marker preference as a blanket chart-event gate.
- `artifacts/rayalgo/src/features/charting/ResearchChartSurface.test.ts`
  - Added UOA visibility coverage with `showExecutionMarkers: false`.

## Current Step

Flow scanner regression, UOA chart visibility, Market chart panning/viewport parity, platform screen switching, and backtest strategy metadata have been validated.

## Next Step

If continuing the soak, run broader end-to-end sweeps or move to any remaining visual/layout review items from the source handoff.

## Validation

- `pnpm --filter @workspace/rayalgo exec playwright test e2e/flow-layout.spec.ts -g "Flow scanner keeps scanning after leaving the Flow page"`: passed.
- `pnpm --filter @workspace/rayalgo exec playwright test e2e/flow-layout.spec.ts -g "Flow tape includes broad scanner feed events"`: passed.
- `pnpm --filter @workspace/rayalgo exec node --import tsx --test src/features/charting/ResearchChartSurface.test.ts`: passed.
- `pnpm --filter @workspace/rayalgo exec playwright test e2e/market-responsive.spec.ts -g "Market chart grid drag-pans inactive plots without selecting or snapping them"`: passed.
- `pnpm --filter @workspace/rayalgo exec playwright test e2e/market-responsive.spec.ts -g "Market chart grid keeps touched viewports through layout changes and clears them on reset"`: passed.
- `pnpm --filter @workspace/rayalgo exec playwright test e2e/platform-shell.spec.ts -g "platform pages render page-by-page and keep primary controls interactive"`: passed.
- `pnpm --filter @workspace/api-server exec node --import tsx --test src/services/backtesting-strategies.test.ts`: passed.
- `pnpm --filter @workspace/rayalgo run typecheck`: passed.
- `pnpm --filter @workspace/api-server run typecheck`: passed.
