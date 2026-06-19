import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResponseHeaderPressureSummary,
  mergeMemoryPressureServerSummary,
} from "./useMemoryPressureSignal.js";

test("response-header pressure keeps resource level separate from held effective pressure", () => {
  const observedAt = "2026-06-18T12:00:00.000Z";
  const current = {
    effectivePressureLevel: "high",
    pressureLevel: "high",
    observedAt,
  };

  const summary = buildResponseHeaderPressureSummary(
    {
      pressureLevel: "watch",
      resourceLevel: "watch",
      routeClass: "active-screen",
      observedAt: "2026-06-18T12:00:05.000Z",
    },
    current,
  );

  assert.equal(summary.pressureLevel, "high");
  assert.equal(summary.effectivePressureLevel, "high");
  assert.equal(summary.resourceLevel, "watch");
  assert.equal(summary.routeClass, "active-screen");
});

test("server summary exposes DB resource pressure without turning it into memory pressure", () => {
  const summary = mergeMemoryPressureServerSummary({
    resourceMetrics: {
      apiResourcePressure: {
        resourceLevel: "watch",
      },
      pressureDrivers: [
        {
          kind: "db-pool",
          level: "watch",
        },
      ],
    },
  });

  assert.equal(summary.level, "normal");
  assert.equal(summary.resourceLevel, "watch");
  assert.deepEqual(summary.pressureDrivers, []);
});
