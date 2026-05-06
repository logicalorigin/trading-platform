import assert from "node:assert/strict";
import test from "node:test";
import { ListFlowEventsResponse } from "@workspace/api-zod";
import type { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import type {
  OptionChainContract,
  QuoteSnapshot,
} from "../providers/ibkr/client";
import { __resetMarketDataAdmissionForTests } from "./market-data-admission";
import { createOptionsFlowScanner } from "./options-flow-scanner";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
const originalOptionMetadataDisabled = process.env["OPTION_METADATA_DISABLED"];
process.env["OPTION_METADATA_DISABLED"] = "1";

const POLYGON_ENV_KEYS = [
  "POLYGON_API_KEY",
  "POLYGON_KEY",
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
] as const;
const originalPolygonEnv = Object.fromEntries(
  POLYGON_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearPolygonEnv(): void {
  POLYGON_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
}

clearPolygonEnv();

const platformModule = await import("./platform");

const {
  __resetOptionChainCachesForTests,
  __runOptionsFlowScannerOnceForTests,
  __setIbkrBridgeClientFactoryForTests,
  __setPolygonMarketDataClientFactoryForTests,
  getOptionsFlowRuntimeConfig,
  resolveOptionsFlowScannerEffectiveConcurrency,
  listFlowEvents,
} = platformModule;
const {
  __resetBridgeOptionQuoteStreamForTests,
  __setBridgeOptionQuoteClientForTests,
} = await import("./bridge-option-quote-stream");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function optionContract(symbol = "SPY"): OptionChainContract {
  const expirationDate = new Date("2026-05-15T00:00:00.000Z");
  return {
    contract: {
      ticker: `${symbol}-2026-05-15-500-C`,
      underlying: symbol,
      expirationDate,
      strike: 500,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: `${symbol}-2026-05-15-500-C`,
    },
    bid: 2,
    ask: 2.2,
    last: 2.25,
    mark: 2.1,
    impliedVolatility: 0.25,
    delta: 0.5,
    gamma: 0.02,
    theta: -0.01,
    vega: 0.08,
    openInterest: 100,
    volume: 250,
    updatedAt: new Date("2026-04-24T14:30:00.000Z"),
  };
}

function optionQuote(
  providerContractId: string,
  overrides: Partial<QuoteSnapshot> = {},
): QuoteSnapshot {
  return {
    symbol: "SPY OPT",
    price: 2.3,
    bid: 2.2,
    ask: 2.4,
    bidSize: 1,
    askSize: 1,
    change: 0,
    changePercent: 0,
    open: null,
    high: null,
    low: null,
    prevClose: null,
    volume: 250,
    openInterest: 100,
    impliedVolatility: 0.25,
    delta: 0.5,
    gamma: 0.02,
    theta: -0.01,
    vega: 0.08,
    updatedAt: new Date("2026-04-24T20:00:00.000Z"),
    providerContractId,
    transport: "tws",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: new Date("2026-04-24T14:35:00.000Z"),
    ageMs: null,
    cacheAgeMs: null,
    latency: null,
    ...overrides,
  };
}

function polygonFlowEvent(id: string, premium: number) {
  return {
    id,
    underlying: "SPY",
    provider: "polygon" as const,
    basis: "trade" as const,
    optionTicker: `O:${id}`,
    providerContractId: null,
    strike: 500,
    expirationDate: new Date("2026-05-15T00:00:00.000Z"),
    right: "call" as const,
    price: 2,
    bid: null,
    ask: null,
    last: null,
    mark: null,
    size: 1,
    premium,
    multiplier: 100,
    sharesPerContract: 100,
    openInterest: 1,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    underlyingPrice: 500,
    moneyness: "ATM" as const,
    distancePercent: 0,
    confidence: "fallback_estimate" as const,
    sourceBasis: "fallback_estimate" as const,
    exchange: "POLYGON",
    side: "unknown",
    sentiment: "neutral" as const,
    tradeConditions: [],
    occurredAt: new Date("2026-04-24T14:30:00.000Z"),
    unusualScore: 1,
    isUnusual: true,
  };
}

test.beforeEach(() => {
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "frozen",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      return [];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });
});

