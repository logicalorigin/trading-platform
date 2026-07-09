import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  getSignalMonitorBackfilledBaseForTests: getBackfilledBase,
  flushSignalMonitorCompletedBarsGapFetchesForTests: flushGapFetches,
  getSignalMonitorCompletedBarsGapFetchStatsForTests: gapFetchStats,
  setSignalMonitorCompletedBarsGapFetchLoaderForTests: setGapFetchLoader,
  stateToResponseForSnapshot,
  signalMonitorStreamLaneLatestCompletedBarAt: laneLatestCompletedBarAt,
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

function toHistoryBars<T extends Array<Record<string, unknown>>>(bars: T) {
  return bars.map((bar) => ({
    ...bar,
    source: "massive-history",
    freshness: "live",
    marketDataMode: "live",
    delayed: false,
  })) as never[];
}

function aggregateToCompletedBar(entry: StockMinuteAggregateMessage) {
  return {
    timestamp: new Date(entry.startMs),
    open: entry.open,
    high: entry.high,
    low: entry.low,
    close: entry.close,
    volume: entry.volume,
    bid: null,
    ask: null,
    mid: null,
    quoteAsOf: null,
    source: "massive-history",
    providerContractId: null,
    outsideRth: true,
    partial: false,
    transport: "massive_rest",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: new Date(entry.startMs + 60_000),
    ageMs: null,
  };
}

function buildCompletedBars(input: {
  latestStartMs: number;
  count: number;
  stepMs: number;
}) {
  return Array.from({ length: input.count }, (_, index) => {
    const startMs =
      input.latestStartMs - (input.count - 1 - index) * input.stepMs;
    const close = Number(
      (100 + index * 0.08 + Math.sin(index / 7) * 1.2).toFixed(4),
    );
    return {
      timestamp: new Date(startMs),
      open: close,
      high: close + 0.6,
      low: close - 0.6,
      close,
      volume: 10_000 + index,
      bid: null,
      ask: null,
      mid: null,
      quoteAsOf: null,
      source: "massive-history",
      providerContractId: null,
      outsideRth: true,
      partial: false,
      transport: "massive_rest",
      delayed: false,
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: new Date(startMs + input.stepMs),
      ageMs: null,
    };
  });
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

test("a hit holds when the clock boundary advances but stream inputs do not", () => {
  primeRing("2026-06-09T15:00:00.000Z");
  recordRevision(SYMBOL, new Date("2026-06-09T14:59:00.000Z").getTime());

  evalAt("2026-06-09T15:00:00.000Z");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 0, misses: 1 });

  evalAt("2026-06-09T15:01:00.000Z");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });
});

test("stream-base promotion preserves cache hits while backfill refreshes bust the cell", () => {
  const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
  primeRing(evaluatedAt.toISOString());

  const completedBars = loadSignalMonitorStreamCompletedBars({
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    limit: 240,
  });
  assert.ok(completedBars.length > 0, "test setup should have completed bars");

  const initialBackfillStamp = Date.parse("2026-06-09T14:00:00.000Z");
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toBackfilledBaseBars(completedBars as never),
    refreshedAtMs: initialBackfillStamp,
    source: "backfill",
  });

  const first = evalAt(evaluatedAt.toISOString());
  assert.ok(first, "first evaluation should produce a state");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 0, misses: 1 });

  const promoted = getBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
  }) as
    | {
        bars?: Array<{ timestamp: Date }>;
        contentStamp?: number;
        refreshedAt?: number;
      }
    | undefined;
  assert.equal(
    promoted?.refreshedAt,
    evaluatedAt.getTime(),
    "promotion should still bump scheduler freshness",
  );
  assert.equal(
    promoted?.contentStamp,
    initialBackfillStamp,
    "promotion should not dirty the completed-bars cache input",
  );
  assert.equal(
    promoted?.bars?.at(-1)?.timestamp.toISOString(),
    completedBars.at(-1)?.timestamp.toISOString(),
    "promotion should keep the same latest completed bar",
  );

  const second = evalAt(evaluatedAt.toISOString());
  assert.ok(second, "second evaluation should produce a state");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });

  const nextBackfillStamp = Date.parse("2026-06-09T14:30:00.000Z");
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toBackfilledBaseBars(completedBars as never),
    refreshedAtMs: nextBackfillStamp,
    source: "backfill",
  });
  const backfilled = getBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
  }) as { contentStamp?: number } | undefined;
  assert.equal(backfilled?.contentStamp, nextBackfillStamp);

  const third = evalAt(evaluatedAt.toISOString());
  assert.ok(third, "third evaluation should produce a state");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 2 });
});

