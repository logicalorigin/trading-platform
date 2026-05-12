import test from "node:test";
import assert from "node:assert/strict";
import {
  clusterChartEvents,
  earningsCalendarToChartEvents,
  filterFlowEventsForChartLookbackWindow,
  filterFlowEventsForOptionContract,
  filterFlowEventsForSymbol,
  flowEventsToChartEventConversion,
  flowEventsToChartEvents,
  getChartEventLookbackWindow,
  getStableFlowEventKey,
  mergeFlowEventFeeds,
  resolveFlowEventChartTimeResolution,
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

test("flowEventsToChartEventConversion reports symbol and time drops", () => {
  const conversion = flowEventsToChartEventConversion(
    [
      {
        id: "visible",
        ticker: "SPY",
        cp: "C",
        premium: 125_000,
        occurredAt: "2026-05-01T15:12:00.000Z",
      },
      {
        id: "wrong-symbol",
        ticker: "QQQ",
        cp: "P",
        premium: 90_000,
        occurredAt: "2026-05-01T15:13:00.000Z",
      },
      {
        id: "missing-time",
        ticker: "SPY",
        cp: "C",
        premium: 50_000,
      },
    ],
    "SPY",
  );

  assert.equal(conversion.rawInputCount, 3);
  assert.equal(conversion.flowRecordCount, 3);
  assert.equal(conversion.convertedEventCount, 1);
  assert.equal(conversion.droppedSymbolCount, 1);
  assert.equal(conversion.droppedInvalidTimeCount, 1);
  assert.deepEqual(
    conversion.events.map((event) => event.id),
    ["visible"],
  );
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

test("flowEventsToChartEvents renders mapped UI flow with uppercase side", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "ui-flow",
        ticker: "SPY",
        cp: "C",
        contract: "SPY 500C May 15",
        premium: 125_000,
        unusualScore: 0.2,
        occurredAt: "2026-05-01T15:12:00.000Z",
        side: "BUY",
        isUnusual: false,
      },
    ],
    "SPY",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].label, "C $125K");
});

test("flowEventsToChartEvents renders flow-filtered rows without a hidden material gate", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "filtered-visible-flow",
        ticker: "SPY",
        cp: "P",
        contract: "SPY 485P",
        premium: 42_000,
        unusualScore: 0,
        occurredAt: "2026-05-01T15:13:20.000Z",
        side: "SELL",
        isUnusual: false,
      },
    ],
    "SPY",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "filtered-visible-flow");
  assert.equal(events[0].severity, "low");
  assert.equal(events[0].summary, "SPY 485P options flow $42K");
});

test("flowEventsToChartEvents maps side and right into flow bias", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "call-buy",
        ticker: "SPY",
        cp: "C",
        premium: 125_000,
        occurredAt: "2026-05-01T15:12:00.000Z",
        side: "BUY",
      },
      {
        id: "put-buy",
        ticker: "SPY",
        cp: "P",
        premium: 130_000,
        occurredAt: "2026-05-01T15:13:00.000Z",
        side: "BUY",
      },
      {
        id: "put-sell",
        ticker: "SPY",
        cp: "P",
        premium: 140_000,
        occurredAt: "2026-05-01T15:14:00.000Z",
        side: "SELL",
      },
    ],
    "SPY",
  );

  assert.deepEqual(
    events.map((event) => event.bias),
    ["bullish", "bearish", "bullish"],
  );
});

test("flowEventsToChartEvents trusts classified side over neutral sentiment", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "tick-test-call-buy",
        ticker: "SPY",
        cp: "C",
        premium: "125,000",
        unusualScore: "2.5",
        occurredAt: "2026-05-01T15:12:00.000Z",
        side: "buy",
        sideBasis: "tick_test",
        sideConfidence: "medium",
        sentiment: "neutral",
      },
      {
        id: "unclassified-call-buy",
        ticker: "SPY",
        cp: "C",
        premium: "125000",
        occurredAt: "2026-05-01T15:13:00.000Z",
        side: "buy",
        sideBasis: "none",
        sentiment: "neutral",
      },
      {
        id: "unclassified-put",
        ticker: "SPY",
        cp: "P",
        premium: "125000",
        occurredAt: "2026-05-01T15:14:00.000Z",
        side: "mid",
        sideBasis: "none",
        sentiment: "neutral",
      },
      {
        id: "classified-sell-call",
        ticker: "SPY",
        cp: "C",
        premium: "125000",
        occurredAt: "2026-05-01T15:15:00.000Z",
        side: "sell",
        sideBasis: "quote_match",
        sideConfidence: "high",
        sentiment: "neutral",
      },
    ],
    "SPY",
  );

  assert.equal(events[0].bias, "bullish");
  assert.equal(events[0].severity, "high");
  assert.equal(events[0].label, "C $125K");
  assert.equal(events[1].bias, "bullish");
  assert.equal(events[1].metadata.biasBasis, "call_put_fallback");
  assert.equal(events[2].bias, "bearish");
  assert.equal(events[2].metadata.biasBasis, "call_put_fallback");
  assert.equal(events[3].bias, "bearish");
  assert.equal(events[3].metadata.biasBasis, "side");
});

