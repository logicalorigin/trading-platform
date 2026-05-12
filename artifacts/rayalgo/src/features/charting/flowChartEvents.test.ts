import test from "node:test";
import assert from "node:assert/strict";
import { flowEventsToChartEvents, type ChartEvent } from "./chartEvents";
import {
  buildFlowChartBuckets,
  buildFlowChartEventPlacements,
  buildFlowChartVolumeBuckets,
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
  metadata: {
    basis: "trade",
    sourceBasis: "confirmed_trade",
    ...(event.metadata || {}),
  },
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

test("buildFlowChartBuckets places raw historical trades on trade time, not update time", () => {
  const chartEvents = flowEventsToChartEvents(
    [
      {
        id: "raw-historical-print",
        ticker: "AAPL",
        basis: "trade",
        sourceBasis: "confirmed_trade",
        cp: "C",
        contract: "AAPL 200C",
        premium: 500_000,
        t: Date.parse("2026-04-30T14:31:00.000Z") * 1_000_000,
        updatedAt: "2026-04-30T14:39:00.000Z",
      },
    ],
    "AAPL",
  );
  const buckets = buildFlowChartBuckets(chartEvents, {
    chartBars: bars,
    chartBarRanges: ranges,
  });

  assert.equal(chartEvents[0]?.time, "2026-04-30T14:31:00.000Z");
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].barIndex, 0);
  assert.equal(buckets[0].time, bars[0].time);
});

test("buildFlowChartEventPlacements keeps same-candle option prints individually addressable", () => {
  const events = [
    flowEvent({
      id: "first-print",
      time: "2026-04-30T14:36:00.000Z",
      metadata: {
        optionTicker: "AAPL260515C00200000",
        cp: "C",
        strike: 200,
        expirationDate: "2026-05-15",
        side: "buy",
        price: 2.1,
        size: 20,
        premium: 42_000,
      },
    }),
    flowEvent({
      id: "second-print",
      time: "2026-04-30T14:37:00.000Z",
      metadata: {
        optionTicker: "AAPL260515C00200000",
        cp: "C",
        strike: 200,
        expirationDate: "2026-05-15",
        side: "buy",
        price: 2.2,
        size: 35,
        premium: 77_000,
      },
    }),
  ];

  const buckets = buildFlowChartBuckets(events, {
    chartBars: bars,
    chartBarRanges: ranges,
  });
  const placements = buildFlowChartEventPlacements(events, {
    chartBars: bars,
    chartBarRanges: ranges,
  });

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].count, 2);
  assert.equal(placements.length, 2);
  assert.deepEqual(
    placements.map((placement) => placement.event.id),
    ["first-print", "second-print"],
  );
  assert.deepEqual(
    placements.map((placement) => placement.barIndex),
    [1, 1],
  );
  assert.deepEqual(
    placements.map((placement) => placement.eventDay),
    ["2026-04-30", "2026-04-30"],
  );
});

test("buildFlowChartEventPlacements does not assign gap events to a sparse previous candle", () => {
  const sparseBars: ChartBar[] = [
    {
      time: Date.parse("2026-05-01T19:55:00.000Z") / 1000,
      ts: "2026-05-01T19:55:00.000Z",
      date: "2026-05-01",
      o: 100,
      h: 101,
      l: 99,
      c: 100.5,
      v: 100_000,
    },
    {
      time: Date.parse("2026-05-04T13:30:00.000Z") / 1000,
      ts: "2026-05-04T13:30:00.000Z",
      date: "2026-05-04",
      o: 101,
      h: 102,
      l: 100,
      c: 101.5,
      v: 120_000,
    },
  ];
  const sparseRanges: ChartBarRange[] = [
    {
      startMs: Date.parse("2026-05-01T19:55:00.000Z"),
      endMs: Date.parse("2026-05-01T20:00:00.000Z"),
    },
    {
      startMs: Date.parse("2026-05-04T13:30:00.000Z"),
      endMs: Date.parse("2026-05-04T13:35:00.000Z"),
    },
  ];

  const placements = buildFlowChartEventPlacements(
    [
      flowEvent({
        id: "gap-print",
        time: "2026-05-01T21:00:00.000Z",
      }),
    ],
    { chartBars: sparseBars, chartBarRanges: sparseRanges },
  );

  assert.equal(placements.length, 0);
});

