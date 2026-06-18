import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetMarketDataAdmissionForTests,
  admitMarketDataLeases,
  getMarketDataAdmissionDiagnostics,
  getMarketDataLeasesSnapshot,
  recordMarketDataAdmissionIbkrPressure,
  setMarketDataAdmissionRuntimeDefaults,
  type MarketDataIntent,
  type MarketDataLineRequest,
} from "./market-data-admission";

function optionRequests(symbol: string, count: number): MarketDataLineRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    assetClass: "option",
    symbol,
    providerContractId: `${symbol}-C-${index}`,
  }));
}

function greekOptionRequests(
  symbol: string,
  count: number,
): MarketDataLineRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    assetClass: "option",
    symbol,
    underlying: symbol,
    providerContractId: `${symbol}-GREEK-C-${index}`,
    requiresGreeks: true,
  }));
}

function equityRequests(prefix: string, count: number): MarketDataLineRequest[] {
  return Array.from({ length: count }, (_, index) => ({
    assetClass: "equity",
    symbol: `${prefix}${index}`,
  }));
}

function admittedLineCount(
  leases: ReturnType<typeof admitMarketDataLeases>["admitted"],
): number {
  return leases.reduce((total, lease) => total + lease.lineCost, 0);
}

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

test("flow scanner cap is derived from active protected demand", () => {
  __resetMarketDataAdmissionForTests();

  const diagnostics = getMarketDataAdmissionDiagnostics();
  const flowScannerUsage = diagnostics.poolUsage["flow-scanner"];
  const visibleUsage = diagnostics.poolUsage.visible;

  assert.equal(diagnostics.budget.visibleOptionQuoteLineReserve, 41);
  assert.equal(diagnostics.lineAllocation.tradeOptionsChainReserveLineCount, 0);
  assert.equal(diagnostics.lineAllocation.optionReserveLineCount, 0);
  assert.ok(flowScannerUsage);
  assert.ok(visibleUsage);
  assert.equal(flowScannerUsage.effectiveMaxLines, 200);
  assert.equal(visibleUsage.label, "Trade Options Chain");
});

test("flow scanner cap uses live Trade Options Chain demand", () => {
  __resetMarketDataAdmissionForTests();

  admitMarketDataLeases({
    owner: "trade-option-chain:SPY",
    intent: "visible-live",
    requests: optionRequests("SPY", 65),
    fallbackProvider: "none",
  });

  const diagnostics = getMarketDataAdmissionDiagnostics();
  const flowScannerUsage = diagnostics.poolUsage["flow-scanner"];

  assert.equal(diagnostics.lineAllocation.nonScannerOptionLineCount, 65);
  assert.equal(diagnostics.lineAllocation.tradeOptionsChainReserveLineCount, 65);
  assert.equal(diagnostics.lineAllocation.optionReserveLineCount, 65);
  assert.ok(flowScannerUsage);
  assert.equal(flowScannerUsage.effectiveMaxLines, 135);
});

const protectedLanePreemptionCases: Array<{
  name: string;
  owner: string;
  intent: MarketDataIntent;
  requests: MarketDataLineRequest[];
  activeLineField:
    | "accountMonitorLineCount"
    | "visibleLineCount"
    | "automationLineCount";
}> = [
  {
    name: "account monitor",
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: equityRequests("ACCT", 70),
    activeLineField: "accountMonitorLineCount",
  },
  {
    name: "Trade Options Chain",
    owner: "trade-option-chain:QQQ",
    intent: "visible-live",
    requests: optionRequests("QQQ", 70),
    activeLineField: "visibleLineCount",
  },
  {
    name: "automation",
    owner: "signal-options-position-mark:test:test",
    intent: "automation-live",
    requests: optionRequests("MSFT", 70),
    activeLineField: "automationLineCount",
  },
];

