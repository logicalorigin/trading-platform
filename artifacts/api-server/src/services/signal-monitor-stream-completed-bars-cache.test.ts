import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";

import { pool } from "@workspace/db";

import {
  __signalMonitorInternalsForTests,
  getSignalMonitorResidentBarStats,
  readSignalMonitorRetainedCompletedBars,
} from "./signal-monitor";
import { __dispatchBarCacheChangesForTests } from "./market-data-store";
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
  shouldEvaluateSignalMonitorMatrixStreamCellInput: shouldEvaluateStreamCell,
  resetSignalMonitorMatrixHeavyEvaluationCache: resetCaches,
  resetSignalMonitorMatrixStreamForTests: resetStream,
  seedSignalMonitorBackfilledBaseForTests: seedBackfilledBase,
  getSignalMonitorBackfilledBaseForTests: getBackfilledBase,
  getSignalMonitorRetainedBackfilledBaseForTests: getRetainedBackfilledBase,
  replaySignalMonitorBackfilledCellsForTests: replayBackfilledCells,
  refreshSignalMonitorBackfilledBaseBarsForTests: refreshBackfilledBase,
  flushSignalMonitorCompletedBarsGapFetchesForTests: flushGapFetches,
  getSignalMonitorCompletedBarsGapFetchStatsForTests: gapFetchStats,
  setSignalMonitorCompletedBarsGapFetchLoaderForTests: setGapFetchLoader,
  queueSignalMonitorCompletedBarsGapFetchForTests: queueGapFetch,
  SIGNAL_MONITOR_BACKFILLED_BASE_MAX_CELLS: BACKFILLED_BASE_MAX_CELLS,
  SIGNAL_MONITOR_GAP_FETCH_LAST_ATTEMPT_MAX_ENTRIES:
    GAP_FETCH_LAST_ATTEMPT_MAX_ENTRIES,
  stateToResponseForSnapshot,
  signalMonitorStreamLaneLatestCompletedBarAt: laneLatestCompletedBarAt,
  signalMonitorStreamLaneLatestCompletedBarAtFromTail:
    laneLatestCompletedBarAtFromTail,
} = __signalMonitorInternalsForTests;

const getRetainedStreamCompletedBars = (
  __signalMonitorInternalsForTests as unknown as Record<string, unknown>
)["getSignalMonitorRetainedStreamCompletedBarsForTests"] as
  | ((input: { symbol: string; timeframe: string }) =>
      | {
          bars: {
            length: number;
            numericColumns: unknown;
            sourceIndexes: unknown;
            freshnessIndexes: unknown;
            marketDataModeIndexes: unknown;
            flags: unknown;
            sources: unknown[];
            freshnessValues: unknown[];
            marketDataModes: unknown[];
          };
        }
      | undefined)
  | undefined;

after(async () => {
  await pool.end();
});

function resetStreamFixture(): void {
  resetStream();
  resetCaches();
  __stockAggregateStreamTestInternals.reset();
  __signalMonitorLocalBarCacheInternalsForTests.reset();
}

beforeEach(() => {
  resetStreamFixture();
});

const SYMBOL = "SPY";

const makeProfile = (settings: Record<string, unknown> = {}) =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    pyrusSignalsSettings: settings,
    freshWindowBars: 5,
  }) as never;

const aggregate = (
  startMs: number,
  close: number,
): StockMinuteAggregateMessage => ({
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

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function completedBarClosedAt(value: unknown): Date | null {
  const bar = value as
    | { dataUpdatedAt?: unknown; timestamp?: unknown }
    | undefined;
  return dateOrNull(bar?.dataUpdatedAt) ?? dateOrNull(bar?.timestamp);
}

function oldLaneLatestCompletedBarAtByAggregation(
  input: Parameters<typeof laneLatestCompletedBarAt>[0],
): Date | null {
  const streamBars = loadSignalMonitorStreamCompletedBars({
    ...input,
    limit: 64,
  });
  return completedBarClosedAt(streamBars.at(-1));
}

function seedMinuteStarts(
  starts: string[],
  options: {
    delayed?: boolean;
    futureClose?: boolean;
  } = {},
): void {
  starts.forEach((start, index) => {
    const startMs = Date.parse(start);
    __stockAggregateStreamTestInternals.ingestAggregateForTests({
      ...aggregate(startMs, 100 + index),
      delayed: options.delayed === true,
      endMs: options.futureClose ? startMs + 30 * 60_000 : startMs + 59_999,
    });
  });
}

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

test("retained completed bars merge the producer base and live edge without the passive history loader", () => {
  const evaluatedAt = new Date("2026-07-20T15:00:00.000Z");
  const minuteMs = 60_000;
  const baseBars = buildCompletedBars({
    latestStartMs: evaluatedAt.getTime() - 6 * minuteMs,
    count: 235,
    stepMs: minuteMs,
  });
  const baseLatestClose = baseBars.at(-1)!.close;
  const streamAggregates = Array.from({ length: 5 }, (_, index) =>
    aggregate(
      evaluatedAt.getTime() - (5 - index) * minuteMs,
      baseLatestClose + (index + 1) * 0.01,
    ),
  );

  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: baseBars as never,
    refreshedAtMs: evaluatedAt.getTime() - minuteMs,
    source: "backfill",
  });
  for (const entry of streamAggregates) {
    __stockAggregateStreamTestInternals.ingestAggregateForTests(entry);
  }

  const retained = readSignalMonitorRetainedCompletedBars({
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });

  assert.equal(retained.bars.length, 240);
  assert.equal(
    (retained.bars.at(-1)?.timestamp as Date | undefined)?.toISOString(),
    "2026-07-20T14:59:00.000Z",
  );
  assert.equal(retained.latestBarAt?.toISOString(), evaluatedAt.toISOString());
});

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

test("stream completed bars use the canonical signal-bar shape", () => {
  const startMs = Date.parse("2026-07-10T14:00:00.000Z");
  __stockAggregateStreamTestInternals.ingestAggregateForTests(
    aggregate(startMs, 100),
  );

  const bars = loadSignalMonitorStreamCompletedBars({
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt: new Date(startMs + 2 * 60_000),
    limit: 1,
  });

  assert.deepEqual(bars, [
    {
      timestamp: new Date(startMs),
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 1_100,
      source: "massive-websocket",
      partial: false,
      delayed: false,
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: new Date(startMs + 60_000),
    },
  ]);
});

// --- Out-of-order revision logic (the dirty-track's correctness backbone) ---

