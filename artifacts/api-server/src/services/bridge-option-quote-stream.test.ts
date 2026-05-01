import assert from "node:assert/strict";
import test from "node:test";
import {
  __cacheBridgeOptionQuoteForTests,
  __resetBridgeOptionQuoteStreamForTests,
  __setBridgeOptionQuoteClientForTests,
  __setBridgeOptionQuoteStreamNowForTests,
  fetchBridgeOptionQuoteSnapshots,
  getBridgeOptionQuoteStreamDiagnostics,
  subscribeBridgeOptionQuoteSnapshots,
} from "./bridge-option-quote-stream";
import {
  __resetMarketDataAdmissionForTests,
  getMarketDataAdmissionDiagnostics,
} from "./market-data-admission";
import type { QuoteSnapshot } from "../providers/ibkr/client";

function optionQuote(
  providerContractId: string,
  price: number,
  updatedAt = "2026-04-28T14:30:00.000Z",
): QuoteSnapshot {
  return {
    symbol: `OPT${providerContractId}`,
    price,
    bid: price - 0.01,
    ask: price + 0.01,
    bidSize: 10,
    askSize: 10,
    change: 0,
    changePercent: 0,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: 100,
    openInterest: 1_000,
    impliedVolatility: 0.2,
    delta: 0.5,
    gamma: 0.01,
    theta: -0.02,
    vega: 0.1,
    updatedAt: new Date(updatedAt),
    providerContractId,
    transport: "tws",
    delayed: false,
  };
}

test.afterEach(() => {
  __resetBridgeOptionQuoteStreamForTests();
  __setBridgeOptionQuoteClientForTests(null);
  __setBridgeOptionQuoteStreamNowForTests(null);
  __resetMarketDataAdmissionForTests();
});

test("option quote stream shares one bridge stream for duplicate contract demand", async () => {
  const bridgeRequests: string[][] = [];
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      return [];
    },
    streamOptionQuoteSnapshots(input) {
      bridgeRequests.push(input.providerContractIds);
      return () => {};
    },
  });

  const unsubscribeOne = subscribeBridgeOptionQuoteSnapshots(
    { underlying: "SPY", providerContractIds: ["1001"] },
    () => {},
  );
  const unsubscribeTwo = subscribeBridgeOptionQuoteSnapshots(
    { underlying: "SPY", providerContractIds: ["1001"] },
    () => {},
  );

  await new Promise((resolve) => setTimeout(resolve, 220));
  const diagnostics = getBridgeOptionQuoteStreamDiagnostics();
  unsubscribeOne();
  unsubscribeTwo();

  assert.deepEqual(bridgeRequests, [["1001"]]);
  assert.equal(diagnostics.activeConsumerCount, 2);
  assert.equal(diagnostics.unionProviderContractIdCount, 1);
  assert.equal(diagnostics.activeBridgeStreamCount, 1);
});

test("option quote stream fans shared bridge updates to matching subscribers", async () => {
  let emitQuotes: ((quotes: QuoteSnapshot[]) => void) | null = null;
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      return [];
    },
    streamOptionQuoteSnapshots(_input, onQuotes) {
      emitQuotes = onQuotes;
      return () => {};
    },
  });

  const firstPayloads: Array<string[]> = [];
  const secondPayloads: Array<string[]> = [];
  const unsubscribeOne = subscribeBridgeOptionQuoteSnapshots(
    { underlying: "SPY", providerContractIds: ["1001"] },
    (payload) => {
      firstPayloads.push(
        payload.quotes.map((quote) => quote.providerContractId ?? ""),
      );
    },
  );
  const unsubscribeTwo = subscribeBridgeOptionQuoteSnapshots(
    { underlying: "SPY", providerContractIds: ["1001", "1002"] },
    (payload) => {
      secondPayloads.push(
        payload.quotes.map((quote) => quote.providerContractId ?? ""),
      );
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 220));
  const emit = emitQuotes as ((quotes: QuoteSnapshot[]) => void) | null;
  if (!emit) {
    throw new Error("Option quote stream was not opened.");
  }
  emit([optionQuote("1001", 1.1), optionQuote("1002", 2.2)]);
  unsubscribeOne();
  unsubscribeTwo();

  assert.deepEqual(firstPayloads.at(-1), ["1001"]);
  assert.deepEqual(secondPayloads.at(-1), ["1001", "1002"]);
});

test("option quote snapshots reuse fresh shared cache before bridge reads", async () => {
  let snapshotReads = 0;
  const now = new Date("2026-04-28T14:30:00.000Z");
  __setBridgeOptionQuoteStreamNowForTests(now);
  assert.ok(__cacheBridgeOptionQuoteForTests(optionQuote("1001", 1.23)));
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      snapshotReads += 1;
      return [optionQuote("1001", 1.24)];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["1001"],
  });

  assert.equal(snapshotReads, 0);
  assert.equal(payload.quotes.length, 1);
  assert.equal(payload.quotes[0]?.price, 1.23);
  assert.equal(payload.debug?.returnedCount, 1);
});

test("option quote snapshots expose custom admission results for background callers", async () => {
  const bridgeRequests: string[][] = [];
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input) {
      bridgeRequests.push(input.providerContractIds);
      return input.providerContractIds.map((providerContractId, index) =>
        optionQuote(providerContractId, index + 1),
      );
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2002", "2001"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "polygon",
    requiresGreeks: false,
    ttlMs: 1_000,
  });

  assert.deepEqual(bridgeRequests, [["2001", "2002"]]);
  assert.deepEqual(payload.debug?.acceptedProviderContractIds, [
    "2001",
    "2002",
  ]);
  assert.equal(payload.debug?.acceptedCount, 2);
  assert.equal(payload.debug?.rejectedCount, 0);
  assert.equal(payload.quotes.length, 2);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.flowScannerLineCount, 0);
  assert.equal(diagnostics.activeLineCount, 0);
});
