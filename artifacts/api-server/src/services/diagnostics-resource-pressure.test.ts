import assert from "node:assert/strict";
import test from "node:test";

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
