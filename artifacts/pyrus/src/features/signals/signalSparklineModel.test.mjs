import assert from "node:assert/strict";
import test from "node:test";

import {
  SIGNAL_SPARKLINE_PENDING_COLOR,
  buildSignalEventsBySymbol,
  buildSignalSparklinePointColors,
  defaultSignalSparklineColorForDirection,
  resolveSignalSparklineFallbackColor,
} from "./signalSparklineModel.js";

const BLUE = "var(--ra-blue-500)";
const RED = "var(--ra-red-500)";

// Epoch-ms base so signalSparklineTimestampMs keeps values as-is (it rescales
// numbers below 10 billion as seconds).
const BASE = 1_700_000_000_000;
const at = (offset) => BASE + offset;
const pointsAt = (offsets) => offsets.map((offset) => ({ ms: at(offset) }));

test("direction color mapping is buy=blue / sell=red / else null", () => {
  assert.equal(defaultSignalSparklineColorForDirection("buy"), BLUE);
  assert.equal(defaultSignalSparklineColorForDirection("sell"), RED);
  assert.equal(defaultSignalSparklineColorForDirection("flat"), null);
  assert.equal(defaultSignalSparklineColorForDirection(undefined), null);
});

test("buildSignalEventsBySymbol keeps timeframe and sorts by time", () => {
  const bySymbol = buildSignalEventsBySymbol([
    { symbol: "aapl", direction: "sell", timeframe: "5m", signalAt: at(2000) },
    { symbol: "AAPL", direction: "buy", timeframe: "1m", signalAt: at(1000) },
    { symbol: "AAPL", direction: "nope", timeframe: "5m", signalAt: at(3000) },
  ]);
  const events = bySymbol.get("AAPL");
  assert.equal(events.length, 2, "invalid direction dropped");
  assert.deepEqual(
    events.map((e) => [e.direction, e.timeframe]),
    [
      ["buy", "1m"],
      ["sell", "5m"],
    ],
  );
});

test("colorTimeframe colors by the traded timeframe's events only", () => {
  const events = buildSignalEventsBySymbol([
    { symbol: "AAPL", direction: "buy", timeframe: "1m", signalAt: at(1000) },
    { symbol: "AAPL", direction: "sell", timeframe: "5m", signalAt: at(1000) },
  ]).get("AAPL");

  const colors = buildSignalSparklinePointColors({
    points: pointsAt([1500, 2000]),
    row: { timeframe: "1m" },
    signalEvents: events,
    colorTimeframe: "5m",
  });
  // Traded tf is 5m -> the 5m sell event drives the color, not the row's 1m buy.
  assert.deepEqual(colors, [RED, RED]);
});

test("colorTimeframe with no matching events falls back to flat (null)", () => {
  const events = buildSignalEventsBySymbol([
    { symbol: "AAPL", direction: "buy", timeframe: "1m", signalAt: at(1000) },
  ]).get("AAPL");

  const colors = buildSignalSparklinePointColors({
    points: pointsAt([1500, 2000]),
    row: { timeframe: "1m" },
    signalEvents: events,
    colorTimeframe: "15m",
  });
  assert.equal(colors, null);
});

test("latched row signal is dropped when row tf differs from traded tf", () => {
  const colors = buildSignalSparklinePointColors({
    points: pointsAt([1500, 2000]),
    row: {
      timeframe: "1m",
      direction: "buy",
      currentSignalAt: at(1000),
      status: "active-fresh",
    },
    signalEvents: [],
    colorTimeframe: "5m",
  });
  // Row's own 1m latched buy must not color a 5m-traded sparkline.
  assert.equal(colors, null);
});

test("latched row signal applies when row tf equals traded tf", () => {
  const colors = buildSignalSparklinePointColors({
    points: pointsAt([1500, 2000]),
    row: {
      timeframe: "5m",
      direction: "buy",
      currentSignalAt: at(1000),
      status: "active-fresh",
    },
    signalEvents: [],
    colorTimeframe: "5m",
  });
  assert.deepEqual(colors, [BLUE, BLUE]);
});

