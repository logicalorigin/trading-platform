import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  __setGexMarketDataClientFactoryForTests,
  getGexDashboardData,
} from "./gex";

const originalEnv = {
  MASSIVE_API_KEY: process.env["MASSIVE_API_KEY"],
  POLYGON_API_KEY: process.env["POLYGON_API_KEY"],
  POLYGON_KEY: process.env["POLYGON_KEY"],
};

afterEach(() => {
  __setGexMarketDataClientFactoryForTests(null);
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function configureMassive() {
  process.env["MASSIVE_API_KEY"] = "test-massive-key";
  delete process.env["POLYGON_API_KEY"];
  delete process.env["POLYGON_KEY"];
}

function basicQuote() {
  return {
    symbol: "SPY",
    price: 100,
    bid: 99.99,
    ask: 100.01,
    bidSize: 1,
    askSize: 1,
    change: 0,
    changePercent: 0,
    open: 100,
    high: 101,
    low: 99,
    prevClose: 100,
    volume: 1000,
    updatedAt: new Date("2026-05-08T15:31:00Z"),
  };
}

function basicYearBars() {
  return {
    bars: [
      {
        timestamp: new Date("2025-05-07T00:00:00Z"),
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 0,
      },
      {
        timestamp: new Date("2025-05-08T00:00:00Z"),
        open: 90,
        high: 110,
        low: 80,
        close: 100,
        volume: 1_000,
      },
      {
        timestamp: new Date("2026-05-08T00:00:00Z"),
        open: 100,
        high: 125,
        low: 95,
        close: 110,
        volume: 1_000,
      },
    ],
  };
}

const option = ({
  right,
  strike,
  gamma,
  openInterest,
}: {
  right: "call" | "put";
  strike: number;
  gamma: number | null;
  openInterest: number;
}) => ({
  contract: {
    ticker: `O:SPY260515${right === "call" ? "C" : "P"}00100000`,
    underlying: "SPY",
    expirationDate: new Date("2026-05-15T00:00:00Z"),
    strike,
    right,
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: null,
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
});

test("GEX dashboard data is sourced from Massive-compatible chain, quote, and flow APIs", async () => {
  configureMassive();
  let flowRequest: any = null;

  __setGexMarketDataClientFactoryForTests((config) => {
    assert.equal(config.baseUrl, "https://api.massive.com");
    return {
      getQuoteSnapshots: async () => [
        {
          ...basicQuote(),
          change: 1.25,
          changePercent: 1.25,
          high: 0,
          low: 0,
          open: 99,
        },
      ],
      getOptionChain: async (input: any) => {
        assert.equal(input.maxPages, 100);
        return [
          option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
          option({ right: "put", strike: 95, gamma: 0.01, openInterest: 10 }),
        ];
      },
      getUniverseTickerByTicker: async () => null,
      getTickerMarketCap: async () => 500_000_000_000,
      getBarsPage: async () => basicYearBars(),
      getDerivedFlowEvents: async (input: any) => {
        flowRequest = input;
        return [
          {
            premium: 10_000,
            size: 5,
            delta: 0.5,
            sentiment: "bullish",
            right: "call",
            side: "buy",
            sideBasis: "quote_match",
            sideConfidence: "high",
          },
        ];
      },
    } as any;
  });

  const data = await getGexDashboardData({ underlying: "spy" });

  assert.equal(flowRequest.underlying, "SPY");
  assert.equal(flowRequest.limit, 100);
  assert.equal(flowRequest.snapshotPageLimit, 3);
  assert.equal(flowRequest.contractLimit, 64);
  assert.equal(flowRequest.contractPageLimit, 1);
  assert.equal(flowRequest.tradeLimit, 500);
  assert.equal(flowRequest.tradePageLimit, 1);
  assert.equal(flowRequest.tradeConcurrency, 6);
  assert.ok(flowRequest.from instanceof Date);
  assert.ok(flowRequest.to instanceof Date);
  assert.ok(flowRequest.to.getTime() >= flowRequest.from.getTime());
  assert.ok(flowRequest.to.getTime() - flowRequest.from.getTime() >= 13 * 60 * 60 * 1000);
  assert.ok(flowRequest.to.getTime() - flowRequest.from.getTime() <= 15 * 60 * 60 * 1000);
  assert.equal(data.ticker, "SPY");
  assert.equal(data.source.provider, "massive");
  assert.equal(data.options.length, 2);
  assert.equal(data.tickerDetails.marketCap, 500_000_000_000);
  assert.equal(data.profile.mktCap, 500_000_000_000);
  assert.equal(data.profile.dayLow, 100);
  assert.equal(data.profile.dayHigh, 100);
  assert.equal(data.profile.yearLow, 80);
  assert.equal(data.profile.yearHigh, 125);
  assert.equal(data.flowContextStatus, "ok");
  assert.ok(data.flowContext);
  assert.equal(data.flowContext.eventCount, 1);
  assert.equal(data.flowContext.todayVol, 200);
  assert.equal(data.flowContext.avg30dVol, null);
  assert.equal(data.source.flowEventCount, 1);
  assert.equal(data.source.classifiedFlowEventCount, 1);
  assert.equal(data.source.flowClassificationCoverage, 1);
  assert.deepEqual(data.source.flowClassificationBasisCounts, {
    quoteMatch: 1,
    tickTest: 0,
    none: 0,
  });
  assert.deepEqual(data.source.flowClassificationConfidenceCounts, {
    high: 1,
    medium: 0,
    low: 0,
    none: 0,
  });
  assert.equal(data.snapshots.length, 1);
  assert.equal(data.snapshots[0].netGex, 1_000);
});

test("GEX skips contracts without required gamma or open interest and marks source partial", async () => {
  configureMassive();

  __setGexMarketDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => [
      basicQuote(),
    ],
    getOptionChain: async () => [
      option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
      option({ right: "put", strike: 95, gamma: null, openInterest: 10 }),
    ],
    getUniverseTickerByTicker: async () => null,
    getTickerMarketCap: async () => null,
    getBarsPage: async () => ({ bars: [] }),
    getDerivedFlowEvents: async () => [],
  }) as any);

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.source.optionCount, 2);
  assert.equal(data.source.usableOptionCount, 1);
  assert.equal(data.options.length, 1);
  assert.equal(data.flowContextStatus, "unavailable");
  assert.equal(data.flowContext, null);
  assert.equal(data.source.flowEventCount, 0);
  assert.equal(data.source.classifiedFlowEventCount, 0);
  assert.equal(data.source.flowClassificationCoverage, 0);
  assert.deepEqual(data.source.flowClassificationBasisCounts, {
    quoteMatch: 0,
    tickTest: 0,
    none: 0,
  });
  assert.equal(data.source.status, "partial");
});

