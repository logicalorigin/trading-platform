import assert from "node:assert/strict";
import test from "node:test";
import {
  __cacheBridgeOptionQuoteForTests,
  __resetBridgeOptionQuoteStreamForTests,
  __setBridgeOptionQuoteClientForTests,
  __setBridgeOptionQuoteRuntimeConfiguredForTests,
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
  setBridgeGovernorOverrides,
} from "./bridge-governor";
import type { QuoteSnapshot } from "../providers/ibkr/client";
import {
  __resetApiResourcePressureForTests,
  resolveApiRssPressureThresholds,
  updateApiResourcePressure,
} from "./resource-pressure";

const ENV_KEYS = [
  "IBKR_MARKET_DATA_APP_MAX_LINES",
  "IBKR_MARKET_DATA_RESERVE_LINES",
  "IBKR_MARKET_DATA_EXECUTION_LINES",
  "IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES",
  "IBKR_MARKET_DATA_VISIBLE_LINES",
  "IBKR_MARKET_DATA_AUTOMATION_LINES",
  "IBKR_MARKET_DATA_FLOW_SCANNER_LINES",
  "IBKR_MARKET_DATA_CONVENIENCE_LINES",
  "IBKR_FLOW_SCANNER_LIVE_OPTION_QUOTE_CAP",
  "IBKR_BRIDGE_GOVERNOR_QUOTES_BACKOFF_MS",
  "IBKR_BRIDGE_GOVERNOR_QUOTES_FAILURE_THRESHOLD",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);
const REGULAR_SESSION_NOW = new Date("2026-04-28T14:30:00.000Z");

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  ENV_KEYS.forEach((key) => {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  });
}

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

function structuredOptionProviderContractId(): string {
  return `twsopt:${Buffer.from(
    JSON.stringify({
      v: 1,
      u: "META",
      e: "20260522",
      s: 605,
      r: "C",
      x: "SMART",
      tc: "META",
      m: 100,
    }),
    "utf8",
  ).toString("base64url")}`;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(predicate(), true);
}

test.afterEach(() => {
  __resetBridgeOptionQuoteStreamForTests();
  __setBridgeOptionQuoteClientForTests(null);
  __setBridgeOptionQuoteStreamNowForTests(null);
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __resetApiResourcePressureForTests();
  setEnv(originalEnv);
});

test.beforeEach(() => {
  __setBridgeOptionQuoteStreamNowForTests(REGULAR_SESSION_NOW);
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

test("option quote snapshots rehydrate fresh price-only cache when Greeks are required", async () => {
  let snapshotReads = 0;
  const now = new Date("2026-04-28T14:30:00.000Z");
  __setBridgeOptionQuoteStreamNowForTests(now);
  assert.ok(
    __cacheBridgeOptionQuoteForTests({
      ...optionQuote("1001", 1.23),
      impliedVolatility: null,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
    }),
  );
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
    requiresGreeks: true,
  });

  assert.equal(snapshotReads, 1);
  assert.equal(payload.quotes.length, 1);
  assert.equal(payload.quotes[0]?.price, 1.24);
  assert.equal(payload.quotes[0]?.delta, 0.5);
  assert.equal(payload.quotes[0]?.gamma, 0.01);
  assert.equal(payload.debug?.upstreamMs !== null, true);
});

test("option quote snapshots retry price-only bridge results when Greeks are required", async () => {
  let snapshotReads = 0;
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
      if (snapshotReads === 1) {
        return [
          {
            ...optionQuote("1001", 1.23),
            impliedVolatility: null,
            delta: null,
            gamma: null,
            theta: null,
            vega: null,
          },
        ];
      }
      return [optionQuote("1001", 1.24, "2026-04-28T14:30:01.000Z")];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["1001"],
    requiresGreeks: true,
  });

  assert.equal(snapshotReads, 2);
  assert.equal(payload.quotes.length, 1);
  assert.equal(payload.quotes[0]?.price, 1.24);
  assert.equal(payload.quotes[0]?.delta, 0.5);
  assert.equal(payload.quotes[0]?.gamma, 0.01);
});

