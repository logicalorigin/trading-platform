import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetMarketDataAdmissionForTests,
  admitMarketDataLeases,
  getMarketDataLeasesSnapshot,
  getMarketDataAdmissionBudget,
  getMarketDataAdmissionDiagnostics,
  setMarketDataAdmissionBridgeLineBudget,
  setMarketDataAdmissionRuntimeDefaults,
  releaseMarketDataLeases,
  expireMarketDataLeases,
} from "./market-data-admission";

const ENV_KEYS = [
  "IBKR_MARKET_DATA_APP_MAX_LINES",
  "IBKR_MARKET_DATA_RESERVE_LINES",
  "IBKR_MARKET_DATA_TARGET_FILL_LINES",
  "IBKR_MARKET_DATA_EXECUTION_LINES",
  "IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES",
  "IBKR_MARKET_DATA_VISIBLE_LINES",
  "IBKR_MARKET_DATA_AUTOMATION_LINES",
  "IBKR_MARKET_DATA_FLOW_SCANNER_LINES",
  "OPTIONS_FLOW_SCANNER_LINE_BUDGET",
  "OPTIONS_FLOW_SCANNER_CONCURRENCY",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function setEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
): void {
  ENV_KEYS.forEach((key) => {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  });
}

afterEach(() => {
  __resetMarketDataAdmissionForTests();
  setEnv(originalEnv);
});

test("uses a 200-line IBKR budget with visible capacity plus flow line pools by default", () => {
  setEnv({});

  const budget = getMarketDataAdmissionBudget();
  assert.equal(budget.maxLines, 200);
  assert.equal(budget.reserveLines, 0);
  assert.equal(budget.usableLines, 200);
  assert.equal(budget.targetFillLines, 200);
  assert.equal(budget.automationExecutionLineCap, 200);
  assert.equal(budget.executionLineCap, 200);
  assert.equal(budget.automationLineCap, 200);
  assert.equal(budget.accountMonitorLineCap, 200);
  assert.equal(budget.visibleLineCap, 200);
  assert.equal(budget.visibleOptionChainStrikesAroundMoney, 5);
  assert.equal(budget.visibleOptionChainDefaultLineCount, 23);
  assert.equal(budget.visibleOptionQuoteContractLineCap, 40);
  assert.equal(budget.visibleOptionQuoteLineReserve, 41);
  assert.equal(budget.flowScannerLineCap, 200);
  assert.deepEqual(budget.poolLineCaps, {
    execution: 200,
    "account-monitor": 200,
    visible: 200,
    automation: 200,
    "flow-scanner": 200,
  });
});

test("uses the bridge-reported line budget when it is lower than the app cap", () => {
  setEnv({});
  setMarketDataAdmissionBridgeLineBudget(190, Date.now());

  const budget = getMarketDataAdmissionBudget();
  assert.equal(budget.configuredMaxLines, 200);
  assert.equal(budget.maxLines, 190);
  assert.equal(budget.bridgeLineBudget, 190);
  assert.equal(budget.budgetSource, "bridge-diagnostics");
  assert.equal(budget.usableLines, 190);
  assert.equal(budget.targetFillLines, 190);
  assert.deepEqual(budget.poolLineCaps, {
    execution: 190,
    "account-monitor": 190,
    visible: 190,
    automation: 190,
    "flow-scanner": 190,
  });
});

test("scanner fills the bridge budget by default", () => {
  setEnv({});

  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:rotation",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 205 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `FLOW${index}`,
      underlying: "SPY",
    })),
  });
  assert.equal(scanner.admitted.length, 200);
  assert.equal(scanner.rejected.length, 5);

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 200);
  assert.equal(diagnostics.flowScannerLineCount, 200);
});

