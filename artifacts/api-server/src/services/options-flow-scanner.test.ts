import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ListFlowEventsResponse } from "@workspace/api-zod";
import type { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import type {
  BrokerBarSnapshot,
  OptionChainContract,
  QuoteSnapshot,
} from "../providers/ibkr/client";
import { HttpError } from "../lib/errors";
import {
  __resetMarketDataAdmissionForTests,
  admitMarketDataLeases,
  getMarketDataAdmissionDiagnostics,
} from "./market-data-admission";
import {
  __resetBridgeGovernorForTests,
  getBridgeGovernorSnapshot,
  resetBridgeGovernorOverrides,
  runBridgeWork,
  setBridgeGovernorOverrides,
} from "./bridge-governor";
import { __resetIbkrHistoricalAdmissionForTests } from "./ibkr-historical-admission";
import { resolveIbkrLaneSymbols } from "./ibkr-lane-policy";
import { createOptionsFlowScanner } from "./options-flow-scanner";
import { createOptionsFlowRadarScanner } from "./options-flow-radar-scanner";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
const originalOptionMetadataDisabled = process.env["OPTION_METADATA_DISABLED"];
process.env["OPTION_METADATA_DISABLED"] = "1";
const BRIDGE_RUNTIME_OVERRIDE_ENV_KEYS = [
  "IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
  "PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
] as const;
const originalBridgeRuntimeOverrideEnv = Object.fromEntries(
  BRIDGE_RUNTIME_OVERRIDE_ENV_KEYS.map((key) => [key, process.env[key]]),
);
const isolatedBridgeRuntimeOverrideFile = join(
  tmpdir(),
  `pyrus-options-flow-scanner-bridge-runtime-${process.pid}.json`,
);
BRIDGE_RUNTIME_OVERRIDE_ENV_KEYS.forEach((key) => {
  process.env[key] = isolatedBridgeRuntimeOverrideFile;
});

const MASSIVE_ENV_KEYS = [
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
] as const;
const originalMassiveEnv = Object.fromEntries(
  MASSIVE_ENV_KEYS.map((key) => [key, process.env[key]]),
);

function clearMassiveEnv(): void {
  MASSIVE_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
}

clearMassiveEnv();

const platformSource = readFileSync(
  fileURLToPath(new URL("./platform.ts", import.meta.url)),
  "utf8",
);

const platformModule = await import("./platform");

const {
  __resetOptionChainCachesForTests,
  __holdOptionsFlowScannerBackgroundForTests,
  __clearOptionsFlowScannerBackgroundHoldForTests,
  __fetchOptionsFlowRadarQuotesForTests,
  __queueOptionsFlowScannerRefreshForTests,
  __runOptionsFlowRadarScannerOnceForTests,
  __runOptionsFlowScannerOnceForTests,
  __selectAggregateFlowSeedSymbolsForTests,
  __normalizeOptionsFlowSessionBlockReasonForTests,
  __setOptionsFlowSessionBlockReasonForTests,
  __setIbkrBridgeClientFactoryForTests,
  __orderOptionsFlowScannerLaneResolutionForTests,
  __setHistoricalFlowDirectFallbackTimeoutMsForTests,
  __setHistoricalFlowStoreDisabledForTests,
  __setHistoricalFlowStoreReadTimeoutMsForTests,
  __setMassiveMarketDataClientFactoryForTests,
  getOptionsFlowScannerDiagnostics,
  getOptionsFlowRadarIntervalMs,
  getOptionsFlowUniverseCoverage,
  getOptionsFlowRuntimeConfig,
  listAggregateFlowEvents,
  resetOptionsFlowRuntimeOverrides,
  resolveOptionsFlowScannerEffectiveConcurrency,
  listFlowEvents,
  setOptionsFlowRuntimeOverrides,
  startOptionsFlowScanner,
} = platformModule;
const {
  __resetBridgeOptionQuoteStreamForTests,
  __setBridgeOptionQuoteClientForTests,
  __setBridgeOptionQuoteStreamNowForTests,
} = await import("./bridge-option-quote-stream");
const {
  __resetApiResourcePressureForTests,
  resolveApiRssPressureThresholds,
  updateApiResourcePressure,
} = await import("./resource-pressure");

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await wait(0);
  }
}

async function waitForPlatformScannerIdle(timeoutMs = 6_000): Promise<void> {
  await waitFor(() => {
    const diagnostics = getOptionsFlowScannerDiagnostics().deepScanner;
    return (
      diagnostics.queuedCount === 0 &&
      diagnostics.activeCount === 0 &&
      !diagnostics.draining
    );
  }, timeoutMs);
}

async function openOptionsLaneBackoff(): Promise<void> {
  setBridgeGovernorOverrides({
    options: { failureThreshold: 1, backoffMs: 60_000 },
  });
  await assert.rejects(
    runBridgeWork("options", async () => {
      throw new HttpError(504, "options lane timeout", {
        code: "ibkr_bridge_request_timeout",
      });
    }),
    HttpError,
  );
}

async function openQuotesLaneBackoff(): Promise<void> {
  setBridgeGovernorOverrides({
    quotes: { failureThreshold: 1, backoffMs: 60_000 },
  });
  await assert.rejects(
    runBridgeWork("quotes", async () => {
      throw new HttpError(504, "quotes lane timeout", {
        code: "ibkr_bridge_request_timeout",
      });
    }),
    HttpError,
  );
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

function historicalOptionBar(
  providerContractId: string,
  overrides: Partial<BrokerBarSnapshot> = {},
): BrokerBarSnapshot {
  return {
    timestamp: new Date("2026-04-24T14:35:00.000Z"),
    open: 2.1,
    high: 2.4,
    low: 2,
    close: 2.3,
    volume: 250,
    source: "ibkr-history",
    providerContractId,
    outsideRth: false,
    partial: false,
    transport: "tws",
    delayed: false,
    freshness: "live",
    marketDataMode: "live",
    dataUpdatedAt: new Date("2026-04-24T14:35:00.000Z"),
    ageMs: null,
    ...overrides,
  };
}

function radarQuote(symbol = "SPY"): QuoteSnapshot {
  return {
    ...optionQuote(`${symbol}-RADAR`),
    symbol,
    price: 500,
    optionCallVolume: 1_000,
    optionCallOpenInterest: 10,
    impliedVolatility: 0.35,
  } as QuoteSnapshot;
}

function massiveFlowEvent(id: string, premium: number) {
  return {
    id,
    underlying: "SPY",
    provider: "massive" as const,
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
    exchange: "MASSIVE",
    side: "unknown",
    sentiment: "neutral" as const,
    tradeConditions: [],
    occurredAt: new Date("2026-04-24T14:30:00.000Z"),
    unusualScore: 1,
    isUnusual: true,
  };
}

test.beforeEach(() => {
  __setBridgeOptionQuoteStreamNowForTests(
    new Date("2026-06-02T15:00:00.000Z"),
  );
  setOptionsFlowRuntimeOverrides({
    scannerSessionGuardEnabled: false,
    universeMode: "watchlist",
  });
  __setHistoricalFlowStoreDisabledForTests(true);
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

test.afterEach(async () => {
  await waitForPlatformScannerIdle();
  __resetOptionChainCachesForTests();
  __setIbkrBridgeClientFactoryForTests(null);
  __setMassiveMarketDataClientFactoryForTests(null);
  __setBridgeOptionQuoteClientForTests(null);
  __resetBridgeOptionQuoteStreamForTests();
  __resetMarketDataAdmissionForTests();
  __resetIbkrHistoricalAdmissionForTests();
  __resetBridgeGovernorForTests();
  resetBridgeGovernorOverrides();
  resetOptionsFlowRuntimeOverrides();
  __resetApiResourcePressureForTests();
  __setHistoricalFlowStoreDisabledForTests(false);
  __setHistoricalFlowStoreReadTimeoutMsForTests(3_000);
  __setHistoricalFlowDirectFallbackTimeoutMsForTests(4_000);
  clearMassiveEnv();
});

test.after(() => {
  if (originalOptionMetadataDisabled === undefined) {
    delete process.env["OPTION_METADATA_DISABLED"];
  } else {
    process.env["OPTION_METADATA_DISABLED"] = originalOptionMetadataDisabled;
  }
  BRIDGE_RUNTIME_OVERRIDE_ENV_KEYS.forEach((key) => {
    const original = originalBridgeRuntimeOverrideEnv[key];
    if (original) {
      process.env[key] = original;
    } else {
      delete process.env[key];
    }
  });
  MASSIVE_ENV_KEYS.forEach((key) => {
    if (originalMassiveEnv[key]) {
      process.env[key] = originalMassiveEnv[key];
    } else {
      delete process.env[key];
    }
  });
});

test("options flow runtime defaults use the reserved flow scanner lane", () => {
  resetOptionsFlowRuntimeOverrides();
  const config = getOptionsFlowRuntimeConfig();

  assert.equal(config.scannerSessionGuardEnabled, true);
  assert.equal(config.radarEnabled, true);
  assert.equal(config.radarBatchSize, 30);
  assert.equal(config.radarDeepCandidateCount, 8);
  assert.equal(config.radarFallbackDeepCandidateCount, 1);
  assert.equal(config.radarDeepLineBudget, 100);
  assert.equal(config.scannerBatchSize, 8);
  assert.equal(config.scannerSymbolTimeoutMs, 45_000);
  assert.equal(config.scannerLineBudget, 200);
  assert.equal(config.scannerConcurrency, 8);
  assert.equal(config.scannerStrikeCoverage, "standard");
  assert.equal(config.expirationScanCount, 1);
  assert.ok(
    Math.ceil(config.universeSize / config.radarBatchSize) *
      config.scannerIntervalMs <=
      5 * 60_000,
  );
  assert.equal(resolveOptionsFlowScannerEffectiveConcurrency(config), 8);
  assert.equal(
    resolveOptionsFlowScannerEffectiveConcurrency({
      ...config,
      scannerConcurrency: 8,
      scannerLineBudget: 30,
    }),
    8,
  );
  assert.equal(
    resolveOptionsFlowScannerEffectiveConcurrency({
      ...config,
      scannerConcurrency: 8,
      scannerLineBudget: 20,
    }),
    8,
  );
  setOptionsFlowRuntimeOverrides({ scannerConcurrency: 8 });
  assert.equal(getOptionsFlowRuntimeConfig().scannerConcurrency, 8);
});

test("default options flow symbol scans use one ticker line and one expiration", async () => {
  const expirations = [
    new Date("2026-05-01T00:00:00.000Z"),
    new Date("2026-05-15T00:00:00.000Z"),
  ];
  const requestedExpirations: string[] = [];
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
      const providerContractIds = input.providerContractIds ?? [];
      requestedProviderContractIds.push(...providerContractIds);
      return providerContractIds.map((providerContractId) =>
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
        getOptionExpirations: async () => expirations,
        getOptionChain: async (input: { expirationDate?: Date }) => {
          assert.ok(input.expirationDate);
          const isoDate = input.expirationDate.toISOString().slice(0, 10);
          requestedExpirations.push(isoDate);
          return [500, 505, 510].map((strike) => {
            const contract = optionContract("SPY");
            const providerContractId = `SPY-${isoDate}-${strike}-C`;
            return {
              ...contract,
              contract: {
                ...contract.contract,
                ticker: providerContractId,
                expirationDate: input.expirationDate,
                strike,
                providerContractId,
              },
              underlyingPrice: 505,
            };
          });
        },
        getHistoricalBars: async (input: {
          providerContractId?: string | null;
        }) => [historicalOptionBar(input.providerContractId ?? "SPY-OPT")],
      }) as unknown as IbkrBridgeClient,
  );

  const parsed = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5 }),
  );

  assert.deepEqual(requestedExpirations, ["2026-05-01"]);
  assert.equal(requestedProviderContractIds.length, 1);
  assert.equal(parsed.source.scannerLineBudget, 1);
  assert.equal(parsed.source.scannerExpirationScanCount, 1);
  assert.equal(parsed.source.ibkrCandidateExpirationCount, 1);
  assert.equal(parsed.source.ibkrLiveCandidateCount, 1);
});

