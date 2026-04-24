import assert from "node:assert/strict";
import test from "node:test";
import {
  expandStudySpecsForRender,
  isVisibleRangeNearRealtime,
  resolveSeriesTailUpdateMode,
  sanitizeStoredChartScalePrefs,
  shouldAutoFollowLatestBars,
  resolveVisibleRangeSyncAction,
} from "./ResearchChartSurface";

test("ResearchChartSurface resets same-length study data when an interior point turns into whitespace", () => {
  const previous = [
    { time: 1, value: 100 },
    { time: 2, value: 99.5 },
    { time: 3, value: 99 },
  ];
  const next = [
    { time: 1, value: 100 },
    { time: 2 },
    { time: 3, value: 99 },
  ];

  assert.equal(resolveSeriesTailUpdateMode(previous, next), "reset");
});

test("ResearchChartSurface still uses a tail patch when only the last point changes", () => {
  const previous = [
    { time: 1, value: 100 },
    { time: 2, value: 99.5 },
  ];
  const next = [
    { time: 1, value: 100 },
    { time: 2, value: 99.25 },
  ];

  assert.equal(resolveSeriesTailUpdateMode(previous, next), "patch");
});

test("ResearchChartSurface patches object-shaped tail times when logically equal", () => {
  const previous = [
    { time: { year: 2026, month: 4, day: 23 }, value: 100 },
    { time: { year: 2026, month: 4, day: 24 }, value: 101 },
  ];
  const next = [
    { time: { year: 2026, month: 4, day: 23 }, value: 100 },
    { time: { year: 2026, month: 4, day: 24 }, value: 101.5 },
  ];

  assert.equal(resolveSeriesTailUpdateMode(previous, next), "patch");
});

test("ResearchChartSurface appends only newer object-shaped times", () => {
  const previous = [
    { time: { year: 2026, month: 4, day: 23 }, value: 100 },
  ];
  const newer = [
    { time: { year: 2026, month: 4, day: 23 }, value: 100 },
    { time: { year: 2026, month: 4, day: 24 }, value: 101 },
  ];
  const older = [
    { time: { year: 2026, month: 4, day: 23 }, value: 100 },
    { time: { year: 2026, month: 4, day: 22 }, value: 99 },
  ];

  assert.equal(resolveSeriesTailUpdateMode(previous, newer), "append");
  assert.equal(resolveSeriesTailUpdateMode(previous, older), "reset");
});

test("ResearchChartSurface resets when interval changes replace object-shaped times", () => {
  const previous = [
    { time: { year: 2026, month: 4, day: 23 }, value: 100 },
    { time: { year: 2026, month: 4, day: 24 }, value: 101 },
  ];
  const next = [
    { time: { year: 2026, month: 4, day: 21 }, value: 98 },
    { time: { year: 2026, month: 4, day: 22 }, value: 99 },
  ];

  assert.equal(resolveSeriesTailUpdateMode(previous, next), "reset");
});

test("ResearchChartSurface expands line-break studies into isolated contiguous segments", () => {
  const expanded = expandStudySpecsForRender([
    {
      key: "rayreplica-bull-main",
      seriesType: "line",
      paneIndex: 0,
      renderMode: "line_breaks",
      options: {},
      data: [
        { time: 1, value: 100 },
        { time: 2, value: 101 },
        { time: 3 },
        { time: 4, value: 98 },
      ],
    },
  ]);

  assert.deepEqual(
    expanded.map((spec) => spec.key),
    [
      "rayreplica-bull-main::segment:0",
      "rayreplica-bull-main::segment:1",
    ],
  );
  assert.deepEqual(
    expanded.map((spec) => spec.data),
    [
      [
        { time: 1, value: 100 },
        { time: 2, value: 101 },
      ],
      [{ time: 4, value: 98 }],
    ],
  );
});

test("ResearchChartSurface skips visible-range reapply when already initialized and no stored-range sync is pending", () => {
  assert.equal(
    resolveVisibleRangeSyncAction({
      hasStoredRange: true,
      hasDefaultRange: true,
      initialized: true,
      pendingStoredRangeSync: false,
    }),
    "noop",
  );
});

test("ResearchChartSurface reapplies the stored visible range when a prepend sync is pending", () => {
  assert.equal(
    resolveVisibleRangeSyncAction({
      hasStoredRange: true,
      hasDefaultRange: true,
      initialized: true,
      pendingStoredRangeSync: true,
    }),
    "stored",
  );
});

test("ResearchChartSurface detects whether the visible range is near realtime", () => {
  assert.equal(
    isVisibleRangeNearRealtime({
      visibleRange: { from: 90, to: 98 },
      barCount: 100,
    }),
    true,
  );
  assert.equal(
    isVisibleRangeNearRealtime({
      visibleRange: { from: 40, to: 70 },
      barCount: 100,
    }),
    false,
  );
});

test("ResearchChartSurface only follows latest bars while realtime follow is active and near the tail", () => {
  assert.equal(
    shouldAutoFollowLatestBars({
      realtimeFollow: true,
      visibleRange: { from: 90, to: 98 },
      previousBarCount: 100,
      nextBarCount: 101,
    }),
    true,
  );
  assert.equal(
    shouldAutoFollowLatestBars({
      realtimeFollow: false,
      visibleRange: { from: 90, to: 98 },
      previousBarCount: 100,
      nextBarCount: 101,
    }),
    false,
  );
  assert.equal(
    shouldAutoFollowLatestBars({
      realtimeFollow: true,
      visibleRange: { from: 40, to: 70 },
      previousBarCount: 100,
      nextBarCount: 101,
    }),
    false,
  );
});

test("ResearchChartSurface sanitizes stored scale preferences", () => {
  assert.deepEqual(
    sanitizeStoredChartScalePrefs({
      scaleMode: "indexed",
      autoScale: false,
      invertScale: true,
      ignored: "value",
    }),
    {
      scaleMode: "indexed",
      autoScale: false,
      invertScale: true,
    },
  );
  assert.deepEqual(
    sanitizeStoredChartScalePrefs({
      scaleMode: "bad",
      autoScale: "yes",
      invertScale: 1,
    }),
    {},
  );
});
