import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../lib/errors";
import type { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import type {
  BrokerBarSnapshot,
  OptionChainContract,
  QuoteSnapshot,
} from "../providers/ibkr/client";
import type { PolygonMarketDataClient } from "../providers/polygon/market-data";
import { __resetBridgeGovernorForTests } from "./bridge-governor";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["OPTION_CHAIN_BATCH_CONCURRENCY"] = "2";
const originalOptionMetadataDisabled = process.env["OPTION_METADATA_DISABLED"];
process.env["OPTION_METADATA_DISABLED"] = "1";

const platformModule = await import("./platform");

const {
  __platformBarsCacheTestInternals,
  __resetOptionChainCachesForTests,
  __setPolygonMarketDataClientFactoryForTests,
  __setIbkrBridgeClientFactoryForTests,
  batchOptionChains,
  getBarsWithDebug,
  getOptionChainWithDebug,
  getOptionChartBarsWithDebug,
  getOptionExpirations,
  getOptionExpirationsWithDebug,
  resolveOptionContractWithDebug,
  shouldUseDurableOptionExpirationsForRequest,
} = platformModule;
const {
  __resetBridgeOptionQuoteStreamForTests,
  __setBridgeOptionQuoteClientForTests,
} = await import("./bridge-option-quote-stream");
const { __resetMarketDataAdmissionForTests } = await import(
  "./market-data-admission"
);

const originalPolygonApiKey = process.env["POLYGON_API_KEY"];
const originalPolygonBaseUrl = process.env["POLYGON_BASE_URL"];
const originalChartHydrationCursorEnabled =
  process.env["CHART_HYDRATION_CURSOR_ENABLED"];

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function optionContract(
  expirationDate: Date,
  strike = 500,
  overrides: Partial<OptionChainContract> = {},
): OptionChainContract {
  const isoDate = dateOnly(expirationDate);
  return {
    contract: {
      ticker: `SPY-${isoDate}-${strike}-C`,
      underlying: "SPY",
      expirationDate,
      strike,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: `${isoDate}-${strike}-C`,
    },
    bid: 1,
    ask: 1.1,
    last: 1.05,
    mark: 1.05,
    impliedVolatility: 0.2,
    delta: 0.5,
    gamma: 0.02,
    theta: -0.01,
    vega: 0.08,
    openInterest: 100,
    volume: 25,
    updatedAt: new Date("2026-04-24T14:30:00.000Z"),
    ...overrides,
  };
}

function optionQuote(
  providerContractId: string,
  price = 1.25,
): QuoteSnapshot {
  return {
    symbol: "SPY OPT",
    price,
    bid: price - 0.05,
    ask: price + 0.05,
    bidSize: 1,
    askSize: 1,
    change: 0,
    changePercent: 0,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: 10,
    openInterest: 100,
    impliedVolatility: 0.2,
    delta: 0.5,
    gamma: 0.02,
    theta: -0.01,
    vega: 0.08,
    updatedAt: new Date("2026-04-27T20:00:00.000Z"),
    providerContractId,
    transport: "tws",
    delayed: false,
    freshness: "frozen",
    marketDataMode: "frozen",
    dataUpdatedAt: new Date("2026-04-27T20:00:00.000Z"),
    ageMs: null,
    cacheAgeMs: null,
    latency: null,
  };
}

function brokerBar(
  providerContractId: string | null,
  close = 1.25,
): BrokerBarSnapshot {
  return {
    timestamp: new Date("2026-04-27T20:00:00.000Z"),
    open: close - 0.05,
    high: close + 0.1,
    low: close - 0.1,
    close,
    volume: 10,
    source: "ibkr-history",
    providerContractId,
    outsideRth: false,
    partial: false,
    transport: "tws",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: new Date("2026-04-27T20:00:00.000Z"),
    ageMs: null,
  };
}

test.afterEach(() => {
  __setIbkrBridgeClientFactoryForTests(null);
  __setPolygonMarketDataClientFactoryForTests(null);
  __setBridgeOptionQuoteClientForTests(null);
  __resetBridgeOptionQuoteStreamForTests();
  __resetMarketDataAdmissionForTests();
  __resetOptionChainCachesForTests();
  __resetBridgeGovernorForTests();
  if (originalPolygonApiKey === undefined) {
    delete process.env["POLYGON_API_KEY"];
  } else {
    process.env["POLYGON_API_KEY"] = originalPolygonApiKey;
  }
  if (originalPolygonBaseUrl === undefined) {
    delete process.env["POLYGON_BASE_URL"];
  } else {
    process.env["POLYGON_BASE_URL"] = originalPolygonBaseUrl;
  }
  if (originalChartHydrationCursorEnabled === undefined) {
    delete process.env["CHART_HYDRATION_CURSOR_ENABLED"];
  } else {
    process.env["CHART_HYDRATION_CURSOR_ENABLED"] =
      originalChartHydrationCursorEnabled;
  }
});

test.after(() => {
  if (originalOptionMetadataDisabled === undefined) {
    delete process.env["OPTION_METADATA_DISABLED"];
  } else {
    process.env["OPTION_METADATA_DISABLED"] = originalOptionMetadataDisabled;
  }
});

test("getBarsWithDebug only creates option study fallback when explicitly requested", async () => {
  let quoteCalls = 0;
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "frozen",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input: { providerContractIds: string[] }) {
      quoteCalls += 1;
      return [optionQuote(input.providerContractIds[0])];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "frozen",
        }),
        getHistoricalBars: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  const strict = await getBarsWithDebug({
    symbol: "SPY",
    timeframe: "1m",
    limit: 2,
    assetClass: "option",
    providerContractId: "STRICT-OPT",
    source: "midpoint",
    outsideRth: false,
    allowHistoricalSynthesis: false,
  });

  assert.equal(strict.bars.length, 0);
  assert.equal(strict.studyFallback, false);
  assert.equal(strict.emptyReason, "broker-history-empty");
  assert.equal(quoteCalls, 0);

  const study = await getBarsWithDebug({
    symbol: "SPY",
    timeframe: "1m",
    limit: 2,
    assetClass: "option",
    providerContractId: "STUDY-OPT",
    source: "midpoint",
    outsideRth: false,
    allowHistoricalSynthesis: false,
    allowStudyFallback: true,
  });

  assert.equal(study.bars.length, 1);
  assert.equal(study.studyFallback, true);
  assert.equal(study.historySource, "option-study-quote-fallback");
  assert.equal(study.freshness, "frozen");
  assert.equal(study.emptyReason, null);
  assert.equal(study.bars[0].close, 1.25);
  assert.equal(quoteCalls, 1);
});