protectedLanePreemptionCases.forEach((scenario) => {
  test(`${scenario.name} demand preempts flow scanner leases`, () => {
    __resetMarketDataAdmissionForTests();

    const scanner = admitMarketDataLeases({
      owner: "flow-scanner:SPY",
      intent: "flow-scanner-live",
      requests: optionRequests("SPY", 200),
      fallbackProvider: "none",
    });
    assert.equal(scanner.rejected.length, 0);
    assert.equal(scanner.admitted.length, 200);

    const protectedDemand = admitMarketDataLeases({
      owner: scenario.owner,
      intent: scenario.intent,
      requests: scenario.requests,
      fallbackProvider: "none",
    });
    const diagnostics = getMarketDataAdmissionDiagnostics();
    const flowScannerUsage = diagnostics.poolUsage["flow-scanner"];

    assert.equal(protectedDemand.rejected.length, 0);
    assert.equal(protectedDemand.admitted.length, 70);
    assert.equal(protectedDemand.demoted.length, 70);
    assert.equal(diagnostics[scenario.activeLineField], 70);
    assert.equal(diagnostics.activeLineCount, 200);
    assert.equal(diagnostics.lineAllocation.optionReserveLineCount, 70);
    assert.ok(flowScannerUsage);
    assert.equal(flowScannerUsage.chargedLineCount, 130);
    assert.equal(flowScannerUsage.effectiveMaxLines, 130);
    assert.equal(flowScannerUsage.remainingLineCount, 0);
  });
});

const concreteDemandPreemptionCases: Array<{
  name: string;
  owner: string;
  intent: MarketDataIntent;
  requests: MarketDataLineRequest[];
  activeLineField:
    | "accountMonitorLineCount"
    | "visibleLineCount"
    | "automationLineCount"
    | "executionLineCount";
}> = [
  {
    name: "account monitor real equity positions",
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: equityRequests("ACCTEQ", 3),
    activeLineField: "accountMonitorLineCount",
  },
  {
    name: "account monitor real option positions with greek underlier",
    owner: "account-position-option-quotes:U24762790:ACCTOPT",
    intent: "account-monitor-live",
    requests: greekOptionRequests("ACCTOPT", 2),
    activeLineField: "accountMonitorLineCount",
  },
  {
    name: "account monitor shadow option positions with greek underlier",
    owner: "shadow-position:ledger:day-change",
    intent: "account-monitor-live",
    requests: greekOptionRequests("SHADOWOPT", 2),
    activeLineField: "accountMonitorLineCount",
  },
  {
    name: "account monitor bridge stream mixed positions",
    owner: "account-monitor:live:all",
    intent: "account-monitor-live",
    requests: [
      ...equityRequests("ACCTMON", 2),
      ...greekOptionRequests("ACCTMONOPT", 2),
    ],
    activeLineField: "accountMonitorLineCount",
  },
  {
    name: "automation algo option quote display with greek underlier",
    owner: "algo-option-quotes:3-contracts",
    intent: "automation-live",
    requests: greekOptionRequests("ALGOOPT", 3),
    activeLineField: "automationLineCount",
  },
  {
    name: "automation signal-options position mark with greek underlier",
    owner: "signal-options-position-mark:deployment:position",
    intent: "automation-live",
    requests: greekOptionRequests("MARKOPT", 1),
    activeLineField: "automationLineCount",
  },
  {
    name: "automation signal-options entry gate with greek underlier",
    owner: "signal-options-entry-gate:deployment:signal",
    intent: "automation-live",
    requests: greekOptionRequests("GATEOPT", 2),
    activeLineField: "automationLineCount",
  },
  {
    name: "automation signal-options entry with greek underlier",
    owner: "signal-options-entry:deployment:signal",
    intent: "automation-live",
    requests: greekOptionRequests("ENTRYOPT", 2),
    activeLineField: "automationLineCount",
  },
  {
    name: "execution demand in automation group",
    owner: "execution-quotes:order-preview",
    intent: "execution-live",
    requests: equityRequests("EXEC", 3),
    activeLineField: "executionLineCount",
  },
  {
    name: "Trade Options Chain snapshot with greek underlier",
    owner: "trade-option-chain:CHAINOPT",
    intent: "visible-live",
    requests: greekOptionRequests("CHAINOPT", 4),
    activeLineField: "visibleLineCount",
  },
  {
    name: "Trade Options Chain SSE with greek underlier",
    owner: "platform-option-quotes-sse:1",
    intent: "visible-live",
    requests: greekOptionRequests("SSEOPT", 4),
    activeLineField: "visibleLineCount",
  },
];

