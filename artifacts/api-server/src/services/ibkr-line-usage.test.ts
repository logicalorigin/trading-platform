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
  assert.equal(snapshot.admission.flowScannerLineCount, 1);
  assert.equal(snapshot.bridge.diagnostics, null);
  assert.equal(snapshot.bridge.activeLineCount, null);
  assert.match(snapshot.bridge.error ?? "", /timed out after 10ms/i);
});
