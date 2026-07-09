import assert from "node:assert/strict";
import test from "node:test";

import { __signalMonitorInternalsForTests } from "./signal-monitor";

// Minimal SignalMonitorBarSnapshot for merge tests (mirrors the helper used by
// signal-monitor-completed-bars.test.ts). `delayed`/`close` overrides let us
// assert live-edge-wins behavior on same-timestamp collisions.
const bar = (
  timestamp: string,
  overrides: Record<string, unknown> = {},
) =>
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
  refreshSignalMonitorBackfilledBaseBarsForTests,
  getSignalMonitorBackfillRefreshDiagnosticsForTests,
  resetSignalMonitorBackfillRefreshDiagnosticsForTests,
  selectSignalMonitorBackfillDueCells,
  shouldSkipSignalMonitorBackfillForPressure,
  shouldSkipSignalMonitorBackfillForQuietProducer,
  resetSignalMonitorMatrixStreamForTests,
  traceSignalMonitorLaneCurrentness,
  getSignalMonitorBackfilledBaseCacheStatsForTests,
  SIGNAL_MONITOR_BACKFILLED_BASE_MAX_CELLS,
  SIGNAL_MONITOR_BACKFILL_REFRESH_MS,
  SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT,
} = __signalMonitorInternalsForTests;

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

test("due-cell selection caps per cycle and refreshes the most-overdue first", () => {
  const nowMs = Date.parse("2026-06-12T15:00:00.000Z");
  const interval1m = SIGNAL_MONITOR_BACKFILL_REFRESH_MS["1m"];

  // Three cells with different staleness; cap of 2 must drop the freshest.
  const candidates = [
    // Most overdue (refreshed 4 intervals ago).
    { symbol: "AAA", timeframe: "1m" as const, refreshedAt: nowMs - interval1m * 4 },
    // Mid overdue (refreshed ~1.5 intervals ago).
    { symbol: "BBB", timeframe: "1m" as const, refreshedAt: nowMs - interval1m * 1.5 },
    // Not yet due (refreshed within the interval) -> excluded regardless of cap.
    { symbol: "CCC", timeframe: "1m" as const, refreshedAt: nowMs - interval1m * 0.25 },
  ];

  const selected = selectSignalMonitorBackfillDueCells({
    candidates,
    nowMs,
    maxCells: 2,
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

  assert.deepEqual(
    Array.from(grouped.entries()).map(([timeframe, symbols]) => [
      timeframe,
      symbols,
    ]),
    [
      ["1m", ["AAPL", "MSFT"]],
      ["1h", ["AAPL"]],
    ],
  );
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

  resetSignalMonitorMatrixStreamForTests();
});

test("pressure-high skips the backfill cycle; watch/normal keep running", () => {
  assert.equal(shouldSkipSignalMonitorBackfillForPressure("high"), true);
  assert.equal(shouldSkipSignalMonitorBackfillForPressure("watch"), false);
  assert.equal(shouldSkipSignalMonitorBackfillForPressure("normal"), false);
});

test("idle-session producer backfill skips when no aggregate can consume it", () => {
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