test.afterEach(() => {
  __setIbkrBridgeClientFactoryForTests(null);
  __setPolygonMarketDataClientFactoryForTests(null);
  __setBridgeOptionQuoteClientForTests(null);
  __resetBridgeOptionQuoteStreamForTests();
  __resetOptionChainCachesForTests();
  __resetMarketDataAdmissionForTests();
  clearPolygonEnv();
});

test.after(() => {
  if (originalOptionMetadataDisabled === undefined) {
    delete process.env["OPTION_METADATA_DISABLED"];
  } else {
    process.env["OPTION_METADATA_DISABLED"] = originalOptionMetadataDisabled;
  }
  POLYGON_ENV_KEYS.forEach((key) => {
    if (originalPolygonEnv[key]) {
      process.env[key] = originalPolygonEnv[key];
    } else {
      delete process.env[key];
    }
  });
});

test("options flow runtime defaults scan one symbol at a time through the reserved line pool", () => {
  const config = getOptionsFlowRuntimeConfig();

  assert.equal(config.scannerLineBudget, 40);
  assert.equal(config.radarBatchSize, 40);
  assert.equal(config.radarDeepLineBudget, 40);
  assert.equal(config.scannerConcurrency, 1);
  assert.equal(resolveOptionsFlowScannerEffectiveConcurrency(config), 1);
  assert.equal(
    resolveOptionsFlowScannerEffectiveConcurrency({
      ...config,
      scannerConcurrency: 8,
      scannerLineBudget: 40,
    }),
    1,
  );
  assert.equal(
    resolveOptionsFlowScannerEffectiveConcurrency({
      ...config,
      scannerConcurrency: 8,
      scannerLineBudget: 20,
    }),
    2,
  );
});

test("options flow scanner skips fan-out when transport is unavailable", async () => {
  let fetchCalls = 0;
  const scanner = createOptionsFlowScanner({
    preferredTransport: "tws",
    allowFallbackTransport: false,
    getTransport: async () => ({
      transport: null,
      connected: true,
      configured: true,
    }),
    fetchSymbol: async ({ symbol }) => {
      fetchCalls += 1;
      return { events: [{ symbol }] };
    },
  });

  const result = await scanner.runOnce(["spy", "qqq"], { limit: 10 });

  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.scannedSymbols, []);
  assert.deepEqual(result.skippedSymbols, ["SPY", "QQQ"]);
  assert.equal(result.skippedReason, "transport-not-tws");
  assert.equal(scanner.getSnapshot("SPY", { limit: 10 }), null);
  assert.equal(scanner.getDiagnostics().lastSkippedReason, "transport-not-tws");
  assert.deepEqual(scanner.getDiagnostics().lastBatch, ["SPY", "QQQ"]);
});

test("options flow scanner waits for an authenticated live Gateway", async () => {
  let fetchCalls = 0;
  const scanner = createOptionsFlowScanner({
    preferredTransport: "tws",
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      authenticated: false,
      liveMarketDataAvailable: true,
    }),
    fetchSymbol: async ({ symbol }) => {
      fetchCalls += 1;
      return { events: [{ symbol }] };
    },
  });

  const unauthenticated = await scanner.runOnce(["spy"], { limit: 10 });
  assert.equal(fetchCalls, 0);
  assert.deepEqual(unauthenticated.skippedSymbols, ["SPY"]);
  assert.equal(unauthenticated.skippedReason, "gateway-not-authenticated");

  const delayedScanner = createOptionsFlowScanner({
    preferredTransport: "tws",
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      authenticated: true,
      liveMarketDataAvailable: false,
    }),
    fetchSymbol: async ({ symbol }) => {
      fetchCalls += 1;
      return { events: [{ symbol }] };
    },
  });

  const delayed = await delayedScanner.runOnce(["spy"], { limit: 10 });
  assert.equal(fetchCalls, 0);
  assert.deepEqual(delayed.skippedSymbols, ["SPY"]);
  assert.equal(delayed.skippedReason, "market-data-not-live");
});

