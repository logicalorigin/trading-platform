import assert from "node:assert/strict";
import test from "node:test";

import { __platformBarsCacheTestInternals } from "./platform";

const {
  getBaseBarsTimeframe,
  resolveRecentCoverageStaleToleranceMs,
  shouldFetchHistoricalSynthesisForRecentCoverage,
  shouldRefreshStaleBarsInBackground,
} = __platformBarsCacheTestInternals;

function storedBar(timestamp: string) {
  return {
    timestamp: new Date(timestamp),
    open: 10,
    high: 10,
    low: 10,
    close: 10,
    volume: 100,
    source: "massive-history",
  } as never;
}

const quietSunday = new Date("2026-07-19T20:45:00.000Z");
const priorSessionClose = new Date("2026-07-17T20:00:00.000Z");
const thursdayCloseBar = storedBar("2026-07-16T20:00:00.000Z");
const requestedTimeframe = "2m" as const;
const baseTimeframe = getBaseBarsTimeframe(requestedTimeframe);
const request = {
  symbol: "LYEL",
  timeframe: baseTimeframe,
  limit: 480,
  to: priorSessionClose,
  assetClass: "equity",
  outsideRth: true,
  source: "trades",
  allowHistoricalSynthesis: true,
} as const;

test("quiet-session signal-matrix coverage still repairs a missed completed session", () => {
  assert.equal(baseTimeframe, "1m");
  const staleToleranceMs = resolveRecentCoverageStaleToleranceMs({
    request,
    providerIdentity: null,
    massiveConfig: null,
    options: { family: "signal-matrix", priority: 5 },
    now: quietSunday,
  });

  assert.equal(staleToleranceMs, null);
  assert.equal(
    shouldFetchHistoricalSynthesisForRecentCoverage({
      request,
      storedHistoricalBars: [thursdayCloseBar],
      brokerBars: [],
      now: quietSunday,
      enabled: true,
      staleToleranceMs,
    }),
    true,
  );
  assert.equal(
    shouldRefreshStaleBarsInBackground(
      request,
      { family: "signal-matrix", priority: 5 },
      quietSunday,
    ),
    false,
    "the existing quiet-session background-refresh pressure guard remains",
  );
});

test("quiet-session sparkline reads retain their broad passive tolerance", () => {
  const staleToleranceMs = resolveRecentCoverageStaleToleranceMs({
    request,
    providerIdentity: null,
    massiveConfig: null,
    options: { family: "signals-table-sparkline", priority: 5 },
    now: quietSunday,
  });

  assert.ok(staleToleranceMs !== null && staleToleranceMs > 24 * 60 * 60_000);
  assert.equal(
    shouldFetchHistoricalSynthesisForRecentCoverage({
      request,
      storedHistoricalBars: [thursdayCloseBar],
      brokerBars: [],
      now: quietSunday,
      enabled: true,
      staleToleranceMs,
    }),
    false,
  );
});