concreteDemandPreemptionCases.forEach((scenario) => {
  test(`${scenario.name} preempts saturated flow scanner demand`, () => {
    __resetMarketDataAdmissionForTests();

    const scanner = admitMarketDataLeases({
      owner: "flow-scanner:SPY",
      intent: "flow-scanner-live",
      requests: optionRequests("SPY", 200),
      fallbackProvider: "none",
    });
    assert.equal(scanner.rejected.length, 0);
    assert.equal(scanner.admitted.length, 200);

    const priorityDemand = admitMarketDataLeases({
      owner: scenario.owner,
      intent: scenario.intent,
      requests: scenario.requests,
      fallbackProvider: "none",
    });
    const diagnostics = getMarketDataAdmissionDiagnostics();
    const flowScannerUsage = diagnostics.poolUsage["flow-scanner"];
    const lineDemand = admittedLineCount(priorityDemand.admitted);

    assert.equal(priorityDemand.rejected.length, 0);
    assert.equal(priorityDemand.admitted.length, scenario.requests.length);
    assert.equal(priorityDemand.demoted.length, lineDemand);
    assert.equal(diagnostics[scenario.activeLineField], lineDemand);
    assert.equal(diagnostics.activeLineCount, 200);
    assert.equal(diagnostics.lineAllocation.protectedPriorityLineCount, lineDemand);
    assert.ok(flowScannerUsage);
    assert.equal(flowScannerUsage.chargedLineCount, 200 - lineDemand);
    assert.equal(flowScannerUsage.effectiveMaxLines, 200 - lineDemand);
    assert.equal(flowScannerUsage.remainingLineCount, 0);
  });
});

test("new Trade Options Chain demand grows by demoting scanner when protected lanes already exist", () => {
  __resetMarketDataAdmissionForTests();

  admitMarketDataLeases({
    owner: "account-position-option-quotes:U24762790:ACCTOPT",
    intent: "account-monitor-live",
    requests: greekOptionRequests("ACCTOPT", 2),
    fallbackProvider: "none",
  });
  admitMarketDataLeases({
    owner: "algo-option-quotes:1-contracts",
    intent: "automation-live",
    requests: greekOptionRequests("ALGOOPT", 1),
    fallbackProvider: "none",
  });
  admitMarketDataLeases({
    owner: "trade-option-chain:CHAINOPT",
    intent: "visible-live",
    requests: greekOptionRequests("CHAINOPT", 2),
    fallbackProvider: "none",
  });
  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: optionRequests("SPY", 200),
    fallbackProvider: "none",
  });
  const before = getMarketDataAdmissionDiagnostics();

  const additionalTradeDemand = admitMarketDataLeases({
    owner: "platform-option-quotes-sse:1",
    intent: "visible-live",
    requests: greekOptionRequests("SSEOPT", 3),
    fallbackProvider: "none",
  });
  const after = getMarketDataAdmissionDiagnostics();
  const additionalTradeLineCount = admittedLineCount(additionalTradeDemand.admitted);

  assert.equal(before.activeLineCount, 200);
  assert.equal(scanner.admitted.length, before.flowScannerChargedLineCount);
  assert.equal(
    scanner.rejected.length,
    before.lineAllocation.protectedPriorityLineCount,
  );
  assert.equal(additionalTradeDemand.rejected.length, 0);
  assert.equal(additionalTradeDemand.admitted.length, 3);
  assert.equal(additionalTradeDemand.demoted.length, additionalTradeLineCount);
  assert.equal(after.activeLineCount, 200);
  assert.equal(
    after.flowScannerChargedLineCount,
    before.flowScannerChargedLineCount - additionalTradeLineCount,
  );
  assert.equal(
    after.visibleLineCount,
    before.visibleLineCount + additionalTradeLineCount,
  );
  assert.equal(
    after.lineAllocation.protectedPriorityLineCount,
    before.lineAllocation.protectedPriorityLineCount + additionalTradeLineCount,
  );
});

