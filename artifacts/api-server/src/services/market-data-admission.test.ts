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
  "IBKR_MARKET_DATA_CONVENIENCE_LINES",
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

test("uses a 200-line IBKR budget and targets full line utilization by default", () => {
  setEnv({});

  const budget = getMarketDataAdmissionBudget();
  assert.equal(budget.maxLines, 200);
  assert.equal(budget.reserveLines, 0);
  assert.equal(budget.usableLines, 200);
  assert.equal(budget.targetFillLines, 200);
  assert.equal(budget.automationLineCap, 0);
  assert.equal(budget.accountMonitorLineCap, 0);
  assert.equal(budget.flowScannerLineCap, 200);
  assert.deepEqual(budget.poolLineCaps, {
    execution: 12,
    "account-monitor": 0,
    visible: 0,
    automation: 0,
    "flow-scanner": 200,
    convenience: 0,
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
    execution: 12,
    "account-monitor": 0,
    visible: 0,
    automation: 0,
    "flow-scanner": 190,
    convenience: 0,
  });
});

test("scanner fills the full idle budget and account demand reclaims it", () => {
  setEnv({});

  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:rotation",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 200 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `FLOW${index}`,
      underlying: "SPY",
    })),
  });
  assert.equal(scanner.admitted.length, 200);
  assert.equal(scanner.rejected.length, 0);
  assert.equal(getMarketDataAdmissionDiagnostics().activeLineCount, 200);

  const account = admitMarketDataLeases({
    owner: "account-monitor:paper:all",
    intent: "account-monitor-live",
    requests: Array.from({ length: 6 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `ACCT${index}`,
    })),
  });
  assert.equal(account.admitted.length, 6);
  assert.equal(account.rejected.length, 0);
  assert.equal(account.demoted.length, 6);

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 200);
  assert.equal(diagnostics.accountMonitor.coveredLineCount, 6);
  assert.equal(diagnostics.flowScannerLineCount, 194);
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

test("derives scanner headroom from runtime scanner line budget and concurrency", () => {
  setEnv({});
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 40,
    flowScannerConcurrency: 2,
  });

  const budget = getMarketDataAdmissionBudget();
  assert.deepEqual(budget.poolLineCaps, {
    execution: 12,
    "account-monitor": 0,
    visible: 0,
    automation: 0,
    "flow-scanner": 80,
    convenience: 0,
  });
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
  assert.equal(budget.poolLineCaps.visible, 0);
});

test("account monitor live lines expand dynamically under account demand", () => {
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

  assert.equal(result.admitted.length, 4);
  assert.equal(result.rejected.length, 0);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.accountMonitorLineCount, 4);
  assert.equal(diagnostics.accountMonitor.dynamic, true);
  assert.equal(diagnostics.accountMonitor.coveredLineCount, 4);
  assert.equal(diagnostics.accountMonitor.neededLineCount, 4);
  assert.equal(diagnostics.accountMonitor.deferredLineCount, 0);
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

test("automation live lines are dynamic below execution and account priority", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "100",
    IBKR_MARKET_DATA_RESERVE_LINES: "10",
    IBKR_MARKET_DATA_EXECUTION_LINES: "8",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "50",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "18",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "4",
  });

  const result = admitMarketDataLeases({
    owner: "automation-scan",
    intent: "automation-live",
    requests: Array.from({ length: 19 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `AUTO${index}`,
    })),
  });

  assert.equal(result.admitted.length, 19);
  assert.equal(result.rejected.length, 0);
  assert.equal(getMarketDataAdmissionDiagnostics().automationLineCount, 19);
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
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
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
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
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

test("signal option quote leases are classified and can reclaim background scanner lines", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "5",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "5",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
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
    intent: "account-monitor-live",
    requests: Array.from({ length: 3 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `SIG${index}`,
      underlying: "NVDA",
    })),
    fallbackProvider: "cache",
  });

  assert.equal(signal.admitted.length, 3);
  assert.equal(signal.demoted.length, 3);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.flowScannerLineCount, 2);
  assert.equal(diagnostics.accountMonitorLineCount, 3);
  assert.equal(diagnostics.signalOptions.activeLineCount, 0);
  assert.equal(
    diagnostics.ownerClasses.summaries["account-monitor"].recentCacheFallbackCount,
    3,
  );
  assert.equal(
    diagnostics.ownerClasses.summaries["flow-scanner"].activeLineCount,
    2,
  );
});

