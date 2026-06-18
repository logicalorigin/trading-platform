import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  __expireGexDashboardCacheForTests,
  __setGexIngestFacadeForTests,
  __setGexPlatformDataClientFactoryForTests,
  __setGexProjectionRatesProviderForTests,
  buildGexDashboardHttpCacheMetadata,
  getCachedGexDashboardHttpCacheMetadata,
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

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
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

function makePlatformOptionContract() {
  return {
    contract: {
      ticker: "QQQ260619C00500000",
      underlying: "QQQ",
      expirationDate: new Date("2026-06-19T00:00:00.000Z"),
      strike: 500,
      right: "call",
      providerContractId: "test-contract-1",
      multiplier: 100,
      sharesPerContract: 100,
    },
    gamma: 0.01,
    delta: 0.5,
    theta: -0.02,
    vega: 0.1,
    openInterest: 100,
    impliedVolatility: 0.2,
    bid: 1,
    ask: 1.2,
    mark: 1.1,
    volume: 10,
    underlyingPrice: 500,
    dataUpdatedAt: new Date("2026-06-17T16:35:48.753Z"),
    quoteUpdatedAt: new Date("2026-06-17T16:35:48.753Z"),
    updatedAt: new Date("2026-06-17T16:35:48.753Z"),
    quoteFreshness: "live",
    marketDataMode: "live",
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

test("cached GEX dashboard exposes stable HTTP validator metadata while fresh", async () => {
  const snapshot: LatestGexSnapshot = {
    computedAt: new Date("2026-06-17T16:35:48.753Z"),
    ageMs: 1_000,
    stale: false,
    payload: makeGexResponse("2026-06-17T16:35:48.753Z"),
  };
  let snapshotReads = 0;

  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    getLatestGexSnapshot: async () => {
      snapshotReads += 1;
      return snapshot;
    },
    enqueueMarketDataJob: async (input) => {
      return { queued: true, dedupeKey: buildIngestDedupeKey(input) };
    },
  });

  setNow("2026-06-17T16:35:50.000Z");
  assert.equal(getCachedGexDashboardHttpCacheMetadata("QQQ"), null);

  const first = await getGexDashboardData({ underlying: "QQQ" });
  assert.equal(first.timestamp, "2026-06-17T16:35:48.753Z");

  const metadata = getCachedGexDashboardHttpCacheMetadata(" qqq ");
  assert.ok(metadata);
  assert.equal(metadata.ticker, "QQQ");
  assert.match(metadata.eTag, /^W\/"gex-[A-Za-z0-9_-]+"$/);
  assert.equal(snapshotReads, 1);

  const repeated = getCachedGexDashboardHttpCacheMetadata("QQQ");
  assert.deepEqual(repeated, metadata);

  __expireGexDashboardCacheForTests("QQQ");
  assert.equal(getCachedGexDashboardHttpCacheMetadata("QQQ"), null);
});

test("stale returned GEX dashboard can still derive HTTP validator metadata", () => {
  const fresh = makeGexResponse("2026-06-17T16:35:48.753Z");
  const stale: GexResponse = {
    ...fresh,
    isStale: true,
    source: {
      ...fresh.source,
      status: "partial",
      message: "Returning the previous zero-gamma dashboard while the refresh is loading.",
    },
  };

  assert.equal(getCachedGexDashboardHttpCacheMetadata("QQQ"), null);

  const metadata = buildGexDashboardHttpCacheMetadata(stale);
  assert.equal(metadata.ticker, "QQQ");
  assert.match(metadata.eTag, /^W\/"gex-[A-Za-z0-9_-]+"$/);
  assert.notEqual(
    metadata.eTag,
    buildGexDashboardHttpCacheMetadata(fresh).eTag,
  );
});

test("GEX dashboard route sets validators on stale refresh fallback responses", async () => {
  let failRefresh = false;
  let quoteCalls = 0;

  // The route test only needs the fields read by the GEX mapper.
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => {
      quoteCalls += 1;
      if (failRefresh) {
        throw new Error("forced refresh quote failure");
      }
      return {
        delayed: false,
        fallbackUsed: false,
        quotes: [
          {
            symbol: "QQQ",
            price: 500,
            low: 495,
            high: 505,
            delayed: false,
            source: "ibkr",
            freshness: "live",
            marketDataMode: "live",
            dataUpdatedAt: "2026-06-17T16:35:48.753Z",
            updatedAt: "2026-06-17T16:35:48.753Z",
          },
        ],
        transport: null,
      };
    },
    getOptionExpirationsWithDebug: async () => {
      if (failRefresh) {
        throw new Error("forced refresh expirations failure");
      }
      return {
        underlying: "QQQ",
        expirations: [{ expirationDate: new Date("2026-06-19T00:00:00.000Z") }],
        debug: {
          cacheStatus: "hit",
          totalMs: 0,
          upstreamMs: null,
          degraded: false,
          reason: null,
        },
      };
    },
    batchOptionChains: async () => {
      if (failRefresh) {
        throw new Error("forced refresh chain failure");
      }
      return {
        underlying: "QQQ",
        results: [
          {
            expirationDate: new Date("2026-06-19T00:00:00.000Z"),
            status: "loaded",
            contracts: [makePlatformOptionContract()],
            error: null,
            debug: {
              cacheStatus: "hit",
              totalMs: 0,
              upstreamMs: null,
              degraded: false,
              reason: null,
            },
          },
        ],
        debug: {
          cacheStatus: "hit",
          totalMs: 0,
          upstreamMs: null,
          degraded: false,
          reason: null,
          requestedExpirationCount: 1,
          loadedExpirationCount: 1,
          failedExpirationCount: 0,
        },
      };
    },
  }) as any);

  setNow("2026-06-17T16:35:48.753Z");
  const { default: app } = await import("../app");
  const server = app.listen(0);
  try {
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const first = await fetch(`${baseUrl}/api/gex/QQQ`, {
      headers: { "accept-encoding": "identity" },
    });
    assert.equal(first.status, 200);
    const firstEtag = first.headers.get("etag");
    assert.ok(firstEtag);
    assert.equal(first.headers.get("last-modified"), null);
    assert.equal(
      first.headers.get("cache-control"),
      "private, max-age=0, must-revalidate, no-transform",
    );
    await first.json();

    const cachedConditional = await fetch(`${baseUrl}/api/gex/QQQ`, {
      headers: {
        "accept-encoding": "identity",
        "if-none-match": firstEtag,
      },
    });
    assert.equal(cachedConditional.status, 304);
    assert.equal(await cachedConditional.text(), "");

    __expireGexDashboardCacheForTests("QQQ");
    failRefresh = true;
    const second = await fetch(`${baseUrl}/api/gex/QQQ`, {
      headers: {
        "accept-encoding": "identity",
        "if-modified-since": "Thu, 18 Jun 2026 16:35:48 GMT",
      },
    });
    assert.equal(second.status, 200);
    assert.ok(second.headers.get("etag"));
    assert.equal(second.headers.get("last-modified"), null);
    assert.equal(
      second.headers.get("cache-control"),
      "private, max-age=0, must-revalidate, no-transform",
    );
    assert.match(second.headers.get("vary") ?? "", /accept-encoding/i);
    const stale = await second.json() as GexResponse;
    assert.equal(stale.isStale, true);
    assert.equal(getCachedGexDashboardHttpCacheMetadata("QQQ"), null);
    assert.equal(quoteCalls, 2);
  } finally {
    await closeServer(server);
  }
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