test("automation-only high pressure does not throttle the flow scanner", () => {
  updateApiResourcePressure({ automationActiveLongScanCount: 1 });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(resolveOptionsFlowScannerEffectiveConcurrency(), 8);
  assert.equal(diagnostics.resourcePressure.level, "normal");
  assert.equal(
    diagnostics.resourcePressure.inputs.automationActiveLongScanCount,
    1,
  );
  assert.equal(diagnostics.scannerPressure.level, "normal");
  assert.equal(diagnostics.scannerPressure.throttled, false);
  assert.equal(diagnostics.scannerFillMode, "steady-state");
  assert.equal(diagnostics.limitingReason, null);
});

test("options flow scanner concurrency remains capped under runtime overrides", () => {
  setOptionsFlowRuntimeOverrides({
    scannerConcurrency: 10,
    scannerLineBudget: 10,
  });
  const config = getOptionsFlowRuntimeConfig();
  assert.equal(config.scannerConcurrency, 8);

  setBridgeGovernorOverrides({ options: { concurrency: 10 } });
  admitMarketDataLeases({
    owner: "active-grid",
    intent: "visible-live",
    requests: Array.from({ length: 150 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `VIS${index}`,
    })),
  });

  assert.equal(resolveOptionsFlowScannerEffectiveConcurrency(config), 8);
  assert.equal(
    getOptionsFlowScannerDiagnostics().deepScanner.maxConcurrency,
    8,
  );
});

test("flow universe coverage labels radar and direct deep phases distinctly", async () => {
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
        getOptionActivitySnapshots: async () => [
          {
            symbol: "SPY",
            price: 500,
            optionCallVolume: 1_000,
            optionPutVolume: 100,
            optionCallOpenInterest: 5_000,
            optionPutOpenInterest: 4_000,
            updatedAt: new Date(),
          },
        ],
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => [optionContract("SPY")],
      }) as unknown as IbkrBridgeClient,
  );

  await __runOptionsFlowRadarScannerOnceForTests(["spy"], {
    batchSize: 1,
    promoteCount: 0,
  });
  assert.equal(getOptionsFlowUniverseCoverage().scannerPhase, "radar");

  __resetOptionChainCachesForTests({ resetFlowScanner: true });
  setOptionsFlowRuntimeOverrides({ radarEnabled: false });
  await __runOptionsFlowScannerOnceForTests(["spy"], { limit: 1 });

  assert.equal(getOptionsFlowUniverseCoverage().scannerPhase, "deep");
});

test("options flow scanner yields capacity when visible demand fills the budget", () => {
  const config = getOptionsFlowRuntimeConfig();

  admitMarketDataLeases({
    owner: "active-grid",
    intent: "visible-live",
    requests: Array.from({ length: 200 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `VIS${index}`,
    })),
  });

  const diagnostics = getOptionsFlowScannerDiagnostics();
  assert.equal(resolveOptionsFlowScannerEffectiveConcurrency(config), 0);
  assert.equal(diagnostics.backgroundBlockedReason, "line-cap-exhausted");
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 0);
  assert.equal(diagnostics.lineUtilization.effectivePoolCap, 0);
});

