import assert from "node:assert/strict";
import test from "node:test";
import {
  __setPolygonMarketDataClientFactoryForTests,
  getFlowPremiumDistribution,
} from "./platform";

const originalPolygonEnv = Object.fromEntries(
  [
    "POLYGON_API_KEY",
    "POLYGON_KEY",
    "POLYGON_BASE_URL",
    "MASSIVE_API_KEY",
    "MASSIVE_MARKET_DATA_API_KEY",
    "MASSIVE_API_BASE_URL",
  ].map((key) => [key, process.env[key]]),
);

function restorePolygonEnv(): void {
  for (const [key, value] of Object.entries(originalPolygonEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function configurePolygonEnv(): void {
  process.env.POLYGON_API_KEY = "test-polygon-key";
  delete process.env.POLYGON_KEY;
  delete process.env.MASSIVE_API_KEY;
  delete process.env.MASSIVE_MARKET_DATA_API_KEY;
}

function makeAggregate(symbol: string, index: number) {
  return {
    symbol,
    volume: 1_000_000 - index * 1_000,
    vwap: null,
    transactions: null,
    timestamp: new Date("2026-05-06T20:00:00Z"),
    otc: false,
  };
}

function makeDistribution(input: {
  symbol: string;
  volume: number | null | undefined;
  timeframe: "today" | "week" | undefined;
  premiumTotal?: number;
  classifiedPremium?: number;
  classificationConfidence?: "high" | "medium" | "low" | "very_low" | "none";
  sideBasis?: "quote_match" | "tick_test" | "mixed" | "none";
  quoteAccess?: "available" | "unavailable" | "forbidden" | "unknown";
  tradeAccess?: "available" | "unavailable" | "forbidden" | "unknown";
}) {
  const premiumTotal = input.premiumTotal ?? 100_000;
  const classifiedPremium = Math.max(0, input.classifiedPremium ?? 0);
  const neutralPremium = Math.max(0, premiumTotal - classifiedPremium);
  const bucket = {
    inflowPremium: classifiedPremium,
    outflowPremium: 0,
    buyPremium: classifiedPremium,
    sellPremium: 0,
    neutralPremium,
    totalPremium: premiumTotal,
    count: 1,
  };
  const emptyBucket = {
    inflowPremium: 0,
    outflowPremium: 0,
    buyPremium: 0,
    sellPremium: 0,
    neutralPremium: 0,
    totalPremium: 0,
    count: 0,
  };

  return {
    symbol: input.symbol,
    asOf: new Date("2026-05-06T20:01:00Z"),
    timeframe: input.timeframe ?? "today",
    stockDayVolume: input.volume ?? null,
    marketCap: null,
    marketCapTier: "small_or_unknown",
    bucketThresholds: { smallMin: 0, mediumMin: 5_000, largeMin: 25_000 },
    premiumTotal,
    classifiedPremium,
    classificationCoverage: premiumTotal > 0 ? classifiedPremium / premiumTotal : 0,
    classificationConfidence: input.classificationConfidence ?? "none",
    netPremium: classifiedPremium,
    inflowPremium: classifiedPremium,
    outflowPremium: 0,
    buyPremium: classifiedPremium,
    sellPremium: 0,
    neutralPremium,
    callPremium: premiumTotal,
    putPremium: 0,
    buckets: {
      small: emptyBucket,
      medium: emptyBucket,
      large: bucket,
    },
    contractCount: 1,
    tradeCount: classifiedPremium > 0 ? 1 : 0,
    classifiedTradeCount: classifiedPremium > 0 ? 1 : 0,
    quoteMatchedCount: classifiedPremium > 0 ? 1 : 0,
    tickTestMatchedCount: 0,
    sideBasis: input.sideBasis ?? (classifiedPremium > 0 ? "quote_match" : "none"),
    quoteAccess: input.quoteAccess ?? (classifiedPremium > 0 ? "available" : "unavailable"),
    tradeAccess: input.tradeAccess ?? "unavailable",
    source: "polygon-options-snapshot",
    confidence: "partial",
    delayed: false,
    pageCount: 4,
  };
}

test.afterEach(() => {
  __setPolygonMarketDataClientFactoryForTests(null);
  restorePolygonEnv();
});

test("flow premium distribution uses aggressive default Polygon snapshot budget", async () => {
  configurePolygonEnv();
  const symbols = Array.from({ length: 30 }, (_, index) => `AAA${index}`);
  const premiumCalls: Array<{ symbol: string; maxPages: number | undefined }> = [];

  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getGroupedDailyStockAggregates: async () =>
          symbols.map((symbol, index) => makeAggregate(symbol, index)),
        getOptionPremiumDistribution: async (input: {
          underlying: string;
          stockDayVolume?: number | null;
          timeframe?: "today" | "week";
          maxPages?: number;
        }) => {
          premiumCalls.push({
            symbol: input.underlying,
            maxPages: input.maxPages,
          });
          return makeDistribution({
            symbol: input.underlying,
            volume: input.stockDayVolume,
            timeframe: input.timeframe,
          });
        },
      }) as any,
  );

  const response = await getFlowPremiumDistribution();

  assert.equal(response.status, "ok");
  assert.equal(response.source.candidateCount, 24);
  assert.equal(response.source.providerHost, "api.polygon.io");
  assert.equal(response.source.sideBasis, "none");
  assert.equal(response.source.tradeAccess, "unavailable");
  assert.equal(response.source.classificationConfidence, "none");
  assert.equal(response.widgets.length, 6);
  assert.equal(premiumCalls.length, 24);
  assert.deepEqual(
    premiumCalls.map((call) => call.symbol),
    symbols.slice(0, 24),
  );
  assert.ok(premiumCalls.every((call) => call.maxPages === 4));
  assert.deepEqual(
    response.widgets.map((widget) => widget.symbol),
    symbols.slice(0, 6),
  );
});