test("market data diagnostics do not expire ttl leases as a side effect", async () => {
  admitMarketDataLeases({
    owner: "flow-scanner:ttl",
    intent: "flow-scanner-live",
    ttlMs: 1,
    requests: [
      {
        assetClass: "option",
        providerContractId: "TTL1",
        underlying: "SPY",
      },
    ],
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 0);
  assert.equal(diagnostics.flowScannerLineCount, 0);
  assert.equal(diagnostics.leaseCount, 0);
  assert.equal(
    diagnostics.ownerClasses.summaries["flow-scanner"].recentExpiredCount,
    0,
  );

  expireMarketDataLeases();

  assert.equal(
    getMarketDataAdmissionDiagnostics().ownerClasses.summaries["flow-scanner"]
      .recentExpiredCount,
    1,
  );
});

test("default visible option reserve leaves the remaining budget for scanner work", () => {
  setEnv({});

  const visible = admitMarketDataLeases({
    owner: "trade-option-visible:SPY",
    intent: "visible-live",
    requests: Array.from({ length: 22 }, (_, index) => ({
      assetClass: "option" as const,
      symbol: "SPY",
      providerContractId: `CHAIN${index}`,
      requiresGreeks: true,
    })),
  });
  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:rotation",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 160 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `FLOW${index}`,
      underlying: "SPY",
    })),
  });

  assert.equal(visible.admitted.length, 22);
  assert.equal(visible.rejected.length, 0);
  assert.equal(scanner.admitted.length, 160);
  assert.equal(scanner.rejected.length, 0);

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 183);
  assert.equal(diagnostics.visibleLineCount, 23);
  assert.equal(diagnostics.flowScannerLineCount, 160);
  assert.equal(diagnostics.usableRemainingLineCount, 17);
});

test("visible option quotes can reclaim scanner lines when the UI needs its full visible window", () => {
  setEnv({});

  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:rotation",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 160 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `FLOW${index}`,
      underlying: "SPY",
    })),
  });
  const visible = admitMarketDataLeases({
    owner: "trade-option-visible:SPY",
    intent: "visible-live",
    requests: Array.from({ length: 40 }, (_, index) => ({
      assetClass: "option" as const,
      symbol: "SPY",
      providerContractId: `CHAIN${index}`,
      requiresGreeks: true,
    })),
  });

  assert.equal(scanner.admitted.length, 160);
  assert.equal(scanner.rejected.length, 0);
  assert.equal(visible.admitted.length, 40);
  assert.equal(visible.rejected.length, 0);
  assert.equal(visible.demoted.length, 1);

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 200);
  assert.equal(diagnostics.visibleLineCount, 41);
  assert.equal(diagnostics.flowScannerLineCount, 159);
  assert.equal(diagnostics.usableRemainingLineCount, 0);
});

test("retired watchlist line env is ignored by operator groups", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "100",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
  });

  const visible = admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "visible-live",
    requests: ["AAPL", "MSFT", "NVDA", "TSLA"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  assert.equal(visible.admitted.length, 4);
  assert.equal(visible.rejected.length, 0);
  const explicitObsoletePool = admitMarketDataLeases({
    owner: "legacy-explicit-watchlist",
    intent: "visible-live",
    pool: "watchlist" as never,
    requests: [{ assetClass: "equity" as const, symbol: "IWM" }],
  });
  assert.equal(explicitObsoletePool.admitted.length, 1);
  assert.equal(explicitObsoletePool.admitted[0]?.pool, "visible");
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal("watchlistLineCount" in diagnostics, false);
  assert.equal("watchlist" in diagnostics.poolUsage, false);
  assert.equal(
    diagnostics.activeDataLineGroups.some((group) => String(group?.id) === "watchlist"),
    false,
  );
  assert.equal(diagnostics.intentUsage["visible-live"], 5);
});

test("allows target fill lines below the active budget and clamps them to the budget", () => {
  setEnv({
    IBKR_MARKET_DATA_TARGET_FILL_LINES: "175",
  });

  let budget = getMarketDataAdmissionBudget();
  assert.equal(budget.maxLines, 200);
  assert.equal(budget.targetFillLines, 175);

  setEnv({
    IBKR_MARKET_DATA_TARGET_FILL_LINES: "250",
  });
  setMarketDataAdmissionBridgeLineBudget(190, Date.now());

  budget = getMarketDataAdmissionBudget();
  assert.equal(budget.maxLines, 190);
  assert.equal(budget.targetFillLines, 190);
});

