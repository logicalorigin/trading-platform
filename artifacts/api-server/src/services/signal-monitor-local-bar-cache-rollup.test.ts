import assert from "node:assert/strict";
import test from "node:test";

import {
  __signalMonitorLocalBarCacheInternalsForTests,
  getSignalMonitorLocalBarCacheDiagnostics,
} from "./signal-monitor-local-bar-cache";
import type { MassiveDelayedStockAggregate } from "./massive-stock-aggregate-stream";

const internals = __signalMonitorLocalBarCacheInternalsForTests;

const MINUTE_MS = 60_000;

function aggregateAtMinute(
  symbol: string,
  baseMs: number,
  minute: number,
  values: Pick<
    MassiveDelayedStockAggregate,
    "open" | "high" | "low" | "close" | "volume"
  >,
): MassiveDelayedStockAggregate {
  const startMs = baseMs + minute * MINUTE_MS;
  return {
    eventType: "AM",
    symbol,
    ...values,
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

test("behavior preserved: deterministic multi-hour ingest rolls up exactly across timeframes", () => {
  // storeMinuteBar prunes against real wall-clock now; widen retention so the
  // synthetic 3h history (anchored near now) is fully retained.
  const previousRetention =
    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
  process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS = String(
    100 * 60 * 60_000,
  );
  internals.reset();
  try {
    const symbol = "BEHAV";
    // Anchor to a clean hour boundary a few hours back from real "now" so the
    // bars sit inside the retention window and floored buckets are predictable.
    const HOUR_MS = 60 * MINUTE_MS;
    const baseMs = Math.floor((Date.now() - 5 * HOUR_MS) / HOUR_MS) * HOUR_MS;

    // Ingest a deterministic minute sequence spanning 3 hours (180 minutes).
    // Each minute's OHLCV is a pure function of its index so expected buckets
    // can be computed independently of the rollup code.
    const totalMinutes = 180;
    for (let minute = 0; minute < totalMinutes; minute += 1) {
      const open = 100 + minute * 0.1;
      const close = open + 0.05;
      const high = open + 0.2;
      const low = open - 0.2;
      const volume = 10 + (minute % 7);
      internals.ingest(
        aggregateAtMinute(symbol, baseMs, minute, {
          open,
          high,
          low,
          close,
          volume,
        }),
      );
    }

    // Evaluate well after the final bucket closes so every bucket is complete.
    const evaluatedAt = new Date(baseMs + (totalMinutes + 120) * MINUTE_MS);

    // Independent reference rollup: group the same deterministic minutes into
    // fixed-size buckets and compute OHLCV the same way the production code
    // documents (open=first, high=max, low=min, close=last, volume=sum).
    type Bucket = {
      timestampMs: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    };

    const expectedBuckets = (bucketMinutes: number): Bucket[] => {
      const byBucket = new Map<number, Bucket>();
      for (let minute = 0; minute < totalMinutes; minute += 1) {
        const tsMs = baseMs + minute * MINUTE_MS;
        const bucketMs = bucketMinutes * MINUTE_MS;
        const bucketStartMs = Math.floor(tsMs / bucketMs) * bucketMs;
        const open = 100 + minute * 0.1;
        const close = open + 0.05;
        const high = open + 0.2;
        const low = open - 0.2;
        const volume = 10 + (minute % 7);
        const existing = byBucket.get(bucketStartMs);
        if (!existing) {
          byBucket.set(bucketStartMs, {
            timestampMs: bucketStartMs,
            open,
            high,
            low,
            close,
            volume,
          });
        } else {
          existing.high = Math.max(existing.high, high);
          existing.low = Math.min(existing.low, low);
          existing.close = close;
          existing.volume += volume;
        }
      }
      return Array.from(byBucket.values()).sort(
        (a, b) => a.timestampMs - b.timestampMs,
      );
    };

    const cases: Array<{
      timeframe: "1m" | "5m" | "15m" | "1h";
      bucketMinutes: number;
    }> = [
      { timeframe: "1m", bucketMinutes: 1 },
      { timeframe: "5m", bucketMinutes: 5 },
      { timeframe: "15m", bucketMinutes: 15 },
      { timeframe: "1h", bucketMinutes: 60 },
    ];

    for (const { timeframe, bucketMinutes } of cases) {
      const limit = 1000;
      const actual = internals.readMemoryBars({
        symbol,
        timeframe,
        evaluatedAt,
        limit,
      });
      const expected = expectedBuckets(bucketMinutes);

      assert.equal(
        actual.length,
        expected.length,
        `bucket count mismatch for ${timeframe}`,
      );
      for (let i = 0; i < expected.length; i += 1) {
        const a = actual[i];
        const e = expected[i];
        assert.ok(a, `missing actual bar ${i} for ${timeframe}`);
        assert.equal(
          a.timestamp.getTime(),
          e.timestampMs,
          `timestamp mismatch ${timeframe} bucket ${i}`,
        );
        // Use approximate compare for floats accumulated by the rollup.
        assert.ok(
          Math.abs(a.open - e.open) < 1e-9,
          `open mismatch ${timeframe} bucket ${i}: ${a.open} vs ${e.open}`,
        );
        assert.ok(
          Math.abs(a.high - e.high) < 1e-9,
          `high mismatch ${timeframe} bucket ${i}: ${a.high} vs ${e.high}`,
        );
        assert.ok(
          Math.abs(a.low - e.low) < 1e-9,
          `low mismatch ${timeframe} bucket ${i}: ${a.low} vs ${e.low}`,
        );
        assert.ok(
          Math.abs(a.close - e.close) < 1e-9,
          `close mismatch ${timeframe} bucket ${i}: ${a.close} vs ${e.close}`,
        );
        assert.equal(
          a.volume,
          e.volume,
          `volume mismatch ${timeframe} bucket ${i}`,
        );
      }
    }
  } finally {
    internals.reset();
    if (previousRetention === undefined) {
      delete process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
    } else {
      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS =
        previousRetention;
    }
  }
});

test("disabled live aggregate persistence skips per-aggregate rollup scan work", () => {
  const previousPersist =
    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
  delete process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
  internals.reset();
  try {
    internals.ingest(
      aggregateAtMinute("SKIPSCAN", Date.now() - MINUTE_MS, 0, {
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 10,
      }),
    );

    const diagnostics = getSignalMonitorLocalBarCacheDiagnostics();
    assert.equal(diagnostics.liveAggregatePersistEnabled, false);
    assert.equal(internals.lastEnqueueScannedBarCount, 0);
    assert.equal(diagnostics.pendingPersistBarCount, 0);
    assert.equal(diagnostics.liveAggregatePersistSkipCount, 1);
    assert.notEqual(diagnostics.lastLiveAggregatePersistSkippedAt, null);
  } finally {
    internals.reset();
    if (previousPersist === undefined) {
      delete process.env
        .PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
    } else {
      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES =
        previousPersist;
    }
  }
});

test("bound: per-aggregate scan is bounded by the recent session window, not deep history", () => {
  // The rollup scan window is session-aware: intra-session it is the 4h recent
  // window, but right after a weekend/holiday reopen it reaches back across the
  // closed gap to the prior session's close (≤ ~93.5h across a holiday weekend).
  // So we cannot assert a fixed wall-clock 4h cap (that would flake whenever CI
  // runs just after a reopen). Instead prove the real invariant: the scan is
  // bounded by the recent SESSION window and does NOT grow with deep retained
  // history. Retain far more than the deep block so nothing is pruned.
  const previousRetention =
    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
  const previousPersist =
    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
  process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS = String(
    400 * 60 * 60_000,
  );
  process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES = "1";
  internals.reset();
  try {
    const symbol = "DEEP";
    const now = Date.now();

    // Deep history 200h back — beyond the ~93.5h max session-aware reach, so it
    // can NEVER enter the scan window — but retained (< 400h). 600 minutes.
    const ancientCount = 600;
    const ancientBaseMs = now - 200 * 60 * MINUTE_MS;
    for (let minute = 0; minute < ancientCount; minute += 1) {
      internals.ingest(
        aggregateAtMinute(symbol, ancientBaseMs, minute, {
          open: 50,
          high: 50.1,
          low: 49.9,
          close: 50.02,
          volume: 5,
        }),
      );
    }

    // Recent history: 3h of continuous minutes ending at ~now. 3h < the 4h
    // MINIMUM window, so every recent bar is inside the scan in EVERY session
    // state (deep-RTH, extended-hours, or just after a gap reopen). This makes
    // the scanned count deterministic regardless of the wall-clock time CI runs.
    const recentCount = 180;
    const recentBaseMs = now - recentCount * MINUTE_MS;
    for (let minute = 0; minute < recentCount; minute += 1) {
      internals.ingest(
        aggregateAtMinute(symbol, recentBaseMs, minute, {
          open: 60 + minute * 0.001,
          high: 60.1,
          low: 59.9,
          close: 60.05,
          volume: 5,
        }),
      );
    }

    // The freshest enqueue scanned the recent window: it saw the ~180 recent bars
    // but NONE of the 600 ancient bars.
    const scanned = internals.lastEnqueueScannedBarCount;
    assert.ok(scanned > 0, "expected the recent enqueue to scan at least one bar");
    assert.ok(
      scanned <= recentCount + 1,
      `scan ${scanned} exceeded the recent window (${recentCount}); deep history leaked in`,
    );
    assert.ok(
      scanned < ancientCount,
      `scan ${scanned} should be far below deep history depth ${ancientCount}`,
    );

    // One more fresh aggregate: the scan grows by ~1, still bounded by the recent
    // window and NOT by the (deeper) retained history.
    const extraStartMs = recentBaseMs + recentCount * MINUTE_MS;
    internals.ingest(
      aggregateAtMinute(symbol, extraStartMs, 0, {
        open: 61,
        high: 61.1,
        low: 60.9,
        close: 61.05,
        volume: 5,
      }),
    );
    const scanAfterExtra = internals.lastEnqueueScannedBarCount;
    assert.ok(
      scanAfterExtra <= recentCount + 2,
      `post-extra scan ${scanAfterExtra} exceeded the recent window`,
    );
    assert.ok(
      scanAfterExtra < ancientCount,
      `scan ${scanAfterExtra} should stay far below history depth ${ancientCount}`,
    );
  } finally {
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
