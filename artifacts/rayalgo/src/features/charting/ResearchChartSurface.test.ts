import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChartLegendStudyItems,
  expandStudySpecsForRender,
  buildIndicatorDashboardStripSegments,
  buildVisibleRangeSignature,
  clampOverlayRectPosition,
  clampVisibleLogicalRangeToBarCount,
  clearStoredChartViewportSnapshot,
  isVisibleRangeNearRealtime,
  normalizeVisibleLogicalRange,
  readStoredChartViewportSnapshot,
  resolveAutoHydrationVisibleRange,
  resolveChartPlotPanRange,
  resolveChartPlotPanStart,
  resolveDashboardStripAnchorStyle,
  resolveDashboardStripTier,
  resolveEffectiveChartViewportSnapshot,
  resolveVisibleRangeChangeSource,
  resolveVisibleRangePublishDecision,
  resolveVisibleRangePublishState,
  resolveViewportRestoreState,
  resolveViewportVisibleLogicalRange,
  resolveSeriesTailUpdateMode,
  resolveZoomedVisibleRange,
  sanitizeStoredChartScalePrefs,
  shouldAutoFollowLatestBars,
  writeStoredChartViewportSnapshot,
  resolveVisibleRangeSyncAction,
} from "./ResearchChartSurface";

const dashboardFixture = {
  id: "dashboard-1",
  title: "RAYALGO DASHBOARD",
  subtitle: "Live confirmation",
  trendLabel: "15M TREND",
  trendValue: "BULLISH",
  trendColor: "#22c55e",
  rows: [
    { label: "STRENGTH", value: "Strong", color: "#ffffff" },
    { label: "TREND AGE", value: "NEW (3)", detail: "fresh" },
    { label: "VOLATILITY", value: "6/10" },
    { label: "SESSION", value: "RTH" },
  ],
  mtf: [
    { label: "H1", value: "BULL", color: "#22c55e" },
    { label: "H4", value: "BEAR", color: "#ef4444", detail: "filter" },
    { label: "D1", value: "BULL", color: "#22c55e" },
  ],
};

test("ResearchChartSurface clamps overlay rectangles inside the plot viewport", () => {
  assert.deepEqual(
    clampOverlayRectPosition({
      left: -12,
      top: 98,
      width: 24,
      height: 16,
      viewportWidth: 120,
      viewportHeight: 100,
    }),
    { left: 0, top: 84 },
  );

  assert.deepEqual(
    clampOverlayRectPosition({
      left: 96,
      top: -8,
      width: 40,
      height: 18,
      viewportWidth: 120,
      viewportHeight: 100,
    }),
    { left: 80, top: 0 },
  );
});

test("ResearchChartSurface flattens dashboard fields for one-line micro strips", () => {
  const segments = buildIndicatorDashboardStripSegments(
    dashboardFixture,
    "micro",
  );

  assert.deepEqual(
    segments.map(({ kind, label, value, detail }) => ({
      kind,
      label,
      value,
      detail,
    })),
    [
      { kind: "title", label: undefined, value: "RA", detail: undefined },
      { kind: "trend", label: "15m", value: "BULL", detail: undefined },
      { kind: "row", label: "", value: "RTH", detail: "" },
      { kind: "mtf", label: "1h", value: "B", detail: "" },
      { kind: "mtf", label: "4h", value: "S", detail: "" },
      { kind: "mtf", label: "1d", value: "B", detail: "" },
    ],
  );
});

