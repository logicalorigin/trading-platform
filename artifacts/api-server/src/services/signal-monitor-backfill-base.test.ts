import assert from "node:assert/strict";
import test from "node:test";
import { currentDbLane } from "@workspace/db";
import {
  setDbAdmissionDiagnosticsSource,
  type DbAdmissionDiagnostics,
} from "../../../../lib/db/src/admission";

import {
  __signalMonitorInternalsForTests,
  getSignalMonitorResidentBarStats,
} from "./signal-monitor";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";
import { __dispatchBarCacheChangesForTests } from "./market-data-store";

// Minimal SignalMonitorBarSnapshot for merge tests (mirrors the helper used by
// signal-monitor-completed-bars.test.ts). `delayed`/`close` overrides let us
// assert live-edge-wins behavior on same-timestamp collisions.
const bar = (timestamp: string, overrides: Record<string, unknown> = {}) =>
  ({
    timestamp: new Date(timestamp),
    dataUpdatedAt: new Date(timestamp),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
    source: "massive-history",
    outsideRth: true,
    partial: false,
    ...overrides,
  }) as never;

const {
  mergeCompletedBars,
  groupSignalMonitorBackfillDueCellsByTimeframe,
  promoteSignalMonitorBackfilledBaseFromStream,
  seedSignalMonitorBackfilledBaseForTests,
  getSignalMonitorBackfilledBaseForTests,
  getSignalMonitorRetainedBackfilledBaseForTests,
  refreshSignalMonitorBackfilledBaseBarsForTests,
  getSignalMonitorBackfillRefreshDiagnosticsForTests,
  resetSignalMonitorBackfillRefreshDiagnosticsForTests,
  selectSignalMonitorBackfillDueCells,
  shouldSkipSignalMonitorBackfillForQuietProducer,
  resetSignalMonitorMatrixStreamForTests,
  traceSignalMonitorLaneCurrentness,
  getSignalMonitorBackfilledBaseCacheStatsForTests,
  SIGNAL_MONITOR_BACKFILLED_BASE_MAX_CELLS,
  SIGNAL_MONITOR_BACKFILL_REFRESH_MS,
  SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT,
  buildSignalMonitorBackfillReadinessPrioritiesForTests,
  isSignalMonitorDelayedBar,
  flushSignalMonitorCompletedBarsGapFetchesForTests,
  setSignalMonitorCompletedBarsGapFetchLoaderForTests,
  queueSignalMonitorCompletedBarsGapFetchForTests,
  getSignalMonitorCompletedBarsGapFetchStatsForTests,
  waitForSignalMonitorBackgroundPressureReliefForTests,
} = __signalMonitorInternalsForTests;

const replaySignalMonitorBackfilledCellsForTests = (
  __signalMonitorInternalsForTests as unknown as Record<string, unknown>
)["replaySignalMonitorBackfilledCellsForTests"] as
  | ((
      input: {
        cells: Array<{ symbol: string; timeframe: "1m" }>;
        evaluatedAt: Date;
      },
      deps: {
        monotonicNow: () => number;
        yieldToEventLoop: () => Promise<void>;
        isScopeCurrent?: () => boolean;
        emitAggregateDelta?: (input: { message: { symbol: string } }) => {
          matchingEvaluationCount: number;
          evaluationErrors: unknown[];
        };
      },
    ) => Promise<void>)
  | undefined;

const signalMonitorEvalWorkSliceElapsedForTests = (
  __signalMonitorInternalsForTests as unknown as Record<string, unknown>
)["signalMonitorEvalWorkSliceElapsedForTests"] as
  | ((startedAtMs: number, nowMs: number) => boolean)
  | undefined;

const signalMonitorPackedBarClosedAtMsForTests = (
  __signalMonitorInternalsForTests as unknown as Record<string, unknown>
)["signalMonitorPackedBarClosedAtMsForTests"] as
  | ((bars: unknown, barIndex: number, timeframe: "1m") => number | null)
  | undefined;

test("merging a deep base under a shallow live edge yields a deeper series", () => {
  // Deep backfilled base (4 historical bars) + shallow live ring (1 fresh bar).
  // The merge must produce the union, sorted, so the indicator sees the full
  // current series instead of the too-shallow live-only ring.
  const baseBars = [
    bar("2026-06-12T13:00:00.000Z"),
    bar("2026-06-12T13:01:00.000Z"),
    bar("2026-06-12T13:02:00.000Z"),
    bar("2026-06-12T13:03:00.000Z"),
  ];
  const streamBars = [bar("2026-06-12T13:04:00.000Z")];

  const merged = mergeCompletedBars(baseBars, streamBars, 240) as Array<{
    timestamp: Date;
  }>;

  assert.equal(merged.length, 5);
  assert.ok(merged.length > streamBars.length);
  // Sorted ascending, live edge last.
  assert.equal(
    merged.at(-1)?.timestamp.toISOString(),
    "2026-06-12T13:04:00.000Z",
  );
});

test("the live edge wins on a same-timestamp collision with the base", () => {
  // Same bucket present in both base and live edge: the live copy (close 101)
  // must replace the stale base copy (close 1).
  const baseBars = [bar("2026-06-12T13:00:00.000Z", { close: 1 })];
  const streamBars = [bar("2026-06-12T13:00:00.000Z", { close: 101 })];

  const merged = mergeCompletedBars(baseBars, streamBars, 240) as Array<{
    close: number;
  }>;

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.close, 101);
});

test("empty base preserves prior live-only behavior", () => {
  // The producer only calls mergeCompletedBars when the base is non-empty; this
  // documents that an empty base merges to exactly the stream bars (the path the
  // producer falls back to when baseBars.length === 0).
  const streamBars = [
    bar("2026-06-12T13:00:00.000Z"),
    bar("2026-06-12T13:01:00.000Z"),
  ];

  const merged = mergeCompletedBars([], streamBars, 240) as Array<{
    timestamp: Date;
  }>;

  assert.equal(merged.length, streamBars.length);
  assert.deepEqual(
    merged.map((b) => b.timestamp.toISOString()),
    streamBars.map((b) => (b as { timestamp: Date }).timestamp.toISOString()),
  );
});

test("append notifications keep the packed base warm while historical or unclassified changes invalidate it", () => {
  resetSignalMonitorMatrixStreamForTests();
  const refreshedAtMs = Date.parse("2026-07-17T00:00:00.000Z");
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
    bars: [bar("2026-07-16T23:58:00.000Z"), bar("2026-07-16T23:59:00.000Z")],
    refreshedAtMs,
    source: "backfill",
  });

  __dispatchBarCacheChangesForTests([
    {
      symbol: "AAPL",
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      maxStartsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      kind: "append",
      previousMaxUnknown: false,
    },
  ]);

  const retainedAfterAppend = getSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
  });
  assert.equal(retainedAfterAppend?.bars.length, 2);
  assert.equal(
    retainedAfterAppend?.refreshedAt,
    refreshedAtMs,
    "append reconciliation is independent from ordinary freshness",
  );
  assert.equal(retainedAfterAppend?.requiresBackfillReconciliation, true);

  __dispatchBarCacheChangesForTests([
    {
      symbol: "AAPL",
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: Date.parse("2026-07-16T23:58:00.000Z"),
      maxStartsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      kind: "historical",
      previousMaxUnknown: false,
    },
  ]);
  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "AAPL",
      timeframe: "1m",
    }),
    undefined,
  );

  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
    bars: [bar("2026-07-16T23:59:00.000Z")],
    refreshedAtMs,
    source: "backfill",
  });
  __dispatchBarCacheChangesForTests([
    {
      symbol: "AAPL",
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      maxStartsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      kind: "append",
      previousMaxUnknown: true,
    },
  ]);
  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "AAPL",
      timeframe: "1m",
    }),
    undefined,
  );
  assert.deepEqual(getSignalMonitorResidentBarStats().backfillRefresh, {
    inFlight: false,
    replayDueCells: 0,
    reconciliationDueCells: 0,
    failureCount: 0,
    lastError: null,
    lastErrorAt: null,
    startedCount: 0,
    overlappingWakeCount: 0,
    completedDrainCount: 0,
    loadAttemptCount: 0,
    successfulHistoryLoadCount: 0,
    emptyHistoryLoadCount: 0,
    failedHistoryLoadCount: 0,
    lastHistoryLoadError: null,
    lastHistoryLoadErrorAt: null,
    lastHistoryLoadCell: null,
    changedHistoryCount: 0,
    unchangedHistoryCount: 0,
    retainedAppendInvalidationCount: 1,
    hardInvalidationCount: 2,
    staleHistoryLoadDiscardCount: 0,
    pressurePacedWindowCount: 0,
    pressurePauseMs: 0,
    lastCompletedAt: null,
    lastDrainDurationMs: null,
  });
  resetSignalMonitorMatrixStreamForTests();
});

test("stream promotion cannot cancel an append-triggered durable reconciliation", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const bars = [bar("2026-07-16T23:59:00.000Z")];
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
    bars,
    refreshedAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
    source: "backfill",
  });
  __dispatchBarCacheChangesForTests([
    {
      symbol: "AAPL",
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      maxStartsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      kind: "append",
      previousMaxUnknown: false,
    },
  ]);
  promoteSignalMonitorBackfilledBaseFromStream({
    symbol: "AAPL",
    timeframe: "1m",
    completedBars: bars,
    evaluatedAt: new Date("2026-07-17T00:01:00.000Z"),
  });

  let loadCount = 0;
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["AAPL"],
      timeframes: ["1m"],
      evaluatedAt: new Date("2026-07-17T00:02:00.000Z"),
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([["AAPL:1m", 0]]),
      now: () => new Date("2026-07-17T00:02:00.000Z"),
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () => {
        loadCount += 1;
        return {
          bars,
          latestBarAt: new Date("2026-07-16T23:59:00.000Z"),
        } as never;
      },
      replayWarmedCells: async () => {},
    },
  );

  assert.equal(loadCount, 1);
  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "AAPL",
      timeframe: "1m",
    })?.requiresBackfillReconciliation,
    false,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("an append arriving during a history read survives that stale completion", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const bars = [bar("2026-07-16T23:59:00.000Z")];
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
    bars,
    refreshedAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
    source: "backfill",
  });
  let releaseLoad!: () => void;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let markLoadStarted!: () => void;
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve;
  });
  const refresh = refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["AAPL"],
      timeframes: ["1m"],
      evaluatedAt: new Date("2026-07-17T00:10:00.000Z"),
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([["AAPL:1m", 0]]),
      now: () => new Date("2026-07-17T00:10:00.000Z"),
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () => {
        markLoadStarted();
        await loadGate;
        return {
          bars,
          latestBarAt: new Date("2026-07-16T23:59:00.000Z"),
        } as never;
      },
      replayWarmedCells: async () => {},
    },
  );
  await loadStarted;
  __dispatchBarCacheChangesForTests([
    {
      symbol: "AAPL",
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      maxStartsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      kind: "append",
      previousMaxUnknown: false,
    },
  ]);
  releaseLoad();
  await refresh;

  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "AAPL",
      timeframe: "1m",
    })?.requiresBackfillReconciliation,
    true,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("stream promotion during a reconciliation read does not starve durable convergence", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const bars = [bar("2026-07-16T23:59:00.000Z")];
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
    bars,
    refreshedAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
    source: "backfill",
  });
  __dispatchBarCacheChangesForTests([
    {
      symbol: "AAPL",
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      maxStartsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      kind: "append",
      previousMaxUnknown: false,
    },
  ]);
  let releaseLoad!: () => void;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let markLoadStarted!: () => void;
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve;
  });
  const refresh = refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["AAPL"],
      timeframes: ["1m"],
      evaluatedAt: new Date("2026-07-17T00:02:00.000Z"),
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([["AAPL:1m", 0]]),
      now: () => new Date("2026-07-17T00:02:00.000Z"),
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () => {
        markLoadStarted();
        await loadGate;
        return {
          bars,
          latestBarAt: new Date("2026-07-16T23:59:00.000Z"),
        } as never;
      },
      replayWarmedCells: async () => {},
    },
  );
  await loadStarted;
  promoteSignalMonitorBackfilledBaseFromStream({
    symbol: "AAPL",
    timeframe: "1m",
    completedBars: bars,
    evaluatedAt: new Date("2026-07-17T00:01:00.000Z"),
  });
  releaseLoad();
  await refresh;

  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "AAPL",
      timeframe: "1m",
    })?.requiresBackfillReconciliation,
    false,
  );
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh
      .staleHistoryLoadDiscardCount,
    0,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("an older reconciliation snapshot cannot overwrite a newer streamed tail", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const durableBar = bar("2026-07-16T23:59:00.000Z");
  const correctedDurableBar = bar("2026-07-16T23:59:00.000Z", {
    close: 5,
    dataUpdatedAt: new Date("2026-07-17T00:01:30.000Z"),
  });
  const streamedBar = bar("2026-07-17T00:00:00.000Z", { close: 2 });
  let replayCount = 0;
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
    bars: [durableBar],
    refreshedAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
    source: "backfill",
  });
  __dispatchBarCacheChangesForTests([
    {
      symbol: "AAPL",
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      maxStartsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      kind: "append",
      previousMaxUnknown: false,
    },
  ]);
  let releaseLoad!: () => void;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let markLoadStarted!: () => void;
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve;
  });
  const refresh = refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["AAPL"],
      timeframes: ["1m"],
      evaluatedAt: new Date("2026-07-17T00:02:00.000Z"),
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([["AAPL:1m", 0]]),
      now: () => new Date("2026-07-17T00:02:00.000Z"),
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () => {
        markLoadStarted();
        await loadGate;
        return {
          bars: [correctedDurableBar],
          latestBarAt: new Date("2026-07-16T23:59:00.000Z"),
        } as never;
      },
      replayWarmedCells: async () => {
        replayCount += 1;
      },
    },
  );
  await loadStarted;
  promoteSignalMonitorBackfilledBaseFromStream({
    symbol: "AAPL",
    timeframe: "1m",
    completedBars: [durableBar, streamedBar],
    evaluatedAt: new Date("2026-07-17T00:01:00.000Z"),
  });
  releaseLoad();
  await refresh;

  const reconciled = getSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
  });
  assert.deepEqual(
    reconciled?.bars.map(({ timestamp }) => timestamp.toISOString()),
    ["2026-07-16T23:59:00.000Z", "2026-07-17T00:00:00.000Z"],
  );
  assert.equal(reconciled?.bars[0]?.close, 5);
  assert.equal(reconciled?.bars.at(-1)?.close, 2);
  assert.equal(reconciled?.requiresBackfillReconciliation, false);
  assert.equal(replayCount, 1);
  resetSignalMonitorMatrixStreamForTests();
});