test("aggregate dirty tracking queues only completed-input changes", () => {
  const sym = "REVTEST";
  assert.equal(getRevision(sym), 0, "unseen symbol starts at 0");

  assert.equal(recordRevision(sym, 60_000), true); // first minute seen
  assert.equal(getRevision(sym), 0, "first message does not bump");

  assert.equal(recordRevision(sym, 60_000), false); // forming-minute update
  assert.equal(getRevision(sym), 0, "forming-minute update does not bump");

  assert.equal(recordRevision(sym, 120_000), true); // forward minute advance
  assert.equal(getRevision(sym), 0, "forward minute advance does not bump");

  assert.equal(recordRevision(sym, 60_000), true); // older-minute correction
  assert.equal(getRevision(sym), 1, "out-of-order correction bumps");

  assert.equal(recordRevision(sym, 180_000), true); // forward again
  assert.equal(
    getRevision(sym),
    1,
    "forward after a correction does not bump again",
  );

  assert.equal(recordRevision(sym, Number.NaN), false); // malformed startMs
  assert.equal(getRevision(sym), 1, "non-finite startMs is a no-op");

  const delayed = "REVDELAYED";
  assert.equal(recordRevision(delayed, 60_000, 119_999), true);
  assert.equal(recordRevision(delayed, 60_000, 119_999), false);
  assert.equal(
    recordRevision(delayed, 60_000, 120_000),
    true,
    "a same-minute final observed after close must invalidate completed bars",
  );
  assert.equal(getRevision(delayed), 1);
});

test("stream cell input gating skips unchanged higher timeframes without hiding corrections", () => {
  const symbol = "CADENCE";
  const at = (minute: number) =>
    new Date(Date.UTC(2026, 6, 16, 12, minute, 0, 0));
  const shouldEvaluate = (timeframe: "1m" | "5m", evaluatedAt: Date) =>
    shouldEvaluateStreamCell({
      evaluationKey: `profile:${symbol}:${timeframe}`,
      symbol,
      timeframe,
      evaluatedAt,
    });

  assert.equal(recordRevision(symbol, at(0).getTime()), true);
  assert.equal(shouldEvaluate("1m", at(1)), true);
  assert.equal(shouldEvaluate("5m", at(1)), true);
  assert.equal(shouldEvaluate("1m", at(1)), false);
  assert.equal(shouldEvaluate("5m", at(1)), false);

  assert.equal(recordRevision(symbol, at(1).getTime()), true);
  assert.equal(
    shouldEvaluate("1m", at(2)),
    true,
    "the newly completed minute must evaluate",
  );
  assert.equal(
    shouldEvaluate("5m", at(2)),
    false,
    "an unchanged completed 5m bucket must not enter aggregation",
  );

  for (let minute = 2; minute <= 4; minute += 1) {
    assert.equal(recordRevision(symbol, at(minute).getTime()), true);
  }
  assert.equal(shouldEvaluate("1m", at(5)), true);
  assert.equal(
    shouldEvaluate("5m", at(5)),
    true,
    "the 5m close must evaluate when its completed bucket advances",
  );
  assert.equal(shouldEvaluate("1m", at(5)), false);
  assert.equal(shouldEvaluate("5m", at(5)), false);

  assert.equal(
    recordRevision(symbol, at(1).getTime(), at(5).getTime()),
    true,
    "an older-minute correction must advance the correction revision",
  );
  assert.equal(shouldEvaluate("1m", at(5)), true);
  assert.equal(shouldEvaluate("5m", at(5)), true);
});

test("resident diagnostics distinguish changed stream inputs from unchanged skips", () => {
  const input = {
    evaluationKey: "profile:DIAGNOSTIC:5m",
    symbol: "DIAGNOSTIC",
    timeframe: "5m" as const,
    evaluatedAt: new Date("2026-07-16T12:01:00.000Z"),
  };

  assert.equal(shouldEvaluateStreamCell(input), true);
  assert.equal(shouldEvaluateStreamCell(input), false);
  assert.deepEqual(getSignalMonitorResidentBarStats().streamInputGate, {
    entries: 1,
    maxEntries: 12_288,
    changed: 1,
    unchanged: 1,
  });
});

test("a finalized minute dirties 1m without dirtying its still-forming 5m bucket", () => {
  const symbol = "FINALIZED";
  const minuteStartMs = Date.parse("2026-07-16T12:01:00.000Z");
  const evaluatedAt = new Date("2026-07-16T12:02:00.000Z");
  const shouldEvaluate = (timeframe: "1m" | "2m" | "5m" | "1d") =>
    shouldEvaluateStreamCell({
      evaluationKey: `profile:${symbol}:${timeframe}`,
      symbol,
      timeframe,
      evaluatedAt,
    });

  assert.equal(
    recordRevision(symbol, minuteStartMs, minuteStartMs + 59_999),
    true,
  );
  assert.equal(shouldEvaluate("1m"), true);
  assert.equal(shouldEvaluate("2m"), true);
  assert.equal(shouldEvaluate("5m"), true);
  assert.equal(shouldEvaluate("1d"), true);
  assert.equal(shouldEvaluate("1m"), false);
  assert.equal(shouldEvaluate("2m"), false);
  assert.equal(shouldEvaluate("5m"), false);
  assert.equal(shouldEvaluate("1d"), false);

  assert.equal(recordRevision(symbol, minuteStartMs, evaluatedAt.getTime()), true);
  assert.equal(shouldEvaluate("1m"), true);
  assert.equal(
    shouldEvaluate("2m"),
    true,
    "the 12:00-12:02 bucket must dirty exactly at its close boundary",
  );
  assert.equal(
    shouldEvaluate("5m"),
    false,
    "finalizing 12:01 must not dirty the 12:00-12:05 bucket before it closes",
  );
  assert.equal(
    shouldEvaluate("1d"),
    false,
    "minute aggregates are not an input to the daily stream cell",
  );
});

// --- completedBars cache hit/miss/skip semantics ---

test("identical (boundary, base, revision) reuses cached bars and is value-identical", () => {
  primeRing("2026-06-09T15:00:00.000Z");

  const r1 = evalAt("2026-06-09T15:00:00.000Z");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 0, misses: 1 });
  assert.deepEqual(
    getSignalMonitorResidentBarStats().streamCompletedBars.missReasons,
    {
      absent: 1,
      inputChanged: 0,
      expired: 0,
    },
  );
  assert.ok(
    getSignalMonitorResidentBarStats().streamCompletedBars.packedArrayBytes > 0,
  );
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