test("without colorTimeframe legacy per-row behavior is unchanged", () => {
  const colors = buildSignalSparklinePointColors({
    points: pointsAt([1500, 2000]),
    row: {
      timeframe: "1m",
      direction: "buy",
      currentSignalAt: at(1000),
      status: "active-fresh",
    },
    signalEvents: [],
  });
  assert.deepEqual(colors, [BLUE, BLUE]);
});

test("transitions over time recolor each point by the active signal", () => {
  const events = buildSignalEventsBySymbol([
    { symbol: "AAPL", direction: "buy", timeframe: "5m", signalAt: at(1000) },
    { symbol: "AAPL", direction: "sell", timeframe: "5m", signalAt: at(3000) },
  ]).get("AAPL");

  const colors = buildSignalSparklinePointColors({
    points: pointsAt([1500, 2500, 3500]),
    row: { timeframe: "5m" },
    signalEvents: events,
    colorTimeframe: "5m",
  });
  assert.deepEqual(colors, [BLUE, BLUE, RED]);
});

test("row state drops older and opposite-direction execution markers", () => {
  const events = buildSignalEventsBySymbol([
    { symbol: "AAPL", direction: "buy", timeframe: "5m", signalAt: at(2000) },
    { symbol: "AAPL", direction: "sell", timeframe: "5m", signalAt: at(4000) },
  ]).get("AAPL");

  const colors = buildSignalSparklinePointColors({
    points: pointsAt([2500, 3500, 4500]),
    row: {
      timeframe: "5m",
      direction: "buy",
      currentSignalAt: at(3000),
      status: "active-fresh",
    },
    signalEvents: events,
    colorTimeframe: "5m",
  });
  assert.deepEqual(colors, [RED, BLUE, BLUE]);
});

test("before a buy shows the opposite stance (sell), then flips to buy — never grey", () => {
  const events = buildSignalEventsBySymbol([
    { symbol: "AAPL", direction: "buy", timeframe: "5m", signalAt: at(2000) },
  ]).get("AAPL");

  const colors = buildSignalSparklinePointColors({
    points: pointsAt([1000, 1500, 2500, 3000]),
    row: { timeframe: "5m" },
    signalEvents: events,
    colorTimeframe: "5m",
  });
  // Points before the 2000 buy are sell (red); points at/after turn buy (blue).
  assert.deepEqual(colors, [RED, RED, BLUE, BLUE]);
});

test("fallback color stays muted until signal state hydrates (no launch green flash)", () => {
  // Launch regression: quotes/spark bars hydrate seconds before the signal
  // matrix/events. With no signal color and no hydration evidence, the
  // sparkline must NOT fall through to MicroSparkline's financial green/red
  // trend default (the "old green style") — it holds the muted pending stroke.
  assert.equal(
    resolveSignalSparklineFallbackColor({
      signalColor: null,
      signalStateHydrated: false,
    }),
    SIGNAL_SPARKLINE_PENDING_COLOR,
  );
});

test("fallback color defers to the caller once signal state is hydrated", () => {
  // Hydrated with no signal -> null, so surfaces that legitimately show a
  // financial trend (price mode) keep their existing behavior.
  assert.equal(
    resolveSignalSparklineFallbackColor({
      signalColor: null,
      signalStateHydrated: true,
    }),
    null,
  );
});

test("fallback color passes a resolved signal color through unchanged", () => {
  assert.equal(
    resolveSignalSparklineFallbackColor({
      signalColor: BLUE,
      signalStateHydrated: false,
    }),
    BLUE,
  );
  assert.equal(
    resolveSignalSparklineFallbackColor({
      signalColor: RED,
      signalStateHydrated: true,
    }),
    RED,
  );
});