test("a historical invalidation during a history read cannot be resurrected", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const bars = [bar("2026-07-16T23:59:00.000Z")];
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
    bars,
    refreshedAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
    source: "backfill",
  });
  let releaseLoad!: () => void;
  const loadGate = new Promise<void>((resolve) => {
    releaseLoad = resolve;
  });
  let markLoadStarted!: () => void;
  const loadStarted = new Promise<void>((resolve) => {
    markLoadStarted = resolve;
  });
  const refresh = refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["AAPL"],
      timeframes: ["1m"],
      evaluatedAt: new Date("2026-07-17T00:10:00.000Z"),
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([["AAPL:1m", 0]]),
      now: () => new Date("2026-07-17T00:10:00.000Z"),
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () => {
        markLoadStarted();
        await loadGate;
        return {
          bars,
          latestBarAt: new Date("2026-07-16T23:59:00.000Z"),
        } as never;
      },
      replayWarmedCells: async () => {},
    },
  );
  await loadStarted;
  __dispatchBarCacheChangesForTests([
    {
      symbol: "AAPL",
      timeframe: "1m",
      sourceName: "massive-history",
      startsAtMs: Date.parse("2026-07-16T23:59:00.000Z"),
      maxStartsAtMs: Date.parse("2026-07-17T00:00:00.000Z"),
      kind: "historical",
      previousMaxUnknown: false,
    },
  ]);
  releaseLoad();
  await refresh;

  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "AAPL",
      timeframe: "1m",
    }),
    undefined,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("backfilled base materialization preserves evaluator bar metadata", () => {
  resetSignalMonitorMatrixStreamForTests();
  const finalBar = bar("2026-06-12T13:00:00.000Z", {
    open: 100,
    high: 105,
    low: 99,
    close: 104,
    volume: 12_345,
    source: "ibkr-history",
    partial: false,
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: new Date("2026-06-12T13:01:00.000Z"),
  });
  const partialDelayedBar = bar("2026-06-12T13:01:00.000Z", {
    open: 104,
    high: 106,
    low: 103,
    close: 105,
    volume: 678,
    source: "massive-delayed-websocket",
    partial: true,
    delayed: true,
    freshness: "delayed",
    marketDataMode: "delayed",
    dataUpdatedAt: null,
  });
  const frozenInconsistentBar = bar("2026-06-12T13:02:00.000Z", {
    open: 105,
    high: 107,
    low: 104,
    close: 106,
    volume: 321,
    source: "ibkr-frozen-history",
    partial: false,
    delayed: false,
    freshness: "delayed",
    marketDataMode: "frozen",
    dataUpdatedAt: null,
  });
  const unspecifiedFreshnessBar = bar("2026-06-12T13:03:00.000Z", {
    source: "custom-history-source",
    partial: false,
    delayed: false,
    freshness: undefined,
    marketDataMode: null,
    dataUpdatedAt: null,
  });

  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
    bars: [
      finalBar,
      partialDelayedBar,
      frozenInconsistentBar,
      unspecifiedFreshnessBar,
    ],
    refreshedAtMs: Date.parse("2026-06-12T13:04:00.000Z"),
    source: "backfill",
  });

  const materialized = getSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
  })?.bars as
    | Array<{
        timestamp: Date;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        partial: boolean;
        delayed: boolean;
        freshness?: string;
        marketDataMode?: string | null;
        dataUpdatedAt?: Date | null;
      }>
    | undefined;

  assert.deepEqual(
    materialized?.map((entry) => ({
      timestamp: entry.timestamp.toISOString(),
      open: entry.open,
      high: entry.high,
      low: entry.low,
      close: entry.close,
      volume: entry.volume,
      source: entry.source,
      partial: entry.partial,
      delayed: entry.delayed,
      freshness: entry.freshness,
      marketDataMode: entry.marketDataMode,
      dataUpdatedAt: entry.dataUpdatedAt?.toISOString() ?? null,
    })),
    [
      {
        timestamp: "2026-06-12T13:00:00.000Z",
        open: 100,
        high: 105,
        low: 99,
        close: 104,
        volume: 12_345,
        source: "ibkr-history",
        partial: false,
        delayed: false,
        freshness: "live",
        marketDataMode: "live",
        dataUpdatedAt: "2026-06-12T13:01:00.000Z",
      },
      {
        timestamp: "2026-06-12T13:01:00.000Z",
        open: 104,
        high: 106,
        low: 103,
        close: 105,
        volume: 678,
        source: "massive-delayed-websocket",
        partial: true,
        delayed: true,
        freshness: "delayed",
        marketDataMode: "delayed",
        dataUpdatedAt: null,
      },
      {
        timestamp: "2026-06-12T13:02:00.000Z",
        open: 105,
        high: 107,
        low: 104,
        close: 106,
        volume: 321,
        source: "ibkr-frozen-history",
        partial: false,
        delayed: false,
        freshness: "delayed",
        marketDataMode: "frozen",
        dataUpdatedAt: null,
      },
      {
        timestamp: "2026-06-12T13:03:00.000Z",
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        source: "custom-history-source",
        partial: false,
        delayed: false,
        freshness: undefined,
        marketDataMode: null,
        dataUpdatedAt: null,
      },
    ],
  );
  assert.equal(isSignalMonitorDelayedBar(materialized?.[0] as never), false);
  assert.equal(isSignalMonitorDelayedBar(materialized?.[1] as never), true);
  assert.equal(materialized?.[2]?.delayed, false);
  assert.equal(isSignalMonitorDelayedBar(materialized?.[2] as never), true);
  resetSignalMonitorMatrixStreamForTests();
});

test("backfilled base retains bars in packed columns without per-bar objects", () => {
  resetSignalMonitorMatrixStreamForTests();
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
    bars: [
      bar("2026-06-12T13:00:00.000Z", {
        source: "ibkr-history",
        delayed: false,
        freshness: "delayed",
        marketDataMode: "live",
        dataUpdatedAt: null,
      }),
    ],
    refreshedAtMs: Date.parse("2026-06-12T13:02:00.000Z"),
    source: "backfill",
  });

  const retained = getSignalMonitorRetainedBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
  })?.bars as unknown as
    | {
        length: number;
        numericColumns: unknown;
        sourceIndexes: unknown;
        freshnessIndexes: unknown;
        marketDataModeIndexes: unknown;
        flags: unknown;
        sources: unknown[];
        freshnessValues: unknown[];
        marketDataModes: unknown[];
      }
    | undefined;

  assert.equal(retained?.length, 1);
  assert.ok(retained?.numericColumns instanceof Float64Array);
  assert.ok(retained?.sourceIndexes instanceof Uint16Array);
  assert.ok(retained?.freshnessIndexes instanceof Uint16Array);
  assert.ok(retained?.marketDataModeIndexes instanceof Uint16Array);
  assert.ok(retained?.flags instanceof Uint8Array);
  assert.deepEqual(retained?.sources, ["ibkr-history"]);
  assert.deepEqual(retained?.freshnessValues, ["delayed"]);
  assert.deepEqual(retained?.marketDataModes, ["live"]);
  assert.equal(
    Object.values(retained ?? {}).some(
      (value) =>
        Array.isArray(value) &&
        value.some((entry) => typeof entry === "object" && entry !== null),
    ),
    false,
    "retained storage must not contain one JS object per bar",
  );
  assert.deepEqual(getSignalMonitorResidentBarStats().backfilledBase, {
    cells: 1,
    maxCells: SIGNAL_MONITOR_BACKFILLED_BASE_MAX_CELLS,
    bars: 1,
  });
  resetSignalMonitorMatrixStreamForTests();
});

test("backfill replay yields by elapsed CPU work rather than a cell count", async () => {
  assert.equal(typeof replaySignalMonitorBackfilledCellsForTests, "function");
  assert.equal(typeof signalMonitorEvalWorkSliceElapsedForTests, "function");
  assert.equal(signalMonitorEvalWorkSliceElapsedForTests?.(0, 24), false);
  assert.equal(signalMonitorEvalWorkSliceElapsedForTests?.(0, 25), true);

  let monotonicMs = 0;
  let yields = 0;
  await replaySignalMonitorBackfilledCellsForTests?.(
    {
      cells: ["A", "B", "C"].map((symbol) => ({
        symbol,
        timeframe: "1m" as const,
      })),
      evaluatedAt: new Date("2026-06-12T13:02:00.000Z"),
    },
    {
      monotonicNow: () => {
        monotonicMs += 13;
        return monotonicMs;
      },
      yieldToEventLoop: async () => {
        yields += 1;
      },
      emitAggregateDelta: () => ({
        matchingEvaluationCount: 1,
        evaluationErrors: [],
      }),
    },
  );

  assert.equal(yields, 1, "two 13ms cells cross one 25ms work slice");
});

test("backfill replay stops after a producer generation is superseded during a work-slice yield", async () => {
  assert.equal(typeof replaySignalMonitorBackfilledCellsForTests, "function");
  let monotonicMs = 0;
  let scopeCurrent = true;
  const emittedSymbols: string[] = [];

  await replaySignalMonitorBackfilledCellsForTests?.(
    {
      cells: ["A", "B", "C"].map((symbol) => ({
        symbol,
        timeframe: "1m" as const,
      })),
      evaluatedAt: new Date("2026-06-12T13:02:00.000Z"),
    },
    {
      monotonicNow: () => {
        monotonicMs += 13;
        return monotonicMs;
      },
      yieldToEventLoop: async () => {
        scopeCurrent = false;
      },
      isScopeCurrent: () => scopeCurrent,
      emitAggregateDelta: (input) => {
        emittedSymbols.push(input.message.symbol);
        return {
          matchingEvaluationCount: 1,
          evaluationErrors: [],
        };
      },
    },
  );

  assert.deepEqual(emittedSymbols, ["A", "B"]);
});