test("options flow radar keeps sampling while the options lane is backed off", async () => {
  let quoteCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionActivitySnapshots: async () => {
          quoteCalls += 1;
          return [radarQuote("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  await openOptionsLaneBackoff();

  const result = await __runOptionsFlowRadarScannerOnceForTests(["spy"], {
    batchSize: 1,
    promoteCount: 0,
  });

  assert.equal(quoteCalls, 1);
  assert.deepEqual(result.scannedSymbols, ["SPY"]);
  assert.deepEqual(result.promotedSymbols, []);
  assert.equal(result.error, null);
  assert.equal(getOptionsFlowScannerDiagnostics().backgroundBlockedReason, null);
});

test("options flow radar treats empty option-activity batches as quiet", async () => {
  let quoteCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionActivitySnapshots: async () => {
          quoteCalls += 1;
          return [];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await __runOptionsFlowRadarScannerOnceForTests(["spy"], {
    batchSize: 1,
    promoteCount: 0,
    fallbackPromoteCount: 0,
  });

  assert.equal(quoteCalls, 1);
  assert.deepEqual(result.scannedSymbols, ["SPY"]);
  assert.deepEqual(result.promotedSymbols, []);
  assert.equal(result.error, null);
  assert.equal(getOptionsFlowScannerDiagnostics().radarDegradedReason, null);
});

test("options flow radar skips polling when the IBKR bridge is not configured", async () => {
  setOptionsFlowRuntimeOverrides({ scannerSessionGuardEnabled: true });
  let quoteCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => {
          throw new HttpError(
            503,
            "Interactive Brokers bridge is not configured.",
            { code: "ibkr_bridge_not_configured" },
          );
        },
        getOptionActivitySnapshots: async () => {
          quoteCalls += 1;
          return [radarQuote("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await __runOptionsFlowRadarScannerOnceForTests(["spy"], {
    batchSize: 1,
    promoteCount: 0,
    fallbackPromoteCount: 0,
  });

  assert.equal(quoteCalls, 0);
  assert.deepEqual(result.scannedSymbols, []);
  assert.deepEqual(result.promotedSymbols, []);
  assert.equal(result.error, "transport-unavailable");
  assert.equal(
    getOptionsFlowScannerDiagnostics().backgroundBlockedReason,
    "transport-unavailable",
  );
});

test("options flow session guard blocks stale quote stream states", () => {
  assert.equal(
    __normalizeOptionsFlowSessionBlockReasonForTests("stream_not_fresh"),
    "transport-unavailable",
  );
  assert.equal(
    __normalizeOptionsFlowSessionBlockReasonForTests("quote_stream_starting"),
    "transport-unavailable",
  );
  assert.equal(
    __normalizeOptionsFlowSessionBlockReasonForTests("market_session_quiet"),
    "market-session-quiet",
  );
});

test("options flow radar scanner keeps its cursor when equivalent universe order changes", async () => {
  const scanner = createOptionsFlowRadarScanner({
    fetchBatch: async (symbols) => ({
      quotes: symbols.map((symbol) => ({ symbol })),
    }),
  });

  const first = await scanner.runOnce(["ccc", "bbb", "aaa"], {
    batchSize: 1,
    promoteCount: 0,
  });
  const second = await scanner.runOnce(["aaa", "bbb", "ccc"], {
    batchSize: 1,
    promoteCount: 0,
  });
  const third = await scanner.runOnce(["aaa", "bbb", "ccc"], {
    batchSize: 1,
    promoteCount: 0,
  });

  assert.deepEqual(first.scannedSymbols, ["CCC"]);
  assert.deepEqual(second.scannedSymbols, ["BBB"]);
  assert.deepEqual(third.scannedSymbols, ["AAA"]);
});

test("options flow radar scanner does not advance cursor while skipped", async () => {
  let blocked = true;
  let fetchCalls = 0;
  const scanner = createOptionsFlowRadarScanner({
    shouldSkip: async () => (blocked ? "market-session-quiet" : null),
    fetchBatch: async (symbols) => {
      fetchCalls += 1;
      return {
        quotes: symbols.map((symbol) => ({ symbol })),
      };
    },
  });

  const skipped = await scanner.runOnce(["aaa", "bbb", "ccc"], {
    batchSize: 1,
    promoteCount: 0,
  });

  assert.deepEqual(skipped.scannedSymbols, []);
  assert.equal(skipped.error, "market-session-quiet");
  assert.equal(fetchCalls, 0);
  assert.equal(scanner.getCoverage().scannedSymbols, 0);
  assert.deepEqual(scanner.getCoverage().currentBatch, []);
  assert.equal(scanner.getCoverage().degradedReason, "market-session-quiet");

  blocked = false;
  const first = await scanner.runOnce(["aaa", "bbb", "ccc"], {
    batchSize: 1,
    promoteCount: 0,
  });
  const second = await scanner.runOnce(["aaa", "bbb", "ccc"], {
    batchSize: 1,
    promoteCount: 0,
  });

  assert.deepEqual(first.scannedSymbols, ["AAA"]);
  assert.deepEqual(second.scannedSymbols, ["BBB"]);
  assert.equal(fetchCalls, 2);
});

test("options flow scanner lane preserves watchlist order before broad universe fallback", () => {
  const sources = {
    builtInSymbols: ["SPY", "QQQ"],
    watchlistSymbols: ["GEV", "ACHR", "AAPL"],
    flowUniverseSymbols: ["SPY", "QQQ", "AACG", "AADR", "ACHR", "GEV"],
  };
  const resolution = resolveIbkrLaneSymbols("flow-scanner", {
    "built-in": sources.builtInSymbols,
    watchlists: sources.watchlistSymbols,
    "flow-universe": sources.flowUniverseSymbols,
  });

  const ordered = __orderOptionsFlowScannerLaneResolutionForTests(
    sources,
    resolution,
  );

  assert.deepEqual(ordered.admittedSymbols.slice(0, 7), [
    "GEV",
    "ACHR",
    "AAPL",
    "SPY",
    "QQQ",
    "AACG",
    "AADR",
  ]);
});

test("flow universe coverage reports the active radar cadence", async () => {
  setOptionsFlowRuntimeOverrides({
    universeMode: "watchlist",
    radarEnabled: true,
    radarBatchSize: 3,
    radarDeepCandidateCount: 0,
    radarFallbackDeepCandidateCount: 0,
    scannerBatchSize: 2,
    scannerIntervalMs: 1_000,
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionActivitySnapshots: async (symbols: string[]) =>
          symbols.map((symbol) => radarQuote(symbol)),
      }) as unknown as IbkrBridgeClient,
  );

  startOptionsFlowScanner();
  __clearOptionsFlowScannerBackgroundHoldForTests();
  await waitFor(() => {
    const coverage = getOptionsFlowUniverseCoverage();
    return Boolean(
      coverage.radarCurrentBatch?.length === 3 && coverage.lastScanAt,
    );
  });

  const coverage = getOptionsFlowUniverseCoverage();
  assert.equal(coverage.batchSize, 3);
  assert.equal(coverage.intervalMs, coverage.radarIntervalMs);
  assert.equal(coverage.estimatedCycleMs, coverage.radarEstimatedCycleMs);
});

test("options flow radar fallback fills available scanner slots when activity is quiet", async () => {
  setOptionsFlowRuntimeOverrides({
    universeMode: "watchlist",
    radarEnabled: true,
    radarBatchSize: 3,
    radarDeepCandidateCount: 3,
    radarFallbackDeepCandidateCount: 1,
    scannerConcurrency: 2,
    scannerLineBudget: 80,
    scannerIntervalMs: 1_000,
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionActivitySnapshots: async (symbols: string[]) =>
          symbols.map(
            (symbol) =>
              ({
                ...radarQuote(symbol),
                optionCallVolume: undefined,
                optionPutVolume: undefined,
                optionCallOpenInterest: undefined,
                optionPutOpenInterest: undefined,
              }) as QuoteSnapshot,
          ),
      }) as unknown as IbkrBridgeClient,
  );

  startOptionsFlowScanner();
  __clearOptionsFlowScannerBackgroundHoldForTests();
  await waitFor(
    () => (getOptionsFlowUniverseCoverage().promotedSymbols ?? []).length === 2,
  );

  const coverage = getOptionsFlowUniverseCoverage();
  assert.deepEqual(
    coverage.promotedSymbols,
    (coverage.radarCurrentBatch ?? []).slice(0, 2),
  );
  assert.equal(
    getOptionsFlowScannerDiagnostics().lineUtilization.effectiveDeepLineBudget,
    1,
  );
});

test("options flow radar does not wait for deep promotion hydration before returning", async () => {
  let releasePromotion: () => void = () => {};
  let promotionStarted = false;
  const scanner = createOptionsFlowRadarScanner({
    fetchBatch: async () => ({
      quotes: [radarQuote("SPY")],
    }),
    onPromotions: async () => {
      promotionStarted = true;
      await new Promise<void>((resolve) => {
        releasePromotion = resolve;
      });
    },
  });

  const result = await Promise.race([
    scanner.runOnce(["spy"], { batchSize: 1, promoteCount: 1 }),
    wait(50).then(() => "timeout" as const),
  ]);

  releasePromotion();

  if (result === "timeout") {
    assert.fail("radar scan waited for deep promotion hydration");
  }
  assert.equal(promotionStarted, true);
  assert.deepEqual(result.promotedSymbols, ["SPY"]);
  assert.deepEqual(result.scannedSymbols, ["SPY"]);
});

test("options flow radar keeps sampling while options work is queued", async () => {
  setBridgeGovernorOverrides({ options: { concurrency: 1 } });
  let releaseActiveWork: () => void = () => {};
  const activeWork = runBridgeWork(
    "options",
    () =>
      new Promise<void>((resolve) => {
        releaseActiveWork = resolve;
      }),
  );
  await waitFor(() => getBridgeGovernorSnapshot().options.active === 1);

  const queuedWork = runBridgeWork("options", async () => undefined);
  await waitFor(() => getBridgeGovernorSnapshot().options.queued === 1);

  let quoteCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionActivitySnapshots: async () => {
          quoteCalls += 1;
          return [radarQuote("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  try {
    const result = await __runOptionsFlowRadarScannerOnceForTests(["spy"], {
      batchSize: 1,
      promoteCount: 0,
    });

    assert.equal(quoteCalls, 1);
    assert.deepEqual(result.scannedSymbols, ["SPY"]);
    assert.equal(result.error, null);
  } finally {
    releaseActiveWork();
    await Promise.all([activeWork, queuedWork]);
  }
});

test("options flow radar promotion respects scanner options backoff", async () => {
  setOptionsFlowRuntimeOverrides({
    radarDeepCandidateCount: 1,
    radarFallbackDeepCandidateCount: 0,
    radarDeepLineBudget: 1,
    scannerLineBudget: 1,
    scannerLimit: 5,
  });

  let quoteCalls = 0;
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
        getOptionActivitySnapshots: async () => {
          quoteCalls += 1;
          await openOptionsLaneBackoff();
          return [radarQuote("SPY")];
        },
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async () => {
          chainCalls += 1;
          return [optionContract("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await __runOptionsFlowRadarScannerOnceForTests(["spy"], {
    batchSize: 1,
    promoteCount: 1,
    fallbackPromoteCount: 0,
  });

  assert.equal(quoteCalls, 1);
  assert.deepEqual(result.promotedSymbols, ["SPY"]);
  assert.equal(result.error, null);
  await waitForPlatformScannerIdle();
  assert.equal(chainCalls, 0);
  assert.equal(getOptionsFlowScannerDiagnostics().deepScanner.queuedCount, 0);
});

test("non-radar options flow scanner respects options backoff", async () => {
  setOptionsFlowRuntimeOverrides({
    radarEnabled: false,
    scannerBatchSize: 1,
    scannerIntervalMs: 1_000,
  });
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

  await openOptionsLaneBackoff();
  const result = await __runOptionsFlowScannerOnceForTests(["spy"], {
    limit: 5,
    lineBudget: 1,
  });

  const diagnostics = getOptionsFlowScannerDiagnostics();
  assert.equal(chainCalls, 0);
  assert.deepEqual(result.scannedSymbols, ["SPY"]);
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.deepScanner.queuedCount, 0);
  assert.deepEqual(diagnostics.lastBatch, ["SPY"]);
});

test("options flow scanner refresh queue respects options backoff", async () => {
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
  await openOptionsLaneBackoff();

  const queued = __queueOptionsFlowScannerRefreshForTests({
    underlying: "SPY",
    scannerRequest: { limit: 5, lineBudget: 1 },
    phase: "test",
  });

  assert.equal(queued, true);
  await waitForPlatformScannerIdle();
  assert.equal(chainCalls, 0);
  assert.deepEqual(
    getOptionsFlowScannerDiagnostics().deepScanner.lastScannedSymbols,
    ["SPY"],
  );
});

test("options flow scanner keeps full throughput under soft RSS-only critical API pressure", () => {
  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:previous",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 200 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `PREVIOUS${index}`,
      underlying: "SPY",
    })),
  });
  assert.equal(scanner.admitted.length, 200);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 200);

  updateApiResourcePressure({
    rssMb: resolveApiRssPressureThresholds().critical + 1,
  });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.resourcePressure.level, "critical");
  assert.equal(diagnostics.scannerPressure.throttled, false);
  assert.equal(diagnostics.scannerFillMode, "steady-state");
  assert.equal(diagnostics.limitingReason, null);
  assert.equal(diagnostics.lineBudget, 200);
  assert.equal(diagnostics.lineUtilization.poolCap, 200);
  assert.equal(diagnostics.lineUtilization.effectivePoolCap, 200);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 8);
  assert.equal(diagnostics.lineUtilization.scannerLineBudget, 200);
  assert.equal(diagnostics.lineUtilization.radarDeepLineBudget, 100);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 200);
  assert.equal(diagnostics.lineUtilization.unusedPoolLines, 0);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 200);
});

test("options flow scanner pauses and sheds leases under hard API pressure", () => {
  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:previous",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 200 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `PREVIOUS${index}`,
      underlying: "SPY",
    })),
  });
  assert.equal(scanner.admitted.length, 200);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 200);

  updateApiResourcePressure({ apiHeapUsedPercent: 91 });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.backgroundBlockedReason, "resource-pressure");
  assert.equal(diagnostics.resourcePressure.level, "critical");
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 0);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 0);
  assert.equal(diagnostics.lineUtilization.unusedPoolLines, 200);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 200);
  assert.equal(
    __queueOptionsFlowScannerRefreshForTests({
      underlying: "SPY",
      scannerRequest: { limit: 5, lineBudget: 1 },
      phase: "test",
    }),
    false,
  );
  const admission = getMarketDataAdmissionDiagnostics();
  assert.equal(admission.budget.flowScannerLineCap, 200);
  assert.equal(admission.flowScannerLineCount, 0);
});

test("options flow scanner keeps background rotation at configured concurrency under high RSS pressure", () => {
  updateApiResourcePressure({
    rssMb: resolveApiRssPressureThresholds().high + 1,
  });

  const diagnostics = getOptionsFlowScannerDiagnostics();

  assert.equal(diagnostics.resourcePressure.level, "high");
  assert.equal(diagnostics.backgroundBlockedReason, null);
  assert.equal(diagnostics.scannerPressure.throttled, false);
  assert.equal(diagnostics.lineUtilization.effectiveConcurrency, 8);
  assert.equal(diagnostics.lineUtilization.schedulablePoolCap, 200);
  assert.equal(diagnostics.lineUtilization.maxDeepScanLines, 200);
});

