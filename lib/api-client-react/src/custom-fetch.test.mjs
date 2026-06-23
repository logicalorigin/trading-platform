import assert from "node:assert/strict";
import test from "node:test";

import { __customFetchInternalsForTests } from "./custom-fetch.ts";

const { getHeavyGetPriority, isHeavyGetPath } =
  __customFetchInternalsForTests;
const { applyBaseUrl } = __customFetchInternalsForTests;

test("signal-quality KPI requests are treated as heavy GETs", () => {
  assert.equal(
    isHeavyGetPath("/api/algo/deployments/deployment-1/signal-quality-kpis"),
    true,
  );
  assert.equal(
    getHeavyGetPriority(
      "/api/algo/deployments/deployment-1/signal-quality-kpis?timeHorizon=9",
      "GET",
    ),
    2,
  );
});

test("signal-quality KPI heavy matching stays scoped to the exact endpoint", () => {
  assert.equal(
    isHeavyGetPath("/api/algo/deployments/deployment-1/signal-options/state"),
    false,
  );
  assert.equal(
    getHeavyGetPriority(
      "/api/algo/deployments/deployment-1/signal-quality-kpis",
      "POST",
    ),
    0,
  );
});

test("customFetch can apply a per-request base URL to relative API paths", () => {
  assert.equal(
    applyBaseUrl(
      "/api/algo/deployments/deployment-1/signal-options/profile",
      "http://127.0.0.1:8080/",
    ),
    "http://127.0.0.1:8080/api/algo/deployments/deployment-1/signal-options/profile",
  );
  assert.equal(
    applyBaseUrl(
      "http://127.0.0.1:18747/api/session",
      "http://127.0.0.1:8080",
    ),
    "http://127.0.0.1:18747/api/session",
  );
});