test("backfill replay rejects swallowed evaluation failures and missing consumers", async () => {
  assert.equal(typeof replaySignalMonitorBackfilledCellsForTests, "function");
  const input = {
    cells: [{ symbol: "A", timeframe: "1m" as const }],
    evaluatedAt: new Date("2026-06-12T13:02:00.000Z"),
  };
  const baseDeps = {
    monotonicNow: () => 0,
    yieldToEventLoop: async () => {},
  };
  const evaluationFailure = new Error("production evaluator failed");

  await assert.rejects(
    replaySignalMonitorBackfilledCellsForTests!(input, {
      ...baseDeps,
      emitAggregateDelta: () => ({
        matchingEvaluationCount: 1,
        evaluationErrors: [evaluationFailure],
      }),
    }),
    (error: unknown) =>
      error instanceof AggregateError &&
      error.errors.includes(evaluationFailure),
  );
  await assert.rejects(
    replaySignalMonitorBackfilledCellsForTests!(input, {
      ...baseDeps,
      emitAggregateDelta: () => ({
        matchingEvaluationCount: 0,
        evaluationErrors: [],
      }),
    }),
    /no matching stream consumer/i,
  );
});

test("packed currentness reads the latest close timestamp without a bar object", () => {
  resetSignalMonitorMatrixStreamForTests();
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "PACKEDTIME",
    timeframe: "1m",
    bars: [
      bar("2026-06-12T13:00:00.000Z", {
        dataUpdatedAt: null,
      }),
    ],
    refreshedAtMs: Date.parse("2026-06-12T13:01:00.000Z"),
    source: "backfill",
  });
  const packed = getSignalMonitorRetainedBackfilledBaseForTests({
    symbol: "PACKEDTIME",
    timeframe: "1m",
  })?.bars;

  assert.equal(typeof signalMonitorPackedBarClosedAtMsForTests, "function");
  assert.equal(
    signalMonitorPackedBarClosedAtMsForTests?.(packed, 0, "1m"),
    Date.parse("2026-06-12T13:01:00.000Z"),
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("stream promotion advances intraday backfilled base with the evaluated series", () => {
  resetSignalMonitorMatrixStreamForTests();
  const refreshedAtMs = Date.parse("2026-06-12T13:00:00.000Z");
  const evaluatedAt = new Date("2026-06-12T13:11:00.000Z");
  const baseBars = [
    bar("2026-06-12T13:00:00.000Z"),
    bar("2026-06-12T13:05:00.000Z"),
  ];
  const completedBars = mergeCompletedBars(
    baseBars,
    [bar("2026-06-12T13:10:00.000Z", { source: "massive-websocket" })],
    240,
  ) as Array<{ timestamp: Date }>;

  seedSignalMonitorBackfilledBaseForTests({
    symbol: "aapl",
    timeframe: "5m",
    bars: baseBars,
    refreshedAtMs,
    source: "backfill",
  });
  promoteSignalMonitorBackfilledBaseFromStream({
    symbol: "AAPL",
    timeframe: "5m",
    completedBars: completedBars as never,
    evaluatedAt,
  });

  const promoted = getSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "5m",
  });
  assert.equal(promoted?.refreshedAt, evaluatedAt.getTime());
  assert.deepEqual(
    promoted?.bars.map((entry) => entry.timestamp.toISOString()),
    completedBars.map((entry) => entry.timestamp.toISOString()),
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("stream promotion does not turn daily stream output into a backfilled base", () => {
  resetSignalMonitorMatrixStreamForTests();
  const refreshedAtMs = Date.parse("2026-06-12T00:00:00.000Z");
  const baseBars = [bar("2026-06-11T00:00:00.000Z")];

  seedSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1d",
    bars: baseBars,
    refreshedAtMs,
    source: "backfill",
  });
  promoteSignalMonitorBackfilledBaseFromStream({
    symbol: "AAPL",
    timeframe: "1d",
    completedBars: [bar("2026-06-12T00:00:00.000Z")] as never,
    evaluatedAt: new Date("2026-06-13T00:00:00.000Z"),
  });

  const promoted = getSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1d",
  });
  assert.equal(promoted?.refreshedAt, refreshedAtMs);
  assert.deepEqual(
    promoted?.bars.map((entry) => entry.timestamp.toISOString()),
    ["2026-06-11T00:00:00.000Z"],
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("backfilled base cache evicts the least-recently-used cell at the cap", () => {
  resetSignalMonitorMatrixStreamForTests();
  const maxCells = SIGNAL_MONITOR_BACKFILLED_BASE_MAX_CELLS;
  const refreshedAtMs = Date.parse("2026-06-12T13:00:00.000Z");

  for (let index = 0; index < maxCells; index += 1) {
    seedSignalMonitorBackfilledBaseForTests({
      symbol: `LRUBASE${index}`,
      timeframe: "1m",
      bars: [bar("2026-06-12T13:00:00.000Z", { close: index })],
      refreshedAtMs,
      source: "backfill",
    });
  }

  assert.ok(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "LRUBASE0",
      timeframe: "1m",
    }),
  );

  seedSignalMonitorBackfilledBaseForTests({
    symbol: `LRUBASE${maxCells}`,
    timeframe: "1m",
    bars: [bar("2026-06-12T13:01:00.000Z", { close: maxCells })],
    refreshedAtMs,
    source: "backfill",
  });

  const stats = getSignalMonitorBackfilledBaseCacheStatsForTests();
  assert.equal(stats.size, maxCells);
  assert.equal(stats.maxCells, maxCells);
  assert.ok(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "LRUBASE0",
      timeframe: "1m",
    }),
  );
  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "LRUBASE1",
      timeframe: "1m",
    }),
    undefined,
  );
  assert.ok(
    getSignalMonitorBackfilledBaseForTests({
      symbol: `LRUBASE${maxCells}`,
      timeframe: "1m",
    }),
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("evicted backfilled base reads like a never-backfilled cell", () => {
  resetSignalMonitorMatrixStreamForTests();
  const maxCells = SIGNAL_MONITOR_BACKFILLED_BASE_MAX_CELLS;
  const refreshedAtMs = Date.parse("2026-06-12T13:00:00.000Z");

  for (let index = 0; index <= maxCells; index += 1) {
    seedSignalMonitorBackfilledBaseForTests({
      symbol: `EVICTEDBASE${index}`,
      timeframe: "1m",
      bars: [bar("2026-06-12T13:00:00.000Z", { close: index })],
      refreshedAtMs,
      source: "backfill",
    });
  }

  const evictedBars =
    getSignalMonitorBackfilledBaseForTests({
      symbol: "EVICTEDBASE0",
      timeframe: "1m",
    })?.bars ?? [];
  const neverBackfilledBars =
    getSignalMonitorBackfilledBaseForTests({
      symbol: "NEVERBACKFILLED",
      timeframe: "1m",
    })?.bars ?? [];
  const streamBars = [bar("2026-06-12T13:01:00.000Z")];

  assert.deepEqual(evictedBars, neverBackfilledBars);
  assert.deepEqual(
    mergeCompletedBars(evictedBars, streamBars, 240),
    mergeCompletedBars(neverBackfilledBars, streamBars, 240),
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("due-cell selection returns every due cell with the most-overdue first", () => {
  const nowMs = Date.parse("2026-06-12T15:00:00.000Z");
  const interval1m = SIGNAL_MONITOR_BACKFILL_REFRESH_MS["1m"];

  // Three cells with different staleness; only the not-yet-due cell is dropped.
  const candidates = [
    // Most overdue (refreshed 4 intervals ago).
    {
      symbol: "AAA",
      timeframe: "1m" as const,
      refreshedAt: nowMs - interval1m * 4,
    },
    // Mid overdue (refreshed ~1.5 intervals ago).
    {
      symbol: "BBB",
      timeframe: "1m" as const,
      refreshedAt: nowMs - interval1m * 1.5,
    },
    // Not yet due (refreshed within the interval) -> excluded.
    {
      symbol: "CCC",
      timeframe: "1m" as const,
      refreshedAt: nowMs - interval1m * 0.25,
    },
  ];

  const selected = selectSignalMonitorBackfillDueCells({
    candidates,
    nowMs,
  });

  assert.equal(selected.length, 2);
  // Most-overdue first; the not-yet-due cell is absent.
  assert.deepEqual(
    selected.map((cell) => cell.symbol),
    ["AAA", "BBB"],
  );
});

test("due-cell prefetch grouping keeps symbols scoped to their due timeframe", () => {
  const grouped = groupSignalMonitorBackfillDueCellsByTimeframe([
    { symbol: "aapl", timeframe: "1m" },
    { symbol: "MSFT", timeframe: "1m" },
    { symbol: "AAPL", timeframe: "1h" },
  ]);

  // Coarse-first: 1h ahead of 1m regardless of insertion order (see below).
  assert.deepEqual(
    Array.from(grouped.entries()).map(([timeframe, symbols]) => [
      timeframe,
      symbols,
    ]),
    [
      ["1h", ["AAPL"]],
      ["1m", ["AAPL", "MSFT"]],
    ],
  );
});

test("warm no-due wakes skip readiness while due and cold cells classify immediately", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  __resetApiResourcePressureForTests();
  try {
    const refreshedAt = Date.parse("2026-07-15T15:00:00.000Z");
    for (const timeframe of ["1m", "1h"] as const) {
      seedSignalMonitorBackfilledBaseForTests({
        symbol: "AAPL",
        timeframe,
        bars: [bar("2026-07-15T14:59:00.000Z")],
        refreshedAtMs: refreshedAt,
        source: "backfill",
      });
    }

    const readinessInputs: Array<{
      symbols: string[];
      timeframes: string[];
    }> = [];
    const prefetched: string[] = [];
    const deps: Parameters<
      typeof refreshSignalMonitorBackfilledBaseBarsForTests
    >[1] = {
      loadReadinessPriorities: async (input) => {
        readinessInputs.push({
          symbols: [...input.symbols],
          timeframes: [...input.timeframes],
        });
        return new Map();
      },
      runWithStoredBarsPrefetch: async (input) => {
        prefetched.push(`${input.timeframes[0]}:${input.symbols.join(",")}`);
        return undefined as never;
      },
    };

    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["AAPL"],
        timeframes: ["1m", "1h"],
        evaluatedAt: new Date(refreshedAt + 60_000),
        environment: "shadow",
      },
      deps,
    );
    assert.deepEqual(readinessInputs, []);
    assert.deepEqual(prefetched, []);

    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["AAPL", "MSFT"],
        timeframes: ["1m", "1h"],
        evaluatedAt: new Date(refreshedAt + 5 * 60_000),
        environment: "shadow",
      },
      deps,
    );
    assert.deepEqual(readinessInputs, [
      { symbols: ["MSFT"], timeframes: ["1h"] },
      { symbols: ["AAPL", "MSFT"], timeframes: ["1m"] },
    ]);
    assert.deepEqual(prefetched, ["1h:MSFT", "1m:MSFT,AAPL"]);
  } finally {
    __resetApiResourcePressureForTests();
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("backfill groups coarse timeframes first", () => {
  // The sweep's progress is in-memory only, so a restart re-colds every cell
  // and restarts at the FIRST group. Fine-first ordering starved 1h/1d of any
  // provider fetch under restart churn (post-truncate 2026-07-10: ~1,900
  // symbols repopulated 1m/5m/15m, zero repopulated 1h/1d). Coarse frames are
  // the only ones without an alternate durable supply, so they must go first.
  const grouped = groupSignalMonitorBackfillDueCellsByTimeframe(
    (["1m", "2m", "5m", "15m", "1h", "1d"] as const).map((timeframe) => ({
      symbol: "AAPL",
      timeframe,
    })),
  );

  assert.deepEqual(Array.from(grouped.keys()), [
    "1d",
    "1h",
    "15m",
    "5m",
    "2m",
    "1m",
  ]);
});

test("continuous cold backfill interleaves timeframe windows so fine frames cannot starve", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  __resetApiResourcePressureForTests();
  try {
    const symbols = Array.from(
      { length: SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT * 2 },
      (_, index) => `FAIR${index}`,
    );
    const attemptedTimeframes: string[] = [];

    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols,
        timeframes: ["1m", "1d"],
        evaluatedAt: new Date("2026-07-14T15:00:00.000Z"),
        environment: "shadow",
      },
      {
        loadReadinessPriorities: async () =>
          new Map(
            symbols.flatMap((symbol) => [
              [`${symbol}:1m`, 2],
              [`${symbol}:1d`, 2],
            ]),
          ),
        runWithStoredBarsPrefetch: async (input) => {
          attemptedTimeframes.push(input.timeframes[0]!);
          return undefined as never;
        },
      },
    );

    assert.deepEqual(attemptedTimeframes, ["1d", "1m", "1d", "1m"]);
  } finally {
    __resetApiResourcePressureForTests();
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("failed coarse backfill windows rotate fairly across timeframes", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  try {
    const symbols = Array.from(
      { length: SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT * 2 },
      (_, index) => `CROSS_TF_FAIL${index}`,
    );
    const attemptedTimeframes: string[] = [];
    const deps: Parameters<
      typeof refreshSignalMonitorBackfilledBaseBarsForTests
    >[1] = {
      loadReadinessPriorities: async () =>
        new Map(
          symbols.flatMap((symbol) => [
            [`${symbol}:1m`, 0],
            [`${symbol}:1d`, 0],
          ]),
        ),
      runWithStoredBarsPrefetch: async (input) => {
        attemptedTimeframes.push(input.timeframes[0]!);
        throw new Error("persistent coarse timeframe failure");
      },
    };

    for (let minute = 0; minute < 6; minute += 1) {
      await refreshSignalMonitorBackfilledBaseBarsForTests(
        {
          symbols,
          timeframes: ["1m", "1d"],
          evaluatedAt: new Date(`2026-07-14T15:0${minute}:00.000Z`),
          environment: "shadow",
        },
        deps,
      );
    }

    assert.deepEqual(attemptedTimeframes, ["1d", "1m", "1d", "1m", "1d", "1m"]);
  } finally {
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("readiness-query failures rotate their paced window across timeframes", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  try {
    const symbols = Array.from(
      { length: SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT * 2 },
      (_, index) => `CROSS_TF_CLASSIFY${index}`,
    );
    const attemptedWindows: string[] = [];
    let readinessAttempts = 0;
    const deps: Parameters<
      typeof refreshSignalMonitorBackfilledBaseBarsForTests
    >[1] = {
      loadReadinessPriorities: async () => {
        readinessAttempts += 1;
        throw new Error("persistent readiness classifier failure");
      },
      runWithStoredBarsPrefetch: async (input, work) => {
        attemptedWindows.push(
          `${input.timeframes[0]}:${input.symbols.join(",")}`,
        );
        return work();
      },
      loadCompletedBars: async ({ evaluatedAt }) =>
        ({
          bars: [bar(new Date(evaluatedAt.getTime() - 60_000).toISOString())],
          latestBarAt: evaluatedAt,
        }) as never,
      replayWarmedCells: async () => {},
    };

    for (let minute = 0; minute < 4; minute += 1) {
      await refreshSignalMonitorBackfilledBaseBarsForTests(
        {
          symbols,
          timeframes: ["1m", "1d"],
          evaluatedAt: new Date(`2026-07-14T16:0${minute}:00.000Z`),
          environment: "shadow",
        },
        deps,
      );
    }

    assert.deepEqual(attemptedWindows, [
      "1d:CROSS_TF_CLASSIFY0,CROSS_TF_CLASSIFY1,CROSS_TF_CLASSIFY2",
      "1m:CROSS_TF_CLASSIFY0,CROSS_TF_CLASSIFY1,CROSS_TF_CLASSIFY2",
      "1d:CROSS_TF_CLASSIFY3,CROSS_TF_CLASSIFY4,CROSS_TF_CLASSIFY5",
      "1m:CROSS_TF_CLASSIFY3,CROSS_TF_CLASSIFY4,CROSS_TF_CLASSIFY5",
    ]);
    assert.equal(readinessAttempts, 4, "one failed classifier call per wake");
  } finally {
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("a classifier-degraded partial drain anchors its successful window at return", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const symbols = ["PARTIAL0", "PARTIAL1", "PARTIAL2", "PARTIAL3"];
  const clocks = [
    new Date("2026-07-14T16:00:00.000Z"),
    new Date("2026-07-14T16:10:00.000Z"),
  ];
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols,
      timeframes: ["1m"],
      evaluatedAt: clocks[0]!,
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => {
        throw new Error("classifier unavailable");
      },
      now: () => clocks.shift() ?? new Date("2026-07-14T16:10:00.000Z"),
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () =>
        ({
          bars: [bar("2026-07-14T15:59:00.000Z")],
          latestBarAt: new Date("2026-07-14T15:59:00.000Z"),
        }) as never,
      replayWarmedCells: async () => {},
    },
  );

  for (const symbol of symbols.slice(0, 3)) {
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({ symbol, timeframe: "1m" })
        ?.refreshedAt,
      Date.parse("2026-07-14T16:10:00.000Z"),
    );
  }
  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: symbols[3]!,
      timeframe: "1m",
    }),
    undefined,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("failed cold backfill windows do not starve the rest of the universe", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const symbols = Array.from(
    { length: 65 },
    (_, index) => `S${String(index).padStart(3, "0")}`,
  );
  const attemptedGroups: string[][] = [];
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] = {
    runWithStoredBarsPrefetch: async (input) => {
      attemptedGroups.push([...input.symbols]);
      throw new Error("provider unavailable for fairness test");
    },
  };

  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols,
      timeframes: ["1d"],
      evaluatedAt: new Date("2026-06-25T15:00:00.000Z"),
      environment: "shadow",
    },
    deps,
  );
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols,
      timeframes: ["1d"],
      evaluatedAt: new Date("2026-06-25T15:01:00.000Z"),
      environment: "shadow",
    },
    deps,
  );

  assert.equal(
    attemptedGroups[0]?.length,
    SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT,
  );
  assert.equal(
    attemptedGroups[1]?.length,
    SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT,
  );
  assert.ok(
    attemptedGroups[0]?.every(
      (symbol) => !attemptedGroups[1]?.includes(symbol),
    ),
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("a failed prefetch window rotates fairly and retries before the timeframe cadence", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const symbols = Array.from({ length: 7 }, (_, index) => `FAIR${index}`);
  const attemptedGroups: string[][] = [];
  let firstGroupFailed = false;
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] = {
    loadReadinessPriorities: async () =>
      new Map(symbols.map((symbol) => [`${symbol}:1d`, 0])),
    runWithStoredBarsPrefetch: async (input, work) => {
      attemptedGroups.push([...input.symbols]);
      if (input.symbols.includes("FAIR0") && !firstGroupFailed) {
        firstGroupFailed = true;
        throw new Error("one transient group failure");
      }
      return work();
    },
    loadCompletedBars: async () =>
      ({
        bars: [bar("2026-07-11T00:00:00.000Z")],
        latestBarAt: new Date("2026-07-11T00:00:00.000Z"),
      }) as never,
    replayWarmedCells: async () => undefined,
  };

  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols,
      timeframes: ["1d"],
      evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
      environment: "shadow",
    },
    deps,
  );
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols,
      timeframes: ["1d"],
      evaluatedAt: new Date("2026-07-13T15:01:00.000Z"),
      environment: "shadow",
    },
    deps,
  );

  const firstWindowAttempts = attemptedGroups.filter((group) =>
    group.includes("FAIR0"),
  );
  assert.equal(
    firstWindowAttempts.length,
    2,
    "the failed group retries next tick",
  );
  const firstDeferredRetryIndex = attemptedGroups
    .map((group) => group.includes("FAIR0"))
    .lastIndexOf(true);
  assert.ok(
    attemptedGroups.findIndex((group) => group.includes("FAIR3")) <
      firstDeferredRetryIndex,
    "unattempted cells rotate ahead of the failed group",
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("a transient cell load failure retries on the next producer tick", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  let retryAttempts = 0;
  const replayed: string[] = [];
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] = {
    loadReadinessPriorities: async () =>
      new Map([
        ["RETRY:1h", 0],
        ["READY:1h", 0],
      ]),
    runWithStoredBarsPrefetch: async (_input, work) => work(),
    loadCompletedBars: async ({ symbol }) => {
      if (symbol === "RETRY" && retryAttempts++ === 0) {
        throw new Error("transient history read failure");
      }
      return {
        bars: [bar("2026-07-13T14:00:00.000Z")],
        latestBarAt: new Date("2026-07-13T15:00:00.000Z"),
      } as never;
    },
    replayWarmedCells: async (input) => {
      replayed.push(...input.cells.map((cell) => cell.symbol));
    },
  };

  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["RETRY", "READY"],
      timeframes: ["1h"],
      evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
      environment: "shadow",
    },
    deps,
  );
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["RETRY", "READY"],
      timeframes: ["1h"],
      evaluatedAt: new Date("2026-07-13T15:01:00.000Z"),
      environment: "shadow",
    },
    deps,
  );

  assert.equal(retryAttempts, 2);
  assert.deepEqual(replayed, ["READY", "RETRY"]);
  resetSignalMonitorMatrixStreamForTests();
});