test("options flow radar keeps polling under high API pressure", async () => {
  let quoteCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionActivitySnapshots: async () => {
          quoteCalls += 1;
          return [radarQuote("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );
  updateApiResourcePressure({
    rssMb: resolveApiRssPressureThresholds().high + 1,
  });

  const result = await __runOptionsFlowRadarScannerOnceForTests(["spy"], {
    batchSize: 1,
    promoteCount: 0,
  });

  assert.equal(quoteCalls, 1);
  assert.deepEqual(result.scannedSymbols, ["SPY"]);
  assert.deepEqual(result.promotedSymbols, []);
  assert.equal(result.error, null);
  assert.equal(getOptionsFlowScannerDiagnostics().backgroundBlockedReason, null);
});

test("options flow radar does not promote deep scans when scanner queue is full", async () => {
  setOptionsFlowRuntimeOverrides({
    scannerConcurrency: 2,
    radarDeepCandidateCount: 8,
    radarFallbackDeepCandidateCount: 0,
    scannerSymbolTimeoutMs: 1_000,
  });
  let chainCalls = 0;
  let releaseDeepScans: () => void = () => {};
  const deepScanGate = new Promise<void>((resolve) => {
    releaseDeepScans = resolve;
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
          marketDataMode: "live",
        }),
        getOptionActivitySnapshots: async (symbols: readonly string[]) =>
          symbols.map((symbol) => radarQuote(symbol)),
        getOptionExpirations: async () => [
          new Date("2026-06-05T00:00:00.000Z"),
        ],
        getOptionChain: async (input: { underlying?: string | null }) => {
          chainCalls += 1;
          await deepScanGate;
          const symbol = input.underlying || "SPY";
          const contract = optionContract(symbol);
          return [
            {
              ...contract,
              contract: {
                ...contract.contract,
                ticker: `${symbol}-2026-06-05-500-C`,
                providerContractId: `${symbol}-2026-06-05-500-C`,
                expirationDate: new Date("2026-06-05T00:00:00.000Z"),
              },
            },
          ];
        },
      }) as unknown as IbkrBridgeClient,
  );

  try {
    await __runOptionsFlowRadarScannerOnceForTests(
      ["aaoi", "aapl", "achr", "alab", "amba", "amd", "amzn", "anet"],
      { batchSize: 8, promoteCount: 8 },
    );
    await waitFor(() => {
      const diagnostics = getOptionsFlowScannerDiagnostics().deepScanner;
      return diagnostics.activeCount === 2 && diagnostics.drainingCount === 2;
    });
    const scheduledBefore =
      getOptionsFlowScannerDiagnostics().deepScanner.drainingSymbols;

    await __runOptionsFlowRadarScannerOnceForTests(
      ["aph", "apld", "arm", "asml"],
      { batchSize: 4, promoteCount: 4 },
    );
    await wait(0);

    const diagnostics = getOptionsFlowScannerDiagnostics().deepScanner;
    assert.equal(diagnostics.activeCount, 2);
    assert.equal(diagnostics.queuedCount, 0);
    assert.equal(diagnostics.drainingCount, 2);
    assert.deepEqual(diagnostics.drainingSymbols, scheduledBefore);
    assert.equal(chainCalls, 2);
  } finally {
    releaseDeepScans();
    await waitForPlatformScannerIdle().catch(() => {});
  }
});

test("options flow scanner diagnostics drop stale transport skip reasons", async () => {
  setOptionsFlowRuntimeOverrides({ scannerIntervalMs: 100 });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => null,
      }) as unknown as IbkrBridgeClient,
  );

  await __runOptionsFlowScannerOnceForTests(["spy"], { limit: 1 });

  assert.equal(
    getOptionsFlowScannerDiagnostics().lastSkippedReason,
    "transport-unavailable",
  );

  await wait(250);

  const diagnostics = getOptionsFlowScannerDiagnostics();
  assert.equal(diagnostics.lastSkippedReason, null);
  assert.equal(diagnostics.deepScanner.lastSkippedReason, null);
});

test("options flow scanner diagnostics prefer current background pauses over stale skips", async () => {
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => null,
      }) as unknown as IbkrBridgeClient,
  );

  await __runOptionsFlowScannerOnceForTests(["spy"], { limit: 1 });
  __holdOptionsFlowScannerBackgroundForTests(60_000);

  const diagnostics = getOptionsFlowScannerDiagnostics();
  assert.equal(diagnostics.backgroundBlockedReason, "live-warmup");
  assert.equal(diagnostics.lastSkippedReason, null);
  assert.equal(diagnostics.deepScanner.lastSkippedReason, null);
});

test("options flow radar interval uses the outside-hours scanner multiplier", () => {
  assert.equal(
    getOptionsFlowRadarIntervalMs(
      {
        ...getOptionsFlowRuntimeConfig(),
        scannerAlwaysOn: true,
        scannerIntervalMs: 15_000,
      },
      new Date("2026-04-28T22:30:00.000Z"),
    ),
    60_000,
  );
});

test("options flow radar quote failures do not open the quotes governor", async () => {
  setBridgeGovernorOverrides({
    quotes: { failureThreshold: 1, backoffMs: 60_000 },
  });
  let quoteCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionActivitySnapshots: async () => {
          quoteCalls += 1;
          throw new HttpError(502, "quote timeout", {
            code: "upstream_request_failed",
          });
        },
      }) as unknown as IbkrBridgeClient,
  );

  const quotes = await __fetchOptionsFlowRadarQuotesForTests(["spy"]);

  assert.deepEqual(quotes, []);
  assert.equal(quoteCalls, 2);
  assert.equal(getBridgeGovernorSnapshot().quotes.circuitOpen, false);

  const skipped = await __runOptionsFlowRadarScannerOnceForTests(["spy"], {
    batchSize: 1,
  });
  assert.equal(skipped.error, "radar-quotes-backoff");
  assert.equal(quoteCalls, 2);
});

test("options flow radar keeps sampling while the quotes lane is backed off", async () => {
  await openQuotesLaneBackoff();
  let quoteCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionActivitySnapshots: async () => {
          quoteCalls += 1;
          return [radarQuote("SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const result = await __runOptionsFlowRadarScannerOnceForTests(["spy"], {
    batchSize: 1,
    promoteCount: 0,
  });

  assert.equal(quoteCalls, 1);
  assert.deepEqual(result.scannedSymbols, ["SPY"]);
  assert.equal(result.error, null);
  assert.equal(
    getOptionsFlowScannerDiagnostics().backgroundBlockedReason,
    null,
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

test("options flow scanner lists cached snapshots across symbols", async () => {
  let currentMs = Date.parse("2026-05-08T14:30:00.000Z");
  const scanner = createOptionsFlowScanner({
    now: () => currentMs,
    snapshotTtlMs: 60_000,
    snapshotStaleTtlMs: 300_000,
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      authenticated: true,
      liveMarketDataAvailable: true,
    }),
    fetchSymbol: async ({ symbol }) => ({ events: [{ symbol }] }),
  });

  scanner.storeSnapshot(
    "spy",
    { limit: 3, unusualThreshold: 1, lineBudget: 3 },
    { events: [{ symbol: "SPY" }] },
  );
  scanner.storeSnapshot(
    "qqq",
    { limit: 3, unusualThreshold: 1, lineBudget: 3 },
    { events: [{ symbol: "QQQ" }] },
  );
  scanner.storeSnapshot(
    "iwm",
    { limit: 3, unusualThreshold: 2, lineBudget: 3 },
    { events: [{ symbol: "IWM" }] },
  );

  assert.deepEqual(
    scanner
      .listSnapshots({ limit: 3, unusualThreshold: 1, lineBudget: 3 })
      .map((snapshot) => snapshot.symbol)
      .sort(),
    ["QQQ", "SPY"],
  );

  currentMs += 90_000;
  assert.deepEqual(
    scanner
      .listSnapshots({
        limit: 5,
        unusualThreshold: 1,
        lineBudget: 5,
        allowPartial: true,
      })
      .map((snapshot) => snapshot.freshness),
    ["stale", "stale"],
  );
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
      marketDataMode: "delayed",
    }),
    fetchSymbol: async ({ symbol }) => {
      fetchCalls += 1;
      return { events: [{ symbol }] };
    },
  });

  const delayed = await delayedScanner.runOnce(["spy"], { limit: 10 });
  assert.equal(fetchCalls, 1);
  assert.deepEqual(delayed.scannedSymbols, ["SPY"]);
  assert.equal(delayed.skippedReason, null);
  assert.equal(delayed.marketDataMode, "delayed");

  const frozenScanner = createOptionsFlowScanner({
    preferredTransport: "tws",
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      authenticated: true,
      liveMarketDataAvailable: false,
      marketDataMode: "delayed_frozen",
    }),
    fetchSymbol: async ({ symbol }) => {
      fetchCalls += 1;
      return { events: [{ symbol }] };
    },
  });

  const frozen = await frozenScanner.runOnce(["spy"], { limit: 10 });
  assert.deepEqual(frozen.skippedSymbols, ["SPY"]);
  assert.equal(frozen.skippedReason, "market-data-delayed-frozen");
  assert.equal(frozen.marketDataMode, "delayed_frozen");
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

test("options flow scanner preserves the largest pending scan for a symbol", async () => {
  const calls: Array<{ symbol: string; limit: number; lineBudget?: number }> = [];
  let releaseFirstScan: () => void = () => {};
  const firstScanStarted = new Promise<void>((resolve) => {
    releaseFirstScan = resolve;
  });
  const scanner = createOptionsFlowScanner({
    preferredTransport: "tws",
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      authenticated: true,
      liveMarketDataAvailable: true,
    }),
    fetchSymbol: async ({ symbol, limit, lineBudget }) => {
      calls.push({ symbol, limit, lineBudget });
      if (symbol === "QQQ") {
        await firstScanStarted;
      }
      return {
        events: Array.from({ length: limit }, (_unused, index) => ({
          symbol,
          index,
        })),
      };
    },
  });

  const first = scanner.requestScan(["qqq"], { limit: 1, lineBudget: 1 });
  await wait(0);
  const larger = scanner.requestScan(["spy"], { limit: 20, lineBudget: 20 });
  const smaller = scanner.requestScan(["spy"], { limit: 5, lineBudget: 5 });

  releaseFirstScan();
  await Promise.all([first, larger, smaller]);

  const spyCalls = calls.filter((call) => call.symbol === "SPY");
  assert.equal(spyCalls.length, 1);
  assert.equal(spyCalls[0]?.limit, 20);
  assert.equal(spyCalls[0]?.lineBudget, 20);
  assert.equal(scanner.getSnapshot("SPY", { limit: 20 })?.events.length, 20);
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