test("getBarsWithDebug does not clip spot broker history without a synthesis provider", async () => {
  const previousPolygonApiKey = process.env["POLYGON_API_KEY"];
  const previousPolygonKey = process.env["POLYGON_KEY"];
  const previousMassiveApiKey = process.env["MASSIVE_API_KEY"];
  const previousMassiveMarketDataApiKey =
    process.env["MASSIVE_MARKET_DATA_API_KEY"];
  const seenRequests: Array<{ limit?: number; from?: Date; to?: Date }> = [];

  delete process.env["POLYGON_API_KEY"];
  delete process.env["POLYGON_KEY"];
  delete process.env["MASSIVE_API_KEY"];
  delete process.env["MASSIVE_MARKET_DATA_API_KEY"];

  try {
    __setIbkrBridgeClientFactoryForTests(
      () =>
        ({
          getHealth: async () => ({
            transport: "tws",
            marketDataMode: "live",
          }),
          getHistoricalBars: async (input: {
            limit?: number;
            from?: Date;
            to?: Date;
          }) => {
            seenRequests.push(input);
            const limit = input.limit ?? 0;
            return Array.from({ length: limit }, (_, index) => {
              const close = 510 + index * 0.1;
              const timestamp = new Date(
                Date.parse("2026-05-01T20:00:00.000Z") -
                  (limit - index - 1) * 60 * 60_000,
              );
              return {
                timestamp,
                open: close - 0.2,
                high: close + 0.4,
                low: close - 0.4,
                close,
                volume: 100_000 + index,
                source: "ibkr-history",
                providerContractId: null,
                outsideRth: true,
                partial: false,
                transport: "tws",
                delayed: false,
                freshness: "live",
                marketDataMode: "live",
                dataUpdatedAt: timestamp,
                ageMs: null,
              } satisfies BrokerBarSnapshot;
            });
          },
        }) as unknown as IbkrBridgeClient,
    );

    const result = await getBarsWithDebug({
      symbol: "SPY",
      timeframe: "1h",
      limit: 120,
      assetClass: "equity",
      allowHistoricalSynthesis: true,
    });

    assert.equal(seenRequests.length, 1);
    assert.equal(seenRequests[0]?.limit, 120);
    assert.equal(result.bars.length, 120);
    assert.equal(result.historySource, "ibkr-history");
  } finally {
    if (previousPolygonApiKey === undefined) {
      delete process.env["POLYGON_API_KEY"];
    } else {
      process.env["POLYGON_API_KEY"] = previousPolygonApiKey;
    }
    if (previousPolygonKey === undefined) {
      delete process.env["POLYGON_KEY"];
    } else {
      process.env["POLYGON_KEY"] = previousPolygonKey;
    }
    if (previousMassiveApiKey === undefined) {
      delete process.env["MASSIVE_API_KEY"];
    } else {
      process.env["MASSIVE_API_KEY"] = previousMassiveApiKey;
    }
    if (previousMassiveMarketDataApiKey === undefined) {
      delete process.env["MASSIVE_MARKET_DATA_API_KEY"];
    } else {
      process.env["MASSIVE_MARKET_DATA_API_KEY"] =
        previousMassiveMarketDataApiKey;
    }
  }
});

test("getBarsWithDebug falls back to full spot broker history when synthesis underfills", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";
  const seenBrokerLimits: Array<number | undefined> = [];
  let polygonCalls = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async (input: { limit?: number }) => {
          seenBrokerLimits.push(input.limit);
          const limit = input.limit ?? 0;
          if (limit < 120) {
            return [];
          }
          return Array.from({ length: limit }, (_, index) => {
            const close = 510 + index * 0.1;
            const timestamp = new Date(
              Date.parse("2026-05-01T20:00:00.000Z") -
                (limit - index - 1) * 60 * 60_000,
            );
            return {
              timestamp,
              open: close - 0.2,
              high: close + 0.4,
              low: close - 0.4,
              close,
              volume: 100_000 + index,
              source: "ibkr-history",
              providerContractId: null,
              outsideRth: true,
              partial: false,
              transport: "tws",
              delayed: false,
              freshness: "live",
              marketDataMode: "live",
              dataUpdatedAt: timestamp,
              ageMs: null,
            } satisfies BrokerBarSnapshot;
          });
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getBarsPage: async () => {
          polygonCalls += 1;
          return {
            bars: [],
            nextUrl: null,
            pageCount: 1,
            pageLimitReached: false,
            requestedFrom: null,
            requestedTo: null,
          };
        },
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getBarsWithDebug({
    symbol: "SPY",
    timeframe: "1h",
    limit: 120,
    assetClass: "equity",
    allowHistoricalSynthesis: true,
  });

  assert.equal(polygonCalls, 1);
  assert.equal(seenBrokerLimits.at(-1), 120);
  assert.ok(
    seenBrokerLimits.length >= 2,
    "expected recent broker attempt plus full broker recovery",
  );
  assert.equal(result.bars.length, 120);
  assert.equal(result.historySource, "ibkr-history");
  assert.equal(result.emptyReason, null);
});

test("getBarsWithDebug lets chart callers size the broker live-edge window", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.massive.com";
  const seenBrokerLimits: Array<number | undefined> = [];
  let polygonCalls = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async (input: { limit?: number }) => {
          seenBrokerLimits.push(input.limit);
          const limit = input.limit ?? 0;
          return Array.from({ length: limit }, (_, index) => {
            const close = 510 + index * 0.1;
            const timestamp = new Date(
              Date.parse("2026-05-01T20:00:00.000Z") -
                (limit - index - 1) * 5 * 60_000,
            );
            return {
              timestamp,
              open: close - 0.2,
              high: close + 0.4,
              low: close - 0.4,
              close,
              volume: 100_000 + index,
              source: "ibkr-history",
              providerContractId: null,
              outsideRth: true,
              partial: false,
              transport: "tws",
              delayed: false,
              freshness: "live",
              marketDataMode: "live",
              dataUpdatedAt: timestamp,
              ageMs: null,
            } satisfies BrokerBarSnapshot;
          });
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getBarsPage: async () => {
          polygonCalls += 1;
          return {
            bars: [],
            nextUrl: null,
            pageCount: 1,
            pageLimitReached: false,
            requestedFrom: null,
            requestedTo: null,
          };
        },
      }) as unknown as PolygonMarketDataClient,
  );

  const clipped = await getBarsWithDebug({
    symbol: "SPY",
    timeframe: "5m",
    limit: 900,
    assetClass: "equity",
    allowHistoricalSynthesis: true,
  });
  assert.ok(
    (seenBrokerLimits[0] ?? 0) < 900,
    "default synthesis path should still clip the first broker request",
  );
  assert.equal(clipped.bars.length, 900);

  seenBrokerLimits.length = 0;
  polygonCalls = 0;
  __resetOptionChainCachesForTests({ resetFlowScanner: false });

  const chartHydrated = await getBarsWithDebug({
    symbol: "SPY",
    timeframe: "5m",
    limit: 900,
    assetClass: "equity",
    allowHistoricalSynthesis: true,
    brokerRecentWindowMinutes: 4510,
  });

  assert.equal(seenBrokerLimits[0], 900);
  assert.equal(polygonCalls, 0);
  assert.equal(chartHydrated.bars.length, 900);
  assert.equal(chartHydrated.historySource, "ibkr-history");
});