test("backfill census separates successful, empty, and failed cell loads from sweep completion", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");

  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["SUCCESS", "EMPTY", "FAILED"],
      timeframes: ["1h"],
      evaluatedAt,
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () =>
        new Map([
          ["SUCCESS:1h", 0],
          ["EMPTY:1h", 0],
          ["FAILED:1h", 0],
        ]),
      now: () => evaluatedAt,
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async ({ symbol }) => {
        if (symbol === "FAILED") {
          throw new Error("password=should-not-enter-flight-recorder");
        }
        if (symbol === "EMPTY") {
          return { bars: [], latestBarAt: null } as never;
        }
        return {
          bars: [bar("2026-07-13T14:00:00.000Z")],
          latestBarAt: new Date("2026-07-13T14:00:00.000Z"),
        } as never;
      },
      replayWarmedCells: async () => {},
    },
  );

  const census = getSignalMonitorResidentBarStats().backfillRefresh;
  assert.equal(census.completedDrainCount, 1, "the sweep traversal completed");
  assert.equal(census.loadAttemptCount, 3);
  assert.equal(census.successfulHistoryLoadCount, 1);
  assert.equal(census.emptyHistoryLoadCount, 1);
  assert.equal(census.failedHistoryLoadCount, 1);
  assert.equal(
    census.lastHistoryLoadError,
    "Signal monitor backfilled base refresh failed.",
  );
  assert.ok(census.lastHistoryLoadErrorAt);
  assert.deepEqual(census.lastHistoryLoadCell, {
    symbol: "FAILED",
    timeframe: "1h",
  });
  assert.equal(
    census.failureCount,
    0,
    "a caught per-cell failure is not misreported as a failed sweep",
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("a setup clock failure cannot strand the backfill refresh latch", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  const input = {
    symbols: ["LATCH_SETUP"],
    timeframes: ["1m" as const],
    evaluatedAt,
    environment: "shadow" as const,
  };

  await assert.rejects(
    refreshSignalMonitorBackfilledBaseBarsForTests(input, {
      monotonicNow() {
        throw new Error("setup clock exploded");
      },
    }),
    /setup clock exploded/,
  );
  const startedAfterFailure =
    getSignalMonitorResidentBarStats().backfillRefresh.startedCount;
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh.inFlight,
    false,
  );

  await refreshSignalMonitorBackfilledBaseBarsForTests(
    { ...input, symbols: [] },
    { monotonicNow: () => 0 },
  );
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh.startedCount,
    startedAfterFailure + 1,
  );
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh.inFlight,
    false,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("a supersession cleanup failure cannot strand the backfill refresh latch", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  const historyBar = bar("2026-07-13T14:59:00.000Z");
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "LATCH_CLEANUP",
    timeframe: "1m",
    bars: [historyBar],
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
    requiresReplay: true,
  });
  let scopeCurrent = true;
  const input = {
    symbols: ["LATCH_CLEANUP"],
    timeframes: ["1m" as const],
    evaluatedAt,
    environment: "shadow" as const,
  };

  await assert.rejects(
    refreshSignalMonitorBackfilledBaseBarsForTests(input, {
      isScopeCurrent: () => scopeCurrent,
      isCellInCurrentScope() {
        throw new Error("scope adapter exploded");
      },
      loadReadinessPriorities: async () =>
        new Map([["LATCH_CLEANUP:1m", 0]]),
      monotonicNow: () => 0,
      now: () => evaluatedAt,
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () =>
        ({
          bars: [historyBar],
          latestBarAt: new Date("2026-07-13T14:59:00.000Z"),
        }) as never,
      yieldToEventLoop: async () => {},
      replayWarmedCells: async () => {
        scopeCurrent = false;
      },
    }),
    /scope adapter exploded/,
  );
  const startedAfterFailure =
    getSignalMonitorResidentBarStats().backfillRefresh.startedCount;
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh.inFlight,
    false,
  );

  await refreshSignalMonitorBackfilledBaseBarsForTests(
    { ...input, symbols: [] },
    { monotonicNow: () => 0 },
  );
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh.startedCount,
    startedAfterFailure + 1,
  );
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh.inFlight,
    false,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("a replay failure leaves the refreshed base due for the next producer tick", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  let loadCount = 0;
  let replayCount = 0;
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] = {
    loadReadinessPriorities: async () => new Map([["REPLAY:1d", 0]]),
    runWithStoredBarsPrefetch: async (_input, work) => work(),
    loadCompletedBars: async () => {
      loadCount += 1;
      return {
        bars: [bar("2026-07-12T20:00:00.000Z")],
        latestBarAt: new Date("2026-07-12T20:00:00.000Z"),
      } as never;
    },
    replayWarmedCells: async () => {
      replayCount += 1;
      if (replayCount === 1) {
        throw new Error("transient replay failure");
      }
    },
  };

  for (const evaluatedAt of [
    new Date("2026-07-13T15:00:00.000Z"),
    new Date("2026-07-13T15:01:00.000Z"),
  ]) {
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["REPLAY"],
        timeframes: ["1d"],
        evaluatedAt,
        environment: "shadow",
      },
      deps,
    );
  }

  assert.equal(loadCount, 2);
  assert.equal(replayCount, 2);
  resetSignalMonitorMatrixStreamForTests();
});

