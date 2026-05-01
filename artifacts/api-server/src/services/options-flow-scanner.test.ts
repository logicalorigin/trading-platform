import assert from "node:assert/strict";
import test from "node:test";
import { ListFlowEventsResponse } from "@workspace/api-zod";
import type { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import type { OptionChainContract } from "../providers/ibkr/client";
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

test("listFlowEvents primes scanner snapshots from the on-demand path", async () => {
  let chainCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
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

test("listFlowEvents can warm on-demand flow without blocking callers", async () => {
  let chainCalls = 0;
  let releaseRefresh: () => void = () => {};
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
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
  assert.equal(parsedFirst.source.ibkrStatus, "degraded");
  assert.equal(
    parsedFirst.source.ibkrReason,
    "options_flow_on_demand_refreshing",
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

test("listFlowEvents widens Polygon fallback candidates before applying narrow filters", async () => {
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
  });
  const parsed = ListFlowEventsResponse.parse(result);

  assert.ok(requestedLimit > 2);
  assert.equal(parsed.source.provider, "polygon");
  assert.deepEqual(
    parsed.events.map((event) => event.id),
    ["SPY-POLYGON-10"],
  );
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