test("options flow scanner times out a stuck symbol and keeps draining queued names", async () => {
  const scanner = createOptionsFlowScanner({
    maxConcurrency: 1,
    scanTimeoutMs: 10,
    preferredTransport: "tws",
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      liveMarketDataAvailable: true,
    }),
    fetchSymbol: async ({ symbol }) => {
      if (symbol === "SPY") {
        await new Promise(() => {});
      }
      return { events: [{ symbol }] };
    },
  });

  const result = await scanner.requestScan(["spy", "qqq"], { limit: 1 });

  assert.deepEqual(result.scannedSymbols, ["SPY", "QQQ"]);
  assert.deepEqual(result.failedSymbols, ["SPY"]);
  assert.equal(scanner.getDiagnostics().activeCount, 0);
  assert.equal(scanner.getDiagnostics().draining, false);
  assert.equal(scanner.getDiagnostics().scanTimeoutMs, 10);
  assert.equal(scanner.getSnapshot("SPY", { limit: 1 }), null);
  assert.deepEqual(scanner.getSnapshot("QQQ", { limit: 1 })?.events, [
    { symbol: "QQQ" },
  ]);
});

test("options flow scanner diagnostics expose active metadata scans", async () => {
  let releaseScan: () => void = () => {};
  const scanGate = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  const scanner = createOptionsFlowScanner({
    maxConcurrency: 1,
    preferredTransport: "tws",
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      liveMarketDataAvailable: true,
    }),
    fetchSymbol: async ({ symbol }) => {
      await scanGate;
      return { events: [{ symbol }] };
    },
  });

  const scan = scanner.requestScan(["spy"], { limit: 1 });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (scanner.getDiagnostics().activeCount > 0) {
      break;
    }
    await wait(0);
  }

  const diagnostics = scanner.getDiagnostics();
  assert.equal(diagnostics.draining, true);
  assert.equal(diagnostics.activeCount, 1);
  assert.deepEqual(diagnostics.activeSymbols, ["SPY"]);
  assert.ok(diagnostics.drainStartedAt instanceof Date);

  releaseScan();
  await scan;
  assert.equal(scanner.getDiagnostics().activeCount, 0);
  assert.equal(scanner.getDiagnostics().drainStartedAt, null);
});

test("options flow scanner diagnostics suppress stale skip reasons while work is active", async () => {
  let transportAvailable = false;
  let releaseScan: () => void = () => {};
  const scanGate = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  const scanner = createOptionsFlowScanner({
    maxConcurrency: 1,
    preferredTransport: "tws",
    getTransport: async () =>
      transportAvailable
        ? {
            transport: "tws",
            connected: true,
            configured: true,
            liveMarketDataAvailable: true,
          }
        : null,
    fetchSymbol: async ({ symbol }) => {
      await scanGate;
      return { events: [{ symbol }] };
    },
  });

  await scanner.runOnce(["spy"], { limit: 1 });
  assert.equal(scanner.getDiagnostics().lastSkippedReason, "transport-unavailable");

  transportAvailable = true;
  const scan = scanner.requestScan(["qqq"], { limit: 1 });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (scanner.getDiagnostics().activeCount > 0) {
      break;
    }
    await wait(0);
  }

  const activeDiagnostics = scanner.getDiagnostics();
  assert.equal(activeDiagnostics.activeCount, 1);
  assert.equal(activeDiagnostics.lastSkippedReason, null);

  releaseScan();
  await scan;
  assert.equal(scanner.getDiagnostics().lastSkippedReason, null);
});

test("options flow scanner clears drain state after unexpected result-handler failures", async () => {
  const scanner = createOptionsFlowScanner({
    preferredTransport: "tws",
    getTransport: async () => ({
      transport: "tws",
      connected: true,
      configured: true,
      liveMarketDataAvailable: true,
    }),
    fetchSymbol: async () => {
      throw new Error("bridge failed");
    },
    onResult: () => {
      throw new Error("result handler failed");
    },
  });

  await assert.rejects(
    scanner.requestScan(["spy"], { limit: 1 }),
    /result handler failed/,
  );

  const diagnostics = scanner.getDiagnostics();
  assert.equal(diagnostics.draining, false);
  assert.equal(diagnostics.activeCount, 0);
  assert.equal(diagnostics.drainStartedAt, null);
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

test("options flow scanner keeps the last event snapshot while market session is quiet", async () => {
  let currentTime = 1_000;
  let quiet = false;
  const scanner = createOptionsFlowScanner({
    now: () => currentTime,
    snapshotTtlMs: 1_000,
    snapshotStaleTtlMs: 5_000,
    preferredTransport: "tws",
    getTransport: async () => ({ transport: "tws" }),
    fetchSymbol: async ({ symbol }) =>
      quiet
        ? {
            events: [],
            source: {
              provider: "ibkr",
              status: "empty",
              ibkrStatus: "empty",
              ibkrReason: "options_flow_scanner_market_session_quiet",
            },
          }
        : {
            events: [{ symbol, id: "live-flow" }],
            source: { provider: "ibkr", status: "live" },
          },
  });

  await scanner.runOnce(["spy"], { limit: 10 });
  quiet = true;
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

test("listAggregateFlowEvents reuses default scanner snapshots with request thresholds", async () => {
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
        getOptionChain: async (input: { underlying?: string }) => [
          optionContract(input.underlying || "SPY"),
        ],
      }) as unknown as IbkrBridgeClient,
  );

  await __runOptionsFlowScannerOnceForTests(["spy", "qqq"], { limit: 10 });
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __setHistoricalFlowStoreDisabledForTests(true);

  const result = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({
      limit: 10,
      scope: "all",
      unusualThreshold: 1,
    }),
  );

  assert.deepEqual(
    [...new Set(result.events.map((event) => event.underlying))].sort(),
    ["QQQ", "SPY"],
  );
  assert.equal(result.source.provider, "ibkr");
  assert.equal(result.source.ibkrStatus, "loaded");
});

test("listAggregateFlowEvents backfills the flow lane from recent durable flow rows", () => {
  const start = platformSource.indexOf(
    "export async function listAggregateFlowEvents",
  );
  const end = platformSource.indexOf(
    "export async function getFlowPremiumDistribution",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const aggregateSource = platformSource.slice(start, end);

  assert.match(aggregateSource, /listRecentStoredHistoricalFlowEvents/);
  assert.match(aggregateSource, /dedupeAggregateFlowEvents\(\[\.\.\.snapshotEvents, \.\.\.storedEvents\]\)/);
  assert.match(aggregateSource, /compareAggregateFlowEventsByRecency/);
  assert.match(aggregateSource, /provider: sourceProvider/);
  assert.match(aggregateSource, /"options_flow_historical_store"/);
  assert.match(aggregateSource, /\["ibkr", "massive"\]/);
});

test("listAggregateFlowEvents backfills underfilled aggregate scanner snapshots", async () => {
  const chainCalls: string[] = [];
  let activityCalls = 0;
  setOptionsFlowRuntimeOverrides({ scannerBatchSize: 2 });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          connected: true,
          configured: true,
          authenticated: true,
          liveMarketDataAvailable: true,
        }),
        getOptionActivitySnapshots: async () => {
          activityCalls += 1;
          return [];
        },
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async (input: { underlying?: string }) => {
          const symbol = input.underlying || "SPY";
          chainCalls.push(symbol);
          return [optionContract(symbol)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  await __runOptionsFlowScannerOnceForTests(["spy"], { limit: 10 });
  await __runOptionsFlowRadarScannerOnceForTests(["spy", "qqq", "iwm"], {
    batchSize: 3,
    promoteCount: 0,
    fallbackPromoteCount: 0,
  });
  __resetOptionChainCachesForTests({ resetFlowScanner: false });
  __setHistoricalFlowStoreDisabledForTests(true);
  chainCalls.length = 0;

  const first = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({
      limit: 10,
      scope: "all",
      unusualThreshold: 1,
    }),
  );

  assert.equal(activityCalls, 1);
  assert.deepEqual(
    [...new Set(first.events.map((event) => event.underlying))],
    ["SPY"],
  );

  for (let attempt = 0; attempt < 60 && chainCalls.length < 2; attempt += 1) {
    await wait(50);
  }

  assert.equal(chainCalls.length, 2);
  assert.equal(chainCalls.includes("SPY"), false);

  let warmed = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({
      limit: 10,
      scope: "all",
      unusualThreshold: 1,
    }),
  );
  for (
    let attempt = 0;
    attempt < 80 &&
    new Set(warmed.events.map((event) => event.underlying)).size < 3;
    attempt += 1
  ) {
    await wait(50);
    warmed = ListFlowEventsResponse.parse(
      await listAggregateFlowEvents({
        limit: 10,
        scope: "all",
        unusualThreshold: 1,
      }),
    );
  }

  assert.deepEqual(
    [...new Set(warmed.events.map((event) => event.underlying))].sort(),
    ["SPY", ...chainCalls].sort(),
  );
});

test("aggregate flow seed ordering keeps quiet radar filler behind lane symbols", () => {
  const selected = __selectAggregateFlowSeedSymbolsForTests({
    prioritySymbols: [],
    laneSymbols: ["spy", "nvda", "dia"],
    fallbackSymbols: ["aacg", "aadr"],
    snapshotSymbols: new Set(),
    batchSize: 2,
  });

  assert.deepEqual(selected, ["SPY", "NVDA"]);
});

test("aggregate flow seed ordering still honors radar promotions first", () => {
  const selected = __selectAggregateFlowSeedSymbolsForTests({
    prioritySymbols: ["aadr"],
    laneSymbols: ["spy", "nvda", "dia"],
    fallbackSymbols: ["aacg", "aadr"],
    snapshotSymbols: new Set(["SPY"]),
    batchSize: 2,
  });

  assert.deepEqual(selected, ["AADR", "NVDA"]);
});

test("listAggregateFlowEvents does not serve radar fallback rows as lane flow", async () => {
  let activityCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          connected: true,
          configured: true,
          authenticated: true,
          liveMarketDataAvailable: true,
        }),
        getOptionActivitySnapshots: async (symbols: string[]) => {
          activityCalls += 1;
          return symbols.map((symbol) => radarQuote(symbol));
        },
        getOptionExpirations: async () => [],
        getOptionChain: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  await __runOptionsFlowRadarScannerOnceForTests(["spy", "qqq", "iwm"], {
    batchSize: 3,
    promoteCount: 0,
    fallbackPromoteCount: 0,
  });

  const result = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({
      limit: 10,
      scope: "all",
      unusualThreshold: 1,
    }),
  );

  assert.equal(activityCalls, 1);
  assert.equal(result.events.length, 0);
  assert.equal(result.source.provider, "none");
  assert.equal(result.source.status, "empty");
  assert.equal(result.source.fallbackUsed, false);
  assert.equal(result.source.ibkrStatus, "empty");
  assert.notEqual(
    result.source.ibkrReason,
    "options_flow_radar_observation_fallback",
  );

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const diagnostics = getOptionsFlowScannerDiagnostics().deepScanner;
    if (diagnostics.queuedCount === 0 && !diagnostics.draining) {
      break;
    }
    await wait(50);
  }
});