test("resident diagnostics classify a correction-driven miss as changed input", () => {
  const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
  primeRing(evaluatedAt.toISOString());
  assert.equal(
    recordRevision(
      SYMBOL,
      evaluatedAt.getTime() - 60_000,
      evaluatedAt.getTime() - 1,
    ),
    true,
  );
  evalAt(evaluatedAt.toISOString());

  assert.equal(
    recordRevision(
      SYMBOL,
      evaluatedAt.getTime() - 5 * 60_000,
      evaluatedAt.getTime(),
    ),
    true,
  );
  evalAt(evaluatedAt.toISOString());

  assert.deepEqual(
    getSignalMonitorResidentBarStats().streamCompletedBars.missReasons,
    {
      absent: 1,
      inputChanged: 1,
      expired: 0,
    },
  );
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
  const retainedAfterMiss = getRetainedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
  });

  const cacheHitAt = new Date(evaluatedAt.getTime() + 30_000);
  const second = evalAt(cacheHitAt.toISOString());
  assert.ok(second, "second evaluation should produce a state");
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });
  const retainedAfterHit = getRetainedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
  });
  assert.equal(
    retainedAfterHit?.bars,
    retainedAfterMiss?.bars,
    "a completed-bars cache hit should refresh cadence without recompacting the retained base",
  );
  assert.equal(retainedAfterHit?.refreshedAt, cacheHitAt.getTime());

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

test("same-millisecond changed backfill invalidates stream inputs before replay clears debt", async () => {
  const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
  const completedBars = buildCompletedBars({
    latestStartMs: evaluatedAt.getTime() - 60_000,
    count: 240,
    stepMs: 60_000,
  });
  const historyBars = toHistoryBars(completedBars);
  const replacementClose = 999;
  const replacementBars = toHistoryBars(
    completedBars.map((bar, index) =>
      index === completedBars.length - 1
        ? {
            ...bar,
            open: replacementClose,
            high: replacementClose + 1,
            low: replacementClose - 1,
            close: replacementClose,
          }
        : bar,
    ),
  );
  const evaluationKey = "same-millisecond-backfill:SPY:1m";

  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: historyBars,
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });
  assert.ok(
    evalStreamBars({
      profile: makeProfile(),
      symbol: SYMBOL,
      timeframe: "1m",
      evaluatedAt,
    }),
    "the initial history should evaluate",
  );
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 0, misses: 1 });
  assert.equal(
    shouldEvaluateStreamCell({
      evaluationKey,
      symbol: SYMBOL,
      timeframe: "1m",
      evaluatedAt,
    }),
    true,
  );
  assert.equal(
    shouldEvaluateStreamCell({
      evaluationKey,
      symbol: SYMBOL,
      timeframe: "1m",
      evaluatedAt,
    }),
    false,
  );
  const retained = getRetainedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
  });
  assert.ok(retained, "the seeded base should remain retained");
  retained.requiresReplay = true;

  let replayedLatestBarClose: number | null | undefined;
  await refreshBackfilledBase(
    {
      symbols: [SYMBOL],
      timeframes: ["1m"],
      evaluatedAt,
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([[`${SYMBOL}:1m`, 0]]),
      now: () => evaluatedAt,
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () =>
        ({
          bars: replacementBars,
          latestBarAt: completedBars.at(-1)!.timestamp,
        }) as never,
      replayWarmedCells: async (input, deps = {}) => {
        await replayBackfilledCells(input, {
          isScopeCurrent: deps.isScopeCurrent,
          monotonicNow: () => 0,
          yieldToEventLoop: async () => {},
          emitAggregateDelta: ({ evaluatedAt: replayedAt }) => {
            assert.ok(replayedAt, "replay must provide evaluatedAt");
            assert.equal(
              shouldEvaluateStreamCell({
                evaluationKey,
                symbol: SYMBOL,
                timeframe: "1m",
                evaluatedAt: replayedAt,
              }),
              true,
              "changed staged history must invalidate the cell before replay",
            );
            const state = evalStreamBars({
              profile: makeProfile(),
              symbol: SYMBOL,
              timeframe: "1m",
              evaluatedAt: replayedAt,
            });
            replayedLatestBarClose = state?.latestBarClose;
            return {
              matchingEvaluationCount: state ? 1 : 0,
              evaluationErrors: [],
            };
          },
        });
      },
    },
  );

  const published = getBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
  });
  assert.equal(replayedLatestBarClose, replacementClose);
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 0, misses: 2 });
  assert.equal(published?.bars.at(-1)?.close, replacementClose);
  assert.equal(published?.requiresReplay, false);
  assert.ok(
    (published?.contentStamp ?? 0) > evaluatedAt.getTime(),
    "same-time semantic mutations need a new content generation",
  );
});