test("runtime scanner line budget caps the scanner working set", () => {
  setEnv({});
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 40,
    flowScannerConcurrency: 2,
  });

  const budget = getMarketDataAdmissionBudget();
  assert.deepEqual(budget.poolLineCaps, {
    execution: 200,
    "account-monitor": 200,
    visible: 200,
    automation: 200,
    "flow-scanner": 40,
  });
});

test("runtime scanner cap shrink demotes scanner live quote leases", () => {
  setEnv({});
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 40,
    flowScannerConcurrency: 2,
  });

  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:rotation",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 80 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `FLOW${index}`,
      underlying: "SPY",
    })),
  });
  assert.equal(scanner.admitted.length, 40);
  assert.equal(scanner.rejected.length, 40);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 40);

  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 20,
    flowScannerConcurrency: 2,
  });

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.budget.flowScannerLineCap, 20);
  assert.equal(diagnostics.poolUsage["flow-scanner"]?.effectiveMaxLines, 20);
  assert.equal(diagnostics.flowScannerLineCount, 20);
  assert.equal(diagnostics.flowScannerChargedLineCount, 20);
  assert.equal(diagnostics.activeLineCount, 20);
  assert.equal(getMarketDataLeasesSnapshot().length, 20);
});

test("keeps explicit admission env caps ahead of runtime scanner defaults", () => {
  setEnv({
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "20",
  });
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 55,
    flowScannerConcurrency: 10,
  });

  const budget = getMarketDataAdmissionBudget();
  assert.equal(budget.flowScannerLineCap, 20);
  assert.equal(budget.poolLineCaps.visible, 200);
});

test("account monitor live lines respect their reserved cap", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "100",
    IBKR_MARKET_DATA_RESERVE_LINES: "10",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "3",
  });

  const result = admitMarketDataLeases({
    owner: "account-monitor:paper:all",
    intent: "account-monitor-live",
    requests: ["AAA", "BBB", "CCC", "DDD"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  assert.equal(result.admitted.length, 3);
  assert.equal(result.rejected.length, 1);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.accountMonitorLineCount, 3);
  assert.equal(diagnostics.accountMonitor.dynamic, false);
  assert.equal(diagnostics.accountMonitor.coveredLineCount, 3);
  assert.equal(diagnostics.accountMonitor.neededLineCount, 4);
  assert.equal(diagnostics.accountMonitor.deferredLineCount, 1);
});

test("counts option greeks as option plus shared underlying line", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "100",
    IBKR_MARKET_DATA_RESERVE_LINES: "10",
  });

  const result = admitMarketDataLeases({
    owner: "visible-chain",
    intent: "visible-live",
    requests: [
      { assetClass: "equity", symbol: "AAPL" },
      {
        assetClass: "option",
        providerContractId: "1001",
        underlying: "AAPL",
        requiresGreeks: true,
      },
      {
        assetClass: "option",
        providerContractId: "1002",
        underlying: "AAPL",
        requiresGreeks: true,
      },
    ],
  });

  assert.equal(result.admitted.length, 3);
  assert.equal(result.rejected.length, 0);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 3);
  assert.equal(diagnostics.activeEquityLineCount, 1);
  assert.equal(diagnostics.activeOptionLineCount, 2);
});

test("automation live lines share the Algo & Execution bundle cap", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "100",
    IBKR_MARKET_DATA_RESERVE_LINES: "10",
    IBKR_MARKET_DATA_EXECUTION_LINES: "8",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "50",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "18",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
  });

  const result = admitMarketDataLeases({
    owner: "automation-scan",
    intent: "automation-live",
    requests: Array.from({ length: 19 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `AUTO${index}`,
    })),
  });

  assert.equal(result.admitted.length, 18);
  assert.equal(result.rejected.length, 1);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.automationLineCount, 18);
  assert.equal(diagnostics.automationExecutionLineCount, 18);
  assert.equal(diagnostics.automationExecutionRemainingLineCount, 0);
});

