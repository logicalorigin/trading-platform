import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetMarketDataAdmissionForTests,
  admitMarketDataLeases,
  getMarketDataAdmissionDiagnostics,
  getMarketDataLeasesSnapshot,
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

test("retired watchlist owner names use provider-neutral intent classification", () => {
  __resetMarketDataAdmissionForTests();

  const result = admitMarketDataLeases({
    owner: "watchlist-prewarm:legacy",
    intent: "historical",
    requests: [{ assetClass: "equity", symbol: "SPY" }],
    fallbackProvider: "none",
  });

  assert.equal(result.admitted[0]?.ownerClass, "historical");
});

test("Massive flow scanner cap is independent of active protected demand", () => {
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

test("Massive flow scanner cap is not reduced by live Trade Options Chain demand", () => {
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
  assert.equal(flowScannerUsage.effectiveMaxLines, 200);
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
  test(`${scenario.name} demand does not consume Massive scanner budget`, () => {
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
    assert.equal(protectedDemand.demoted.length, 0);
    assert.equal(diagnostics[scenario.activeLineField], 70);
    assert.equal(diagnostics.activeLineCount, 70);
    assert.equal(diagnostics.grossActiveLineCount, 70);
    assert.equal(diagnostics.totalLeaseLineCount, 270);
    assert.equal(diagnostics.flowScannerContractCount, 200);
    assert.equal(diagnostics.pressure.activeLineCount, 70);
    assert.equal(diagnostics.pressure.grossActiveLineCount, 70);
    assert.equal(diagnostics.pressure.flowScannerContractCount, 200);
    assert.equal(diagnostics.lineAllocation.optionReserveLineCount, 70);
    assert.ok(flowScannerUsage);
    assert.equal(flowScannerUsage.chargedLineCount, 200);
    assert.equal(flowScannerUsage.effectiveMaxLines, 200);
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
  test(`${scenario.name} coexists with saturated Massive scanner demand`, () => {
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
    assert.equal(priorityDemand.demoted.length, 0);
    assert.equal(diagnostics[scenario.activeLineField], lineDemand);
    assert.equal(diagnostics.activeLineCount, lineDemand);
    assert.equal(diagnostics.grossActiveLineCount, lineDemand);
    assert.equal(diagnostics.totalLeaseLineCount, 200 + lineDemand);
    assert.equal(diagnostics.flowScannerContractCount, 200);
    assert.equal(diagnostics.pressure.activeLineCount, lineDemand);
    assert.equal(diagnostics.pressure.grossActiveLineCount, lineDemand);
    assert.equal(diagnostics.pressure.flowScannerContractCount, 200);
    assert.equal(diagnostics.lineAllocation.protectedPriorityLineCount, lineDemand);
    assert.ok(flowScannerUsage);
    assert.equal(flowScannerUsage.chargedLineCount, 200);
    assert.equal(flowScannerUsage.effectiveMaxLines, 200);
    assert.equal(flowScannerUsage.remainingLineCount, 0);
  });
});

test("new Trade Options Chain demand grows without demoting Massive scanner", () => {
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

  assert.equal(
    before.grossActiveLineCount,
    before.pressure.activeLineCount,
  );
  assert.equal(
    before.totalLeaseLineCount,
    200 + before.pressure.activeLineCount,
  );
  assert.equal(before.flowScannerContractCount, 200);
  assert.equal(before.activeLineCount, before.pressure.activeLineCount);
  assert.ok(before.pressure.activeLineCount > 0);
  assert.equal(scanner.admitted.length, 200);
  assert.equal(scanner.rejected.length, 0);
  assert.equal(additionalTradeDemand.rejected.length, 0);
  assert.equal(additionalTradeDemand.admitted.length, 3);
  assert.equal(additionalTradeDemand.demoted.length, 0);
  assert.equal(
    after.grossActiveLineCount,
    before.grossActiveLineCount + additionalTradeLineCount,
  );
  assert.equal(
    after.pressure.activeLineCount,
    before.pressure.activeLineCount + additionalTradeLineCount,
  );
  assert.equal(after.activeLineCount, after.pressure.activeLineCount);
  assert.equal(after.flowScannerChargedLineCount, before.flowScannerChargedLineCount);
  assert.equal(
    after.visibleLineCount,
    before.visibleLineCount + additionalTradeLineCount,
  );
  assert.equal(
    after.lineAllocation.protectedPriorityLineCount,
    before.lineAllocation.protectedPriorityLineCount + additionalTradeLineCount,
  );
});

test("Massive flow scanner admits up to its configured line budget", () => {
  __resetMarketDataAdmissionForTests();
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 250,
    flowScannerConcurrency: 1,
  });

  const scanner = admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: optionRequests("SPY", 100),
    fallbackProvider: "none",
  });
  const diagnostics = getMarketDataAdmissionDiagnostics();

  assert.equal(scanner.rejected.length, 0);
  assert.equal(scanner.admitted.length, 100);
  assert.equal(diagnostics.budget.flowScannerLineCap, 250);
  assert.equal(diagnostics.flowScannerChargedLineCount, 100);
  assert.equal(diagnostics.flowScannerContractCount, 100);
  assert.equal(diagnostics.activeLineCount, 0);
  assert.equal(diagnostics.grossActiveLineCount, 0);
  assert.equal(diagnostics.totalLeaseLineCount, 100);
  assert.equal(diagnostics.activeOptionLineCount, 0);
  assert.equal(diagnostics.pressure.activeLineCount, 0);
  assert.equal(diagnostics.pressure.grossActiveLineCount, 0);
  assert.equal(diagnostics.pressure.flowScannerContractCount, 100);
  assert.equal(diagnostics.lineAllocation.activeLineCount, 0);
  assert.equal(diagnostics.lineAllocation.scannerLineCount, 100);
  assert.equal(diagnostics.pressure.state, "normal");
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

test("retired IBKR compatibility fields stay inert while Massive scanner refills", () => {
  __resetMarketDataAdmissionForTests();
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

  const refill = admitMarketDataLeases({
    owner: "flow-scanner:SPY:refill",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 5 }, (_, index) => ({
      assetClass: "option" as const,
      symbol: "SPY",
      providerContractId: `SPY-REFILL-C-${index}`,
    })),
    fallbackProvider: "none",
  });
  const diagnostics = getMarketDataAdmissionDiagnostics();

  assert.equal(refill.rejected.length, 0);
  assert.equal(refill.admitted.length, 5);
  assert.equal(refill.demoted.length, 0);
  assert.equal(diagnostics.accountMonitorLineCount, 1);
  assert.equal(diagnostics.pressure.ibkrPressure, null);
  assert.equal(diagnostics.pressure.scannerConfiguredLineCap, 20);
  assert.equal(diagnostics.pressure.scannerEffectiveLineCap, 20);
  assert.equal(diagnostics.pressure.scannerPressureLineCap, null);
  assert.equal(diagnostics.pressure.scannerPressureDampingActive, false);
  assert.equal(diagnostics.pressure.scannerChargedLineCount, 15);
  assert.equal(diagnostics.poolUsageRanking[0]?.id, "flow-scanner");
  assert.equal(diagnostics.poolUsageRanking[0]?.recentIbkrPressureShed, false);
});