test("GEX does not synthesize neutral flow context from unclassified events", async () => {
  configureMassive();

  __setGexMarketDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => [basicQuote()],
    getOptionChain: async () => [
      option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
    ],
    getUniverseTickerByTicker: async () => null,
    getTickerMarketCap: async () => null,
    getBarsPage: async () => ({ bars: [] }),
    getDerivedFlowEvents: async () => [
      {
        premium: 10_000,
        size: 5,
        delta: 0.5,
        sentiment: "neutral",
        right: "call",
        side: "mid",
      },
    ],
  }) as any);

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.flowContextStatus, "unavailable");
  assert.equal(data.flowContext, null);
  assert.equal(data.source.flowEventCount, 1);
  assert.equal(data.source.classifiedFlowEventCount, 0);
  assert.equal(data.source.flowClassificationCoverage, 0);
  assert.deepEqual(data.source.flowClassificationBasisCounts, {
    quoteMatch: 0,
    tickTest: 0,
    none: 1,
  });
  assert.deepEqual(data.source.flowClassificationConfidenceCounts, {
    high: 0,
    medium: 0,
    low: 0,
    none: 1,
  });
  assert.equal(data.source.status, "partial");
});

test("GEX excludes unclassified flow from squeeze context while reporting raw coverage", async () => {
  configureMassive();

  __setGexMarketDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => [basicQuote()],
    getOptionChain: async () => [
      option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
    ],
    getUniverseTickerByTicker: async () => null,
    getTickerMarketCap: async () => null,
    getBarsPage: async () => ({ bars: [] }),
    getDerivedFlowEvents: async () => [
      {
        premium: 30_000,
        size: 3,
        delta: 0.6,
        sentiment: "bullish",
        right: "call",
        side: "buy",
        sideBasis: "tick_test",
        sideConfidence: "medium",
      },
      {
        premium: 70_000,
        size: 7,
        delta: 0.4,
        sentiment: "neutral",
        right: "put",
        side: "mid",
        sideBasis: "none",
        sideConfidence: "none",
      },
    ],
  }) as any);

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.flowContextStatus, "ok");
  assert.ok(data.flowContext);
  assert.equal(data.flowContext.bullishShare, 1);
  assert.ok(Math.abs(data.flowContext.netDelta - 180) < 1e-9);
  assert.ok(Math.abs(data.flowContext.refDelta - 180) < 1e-9);
  assert.equal(data.source.flowEventCount, 2);
  assert.equal(data.source.classifiedFlowEventCount, 1);
  assert.equal(data.source.flowClassificationCoverage, 0.5);
  assert.deepEqual(data.source.flowClassificationBasisCounts, {
    quoteMatch: 0,
    tickTest: 1,
    none: 1,
  });
  assert.deepEqual(data.source.flowClassificationConfidenceCounts, {
    high: 0,
    medium: 1,
    low: 0,
    none: 1,
  });
});

test("GEX coalesces and caches full-chain dashboard loads per ticker", async () => {
  configureMassive();
  let chainRequests = 0;

  __setGexMarketDataClientFactoryForTests(() => ({
    getQuoteSnapshots: async () => [basicQuote()],
    getOptionChain: async () => {
      chainRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [
        option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
      ];
    },
    getUniverseTickerByTicker: async () => null,
    getTickerMarketCap: async () => null,
    getBarsPage: async () => ({ bars: [] }),
    getDerivedFlowEvents: async () => [],
  }) as any);

  const [first, second] = await Promise.all([
    getGexDashboardData({ underlying: "SPY" }),
    getGexDashboardData({ underlying: "spy" }),
  ]);
  const third = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(chainRequests, 1);
});

test("GEX prefers Massive credentials over legacy Polygon credentials", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-key";
  process.env["POLYGON_API_KEY"] = "polygon-key";

  __setGexMarketDataClientFactoryForTests((config) => {
    assert.equal(config.apiKey, "massive-key");
    assert.equal(config.baseUrl, "https://api.massive.com");
    return {
      getQuoteSnapshots: async () => [basicQuote()],
      getOptionChain: async () => [
        option({ right: "call", strike: 100, gamma: 0.02, openInterest: 10 }),
      ],
      getUniverseTickerByTicker: async () => null,
      getTickerMarketCap: async () => null,
      getBarsPage: async () => ({ bars: [] }),
      getDerivedFlowEvents: async () => [],
    } as any;
  });

  const data = await getGexDashboardData({ underlying: "SPY" });

  assert.equal(data.source.provider, "massive");
});
