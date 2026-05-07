import assert from "node:assert/strict";
import test from "node:test";
import {
  admitMarketDataLeases,
  __resetMarketDataAdmissionForTests,
} from "./market-data-admission";
import {
  getIbkrLineUsageSnapshot,
  __resetIbkrLineUsageForTests,
  __setIbkrLineUsageBridgeClientFactoryForTests,
} from "./ibkr-line-usage";

const originalTimeoutMs = process.env["IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS"];

test.afterEach(() => {
  __setIbkrLineUsageBridgeClientFactoryForTests(null);
  __resetIbkrLineUsageForTests();
  __resetMarketDataAdmissionForTests();
  if (originalTimeoutMs === undefined) {
    delete process.env["IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS"];
  } else {
    process.env["IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS"] = originalTimeoutMs;
  }
});

test("getIbkrLineUsageSnapshot returns admission counters when bridge lanes stall", async () => {
  process.env["IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS"] = "10";
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: () => new Promise(() => {}),
  }));
  admitMarketDataLeases({
    owner: "line-usage-test",
    intent: "flow-scanner-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });

  const startedAt = Date.now();
  const snapshot = await getIbkrLineUsageSnapshot();

  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(snapshot.admission.activeLineCount, 1);
  assert.equal(snapshot.admission.accountMonitorLineCount, 0);
  assert.equal(snapshot.admission.budget.accountMonitorLineCap, 10);
  assert.equal(snapshot.admission.poolUsage["account-monitor"].maxLines, 10);
  assert.equal(snapshot.admission.flowScannerLineCount, 1);
  assert.equal(typeof snapshot.admission.optionsFlowScanner, "object");
  assert.equal(snapshot.bridge.diagnostics, null);
  assert.equal(snapshot.bridge.activeLineCount, null);
  assert.match(snapshot.bridge.error ?? "", /timed out after 10ms/i);
  assert.equal(snapshot.drift.reconciliation.status, "unknown");
});

test("getIbkrLineUsageSnapshot classifies API and bridge line drift", async () => {
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 3,
        marketDataLineBudget: 190,
        activeEquitySymbols: ["AAPL", "MSFT"],
        activeOptionProviderContractIds: ["twsopt:test-bridge-only"],
      },
    }),
  }));
  admitMarketDataLeases({
    owner: "line-usage-equity",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });
  admitMarketDataLeases({
    owner: "line-usage-option",
    intent: "visible-live",
    requests: [
      {
        assetClass: "option",
        symbol: "SPY",
        providerContractId: "twsopt:test-api-only",
      },
    ],
    fallbackProvider: "cache",
    replaceOwnerExisting: false,
  });

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.drift.admissionVsBridgeLineDelta, -1);
  assert.equal(snapshot.drift.reconciliation.status, "mixed");
  assert.equal(snapshot.drift.reconciliation.matchedLineCount, 1);
  assert.equal(snapshot.drift.reconciliation.apiOnlyLineCount, 1);
  assert.equal(snapshot.drift.reconciliation.bridgeOnlyLineCount, 2);
  assert.deepEqual(snapshot.drift.reconciliation.apiOnlyLineSample, [
    "option:twsopt:test-api-only",
  ]);
  assert.deepEqual(snapshot.drift.reconciliation.bridgeOnlyLineSample, [
    "equity:MSFT",
    "option:twsopt:test-bridge-only",
  ]);
});
