import assert from "node:assert/strict";
import test from "node:test";

import { __signalMonitorLocalBarCacheInternalsForTests } from "./signal-monitor-local-bar-cache";
import type { MassiveDelayedStockAggregate } from "./massive-stock-aggregate-stream";

test("signal monitor local bar cache warms from durable massive history", () => {
  const sources =
    __signalMonitorLocalBarCacheInternalsForTests.storeSourceNames();

  assert.equal(sources.at(-1), "massive-history");
  assert(
    sources[0] === "massive-websocket" ||
      sources[0] === "massive-delayed-websocket",
  );
});

test("signal monitor local bar cache rolls up sparse completed hourly buckets", () => {
  const internals = __signalMonitorLocalBarCacheInternalsForTests;
  internals.reset();
  try {
    // Anchor to a recent completed hour so the ingested bars stay inside the
    // 72h memory-retention window (storeMinuteBar prunes older-than-now-72h);
    // a fixed past date rots into a false failure once it ages out.
    const bucketStartMs =
      Math.floor((Date.now() - 2 * 60 * 60_000) / (60 * 60_000)) * (60 * 60_000);
    const aggregate = (
      minute: number,
      values: Pick<
        MassiveDelayedStockAggregate,
        "open" | "high" | "low" | "close" | "volume"
      >,
    ): MassiveDelayedStockAggregate => ({
      eventType: "AM",
      symbol: "AGZ",
      ...values,
      accumulatedVolume: null,
      vwap: null,
      sessionVwap: null,
      officialOpen: null,
      averageTradeSize: null,
      startMs: bucketStartMs + minute * 60_000,
      endMs: bucketStartMs + (minute + 1) * 60_000,
      delayed: false,
      source: "massive-websocket",
    });

    internals.ingest(
      aggregate(5, { open: 100, high: 101, low: 99, close: 100.5, volume: 10 }),
    );
    internals.ingest(
      aggregate(17, { open: 100.5, high: 102, low: 100, close: 101.5, volume: 8 }),
    );
    internals.ingest(
      aggregate(52, { open: 101.5, high: 103, low: 98, close: 102.5, volume: 12 }),
    );

    const bars = internals.readMemoryBars({
      symbol: "AGZ",
      timeframe: "1h",
      evaluatedAt: new Date(bucketStartMs + 65 * 60_000),
      limit: 5,
    });

    assert.equal(bars.length, 1);
    assert.equal(
      bars[0]?.timestamp.toISOString(),
      new Date(bucketStartMs).toISOString(),
    );
    assert.equal(bars[0]?.open, 100);
    assert.equal(bars[0]?.high, 103);
    assert.equal(bars[0]?.low, 98);
    assert.equal(bars[0]?.close, 102.5);
    assert.equal(bars[0]?.volume, 30);
    assert.equal(bars[0]?.partial, false);
  } finally {
    internals.reset();
  }
});
