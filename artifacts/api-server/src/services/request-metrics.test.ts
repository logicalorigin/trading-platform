import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetRequestMetricsForTests,
  getRecentRequestSamples,
  recordApiRequest,
} from "./request-metrics";

test("successful health probes do not dilute API workload latency metrics", () => {
  __resetRequestMetricsForTests();
  try {
    for (const path of ["/healthz", "/api/healthz"] as const) {
      recordApiRequest({
        method: "GET",
        path,
        statusCode: 200,
        durationMs: 1,
      });
    }
    recordApiRequest({
      method: "GET",
      path: "/api/healthz",
      statusCode: 302,
      durationMs: 2,
    });
    recordApiRequest({
      method: "GET",
      path: "/api/healthz",
      statusCode: 503,
      durationMs: 2,
    });
    recordApiRequest({
      method: "GET",
      path: "/api/bars",
      statusCode: 200,
      durationMs: 3,
    });

    assert.deepEqual(
      getRecentRequestSamples().map(({ path, statusCode }) => ({
        path,
        statusCode,
      })),
      [
        { path: "/api/healthz", statusCode: 302 },
        { path: "/api/healthz", statusCode: 503 },
        { path: "/api/bars", statusCode: 200 },
      ],
    );
  } finally {
    __resetRequestMetricsForTests();
  }
});
