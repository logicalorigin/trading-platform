# Session Handoff: Chart Overlay Root Cause

- Last Updated (MT): `2026-06-02 18:36:00 MDT`
- Last Updated (UTC): `2026-06-03T00:36:00.000Z`
- Native Codex Session ID: `019e8ac2-edd3-7d53-b81e-2ee862972acc`
- User Request: Investigate why flow events, GEX markers/overlay, and real/shadow trailing stop and stop-loss lines are not displaying on charts; solve root cause. User clarified GEX is expected on spot charts only, not option price charts.

## Status

Implemented and validated the chart overlay fixes, including post-restart browser checks.

## Root Cause

- Real-account chart risk lines were not rendered because `/positions` exposes attached broker risk as `openOrders`, while `chartPositionOverlays.ts` only read `stopLoss`, `takeProfit`, `riskOverlay`, and `automationContext`.
- Shadow/signal risk lines could disappear if a payload arrived as raw `lastStop` / `lastWireTrail` rather than the normalized `riskOverlay` shape.
- Spot GEX/chart hydration was tied to `tradeLiveStreamsEnabled`, which is an interaction/realtime-stream gate. That could disable historical chart/GEX fetches even when the spot chart itself is mounted. GEX remains spot-only; option charts still do not receive `gexProjectionCone`.
- Trade chart flow hydration requests did not carry visible chart route-admission headers, so `/api/flow/events` could be shed as deferred/background under resource pressure.
- Option stop lines could still be omitted after bars arrived when the option chart initially had only one drawable bar, because the SVG risk renderer dropped risk paths with fewer than two coordinates.

## Changes

- `artifacts/pyrus/src/features/charting/chartPositionOverlays.ts`
  - Added `openOrders`, `lastStop`, and `lastWireTrail` support to chart position risk normalization.
  - Derives real-account stop loss / take profit from closing stop and limit open orders.
  - Reads raw shadow stop/trail payloads in addition to normalized risk overlays.
  - Made trailing-stop inference direction-aware for shorts.
- `artifacts/pyrus/src/features/charting/chartPositionOverlays.test.ts`
  - Added regressions for real-account open-order SL/TP lines.
  - Added regressions for raw shadow last-stop / wire-trail HSL/TRL lines.
- `artifacts/pyrus/src/screens/TradeScreen.jsx`
  - Added `tradePrimaryChartDataEnabled` and uses it for spot chart `historicalDataEnabled`.
  - Left realtime stream enablement separate.
  - Added visible chart admission headers to Trade flow live/history requests.
- `artifacts/pyrus/src/features/charting/ResearchChartSurface.tsx`
  - Added a one-point fallback for position risk-line paths so single-bar option charts still render current SL/TP/TRL labels and lines.
- `artifacts/pyrus/src/features/charting/ResearchChartSurface.test.ts`
  - Added regression coverage for one-point position risk-line rendering.
- `artifacts/pyrus/src/features/platform/platformRootSource.test.js`
  - Added regression coverage for Trade chart flow requests using visible chart admission headers.

## Validation

- `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/charting/chartPositionOverlays.test.ts src/features/charting/chartEvents.test.ts src/features/charting/flowChartEvents.test.ts src/features/gex/useGexProjection.test.js src/features/gex/gexProjectionChartWiring.test.js src/features/market/marketChartWiring.test.js src/features/platform/platformRootSource.test.js`
  - Passed: 167/167.
- `pnpm --filter @workspace/pyrus typecheck`
  - Passed.
- `pnpm --filter @workspace/pyrus exec node --import tsx --test src/features/charting/ResearchChartSurface.test.ts src/features/charting/chartPositionOverlays.test.ts src/features/platform/platformRootSource.test.js src/features/charting/chartEvents.test.ts src/features/charting/flowChartEvents.test.ts src/features/gex/useGexProjection.test.js src/features/gex/gexProjectionChartWiring.test.js src/features/market/marketChartWiring.test.js`
  - Passed: 254/254.
- Post-restart browser probe against `http://127.0.0.1:18747/`:
  - Spot SPY chart rendered 361 bars, GEX cone present, GEX future axis present.
  - Trade flow requests for SPY/AAOI returned 200 after header fix; current source payloads still had `events.length === 0`, so no flow markers were drawn for those symbols.
  - Shadow AAOI option contract chart rendered 135 bars and displayed one risk group/line/label: `SL 8.34`.
- `git diff --check` on touched files:
  - Passed.

## Notes

- Did not touch Replit startup config intentionally.
- `.replit` was already dirty before this handoff; no startup audit was run for this chart-only change.
- `TradeScreen.jsx` already had unrelated pending edits before this session. This session only added the chart-data gate and changed the spot chart `historicalDataEnabled` prop.

## Next Recommended Steps

1. When live flow data has non-empty events for the active symbol, verify markers/cluster glyphs render; current SPY/AAOI flow payloads were empty.
2. Verify a real position with attached stop/limit orders shows SL/TP lines once a real account position has risk metadata/open orders.
3. Verify a shadow signal position with an active trailing stop shows HSL/TRL lines; current shadow positions only exposed hard stops.
