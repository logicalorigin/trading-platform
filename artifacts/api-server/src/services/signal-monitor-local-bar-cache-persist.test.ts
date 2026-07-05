import assert from "node:assert/strict";
import test from "node:test";

import { __signalMonitorLocalBarCacheInternalsForTests } from "./signal-monitor-local-bar-cache";
import { getSignalMonitorLocalBarCacheDiagnostics } from "./signal-monitor-local-bar-cache";
import type { MassiveDelayedStockAggregate } from "./massive-stock-aggregate-stream";
import type { PersistMarketDataBarsMixedEntry } from "./market-data-store";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";

const internals = __signalMonitorLocalBarCacheInternalsForTests;

// Anchor the minute bars to an hour boundary ~2h before now. That keeps them
// well inside the 72h memory-retention window (so storeMinuteBar does not prune
// them on ingest) while guaranteeing every enclosing intraday bucket — up to
// the largest 1h timeframe — is already "completed" relative to the wall-clock
// evaluatedAt that ingest() uses. Completed buckets roll up non-provisionally
// and so get queued for persistence.
const HOUR_MS = 60 * 60_000;
const BASE_MS = Math.floor((Date.now() - 2 * HOUR_MS) / HOUR_MS) * HOUR_MS;

function enableLiveAggregatePersistForTest(): () => void {
  const previous =
    process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
  process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES = "1";
  return () => {
    if (previous === undefined) {
      delete process.env
        .PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES;
    } else {
      process.env.PYRUS_SIGNAL_MONITOR_LOCAL_BAR_CACHE_PERSIST_LIVE_AGGREGATES =
        previous;
    }
  };
}

function minuteAggregate(
  symbol: string,
  minute: number,
  values: Pick<
    MassiveDelayedStockAggregate,
    "open" | "high" | "low" | "close" | "volume"
  >,
): MassiveDelayedStockAggregate {
  return {
    eventType: "AM",
    symbol,
    ...values,
    accumulatedVolume: null,
    vwap: null,
    sessionVwap: null,
    officialOpen: null,
    averageTradeSize: null,
    startMs: BASE_MS + minute * 60_000,
    endMs: BASE_MS + (minute + 1) * 60_000,
    delayed: false,
    source: "massive-websocket",
  };
}

function ingestSymbols(symbols: string[], minutesPerSymbol: number): void {
  for (const symbol of symbols) {
    for (let minute = 0; minute < minutesPerSymbol; minute += 1) {
      internals.ingest(
        minuteAggregate(symbol, minute, {
          open: 100,
          high: 101,
          low: 99,
          close: 100.5,
          volume: 10,
        }),
      );
    }
  }
}

test("live aggregate persistence is opt-in so realtime bars do not write-through to bar_cache by default", () => {
  internals.reset();
  try {
    ingestSymbols(["NOPERSIST"], 6);

    const diagnostics = getSignalMonitorLocalBarCacheDiagnostics();
    assert.equal(diagnostics.liveAggregatePersistEnabled, false);
    assert.equal(diagnostics.pendingPersistBarCount, 0);
    assert(diagnostics.liveAggregatePersistSkipCount > 0);
    assert.notEqual(diagnostics.lastLiveAggregatePersistSkippedAt, null);
  } finally {
    internals.reset();
  }
});

test("flush drains the full pending backlog and counts every unique bar", async () => {
  internals.reset();
  const restorePersist = enableLiveAggregatePersistForTest();
  try {
    internals.__setPersistMarketDataBarsMixedForTests(async (input) => ({
      okByIndex: input.entries.map(() => true),
      error: null,
    }));

    const symbols = Array.from({ length: 40 }, (_, i) => `SYM${i}`);
    ingestSymbols(symbols, 6);

    const queued = getSignalMonitorLocalBarCacheDiagnostics().pendingPersistBarCount;
    assert(queued > 0, "expected some pending bars to be queued");

    await internals.flushNow();

    const after = getSignalMonitorLocalBarCacheDiagnostics();
    assert.equal(after.pendingPersistBarCount, 0);
    assert.equal(after.persistedBarCount, queued);
    assert.equal(after.lastPersistError, null);
  } finally {
    restorePersist();
    internals.__setPersistMarketDataBarsMixedForTests(null);
    internals.reset();
  }
});