test("ResearchChartSurface keeps fuller dashboard labels off the chart area", () => {
  const segments = buildIndicatorDashboardStripSegments({
    id: "dashboard-1",
    title: "RAYALGO DASHBOARD",
    subtitle: "Live confirmation",
    trendLabel: "15M TREND",
    trendValue: "BULLISH",
    trendColor: "#22c55e",
    rows: [
      { label: "STRENGTH", value: "STRONG", color: "#ffffff" },
      { label: "TREND AGE", value: "EARLY (3)", detail: "fresh" },
      { label: "VOLATILITY", value: "NORMAL" },
      { label: "SESSION", value: "RTH", detail: "Regular trading hours" },
    ],
    mtf: [
      { label: "1H", value: "BULL", color: "#22c55e" },
      { label: "4H", value: "BEAR", color: "#ef4444", detail: "filter" },
    ],
  }, "full");

  assert.deepEqual(
    segments.map(({ kind, label, value, detail }) => ({
      kind,
      label,
      value,
      detail,
    })),
    [
      {
        kind: "title",
        label: undefined,
        value: "RayAlgo",
        detail: undefined,
      },
      {
        kind: "trend",
        label: "15m",
        value: "BULL",
        detail: undefined,
      },
      {
        kind: "row",
        label: "",
        value: "STRONG",
        detail: "",
      },
      {
        kind: "row",
        label: "",
        value: "E3",
        detail: "",
      },
      {
        kind: "row",
        label: "",
        value: "NORMAL",
        detail: "",
      },
      {
        kind: "row",
        label: "",
        value: "RTH",
        detail: "",
      },
      { kind: "mtf", label: "1h", value: "B", detail: "" },
      { kind: "mtf", label: "4h", value: "S", detail: "filter" },
    ],
  );
  assert.deepEqual(resolveDashboardStripTier(340, true), "micro");
  assert.deepEqual(resolveDashboardStripTier(480, true), "compact");
  assert.deepEqual(resolveDashboardStripTier(700, true), "full");
  assert.deepEqual(resolveDashboardStripAnchorStyle(false, 22, 40), {
    left: 48,
    right: 8,
    bottom: 25,
  });
  assert.deepEqual(resolveDashboardStripAnchorStyle(true, 14, 28), {
    left: 32,
    right: 4,
    bottom: 16,
  });
});

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

test("ResearchChartSurface builds TradingView-style study legend items at the active bar", () => {
  const items = buildChartLegendStudyItems({
    time: 2,
    fallbackColor: "#ffffff",
    studies: [
      { id: "ema-21", label: "EMA 21" },
      { id: "rsi-14", label: "RSI" },
    ],
    selectedStudies: ["ema-21", "rsi-14"],
    studySpecs: [
      {
        key: "ema-21",
        seriesType: "line",
        paneIndex: 0,
        options: { color: "#60a5fa" },
        data: [
          { time: 1, value: 99 },
          { time: 2, value: 101.2345 },
        ],
      },
      {
        key: "rsi-14-guide-70",
        seriesType: "line",
        paneIndex: 1,
        options: { color: "#ef4444" },
        data: [{ time: 2, value: 70 }],
      },
      {
        key: "rsi-14",
        seriesType: "line",
        paneIndex: 1,
        options: {},
        data: [{ time: 2, value: 55.4321, color: "#22c55e" }],
      },
    ],
  });

  assert.deepEqual(items, [
    {
      id: "ema-21",
      label: "EMA 21",
      colors: ["#60a5fa"],
      values: [101.2345],
    },
    {
      id: "rsi-14",
      label: "RSI",
      colors: ["#22c55e"],
      values: [55.4321],
    },
  ]);
});

