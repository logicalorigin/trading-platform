# Webull Data Expansion Plan

## Objective
Improve fidelity of live and historical market data across the app using existing and newly available Webull OpenAPI surfaces.

## Current Baseline (already in code)
- Live spot quote fallback chain via multiple quote/snapshot endpoints.
- Live bars fallback chain via history/bars/candles/kline endpoints.
- Live depth/ticks/footprint with synthetic fallback.
- Order-history driven closed trades and cash ledger extraction.
- TradingView datafeed supports: `1,3,5,15,30,60,120,240,1D,1W`.

## Phase 1: Accuracy Upgrades (Near Term)
1. Add `market_session` normalization and store raw session flags in quote payload.
2. Persist and expose quote timestamp drift (`serverTime - localTime`) for stale detection.
3. Enrich bar payload with raw source granularity + endpoint used (`history|bars|candles|kline`) for traceability.
4. Promote `webull-live-*` confidence in performance model when source is native and timestamped.

## Phase 2: Better Historical Continuity
1. Implement paginated backfill in `#fetchBalanceHistoryPoints` and `#fetchOrderHistoryRows` when provider caps response size.
2. Add stitch logic for missing bar gaps using nearest endpoint variant before synthetic fallback.
3. Cache successful endpoint/query combinations per account+symbol to reduce fallback churn.

## Phase 3: Shorter Candle Periods in TradingView Plugin
1. Keep `1m` and `3m` native first.
2. Add optional synthetic sub-minute bars (`30s`, `15s`) by aggregating live ticks in the datafeed layer when native bars are unavailable.
3. Gate sub-minute mode behind explicit UI toggle (`experimentalSubMinute=true`) to avoid implying broker-native precision.
4. Display source badge on chart (`native bars`, `tick-aggregated`, `synthetic`) for transparency.

## Phase 4: Options Data Fidelity
1. Add Webull-native option chain endpoint probes (if enabled on account) before derived chain fallback.
2. Preserve and surface native Greeks/IV/volume/OI confidence per field.
3. Backfill options flow buckets from native trade prints when available; fallback to bid/ask classification only when needed.

## Phase 5: Cross-Page Adoption
1. Portfolio Workspace: source/confidence badges for spot, flow, ladder.
2. TradingView panel: interval list driven by datafeed capability response.
3. Positions & Accounts: confidence badges in performance cards + marker source tags.

## Validation Checklist
- `npm run build` passes.
- `/api/market/bars` returns stable timestamps for `1`, `3`, `5`, `15`, `30`, `60`.
- TradingView plugin renders `1m` and `3m` with native bars when available.
- Marker and ledger timestamps align with equity curve chronology in Positions & Accounts.