test("a superseded producer generation cannot replay or retain its warmed window", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "PROMOTED",
    timeframe: "1m",
    bars: [bar("2026-07-13T14:59:00.000Z")],
    refreshedAtMs: evaluatedAt.getTime() - 10 * 60_000,
    source: "backfill",
    requiresReplay: true,
  });
  let scopeCurrent = true;
  let yieldCount = 0;
  let replayCount = 0;
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] & { isScopeCurrent: () => boolean } = {
    isScopeCurrent: () => scopeCurrent,
    loadReadinessPriorities: async () =>
      new Map([
        ["STALE:1m", 0],
        ["PROMOTED:1m", 0],
      ]),
    monotonicNow: () => 0,
    now: () => evaluatedAt,
    runWithStoredBarsPrefetch: async (_input, work) => work(),
    loadCompletedBars: async () =>
      ({
        bars: [bar("2026-07-13T14:59:00.000Z")],
        latestBarAt: new Date("2026-07-13T14:59:00.000Z"),
      }) as never,
    yieldToEventLoop: async () => {
      yieldCount += 1;
      promoteSignalMonitorBackfilledBaseFromStream({
        symbol: "PROMOTED",
        timeframe: "1m",
        completedBars: [
          bar("2026-07-13T14:59:00.000Z", {
            close: 2,
          }),
        ],
        evaluatedAt,
      });
      scopeCurrent = false;
    },
    replayWarmedCells: async () => {
      replayCount += 1;
    },
  };

  try {
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["STALE", "PROMOTED"],
        timeframes: ["1m"],
        evaluatedAt,
        environment: "shadow",
      },
      deps,
    );

    assert.equal(yieldCount, 1);
    assert.equal(replayCount, 0);
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "STALE",
        timeframe: "1m",
      }),
      undefined,
    );
    const promoted = getSignalMonitorBackfilledBaseForTests({
      symbol: "PROMOTED",
      timeframe: "1m",
    });
    assert.equal(promoted?.bars[0]?.close, 2);
    assert.equal(promoted?.requiresReplay, false);
    const diagnostics = getSignalMonitorBackfillRefreshDiagnosticsForTests();
    assert.equal(diagnostics.failureCount, 0);
    assert.equal(
      getSignalMonitorResidentBarStats().backfillRefresh.completedDrainCount,
      0,
    );
  } finally {
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("a history load that settles after producer supersession cannot warm or replay its cell", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  let scopeCurrent = true;
  let replayCount = 0;
  let yieldCount = 0;
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] & { isScopeCurrent: () => boolean } = {
    isScopeCurrent: () => scopeCurrent,
    loadReadinessPriorities: async () => new Map([["STALE_LOAD:1h", 0]]),
    monotonicNow: () => 0,
    now: () => evaluatedAt,
    runWithStoredBarsPrefetch: async (_input, work) => work(),
    loadCompletedBars: async () => {
      scopeCurrent = false;
      return {
        bars: [bar("2026-07-13T14:00:00.000Z")],
        latestBarAt: new Date("2026-07-13T14:00:00.000Z"),
      } as never;
    },
    yieldToEventLoop: async () => {
      yieldCount += 1;
    },
    replayWarmedCells: async () => {
      replayCount += 1;
    },
  };

  try {
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["STALE_LOAD"],
        timeframes: ["1h"],
        evaluatedAt,
        environment: "shadow",
      },
      deps,
    );

    assert.equal(yieldCount, 0);
    assert.equal(replayCount, 0);
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "STALE_LOAD",
        timeframe: "1h",
      }),
      undefined,
    );
    assert.equal(
      getSignalMonitorBackfillRefreshDiagnosticsForTests().failureCount,
      0,
    );
  } finally {
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("supersession in a later window restores replay debt from earlier windows", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  const symbols = ["A", "B", "C", "D"];
  let scopeCurrent = true;
  let yieldCount = 0;
  const replayedWindows: string[][] = [];

  try {
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols,
        timeframes: ["1m"],
        evaluatedAt,
        environment: "shadow",
      },
      {
        isScopeCurrent: () => scopeCurrent,
        loadReadinessPriorities: async ({ symbols: requestedSymbols }) =>
          new Map(requestedSymbols.map((symbol) => [`${symbol}:1m`, 0])),
        monotonicNow: () => 0,
        now: () => evaluatedAt,
        runWithStoredBarsPrefetch: async (_input, work) => work(),
        loadCompletedBars: async ({ symbol }) =>
          ({
            bars: [
              bar("2026-07-13T14:59:00.000Z", {
                close: symbol.charCodeAt(0),
              }),
            ],
            latestBarAt: new Date("2026-07-13T14:59:00.000Z"),
          }) as never,
        yieldToEventLoop: async () => {
          yieldCount += 1;
          if (yieldCount === 2) {
            scopeCurrent = false;
          }
        },
        replayWarmedCells: async ({ cells }) => {
          replayedWindows.push(cells.map(({ symbol }) => symbol));
        },
      },
    );

    assert.deepEqual(replayedWindows, [["A", "B", "C"]]);
    for (const symbol of ["A", "B", "C"]) {
      assert.equal(
        getSignalMonitorBackfilledBaseForTests({
          symbol,
          timeframe: "1m",
        })?.requiresReplay,
        true,
        `${symbol} was consumed only by the superseded generation`,
      );
    }
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "D",
        timeframe: "1m",
      }),
      undefined,
    );
  } finally {
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("supersession neutralizes only replay debt removed from every current producer scope", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  const historyBar = bar("2026-07-13T14:59:00.000Z");
  for (const symbol of ["REMOVED", "SHARED"]) {
    seedSignalMonitorBackfilledBaseForTests({
      symbol,
      timeframe: "1m",
      bars: [historyBar],
      refreshedAtMs: evaluatedAt.getTime(),
      source: "backfill",
      requiresReplay: true,
    });
  }
  let scopeCurrent = true;

  try {
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["REMOVED", "SHARED"],
        timeframes: ["1m"],
        evaluatedAt,
        environment: "shadow",
      },
      {
        isScopeCurrent: () => scopeCurrent,
        isCellInCurrentScope: ({ symbol }: { symbol: string }) =>
          symbol === "SHARED",
        loadReadinessPriorities: async () =>
          new Map([
            ["REMOVED:1m", 0],
            ["SHARED:1m", 0],
          ]),
        monotonicNow: () => 0,
        now: () => evaluatedAt,
        runWithStoredBarsPrefetch: async (_input, work) => work(),
        loadCompletedBars: async () =>
          ({
            bars: [historyBar],
            latestBarAt: new Date("2026-07-13T14:59:00.000Z"),
          }) as never,
        yieldToEventLoop: async () => {
          scopeCurrent = false;
        },
        replayWarmedCells: async () => {
          assert.fail("the superseded generation must not replay");
        },
      } as Parameters<typeof refreshSignalMonitorBackfilledBaseBarsForTests>[1],
    );

    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "REMOVED",
        timeframe: "1m",
      })?.requiresReplay,
      false,
    );
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "SHARED",
        timeframe: "1m",
      })?.requiresReplay,
      true,
    );
    assert.equal(
      getSignalMonitorResidentBarStats().backfillRefresh.replayDueCells,
      1,
    );
  } finally {
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("a staged stale window cannot evict the warm LRU before publication", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  const historyBar = bar("2026-07-13T14:59:00.000Z");
  for (
    let index = 0;
    index < SIGNAL_MONITOR_BACKFILLED_BASE_MAX_CELLS;
    index += 1
  ) {
    seedSignalMonitorBackfilledBaseForTests({
      symbol: `KEEP${index}`,
      timeframe: "1m",
      bars: [historyBar],
      refreshedAtMs: evaluatedAt.getTime(),
      source: "backfill",
    });
  }
  let scopeCurrent = true;
  let loadCount = 0;
  let replayCount = 0;
  const runRefresh = () =>
    refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["STALE"],
        timeframes: ["1m"],
        evaluatedAt,
        environment: "shadow",
      },
      {
        isScopeCurrent: () => scopeCurrent,
        loadReadinessPriorities: async () => new Map([["STALE:1m", 0]]),
        monotonicNow: () => 0,
        now: () => evaluatedAt,
        runWithStoredBarsPrefetch: async (_input, work) => work(),
        loadCompletedBars: async () => {
          loadCount += 1;
          return {
            bars: [historyBar],
            latestBarAt: new Date("2026-07-13T14:59:00.000Z"),
          } as never;
        },
        yieldToEventLoop: async () => {},
        replayWarmedCells: async () => {
          replayCount += 1;
          if (replayCount === 1) {
            scopeCurrent = false;
          }
        },
      },
    );

  try {
    await runRefresh();
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "STALE",
        timeframe: "1m",
      }),
      undefined,
    );
    assert.ok(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "KEEP0",
        timeframe: "1m",
      }),
    );
    assert.equal(
      getSignalMonitorResidentBarStats().backfilledBase.cells,
      SIGNAL_MONITOR_BACKFILLED_BASE_MAX_CELLS,
    );

    scopeCurrent = true;
    await runRefresh();
    assert.equal(loadCount, 2);
    assert.equal(replayCount, 2);
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "STALE",
        timeframe: "1m",
      })?.requiresReplay,
      false,
    );
  } finally {
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("an in-replay promotion stays staged when generation changes before publication", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  assert.ok(replaySignalMonitorBackfilledCellsForTests);
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  let scopeCurrent = true;
  let supersedeOnEmit = true;
  let loadCount = 0;
  let emitCount = 0;

  const runRefresh = () =>
    refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["IN_REPLAY"],
        timeframes: ["1m"],
        evaluatedAt,
        environment: "shadow",
      },
      {
        isScopeCurrent: () => scopeCurrent,
        loadReadinessPriorities: async () => new Map([["IN_REPLAY:1m", 0]]),
        monotonicNow: () => 0,
        now: () => evaluatedAt,
        runWithStoredBarsPrefetch: async (_input, work) => work(),
        loadCompletedBars: async () => {
          loadCount += 1;
          return {
            bars: [bar("2026-07-13T14:59:00.000Z")],
            latestBarAt: new Date("2026-07-13T14:59:00.000Z"),
          } as never;
        },
        yieldToEventLoop: async () => {},
        replayWarmedCells: async ({ cells, evaluatedAt: replayedAt }) => {
          await replaySignalMonitorBackfilledCellsForTests!(
            {
              cells: cells as Array<{
                symbol: string;
                timeframe: "1m";
              }>,
              evaluatedAt: replayedAt,
            },
            {
              monotonicNow: () => 0,
              yieldToEventLoop: async () => {},
              isScopeCurrent: () => scopeCurrent,
              emitAggregateDelta: ({ message }) => {
                emitCount += 1;
                promoteSignalMonitorBackfilledBaseFromStream({
                  symbol: message.symbol,
                  timeframe: "1m",
                  completedBars: [
                    bar("2026-07-13T14:59:00.000Z", { close: 2 }),
                  ],
                  evaluatedAt: replayedAt,
                });
                if (supersedeOnEmit) {
                  scopeCurrent = false;
                }
                assert.equal(
                  getSignalMonitorBackfilledBaseForTests({
                    symbol: message.symbol,
                    timeframe: "1m",
                  }),
                  undefined,
                  "the replay-local promotion must not publish before generation revalidation",
                );
                return {
                  matchingEvaluationCount: 1,
                  evaluationErrors: [],
                };
              },
            },
          );
        },
      },
    );

  try {
    await runRefresh();
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "IN_REPLAY",
        timeframe: "1m",
      }),
      undefined,
    );

    scopeCurrent = true;
    supersedeOnEmit = false;
    await runRefresh();
    const retained = getSignalMonitorBackfilledBaseForTests({
      symbol: "IN_REPLAY",
      timeframe: "1m",
    });
    assert.equal(loadCount, 2);
    assert.equal(emitCount, 2);
    assert.equal(retained?.bars[0]?.close, 2);
    assert.equal(retained?.requiresReplay, false);
  } finally {
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("a batch replay failure retains promoted content but leaves it due", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["PROMOTED", "FAILED"],
      timeframes: ["1m"],
      evaluatedAt,
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () =>
        new Map([
          ["PROMOTED:1m", 0],
          ["FAILED:1m", 0],
        ]),
      now: () => evaluatedAt,
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () =>
        ({
          bars: [bar("2026-07-13T14:59:00.000Z")],
          latestBarAt: new Date("2026-07-13T14:59:00.000Z"),
        }) as never,
      replayWarmedCells: async () => {
        promoteSignalMonitorBackfilledBaseFromStream({
          symbol: "PROMOTED",
          timeframe: "1m",
          completedBars: [bar("2026-07-13T14:59:00.000Z", { close: 2 })],
          evaluatedAt,
        });
        throw new Error("the other cell failed replay");
      },
    },
  );

  const promoted = getSignalMonitorBackfilledBaseForTests({
    symbol: "PROMOTED",
    timeframe: "1m",
  });
  assert.equal(promoted?.bars[0]?.close, 2);
  assert.equal(promoted?.refreshedAt, 0);
  assert.equal(promoted?.requiresReplay, true);
  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "FAILED",
      timeframe: "1m",
    })?.refreshedAt,
    0,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("a gap fetch settling during failed replay preserves an immediate replay retry", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const realDateNow = Date.now;
  const firstEvaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  const firstBarAt = new Date("2026-07-13T14:58:00.000Z");
  const gapBarAt = new Date("2026-07-13T14:59:00.000Z");
  const firstBar = bar(firstBarAt.toISOString());
  const gapBar = bar(gapBarAt.toISOString());
  let loadCount = 0;
  let replayCount = 0;
  setSignalMonitorCompletedBarsGapFetchLoaderForTests(async () => [gapBar]);
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] = {
    loadReadinessPriorities: async () => new Map([["GAP_REPLAY:1m", 0]]),
    runWithStoredBarsPrefetch: async (_input, work) => work(),
    loadCompletedBars: async () => {
      loadCount += 1;
      return { bars: [firstBar], latestBarAt: firstBarAt } as never;
    },
    replayWarmedCells: async () => {
      replayCount += 1;
      if (replayCount !== 1) {
        return;
      }
      Date.now = () => firstEvaluatedAt.getTime() + 30_000;
      queueSignalMonitorCompletedBarsGapFetchForTests({
        symbol: "GAP_REPLAY",
        timeframe: "1m",
        fromMs: gapBarAt.getTime(),
        toMs: gapBarAt.getTime(),
        limit: 1,
      });
      await flushSignalMonitorCompletedBarsGapFetchesForTests();
      throw new Error("replay failed after gap settlement");
    },
  };

  try {
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["GAP_REPLAY"],
        timeframes: ["1m"],
        evaluatedAt: firstEvaluatedAt,
        environment: "shadow",
      },
      deps,
    );
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "GAP_REPLAY",
        timeframe: "1m",
      })?.requiresReplay,
      true,
    );

    Date.now = realDateNow;
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["GAP_REPLAY"],
        timeframes: ["1m"],
        evaluatedAt: new Date("2026-07-13T15:01:00.000Z"),
        environment: "shadow",
      },
      deps,
    );
    assert.equal(loadCount, 2);
    assert.equal(replayCount, 2);
  } finally {
    Date.now = realDateNow;
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("successful replay cannot clear debt on a same-millisecond gap replacement it did not consume", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const realDateNow = Date.now;
  const evaluatedAt = new Date("2026-07-13T15:00:00.000Z");
  const firstBarAt = new Date("2026-07-13T14:58:00.000Z");
  const gapBarAt = new Date("2026-07-13T14:59:00.000Z");
  const firstBar = bar(firstBarAt.toISOString());
  const gapBar = bar(gapBarAt.toISOString());
  setSignalMonitorCompletedBarsGapFetchLoaderForTests(async () => [gapBar]);

  try {
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["REPLAY_IDENTITY"],
        timeframes: ["1m"],
        evaluatedAt,
        environment: "shadow",
      },
      {
        loadReadinessPriorities: async () =>
          new Map([["REPLAY_IDENTITY:1m", 0]]),
        now: () => evaluatedAt,
        runWithStoredBarsPrefetch: async (_input, work) => work(),
        loadCompletedBars: async () =>
          ({ bars: [firstBar], latestBarAt: firstBarAt }) as never,
        replayWarmedCells: async () => {
          Date.now = () => evaluatedAt.getTime();
          queueSignalMonitorCompletedBarsGapFetchForTests({
            symbol: "REPLAY_IDENTITY",
            timeframe: "1m",
            fromMs: gapBarAt.getTime(),
            toMs: gapBarAt.getTime(),
            limit: 1,
          });
          await flushSignalMonitorCompletedBarsGapFetchesForTests();
        },
      },
    );

    const replacement = getSignalMonitorBackfilledBaseForTests({
      symbol: "REPLAY_IDENTITY",
      timeframe: "1m",
    });
    assert.deepEqual(
      replacement?.bars.map(({ timestamp }) => timestamp.toISOString()),
      [firstBarAt.toISOString(), gapBarAt.toISOString()],
    );
    assert.equal(replacement?.requiresReplay, true);
  } finally {
    Date.now = realDateNow;
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("an awaited gap fetch cannot resurrect a base after hard invalidation", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const baseAt = Date.parse("2026-07-13T14:58:00.000Z");
  const gapAt = Date.parse("2026-07-13T14:59:00.000Z");
  let resolveGapStarted!: () => void;
  let releaseGap!: () => void;
  const gapStarted = new Promise<void>((resolve) => {
    resolveGapStarted = resolve;
  });
  const gapGate = new Promise<void>((resolve) => {
    releaseGap = resolve;
  });

  seedSignalMonitorBackfilledBaseForTests({
    symbol: "GAP_RACE",
    timeframe: "1m",
    bars: [bar(new Date(baseAt).toISOString())],
    refreshedAtMs: baseAt,
    source: "backfill",
  });
  setSignalMonitorCompletedBarsGapFetchLoaderForTests(async () => {
    resolveGapStarted();
    await gapGate;
    return [bar(new Date(gapAt).toISOString())];
  });

  try {
    queueSignalMonitorCompletedBarsGapFetchForTests({
      symbol: "GAP_RACE",
      timeframe: "1m",
      fromMs: gapAt,
      toMs: gapAt,
      limit: 1,
    });
    const flush = flushSignalMonitorCompletedBarsGapFetchesForTests();
    await gapStarted;

    __dispatchBarCacheChangesForTests([
      {
        symbol: "GAP_RACE",
        timeframe: "1m",
        sourceName: "massive-history",
        startsAtMs: baseAt,
        maxStartsAtMs: gapAt,
        kind: "historical",
        previousMaxUnknown: false,
      },
    ]);
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "GAP_RACE",
        timeframe: "1m",
      }),
      undefined,
    );

    releaseGap();
    await flush;
    assert.equal(
      getSignalMonitorBackfilledBaseForTests({
        symbol: "GAP_RACE",
        timeframe: "1m",
      }),
      undefined,
    );
    assert.equal(
      getSignalMonitorCompletedBarsGapFetchStatsForTests()
        .staleResultDiscardCount,
      1,
    );
    assert.equal(
      getSignalMonitorResidentBarStats().completedBarsGapFetch
        .staleResultDiscards,
      1,
    );
  } finally {
    releaseGap();
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("backfill-owned stored-bar prefetches execute in the background DB lane", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const observedLanes: string[] = [];
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["LANE"],
      timeframes: ["1h"],
      evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([["LANE:1h", 0]]),
      runWithStoredBarsPrefetch: async () => {
        observedLanes.push(currentDbLane());
        return undefined as never;
      },
    },
  );

  assert.deepEqual(observedLanes, ["background"]);
  resetSignalMonitorMatrixStreamForTests();
});

