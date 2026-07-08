import assert from "node:assert/strict";
import test from "node:test";

import {
  __signalMonitorLocalBarCacheInternalsForTests,
  getSignalMonitorLocalBarCacheDiagnostics,
} from "./signal-monitor-local-bar-cache";
import type { MassiveDelayedStockAggregate } from "./massive-stock-aggregate-stream";

const MINUTE_MS = 60_000;

function aggregateAtMs(
  symbol: string,
  startMs: number,
): MassiveDelayedStockAggregate {
  return {
    eventType: "AM",
    symbol,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10,
    accumulatedVolume: null,
    vwap: null,
    sessionVwap: null,
    officialOpen: null,
    averageTradeSize: null,
    startMs,
    endMs: startMs + MINUTE_MS,
    delayed: false,
    source: "massive-websocket",
  };
}

test("default memory retention spans a holiday weekend (>= 89.5h)", () => {
  // Fri 16:00 close -> Tue 09:30 open across a Monday holiday = 89.5h; the old 72h
  // default did not span it. The default applies only with the env override unset.
  const previous =
    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
  delete process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
  try {
    const { memoryRetentionMs } = getSignalMonitorLocalBarCacheDiagnostics();
    assert.ok(
      memoryRetentionMs >= 89.5 * 60 * 60_000,
      `retention ${memoryRetentionMs} must span the 89.5h holiday weekend`,
    );
    assert.equal(memoryRetentionMs, 120 * 60 * 60_000);
  } finally {
    if (previous === undefined) {
      delete process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
    } else {
      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS = previous;
    }
  }
});

test("minute retention pruning is cadence-bound without serving stale memory bars", () => {
  const internals = __signalMonitorLocalBarCacheInternalsForTests;
  const previousRetention =
    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
  const previousPersist =
    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
  const realDateNow = Date.now;
  const baseNowMs = Math.floor(realDateNow() / MINUTE_MS) * MINUTE_MS;

  process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS = String(
    2 * MINUTE_MS,
  );
  delete process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
  internals.reset();
  try {
    const symbol = "PRUNECAD";

    Date.now = () => baseNowMs;
    internals.ingest(aggregateAtMs(symbol, baseNowMs - MINUTE_MS));
    assert.equal(internals.minuteBarRetentionPruneRunCount, 1);
    assert.equal(internals.lastMinuteBarRetentionPruneScannedBarCount, 1);

    internals.ingest(aggregateAtMs(symbol, baseNowMs));
    assert.equal(
      internals.minuteBarRetentionPruneRunCount,
      1,
      "second insert inside the cadence window must not full-scan retained bars",
    );
    assert.equal(internals.lastMinuteBarRetentionPruneScannedBarCount, 1);

    Date.now = () => baseNowMs + 3 * MINUTE_MS;
    internals.ingest(aggregateAtMs(symbol, baseNowMs + 3 * MINUTE_MS));
    assert.equal(
      internals.minuteBarRetentionPruneRunCount,
      1,
      "expired bars may remain physically cached until the prune cadence fires",
    );
    assert.equal(getSignalMonitorLocalBarCacheDiagnostics().minuteBarCount, 3);

    const visibleBeforeCadence = internals.readMemoryBars({
      symbol,
      timeframe: "1m",
      evaluatedAt: new Date(baseNowMs + 4 * MINUTE_MS),
      limit: 10,
    });
    assert.deepEqual(
      visibleBeforeCadence.map((bar) => bar.timestamp.getTime()),
      [baseNowMs + 3 * MINUTE_MS],
    );

    Date.now = () => baseNowMs + 5 * MINUTE_MS;
    internals.ingest(aggregateAtMs(symbol, baseNowMs + 5 * MINUTE_MS));
    assert.equal(internals.minuteBarRetentionPruneRunCount, 2);
    assert.equal(internals.lastMinuteBarRetentionPruneScannedBarCount, 4);
    assert.equal(getSignalMonitorLocalBarCacheDiagnostics().minuteBarCount, 2);

    const visibleAfterCadence = internals.readMemoryBars({
      symbol,
      timeframe: "1m",
      evaluatedAt: new Date(baseNowMs + 6 * MINUTE_MS),
      limit: 10,
    });
    assert.deepEqual(
      visibleAfterCadence.map((bar) => bar.timestamp.getTime()),
      [baseNowMs + 3 * MINUTE_MS, baseNowMs + 5 * MINUTE_MS],
    );
  } finally {
    Date.now = realDateNow;
    internals.reset();
    if (previousRetention === undefined) {
      delete process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
    } else {
      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS =
        previousRetention;
    }
    if (previousPersist === undefined) {
      delete process.env
        .PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
    } else {
      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES =
        previousPersist;
    }
  }
});

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
    // memory-retention window (storeMinuteBar prunes older-than-now-retention);
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