test("a new completed stream bar busts the cell (re-aggregates)", () => {
  primeRing("2026-06-09T15:00:00.000Z");
  recordRevision(SYMBOL, new Date("2026-06-09T14:59:00.000Z").getTime());

  evalAt("2026-06-09T15:00:00.000Z");
  assert.equal(barsCacheStats().misses, 1);

  __stockAggregateStreamTestInternals.ingestAggregateForTests(
    aggregate(new Date("2026-06-09T15:00:00.000Z").getTime(), 104),
  );
  recordRevision(SYMBOL, new Date("2026-06-09T15:00:00.000Z").getTime());

  // The new 15:00 minute aggregate is complete at 15:01, so the completed-bar
  // input really changed and must recompute.
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

// --- P3v2 slice 1a: stored-state read shaping memoizes per-row ring loads ---

test("stored-state shaping memoizes ring loads per row and skips them without relabel", () => {
  primeRing("2026-06-09T15:00:00.000Z", 300);
  const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
  const state = {
    id: "22222222-2222-4222-8222-222222222222",
    profileId: "11111111-1111-4111-8111-111111111111",
    symbol: SYMBOL,
    timeframe: "5m",
    currentSignalDirection: "buy",
    trendDirection: "bullish",
    currentSignalAt: new Date("2026-06-09T14:30:00.000Z"),
    currentSignalPrice: "100.5",
    currentSignalClose: "100.6",
    currentSignalMfePercent: null,
    currentSignalMaePercent: null,
    filterState: null,
    latestBarAt: new Date("2026-06-09T14:55:00.000Z"),
    latestBarClose: "101.2",
    barsSinceSignal: 5,
    fresh: true,
    status: "ok",
    active: true,
    lastEvaluatedAt: new Date("2026-06-09T14:55:00.000Z"),
    lastError: null,
    createdAt: new Date("2026-06-09T14:00:00.000Z"),
    updatedAt: new Date("2026-06-09T14:55:00.000Z"),
  } as never;

  const before = sourceBarsMemoStats();

  // Lazy half: without markNonCurrentStale the per-row shaping must never touch
  // the ring — the lane read exists only as an input to the stale relabel.
  withSourceBarsMemo(() => {
    stateToResponseForSnapshot(state, {
      timeframe: "5m" as never,
      evaluatedAt,
      freshWindowBars: 5,
    });
    const stats = sourceBarsMemoStats();
    assert.equal(stats.size, 0, "no ring load without markNonCurrentStale");
    assert.equal(stats.misses, before.misses, "no memo miss without relabel");
    assert.equal(stats.hits, before.hits, "no memo hit without relabel");
  });

  // Memo half: the stored-state read's per-row pattern — the currentness
  // filter's lane read followed by the relabeling shaping's lane read for the
  // same cell — loads the ring source once and reuses it.
  withSourceBarsMemo(() => {
    laneLatestCompletedBarAt({
      symbol: SYMBOL,
      timeframe: "5m" as never,
      evaluatedAt,
    });
    stateToResponseForSnapshot(state, {
      timeframe: "5m" as never,
      evaluatedAt,
      freshWindowBars: 5,
      markNonCurrentStale: true,
    });
    const stats = sourceBarsMemoStats();
    assert.equal(stats.size, 1, "one memoized source-load for the cell");
    assert.equal(stats.misses - before.misses, 1, "ring loaded exactly once");
    assert.equal(stats.hits - before.hits, 1, "second lane read reused the memo");
  });

  // Wiring: both stored-state read functions scope the memo around their
  // synchronous shaping pass (source-structural check, matching the repo's
  // convention for asserting wiring on DB-coupled read paths).
  const source = readFileSync(
    new URL("./signal-monitor.ts", import.meta.url),
    "utf8",
  );
  const passiveStart = source.indexOf(
    "async function readSignalMonitorPassiveStoredStateFresh",
  );
  const freshStart = source.indexOf(
    "async function readSignalMonitorStateFresh",
  );
  const freshEnd = source.indexOf(
    "export async function getSignalMonitorStoredState",
  );
  assert.ok(passiveStart >= 0, "passive stored-state read exists");
  assert.ok(
    freshStart > passiveStart && freshEnd > freshStart,
    "stored-state read functions appear in the expected order",
  );
  assert.match(
    source.slice(passiveStart, freshStart),
    /withSignalMonitorStreamSourceMinuteBarsMemo\(/,
    "passive stored-state read scopes the source-bars memo",
  );
  assert.match(
    source.slice(freshStart, freshEnd),
    /withSignalMonitorStreamSourceMinuteBarsMemo\(/,
    "fresh stored-state read scopes the source-bars memo",
  );
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
    source: "backfill",
  });

  const gapFilled = evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  const streamBars = loadSignalMonitorStreamCompletedBars({
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    limit: 240,
  });
  const contiguousBars = mergeCompletedBars(fullSeries as never[], streamBars, 240);
  const contiguous = evalCompletedBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    completedBars: contiguousBars,
  });

  assert.ok(gapFilled, "stream eval should produce a state");
  assert.deepEqual(gapFilled, contiguous);
});

