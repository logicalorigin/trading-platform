import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __platformBarsCacheTestInternals } from "./platform";
import {
  __resetApiResourcePressureForTests,
  updateApiResourcePressure,
} from "./resource-pressure";

test("stale chart refresh is not disabled by unrelated global pressure", () => {
  __resetApiResourcePressureForTests();
  try {
    updateApiResourcePressure({ apiHeapUsedPercent: 90 });
    updateApiResourcePressure({ apiHeapUsedPercent: 90 });

    assert.equal(
      __platformBarsCacheTestInternals.shouldRefreshStaleBarsInBackground(
        { symbol: "SPY", timeframe: "1m" },
        {},
        new Date("2026-07-16T15:00:00.000Z"),
      ),
      true,
    );
  } finally {
    __resetApiResourcePressureForTests();
  }
});

test("Flow historical hydration delegates capacity to its local owners", () => {
  const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
  const start = source.indexOf(
    "const historicalCandidateContracts =",
    source.indexOf("export async function getOptionsFlowScannerContracts"),
  );
  const end = source.indexOf(
    "const liveHydration = await hydrateFlowScannerContractsFromLiveQuotes",
    start,
  );

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.doesNotMatch(
    source.slice(start, end),
    /shouldHydrateFlowScannerHistoricalBars|getApiResourcePressureSnapshot|hardResourceLevel|resourceLevel/,
  );
  assert.match(source.slice(start, end), /await hydrateFlowScannerContractsFromHistoricalBars/);
});
