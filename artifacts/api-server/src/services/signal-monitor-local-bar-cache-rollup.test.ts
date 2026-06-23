import assert from "node:assert/strict";
import test from "node:test";

import { __signalMonitorLocalBarCacheInternalsForTests } from "./signal-monitor-local-bar-cache";
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

test("bound: per-aggregate scan stays within the recent window regardless of history depth", () => {
  // Retain far more than the deep history so nothing is pruned and we can prove
  // the scan does NOT grow with the retained depth.
  const previousRetention =
    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS;
  process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_RETENTION_MS = String(
    100 * 60 * 60_000,
  );
  internals.reset();
  try {
    const symbol = "DEEP";
    // Anchor "now" to a fixed instant so window math is deterministic relative
    // to the synthetic bar timestamps. Bars are ingested with real Date() as
    // observedAt internally, but the scan window is computed from observedAt
    // (now) minus 4h, and we ingest the freshest bar at ~now.
    const now = Date.now();

    // 80h of minute history = 4800 minutes, ending shortly before "now".
    const historyMinutes = 80 * 60;
    const baseMs = now - historyMinutes * MINUTE_MS;
    for (let minute = 0; minute < historyMinutes; minute += 1) {
      const open = 50 + (minute % 50) * 0.01;
      internals.ingest(
        aggregateAtMinute(symbol, baseMs, minute, {
          open,
          high: open + 0.1,
          low: open - 0.1,
          close: open + 0.02,
          volume: 5,
        }),
      );
    }

    // After ingesting the entire 80h history, the most recent enqueue (the
    // freshest bar, near "now") must have scanned only the recent window.
    const diagnosticsDeep = internals.lastEnqueueScannedBarCount;
    // 4h window => at most ~241 minute bars (240 + boundary inclusivity).
    const windowMinutesCap = 4 * 60 + 1;
    assert.ok(
      diagnosticsDeep > 0,
      "expected the deep-history enqueue to have scanned at least one bar",
    );
    assert.ok(
      diagnosticsDeep <= windowMinutesCap,
      `deep-history scan ${diagnosticsDeep} exceeded recent-window cap ${windowMinutesCap}`,
    );

    // Now ingest one more fresh aggregate and re-check the scan count: it must
    // remain bounded and must NOT have grown with the (now deeper) history.
    const extraStartMs = baseMs + historyMinutes * MINUTE_MS;
    internals.ingest(
      aggregateAtMinute(symbol, extraStartMs, 0, {
        open: 60,
        high: 60.1,
        low: 59.9,
        close: 60.05,
        volume: 5,
      }),
    );
    const scanAfterExtra = internals.lastEnqueueScannedBarCount;
    assert.ok(
      scanAfterExtra <= windowMinutesCap,
      `post-extra scan ${scanAfterExtra} exceeded recent-window cap ${windowMinutesCap}`,
    );
    // The scan is bounded by the window, not the ~4800-bar retained history.
    assert.ok(
      scanAfterExtra < historyMinutes / 10,
      `scan ${scanAfterExtra} should be far below history depth ${historyMinutes}`,
    );
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
