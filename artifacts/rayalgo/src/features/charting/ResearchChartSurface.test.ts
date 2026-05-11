import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ChartEvent } from "./chartEvents";
import {
  buildChartLegendStudyItems,
  expandStudySpecsForRender,
  formatChartPriceAxisValue,
  buildIndicatorDashboardStripSegments,
  buildVisibleRangeSignature,
  clampOverlayRectPosition,
  clampVisibleLogicalRangeToBarCount,
  clearStoredChartViewportSnapshot,
  isOverlayAnchorVisibleOnAxis,
  isVisibleRangeNearRealtime,
  normalizeVisibleLogicalRange,
  RESEARCH_CHART_SURFACE_MODULE_VERSION,
  readStoredChartViewportSnapshot,
  resolveAutoHydrationVisibleRange,
  resolveChartPlotPanRange,
  resolveChartPlotPanStart,
  resolvePreferenceRightOffset,
  resolvePrependedVisibleLogicalRange,
  resolveDashboardStripAnchorStyle,
  resolveDashboardStripTier,
  resolveEffectiveChartViewportSnapshot,
  resolveSeriesTailUpdateResetReason,
  resolveVisibleRangeChangeSource,
  resolveVisibleRangePublishDecision,
  resolveVisibleRangePublishState,
  resolveVisibleChartEvents,
  resolveViewportRestoreState,
  resolveViewportVisibleLogicalRange,
  resolvePricePrecision,
  resolveSeriesTailUpdateMode,
  resolveZoomedVisibleRange,
  sanitizeStoredChartScalePrefs,
  shouldApplyProgrammaticRangeSync,
  shouldAutoFollowLatestBars,
  shouldPreserveUserViewportRange,
  writeStoredChartViewportSnapshot,
  resolveVisibleRangeSyncAction,
} from "./ResearchChartSurface";

const readResearchChartSurfaceSource = () =>
  readFileSync(new URL("./ResearchChartSurface.tsx", import.meta.url), "utf8");

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

const unusualFlowChartEvent: ChartEvent = {
  id: "flow:SPY:1",
  symbol: "SPY",
  eventType: "unusual_flow",
  time: "2026-05-01T14:30:00.000Z",
  placement: "bar",
  severity: "high",
  label: "CALL $950K",
  summary: "SPY 500 C unusual flow $950K",
  source: "flow",
  confidence: 0.8,
  bias: "bullish",
  actions: ["open_flow"],
  metadata: {},
};

test("ResearchChartSurface keeps flow chart events visible when execution markers are disabled", () => {
  assert.deepEqual(
    resolveVisibleChartEvents({
      chartEvents: [unusualFlowChartEvent],
      showExecutionMarkers: false,
    }),
    [unusualFlowChartEvent],
  );
});