test("option quote snapshots do not admit leases or call bridge when runtime is missing", async () => {
  let healthReads = 0;
  let snapshotReads = 0;
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      healthReads += 1;
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
      throw new Error("stream should not open");
    },
  });
  __setBridgeOptionQuoteRuntimeConfiguredForTests(false);

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["1001"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
  });

  assert.equal(healthReads, 0);
  assert.equal(snapshotReads, 0);
  assert.equal(payload.quotes.length, 0);
  assert.equal(payload.debug?.errorCode, "ibkr_bridge_not_configured");
  assert.equal(payload.debug?.acceptedCount, 0);
  assert.equal(payload.debug?.rejectedCount, 1);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeOptionLineCount, 0);
  assert.equal(diagnostics.activeLineCount, 0);
});

test("flow scanner live option snapshots are blocked outside regular trading", async () => {
  __setBridgeOptionQuoteStreamNowForTests(new Date("2026-11-27T18:30:00.000Z"));
  let healthReads = 0;
  let snapshotReads = 0;
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      healthReads += 1;
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
      throw new Error("stream should not open");
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["1001"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
  });

  assert.equal(healthReads, 0);
  assert.equal(snapshotReads, 0);
  assert.equal(payload.quotes.length, 0);
  assert.equal(payload.debug?.blockedReason, "market_session_quiet");
  assert.equal(payload.debug?.errorCode, "ibkr_live_option_quote_blocked");
  assert.match(payload.debug?.errorMessage ?? "", /regular trading is closed/i);
  assert.equal(payload.debug?.acceptedCount, 0);
  assert.equal(payload.debug?.rejectedCount, 1);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.flowScannerLineCount, 0);
  assert.equal(diagnostics.activeLineCount, 0);
});

test("option quote subscriptions do not admit leases or open streams while runtime is missing", async () => {
  let streamReads = 0;
  const payloads: Array<string | null | undefined> = [];
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      throw new Error("health should not be read");
    },
    async getOptionQuoteSnapshots() {
      throw new Error("snapshots should not be read");
    },
    streamOptionQuoteSnapshots() {
      streamReads += 1;
      return () => {};
    },
  });
  __setBridgeOptionQuoteRuntimeConfiguredForTests(false);

  const unsubscribe = subscribeBridgeOptionQuoteSnapshots(
    { underlying: "SPY", providerContractIds: ["1001"] },
    (payload) => payloads.push(payload.debug?.errorCode),
  );

  await new Promise((resolve) => setTimeout(resolve, 220));
  const streamDiagnostics = getBridgeOptionQuoteStreamDiagnostics();
  const admissionDiagnostics = getMarketDataAdmissionDiagnostics();
  unsubscribe();

  assert.deepEqual(payloads, ["ibkr_bridge_not_configured"]);
  assert.equal(streamReads, 0);
  assert.equal(streamDiagnostics.activeConsumerCount, 1);
  assert.equal(streamDiagnostics.unionProviderContractIdCount, 0);
  assert.equal(streamDiagnostics.requestedProviderContractIdCount, 1);
  assert.equal(admissionDiagnostics.activeOptionLineCount, 0);
});

test("option quote shared cache preserves prices when a partial zero quote is newer", () => {
  assert.ok(
    __cacheBridgeOptionQuoteForTests(
      optionQuote("1001", 1.23, "2026-04-28T14:30:00.000Z"),
    ),
  );

  const partialZeroQuote = {
    ...optionQuote("1001", 0, "2026-04-28T14:31:00.000Z"),
    bid: 0,
    ask: 0,
    change: -1.23,
    changePercent: -100,
    volume: 250,
    openInterest: 2_000,
    delta: 0.42,
  };
  const cached = __cacheBridgeOptionQuoteForTests(partialZeroQuote);

  assert.equal(cached?.price, 1.23);
  assert.equal(cached?.bid, 1.22);
  assert.equal(cached?.ask, 1.24);
  assert.equal(cached?.change, 0);
  assert.equal(cached?.changePercent, 0);
  assert.equal(cached?.volume, 250);
  assert.equal(cached?.openInterest, 2_000);
  assert.equal(cached?.delta, 0.42);
  assert.equal(
    cached?.updatedAt.toISOString(),
    "2026-04-28T14:31:00.000Z",
  );
});