test("one cold readiness sweep drains every due cell beyond the former 64-cell cap", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const symbols = Array.from(
    { length: 64 + SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT },
    (_, index) => `BUDGET${String(index).padStart(3, "0")}`,
  );
  const attempted: string[] = [];
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] = {
    loadReadinessPriorities: async () =>
      new Map(symbols.map((symbol) => [`${symbol}:1h`, 0])),
    runWithStoredBarsPrefetch: async (input) => {
      attempted.push(...input.symbols);
      return undefined as never;
    },
  };

  try {
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols,
        timeframes: ["1h"],
        evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
        environment: "shadow",
      },
      deps,
    );

    assert.deepEqual(attempted, symbols);
  } finally {
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("cold readiness drain yields on elapsed work and continues the same sweep", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const symbols = Array.from(
    { length: SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT * 2 },
    (_, index) => `S${String(index).padStart(3, "0")}`,
  );
  const attemptedGroups: string[][] = [];
  let monotonicMs = 0;
  let cooperativeYields = 0;
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] = {
    loadReadinessPriorities: async () =>
      new Map(symbols.map((symbol) => [`${symbol}:1h`, 0])),
    runWithStoredBarsPrefetch: async (input) => {
      attemptedGroups.push([...input.symbols]);
      monotonicMs += 30;
      return undefined as never;
    },
    monotonicNow: () => monotonicMs,
    yieldToEventLoop: async () => {
      cooperativeYields += 1;
    },
  };
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols,
      timeframes: ["1h"],
      evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
      environment: "shadow",
    },
    deps,
  );

  assert.equal(attemptedGroups.length, 2);
  assert.ok(
    attemptedGroups.every(
      (group) => group.length <= SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT,
    ),
  );
  assert.equal(cooperativeYields, 1);
  resetSignalMonitorMatrixStreamForTests();
});