test("ResearchChartSurface mounts the overlay layer for flow event overlays", () => {
  const source = readResearchChartSurfaceSource();
  const overlayLayerGate = source.match(
    /\{windowOverlays\.length \|\|[\s\S]*?\? \(\s*<div\s+data-testid=\{dataTestId \? `\$\{dataTestId\}-overlay-layer`/,
  )?.[0];

  assert.ok(overlayLayerGate, "overlay layer gate must be present");
  assert.match(overlayLayerGate, /flowVolumeOverlays\.length/);
  assert.match(overlayLayerGate, /chartEventOverlays\.length/);
});

test("ResearchChartSurface mounts position bubbles and mini off-pane indicators", () => {
  const source = readResearchChartSurfaceSource();
  const overlayLayerGate = source.match(
    /\{windowOverlays\.length \|\|[\s\S]*?\? \(\s*<div\s+data-testid=\{dataTestId \? `\$\{dataTestId\}-overlay-layer`/,
  )?.[0];

  assert.ok(overlayLayerGate, "overlay layer gate must be present");
  assert.match(overlayLayerGate, /positionBubbleOverlays\.length/);
  assert.match(overlayLayerGate, /positionOffPaneOverlays\.length/);
  assert.match(source, /dataTestId: `chart-position-pnl-\$\{bubble\.id\}`/);
  assert.match(source, /dataTestId: `chart-position-offpane-\$\{indicator\.id\}`/);
  assert.match(source, /resolvedPositionOverlays\.density === "mini"/);
});

test("ResearchChartSurface applies semantic colors to flow markers", () => {
  const source = readResearchChartSurfaceSource();
  const chartEventColorResolver = source.match(
    /const resolveChartEventToneColor = \([\s\S]*?\n};/,
  )?.[0];

  assert.match(source, /const resolveFlowToneColor = \(/);
  assert.match(source, /theme\.green : tone === "bearish" \? theme\.red : theme\.amber/);
  assert.ok(chartEventColorResolver, "chart event color resolver must be present");
  assert.match(chartEventColorResolver, /overlay\.eventType === "unusual_flow"/);
  assert.match(
    chartEventColorResolver,
    /return resolveFlowToneColor\(overlay\.tone, theme\);/,
  );
  assert.match(chartEventColorResolver, /return theme\.accent \|\| theme\.text;/);
  assert.match(source, /const toneColor = resolveFlowToneColor\(overlay\.tone, theme\);/);
  assert.match(source, /const segmentColor = resolveFlowToneColor\(segment\.tone, theme\);/);
  assert.match(source, /const color = resolveChartEventToneColor\(overlay, theme\);/);
  assert.match(source, /data-chart-flow-marker-tone=\{/);
  assert.match(source, /data-chart-flow-marker-basis=\{/);
  assert.match(source, /data-chart-flow-volume-basis=\{overlay\.flowSourceBasis\}/);
});

test("ResearchChartSurface supports tap-selected crosshair state", () => {
  const source = readResearchChartSurfaceSource();

  assert.match(source, /const \[tapSelectedBar, setTapSelectedBar\]/);
  assert.match(source, /tapSelectedBarRef\.current/);
  assert.match(source, /chart\.setCrosshairPosition\?\./);
  assert.match(source, /chart\.clearCrosshairPosition\?\./);
  assert.match(source, /tapSelectedBar \|\|\s*hoverBar/);
});

test("ResearchChartSurface exposes basis-aware flow diagnostics", () => {
  const source = readResearchChartSurfaceSource();

  assert.match(source, /data-chart-flow-confirmed-event-count=\{/);
  assert.match(source, /data-chart-flow-snapshot-event-count=\{/);
  assert.match(source, /data-chart-flow-bucketed-confirmed-event-count=\{/);
  assert.match(source, /data-chart-flow-bucketed-snapshot-event-count=\{/);
});

test("ResearchChartSurface colors flat candles and volume neutral", () => {
  const source = readResearchChartSurfaceSource();

  assert.match(source, /bar\.color \?\? \(bar\.c === bar\.o \? theme\.textMuted : undefined\)/);
  assert.match(source, /bar\.wickColor \?\? \(bar\.c === bar\.o \? theme\.textMuted : undefined\)/);
  assert.match(source, /bar\.c > bar\.o/);
  assert.match(source, /bar\.c < bar\.o/);
  assert.match(source, /withAlpha\(theme\.textMuted, "55"\)/);
});

test("ResearchChartSurface renders compact enriched flow tooltips", () => {
  const source = readResearchChartSurfaceSource();

  assert.match(source, /const FLOW_TOOLTIP_WIDTH = 248;/);
  assert.match(source, /const FLOW_TOOLTIP_ESTIMATED_HEIGHT = 232;/);
  assert.match(source, /const FLOW_TOOLTIP_HIDE_DELAY_MS = 120;/);
  assert.match(source, /const buildFlowTooltipStatCells = \(/);
  assert.match(source, /const FLOW_TOOLTIP_SCALAR_KEYS:/);
  assert.match(source, /const scheduleHideFlowTooltip = useCallback\(/);
  assert.match(source, /onPointerLeave=\{scheduleCurrentFlowTooltipHide\}/);
  assert.match(source, /data-chart-flow-tooltip-compact="true"/);
  assert.match(source, /onPointerEnter=\{clearFlowTooltipHideTimer\}/);
  assert.match(source, /onPointerLeave=\{\(\) => scheduleHideFlowTooltip\(flowTooltip\.id\)\}/);
  assert.match(source, /data-chart-flow-tooltip-contract="true"/);
  assert.match(source, /data-chart-flow-tooltip-mix-strip="true"/);
  assert.match(source, /data-chart-flow-tooltip-stat-grid="true"/);
  assert.match(source, /maxHeight:\s*"calc\(100% - 16px\)"/);
  assert.match(source, /<Copy size=\{11\} strokeWidth=\{1\.8\} \/>/);
  assert.doesNotMatch(source, /width:\s*280/);
  assert.doesNotMatch(source, /plotSize\.width - 292/);
});

test("ResearchChartSurface removes stale diagonal closed-market visuals", () => {
  const source = readResearchChartSurfaceSource();

  assert.match(source, /const effectiveShowGrid = showGrid;/);
  assert.match(source, /showGrid:\s*effectiveShowGrid/);
  assert.match(source, /visible:\s*effectiveShowGrid/);
  assert.doesNotMatch(source, /closedMarketVisualsEnabled/);
  assert.doesNotMatch(source, /market-closed-overlay/);
  assert.doesNotMatch(source, /repeating-linear-gradient/);
});

test("ResearchChartSurface renders extended-hours session windows from chart bars", () => {
  const source = readResearchChartSurfaceSource();

  assert.match(source, /buildUsEquityExtendedSessionWindows/);
  assert.match(source, /userPreferences\.chart\.extendedHours/);
  assert.match(source, /data-chart-extended-session-window-count=\{extendedSessionWindows\.length\}/);
  assert.match(source, /marketSessionKey === "after"/);
});

test("ResearchChartSurface publishes controlled viewport after prepending older bars", () => {
  const source = readResearchChartSurfaceSource();
  const prependAdjustment = source.match(
    /const prependCount = model\.chartBars\.findIndex\([\s\S]*?setOverlayRevision\(\(value\) => value \+ 1\);/,
  )?.[0];

  assert.ok(prependAdjustment, "prepend adjustment effect must be present");
  assert.match(prependAdjustment, /adjustedVisibleRange/);
  assert.match(prependAdjustment, /visibleRangeChangeRef\.current\?\./);
  assert.match(prependAdjustment, /publishViewportSnapshot/);
});

test("ResearchChartSurface preserves viewport while filling left whitespace after prepends", () => {
  assert.deepEqual(
    resolvePrependedVisibleLogicalRange({
      visibleRange: { from: 10, to: 110 },
      prependCount: 50,
    }),
    { from: 60, to: 160 },
  );
  assert.deepEqual(
    resolvePrependedVisibleLogicalRange({
      visibleRange: { from: -10, to: 90 },
      prependCount: 50,
    }),
    { from: 40, to: 140 },
  );
  assert.deepEqual(
    resolvePrependedVisibleLogicalRange({
      visibleRange: { from: -80, to: 20 },
      prependCount: 50,
    }),
    { from: -30, to: 70 },
  );
});

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

test("ResearchChartSurface drops event anchors that are fully outside the plot axis", () => {
  assert.equal(isOverlayAnchorVisibleOnAxis(-13, 12, 320), false);
  assert.equal(isOverlayAnchorVisibleOnAxis(-12, 12, 320), true);
  assert.equal(isOverlayAnchorVisibleOnAxis(332, 12, 320), true);
  assert.equal(isOverlayAnchorVisibleOnAxis(333, 12, 320), false);
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

test("ResearchChartSurface treats batched newer points as a tail append", () => {
  const previous = [
    { time: 1, value: 100 },
    { time: 2, value: 101 },
  ];
  const next = [
    { time: 1, value: 100 },
    { time: 2, value: 101 },
    { time: 3, value: 102 },
    { time: 4, value: 103 },
  ];

  assert.equal(resolveSeriesTailUpdateMode(previous, next), "append");
});

test("ResearchChartSurface appends when the current tail is patched first", () => {
  const previous = [
    { time: 1, value: 100 },
    { time: 2, value: 101 },
  ];
  const next = [
    { time: 1, value: 100 },
    { time: 2, value: 101.25 },
    { time: 3, value: 102 },
  ];

  assert.equal(resolveSeriesTailUpdateMode(previous, next), "append");
});

test("ResearchChartSurface resets batched data when an interior point changes", () => {
  const previous = [
    { time: 1, value: 100 },
    { time: 2, value: 101 },
  ];
  const next = [
    { time: 1, value: 99.75 },
    { time: 2, value: 101 },
    { time: 3, value: 102 },
  ];

  assert.equal(resolveSeriesTailUpdateMode(previous, next), "reset");
  assert.equal(
    resolveSeriesTailUpdateResetReason(previous, next),
    "interior-point-changed",
  );
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
  assert.equal(
    resolveSeriesTailUpdateResetReason(previous, next),
    "time-sequence-changed",
  );
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

test("ResearchChartSurface trims unused trailing zeroes from chart price labels", () => {
  assert.equal(formatChartPriceAxisValue(100, 4), "100.00");
  assert.equal(formatChartPriceAxisValue(100.5, 4), "100.50");
  assert.equal(formatChartPriceAxisValue(100.25, 4), "100.25");
  assert.equal(formatChartPriceAxisValue(100.1234, 4), "100.1234");
  assert.equal(formatChartPriceAxisValue(-0.00001, 4), "0.00");
  assert.equal(formatChartPriceAxisValue(Number.NaN, 4), "—");
});

test("ResearchChartSurface bases axis precision on rendered OHLC prices", () => {
  const bars = [
    {
      time: 1,
      ts: "2026-05-06T13:30:00.000Z",
      date: "2026-05-06",
      o: 100,
      h: 101.5,
      l: 99.25,
      c: 100,
      v: 120_000,
      vwap: 100.1234,
      sessionVwap: 100.9876,
    },
  ];
  const fractionalBars = [
    {
      ...bars[0],
      o: 0.1234,
      h: 0.125,
      l: 0.12,
      c: 0.123,
    },
  ];

  assert.equal(resolvePricePrecision(bars), 2);
  assert.equal(resolvePricePrecision(fractionalBars), 4);
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

test("ResearchChartSurface requires explicit viewport input for user-touched ranges", () => {
  assert.equal(
    resolveVisibleRangeChangeSource({
      initialized: true,
      nextSignature: "10:40",
      programmaticSignature: null,
      hasRecentProgrammaticIntent: false,
      hasRecentUserViewportIntent: false,
    }),
    "programmatic",
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

test("ResearchChartSurface preserves user-panned ranges from delayed programmatic snaps", () => {
  assert.equal(
    shouldPreserveUserViewportRange({
      source: "programmatic",
      activeUserTouchedViewport: true,
      hasRecentProgrammaticIntent: false,
      currentUserRange: { from: 20, to: 70 },
      nextRange: { from: 50, to: 100 },
    }),
    true,
  );
  assert.equal(
    shouldPreserveUserViewportRange({
      source: "programmatic",
      activeUserTouchedViewport: true,
      hasRecentProgrammaticIntent: true,
      currentUserRange: { from: 20, to: 70 },
      nextRange: { from: 50, to: 100 },
    }),
    false,
  );
  assert.equal(
    shouldPreserveUserViewportRange({
      source: "user",
      activeUserTouchedViewport: true,
      hasRecentProgrammaticIntent: false,
      currentUserRange: { from: 20, to: 70 },
      nextRange: { from: 50, to: 100 },
    }),
    false,
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

test("ResearchChartSurface clamps future-axis right offset preferences", () => {
  assert.equal(resolvePreferenceRightOffset(0, false), 0);
  assert.equal(resolvePreferenceRightOffset(4, false), 4);
  assert.equal(resolvePreferenceRightOffset(200, false), 6);
  assert.equal(resolvePreferenceRightOffset(6, true), 4);
  assert.equal(resolvePreferenceRightOffset(Number.NaN, false), 0);
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

test("ResearchChartSurface treats user-touched snapshots as realtime-follow opt-outs", () => {
  const snapshot = {
    identityKey: "market-grid-slot::0::NVDA::15m",
    visibleLogicalRange: { from: 92, to: 119 },
    userTouched: true,
    realtimeFollow: true,
    scaleMode: "linear",
    autoScale: true,
    invertScale: false,
    updatedAt: 1,
  } as const;

  assert.deepEqual(
    resolveViewportRestoreState({
      identityKey: "market-grid-slot::0::NVDA::15m",
      viewportSnapshot: snapshot,
      defaultScaleMode: "log",
      barCount: 120,
    }),
    {
      matchingSnapshot: snapshot,
      visibleLogicalRange: { from: 92, to: 119 },
      realtimeFollow: false,
      autoHydration: false,
      scaleMode: "linear",
      autoScale: true,
      invertScale: false,
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

test("ResearchChartSurface scopes stored viewport ranges by layout context", () => {
  const identityKey = "chart-parity:market:SPY:15m";
  const layoutSnapshot = {
    identityKey,
    viewportLayoutKey: "market-grid:2x3:slot-0:3x2:rev-0",
    visibleLogicalRange: { from: 20, to: 80 },
    userTouched: true,
    realtimeFollow: false,
    scaleMode: "linear",
    autoScale: true,
    invertScale: false,
    updatedAt: 1,
  } as const;

  clearStoredChartViewportSnapshot(identityKey);
  writeStoredChartViewportSnapshot(layoutSnapshot);

  assert.deepEqual(
    readStoredChartViewportSnapshot(identityKey, layoutSnapshot.viewportLayoutKey),
    layoutSnapshot,
  );
  assert.equal(readStoredChartViewportSnapshot(identityKey), null);
  assert.equal(
    readStoredChartViewportSnapshot(
      identityKey,
      "market-grid:3x3:slot-0:3x3:rev-0",
    ),
    null,
  );
  assert.equal(
    resolveEffectiveChartViewportSnapshot({
      identityKey,
      viewportLayoutKey: "market-grid:3x3:slot-0:3x3:rev-0",
      viewportSnapshot: null,
      useStoredFallback: true,
    }),
    null,
  );

  clearStoredChartViewportSnapshot(identityKey);
  assert.equal(
    readStoredChartViewportSnapshot(identityKey, layoutSnapshot.viewportLayoutKey),
    null,
  );
});

test("ResearchChartSurface resets user-touched ranges when the layout context changes", () => {
  const snapshot = {
    identityKey: "chart-parity:market:NVDA:15m",
    viewportLayoutKey: "market-grid:2x3:slot-0:3x2:rev-0",
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
      identityKey: snapshot.identityKey,
      viewportLayoutKey: "market-grid:3x3:slot-0:3x3:rev-0",
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
      matchingSnapshot: null,
      visibleLogicalRange: null,
      realtimeFollow: true,
      autoHydration: true,
      scaleMode: "log",
      autoScale: true,
      invertScale: false,
    },
  );
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

test("ResearchChartSurface defers programmatic range sync during active user gestures", () => {
  assert.equal(
    shouldApplyProgrammaticRangeSync({
      interactionActive: false,
      realtimeFollow: false,
      followLatestBars: false,
    }),
    true,
  );
  assert.equal(
    shouldApplyProgrammaticRangeSync({
      interactionActive: true,
      realtimeFollow: false,
      followLatestBars: false,
    }),
    false,
  );
  assert.equal(
    shouldApplyProgrammaticRangeSync({
      interactionActive: true,
      realtimeFollow: true,
      followLatestBars: true,
    }),
    false,
  );
  assert.equal(
    shouldApplyProgrammaticRangeSync({
      interactionActive: true,
      realtimeFollow: true,
      followLatestBars: false,
    }),
    false,
  );
});

test("ResearchChartSurface restores viewport ranges after full resets and user-touched live syncs", () => {
  const source = readResearchChartSurfaceSource();

  assert.match(source, /let seriesFullResetDuringSync = false;/);
  assert.match(source, /const shouldRestoreRangeAfterFullReset = Boolean/);
  assert.match(source, /userViewportTouched &&\s*!seriesFullResetDuringSync/);
  assert.match(source, /canApplyProgrammaticRangeSync && shouldRestoreRangeAfterFullReset/);
  assert.doesNotMatch(
    source,
    /canApplyProgrammaticRangeSync &&\s*initializedRangeRef\.current &&\s*visibleRangeBeforeDataSync &&/,
  );
});

test("ResearchChartSurface exposes live render diagnostics for viewport and flow", () => {
  const source = readResearchChartSurfaceSource();

  assert.equal(
    RESEARCH_CHART_SURFACE_MODULE_VERSION,
    "ResearchChartSurface@20260508-flow-normalized-v1",
  );
  assert.match(source, /data-chart-surface-module-version=\{RESEARCH_CHART_SURFACE_MODULE_VERSION\}/);
  assert.match(source, /data-chart-surface-module-source="ResearchChartSurface\.tsx"/);
  assert.match(source, /data-chart-flow-events-count=\{flowChartEventCount\}/);
  assert.match(source, /data-chart-flow-raw-input-count=\{rawFlowInputCount\}/);
  assert.match(source, /data-chart-flow-converted-count=\{convertedFlowEventCount\}/);
  assert.match(source, /data-chart-flow-bucket-count=\{flowChartBuckets\.length\}/);
  assert.match(source, /data-chart-flow-unique-event-count=\{uniqueFlowEventCount\}/);
  assert.match(source, /data-chart-flow-duplicate-drop-count=\{duplicateFlowEventDropCount\}/);
  assert.match(source, /data-chart-flow-hydration-state=\{chartFlowHydrationState\}/);
  assert.match(source, /data-chart-flow-bucketed-event-count=/);
  assert.match(source, /data-chart-flow-marker-count=\{renderedFlowMarkerCount\}/);
  assert.match(source, /data-chart-flow-invalid-time-drop-count=/);
  assert.match(source, /data-chart-flow-symbol-drop-count=\{conversionSymbolDropCount\}/);
  assert.match(source, /data-chart-flow-outside-bar-drop-count=/);
  assert.match(source, /summarizeFlowChartBucketPlacement/);
  assert.match(source, /data-chart-extended-session-enabled=/);
  assert.match(source, /data-chart-instance-create-count=\{surfaceDiagnostics\.chartInstanceCreates\}/);
  assert.match(source, /data-chart-series-full-reset-count=\{surfaceDiagnostics\.seriesFullResets\}/);
  assert.match(source, /data-chart-series-last-reset-reason=/);
  assert.match(source, /data-chart-latest-quote-age-ms=/);
  assert.match(source, /data-chart-watchlist-price-delta=/);
  assert.match(source, /data-chart-marker-set-count=\{surfaceDiagnostics\.markerSetCalls\}/);
  assert.match(source, /data-chart-viewport-user-range-preserve-count=/);
  assert.match(source, /visibleRangeUserPreserved/);
  assert.match(source, /visibleRangeRealtimeFollow/);
});

test("ResearchChartSurface skips marker redraws when the marker payload is unchanged", () => {
  const source = readResearchChartSurfaceSource();

  assert.match(source, /const markerSignatureRef = useRef<string \| null>\(null\);/);
  assert.match(source, /const markerSignature = JSON\.stringify\(markers\);/);
  assert.match(source, /markerSignatureRef\.current === markerSignature/);
  assert.match(source, /markerApi\.setMarkers\(markers\)/);
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
