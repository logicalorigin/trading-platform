import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEquityCurvePointSummary,
  buildPaddedValueDomain,
  normalizeEquityPointSeries,
  parseEquityTimestampMs,
} from "./equityCurveData.js";

test("equity normalization rejects missing timestamps and NAV values", () => {
  assert.equal(parseEquityTimestampMs(null), null);
  assert.equal(parseEquityTimestampMs("  "), null);
  assert.deepEqual(
    normalizeEquityPointSeries([
      { timestamp: null, netLiquidation: 100 },
      { timestamp: "2026-07-21T20:00:00.000Z", netLiquidation: "" },
      { timestamp: "2026-07-21T20:00:00.000Z", netLiquidation: "100" },
    ]),
    [
      {
        timestamp: "2026-07-21T20:00:00.000Z",
        timestampMs: Date.parse("2026-07-21T20:00:00.000Z"),
        netLiquidation: 100,
      },
    ],
  );
});

test("equity summaries and domains do not turn missing values into zero", () => {
  const summary = buildEquityCurvePointSummary([
    { timestampMs: 1, netLiquidation: 100, cumulativePnl: null },
  ]);

  assert.equal(summary.minPnl, null);
  assert.equal(summary.maxPnl, null);
  assert.equal(summary.transferAdjustedPnl, null);
  assert.deepEqual(buildPaddedValueDomain([null, "", "  "]), ["auto", "auto"]);
});
