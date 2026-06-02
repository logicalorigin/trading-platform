import assert from "node:assert/strict";
import test, { after, afterEach, beforeEach } from "node:test";
import { GetGexDashboardResponse } from "@workspace/api-zod";
import {
  __expireGexDashboardCacheForTests,
  __setGexDashboardLoadTimeoutMsForTests,
  __setGexIngestFacadeForTests,
  __setGexMarketDataClientFactoryForTests,
  __setGexPlatformDataClientFactoryForTests,
  getGexDashboardData,
  getGexZeroGammaData,
} from "./gex";

const GEX_MARKET_DATA_ENV_KEYS = [
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
  "MASSIVE_API_BASE_URL",
] as const;
const originalGexMarketDataEnv = Object.fromEntries(
  GEX_MARKET_DATA_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearGexMarketDataEnv(): void {
  GEX_MARKET_DATA_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
}

beforeEach(() => {
  clearGexMarketDataEnv();
});

afterEach(() => {
  __setGexDashboardLoadTimeoutMsForTests(null);
  __setGexIngestFacadeForTests(null);
  __setGexPlatformDataClientFactoryForTests(null);
  __setGexMarketDataClientFactoryForTests(null);
  clearGexMarketDataEnv();
});

after(() => {
  GEX_MARKET_DATA_ENV_KEYS.forEach((key) => {
    if (originalGexMarketDataEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalGexMarketDataEnv[key];
    }
  });
});

function basicQuote(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "SPY",
    price: 100,
    bid: 99.99,
    ask: 100.01,
    bidSize: 1,
    askSize: 1,
    change: 1.25,
    changePercent: 1.25,
    open: 99,
    high: 101,
    low: 99,
    prevClose: 98.75,
    volume: 1000,
    openInterest: null,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    updatedAt: new Date("2026-05-08T15:31:00Z"),
    providerContractId: null,
    transport: "tws",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: new Date("2026-05-08T15:31:00Z"),
    ageMs: null,
    source: "ibkr",
    ...overrides,
  };
}

function option({
  right,
  strike,
  gamma,
  openInterest,
  multiplier = 100,
  underlyingPrice = 100,
  expirationDate = new Date("2026-05-15T00:00:00Z"),
}: {
  right: "call" | "put";
  strike: number;
  gamma: number | null;
  openInterest: number | null;
  multiplier?: number;
  underlyingPrice?: number | null;
  expirationDate?: Date;
}) {
  const expirationKey = expirationDate.toISOString().slice(0, 10).replaceAll("-", "");
  return {
    contract: {
      ticker: `SPY-${expirationKey}-${right}-${strike}`,
      underlying: "SPY",
      expirationDate,
      strike,
      right,
      multiplier,
      sharesPerContract: multiplier,
      providerContractId: `ibkr-${right}-${strike}`,
    },
    bid: 1,
    ask: 1.05,
    last: 1.02,
    mark: 1.025,
    impliedVolatility: 0.2,
    delta: right === "call" ? 0.5 : -0.5,
    gamma,
    theta: null,
    vega: null,
    openInterest,
    volume: 100,
    updatedAt: new Date("2026-05-08T15:30:00Z"),
    quoteFreshness: "live",
    marketDataMode: "live",
    quoteUpdatedAt: new Date("2026-05-08T15:30:00Z"),
    dataUpdatedAt: new Date("2026-05-08T15:30:00Z"),
    ageMs: null,
    underlyingPrice,
  };
}