test("stream completed-bars cache retains packed columns instead of bar objects", () => {
  const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
  primeRing(evaluatedAt.toISOString());

  const first = evalAt(evaluatedAt.toISOString());
  assert.ok(first, "test setup should populate the completed-bars cache");
  assert.equal(typeof getRetainedStreamCompletedBars, "function");

  const retained = getRetainedStreamCompletedBars?.({
    symbol: SYMBOL,
    timeframe: "1m",
  })?.bars;
  assert.ok((retained?.length ?? 0) > 0);
  assert.ok(retained?.numericColumns instanceof Float64Array);
  assert.ok(retained?.sourceIndexes instanceof Uint16Array);
  assert.ok(retained?.freshnessIndexes instanceof Uint16Array);
  assert.ok(retained?.marketDataModeIndexes instanceof Uint16Array);
  assert.ok(retained?.flags instanceof Uint8Array);
  assert.equal(
    Object.values(retained ?? {}).some(
      (value) =>
        Array.isArray(value) &&
        value.some((entry) => typeof entry === "object" && entry !== null),
    ),
    false,
    "retained storage must not contain one JS object per bar",
  );
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

// --- P3v2 slice 1b: latest completed bucket derives from the ring tail ---

test("tail latest-completed derivation matches the aggregation path", () => {
  const previousFullBucket = [
    "2026-06-09T14:55:00.000Z",
    "2026-06-09T14:56:00.000Z",
    "2026-06-09T14:57:00.000Z",
    "2026-06-09T14:58:00.000Z",
    "2026-06-09T14:59:00.000Z",
  ];
  const fullBoundaryBucket = [
    "2026-06-09T15:00:00.000Z",
    "2026-06-09T15:01:00.000Z",
    "2026-06-09T15:02:00.000Z",
    "2026-06-09T15:03:00.000Z",
    "2026-06-09T15:04:00.000Z",
  ];
  const scenarios: Array<{
    name: string;
    timeframe: Parameters<typeof laneLatestCompletedBarAt>[0]["timeframe"];
    evaluatedAt: string;
    expectedIso: string | null;
    seed: () => void;
  }> = [
    {
      name: "empty ring",
      timeframe: "5m",
      evaluatedAt: "2026-06-09T15:02:00.000Z",
      expectedIso: null,
      seed: () => {},
    },
    {
      name: "mid-bucket live edge skips the incomplete latest bucket",
      timeframe: "5m",
      evaluatedAt: "2026-06-09T15:02:00.000Z",
      expectedIso: "2026-06-09T15:00:00.000Z",
      seed: () =>
        seedMinuteStarts([
          ...previousFullBucket,
          ...fullBoundaryBucket.slice(0, 2),
        ]),
    },
    {
      name: "delayed provisional tail bars do not count as completed",
      timeframe: "5m",
      evaluatedAt: "2026-06-09T15:05:00.000Z",
      expectedIso: "2026-06-09T15:00:00.000Z",
      seed: () => {
        seedMinuteStarts(previousFullBucket);
        seedMinuteStarts(fullBoundaryBucket, {
          delayed: true,
          futureClose: true,
        });
      },
    },
    {
      name: "exact bucket boundary counts the bucket that just closed",
      timeframe: "5m",
      evaluatedAt: "2026-06-09T15:05:00.000Z",
      expectedIso: "2026-06-09T15:05:00.000Z",
      seed: () => seedMinuteStarts(fullBoundaryBucket),
    },
    {
      name: "gapped tail falls back to the previous full bucket",
      timeframe: "5m",
      evaluatedAt: "2026-06-09T15:05:00.000Z",
      expectedIso: "2026-06-09T15:00:00.000Z",
      seed: () => {
        seedMinuteStarts(previousFullBucket);
        seedMinuteStarts([
          "2026-06-09T15:00:00.000Z",
          "2026-06-09T15:01:00.000Z",
          "2026-06-09T15:03:00.000Z",
          "2026-06-09T15:04:00.000Z",
        ]);
      },
    },
    {
      name: "1m provisional tail falls back to the latest completed minute",
      timeframe: "1m",
      evaluatedAt: "2026-06-09T15:02:00.000Z",
      expectedIso: "2026-06-09T15:02:00.000Z",
      seed: () => {
        seedMinuteStarts([
          "2026-06-09T15:00:00.000Z",
          "2026-06-09T15:01:00.000Z",
        ]);
        seedMinuteStarts(["2026-06-09T15:02:00.000Z"], {
          delayed: true,
          futureClose: true,
        });
      },
    },
  ];

  for (const scenario of scenarios) {
    resetStreamFixture();
    scenario.seed();
    const input = {
      symbol: SYMBOL,
      timeframe: scenario.timeframe,
      evaluatedAt: new Date(scenario.evaluatedAt),
    };
    const oldValue = oldLaneLatestCompletedBarAtByAggregation(input);
    const nextValue = laneLatestCompletedBarAtFromTail(input);

    assert.equal(
      oldValue?.toISOString() ?? null,
      scenario.expectedIso,
      `${scenario.name}: fixture should exercise the expected old-path close`,
    );
    assert.equal(
      nextValue?.toISOString() ?? null,
      oldValue?.toISOString() ?? null,
      `${scenario.name}: tail derivation must match aggregation`,
    );
  }
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
    assert.equal(
      stats.hits - before.hits,
      1,
      "second lane read reused the memo",
    );
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
  assert.equal(
    getRevision(SYMBOL),
    1,
    "out-of-order minute bumped the revision",
  );
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
  const contiguousBars = mergeCompletedBars(
    fullSeries as never[],
    streamBars,
    240,
  );
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
  const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
  const aggregates = buildMinuteAggregates({ evaluatedAt, count: 260 });
  seedStreamBars(aggregates.slice(-5));

  const fullSeries = aggregates
    .slice(-240)
    .map((entry) => aggregateToCompletedBar(entry));
  const staleBase = toHistoryBars(fullSeries.slice(0, 210));
  const fetchedGap = toHistoryBars(fullSeries.slice(210, 235));
  const expectedFrom = fullSeries[210]?.timestamp.getTime();
  const expectedTo = fullSeries[234]?.timestamp.getTime();
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
  assert.equal(
    getBackfilledBase({ symbol: SYMBOL, timeframe: "1m" })?.requiresReplay,
    true,
    "durable gap content remains due until an evaluation consumes it",
  );

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
  const contiguousBars = mergeCompletedBars(
    fullSeries as never[],
    streamBars,
    240,
  );
  const contiguous = evalCompletedBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
    completedBars: contiguousBars,
  });

  assert.ok(gapFilled, "stream eval should produce a state after fetch");
  assert.deepEqual(gapFilled, contiguous);
  assert.equal(
    getBackfilledBase({ symbol: SYMBOL, timeframe: "1m" })?.requiresReplay,
    false,
    "stream promotion clears replay debt only after consuming the gap",
  );
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

test("a max-sized internal gap fetch excludes its already-present right boundary", async () => {
  const minuteMs = 60_000;
  const leftMs = Date.parse("2026-06-09T13:30:00.000Z");
  const rightMs = leftMs + 241 * minuteMs;
  const evaluatedAt = new Date(rightMs + minuteMs);
  const leftBar = buildCompletedBars({
    latestStartMs: leftMs,
    count: 1,
    stepMs: minuteMs,
  })[0]!;
  const rightBar = buildCompletedBars({
    latestStartMs: rightMs,
    count: 1,
    stepMs: minuteMs,
  })[0]!;
  let requestWindow: { from: number; to: number; limit: number } | null = null;
  setGapFetchLoader(async (request) => {
    requestWindow = {
      from: request.from.getTime(),
      to: request.to.getTime(),
      limit: request.limit,
    };
    return [];
  });
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars([leftBar, rightBar]),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();

  assert.deepEqual(requestWindow, {
    from: leftMs + minuteMs,
    to: rightMs - minuteMs,
    limit: 240,
  });
});

test("the closed overnight interval neither queues a gap fetch nor blocks completed-bars caching", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T08:01:00.000Z");
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T07:49:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T08:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  let fetchCalls = 0;
  setGapFetchLoader(async () => {
    fetchCalls += 1;
    return [];
  });
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(bars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });

  assert.equal(gapFetchStats().queuedCount, 0);
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 0, misses: 1 });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();

  assert.equal(fetchCalls, 0);
  assert.deepEqual(barsCacheStats(), { size: 1, hits: 1, misses: 1 });
});