test("option quote shared cache preserves Greeks when a newer price-only quote arrives", () => {
  assert.ok(
    __cacheBridgeOptionQuoteForTests(
      optionQuote("1001", 1.23, "2026-04-28T14:30:00.000Z"),
    ),
  );

  const priceOnlyQuote = {
    ...optionQuote("1001", 1.31, "2026-04-28T14:31:00.000Z"),
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
  };
  const cached = __cacheBridgeOptionQuoteForTests(priceOnlyQuote);

  assert.equal(cached?.price, 1.31);
  assert.equal(cached?.delta, 0.5);
  assert.equal(cached?.gamma, 0.01);
  assert.equal(cached?.theta, -0.02);
  assert.equal(cached?.vega, 0.1);
  assert.equal(cached?.impliedVolatility, 0.2);
});

test("option quote shared cache accepts zero bid when the same quote has a usable ask", () => {
  assert.ok(
    __cacheBridgeOptionQuoteForTests(
      optionQuote("1001", 1.23, "2026-04-28T14:30:00.000Z"),
    ),
  );

  const zeroBidQuote = {
    ...optionQuote("1001", 1.21, "2026-04-28T14:31:00.000Z"),
    bid: 0,
    ask: 1.24,
    change: -0.02,
    changePercent: -1.63,
  };
  const cached = __cacheBridgeOptionQuoteForTests(zeroBidQuote);

  assert.equal(cached?.price, 1.21);
  assert.equal(cached?.bid, 0);
  assert.equal(cached?.ask, 1.24);
  assert.equal(cached?.changePercent, -1.63);
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
    fallbackProvider: "massive",
    requiresGreeks: false,
    ttlMs: 1_000,
  });

  assert.deepEqual(bridgeRequests, [["2001", "2002"]]);
  assert.deepEqual(payload.debug?.acceptedProviderContractIds, ["2001", "2002"]);
  assert.equal(payload.debug?.acceptedCount, 2);
  assert.equal(payload.debug?.rejectedCount, 0);
  assert.equal(payload.debug?.blockedReason, null);
  assert.equal(payload.debug?.errorCode, undefined);
  assert.equal(payload.quotes.length, 2);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.flowScannerLineCount, 0);
  assert.equal(diagnostics.activeLineCount, 0);
});

test("retained flow scanner snapshot leases open matching bridge streams", async () => {
  const snapshotRequests: string[][] = [];
  const streamRequests: string[][] = [];
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input) {
      snapshotRequests.push(input.providerContractIds);
      return input.providerContractIds.map((providerContractId, index) =>
        optionQuote(providerContractId, index + 1),
      );
    },
    streamOptionQuoteSnapshots(input) {
      streamRequests.push(input.providerContractIds);
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2202", "2201"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 1_000,
    releaseLeasesOnComplete: false,
  });

  await waitFor(
    () => getBridgeOptionQuoteStreamDiagnostics().unionProviderContractIdCount === 2,
  );
  await waitFor(() => streamRequests.length === 1);
  const streamDiagnostics = getBridgeOptionQuoteStreamDiagnostics();
  const admissionDiagnostics = getMarketDataAdmissionDiagnostics();

  assert.deepEqual(snapshotRequests, [["2201", "2202"]]);
  assert.deepEqual(streamRequests, [["2201", "2202"]]);
  assert.equal(payload.debug?.acceptedCount, 2);
  assert.equal(streamDiagnostics.activeConsumerCount, 0);
  assert.equal(streamDiagnostics.activeBridgeStreamCount, 1);
  assert.deepEqual(streamDiagnostics.desiredProviderContractIds, ["2201", "2202"]);
  assert.equal(admissionDiagnostics.flowScannerLineCount, 2);
});

