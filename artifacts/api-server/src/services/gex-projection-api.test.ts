import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  __setGexChartProjectionChainWaitMsForTests,
  __setGexChartProjectionQuoteWaitMsForTests,
  __setGexChartProjectionSnapshotWaitMsForTests,
  __setGexIngestFacadeForTests,
  __setGexPlatformDataClientFactoryForTests,
  __setGexProjectionRatesProviderForTests,
  getGexProjectionData,
  type GexResponse,
} from "./gex";
import { OPTION_EXPIRATION_PUBLIC_FOREGROUND_WAIT_MS } from "./platform";

function option(strike: number, cp: "C" | "P", expirationDate = "2026-06-19") {
  const expirationParts = expirationDate.split("-").map((part) => Number(part));
  const expireYear = expirationParts[0] ?? 0;
  const expireMonth = expirationParts[1] ?? 0;
  const expireDay = expirationParts[2] ?? 0;
  return {
    strike,
    expireYear,
    expireMonth,
    expireDay,
    cp,
    ticker: `SPY-${expirationDate}-${cp}-${strike}`,
    underlying: "SPY",
    expirationDate,
    providerContractId: `contract-${expirationDate}-${cp}-${strike}`,
    gamma: 0.02,
    delta: cp === "C" ? 0.5 : -0.5,
    openInterest: 100,
    impliedVol: 0.28,
    bid: 1,
    ask: 1.2,
    multiplier: 100,
    sharesPerContract: 100,
    volume: 10,
    updatedAt: "2026-05-31T15:25:00.000Z",
    quoteFreshness: null,
    marketDataMode: "live",
  };
}