test("buildFlowChartEventPlacements only renders confirmed trades as price markers", () => {
  const placements = buildFlowChartEventPlacements(
    [
      flowEvent({
        id: "confirmed-print",
        time: "2026-04-30T14:31:00.000Z",
        metadata: {
          basis: "trade",
          sourceBasis: "confirmed_trade",
          timeBasis: "trade_reported",
          chartTimeSourceField: "sip_timestamp",
        },
      }),
      flowEvent({
        id: "snapshot-contract",
        time: "2026-04-30T14:31:00.000Z",
        metadata: {
          basis: "snapshot",
          sourceBasis: "snapshot_activity",
          timeBasis: "snapshot_observed",
          chartTimeSourceField: "updatedAt",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(placements.length, 1);
  assert.equal(placements[0].event.id, "confirmed-print");
  assert.equal(placements[0].sourceBasis, "confirmed_trade");
  assert.equal(placements[0].eventIso, "2026-04-30T14:31:00.000Z");
  assert.equal(placements[0].timeBasis, "trade_reported");
  assert.equal(placements[0].timeSourceField, "sip_timestamp");
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

test("buildFlowChartBuckets dedupes live and historical copies before totaling", () => {
  const buckets = buildFlowChartBuckets(
    [
      flowEvent({
        id: "live-print",
        metadata: {
          provider: "polygon",
          basis: "trade",
          sourceBasis: "confirmed_trade",
          optionTicker: "AAPL260515C00200000",
          cp: "C",
          strike: 200,
          expirationDate: "2026-05-15",
          side: "buy",
          price: 2.1,
          size: 20,
          premium: 42_000,
          contractLabel: "AAPL 200C",
        },
      }),
      flowEvent({
        id: "history-print",
        metadata: {
          provider: "polygon",
          basis: "trade",
          sourceBasis: "confirmed_trade",
          optionTicker: "AAPL260515C00200000",
          cp: "C",
          strike: 200,
          expirationDate: "2026-05-15",
          side: "buy",
          price: 2.1,
          size: 20,
          premium: 42_000,
          contractLabel: "AAPL 200C",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].count, 1);
  assert.equal(buckets[0].totalPremium, 42_000);
  assert.equal(buckets[0].totalContracts, 20);
  assert.equal(buildFlowTooltipModel(buckets[0]).title, "Flow event");
});

test("buildFlowChartBuckets keeps confirmed prints and snapshot activity separate on the same candle", () => {
  const buckets = buildFlowChartBuckets(
    [
      flowEvent({
        id: "same-candle-confirmed",
        metadata: {
          provider: "polygon",
          basis: "trade",
          sourceBasis: "confirmed_trade",
          optionTicker: "SPY260515C00500000",
          cp: "C",
          strike: 500,
          expirationDate: "2026-05-15",
          side: "buy",
          price: 2.1,
          size: 20,
          premium: 42_000,
          contractLabel: "SPY 500C",
        },
      }),
      flowEvent({
        id: "same-candle-snapshot",
        metadata: {
          provider: "ibkr",
          basis: "snapshot",
          sourceBasis: "snapshot_activity",
          optionTicker: "SPY260515C00500000",
          cp: "C",
          strike: 500,
          expirationDate: "2026-05-15",
          side: "buy",
          price: 2.1,
          size: 5000,
          premium: 1_050_000,
          contractLabel: "SPY 500C",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(buckets.length, 2);
  assert.deepEqual(
    buckets.map((bucket) => bucket.sourceBasis),
    ["confirmed_trade", "snapshot_activity"],
  );
  assert.deepEqual(
    buckets.map((bucket) => bucket.totalPremium),
    [42_000, 1_050_000],
  );
  assert.equal(buildFlowTooltipModel(buckets[0]).title, "Flow event");
  assert.equal(buildFlowTooltipModel(buckets[1]).title, "Active contract flow");
});

test("buildFlowChartBuckets keeps same-time prints distinct when size differs", () => {
  const buckets = buildFlowChartBuckets(
    [
      flowEvent({
        id: "small-print",
        metadata: {
          optionTicker: "AAPL260515C00200000",
          cp: "C",
          strike: 200,
          expirationDate: "2026-05-15",
          side: "buy",
          price: 2.1,
          size: 20,
          premium: 42_000,
          contractLabel: "AAPL 200C",
        },
      }),
      flowEvent({
        id: "large-print",
        metadata: {
          optionTicker: "AAPL260515C00200000",
          cp: "C",
          strike: 200,
          expirationDate: "2026-05-15",
          side: "buy",
          price: 2.1,
          size: 35,
          premium: 73_500,
          contractLabel: "AAPL 200C",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].count, 2);
  assert.equal(buckets[0].totalPremium, 115_500);
  assert.equal(buckets[0].totalContracts, 55);
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

test("buildFlowChartBuckets does not invent bias premium for zero-premium events", () => {
  const [bucket] = buildFlowChartBuckets(
    [
      flowEvent({
        id: "zero-bull",
        bias: "bullish",
        metadata: { cp: "C", premium: 0 },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(bucket.totalPremium, 0);
  assert.equal(bucket.bullishPremium, 0);
  assert.equal(bucket.bullishShare, 0);
  assert.equal(bucket.neutralShare, 1);
  assert.equal(bucket.bias, "bullish");
});

test("buildFlowTooltipModel rounds mix percentages to exactly 100", () => {
  const [bucket] = buildFlowChartBuckets(
    [
      flowEvent({
        id: "bull-third",
        bias: "bullish",
        metadata: { cp: "C", premium: 1 },
      }),
      flowEvent({
        id: "bear-third",
        bias: "bearish",
        metadata: { cp: "P", premium: 1 },
      }),
      flowEvent({
        id: "neutral-third",
        bias: "neutral",
        metadata: { cp: "C", premium: 1 },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  const tooltip = buildFlowTooltipModel(bucket);

  assert.equal(
    tooltip.bullishPercent + tooltip.bearishPercent + tooltip.neutralPercent,
    100,
  );
  assert.equal(tooltip.callPercent + tooltip.putPercent, 100);
});

test("buildFlowChartBuckets colors unclassified all-call flow with fallback bias", () => {
  const [bucket] = buildFlowChartBuckets(
    [
      flowEvent({
        id: "call-fallback",
        bias: "bullish",
        metadata: { cp: "C", premium: 250_000, biasBasis: "call_put_fallback" },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );
  const tooltip = buildFlowTooltipModel(bucket);

  assert.equal(bucket.bias, "bullish");
  assert.equal(bucket.biasBasis, "Calls 100%");
  assert.equal(bucket.bullishPremium, 0);
  assert.equal(bucket.neutralPremium, 250_000);
  assert.equal(tooltip.tone, "bullish");
  assert.equal(tooltip.biasBasis, "Calls 100%");
  assert.equal(tooltip.sideConfidence, "Unclassified");
});

test("buildFlowChartBuckets colors unclassified all-put flow with fallback bias", () => {
  const [bucket] = buildFlowChartBuckets(
    [
      flowEvent({
        id: "put-fallback",
        bias: "bearish",
        metadata: { cp: "P", premium: 250_000, biasBasis: "call_put_fallback" },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(bucket.bias, "bearish");
  assert.equal(bucket.biasBasis, "Puts 100%");
});

test("buildFlowChartBuckets keeps weak unclassified call put mix neutral", () => {
  const [bucket] = buildFlowChartBuckets(
    [
      flowEvent({
        id: "call-fallback",
        bias: "bullish",
        metadata: { cp: "C", premium: 60_000, biasBasis: "call_put_fallback" },
      }),
      flowEvent({
        id: "put-fallback",
        bias: "bearish",
        metadata: { cp: "P", premium: 40_000, biasBasis: "call_put_fallback" },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(bucket.bias, "neutral");
  assert.equal(bucket.biasBasis, "Mixed C/P");
});

test("buildFlowChartBuckets lets classified side beat call type fallback", () => {
  const [bucket] = buildFlowChartBuckets(
    [
      flowEvent({
        id: "sell-call",
        bias: "bearish",
        metadata: {
          cp: "C",
          premium: 100_000,
          side: "sell",
          sideBasis: "quote_match",
          sideConfidence: "high",
          biasBasis: "side",
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );
  const tooltip = buildFlowTooltipModel(bucket);

  assert.equal(bucket.bias, "bearish");
  assert.equal(bucket.biasBasis, "Side premium");
  assert.equal(tooltip.sideConfidence, "Quote high");
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

test("buildFlowChartVolumeBuckets excludes snapshot activity from rendered volume bars", () => {
  const buckets = buildFlowChartVolumeBuckets(
    [
      flowEvent({
        id: "confirmed-early",
        time: "2026-04-30T14:31:00.000Z",
        metadata: {
          cp: "C",
          premium: 200_000,
          contracts: 50,
          contractLabel: "AAPL 200C",
        },
      }),
      flowEvent({
        id: "confirmed-later",
        time: "2026-04-30T14:37:00.000Z",
        bias: "bearish",
        metadata: {
          cp: "P",
          premium: 350_000,
          contracts: 80,
          contractLabel: "AAPL 180P",
        },
      }),
      flowEvent({
        id: "snapshot-close",
        time: "2026-04-30T14:39:00.000Z",
        bias: "neutral",
        metadata: {
          basis: "snapshot",
          sourceBasis: "snapshot_activity",
          cp: "C",
          premium: 10_000_000,
          contracts: 5000,
          contractLabel: "AAPL 205C",
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
    buckets.map((bucket) => bucket.sourceBasis),
    ["confirmed_trade", "confirmed_trade"],
  );
  assert.deepEqual(
    buckets.map((bucket) => bucket.totalPremium),
    [200_000, 350_000],
  );
  assert.equal(
    buckets.some((bucket) =>
      bucket.events.some((event) => event.id === "snapshot-close"),
    ),
    false,
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
  assert.equal(diagnostics.markerEligibleEventCount, 3);
  assert.equal(diagnostics.markerPlacementCount, 1);
  assert.equal(diagnostics.droppedMarkerOutsideBarCount, 1);
});

test("summarizeFlowChartBucketPlacement reports duplicate flow drops", () => {
  const diagnostics = summarizeFlowChartBucketPlacement(
    [
      flowEvent({
        id: "live-print",
        metadata: {
          optionTicker: "AAPL260515C00200000",
          cp: "C",
          strike: 200,
          expirationDate: "2026-05-15",
          side: "buy",
          price: 2.1,
          size: 20,
          premium: 42_000,
        },
      }),
      flowEvent({
        id: "history-print",
        metadata: {
          optionTicker: "AAPL260515C00200000",
          cp: "C",
          strike: 200,
          expirationDate: "2026-05-15",
          side: "buy",
          price: 2.1,
          size: 20,
          premium: 42_000,
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(diagnostics.flowEventCount, 2);
  assert.equal(diagnostics.uniqueFlowEventCount, 1);
  assert.equal(diagnostics.droppedDuplicateFlowEventCount, 1);
  assert.equal(diagnostics.bucketedEventCount, 1);
});

test("summarizeFlowChartBucketPlacement reports confirmed and snapshot basis counts separately", () => {
  const diagnostics = summarizeFlowChartBucketPlacement(
    [
      flowEvent({
        id: "confirmed",
        metadata: {
          basis: "trade",
          sourceBasis: "confirmed_trade",
          cp: "C",
          premium: 42_000,
        },
      }),
      flowEvent({
        id: "snapshot",
        metadata: {
          basis: "snapshot",
          sourceBasis: "snapshot_activity",
          cp: "C",
          premium: 1_050_000,
        },
      }),
    ],
    { chartBars: bars, chartBarRanges: ranges },
  );

  assert.equal(diagnostics.uniqueFlowEventCount, 2);
  assert.equal(diagnostics.confirmedTradeFlowEventCount, 1);
  assert.equal(diagnostics.snapshotActivityFlowEventCount, 1);
  assert.equal(diagnostics.bucketedConfirmedTradeEventCount, 1);
  assert.equal(diagnostics.bucketedSnapshotActivityEventCount, 1);
  assert.equal(diagnostics.markerEligibleEventCount, 1);
  assert.equal(diagnostics.markerPlacementCount, 1);
  assert.equal(diagnostics.markerSnapshotSkippedEventCount, 1);
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