test("options flow scanner scans once Gateway is authenticated and live", async () => {
  let fetchCalls = 0;
  const scanner = createOptionsFlowScanner({
    preferredTransport: "tws",
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      authenticated: true,
      liveMarketDataAvailable: true,
    }),
    fetchSymbol: async ({ symbol }) => {
      fetchCalls += 1;
      return { events: [{ symbol }] };
    },
  });

  const result = await scanner.runOnce(["spy"], { limit: 10 });

  assert.equal(fetchCalls, 1);
  assert.deepEqual(result.scannedSymbols, ["SPY"]);
  assert.equal(result.skippedReason, null);
});

test("options flow scanner caps concurrent Gateway chain scans", async () => {
  let active = 0;
  let maxActive = 0;
  const scanner = createOptionsFlowScanner({
    maxConcurrency: 2,
    preferredTransport: "tws",
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      liveMarketDataAvailable: true,
    }),
    fetchSymbol: async ({ symbol }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await wait(20);
      active -= 1;
      return { events: [{ symbol }, { symbol, rank: 2 }] };
    },
  });

  const result = await scanner.runOnce(["spy", "qqq", "iwm", "dia"], {
    limit: 2,
  });
  const snapshot = scanner.getSnapshot("spy", { limit: 1 });

  assert.equal(maxActive, 2);
  assert.equal(result.scannedSymbols.length, 4);
  assert.equal(snapshot?.freshness, "fresh");
  assert.equal(snapshot?.transport, "tws");
  assert.deepEqual(snapshot?.events, [{ symbol: "SPY" }]);
});

test("options flow scanner serves stale snapshots inside stale ttl", async () => {
  let currentTime = 1_000;
  const scanner = createOptionsFlowScanner({
    now: () => currentTime,
    snapshotTtlMs: 1_000,
    snapshotStaleTtlMs: 2_000,
    preferredTransport: "tws",
    getTransport: async () => ({ transport: "tws" }),
    fetchSymbol: async ({ symbol }) => ({ events: [{ symbol }] }),
  });

  await scanner.runOnce(["spy"], { limit: 10 });

  currentTime = 2_150;
  assert.equal(scanner.getSnapshot("SPY", { limit: 10 })?.freshness, "stale");

  currentTime = 3_100;
  assert.equal(scanner.getSnapshot("SPY", { limit: 10 }), null);
});

test("options flow scanner keeps the last event snapshot when a refresh is line-budget blocked", async () => {
  let currentTime = 1_000;
  let blocked = false;
  const scanner = createOptionsFlowScanner({
    now: () => currentTime,
    snapshotTtlMs: 1_000,
    snapshotStaleTtlMs: 5_000,
    preferredTransport: "tws",
    getTransport: async () => ({ transport: "tws" }),
    fetchSymbol: async ({ symbol }) =>
      blocked
        ? {
            events: [],
            source: {
              provider: "none",
              status: "empty",
              ibkrStatus: "empty",
              ibkrReason: "options_flow_scanner_line_budget_exhausted",
            },
          }
        : {
            events: [{ symbol, id: "live-flow" }],
            source: { provider: "ibkr", status: "live" },
          },
  });

  await scanner.runOnce(["spy"], { limit: 10 });
  blocked = true;
  currentTime = 1_500;
  await scanner.runOnce(["spy"], { limit: 10 });

  const snapshot = scanner.getSnapshot("SPY", { limit: 10 });
  assert.deepEqual(snapshot?.events, [{ symbol: "SPY", id: "live-flow" }]);
  assert.equal(snapshot?.source?.provider, "ibkr");
});