test("flush merges every queued (symbol,timeframe,source) into a single mixed write call", async () => {
  internals.reset();
  const restorePersist = enableLiveAggregatePersistForTest();
  try {
    let callCount = 0;
    let captured: PersistMarketDataBarsMixedEntry[] | null = null;
    internals.__setPersistMarketDataBarsMixedForTests(async (input) => {
      callCount += 1;
      captured = input.entries;
      return { okByIndex: input.entries.map(() => true), error: null };
    });

    // Two symbols on two distinct sources; each produces several intraday-timeframe
    // rollups → the drained backlog spans >=2 timeframes AND >=2 sources, which the
    // old per-(timeframe,source) path would have split across many write calls.
    const liveSymbol = "LIVEONE";
    const delayedSymbol = "DLYONE";
    const values = { open: 100, high: 101, low: 99, close: 100.5, volume: 10 };
    for (let minute = 0; minute < 6; minute += 1) {
      internals.ingest({
        ...minuteAggregate(liveSymbol, minute, values),
        source: "massive-websocket",
        delayed: false,
      });
      internals.ingest({
        ...minuteAggregate(delayedSymbol, minute, values),
        source: "massive-delayed-websocket",
        delayed: true,
      });
    }

    const queued =
      getSignalMonitorLocalBarCacheDiagnostics().pendingPersistBarCount;
    assert(queued > 0, "expected pending bars before flush");

    await internals.flushNow();

    assert.equal(callCount, 1, "the whole flush must be a single mixed write call");
    assert(captured, "writer input must be captured");
    const entries: PersistMarketDataBarsMixedEntry[] = captured;

    // Every queued bar landed in the one call — no loss, no split.
    const totalRows = entries.reduce((sum, entry) => sum + entry.bars.length, 0);
    assert.equal(totalRows, queued, "the single call must carry every queued bar");

    // >=2 timeframes and >=2 sources, tagged per entry (per-row timeframe/source).
    const timeframes = new Set(entries.map((entry) => entry.timeframe));
    const sources = new Set(entries.map((entry) => entry.sourceName));
    assert(
      timeframes.size >= 2,
      `expected >=2 timeframes, got ${[...timeframes].join(",")}`,
    );
    assert(
      sources.size >= 2,
      `expected >=2 sources, got ${[...sources].join(",")}`,
    );

    // Per-row source is correct row-for-row: live-symbol entries carry the live
    // source, delayed-symbol entries the delayed source — exactly what the former
    // per-(timeframe,source) group path would have written.
    for (const entry of entries) {
      const expectedSource =
        entry.symbol === delayedSymbol
          ? "massive-delayed-websocket"
          : "massive-websocket";
      assert.equal(
        entry.sourceName,
        expectedSource,
        `entry ${entry.symbol}/${entry.timeframe} carries the wrong source`,
      );
      assert(entry.bars.length > 0, "every entry must carry bars");
    }

    // Each (symbol,timeframe,source) tuple appears once — clean grouping, no collapse.
    const keys = entries.map(
      (entry) => `${entry.symbol}|${entry.timeframe}|${entry.sourceName}`,
    );
    assert.equal(
      new Set(keys).size,
      keys.length,
      "each (symbol,timeframe,source) tuple must appear exactly once",
    );

    const after = getSignalMonitorLocalBarCacheDiagnostics();
    assert.equal(after.pendingPersistBarCount, 0);
    assert.equal(after.persistedBarCount, queued);
    assert.equal(after.lastPersistError, null);
  } finally {
    restorePersist();
    internals.__setPersistMarketDataBarsMixedForTests(null);
    internals.reset();
  }
});

