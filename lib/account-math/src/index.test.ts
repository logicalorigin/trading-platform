import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTransferAdjustedPnlSeries,
  calculateTransferAdjustedReturnSeries,
  calculateTransferAdjustedReturnSummary,
  ratioToPercentPoint,
} from "./index";

test("calculateTransferAdjustedReturnSeries excludes deposits and withdrawals", () => {
  const points = [
    { netLiquidation: 100_000 },
    { netLiquidation: 110_000, deposits: 10_000 },
    { netLiquidation: 108_500, withdrawals: 2_000 },
    { netLiquidation: 112_000 },
  ];
  const summary = calculateTransferAdjustedReturnSummary(points);

  assert.equal(summary.cumulativePnl, 4_000);
  assert.equal(summary.capitalBase, 110_000);
  assert.equal(summary.returnPercent, 100 * (4_000 / 110_000));
  assert.deepEqual(buildTransferAdjustedPnlSeries(points), [0, 0, 500, 4_000]);
});

test("calculateTransferAdjustedReturnSeries backs out first-point deposits conservatively", () => {
  const summary = calculateTransferAdjustedReturnSummary([
    { netLiquidation: 110_000, deposits: 10_000 },
    { netLiquidation: 115_000 },
  ]);

  assert.equal(summary.startNav, 110_000);
  assert.equal(summary.transferAdjustedPreviousNav, 100_000);
  assert.equal(summary.transferAdjustedStartNav, 100_000);
  assert.equal(summary.capitalBase, 110_000);
  assert.equal(summary.cumulativePnl, 5_000);
  assert.equal(summary.returnPercent, 100 * (5_000 / 110_000));
});

test("calculateTransferAdjustedReturnSeries avoids inflated returns when first capital is deposited into zero NAV", () => {
  const points = [
    { netLiquidation: 0 },
    { netLiquidation: 500, deposits: 500 },
    { netLiquidation: 225.5, withdrawals: 250 },
    { netLiquidation: 3_757.3, deposits: 3_500 },
    { netLiquidation: 5_724.7, deposits: 2_000 },
    { netLiquidation: 5_759.34 },
  ];
  const summary = calculateTransferAdjustedReturnSummary(points);

  assert.equal(summary.capitalBase, 6_000);
  assert.equal(Number(summary.cumulativePnl?.toFixed(2)), 9.34);
  assert.equal(Number(summary.returnPercent?.toFixed(6)), 0.155667);
});

test("calculateTransferAdjustedReturnSeries returns point-level metrics for live terminal patching", () => {
  const series = calculateTransferAdjustedReturnSeries([
    { netLiquidation: 110_000, deposits: 10_000 },
    { netLiquidation: 115_000 },
  ]);

  assert.deepEqual(
    series.map((point) => ({
      pnlDelta: point.pnlDelta,
      cumulativePnl: point.cumulativePnl,
      returnPercent: point.returnPercent,
    })),
    [
      { pnlDelta: 0, cumulativePnl: 0, returnPercent: 0 },
      {
        pnlDelta: 5_000,
        cumulativePnl: 5_000,
        returnPercent: 100 * (5_000 / 110_000),
      },
    ],
  );
});

test("ratioToPercentPoint normalizes ratio-only provider fields", () => {
  assert.equal(ratioToPercentPoint(0.375), 37.5);
  assert.equal(ratioToPercentPoint(null), null);
});
