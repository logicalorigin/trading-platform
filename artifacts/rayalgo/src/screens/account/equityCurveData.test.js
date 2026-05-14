import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnchoredValueDomain,
  buildEquityCurvePointSummary,
  buildPaddedValueDomain,
  buildTransferAdjustedPnlSeries,
  equityRangeResponseMatches,
  joinBenchmarkPercentSeries,
  mapEquityEventsToPoints,
  normalizeEquityPointSeries,
  resolveStableEquityRangeResponse,
} from "./equityCurveData.js";

test("normalizeEquityPointSeries filters invalid values and sorts by time", () => {
  const points = normalizeEquityPointSeries([
    { timestamp: "bad-date", netLiquidation: 100 },
    { timestamp: "2026-04-30T12:02:00.000Z", netLiquidation: "102" },
    { timestamp: "2026-04-30T12:00:00.000Z", netLiquidation: 100 },
    { timestamp: "2026-04-30T12:01:00.000Z", netLiquidation: "not-a-number" },
  ]);

  assert.deepEqual(
    points.map((point) => point.timestamp),
    ["2026-04-30T12:00:00.000Z", "2026-04-30T12:02:00.000Z"],
  );
  assert.deepEqual(
    points.map((point) => point.netLiquidation),
    [100, 102],
  );
});

test("resolveStableEquityRangeResponse keeps the last completed range during transitions", () => {
  const fallback = {
    range: "1M",
    points: [{ timestamp: "2026-04-01T00:00:00.000Z", netLiquidation: 100 }],
  };
  const current = {
    range: "1W",
    points: [{ timestamp: "2026-04-30T00:00:00.000Z", netLiquidation: 110 }],
  };

  assert.equal(equityRangeResponseMatches(current, "1W"), true);
  assert.equal(equityRangeResponseMatches(current, "1M"), false);
  assert.equal(
    resolveStableEquityRangeResponse({ response: undefined, fallback, range: "1W" }),
    fallback,
  );
  assert.equal(
    resolveStableEquityRangeResponse({ response: current, fallback, range: "1W" }),
    current,
  );
  assert.equal(
    resolveStableEquityRangeResponse({ response: current, fallback, range: "1M" }),
    fallback,
  );
});

test("resolveStableEquityRangeResponse can hold the prior range until overlays are ready", () => {
  const fallback = {
    range: "1M",
    points: [{ timestamp: "2026-04-01T00:00:00.000Z", netLiquidation: 100 }],
  };
  const current = {
    range: "1W",
    points: [{ timestamp: "2026-04-30T00:00:00.000Z", netLiquidation: 110 }],
  };

  assert.equal(
    resolveStableEquityRangeResponse({
      response: current,
      fallback,
      range: "1W",
      acceptResponse: false,
    }),
    fallback,
  );
  assert.equal(
    resolveStableEquityRangeResponse({
      response: current,
      fallback: null,
      range: "1W",
      acceptResponse: false,
    }),
    current,
  );
});

test("joinBenchmarkPercentSeries rebases nearby benchmark timestamps to a zero start", () => {
  const equityPoints = normalizeEquityPointSeries([
    { timestamp: "2026-04-30T12:00:00.000Z", netLiquidation: 100 },
    { timestamp: "2026-04-30T12:05:00.000Z", netLiquidation: 101 },
  ]);
  const values = joinBenchmarkPercentSeries(
    equityPoints,
    [
      { timestamp: "2026-04-30T11:59:30.000Z", benchmarkPercent: 1.2 },
      { timestamp: "2026-04-30T12:04:30.000Z", benchmarkPercent: 1.5 },
    ],
    "1D",
  );

  assert.deepEqual(values, [0, 0.3]);
});

test("joinBenchmarkPercentSeries preserves leading gaps and rebases from the first visible match", () => {
  const equityPoints = normalizeEquityPointSeries([
    { timestamp: "2026-04-30T12:00:00.000Z", netLiquidation: 100 },
    { timestamp: "2026-04-30T12:10:00.000Z", netLiquidation: 101 },
    { timestamp: "2026-04-30T12:20:00.000Z", netLiquidation: 102 },
  ]);
  const values = joinBenchmarkPercentSeries(
    equityPoints,
    [
      { timestamp: "2026-04-30T12:10:00.000Z", benchmarkPercent: 2.5 },
      { timestamp: "2026-04-30T12:20:00.000Z", benchmarkPercent: 4 },
    ],
    "1D",
  );

  assert.deepEqual(values, [null, 0, 1.5]);
});

