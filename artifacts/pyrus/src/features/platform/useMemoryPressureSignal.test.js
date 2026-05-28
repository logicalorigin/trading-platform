import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeMemoryPressureRuntimeState,
  mergeMemoryPressureServerSummary,
} from "./useMemoryPressureSignal.js";

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

test("memory pressure runtime state surfaces API RSS drivers in footer state", () => {
  const result = mergeMemoryPressureRuntimeState(
    {
      level: "normal",
      browserMemoryMb: 120,
      apiHeapUsedPercent: 22,
      sourceQuality: "low",
      pressureDrivers: [
        { kind: "browser-memory", label: "Browser memory", level: "normal" },
        { kind: "api-heap", label: "API heap", level: "normal" },
      ],
      dominantDrivers: [],
    },
    {
      level: "critical",
      rssMb: 1639.1,
      apiHeapUsedPercent: 22,
      sourceQuality: "medium",
      dominantDrivers: [
        {
          kind: "api-rss",
          label: "API RSS",
          level: "critical",
          detail: "1639 MB",
          score: 1639.1,
        },
      ],
    },
  );

  assert.equal(result.level, "critical");
  assert.equal(result.apiRssMb, 1639.1);
  assert.equal(result.sourceQuality, "medium");
  assert.equal(result.pressureDrivers[0].kind, "api-rss");
  assert.equal(result.dominantDrivers[0].kind, "api-rss");
});
