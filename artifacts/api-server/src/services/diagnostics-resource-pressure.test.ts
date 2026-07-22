import assert from "node:assert/strict";
import test from "node:test";
import v8 from "node:v8";

import { __diagnosticsInternalsForTests } from "./diagnostics";
import {
  __resetApiResourcePressureForTests,
  getApiResourcePressureSnapshot,
} from "./resource-pressure";

test("resource-pressure RSS samples the current API process, not stale runtime JSON", () => {
  __resetApiResourcePressureForTests();
  try {
    const metrics =
      __diagnosticsInternalsForTests.buildResourcePressureMetrics(
        {
          api: {
            memoryMb: {
              rss: 540.2,
              heapUsed: 128,
              heapTotal: 256,
            },
          },
        },
        {},
        () => ({ rss: 1_234 * 1024 * 1024 }),
      );

    assert.equal(metrics["rssMb"], 1_234);
    assert.equal(getApiResourcePressureSnapshot().inputs.rssMb, 1_234);
  } finally {
    __resetApiResourcePressureForTests();
  }
});

for (const expectation of [
  { percent: 69, level: "normal" },
  { percent: 70, level: "watch" },
  { percent: 79, level: "watch" },
  { percent: 80, level: "high" },
] as const) {
  test(`resource pressure uses the V8 heap ceiling at ${expectation.percent}%`, () => {
    __resetApiResourcePressureForTests();
    try {
      const heapLimitMb = v8.getHeapStatistics().heap_size_limit / 1024 / 1024;
      const metrics =
        __diagnosticsInternalsForTests.buildResourcePressureMetrics(
          {
            api: {
              memoryMb: {
                rss: 512,
                heapUsed: (heapLimitMb * expectation.percent) / 100,
                heapTotal: heapLimitMb,
              },
            },
          },
          {},
          () => ({ rss: 512 * 1024 * 1024 }),
        );
      const snapshot = getApiResourcePressureSnapshot();

      assert.equal(snapshot.inputs.apiHeapUsedPercent, expectation.percent);
      assert.equal(
        snapshot.drivers.find((driver) => driver.kind === "api-heap")?.level ??
          "normal",
        expectation.level,
      );
      assert.equal(metrics["pressureLevel"], expectation.level);
    } finally {
      __resetApiResourcePressureForTests();
    }
  });
}
