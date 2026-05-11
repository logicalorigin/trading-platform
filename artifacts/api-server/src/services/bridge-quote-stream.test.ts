import assert from "node:assert/strict";
import test from "node:test";
import {
  __cacheBridgeQuoteForTests,
  __resetBridgeQuoteStreamForTests,
  __resolveCurrentBridgeQuoteStreamSignalAtForTests,
  __setBridgeQuoteClientForTests,
  __setBridgeQuoteStreamNowForTests,
  fetchBridgeQuoteSnapshots,
  getBridgeQuoteStreamDiagnostics,
  getCurrentBridgeQuoteSnapshots,
  subscribeBridgeQuoteSnapshots,
} from "./bridge-quote-stream";
import type { QuoteSnapshot } from "../providers/ibkr/client";

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
    providerContractId: `${symbol}-conid`,
    transport: "tws",
    delayed: false,
  };
}

test.afterEach(() => {
  __resetBridgeQuoteStreamForTests();
  __setBridgeQuoteClientForTests(null);
});

test("bridge quote cache rejects older quote events for the same symbol", () => {
  const newer = quote("spy", 502, "2026-04-28T14:30:02.000Z");
  const older = quote("SPY", 499, "2026-04-28T14:29:58.000Z");

  assert.ok(__cacheBridgeQuoteForTests(newer));
  assert.equal(__cacheBridgeQuoteForTests(older), null);

  const cached = getCurrentBridgeQuoteSnapshots(["SPY"]);
  assert.equal(cached.length, 1);
  assert.equal(cached[0]?.symbol, "SPY");
  assert.equal(cached[0]?.price, 502);
});

test("fetchBridgeQuoteSnapshots hydrates missing symbols through the shared bridge client", async () => {
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots(symbols) {
      return symbols.map((symbol, index) =>
        quote(symbol, 100 + index, "2026-04-28T14:30:00.000Z"),
      );
    },
    streamQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeQuoteSnapshots(["spy", "qqq"]);

  assert.deepEqual(
    payload.quotes.map((item) => [item.symbol, item.price]),
    [
      ["QQQ", 100],
      ["SPY", 101],
    ],
  );
  assert.deepEqual(
    getCurrentBridgeQuoteSnapshots(["SPY", "QQQ"]).map((item) => item.symbol),
    ["QQQ", "SPY"],
  );
});

test("fetchBridgeQuoteSnapshots refreshes stale cached symbols through the shared bridge client", async () => {
  const cachedAt = new Date("2026-04-28T14:30:00.000Z");
  __setBridgeQuoteStreamNowForTests(cachedAt);
  assert.ok(
    __cacheBridgeQuoteForTests(
      quote("SPY", 500, "2026-04-28T14:30:00.000Z"),
    ),
  );

  const requestedSymbols: string[][] = [];
  __setBridgeQuoteStreamNowForTests(new Date("2026-04-28T14:30:03.000Z"));
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots(symbols) {
      requestedSymbols.push(symbols);
      return symbols.map((symbol) =>
        quote(symbol, 501, "2026-04-28T14:30:00.000Z"),
      );
    },
    streamQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeQuoteSnapshots(["spy"]);

  assert.deepEqual(requestedSymbols, [["SPY"]]);
  assert.equal(payload.quotes.length, 1);
  assert.equal(payload.quotes[0]?.symbol, "SPY");
  assert.equal(payload.quotes[0]?.price, 501);
  assert.equal(payload.quotes[0]?.freshness, "live");
  assert.equal(payload.quotes[0]?.cacheAgeMs, 0);
});

test("bridge quote stream records synchronous start failures without crashing", async () => {
  __setBridgeQuoteStreamNowForTests(new Date("2026-04-28T14:30:00.000Z"));
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots() {
      return [];
    },
    streamQuoteSnapshots() {
      throw new TypeError("Invalid URL");
    },
  });

  const unsubscribe = subscribeBridgeQuoteSnapshots(["NVDA"], () => {});
  await new Promise((resolve) => setTimeout(resolve, 180));
  const diagnostics = getBridgeQuoteStreamDiagnostics();
  unsubscribe();

  assert.equal(diagnostics.lastError, "Invalid URL");
  assert.equal(diagnostics.reconnectScheduled, true);
  assert.equal(diagnostics.pressure, "reconnecting");
});

test("bridge quote stream does not hot-loop reconnects during quiet market", async () => {
  let attempts = 0;
  __setBridgeQuoteStreamNowForTests(new Date("2026-04-28T21:30:00.000Z"));
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots() {
      return [];
    },
    streamQuoteSnapshots(_symbols, _onSnapshot, onError) {
      attempts += 1;
      setTimeout(() => onError?.(new Error("IBKR bridge quote stream ended.")), 0);
      return () => {};
    },
  });

  const unsubscribe = subscribeBridgeQuoteSnapshots(["NVDA"], () => {});
  await new Promise((resolve) => setTimeout(resolve, 220));
  const diagnostics = getBridgeQuoteStreamDiagnostics();
  unsubscribe();

  assert.equal(attempts, 1);
  assert.equal(diagnostics.lastError, "IBKR bridge quote stream ended.");
  assert.equal(diagnostics.reconnectScheduled, false);
  assert.equal(diagnostics.pressure, "normal");
});