test("options flow scanner does not retain transient empty error snapshots", async () => {
  const scanner = createOptionsFlowScanner({
    preferredTransport: "tws",
    getTransport: async () => ({ transport: "tws" }),
    fetchSymbol: async () => ({
      events: [],
      source: {
        provider: "none",
        status: "error",
        errorMessage: "IBKR bridge request to /options/quotes timed out after 12000ms.",
      },
    }),
  });

  await scanner.runOnce(["spy"], { limit: 10 });

  assert.equal(scanner.getSnapshot("SPY", { limit: 10 }), null);
});

test("listFlowEvents serves backend scanner snapshots before on-demand derivation", async () => {
  let chainCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          connected: true,
          configured: true,
          liveMarketDataAvailable: true,
        }),
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => {
          chainCalls += 1;
          return [optionContract("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  await __runOptionsFlowScannerOnceForTests(["spy"], { limit: 10 });
  assert.equal(chainCalls, 1);

  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          throw new Error("on-demand flow path should not run");
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await listFlowEvents({ underlying: "SPY", limit: 5 });

	  assert.equal(chainCalls, 1);
	  assert.equal(result.events.length, 1);
	  assert.equal((result.events[0] as { underlying?: string }).underlying, "SPY");
	  assert.equal(
	    ListFlowEventsResponse.parse(result).events[0]?.providerContractId,
	    "SPY-2026-05-15-500-C",
		  );
		});

test("listFlowEvents serves partial scanner snapshots to nonblocking callers", async () => {
  const contracts = Array.from({ length: 10 }, (_unused, index) => {
    const base = optionContract("SPY");
    return {
      ...base,
      contract: {
        ...base.contract,
        ticker: `SPY-2026-05-15-${500 + index}-C`,
        providerContractId: `SPY-2026-05-15-${500 + index}-C`,
        strike: 500 + index,
      },
      underlyingPrice: 505,
    };
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          connected: true,
          configured: true,
          liveMarketDataAvailable: true,
        }),
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => contracts,
      }) as unknown as IbkrBridgeClient,
  );

  await __runOptionsFlowScannerOnceForTests(["spy"], {
    limit: 10,
    lineBudget: 10,
  });

  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          throw new Error("partial scanner snapshot should satisfy the request");
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 25, blocking: false }),
  );

  assert.equal(result.events.length, 10);
  assert.equal(result.source.status, "live");
  assert.equal(result.events[0]?.underlying, "SPY");
});

test("listFlowEvents primes scanner snapshots from the on-demand path", async () => {
  let chainCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          configured: true,
          connected: true,
          authenticated: true,
          liveMarketDataAvailable: true,
        }),
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => {
          chainCalls += 1;
          return [optionContract("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const first = await listFlowEvents({ underlying: "SPY", limit: 5 });
  assert.equal(first.events.length, 1);
  assert.equal(chainCalls, 1);

  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionChain: async () => {
          throw new Error("scanner snapshot should satisfy the request");
        },
      }) as unknown as IbkrBridgeClient,
  );

  const second = await listFlowEvents({ underlying: "SPY", limit: 5 });

	  assert.equal(chainCalls, 1);
	  assert.equal(second.events.length, 1);
	  assert.equal((second.events[0] as { underlying?: string }).underlying, "SPY");
	  assert.equal(
	    ListFlowEventsResponse.parse(second).events[0]?.providerContractId,
	    "SPY-2026-05-15-500-C",
	  );
	});

