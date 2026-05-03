import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMemoryPressureState,
  isPressureLevelAtLeast,
} from "./memoryPressureModel.js";
import { memoryPressureFillPercent } from "./FooterMemoryPressureIndicator.jsx";

test("memory pressure model stays normal for quiet workloads", () => {
  const result = buildMemoryPressureState({
    browserMemoryMb: 96,
    browserSource: "performance.memory",
    apiHeapUsedPercent: 42,
    activeWorkloadCount: 2,
    pollCount: 1,
    streamCount: 1,
    chartScopeCount: 2,
    prependScopeCount: 0,
    queryCount: 18,
    heavyQueryCount: 1,
    storeEntryCount: 20,
  });

  assert.equal(result.level, "normal");
  assert.equal(result.trend, "steady");
});

test("memory pressure model escalates on direct browser memory growth", () => {
  const result = buildMemoryPressureState(
    {
      browserMemoryMb: 340,
      browserSource: "performance.memory",
      apiHeapUsedPercent: 55,
      activeWorkloadCount: 7,
      pollCount: 3,
      streamCount: 3,
      chartScopeCount: 8,
      prependScopeCount: 1,
      queryCount: 72,
      heavyQueryCount: 12,
      storeEntryCount: 64,
    },
    {
      history: [{ score: 24, level: "watch" }],
    },
  );

  assert.equal(result.level, "high");
  assert.equal(result.trend, "rising");
  assert.ok(
    result.dominantDrivers.some((driver) => driver.kind === "browser-memory"),
  );
});

test("memory pressure model keeps elevated state until recovery is clear", () => {
  const result = buildMemoryPressureState(
    {
      browserMemoryMb: 178,
      browserSource: "performance.memory",
      apiHeapUsedPercent: 68,
      activeWorkloadCount: 7,
      pollCount: 3,
      streamCount: 2,
      chartScopeCount: 7,
      prependScopeCount: 0,
      queryCount: 60,
      heavyQueryCount: 6,
      storeEntryCount: 28,
    },
    {
      previousState: { level: "watch", score: 34 },
      history: [{ score: 35, level: "watch" }, { score: 31, level: "watch" }],
    },
  );

  assert.equal(result.level, "watch");
  assert.equal(isPressureLevelAtLeast(result.level, "watch"), true);
});

test("memory pressure footer fill uses score with level fallback", () => {
  assert.equal(memoryPressureFillPercent({ score: 67.2, level: "normal" }), 67);
  assert.equal(memoryPressureFillPercent({ score: -4, level: "critical" }), 0);
  assert.equal(memoryPressureFillPercent({ score: 133, level: "critical" }), 100);
  assert.equal(memoryPressureFillPercent({ level: "high" }), 68);
});
