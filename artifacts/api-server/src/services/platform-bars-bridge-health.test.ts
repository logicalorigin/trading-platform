import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  __resetOptionChainCachesForTests,
  __setIbkrBridgeClientFactoryForTests,
  __platformBarsCacheTestInternals,
  getBarsWithDebug,
} from "./platform";

afterEach(() => {
  __setIbkrBridgeClientFactoryForTests(null);
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
});

test("bars history requests do not read bridge health unless fallback needs it", async () => {
  let bridgeHealthCalls = 0;
  let historicalBarsCalls = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        async getHealth() {
          bridgeHealthCalls += 1;
          throw new Error("bridge health should not be read for bars history");
        },
        async getHistoricalBars() {
          historicalBarsCalls += 1;
          return [];
        },
      }) as never,
  );

  const result = await getBarsWithDebug(
    {
      symbol: "SPY",
      timeframe: "1m",
      limit: 2,
      outsideRth: true,
      source: "trades",
      allowHistoricalSynthesis: false,
      brokerRecentWindowMinutes: 0,
    },
    {
      family: "bars-health-test",
      priority: 6,
    },
  );

  assert(historicalBarsCalls > 0);
  assert.equal(bridgeHealthCalls, 0);
  assert.equal(result.bars.length, 0);
});

test("passive sparkline bars trust stored history during quiet market sessions", () => {
  const request = {
    symbol: "SPY",
    timeframe: "1m",
    limit: 240,
    outsideRth: true,
    source: "trades",
    brokerRecentWindowMinutes: 0,
    assetClass: "equity",
  } as const;

  assert.equal(
    __platformBarsCacheTestInternals.shouldUsePassiveQuietSessionRecentCoverageTolerance({
      request,
      options: { family: "signals-table-sparkline", priority: 5 },
      now: new Date("2026-06-07T16:00:00.000Z"),
    }),
    true,
  );
  assert.equal(
    __platformBarsCacheTestInternals.shouldUsePassiveQuietSessionRecentCoverageTolerance({
      request,
      options: { family: "chart-backfill", priority: 9 },
      now: new Date("2026-06-07T16:00:00.000Z"),
    }),
    false,
  );
});

test("passive quiet-session stale bars do not schedule background refresh", () => {
  const request = {
    symbol: "SPY",
    timeframe: "1m",
    limit: 240,
    outsideRth: true,
    source: "trades",
    brokerRecentWindowMinutes: 0,
    assetClass: "equity",
  } as const;

  assert.equal(
    __platformBarsCacheTestInternals.shouldRefreshStaleBarsInBackground(
      request,
      { family: "signal-matrix", priority: 5 },
      new Date("2026-06-07T16:00:00.000Z"),
    ),
    false,
  );
});