test("listFlowEvents keeps line-budget cache entries isolated", async () => {
  const first = optionContract("SPY");
  const second = optionContract("SPY");
  const firstId = first.contract.providerContractId ?? "";
  const secondId = "SPY-2026-05-15-505-C";
  second.contract = {
    ...second.contract,
    ticker: secondId,
    providerContractId: secondId,
    strike: 505,
  };
  second.volume = 225;
  second.mark = 1.9;

  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input: { providerContractIds?: string[] }) {
      return (input.providerContractIds || []).map((providerContractId) =>
        optionQuote(providerContractId, {
          volume: providerContractId === firstId ? 250 : 225,
          price: providerContractId === firstId ? 2.3 : 1.95,
          bid: providerContractId === firstId ? 2.2 : 1.9,
          ask: providerContractId === firstId ? 2.4 : 2,
        }),
      );
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
          configured: true,
          connected: true,
          authenticated: true,
          liveMarketDataAvailable: true,
        }),
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => [first, second],
      }) as unknown as IbkrBridgeClient,
  );

  const narrow = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5, lineBudget: 1 }),
  );
  const wider = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5, lineBudget: 2 }),
  );

  assert.equal(narrow.events.length, 1);
  assert.equal(wider.events.length, 2);
});

test("listFlowEvents spends scanner quote lines on near-the-money metadata contracts", async () => {
  const base = optionContract("SPY");
  const buildMetadataContract = (
    providerContractId: string,
    strike: number,
    right: "call" | "put",
  ): OptionChainContract => ({
    ...base,
    contract: {
      ...base.contract,
      ticker: providerContractId,
      providerContractId,
      strike,
      right,
    },
    bid: null,
    ask: null,
    last: null,
    mark: null,
    openInterest: null,
    volume: null,
    underlyingPrice: 500,
  });
  const nearCallId = "SPY-2026-05-15-500-C";
  const nearPutId = "SPY-2026-05-15-500-P";
  const requestedProviderContractIds: string[] = [];

  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input: { providerContractIds?: string[] }) {
      requestedProviderContractIds.push(...(input.providerContractIds || []));
      return (input.providerContractIds || []).map((providerContractId) =>
        optionQuote(providerContractId, {
          volume: 250,
          openInterest: null,
          price: 2.3,
          bid: 2.2,
          ask: 2.4,
        }),
      );
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => [
          buildMetadataContract("SPY-2026-05-15-100-C", 100, "call"),
          buildMetadataContract("SPY-2026-05-15-900-C", 900, "call"),
          buildMetadataContract(nearCallId, 500, "call"),
          buildMetadataContract(nearPutId, 500, "put"),
        ],
      }) as unknown as IbkrBridgeClient,
  );

  const parsed = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5, lineBudget: 2 }),
  );

  assert.deepEqual(
    parsed.events.map((event) => event.openInterest),
    [0, 0],
  );
  assert.deepEqual(requestedProviderContractIds.sort(), [
    nearCallId,
    nearPutId,
  ]);
  assert.deepEqual(
    parsed.events.map((event) => event.providerContractId).sort(),
    [nearCallId, nearPutId],
  );
});

test("listFlowEvents queues scanner refreshes without blocking callers", async () => {
  let chainCalls = 0;
  let releaseRefresh: () => void = () => {};
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          configured: true,
          connected: true,
          authenticated: true,
          liveMarketDataAvailable: true,
        }),
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => {
          chainCalls += 1;
          await refreshGate;
          return [optionContract("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const first = await listFlowEvents({
    underlying: "SPY",
    limit: 5,
    blocking: false,
  });
  const parsedFirst = ListFlowEventsResponse.parse(first);

  assert.equal(parsedFirst.events.length, 0);
  assert.equal(parsedFirst.source.ibkrStatus, "empty");
  assert.equal(
    parsedFirst.source.ibkrReason,
    "options_flow_scanner_queued",
  );

  for (let attempt = 0; attempt < 10 && chainCalls === 0; attempt += 1) {
    await wait(0);
  }
  assert.equal(chainCalls, 1);

  releaseRefresh();

  const warmed = await listFlowEvents({ underlying: "SPY", limit: 5 });
  assert.equal(warmed.events.length, 1);

  const cached = await listFlowEvents({
    underlying: "SPY",
    limit: 5,
    blocking: false,
  });
  assert.equal(cached.events.length, 1);
});

