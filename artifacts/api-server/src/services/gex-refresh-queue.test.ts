import assert from "node:assert/strict";
import test from "node:test";

import {
  __expireGexDashboardCacheForTests,
  __setGexIngestFacadeForTests,
  __setGexPlatformDataClientFactoryForTests,
  __setGexProjectionRatesProviderForTests,
  getGexDashboardData,
  getGexProjectionData,
  getGexZeroGammaData,
  type GexResponse,
} from "./gex";
import {
  buildIngestDedupeKey,
  type EnqueueMarketDataJobInput,
  type LatestGexSnapshot,
} from "./market-data-ingest";

const REAL_DATE_NOW = Date.now;

function setNow(iso: string): void {
  Date.now = () => new Date(iso).getTime();
}

async function waitForEnqueuedJobs(
  enqueued: EnqueueMarketDataJobInput[],
  count: number,
): Promise<void> {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    if (enqueued.length >= count) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(enqueued.length, count);
}

function makeGexResponse(timestamp: string): GexResponse {
  return {
    ticker: "QQQ",
    tickerDetails: {
      ticker: "QQQ",
      name: "Invesco QQQ Trust",
      sector: "ETF",
      industry: "ETF",
      marketCap: null,
      exchangeShortName: "NASDAQ",
      country: "US",
      isEtf: true,
      isFund: true,
    },
    profile: {
      price: 500,
      dayLow: 495,
      dayHigh: 505,
      yearLow: null,
      yearHigh: null,
      mktCap: null,
    },
    spot: 500,
    timestamp,
    isStale: false,
    options: [],
    snapshots: [],
    flowContext: null,
    flowContextStatus: "unavailable",
    source: {
      provider: "massive",
      status: "partial",
      expirationCoverage: {
        requestedCount: 0,
        returnedCount: 0,
        loadedCount: 0,
        failedCount: 0,
        complete: false,
        capped: false,
      },
      optionCount: 0,
      usableOptionCount: 0,
      withGamma: 0,
      withOpenInterest: 0,
      withImpliedVolatility: 0,
      quoteUpdatedAt: null,
      chainUpdatedAt: null,
      flowStatus: "unavailable",
      flowEventCount: 0,
      classifiedFlowEventCount: 0,
      flowClassificationCoverage: 0,
      flowClassificationBasisCounts: {
        quoteMatch: 0,
        tickTest: 0,
        none: 0,
      },
      flowClassificationConfidenceCounts: {
        high: 0,
        medium: 0,
        low: 0,
        none: 0,
      },
      message: null,
    },
  };
}

function makeStaleSnapshot(computedAtIso: string): LatestGexSnapshot {
  const computedAt = new Date(computedAtIso);
  return {
    computedAt,
    ageMs: 6 * 60 * 60 * 1000,
    stale: true,
    payload: makeGexResponse(computedAt.toISOString()),
  };
}

test.afterEach(() => {
  Date.now = REAL_DATE_NOW;
  __setGexIngestFacadeForTests(null);
  __setGexPlatformDataClientFactoryForTests(null);
  __setGexProjectionRatesProviderForTests(null);
});

test("stale persisted GEX refreshes reuse the stale snapshot bucket across minute boundaries", async () => {
  const enqueued: EnqueueMarketDataJobInput[] = [];
  const snapshot = makeStaleSnapshot("2026-06-17T16:35:48.753Z");
  const expectedBucket = Math.floor(snapshot.computedAt.getTime() / 60_000);

  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    getLatestGexSnapshot: async () => snapshot,
    enqueueMarketDataJob: async (input) => {
      enqueued.push(input);
      return { queued: true, dedupeKey: buildIngestDedupeKey(input) };
    },
  });

  setNow("2026-06-17T21:40:10.000Z");
  const first = await getGexDashboardData({ underlying: "QQQ" });
  assert.equal(first.isStale, true);
  await waitForEnqueuedJobs(enqueued, 3);

  __expireGexDashboardCacheForTests("QQQ");
  setNow("2026-06-17T21:42:10.000Z");
  const second = await getGexDashboardData({ underlying: "QQQ" });
  assert.equal(second.isStale, true);
  await waitForEnqueuedJobs(enqueued, 6);

  assert.deepEqual(
    enqueued.map((input) => input.payload?.dedupeBucket),
    [
      expectedBucket,
      expectedBucket,
      expectedBucket,
      expectedBucket,
      expectedBucket,
      expectedBucket,
    ],
  );
});

test("passive chart GEX misses do not enqueue refreshes or live-chain fallback", async () => {
  const enqueued: EnqueueMarketDataJobInput[] = [];
  let ratesCalls = 0;
  let platformCalls = 0;

  __setGexProjectionRatesProviderForTests(async () => {
    ratesCalls += 1;
    return {
      status: "unavailable",
      source: "test",
      asOf: null,
      points: [],
    };
  });
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => {
      platformCalls += 1;
      throw new Error("Passive chart projection must not fetch live quotes.");
    },
    getOptionExpirationsWithDebug: async () => {
      platformCalls += 1;
      throw new Error(
        "Passive chart projection must not fetch live expirations.",
      );
    },
    batchOptionChains: async () => {
      platformCalls += 1;
      throw new Error(
        "Passive chart projection must not fetch live option chains.",
      );
    },
  }));
  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    getLatestChartGexSnapshot: async () => null,
    getLatestGexSnapshot: async () => null,
    enqueueMarketDataJob: async (input) => {
      enqueued.push(input);
      return { queued: true, dedupeKey: buildIngestDedupeKey(input) };
    },
  });

  const projection = await getGexProjectionData({
    underlying: "QQQ",
    scope: "chart",
    mode: "snapshot",
  });

  assert.equal(projection.ticker, "QQQ");
  assert.equal(projection.source.status, "unavailable");
  assert.equal(projection.overlayPoints.length, 0);

  const zeroGamma = await getGexZeroGammaData({
    underlying: "QQQ",
    mode: "snapshot",
  });

  assert.equal(zeroGamma.ticker, "QQQ");
  assert.equal(zeroGamma.source.status, "unavailable");
  assert.equal(zeroGamma.zeroGamma, null);
  assert.equal(enqueued.length, 0);
  assert.equal(ratesCalls, 0);
  assert.equal(platformCalls, 0);
});
