import assert from "node:assert/strict";
import test from "node:test";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  __platformQuoteSnapshotTestInternals,
  __setIbkrBridgeClientFactoryForTests,
  __setMassiveMarketDataClientFactoryForTests,
  getQuoteSnapshots,
} from "./platform";
import { __massiveStockQuoteStreamInternalsForTests } from "./massive-stock-quote-stream";
import { __stockAggregateStreamTestInternals } from "./stock-aggregate-stream";
import { __stockQuoteDayChangeContextTestInternals } from "./stock-quote-day-change-context";
import {
  __resetBridgeQuoteStreamForTests,
  __setBridgeQuoteClientForTests,
  __setBridgeQuoteStreamNowForTests,
} from "./bridge-quote-stream";
import { __resetMarketDataAdmissionForTests } from "./market-data-admission";
import {
  __resetBridgeGovernorForTests,
  resetBridgeGovernorOverrides,
} from "./bridge-governor";

const MARKET_DATA_ENV_KEYS = [
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
  "MASSIVE_API_BASE_URL",
  "MASSIVE_STOCKS_RECENCY",
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
  "MASSIVE_API_BASE_URL",
] as const;
const ORIGINAL_MARKET_DATA_ENV = new Map(
  MARKET_DATA_ENV_KEYS.map((key) => [key, process.env[key]] as const),
);

function quote(symbol: string, price: number, updatedAt: string): QuoteSnapshot {
  return {
    symbol,
    price,
    bid: price - 0.01,
    ask: price + 0.01,
    bidSize: 100,
    askSize: 100,
    change: 1,
    changePercent: 1,
    open: price - 1,
    high: price + 1,
    low: price - 2,
    prevClose: price - 1,
    volume: 1_000,
    openInterest: null,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    updatedAt: new Date(updatedAt),
    dataUpdatedAt: new Date(updatedAt),
    providerContractId: `${symbol}-conid`,
    transport: "tws",
    delayed: false,
  };
}

function bridgeHealth() {
  return {
    configured: true,
    authenticated: true,
    connected: true,
    competing: false,
    selectedAccountId: "DU1234567",
    accounts: ["DU1234567"],
    lastTickleAt: new Date(),
    lastError: null,
    lastRecoveryAttemptAt: null,
    lastRecoveryError: null,
    updatedAt: new Date(),
    transport: "tws",
    connectionTarget: "127.0.0.1:4001",
    sessionMode: "live",
    clientId: 101,
    marketDataMode: "live",
    liveMarketDataAvailable: true,
    streamFresh: true,
    lastStreamEventAgeMs: 0,
    strictReady: true,
    strictReason: null,
  };
}

test.beforeEach(() => {
  for (const key of MARKET_DATA_ENV_KEYS) {
    delete process.env[key];
  }
});

test.afterEach(() => {
  __platformQuoteSnapshotTestInternals.resetQuoteSnapshotCache();
  __resetBridgeQuoteStreamForTests();
  __setBridgeQuoteClientForTests(null);
  __setIbkrBridgeClientFactoryForTests(null);
  __setMassiveMarketDataClientFactoryForTests(null);
  __massiveStockQuoteStreamInternalsForTests.reset();
  __stockAggregateStreamTestInternals.reset();
  __stockQuoteDayChangeContextTestInternals.reset();
  __resetMarketDataAdmissionForTests();
  __resetBridgeGovernorForTests();
  resetBridgeGovernorOverrides();
  for (const [key, value] of ORIGINAL_MARKET_DATA_ENV) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("getQuoteSnapshots coalesces concurrent identical snapshot requests", async () => {
  let healthCalls = 0;
  let snapshotCalls = 0;
  let resolveSnapshot!: () => void;
  const pendingSnapshot = new Promise<void>((resolve) => {
    resolveSnapshot = resolve;
  });

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => {
          healthCalls += 1;
          return bridgeHealth();
        },
      }) as never,
  );
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots(symbols) {
      snapshotCalls += 1;
      await pendingSnapshot;
      return symbols.map((symbol, index) =>
        quote(symbol, 500 + index, "2026-05-27T19:30:00.000Z"),
      );
    },
    streamQuoteSnapshots() {
      return () => {};
    },
  });

  const first = getQuoteSnapshots({ symbols: "SPY,QQQ" });
  const second = getQuoteSnapshots({ symbols: "SPY,QQQ" });
  resolveSnapshot();
  const [firstPayload, secondPayload] = await Promise.all([first, second]);

  assert.equal(healthCalls, 1);
  assert.equal(snapshotCalls, 1);
  assert.deepEqual(
    firstPayload.quotes.map((item) => [item.symbol, item.price]),
    [
      ["SPY", 501],
      ["QQQ", 500],
    ],
  );
  assert.deepEqual(secondPayload, firstPayload);
});

