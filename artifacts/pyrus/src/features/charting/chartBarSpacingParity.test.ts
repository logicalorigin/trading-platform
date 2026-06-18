import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  estimateBarOverlayWidth,
  getChartBarSpacing,
  resolveBarSpacing,
  resolveFootprintCandleWidth,
} from "./ResearchChartSurface";

const surfaceSource = readFileSync(
  new URL("./ResearchChartSurface.tsx", import.meta.url),
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
