import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { pool } from "@workspace/db";

import { __signalMonitorInternalsForTests } from "./signal-monitor";
import {
  __signalMonitorLocalBarCacheInternalsForTests,
  readSignalMonitorLocalMemoryBars,
} from "./signal-monitor-local-bar-cache";
import {
  __stockAggregateStreamTestInternals,
  type StockMinuteAggregateMessage,
} from "./stock-aggregate-stream";

const {
  evaluateSignalMonitorMatrixStateFromStreamBars: evalStreamBars,
  evaluateSignalMonitorMatrixStateFromCompletedBars: evalCompletedBars,
  loadSignalMonitorStreamCompletedBars,
  mergeCompletedBars,
  getSignalMonitorStreamCompletedBarsCacheStats: barsCacheStats,
  getSignalMonitorStreamSourceMinuteBarsMemoStats: sourceBarsMemoStats,
  withSignalMonitorStreamSourceMinuteBarsMemo: withSourceBarsMemo,
  recordSignalMonitorAggregateRevision: recordRevision,
  getSignalMonitorAggregateRevision: getRevision,
  resetSignalMonitorMatrixHeavyEvaluationCache: resetCaches,
  resetSignalMonitorMatrixStreamForTests: resetStream,
  seedSignalMonitorBackfilledBaseForTests: seedBackfilledBase,
} = __signalMonitorInternalsForTests;

after(async () => {
  await pool.end();
});

beforeEach(() => {
  resetStream();
  resetCaches();
  __stockAggregateStreamTestInternals.reset();
  __signalMonitorLocalBarCacheInternalsForTests.reset();
});

const SYMBOL = "SPY";

const makeProfile = (settings: Record<string, unknown> = {}) =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    pyrusSignalsSettings: settings,
    freshWindowBars: 5,
  }) as never;

const aggregate = (startMs: number, close: number): StockMinuteAggregateMessage => ({
  eventType: "AM",
  symbol: SYMBOL,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1_000 + Math.round(close),
  accumulatedVolume: null,
  vwap: null,
  sessionVwap: null,
  officialOpen: null,
  averageTradeSize: null,
  startMs,
  endMs: startMs + 59_999,
  delayed: false,
  source: "massive-websocket",
});

function recentEvaluatedAt(): Date {
  return new Date(Math.floor(Date.now() / 60_000) * 60_000);
}

function buildMinuteAggregates(input: {
  evaluatedAt: Date;
  count: number;
}): StockMinuteAggregateMessage[] {
  const latestCompletedStartMs = input.evaluatedAt.getTime() - 60_000;
  return Array.from({ length: input.count }, (_, index) => {
    const startMs = latestCompletedStartMs - (input.count - 1 - index) * 60_000;
    const close = Number(
      (100 + index * 0.025 + Math.sin(index / 9) * 0.75).toFixed(4),
    );
    return aggregate(startMs, close);
  });
}

function seedLocalMemoryBars(aggregates: StockMinuteAggregateMessage[]): void {
  for (const entry of aggregates) {
    __signalMonitorLocalBarCacheInternalsForTests.ingest(entry as never);
  }
}

function seedStreamBars(aggregates: StockMinuteAggregateMessage[]): void {
  for (const entry of aggregates) {
    __stockAggregateStreamTestInternals.ingestAggregateForTests(entry);
  }
}

function toBackfilledBaseBars(
  bars: ReturnType<typeof readSignalMonitorLocalMemoryBars>,
) {
  return bars.map((bar) => ({
    ...bar,
    source: "massive-history",
    freshness: "live",
    marketDataMode: "live",
  })) as never[];
}

function readFullLocalMemorySeries(evaluatedAt: Date) {
  const bars = readSignalMonitorLocalMemoryBars({
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    limit: 240,
  }) as never[];
  assert.equal(bars.length, 240, "test setup must have a full 240-bar series");
  return bars;
}

// Push `count` one-minute aggregates into the in-memory ring, the freshest closing
// at `endIso`. Price waves so the pyrus indicator has real variation.
function primeRing(endIso: string, count = 150) {
  const endStartMs = new Date(endIso).getTime() - 60_000; // last COMPLETED minute
  for (let i = count - 1; i >= 0; i -= 1) {
    const startMs = endStartMs - i * 60_000;
    const close = 100 + Math.sin((count - i) / 4) * 3;
    __stockAggregateStreamTestInternals.ingestAggregateForTests(
      aggregate(startMs, Number(close.toFixed(2))),
    );
  }
}

const evalAt = (iso: string, timeframe = "1m") =>
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: timeframe as never,
    evaluatedAt: new Date(iso),
  });

// --- Out-of-order revision logic (the dirty-track's correctness backbone) ---

test("revision bumps ONLY on out-of-order minutes, not forward/forming updates", () => {
  const sym = "REVTEST";
  assert.equal(getRevision(sym), 0, "unseen symbol starts at 0");

  recordRevision(sym, 60_000); // first minute seen
  assert.equal(getRevision(sym), 0, "first message does not bump");

  recordRevision(sym, 60_000); // forming-minute update (same startMs)
  assert.equal(getRevision(sym), 0, "forming-minute update does not bump");

  recordRevision(sym, 120_000); // forward minute advance
  assert.equal(getRevision(sym), 0, "forward minute advance does not bump");

  recordRevision(sym, 60_000); // out-of-order correction to an older minute
  assert.equal(getRevision(sym), 1, "out-of-order correction bumps");

  recordRevision(sym, 180_000); // forward again
  assert.equal(getRevision(sym), 1, "forward after a correction does not bump again");

  recordRevision(sym, Number.NaN); // malformed startMs is ignored
  assert.equal(getRevision(sym), 1, "non-finite startMs is a no-op");
});