test("bridge quote stream stall age is anchored to the current stream start", async () => {
  const previousEventAt = new Date("2026-04-28T14:30:00.000Z");
  const streamStartedAt = new Date("2026-04-28T14:45:00.000Z");

  assert.equal(
    __resolveCurrentBridgeQuoteStreamSignalAtForTests(
      previousEventAt,
      streamStartedAt,
    )?.toISOString(),
    streamStartedAt.toISOString(),
  );

  __setBridgeQuoteStreamNowForTests(previousEventAt);
  assert.ok(
    __cacheBridgeQuoteForTests(
      quote("NVDA", 162, "2026-04-28T14:30:00.000Z"),
    ),
  );

  __setBridgeQuoteStreamNowForTests(streamStartedAt);
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots() {
      return [];
    },
    streamQuoteSnapshots() {
      return () => {};
    },
  });

  const unsubscribe = subscribeBridgeQuoteSnapshots(["NVDA"], () => {});
  await new Promise((resolve) => setTimeout(resolve, 220));
  const diagnostics = getBridgeQuoteStreamDiagnostics();
  unsubscribe();

  assert.equal(diagnostics.lastEventAgeMs, 15 * 60_000);
  assert.equal(diagnostics.streamActive, true);
  assert.equal(diagnostics.reconnectScheduled, false);
  assert.equal(diagnostics.pressure, "normal");
});

test("bridge quote stream treats open stream signals as liveness proof", async () => {
  const now = new Date("2026-04-28T14:30:00.000Z");
  __setBridgeQuoteStreamNowForTests(now);
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots() {
      return [];
    },
    streamQuoteSnapshots(_symbols, _onSnapshot, _onError, onSignal) {
      onSignal?.({
        type: "status",
        at: now,
        status: { state: "open", lastEventAgeMs: null },
      });
      return () => {};
    },
  });

  const unsubscribe = subscribeBridgeQuoteSnapshots(["NVDA"], () => {});
  await new Promise((resolve) => setTimeout(resolve, 220));
  const diagnostics = getBridgeQuoteStreamDiagnostics();
  unsubscribe();

  assert.equal(diagnostics.streamActive, true);
  assert.equal(diagnostics.lastSignalAt, now.toISOString());
  assert.equal(diagnostics.lastSignalAgeMs, 0);
  assert.equal(diagnostics.lastEventAgeMs, null);
  assert.equal(diagnostics.freshnessAgeMs, 0);
  assert.equal(diagnostics.transportFreshnessAgeMs, 0);
  assert.equal(diagnostics.dataFreshnessAgeMs, null);
  assert.equal(diagnostics.dataGapCount, 0);
  assert.equal(diagnostics.pressure, "normal");
  assert.equal(diagnostics.lastError, null);
});

test("bridge quote stream updates mutable bridge stream symbols without reconnecting", async () => {
  const now = new Date("2026-04-28T14:30:00.000Z");
  let opened = 0;
  const updates: string[][] = [];
  __setBridgeQuoteStreamNowForTests(now);
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots() {
      return [];
    },
    streamMutableQuoteSnapshots(_symbols, _onSnapshot, _onError, onSignal) {
      opened += 1;
      onSignal?.({
        type: "ready",
        at: now,
        status: { state: "open" },
      });
      return {
        async setSymbols(symbols) {
          updates.push(symbols);
        },
        close() {},
      };
    },
    streamQuoteSnapshots() {
      throw new Error("legacy stream should not be used");
    },
  });

  const unsubscribeSpy = subscribeBridgeQuoteSnapshots(["SPY"], () => {});
  await new Promise((resolve) => setTimeout(resolve, 220));
  const unsubscribeQqq = subscribeBridgeQuoteSnapshots(["QQQ"], () => {});
  await new Promise((resolve) => setTimeout(resolve, 220));
  const diagnostics = getBridgeQuoteStreamDiagnostics();
  unsubscribeQqq();
  unsubscribeSpy();

  assert.equal(opened, 1);
  assert.deepEqual(updates.at(-1), ["QQQ", "SPY"]);
  assert.equal(diagnostics.mutableStreamActive, true);
  assert.equal(diagnostics.mutableUpdateCount, 1);
  assert.equal(diagnostics.reconnectScheduled, false);
});

test("bridge quote stream reports capacity pressure without reconnecting", async () => {
  const now = new Date("2026-04-28T14:30:00.000Z");
  __setBridgeQuoteStreamNowForTests(now);
  __setBridgeQuoteClientForTests({
    async getQuoteSnapshots() {
      return [];
    },
    streamQuoteSnapshots(_symbols, _onSnapshot, _onError, onSignal) {
      onSignal?.({
        type: "status",
        at: now,
        status: {
          state: "backpressure",
          reason: "ibkr_bridge_lane_queue_full",
          requestedCount: 3,
          admittedCount: 0,
          rejectedCount: 3,
        },
      });
      return () => {};
    },
  });

  const unsubscribe = subscribeBridgeQuoteSnapshots(["SPY", "QQQ"], () => {});
  await new Promise((resolve) => setTimeout(resolve, 220));
  const diagnostics = getBridgeQuoteStreamDiagnostics();
  unsubscribe();

  assert.equal(diagnostics.streamActive, true);
  assert.equal(diagnostics.reconnectScheduled, false);
  assert.equal(diagnostics.pressure, "backpressure");
  assert.equal(diagnostics.lastError, null);
});