test("getBarsWithDebug waits long enough for broker live-edge backfill before synthesis", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.massive.com";
  const symbol = `SLOWIBKR${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  let brokerCalls = 0;
  let polygonCalls = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async (input: { exchange?: string | null }) => {
          brokerCalls += 1;
          if (input.exchange) {
            return [];
          }
          await wait(3_500);
          return ["2026-05-11T22:45:00.000Z", "2026-05-11T23:00:00.000Z"].map(
            (timestamp, index) => {
              const close = 520 + index;
              return {
                timestamp: new Date(timestamp),
                open: close - 0.2,
                high: close + 0.4,
                low: close - 0.4,
                close,
                volume: 100_000 + index,
                source: "ibkr-history",
                providerContractId: null,
                outsideRth: true,
                partial: false,
                transport: "tws",
                delayed: false,
                freshness: "live",
                marketDataMode: "live",
                dataUpdatedAt: new Date(timestamp),
                ageMs: null,
              } satisfies BrokerBarSnapshot;
            },
          );
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getBarsPage: async () => {
          polygonCalls += 1;
          return {
            bars: ["2026-05-11T22:15:00.000Z", "2026-05-11T22:30:00.000Z"].map(
              (timestamp, index) => ({
                timestamp: new Date(timestamp),
                open: 510 + index,
                high: 511 + index,
                low: 509 + index,
                close: 510 + index,
                volume: 50_000 + index,
              }),
            ),
            nextUrl: null,
            pageCount: 1,
            pageLimitReached: false,
            requestedFrom: null,
            requestedTo: null,
          };
        },
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getBarsWithDebug({
    symbol,
    timeframe: "15m",
    limit: 4,
    assetClass: "equity",
    outsideRth: true,
    allowHistoricalSynthesis: true,
  });

  assert.ok(brokerCalls >= 1);
  assert.equal(polygonCalls, 1);
  assert.equal(result.bars.length, 4);
  assert.equal(result.historySource, "ibkr-history");
  assert.deepEqual(
    result.bars.map((bar) => bar.source),
    ["massive-history", "massive-history", "ibkr-history", "ibkr-history"],
  );
});

test("getBarsWithDebug retries quick empty broker live-edge backfill before synthesis", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.massive.com";
  const symbol = `EMPTYIBKR${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  let primaryBrokerCalls = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async (input: { exchange?: string | null }) => {
          if (input.exchange) {
            return [];
          }
          primaryBrokerCalls += 1;
          if (primaryBrokerCalls === 1) {
            return [];
          }
          return ["2026-05-11T22:45:00.000Z", "2026-05-11T23:00:00.000Z"].map(
            (timestamp, index) => {
              const close = 530 + index;
              return {
                timestamp: new Date(timestamp),
                open: close - 0.2,
                high: close + 0.4,
                low: close - 0.4,
                close,
                volume: 120_000 + index,
                source: "ibkr-history",
                providerContractId: null,
                outsideRth: true,
                partial: false,
                transport: "tws",
                delayed: false,
                freshness: "live",
                marketDataMode: "live",
                dataUpdatedAt: new Date(timestamp),
                ageMs: null,
              } satisfies BrokerBarSnapshot;
            },
          );
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getBarsPage: async () => ({
          bars: ["2026-05-11T22:15:00.000Z", "2026-05-11T22:30:00.000Z"].map(
            (timestamp, index) => ({
              timestamp: new Date(timestamp),
              open: 510 + index,
              high: 511 + index,
              low: 509 + index,
              close: 510 + index,
              volume: 50_000 + index,
            }),
          ),
          nextUrl: null,
          pageCount: 1,
          pageLimitReached: false,
          requestedFrom: null,
          requestedTo: null,
        }),
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getBarsWithDebug({
    symbol,
    timeframe: "15m",
    limit: 4,
    assetClass: "equity",
    outsideRth: true,
    allowHistoricalSynthesis: true,
  });

  assert.equal(primaryBrokerCalls, 2);
  assert.equal(result.historySource, "ibkr-history");
  assert.deepEqual(
    result.bars.map((bar) => bar.source),
    ["massive-history", "massive-history", "ibkr-history", "ibkr-history"],
  );
});

test("getBarsWithDebug merges IBKR overnight exchange bars into extended spot history", async () => {
  const seenExchanges: Array<string | null | undefined> = [];

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async (input: { exchange?: string | null }) => {
          seenExchanges.push(input.exchange);
          const isOvernight = input.exchange === "OVERNIGHT";
          const timestamps = isOvernight
            ? ["2026-05-01T01:00:00.000Z", "2026-05-01T02:00:00.000Z"]
            : ["2026-05-01T12:00:00.000Z", "2026-05-01T14:30:00.000Z"];

          return timestamps.map((timestamp, index) => {
            const close = (isOvernight ? 500 : 510) + index;
            return {
              timestamp: new Date(timestamp),
              open: close - 0.2,
              high: close + 0.4,
              low: close - 0.4,
              close,
              volume: 100_000 + index,
              source: "ibkr-history",
              providerContractId: null,
              outsideRth: true,
              partial: false,
              transport: "tws",
              delayed: false,
              freshness: "live",
              marketDataMode: "live",
              dataUpdatedAt: new Date(timestamp),
              ageMs: null,
            } satisfies BrokerBarSnapshot;
          });
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await getBarsWithDebug({
    symbol: "SPY",
    timeframe: "1m",
    limit: 4,
    assetClass: "equity",
    outsideRth: true,
    allowHistoricalSynthesis: false,
  });

  assert.deepEqual(seenExchanges.sort(), [undefined, "OVERNIGHT"].sort());
  assert.deepEqual(
    result.bars.map((bar) => ({
      timestamp: bar.timestamp.toISOString(),
      source: bar.source,
    })),
    [
      {
        timestamp: "2026-05-01T01:00:00.000Z",
        source: "ibkr-overnight-history",
      },
      {
        timestamp: "2026-05-01T02:00:00.000Z",
        source: "ibkr-overnight-history",
      },
      { timestamp: "2026-05-01T12:00:00.000Z", source: "ibkr-history" },
      { timestamp: "2026-05-01T14:30:00.000Z", source: "ibkr-history" },
    ],
  );
});

test("getBarsWithDebug falls back to IBEOS when OVERNIGHT returns regular history", async () => {
  const seenExchanges: Array<string | null | undefined> = [];

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async (input: { exchange?: string | null }) => {
          seenExchanges.push(input.exchange);
          const timestamp =
            input.exchange === "IBEOS"
              ? "2026-05-01T01:00:00.000Z"
              : input.exchange === "OVERNIGHT"
                ? "2026-05-01T21:00:00.000Z"
                : "2026-05-01T14:30:00.000Z";
          const close = input.exchange === "IBEOS" ? 500 : 510;

          return [
            {
              timestamp: new Date(timestamp),
              open: close - 0.2,
              high: close + 0.4,
              low: close - 0.4,
              close,
              volume: 100_000,
              source: "ibkr-history",
              providerContractId: null,
              outsideRth: true,
              partial: false,
              transport: "tws",
              delayed: false,
              freshness: "live",
              marketDataMode: "live",
              dataUpdatedAt: new Date(timestamp),
              ageMs: null,
            } satisfies BrokerBarSnapshot,
          ];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await getBarsWithDebug({
    symbol: "SPY",
    timeframe: "1m",
    limit: 3,
    assetClass: "equity",
    outsideRth: true,
    allowHistoricalSynthesis: false,
  });

  assert.deepEqual(seenExchanges, [undefined, "OVERNIGHT", "IBEOS"]);
  assert.deepEqual(
    result.bars.map((bar) => ({
      timestamp: bar.timestamp.toISOString(),
      source: bar.source,
    })),
    [
      {
        timestamp: "2026-05-01T01:00:00.000Z",
        source: "ibkr-overnight-history",
      },
      { timestamp: "2026-05-01T14:30:00.000Z", source: "ibkr-history" },
    ],
  );
});

test("getBarsWithDebug keeps delayed synthesis out of the IBKR live edge", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.massive.com";
  const symbol = "TSTLIVEEDGE";
  const stepMs = 15 * 60_000;
  const anchorMs = Math.floor(Date.now() / stepMs) * stepMs;
  const oldestIbkrMs = anchorMs - stepMs;
  const ibkrBars = [
    {
      timestamp: new Date(oldestIbkrMs),
      open: 599,
      high: 603,
      low: 598,
      close: 602,
      volume: 120_000,
      source: "ibkr-history",
      providerContractId: null,
      outsideRth: true,
      partial: false,
      transport: "tws",
      delayed: false,
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: new Date(oldestIbkrMs),
      ageMs: null,
    },
    {
      timestamp: new Date(anchorMs),
      open: 602,
      high: 606,
      low: 601,
      close: 605,
      volume: 140_000,
      source: "ibkr-history",
      providerContractId: null,
      outsideRth: true,
      partial: false,
      transport: "tws",
      delayed: false,
      freshness: "live",
      marketDataMode: "live",
      dataUpdatedAt: new Date(anchorMs),
      ageMs: null,
    },
  ] satisfies BrokerBarSnapshot[];

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async () => ibkrBars,
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getBarsPage: async () => ({
          bars: [
            {
              timestamp: new Date(oldestIbkrMs - stepMs),
              open: 590,
              high: 596,
              low: 589,
              close: 595,
              volume: 90_000,
            },
            {
              timestamp: new Date(oldestIbkrMs),
              open: 596,
              high: 600,
              low: 595,
              close: 599,
              volume: 95_000,
            },
            {
              timestamp: new Date(anchorMs),
              open: 599,
              high: 602,
              low: 598,
              close: 601,
              volume: 100_000,
            },
            {
              timestamp: new Date(anchorMs + stepMs),
              open: 601,
              high: 604,
              low: 600,
              close: 603,
              volume: 110_000,
            },
          ],
          nextUrl: null,
          pageCount: 1,
          pageLimitReached: false,
          requestedFrom: new Date(oldestIbkrMs - stepMs),
          requestedTo: new Date(anchorMs + stepMs),
        }),
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getBarsWithDebug({
    symbol,
    timeframe: "15m",
    limit: 6,
    from: new Date(oldestIbkrMs - 2 * stepMs),
    to: new Date(anchorMs + stepMs),
    assetClass: "equity",
    allowHistoricalSynthesis: true,
    brokerRecentWindowMinutes: 240,
  });

  assert.equal(result.bars.at(-1)?.source, "ibkr-history");
  assert.equal(result.bars.at(-1)?.close, 605);
  assert.equal(result.historySource, "ibkr-history");
  assert.equal(
    result.bars.some(
      (bar) =>
        bar.timestamp.getTime() >= oldestIbkrMs &&
        (bar.delayed || String(bar.source).includes("massive")),
    ),
    false,
  );
  assert.equal(
    result.bars.some(
      (bar) =>
        bar.timestamp.getTime() < oldestIbkrMs &&
        bar.source === "massive-history",
    ),
    true,
  );
});

test("getBarsWithDebug starts fresh after a stale in-flight bar request", async () => {
  const originalNow = Date.now;
  let now = Date.parse("2026-05-01T20:00:00.000Z");
  let historyCalls = 0;
  let releaseFirstHistory: ((bars: BrokerBarSnapshot[]) => void) | null = null;
  let firstReleased = false;
  let firstRequest: ReturnType<typeof getBarsWithDebug> | null = null;
  const releaseFirst = (bars: BrokerBarSnapshot[]) => {
    if (firstReleased) return;
    firstReleased = true;
    releaseFirstHistory?.(bars);
  };

  Date.now = () => now;
  const firstHistory = new Promise<BrokerBarSnapshot[]>((resolve) => {
    releaseFirstHistory = resolve;
  });

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async () => {
          historyCalls += 1;
          if (historyCalls === 1) {
            return firstHistory;
          }
          return [brokerBar(null, 502)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  try {
    const input = {
      symbol: "STALEJOIN",
      timeframe: "1m" as const,
      limit: 1,
      assetClass: "equity" as const,
      allowHistoricalSynthesis: false,
    };

    firstRequest = getBarsWithDebug(input);
    await wait(0);
    assert.equal(historyCalls, 1);

    now += 31_000;
    const second = await getBarsWithDebug(input);

    assert.equal(historyCalls >= 2, true);
    assert.equal(second.debug.cacheStatus, "miss");
    assert.equal(second.bars.length, 1);
    assert.equal(second.bars[0]?.close, 502);

    releaseFirst([]);
    const first = await firstRequest;
    assert.equal(first.bars.length, 0);
  } finally {
    Date.now = originalNow;
    releaseFirst([]);
    if (firstRequest) {
      await firstRequest.catch(() => undefined);
    }
  }
});

test("getBarsWithDebug marks stale cached bar history as warming", async () => {
  const originalNow = Date.now;
  const originalBackgroundEnabled =
    process.env["CHART_HYDRATION_BACKGROUND_ENABLED"];
  let now = Date.parse("2026-05-01T20:00:00.000Z");
  let historyCalls = 0;

  Date.now = () => now;
  process.env["CHART_HYDRATION_BACKGROUND_ENABLED"] = "0";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async () => {
          historyCalls += 1;
          return [brokerBar(null, 501)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  try {
    const input = {
      symbol: "STALECACHE",
      timeframe: "1m" as const,
      limit: 1,
      assetClass: "equity" as const,
      allowHistoricalSynthesis: false,
    };

    const first = await getBarsWithDebug(input);
    now += 31_000;
    const second = await getBarsWithDebug(input);

    assert.equal(first.debug.cacheStatus, "miss");
    assert.equal(first.historyPage.hydrationStatus, "warm");
    assert.equal(second.debug.cacheStatus, "hit");
    assert.equal(second.debug.stale, true);
    assert.equal(second.historyPage.cacheStatus, "hit");
    assert.equal(second.historyPage.hydrationStatus, "warming");
    assert.equal(second.bars[0]?.close, 501);
    assert.equal(historyCalls, 1);
  } finally {
    Date.now = originalNow;
    if (originalBackgroundEnabled === undefined) {
      delete process.env["CHART_HYDRATION_BACKGROUND_ENABLED"];
    } else {
      process.env["CHART_HYDRATION_BACKGROUND_ENABLED"] =
        originalBackgroundEnabled;
    }
  }
});

test("getBarsWithDebug does not serve cached synthesis-only bars for broker-backed extended charts", async () => {
  const originalNow = Date.now;
  let now = Date.parse("2026-05-01T20:00:00.000Z");
  let historyCalls = 0;
  let polygonCalls = 0;
  const symbol = `STALESYNTH${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

  Date.now = () => now;
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.massive.com";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async () => {
          historyCalls += 1;
          return [];
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getBarsPage: async () => {
          polygonCalls += 1;
          return {
            bars: [
              {
                timestamp: new Date(now - 15 * 60_000),
                open: 500 + polygonCalls,
                high: 501 + polygonCalls,
                low: 499 + polygonCalls,
                close: 500 + polygonCalls,
                volume: 100_000,
              },
            ],
            nextUrl: null,
            pageCount: 1,
            pageLimitReached: false,
            requestedFrom: null,
            requestedTo: new Date(now),
          };
        },
      }) as unknown as PolygonMarketDataClient,
  );

  try {
    const input = {
      symbol,
      timeframe: "15m" as const,
      limit: 1,
      assetClass: "equity" as const,
      outsideRth: true,
      allowHistoricalSynthesis: true,
    };

    const first = await getBarsWithDebug(input);
    const second = await getBarsWithDebug(input);

    assert.equal(first.debug.cacheStatus, "miss");
    assert.equal(second.debug.cacheStatus, "miss");
    assert.equal(second.debug.stale, undefined);
    assert.equal(historyCalls >= 2, true);
    assert.equal(polygonCalls >= 1, true);
    assert.equal(second.bars[0]?.source, "massive-history");
  } finally {
    Date.now = originalNow;
  }
});

test("getBarsWithDebug refreshes after durable bar writes invalidate cache", async () => {
  let historyCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async () => {
          historyCalls += 1;
          return [brokerBar(null, 500 + historyCalls)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const input = {
    symbol: "CACHEWRITE",
    timeframe: "1m" as const,
    limit: 1,
    assetClass: "equity" as const,
    allowHistoricalSynthesis: false,
  };

  const first = await getBarsWithDebug(input);
  const second = await getBarsWithDebug(input);
  assert.equal(first.debug.cacheStatus, "miss");
  assert.equal(second.debug.cacheStatus, "hit");
  assert.equal(second.bars[0]?.close, 501);
  assert.equal(historyCalls, 1);

  __platformBarsCacheTestInternals.invalidateBarsCacheForDurableWrite(input);

  const third = await getBarsWithDebug(input);
  const counters =
    __platformBarsCacheTestInternals.getBarsHydrationCounters();
  assert.equal(third.debug.cacheStatus, "miss");
  assert.equal(third.bars[0]?.close, 502);
  assert.equal(historyCalls, 2);
  assert.equal(counters.cacheInvalidated >= 1, true);
});

test("batchOptionChains dedupes dates and caps upstream concurrency", async () => {
  const calls: string[] = [];
  let active = 0;
  let maxActive = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: { expirationDate?: Date }) => {
          const expirationDate = input.expirationDate;
          assert.ok(expirationDate);
          calls.push(dateOnly(expirationDate));
          active += 1;
          maxActive = Math.max(maxActive, active);
          await wait(20);
          active -= 1;
          return dateOnly(expirationDate).endsWith("-01")
            ? []
            : [optionContract(expirationDate)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await batchOptionChains({
    underlying: "spy",
    expirationDates: [
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-08T00:00:00.000Z"),
      new Date("2026-05-15T00:00:00.000Z"),
    ],
    strikesAroundMoney: 2,
  });

  assert.deepEqual(calls, [
    "2026-05-01",
    "2026-05-08",
    "2026-05-15",
    "2026-05-01",
    "2026-05-01",
  ]);
  assert.equal(maxActive, 1);
  assert.deepEqual(
    result.results.map((entry) => entry.status),
    ["failed", "loaded", "loaded"],
  );
  assert.equal(result.results[0].error, "IBKR returned an empty option chain.");
});

test("batchOptionChains returns per-expiration failures without failing the batch", async () => {
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: { expirationDate?: Date }) => {
          const expirationDate = input.expirationDate;
          assert.ok(expirationDate);
          if (dateOnly(expirationDate) === "2026-05-08") {
            throw new Error("IBKR timeout");
          }
          return [optionContract(expirationDate)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await batchOptionChains({
    underlying: "SPY",
    expirationDates: [
      new Date("2026-05-01T00:00:00.000Z"),
      new Date("2026-05-08T00:00:00.000Z"),
    ],
    strikesAroundMoney: 2,
  });

  assert.equal(result.results[0].status, "loaded");
  assert.equal(result.results[1].status, "failed");
  assert.equal(result.results[1].contracts.length, 0);
  assert.match(result.results[1].error || "", /IBKR timeout/);
});

test("batchOptionChains reuses in-flight chain requests", async () => {
  let calls = 0;
  let releaseRequest!: () => void;
  let requestStarted!: () => void;
  const requestStartedPromise = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const releaseRequestPromise = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: { expirationDate?: Date }) => {
          calls += 1;
          requestStarted();
          await releaseRequestPromise;
          assert.ok(input.expirationDate);
          return [optionContract(input.expirationDate)];
        },
      }) as IbkrBridgeClient,
  );

  const first = batchOptionChains({
    underlying: "SPY",
    expirationDates: [new Date("2026-05-01T00:00:00.000Z")],
    strikesAroundMoney: 2,
  });
  await requestStartedPromise;
  const second = batchOptionChains({
    underlying: "SPY",
    expirationDates: [new Date("2026-05-01T00:00:00.000Z")],
    strikesAroundMoney: 2,
  });
  releaseRequest();

  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(firstResult.results[0].status, "loaded");
  assert.equal(secondResult.results[0].status, "loaded");
  assert.equal(secondResult.results[0].debug?.cacheStatus, "inflight");
});

test("option expiration lookup does not cache empty Gateway responses", async () => {
  let calls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => {
          calls += 1;
          return calls === 1
            ? []
            : [new Date("2026-05-08T00:00:00.000Z")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const empty = await getOptionExpirations({ underlying: "SPY" });
  const loaded = await getOptionExpirations({ underlying: "SPY" });

  assert.equal(calls, 2);
  assert.deepEqual(empty.expirations, []);
  assert.equal(dateOnly(loaded.expirations[0].expirationDate), "2026-05-08");
});

test("option expiration lookup forwards explicit caps without capping all-expiration discovery", async () => {
  const seenMaxExpirations: Array<number | undefined> = [];
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async (input: { maxExpirations?: number }) => {
          seenMaxExpirations.push(input.maxExpirations);
          const expirations = [
            new Date("2026-05-08T00:00:00.000Z"),
            new Date("2026-05-15T00:00:00.000Z"),
          ];
          return expirations.slice(0, input.maxExpirations ?? expirations.length);
        },
      }) as unknown as IbkrBridgeClient,
  );

  const all = await getOptionExpirationsWithDebug({ underlying: "SPY" });
  const capped = await getOptionExpirationsWithDebug({
    underlying: "SPY",
    maxExpirations: 1,
  });

  assert.deepEqual(seenMaxExpirations, [undefined, 1]);
  assert.equal(all.expirations.length, 2);
  assert.equal(capped.expirations.length, 1);
  assert.equal(all.debug.complete, true);
  assert.equal(all.debug.capped, false);
  assert.equal(all.debug.requestedCount, 2);
  assert.equal(all.debug.returnedCount, 2);
  assert.equal(capped.debug.complete, false);
  assert.equal(capped.debug.capped, true);
  assert.equal(capped.debug.requestedCount, 1);
  assert.equal(capped.debug.returnedCount, 1);
});

test("uncapped option expiration discovery does not trust partial durable metadata", () => {
  const durable = {
    expirations: [
      new Date("2026-05-05T00:00:00.000Z"),
      new Date("2026-05-06T00:00:00.000Z"),
      new Date("2026-05-07T00:00:00.000Z"),
      new Date("2026-05-08T00:00:00.000Z"),
    ],
    debug: {
      cacheStatus: "hit" as const,
      totalMs: 0,
      upstreamMs: null,
      reason: "durable_option_expirations",
    },
  };

  assert.equal(
    shouldUseDurableOptionExpirationsForRequest({ underlying: "SPY" }, durable),
    false,
  );
  assert.equal(
    shouldUseDurableOptionExpirationsForRequest(
      { underlying: "SPY", maxExpirations: 20 },
      durable,
    ),
    false,
  );
  assert.equal(
    shouldUseDurableOptionExpirationsForRequest(
      { underlying: "SPY", maxExpirations: 4 },
      durable,
    ),
    true,
  );
});

test("option chain lookup defaults to all expirations when no expiration is requested", async () => {
  const seenMaxExpirations: Array<number | undefined> = [];
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: {
          expirationDate?: Date;
          maxExpirations?: number;
        }) => {
          seenMaxExpirations.push(input.maxExpirations);
          const firstExpiration =
            input.expirationDate ?? new Date("2026-05-01T00:00:00.000Z");
          const secondExpiration = new Date("2026-05-08T00:00:00.000Z");
          return input.expirationDate
            ? [optionContract(firstExpiration)]
            : [
                optionContract(firstExpiration),
                optionContract(secondExpiration, 101),
              ];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const all = await getOptionChainWithDebug({
    underlying: "SPY",
    strikesAroundMoney: 2,
    quoteHydration: "metadata",
  });
  const explicit = await getOptionChainWithDebug({
    underlying: "SPY",
    expirationDate: new Date("2026-05-01T00:00:00.000Z"),
    strikesAroundMoney: 2,
    quoteHydration: "metadata",
  });

  assert.deepEqual(seenMaxExpirations, [undefined, undefined]);
  assert.deepEqual(
    Array.from(
      new Set(
        all.contracts.map((contract) =>
          dateOnly(contract.contract.expirationDate),
        ),
      ),
    ),
    ["2026-05-01", "2026-05-08"],
  );
  assert.equal(explicit.contracts.length, 1);
  assert.equal(dateOnly(explicit.contracts[0]!.contract.expirationDate), "2026-05-01");
});

test("option chain lookup retries empty Gateway responses", async () => {
  let calls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: { expirationDate?: Date }) => {
          calls += 1;
          assert.ok(input.expirationDate);
          return calls === 1 ? [] : [optionContract(input.expirationDate)];
        },
      }) as IbkrBridgeClient,
  );

  const input = {
    underlying: "SPY",
    expirationDate: new Date("2026-05-01T00:00:00.000Z"),
    strikesAroundMoney: 2,
  };
  const loaded = await getOptionChainWithDebug(input);
  const cached = await getOptionChainWithDebug(input);

  assert.equal(calls, 2);
  assert.equal(loaded.contracts.length, 1);
  assert.equal(cached.contracts.length, 1);
});

test("resolveOptionContractWithDebug hydrates full expiration metadata and caches conids", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  let calls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: {
          expirationDate?: Date;
          contractType?: "call" | "put";
          strikeCoverage?: string;
          quoteHydration?: string;
        }) => {
          calls += 1;
          assert.equal(dateOnly(input.expirationDate as Date), "2026-12-18");
          assert.equal(input.contractType, "put");
          assert.equal(input.strikeCoverage, "full");
          assert.equal(input.quoteHydration, "metadata");
          const base = optionContract(expirationDate, 970);
          return [
            {
              ...base,
              contract: {
                ...base.contract,
                ticker: "SPY-2026-12-18-970-P",
                right: "put",
                providerContractId: "970001",
              },
            },
          ];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const first = await resolveOptionContractWithDebug({
    underlying: "spy",
    expirationDate,
    strike: 970,
    right: "put",
  });
  const second = await resolveOptionContractWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "put",
  });

  assert.equal(first.status, "resolved");
  assert.equal(first.providerContractId, "970001");
  assert.equal(second.debug.cacheStatus, "hit");
  assert.equal(calls, 1);
});

test("resolveOptionContractWithDebug accepts nearest same-contract strike within tolerance", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          const base = optionContract(expirationDate, 970.005);
          return [
            {
              ...base,
              contract: {
                ...base.contract,
                providerContractId: "970005",
              },
            },
          ];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await resolveOptionContractWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.providerContractId, "970005");
  assert.equal(result.contract?.strike, 970.005);
});

test("resolveOptionContractWithDebug reports not_found when full chain lacks the contract", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => [optionContract(expirationDate, 960)],
      }) as unknown as IbkrBridgeClient,
  );

  const result = await resolveOptionContractWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
  });

  assert.equal(result.status, "not_found");
  assert.equal(result.providerContractId, null);
  assert.equal(result.contract, null);
  assert.equal(result.debug.reason, "option_contract_not_found");
});

test("resolveOptionContractWithDebug keeps expiration and right strict", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  const otherExpirationDate = new Date("2026-12-19T00:00:00.000Z");
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          const wrongExpiration = optionContract(otherExpirationDate, 970);
          const wrongRight = optionContract(expirationDate, 970, {
            contract: {
              ...optionContract(expirationDate, 970).contract,
              right: "put",
              providerContractId: "wrong-right",
            },
          });
          return [wrongExpiration, wrongRight];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await resolveOptionContractWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
  });

  assert.equal(result.status, "not_found");
  assert.equal(result.providerContractId, null);
  assert.equal(result.debug.reason, "option_contract_not_found");
});

test("resolveOptionContractWithDebug reports error when IB Gateway lookup fails", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          throw new HttpError(502, "Unable to resolve option contract via TWS.");
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await resolveOptionContractWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
  });

  assert.equal(result.status, "error");
  assert.equal(result.providerContractId, null);
  assert.equal(result.contract, null);
  assert.equal(result.debug.reason, "option_contract_resolution_error");
});

test("getOptionChartBarsWithDebug uses a provided provider contract id before loading the full chain", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  let historicalProviderContractId: string | null | undefined;
  let optionChainFetches = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getOptionChain: async () => {
          optionChainFetches += 1;
          const base = optionContract(expirationDate, 970);
          return [
            {
              ...base,
              contract: {
                ...base.contract,
                ticker: "O:SPY261218C00970000",
                providerContractId: "chain-conid",
              },
            },
          ];
        },
        getHistoricalBars: async (input: { providerContractId?: string | null }) => {
          historicalProviderContractId = input.providerContractId;
          return [brokerBar(input.providerContractId ?? null, 2.15)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await getOptionChartBarsWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
    providerContractId: "event-conid",
    timeframe: "1m",
    limit: 5,
    outsideRth: false,
  });

  assert.equal(optionChainFetches, 0);
  assert.equal(historicalProviderContractId, "event-conid");
  assert.equal(result.providerContractId, "event-conid");
  assert.equal(result.resolutionSource, "provided");
  assert.equal(result.dataSource, "ibkr-history");
  assert.equal(result.feedIssue, false);
  assert.equal(result.emptyReason, null);
  assert.equal(result.bars.length, 1);
  assert.equal(result.bars[0].close, 2.15);
});

test("getOptionChartBarsWithDebug still resolves a broker contract when only an option ticker is supplied", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  let historicalProviderContractId: string | null | undefined;
  let optionChainFetches = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getOptionChain: async () => {
          optionChainFetches += 1;
          const base = optionContract(expirationDate, 970);
          return [
            {
              ...base,
              contract: {
                ...base.contract,
                ticker: "O:SPY261218C00970000",
                providerContractId: "chain-conid",
              },
            },
          ];
        },
        getHistoricalBars: async (input: { providerContractId?: string | null }) => {
          historicalProviderContractId = input.providerContractId;
          return [brokerBar(input.providerContractId ?? null, 2.2)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await getOptionChartBarsWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
    optionTicker: "O:SPY261218C00970000",
    timeframe: "1m",
    limit: 5,
    outsideRth: false,
  });

  assert.equal(optionChainFetches, 1);
  assert.equal(historicalProviderContractId, "chain-conid");
  assert.equal(result.providerContractId, "chain-conid");
  assert.equal(result.resolutionSource, "chain");
  assert.equal(result.dataSource, "ibkr-history");
  assert.equal(result.bars.length, 1);
});

test("getOptionChartBarsWithDebug preserves IBKR bars cache metadata", async () => {
  let historicalCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async (input: { providerContractId?: string | null }) => {
          historicalCalls += 1;
          return [brokerBar(input.providerContractId ?? null)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const expirationDate = new Date("2026-05-01T00:00:00.000Z");
  const request = {
    underlying: "SPY",
    expirationDate,
    strike: 500,
    right: "call" as const,
    providerContractId: "event-conid",
    timeframe: "1m" as const,
    limit: 5,
    outsideRth: false,
  };

  const first = await getOptionChartBarsWithDebug(request);
  const second = await getOptionChartBarsWithDebug(request);

  assert.equal(first.dataSource, "ibkr-history");
  assert.equal(second.dataSource, "ibkr-history");
  assert.equal(second.debug.cacheStatus, "hit");
  assert.equal(historicalCalls, 1);
});

test("getOptionChartBarsWithDebug falls back to Polygon option aggregates when IBKR history is empty", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";
  let polygonTicker: string | null = null;
  const polygonNextUrl =
    "https://api.polygon.io/v2/aggs/ticker/O:SPY261218C00970000/range/1/minute/1/2?cursor=abc&apiKey=secret";

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getOptionChain: async () => {
          const base = optionContract(expirationDate, 970);
          return [
            {
              ...base,
              contract: {
                ...base.contract,
                ticker: "O:SPY261218C00970000",
                providerContractId: "chain-conid",
              },
            },
          ];
        },
        getHistoricalBars: async () => [],
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getOptionAggregateBarsPage: async (input: { optionTicker: string }) => {
          polygonTicker = input.optionTicker;
          return {
            bars: [
              {
                timestamp: new Date("2026-04-27T20:00:00.000Z"),
                open: 1.1,
                high: 1.3,
                low: 1,
                close: 1.25,
                volume: 42,
              },
            ],
            nextUrl: polygonNextUrl,
            pageCount: 2,
            pageLimitReached: true,
            requestedFrom: new Date("2026-04-20T00:00:00.000Z"),
            requestedTo: new Date("2026-04-27T20:00:00.000Z"),
          };
        },
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getOptionChartBarsWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
    providerContractId: "event-conid",
    timeframe: "1m",
    limit: 5,
    outsideRth: false,
  });

  assert.equal(polygonTicker, "O:SPY261218C00970000");
  assert.equal(result.providerContractId, "event-conid");
  assert.equal(result.resolutionSource, "provided");
  assert.equal(result.dataSource, "polygon-option-aggregates");
  assert.equal(result.historySource, "polygon-option-aggregates");
  assert.equal(result.feedIssue, false);
  assert.equal(result.emptyReason, null);
  assert.equal(result.bars.length, 1);
  assert.equal(result.bars[0].providerContractId, "event-conid");
  assert.equal(result.bars[0].source, "polygon-option-aggregates");
  assert.equal(result.bars[0].close, 1.25);
  assert.equal(result.bars[0].volume, 42);
  assert.equal(result.historyPage.provider, "polygon-option-aggregates");
  assert.equal(result.historyPage.providerNextUrl?.includes("apiKey"), false);
  assert.equal(result.historyPage.providerNextUrl?.includes("cursor=abc"), true);
  assert.equal(result.historyPage.providerCursor, result.historyPage.providerNextUrl);
  assert.equal(result.historyPage.providerPageCount, 2);
  assert.equal(result.historyPage.providerPageLimitReached, true);
});

test("getBarsWithDebug carries sanitized Polygon pagination metadata", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";
  process.env["CHART_HYDRATION_CURSOR_ENABLED"] = "1";
  const symbol = "TSTCUR1";
  const polygonNextUrl =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/minute/1/2?cursor=xyz&apiKey=secret`;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async () => [],
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getBarsPage: async () => ({
          bars: [
            {
              timestamp: new Date("2026-04-27T20:00:00.000Z"),
              open: 520,
              high: 522,
              low: 519,
              close: 521,
              volume: 1000,
            },
          ],
          nextUrl: polygonNextUrl,
          pageCount: 3,
          pageLimitReached: true,
          requestedFrom: new Date("2026-04-20T00:00:00.000Z"),
          requestedTo: new Date("2026-04-27T20:00:00.000Z"),
        }),
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getBarsWithDebug({
    symbol,
    timeframe: "1m",
    limit: 5,
    from: new Date("2026-04-20T00:00:00.000Z"),
    to: new Date("2026-04-27T20:00:00.000Z"),
    allowHistoricalSynthesis: true,
  });

  assert.equal(result.gapFilled, true);
  assert.equal(result.bars.length, 1);
  assert.equal(result.historyPage.provider, "polygon-history");
  assert.equal(result.historyPage.providerNextUrl?.includes("apiKey"), false);
  assert.equal(result.historyPage.providerNextUrl?.includes("cursor=xyz"), true);
  assert.equal(result.historyPage.providerCursor, result.historyPage.providerNextUrl);
  assert.equal(result.historyPage.providerPageCount, 3);
  assert.equal(result.historyPage.providerPageLimitReached, true);
  assert.equal(typeof result.historyPage.historyCursor, "string");
  assert.equal(result.historyPage.historyCursor?.includes("apiKey"), false);
});

test("getBarsWithDebug uses opaque history cursors for Polygon continuation", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";
  process.env["CHART_HYDRATION_CURSOR_ENABLED"] = "1";
  const symbol = "TSTCUR2";
  const polygonNextUrl =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/minute/1/2?cursor=next&apiKey=secret`;
  let cursorUrlSeen: string | null = null;
  let windowFetches = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getHistoricalBars: async () => [],
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getBarsPage: async () => {
          windowFetches += 1;
          return {
            bars: [
              {
                timestamp: new Date("2026-04-27T19:55:00.000Z"),
                open: 519,
                high: 521,
                low: 518,
                close: 520,
                volume: 900,
              },
            ],
            nextUrl: polygonNextUrl,
            pageCount: 4,
            pageLimitReached: true,
            requestedFrom: new Date("2026-04-20T00:00:00.000Z"),
            requestedTo: new Date("2026-04-27T20:00:00.000Z"),
          };
        },
        getBarsProviderCursorPage: async (input: { providerNextUrl: string }) => {
          cursorUrlSeen = input.providerNextUrl;
          return {
            bars: [
              {
                timestamp: new Date("2026-04-27T20:00:00.000Z"),
                open: 520,
                high: 522,
                low: 519,
                close: 521,
                volume: 1000,
              },
            ],
            nextUrl: null,
            pageCount: 1,
            pageLimitReached: false,
            requestedFrom: new Date("2026-04-27T20:00:00.000Z"),
            requestedTo: new Date("2026-04-27T20:00:00.000Z"),
          };
        },
      }) as unknown as PolygonMarketDataClient,
  );

  const first = await getBarsWithDebug({
    symbol,
    timeframe: "1m",
    limit: 5,
    from: new Date("2026-04-20T00:00:00.000Z"),
    to: new Date("2026-04-27T20:00:00.000Z"),
    allowHistoricalSynthesis: true,
  });
  const cursor = first.historyPage.historyCursor;
  assert.ok(cursor);

  const second = await getBarsWithDebug({
    symbol,
    timeframe: "1m",
    limit: 5,
    from: new Date("2026-04-20T00:00:00.000Z"),
    to: new Date("2026-04-27T20:00:00.000Z"),
    allowHistoricalSynthesis: true,
    historyCursor: cursor,
    preferCursor: true,
  });

  assert.equal(windowFetches, 1);
  assert.equal(cursorUrlSeen, polygonNextUrl);
  assert.equal(second.bars.some((bar) => bar.close === 521), true);
  assert.equal(second.historyPage.providerPageLimitReached, false);
});

test("getOptionChartBarsWithDebug can use Polygon option aggregates when IBKR contract lookup is backed off", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";
  let polygonTicker: string | null = null;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          throw new HttpError(530, "HTTP 530: error code: 1033", {
            code: "upstream_http_error",
          });
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getOptionAggregateBars: async (input: { optionTicker: string }) => {
          polygonTicker = input.optionTicker;
          return [
            {
              timestamp: new Date("2026-04-27T20:00:00.000Z"),
              open: 1.1,
              high: 1.3,
              low: 1,
              close: 1.25,
              volume: 42,
            },
          ];
        },
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getOptionChartBarsWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
    timeframe: "1m",
    limit: 5,
    outsideRth: false,
  });

  assert.equal(polygonTicker, "O:SPY261218C00970000");
  assert.equal(result.providerContractId, null);
  assert.equal(result.resolutionSource, "none");
  assert.equal(result.dataSource, "polygon-option-aggregates");
  assert.equal(result.feedIssue, true);
  assert.equal(result.emptyReason, null);
  assert.equal(result.bars.length, 1);
});

test("getOptionChartBarsWithDebug uses opaque history cursors for Polygon option aggregates", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";
  process.env["CHART_HYDRATION_CURSOR_ENABLED"] = "1";
  const polygonNextUrl =
    "https://api.polygon.io/v2/aggs/ticker/O:SPY261218C00970000/range/1/minute/1/2?cursor=opt&apiKey=secret";
  let cursorUrlSeen: string | null = null;
  let aggregateFetches = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getOptionChain: async () => {
          const base = optionContract(expirationDate, 970);
          return [
            {
              ...base,
              contract: {
                ...base.contract,
                ticker: "O:SPY261218C00970000",
                providerContractId: "chain-conid",
              },
            },
          ];
        },
        getHistoricalBars: async () => [],
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getOptionAggregateBarsPage: async () => {
          aggregateFetches += 1;
          return {
            bars: [
              {
                timestamp: new Date("2026-04-27T19:55:00.000Z"),
                open: 1.1,
                high: 1.3,
                low: 1,
                close: 1.25,
                volume: 42,
              },
            ],
            nextUrl: polygonNextUrl,
            pageCount: 4,
            pageLimitReached: true,
            requestedFrom: new Date("2026-04-20T00:00:00.000Z"),
            requestedTo: new Date("2026-04-27T20:00:00.000Z"),
          };
        },
        getBarsProviderCursorPage: async (input: { providerNextUrl: string }) => {
          cursorUrlSeen = input.providerNextUrl;
          return {
            bars: [
              {
                timestamp: new Date("2026-04-27T20:00:00.000Z"),
                open: 1.2,
                high: 1.4,
                low: 1.1,
                close: 1.35,
                volume: 50,
              },
            ],
            nextUrl: null,
            pageCount: 1,
            pageLimitReached: false,
            requestedFrom: new Date("2026-04-27T20:00:00.000Z"),
            requestedTo: new Date("2026-04-27T20:00:00.000Z"),
          };
        },
      }) as unknown as PolygonMarketDataClient,
  );

  const first = await getOptionChartBarsWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
    timeframe: "1m",
    limit: 5,
    outsideRth: false,
  });
  const cursor = first.historyPage.historyCursor;
  assert.ok(cursor);

  const second = await getOptionChartBarsWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
    timeframe: "1m",
    limit: 5,
    outsideRth: false,
    historyCursor: cursor,
    preferCursor: true,
  });

  assert.equal(aggregateFetches, 1);
  assert.equal(cursorUrlSeen, polygonNextUrl);
  assert.equal(second.bars.length, 1);
  assert.equal(second.bars[0].close, 1.35);
  assert.equal(second.historyPage.providerPageLimitReached, false);
});

test("getOptionChartBarsWithDebug prefers the flow option ticker for Polygon fallback", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";
  let polygonTicker: string | null = null;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          throw new HttpError(530, "HTTP 530: error code: 1033", {
            code: "upstream_http_error",
          });
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getOptionAggregateBars: async (input: { optionTicker: string }) => {
          polygonTicker = input.optionTicker;
          return [
            {
              timestamp: new Date("2026-04-27T20:00:00.000Z"),
              open: 1.1,
              high: 1.3,
              low: 1,
              close: 1.25,
              volume: 42,
            },
          ];
        },
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getOptionChartBarsWithDebug({
    underlying: "BRK.B",
    expirationDate,
    strike: 512.5,
    right: "put",
    optionTicker: "brk.b261218p00512500",
    timeframe: "1m",
    limit: 5,
    outsideRth: false,
  });

  assert.equal(polygonTicker, "O:BRK.B261218P00512500");
  assert.equal(result.optionTicker, "O:BRK.B261218P00512500");
  assert.equal(result.providerContractId, null);
  assert.equal(result.resolutionSource, "none");
  assert.equal(result.dataSource, "polygon-option-aggregates");
  assert.equal(result.feedIssue, true);
  assert.equal(result.emptyReason, null);
  assert.equal(result.bars.length, 1);
});

test("getOptionChartBarsWithDebug returns no chart when both IBKR and Polygon have no option bars", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getOptionChain: async () => {
          const base = optionContract(expirationDate, 970);
          return [
            {
              ...base,
              contract: {
                ...base.contract,
                ticker: "O:SPY261218C00970000",
                providerContractId: "chain-conid",
              },
            },
          ];
        },
        getHistoricalBars: async () => [],
        getOptionQuoteSnapshots: async () => {
          throw new Error("option quote fallback should not be used");
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getOptionAggregateBars: async () => [],
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getOptionChartBarsWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
    providerContractId: "event-conid",
    timeframe: "1m",
    limit: 5,
    outsideRth: false,
  });

  assert.equal(result.providerContractId, "event-conid");
  assert.equal(result.resolutionSource, "provided");
  assert.equal(result.dataSource, "none");
  assert.equal(result.feedIssue, false);
  assert.equal(result.emptyReason, "no-option-aggregate-bars");
  assert.equal(result.studyFallback, false);
  assert.equal(result.bars.length, 0);
});

test("getOptionChartBarsWithDebug marks IBKR feed issues when Polygon supplies fallback bars", async () => {
  const expirationDate = new Date("2026-12-18T00:00:00.000Z");
  process.env["POLYGON_API_KEY"] = "test";
  process.env["POLYGON_BASE_URL"] = "https://api.polygon.io";

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          marketDataMode: "live",
        }),
        getOptionChain: async () => {
          const base = optionContract(expirationDate, 970);
          return [
            {
              ...base,
              contract: {
                ...base.contract,
                ticker: "O:SPY261218C00970000",
                providerContractId: "chain-conid",
              },
            },
          ];
        },
        getHistoricalBars: async () => {
          throw new HttpError(502, "IBKR history failed");
        },
      }) as unknown as IbkrBridgeClient,
  );
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getOptionAggregateBars: async () => [
          {
            timestamp: new Date("2026-04-27T20:00:00.000Z"),
            open: 1.1,
            high: 1.3,
            low: 1,
            close: 1.25,
            volume: 42,
          },
        ],
      }) as unknown as PolygonMarketDataClient,
  );

  const result = await getOptionChartBarsWithDebug({
    underlying: "SPY",
    expirationDate,
    strike: 970,
    right: "call",
    providerContractId: "event-conid",
    timeframe: "1m",
    limit: 5,
    outsideRth: false,
  });

  assert.equal(result.dataSource, "polygon-option-aggregates");
  assert.equal(result.feedIssue, true);
  assert.equal(result.emptyReason, null);
  assert.equal(result.bars.length, 1);
});

test("option chain lookup degrades to an empty result on transient upstream failure", async () => {
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          throw new HttpError(530, "HTTP 530: error code: 1033", {
            code: "upstream_http_error",
          });
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await getOptionChainWithDebug({
    underlying: "SPY",
    expirationDate: new Date("2026-05-01T00:00:00.000Z"),
    strikesAroundMoney: 2,
  });

  assert.deepEqual(result.contracts, []);
  assert.equal(result.debug.stale, true);
});

test("option expiration lookup degrades to an empty result on transient upstream failure", async () => {
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => {
          throw new HttpError(524, "HTTP 524: timeout", {
            code: "upstream_http_error",
          });
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await getOptionExpirations({ underlying: "SPY" });

  assert.deepEqual(result.expirations, []);
});

test("option chain lookup forwards metadata quote hydration", async () => {
  let seenQuoteHydration: unknown = null;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: {
          expirationDate?: Date;
          quoteHydration?: string;
        }) => {
          seenQuoteHydration = input.quoteHydration;
          assert.ok(input.expirationDate);
          return [optionContract(input.expirationDate)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  await getOptionChainWithDebug({
    underlying: "SPY",
    expirationDate: new Date("2026-05-01T00:00:00.000Z"),
    strikesAroundMoney: 5,
    quoteHydration: "metadata",
  });

  assert.equal(seenQuoteHydration, "metadata");
});

test("metadata option-chain batches can skip delayed Polygon snapshot hydration", async () => {
  process.env["POLYGON_API_KEY"] = "test-polygon-key";
  let polygonChainCalls = 0;
  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          polygonChainCalls += 1;
          return [];
        },
      }) as unknown as PolygonMarketDataClient,
  );
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: { expirationDate?: Date }) => {
          assert.ok(input.expirationDate);
          return [optionContract(input.expirationDate)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await batchOptionChains({
    underlying: "SPY",
    expirationDates: [new Date("2026-05-01T00:00:00.000Z")],
    quoteHydration: "metadata",
    allowDelayedSnapshotHydration: false,
  });

  assert.equal(polygonChainCalls, 0);
  assert.equal(result.results[0]?.contracts.length, 1);
});

test("option chain cache slices full cached chains for narrower requests", async () => {
  let calls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: { expirationDate?: Date }) => {
          calls += 1;
          assert.ok(input.expirationDate);
          return Array.from({ length: 13 }, (_, index) =>
            optionContract(input.expirationDate as Date, 94 + index),
          );
        },
      }) as unknown as IbkrBridgeClient,
  );

  const expirationDate = new Date("2026-05-01T00:00:00.000Z");
  const full = await getOptionChainWithDebug({
    underlying: "SPY",
    expirationDate,
    strikeCoverage: "full",
    quoteHydration: "metadata",
  });
  const narrow = await getOptionChainWithDebug({
    underlying: "SPY",
    expirationDate,
    strikesAroundMoney: 2,
    quoteHydration: "metadata",
  });

  assert.equal(calls, 1);
  assert.equal(full.contracts.length, 13);
  assert.equal(narrow.contracts.length, 5);
  assert.deepEqual(
    narrow.contracts.map((contract) => contract.contract.strike),
    [98, 99, 100, 101, 102],
  );
  assert.equal(narrow.debug.cacheStatus, "hit");
});

test("option chain cache slices full metadata chains around cached underlying spot", async () => {
  let calls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: { expirationDate?: Date }) => {
          calls += 1;
          assert.ok(input.expirationDate);
          return Array.from({ length: 13 }, (_, index) =>
            optionContract(input.expirationDate as Date, 94 + index, {
              bid: 0,
              ask: 0,
              last: 0,
              mark: 0,
              underlyingPrice: 104,
            }),
          );
        },
      }) as unknown as IbkrBridgeClient,
  );

  const expirationDate = new Date("2026-05-01T00:00:00.000Z");
  await getOptionChainWithDebug({
    underlying: "SPY",
    expirationDate,
    strikeCoverage: "full",
    quoteHydration: "metadata",
  });
  const narrow = await getOptionChainWithDebug({
    underlying: "SPY",
    expirationDate,
    strikesAroundMoney: 2,
    quoteHydration: "metadata",
  });

  assert.equal(calls, 1);
  assert.deepEqual(
    narrow.contracts.map((contract) => contract.contract.strike),
    [102, 103, 104, 105, 106],
  );
  assert.equal(narrow.debug.cacheStatus, "hit");
});

test("option chain metadata cache does not satisfy snapshot hydration requests", async () => {
  let calls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async (input: { expirationDate?: Date }) => {
          calls += 1;
          assert.ok(input.expirationDate);
          return [optionContract(input.expirationDate)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const expirationDate = new Date("2026-05-01T00:00:00.000Z");
  await getOptionChainWithDebug({
    underlying: "SPY",
    expirationDate,
    strikeCoverage: "full",
    quoteHydration: "metadata",
  });
  await getOptionChainWithDebug({
    underlying: "SPY",
    expirationDate,
    strikesAroundMoney: 2,
    quoteHydration: "snapshot",
  });

  assert.equal(calls, 2);
});