function dashboardPayload(input: { expirationDates?: string[] } = {}): GexResponse {
  const expirationDates = input.expirationDates?.length
    ? input.expirationDates
    : ["2026-06-19"];
  const options = expirationDates.flatMap((expirationDate) =>
    [80, 85, 90, 95, 100, 105, 110, 115, 120].flatMap((strike) => [
      option(strike, "C", expirationDate),
      option(strike, "P", expirationDate),
    ]),
  );

  return {
    ticker: "SPY",
    tickerDetails: {
      ticker: "SPY",
      name: "SPDR S&P 500 ETF Trust",
      sector: "",
      industry: "",
      marketCap: null,
      exchangeShortName: "ARCX",
      country: "US",
      isEtf: true,
      isFund: false,
    },
    profile: {
      price: 100,
      dayLow: 99,
      dayHigh: 101,
      yearLow: null,
      yearHigh: null,
      mktCap: null,
    },
    spot: 100,
    timestamp: "2026-05-31T15:30:00.000Z",
    isStale: false,
    options,
    snapshots: [{ ts: "2026-05-31T15:30:00.000Z", netGex: 0 }],
    flowContext: null,
    flowContextStatus: "unavailable",
    source: {
      provider: "massive",
      status: "ok",
      expirationCoverage: {
        requestedCount: expirationDates.length,
        returnedCount: expirationDates.length,
        loadedCount: expirationDates.length,
        failedCount: 0,
        complete: true,
        capped: false,
      },
      optionCount: options.length,
      usableOptionCount: options.length,
      withGamma: options.length,
      withOpenInterest: options.length,
      withImpliedVolatility: options.length,
      quoteUpdatedAt: "2026-05-31T15:29:00.000Z",
      chainUpdatedAt: "2026-05-31T15:25:00.000Z",
      flowStatus: "unavailable",
      flowEventCount: 0,
      classifiedFlowEventCount: 0,
      flowClassificationCoverage: 0,
      flowClassificationBasisCounts: { quoteMatch: 0, tickTest: 0, none: 0 },
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

function futureExpiration(daysFromNow: number): Date {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function futureExpirationKey(daysFromNow: number): string {
  return futureExpiration(daysFromNow).toISOString().slice(0, 10);
}

function releaseMaybe(release: (() => void) | null): void {
  if (release) {
    release();
  }
}

function chainContract(
  expirationDate: Date,
  strike: number,
  right: "call" | "put",
) {
  const expirationKey = expirationDate.toISOString().slice(0, 10);
  return {
    contract: {
      ticker: `SPY-${expirationKey}-${strike}-${right === "call" ? "C" : "P"}`,
      underlying: "SPY",
      expirationDate,
      strike,
      right,
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: `${expirationKey}-${strike}-${right}`,
    },
    bid: 1,
    ask: 1.2,
    last: 1.1,
    mark: 1.1,
    impliedVolatility: 0.28,
    delta: right === "call" ? 0.5 : -0.5,
    gamma: 0.02,
    theta: -0.01,
    vega: 0.08,
    openInterest: 100,
    volume: 10,
    updatedAt: new Date(),
    quoteFreshness: "live",
    marketDataMode: "live",
  };
}

afterEach(() => {
  __setGexChartProjectionChainWaitMsForTests(null);
  __setGexChartProjectionQuoteWaitMsForTests(null);
  __setGexChartProjectionSnapshotWaitMsForTests(null);
  __setGexIngestFacadeForTests(null);
  __setGexPlatformDataClientFactoryForTests(null);
  __setGexProjectionRatesProviderForTests(null);
});

test("getGexProjectionData builds a projection from persisted GEX snapshots", async () => {
  const enqueued: string[] = [];
  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    enqueueMarketDataJob: async (input) => {
      enqueued.push(input.kind);
      return { queued: true, dedupeKey: input.kind };
    },
    getLatestGexSnapshot: async () => ({
      payload: dashboardPayload(),
      computedAt: new Date("2026-05-31T15:30:00.000Z"),
      ageMs: 1_000,
      stale: false,
    }),
  });
  __setGexProjectionRatesProviderForTests(async () => ({
    status: "ok",
    source: "treasury_daily_par_yield_curve",
    asOf: "2026-05-29",
    points: [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 1, rate: 0.047 },
    ],
  }));

  const projection = await getGexProjectionData({ underlying: "spy" });

  assert.equal(projection.ticker, "SPY");
  assert.equal(projection.model.pricingInput, "provider_iv");
  assert.equal(projection.rates.status, "ok");
  assert.equal(projection.dividendYield.status, "unavailable");
  assert.equal(projection.expirations.length, 1);
  assert.equal(projection.overlayPoints.length, 1);
  assert.equal(enqueued.length, 0);
});

test("getGexProjectionData chart scope uses a compact projection workload", async () => {
  const expirations = [7, 14, 21, 28, 35, 42].map(futureExpiration);
  const contracts = expirations.flatMap((expirationDate) =>
    [80, 85, 90, 95, 100, 105, 110, 115, 120].flatMap((strike) => [
      chainContract(expirationDate, strike, "call"),
      chainContract(expirationDate, strike, "put"),
    ]),
  );
  let expirationsRequest: any = null;
  let batchRequest: any = null;

  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => ({
      quotes: [
        {
          symbol: "SPY",
          price: 100,
          dataUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          freshness: "live",
          marketDataMode: "live",
          delayed: false,
        },
      ],
      transport: "tws",
      delayed: false,
      fallbackUsed: false,
    }),
    getOptionExpirationsWithDebug: async (request: any) => {
      expirationsRequest = request;
      const selected = expirations.slice(0, request.maxExpirations ?? expirations.length);
      return {
        underlying: "SPY",
        expirations: selected.map((expirationDate) => ({ expirationDate })),
        debug: {
          cacheStatus: "miss",
          totalMs: 1,
          upstreamMs: 1,
          requestedCount: expirations.length,
          returnedCount: selected.length,
          complete: false,
          capped: true,
        },
      };
    },
    batchOptionChains: async (request: any) => {
      batchRequest = request;
      return {
        underlying: "SPY",
        results: request.expirationDates.map((expirationDate: Date) => {
          const expirationKey = expirationDate.toISOString().slice(0, 10);
          return {
            expirationDate,
            status: "loaded",
            contracts: contracts.filter(
              (contract) =>
                contract.contract.expirationDate.toISOString().slice(0, 10) ===
                expirationKey,
            ),
            error: null,
            debug: {
              cacheStatus: "miss",
              totalMs: 1,
              upstreamMs: 1,
            },
          };
        }),
        debug: {
          cacheStatus: "miss",
          totalMs: 1,
          upstreamMs: 1,
          requestedCount: request.expirationDates.length,
          returnedCount: contracts.length,
        },
      };
    },
  }) as any);
  __setGexProjectionRatesProviderForTests(async () => ({
    status: "ok",
    source: "treasury_daily_par_yield_curve",
    asOf: new Date().toISOString().slice(0, 10),
    points: [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 1, rate: 0.047 },
    ],
  }));

  const projection = await getGexProjectionData({
    underlying: "spy",
    scope: "chart",
  });

  assert.equal(expirationsRequest?.maxExpirations, 4);
  assert.equal(typeof expirationsRequest?.foregroundWaitMs, "number");
  assert.equal(
    expirationsRequest.foregroundWaitMs <=
      OPTION_EXPIRATION_PUBLIC_FOREGROUND_WAIT_MS,
    true,
  );
  assert.equal(batchRequest?.strikeCoverage, "standard");
  assert.equal(batchRequest?.strikesAroundMoney, 8);
  assert.equal(batchRequest?.expirationDates.length, 4);
  assert.equal(projection.expirations.length, 4);
  assert.equal(projection.overlayPoints.length, 4);
  assert.equal(projection.source.expirationCoverage?.complete, true);
  assert.equal(projection.source.expirationCoverage?.capped, false);
});