test("a fully closed weekend interval does not queue an intraday gap fetch", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-08T00:01:00.000Z");
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-05T23:59:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-08T00:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  let fetchCalls = 0;
  setGapFetchLoader(async () => {
    fetchCalls += 1;
    return [];
  });
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(bars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();

  assert.equal(gapFetchStats().queuedCount, 0);
  assert.equal(fetchCalls, 0);
});

test("a holiday weekend between daily bars does not queue a gap fetch", async () => {
  const dayMs = 24 * 60 * 60_000;
  const evaluatedAt = new Date("2026-07-07T14:00:00.000Z");
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-07-02T00:00:00.000Z"),
      count: 1,
      stepMs: dayMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-07-06T00:00:00.000Z"),
      count: 1,
      stepMs: dayMs,
    }),
  ];
  let fetchCalls = 0;
  setGapFetchLoader(async () => {
    fetchCalls += 1;
    return [];
  });
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1d",
    bars: toHistoryBars(bars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1d",
    evaluatedAt,
  });
  await flushGapFetches();

  assert.equal(gapFetchStats().queuedCount, 0);
  assert.equal(fetchCalls, 0);
});

test("an authoritative empty sparse-session gap is memoized until base content changes", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T14:03:00.000Z");
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  setGapFetchLoader(async () => []);
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(bars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();
  assert.equal(gapFetchStats().emptyCount, 1);
  assert.deepEqual(barsCacheStats(), { size: 0, hits: 0, misses: 1 });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  assert.deepEqual(
    barsCacheStats(),
    { size: 1, hits: 1, misses: 2 },
    "the proven-empty window should recompute once to populate the cache, then hit",
  );
  assert.equal(gapFetchStats().queuedCount, 1);

  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(
      bars.map((bar, index) =>
        index === 0 ? { ...bar, volume: bar.volume + 1 } : bar,
      ),
    ),
    refreshedAtMs: evaluatedAt.getTime() + 1,
    source: "backfill",
  });
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  assert.equal(
    gapFetchStats().queuedCount,
    2,
    "a base mutation must bypass both the empty memo and its retry throttle",
  );
});

test("a semantic-equal fast-path refresh preserves authoritative empty-gap evidence", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T14:03:00.000Z");
  const refreshedAt = new Date(evaluatedAt.getTime() + 6 * minuteMs);
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  const historyBars = toHistoryBars(bars);
  let replayCount = 0;
  setGapFetchLoader(async () => []);
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: historyBars,
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();
  assert.equal(gapFetchStats().emptyCount, 1);

  await refreshBackfilledBase(
    {
      symbols: [SYMBOL],
      timeframes: ["1m"],
      evaluatedAt: refreshedAt,
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([[`${SYMBOL}:1m`, 0]]),
      now: () => refreshedAt,
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () =>
        ({
          bars: historyBars,
          latestBarAt: bars.at(-1)!.timestamp,
        }) as never,
      replayWarmedCells: async () => {
        replayCount += 1;
      },
    },
  );
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });

  assert.equal(replayCount, 0);
  assert.equal(
    gapFetchStats().queuedCount,
    1,
    "metadata-only freshness must not invalidate semantic gap evidence",
  );
});

test("a semantic-equal staged publication preserves authoritative empty-gap evidence", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T14:05:00.000Z");
  const refreshedAt = new Date(evaluatedAt.getTime() + 6 * minuteMs);
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  const historyBars = toHistoryBars(bars);
  let replayCount = 0;
  setGapFetchLoader(async () => []);
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: historyBars,
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
    requiresReplay: true,
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();
  assert.equal(gapFetchStats().emptyCount, 1);
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();
  assert.equal(
    gapFetchStats().emptyCount,
    2,
    "the setup must prove both the internal gap and advancing tail empty",
  );

  await refreshBackfilledBase(
    {
      symbols: [SYMBOL],
      timeframes: ["1m"],
      evaluatedAt: refreshedAt,
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([[`${SYMBOL}:1m`, 0]]),
      now: () => refreshedAt,
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () =>
        ({
          bars: historyBars,
          latestBarAt: bars.at(-1)!.timestamp,
        }) as never,
      replayWarmedCells: async (input, deps = {}) => {
        await replayBackfilledCells(input, {
          isScopeCurrent: deps.isScopeCurrent,
          monotonicNow: () => 0,
          yieldToEventLoop: async () => {},
          emitAggregateDelta: ({ evaluatedAt: replayedAt }) => {
            assert.ok(replayedAt, "replay must provide evaluatedAt");
            replayCount += 1;
            const state = evalStreamBars({
              profile: makeProfile(),
              symbol: SYMBOL,
              timeframe: "1m",
              evaluatedAt: replayedAt,
            });
            return {
              matchingEvaluationCount: state ? 1 : 0,
              evaluationErrors: [],
            };
          },
        });
      },
    },
  );
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });

  assert.equal(replayCount, 1);
  assert.equal(
    gapFetchStats().queuedCount,
    2,
    "a real replay-local stream promotion around identical bars must retain gap evidence",
  );
});

test("a known durable append preserves authoritative internal empty-gap evidence", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T14:03:00.000Z");
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  setGapFetchLoader(async () => []);
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(bars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();
  __dispatchBarCacheChangesForTests([
    {
      symbol: SYMBOL,
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: Date.parse("2026-06-09T14:03:00.000Z"),
      maxStartsAtMs: Date.parse("2026-06-09T14:03:00.000Z"),
      kind: "append",
      previousMaxUnknown: false,
    },
  ]);
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });

  assert.ok(getBackfilledBase({ symbol: SYMBOL, timeframe: "1m" }));
  assert.equal(
    gapFetchStats().queuedCount,
    1,
    "a known tail append cannot fill an older internal gap",
  );
});

