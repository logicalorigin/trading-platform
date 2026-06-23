import assert from "node:assert/strict";
import test from "node:test";

import { __customFetchInternalsForTests } from "./custom-fetch.ts";

const { getHeavyGetPriority, isHeavyGetPath } =
  __customFetchInternalsForTests;

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
