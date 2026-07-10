import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  __resetBridgeGovernorForTests,
} from "./bridge-governor";
import {
  admitMarketDataLeases,
  getMarketDataAdmissionDiagnostics,
  __resetMarketDataAdmissionForTests,
  setMarketDataAdmissionRuntimeDefaults,
} from "./market-data-admission";
import {
  __getMassiveOptionQuoteLastErrorForTests,
  getMassiveOptionQuoteStreamDiagnostics,
  __resetMassiveOptionQuoteStreamForTests,
  __setMassiveOptionQuoteClientForTests,
  __setMassiveOptionQuoteRuntimeConfiguredForTests,
  __setMassiveOptionQuoteStreamNowForTests,
  fetchMassiveOptionQuoteSnapshots,
  subscribeMassiveOptionQuoteSnapshots,
} from "./massive-option-quote-stream";
import { HttpError } from "../lib/errors";

afterEach(() => {
  __resetMassiveOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setMassiveOptionQuoteClientForTests(null);
  __setMassiveOptionQuoteStreamNowForTests(null);
});

const SPY_OPRA = "O:SPY260608C00500000";

test("algo operations automation live quote snapshots use Massive OPRA quotes", async () => {
  __resetMassiveOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setMassiveOptionQuoteStreamNowForTests(new Date("2026-06-08T18:00:00.000Z"));
  __setMassiveOptionQuoteClientForTests({
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
          providerContractId: SPY_OPRA,
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

  const payload = await fetchMassiveOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: [SPY_OPRA],
    owner: "algo-operations:SPY",
    intent: "automation-live",
    requiresGreeks: true,
  });

  assert.equal(payload.quotes.length, 1);
  assert.equal(payload.quotes[0]?.providerContractId, SPY_OPRA);
  assert.equal(payload.quotes[0]?.source, "massive");
});

test("option quote payload freshness uses server receive-age, not market-data age", async () => {
  __resetMassiveOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setMassiveOptionQuoteStreamNowForTests(new Date("2026-06-08T18:00:10.000Z"));
  __setMassiveOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws" as const,
        marketDataMode: "live" as const,
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots() {
      return [
        {
          symbol: "SPY",
          providerContractId: SPY_OPRA,
          bid: 1,
          ask: 1.1,
          price: 1.05,
          delayed: false,
          freshness: "live",
          transport: "massive_rest",
          updatedAt: new Date("2026-06-08T18:00:00.000Z"),
          dataUpdatedAt: new Date("2026-06-08T18:00:00.000Z"),
        },
      ] as never;
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  const payload = await fetchMassiveOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: [SPY_OPRA],
    owner: "account-position-option-quotes:test:stale-upstream",
    intent: "account-monitor-live",
    requiresGreeks: false,
    hydrateCached: true,
  });

  assert.equal(payload.quotes.length, 1);
  // The NBBO last changed 10s ago (ageMs 10_000) but we just re-fetched this
  // snapshot (cacheAgeMs 0). A quiet-but-current NBBO is the live market, so the
  // freshly-received quote is "live" — staleness keys on our receive-age, not on
  // how long the underlying market has been quiet.
  assert.equal(payload.quotes[0]?.freshness, "live");
  assert.equal(payload.quotes[0]?.ageMs, 10_000);
  assert.equal(payload.quotes[0]?.cacheAgeMs, 0);
});

test("unconfigured Massive option snapshots report Massive runtime unavailable", async () => {
  __resetMassiveOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setMassiveOptionQuoteRuntimeConfiguredForTests(false);

  const payload = await fetchMassiveOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: [SPY_OPRA],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requiresGreeks: false,
  });

  assert.equal(payload.debug?.errorCode, "massive_not_configured");
  assert.match(payload.debug?.errorMessage ?? "", /Massive options market data/i);
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

