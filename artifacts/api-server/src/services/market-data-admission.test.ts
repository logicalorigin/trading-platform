import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetMarketDataAdmissionForTests,
  admitMarketDataLeases,
  getMarketDataAdmissionDiagnostics,
  getMarketDataLeasesSnapshot,
} from "./market-data-admission";

test("equity lease refresh preserves newly supplied provider contract id", () => {
  __resetMarketDataAdmissionForTests();

  admitMarketDataLeases({
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "FCEL" }],
    fallbackProvider: "none",
  });
  admitMarketDataLeases({
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: [
      {
        assetClass: "equity",
        symbol: "FCEL",
        providerContractId: "740517233",
      },
    ],
    fallbackProvider: "none",
  });

  const leases = getMarketDataLeasesSnapshot();
  assert.equal(leases.length, 1);
  assert.equal(leases[0].instrumentKey, "equity:FCEL");
  assert.equal(leases[0].lineIds[0], "equity:FCEL");
  assert.equal(leases[0].providerContractId, "740517233");
});

test("flow scanner cap preserves Trade Options Chain reserve", () => {
  __resetMarketDataAdmissionForTests();

  const diagnostics = getMarketDataAdmissionDiagnostics();
  const flowScannerUsage = diagnostics.poolUsage["flow-scanner"];
  const visibleUsage = diagnostics.poolUsage.visible;

  assert.equal(diagnostics.budget.visibleOptionQuoteLineReserve, 41);
  assert.equal(diagnostics.lineAllocation.optionReserveLineCount, 41);
  assert.ok(flowScannerUsage);
  assert.ok(visibleUsage);
  assert.equal(flowScannerUsage.effectiveMaxLines, 159);
  assert.equal(visibleUsage.label, "Trade Options Chain");
});

test("flow scanner cap uses live Trade Options Chain demand above reserve", () => {
  __resetMarketDataAdmissionForTests();

  admitMarketDataLeases({
    owner: "trade-option-chain:SPY",
    intent: "visible-live",
    requests: Array.from({ length: 47 }, (_, index) => ({
      assetClass: "option",
      symbol: "SPY",
      providerContractId: `SPY-C-${index}`,
    })),
    fallbackProvider: "none",
  });

  const diagnostics = getMarketDataAdmissionDiagnostics();
  const flowScannerUsage = diagnostics.poolUsage["flow-scanner"];

  assert.equal(diagnostics.lineAllocation.nonScannerOptionLineCount, 47);
  assert.equal(diagnostics.lineAllocation.optionReserveLineCount, 47);
  assert.ok(flowScannerUsage);
  assert.equal(flowScannerUsage.effectiveMaxLines, 153);
});