test("retained flow scanner snapshot demand debounces stream reconfiguration after activation", async () => {
  const streamRequests: string[][] = [];
  let streamUnsubscribes = 0;
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
    streamOptionQuoteSnapshots(input) {
      streamRequests.push(input.providerContractIds);
      return () => {
        streamUnsubscribes += 1;
      };
    },
  });

  await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2211"],
    owner: "flow-scanner:SPY:first",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 2_000,
    releaseLeasesOnComplete: false,
  });

  await waitFor(() => streamRequests.length === 1);

  await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2212"],
    owner: "flow-scanner:SPY:second",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 2_000,
    releaseLeasesOnComplete: false,
  });

  assert.deepEqual(streamRequests, [["2211"]]);
  await waitFor(() => streamRequests.length === 2, 1_500);

  assert.deepEqual(streamRequests, [["2211"], ["2211", "2212"]]);
  assert.equal(streamUnsubscribes, 1);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 2);
});

test("retained flow scanner snapshot leases open streams while hydration is in flight", async () => {
  const snapshotRequests: string[][] = [];
  const streamRequests: string[][] = [];
  let resolveSnapshotRequest!: (quotes: QuoteSnapshot[]) => void;
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    getOptionQuoteSnapshots(input) {
      snapshotRequests.push(input.providerContractIds);
      return new Promise<QuoteSnapshot[]>((resolve) => {
        resolveSnapshotRequest = resolve;
      });
    },
    streamOptionQuoteSnapshots(input) {
      streamRequests.push(input.providerContractIds);
      return () => {};
    },
  });

  const request = fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2252", "2251"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 1_000,
    releaseLeasesOnComplete: false,
  });

  await waitFor(() => snapshotRequests.length === 1);
  await waitFor(
    () => getBridgeOptionQuoteStreamDiagnostics().unionProviderContractIdCount === 2,
  );
  await waitFor(() => streamRequests.length === 1);

  assert.deepEqual(snapshotRequests, [["2251", "2252"]]);
  assert.deepEqual(streamRequests, [["2251", "2252"]]);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 2);

  resolveSnapshotRequest([
    optionQuote("2251", 1),
    optionQuote("2252", 2),
  ]);
  const payload = await request;
  assert.equal(payload.debug?.acceptedCount, 2);
});

test("retained flow scanner snapshot leases survive transient hydration errors", async () => {
  const snapshotRequests: string[][] = [];
  const streamRequests: string[][] = [];
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input) {
      snapshotRequests.push(input.providerContractIds);
      throw new HttpError(504, "IBKR bridge request to /options/quotes timed out.", {
        code: "upstream_http_error",
      });
    },
    streamOptionQuoteSnapshots(input) {
      streamRequests.push(input.providerContractIds);
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2261"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 1_000,
    releaseLeasesOnComplete: false,
  });

  await waitFor(
    () => getBridgeOptionQuoteStreamDiagnostics().unionProviderContractIdCount === 1,
  );
  await waitFor(() => streamRequests.length === 1);
  const streamDiagnostics = getBridgeOptionQuoteStreamDiagnostics();
  const admissionDiagnostics = getMarketDataAdmissionDiagnostics();

  assert.deepEqual(snapshotRequests, [["2261"]]);
  assert.deepEqual(streamRequests, [["2261"]]);
  assert.equal(payload.quotes.length, 0);
  assert.match(payload.debug?.errorMessage || "", /timed out/i);
  assert.equal(payload.debug?.acceptedCount, 1);
  assert.equal(streamDiagnostics.activeBridgeStreamCount, 1);
  assert.deepEqual(streamDiagnostics.desiredProviderContractIds, ["2261"]);
  assert.equal(admissionDiagnostics.flowScannerLineCount, 1);
  assert.equal(admissionDiagnostics.activeLineCount, 1);
});

