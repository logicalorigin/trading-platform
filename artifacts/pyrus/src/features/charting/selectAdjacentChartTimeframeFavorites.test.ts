import assert from "node:assert/strict";
import test from "node:test";

import { selectAdjacentChartTimeframeFavorites } from "./timeframes";

const FAVS = ["5s", "1m", "5m", "10m", "15m", "1h", "12h", "1d"];

test("caps the mount prewarm to the favorites adjacent to the current timeframe", () => {
  // current in the middle -> the two neighbors, not the whole list
  assert.deepEqual(selectAdjacentChartTimeframeFavorites(FAVS, "5m"), ["1m", "10m"]);
  // never re-warms the current timeframe
  assert.ok(!selectAdjacentChartTimeframeFavorites(FAVS, "5m").includes("5m"));
});

test("clamps at the edges of the favorites list", () => {
  assert.deepEqual(selectAdjacentChartTimeframeFavorites(FAVS, "5s"), ["1m"]);
  assert.deepEqual(selectAdjacentChartTimeframeFavorites(FAVS, "1d"), ["12h"]);
});

test("falls back to the first favorites when the current timeframe is not a favorite", () => {
  assert.deepEqual(selectAdjacentChartTimeframeFavorites(FAVS, "3m"), ["5s", "1m"]);
});

test("a wider radius warms more neighbors but still excludes the current", () => {
  assert.deepEqual(selectAdjacentChartTimeframeFavorites(FAVS, "5m", 2), [
    "5s",
    "1m",
    "10m",
    "15m",
  ]);
});

test("handles empty favorites, zero radius, and a missing current timeframe", () => {
  assert.deepEqual(selectAdjacentChartTimeframeFavorites([], "5m"), []);
  assert.deepEqual(selectAdjacentChartTimeframeFavorites(FAVS, "5m", 0), []);
  assert.deepEqual(selectAdjacentChartTimeframeFavorites(FAVS, null), ["5s", "1m"]);
});
