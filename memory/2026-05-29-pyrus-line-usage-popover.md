# Pyrus Line Usage and Massive Popover Debug Report

- Date: `2026-05-29`
- Status: `DONE_WITH_CONCERNS`
- Scope: running Replit app data-line usage and header connection popover.

## Symptom

During a five-minute watch of the running app, the backend showed active line usage and healthy Massive diagnostics, but the header connection popover showed stale `0 of 200` line usage and did not display the Massive connection information.

## Root Cause

Three frontend issues combined:

1. `MultiChartGrid.jsx` opened `useIbkrQuoteSnapshotStream` directly while `MarketDataSubscriptionProvider` already owned visible quote ticks. This created duplicate `/api/streams/quotes` consumers for overlapping symbol sets.
2. `HeaderStatusCluster.jsx` kept the header line-usage readout on a long-lived SSE stream. That gave a small popover indicator another persistent browser connection and made the UI more prone to stale state when the browser was saturated.
3. `ibkrPopoverModel.js` only rendered Massive provider detail from `/api/diagnostics/runtime`. When runtime diagnostics lagged in the browser, the popover ignored the Massive websocket state already present in `/api/settings/ibkr-line-usage` under stock aggregate stream diagnostics.

## Evidence

- Five-minute sampler: `/tmp/pyrus-line-watch-2026-05-29.jsonl`, 21 samples from `2026-05-29T14:53:31Z` through `2026-05-29T14:59:05Z`.
- Backend during observation: active lines were usually about `42`, bridge lines about `41`, visible lines about `42`, automation about `6`, scanner `0`, budget `200`.
- Backend Massive diagnostics stayed healthy: provider `massive-websocket`, real-time mode, stock aggregate websocket connected, symbol counts observed at `37` and `550`.
- Initial browser popover state: stale `0 of 200`, no Massive provider row, and several pending same-origin diagnostics/quote stream requests.
- Post-fix live recheck with browser open: header showed `22 of 200`; provider rows showed `MASSIVE OK`, `REST request`, `WS AM`, `real-time`, `550 sym`, and recent websocket events.
- Post-fix browser resource entries: no `/api/settings/ibkr-line-usage/stream`; the header used `/api/settings/ibkr-line-usage` polling.
- After closing the browser tab: backend line usage fell to `2` active lines, `0` quote consumers, and no active stock aggregate socket.

## Fix

- Removed the direct quote snapshot stream from `artifacts/pyrus/src/features/market/MultiChartGrid.jsx`.
- Changed the header line usage readout to polling by setting `lineUsageStreamEnabled: false` in `artifacts/pyrus/src/features/platform/HeaderStatusCluster.jsx`.
- Added a fallback Massive websocket normalizer from `lineUsageSnapshot.streams.stockAggregates.polygonDelayedWebSocket` in `artifacts/pyrus/src/features/platform/runtimeControlModel.js`.
- Passed `lineUsageSnapshot` through `artifacts/pyrus/src/features/platform/ibkrPopoverModel.js` so provider rows and detail groups can render Massive even when runtime diagnostics lag.

## Regression Tests

- `artifacts/pyrus/src/features/platform/IbkrConnectionStatus.validation.js`: verifies Massive remains visible from line-usage websocket diagnostics when runtime provider diagnostics lag.
- `artifacts/pyrus/src/features/market/marketChartWiring.validation.js`: verifies Market chart grid no longer owns quote stream subscription setup.

## Validation

- Passed: `pnpm --filter @workspace/pyrus exec node JS validation runner src/features/platform/IbkrConnectionStatus.validation.js src/features/market/marketChartWiring.validation.js` (`65/65`).
- Passed: `pnpm --filter @workspace/pyrus run typecheck`.
- Passed: `git diff --check`.
- Live browser verification passed against `http://127.0.0.1:18747/` without restarting the app, and the browser tab was closed afterward.

## Concern

Full `pnpm --filter @workspace/pyrus run unit validation` still has an unrelated existing failure in `src/screens/account/accountCalendarData.validation.js`, which asserts that the unchanged Account screen source contains `summary: displaySummaryData`.