test("mapEquityEventsToPoints places events on nearest chart points", () => {
  const equityPoints = normalizeEquityPointSeries([
    { timestamp: "2026-04-30T12:00:00.000Z", netLiquidation: 100 },
    { timestamp: "2026-04-30T12:05:00.000Z", netLiquidation: 101 },
  ]);
  const events = mapEquityEventsToPoints(
    [{ timestamp: "2026-04-30T12:04:45.000Z", type: "deposit", amount: 20 }],
    equityPoints,
    "1D",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].timestampMs, equityPoints[1].timestampMs);
  assert.equal(events[0].netLiquidation, 101);
});

test("buildTransferAdjustedPnlSeries excludes deposits and withdrawals", () => {
  const points = normalizeEquityPointSeries([
    {
      timestamp: "2026-04-30T12:00:00.000Z",
      netLiquidation: 1_500,
      deposits: 500,
    },
    {
      timestamp: "2026-04-30T12:05:00.000Z",
      netLiquidation: 1_650,
    },
    {
      timestamp: "2026-04-30T12:10:00.000Z",
      netLiquidation: 1_500,
      withdrawals: 250,
    },
  ]);

  assert.deepEqual(buildTransferAdjustedPnlSeries(points), [0, 150, 250]);
});

test("buildEquityCurvePointSummary computes extrema and final transfer-adjusted P&L in one pass", () => {
  const summary = buildEquityCurvePointSummary([
    { timestamp: "2026-04-30T12:00:00.000Z", netLiquidation: 100, cumulativePnl: null },
    { timestamp: "2026-04-30T12:05:00.000Z", netLiquidation: 106, cumulativePnl: 6 },
    { timestamp: "2026-04-30T12:10:00.000Z", netLiquidation: 98, cumulativePnl: -2 },
  ]);

  assert.equal(summary.firstPoint.timestamp, "2026-04-30T12:00:00.000Z");
  assert.equal(summary.lastPoint.timestamp, "2026-04-30T12:10:00.000Z");
  assert.equal(summary.minNav, 98);
  assert.equal(summary.maxNav, 106);
  assert.equal(summary.minPnl, -2);
  assert.equal(summary.maxPnl, 6);
  assert.equal(summary.transferAdjustedPnl, -2);
});

test("buildPaddedValueDomain scales around plotted values without forcing zero", () => {
  assert.deepEqual(buildPaddedValueDomain([5_700, 5_750]), [5_696, 5_754]);
  assert.deepEqual(buildPaddedValueDomain([5_750, 5_750]), [5_738.5, 5_761.5]);
  assert.deepEqual(buildPaddedValueDomain([0, 2.5]), [-1, 3.5]);
  assert.deepEqual(buildPaddedValueDomain([226, 5_750], { floor: 0 }), [0, 6191.92]);
});

test("buildAnchoredValueDomain aligns an anchor value to the requested ratio", () => {
  const [min, max] = buildAnchoredValueDomain([0, 10], {
    anchorValue: 0,
    anchorRatio: 0.75,
    paddingRatio: 0,
    minPadding: 0,
  });

  assert.equal(Number(min.toFixed(10)), -3.3333333333);
  assert.equal(max, 10);
  assert.equal(Number(((max - 0) / (max - min)).toFixed(10)), 0.75);
});

test("buildAnchoredValueDomain expands both sides when needed to preserve alignment", () => {
  const [min, max] = buildAnchoredValueDomain([-5, 10], {
    anchorValue: 0,
    anchorRatio: 0.75,
    paddingRatio: 0,
    minPadding: 0,
  });

  assert.equal(min, -5);
  assert.equal(max, 15);
  assert.equal(Number(((max - 0) / (max - min)).toFixed(10)), 0.75);
});
