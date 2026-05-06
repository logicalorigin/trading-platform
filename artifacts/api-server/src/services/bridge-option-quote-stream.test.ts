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
import { HttpError } from "../lib/errors";
import {
  __resetBridgeGovernorForTests,
  isBridgeWorkBackedOff,
  runBridgeWork,
} from "./bridge-governor";
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
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  delete process.env["IBKR_BRIDGE_GOVERNOR_QUOTES_BACKOFF_MS"];
  delete process.env["IBKR_BRIDGE_GOVERNOR_QUOTES_FAILURE_THRESHOLD"];
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

test("flow scanner option quote snapshots are not blocked by option-chain governor backoff", async () => {
  await assert.rejects(
    runBridgeWork("options", async () => {
      throw new HttpError(504, "IBKR bridge request to /options/quotes timed out.", {
        code: "upstream_http_error",
      });
    }),
  );
  assert.equal(isBridgeWorkBackedOff("options"), true);

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
    providerContractIds: ["3002", "3001"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 1_000,
  });

  assert.deepEqual(bridgeRequests, [["3001", "3002"]]);
  assert.equal(payload.quotes.length, 2);
  assert.equal(payload.debug?.returnedCount, 2);
  assert.equal(payload.debug?.acceptedCount, 2);
  assert.equal(payload.debug?.rejectedCount, 0);
});

test("flow scanner option quote snapshots bypass quote governor backoff", async () => {
  process.env["IBKR_BRIDGE_GOVERNOR_QUOTES_FAILURE_THRESHOLD"] = "1";
  process.env["IBKR_BRIDGE_GOVERNOR_QUOTES_BACKOFF_MS"] = "1000";

  await assert.rejects(
    runBridgeWork("quotes", async () => {
      throw new HttpError(504, "IBKR bridge request to /quotes timed out.", {
        code: "ibkr_bridge_request_timeout",
      });
    }),
  );
  assert.equal(isBridgeWorkBackedOff("quotes"), true);

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
    providerContractIds: ["4002", "4001"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 1_000,
  });

  assert.deepEqual(bridgeRequests, [["4001", "4002"]]);
  assert.equal(payload.quotes.length, 2);
  assert.equal(payload.debug?.errorMessage, null);
  assert.equal(payload.debug?.returnedCount, 2);
  assert.equal(payload.debug?.acceptedCount, 2);
  assert.equal(payload.debug?.rejectedCount, 0);
});

test("option quote snapshots expose bridge hydration errors in debug metadata", async () => {
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      throw new HttpError(504, "IBKR bridge request to /options/quotes timed out.", {
        code: "upstream_http_error",
      });
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["5001"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 1_000,
  });

  assert.equal(payload.quotes.length, 0);
  assert.match(payload.debug?.errorMessage || "", /timed out/i);
  assert.equal(payload.debug?.acceptedCount, 1);
  assert.equal(payload.debug?.returnedCount, 0);
  assert.deepEqual(payload.debug?.missingProviderContractIds, ["5001"]);
});

test("option quote snapshots do not release same-owner live stream leases", async () => {
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input) {
      return input.providerContractIds.map((providerContractId, index) =>
        optionQuote(providerContractId, index + 1),
      );
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const owner = "trade-option-visible:SPY";
  const unsubscribe = subscribeBridgeOptionQuoteSnapshots(
    {
      underlying: "SPY",
      providerContractIds: ["3001"],
      owner,
      intent: "visible-live",
    },
    () => {},
  );

  await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["3001"],
    owner,
    intent: "visible-live",
  });

  const streamDiagnostics = getBridgeOptionQuoteStreamDiagnostics();
  const admissionDiagnostics = getMarketDataAdmissionDiagnostics();
  unsubscribe();

  assert.equal(streamDiagnostics.activeConsumerCount, 1);
  assert.equal(streamDiagnostics.unionProviderContractIdCount, 1);
  assert.equal(admissionDiagnostics.activeOptionLineCount, 1);
  assert.equal(admissionDiagnostics.activeEquityLineCount, 1);
});