test("retained flow scanner snapshot streams close when quote leases expire", async () => {
  const streamRequests: string[][] = [];
  let streamUnsubscribes = 0;
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
    streamOptionQuoteSnapshots(input) {
      streamRequests.push(input.providerContractIds);
      return () => {
        streamUnsubscribes += 1;
      };
    },
  });

  await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2301"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 20,
    releaseLeasesOnComplete: false,
  });

  await waitFor(
    () => getBridgeOptionQuoteStreamDiagnostics().activeBridgeStreamCount === 1,
  );
  await waitFor(
    () => getBridgeOptionQuoteStreamDiagnostics().activeBridgeStreamCount === 0,
  );

  assert.deepEqual(streamRequests, [["2301"]]);
  assert.equal(streamUnsubscribes, 1);
  assert.equal(getBridgeOptionQuoteStreamDiagnostics().unionProviderContractIdCount, 0);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 0);
});

test("flow scanner live option snapshots stay admitted under watch pressure", async () => {
  __setBridgeOptionQuoteStreamNowForTests(REGULAR_SESSION_NOW);
  setEnv({
    IBKR_FLOW_SCANNER_LIVE_OPTION_QUOTE_CAP: "2",
  });
  updateApiResourcePressure({ rssMb: 950 });
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
      return [];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2101", "2102"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
  });

  assert.deepEqual(bridgeRequests[0], ["2101", "2102"]);
  assert.ok(bridgeRequests.length >= 1);
  assert.equal(payload.debug?.blockedReason, null);
  assert.equal(payload.debug?.acceptedCount, 2);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 0);
});

test("flow scanner live option snapshots stay admitted under soft RSS critical pressure", async () => {
  __setBridgeOptionQuoteStreamNowForTests(REGULAR_SESSION_NOW);
  setEnv({
    IBKR_FLOW_SCANNER_LIVE_OPTION_QUOTE_CAP: "2",
  });
  updateApiResourcePressure({
    rssMb: resolveApiRssPressureThresholds().critical + 1,
  });
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
      return [];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2201", "2202"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
  });

  assert.deepEqual(bridgeRequests[0], ["2201", "2202"]);
  assert.equal(payload.debug?.blockedReason, null);
  assert.equal(payload.debug?.acceptedCount, 2);
});

test("flow scanner live option snapshots are blocked only under hard API pressure", async () => {
  __setBridgeOptionQuoteStreamNowForTests(REGULAR_SESSION_NOW);
  updateApiResourcePressure({ apiHeapUsedPercent: 91 });
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
      return [];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["2301", "2302"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
  });

  assert.deepEqual(bridgeRequests, []);
  assert.equal(payload.debug?.blockedReason, "resource_pressure");
  assert.equal(payload.debug?.acceptedCount, 0);
});

test("option quote snapshot abort releases flow scanner leases immediately", async () => {
  setEnv({
    IBKR_FLOW_SCANNER_LIVE_OPTION_QUOTE_CAP: "1",
  });
  const controller = new AbortController();
  const providerContractId = structuredOptionProviderContractId();
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input) {
      assert.equal(input.signal, controller.signal);
      return new Promise<QuoteSnapshot[]>((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () =>
            reject(input.signal?.reason ?? new Error("snapshot aborted")),
          { once: true },
        );
      });
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const request = fetchBridgeOptionQuoteSnapshots({
    underlying: "META",
    providerContractIds: [providerContractId],
    owner: "flow-scanner:META",
    intent: "flow-scanner-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    signal: controller.signal,
  });

  await waitFor(
    () => getMarketDataAdmissionDiagnostics().flowScannerLineCount === 1,
  );
  controller.abort(new Error("scanner timeout"));
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 0);

  const payload = await request;
  assert.match(payload.debug?.errorMessage ?? "", /scanner timeout/i);
  assert.equal(getMarketDataAdmissionDiagnostics().activeLineCount, 0);
});

test("option quote snapshots keep cached rejected contracts in the payload", async () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "1",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
    IBKR_FLOW_SCANNER_LIVE_OPTION_QUOTE_CAP: "1",
  });
  const now = new Date("2026-04-28T14:30:00.000Z");
  __setBridgeOptionQuoteStreamNowForTests(now);
  assert.ok(__cacheBridgeOptionQuoteForTests(optionQuote("2002", 2.2)));
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
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 1_000,
  });

  assert.deepEqual(bridgeRequests, [["2001"]]);
  assert.deepEqual(
    payload.quotes.map((quote) => quote.providerContractId),
    ["2001", "2002"],
  );
  assert.equal(payload.debug?.acceptedCount, 1);
  assert.equal(payload.debug?.rejectedCount, 1);
  assert.equal(payload.debug?.returnedCount, 2);
  assert.deepEqual(payload.debug?.missingProviderContractIds, []);
});