test("a known durable append invalidates authoritative empty-tail evidence", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T15:00:00.000Z");
  const baseLatestMs = Date.parse("2026-06-09T14:50:00.000Z");
  setGapFetchLoader(async () => []);
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(
      buildCompletedBars({
        latestStartMs: baseLatestMs,
        count: 30,
        stepMs: minuteMs,
      }),
    ),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();
  assert.equal(gapFetchStats().queuedCount, 1);

  __dispatchBarCacheChangesForTests([
    {
      symbol: SYMBOL,
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: baseLatestMs + minuteMs,
      maxStartsAtMs: baseLatestMs + minuteMs,
      kind: "append",
      previousMaxUnknown: false,
    },
  ]);
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });

  assert.equal(
    gapFetchStats().queuedCount,
    2,
    "a durable tail append can fill the previously empty tail window",
  );
});

test("an empty advancing tail stays cacheable until base or aggregate content changes", async () => {
  const realDateNow = Date.now;
  const minuteMs = 60_000;
  const firstEvaluatedAt = new Date("2026-06-09T15:00:00.000Z");
  const secondEvaluatedAt = new Date(firstEvaluatedAt.getTime() + minuteMs);
  const baseLatestMs = Date.parse("2026-06-09T14:50:00.000Z");
  const baseBars = toHistoryBars(
    buildCompletedBars({
      latestStartMs: baseLatestMs,
      count: 30,
      stepMs: minuteMs,
    }),
  );
  let fetchCalls = 0;
  setGapFetchLoader(async () => {
    fetchCalls += 1;
    return [];
  });

  try {
    Date.now = () => firstEvaluatedAt.getTime();
    recordRevision(SYMBOL, baseLatestMs);
    assert.equal(getRevision(SYMBOL), 0);
    seedBackfilledBase({
      symbol: SYMBOL,
      timeframe: "1m",
      bars: baseBars,
      refreshedAtMs: firstEvaluatedAt.getTime(),
      source: "backfill",
    });

    evalStreamBars({
      profile: makeProfile(),
      symbol: SYMBOL,
      timeframe: "1m",
      evaluatedAt: firstEvaluatedAt,
    });
    await flushGapFetches();
    assert.equal(fetchCalls, 1, JSON.stringify(gapFetchStats()));
    assert.deepEqual(barsCacheStats(), { size: 0, hits: 0, misses: 1 });

    Date.now = () => secondEvaluatedAt.getTime();
    evalStreamBars({
      profile: makeProfile(),
      symbol: SYMBOL,
      timeframe: "1m",
      evaluatedAt: secondEvaluatedAt,
    });
    evalStreamBars({
      profile: makeProfile(),
      symbol: SYMBOL,
      timeframe: "1m",
      evaluatedAt: secondEvaluatedAt,
    });
    assert.deepEqual(
      barsCacheStats(),
      { size: 1, hits: 1, misses: 2 },
      "an advancing tail with unchanged inputs should settle into the cache",
    );
    assert.equal(gapFetchStats().queuedCount, 1);
    assert.equal(fetchCalls, 1);

    recordRevision(SYMBOL, baseLatestMs + minuteMs);
    assert.equal(
      getRevision(SYMBOL),
      0,
      "forward aggregate progress changes maxStartMs without incrementing revision",
    );
    evalStreamBars({
      profile: makeProfile(),
      symbol: SYMBOL,
      timeframe: "1m",
      evaluatedAt: secondEvaluatedAt,
    });
    assert.equal(
      gapFetchStats().queuedCount,
      2,
      "forward maxStartMs progress must invalidate the empty-tail evidence",
    );
  } finally {
    Date.now = realDateNow;
    resetStreamFixture();
  }
});

test("a completed-minute boundary invalidates empty-tail evidence without a new aggregate revision", async () => {
  const minuteMs = 60_000;
  const beforeBoundary = new Date("2026-06-09T14:59:30.000Z");
  const atBoundary = new Date("2026-06-09T15:00:00.000Z");
  const baseLatestMs = Date.parse("2026-06-09T14:50:00.000Z");
  const aggregateMaxStartMs = Date.parse("2026-06-09T14:59:00.000Z");
  setGapFetchLoader(async () => []);
  recordRevision(SYMBOL, aggregateMaxStartMs);
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(
      buildCompletedBars({
        latestStartMs: baseLatestMs,
        count: 30,
        stepMs: minuteMs,
      }),
    ),
    refreshedAtMs: beforeBoundary.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt: beforeBoundary,
  });
  await flushGapFetches();
  assert.equal(gapFetchStats().emptyCount, 1);
  assert.equal(getRevision(SYMBOL), 0);

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt: atBoundary,
  });

  assert.equal(
    gapFetchStats().queuedCount,
    2,
    "the forming aggregate becoming completed must invalidate the expanding tail",
  );
});

test("multiple sparse internal gaps are proven newest to oldest before caching", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T14:05:00.000Z");
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:04:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  const fetchedWindows: Array<[number, number]> = [];
  setGapFetchLoader(async (request) => {
    fetchedWindows.push([request.from.getTime(), request.to.getTime()]);
    return [];
  });
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(bars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();
  assert.deepEqual(fetchedWindows, [
    [
      Date.parse("2026-06-09T14:03:00.000Z"),
      Date.parse("2026-06-09T14:03:00.000Z"),
    ],
    [
      Date.parse("2026-06-09T14:01:00.000Z"),
      Date.parse("2026-06-09T14:01:00.000Z"),
    ],
  ]);

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  assert.deepEqual(
    barsCacheStats(),
    { size: 1, hits: 1, misses: 3 },
    "the cache may settle only after every ordered internal gap was proven empty",
  );
  assert.equal(gapFetchStats().queuedCount, 2);
});

