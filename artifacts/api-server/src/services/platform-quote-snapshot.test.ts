import assert from "node:assert/strict";
import test from "node:test";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  __platformQuoteSnapshotTestInternals,
  __setIbkrBridgeClientFactoryForTests,
  __setMassiveMarketDataClientFactoryForTests,
  getQuoteSnapshots,
} from "./platform";
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

test("getQuoteSnapshots uses Massive first for real-time stock snapshots", async () => {
  process.env["MASSIVE_API_KEY"] = "massive-test-key";

  let massiveCalls = 0;
  let bridgeCalls = 0;
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
  } finally {
    delete process.env["MASSIVE_API_KEY"];
  }
});