test("listAggregateFlowEvents seeds the scanner when no current batch exists", async () => {
  const scannedSymbols: string[] = [];
  setOptionsFlowRuntimeOverrides({ scannerBatchSize: 1 });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          connected: true,
          configured: true,
          authenticated: true,
          liveMarketDataAvailable: true,
        }),
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async (input: { underlying?: string }) => {
          const symbol = input.underlying || "SPY";
          scannedSymbols.push(symbol);
          return [optionContract(symbol)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const pending = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({
      limit: 5,
      scope: "all",
    }),
  );

  assert.equal(pending.events.length, 0);
  assert.equal(pending.source.ibkrReason, "options_flow_scanner_queued");

  for (let attempt = 0; attempt < 60 && scannedSymbols.length === 0; attempt += 1) {
    await wait(50);
  }

  assert.ok(scannedSymbols.length > 0);

  let warmed = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({ limit: 5, scope: "all" }),
  );
  for (let attempt = 0; attempt < 60 && warmed.events.length === 0; attempt += 1) {
    await wait(50);
    warmed = ListFlowEventsResponse.parse(
      await listAggregateFlowEvents({ limit: 5, scope: "all" }),
    );
  }

  assert.ok(warmed.events.length > 0);
  assert.equal(warmed.source.provider, "ibkr");
  assert.equal(warmed.source.ibkrStatus, "loaded");
});

test("listAggregateFlowEvents does not seed deep scans while session quiet is cached", async () => {
  const scannedSymbols: string[] = [];
  setOptionsFlowRuntimeOverrides({
    scannerBatchSize: 1,
    scannerSessionGuardEnabled: true,
    scannerAlwaysOn: false,
  });
  __setOptionsFlowSessionBlockReasonForTests("market-session-quiet");
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          connected: true,
          configured: true,
          authenticated: true,
          accounts: ["DU123"],
          liveMarketDataAvailable: true,
          marketDataMode: "live",
          updatedAt: new Date(),
        }),
        getOptionExpirations: async (underlying: string) => {
          scannedSymbols.push(underlying);
          return [new Date("2026-05-15T00:00:00.000Z")];
        },
        getOptionChain: async (input: { underlying?: string }) => {
          scannedSymbols.push(input.underlying || "SPY");
          return [optionContract(input.underlying || "SPY")];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const pending = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({
      limit: 5,
      scope: "all",
    }),
  );

  assert.equal(
    getOptionsFlowScannerDiagnostics().backgroundBlockedReason,
    "market-session-quiet",
  );
  assert.equal(pending.events.length, 0);
  assert.equal(
    pending.source.ibkrReason,
    "options_flow_scanner_market_session_quiet",
  );

  await wait(100);

  assert.deepEqual(scannedSymbols, []);
  const diagnostics = getOptionsFlowScannerDiagnostics().deepScanner;
  assert.equal(diagnostics.queuedCount, 0);
  assert.equal(diagnostics.draining, false);
});

test("listAggregateFlowEvents seeds deep scans during quiet sessions when scannerAlwaysOn is true", async () => {
  const scannedSymbols: string[] = [];
  setOptionsFlowRuntimeOverrides({
    scannerBatchSize: 1,
    scannerSessionGuardEnabled: true,
    scannerAlwaysOn: true,
  });
  __setOptionsFlowSessionBlockReasonForTests("market-session-quiet");
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          connected: true,
          configured: true,
          authenticated: true,
          accounts: ["DU123"],
          liveMarketDataAvailable: true,
          marketDataMode: "live",
          updatedAt: new Date(),
        }),
        getOptionExpirations: async (underlying: string) => {
          scannedSymbols.push(underlying);
          return [new Date("2026-05-15T00:00:00.000Z")];
        },
        getOptionChain: async (input: { underlying?: string }) => {
          const symbol = input.underlying || "SPY";
          scannedSymbols.push(symbol);
          return [optionContract(symbol)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const pending = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({
      limit: 5,
      scope: "all",
    }),
  );

  assert.equal(getOptionsFlowScannerDiagnostics().backgroundBlockedReason, null);
  assert.equal(pending.events.length, 0);
  assert.equal(pending.source.ibkrReason, "options_flow_scanner_queued");

  for (
    let attempt = 0;
    attempt < 60 && scannedSymbols.length === 0;
    attempt += 1
  ) {
    await wait(50);
  }

  assert.ok(scannedSymbols.length > 0);
});

test("listAggregateFlowEvents seeds foreground aggregate scans during live warmup hold", async () => {
  const scannedSymbols: string[] = [];
  setOptionsFlowRuntimeOverrides({ scannerBatchSize: 1 });
  __holdOptionsFlowScannerBackgroundForTests(60_000);
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          connected: true,
          configured: true,
          authenticated: true,
          liveMarketDataAvailable: true,
        }),
        getOptionExpirations: async () => [
          new Date("2026-05-15T00:00:00.000Z"),
        ],
        getOptionChain: async (input: { underlying?: string }) => {
          const symbol = input.underlying || "SPY";
          scannedSymbols.push(symbol);
          return [optionContract(symbol)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const pending = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({
      limit: 5,
      scope: "all",
    }),
  );

  assert.equal(getOptionsFlowScannerDiagnostics().backgroundBlockedReason, "live-warmup");
  assert.equal(pending.events.length, 0);
  assert.equal(pending.source.ibkrReason, "options_flow_scanner_queued");

  for (let attempt = 0; attempt < 20 && scannedSymbols.length === 0; attempt += 1) {
    await wait(50);
  }

  assert.ok(scannedSymbols.length > 0);
});

test("listAggregateFlowEvents seeds scanner work during options backoff", async () => {
  let chainCalls = 0;
  setOptionsFlowRuntimeOverrides({ scannerBatchSize: 1 });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => ({
          transport: "tws",
          connected: true,
          configured: true,
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

  await openOptionsLaneBackoff();

  const pending = ListFlowEventsResponse.parse(
    await listAggregateFlowEvents({
      limit: 5,
      scope: "all",
    }),
  );

  assert.equal(pending.events.length, 0);
  assert.equal(pending.source.ibkrReason, "options_flow_scanner_queued");
  await waitFor(() => {
    const diagnostics = getOptionsFlowScannerDiagnostics();
    return (
      chainCalls > 0 ||
      diagnostics.deepScanner.queuedCount > 0 ||
      diagnostics.deepScanner.activeCount > 0 ||
      diagnostics.deepScanner.draining ||
      diagnostics.lastBatch.length > 0
    );
  });
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
  const primingChainCalls = chainCalls;
  assert.ok(primingChainCalls >= 1);

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

  assert.equal(chainCalls, primingChainCalls);
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

test("listFlowEvents hydrates near-the-money metadata contracts with historical option bars", async () => {
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
  let liveQuoteCalls = 0;

  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input: { providerContractIds?: string[] }) {
      liveQuoteCalls += 1;
      return (input.providerContractIds ?? []).map((providerContractId) =>
        optionQuote(providerContractId, { price: 1 }),
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
        getOptionChain: async () => [
          buildMetadataContract("SPY-2026-05-15-100-C", 100, "call"),
          buildMetadataContract("SPY-2026-05-15-900-C", 900, "call"),
          buildMetadataContract(nearCallId, 500, "call"),
          buildMetadataContract(nearPutId, 500, "put"),
        ],
        getHistoricalBars: async (input: { providerContractId?: string | null }) => {
          const providerContractId = input.providerContractId ?? "";
          requestedProviderContractIds.push(providerContractId);
          return [historicalOptionBar(providerContractId)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const parsed = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5, lineBudget: 2 }),
  );

  assert.deepEqual(
    parsed.events.map((event) => event.openInterest),
    [100, 100],
  );
  assert.deepEqual(requestedProviderContractIds.sort(), [
    nearCallId,
    nearPutId,
  ]);
  assert.equal(liveQuoteCalls, 1);
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

test("listFlowEvents can read nonblocking scanner snapshots without enqueueing deep scans", async () => {
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

  const result = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 5,
      blocking: false,
      queueRefresh: false,
    }),
  );

  assert.equal(result.events.length, 0);
  assert.equal(result.source.ibkrStatus, "empty");
  assert.equal(
    result.source.ibkrReason,
    "options_flow_scanner_snapshot_pending",
  );

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await wait(0);
  }
  assert.equal(chainCalls, 0);

  const warmed = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 1,
      lineBudget: getOptionsFlowRuntimeConfig().scannerLineBudget,
    }),
  );
  assert.equal(warmed.events.length, 1);
  assert.equal(chainCalls, 1);

  const snapshot = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 5,
      blocking: false,
      queueRefresh: false,
    }),
  );
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.source.provider, "ibkr");
  assert.equal(chainCalls, 1);
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

test("listFlowEvents does not cache transient historical option hydration empties", async () => {
  const originalIdenticalCooldown =
    process.env["IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS"];
  process.env["IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS"] = "1";
  try {
    let historicalCalls = 0;
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
          getOptionChain: async () => [{ ...optionContract("SPY"), volume: 0 }],
          getHistoricalBars: async (input: {
            providerContractId?: string | null;
          }) => {
            historicalCalls += 1;
            if (historicalCalls === 1) {
              throw new Error(
                "IBKR bridge request to historical option bars timed out after 12000ms.",
              );
            }
            return [historicalOptionBar(input.providerContractId ?? "SPY-OPT")];
          },
        }) as unknown as IbkrBridgeClient,
    );

    const timedOut = ListFlowEventsResponse.parse(
      await listFlowEvents({ underlying: "SPY", limit: 5 }),
    );
    assert.equal(timedOut.events.length, 0);
    assert.equal(timedOut.source.status, "error");
    assert.equal(
      timedOut.source.ibkrReason,
      "options_flow_historical_hydration_degraded",
    );

    await wait(2);
    const recovered = ListFlowEventsResponse.parse(
      await listFlowEvents({ underlying: "SPY", limit: 5 }),
    );
    assert.equal(recovered.events.length, 1);
    assert.equal(recovered.source.status, "live");
    assert.equal(historicalCalls, 2);
  } finally {
    if (originalIdenticalCooldown === undefined) {
      delete process.env["IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS"];
    } else {
      process.env["IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS"] =
        originalIdenticalCooldown;
    }
  }
});