test("execution can reclaim automation lines inside the Algo & Execution bundle", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "4",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "4",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "automation-scan",
    intent: "automation-live",
    requests: ["AUTO1", "AUTO2", "AUTO3", "AUTO4"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const execution = admitMarketDataLeases({
    owner: "order-ticket",
    intent: "execution-live",
    requests: ["EXEC1", "EXEC2"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  assert.equal(execution.admitted.length, 2);
  assert.equal(execution.demoted.length, 2);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.executionLineCount, 2);
  assert.equal(diagnostics.automationLineCount, 2);
  assert.equal(diagnostics.automationExecutionLineCount, 4);
});

test("automation cannot reclaim execution lines inside the Algo & Execution bundle", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "4",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "4",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "order-ticket",
    intent: "execution-live",
    requests: ["EXEC1", "EXEC2", "EXEC3", "EXEC4"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const automation = admitMarketDataLeases({
    owner: "automation-scan",
    intent: "automation-live",
    requests: [{ assetClass: "equity", symbol: "AUTO1" }],
  });

  assert.equal(automation.admitted.length, 0);
  assert.equal(automation.demoted.length, 0);
  assert.equal(automation.rejected.length, 1);
  assert.equal(automation.rejected[0].reason, "automation-cap");
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.executionLineCount, 4);
  assert.equal(diagnostics.automationLineCount, 0);
  assert.equal(diagnostics.automationExecutionLineCount, 4);
});

test("signal option quote leases preempt lower-priority automation lines inside the Algo & Execution bundle", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "6",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "3",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "3",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "automation-scan",
    intent: "automation-live",
    requests: ["AUTO1", "AUTO2", "AUTO3"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const signal = admitMarketDataLeases({
    owner: "signal-options-position-mark:deploy-1:position-1",
    intent: "automation-live",
    requests: [{ assetClass: "equity" as const, symbol: "SIG1" }],
    fallbackProvider: "cache",
  });

  assert.equal(signal.admitted.length, 1);
  assert.equal(signal.rejected.length, 0);
  assert.equal(signal.demoted.length, 1);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.automationLineCount, 3);
  assert.equal(diagnostics.signalOptions.activeLineCount, 1);
  assert.equal(diagnostics.ownerClasses.summaries.automation.activeLineCount, 2);
});

test("signal options preview quote leases classify with signal option owners", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "4",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "4",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "0",
  });

  const signal = admitMarketDataLeases({
    owner: "signal-options-preview:deploy-1:NVDA",
    intent: "automation-live",
    requests: [{ assetClass: "option" as const, providerContractId: "SIG1", underlying: "NVDA" }],
    fallbackProvider: "cache",
  });

  assert.equal(signal.admitted.length, 1);
  assert.equal(signal.rejected.length, 0);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.signalOptions.activeLineCount, 1);
  assert.equal(diagnostics.ownerClasses.summaries["signal-options"].activeLineCount, 1);
});

test("enforces the flow scanner live-line cap", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "100",
    IBKR_MARKET_DATA_RESERVE_LINES: "10",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
  });

  const result = admitMarketDataLeases({
    owner: "flow-scanner",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 11 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `OPT${index}`,
      underlying: "SPY",
    })),
  });

  assert.equal(result.admitted.length, 10);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "pool-cap");
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 10);
});

test("same-owner refresh revalidates strict pool caps instead of preserving over-cap leases", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "20",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "5",
  });
  const requests = Array.from({ length: 5 }, (_, index) => ({
    assetClass: "option" as const,
    providerContractId: `OPT${index}`,
    underlying: "SPY",
  }));

  assert.equal(
    admitMarketDataLeases({
      owner: "flow-scanner:SPY",
      intent: "flow-scanner-live",
      requests,
    }).admitted.length,
    5,
  );

  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "20",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "3",
  });

  const refreshed = admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests,
  });

  assert.equal(refreshed.admitted.length, 3);
  assert.equal(refreshed.rejected.length, 2);
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 3);
});

