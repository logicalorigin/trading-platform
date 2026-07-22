import assert from "node:assert/strict";
import test from "node:test";

import {
  getChartBarLimit,
  getInitialChartBarLimit,
  getMaxChartBarLimit,
  resolveChartTimeframeFavorites,
  selectAdjacentChartTimeframeFavorites,
} from "./timeframes.ts";

test("favorites resolve in duration order so adjacent prewarm stays nearest", () => {
  const favorites = resolveChartTimeframeFavorites(
    ["1m", "5m", "1d", "5s"],
    "primary",
  );

  assert.deepEqual(favorites, ["5s", "1m", "5m", "1d"]);
  assert.deepEqual(
    selectAdjacentChartTimeframeFavorites(favorites, "5m"),
    ["1m", "1d"],
  );
});

test("unsupported option timeframes keep their explicit zero bar limits", () => {
  assert.equal(getChartBarLimit("1month", "option"), 0);
  assert.equal(getInitialChartBarLimit("1month", "option"), 0);
  assert.equal(getMaxChartBarLimit("1month", "option"), 0);
});
