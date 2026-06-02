import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearIbkrBridgeRuntimeOverride } from "../lib/runtime";
import {
  __resetBridgeOptionQuoteStreamForTests,
  __setBridgeOptionQuoteClientForTests,
  __setBridgeOptionQuoteStreamNowForTests,
} from "./bridge-option-quote-stream";
import {
  __resetMarketDataAdmissionForTests,
  getMarketDataAdmissionDiagnostics,
} from "./market-data-admission";
import {
  __resetIbkrLiveDemandCoordinatorForTests,
  declareIbkrLiveDemand,
  getIbkrLiveDemandDiagnostics,
  readIbkrLiveDemandState,
  releaseIbkrLiveDemand,
} from "./ibkr-live-demand-coordinator";
import type { QuoteSnapshot } from "../providers/ibkr/client";

const ENV_KEYS = [
  "IBKR_MARKET_DATA_APP_MAX_LINES",
  "IBKR_MARKET_DATA_RESERVE_LINES",
  "IBKR_MARKET_DATA_EXECUTION_LINES",
  "IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES",
  "IBKR_MARKET_DATA_VISIBLE_LINES",
  "IBKR_MARKET_DATA_AUTOMATION_LINES",
  "IBKR_MARKET_DATA_FLOW_SCANNER_LINES",
  "IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
  "PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE",
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

function optionQuote(providerContractId: string, price: number): QuoteSnapshot {
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
    updatedAt: REGULAR_SESSION_NOW,
    providerContractId,
    transport: "tws",
    delayed: false,
  };
}

function emitBridgeQuotes(
  emit: ((quotes: QuoteSnapshot[]) => void) | null,
  quotes: QuoteSnapshot[],
): void {
  if (typeof emit !== "function") {
    assert.fail("expected bridge quote stream callback to be registered");
  }
  emit(quotes);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(predicate(), true);
}

test.afterEach(() => {
  __resetIbkrLiveDemandCoordinatorForTests();
  __resetBridgeOptionQuoteStreamForTests();
  __setBridgeOptionQuoteClientForTests(null);
  __setBridgeOptionQuoteStreamNowForTests(null);
  __resetMarketDataAdmissionForTests();
  setEnv(originalEnv);
  clearIbkrBridgeRuntimeOverride({ deletePersisted: false });
});

test.beforeEach(() => {
  __setBridgeOptionQuoteStreamNowForTests(REGULAR_SESSION_NOW);
});

test("IBKR live demand declares stream-backed option demand and reads cached live state", async () => {
  let emitQuotes: ((quotes: QuoteSnapshot[]) => void) | null = null;
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
      throw new Error("live demand coordinator should not snapshot first");
    },
    streamOptionQuoteSnapshots(input, onQuotes) {
      bridgeRequests.push(input.providerContractIds);
      emitQuotes = onQuotes;
      return () => {};
    },
  });

  declareIbkrLiveDemand({
    owner: "algo-operations:SPY",
    intent: "automation-live",
    underlying: "SPY",
    providerContractIds: ["1001"],
    fallbackProvider: "cache",
    requiresGreeks: true,
    ttlMs: 5_000,
  });

  await waitFor(() => bridgeRequests.length === 1);
  assert.deepEqual(bridgeRequests, [["1001"]]);
  assert.deepEqual(
    readIbkrLiveDemandState({
      owner: "algo-operations:SPY",
      underlying: "SPY",
      providerContractIds: ["1001"],
      requiresGreeks: true,
    }).states.map((state) => ({
      providerContractId: state.providerContractId,
      status: state.status,
      reason: state.reason,
    })),
    [
      {
        providerContractId: "1001",
        status: "pending",
        reason: "awaiting_quote",
      },
    ],
  );

  emitBridgeQuotes(emitQuotes, [optionQuote("1001", 1.23)]);

  const state = readIbkrLiveDemandState({
    owner: "algo-operations:SPY",
    underlying: "SPY",
    providerContractIds: ["1001"],
    requiresGreeks: true,
  });
  assert.equal(state.states[0]?.status, "live");
  assert.equal(state.states[0]?.quote?.price, 1.23);
  assert.equal(getIbkrLiveDemandDiagnostics().activeDemandCount, 1);

  releaseIbkrLiveDemand("algo-operations:SPY", "test_complete");
  assert.equal(getIbkrLiveDemandDiagnostics().activeDemandCount, 0);
});

test("IBKR live demand reports bridge unavailable instead of not-admitted when unconfigured", () => {
  process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = join(
    tmpdir(),
    `pyrus-live-demand-unconfigured-${process.pid}-${Date.now()}.json`,
  );
  delete process.env["PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
  clearIbkrBridgeRuntimeOverride({ deletePersisted: false });

  declareIbkrLiveDemand({
    owner: "algo-operations:SPY",
    intent: "automation-live",
    underlying: "SPY",
    providerContractIds: ["1001"],
    fallbackProvider: "cache",
    requiresGreeks: true,
  });

  const state = readIbkrLiveDemandState({
    owner: "algo-operations:SPY",
    underlying: "SPY",
    providerContractIds: ["1001"],
    requiresGreeks: true,
  });

  assert.equal(state.states[0]?.status, "unavailable");
  assert.equal(state.states[0]?.reason, "ibkr_bridge_not_configured");
});

test("IBKR live demand lets execution demand preempt scanner demand", async () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "2",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "2",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "2",
    IBKR_MARKET_DATA_VISIBLE_LINES: "2",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "2",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "2",
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
    async getOptionQuoteSnapshots() {
      return [];
    },
    streamOptionQuoteSnapshots(input) {
      bridgeRequests.push(input.providerContractIds);
      return () => {};
    },
  });

  declareIbkrLiveDemand({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    underlying: "SPY",
    providerContractIds: ["1001"],
    fallbackProvider: "none",
    requiresGreeks: false,
  });
  await waitFor(() => bridgeRequests.length === 1);

  declareIbkrLiveDemand({
    owner: "order-ticket:SPY",
    intent: "execution-live",
    underlying: "SPY",
    providerContractIds: ["2001"],
    fallbackProvider: "cache",
    requiresGreeks: true,
  });

  await waitFor(() => bridgeRequests.length >= 2);
  const admission = getMarketDataAdmissionDiagnostics();
  const diagnostics = getIbkrLiveDemandDiagnostics();

  assert.equal(admission.intentUsage["execution-live"], 2);
  assert.equal(admission.intentUsage["flow-scanner-live"], 0);
  assert.deepEqual(diagnostics.desiredProviderContractIds, ["2001"]);
});