test("flow scanner rotates older same-priority scanner owners when its pool is full", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "3",
  });

  admitMarketDataLeases({
    owner: "flow-scanner:AAA",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 3 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `AAA${index}`,
      underlying: "AAA",
    })),
  });

  const rotated = admitMarketDataLeases({
    owner: "flow-scanner:BBB",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 2 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `BBB${index}`,
      underlying: "BBB",
    })),
  });

  assert.equal(rotated.admitted.length, 2);
  assert.equal(rotated.demoted.length, 2);
  assert.equal(rotated.rejected.length, 0);

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.flowScannerLineCount, 3);
  assert.equal(diagnostics.flowScannerActivity.recentRotatedCount, 2);
  assert.deepEqual(diagnostics.flowScannerActivity.recentRotatedOwnerSample, [
    "flow-scanner:AAA",
  ]);
  assert.equal(
    getMarketDataLeasesSnapshot().filter(
      (lease) => lease.owner === "flow-scanner:BBB",
    ).length,
    2,
  );
});

test("flow scanner does not reclaim visible lines when active demand leaves no scanner headroom", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "2",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "2",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "2",
  });

  admitMarketDataLeases({
    owner: "visible-chart",
    intent: "visible-live",
    requests: ["VIS1", "VIS2"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:AAA",
    intent: "flow-scanner-live",
    requests: [
      {
        assetClass: "option",
        providerContractId: "AAA0",
        underlying: "AAA",
      },
    ],
  });

  assert.equal(scanner.admitted.length, 0);
  assert.equal(scanner.rejected.length, 1);
  assert.equal(scanner.rejected[0].reason, "pool-cap");

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.intentUsage["visible-live"], 2);
  assert.equal(diagnostics.flowScannerLineCount, 0);
});

test("protected demand shrinks scanner headroom below the global budget", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "200",
    IBKR_MARKET_DATA_TARGET_FILL_LINES: "80",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "80",
  });

  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:rotation",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 80 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `FLOW${index}`,
      underlying: "SPY",
    })),
  });
  assert.equal(scanner.admitted.length, 80);

  const visible = admitMarketDataLeases({
    owner: "trade-option-visible:SPY",
    intent: "visible-live",
    requests: Array.from({ length: 30 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `VISIBLE${index}`,
      underlying: "SPY",
    })),
  });

  assert.equal(visible.admitted.length, 30);
  assert.equal(visible.demoted.length, 30);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 80);
  assert.equal(diagnostics.visibleLineCount, 30);
  assert.equal(diagnostics.flowScannerChargedLineCount, 50);
  assert.equal(diagnostics.poolUsage["flow-scanner"]?.effectiveMaxLines, 50);
});

test("shared option demand is counted once and charged to the highest-priority owner", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_TARGET_FILL_LINES: "10",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "5",
  });

  admitMarketDataLeases({
    owner: "trade-option-visible:SPY",
    intent: "visible-live",
    requests: [
      {
        assetClass: "option" as const,
        providerContractId: "SHARED1",
        underlying: "SPY",
      },
    ],
  });
  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: [
      {
        assetClass: "option" as const,
        providerContractId: "SHARED1",
        underlying: "SPY",
      },
    ],
  });

  assert.equal(scanner.admitted.length, 1);
  assert.equal(scanner.admitted[0]?.lineCost, 0);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 1);
  assert.equal(diagnostics.flowScannerLineCount, 1);
  assert.equal(diagnostics.flowScannerChargedLineCount, 0);
  assert.equal(diagnostics.lineOwnership.duplicateLineCount, 1);
  assert.equal(
    diagnostics.lineOwnership.duplicateLines[0]?.chargedOwnerClass,
    "visible",
  );
  assert.equal(
    diagnostics.lineOwnership.duplicateLines[0]?.sharedWithScanner,
    true,
  );
});

test("signal option quote leases stay in the Algo & Execution bundle and reclaim lower-priority scanner lines", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "5",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "3",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "3",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "5",
  });

  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 5 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `BG${index}`,
      underlying: "SPY",
    })),
  });

  const signal = admitMarketDataLeases({
    owner: "signal-options-position-mark:deploy-1:position-1",
    intent: "automation-live",
    requests: Array.from({ length: 3 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `SIG${index}`,
      underlying: "NVDA",
    })),
    fallbackProvider: "cache",
  });

  assert.equal(signal.admitted.length, 3);
  assert.equal(signal.rejected.length, 0);
  assert.equal(signal.demoted.length, 3);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.flowScannerLineCount, 2);
  assert.equal(diagnostics.accountMonitorLineCount, 0);
  assert.equal(diagnostics.automationLineCount, 3);
  assert.equal(diagnostics.signalOptions.activeLineCount, 3);
  assert.equal(
    diagnostics.ownerClasses.summaries["signal-options"].recentCacheFallbackCount,
    3,
  );
  assert.equal(
    diagnostics.ownerClasses.summaries["flow-scanner"].activeLineCount,
    2,
  );
});

