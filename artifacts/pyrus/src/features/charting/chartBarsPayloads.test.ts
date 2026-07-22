import assert from "node:assert/strict";
import test from "node:test";

import { isChartBarsPayloadCacheStale } from "./chartBarsPayloads";

test("runtime-cache stale metadata keeps hydrated chart bars stale", () => {
  assert.equal(
    isChartBarsPayloadCacheStale({
      bars: [{ timestamp: "2026-07-21T14:30:00.000Z" }],
      runtimeCache: { cacheStatus: "stale", stale: true },
    }),
    true,
  );
  assert.equal(
    isChartBarsPayloadCacheStale({
      bars: [{ timestamp: "2026-07-21T14:30:00.000Z" }],
      runtimeCache: { cacheStatus: "hit", stale: false },
    }),
    false,
  );
});