test("getQuoteSnapshots serves bounded stale cache while a refresh is stuck", async () => {
  __platformQuoteSnapshotTestInternals.setQuoteSnapshotCacheWindowsForTests({
    ttlMs: 0,
    staleTtlMs: 60_000,
    staleWaitMs: 5,
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => bridgeHealth(),
      }) as never,
  );
  __setBridgeQuoteStreamNowForTests(new Date("2026-05-27T19:30:00.000Z"));
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots(symbols) {
      return symbols.map((symbol) =>
        quote(symbol, 500, "2026-05-27T19:30:00.000Z"),
      );
    },
    streamQuoteSnapshots() {
      return () => {};
    },
  });

  const fresh = await getQuoteSnapshots({ symbols: "SPY" });
  assert.equal(fresh.quotes[0]?.freshness, "live");

  __setBridgeQuoteStreamNowForTests(new Date("2026-05-27T19:30:03.000Z"));
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots() {
      return new Promise<QuoteSnapshot[]>(() => {});
    },
    streamQuoteSnapshots() {
      return () => {};
    },
  });

  const stale = await getQuoteSnapshots({ symbols: "SPY" });

  assert.equal(stale.quotes[0]?.symbol, "SPY");
  assert.equal(stale.quotes[0]?.price, 500);
  assert.equal(stale.quotes[0]?.freshness, "stale");
  assert.equal(typeof stale.quotes[0]?.cacheAgeMs, "number");
});

test("getQuoteSnapshots enriches Massive socket cache with REST day-change context without bridge", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-test-key";

  let massiveCalls = 0;
  let bridgeCalls = 0;
  __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
    ev: "T",
    sym: "SPY",
    p: 500,
    s: 100,
    t: Date.parse("2026-05-27T20:30:00.000Z"),
  });
  __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
    ev: "T",
    sym: "QQQ",
    p: 501,
    s: 100,
    t: Date.parse("2026-05-27T20:30:01.000Z"),
  });
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getQuoteSnapshots(symbols: string[]) {
          massiveCalls += 1;
          return symbols.map((symbol, index) => ({
            symbol,
            price: 500 + index,
            bid: 499 + index,
            ask: 501 + index,
            bidSize: 100,
            askSize: 200,
            change: 1,
            changePercent: 0.2,
            open: 490,
            high: 510,
            low: 480,
            prevClose: 499,
            volume: 1_000,
            updatedAt: new Date("2026-05-27T20:30:00.000Z"),
          }));
        },
      }) as never,
  );
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        async getHealth() {
          bridgeCalls += 1;
          return bridgeHealth();
        },
      }) as never,
  );

  try {
    const payload = await getQuoteSnapshots({ symbols: "SPY,QQQ" });

    assert.equal(massiveCalls, 1);
    assert.equal(bridgeCalls, 0);
    assert.equal(payload.delayed, false);
    assert.equal(payload.fallbackUsed, false);
    assert.deepEqual(
      payload.quotes.map((item) => [item.symbol, item.source, item.freshness]),
      [
        ["SPY", "massive", "live"],
        ["QQQ", "massive", "live"],
      ],
    );
    assert.equal(payload.quotes[0]?.price, 500);
    assert.equal(payload.quotes[0]?.prevClose, 499);
    assert.equal(payload.quotes[0]?.change, 1);
    assert.ok(
      Math.abs((payload.quotes[0]?.changePercent ?? 0) - 0.20040080160320642) <
        0.000000001,
    );
  } finally {
    delete process.env["MASSIVE_API_KEY"];
  }
});

test("getQuoteSnapshots preserves Massive quote socket prices when REST context is empty", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-test-key";

  let massiveCalls = 0;
  __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
    ev: "T",
    sym: "SPY",
    p: 512.25,
    s: 100,
    t: Date.parse("2026-05-27T20:30:00.000Z"),
  });
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getQuoteSnapshots() {
          massiveCalls += 1;
          return [];
        },
      }) as never,
  );

  try {
    const payload = await getQuoteSnapshots({ symbols: "SPY,QQQ" });

    assert.equal(massiveCalls, 1);
    assert.deepEqual(
      payload.quotes.map((item) => [item.symbol, item.source, item.price]),
      [["SPY", "massive", 512.25]],
    );
  } finally {
    delete process.env["MASSIVE_API_KEY"];
  }
});