async function waitForLastOptionQuoteError(
  pattern: RegExp,
): Promise<string> {
  for (let index = 0; index < 20; index += 1) {
    const lastError = __getMassiveOptionQuoteLastErrorForTests();
    if (lastError && pattern.test(lastError)) {
      return lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Expected option quote stream error matching ${pattern}`);
}

test("off-hours upstream-unavailable option fetch does not record a connection error", async () => {
  __resetMassiveOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setMassiveOptionQuoteStreamNowForTests(new Date("2026-06-08T23:30:00.000Z"));
  __setMassiveOptionQuoteClientForTests(
    makeThrowingOptionQuoteClient(
      new HttpError(502, "Upstream request failed.", {
        code: "upstream_request_failed",
      }),
    ),
  );

  await fetchMassiveOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: [SPY_OPRA],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requiresGreeks: false,
  });

  assert.equal(
    __getMassiveOptionQuoteLastErrorForTests(),
    null,
    "upstream-unavailable must not surface as option-stream lastError",
  );
});

test("a genuine upstream error still records a connection error", async () => {
  __resetMassiveOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setMassiveOptionQuoteStreamNowForTests(new Date("2026-06-08T18:00:00.000Z"));
  __setMassiveOptionQuoteClientForTests(
    makeThrowingOptionQuoteClient(new Error("tws auth rejected")),
  );

  await fetchMassiveOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: [SPY_OPRA],
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requiresGreeks: false,
  });

  assert.match(
    __getMassiveOptionQuoteLastErrorForTests() ?? "",
    /tws auth rejected/,
    "non-upstream errors must still surface as option-stream lastError",
  );
});

test("account monitor can refresh stale cached option quotes with a bounded timeout", async () => {
  __resetMassiveOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setMassiveOptionQuoteStreamNowForTests(new Date("2026-06-08T18:00:00.000Z"));

  let snapshotCalls = 0;
  const observedTimeouts: Array<number | undefined> = [];
  __setMassiveOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws" as const,
        marketDataMode: "live" as const,
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(input: { timeoutMs?: number }) {
      snapshotCalls += 1;
      observedTimeouts.push(input.timeoutMs);
      return [
        {
          symbol: "SPY",
          providerContractId: SPY_OPRA,
          bid: snapshotCalls === 1 ? 1 : 2,
          ask: snapshotCalls === 1 ? 1.1 : 2.1,
          price: snapshotCalls === 1 ? 1.05 : 2.05,
          delayed: false,
          freshness: snapshotCalls === 1 ? "stale" : "live",
          transport: "tws",
          updatedAt: new Date(
            snapshotCalls === 1
              ? "2026-06-08T18:00:01.000Z"
              : "2026-06-08T18:00:02.000Z",
          ),
        },
      ] as never;
    },
    streamOptionQuoteSnapshots() {
      return () => {};
    },
  });

  await fetchMassiveOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: [SPY_OPRA],
    owner: "account-position-option-quotes:test:prime",
    intent: "account-monitor-live",
    requiresGreeks: false,
    hydrateCached: true,
    timeoutMs: 1234,
  });

  const cachedPayload = await fetchMassiveOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: [SPY_OPRA],
    owner: "account-position-option-quotes:test:cached",
    intent: "account-monitor-live",
    requiresGreeks: false,
  });
  assert.equal(snapshotCalls, 1);
  assert.equal(cachedPayload.quotes[0]?.bid, 1);
  assert.equal(cachedPayload.quotes[0]?.freshness, "stale");

  const refreshedPayload = await fetchMassiveOptionQuoteSnapshots({
    underlying: "SPY",
    providerContractIds: [SPY_OPRA],
    owner: "account-position-option-quotes:test:refresh",
    intent: "account-monitor-live",
    requiresGreeks: false,
    hydrateCached: true,
    timeoutMs: 1234,
  });
  assert.equal(snapshotCalls, 2);
  assert.deepEqual(observedTimeouts, [1234, 1234]);
  assert.equal(refreshedPayload.quotes[0]?.bid, 2);
  assert.equal(refreshedPayload.quotes[0]?.freshness, "live");
});

test("option stream generic Output exceeded error does not shed scanner demand", async () => {
  __resetMassiveOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setMassiveOptionQuoteStreamNowForTests(new Date("2026-06-12T12:00:00.000Z"));

  __setMassiveOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws" as const,
        marketDataMode: "live" as const,
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(): Promise<never> {
      throw new Error("Output exceeded limit (was: 100031)");
    },
    streamOptionQuoteSnapshots() {
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

  const unsubscribe = subscribeMassiveOptionQuoteSnapshots(
    {
      underlying: "SPY",
      providerContractIds: [SPY_OPRA],
      owner: "trade-option-chain:SPY",
      intent: "visible-live",
      requiresGreeks: true,
      fallbackProvider: "none",
    },
    () => {},
  );
  await waitForLastOptionQuoteError(/Output exceeded limit/);

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.pressure.ibkrPressure, null);
  assert.equal(diagnostics.pressure.scannerChargedLineCount, 10);
  assert.match(
    __getMassiveOptionQuoteLastErrorForTests() ?? "",
    /Output exceeded limit/,
  );

  unsubscribe();
});

test("a transient option-stream timeout does not shed the scanner or tear down the chunk", async () => {
  __resetMassiveOptionQuoteStreamForTests();
  __resetBridgeGovernorForTests();
  __resetMarketDataAdmissionForTests();
  __setMassiveOptionQuoteStreamNowForTests(new Date("2026-06-12T12:00:00.000Z"));

  __setMassiveOptionQuoteClientForTests({
    async getHealth() {
      return {
        transport: "tws" as const,
        marketDataMode: "live" as const,
        liveMarketDataAvailable: true,
      };
    },
    async getOptionQuoteSnapshots(): Promise<never> {
      throw new Error(
        "Massive option quote snapshot request timed out after 30000ms.",
      );
    },
    streamOptionQuoteSnapshots() {
      return () => {
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

  const unsubscribe = subscribeMassiveOptionQuoteSnapshots(
    {
      underlying: "SPY",
      providerContractIds: [SPY_OPRA],
      owner: "trade-option-chain:SPY",
      intent: "visible-live",
      requiresGreeks: true,
      fallbackProvider: "none",
    },
    () => {},
  );
  await waitForLastOptionQuoteError(/timed out/);

  const diagnostics = getMarketDataAdmissionDiagnostics();
  // A transient request timeout must NOT be treated as capacity pressure, so the
  // one-shot scanner shed never fires (this was half the flap).
  assert.equal(diagnostics.pressure.ibkrPressure, null);
  assert.equal(getMassiveOptionQuoteStreamDiagnostics().activeMassiveChunkCount, 1);
  // The timeout is still surfaced as the stream's lastError for visibility.
  assert.match(
    __getMassiveOptionQuoteLastErrorForTests() ?? "",
    /timed out/,
  );

  unsubscribe();
});