test("getGexProjectionData chart scope returns quickly when compact chains exceed budget", async () => {
  __setGexChartProjectionChainWaitMsForTests(10);
  const expirationDate = futureExpiration(7);
  let batchRequestCount = 0;
  let chainSignalAborted = false;
  let releaseChain: (() => void) | null = null;
  const chainReleased = new Promise<void>((resolve) => {
    releaseChain = resolve;
  });

  __setGexIngestFacadeForTests({
    isConfigured: () => false,
  });
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => ({
      quotes: [
        {
          symbol: "SPY",
          price: 100,
          dataUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          freshness: "live",
          marketDataMode: "live",
          delayed: false,
        },
      ],
      transport: "tws",
      delayed: false,
      fallbackUsed: false,
    }),
    getOptionExpirationsWithDebug: async () => ({
      underlying: "SPY",
      expirations: [{ expirationDate }],
      debug: {
        cacheStatus: "hit",
        totalMs: 1,
        upstreamMs: null,
        requestedCount: 1,
        returnedCount: 1,
        complete: true,
        capped: false,
      },
    }),
    batchOptionChains: async (request: { signal?: AbortSignal }) => {
      batchRequestCount += 1;
      chainSignalAborted = Boolean(request.signal?.aborted);
      request.signal?.addEventListener(
        "abort",
        () => {
          chainSignalAborted = true;
        },
        { once: true },
      );
      await chainReleased;
      return {
        underlying: "SPY",
        results: [],
        debug: {
          cacheStatus: "miss",
          totalMs: 1,
          upstreamMs: 1,
          requestedCount: 1,
          returnedCount: 0,
        },
      };
    },
  }) as any);
  __setGexProjectionRatesProviderForTests(async () => ({
    status: "ok",
    source: "treasury_daily_par_yield_curve",
    asOf: new Date().toISOString().slice(0, 10),
    points: [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 1, rate: 0.047 },
    ],
  }));

  const startedAt = Date.now();
  try {
    const projection = await getGexProjectionData({
      underlying: "spy",
      scope: "chart",
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(batchRequestCount, 1);
    assert.equal(elapsedMs < 500, true);
    assert.equal(chainSignalAborted, true);
    assert.equal(projection.expirations.length, 0);
    assert.equal(projection.overlayPoints.length, 0);
    assert.match(
      projection.rates.message || "",
      /Compact option-chain data did not respond/,
    );
  } finally {
    releaseMaybe(releaseChain);
  }
});