test("background listFlowEvents skips historical bars and admits live scanner quotes", async () => {
  const base = optionContract("SPY");
  const historicalProviderContractIds: string[] = [];
  const liveProviderContractIds: string[] = [];
  const contracts = Array.from(
    { length: getOptionsFlowRuntimeConfig().scannerLineBudget },
    (_unused, index) => ({
      ...base,
      contract: {
        ...base.contract,
        ticker: `SPY-2026-05-15-${400 + index}-C`,
        providerContractId: `SPY-2026-05-15-${400 + index}-C`,
        strike: 400 + index,
      },
      underlyingPrice: 420,
    }),
  );

  let liveQuoteCalls = 0;
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws",
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input: { providerContractIds?: string[] }) {
      liveQuoteCalls += 1;
      const providerContractIds = input.providerContractIds ?? [];
      liveProviderContractIds.push(...providerContractIds);
      return providerContractIds.map((providerContractId) =>
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
        getHistoricalBars: async (input: { providerContractId?: string | null }) => {
          const providerContractId = input.providerContractId ?? "";
          historicalProviderContractIds.push(providerContractId);
          return [historicalOptionBar(providerContractId)];
        },
      }) as unknown as IbkrBridgeClient,
  );

  const queued = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5, blocking: false }),
  );

  assert.equal(queued.source.ibkrReason, "options_flow_scanner_queued");

  for (
    let attempt = 0;
    attempt < 20 && liveProviderContractIds.length === 0;
    attempt += 1
  ) {
    await wait(10);
  }

  assert.equal(historicalProviderContractIds.length, 0);
  assert.ok(liveQuoteCalls >= 1);
  assert.ok(liveProviderContractIds.length > 0);
  assert.equal(
    getMarketDataAdmissionDiagnostics().flowScannerLineCount,
    liveProviderContractIds.length,
  );
});

test("listFlowEvents reports scanner live quote market close as quiet", async () => {
  __setBridgeOptionQuoteStreamNowForTests(
    new Date("2026-06-02T20:30:00.000Z"),
  );
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
          new Date("2026-06-05T00:00:00.000Z"),
        ],
        getOptionChain: async () => [
          { ...optionContract("SPY"), volume: 0 },
        ],
        getHistoricalBars: async () => [],
      }) as unknown as IbkrBridgeClient,
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
      throw new Error("quote snapshots should be blocked before hydration");
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const result = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5 }),
  );

  assert.equal(result.events.length, 0);
  assert.equal(result.source.status, "empty");
  assert.equal(result.source.errorMessage, null);
  assert.equal(
    result.source.ibkrReason,
    "options_flow_scanner_market_session_quiet",
  );
});

test("flow scanner quote leases stay admitted after quote snapshot completion", async () => {
  setOptionsFlowRuntimeOverrides({
    scannerAlwaysOn: false,
    scannerIntervalMs: 60_000,
    scannerLimit: 1,
    scannerLineBudget: 1,
  });

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
        getOptionChain: async () => [optionContract("SPY")],
      }) as unknown as IbkrBridgeClient,
  );

  const startedAt = Date.now();
  const result = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 1, lineBudget: 1 }),
  );
  assert.equal(result.events.length, 1);

  const diagnostics = getMarketDataAdmissionDiagnostics();
  const flowScannerLeases = diagnostics.leases.filter(
    (lease) => lease.intent === "flow-scanner-live",
  );
  assert.equal(diagnostics.flowScannerLineCount, 1);
  assert.equal(flowScannerLeases.length, 1);
  assert.ok(
    Date.parse(flowScannerLeases[0]?.expiresAt ?? "") > Date.now(),
  );
  assert.ok(Date.now() - startedAt < 70_000);
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

test("listFlowEvents keeps realtime flow on IBKR by default when Massive is configured", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  let massiveCalls = 0;
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getDerivedFlowEvents: async () => {
          massiveCalls += 1;
          return [massiveFlowEvent("SPY-MASSIVE", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const result = await listFlowEvents({
    underlying: "SPY",
    limit: 2,
    minPremium: 50_000,
  });
  const parsed = ListFlowEventsResponse.parse(result);

  assert.equal(massiveCalls, 0);
  assert.equal(parsed.source.provider, "none");
  assert.equal(parsed.source.fallbackUsed, false);
  assert.equal(parsed.source.ibkrReason, "options_flow_no_expirations");
  assert.deepEqual(parsed.events, []);
});

test("listFlowEvents keeps nonblocking realtime flow on IBKR by default", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  const providerOrder: string[] = [];
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
        getOptionExpirations: async () => {
          providerOrder.push("ibkr");
          return [];
        },
      }) as unknown as IbkrBridgeClient,
  );

  let massiveCalls = 0;
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getDerivedFlowEvents: async () => {
          providerOrder.push("massive");
          massiveCalls += 1;
          return [massiveFlowEvent("SPY-MASSIVE-NONBLOCKING", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const primer = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 2,
      minPremium: 50_000,
      blocking: false,
    }),
  );
  assert.equal(primer.source.ibkrReason, "options_flow_scanner_queued");

  await waitFor(() => providerOrder.includes("ibkr"));

  assert.equal(massiveCalls, 0);
  assert.deepEqual(providerOrder, ["ibkr"]);
});

test("listFlowEvents uses direct Massive snapshot first for explicit time windows", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setHistoricalFlowStoreDisabledForTests(true);
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => {
          throw new Error("historical flow should not use IBKR snapshots");
        },
      }) as unknown as IbkrBridgeClient,
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
      throw new Error("historical flow should not use IBKR option quote streams");
    },
    streamOptionQuoteSnapshots() {
      throw new Error("historical flow should not subscribe to option quotes");
    },
  });

  let requestedFrom: Date | undefined;
  let requestedTo: Date | undefined;
  let requestedSnapshotPageLimit: number | undefined;
  let massiveCalls = 0;
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getHistoricalOptionFlowEvents: () => {
          throw new Error("historical trade scan should not run before derived flow");
        },
        getDerivedFlowEvents: async (input: {
          from?: Date;
          to?: Date;
          limit?: number;
          snapshotPageLimit?: number;
        }) => {
          massiveCalls += 1;
          requestedFrom = input.from;
          requestedTo = input.to;
          requestedSnapshotPageLimit = input.snapshotPageLimit;
          return [massiveFlowEvent("SPY-HISTORY", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const from = new Date("2026-04-23T13:30:00.000Z");
  const to = new Date("2026-04-24T20:00:00.000Z");
  const result = await listFlowEvents({
    underlying: "SPY",
    limit: 2,
    from,
    to,
  });
  const parsed = ListFlowEventsResponse.parse(result);

  assert.equal(massiveCalls, 1);
  assert.equal(requestedFrom, undefined);
  assert.equal(requestedTo, undefined);
  assert.equal(requestedSnapshotPageLimit, 1);
  assert.equal(parsed.source.provider, "massive");
  assert.equal(parsed.source.ibkrReason, "options_flow_historical_direct");
  assert.deepEqual(
    parsed.events.map((event) => event.id),
    ["SPY-HISTORY"],
  );
});

test("listFlowEvents bounds direct historical flow for nonblocking charts", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setHistoricalFlowStoreDisabledForTests(true);
  __setHistoricalFlowDirectFallbackTimeoutMsForTests(1);
  let massiveCalls = 0;
  let requestedInput:
    | {
        contractLimit?: number;
        contractPageLimit?: number;
        tradeConcurrency?: number;
        tradePageLimit?: number;
        tradeLimit?: number;
        maxDte?: number | null;
        signal?: AbortSignal;
      }
    | undefined;
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getHistoricalOptionFlowEvents: (input: {
          contractLimit?: number;
          contractPageLimit?: number;
          tradeConcurrency?: number;
          tradePageLimit?: number;
          tradeLimit?: number;
          maxDte?: number | null;
          signal?: AbortSignal;
        }) => {
          massiveCalls += 1;
          requestedInput = input;
          return new Promise(() => {});
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const result = await listFlowEvents({
    underlying: "SPY",
    limit: 1_000,
    from: new Date("2026-04-23T13:30:00.000Z"),
    to: new Date("2026-04-24T20:00:00.000Z"),
    blocking: false,
  });
  const parsed = ListFlowEventsResponse.parse(result);

  assert.equal(massiveCalls, 1);
  assert.equal(requestedInput?.contractLimit, 40);
  assert.equal(requestedInput?.contractPageLimit, 1);
  assert.equal(requestedInput?.tradeConcurrency, 4);
  assert.equal(requestedInput?.tradePageLimit, 1);
  assert.equal(requestedInput?.tradeLimit, 500);
  assert.equal(requestedInput?.maxDte, 60);
  assert.equal(requestedInput?.signal?.aborted, true);
  assert.deepEqual(parsed.events, []);
  assert.equal(parsed.source.provider, "massive");
  assert.equal(
    parsed.source.ibkrReason,
    "options_flow_historical_provider_timeout",
  );
});

test("listFlowEvents single-flights bucketed nonblocking historical chart reads", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setHistoricalFlowStoreDisabledForTests(true);
  let massiveCalls = 0;
  const resolveHistoricalReads: Array<
    (events: ReturnType<typeof massiveFlowEvent>[]) => void
  > = [];
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getHistoricalOptionFlowEvents: () => {
          massiveCalls += 1;
          return new Promise<ReturnType<typeof massiveFlowEvent>[]>((resolve) => {
            resolveHistoricalReads.push(resolve);
          });
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const request = {
    underlying: "SPY",
    limit: 1_000,
    from: new Date("2026-04-24T13:30:00.000Z"),
    to: new Date("2026-04-24T20:00:00.000Z"),
    blocking: false,
    historicalBucketSeconds: 300,
  };
  const first = ListFlowEventsResponse.parse(await listFlowEvents(request));
  const second = ListFlowEventsResponse.parse(await listFlowEvents(request));

  assert.equal(massiveCalls, 1);
  assert.deepEqual(first.events, []);
  assert.equal(first.source.ibkrReason, "options_flow_historical_refreshing");
  assert.deepEqual(second.events, []);
  assert.equal(second.source.ibkrReason, "options_flow_historical_refreshing");

  resolveHistoricalReads.forEach((resolve) => resolve([]));
  await wait(5);
});

test("listFlowEvents cools down bucketed historical provider timeouts by exact key", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setHistoricalFlowStoreDisabledForTests(true);
  __setHistoricalFlowDirectFallbackTimeoutMsForTests(1);
  let massiveCalls = 0;
  const resolveHistoricalReads: Array<
    (events: ReturnType<typeof massiveFlowEvent>[]) => void
  > = [];
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getHistoricalOptionFlowEvents: () => {
          massiveCalls += 1;
          return new Promise<ReturnType<typeof massiveFlowEvent>[]>((resolve) => {
            resolveHistoricalReads.push(resolve);
          });
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const request = {
    underlying: "SPY",
    limit: 1_000,
    from: new Date("2026-04-24T13:30:00.000Z"),
    to: new Date("2026-04-24T20:00:00.000Z"),
    blocking: false,
    historicalBucketSeconds: 300,
  };
  const first = ListFlowEventsResponse.parse(await listFlowEvents(request));
  assert.equal(first.source.ibkrReason, "options_flow_historical_refreshing");
  assert.equal(massiveCalls, 1);

  let cooled = first;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(5);
    cooled = ListFlowEventsResponse.parse(await listFlowEvents(request));
    if (cooled.source.ibkrReason === "options_flow_historical_provider_timeout") {
      break;
    }
  }

  assert.equal(
    cooled.source.ibkrReason,
    "options_flow_historical_provider_timeout",
  );
  assert.equal(massiveCalls, 1);

  const differentWindow = ListFlowEventsResponse.parse(
    await listFlowEvents({
      ...request,
      to: new Date("2026-04-24T20:05:00.000Z"),
    }),
  );
  assert.equal(
    differentWindow.source.ibkrReason,
    "options_flow_historical_refreshing",
  );
  assert.equal(massiveCalls, 2);

  resolveHistoricalReads.forEach((resolve) => resolve([]));
  await wait(5);
});

