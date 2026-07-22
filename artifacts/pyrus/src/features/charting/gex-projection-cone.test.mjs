// Regression coverage for buildGexProjectionConeSvgOverlay.
//
// .tsx is not exercised by `node --test` by default and .js/.jsx are not
// covered by tsc (allowJs is off), so this guards the cone builder's three
// reported defects directly:
//   1. exactly one green center dot per expiration (no missing / duplicated dots)
//   2. a single cone structure (one outer band + one inner band, each a single
//      closed path) — the "two cones" report is the nested 2σ/1σ bands, not a
//      double render.
//   3. the center-dot x is clamped to the same SVG render window as the cone
//      path, so a far-future expiration's dot pins to the edge instead of
//      rendering off the overscan window (the leader's clamp patch).
//
// Run: npx tsx --test src/features/charting/gex-projection-cone.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGexProjectionConeSvgOverlay,
  resolveGexProjectionSvgXBounds,
} from "./ResearchChartSurface.tsx";

const DAY_SECONDS = 86_400;
const LAST_BAR_TIME = Date.UTC(2026, 5, 18) / 1000; // 2026-06-18T00:00:00Z
const PREV_BAR_TIME = LAST_BAR_TIME - DAY_SECONDS;

const buildModel = () => ({
  chartBars: [
    { time: PREV_BAR_TIME, h: 101, l: 99, c: 100 },
    { time: LAST_BAR_TIME, h: 102, l: 98, c: 100 },
  ],
});

// Daily bars -> observed step of 86_400s; explicit barSpacing keeps lastX deterministic.
const LAST_X = 500;
const BAR_SPACING = 12;
const buildChart = () => ({
  timeScale: () => ({
    options: () => ({ barSpacing: BAR_SPACING }),
    timeToCoordinate: (time) => (time === LAST_BAR_TIME ? LAST_X : null),
  }),
});

// Linear, always-finite price->coordinate mapping.
const buildSeries = () => ({
  priceToCoordinate: (price) => 400 - price,
});

const THEME = {
  green: "#33ff99",
  blue: "#3388ff",
  cyan: "#33ddff",
  accent: "#8855ff",
  text: "#e6e6e6",
  textMuted: "#9aa0a6",
  amber: "#ffb020",
  bg2: "#11161c",
};

const conePoint = (expirationDate, center, spread) => ({
  expirationDate,
  lower2: center - 2 * spread,
  lower1: center - spread,
  center,
  upper1: center + spread,
  upper2: center + 2 * spread,
  qualityStatus: "ok",
});

const buildOverlay = (points) => ({
  ticker: "SPY",
  spot: 100,
  qualityStatus: "ok",
  points,
});

const buildArgs = (points) => ({
  chart: buildChart(),
  series: buildSeries(),
  model: buildModel(),
  overlay: buildOverlay(points),
  theme: THEME,
  chartTimeframe: null, // forces fallback to observed 86_400s step
  viewportWidth: 1000,
  viewportHeight: 400,
  anchorPrice: undefined,
  dataTestId: "chart",
});

const countPathStarts = (path) => (path.match(/M /g) || []).length;

test("renders exactly one center dot per expiration", () => {
  const points = [
    conePoint("2026-06-20", 100, 2),
    conePoint("2026-06-27", 101, 3),
    conePoint("2026-07-18", 102, 5),
  ];
  const result = buildGexProjectionConeSvgOverlay(buildArgs(points));

  assert.ok(result, "overlay should build");
  assert.equal(result.centerDots.length, points.length, "one dot per expiration");

  const expirations = result.centerDots.map((dot) => dot.expirationDate);
  assert.deepEqual(
    [...new Set(expirations)].sort(),
    points.map((point) => point.expirationDate).sort(),
    "dots cover each distinct expiration with no duplicates",
  );

  for (const dot of result.centerDots) {
    assert.ok(Number.isFinite(dot.x), "dot x finite");
    assert.ok(Number.isFinite(dot.y), "dot y finite");
    assert.ok(Number.isFinite(dot.price), "dot price finite");
  }
});

test("single cone structure: one outer band, one inner band, one center line", () => {
  const points = [
    conePoint("2026-06-20", 100, 2),
    conePoint("2026-06-27", 101, 3),
  ];
  const result = buildGexProjectionConeSvgOverlay(buildArgs(points));

  assert.ok(result, "overlay should build");
  // Each band is one continuous closed path (single move-to). Two distinct
  // bands (outer 2σ + inner 1σ) is the intended nesting, not a double render.
  assert.equal(countPathStarts(result.outerPath), 1, "outer band is a single path");
  assert.equal(countPathStarts(result.innerPath), 1, "inner band is a single path");
  assert.equal(countPathStarts(result.centerPath), 1, "center line is a single path");
  assert.notEqual(result.outerPath, result.innerPath, "outer and inner are distinct bands");
});

test("center dot x is clamped to the SVG render window (leader clamp patch)", () => {
  const bounds = resolveGexProjectionSvgXBounds(1000);
  // A far-future expiration projects to x = 500 + ~367*12 ≈ 4892, well past
  // maxX (2000). The patch clamps the dot so it stays in the render window
  // instead of rendering off-canvas (the "missing dot" report).
  const farExpiration = "2027-06-18";
  const points = [
    conePoint("2026-06-20", 100, 2),
    conePoint(farExpiration, 105, 6),
  ];
  const result = buildGexProjectionConeSvgOverlay(buildArgs(points));

  assert.ok(result, "overlay should build");
  for (const dot of result.centerDots) {
    assert.ok(
      dot.x >= bounds.minX && dot.x <= bounds.maxX,
      `dot x ${dot.x} within [${bounds.minX}, ${bounds.maxX}]`,
    );
  }

  const farDot = result.centerDots.find((dot) => dot.expirationDate === farExpiration);
  assert.ok(farDot, "far expiration still yields a dot");
  assert.equal(farDot.x, bounds.maxX, "far dot is clamped to the render window edge");
});
