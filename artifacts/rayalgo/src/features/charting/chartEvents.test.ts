import test from "node:test";
import assert from "node:assert/strict";
import {
  clusterChartEvents,
  earningsCalendarToChartEvents,
  flowEventsToChartEvents,
  getChartEventLookbackWindow,
} from "./chartEvents";

test("flowEventsToChartEvents normalizes unusual flow into bar events", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "flow-1",
        ticker: "AAPL",
        cp: "C",
        contract: "AAPL 200C",
        premium: 750_000,
        unusualScore: 3,
        occurredAt: "2026-04-28T14:30:00.000Z",
        isUnusual: true,
        flowBias: "bullish",
      },
    ],
    "AAPL",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "unusual_flow");
  assert.equal(events[0].placement, "bar");
  assert.equal(events[0].severity, "high");
  assert.equal(events[0].bias, "bullish");
  assert.equal(events[0].actions.includes("add_alert"), true);
});

test("flowEventsToChartEvents accepts symbol-only unusual flow payloads", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "flow-symbol-only",
        symbol: "NVDA",
        right: "call",
        strike: 910,
        premium: 640_000,
        unusualScore: 3.4,
        occurredAt: "2026-04-28T14:45:00.000Z",
        isUnusual: true,
        sentiment: "bullish",
      },
    ],
    "NVDA",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].symbol, "NVDA");
  assert.equal(events[0].label, "CALL $640K");
});

test("flowEventsToChartEvents promotes high-premium non-unusual options flow", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "flow-premium",
        ticker: "SPY",
        cp: "P",
        contract: "SPY 485P",
        premium: 320_000,
        unusualScore: 0.4,
        occurredAt: "2026-05-01T15:12:00.000Z",
        isUnusual: false,
        flowBias: "bearish",
      },
    ],
    "SPY",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].severity, "medium");
  assert.equal(events[0].summary, "SPY 485P options flow $320K");
  assert.equal(events[0].metadata.isUnusual, false);
});

test("earningsCalendarToChartEvents normalizes earnings into timescale events", () => {
  const events = earningsCalendarToChartEvents(
    [{ symbol: "MSFT", date: "2026-05-01", time: "amc" }],
    "MSFT",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "earnings");
  assert.equal(events[0].placement, "timescale");
  assert.equal(events[0].label, "E");
});

test("getChartEventLookbackWindow uses timeframe-aware extended history", () => {
  const now = new Date("2026-04-28T00:00:00.000Z");
  const intraday = getChartEventLookbackWindow("5m", now);
  const daily = getChartEventLookbackWindow("1d", now);

  assert.equal(intraday.from.toISOString(), "2026-04-26T00:00:00.000Z");
  assert.equal(daily.from.toISOString(), "2026-01-28T00:00:00.000Z");
});

test("clusterChartEvents labels clustered flow by count and net bias", () => {
  const events = flowEventsToChartEvents([
    {
      id: "flow-1",
      ticker: "AAPL",
      cp: "C",
      premium: 200_000,
      unusualScore: 1,
      occurredAt: "2026-04-28T14:30:00.000Z",
      isUnusual: true,
      flowBias: "bullish",
    },
    {
      id: "flow-2",
      ticker: "AAPL",
      cp: "C",
      premium: 300_000,
      unusualScore: 1,
      occurredAt: "2026-04-28T14:31:00.000Z",
      isUnusual: true,
      flowBias: "bullish",
    },
  ]);

  const clusters = clusterChartEvents(events, { bucketMs: 5 * 60 * 1000 });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 2);
  assert.equal(clusters[0].label, "2 bullish");
});
