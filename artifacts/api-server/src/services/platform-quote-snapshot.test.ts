import assert from "node:assert/strict";
import test from "node:test";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  __platformQuoteSnapshotTestInternals,
  __setIbkrBridgeClientFactoryForTests,
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

test.afterEach(() => {
  __platformQuoteSnapshotTestInternals.resetQuoteSnapshotCache();
  __resetBridgeQuoteStreamForTests();
  __setBridgeQuoteClientForTests(null);
  __setIbkrBridgeClientFactoryForTests(null);
  __resetMarketDataAdmissionForTests();
  __resetBridgeGovernorForTests();
  resetBridgeGovernorOverrides();
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