test("flow premium distribution source reports very low classification confidence", async () => {
  configurePolygonEnv();
  const symbols = Array.from({ length: 7 }, (_, index) => `AAD${index}`);

  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getGroupedDailyStockAggregates: async () =>
          symbols.map((symbol, index) => makeAggregate(symbol, index)),
        getOptionPremiumDistribution: async (input: {
          underlying: string;
          stockDayVolume?: number | null;
          timeframe?: "today" | "week";
        }) =>
          makeDistribution({
            symbol: input.underlying,
            volume: input.stockDayVolume,
            timeframe: input.timeframe,
            premiumTotal: 100_000,
            classifiedPremium: 100,
            classificationConfidence: "very_low",
            sideBasis: "quote_match",
            quoteAccess: "available",
            tradeAccess: "available",
          }),
      }) as any,
  );

  const response = await getFlowPremiumDistribution({
    candidateLimit: 7,
    limit: 6,
    timeframe: "week",
  });

  assert.equal(response.source.sideBasis, "quote_match");
  assert.equal(response.source.classificationCoverage, 0.001);
  assert.equal(response.source.classificationConfidence, "very_low");
});

test("flow premium distribution coalesces in-flight cache-key requests", async () => {
  configurePolygonEnv();
  const symbols = Array.from({ length: 8 }, (_, index) => `AAB${index}`);
  let groupedCalls = 0;
  let resolveGrouped: (value: ReturnType<typeof makeAggregate>[]) => void =
    () => {};
  const groupedPromise = new Promise<ReturnType<typeof makeAggregate>[]>((resolve) => {
    resolveGrouped = resolve;
  });

  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getGroupedDailyStockAggregates: async () => {
          groupedCalls += 1;
          return groupedPromise;
        },
        getOptionPremiumDistribution: async (input: {
          underlying: string;
          stockDayVolume?: number | null;
          timeframe?: "today" | "week";
        }) =>
          makeDistribution({
            symbol: input.underlying,
            volume: input.stockDayVolume,
            timeframe: input.timeframe,
          }),
      }) as any,
  );

  const first = getFlowPremiumDistribution({ candidateLimit: 8 });
  const second = getFlowPremiumDistribution({ candidateLimit: 8 });
  resolveGrouped(symbols.map((symbol, index) => makeAggregate(symbol, index)));

  const [firstResponse, secondResponse] = await Promise.all([first, second]);

  assert.equal(groupedCalls, 1);
  assert.equal(firstResponse.source.candidateCount, 8);
  assert.equal(secondResponse.source.candidateCount, 8);
  assert.deepEqual(
    firstResponse.widgets.map((widget) => widget.symbol),
    secondResponse.widgets.map((widget) => widget.symbol),
  );
});

test("flow premium distribution degrades instead of failing when candidates error", async () => {
  configurePolygonEnv();
  const symbols = Array.from({ length: 6 }, (_, index) => `AAC${index}`);

  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getGroupedDailyStockAggregates: async () =>
          symbols.map((symbol, index) => makeAggregate(symbol, index)),
        getOptionPremiumDistribution: async (input: {
          underlying: string;
          stockDayVolume?: number | null;
          timeframe?: "today" | "week";
        }) => {
          if (input.underlying === symbols[0]) {
            throw new Error("snapshot throttled");
          }
          return makeDistribution({
            symbol: input.underlying,
            volume: input.stockDayVolume,
            timeframe: input.timeframe,
          });
        },
      }) as any,
  );

  const response = await getFlowPremiumDistribution({ candidateLimit: 6 });

  assert.equal(response.status, "degraded");
  assert.equal(response.source.errorCount, 1);
  assert.equal(response.source.errorMessage, "snapshot throttled");
  assert.deepEqual(
    response.widgets.map((widget) => widget.symbol),
    symbols.slice(1),
  );
  assert.deepEqual(
    response.widgets.map((widget) => widget.rank),
    [1, 2, 3, 4, 5],
  );
});

test("flow premium distribution ranks widgets by scored premium", async () => {
  configurePolygonEnv();
  const symbols = ["LOW", "MID", "HIGH", "TAIL"];
  const premiumBySymbol: Record<string, number> = {
    LOW: 100_000,
    MID: 350_000,
    HIGH: 900_000,
    TAIL: 50_000,
  };

  __setPolygonMarketDataClientFactoryForTests(
    () =>
      ({
        getGroupedDailyStockAggregates: async () =>
          symbols.map((symbol, index) => makeAggregate(symbol, index)),
        getOptionPremiumDistribution: async (input: {
          underlying: string;
          stockDayVolume?: number | null;
          timeframe?: "today" | "week";
        }) =>
          makeDistribution({
            symbol: input.underlying,
            volume: input.stockDayVolume,
            timeframe: input.timeframe,
            premiumTotal: premiumBySymbol[input.underlying] ?? 0,
          }),
      }) as any,
  );

  const response = await getFlowPremiumDistribution({
    candidateLimit: 6,
    limit: 3,
  });

  assert.equal(response.status, "ok");
  assert.deepEqual(
    response.widgets.map((widget) => widget.symbol),
    ["HIGH", "MID", "LOW"],
  );
  assert.deepEqual(
    response.widgets.map((widget) => widget.rank),
    [1, 2, 3],
  );
});
