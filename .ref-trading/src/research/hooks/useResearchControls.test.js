import test from "node:test";
import assert from "node:assert/strict";
import { resolveResearchStartupChartState } from "./researchStartupChartState.js";

test("resolveResearchStartupChartState forces the global startup chart defaults", () => {
  assert.deepEqual(resolveResearchStartupChartState(), {
    candleTf: "auto",
    chartRange: "3M",
    chartWindowMode: "default",
    spotChartType: "candles",
    optionChartType: "candles",
    rayalgoCandleColorMode: "rayalgo",
  });
});
