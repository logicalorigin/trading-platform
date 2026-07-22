import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  __stockAggregateStreamTestInternals,
  getStockAggregateStreamDiagnostics,
  resolvePreferredStockAggregateStreamSource,
  subscribeMutableStockMinuteAggregates,
  type StockMinuteAggregateMessage,
} from "./stock-aggregate-stream";

const aggregate = (
  overrides: Partial<StockMinuteAggregateMessage> = {},
): StockMinuteAggregateMessage => ({
  eventType: "AM",
  symbol: "AAPL",
  open: 200,
  high: 201,
  low: 199,
  close: 200.5,
  volume: 100,
  accumulatedVolume: 1_000,
  vwap: 200.25,
  sessionVwap: 200,
  officialOpen: 198,
  averageTradeSize: 10,
  startMs: Date.parse("2026-07-16T18:30:00.000Z"),
  endMs: Date.parse("2026-07-16T18:30:59.999Z"),
  delayed: false,
  source: "massive-websocket",
  ...overrides,
});

test("stock aggregate stream prefers Massive realtime when available", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      massiveDelayedConfigured: true,
      massiveRealtimeConfigured: true,
    }),
    "massive-websocket",
  );
});

test("stock aggregate stream does not wait on configured IBKR when delayed Massive is available", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      massiveDelayedConfigured: true,
      massiveRealtimeConfigured: false,
    }),
    "massive-delayed-websocket",
  );
});

test("stock aggregate stream reports unavailable without Massive", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      massiveDelayedConfigured: false,
      massiveRealtimeConfigured: false,
    }),
    "none",
  );
});

test("stock aggregate stream reports unavailable when no provider is configured", () => {
  assert.equal(
    resolvePreferredStockAggregateStreamSource({
      massiveDelayedConfigured: false,
      massiveRealtimeConfigured: false,
    }),
    "none",
  );
});

test("stock aggregate service has no synthetic data-heartbeat creator", () => {
  const source = readFileSync(
    new URL("./stock-aggregate-stream.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /AGGREGATE_STALE_HEARTBEAT_MS/);
  assert.doesNotMatch(source, /carryForwardAccumulator/);
  assert.doesNotMatch(source, /emitAggregateHeartbeats/);
  assert.doesNotMatch(source, /synthetic:\s*true/);
});

test("real aggregate fanout records source freshness", () => {
  __stockAggregateStreamTestInternals.reset();
  try {
    __stockAggregateStreamTestInternals.scheduleAggregateFanoutForTests(
      aggregate(),
      Date.parse("2026-07-16T18:31:06.000Z"),
    );
    __stockAggregateStreamTestInternals.flushAggregateFanout();

    const diagnostics = getStockAggregateStreamDiagnostics();
    assert.equal(diagnostics.eventCount, 1);
    assert.equal(diagnostics.lastAggregateAt, "2026-07-16T18:31:06.000Z");
    assert.equal(diagnostics.historyAggregateCount, 1);
  } finally {
    __stockAggregateStreamTestInternals.reset();
  }
});

test("raw quote patches are limited to explicit subscribers without shrinking aggregate breadth", () => {
  __stockAggregateStreamTestInternals.reset();
  const bulkSymbols = Array.from(
    { length: 2_000 },
    (_, index) => `BULK${index}`,
  );
  const bulk = subscribeMutableStockMinuteAggregates(
    bulkSymbols,
    () => {},
    { rawQuotePatches: false },
  );
  const foreground = subscribeMutableStockMinuteAggregates(
    ["AAPL"],
    () => {},
    { rawQuotePatches: true },
  );

  try {
    const diagnostics = getStockAggregateStreamDiagnostics();
    assert.equal(diagnostics.unionSymbolCount, 2_001);
    assert.equal(diagnostics.rawQuoteSymbolCount, 1);
  } finally {
    bulk.unsubscribe();
    foreground.unsubscribe();
    __stockAggregateStreamTestInternals.reset();
  }
});
