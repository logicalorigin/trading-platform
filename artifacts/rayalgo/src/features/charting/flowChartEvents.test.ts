import test from "node:test";
import assert from "node:assert/strict";
import type { ChartEvent } from "./chartEvents";
import { buildFlowChartBuckets, buildFlowTooltipModel } from "./flowChartEvents";
import type { ChartBar, ChartBarRange } from "./types";

const bars: ChartBar[] = [
  {
    time: Date.parse("2026-04-30T14:30:00.000Z") / 1000,
    ts: "2026-04-30T14:30:00.000Z",
    date: "2026-04-30",
    o: 100,
    h: 101,
    l: 99,
    c: 100.5,
    v: 100_000,
  },
  {
    time: Date.parse("2026-04-30T14:35:00.000Z") / 1000,
    ts: "2026-04-30T14:35:00.000Z",
    date: "2026-04-30",
    o: 100.5,
    h: 103,
    l: 100,
    c: 102,
    v: 120_000,
  },
];

const ranges: ChartBarRange[] = [
  {
    startMs: Date.parse("2026-04-30T14:30:00.000Z"),
    endMs: Date.parse("2026-04-30T14:35:00.000Z"),
  },
  {
    startMs: Date.parse("2026-04-30T14:35:00.000Z"),
    endMs: Date.parse("2026-04-30T14:40:00.000Z"),
  },
];

const flowEvent = (event: Partial<ChartEvent>): ChartEvent => ({
  id: event.id || "flow",
  symbol: event.symbol || "AAPL",
  eventType: "unusual_flow",
  time: event.time || "2026-04-30T14:36:12.000Z",
  placement: "bar",
  severity: event.severity || "high",
  label: event.label || "C $500K",
  summary: event.summary || "AAPL 200C unusual flow $500K",
  source: "test",
  confidence: 0.7,
  bias: event.bias || "bullish",
  actions: ["open_flow"],
  metadata: event.metadata || {},
});

test("buildFlowChartBuckets assigns intrabar flow to the candle range", () => {
  const buckets = buildFlowChartBuckets(
    [
      flowEvent({
        id: "flow-1",
        time: "2026-04-30T14:37:20.000Z",
        metadata: {
          cp: "C",
          premium: 500_000,
          contracts: 250,
          contractLabel: "AAPL 200C",
          type: "sweep",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].barIndex, 1);
  assert.equal(buckets[0].time, bars[1].time);
  assert.equal(buckets[0].totalPremium, 500_000);
  assert.equal(buckets[0].totalContracts, 250);
  assert.equal(buckets[0].callPremium, 500_000);
  assert.deepEqual(buckets[0].tags, ["sweep"]);
});

test("buildFlowChartBuckets aggregates premium, bias, top contract, and intensity", () => {
  const buckets = buildFlowChartBuckets(
    [
      flowEvent({
        id: "flow-1",
        metadata: {
          cp: "C",
          premium: 200_000,
          contracts: 50,
          contractLabel: "AAPL 200C",
        },
      }),
      flowEvent({
        id: "flow-2",
        severity: "extreme",
        bias: "bearish",
        metadata: {
          cp: "P",
          premium: 650_000,
          contracts: 100,
          contractLabel: "AAPL 180P",
          isBlock: true,
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].count, 2);
  assert.equal(buckets[0].totalPremium, 850_000);
  assert.equal(buckets[0].putPremium, 650_000);
  assert.equal(buckets[0].bias, "bearish");
  assert.equal(buckets[0].severity, "extreme");
  assert.equal(buckets[0].topContractLabel, "AAPL 180P");
  assert.equal(buckets[0].volumeSegmentRatio <= 0.55, true);
  assert.equal(buckets[0].volumeSegmentRatio >= 0.08, true);
});

test("buildFlowTooltipModel returns compact TradingView-style event details", () => {
  const [bucket] = buildFlowChartBuckets(
    [
      flowEvent({
        metadata: {
          cp: "C",
          premium: 1_250_000,
          contracts: 500,
          contractLabel: "AAPL 200C",
          isSweep: true,
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  const tooltip = buildFlowTooltipModel(bucket);

  assert.equal(tooltip.premium, "$1.3M");
  assert.equal(tooltip.contracts, "500");
  assert.equal(tooltip.callPutMix, "100% C / 0% P");
  assert.equal(tooltip.topContract, "AAPL 200C");
  assert.deepEqual(tooltip.tags, ["sweep"]);
});
