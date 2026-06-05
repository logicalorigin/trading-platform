import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSignalEventsBySymbol,
  buildSignalSparklinePointColors,
} from "./signalSparklineModel.js";

test("buildSignalEventsBySymbol normalizes, filters, and orders signal events", () => {
  const eventsBySymbol = buildSignalEventsBySymbol([
    { symbol: "spy", direction: "buy", signalAt: "2026-06-04T14:35:00.000Z", timeframe: "5m" },
    { symbol: "SPY", direction: "hold", signalAt: "2026-06-04T14:40:00.000Z", timeframe: "5m" },
    { symbol: "SPY", direction: "sell", signalAt: "2026-06-04T14:30:00.000Z", timeframe: "1m" },
    { symbol: "", direction: "buy", signalAt: "2026-06-04T14:45:00.000Z", timeframe: "5m" },
  ]);

  assert.deepEqual(
    eventsBySymbol.get("SPY").map((event) => [event.direction, event.timeframe]),
    [
      ["sell", "1m"],
      ["buy", "5m"],
    ],
  );
});

test("buildSignalSparklinePointColors colors only matching timeframe transitions", () => {
  const eventsBySymbol = buildSignalEventsBySymbol([
    { symbol: "SPY", direction: "sell", signalAt: "2026-06-04T14:30:00.000Z", timeframe: "1m" },
    { symbol: "SPY", direction: "buy", signalAt: "2026-06-04T14:35:00.000Z", timeframe: "5m" },
  ]);
  const colors = buildSignalSparklinePointColors({
    points: [
      { ms: Date.parse("2026-06-04T14:29:00.000Z"), value: 100 },
      { ms: Date.parse("2026-06-04T14:32:00.000Z"), value: 99 },
      { ms: Date.parse("2026-06-04T14:36:00.000Z"), value: 101 },
    ],
    row: {
      timeframe: "5m",
      direction: "buy",
      currentSignalAt: "2026-06-04T14:35:00.000Z",
      status: "active-fresh",
    },
    signalEvents: eventsBySymbol.get("SPY"),
  });

  assert.deepEqual(colors, [
    "var(--ra-blue-500)",
    "var(--ra-blue-500)",
    "var(--ra-blue-500)",
  ]);
});

test("buildSignalSparklinePointColors falls back to latest signal color without timestamps", () => {
  const colors = buildSignalSparklinePointColors({
    points: [{ value: 100 }, { value: 101 }, { value: 102 }],
    row: {
      timeframe: "1m",
      direction: "sell",
      currentSignalAt: "2026-06-04T14:35:00.000Z",
      status: "active-stale",
    },
    signalEvents: [],
  });

  assert.deepEqual(colors, [
    "var(--ra-red-500)",
    "var(--ra-red-500)",
    "var(--ra-red-500)",
  ]);
});