test("listFlowEvents queues filtered nonblocking scans through the scanner", async () => {
  let chainCalls = 0;
  let releaseRefresh: () => void = () => {};
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          configured: true,
          connected: true,
          authenticated: true,
          liveMarketDataAvailable: true,
        }),
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => {
          chainCalls += 1;
          await refreshGate;
          return [optionContract("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const first = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 5,
      blocking: false,
      minPremium: 10_000,
      maxDte: 30,
    }),
  );

  assert.equal(first.events.length, 0);
  assert.equal(first.source.ibkrStatus, "empty");
  assert.equal(first.source.ibkrReason, "options_flow_scanner_queued");

  for (let attempt = 0; attempt < 10 && chainCalls === 0; attempt += 1) {
    await wait(0);
  }
  assert.equal(chainCalls, 1);

  releaseRefresh();

  const warmed = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 5,
      minPremium: 10_000,
      maxDte: 30,
    }),
  );
  assert.equal(warmed.events.length, 1);
});

test("listFlowEvents does not cache transient quote timeout empties", async () => {
  let quoteCalls = 0;
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input: { providerContractIds?: string[] }) {
      quoteCalls += 1;
      if (quoteCalls === 1) {
        throw new Error(
          "IBKR bridge request to /options/quotes timed out after 12000ms.",
        );
      }
      return (input.providerContractIds || []).map((providerContractId) =>
        optionQuote(providerContractId, { volume: 250 }),
      );
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => [{ ...optionContract("SPY"), volume: 0 }],
      }) as unknown as IbkrBridgeClient,
  );

  const timedOut = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5 }),
  );
  assert.equal(timedOut.events.length, 0);
  assert.equal(timedOut.source.status, "error");

  const recovered = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5 }),
  );
  assert.equal(recovered.events.length, 1);
  assert.equal(recovered.source.status, "live");
  assert.equal(quoteCalls, 2);
});

test("listFlowEvents caps nonblocking scanner refreshes to the radar deep quote budget", async () => {
  const base = optionContract("SPY");
  const requestedProviderContractIds: string[] = [];
  const contracts = Array.from({ length: 40 }, (_unused, index) => ({
    ...base,
    contract: {
      ...base.contract,
      ticker: `SPY-2026-05-15-${400 + index}-C`,
      providerContractId: `SPY-2026-05-15-${400 + index}-C`,
      strike: 400 + index,
    },
    underlyingPrice: 420,
  }));

  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input: { providerContractIds?: string[] }) {
      requestedProviderContractIds.push(...(input.providerContractIds || []));
      return (input.providerContractIds || []).map((providerContractId) =>
        optionQuote(providerContractId, { volume: 250 }),
      );
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
          configured: true,
          connected: true,
          authenticated: true,
          liveMarketDataAvailable: true,
        }),
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => contracts,
      }) as unknown as IbkrBridgeClient,
  );

  const queued = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5, blocking: false }),
  );

  assert.equal(queued.source.ibkrReason, "options_flow_scanner_queued");

  for (
    let attempt = 0;
    attempt < 20 && requestedProviderContractIds.length === 0;
    attempt += 1
  ) {
    await wait(10);
  }

  assert.equal(
    requestedProviderContractIds.length,
    getOptionsFlowRuntimeConfig().radarDeepLineBudget,
  );
});