test("account monitor demand preempts execution automation group lines", () => {
  __resetMarketDataAdmissionForTests();

  admitMarketDataLeases({
    owner: "execution-quotes:test",
    intent: "execution-live",
    requests: equityRequests("EXEC", 200),
    fallbackProvider: "none",
  });

  const account = admitMarketDataLeases({
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: equityRequests("ACCT", 10),
    fallbackProvider: "none",
  });
  const diagnostics = getMarketDataAdmissionDiagnostics();

  assert.equal(account.rejected.length, 0);
  assert.equal(account.admitted.length, 10);
  assert.equal(account.demoted.length, 10);
  assert.equal(diagnostics.accountMonitorLineCount, 10);
  assert.equal(diagnostics.executionLineCount, 190);
  assert.equal(diagnostics.activeLineCount, 200);
});

test("automation demand preempts Trade Options Chain lines", () => {
  __resetMarketDataAdmissionForTests();

  admitMarketDataLeases({
    owner: "trade-option-chain:QQQ",
    intent: "visible-live",
    requests: optionRequests("QQQ", 200),
    fallbackProvider: "none",
  });

  const automation = admitMarketDataLeases({
    owner: "signal-options-position-mark:test:test",
    intent: "automation-live",
    requests: optionRequests("MSFT", 10),
    fallbackProvider: "none",
  });
  const diagnostics = getMarketDataAdmissionDiagnostics();

  assert.equal(automation.rejected.length, 0);
  assert.equal(automation.admitted.length, 10);
  assert.equal(automation.demoted.length, 10);
  assert.equal(diagnostics.automationLineCount, 10);
  assert.equal(diagnostics.visibleLineCount, 190);
  assert.equal(diagnostics.activeLineCount, 200);
});

test("execution and automation share priority without preempting each other", () => {
  __resetMarketDataAdmissionForTests();

  admitMarketDataLeases({
    owner: "signal-options-position-mark:test:test",
    intent: "automation-live",
    requests: optionRequests("MSFT", 200),
    fallbackProvider: "none",
  });

  const execution = admitMarketDataLeases({
    owner: "execution-quotes:test",
    intent: "execution-live",
    requests: equityRequests("EXEC", 1),
    fallbackProvider: "none",
  });
  const diagnostics = getMarketDataAdmissionDiagnostics();

  assert.equal(execution.admitted.length, 0);
  assert.equal(execution.demoted.length, 0);
  assert.equal(execution.rejected.length, 1);
  assert.equal(execution.rejected[0]?.reason, "automation-cap");
  assert.equal(diagnostics.executionLineCount, 0);
  assert.equal(diagnostics.automationLineCount, 200);
  assert.equal(diagnostics.activeLineCount, 200);
});

test("IBKR pressure sheds half of charged flow scanner lines once", () => {
  __resetMarketDataAdmissionForTests();
  const observedAt = Date.now();
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 20,
    flowScannerConcurrency: 1,
  });

  admitMarketDataLeases({
    owner: "account-position-equity-quotes:U24762790",
    intent: "account-monitor-live",
    requests: [{ assetClass: "equity", symbol: "FCEL" }],
    fallbackProvider: "none",
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

  const demoted = recordMarketDataAdmissionIbkrPressure({
    state: "backpressure",
    reason: "Output exceeded limit (was: 100031)",
    source: "option-stream",
    observedAt,
  });
  const diagnostics = getMarketDataAdmissionDiagnostics();

  assert.equal(diagnostics.accountMonitorLineCount, 1);
  assert.equal(diagnostics.pressure.ibkrPressure?.policy, "scanner-shed-damping");
  assert.equal(diagnostics.pressure.ibkrPressure?.scannerLineCountBefore, 10);
  assert.equal(diagnostics.pressure.ibkrPressure?.scannerLineTarget, 5);
  assert.equal(diagnostics.pressure.ibkrPressure?.scannerLineCountAfter, 5);
  assert.equal(diagnostics.pressure.ibkrPressure?.demotedLeaseCount, 5);
  assert.equal(diagnostics.pressure.ibkrPressure?.dampingActive, true);
  assert.equal(diagnostics.pressure.scannerConfiguredLineCap, 20);
  assert.equal(diagnostics.pressure.scannerEffectiveLineCap, 5);
  assert.equal(diagnostics.pressure.scannerPressureLineCap, 5);
  assert.equal(diagnostics.pressure.scannerPressureDampingActive, true);
  assert.equal(diagnostics.pressure.scannerChargedLineCount, 5);
  assert.equal(diagnostics.poolUsageRanking[0]?.id, "flow-scanner");
  assert.equal(diagnostics.poolUsageRanking[0]?.recentIbkrPressureShed, true);
  assert.equal(demoted.length, 5);
});