test("getGexProjectionData chart scope bounds slow snapshot fallback after empty compact chains", async () => {
  __setGexChartProjectionSnapshotWaitMsForTests(10);
  const expirationDate = futureExpiration(7);
  let snapshotRequestCount = 0;
  let releaseSnapshot: (() => void) | null = null;
  const snapshotReleased = new Promise<void>((resolve) => {
    releaseSnapshot = resolve;
  });

  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    enqueueMarketDataJob: async (input) => ({
      queued: true,
      dedupeKey: input.kind,
    }),
    getLatestGexSnapshot: async () => {
      snapshotRequestCount += 1;
      await snapshotReleased;
      return null;
    },
  });
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => ({
      quotes: [
        {
          symbol: "SPY",
          price: 100,
          dataUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          freshness: "live",
          marketDataMode: "live",
          delayed: false,
        },
      ],
      transport: "tws",
      delayed: false,
      fallbackUsed: false,
    }),
    getOptionExpirationsWithDebug: async () => ({
      underlying: "SPY",
      expirations: [{ expirationDate }],
      debug: {
        cacheStatus: "hit",
        totalMs: 1,
        upstreamMs: null,
        requestedCount: 1,
        returnedCount: 1,
        complete: true,
        capped: false,
      },
    }),
    batchOptionChains: async () => ({
      underlying: "SPY",
      results: [
        {
          expirationDate,
          status: "failed",
          contracts: [],
          error: "empty chain",
          debug: {
            cacheStatus: "hit",
            totalMs: 1,
            upstreamMs: null,
            degraded: true,
            reason: "options_successful_empty",
          },
        },
      ],
      debug: {
        cacheStatus: "hit",
        totalMs: 1,
        upstreamMs: null,
        requestedCount: 1,
        returnedCount: 0,
      },
    }),
  }) as any);
  __setGexProjectionRatesProviderForTests(async () => ({
    status: "ok",
    source: "treasury_daily_par_yield_curve",
    asOf: new Date().toISOString().slice(0, 10),
    points: [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 1, rate: 0.047 },
    ],
  }));

  const startedAt = Date.now();
  try {
    const projection = await getGexProjectionData({
      underlying: "spy",
      scope: "chart",
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(snapshotRequestCount, 1);
    assert.equal(elapsedMs < 600, true);
    assert.equal(projection.expirations.length, 0);
    assert.equal(projection.overlayPoints.length, 0);
    assert.match(
      projection.rates.message || "",
      /Near-expiration option data is unavailable/,
    );
  } finally {
    releaseMaybe(releaseSnapshot);
  }
});

test("getGexProjectionData chart scope tolerates a cold persisted snapshot read", async () => {
  const expirationDate = futureExpirationKey(7);
  let platformRequestCount = 0;

  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    enqueueMarketDataJob: async () => ({ queued: true, dedupeKey: "gex" }),
    getLatestGexSnapshot: async () => {
      await new Promise((resolve) => setTimeout(resolve, 4_500));
      return {
        payload: dashboardPayload({ expirationDates: [expirationDate] }),
        computedAt: new Date("2026-05-31T15:30:00.000Z"),
        ageMs: 1_000,
        stale: false,
      };
    },
  });
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => {
      platformRequestCount += 1;
      throw new Error("chart projection should wait for persisted GEX first");
    },
    getOptionExpirationsWithDebug: async () => {
      platformRequestCount += 1;
      throw new Error("chart projection should wait for persisted GEX first");
    },
    batchOptionChains: async () => {
      platformRequestCount += 1;
      throw new Error("chart projection should wait for persisted GEX first");
    },
  }) as any);
  __setGexProjectionRatesProviderForTests(async () => ({
    status: "ok",
    source: "treasury_daily_par_yield_curve",
    asOf: new Date().toISOString().slice(0, 10),
    points: [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 1, rate: 0.047 },
    ],
  }));

  const projection = await getGexProjectionData({
    underlying: "spy",
    scope: "chart",
  });

  assert.equal(platformRequestCount, 0);
  assert.equal(projection.expirations.length, 1);
  assert.equal(projection.overlayPoints.length, 1);
});

