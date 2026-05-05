import assert from "node:assert/strict";
import test from "node:test";

import {
  formatChartPrice,
  formatChartSignedPrice,
  formatCompactChartValue,
  resolveChartOverlayLabelBudget,
  resolveChartPricePrecision,
  resolveChartPricePrecisionForBars,
} from "./chartNumberFormat";

test("resolveChartPricePrecision adapts to price and visible range", () => {
  assert.equal(resolveChartPricePrecision({ price: 625, range: 8 }), 2);
  assert.equal(resolveChartPricePrecision({ price: 625, range: 0.25 }), 3);
  assert.equal(resolveChartPricePrecision({ price: 8.25, range: 0.08 }), 4);
  assert.equal(resolveChartPricePrecision({ price: 0.42, range: 0.01 }), 5);
  assert.equal(
    resolveChartPricePrecision({ price: 8.25, range: 0.08, compact: true }),
    3,
  );
});

test("resolveChartPricePrecisionForBars respects source precision without over-expanding dense charts", () => {
  const bars = [
    { o: 12.1, h: 12.28, l: 11.96, c: 12.125, vwap: 12.1025, sessionVwap: null },
    { o: 12.13, h: 12.19, l: 12.01, c: 12.18, vwap: null, sessionVwap: null },
  ];

  assert.equal(resolveChartPricePrecisionForBars(bars), 4);
  assert.equal(resolveChartPricePrecisionForBars(bars, { compact: true }), 3);
});

test("chart value formatting compacts large values and preserves signed prices", () => {
  assert.equal(formatChartPrice(123.456, { precision: 2 }), "123.46");
  assert.equal(formatChartPrice(12500, { compact: true }), "12.5K");
  assert.equal(formatChartSignedPrice(-1.235, { precision: 2 }), "-1.24");
  assert.equal(formatCompactChartValue(1_250_000), "1.25M");
});

test("resolveChartOverlayLabelBudget tightens labels for dense chart grids", () => {
  assert.equal(
    resolveChartOverlayLabelBudget({
      compact: true,
      plotWidth: 330,
      plotHeight: 170,
      overlayCount: 8,
    }),
    1,
  );
  assert.equal(
    resolveChartOverlayLabelBudget({
      compact: true,
      plotWidth: 560,
      plotHeight: 280,
      overlayCount: 8,
    }),
    5,
  );
  assert.equal(
    resolveChartOverlayLabelBudget({
      compact: false,
      plotWidth: 760,
      plotHeight: 420,
      overlayCount: 12,
    }),
    10,
  );
});
