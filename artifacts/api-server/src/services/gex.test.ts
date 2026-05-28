import assert from "node:assert/strict";
import test, { after, afterEach, beforeEach } from "node:test";
import { GetGexDashboardResponse } from "@workspace/api-zod";
import {
  __expireGexDashboardCacheForTests,
  __setGexDashboardLoadTimeoutMsForTests,
  __setGexMarketDataClientFactoryForTests,
  __setGexPlatformDataClientFactoryForTests,
  getGexDashboardData,
} from "./gex";

const GEX_MARKET_DATA_ENV_KEYS = [
  "POLYGON_API_KEY",
  "POLYGON_KEY",
  "POLYGON_BASE_URL",
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
}: {
  right: "call" | "put";
  strike: number;
  gamma: number | null;
  openInterest: number | null;
  multiplier?: number;
  underlyingPrice?: number | null;
}) {
  return {
    contract: {
      ticker: `SPY-20260515-${right}-${strike}`,
      underlying: "SPY",
      expirationDate: new Date("2026-05-15T00:00:00Z"),
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
  onBatchRequest?: (request: unknown) => void;
}) {
  let chainRequests = 0;
  __setGexPlatformDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => ({
      quotes: input.quote === null ? [] : [input.quote ?? basicQuote()],
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
        complete: false,
        capped: true,
      },
    }),
    batchOptionChains: async (request: any) => {
      chainRequests += 1;
      input.onBatchRequest?.(request);
      return {
        underlying: "SPY",
        results: [
          {
            expirationDate: new Date("2026-05-15T00:00:00Z"),
            status: "loaded",
            contracts: input.contracts,
            error: null,
            debug: {
              cacheStatus: "miss",
              totalMs: 1,
              upstreamMs: 1,
            },
          },
        ],
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
  provider?: "massive" | "polygon";
}) {
  if (input.provider === "polygon") {
    process.env["POLYGON_API_KEY"] = "test";
    process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";
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

test("GEX does not request Polygon reference option snapshots for live option data", async () => {
  const ibkr = configureIbkrGex({
    contracts: [
      option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
    ],
  });
  const reference = configureReferenceGex({
    provider: "polygon",
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
      source: "polygon",
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
