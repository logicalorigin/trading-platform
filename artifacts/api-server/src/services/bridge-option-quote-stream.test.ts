import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  __resetBridgeGovernorForTests,
  getBridgeGovernorSnapshot,
} from "./bridge-governor";
import {
  admitMarketDataLeases,
  getMarketDataAdmissionDiagnostics,
  __resetMarketDataAdmissionForTests,
  setMarketDataAdmissionRuntimeDefaults,
} from "./market-data-admission";
import {
  __getBridgeOptionQuoteLastErrorForTests,
  __resetBridgeOptionQuoteStreamForTests,
  __setBridgeOptionQuoteClientForTests,
  __setBridgeOptionQuoteStreamNowForTests,
  fetchBridgeOptionQuoteSnapshots,
  subscribeBridgeOptionQuoteSnapshots,
} from "./bridge-option-quote-stream";
import { HttpError } from "../lib/errors";

afterEach(() => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteClientForTests(null);
  __setBridgeOptionQuoteStreamNowForTests(null);
});

test("algo operations automation live quote snapshots use the quote bridge lane", async () => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteStreamNowForTests(new Date("2026-06-08T18:00:00.000Z"));
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
        {
          symbol: "SPY",
          providerContractId: "contract-1",
          bid: 1,
          ask: 1.1,
          price: 1.05,
          delayed: false,
          freshness: "live",
          transport: "tws",
          updatedAt: new Date("2026-06-08T18:00:01.000Z"),
          delta: 0.5,
        },
      ] as never;
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["contract-1"],
    owner: "algo-operations:SPY",
    intent: "automation-live",
    requiresGreeks: true,
  });

  assert.equal(payload.quotes.length, 1);
  const snapshot = getBridgeGovernorSnapshot();
  assert.ok(snapshot.quotes.lastSuccessAt);
  assert.equal(snapshot.options.lastSuccessAt, null);
});

function makeThrowingOptionQuoteClient(error: unknown) {
  return {
    async getHealth() {
      return {
        transport: "tws" as const,
        marketDataMode: "live" as const,
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(): Promise<never> {
      throw error;
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  };
}

async function waitForStreamErrorHook(
  getHook: () => ((error: unknown) => void) | null,
): Promise<(error: unknown) => void> {
  for (let index = 0; index < 20; index += 1) {
    const hook = getHook();
    if (hook) {
      return hook;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("Expected option quote stream hook to be registered");
}

test("off-hours upstream-unavailable option fetch does not record a connection error", async () => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteStreamNowForTests(new Date("2026-06-08T23:30:00.000Z"));
  __setBridgeOptionQuoteClientForTests(
    makeThrowingOptionQuoteClient(
      new HttpError(502, "Upstream request failed.", {
        code: "upstream_request_failed",
      }),
    ),
  );

  await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["contract-1"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requiresGreeks: false,
  });

  assert.equal(
    __getBridgeOptionQuoteLastErrorForTests(),
    null,
    "upstream-unavailable must not surface as option-stream lastError",
  );
});

test("a genuine upstream error still records a connection error", async () => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteStreamNowForTests(new Date("2026-06-08T18:00:00.000Z"));
  __setBridgeOptionQuoteClientForTests(
    makeThrowingOptionQuoteClient(new Error("tws auth rejected")),
  );

  await fetchBridgeOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: ["contract-1"],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requiresGreeks: false,
  });

  assert.match(
    __getBridgeOptionQuoteLastErrorForTests() ?? "",
    /tws auth rejected/,
    "non-upstream errors must still surface as option-stream lastError",
  );
});

test("option stream generic Output exceeded error does not shed scanner demand", async () => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteStreamNowForTests(new Date("2026-06-12T12:00:00.000Z"));

  let onStreamError: ((error: unknown) => void) | null = null;
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws" as const,
        marketDataMode: "live" as const,
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      return [];
    },
    streamOptionQuoteSnapshots(_input, _onQuotes, onError) {
      onStreamError = onError ?? null;
      return () => {};
    },
  });
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 20,
    flowScannerConcurrency: 1,
  });
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 10 }, (_, index) => ({
      assetClass: "option",
      symbol: "SPY",
      providerContractId: `SPY-C-${index}`,
    })),
    fallbackProvider: "none",
  });

  const unsubscribe = subscribeBridgeOptionQuoteSnapshots(
    {
      underlying: "SPY",
      providerContractIds: ["visible-contract"],
      owner: "trade-option-chain:SPY",
      intent: "visible-live",
      requiresGreeks: true,
      fallbackProvider: "none",
    },
    () => {},
  );
  const streamError = await waitForStreamErrorHook(() => onStreamError);
  streamError(new Error("Output exceeded limit (was: 100031)"));

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.pressure.ibkrPressure, null);
  assert.equal(diagnostics.pressure.scannerChargedLineCount, 10);
  assert.match(
    __getBridgeOptionQuoteLastErrorForTests() ?? "",
    /Output exceeded limit/,
  );

  unsubscribe();
});

test("a transient option-stream timeout does not shed the scanner or tear down the chunk", async () => {
  __resetBridgeOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setBridgeOptionQuoteStreamNowForTests(new Date("2026-06-12T12:00:00.000Z"));

  let onStreamError: ((error: unknown) => void) | null = null;
  let unsubscribeCount = 0;
  __setBridgeOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws" as const,
        marketDataMode: "live" as const,
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      return [];
    },
    streamOptionQuoteSnapshots(_input, _onQuotes, onError) {
      onStreamError = onError ?? null;
      // The unsubscribe call is the teardown signal: the flap was every option
      // line being unsubscribed on one chunk's timeout.
      return () => {
        unsubscribeCount += 1;
      };
    },
  });
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 20,
    flowScannerConcurrency: 1,
  });
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 10 }, (_, index) => ({
      assetClass: "option",
      symbol: "SPY",
      providerContractId: `SPY-C-${index}`,
    })),
    fallbackProvider: "none",
  });

  const unsubscribe = subscribeBridgeOptionQuoteSnapshots(
    {
      underlying: "SPY",
      providerContractIds: ["visible-contract"],
      owner: "trade-option-chain:SPY",
      intent: "visible-live",
      requiresGreeks: true,
      fallbackProvider: "none",
    },
    () => {},
  );
  const streamError = await waitForStreamErrorHook(() => onStreamError);

  streamError(
    new Error(
      "IBKR bridge request to /options/quotes timed out after 30000ms.",
    ),
  );

  const diagnostics = getMarketDataAdmissionDiagnostics();
  // A transient request timeout must NOT be treated as capacity pressure, so the
  // one-shot scanner shed never fires (this was half the flap).
  assert.equal(diagnostics.pressure.ibkrPressure, null);
  // ...and it must NOT tear down the live chunk: the other option lines (incl.
  // the Trade Options Chain) stay subscribed while only the failed chunk retries.
  assert.equal(unsubscribeCount, 0);
  // The timeout is still surfaced as the stream's lastError for visibility.
  assert.match(
    __getBridgeOptionQuoteLastErrorForTests() ?? "",
    /timed out/,
  );

  unsubscribe();
});