test("getQuoteSnapshots keeps REST fallback for missing Massive socket symbols with fresh context", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-test-key";

  let massiveCalls = 0;
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getQuoteSnapshots(symbols: string[]) {
          massiveCalls += 1;
          return symbols.map((symbol) => ({
            symbol,
            price: 21.6,
            bid: 21.5,
            ask: 21.65,
            bidSize: 10,
            askSize: 12,
            change: 0.4,
            changePercent: 1.8867924528301887,
            open: 21,
            high: 21.8,
            low: 20.9,
            prevClose: 21.2,
            volume: 2_000,
            updatedAt: new Date("2026-06-04T20:39:00.000Z"),
          }));
        },
      }) as never,
  );

  try {
    const first = await getQuoteSnapshots({
      symbols: "FCEL",
      allowMassiveFallback: true,
    });
    __platformQuoteSnapshotTestInternals.resetQuoteSnapshotCache();
    const second = await getQuoteSnapshots({
      symbols: "FCEL",
      allowMassiveFallback: true,
    });

    assert.equal(massiveCalls, 2);
    assert.deepEqual(
      first.quotes.map((item) => [item.symbol, item.source, item.bid, item.ask]),
      [["FCEL", "massive", 21.5, 21.65]],
    );
    assert.deepEqual(
      second.quotes.map((item) => [item.symbol, item.source, item.bid, item.ask]),
      [["FCEL", "massive", 21.5, 21.65]],
    );
    assert.equal(second.fallbackUsed, true);
  } finally {
    delete process.env["MASSIVE_API_KEY"];
  }
});

test("getQuoteSnapshots uses Massive REST day-change context without replacing live socket prices", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-test-key";

  let massiveCalls = 0;
  __massiveStockQuoteStreamInternalsForTests.handleWebSocketMessage({
    ev: "T",
    sym: "SPY",
    p: 512.25,
    s: 100,
    t: Date.parse("2026-05-27T20:30:00.000Z"),
  });
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getQuoteSnapshots(symbols: string[]) {
          massiveCalls += 1;
          return symbols.map((symbol) => ({
            symbol,
            price: 511,
            bid: 510.9,
            ask: 511.1,
            bidSize: 10,
            askSize: 12,
            change: -1.5,
            changePercent: -0.292,
            open: 513,
            high: 514,
            low: 510,
            prevClose: 513.5,
            volume: 2_000,
            updatedAt: new Date("2026-05-27T20:29:00.000Z"),
          }));
        },
      }) as never,
  );

  try {
    const payload = await getQuoteSnapshots({ symbols: "SPY" });
    const [snapshot] = payload.quotes;

    assert.equal(massiveCalls, 1);
    assert.equal(snapshot?.source, "massive");
    assert.equal(snapshot?.price, 512.25);
    assert.equal(snapshot?.change, -1.25);
    assert.ok(
      Math.abs((snapshot?.changePercent ?? 0) - -0.24342745861733204) <
        0.000000001,
    );
    assert.equal(snapshot?.prevClose, 513.5);
  } finally {
    delete process.env["MASSIVE_API_KEY"];
  }
});

test("getQuoteSnapshots seeds Massive snapshots from aggregate socket cache", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-test-key";

  let massiveCalls = 0;
  __stockAggregateStreamTestInternals.handleMassiveQuoteSnapshot(
    {
      quotes: [
        {
          symbol: "PWR",
          price: 700,
          bid: 699.5,
          ask: 700.5,
          volume: null,
        } as any,
      ],
    },
    Date.parse("2026-05-27T20:30:00.000Z"),
  );
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getQuoteSnapshots() {
          massiveCalls += 1;
          return [];
        },
      }) as never,
  );

  try {
    const payload = await getQuoteSnapshots({ symbols: "PWR" });

    assert.equal(massiveCalls, 1);
    assert.deepEqual(
      payload.quotes.map((item) => [item.symbol, item.source, item.price]),
      [["PWR", "massive", 700]],
    );
  } finally {
    delete process.env["MASSIVE_API_KEY"];
  }
});

test("getQuoteSnapshots uses IBKR bridge for overnight stock snapshots", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-test-key";

  let massiveCalls = 0;
  let bridgeCalls = 0;
  const tradingSessions: Array<"overnight" | null | undefined> = [];
  __setMassiveMarketDataClientFactoryForTests(
    () =>
      ({
        async getQuoteSnapshots() {
          massiveCalls += 1;
          return [];
        },
      }) as never,
  );
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => bridgeHealth(),
      }) as never,
  );
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots(symbols, options) {
      bridgeCalls += 1;
      tradingSessions.push(options?.tradingSession);
      return symbols.map((symbol, index) =>
        quote(symbol, 600 + index, "2026-06-03T02:30:00.000Z"),
      );
    },
    streamQuoteSnapshots() {
      return () => {};
    },
  });

  try {
    const payload = await getQuoteSnapshots({
      symbols: "CEG,UUUU",
      allowMassiveFallback: false,
      tradingSession: "overnight",
    });

    assert.equal(massiveCalls, 0);
    assert.equal(bridgeCalls, 1);
    assert.deepEqual(tradingSessions, ["overnight"]);
    assert.deepEqual(
      payload.quotes.map((item) => [item.symbol, item.source, item.freshness]),
      [
        ["CEG", "ibkr", "live"],
        ["UUUU", "ibkr", "live"],
      ],
    );
  } finally {
    delete process.env["MASSIVE_API_KEY"];
  }
});