test("flush persists pending bar_cache writes while API pressure is high", async () => {
  internals.reset();
  __resetApiResourcePressureForTests();
  const restorePersist = enableLiveAggregatePersistForTest();
  try {
    let persistCalls = 0;
    internals.__setPersistMarketDataBarsMixedForTests(async (input) => {
      persistCalls += 1;
      return { okByIndex: input.entries.map(() => true), error: null };
    });
    ingestSymbols(["PRESSURE"], 6);
    const queued =
      getSignalMonitorLocalBarCacheDiagnostics().pendingPersistBarCount;
    assert(queued > 0, "expected pending bars before flush");

    updateApiResourcePressure({ eventLoopUtilization: 0.95 });
    await internals.flushNow();

    const after = getSignalMonitorLocalBarCacheDiagnostics();
    assert(persistCalls > 0);
    assert.equal(after.pendingPersistBarCount, 0);
    assert.equal(after.persistedBarCount, queued);
  } finally {
    restorePersist();
    internals.__setPersistMarketDataBarsMixedForTests(null);
    internals.reset();
    __resetApiResourcePressureForTests();
  }
});

test("flush requeues only the failed entries from the single mixed write, no double-count on retry", async () => {
  internals.reset();
  const restorePersist = enableLiveAggregatePersistForTest();
  try {
    const failTimeframe = "5m";

    // The flush now merges the whole backlog into ONE mixed write whose per-entry ok
    // flag drives requeue. Simulate a partial failure: the 5m entries come back
    // not-ok (their chunk was rejected) with an error; all other entries succeed.
    // Invariant under test: every bar is persisted OR requeued exactly once — no
    // loss, no double-count — and only the failed entries return to the queue.
    internals.__setPersistMarketDataBarsMixedForTests(async (input) => {
      const okByIndex = input.entries.map(
        (entry) => entry.timeframe !== failTimeframe,
      );
      return {
        okByIndex,
        error: okByIndex.some((ok) => !ok)
          ? new Error("simulated persist failure")
          : null,
      };
    });

    ingestSymbols(["FAILSYM", "OKSYM1", "OKSYM2"], 6);

    const queued = getSignalMonitorLocalBarCacheDiagnostics().pendingPersistBarCount;
    assert(queued > 0, "expected pending bars");

    await internals.flushNow();

    const after = getSignalMonitorLocalBarCacheDiagnostics();
    // Only the failed 5m entries should be back in the queue.
    assert(after.pendingPersistBarCount > 0, "failed entries must be requeued");
    assert(
      after.pendingPersistBarCount < queued,
      "successful entries must NOT be requeued",
    );
    assert(after.persistedBarCount > 0, "successes must be counted");
    assert.equal(
      after.persistedBarCount + after.pendingPersistBarCount,
      queued,
      "every bar is either persisted or requeued, with no loss or duplication",
    );
    assert.notEqual(after.lastPersistError, null);

    const persistedAfterFirst = after.persistedBarCount;
    const requeuedCount = after.pendingPersistBarCount;

    // Retry with the failing entries now succeeding: the previously-successful
    // entries are gone from pending, so they must NOT be re-counted. Only the
    // requeued failed-entry bars get persisted on this pass.
    internals.__setPersistMarketDataBarsMixedForTests(async (input) => ({
      okByIndex: input.entries.map(() => true),
      error: null,
    }));
    await internals.flushNow();

    const final = getSignalMonitorLocalBarCacheDiagnostics();
    assert.equal(final.pendingPersistBarCount, 0);
    assert.equal(
      final.persistedBarCount,
      persistedAfterFirst + requeuedCount,
      "retry must only add the requeued bars (no double-count)",
    );
    assert.equal(final.persistedBarCount, queued);
    assert.equal(final.lastPersistError, null);
  } finally {
    restorePersist();
    internals.__setPersistMarketDataBarsMixedForTests(null);
    internals.reset();
  }
});