test("flowEventsToChartEvents reads raw Polygon/Massive trade timestamps", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "massive-trade",
        ticker: "SPY",
        cp: "C",
        premium: 125_000,
        sip_timestamp: 1_777_647_120_000_000_000,
        side: "BUY",
        provider: "polygon",
      },
    ],
    "SPY",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].time, "2026-05-01T14:52:00.000Z");
  assert.equal(events[0].source, "polygon");
  assert.equal(events[0].bias, "bullish");
  assert.equal(events[0].metadata.timeBasis, "trade_reported");
  assert.equal(events[0].metadata.chartTimeSourceField, "sip_timestamp");
});

test("flowEventsToChartEvents uses provider trade time before update and observed times", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "raw-t-trade",
        ticker: "SPY",
        cp: "C",
        premium: 125_000,
        t: Date.parse("2026-05-01T14:52:00.000Z") * 1_000_000,
        occurredAt: "2026-05-01T19:58:00.000Z",
        updatedAt: "2026-05-01T19:59:00.000Z",
        side: "BUY",
        provider: "polygon",
      },
    ],
    "SPY",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].time, "2026-05-01T14:52:00.000Z");
  assert.equal(events[0].metadata.chartTimeSourceField, "t");
});

test("flowEventsToChartEvents combines separate trade date and time in New York time", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "date-time-trade",
        ticker: "SPY",
        cp: "C",
        premium: 125_000,
        tradeDate: "2026-05-01",
        tradeTime: "09:52:15",
        side: "BUY",
        provider: "polygon",
      },
    ],
    "SPY",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].time, "2026-05-01T13:52:15.000Z");
  assert.equal(events[0].metadata.chartTimeSourceField, "tradeDate+tradeTime");
  assert.equal(events[0].metadata.chartEventDay, "2026-05-01");
});

test("flowEventsToChartEventConversion drops confirmed date-only events", () => {
  const conversion = flowEventsToChartEventConversion(
    [
      {
        id: "date-only-trade",
        ticker: "SPY",
        basis: "trade",
        sourceBasis: "confirmed_trade",
        cp: "C",
        premium: 125_000,
        occurredAt: "2026-05-01",
      },
    ],
    "SPY",
  );

  assert.equal(conversion.convertedEventCount, 0);
  assert.equal(conversion.droppedInvalidTimeCount, 1);
  assert.equal(
    resolveFlowEventChartTimeResolution({
      ticker: "SPY",
      basis: "trade",
      sourceBasis: "confirmed_trade",
      occurredAt: "2026-05-01",
    }),
    null,
  );
});

test("flowEventsToChartEventConversion drops confirmed trades with only update time", () => {
  const conversion = flowEventsToChartEventConversion(
    [
      {
        id: "updated-only-trade",
        ticker: "SPY",
        basis: "trade",
        sourceBasis: "confirmed_trade",
        cp: "C",
        premium: 125_000,
        updatedAt: "2026-05-01T19:59:00.000Z",
      },
    ],
    "SPY",
  );

  assert.equal(conversion.rawInputCount, 1);
  assert.equal(conversion.flowRecordCount, 1);
  assert.equal(conversion.convertedEventCount, 0);
  assert.equal(conversion.droppedInvalidTimeCount, 1);
});

test("flowEventsToChartEvents allows snapshot flow to use observation update time", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "snapshot-updated-time",
        ticker: "SPY",
        basis: "snapshot",
        sourceBasis: "snapshot_activity",
        cp: "C",
        contract: "SPY 500C",
        premium: 420_000,
        updatedAt: "2026-05-01T19:59:00.000Z",
      },
    ],
    "SPY",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].time, "2026-05-01T19:59:00.000Z");
  assert.equal(events[0].metadata.timeBasis, "snapshot_observed");
});