test("listFlowEvents caches successful bucketed historical refresh after nonblocking primer", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setHistoricalFlowStoreDisabledForTests(true);
  let massiveCalls = 0;
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getHistoricalOptionFlowEvents: async () => {
          massiveCalls += 1;
          return [massiveFlowEvent("SPY-CACHED-HISTORY", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const request = {
    underlying: "SPY",
    limit: 1_000,
    from: new Date("2026-04-24T13:30:00.000Z"),
    to: new Date("2026-04-24T20:00:00.000Z"),
    blocking: false,
    historicalBucketSeconds: 300,
  };
  const first = ListFlowEventsResponse.parse(await listFlowEvents(request));
  assert.equal(first.source.ibkrReason, "options_flow_historical_refreshing");

  let cached = first;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(5);
    cached = ListFlowEventsResponse.parse(await listFlowEvents(request));
    if (cached.events.length > 0) {
      break;
    }
  }

  assert.equal(massiveCalls, 1);
  assert.deepEqual(
    cached.events.map((event) => event.id),
    ["SPY-CACHED-HISTORY"],
  );
  assert.equal(cached.source.ibkrReason, "options_flow_historical_direct");
});

test("listFlowEvents falls back to derived historical flow for nonblocking charts", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setHistoricalFlowStoreDisabledForTests(true);
  let requestedInput:
    | {
      from?: Date;
      to?: Date;
      limit?: number;
      snapshotPageLimit?: number;
      contractLimit?: number;
      contractPageLimit?: number;
      tradeLimit?: number;
      tradePageLimit?: number;
      tradeConcurrency?: number;
    }
    | undefined;
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getHistoricalOptionFlowEvents: () => {
          throw new Error("historical scan should not run before derived fallback");
        },
        getDerivedFlowEvents: async (input: {
          from?: Date;
          to?: Date;
          limit?: number;
          snapshotPageLimit?: number;
          contractLimit?: number;
          contractPageLimit?: number;
          tradeLimit?: number;
          tradePageLimit?: number;
          tradeConcurrency?: number;
        }) => {
          if (!input.from) {
            return [];
          }
          requestedInput = input;
          return [massiveFlowEvent("SPY-DERIVED-HISTORY", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const from = new Date("2026-04-23T13:30:00.000Z");
  const to = new Date("2026-04-24T20:00:00.000Z");
  const result = await listFlowEvents({
    underlying: "SPY",
    limit: 1_000,
    from,
    to,
    blocking: false,
  });
  const parsed = ListFlowEventsResponse.parse(result);

  assert.equal(requestedInput?.from?.toISOString(), from.toISOString());
  assert.equal(requestedInput?.to?.toISOString(), to.toISOString());
  assert.equal(requestedInput?.limit, 250);
  assert.equal(requestedInput?.snapshotPageLimit, 1);
  assert.equal(requestedInput?.contractLimit, 40);
  assert.equal(requestedInput?.contractPageLimit, 1);
  assert.equal(requestedInput?.tradeLimit, 500);
  assert.equal(requestedInput?.tradePageLimit, 1);
  assert.equal(requestedInput?.tradeConcurrency, 4);
  assert.deepEqual(
    parsed.events.map((event) => event.id),
    ["SPY-DERIVED-HISTORY"],
  );
  assert.equal(parsed.source.provider, "massive");
  assert.equal(parsed.source.ibkrReason, "options_flow_historical_direct");
});

test("listFlowEvents widens explicit Massive fallback candidates before applying narrow filters", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  let requestedLimit = 0;
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getDerivedFlowEvents: async (input: { limit?: number }) => {
          requestedLimit = input.limit ?? 0;
          return Array.from({ length: requestedLimit }, (_value, index) =>
            massiveFlowEvent(
              `SPY-MASSIVE-${index}`,
              index === 10 ? 75_000 : 5_000,
            ),
          );
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const result = await listFlowEvents({
    underlying: "SPY",
    limit: 2,
    minPremium: 50_000,
    allowMassiveFallback: true,
  });
  const parsed = ListFlowEventsResponse.parse(result);

  assert.ok(requestedLimit > 2);
  assert.equal(parsed.source.provider, "massive");
  assert.deepEqual(
    parsed.events.map((event) => event.id),
    ["SPY-MASSIVE-10"],
  );
});

test("listFlowEvents reports IBKR as source when a live snapshot is filtered empty", async () => {
  const contract = optionContract("SPY");
  const expirationDate = new Date("2026-06-19T00:00:00.000Z");
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [expirationDate],
        getOptionChain: async () => [
          {
            ...contract,
            contract: {
              ...contract.contract,
              ticker: "SPY-2026-06-19-500-C",
              providerContractId: "SPY-2026-06-19-500-C",
              expirationDate,
            },
          },
        ],
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

test("listFlowEvents timestamps IBKR snapshot rows from historical option bar time", async () => {
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
      throw new Error("flow scanner should not use live option quote snapshots");
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
        getOptionChain: async () => [contract],
        getHistoricalBars: async () => [
          historicalOptionBar(providerContractId, {
            timestamp: new Date("2026-04-24T14:35:00.000Z"),
            dataUpdatedAt: new Date("2026-04-24T14:35:00.000Z"),
          }),
        ],
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

test("listFlowEvents pins after-hours IBKR historical option rows to regular-session close", async () => {
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
      throw new Error("flow scanner should not use live option quote snapshots");
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
        getOptionChain: async () => [contract],
        getHistoricalBars: async () => [
          historicalOptionBar(providerContractId, {
            timestamp: new Date("2026-04-24T23:15:00.000Z"),
            dataUpdatedAt: new Date("2026-04-24T23:15:00.000Z"),
          }),
        ],
      }) as unknown as IbkrBridgeClient,
  );

  const parsed = ListFlowEventsResponse.parse(
    await listFlowEvents({ underlying: "SPY", limit: 5 }),
  );

  assert.equal(parsed.events.length, 1);
  assert.equal(
    parsed.events[0]?.occurredAt.toISOString(),
    "2026-04-24T20:00:00.000Z",
  );
  assert.match(parsed.events[0]?.id ?? "", /1777060800000$/);
});

test("listFlowEvents does not reuse explicit Massive fallback cache for IBKR-only requests", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  let massiveCalls = 0;
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getDerivedFlowEvents: async () => {
          massiveCalls += 1;
          return [massiveFlowEvent("SPY-MASSIVE-CACHED", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const fallback = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 2,
      minPremium: 50_000,
      allowMassiveFallback: true,
    }),
  );
  const ibkrOnly = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 2,
      minPremium: 50_000,
    }),
  );

  assert.equal(massiveCalls, 1);
  assert.equal(fallback.source.provider, "massive");
  assert.equal(ibkrOnly.source.provider, "none");
  assert.equal(ibkrOnly.source.fallbackUsed, false);
  assert.deepEqual(ibkrOnly.events, []);
});

test("listFlowEvents does not reuse explicit Massive fallback scanner snapshots for IBKR-only requests", async () => {
  process.env["MASSIVE_API_KEY"] = "test";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getOptionExpirations: async () => [],
      }) as unknown as IbkrBridgeClient,
  );

  let massiveCalls = 0;
  __setMassiveMarketDataClientFactoryForTests(
    (() =>
      ({
        getDerivedFlowEvents: async () => {
          massiveCalls += 1;
          return [massiveFlowEvent("SPY-MASSIVE-SNAPSHOT", 75_000)];
        },
      })) as unknown as Parameters<
        typeof __setMassiveMarketDataClientFactoryForTests
      >[0],
  );

  const fallback = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 2,
      allowMassiveFallback: true,
    }),
  );
  const ibkrOnly = ListFlowEventsResponse.parse(
    await listFlowEvents({
      underlying: "SPY",
      limit: 2,
    }),
  );

  assert.equal(massiveCalls, 1);
  assert.equal(fallback.source.provider, "massive");
  assert.equal(ibkrOnly.source.provider, "none");
  assert.equal(ibkrOnly.source.fallbackUsed, false);
  assert.deepEqual(ibkrOnly.events, []);
});

test("listFlowEvents hydrates multiple expirations before falling back", async () => {
  setOptionsFlowRuntimeOverrides({ expirationScanCount: 2 });
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

  const result = await listFlowEvents({
    underlying: "SPY",
    limit: 5,
    lineBudget: 2,
  });
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