test("ELU pressure paces but does not stop cold history progress", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  __resetApiResourcePressureForTests();
  try {
    const attemptedGroups: string[][] = [];
    let pressureWaits = 0;
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: Array.from({ length: 7 }, (_, index) => `PRESSURE${index}`),
        timeframes: ["1h"],
        evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
        environment: "shadow",
      },
      {
        loadReadinessPriorities: async () => new Map(),
        runWithStoredBarsPrefetch: async (input) => {
          attemptedGroups.push([...input.symbols]);
          updateApiResourcePressure({ eventLoopUtilization: 0.95 });
          return undefined as never;
        },
        waitForBackgroundPressureRelief: async () => {
          pressureWaits += 1;
        },
      },
    );

    assert.equal(attemptedGroups.length, 3);
    assert.equal(attemptedGroups.flat().length, 7);
    assert.equal(pressureWaits, 2);
  } finally {
    __resetApiResourcePressureForTests();
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("background history relief stays paused until measured pressure clears", async () => {
  assert.equal(
    typeof waitForSignalMonitorBackgroundPressureReliefForTests,
    "function",
  );
  let pressureChecks = 0;
  let intervalWaits = 0;
  const waitedMs =
    await waitForSignalMonitorBackgroundPressureReliefForTests({
      shouldPace: () => {
        pressureChecks += 1;
        return pressureChecks < 3;
      },
      waitForInterval: async () => {
        intervalWaits += 1;
      },
      pauseMs: 1_000,
    });

  assert.equal(pressureChecks, 3);
  assert.equal(intervalWaits, 3);
  assert.equal(waitedMs, 3_000);
});

test("pre-existing ELU pressure does not strand later readiness tiers", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  __resetApiResourcePressureForTests();
  try {
    updateApiResourcePressure({ eventLoopUtilization: 0.95 });
    const attemptedSymbols: string[] = [];
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["URGENT_A", "URGENT_B", "ORDINARY"],
        timeframes: ["1d"],
        evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
        environment: "shadow",
      },
      {
        loadReadinessPriorities: async () =>
          new Map([
            ["URGENT_A:1d", 0],
            ["URGENT_B:1d", 1],
            ["ORDINARY:1d", 2],
          ]),
        runWithStoredBarsPrefetch: async (input) => {
          attemptedSymbols.push(...input.symbols);
          return undefined as never;
        },
        waitForBackgroundPressureRelief: async () => {},
      },
    );

    assert.deepEqual(attemptedSymbols, ["URGENT_A", "URGENT_B", "ORDINARY"]);
  } finally {
    __resetApiResourcePressureForTests();
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("background DB admission queues pace but do not stop cold history progress", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const lane = (queued: number) => ({
    queued,
    inFlight: 0,
    admittedTotal: 0,
    maxWaitMs: 0,
    recentWaitMsP95: 0,
  });
  const unrelatedBacklog: DbAdmissionDiagnostics = {
    interactive: lane(12),
    bulk: lane(7),
    background: lane(5),
  };
  setDbAdmissionDiagnosticsSource(() => unrelatedBacklog);
  try {
    const symbols = Array.from({ length: 7 }, (_, index) => `DBQ${index}`);
    const attemptedGroups: string[][] = [];
    let pressureWaits = 0;
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols,
        timeframes: ["1h"],
        evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
        environment: "shadow",
      },
      {
        loadReadinessPriorities: async () =>
          new Map(symbols.map((symbol) => [`${symbol}:1h`, 0])),
        runWithStoredBarsPrefetch: async (input) => {
          attemptedGroups.push([...input.symbols]);
          return undefined as never;
        },
        waitForBackgroundPressureRelief: async () => {
          pressureWaits += 1;
        },
      },
    );

    assert.equal(attemptedGroups.length, 3);
    assert.equal(attemptedGroups.flat().length, symbols.length);
    assert.equal(pressureWaits, 3);
  } finally {
    setDbAdmissionDiagnosticsSource(null);
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("a backfill window waits for its own DB work before starting the next", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const symbols = Array.from(
    { length: SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT * 2 },
    (_, index) => `OWNDB${index}`,
  );
  const attemptedGroups: string[][] = [];
  let releaseFirstWindow!: () => void;
  const firstWindow = new Promise<void>((resolve) => {
    releaseFirstWindow = resolve;
  });
  const refresh = refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols,
      timeframes: ["1h"],
      evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () =>
        new Map(symbols.map((symbol) => [`${symbol}:1h`, 0])),
      runWithStoredBarsPrefetch: async (input) => {
        attemptedGroups.push([...input.symbols]);
        if (attemptedGroups.length === 1) {
          await firstWindow;
        }
        return undefined as never;
      },
    },
  );

  while (!attemptedGroups.length) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(attemptedGroups.length, 1);

  releaseFirstWindow();
  await refresh;
  assert.equal(attemptedGroups.length, 2);
  resetSignalMonitorMatrixStreamForTests();
});

test("memory-high pressure defers every cold readiness tier", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  __resetApiResourcePressureForTests();
  try {
    updateApiResourcePressure({ apiHeapUsedPercent: 80 });
    const attemptedSymbols: string[] = [];
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["URGENT", "SPARSE", "ORDINARY"],
        timeframes: ["1h"],
        evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
        environment: "shadow",
      },
      {
        loadReadinessPriorities: async () =>
          new Map([
            ["URGENT:1h", 0],
            ["SPARSE:1h", 1],
            ["ORDINARY:1h", 2],
          ]),
        runWithStoredBarsPrefetch: async (input) => {
          attemptedSymbols.push(...input.symbols);
          return undefined as never;
        },
      },
    );

    assert.deepEqual(attemptedSymbols, []);
  } finally {
    __resetApiResourcePressureForTests();
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("readiness-query failure makes paced, fair progress under high pressure", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  __resetApiResourcePressureForTests();
  try {
    seedSignalMonitorBackfilledBaseForTests({
      symbol: "WARM",
      timeframe: "1h",
      bars: [bar("2026-07-13T14:00:00.000Z")],
      refreshedAtMs: Date.parse("2026-07-13T14:00:00.000Z"),
      source: "backfill",
    });
    updateApiResourcePressure({ eventLoopUtilization: 0.95 });
    const coldSymbols = Array.from({ length: 8 }, (_, index) => `COLD${index}`);
    const attemptedGroups: string[][] = [];
    const deps: Parameters<
      typeof refreshSignalMonitorBackfilledBaseBarsForTests
    >[1] = {
      loadReadinessPriorities: async () => {
        throw new Error("readiness query unavailable");
      },
      runWithStoredBarsPrefetch: async (input) => {
        attemptedGroups.push([...input.symbols]);
        return undefined as never;
      },
      waitForBackgroundPressureRelief: async () => {},
    };
    for (const evaluatedAt of [
      new Date("2026-07-13T15:00:00.000Z"),
      new Date("2026-07-13T15:01:00.000Z"),
    ]) {
      await refreshSignalMonitorBackfilledBaseBarsForTests(
        {
          symbols: [...coldSymbols, "WARM"],
          timeframes: ["1h"],
          evaluatedAt,
          environment: "shadow",
        },
        deps,
      );
    }

    assert.equal(attemptedGroups.length, 2, "one window per degraded tick");
    assert.ok(
      attemptedGroups.every(
        (group) => group.length === SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT,
      ),
    );
    assert.ok(
      attemptedGroups[0]!.every(
        (symbol) => !attemptedGroups[1]!.includes(symbol),
      ),
      "the second tick rotates past the first attempted window",
    );
    assert.ok(attemptedGroups.flat().every((symbol) => symbol !== "WARM"));
  } finally {
    __resetApiResourcePressureForTests();
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("quiet ticker sessions warm cold ordinary cells without refreshing warm ones", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  __resetApiResourcePressureForTests();
  try {
    seedSignalMonitorBackfilledBaseForTests({
      symbol: "WARM_ORDINARY",
      timeframe: "1d",
      bars: [bar("2026-07-10T20:00:00.000Z")],
      refreshedAtMs: new Date("2026-07-12T23:00:00.000Z").getTime(),
      source: "backfill",
    });
    const attemptedSymbols: string[] = [];
    await refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["DAILY_GAP", "COLD_ORDINARY", "WARM_ORDINARY"],
        timeframes: ["1d"],
        evaluatedAt: new Date("2026-07-13T01:00:00.000Z"),
        environment: "shadow",
      },
      {
        loadReadinessPriorities: async () =>
          new Map([
            ["DAILY_GAP:1d", 0],
            ["COLD_ORDINARY:1d", 2],
            ["WARM_ORDINARY:1d", 2],
          ]),
        runWithStoredBarsPrefetch: async (input) => {
          attemptedSymbols.push(...input.symbols);
          return undefined as never;
        },
      },
    );

    assert.deepEqual(attemptedSymbols, ["DAILY_GAP", "COLD_ORDINARY"]);
  } finally {
    __resetApiResourcePressureForTests();
    resetSignalMonitorMatrixStreamForTests();
  }
});

test("quiet ticker sessions still repay warm replay debt", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();
  const evaluatedAt = new Date("2026-07-13T01:00:00.000Z");
  const bars = [bar("2026-07-10T20:00:00.000Z")];
  seedSignalMonitorBackfilledBaseForTests({
    symbol: "REPLAY_DEBT",
    timeframe: "1d",
    bars,
    refreshedAtMs: evaluatedAt.getTime(),
    source: "backfill",
    requiresReplay: true,
  });
  let loadCount = 0;
  let replayCount = 0;

  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["REPLAY_DEBT"],
      timeframes: ["1d"],
      evaluatedAt,
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([["REPLAY_DEBT:1d", 2]]),
      now: () => evaluatedAt,
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async () => {
        loadCount += 1;
        return {
          bars,
          latestBarAt: new Date("2026-07-10T20:00:00.000Z"),
        } as never;
      },
      replayWarmedCells: async () => {
        replayCount += 1;
      },
    },
  );

  assert.equal(loadCount, 1);
  assert.equal(replayCount, 1);
  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "REPLAY_DEBT",
      timeframe: "1d",
    })?.requiresReplay,
    false,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("readiness ordering treats absent and directionless cells as urgent", () => {
  const priorities = buildSignalMonitorBackfillReadinessPrioritiesForTests({
    symbols: ["ABSENT", "EMPTY", "SIGNAL", "TREND", "READY"],
    timeframes: ["1h"],
    rows: [
      {
        symbol: "EMPTY",
        timeframe: "1h",
        readinessPriority: 0,
      },
      {
        symbol: "SIGNAL",
        timeframe: "1h",
        readinessPriority: 1,
      },
      {
        symbol: "TREND",
        timeframe: "1h",
        readinessPriority: 2,
      },
      {
        symbol: "READY",
        timeframe: "1h",
        readinessPriority: 2,
      },
    ],
  });

  assert.equal(priorities.get("ABSENT:1h"), 0);
  assert.equal(priorities.get("EMPTY:1h"), 0);
  assert.equal(priorities.get("SIGNAL:1h"), 1);
  assert.equal(priorities.get("TREND:1h"), 2);
  assert.equal(priorities.get("READY:1h"), 2);
});

test("successful history warmup is replayed immediately instead of waiting for another tick", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const replayed: Array<{ symbol: string; timeframe: string }> = [];
  let retainSettledCacheEntry: unknown = "not-called";
  let bypassCompletedBarsCache: unknown = "not-called";
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["AAPL"],
      timeframes: ["1h"],
      evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
      environment: "shadow",
    },
    {
      loadReadinessPriorities: async () => new Map([["AAPL:1h", 0]]),
      runWithStoredBarsPrefetch: async (_input, work) => work(),
      loadCompletedBars: async (loadInput) => {
        retainSettledCacheEntry = loadInput.retainSettledCacheEntry;
        bypassCompletedBarsCache = loadInput.bypassCompletedBarsCache;
        return {
          bars: [bar("2026-07-13T14:00:00.000Z")],
          latestBarAt: new Date("2026-07-13T15:00:00.000Z"),
        } as never;
      },
      replayWarmedCells: async (input) => {
        replayed.push(...input.cells);
      },
    },
  );

  assert.deepEqual(replayed, [{ symbol: "AAPL", timeframe: "1h" }]);
  assert.equal(retainSettledCacheEntry, false);
  assert.equal(bypassCompletedBarsCache, true);
  resetSignalMonitorMatrixStreamForTests();
});

