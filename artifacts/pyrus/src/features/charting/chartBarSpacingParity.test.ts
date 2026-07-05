import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  estimateBarOverlayWidth,
  getChartBarSpacing,
  resolveGuardedAutoHydrationProgrammaticRange,
  resolveBarSpacing,
  resolveFootprintCandleWidth,
} from "./ResearchChartSurface";

const surfaceSource = readFileSync(
  new URL("./ResearchChartSurface.tsx", import.meta.url),
  "utf8",
);
const pyrusSignalsPineAdapterSource = readFileSync(
  new URL("./pyrusSignalsPineAdapter.ts", import.meta.url),
  "utf8",
);

// Minimal chart stub exposing the canonical lightweight-charts bar spacing (the
// single pixels-per-bar value candles render from).
const chartWith = (barSpacing: unknown) =>
  ({
    timeScale: () => ({
      options: () => ({ barSpacing }),
      timeToCoordinate: () => null,
    }),
  }) as never;

// Chart stub with no usable lib bar spacing, forcing the measured
// (timeToCoordinate) fallback path.
const chartFallback = (coordByTime: Record<number, number>) =>
  ({
    timeScale: () => ({
      options: () => ({ barSpacing: 0 }),
      timeToCoordinate: (time: number) => coordByTime[time] ?? null,
    }),
  }) as never;

test("getChartBarSpacing reads the lib bar spacing and guards non-positive", () => {
  assert.equal(getChartBarSpacing(chartWith(12)), 12);
  assert.equal(getChartBarSpacing(chartWith(0)), null);
  assert.equal(getChartBarSpacing(chartWith(undefined)), null);
  assert.equal(getChartBarSpacing(chartWith(Number.NaN)), null);
});

test("overlay/shading widths derive from the canonical bar spacing", () => {
  const chart = chartWith(10);
  assert.equal(resolveBarSpacing(chart, { chartBars: [] } as never), 10);
  // flow overlay width = barSpacing * 0.62 within clamp [3,14]
  assert.equal(estimateBarOverlayWidth(chart, [] as never, 0), 10 * 0.62);
  // footprint cell width = barSpacing * 0.84 within clamp [28,72] (8.4 -> 28)
  assert.equal(resolveFootprintCandleWidth(chart, [] as never, 0), 28);
});

test("widths scale in lock-step with the chart's bar spacing (parity)", () => {
  assert.equal(estimateBarOverlayWidth(chartWith(10), [] as never, 0), 6.2);
  assert.equal(estimateBarOverlayWidth(chartWith(20), [] as never, 0), 12.4);
  assert.equal(resolveFootprintCandleWidth(chartWith(40), [] as never, 0), 33.6);
  assert.equal(resolveFootprintCandleWidth(chartWith(60), [] as never, 0), 50.4);
});

test("legibility clamps still bound the derived widths", () => {
  assert.equal(estimateBarOverlayWidth(chartWith(2), [] as never, 0), 3); // floor
  assert.equal(estimateBarOverlayWidth(chartWith(40), [] as never, 0), 14); // ceil
  assert.equal(resolveFootprintCandleWidth(chartWith(4), [] as never, 0), 28); // floor
  assert.equal(resolveFootprintCandleWidth(chartWith(120), [] as never, 0), 72); // ceil
  assert.equal(resolveBarSpacing(chartWith(1), { chartBars: [] } as never), 2); // floor
});

test("falls back to the measured spacing when the lib value is unavailable", () => {
  const model = { chartBars: [{ time: 0 }, { time: 1 }, { time: 2 }] } as never;
  const chart = chartFallback({ 0: 0, 1: 8, 2: 16 });
  assert.equal(resolveBarSpacing(chart, model), 8);
});

test("chart scale preferences use the current storage key directly", () => {
  assert.doesNotMatch(surfaceSource, /LEGACY_CHART_SCALE_PREFS_STORAGE_PREFIX/);
  assert.doesNotMatch(surfaceSource, /buildLegacyChartScalePrefsStorageKey/);
  assert.match(
    surfaceSource,
    /const raw = window\.localStorage\.getItem\(storageKey\);/,
  );
});

test("right-labeled Pyrus line overlays share chart viewport width", () => {
  assert.match(
    surfaceSource,
    /const lineReachesViewportRight =\s*style === "line-overlay" && resolvedLabelPosition === "right";/,
  );
  assert.match(
    surfaceSource,
    /const lineRight = lineReachesViewportRight \? viewportWidth : right;/,
  );
  assert.match(
    surfaceSource,
    /const xSpan = clipSpanToViewport\(left, lineRight, viewportWidth, 2\);/,
  );
  assert.match(
    surfaceSource,
    /right:\s*overlay\.labelPosition === "right"\s*\?\s*Math\.max\(4, overlay\.labelOffsetX \?\? 4\)/,
  );
  assert.doesNotMatch(
    pyrusSignalsPineAdapterSource,
    /extendBars:\s*labelOffsetBars/,
  );
});

