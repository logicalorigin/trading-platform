import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMtfTimeframeSequence,
  getChartTimeframeValues,
  resolveChartTimeframeFavorites,
} from "./timeframes.ts";

// Representative ascending-duration available set (subset of MARKET_CHART_TIMEFRAMES).
const AVAILABLE = ["1m", "2m", "5m", "15m", "1h", "1d"];

test("chart 1 keeps the current timeframe", () => {
  const seq = buildMtfTimeframeSequence({
    current: "5m",
    favorites: ["1h"],
    available: AVAILABLE,
    count: 4,
  });
  assert.equal(seq[0], "5m");
});

test("steps to next-longest FAVORITES first, then longer non-favorites", () => {
  const seq = buildMtfTimeframeSequence({
    current: "2m",
    favorites: ["15m", "1h"],
    available: AVAILABLE,
    count: 5,
  });
  // chart1 = current; then longer favorites (asc); then longer non-favorites (asc)
  assert.deepEqual(seq, ["2m", "15m", "1h", "5m", "1d"]);
});

test("returns `count` distinct timeframes, longer favorite ahead of non-favorites", () => {
  const seq = buildMtfTimeframeSequence({
    current: "1m",
    favorites: ["1d"],
    available: AVAILABLE,
    count: 3,
  });
  assert.equal(seq.length, 3);
  assert.equal(new Set(seq).size, 3);
  assert.equal(seq[0], "1m");
  assert.equal(seq[1], "1d"); // the longer favorite comes before non-favorite longers
});

test("current at the longest TF pads DOWNWARD (descending) so the grid still fills", () => {
  const seq = buildMtfTimeframeSequence({
    current: "1d",
    favorites: [], // resolves to defaults (incl. 1h/15m), so padding is favorite-first descending
    available: AVAILABLE,
    count: 3,
  });
  assert.deepEqual(seq, ["1d", "1h", "15m"]);
});

test("current not in available falls back to the shortest available", () => {
  const seq = buildMtfTimeframeSequence({
    current: "30s",
    favorites: [],
    available: AVAILABLE,
    count: 2,
  });
  assert.equal(seq[0], "1m");
});

test("count larger than available returns every available timeframe, no duplicates", () => {
  const seq = buildMtfTimeframeSequence({
    current: "1m",
    favorites: [],
    available: AVAILABLE,
    count: 99,
  });
  assert.equal(seq.length, AVAILABLE.length);
  assert.equal(new Set(seq).size, AVAILABLE.length);
  assert.equal(seq[0], "1m");
});

test("empty available falls back to the role timeframe set (never empty)", () => {
  const seq = buildMtfTimeframeSequence({
    current: "5m",
    favorites: [],
    available: [],
    count: 3,
  });
  assert.ok(seq.length >= 1);
  assert.equal(seq[0], "5m");
});

test("primary chart timeframes include the requested Massive-backed defaults", () => {
  const values = getChartTimeframeValues("primary");
  for (const timeframe of ["10m", "12h", "1w", "1month", "1year"]) {
    assert.ok(values.includes(timeframe), `${timeframe} should be available`);
  }

  assert.equal(getChartTimeframeValues("option").includes("1month"), false);
  assert.equal(getChartTimeframeValues("option").includes("1year"), false);
});

test("default MTF ladder steps into the new primary favorites", () => {
  const seq = buildMtfTimeframeSequence({
    current: "5m",
    favorites: resolveChartTimeframeFavorites([], "primary"),
    available: getChartTimeframeValues("primary"),
    count: 6,
  });

  assert.deepEqual(seq, ["5m", "10m", "15m", "1h", "12h", "1d"]);
});