test("visible requests do not reclaim signal option maintenance lines", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "2",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "1",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "2",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "signal-options-position-mark:deploy-1:position-1",
    intent: "automation-live",
    requests: ["SIG1", "SIG2"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
    fallbackProvider: "cache",
  });

  const visible = admitMarketDataLeases({
    owner: "visible-chart",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "VIS1" }],
  });

  assert.equal(visible.admitted.length, 0);
  assert.equal(visible.demoted.length, 0);
  assert.equal(visible.rejected.length, 1);

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.intentUsage["visible-live"], 0);
  assert.equal(diagnostics.signalOptions.activeLineCount, 2);
  assert.equal(diagnostics.accountMonitorLineCount, 0);
});

test("explicit owner release cleans stale websocket leases", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "1",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "1",
  });

  admitMarketDataLeases({
    owner: "bridge-option-quote-stream:1",
    intent: "visible-live",
    requests: [
      {
        assetClass: "option" as const,
        providerContractId: "STREAMOPT1",
        underlying: "SPY",
      },
    ],
  });
  assert.equal(getMarketDataAdmissionDiagnostics().activeLineCount, 1);

  releaseMarketDataLeases("bridge-option-quote-stream:1", "unsubscribe");

  assert.equal(getMarketDataAdmissionDiagnostics().activeLineCount, 0);
});

test("retired shadow equity forward owners are surfaced as allocation warnings", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "1",
  });

  admitMarketDataLeases({
    owner: "shadow-equity-forward:test",
    intent: "flow-scanner-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
  });

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.ownerClasses.retiredOwnerCount, 1);
  assert.equal(
    diagnostics.ownerClasses.summaries["retired-shadow-equity-forward"]
      .activeLineCount,
    1,
  );
  assert.equal(diagnostics.ownerClasses.warnings[0]?.code, "retired-owner-active");
});

test("keeps scanner headroom fixed when visible demand reaches its own cap", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "20",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "10",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
  });

  admitMarketDataLeases({
    owner: "active-chart-grid",
    intent: "visible-live",
    requests: Array.from({ length: 15 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `VIS${index}`,
    })),
  });

  const beforeScanner = getMarketDataAdmissionDiagnostics();
  assert.equal(beforeScanner.visibleLineCount, 10);
  assert.equal(beforeScanner.pressure.state, "normal");
  assert.equal(beforeScanner.pressure.scannerStaticLineCap, 10);
  assert.equal(beforeScanner.pressure.scannerEffectiveLineCap, 10);
  assert.equal(beforeScanner.flowScannerRemainingLineCount, 10);

  const result = admitMarketDataLeases({
    owner: "flow-scanner",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 10 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `OPT${index}`,
      underlying: "SPY",
    })),
  });

  assert.equal(result.admitted.length, 10);
  assert.equal(result.rejected.length, 0);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.poolUsage["flow-scanner"]?.maxLines, 10);
  assert.equal(diagnostics.poolUsage["flow-scanner"]?.effectiveMaxLines, 10);
  assert.equal(diagnostics.flowScannerRemainingLineCount, 0);
  assert.equal(diagnostics.pressure.state, "protected");
});