test("option quote snapshots ignore Massive option tickers before bridge hydration", async () => {
  const bridgeRequests: string[][] = [];
  const structuredProviderContractId = structuredOptionProviderContractId();
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
    underlying: "META",
    providerContractIds: [
      "O:META260522C00605000",
      "1001",
      structuredProviderContractId,
    ],
    owner: "trade-option-visible:META",
    intent: "visible-live",
    fallbackProvider: "none",
    requiresGreeks: false,
    ttlMs: 1_000,
  });

  assert.deepEqual(bridgeRequests, [["1001", structuredProviderContractId]]);
  assert.equal(payload.debug?.requestedCount, 3);
  assert.equal(payload.debug?.acceptedCount, 2);
  assert.equal(payload.debug?.rejectedCount, 1);
  assert.deepEqual(payload.debug?.acceptedProviderContractIds, [
    "1001",
    structuredProviderContractId,
  ]);
  assert.deepEqual(
    payload.quotes.map((quote) => quote.providerContractId),
    ["1001", structuredProviderContractId],
  );
});

test("option quote stream subscriptions do not admit Massive option tickers", async () => {
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

  const unsubscribe = subscribeBridgeOptionQuoteSnapshots(
    {
      underlying: "META",
      providerContractIds: ["O:META260522C00605000", "1001"],
      owner: "trade-option-visible:META",
    },
    () => {},
  );

  await new Promise((resolve) => setTimeout(resolve, 220));
  const diagnostics = getMarketDataAdmissionDiagnostics();
  unsubscribe();

  assert.deepEqual(bridgeRequests, [["1001"]]);
  assert.equal(diagnostics.activeOptionLineCount, 1);
  assert.equal(diagnostics.activeLineCount, 2);
});

test("automation display option quote subscribers stay live under critical pressure", async () => {
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

  const unsubscribe = subscribeBridgeOptionQuoteSnapshots(
    {
      underlying: "CRWV",
      providerContractIds: ["CRWV-1", "CRWV-2"],
      owner: "algo-operations:CRWV",
      intent: "automation-live",
      fallbackProvider: "cache",
      requiresGreeks: false,
    },
    () => {},
  );

  await waitFor(
    () => getBridgeOptionQuoteStreamDiagnostics().unionProviderContractIdCount === 2,
  );
  await waitFor(() => bridgeRequests.length === 1);
  assert.deepEqual(bridgeRequests, [["CRWV-1", "CRWV-2"]]);

  updateApiResourcePressure({ rssMb: 1_650 });
  await waitFor(
    () => getBridgeOptionQuoteStreamDiagnostics().unionProviderContractIdCount === 2,
  );
  const streamDiagnostics = getBridgeOptionQuoteStreamDiagnostics();
  const admissionDiagnostics = getMarketDataAdmissionDiagnostics();
  unsubscribe();

  assert.equal(streamDiagnostics.requestedProviderContractIdCount, 2);
  assert.equal(streamDiagnostics.nonLiveProviderContractIdCount, 0);
  assert.equal(admissionDiagnostics.activeOptionLineCount, 2);
});

