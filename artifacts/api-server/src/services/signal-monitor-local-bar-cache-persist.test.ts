import assert from "node:assert/strict";
import test from "node:test";

import { __signalMonitorLocalBarCacheInternalsForTests } from "./signal-monitor-local-bar-cache";
import { getSignalMonitorLocalBarCacheDiagnostics } from "./signal-monitor-local-bar-cache";
import type { MassiveDelayedStockAggregate } from "./massive-stock-aggregate-stream";

const internals = __signalMonitorLocalBarCacheInternalsForTests;

// Anchor the minute bars to an hour boundary ~2h before now. That keeps them
// well inside the 72h memory-retention window (so storeMinuteBar does not prune
// them on ingest) while guaranteeing every enclosing intraday bucket — up to
// the largest 1h timeframe — is already "completed" relative to the wall-clock
// evaluatedAt that ingest() uses. Completed buckets roll up non-provisionally
// and so get queued for persistence.
const HOUR_MS = 60 * 60_000;
const BASE_MS = Math.floor((Date.now() - 2 * HOUR_MS) / HOUR_MS) * HOUR_MS;

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

test("flush drains the full pending backlog and counts every unique bar", async () => {
  internals.reset();
  try {
    internals.__setPersistMarketDataBarsForSymbolsForTests(async () => true);

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
    internals.__setPersistMarketDataBarsForSymbolsForTests(null);
    internals.reset();
  }
});

test("flush persists groups with bounded concurrency above one", async () => {
  internals.reset();
  try {
    const cap = 5; // matches DEFAULT_PERSIST_FLUSH_CONCURRENCY
    let inFlight = 0;
    let maxInFlight = 0;
    internals.__setPersistMarketDataBarsForSymbolsForTests(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield so multiple group writes overlap before any resolves.
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return true;
    });

    const symbols = Array.from({ length: 40 }, (_, i) => `CON${i}`);
    ingestSymbols(symbols, 6);

    await internals.flushNow();

    assert(
      maxInFlight > 1,
      `expected parallel persists, got maxInFlight=${maxInFlight}`,
    );
    assert(
      maxInFlight <= cap,
      `expected at most ${cap} in flight, got maxInFlight=${maxInFlight}`,
    );
    assert.equal(
      getSignalMonitorLocalBarCacheDiagnostics().pendingPersistBarCount,
      0,
    );
  } finally {
    internals.__setPersistMarketDataBarsForSymbolsForTests(null);
    internals.reset();
  }
});

test("flush requeues the whole failed (timeframe,source) group, no double-count on retry", async () => {
  internals.reset();
  try {
    const failTimeframe = "5m";

    // The flush now batches all symbols of a (timeframe, source) into one upsert,
    // so a failure requeues that whole group (every symbol's 5m bars), not just one
    // symbol. Invariant under test: every bar is persisted OR requeued exactly once
    // — no loss, no double-count.
    internals.__setPersistMarketDataBarsForSymbolsForTests(async (input) => {
      if (input.timeframe === failTimeframe) {
        throw new Error("simulated persist failure");
      }
      return true;
    });

    ingestSymbols(["FAILSYM", "OKSYM1", "OKSYM2"], 6);

    const queued = getSignalMonitorLocalBarCacheDiagnostics().pendingPersistBarCount;
    assert(queued > 0, "expected pending bars");

    await internals.flushNow();

    const after = getSignalMonitorLocalBarCacheDiagnostics();
    // Only the failed (5m,*) group should be back in the queue.
    assert(after.pendingPersistBarCount > 0, "failed group must be requeued");
    assert(
      after.pendingPersistBarCount < queued,
      "other-timeframe groups must NOT be requeued",
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

    // Retry with the failing group now succeeding: the previously-successful
    // groups are gone from pending, so they must NOT be re-counted. Only the
    // requeued failed-group bars get persisted on this pass.
    internals.__setPersistMarketDataBarsForSymbolsForTests(async () => true);
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
    internals.__setPersistMarketDataBarsForSymbolsForTests(null);
    internals.reset();
  }
});
