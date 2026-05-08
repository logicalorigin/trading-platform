import test from "node:test";
import assert from "node:assert/strict";
import type { ChartEvent } from "./chartEvents";
import {
  buildFlowChartBuckets,
  buildFlowTooltipModel,
  summarizeFlowChartBucketPlacement,
} from "./flowChartEvents";
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
  assert.equal(buckets[0].bullishShare > 0, true);
  assert.equal(buckets[0].bearishShare > buckets[0].bullishShare, true);
  assert.equal(buckets[0].neutralShare, 0);
  assert.equal(buckets[0].severity, "extreme");
  assert.equal(buckets[0].topContractLabel, "AAPL 180P");
  assert.equal(buckets[0].volumeSegmentRatio <= 0.55, true);
  assert.equal(buckets[0].volumeSegmentRatio >= 0.08, true);
});

test("buildFlowChartBuckets separates bullish, bearish, and mixed flow shares", () => {
  const buckets = buildFlowChartBuckets(
    [
      flowEvent({
        id: "flow-bull",
        bias: "bullish",
        metadata: { cp: "C", premium: 200_000 },
      }),
      flowEvent({
        id: "flow-bear",
        bias: "bearish",
        metadata: { cp: "P", premium: 300_000 },
      }),
      flowEvent({
        id: "flow-mixed",
        bias: "neutral",
        metadata: { cp: "C", premium: 500_000 },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].bullishPremium, 200_000);
  assert.equal(buckets[0].bearishPremium, 300_000);
  assert.equal(buckets[0].neutralPremium, 500_000);
  assert.equal(buckets[0].bullishShare, 0.2);
  assert.equal(buckets[0].bearishShare, 0.3);
  assert.equal(buckets[0].neutralShare, 0.5);
});

test("buildFlowChartBuckets preserves multiple visible flow buckets across bars", () => {
  const buckets = buildFlowChartBuckets(
    [
      flowEvent({
        id: "flow-early",
        time: "2026-04-30T14:31:00.000Z",
        metadata: {
          cp: "C",
          premium: 200_000,
          contracts: 50,
          contractLabel: "AAPL 200C",
        },
      }),
      flowEvent({
        id: "flow-later",
        time: "2026-04-30T14:37:00.000Z",
        bias: "bearish",
        metadata: {
          cp: "P",
          premium: 350_000,
          contracts: 80,
          contractLabel: "AAPL 180P",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(buckets.length, 2);
  assert.deepEqual(
    buckets.map((bucket) => bucket.barIndex),
    [0, 1],
  );
  assert.deepEqual(
    buckets.map((bucket) => bucket.count),
    [1, 1],
  );
});

test("buildFlowChartBuckets does not clamp preloaded flow to the first bar", () => {
  const buckets = buildFlowChartBuckets(
    [
      flowEvent({
        id: "before-loaded-bars",
        time: "2026-04-30T14:20:00.000Z",
        metadata: {
          basis: "snapshot",
          sourceBasis: "snapshot_activity",
          cp: "C",
          premium: 250_000,
          contractLabel: "AAPL 200C",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(buckets.length, 0);
});

test("summarizeFlowChartBucketPlacement reports bucket drops", () => {
  const diagnostics = summarizeFlowChartBucketPlacement(
    [
      flowEvent({ id: "visible", time: "2026-04-30T14:31:00.000Z" }),
      flowEvent({ id: "bad-time", time: "not-a-date" }),
      flowEvent({ id: "outside", time: "2026-04-30T15:30:00.000Z" }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(diagnostics.inputEventCount, 3);
  assert.equal(diagnostics.flowEventCount, 3);
  assert.equal(diagnostics.bucketedEventCount, 1);
  assert.equal(diagnostics.droppedInvalidTimeCount, 1);
  assert.equal(diagnostics.droppedOutsideBarCount, 1);
});

test("buildFlowChartBuckets does not pile after-hours snapshot flow onto the final bar", () => {
  const buckets = buildFlowChartBuckets(
    [
      flowEvent({
        id: "after-final-bar",
        time: "2026-04-30T21:00:00.000Z",
        metadata: {
          basis: "snapshot",
          sourceBasis: "snapshot_activity",
          cp: "P",
          premium: 450_000,
          contractLabel: "AAPL 180P",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(buckets.length, 0);
});

test("buildFlowTooltipModel returns compact TradingView-style event details", () => {
  const [bucket] = buildFlowChartBuckets(
    [
      flowEvent({
        metadata: {
          provider: "ibkr",
          basis: "trade",
          cp: "C",
          premium: 1_250_000,
          contracts: 500,
          contractLabel: "AAPL 200C",
          side: "ask",
          price: 2.5,
          bid: 2.45,
          ask: 2.55,
          openInterest: 1_200,
          dte: 14,
          impliedVolatility: 0.42,
          delta: 0.57,
          unusualScore: 3.2,
          moneyness: "OTM",
          distancePercent: 1.4,
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
  assert.equal(tooltip.flowMix, "100% bull / 0% bear / 0% mix");
  assert.equal(tooltip.tone, "bullish");
  assert.equal(tooltip.callPercent, 100);
  assert.equal(tooltip.bullishPercent, 100);
  assert.equal(tooltip.topContract, "AAPL 200C");
  assert.equal(tooltip.copyLabel, "AAPL 200C");
  assert.equal(tooltip.sourceLabel, "IBKR TRADE");
  assert.equal(tooltip.timeBasis, "reported");
  assert.equal(tooltip.side, "BUY");
  assert.equal(tooltip.price, "2.50");
  assert.equal(tooltip.bidAsk, "2.45/2.55");
  assert.equal(tooltip.openInterest, "1K");
  assert.equal(tooltip.dte, "14d");
  assert.equal(tooltip.iv, "42%");
  assert.equal(tooltip.delta, "0.57");
  assert.equal(tooltip.unusualScore, "3.2x");
  assert.equal(tooltip.moneyness, "OTM");
  assert.equal(tooltip.distance, "+1.4%");
  assert.deepEqual(tooltip.tags, ["sweep"]);
});

test("buildFlowTooltipModel labels snapshot buckets as contract activity", () => {
  const [bucket] = buildFlowChartBuckets(
    [
      flowEvent({
        metadata: {
          basis: "snapshot",
          sourceBasis: "snapshot_activity",
          cp: "C",
          premium: 450_000,
          contracts: 300,
          contractLabel: "SPY 500C",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  const tooltip = buildFlowTooltipModel(bucket);

  assert.equal(tooltip.title, "Active contract flow");
  assert.equal(tooltip.sourceLabel, "TEST SNAPSHOT");
  assert.equal(tooltip.timeBasis, "observed");
  assert.equal(tooltip.side, "n/a");
  assert.equal(tooltip.bidAsk, "n/a");
});