test("line pressure keeps half usage normal and escalates near exhaustion", () => {
  const pressureForActiveLineCount = (count: number) => {
    __resetMarketDataAdmissionForTests();
    setEnv({
      IBKR_MARKET_DATA_APP_MAX_LINES: "200",
      IBKR_MARKET_DATA_RESERVE_LINES: "0",
      IBKR_MARKET_DATA_EXECUTION_LINES: "0",
      IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
      IBKR_MARKET_DATA_VISIBLE_LINES: "200",
      IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
      IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "0",
    });
    admitMarketDataLeases({
      owner: "line-pressure-test",
      intent: "visible-live",
      requests: Array.from({ length: count }, (_, index) => ({
        assetClass: "equity" as const,
        symbol: `LP${index}`,
      })),
    });
    return getMarketDataAdmissionDiagnostics().pressure;
  };

  const half = pressureForActiveLineCount(100);
  assert.equal(half.utilizationPercent, 50);
  assert.equal(half.utilizationLevel, "normal");
  assert.equal(half.state, "normal");

  const watch = pressureForActiveLineCount(140);
  assert.equal(watch.utilizationPercent, 70);
  assert.equal(watch.utilizationLevel, "watch");
  assert.equal(watch.state, "normal");

  const constrained = pressureForActiveLineCount(176);
  assert.equal(constrained.utilizationPercent, 88);
  assert.equal(constrained.utilizationLevel, "constrained");
  assert.equal(constrained.state, "constrained");

  const protectedPressure = pressureForActiveLineCount(190);
  assert.equal(protectedPressure.utilizationPercent, 95);
  assert.equal(protectedPressure.utilizationLevel, "protected");
  assert.equal(protectedPressure.state, "protected");
});

test("flow scanner leases use their pool while preserving visible prewarm lines", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "20",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "10",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
  });

  admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "visible-live",
    requests: Array.from({ length: 10 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `CORE${index}`,
    })),
  });

  const result = admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 10 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `SPYOPT${index}`,
      underlying: "SPY",
    })),
  });

  assert.equal(result.admitted.length, 10);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.demoted.length, 0);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 20);
  assert.equal(diagnostics.visibleLineCount, 10);
  assert.equal("watchlistLineCount" in diagnostics, false);
  assert.equal("fillerLineCount" in diagnostics, false);
  assert.equal(diagnostics.flowScannerLineCount, 10);
  assert.equal(diagnostics.poolUsage.visible?.activeLineCount, 10);
  assert.equal(
    diagnostics.leases.filter((lease) => lease.owner === "watchlist-prewarm")
      .length,
    10,
  );
});

test("maps low-priority background quote intents into visible operator groups", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "20",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "10",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "positions",
    intent: "visible-live",
    requests: ["AAPL", "MSFT"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });
  admitMarketDataLeases({
    owner: "background-history",
    intent: "historical",
    pool: "convenience" as never,
    requests: ["AAPL", "SPY", "QQQ"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });
  admitMarketDataLeases({
    owner: "background-warmup",
    intent: "delayed-ok",
    requests: ["IWM", "DIA"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.lineAllocation.protectedLineCount, 0);
  assert.equal(diagnostics.lineAllocation.dynamicLineCount, 6);
  assert.equal(diagnostics.visibleLineCount, 6);
  assert.equal(diagnostics.lineAllocation.activeLineCount, 6);
  assert.equal("elasticLineCount" in diagnostics.lineAllocation, false);
  assert.equal("convenience" in diagnostics.poolUsage, false);
  assert.equal(
    diagnostics.activeDataLineGroups.some((group) => String(group?.id) === "convenience"),
    false,
  );
});

test("active visible requests do not reclaim lines from scanner leases under pressure", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "5",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "5",
  });

  admitMarketDataLeases({
    owner: "flow-scanner",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 5 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `OPT${index}`,
      underlying: "SPY",
    })),
  });

  const result = admitMarketDataLeases({
    owner: "active-chart",
    intent: "visible-live",
    requests: ["AAA", "BBB", "CCC"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  assert.equal(result.admitted.length, 0);
  assert.equal(result.demoted.length, 0);
  assert.equal(result.rejected.length, 3);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.intentUsage["visible-live"], 0);
  assert.equal(diagnostics.intentUsage["flow-scanner-live"], 5);
});

