import test from "node:test";
import assert from "node:assert/strict";

import { sliceFiniteSeries } from "./EquityCurveChart.jsx";

test("sliceFiniteSeries sorts and coalesces duplicate chart seconds", () => {
  const points = [
    { timestampMs: 1_780_444_800_900, netLiquidation: 103, spyReturnPct: 1.5 },
    { timestampMs: 1_780_444_800_000, netLiquidation: 101, spyReturnPct: 1 },
    { timestampMs: 1_780_444_801_000, netLiquidation: 104, spyReturnPct: 2 },
    { timestampMs: 1_780_444_799_500, netLiquidation: 100, spyReturnPct: 0 },
    { timestampMs: Number.NaN, netLiquidation: 105, spyReturnPct: 3 },
    { timestampMs: 1_780_444_802_000, netLiquidation: null, spyReturnPct: null },
  ];

  assert.deepEqual(sliceFiniteSeries(points, "netLiquidation"), [
    { time: 1_780_444_799, value: 100 },
    { time: 1_780_444_800, value: 103 },
    { time: 1_780_444_801, value: 104 },
  ]);
  assert.deepEqual(sliceFiniteSeries(points, "spyReturnPct"), [
    { time: 1_780_444_799, value: 0 },
    { time: 1_780_444_800, value: 1.5 },
    { time: 1_780_444_801, value: 2 },
  ]);
});