test("internal empty-gap evidence survives forward progress only through its proven horizon", async () => {
  const minuteMs = 60_000;
  const initialEvaluatedAt = new Date("2026-06-09T14:05:00.000Z");
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:04:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  const fetchedWindows: Array<[number, number]> = [];
  setGapFetchLoader(async (request) => {
    fetchedWindows.push([request.from.getTime(), request.to.getTime()]);
    return [];
  });
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(bars),
    refreshedAtMs: initialEvaluatedAt.getTime(),
    source: "backfill",
  });

  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt: initialEvaluatedAt,
  });
  await flushGapFetches();

  const firstForwardStartMs = Date.parse("2026-06-09T14:05:00.000Z");
  seedStreamBars([aggregate(firstForwardStartMs, 100.2)]);
  recordRevision(SYMBOL, firstForwardStartMs);
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt: new Date("2026-06-09T14:06:00.000Z"),
  });
  await flushGapFetches();

  const gappedForwardStartMs = Date.parse("2026-06-09T14:07:00.000Z");
  seedStreamBars([aggregate(gappedForwardStartMs, 100.3)]);
  recordRevision(SYMBOL, gappedForwardStartMs);
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt: new Date("2026-06-09T14:08:00.000Z"),
  });
  await flushGapFetches();

  assert.deepEqual(fetchedWindows, [
    [
      Date.parse("2026-06-09T14:03:00.000Z"),
      Date.parse("2026-06-09T14:03:00.000Z"),
    ],
    [
      Date.parse("2026-06-09T14:01:00.000Z"),
      Date.parse("2026-06-09T14:01:00.000Z"),
    ],
    [
      Date.parse("2026-06-09T14:06:00.000Z"),
      Date.parse("2026-06-09T14:06:00.000Z"),
    ],
  ]);

  assert.equal(
    recordRevision(
      SYMBOL,
      Date.parse("2026-06-09T14:02:00.000Z"),
    ),
    true,
    "an out-of-order historical correction must advance aggregate revision",
  );
  assert.equal(getRevision(SYMBOL), 1);
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt: new Date("2026-06-09T14:08:00.000Z"),
  });
  await flushGapFetches();
  assert.deepEqual(fetchedWindows.at(-1), [
    Date.parse("2026-06-09T14:06:00.000Z"),
    Date.parse("2026-06-09T14:06:00.000Z"),
  ]);
  assert.equal(fetchedWindows.length, 4);
});

test("a content-changing evaluation retained during an in-flight gap read is drained next", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T14:03:00.000Z");
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  let releaseFirstLoad!: () => void;
  const firstLoadRelease = new Promise<void>((resolve) => {
    releaseFirstLoad = resolve;
  });
  let markFirstLoadStarted!: () => void;
  const firstLoadStarted = new Promise<void>((resolve) => {
    markFirstLoadStarted = resolve;
  });
  let fetchCalls = 0;
  setGapFetchLoader(async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      markFirstLoadStarted();
      await firstLoadRelease;
    }
    return [];
  });
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(bars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });

  const flush = flushGapFetches();
  await firstLoadStarted;
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(
      bars.map((bar, index) =>
        index === 0 ? { ...bar, volume: bar.volume + 1 } : bar,
      ),
    ),
    refreshedAtMs: evaluatedAt.getTime() + 1,
    source: "backfill",
  });
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  releaseFirstLoad();
  await flush;

  assert.equal(
    fetchCalls,
    2,
    "the fresh same-cell candidate must survive while the stale read unwinds",
  );
  assert.equal(gapFetchStats().staleResultDiscardCount, 1);
  assert.equal(gapFetchStats().emptyCount, 1);
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  assert.equal(gapFetchStats().queuedCount, 2);
});

test("a gap candidate made stale before its load is counted as discarded", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T14:03:00.000Z");
  const bars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  let fetchCalls = 0;
  setGapFetchLoader(async () => {
    fetchCalls += 1;
    return [];
  });
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(bars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });
  evalStreamBars({
    profile: makeProfile(),
    symbol: SYMBOL,
    timeframe: "1m",
    evaluatedAt,
  });
  seedBackfilledBase({
    symbol: SYMBOL,
    timeframe: "1m",
    bars: toHistoryBars(
      bars.map((bar, index) =>
        index === 0 ? { ...bar, volume: bar.volume + 1 } : bar,
      ),
    ),
    refreshedAtMs: evaluatedAt.getTime() + 1,
    source: "backfill",
  });

  await flushGapFetches();

  assert.equal(fetchCalls, 0);
  assert.equal(gapFetchStats().staleResultDiscardCount, 1);
  assert.equal(gapFetchStats().pendingCount, 0);
  assert.equal(gapFetchStats().inFlightCount, 0);
});

test("empty durable gap fetch retry is throttled by cell attempt time across an advancing window", async () => {
  const realDateNow = Date.now;
  const nowMs = Date.parse("2026-06-09T15:00:00.000Z");
  const minuteMs = 60_000;
  const baseBars = toHistoryBars(
    buildCompletedBars({
      latestStartMs: nowMs - 10 * minuteMs,
      count: 30,
      stepMs: minuteMs,
    }),
  );
  let fetchCalls = 0;
  setGapFetchLoader(async () => {
    fetchCalls += 1;
    return [];
  });

  try {
    Date.now = () => nowMs;
    seedBackfilledBase({
      symbol: SYMBOL,
      timeframe: "1m",
      bars: baseBars,
      refreshedAtMs: nowMs - minuteMs,
      source: "backfill",
    });
    queueGapFetch({
      symbol: SYMBOL,
      timeframe: "1m",
      fromMs: nowMs - 9 * minuteMs,
      toMs: nowMs - 5 * minuteMs,
      limit: 5,
    });
    assert.equal(gapFetchStats().queuedCount, 1);

    await flushGapFetches();
    assert.equal(fetchCalls, 1);
    assert.equal(gapFetchStats().emptyCount, 1);
    assert.equal(gapFetchStats().lastAttemptCount, 1);

    Date.now = () => nowMs + minuteMs;
    queueGapFetch({
      symbol: SYMBOL,
      timeframe: "1m",
      fromMs: nowMs - 8 * minuteMs,
      toMs: nowMs - 4 * minuteMs,
      limit: 5,
    });

    const stats = gapFetchStats();
    assert.equal(stats.queuedCount, 1);
    assert.equal(stats.pendingCount, 0);
    assert.equal(stats.skippedThrottleCount, 1);
    assert.equal(fetchCalls, 1);
  } finally {
    Date.now = realDateNow;
    resetStreamFixture();
  }
});

test("durable gap repair never exceeds the two-slot background DB lane", async () => {
  const nowMs = Date.parse("2026-06-09T15:00:00.000Z");
  const minuteMs = 60_000;
  let activeLoads = 0;
  let maxActiveLoads = 0;
  setGapFetchLoader(async () => {
    activeLoads += 1;
    maxActiveLoads = Math.max(maxActiveLoads, activeLoads);
    await new Promise<void>((resolve) => setImmediate(resolve));
    activeLoads -= 1;
    return [];
  });

  for (const symbol of ["GAP_A", "GAP_B", "GAP_C", "GAP_D", "GAP_E"]) {
    seedBackfilledBase({
      symbol,
      timeframe: "1m",
      bars: toHistoryBars(
        buildCompletedBars({
          latestStartMs: nowMs - 10 * minuteMs,
          count: 30,
          stepMs: minuteMs,
        }),
      ),
      refreshedAtMs: nowMs,
      source: "backfill",
    });
    queueGapFetch({
      symbol,
      timeframe: "1m",
      fromMs: nowMs - 9 * minuteMs,
      toMs: nowMs - 5 * minuteMs,
      limit: 5,
    });
  }

  await flushGapFetches();

  assert.equal(maxActiveLoads, 2);
  assert.equal(gapFetchStats().fetchCount, 5);
});