test("each backfill window uses a fresh evaluation and refresh clock", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const symbols = ["CLOCK0", "CLOCK1", "CLOCK2", "CLOCK3"];
  const windowTimes = [
    new Date("2026-07-13T15:00:00.000Z"),
    new Date("2026-07-13T15:10:00.000Z"),
  ];
  const loadedAt: Array<{ symbol: string; evaluatedAt: string }> = [];
  const replayedAt: Array<{ symbols: string[]; evaluatedAt: string }> = [];
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] = {
    loadReadinessPriorities: async () =>
      new Map(symbols.map((symbol) => [`${symbol}:1m`, 0])),
    now: () => windowTimes.shift() ?? new Date("2026-07-13T15:10:00.000Z"),
    runWithStoredBarsPrefetch: async (_input, work) => work(),
    loadCompletedBars: async ({ symbol, evaluatedAt }) => {
      loadedAt.push({ symbol, evaluatedAt: evaluatedAt.toISOString() });
      return {
        bars: [bar("2026-07-13T14:59:00.000Z")],
        latestBarAt: new Date("2026-07-13T15:00:00.000Z"),
      } as never;
    },
    replayWarmedCells: async ({ cells, evaluatedAt }) => {
      replayedAt.push({
        symbols: cells.map((cell) => cell.symbol),
        evaluatedAt: evaluatedAt.toISOString(),
      });
    },
  };
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols,
      timeframes: ["1m"],
      evaluatedAt: new Date("2026-07-13T15:00:00.000Z"),
      environment: "shadow",
    },
    deps,
  );

  assert.deepEqual(
    loadedAt.map((entry) => entry.evaluatedAt),
    [
      "2026-07-13T15:00:00.000Z",
      "2026-07-13T15:00:00.000Z",
      "2026-07-13T15:00:00.000Z",
      "2026-07-13T15:10:00.000Z",
    ],
  );
  assert.deepEqual(replayedAt, [
    {
      symbols: ["CLOCK0", "CLOCK1", "CLOCK2"],
      evaluatedAt: "2026-07-13T15:00:00.000Z",
    },
    {
      symbols: ["CLOCK3"],
      evaluatedAt: "2026-07-13T15:10:00.000Z",
    },
  ]);
  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "CLOCK3",
      timeframe: "1m",
    })?.refreshedAt,
    Date.parse("2026-07-13T15:10:00.000Z"),
  );

  assert.equal(
    getSignalMonitorBackfilledBaseForTests({
      symbol: "CLOCK0",
      timeframe: "1m",
    })?.refreshedAt,
    Date.parse("2026-07-13T15:10:00.000Z"),
    "early windows are fresh from drain completion, not their stale start",
  );
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols,
      timeframes: ["1m"],
      evaluatedAt: new Date("2026-07-13T15:11:00.000Z"),
      environment: "shadow",
    },
    deps,
  );
  assert.equal(
    loadedAt.length,
    4,
    "a long drain must not make its earliest successful windows immediately due",
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("semantically unchanged history advances freshness without repacking or replaying", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  let nowMs = Date.parse("2026-07-13T15:00:00.000Z");
  let loadCount = 0;
  let replayCount = 0;
  const unchangedBars = [
    {
      timestamp: new Date("2026-07-13T14:59:00.000Z"),
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      source: "massive-history",
      partial: false,
      delayed: true,
      freshness: "delayed",
      marketDataMode: "delayed",
      dataUpdatedAt: new Date("2026-07-13T15:00:01.000Z"),
    },
  ];
  const deps: Parameters<
    typeof refreshSignalMonitorBackfilledBaseBarsForTests
  >[1] = {
    loadReadinessPriorities: async () => new Map([["AAPL:1m", 0]]),
    now: () => new Date(nowMs),
    runWithStoredBarsPrefetch: async (_input, work) => work(),
    loadCompletedBars: async () => {
      loadCount += 1;
      return {
        bars: unchangedBars,
        latestBarAt: unchangedBars[0]!.timestamp,
      } as never;
    },
    replayWarmedCells: async () => {
      replayCount += 1;
    },
  };

  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["AAPL"],
      timeframes: ["1m"],
      evaluatedAt: new Date(nowMs),
      environment: "shadow",
    },
    deps,
  );
  const firstEntry = getSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
  });
  const firstRetainedBars = getSignalMonitorRetainedBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
  })?.bars;

  nowMs += 6 * 60_000;
  await refreshSignalMonitorBackfilledBaseBarsForTests(
    {
      symbols: ["AAPL"],
      timeframes: ["1m"],
      evaluatedAt: new Date(nowMs),
      environment: "shadow",
    },
    deps,
  );
  const secondEntry = getSignalMonitorBackfilledBaseForTests({
    symbol: "AAPL",
    timeframe: "1m",
  });

  assert.equal(loadCount, 2, "the due cadence still reconciles stored history");
  assert.equal(
    replayCount,
    1,
    "unchanged history does not replay evaluator state",
  );
  assert.equal(secondEntry?.contentStamp, firstEntry?.contentStamp);
  assert.strictEqual(
    getSignalMonitorRetainedBackfilledBaseForTests({
      symbol: "AAPL",
      timeframe: "1m",
    })?.bars,
    firstRetainedBars,
    "semantically equal history must retain the packed allocation",
  );
  assert.equal(secondEntry?.refreshedAt, nowMs);
  assert.equal(secondEntry?.bars.length, 1);
  assert.equal(secondEntry?.bars[0]?.source, "massive-history");
  assert.equal(secondEntry?.bars[0]?.delayed, true);
  assert.equal(
    secondEntry?.bars[0]?.dataUpdatedAt?.toISOString(),
    "2026-07-13T15:00:01.000Z",
  );
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh.changedHistoryCount,
    1,
  );
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh.unchangedHistoryCount,
    1,
  );
  resetSignalMonitorMatrixStreamForTests();
});

test("a sweep that dies mid-run still warms 1d and 1h first", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  const processedGroups: string[] = [];
  await assert.doesNotReject(
    refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["AAA", "BBB"],
        timeframes: ["1m", "2m", "5m", "15m", "1h", "1d"],
        evaluatedAt: new Date("2026-06-25T15:00:00.000Z"),
        environment: "shadow",
      },
      {
        runWithStoredBarsPrefetch: async (input) => {
          processedGroups.push(String(input.timeframes[0]));
          if (processedGroups.length >= 2) {
            // Simulate the process dying mid-sweep (the restart-churn regime
            // that starved 1h/1d): only the first groups ever complete.
            throw new Error("sweep died mid-run for test");
          }
          return null as never;
        },
      },
    ),
  );

  assert.deepEqual(processedGroups, ["1d", "1h"]);
  const diagnostics = getSignalMonitorBackfillRefreshDiagnosticsForTests();
  assert.equal(diagnostics.failureCount, 1);
  assert.equal(diagnostics.lastError, "sweep died mid-run for test");

  resetSignalMonitorMatrixStreamForTests();
});

test("backfilled base refresh swallows grouped prefetch rejection and records diagnostics", async () => {
  resetSignalMonitorMatrixStreamForTests();
  resetSignalMonitorBackfillRefreshDiagnosticsForTests();

  await assert.doesNotReject(
    refreshSignalMonitorBackfilledBaseBarsForTests(
      {
        symbols: ["AAPL"],
        timeframes: ["5m"],
        evaluatedAt: new Date("2026-06-25T15:00:00.000Z"),
        environment: "shadow",
      },
      {
        runWithStoredBarsPrefetch: async () => {
          throw new Error("prefetch rejected for test");
        },
      },
    ),
  );

  const diagnostics = getSignalMonitorBackfillRefreshDiagnosticsForTests();
  assert.equal(diagnostics.failureCount, 1);
  assert.equal(diagnostics.lastError, "prefetch rejected for test");
  assert.equal(diagnostics.lastErrorAt, "2026-06-25T15:00:00.000Z");
  assert.equal(
    diagnostics.lastDiagnostic?.operation,
    "refresh_signal_monitor_backfilled_base_bars",
  );
  assert.equal(diagnostics.lastDiagnostic?.environment, "shadow");
  assert.equal(
    diagnostics.lastDiagnostic?.sourceStatus,
    "backfill-refresh-failed",
  );
  assert.equal(
    getSignalMonitorResidentBarStats().backfillRefresh.lastError,
    "prefetch rejected for test",
  );

  resetSignalMonitorMatrixStreamForTests();
});

test("idle-session producer marks routine refresh skippable without a recent aggregate", () => {
  const evaluatedAt = new Date("2026-06-26T01:00:00.000Z");
  const graceMs = 5 * 60_000;

  assert.equal(
    shouldSkipSignalMonitorBackfillForQuietProducer({
      evaluatedAt,
      eventCount: 0,
      lastAggregateAt: null,
      recentAggregateGraceMs: graceMs,
    }),
    true,
  );
  assert.equal(
    shouldSkipSignalMonitorBackfillForQuietProducer({
      evaluatedAt,
      eventCount: 1,
      lastAggregateAt: new Date("2026-06-26T00:58:00.000Z"),
      recentAggregateGraceMs: graceMs,
    }),
    false,
  );
  assert.equal(
    shouldSkipSignalMonitorBackfillForQuietProducer({
      evaluatedAt,
      eventCount: 1,
      lastAggregateAt: new Date("2026-06-26T00:50:00.000Z"),
      recentAggregateGraceMs: graceMs,
    }),
    true,
  );
});

test("active-market producer backfill stays enabled before first aggregate", () => {
  assert.equal(
    shouldSkipSignalMonitorBackfillForQuietProducer({
      evaluatedAt: new Date("2026-06-25T15:00:00.000Z"),
      eventCount: 0,
      lastAggregateAt: null,
      recentAggregateGraceMs: 5 * 60_000,
    }),
    false,
  );
});

test("price trace explains daily rows marked stale by the policy window", () => {
  const trace = traceSignalMonitorLaneCurrentness({
    state: {
      status: "ok",
      latestBarAt: new Date("2026-06-18T00:00:00.000Z"),
      lastEvaluatedAt: new Date("2026-06-18T22:26:03.679Z"),
    },
    timeframe: "1d",
    evaluatedAt: new Date("2026-06-22T20:18:00.000Z"),
  });

  assert.equal(trace.current, false);
  assert.equal(trace.reason, "latest_bar_age_exceeds_policy_window");
  assert.equal(trace.completedBarsQueryTo, "2026-06-22T00:00:00.000Z");
  assert.equal(trace.latestBarStaleWindowMs, 4 * 24 * 60 * 60_000);
  assert.ok((trace.latestBarAgeMs ?? 0) > trace.latestBarStaleWindowMs);
});

test("price trace distinguishes current rows from stale stored status", () => {
  const current = traceSignalMonitorLaneCurrentness({
    state: {
      status: "ok",
      latestBarAt: new Date("2026-06-22T20:00:00.000Z"),
      lastEvaluatedAt: new Date("2026-06-22T20:18:00.000Z"),
    },
    timeframe: "1h",
    evaluatedAt: new Date("2026-06-22T20:18:00.000Z"),
  });
  const storedStale = traceSignalMonitorLaneCurrentness({
    state: {
      status: "stale",
      latestBarAt: new Date("2026-06-22T20:00:00.000Z"),
      lastEvaluatedAt: new Date("2026-06-22T20:18:00.000Z"),
    },
    timeframe: "1h",
    evaluatedAt: new Date("2026-06-22T20:18:00.000Z"),
  });

  assert.equal(current.current, true);
  assert.equal(current.reason, "current");
  assert.equal(storedStale.current, false);
  assert.equal(storedStale.reason, "stored_status_not_ok");
});

test("backfill cadence is slow and the concurrency budget is small and dedicated", () => {
  // The base is deep warmup history; the per-tick live edge supplies freshness,
  // so cadence is minutes-to-hours, not the 60s warmup tick.
  assert.ok(SIGNAL_MONITOR_BACKFILL_REFRESH_MS["1m"] >= 5 * 60_000);
  assert.ok(SIGNAL_MONITOR_BACKFILL_REFRESH_MS["2m"] >= 5 * 60_000);
  assert.ok(SIGNAL_MONITOR_BACKFILL_REFRESH_MS["5m"] >= 5 * 60_000);
  assert.ok(SIGNAL_MONITOR_BACKFILL_REFRESH_MS["15m"] >= 10 * 60_000);
  assert.ok(SIGNAL_MONITOR_BACKFILL_REFRESH_MS["1h"] >= 30 * 60_000);
  assert.ok(SIGNAL_MONITOR_BACKFILL_REFRESH_MS["1d"] >= 4 * 60 * 60_000);
  // Dedicated, small budget — never the full evaluation concurrency (10).
  assert.equal(SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT, 3);
});
