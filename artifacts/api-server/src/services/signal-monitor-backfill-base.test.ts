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
  selectSignalMonitorBackfillDueCells,
  shouldSkipSignalMonitorBackfillForPressure,
  SIGNAL_MONITOR_BACKFILL_REFRESH_MS,
  SIGNAL_MONITOR_BACKFILL_MAX_CELLS_PER_CYCLE,
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

test("never-refreshed cells are maximally overdue but still cap-bounded (no thundering herd)", () => {
  const nowMs = Date.parse("2026-06-12T15:00:00.000Z");
  // Cold start: simulate the whole universe with no prior base (refreshedAt null),
  // far more than the cap. Only the cap is refreshed this cycle; the rest are
  // picked up on later cycles.
  const candidates = Array.from({ length: 500 }, (_unused, index) => ({
    symbol: `S${index}`,
    timeframe: "1m" as const,
    refreshedAt: null,
  }));

  const selected = selectSignalMonitorBackfillDueCells({
    candidates,
    nowMs,
    maxCells: SIGNAL_MONITOR_BACKFILL_MAX_CELLS_PER_CYCLE,
  });

  assert.equal(selected.length, SIGNAL_MONITOR_BACKFILL_MAX_CELLS_PER_CYCLE);
  assert.ok(selected.length < candidates.length);
});

test("pressure-high skips the backfill cycle; watch/normal keep running", () => {
  assert.equal(shouldSkipSignalMonitorBackfillForPressure("high"), true);
  assert.equal(shouldSkipSignalMonitorBackfillForPressure("watch"), false);
  assert.equal(shouldSkipSignalMonitorBackfillForPressure("normal"), false);
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