test("stale backfilled base gap is filled from durable history without changing signal output", async () => {
  const evaluatedAt = recentEvaluatedAt();
  const aggregates = buildMinuteAggregates({ evaluatedAt, count: 260 });
  seedStreamBars(aggregates.slice(-5));

  const fullSeries = aggregates
    .slice(-240)
    .map((entry) => aggregateToCompletedBar(entry));
  const staleBase = toHistoryBars(fullSeries.slice(0, 210));
  const fetchedGap = toHistoryBars(fullSeries.slice(210, 236));
  const expectedFrom = fullSeries[210]?.timestamp.getTime();
  const expectedTo = fullSeries[235]?.timestamp.getTime();
  let fetchCalls = 0;
  setGapFetchLoader(async (request) => {
    fetchCalls += 1;
    assert.equal(request.symbol, SYMBOL);
    assert.equal(request.timeframe, "1m");
    assert.equal(request.from.getTime(), expectedFrom);
    assert.equal(request.to.getTime(), expectedTo);
    assert.equal(request.limit, fetchedGap.length);
    return fetchedGap;
  });

  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: staleBase,
    refreshedAtMs: evaluatedAt.getTime() - 60 * 60_000,
    source: "backfill",
  });

  const firstPass = evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  assert.ok(firstPass, "first stream eval should produce a state");
  assert.equal(gapFetchStats().queuedCount, 1);

  await flushGapFetches();
  assert.equal(fetchCalls, 1);
  assert.equal(gapFetchStats().promotedCount, 1);

  const gapFilled = evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  const streamBars = loadSignalMonitorStreamCompletedBars({
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    limit: 240,
  });
  const contiguousBars = mergeCompletedBars(fullSeries as never[], streamBars, 240);
  const contiguous = evalCompletedBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    completedBars: contiguousBars,
  });

  assert.ok(gapFilled, "stream eval should produce a state after fetch");
  assert.deepEqual(gapFilled, contiguous);
});

test("stale 1h backfilled base gap is filled from durable history without changing signal output", async () => {
  const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
  const hourMs = 60 * 60_000;
  const fullSeries = buildCompletedBars({
    latestStartMs: evaluatedAt.getTime() - hourMs,
    count: 240,
    stepMs: hourMs,
  });
  const staleBase = toHistoryBars(fullSeries.slice(0, 210));
  const fetchedGap = toHistoryBars(fullSeries.slice(210));
  const expectedFrom = fullSeries[210]?.timestamp.getTime();
  const expectedTo = fullSeries.at(-1)?.timestamp.getTime();
  let fetchCalls = 0;
  setGapFetchLoader(async (request) => {
    fetchCalls += 1;
    assert.equal(request.symbol, SYMBOL);
    assert.equal(request.timeframe, "1h");
    assert.equal(request.from.getTime(), expectedFrom);
    assert.equal(request.to.getTime(), expectedTo);
    assert.equal(request.limit, fetchedGap.length);
    return fetchedGap;
  });

  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1h",
    bars: staleBase,
    refreshedAtMs: evaluatedAt.getTime() - 2 * hourMs,
    source: "backfill",
  });

  const firstPass = evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1h",
    evaluatedAt,
  });
  assert.ok(firstPass, "first 1h stream eval should produce a state");
  assert.equal(gapFetchStats().queuedCount, 1);

  await flushGapFetches();
  assert.equal(fetchCalls, 1);
  assert.equal(gapFetchStats().promotedCount, 1);

  const gapFilled = evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1h",
    evaluatedAt,
  });
  const contiguous = evalCompletedBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1h",
    evaluatedAt,
    completedBars: fullSeries as never[],
  });

  assert.ok(gapFilled, "1h stream eval should produce a state after fetch");
  assert.deepEqual(gapFilled, contiguous);
});

test("contiguous base plus live edge is unchanged and never queues durable gap fetch", async () => {
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
    source: "backfill",
  });
  let fetchCalls = 0;
  setGapFetchLoader(async () => {
    fetchCalls += 1;
    return [];
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
  await flushGapFetches();
  assert.equal(fetchCalls, 0);
  assert.equal(gapFetchStats().queuedCount, 0);
});