// --- completedBars cache hit/miss/skip semantics ---

test("identical (boundary, base, revision) reuses cached bars and is value-identical", () => {
  primeRing("2026-06-09T15:00:00.000Z");

  const r1 = evalAt("2026-06-09T15:00:00.000Z");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 0, misses: 1 });
  assert.ok(r1 && r1.status, "first eval produced a state");

  const r2 = evalAt("2026-06-09T15:00:00.000Z");
  // Second call within the same minute boundary skips load/merge: a cache hit.
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });
  // Reused bars must yield byte-identical output to the fresh compute.
  assert.deepEqual(r2, r1);
});

test("a hit holds across sub-minute evaluatedAt drift (same completed boundary)", () => {
  primeRing("2026-06-09T15:00:00.000Z");

  evalAt("2026-06-09T15:00:00.000Z");
  evalAt("2026-06-09T15:00:30.000Z"); // same 1m boundary 15:00:00
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });
});

test("crossing the completed-bar boundary busts the cell (re-aggregates)", () => {
  primeRing("2026-06-09T15:00:00.000Z");

  evalAt("2026-06-09T15:00:00.000Z");
  assert.equal(barsCacheStats().misses, 1);

  // One minute later: boundary advances 15:00:00 -> 15:01:00, so a forming minute
  // may have been promoted to completed -> must recompute, not skip.
  evalAt("2026-06-09T15:01:00.000Z");
  assert.equal(barsCacheStats().misses, 2);
  assert.equal(barsCacheStats().hits, 0);
});

test("source minute bars memo reuses same-depth loads across stream timeframes", () => {
  primeRing("2026-06-09T15:00:00.000Z", 300);

  withSourceBarsMemo(() => {
    const first = loadSignalMonitorStreamCompletedBars({
      symbol: SYMBOL,
      timeframe: "5m",
      evaluatedAt: new Date("2026-06-09T15:00:00.000Z"),
      limit: 240,
    });
    const second = loadSignalMonitorStreamCompletedBars({
      symbol: SYMBOL,
      timeframe: "15m",
      evaluatedAt: new Date("2026-06-09T15:00:00.000Z"),
      limit: 240,
    });

    assert.ok(first.length > 0, "first timeframe should produce bars");
    assert.ok(second.length > 0, "second timeframe should produce bars");
    assert.deepEqual(sourceBarsMemoStats(), {
      active: true,
      size: 1,
      hits: 1,
      misses: 1,
    });
  });
});

test("an out-of-order correction busts the cell even within the same boundary", () => {
  primeRing("2026-06-09T15:00:00.000Z");

  // Seed the revision tracker's high-water mark (forward minute -> no bump), since
  // priming the ring does not run the enqueue path that maintains it.
  recordRevision(SYMBOL, new Date("2026-06-09T14:59:00.000Z").getTime());
  assert.equal(getRevision(SYMBOL), 0);

  evalAt("2026-06-09T15:00:00.000Z");
  evalAt("2026-06-09T15:00:00.000Z");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });

  // A late aggregate for an already-completed minute bumps the symbol revision,
  // which is part of the dirty key -> the next eval (same boundary) must recompute.
  recordRevision(SYMBOL, new Date("2026-06-09T14:50:00.000Z").getTime());
  assert.equal(getRevision(SYMBOL), 1, "out-of-order minute bumped the revision");
  evalAt("2026-06-09T15:00:00.000Z");
  assert.equal(barsCacheStats().misses, 2, "revision bump must bust the cell");
});

test("stale backfilled base gap is filled from local 1m memory without changing signal output", () => {
  const evaluatedAt = recentEvaluatedAt();
  const aggregates = buildMinuteAggregates({ evaluatedAt, count: 260 });
  seedLocalMemoryBars(aggregates);
  seedStreamBars(aggregates.slice(-5));

  const fullSeries = readFullLocalMemorySeries(evaluatedAt);
  const staleBase = toBackfilledBaseBars(fullSeries.slice(0, 210));
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: staleBase,
    refreshedAtMs: evaluatedAt.getTime() - 60 * 60_000,
  });

  const gapFilled = evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  const contiguous = evalCompletedBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    completedBars: fullSeries,
  });

  assert.ok(gapFilled, "stream eval should produce a state");
  assert.deepEqual(gapFilled, contiguous);
});

test("contiguous base plus live edge is unchanged when local memory is available", () => {
  const evaluatedAt = recentEvaluatedAt();
  const aggregates = buildMinuteAggregates({ evaluatedAt, count: 245 });
  seedLocalMemoryBars(aggregates);
  seedStreamBars(aggregates.slice(-5));

  const fullSeries = readFullLocalMemorySeries(evaluatedAt);
  const baseBars = toBackfilledBaseBars(fullSeries.slice(0, 235));
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: baseBars,
    refreshedAtMs: evaluatedAt.getTime() - 60_000,
  });

  const streamBars = loadSignalMonitorStreamCompletedBars({
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    limit: 240,
  });
  assert.equal(streamBars.length, 5, "test setup should have a shallow live edge");
  const oldMergeSeries = mergeCompletedBars(baseBars, streamBars, 240);

  const streamState = evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  const oldMergeState = evalCompletedBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    completedBars: oldMergeSeries,
  });

  assert.ok(streamState, "stream eval should produce a state");
  assert.deepEqual(streamState, oldMergeState);
});