test("higher-priority execution requests demote lower-priority convenience leases", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "3",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "watchlist",
    intent: "delayed-ok",
    requests: ["AAA", "BBB", "CCC"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const result = admitMarketDataLeases({
    owner: "order-ticket",
    intent: "execution-live",
    requests: ["DDD", "EEE"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  assert.equal(result.admitted.length, 2);
  assert.equal(result.demoted.length, 2);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 3);
  assert.equal(diagnostics.intentUsage["execution-live"], 2);
  assert.equal(diagnostics.intentUsage["delayed-ok"], 1);
});

test("account monitor requests demote visible requests but not execution requests", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "4",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "2",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "2",
    IBKR_MARKET_DATA_VISIBLE_LINES: "2",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "order-ticket",
    intent: "execution-live",
    requests: ["EX1", "EX2"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });
  admitMarketDataLeases({
    owner: "visible-watchlist",
    intent: "visible-live",
    requests: ["VIS1", "VIS2"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const result = admitMarketDataLeases({
    owner: "account-monitor:paper:all",
    intent: "account-monitor-live",
    requests: ["MON1", "MON2"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  assert.equal(result.admitted.length, 2);
  assert.equal(result.demoted.length, 2);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.intentUsage["execution-live"], 2);
  assert.equal(diagnostics.intentUsage["account-monitor-live"], 2);
  assert.equal(diagnostics.intentUsage["visible-live"], 0);
});

test("returns a lease snapshot for live bridge warm-up without exposing mutable state", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "visible-watchlist",
    intent: "visible-live",
    requests: ["SPY", "NVDA"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const snapshot = getMarketDataLeasesSnapshot();

  assert.equal(snapshot.length, 2);
  assert.deepEqual(
    snapshot.map((lease) => lease.lineIds[0]).sort(),
    ["equity:NVDA", "equity:SPY"],
  );
  snapshot[0]?.lineIds.push("equity:BAD");
  snapshot.length = 0;
  assert.equal(getMarketDataLeasesSnapshot().length, 2);
  assert.equal(
    getMarketDataLeasesSnapshot().some((lease) =>
      lease.lineIds.includes("equity:BAD"),
    ),
    false,
  );
});

test("rejects same-priority requests when the live-line budget is full", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "2",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "visible-a",
    intent: "visible-live",
    requests: ["AAA", "BBB"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const result = admitMarketDataLeases({
    owner: "visible-b",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "CCC" }],
  });

  assert.equal(result.admitted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "pool-cap");
  assert.equal(getMarketDataAdmissionDiagnostics().activeLineCount, 2);
});

test("watchlist prewarm priority offsets preserve source symbols before expansion lines", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "5",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "5",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "2",
  });

  admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "visible-live",
    requests: [
      { assetClass: "equity", symbol: "AAA", priorityOffset: 1 },
      { assetClass: "equity", symbol: "BBB", priorityOffset: 1 },
      { assetClass: "equity", symbol: "CCC", priorityOffset: 1 },
      { assetClass: "equity", symbol: "FLOW1", priorityOffset: -1 },
      { assetClass: "equity", symbol: "FLOW2", priorityOffset: -1 },
    ],
    fallbackProvider: "cache",
  });

  admitMarketDataLeases({
    owner: "account-monitor",
    intent: "account-monitor-live",
    requests: [
      { assetClass: "equity", symbol: "POS1" },
      { assetClass: "equity", symbol: "POS2" },
    ],
  });

  const symbols = getMarketDataLeasesSnapshot()
    .map((lease) => lease.symbol)
    .filter(Boolean)
    .sort();

  assert.deepEqual(symbols, ["AAA", "BBB", "CCC", "POS1", "POS2"]);
});

test("diagnostics separate routine equity lines from option underlier support", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "10",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
  });

  admitMarketDataLeases({
    owner: "visible-stock",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "SPY" }],
  });
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: [
      {
        assetClass: "option",
        symbol: "SPY",
        underlying: "SPY",
        providerContractId: "SPY-CALL-1",
        requiresGreeks: true,
      },
    ],
  });

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeEquityLineCount, 1);
  assert.equal(diagnostics.routineEquityLineCount, 1);
  assert.equal(diagnostics.optionSupportEquityLineCount, 1);

  const optionLease = getMarketDataLeasesSnapshot().find(
    (lease) => lease.providerContractId === "SPY-CALL-1",
  );
  assert.equal(optionLease?.lineRoles["option:SPY-CALL-1"], "option-contract");
  assert.equal(
    optionLease?.lineRoles["equity:SPY"],
    "option-underlier-support",
  );
});