test("ResearchChartSurface keeps study legend labels when the active bar has no study value", () => {
  assert.deepEqual(
    buildChartLegendStudyItems({
      time: 3,
      fallbackColor: "#ffffff",
      studies: [{ id: "ema-21", label: "EMA 21" }],
      selectedStudies: ["ema-21"],
      studySpecs: [
        {
          key: "ema-21",
          seriesType: "line",
          paneIndex: 0,
          options: { color: "#60a5fa" },
          data: [{ time: 2, value: 101.2345 }],
        },
      ],
    }),
    [
      {
        id: "ema-21",
        label: "EMA 21",
        colors: ["#60a5fa"],
        values: [],
      },
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

test("ResearchChartSurface normalizes visible range publish state", () => {
  assert.deepEqual(
    normalizeVisibleLogicalRange({ from: 10.5, to: 42 }),
    { from: 10.5, to: 42 },
  );
  assert.equal(normalizeVisibleLogicalRange({ from: 10, to: Number.NaN }), null);
  assert.equal(normalizeVisibleLogicalRange(null), null);

  assert.deepEqual(
    resolveVisibleRangePublishState({
      range: { from: 90, to: 98 },
      barCount: 100,
    }),
    {
      visibleRange: { from: 90, to: 98 },
      realtimeFollow: true,
    },
  );
  assert.deepEqual(
    resolveVisibleRangePublishState({
      range: { from: 40, to: 70 },
      barCount: 100,
    }),
    {
      visibleRange: { from: 40, to: 70 },
      realtimeFollow: false,
    },
  );
  assert.deepEqual(
    resolveVisibleRangePublishState({
      range: { from: "bad", to: 70 },
      barCount: 100,
    }),
    {
      visibleRange: null,
      realtimeFollow: false,
    },
  );
  assert.deepEqual(
    resolveVisibleRangePublishState({
      range: { from: 96, to: 130 },
      barCount: 100,
      source: "user",
    }),
    {
      visibleRange: { from: 96, to: 130 },
      realtimeFollow: false,
    },
  );
});

test("ResearchChartSurface classifies initialized non-programmatic range changes as user intent", () => {
  assert.equal(
    resolveVisibleRangeChangeSource({
      initialized: true,
      nextSignature: "10:40",
      programmaticSignature: null,
      hasRecentProgrammaticIntent: false,
      hasRecentUserViewportIntent: false,
    }),
    "user",
  );
  assert.equal(
    resolveVisibleRangeChangeSource({
      initialized: true,
      nextSignature: "10:40",
      programmaticSignature: "10:40",
      hasRecentProgrammaticIntent: true,
      hasRecentUserViewportIntent: true,
    }),
    "user",
  );
  assert.equal(
    resolveVisibleRangeChangeSource({
      initialized: true,
      nextSignature: "10:40",
      programmaticSignature: "10:40",
      hasRecentProgrammaticIntent: false,
      hasRecentUserViewportIntent: true,
    }),
    "user",
  );
  assert.equal(
    resolveVisibleRangeChangeSource({
      initialized: true,
      nextSignature: "11:41",
      programmaticSignature: null,
      hasRecentProgrammaticIntent: true,
      hasRecentUserViewportIntent: false,
    }),
    "programmatic",
  );
});

test("ResearchChartSurface suppresses duplicate visible range publications", () => {
  assert.equal(buildVisibleRangeSignature({ from: 10.5, to: 42 }), "10.5:42");
  assert.equal(buildVisibleRangeSignature(null), "none");

  const firstPublish = resolveVisibleRangePublishDecision({
    lastSignature: null,
    visibleRange: { from: 12, to: 48 },
  });
  assert.deepEqual(firstPublish, {
    signature: "12:48",
    shouldPublish: true,
  });

  assert.deepEqual(
    resolveVisibleRangePublishDecision({
      lastSignature: firstPublish.signature,
      visibleRange: { from: 12, to: 48 },
    }),
    {
      signature: "12:48",
      shouldPublish: false,
    },
  );
  assert.deepEqual(
    resolveVisibleRangePublishDecision({
      lastSignature: firstPublish.signature,
      visibleRange: { from: 12, to: 49 },
    }),
    {
      signature: "12:49",
      shouldPublish: true,
    },
  );
});

test("ResearchChartSurface clamps stored visible ranges to available bars", () => {
  assert.deepEqual(
    clampVisibleLogicalRangeToBarCount({ from: -20, to: 120 }, 100),
    { from: 0, to: 99 },
  );
  assert.equal(
    clampVisibleLogicalRangeToBarCount({ from: 120, to: 150 }, 100),
    null,
  );
  assert.equal(
    clampVisibleLogicalRangeToBarCount({ from: Number.NaN, to: 10 }, 100),
    null,
  );
});

test("ResearchChartSurface preserves finite viewport ranges outside loaded bars", () => {
  assert.deepEqual(
    resolveViewportVisibleLogicalRange({ from: 80, to: 130 }),
    { from: 80, to: 130 },
  );
  assert.deepEqual(
    resolveViewportVisibleLogicalRange({ from: -30, to: 50 }),
    { from: -30, to: 50 },
  );
  assert.deepEqual(
    resolveViewportVisibleLogicalRange({ from: 50, to: -30 }),
    { from: -30, to: 50 },
  );
  assert.equal(
    resolveViewportVisibleLogicalRange({ from: Number.NaN, to: 50 }),
    null,
  );
});

test("ResearchChartSurface starts plot panning only for valid plot drags", () => {
  const start = resolveChartPlotPanStart({
    pointerId: 7,
    startX: 120,
    startY: 80,
    currentRange: { from: 20, to: 80 },
    plotWidth: 600,
    enabled: true,
    drawMode: null,
    button: 0,
    insidePlot: true,
    insideRightPriceScale: false,
  });

  assert.deepEqual(start, {
    pointerId: 7,
    startX: 120,
    startY: 80,
    startRange: { from: 20, to: 80 },
    plotWidth: 600,
    active: false,
  });

  assert.equal(
    resolveChartPlotPanStart({
      pointerId: 7,
      startX: 120,
      startY: 80,
      currentRange: { from: 20, to: 80 },
      plotWidth: 600,
      enabled: true,
      drawMode: "horizontal",
      button: 0,
      insidePlot: true,
      insideRightPriceScale: false,
    }),
    null,
  );
  assert.equal(
    resolveChartPlotPanStart({
      pointerId: 7,
      startX: 120,
      startY: 80,
      currentRange: { from: 20, to: 80 },
      plotWidth: 600,
      enabled: true,
      drawMode: null,
      button: 0,
      insidePlot: true,
      insideRightPriceScale: true,
    }),
    null,
  );
});

test("ResearchChartSurface converts plot drag distance into one logical range update", () => {
  const pan = resolveChartPlotPanStart({
    pointerId: 3,
    startX: 100,
    startY: 50,
    currentRange: { from: 20, to: 80 },
    plotWidth: 600,
    enabled: true,
    drawMode: null,
    button: 0,
    insidePlot: true,
    insideRightPriceScale: false,
  });

  assert.equal(
    resolveChartPlotPanRange({
      pan,
      clientX: 103,
      clientY: 50,
      moveTolerance: 6,
    }),
    null,
  );

  const next = resolveChartPlotPanRange({
    pan,
    clientX: 160,
    clientY: 50,
    moveTolerance: 6,
  });

  assert.deepEqual(next?.visibleRange, { from: 14, to: 74 });
  assert.equal(next?.pan.active, true);
});

test("ResearchChartSurface zooms around the current viewport center", () => {
  assert.deepEqual(
    resolveZoomedVisibleRange({
      currentRange: { from: 20, to: 80 },
      factor: 0.8,
    }),
    { from: 26, to: 74 },
  );
  assert.deepEqual(
    resolveZoomedVisibleRange({
      currentRange: { from: 20, to: 80 },
      factor: 1.25,
    }),
    { from: 12.5, to: 87.5 },
  );
  assert.deepEqual(
    resolveZoomedVisibleRange({
      currentRange: { from: 48, to: 50 },
      factor: 0.5,
    }),
    { from: 45, to: 53 },
  );
});

test("ResearchChartSurface restores matching user-touched viewport snapshots", () => {
  const snapshot = {
    identityKey: "market-grid-slot::0::SPY::15m",
    visibleLogicalRange: { from: 24, to: 84 },
    userTouched: true,
    realtimeFollow: false,
    scaleMode: "percentage",
    autoScale: false,
    invertScale: true,
    updatedAt: 1,
  } as const;

  assert.deepEqual(
    resolveViewportRestoreState({
      identityKey: "market-grid-slot::0::SPY::15m",
      viewportSnapshot: snapshot,
      storedScalePrefs: {
        scaleMode: "log",
        autoScale: true,
        invertScale: false,
      },
      defaultScaleMode: "linear",
      barCount: 100,
    }),
    {
      matchingSnapshot: snapshot,
      visibleLogicalRange: { from: 24, to: 84 },
      realtimeFollow: false,
      autoHydration: false,
      scaleMode: "percentage",
      autoScale: false,
      invertScale: true,
    },
  );
});

test("ResearchChartSurface keeps untouched viewport snapshots auto-hydrated while restoring scale state", () => {
  const snapshot = {
    identityKey: "market-grid-slot::1::QQQ::15m",
    visibleLogicalRange: { from: 10, to: 70 },
    userTouched: false,
    realtimeFollow: true,
    scaleMode: "indexed",
    autoScale: false,
    invertScale: true,
    updatedAt: 1,
  } as const;

  assert.deepEqual(
    resolveViewportRestoreState({
      identityKey: "market-grid-slot::1::QQQ::15m",
      viewportSnapshot: snapshot,
      storedScalePrefs: {
        scaleMode: "log",
        autoScale: true,
        invertScale: false,
      },
      defaultScaleMode: "linear",
      barCount: 100,
    }),
    {
      matchingSnapshot: snapshot,
      visibleLogicalRange: null,
      realtimeFollow: true,
      autoHydration: true,
      scaleMode: "indexed",
      autoScale: false,
      invertScale: true,
    },
  );
});

test("ResearchChartSurface restores future user-touched viewport ranges without dropping scale state", () => {
  const snapshot = {
    identityKey: "market-grid-slot::2::IWM::15m",
    visibleLogicalRange: { from: 140, to: 180 },
    userTouched: true,
    realtimeFollow: false,
    scaleMode: "log",
    autoScale: false,
    invertScale: false,
    updatedAt: 1,
  } as const;

  assert.deepEqual(
    resolveViewportRestoreState({
      identityKey: "market-grid-slot::2::IWM::15m",
      viewportSnapshot: snapshot,
      defaultScaleMode: "linear",
      barCount: 100,
    }),
    {
      matchingSnapshot: snapshot,
      visibleLogicalRange: { from: 140, to: 180 },
      realtimeFollow: false,
      autoHydration: false,
      scaleMode: "log",
      autoScale: false,
      invertScale: false,
    },
  );
});

test("ResearchChartSurface restores past user-touched viewport ranges without dropping scale state", () => {
  const snapshot = {
    identityKey: "market-grid-slot::3::DIA::15m",
    visibleLogicalRange: { from: -45, to: 30 },
    userTouched: true,
    realtimeFollow: false,
    scaleMode: "linear",
    autoScale: false,
    invertScale: false,
    updatedAt: 1,
  } as const;

  assert.deepEqual(
    resolveViewportRestoreState({
      identityKey: "market-grid-slot::3::DIA::15m",
      viewportSnapshot: snapshot,
      defaultScaleMode: "log",
      barCount: 100,
    }),
    {
      matchingSnapshot: snapshot,
      visibleLogicalRange: { from: -45, to: 30 },
      realtimeFollow: false,
      autoHydration: false,
      scaleMode: "linear",
      autoScale: false,
      invertScale: false,
    },
  );
});

test("ResearchChartSurface uses stored viewport snapshots as an uncontrolled fallback", () => {
  const identityKey = "chart-parity:core:primary:5m";
  const storedSnapshot = {
    identityKey,
    visibleLogicalRange: { from: 110, to: 170 },
    userTouched: true,
    realtimeFollow: false,
    scaleMode: "percentage",
    autoScale: false,
    invertScale: false,
    updatedAt: 1,
  } as const;

  clearStoredChartViewportSnapshot(identityKey);
  writeStoredChartViewportSnapshot(storedSnapshot);

  assert.deepEqual(readStoredChartViewportSnapshot(identityKey), storedSnapshot);
  assert.deepEqual(
    resolveEffectiveChartViewportSnapshot({
      identityKey,
      viewportSnapshot: null,
      useStoredFallback: true,
    }),
    storedSnapshot,
  );

  clearStoredChartViewportSnapshot(identityKey);
  assert.equal(readStoredChartViewportSnapshot(identityKey), null);
});

test("ResearchChartSurface lets controlled viewport snapshots win over stored fallback", () => {
  const identityKey = "chart-parity:core:secondary:5m";
  const storedSnapshot = {
    identityKey,
    visibleLogicalRange: { from: 110, to: 170 },
    userTouched: true,
    realtimeFollow: false,
    scaleMode: "percentage",
    autoScale: false,
    invertScale: false,
    updatedAt: 1,
  } as const;
  const controlledSnapshot = {
    identityKey,
    visibleLogicalRange: { from: -40, to: 20 },
    userTouched: true,
    realtimeFollow: false,
    scaleMode: "log",
    autoScale: true,
    invertScale: true,
    updatedAt: 2,
  } as const;

  clearStoredChartViewportSnapshot(identityKey);
  writeStoredChartViewportSnapshot(storedSnapshot);

  assert.deepEqual(
    resolveEffectiveChartViewportSnapshot({
      identityKey,
      viewportSnapshot: controlledSnapshot,
      useStoredFallback: true,
    }),
    controlledSnapshot,
  );
  assert.equal(
    resolveEffectiveChartViewportSnapshot({
      identityKey,
      viewportSnapshot: null,
      useStoredFallback: false,
    }),
    null,
  );

  clearStoredChartViewportSnapshot(identityKey);
});

test("ResearchChartSurface re-anchors auto hydration ranges to latest bars", () => {
  assert.deepEqual(
    resolveAutoHydrationVisibleRange({
      barCount: 900,
      defaultVisibleRange: { from: 0, to: 239 },
    }),
    { from: 660, to: 899 },
  );
  assert.deepEqual(
    resolveAutoHydrationVisibleRange({
      barCount: 120,
      defaultVisibleRange: { from: 0, to: 239 },
    }),
    { from: 0, to: 119 },
  );
  assert.equal(
    resolveAutoHydrationVisibleRange({
      barCount: 0,
      defaultVisibleRange: { from: 0, to: 239 },
    }),
    null,
  );
  assert.equal(
    resolveAutoHydrationVisibleRange({
      barCount: 900,
      defaultVisibleRange: { from: 20, to: 10 },
    }),
    null,
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