test("getGexProjectionData chart scope prefers compact persisted snapshots", async () => {
  const expirationDate = futureExpirationKey(7);
  let compactSnapshotRequest:
    | {
        symbol: string;
        maxAgeMs: number;
        maxExpirations: number;
        strikesAroundMoney: number;
      }
    | null = null;
  let fullSnapshotRequestCount = 0;

  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    enqueueMarketDataJob: async () => ({ queued: true, dedupeKey: "gex" }),
    getLatestChartGexSnapshot: async (symbol, maxAgeMs, options) => {
      compactSnapshotRequest = {
        symbol,
        maxAgeMs,
        maxExpirations: options.maxExpirations,
        strikesAroundMoney: options.strikesAroundMoney,
      };
      return {
        payload: dashboardPayload({ expirationDates: [expirationDate] }),
        computedAt: new Date("2026-05-31T15:30:00.000Z"),
        ageMs: 1_000,
        stale: false,
      };
    },
    getLatestGexSnapshot: async () => {
      fullSnapshotRequestCount += 1;
      throw new Error("chart projection should not read the full GEX snapshot");
    },
  });
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => {
      throw new Error("chart projection should use compact GEX first");
    },
    getOptionExpirationsWithDebug: async () => {
      throw new Error("chart projection should use compact GEX first");
    },
    batchOptionChains: async () => {
      throw new Error("chart projection should use compact GEX first");
    },
  }) as any);
  __setGexProjectionRatesProviderForTests(async () => ({
    status: "ok",
    source: "treasury_daily_par_yield_curve",
    asOf: new Date().toISOString().slice(0, 10),
    points: [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 1, rate: 0.047 },
    ],
  }));

  const projection = await getGexProjectionData({
    underlying: "spy",
    scope: "chart",
  });

  assert.deepEqual(compactSnapshotRequest, {
    symbol: "SPY",
    maxAgeMs: 60_000,
    maxExpirations: 8,
    strikesAroundMoney: 8,
  });
  assert.equal(fullSnapshotRequestCount, 0);
  assert.equal(projection.expirations.length, 1);
  assert.equal(projection.overlayPoints.length, 1);
});

test("getGexProjectionData chart scope skips compact chains when quote exceeds budget", async () => {
  __setGexChartProjectionQuoteWaitMsForTests(10);
  const expirationDate = futureExpiration(7);
  let quoteRequestCount = 0;
  let expirationsRequestCount = 0;
  let batchRequestCount = 0;
  let releaseQuote: (() => void) | null = null;
  const quoteReleased = new Promise<void>((resolve) => {
    releaseQuote = resolve;
  });

  __setGexIngestFacadeForTests({
    isConfigured: () => false,
  });
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => {
      quoteRequestCount += 1;
      await quoteReleased;
      return {
        quotes: [
          {
            symbol: "SPY",
            price: 100,
            dataUpdatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            freshness: "live",
            marketDataMode: "live",
            delayed: false,
          },
        ],
        transport: "tws",
        delayed: false,
        fallbackUsed: false,
      };
    },
    getOptionExpirationsWithDebug: async () => {
      expirationsRequestCount += 1;
      return {
        underlying: "SPY",
        expirations: [{ expirationDate }],
        debug: {
          cacheStatus: "hit",
          totalMs: 1,
          upstreamMs: null,
          requestedCount: 1,
          returnedCount: 1,
          complete: true,
          capped: false,
        },
      };
    },
    batchOptionChains: async () => {
      batchRequestCount += 1;
      return {
        underlying: "SPY",
        results: [],
        debug: {
          cacheStatus: "miss",
          totalMs: 1,
          upstreamMs: 1,
          requestedCount: 1,
          returnedCount: 0,
        },
      };
    },
  }) as any);
  __setGexProjectionRatesProviderForTests(async () => ({
    status: "ok",
    source: "treasury_daily_par_yield_curve",
    asOf: new Date().toISOString().slice(0, 10),
    points: [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 1, rate: 0.047 },
    ],
  }));

  const startedAt = Date.now();
  try {
    const projection = await getGexProjectionData({
      underlying: "spy",
      scope: "chart",
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(quoteRequestCount, 1);
    assert.equal(expirationsRequestCount, 1);
    assert.equal(batchRequestCount, 0);
    assert.equal(elapsedMs < 500, true);
    assert.equal(projection.expirations.length, 0);
    assert.equal(projection.overlayPoints.length, 0);
    assert.match(
      projection.rates.message || "",
      /live quote did not respond inside the chart projection budget/i,
    );
  } finally {
    releaseMaybe(releaseQuote);
  }
});