test("option quote stream keeps cached rejected contracts subscribed", async () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "1",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
    IBKR_FLOW_SCANNER_LIVE_OPTION_QUOTE_CAP: "1",
  });
  const now = new Date("2026-04-28T14:30:00.000Z");
  __setBridgeOptionQuoteStreamNowForTests(now);
  assert.ok(__cacheBridgeOptionQuoteForTests(optionQuote("1002", 2.2)));
  const bridgeRequests: string[][] = [];
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
    streamOptionQuoteSnapshots(input, onQuotes) {
      bridgeRequests.push(input.providerContractIds);
      emitQuotes = onQuotes;
      return () => {};
    },
  });

  const payloads: string[][] = [];
  const unsubscribe = subscribeBridgeOptionQuoteSnapshots(
    {
      underlying: "SPY",
      providerContractIds: ["1002", "1001"],
      owner: "flow-scanner:SPY",
      intent: "flow-scanner-live",
      fallbackProvider: "none",
      requiresGreeks: false,
    },
    (payload) => {
      payloads.push(payload.quotes.map((quote) => quote.providerContractId ?? ""));
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 220));
  const diagnostics = getBridgeOptionQuoteStreamDiagnostics();
  const emit = emitQuotes as ((quotes: QuoteSnapshot[]) => void) | null;
  if (!emit) {
    throw new Error("Option quote stream was not opened.");
  }
  emit([optionQuote("1001", 1.1)]);
  unsubscribe();

  assert.deepEqual(bridgeRequests, [["1001"]]);
  assert.deepEqual(payloads[0], ["1002"]);
  assert.deepEqual(payloads.at(-1), ["1001"]);
  assert.equal(diagnostics.unionProviderContractIdCount, 1);
  assert.equal(diagnostics.requestedProviderContractIdCount, 2);
  assert.equal(diagnostics.nonLiveProviderContractIdCount, 1);
});

test("flow scanner option quote snapshots are not blocked by option-chain governor backoff", async () => {
  setEnv({
    IBKR_FLOW_SCANNER_LIVE_OPTION_QUOTE_CAP: "2",
  });
  setBridgeGovernorOverrides({ options: { failureThreshold: 1 } });
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

test("signal options automation quote snapshots are not blocked by option-chain governor backoff", async () => {
  setBridgeGovernorOverrides({ options: { failureThreshold: 1 } });
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
    underlying: "NVDA",
    providerContractIds: ["3102", "3101"],
    owner: "signal-options-position-mark:deploy-1:position-1",
    intent: "automation-live",
    fallbackProvider: "cache",
    requiresGreeks: false,
    ttlMs: 1_000,
  });

  assert.deepEqual(bridgeRequests, [["3101", "3102"]]);
  assert.equal(payload.quotes.length, 2);
  assert.equal(payload.debug?.returnedCount, 2);
  assert.equal(payload.debug?.acceptedCount, 2);
  assert.equal(payload.debug?.rejectedCount, 0);
});

test("signal options position mark snapshots stay allowed under critical pressure", async () => {
  updateApiResourcePressure({ rssMb: 1_650 });
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
      return [];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "NVDA",
    providerContractIds: ["3101"],
    owner: "signal-options-position-mark:deploy-1:position-1",
    intent: "automation-live",
    fallbackProvider: "cache",
    requiresGreeks: false,
  });

  assert.deepEqual(bridgeRequests, [["3101"], ["3101"]]);
  assert.equal(payload.debug?.blockedReason, null);
  assert.equal(payload.debug?.acceptedCount, 1);
  assert.equal(getMarketDataAdmissionDiagnostics().activeOptionLineCount, 0);
});

test("flow scanner option quote snapshots honor quote governor backoff", async () => {
  setEnv({
    IBKR_FLOW_SCANNER_LIVE_OPTION_QUOTE_CAP: "2",
  });
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

  assert.deepEqual(bridgeRequests, []);
  assert.equal(payload.quotes.length, 0);
  assert.equal(
    payload.debug?.errorMessage,
    "IBKR bridge quotes work is backed off.",
  );
  assert.equal(payload.debug?.returnedCount, 0);
  assert.equal(payload.debug?.acceptedCount, 2);
  assert.equal(payload.debug?.rejectedCount, 0);
});

test("option quote snapshots expose bridge hydration errors in debug metadata", async () => {
  setEnv({
    IBKR_FLOW_SCANNER_LIVE_OPTION_QUOTE_CAP: "1",
  });
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
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.flowScannerLineCount, 0);
  assert.equal(diagnostics.activeLineCount, 0);
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