test("plot/root sizing is measured in zoom-invariant layout space", () => {
  // CSS `zoom < 1` (PlatformShell screenFitZoom below the design width) makes
  // getBoundingClientRect() report post-zoom (visual) sizes, while the chart-space
  // overlay layer and lightweight-charts coordinate API work in layout (pre-zoom)
  // px. Measuring plotSize/rootWidth via getBoundingClientRect double-applied the
  // zoom and clipped overlays at the right/bottom. offsetWidth/offsetHeight are
  // zoom-invariant, so the measurement must use them.
  assert.match(surfaceSource, /setRootWidth\(rootElement\.offsetWidth\);/);
  assert.match(surfaceSource, /const nextWidth = plotElement\.offsetWidth;/);
  assert.match(surfaceSource, /const nextHeight = plotElement\.offsetHeight;/);
  assert.match(surfaceSource, /setter\(element\.offsetHeight\);/);
  // Guard against the regressed getBoundingClientRect()-based plot/root sizing.
  assert.doesNotMatch(
    surfaceSource,
    /setRootWidth\(Math\.ceil\(rootElement\.getBoundingClientRect\(\)\.width\)\)/,
  );
  assert.doesNotMatch(
    surfaceSource,
    /const rect = plotElement\.getBoundingClientRect\(\);/,
  );
});

test("right price scale updates use the default pane", () => {
  assert.doesNotMatch(
    surfaceSource,
    /priceScale\("right",\s*0\)/,
  );
  assert.match(surfaceSource, /priceScale\("right"\)\.setAutoScale/);
  assert.match(surfaceSource, /priceScale\("right"\)\.applyOptions/);
});

test("auto-hydration guards stale programmatic logical ranges after interval changes", () => {
  const currentRange = { from: 0, to: 359 };
  assert.deepEqual(
    resolveGuardedAutoHydrationProgrammaticRange({
      source: "programmatic",
      autoHydration: true,
      currentRange,
      nextRange: { from: -358, to: 1 },
      barCount: 360,
    }),
    currentRange,
  );
  assert.deepEqual(
    resolveGuardedAutoHydrationProgrammaticRange({
      source: "programmatic",
      autoHydration: true,
      currentRange: null,
      defaultRange: currentRange,
      nextRange: { from: -358, to: 1 },
      barCount: 360,
    }),
    currentRange,
  );

  assert.equal(
    resolveGuardedAutoHydrationProgrammaticRange({
      source: "user",
      autoHydration: true,
      currentRange,
      nextRange: { from: -358, to: 1 },
      barCount: 360,
    }),
    null,
  );
  assert.equal(
    resolveGuardedAutoHydrationProgrammaticRange({
      source: "programmatic",
      autoHydration: false,
      currentRange,
      nextRange: { from: -358, to: 1 },
      barCount: 360,
    }),
    null,
  );
  assert.equal(
    resolveGuardedAutoHydrationProgrammaticRange({
      source: "programmatic",
      autoHydration: true,
      currentRange: { from: 0, to: 359 },
      nextRange: { from: 0, to: 359 },
      barCount: 1800,
    }),
    null,
  );
});

test("chart control pointer events do not mark viewport user intent", () => {
  assert.match(
    surfaceSource,
    /const handleNativePointerDown = \(event: globalThis\.PointerEvent\) => \{\s*if \(isChartControlEventTarget\(event\.target\)\) \{\s*return;\s*\}/s,
  );
  assert.match(
    surfaceSource,
    /const handleRootWheelCapture = \(event: WheelEvent<HTMLDivElement>\) => \{\s*if \(isChartControlEventTarget\(event\.target\)\) \{\s*return;\s*\}/s,
  );
});

test("GEX projection center dots use the same x clamp as cone paths", () => {
  assert.match(
    surfaceSource,
    /centerDots:\s*projected\.map\(\(point\)\s*=>\s*\(\{\s*x:\s*clampProjectionCoordinate\(point\.x,\s*svgXBounds\.minX,\s*svgXBounds\.maxX\)/s,
  );
  assert.doesNotMatch(
    surfaceSource,
    /centerDots:\s*projected\.map\(\(point\)\s*=>\s*\(\{\s*x:\s*point\.x,/s,
  );
});