test("getGexProjectionData chart scope keeps a wider persisted snapshot horizon", async () => {
  const expirationDates = [1, 2, 3, 4, 5, 7, 10, 14, 21].map(
    futureExpirationKey,
  );
  let platformRequestCount = 0;

  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    enqueueMarketDataJob: async () => ({ queued: true, dedupeKey: "gex" }),
    getLatestGexSnapshot: async () => ({
      payload: dashboardPayload({ expirationDates }),
      computedAt: new Date("2026-05-31T15:30:00.000Z"),
      ageMs: 1_000,
      stale: false,
    }),
  });
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => {
      platformRequestCount += 1;
      throw new Error("chart projection should use persisted GEX first");
    },
    getOptionExpirationsWithDebug: async () => {
      platformRequestCount += 1;
      throw new Error("chart projection should use persisted GEX first");
    },
    batchOptionChains: async () => {
      platformRequestCount += 1;
      throw new Error("chart projection should use persisted GEX first");
    },
  }) as any);
  __setGexProjectionRatesProviderForTests(async () => ({
    status: "ok",
    source: "treasury_daily_par_yield_curve",
    asOf: new Date().toISOString().slice(0, 10),
    points: [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 1, rate: 0.047 },
    ],
  }));

  const projection = await getGexProjectionData({
    underlying: "spy",
    scope: "chart",
  });

  assert.equal(platformRequestCount, 0);
  assert.equal(projection.expirations.length, 8);
  assert.equal(projection.overlayPoints.length, 8);
  assert.deepEqual(
    projection.overlayPoints.map((point) => point.expirationDate),
    expirationDates.slice(0, 8),
  );
});

test("getGexProjectionData chart scope prefers the latest persisted GEX snapshot", async () => {
  const enqueued: string[] = [];
  let platformRequestCount = 0;

  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    enqueueMarketDataJob: async (input) => {
      enqueued.push(input.kind);
      return { queued: true, dedupeKey: input.kind };
    },
    getLatestGexSnapshot: async () => ({
      payload: dashboardPayload(),
      computedAt: new Date("2026-05-31T15:30:00.000Z"),
      ageMs: 1_000,
      stale: false,
    }),
  });
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => {
      platformRequestCount += 1;
      throw new Error("chart projection should use persisted GEX first");
    },
    getOptionExpirationsWithDebug: async () => {
      platformRequestCount += 1;
      throw new Error("chart projection should use persisted GEX first");
    },
    batchOptionChains: async () => {
      platformRequestCount += 1;
      throw new Error("chart projection should use persisted GEX first");
    },
  }) as any);
  __setGexProjectionRatesProviderForTests(async () => ({
    status: "ok",
    source: "treasury_daily_par_yield_curve",
    asOf: new Date().toISOString().slice(0, 10),
    points: [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 1, rate: 0.047 },
    ],
  }));

  const projection = await getGexProjectionData({
    underlying: "spy",
    scope: "chart",
  });

  assert.equal(platformRequestCount, 0);
  assert.equal(projection.ticker, "SPY");
  assert.equal(projection.source.optionCount, 18);
  assert.equal(projection.expirations.length, 1);
  assert.equal(projection.overlayPoints.length, 1);
  assert.equal(projection.quality.status, "partial");
  assert.deepEqual(enqueued, []);
});