test("listFlowEvents applies request filters to IBKR-derived rows", async () => {
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
          new Date("2026-08-21T00:00:00.000Z"),
        ],
        getOptionChain: async (input: { expirationDate?: Date }) => {
          if (input.expirationDate?.toISOString().startsWith("2026-08-21")) {
            const far = optionContract("SPY");
            return [
              {
                ...far,
                contract: {
                  ...far.contract,
                  ticker: "SPY-2026-08-21-500-C",
                  expirationDate: input.expirationDate,
                  providerContractId: "SPY-2026-08-21-500-C",
                },
                volume: 400,
              },
            ];
          }
          const unusual = optionContract("SPY");
          const routine = optionContract("SPY");
          return [
            unusual,
            {
              ...routine,
              contract: {
                ...routine.contract,
                ticker: "SPY-2026-05-15-505-C",
                providerContractId: "SPY-2026-05-15-505-C",
                strike: 505,
              },
              volume: 50,
              openInterest: 200,
            },
          ];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const unusualOnly = await listFlowEvents({
    underlying: "SPY",
    limit: 5,
    scope: "unusual",
    unusualThreshold: 2,
    minPremium: 50_000,
    maxDte: 30,
  });
  assert.equal(unusualOnly.events.length, 1);
  assert.equal(
    ListFlowEventsResponse.parse(unusualOnly).events[0]?.providerContractId,
    "SPY-2026-05-15-500-C",
  );

  const premiumAndDteFiltered = await listFlowEvents({
    underlying: "SPY",
    limit: 5,
    scope: "all",
    minPremium: 50_000,
    maxDte: 30,
  });
  assert.deepEqual(
    ListFlowEventsResponse.parse(premiumAndDteFiltered).events.map(
      (event) => event.providerContractId,
    ),
    ["SPY-2026-05-15-500-C"],
  );
});

test("listFlowEvents keeps realtime flow on IBKR by default when Polygon is configured", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  let polygonCalls = 0;
  __setPolygonMarketDataClientFactoryForTests(
    (() =>
      ({
        getDerivedFlowEvents: async () => {
          polygonCalls += 1;
          return [polygonFlowEvent("SPY-POLYGON", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setPolygonMarketDataClientFactoryForTests
      >[0],
  );

  const result = await listFlowEvents({
    underlying: "SPY",
    limit: 2,
    minPremium: 50_000,
  });
  const parsed = ListFlowEventsResponse.parse(result);

  assert.equal(polygonCalls, 0);
  assert.equal(parsed.source.provider, "none");
  assert.equal(parsed.source.fallbackUsed, false);
  assert.equal(parsed.source.ibkrReason, "options_flow_no_expirations");
  assert.deepEqual(parsed.events, []);
});

test("listFlowEvents widens explicit Polygon fallback candidates before applying narrow filters", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  let requestedLimit = 0;
  __setPolygonMarketDataClientFactoryForTests(
    (() =>
      ({
        getDerivedFlowEvents: async (input: { limit?: number }) => {
          requestedLimit = input.limit ?? 0;
          return Array.from({ length: requestedLimit }, (_value, index) =>
            polygonFlowEvent(
              `SPY-POLYGON-${index}`,
              index === 10 ? 75_000 : 5_000,
            ),
          );
        },
      })) as unknown as Parameters<
        typeof __setPolygonMarketDataClientFactoryForTests
      >[0],
  );

  const result = await listFlowEvents({
    underlying: "SPY",
    limit: 2,
    minPremium: 50_000,
    allowPolygonFallback: true,
  });
  const parsed = ListFlowEventsResponse.parse(result);

  assert.ok(requestedLimit > 2);
  assert.equal(parsed.source.provider, "polygon");
  assert.deepEqual(
    parsed.events.map((event) => event.id),
    ["SPY-POLYGON-10"],
  );
});

test("listFlowEvents reports IBKR as source when a live snapshot is filtered empty", async () => {
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => [optionContract("SPY")],
      }) as unknown as IbkrBridgeClient,
  );

  const parsed = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 5,
      scope: "unusual",
      unusualThreshold: 50,
    }),
  );

  assert.deepEqual(parsed.events, []);
  assert.equal(parsed.source.provider, "ibkr");
  assert.equal(parsed.source.status, "empty");
  assert.equal(parsed.source.fallbackUsed, false);
  assert.equal(parsed.source.ibkrStatus, "loaded");
  assert.ok((parsed.source.ibkrFilteredEventCount ?? 0) > 0);
});