function referenceOption({
  right,
  strike,
  gamma,
  openInterest,
  multiplier = 100,
}: {
  right: "call" | "put";
  strike: number;
  gamma: number | null;
  openInterest: number | null;
  multiplier?: number;
}) {
  return {
    contract: {
      ticker: `O:SPY260515${right === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
      underlying: "SPY",
      expirationDate: new Date("2026-05-15T00:00:00Z"),
      strike,
      right,
      multiplier,
      sharesPerContract: multiplier,
      providerContractId: null,
    },
    bid: 1,
    ask: 1.05,
    last: 1.02,
    mark: 1.025,
    prevClose: 1,
    change: 0.02,
    changePercent: 2,
    impliedVolatility: 0.2,
    delta: right === "call" ? 0.5 : -0.5,
    gamma,
    theta: null,
    vega: null,
    openInterest,
    volume: 100,
    updatedAt: new Date("2026-05-08T15:30:00Z"),
  };
}

function configureIbkrGex(input: {
  quote?: ReturnType<typeof basicQuote> | null;
  contracts: ReturnType<typeof option>[];
  expirations?: Date[];
  onExpirationsRequest?: (request: unknown) => void;
  onBatchRequest?: (request: unknown) => void;
}) {
  let chainRequests = 0;
  const expirations =
    input.expirations ??
    Array.from(
      new Map(
        input.contracts.map((contract) => [
          contract.contract.expirationDate.toISOString().slice(0, 10),
          contract.contract.expirationDate,
        ]),
      ).values(),
    );
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => ({
      quotes: input.quote === null ? [] : [input.quote ?? basicQuote()],
      transport: "tws",
      delayed: false,
      fallbackUsed: false,
    }),
    getOptionExpirationsWithDebug: async (request: unknown) => {
      input.onExpirationsRequest?.(request);
      return {
        underlying: "SPY",
        expirations: expirations.map((expirationDate) => ({ expirationDate })),
        debug: {
          cacheStatus: "miss",
          totalMs: 1,
          upstreamMs: 1,
          requestedCount: expirations.length,
          returnedCount: expirations.length,
          complete: true,
          capped: false,
        },
      };
    },
    batchOptionChains: async (request: any) => {
      chainRequests += 1;
      input.onBatchRequest?.(request);
      return {
        underlying: "SPY",
        results: request.expirationDates.map((expirationDate: Date) => {
          const expirationKey = expirationDate.toISOString().slice(0, 10);
          const contracts = input.contracts.filter(
            (contract) =>
              contract.contract.expirationDate.toISOString().slice(0, 10) ===
              expirationKey,
          );
          return {
            expirationDate,
            status: "loaded",
            contracts,
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
          returnedCount: input.contracts.length,
        },
      };
    },
  }) as any);

  return {
    get chainRequests() {
      return chainRequests;
    },
  };
}

function configureReferenceGex(input: {
  contracts: ReturnType<typeof referenceOption>[];
  provider?: "massive";
}) {
  if (input.provider === "massive") {
    process.env["MASSIVE_API_KEY"] = "test";
    process.env["MASSIVE_API_BASE_URL"] = "https://api.massive.com";
  } else {
    process.env["MASSIVE_API_KEY"] = "test";
    process.env["MASSIVE_API_BASE_URL"] = "https://api.massive.com";
  }

  let optionChainRequests = 0;
  __setGexMarketDataClientFactoryForTests(() => ({
    getUniverseTickerByTicker: async () => null,
    getTickerMarketCap: async () => null,
    getBarsPage: async () => ({
      bars: [
        {
          timestamp: new Date("2026-05-08T00:00:00Z"),
          open: 99,
          high: 101,
          low: 98,
          close: 100,
          volume: 1_000,
        },
      ],
    }),
    getOptionChain: async () => {
      optionChainRequests += 1;
      return input.contracts;
    },
  }) as any);

  return {
    get optionChainRequests() {
      return optionChainRequests;
    },
  };
}

function persistedGexPayload(overrides: Partial<any> = {}): any {
  return {
    ticker: "SPY",
    tickerDetails: {
      ticker: "SPY",
      name: "SPY",
      sector: "ETF",
      industry: "ETF",
      marketCap: null,
      exchangeShortName: "NYSEARCA",
      country: "US",
      isEtf: true,
      isFund: false,
    },
    profile: {
      price: 100,
      dayLow: 100,
      dayHigh: 100,
      yearLow: null,
      yearHigh: null,
      mktCap: null,
      logo: null,
    },
    spot: 100,
    timestamp: "2026-05-08T15:31:00.000Z",
    isStale: false,
    options: [
      {
        strike: 100,
        expireYear: 2026,
        expireMonth: 5,
        expireDay: 15,
        cp: "C",
        ticker: "SPY-20260515-call-100",
        underlying: "SPY",
        expirationDate: "2026-05-15",
        providerContractId: "ibkr-call-100",
        gamma: 0.02,
        delta: 0.5,
        openInterest: 10,
        impliedVol: 0.2,
        bid: 1,
        ask: 1.05,
        multiplier: 100,
        sharesPerContract: 100,
        volume: 100,
        updatedAt: "2026-05-08T15:30:00.000Z",
        quoteFreshness: "live",
        marketDataMode: "live",
      },
    ],
    snapshots: [{ ts: "2026-05-08T15:31:00.000Z", netGex: 1_000 }],
    flowContext: null,
    flowContextStatus: "unavailable",
    source: {
      provider: "ibkr",
      status: "ok",
      expirationCoverage: {
        requestedCount: 1,
        returnedCount: 1,
        loadedCount: 1,
        failedCount: 0,
        complete: true,
        capped: false,
      },
      optionCount: 1,
      usableOptionCount: 1,
      withGamma: 1,
      withOpenInterest: 1,
      withImpliedVolatility: 1,
      quoteUpdatedAt: "2026-05-08T15:31:00.000Z",
      chainUpdatedAt: "2026-05-08T15:30:00.000Z",
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
    ...overrides,
  };
}

test("GEX dashboard returns a fresh persisted snapshot without option-chain fanout", async () => {
  const enqueued: unknown[] = [];
  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    getLatestGexSnapshot: async () => ({
      payload: persistedGexPayload(),
      computedAt: new Date(),
      ageMs: 100,
      stale: false,
    }),
    enqueueMarketDataJob: async (input) => {
      enqueued.push(input);
      return { queued: true, dedupeKey: "test" };
    },
  });

  const data = await getGexDashboardData({ underlying: "spy" });

  assert.equal(data.ticker, "SPY");
  assert.equal(data.source.status, "ok");
  assert.deepEqual(data.source.expirationCoverage, {
    requestedCount: 1,
    returnedCount: 1,
    loadedCount: 1,
    failedCount: 0,
    complete: true,
    capped: false,
  });
  assert.equal(enqueued.length, 0);
  assert.equal(GetGexDashboardResponse.parse(data).source.provider, "ibkr");
});

test("GEX dashboard backfills expiration coverage for legacy persisted snapshots", async () => {
  const payload = persistedGexPayload();
  delete payload.source.expirationCoverage;
  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    getLatestGexSnapshot: async () => ({
      payload,
      computedAt: new Date(),
      ageMs: 100,
      stale: false,
    }),
    enqueueMarketDataJob: async () => ({ queued: true, dedupeKey: "test" }),
  });

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.deepEqual(data.source.expirationCoverage, {
    requestedCount: 1,
    returnedCount: 1,
    loadedCount: 1,
    failedCount: 0,
    complete: true,
    capped: false,
  });
  assert.equal(GetGexDashboardResponse.parse(data).source.expirationCoverage.complete, true);
});

test("GEX dashboard serves stale persisted data and queues refresh", async () => {
  const enqueued: any[] = [];
  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    getLatestGexSnapshot: async () => ({
      payload: persistedGexPayload(),
      computedAt: new Date(Date.now() - 120_000),
      ageMs: 120_000,
      stale: true,
    }),
    enqueueMarketDataJob: async (input) => {
      enqueued.push(input);
      return { queued: true, dedupeKey: `${input.kind}:SPY` };
    },
  });

  const data = await getGexDashboardData({ underlying: "SPY" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(data.isStale, true);
  assert.equal(data.source.status, "partial");
  assert.deepEqual(data.source.expirationCoverage, {
    requestedCount: 1,
    returnedCount: 1,
    loadedCount: 1,
    failedCount: 0,
    complete: true,
    capped: false,
  });
  assert.match(data.source.message || "", /persisted GEX snapshot/);
  assert.deepEqual(
    enqueued.map((entry) => entry.kind).sort(),
    ["gex_snapshot", "option_chain_snapshot", "stock_snapshot"],
  );
  assert.deepEqual(
    enqueued
      .slice()
      .sort((left, right) => left.priority - right.priority)
      .map((entry) => [entry.kind, entry.priority]),
    [
      ["stock_snapshot", 1],
      ["option_chain_snapshot", 2],
      ["gex_snapshot", 3],
    ],
  );
});

test("GEX dashboard queues ingest and reports pending when no persisted snapshot exists", async () => {
  const enqueued: any[] = [];
  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    getLatestGexSnapshot: async () => null,
    enqueueMarketDataJob: async (input) => {
      enqueued.push(input);
      return { queued: true, dedupeKey: `${input.kind}:SPY` };
    },
  });

  await assert.rejects(
    () => getGexDashboardData({ underlying: "SPY" }),
    (error: any) =>
      error?.statusCode === 503 &&
      error?.code === "gex_snapshot_pending",
  );
  assert.deepEqual(
    enqueued.map((entry) => entry.kind).sort(),
    ["gex_snapshot", "option_chain_snapshot", "stock_snapshot"],
  );
  assert.deepEqual(
    enqueued
      .slice()
      .sort((left, right) => left.priority - right.priority)
      .map((entry) => [entry.kind, entry.priority]),
    [
      ["stock_snapshot", 1],
      ["option_chain_snapshot", 2],
      ["gex_snapshot", 3],
    ],
  );
});

test("GEX zero-gamma overlay returns empty data while persisted snapshot is pending", async () => {
  const enqueued: any[] = [];
  __setGexIngestFacadeForTests({
    isConfigured: () => true,
    getLatestGexSnapshot: async () => null,
    enqueueMarketDataJob: async (input) => {
      enqueued.push(input);
      return { queued: true, dedupeKey: `${input.kind}:SPY` };
    },
  });

  const data = await getGexZeroGammaData({ underlying: "SPY" });

  assert.equal(data.ticker, "SPY");
  assert.equal(data.spot, null);
  assert.equal(data.zeroGamma, null);
  assert.equal(data.asOf, null);
  assert.equal(data.isStale, true);
  assert.equal(data.source.status, "unavailable");
  assert.equal(data.source.optionCount, 0);
  assert.equal(data.source.usableOptionCount, 0);
  assert.match(
    data.source.message || "",
    /market-data ingest worker must hydrate option-chain data/i,
  );
  assert.deepEqual(
    enqueued.map((entry) => entry.kind).sort(),
    ["gex_snapshot", "option_chain_snapshot", "stock_snapshot"],
  );
});

test("GEX dashboard data is sourced from IBKR quotes, expirations, and full option-chain batches", async () => {
  let batchRequest: any = null;
  configureIbkrGex({
    contracts: [
      option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
      option({ right: "put", strike: 95, gamma: 0.01, openInterest: 10 }),
    ],
    onBatchRequest: (request) => {
      batchRequest = request;
    },
  });

  const data = await getGexDashboardData({ underlying: "spy" });

  assert.equal(batchRequest.underlying, "SPY");
  assert.equal(batchRequest.strikeCoverage, "full");
  assert.equal(batchRequest.quoteHydration, "snapshot");
  assert.deepEqual(batchRequest.expirationDates, [new Date("2026-05-15T00:00:00Z")]);
  assert.equal(data.ticker, "SPY");
  assert.equal(data.source.provider, "ibkr");
  assert.equal(data.source.status, "ok");
  assert.deepEqual(data.source.expirationCoverage, {
    requestedCount: 1,
    returnedCount: 1,
    loadedCount: 1,
    failedCount: 0,
    complete: true,
    capped: false,
  });
  assert.equal(data.options.length, 2);
  assert.equal(data.options[0].providerContractId, "ibkr-call-100");
  assert.equal(data.options[0].multiplier, 100);
  assert.equal(data.profile.price, 100);
  assert.equal(data.profile.dayLow, 99);
  assert.equal(data.profile.dayHigh, 101);
  assert.equal(data.flowContextStatus, "unavailable");
  assert.equal(data.flowContext, null);
  assert.equal(data.source.flowStatus, "unavailable");
  assert.equal(data.snapshots.length, 1);
  assert.equal(data.snapshots[0].netGex, 1_000);
  const parsed = GetGexDashboardResponse.parse(data);
  assert.equal(parsed.source.provider, "ibkr");
  assert.equal((parsed.options[0] as any).providerContractId, "ibkr-call-100");
});

test("GEX requests all option expirations without capping and batches every expiration", async () => {
  const firstExpiration = new Date("2026-05-15T00:00:00Z");
  const secondExpiration = new Date("2026-05-22T00:00:00Z");
  let expirationsRequest: any = null;
  let batchRequest: any = null;
  configureIbkrGex({
    expirations: [firstExpiration, secondExpiration],
    contracts: [
      option({
        right: "call",
        strike: 100,
        gamma: 0.02,
        openInterest: 10,
        expirationDate: firstExpiration,
      }),
      option({
        right: "put",
        strike: 98,
        gamma: 0.01,
        openInterest: 12,
        expirationDate: secondExpiration,
      }),
    ],
    onExpirationsRequest: (request) => {
      expirationsRequest = request;
    },
    onBatchRequest: (request) => {
      batchRequest = request;
    },
  });

  const data = await getGexDashboardData({ underlying: "spy" });

  assert.equal(expirationsRequest.underlying, "SPY");
  assert.equal("maxExpirations" in expirationsRequest, false);
  assert.deepEqual(batchRequest.expirationDates, [firstExpiration, secondExpiration]);
  assert.equal(batchRequest.strikeCoverage, "full");
  assert.equal(batchRequest.quoteHydration, "snapshot");
  assert.deepEqual(data.source.expirationCoverage, {
    requestedCount: 2,
    returnedCount: 2,
    loadedCount: 2,
    failedCount: 0,
    complete: true,
    capped: false,
  });
  assert.equal(data.source.status, "ok");
  assert.equal(GetGexDashboardResponse.parse(data).source.expirationCoverage.loadedCount, 2);
});

test("GEX zero-gamma endpoint returns a compact overlay payload", async () => {
  configureIbkrGex({
    contracts: [
      option({ right: "put", strike: 95, gamma: 0.02, openInterest: 10 }),
      option({ right: "call", strike: 105, gamma: 0.02, openInterest: 20 }),
    ],
  });

  const data = await getGexZeroGammaData({ underlying: "spy" });

  assert.equal(data.ticker, "SPY");
  assert.equal(data.spot, 100);
  assert.ok(data.zeroGamma != null && data.zeroGamma > 95 && data.zeroGamma < 105);
  assert.equal(data.asOf, "2026-05-08T15:30:00.000Z");
  assert.equal(data.source.provider, "ibkr");
  assert.equal(data.source.optionCount, 2);
  assert.equal("options" in data, false);
  assert.equal("snapshots" in data, false);
});

test("GEX keeps option-chain snapshots on IBKR when Massive reference data is configured", async () => {
  const ibkr = configureIbkrGex({
    contracts: [
      option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
    ],
  });
  const reference = configureReferenceGex({
    provider: "massive",
    contracts: [
      referenceOption({
        right: "call",
        strike: 100,
        gamma: 0.02,
        openInterest: 10,
      }),
      referenceOption({
        right: "put",
        strike: 95,
        gamma: 0.01,
        openInterest: 10,
      }),
    ],
  });

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(reference.optionChainRequests, 0);
  assert.equal(ibkr.chainRequests, 1);
  assert.equal(data.source.provider, "ibkr");
  assert.equal(data.source.status, "ok");
  assert.equal(data.options.length, 1);
  assert.equal(data.options[0].providerContractId, "ibkr-call-100");
  assert.equal(data.options[0].quoteFreshness, "live");
  assert.equal(data.options[0].marketDataMode, "live");
  assert.equal(GetGexDashboardResponse.parse(data).source.provider, "ibkr");
});

test("GEX does not request Massive reference option snapshots for live option data", async () => {
  const ibkr = configureIbkrGex({
    contracts: [
      option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
    ],
  });
  const reference = configureReferenceGex({
    provider: "massive",
    contracts: [
      referenceOption({
        right: "call",
        strike: 100,
        gamma: null,
        openInterest: 10,
      }),
    ],
  });

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(reference.optionChainRequests, 0);
  assert.equal(ibkr.chainRequests, 1);
  assert.equal(data.source.provider, "ibkr");
  assert.equal(data.options.length, 1);
  assert.equal(data.options[0].providerContractId, "ibkr-call-100");
});

test("GEX skips contracts without required gamma or open interest and marks source partial", async () => {
  configureIbkrGex({
    contracts: [
      option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
      option({ right: "put", strike: 95, gamma: null, openInterest: 10 }),
    ],
  });

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.source.optionCount, 2);
  assert.equal(data.source.usableOptionCount, 1);
  assert.equal(data.options.length, 1);
  assert.equal(data.source.status, "partial");
});

test("GEX uses the contract multiplier when computing snapshot net exposure", async () => {
  configureIbkrGex({
    contracts: [
      option({
        right: "call",
        strike: 100,
        gamma: 0.02,
        openInterest: 10,
        multiplier: 50,
      }),
    ],
  });

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.options[0].multiplier, 50);
  assert.equal(data.snapshots[0].netGex, 1_000);
});

test("GEX can use option-chain underlying price when the quote snapshot is missing", async () => {
  configureIbkrGex({
    quote: null,
    contracts: [
      option({
        right: "call",
        strike: 100,
        gamma: 0.02,
        openInterest: 10,
        underlyingPrice: 101,
      }),
    ],
  });

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.spot, 101);
  assert.equal(data.profile.price, 101);
  assert.equal(data.source.status, "partial");
});

test("GEX uses live Massive stock spot with IBKR option-chain data", async () => {
  configureIbkrGex({
    quote: basicQuote({ price: 999, source: "massive" }),
    contracts: [
      option({
        right: "call",
        strike: 100,
        gamma: 0.02,
        openInterest: 10,
        underlyingPrice: 101,
      }),
    ],
  });

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.spot, 999);
  assert.equal(data.profile.price, 999);
  assert.equal(data.source.provider, "ibkr");
  assert.equal(data.source.status, "ok");
});

test("GEX ignores delayed non-IBKR quote fallback for live spot", async () => {
  configureIbkrGex({
    quote: basicQuote({
      price: 999,
      source: "massive",
      delayed: true,
      freshness: "delayed",
      marketDataMode: "delayed",
    }),
    contracts: [
      option({
        right: "call",
        strike: 100,
        gamma: 0.02,
        openInterest: 10,
        underlyingPrice: 101,
      }),
    ],
  });

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.spot, 101);
  assert.equal(data.profile.price, 101);
  assert.equal(data.source.provider, "ibkr");
  assert.equal(data.source.status, "partial");
});

test("GEX marks source partial when an expiration batch is degraded", async () => {
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => ({
      quotes: [basicQuote()],
      transport: "tws",
      delayed: false,
      fallbackUsed: false,
    }),
    getOptionExpirationsWithDebug: async () => ({
      underlying: "SPY",
      expirations: [
        { expirationDate: new Date("2026-05-15T00:00:00Z") },
        { expirationDate: new Date("2026-05-22T00:00:00Z") },
      ],
      debug: {
        cacheStatus: "miss",
        totalMs: 1,
        upstreamMs: 1,
        requestedCount: 2,
        returnedCount: 2,
        complete: false,
        capped: true,
      },
    }),
    batchOptionChains: async () => ({
      underlying: "SPY",
      results: [
        {
          expirationDate: new Date("2026-05-15T00:00:00Z"),
          status: "loaded",
          contracts: [
            option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
          ],
          error: null,
        },
        {
          expirationDate: new Date("2026-05-22T00:00:00Z"),
          status: "failed",
          contracts: [],
          error: "IBKR returned an empty option chain.",
        },
      ],
      debug: {
        cacheStatus: "miss",
        totalMs: 1,
        upstreamMs: 1,
        requestedCount: 2,
        returnedCount: 1,
      },
    }),
  }) as any);

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.options.length, 1);
  assert.equal(data.source.status, "partial");
  assert.deepEqual(data.source.expirationCoverage, {
    requestedCount: 2,
    returnedCount: 2,
    loadedCount: 1,
    failedCount: 1,
    complete: false,
    capped: true,
  });
});

test("GEX coalesces and caches full-chain dashboard loads per ticker", async () => {
  const fixture = configureIbkrGex({
    contracts: [
      option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
    ],
  });

  const [first, second] = await Promise.all([
    getGexDashboardData({ underlying: "SPY" }),
    getGexDashboardData({ underlying: "spy" }),
  ]);
  const third = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(fixture.chainRequests, 1);
});

test("GEX preserves same-session snapshots across dashboard refreshes", async () => {
  let chainRequests = 0;
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => ({
      quotes: [basicQuote()],
      transport: "tws",
      delayed: false,
      fallbackUsed: false,
    }),
    getOptionExpirationsWithDebug: async () => ({
      underlying: "SPY",
      expirations: [{ expirationDate: new Date("2026-05-15T00:00:00Z") }],
      debug: {
        cacheStatus: "miss",
        totalMs: 1,
        upstreamMs: 1,
        requestedCount: 1,
        returnedCount: 1,
        complete: true,
        capped: false,
      },
    }),
    batchOptionChains: async () => {
      chainRequests += 1;
      return {
        underlying: "SPY",
        results: [
          {
            expirationDate: new Date("2026-05-15T00:00:00Z"),
            status: "loaded",
            contracts: [
              option({
                right: "call",
                strike: 100,
                gamma: chainRequests === 1 ? 0.01 : 0.03,
                openInterest: 10,
              }),
            ],
            error: null,
          },
        ],
        debug: {
          cacheStatus: "miss",
          totalMs: 1,
          upstreamMs: 1,
          requestedCount: 1,
          returnedCount: 1,
        },
      };
    },
  }) as any);

  const first = await getGexDashboardData({ underlying: "SPY" });
  __expireGexDashboardCacheForTests("SPY");
  await new Promise((resolve) => setTimeout(resolve, 2));
  const stale = await getGexDashboardData({ underlying: "SPY" });
  let second = stale;
  for (let attempt = 0; attempt < 10 && second.snapshots.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    second = await getGexDashboardData({ underlying: "SPY" });
  }

  assert.equal(first.snapshots.length, 1);
  assert.equal(stale.snapshots.length, 1);
  assert.equal(second.snapshots.length, 2);
  assert.deepEqual(
    second.snapshots.map((snapshot) => snapshot.netGex),
    [1_000, 3_000],
  );
});

test("GEX returns stale cached zero-gamma data while a refresh is stuck", async () => {
  let hangChain = false;
  let chainRequests = 0;
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => ({
      quotes: [basicQuote()],
      transport: "tws",
      delayed: false,
      fallbackUsed: false,
    }),
    getOptionExpirationsWithDebug: async () => ({
      underlying: "SPY",
      expirations: [{ expirationDate: new Date("2026-05-15T00:00:00Z") }],
      debug: {
        cacheStatus: "miss",
        totalMs: 1,
        upstreamMs: 1,
        requestedCount: 1,
        returnedCount: 1,
        complete: true,
        capped: false,
      },
    }),
    batchOptionChains: async () => {
      chainRequests += 1;
      if (hangChain) {
        return new Promise(() => {});
      }
      return {
        underlying: "SPY",
        results: [
          {
            expirationDate: new Date("2026-05-15T00:00:00Z"),
            status: "loaded",
            contracts: [
              option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
            ],
            error: null,
          },
        ],
        debug: {
          cacheStatus: "miss",
          totalMs: 1,
          upstreamMs: 1,
          requestedCount: 1,
          returnedCount: 1,
        },
      };
    },
  }) as any);

  const first = await getGexDashboardData({ underlying: "SPY" });
  __setGexDashboardLoadTimeoutMsForTests(20);
  __expireGexDashboardCacheForTests("SPY");
  hangChain = true;

  const startedAt = Date.now();
  const second = await getGexDashboardData({ underlying: "SPY" });
  const third = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(first.source.status, "ok");
  assert.equal(second.isStale, true);
  assert.equal(second.source.status, "partial");
  assert.match(second.source.message || "", /previous zero-gamma dashboard/);
  assert.equal(third.isStale, true);
  assert.ok(Date.now() - startedAt < 100, "stale GEX should return immediately");
  assert.ok(chainRequests >= 1);
});