test("flow event helpers merge feeds and match selected option contracts", () => {
  const broad = [
    {
      id: "spy-call",
      ticker: "SPY",
      providerContractId: "conid-call",
      optionTicker: "SPY250515C00500000",
      cp: "C",
      strike: 500,
      expirationDate: "2026-05-15",
      premium: 300_000,
    },
  ];
  const local = [
    broad[0],
    {
      id: "spy-put",
      ticker: "SPY",
      providerContractId: "conid-put",
      cp: "P",
      strike: 500,
      expirationDate: "2026-05-15",
      premium: 250_000,
    },
    {
      id: "qqq-call",
      ticker: "QQQ",
      providerContractId: "conid-qqq",
      cp: "C",
      strike: 430,
      expirationDate: "2026-05-15",
      premium: 200_000,
    },
  ];

  const merged = mergeFlowEventFeeds(broad, local);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    filterFlowEventsForSymbol(merged, "SPY").map((event) => event.id),
    ["spy-call", "spy-put"],
  );
  assert.deepEqual(
    filterFlowEventsForOptionContract(merged, {
      symbol: "SPY",
      providerContractId: "conid-call",
      expirationDate: "2026-05-15",
      right: "call",
      strike: 500,
    }).map((event) => event.id),
    ["spy-call"],
  );
});

test("mergeFlowEventFeeds keeps distinct trade rows without ids", () => {
  const rows = mergeFlowEventFeeds(
    [
      {
        ticker: "SPY",
        provider: "polygon",
        basis: "trade",
        optionTicker: "SPY260515C00500000",
        cp: "C",
        strike: 500,
        expirationDate: "2026-05-15",
        occurredAt: "2026-05-01T15:12:00.000Z",
        side: "buy",
        price: 2.1,
        size: 20,
        premium: 42_000,
      },
      {
        ticker: "SPY",
        provider: "polygon",
        basis: "trade",
        optionTicker: "SPY260515C00500000",
        cp: "C",
        strike: 500,
        expirationDate: "2026-05-15",
        occurredAt: "2026-05-01T15:12:00.000Z",
        side: "buy",
        price: 2.1,
        size: 35,
        premium: 73_500,
      },
    ],
  );

  assert.equal(rows.length, 2);
});

test("mergeFlowEventFeeds dedupes the same confirmed trade with different ids", () => {
  const rows = mergeFlowEventFeeds(
    [
      {
        id: "live-print",
        ticker: "SPY",
        provider: "polygon",
        basis: "trade",
        sourceBasis: "confirmed_trade",
        optionTicker: "SPY260515C00500000",
        cp: "C",
        strike: 500,
        expirationDate: "2026-05-15",
        occurredAt: "2026-05-01T15:12:00.000Z",
        side: "buy",
        price: 2.1,
        size: 20,
        premium: 42_000,
      },
    ],
    [
      {
        id: "history-print",
        ticker: "SPY",
        provider: "polygon",
        basis: "trade",
        sourceBasis: "confirmed_trade",
        optionTicker: "SPY260515C00500000",
        cp: "C",
        strike: 500,
        expirationDate: "2026-05-15",
        occurredAt: "2026-05-01T15:12:00.000Z",
        side: "buy",
        price: 2.1,
        size: 20,
        premium: 42_000,
      },
    ],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "live-print");
});

test("mergeFlowEventFeeds keeps confirmed trades and snapshot activity separate when ids collide", () => {
  const rows = mergeFlowEventFeeds(
    [
      {
        id: "provider-reused-id",
        ticker: "SPY",
        provider: "polygon",
        basis: "trade",
        sourceBasis: "confirmed_trade",
        optionTicker: "SPY260515C00500000",
        cp: "C",
        strike: 500,
        expirationDate: "2026-05-15",
        occurredAt: "2026-05-01T15:12:00.000Z",
        side: "buy",
        price: 2.1,
        size: 20,
        premium: 42_000,
      },
    ],
    [
      {
        id: "provider-reused-id",
        ticker: "SPY",
        provider: "ibkr",
        basis: "snapshot",
        sourceBasis: "snapshot_activity",
        optionTicker: "SPY260515C00500000",
        cp: "C",
        strike: 500,
        expirationDate: "2026-05-15",
        occurredAt: "2026-05-01T15:12:00.000Z",
        side: "buy",
        price: 2.1,
        size: 5000,
        premium: 1_050_000,
      },
    ],
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.sourceBasis),
    ["confirmed_trade", "snapshot_activity"],
  );
});