test("IBKR pressure damps scanner refill without changing configured cap", () => {
  __resetMarketDataAdmissionForTests();
  const observedAt = Date.now();
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

  recordMarketDataAdmissionIbkrPressure({
    state: "backpressure",
    reason: "Output exceeded limit (was: 100031)",
    source: "option-stream",
    observedAt,
  });

  const refill = admitMarketDataLeases({
    owner: "flow-scanner:SPY:refill",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 5 }, (_, index) => ({
      assetClass: "option",
      symbol: "SPY",
      providerContractId: `SPY-REFILL-C-${index}`,
    })),
    fallbackProvider: "none",
  });
  const diagnostics = getMarketDataAdmissionDiagnostics();

  assert.equal(refill.rejected.length, 0);
  assert.equal(refill.admitted.length, 5);
  assert.equal(refill.demoted.length, 5);
  assert.equal(diagnostics.pressure.scannerConfiguredLineCap, 20);
  assert.equal(diagnostics.pressure.scannerEffectiveLineCap, 5);
  assert.equal(diagnostics.pressure.scannerPressureLineCap, 5);
  assert.equal(diagnostics.pressure.scannerPressureDampingActive, true);
  assert.equal(diagnostics.pressure.scannerChargedLineCount, 5);
});

test("IBKR pressure leaves configured flow scanner env overrides unchanged", () => {
  __resetMarketDataAdmissionForTests();
  const previous = process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES;
  process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES = "50";
  try {
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
    recordMarketDataAdmissionIbkrPressure({
      state: "backpressure",
      reason: "Output exceeded limit (was: 100031)",
      source: "option-stream",
      observedAt: Date.now(),
    });
    const diagnostics = getMarketDataAdmissionDiagnostics();

    assert.equal(diagnostics.pressure.scannerConfiguredLineCap, 50);
    assert.equal(diagnostics.pressure.scannerEffectiveLineCap, 5);
    assert.equal(diagnostics.pressure.scannerPressureLineCap, 5);
    assert.equal(diagnostics.pressure.scannerChargedLineCount, 5);
  } finally {
    if (previous === undefined) {
      delete process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES;
    } else {
      process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES = previous;
    }
  }
});

test("IBKR pressure damping expires and restores scanner capacity", () => {
  __resetMarketDataAdmissionForTests();
  const originalDateNow = Date.now;
  const previous = process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES;
  let now = new Date("2026-06-18T12:00:00.000Z").getTime();
  Date.now = () => now;
  process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES = "50";
  try {
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
    recordMarketDataAdmissionIbkrPressure({
      state: "backpressure",
      reason: "pacing violation",
      source: "option-stream",
      observedAt: now,
    });
    const active = getMarketDataAdmissionDiagnostics();

    assert.equal(active.pressure.scannerConfiguredLineCap, 50);
    assert.equal(active.pressure.scannerEffectiveLineCap, 5);
    assert.equal(active.pressure.scannerPressureLineCap, 5);
    assert.equal(active.pressure.scannerPressureDampingActive, true);
    assert.equal(active.pressure.ibkrPressure?.dampingActive, true);
    assert.equal(active.poolUsageRanking[0]?.id, "flow-scanner");
    assert.equal(active.poolUsageRanking[0]?.recentIbkrPressureShed, true);

    now += 60_001;
    const expired = getMarketDataAdmissionDiagnostics();

    assert.equal(expired.pressure.scannerConfiguredLineCap, 50);
    assert.equal(expired.pressure.scannerEffectiveLineCap, 50);
    assert.equal(expired.pressure.scannerPressureLineCap, null);
    assert.equal(expired.pressure.scannerPressureDampingActive, false);
    assert.equal(expired.pressure.ibkrPressure?.dampingActive, false);
    assert.equal(expired.poolUsageRanking[0]?.id, "flow-scanner");
    assert.equal(expired.poolUsageRanking[0]?.recentIbkrPressureShed, false);
  } finally {
    Date.now = originalDateNow;
    if (previous === undefined) {
      delete process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES;
    } else {
      process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES = previous;
    }
  }
});