test("completed-bars gap fetch attempt map evicts oldest cells at the cap", async () => {
  const realDateNow = Date.now;
  const nowMs = Date.parse("2026-06-09T15:00:00.000Z");
  const minuteMs = 60_000;
  const baseBars = toHistoryBars(
    buildCompletedBars({
      latestStartMs: nowMs - minuteMs,
      count: 2,
      stepMs: minuteMs,
    }),
  );
  setGapFetchLoader(async () => []);

  try {
    Date.now = () => nowMs;
    assert.equal(
      GAP_FETCH_LAST_ATTEMPT_MAX_ENTRIES,
      BACKFILLED_BASE_MAX_CELLS,
      "negative evidence must cover the entire retained base working set",
    );
    assert.ok(
      GAP_FETCH_LAST_ATTEMPT_MAX_ENTRIES >= 12_000,
      "the configured cap must cover the supported 2,000-symbol x 6-timeframe universe",
    );
    const cellCount = GAP_FETCH_LAST_ATTEMPT_MAX_ENTRIES + 1;
    for (let index = 0; index < cellCount; index += 1) {
      const symbol = `GAPBOUND${index}`;
      seedBackfilledBase({
        symbol,
        timeframe: "1m",
        bars: baseBars,
        refreshedAtMs: nowMs,
        source: "backfill",
      });
      queueGapFetch({
        symbol,
        timeframe: "1m",
        fromMs: nowMs,
        toMs: nowMs,
        limit: 1,
      });
    }
    assert.equal(gapFetchStats().queuedCount, cellCount);

    await flushGapFetches();
    const stats = gapFetchStats();
    assert.equal(stats.pendingCount, 0);
    assert.equal(stats.fetchCount, BACKFILLED_BASE_MAX_CELLS);
    assert.equal(stats.emptyCount, BACKFILLED_BASE_MAX_CELLS);
    assert.equal(stats.lastAttemptCount, GAP_FETCH_LAST_ATTEMPT_MAX_ENTRIES);
  } finally {
    Date.now = realDateNow;
    resetStreamFixture();
  }
});

test("base LRU eviction purges the exact cell's gap-attempt state and reports capacity", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T14:03:00.000Z");
  const evictedSymbol = "GAPEVICT";
  const sparseBars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  setGapFetchLoader(async () => []);
  seedBackfilledBase({
    symbol: evictedSymbol,
    timeframe: "1m",
    bars: toHistoryBars(sparseBars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });
  evalStreamBars({
    profile: makeProfile(),
    symbol: evictedSymbol,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();
  assert.equal(gapFetchStats().lastAttemptCount, 1);

  const retainedBar = toHistoryBars([sparseBars[0]!]);
  for (let index = 0; index < BACKFILLED_BASE_MAX_CELLS; index += 1) {
    seedBackfilledBase({
      symbol: `GAPBASE${index}`,
      timeframe: "1m",
      bars: retainedBar,
      refreshedAtMs: evaluatedAt.getTime(),
      source: "backfill",
    });
  }

  assert.equal(
    getBackfilledBase({ symbol: evictedSymbol, timeframe: "1m" }),
    undefined,
  );
  assert.equal(
    gapFetchStats().lastAttemptCount,
    0,
    "the attempt for the actually evicted base key must not consume capacity",
  );
  assert.deepEqual(
    {
      attemptEntries:
        getSignalMonitorResidentBarStats().completedBarsGapFetch.attemptEntries,
      maxAttemptEntries:
        getSignalMonitorResidentBarStats().completedBarsGapFetch
          .maxAttemptEntries,
    },
    {
      attemptEntries: 0,
      maxAttemptEntries: GAP_FETCH_LAST_ATTEMPT_MAX_ENTRIES,
    },
  );
});

test("using authoritative empty-gap evidence refreshes its attempt-map LRU position", async () => {
  const minuteMs = 60_000;
  const evaluatedAt = new Date("2026-06-09T14:03:00.000Z");
  const activeSymbol = "GAPACTIVE";
  const sparseBars = [
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:00:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
    ...buildCompletedBars({
      latestStartMs: Date.parse("2026-06-09T14:02:00.000Z"),
      count: 1,
      stepMs: minuteMs,
    }),
  ];
  setGapFetchLoader(async () => []);
  seedBackfilledBase({
    symbol: activeSymbol,
    timeframe: "1m",
    bars: toHistoryBars(sparseBars),
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
  });
  evalStreamBars({
    profile: makeProfile(),
    symbol: activeSymbol,
    timeframe: "1m",
    evaluatedAt,
  });
  await flushGapFetches();

  for (
    let index = 0;
    index < GAP_FETCH_LAST_ATTEMPT_MAX_ENTRIES - 1;
    index += 1
  ) {
    queueGapFetch({
      symbol: `GAPSTALE${index}`,
      timeframe: "1m",
      fromMs: evaluatedAt.getTime(),
      toMs: evaluatedAt.getTime(),
      limit: 1,
    });
  }
  await flushGapFetches();
  assert.equal(
    gapFetchStats().lastAttemptCount,
    GAP_FETCH_LAST_ATTEMPT_MAX_ENTRIES,
  );

  evalStreamBars({
    profile: makeProfile(),
    symbol: activeSymbol,
    timeframe: "1m",
    evaluatedAt,
  });
  queueGapFetch({
    symbol: "GAPSTALEFINAL",
    timeframe: "1m",
    fromMs: evaluatedAt.getTime(),
    toMs: evaluatedAt.getTime(),
    limit: 1,
  });
  await flushGapFetches();
  resetCaches();
  const queuedBeforeReuse = gapFetchStats().queuedCount;
  evalStreamBars({
    profile: makeProfile(),
    symbol: activeSymbol,
    timeframe: "1m",
    evaluatedAt,
  });

  assert.equal(
    gapFetchStats().queuedCount,
    queuedBeforeReuse,
    "recently consumed evidence must survive the next attempt-map eviction",
  );
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
  assert.equal(
    streamBars.length,
    5,
    "test setup should have a shallow live edge",
  );
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
