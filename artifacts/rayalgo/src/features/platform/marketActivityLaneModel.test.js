import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketActivityLanes,
  buildNotificationLaneRows,
  buildSignalLaneRows,
  buildUnusualLaneRows,
} from "./marketActivityLaneModel.js";

test("signal lane dedupes current state and matching event", () => {
  const rows = buildSignalLaneRows(
    {
      selectedTimeframe: "15m",
      states: [
        {
          id: "spy-state",
          symbol: "spy",
          timeframe: "15m",
          currentSignalDirection: "buy",
          currentSignalAt: "2026-04-30T15:55:00Z",
          currentSignalPrice: 510.25,
          fresh: true,
          active: true,
        },
      ],
      events: [
        {
          id: "spy-event",
          symbol: "SPY",
          timeframe: "15m",
          direction: "buy",
          signalAt: "2026-04-30T15:55:00Z",
          signalPrice: 510.25,
        },
      ],
    },
    { nowMs: Date.parse("2026-04-30T16:00:00Z") },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "SPY");
  assert.equal(rows[0].source, "state");
});

test("signal lane filters visible rows to selected timeframe", () => {
  const rows = buildSignalLaneRows(
    {
      selectedTimeframe: "5m",
      events: [
        {
          id: "aapl",
          symbol: "AAPL",
          timeframe: "5m",
          direction: "buy",
          signalAt: "2026-04-30T15:58:00Z",
        },
        {
          id: "nvda",
          symbol: "NVDA",
          timeframe: "15m",
          direction: "sell",
          signalAt: "2026-04-30T15:58:00Z",
        },
      ],
    },
    { nowMs: Date.parse("2026-04-30T16:00:00Z") },
  );

  assert.deepEqual(
    rows.map((row) => row.symbol),
    ["AAPL"],
  );
});

test("signal lane ranks fresh current signals before stale events", () => {
  const rows = buildSignalLaneRows(
    {
      selectedTimeframe: "15m",
      states: [
        {
          id: "old-current",
          symbol: "MSFT",
          timeframe: "15m",
          currentSignalDirection: "sell",
          currentSignalAt: "2026-04-30T14:00:00Z",
          fresh: true,
          active: true,
        },
      ],
      events: [
        {
          id: "new-event",
          symbol: "TSLA",
          timeframe: "15m",
          direction: "buy",
          signalAt: "2026-04-30T15:59:00Z",
        },
      ],
    },
    { nowMs: Date.parse("2026-04-30T16:00:00Z") },
  );

  assert.equal(rows[0].symbol, "MSFT");
  assert.equal(rows[0].source, "state");
});

test("unusual lane excludes routine flow and sorts by recency, score, then premium", () => {
  const rows = buildUnusualLaneRows([
    {
      id: "routine",
      ticker: "SPY",
      isUnusual: false,
      unusualScore: 20,
      premium: 900_000,
      occurredAt: "2026-04-30T15:59:00Z",
    },
    {
      id: "older-higher-score",
      ticker: "NVDA",
      isUnusual: true,
      unusualScore: 10,
      premium: 300_000,
      occurredAt: "2026-04-30T15:55:00Z",
    },
    {
      id: "newer",
      ticker: "QQQ",
      isUnusual: true,
      unusualScore: 2,
      premium: 100_000,
      occurredAt: "2026-04-30T15:59:00Z",
    },
    {
      id: "same-time-bigger",
      ticker: "IWM",
      isUnusual: true,
      unusualScore: 2,
      premium: 250_000,
      occurredAt: "2026-04-30T15:59:00Z",
    },
  ]);

  assert.deepEqual(
    rows.map((row) => row.symbol),
    ["IWM", "QQQ", "NVDA"],
  );
});

test("notifications keep alerts, news, and calendar separate from signal and UOA lanes", () => {
  const lanes = buildMarketActivityLanes(
    {
      selectedTimeframe: "15m",
      notifications: [
        {
          id: "risk",
          symbol: "AMD",
          label: "AMD risk alert",
          detail: "-26.0% unrealized PnL",
          tone: "risk",
          updatedAt: "2026-04-30T15:00:00Z",
        },
      ],
      signalEvents: [
        {
          id: "signal",
          symbol: "SPY",
          timeframe: "15m",
          direction: "buy",
          signalAt: "2026-04-30T15:58:00Z",
        },
      ],
      highlightedUnusualFlow: [
        {
          id: "flow",
          ticker: "NVDA",
          isUnusual: true,
          unusualScore: 3,
          premium: 150_000,
          occurredAt: "2026-04-30T15:57:00Z",
        },
      ],
      newsItems: [
        {
          id: "news",
          text: "Market headline",
          tag: "NEWS",
          time: "1m",
          publishedAt: "2026-04-30T15:59:00Z",
        },
      ],
      calendarItems: [
        {
          id: "cal",
          label: "AAPL earnings",
          symbol: "AAPL",
          date: "Today AMC",
          dateTime: "2026-04-30T20:00:00Z",
          type: "earnings",
        },
      ],
    },
    {
      signals: { nowMs: Date.parse("2026-04-30T16:00:00Z") },
    },
  );

  assert.deepEqual(lanes.signals.map((row) => row.kind), ["signal"]);
  assert.deepEqual(lanes.unusual.map((row) => row.kind), ["unusual"]);
  assert.deepEqual(
    lanes.notifications.map((row) => row.kind),
    ["alert", "calendar", "news"],
  );
});

test("notification lane ranks portfolio alerts before news and calendar", () => {
  const rows = buildNotificationLaneRows({
    alerts: [
      {
        id: "old-alert",
        label: "Portfolio drawdown",
        tone: "risk",
        updatedAt: "2026-04-30T10:00:00Z",
      },
    ],
    news: [
      {
        id: "new-news",
        text: "Fresh headline",
        publishedAt: "2026-04-30T15:59:00Z",
      },
    ],
  });

  assert.equal(rows[0].kind, "alert");
});
