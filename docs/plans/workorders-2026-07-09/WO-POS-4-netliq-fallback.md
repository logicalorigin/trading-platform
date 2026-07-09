# WO-POS-4 — Dead netLiquidation fallback in the SnapTrade panel model

Owner: codex worker (xhigh). Dispatcher: Claude positions session (71069931). Status log: `.codex-watch/wo-pos-4.log`.
Discipline: ponytail (full) — this is a ~5-line fix plus a test. Do not expand scope.

## Problem

File: `artifacts/pyrus/src/screens/account/snapTradeAccountPanelModel.js` (~lines 589-600, `buildSnapTradeAccountPanelData`).

```js
const positionMarketValue =
  sumNullable(...) ?? finiteNumber(portfolio?.totals?.positionMarketValue) ?? 0;
const netLiquidation =
  cash != null || positionMarketValue != null
    ? (cash ?? 0) + positionMarketValue
    : finiteNumber(portfolio?.totals?.netLiquidation);
```

The trailing `?? 0` makes `positionMarketValue` always finite, so `positionMarketValue != null` is always true and the `totals.netLiquidation` fallback is DEAD code. A portfolio that reports `totals.netLiquidation` but has empty `balances` (cash null) and no positions renders **netLiquidation 0** in the account summary metrics, positions totals, equity history point, and positionsAtDate balance.

## Fix design

Keep a genuinely-nullable market value for the presence check (e.g. compute the sum/totals fallback WITHOUT `?? 0` into a separate const), and:
- if `cash != null || rawPositionMarketValue != null` → `(cash ?? 0) + (rawPositionMarketValue ?? 0)`
- else → `finiteNumber(portfolio?.totals?.netLiquidation)` (may be null — downstream `metric()`/`finiteNumber` already tolerate null).
Downstream uses of `positionMarketValue` (asset buckets, exposure, metrics) may keep the `?? 0` shape — do not change their behavior for existing inputs.

## Required test (extend `snapTradeAccountPanelModel.test.mjs`)

Portfolio `{ balances: [], positions: [], totals: { netLiquidation: 5000 } }` →
- `data.summary.metrics.netLiquidation.value === 5000`
- `data.positions.totals.netLiquidation === 5000`
Also assert one existing-shaped case is unchanged (cash 100 + positions → cash + MV math still wins over totals).

## Verification (paste outputs)
```bash
cd /home/runner/workspace/artifacts/pyrus
node --import tsx --test src/screens/account/snapTradeAccountPanelModel.test.mjs
pnpm run typecheck
```

## Constraints
- Only this model file + its test. No commits. All 7+ existing tests in the file must stay green.

## Report format
STATUS / DIFFSTAT / test output / any deviation + why.