test("listFlowEvents timestamps IBKR snapshot rows from quote data time", async () => {
  const contract = optionContract("SPY");
  const providerContractId = contract.contract.providerContractId ?? "";
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      return [
        optionQuote(providerContractId, {
          updatedAt: new Date("2026-04-24T20:00:00.000Z"),
          dataUpdatedAt: new Date("2026-04-24T14:35:00.000Z"),
        }),
      ];
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => [contract],
      }) as unknown as IbkrBridgeClient,
  );

  const parsed = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5 }),
  );

  assert.equal(parsed.events.length, 1);
  assert.equal(
    parsed.events[0]?.occurredAt.toISOString(),
    "2026-04-24T14:35:00.000Z",
  );
  assert.match(parsed.events[0]?.id ?? "", /1777041300000$/);
});

test("listFlowEvents does not reuse explicit Polygon fallback cache for IBKR-only requests", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  let polygonCalls = 0;
  __setPolygonMarketDataClientFactoryForTests(
    (() =>
      ({
        getDerivedFlowEvents: async () => {
          polygonCalls += 1;
          return [polygonFlowEvent("SPY-POLYGON-CACHED", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setPolygonMarketDataClientFactoryForTests
      >[0],
  );

  const fallback = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 2,
      minPremium: 50_000,
      allowPolygonFallback: true,
    }),
  );
  const ibkrOnly = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 2,
      minPremium: 50_000,
    }),
  );

  assert.equal(polygonCalls, 1);
  assert.equal(fallback.source.provider, "polygon");
  assert.equal(ibkrOnly.source.provider, "none");
  assert.equal(ibkrOnly.source.fallbackUsed, false);
  assert.deepEqual(ibkrOnly.events, []);
});

test("listFlowEvents does not reuse explicit Polygon fallback scanner snapshots for IBKR-only requests", async () => {
  process.env["POLYGON_API_KEY"] = "test";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  let polygonCalls = 0;
  __setPolygonMarketDataClientFactoryForTests(
    (() =>
      ({
        getDerivedFlowEvents: async () => {
          polygonCalls += 1;
          return [polygonFlowEvent("SPY-POLYGON-SNAPSHOT", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setPolygonMarketDataClientFactoryForTests
      >[0],
  );

  const fallback = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 2,
      allowPolygonFallback: true,
    }),
  );
  const ibkrOnly = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 2,
    }),
  );

  assert.equal(polygonCalls, 1);
  assert.equal(fallback.source.provider, "polygon");
  assert.equal(ibkrOnly.source.provider, "none");
  assert.equal(ibkrOnly.source.fallbackUsed, false);
  assert.deepEqual(ibkrOnly.events, []);
});

test("listFlowEvents hydrates multiple expirations before falling back", async () => {
  const expirations = [
    new Date("2026-05-01T00:00:00.000Z"),
    new Date("2026-05-15T00:00:00.000Z"),
  ];
  const requestedExpirations = new Set<string>();
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => expirations,
        getOptionChain: async (input: { expirationDate?: Date }) => {
          assert.ok(input.expirationDate);
          const isoDate = input.expirationDate.toISOString().slice(0, 10);
          requestedExpirations.add(isoDate);
          const contract = optionContract("SPY");
          return [
            {
              ...contract,
              contract: {
                ...contract.contract,
                ticker: `SPY-${isoDate}-500-C`,
                expirationDate: input.expirationDate,
                providerContractId: `SPY-${isoDate}-500-C`,
              },
              mark: isoDate === "2026-05-15" ? 2.1 : 0,
              volume: isoDate === "2026-05-15" ? 250 : 0,
            },
          ];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await listFlowEvents({ underlying: "SPY", limit: 5 });
  const parsed = ListFlowEventsResponse.parse(result);

  assert.deepEqual(Array.from(requestedExpirations).sort(), [
    "2026-05-01",
    "2026-05-15",
  ]);
  assert.equal(parsed.source.provider, "ibkr");
  assert.equal(parsed.source.ibkrExpirationCount, 2);
  assert.equal(parsed.source.ibkrHydratedExpirationCount, 2);
  assert.equal(parsed.events[0]?.providerContractId, "SPY-2026-05-15-500-C");
});