test("legacy IBKR flow scanner env does not cap Massive scanner budget", () => {
  __resetMarketDataAdmissionForTests();
  const previousLegacy = process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES;
  const previousMassive = process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET;
  process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES = "50";
  delete process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET;
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: 20,
    flowScannerConcurrency: 1,
  });
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
    const diagnostics = getMarketDataAdmissionDiagnostics();

    assert.equal(diagnostics.pressure.scannerConfiguredLineCap, 20);
    assert.equal(diagnostics.pressure.scannerEffectiveLineCap, 20);
    assert.equal(diagnostics.pressure.scannerPressureLineCap, null);
    assert.equal(diagnostics.pressure.scannerPressureDampingActive, false);
    assert.equal(diagnostics.pressure.ibkrPressure, null);
    assert.equal(diagnostics.pressure.scannerChargedLineCount, 10);
  } finally {
    if (previousLegacy === undefined) {
      delete process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES;
    } else {
      process.env.IBKR_MARKET_DATA_FLOW_SCANNER_LINES = previousLegacy;
    }
    if (previousMassive === undefined) {
      delete process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET;
    } else {
      process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET = previousMassive;
    }
  }
});

test("Massive flow scanner env controls Massive scanner budget", () => {
  __resetMarketDataAdmissionForTests();
  const previous = process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET;
  process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET = "50";
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
    const diagnostics = getMarketDataAdmissionDiagnostics();

    assert.equal(diagnostics.pressure.scannerConfiguredLineCap, 50);
    assert.equal(diagnostics.pressure.scannerEffectiveLineCap, 50);
    assert.equal(diagnostics.pressure.scannerPressureLineCap, null);
    assert.equal(diagnostics.pressure.scannerPressureDampingActive, false);
    assert.equal(diagnostics.pressure.ibkrPressure, null);
    assert.equal(diagnostics.pressure.scannerChargedLineCount, 10);
  } finally {
    if (previous === undefined) {
      delete process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET;
    } else {
      process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET = previous;
    }
  }
});

test("shared scanner lines remain available instead of consuming scanner capacity", () => {
  __resetMarketDataAdmissionForTests();
  const previous = process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET;
  process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET = "1";
  try {
    const request = optionRequests("SPY", 1);
    admitMarketDataLeases({
      owner: "trade-option-chain:SPY",
      intent: "visible-live",
      requests: request,
      fallbackProvider: "none",
    });
    admitMarketDataLeases({
      owner: "flow-scanner:SPY",
      intent: "flow-scanner-live",
      requests: request,
      fallbackProvider: "none",
    });

    const diagnostics = getMarketDataAdmissionDiagnostics();
    assert.equal(diagnostics.flowScannerLineCount, 1);
    assert.equal(diagnostics.flowScannerChargedLineCount, 0);
    assert.equal(diagnostics.pressure.scannerRemainingLineCount, 1);
    assert.equal(diagnostics.flowScannerRemainingLineCount, 1);
  } finally {
    if (previous === undefined) {
      delete process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET;
    } else {
      process.env.OPTIONS_FLOW_SCANNER_LINE_BUDGET = previous;
    }
  }
});
