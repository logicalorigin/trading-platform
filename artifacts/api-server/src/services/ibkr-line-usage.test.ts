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
  assert.equal(snapshot.admission.budget.accountMonitorLineCap, 0);
  assert.equal(snapshot.policy.maxLines, 200);
  assert.equal(snapshot.policy.reserveLines, 0);
  assert.equal(snapshot.policy.targetFillLines, 200);
  assert.equal(snapshot.policy.accountMonitorDynamic, true);
  assert.equal(snapshot.allocation.activeLineCount, 1);
  assert.equal(snapshot.allocation.remainingToTargetLineCount, 199);
  assert.equal(snapshot.allocation.elasticLineCount, 0);
  assert.equal(snapshot.allocation.reclaimableElasticLineCount, 0);
  assert.equal(snapshot.allocation.fillerLineCount, 0);
  assert.equal(snapshot.lineUtilizationAudit.targetLineCount, 200);
  assert.equal(snapshot.lineUtilizationAudit.admissionActiveLineCount, 1);
  assert.equal(snapshot.lineUtilizationAudit.idleToTargetLineCount, 199);
  assert.equal(
    snapshot.lineUtilizationAudit.topLimitingReason,
    "bridge-diagnostics-unavailable",
  );
  assert.equal(
    snapshot.lineUtilizationAudit.scanner.configuredConcurrency,
    2,
  );
  assert.equal(snapshot.lineUtilizationAudit.scanner.maxDeepScanLines, 80);
  assert.equal(snapshot.lineUtilizationAudit.watchlist.fillerCapSymbolCount, 40);
  assert.equal(snapshot.admission.poolUsage["account-monitor"].maxLines, 0);
  assert.equal(snapshot.admission.poolUsage["account-monitor"].dynamic, true);
  assert.equal(snapshot.admission.flowScannerLineCount, 1);
  assert.equal(typeof snapshot.admission.optionsFlowScanner, "object");
  assert.equal(snapshot.signalOptions.activeLineCount, 0);
  assert.equal(snapshot.bridge.diagnostics, null);
  assert.equal(snapshot.bridge.activeLineCount, null);
  assert.match(snapshot.bridge.error ?? "", /timed out after 10ms/i);
  assert.equal(snapshot.drift.reconciliation.status, "unknown");
});

test("getIbkrLineUsageSnapshot exposes signal option owner-class usage", async () => {
  process.env["IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS"] = "10";
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: () => new Promise(() => {}),
  }));
  admitMarketDataLeases({
    owner: "signal-options-position-mark:deploy-1:position-1",
    intent: "flow-scanner-live",
    requests: [
      {
        assetClass: "option",
        symbol: "NVDA",
        providerContractId: "SIGOPT1",
      },
    ],
    fallbackProvider: "cache",
  });

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.signalOptions.activeLineCount, 1);
  assert.equal(snapshot.signalOptions.ownerCount, 1);
  assert.equal(snapshot.signalOptions.recentCacheFallbackCount, 1);
  assert.equal(
    snapshot.ownerClasses.summaries["signal-options"].activeLineCount,
    1,
  );
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

  assert.equal(snapshot.admission.budget.maxLines, 190);
  assert.equal(snapshot.admission.budget.configuredMaxLines, 200);
  assert.equal(snapshot.admission.budget.budgetSource, "bridge-diagnostics");
  assert.equal(snapshot.policy.targetFillLines, 190);
  assert.equal(snapshot.allocation.bridgeLineBudget, 190);
  assert.equal(snapshot.allocation.remainingToTargetLineCount, 188);
  assert.equal(snapshot.lineUtilizationAudit.bridgeLineBudget, 190);
  assert.equal(snapshot.lineUtilizationAudit.bridgeActiveLineCount, 3);
  assert.equal(snapshot.lineUtilizationAudit.bridgeRemainingLineCount, 187);
  assert.equal(snapshot.lineUtilizationAudit.admissionVsBridgeLineDelta, -1);
  assert.equal(snapshot.lineUtilizationAudit.driftStatus, "mixed");
  assert.equal(snapshot.lineUtilizationAudit.topLimitingReason, "line-drift");
  assert.equal(snapshot.drift.admissionVsBridgeLineDelta, -1);
  assert.equal(snapshot.drift.reconciliation.status, "mixed");
  assert.equal(snapshot.drift.reconciliation.matchedLineCount, 1);
  assert.equal(snapshot.drift.reconciliation.apiOnlyLineCount, 1);
  assert.equal(snapshot.drift.reconciliation.bridgeOnlyLineCount, 2);
  assert.deepEqual(snapshot.drift.reconciliation.apiOnlyLineSample, [
    "option:twsopt:test-api-only",
  ]);
  assert.deepEqual(snapshot.drift.reconciliation.apiOnlyGroups, [
    {
      owner: "line-usage-option",
      intent: "visible-live",
      pool: "visible",
      assetClass: null,
      lineCount: 1,
      leaseCount: 1,
      lineSample: ["option:twsopt:test-api-only"],
    },
  ]);
  assert.deepEqual(snapshot.drift.reconciliation.bridgeOnlyLineSample, [
    "equity:MSFT",
    "option:twsopt:test-bridge-only",
  ]);
  assert.deepEqual(snapshot.drift.reconciliation.bridgeOnlyGroups, [
    {
      owner: null,
      intent: null,
      pool: null,
      assetClass: "equity",
      lineCount: 1,
      leaseCount: 0,
      lineSample: ["equity:MSFT"],
    },
    {
      owner: null,
      intent: null,
      pool: null,
      assetClass: "option",
      lineCount: 1,
      leaseCount: 0,
      lineSample: ["option:twsopt:test-bridge-only"],
    },
  ]);
  assert.equal(snapshot.drift.reconciliation.persistentBridgeOnlyLineCount, 0);
});

test("getIbkrLineUsageSnapshot reports account and visible bridge warm-up coverage", async () => {
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 2,
        marketDataLineBudget: 190,
        activeEquitySymbols: ["AAPL", "SPY"],
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  admitMarketDataLeases({
    owner: "account-monitor:paper:all",
    intent: "account-monitor-live",
    requests: ["AAPL", "MSFT"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
    fallbackProvider: "cache",
  });
  admitMarketDataLeases({
    owner: "visible-watchlist",
    intent: "visible-live",
    requests: ["SPY", "NVDA"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
    fallbackProvider: "cache",
  });

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.warmup.state, "pending");
  assert.equal(snapshot.warmup.targetLineCount, 4);
  assert.equal(snapshot.warmup.activeBridgeLineCount, 2);
  assert.equal(snapshot.warmup.pendingLineCount, 2);
  assert.equal(snapshot.warmup.accountTargetLineCount, 2);
  assert.equal(snapshot.warmup.accountPendingLineCount, 1);
  assert.equal(snapshot.warmup.visibleTargetLineCount, 2);
  assert.equal(snapshot.warmup.visiblePendingLineCount, 1);
  assert.deepEqual(snapshot.warmup.accountPendingLineSample, ["equity:MSFT"]);
  assert.deepEqual(snapshot.warmup.visiblePendingLineSample, ["equity:NVDA"]);
  assert.equal(snapshot.accountMonitor.activeLineCount, 2);
  assert.equal(snapshot.accountMonitor.pendingLineCount, 1);
  assert.deepEqual(snapshot.accountMonitor.pendingLineSample, ["equity:MSFT"]);
});