test("explicit owner release cleans stale websocket leases", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "10",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "1",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
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
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
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

test("shrinks scanner headroom when active visible demand borrows idle lines", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "20",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "10",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
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
  assert.equal(beforeScanner.pressure.state, "constrained");
  assert.equal(beforeScanner.pressure.scannerStaticLineCap, 10);
  assert.equal(beforeScanner.pressure.scannerEffectiveLineCap, 5);

  const result = admitMarketDataLeases({
    owner: "flow-scanner",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 10 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `OPT${index}`,
      underlying: "SPY",
    })),
  });

  assert.equal(result.admitted.length, 5);
  assert.equal(result.rejected.length, 5);
  assert.equal(result.rejected[0].reason, "pool-cap");
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.poolUsage["flow-scanner"].maxLines, 10);
  assert.equal(diagnostics.poolUsage["flow-scanner"].effectiveMaxLines, 5);
  assert.equal(diagnostics.pressure.state, "protected");
});

test("flow scanner leases can reclaim lower-priority convenience filler lines", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "20",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "convenience-live",
    requests: Array.from({ length: 5 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `CORE${index}`,
    })),
  });

  admitMarketDataLeases({
    owner: "watchlist-prewarm-filler",
    intent: "delayed-ok",
    requests: Array.from({ length: 15 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `FILL${index}`,
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
  assert.equal(result.demoted.length, 10);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 20);
  assert.equal(diagnostics.fillerLineCount, 5);
  assert.equal(diagnostics.flowScannerLineCount, 10);
  assert.equal(
    diagnostics.leases.filter((lease) => lease.owner === "watchlist-prewarm")
      .length,
    5,
  );
});

test("reports convenience leases as elastic slack instead of a hard cap violation", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "20",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "10",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "0",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
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
    owner: "watchlist-prewarm",
    intent: "convenience-live",
    requests: ["AAPL", "SPY", "QQQ"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });
  admitMarketDataLeases({
    owner: "watchlist-prewarm-filler",
    intent: "delayed-ok",
    requests: ["IWM", "DIA"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.lineAllocation.protectedLineCount, 0);
  assert.equal(diagnostics.lineAllocation.dynamicLineCount, 2);
  assert.equal(diagnostics.lineAllocation.elasticLineCount, 5);
  assert.equal(diagnostics.lineAllocation.sharedElasticLineCount, 1);
  assert.equal(diagnostics.lineAllocation.reclaimableElasticLineCount, 4);
  assert.equal(diagnostics.lineAllocation.reclaimableFillerLineCount, 2);
  assert.equal(diagnostics.poolUsage.convenience.maxLines, 0);
  assert.equal(diagnostics.poolUsage.convenience.elastic, true);
  assert.equal(diagnostics.poolUsage.convenience.effectiveMaxLines, 18);
  assert.equal(diagnostics.poolUsage.convenience.reclaimableLineCount, 4);
  assert.equal(diagnostics.poolUsage.convenience.remainingLineCount, 14);
});

test("active visible requests reclaim lines from scanner leases under pressure", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "5",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
    IBKR_MARKET_DATA_EXECUTION_LINES: "0",
    IBKR_MARKET_DATA_ACCOUNT_MONITOR_LINES: "0",
    IBKR_MARKET_DATA_VISIBLE_LINES: "0",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "0",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "5",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
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

  assert.equal(result.admitted.length, 3);
  assert.equal(result.demoted.length, 3);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.intentUsage["visible-live"], 3);
  assert.equal(diagnostics.intentUsage["flow-scanner-live"], 2);
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
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "0",
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
  assert.equal(result.rejected[0].reason, "budget");
  assert.equal(getMarketDataAdmissionDiagnostics().activeLineCount, 2);
});