test("snapshot flow feeds dedupe by stable contract identity", () => {
  const broad = {
    id: "SPY260515C00500000-1770000000000",
    ticker: "SPY",
    provider: "ibkr",
    basis: "snapshot",
    sourceBasis: "snapshot_activity",
    providerContractId: "12345",
    optionTicker: "SPY260515C00500000",
    cp: "C",
    strike: 500,
    expirationDate: "2026-05-15",
    occurredAt: "2026-05-01T20:59:00.000Z",
    premium: 300_000,
  };
  const local = {
    ...broad,
    id: "SPY260515C00500000-1770000060000",
    occurredAt: "2026-05-01T21:00:00.000Z",
    premium: 325_000,
  };

  const merged = mergeFlowEventFeeds([broad], [local]);
  const chartEvents = flowEventsToChartEvents(merged, "SPY");

  assert.equal(merged.length, 1);
  assert.equal(getStableFlowEventKey(broad), getStableFlowEventKey(local));
  assert.equal(chartEvents[0].id, getStableFlowEventKey(broad));
});

test("flowEventsToChartEvents preserves snapshot time basis without treating it as a print", () => {
  const events = flowEventsToChartEvents(
    [
      {
        id: "snapshot-flow",
        ticker: "SPY",
        basis: "snapshot",
        sourceBasis: "snapshot_activity",
        cp: "C",
        contract: "SPY 500C",
        premium: 420_000,
        unusualScore: 1.5,
        occurredAt: "2026-05-01T15:12:00.000Z",
        time: "11:12 AM",
        isUnusual: true,
      },
    ],
    "SPY",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].time, "2026-05-01T15:12:00.000Z");
  assert.equal(events[0].summary, "SPY 500C snapshot activity $420K");
  assert.equal(events[0].metadata.timeBasis, "snapshot_observed");
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
  const fifteenMinute = getChartEventLookbackWindow("15m", now);
  const daily = getChartEventLookbackWindow("1d", now);

  assert.equal(intraday.from.toISOString(), "2026-04-23T13:30:00.000Z");
  assert.equal(fifteenMinute.from.toISOString(), "2026-04-10T13:30:00.000Z");
  assert.equal(daily.from.toISOString(), "2026-01-28T00:00:00.000Z");
});

test("getChartEventLookbackWindow includes full prior sessions after market close", () => {
  const now = new Date("2026-05-08T01:00:00.000Z");
  const intraday = getChartEventLookbackWindow("5m", now);

  assert.equal(intraday.from.toISOString(), "2026-05-05T13:30:00.000Z");
  assert.equal(intraday.to.toISOString(), now.toISOString());
});

test("filterFlowEventsForChartLookbackWindow keeps window events and newest overflow only", () => {
  const events = [
    {
      id: "old",
      ticker: "AAPL",
      occurredAt: "2026-04-30T14:30:00.000Z",
    },
    {
      id: "window",
      ticker: "AAPL",
      occurredAt: "2026-05-06T14:30:00.000Z",
    },
    {
      id: "newest",
      ticker: "AAPL",
      occurredAt: "2026-05-07T14:30:00.000Z",
    },
  ];

  const filtered = filterFlowEventsForChartLookbackWindow(events, "5m", {
    now: new Date("2026-05-07T16:00:00.000Z"),
    keepNewest: 1,
  });

  assert.deepEqual(filtered.map((event) => event.id), ["window", "newest"]);
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

test("clusterChartEvents resolves net bias by premium before counts", () => {
  const events = flowEventsToChartEvents([
    {
      id: "small-bull",
      ticker: "AAPL",
      cp: "C",
      premium: 25_000,
      occurredAt: "2026-04-28T14:30:00.000Z",
      flowBias: "bullish",
    },
    {
      id: "large-bear",
      ticker: "AAPL",
      cp: "P",
      premium: 500_000,
      occurredAt: "2026-04-28T14:31:00.000Z",
      flowBias: "bearish",
    },
    {
      id: "small-bull-2",
      ticker: "AAPL",
      cp: "C",
      premium: 25_000,
      occurredAt: "2026-04-28T14:32:00.000Z",
      flowBias: "bullish",
    },
  ]);

  const clusters = clusterChartEvents(events, { bucketMs: 5 * 60 * 1000 });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].bias, "bearish");
  assert.equal(clusters[0].label, "3 bearish");
});

test("clusterChartEvents uses call put fallback only after side bias is unavailable", () => {
  const events = flowEventsToChartEvents([
    {
      id: "fallback-call",
      ticker: "AAPL",
      cp: "C",
      premium: 60_000,
      occurredAt: "2026-04-28T14:30:00.000Z",
      side: "mid",
      sideBasis: "none",
      sentiment: "neutral",
    },
    {
      id: "fallback-put",
      ticker: "AAPL",
      cp: "P",
      premium: 40_000,
      occurredAt: "2026-04-28T14:31:00.000Z",
      side: "mid",
      sideBasis: "none",
      sentiment: "neutral",
    },
  ]);

  const clusters = clusterChartEvents(events, { bucketMs: 5 * 60 * 1000 });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].bias, "neutral");
});
