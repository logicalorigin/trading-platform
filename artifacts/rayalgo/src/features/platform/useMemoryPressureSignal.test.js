import assert from "node:assert/strict";
import test from "node:test";

import { mergeMemoryPressureServerSummary } from "./useMemoryPressureSignal.js";

test("memory pressure monitor honors stricter resource-pressure diagnostics", () => {
  const result = mergeMemoryPressureServerSummary({
    footerMemoryPressure: {
      level: "normal",
      apiHeapUsedPercent: 20.5,
      browserMemoryMb: 123,
      dominantDrivers: [],
    },
    resourceMetrics: {
      pressureLevel: "critical",
      heapUsedPercent: 20.5,
      rssMb: 2603.6,
      dominantDrivers: [
        {
          kind: "api-rss",
          label: "API RSS",
          level: "critical",
          detail: "2604 MB",
          score: 2603.6,
        },
      ],
    },
  });

  assert.equal(result.level, "critical");
  assert.equal(result.apiHeapUsedPercent, 20.5);
  assert.equal(result.browserMemoryMb, 123);
  assert.equal(result.dominantDrivers[0].kind, "api-rss");
});
