import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChartEvent } from "./chartEvents.ts";
import {
  buildFlowChartBuckets,
  buildFlowChartEventPlacements,
  buildFlowTooltipModel,
  summarizeFlowChartBucketPlacement,
} from "./flowChartEvents.ts";
import type { ChartBar } from "./types.ts";

test("flow placement diagnostics include the snapshot marker cap", () => {
  const startSeconds = 1_700_000_000;
  const chartBars: ChartBar[] = Array.from({ length: 61 }, (_, index) => ({
    time: startSeconds + index * 60,
    ts: new Date((startSeconds + index * 60) * 1_000).toISOString(),
    date: new Date((startSeconds + index * 60) * 1_000)
      .toISOString()
      .slice(0, 10),
    o: 100,
    h: 101,
    l: 99,
    c: 100,
    v: 1_000,
  }));
  const events: ChartEvent[] = chartBars.map((bar, index) => ({
    id: `snapshot-${index}`,
    symbol: "AAPL",
    eventType: "unusual_flow",
    time: new Date(bar.time * 1_000).toISOString(),
    placement: "bar",
    severity: "low",
    label: "C",
    summary: "Snapshot activity",
    source: "flow",
    confidence: 1,
    bias: "neutral",
    actions: [],
    metadata: {
      sourceBasis: "snapshot_activity",
      providerContractId: `contract-${index}`,
      premium: index + 1,
    },
  }));
  const model = { chartBars };

  const placements = buildFlowChartEventPlacements(events, model);
  const diagnostics = summarizeFlowChartBucketPlacement(events, model);

  assert.equal(placements.length, 60);
  assert.equal(diagnostics.markerPlacementCount, placements.length);
  assert.equal(diagnostics.markerSnapshotSkippedEventCount, 1);
});

test("off-chart priority events cannot exhaust the visible marker cap", () => {
  const chartTime = "2026-07-20T14:30:00.000Z";
  const chartBars: ChartBar[] = [
    {
      time: Date.parse(chartTime) / 1_000,
      ts: chartTime,
      date: chartTime.slice(0, 10),
      o: 100,
      h: 101,
      l: 99,
      c: 100,
      v: 1_000,
    },
  ];
  const offChartEvents: ChartEvent[] = Array.from(
    { length: 200 },
    (_, index) => ({
      id: `off-chart-${index}`,
      symbol: "AAPL",
      eventType: "unusual_flow",
      time: new Date(Date.parse(chartTime) - (index + 1) * 86_400_000).toISOString(),
      placement: "bar",
      severity: "high",
      label: "C",
      summary: "Off-chart confirmed trade",
      source: "flow",
      confidence: 1,
      bias: "bullish",
      actions: [],
      metadata: {
        sourceBasis: "confirmed_trade",
        optionTicker: `OFF${index}`,
        premium: 1_000_000 + index,
      },
    }),
  );
  const visibleEvent: ChartEvent = {
    id: "visible",
    symbol: "AAPL",
    eventType: "unusual_flow",
    time: chartTime,
    placement: "bar",
    severity: "low",
    label: "C",
    summary: "Visible confirmed trade",
    source: "flow",
    confidence: 1,
    bias: "bullish",
    actions: [],
    metadata: {
      sourceBasis: "confirmed_trade",
      optionTicker: "VISIBLE",
      premium: 1,
    },
  };

  const model = { chartBars };
  const events = [...offChartEvents, visibleEvent];
  const placements = buildFlowChartEventPlacements(events, model);
  const diagnostics = summarizeFlowChartBucketPlacement(events, model);

  assert.deepEqual(placements.map((placement) => placement.event.id), ["visible"]);
  assert.equal(diagnostics.markerPlacementCount, 1);
  assert.equal(diagnostics.droppedOutsideBarCount, 200);
  assert.equal(diagnostics.droppedMarkerOutsideBarCount, 0);
});

test("flow tooltip DTE accepts the same expiration alias as expiry display", () => {
  const eventTime = "2026-07-20T14:30:00.000Z";
  const chartBars: ChartBar[] = [
    {
      time: Date.parse(eventTime) / 1_000,
      ts: eventTime,
      date: eventTime.slice(0, 10),
      o: 100,
      h: 101,
      l: 99,
      c: 100,
      v: 1_000,
    },
  ];
  const [bucket] = buildFlowChartBuckets(
    [
      {
        id: "expiration-alias",
        symbol: "AAPL",
        eventType: "unusual_flow",
        time: eventTime,
        placement: "bar",
        severity: "medium",
        label: "C",
        summary: "Confirmed trade",
        source: "flow",
        confidence: 1,
        bias: "bullish",
        actions: [],
        metadata: {
          sourceBasis: "confirmed_trade",
          optionTicker: "AAPL260725C00100000",
          exp: "2026-07-25",
          premium: 100,
        },
      },
    ],
    { chartBars },
  );

  const tooltip = buildFlowTooltipModel(bucket);
  assert.equal(tooltip.topExpiry, "7/25");
  assert.equal(tooltip.dte, "5d");
});
