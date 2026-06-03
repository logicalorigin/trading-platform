import assert from "node:assert/strict";
import test from "node:test";
import type {
  IbkrMarketDataDesiredGeneration,
  IbkrMarketDataGenerationStatus,
} from "@workspace/ibkr-contracts";
import {
  admitMarketDataLeases,
  __resetMarketDataAdmissionForTests,
} from "./market-data-admission";
import {
  getIbkrLineUsageSnapshot,
  runIbkrLineUsageGenerationCoordinatorOnce,
  __resetIbkrLineUsageForTests,
  __setIbkrLineUsageAsyncSidecarClientFactoryForTests,
  __setIbkrLineUsageBridgeClientFactoryForTests,
} from "./ibkr-line-usage";
import {
  __resetApiResourcePressureForTests,
  resolveApiRssPressureThresholds,
  updateApiResourcePressure,
} from "./resource-pressure";

const originalTimeoutMs = process.env["IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS"];
const originalRoutingEnabled =
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"];
const originalGenerationApplyEnabled =
  process.env["IBKR_MARKET_DATA_GENERATION_APPLY_ENABLED"];
const originalGenerationApplyTimeoutMs =
  process.env["IBKR_MARKET_DATA_GENERATION_APPLY_TIMEOUT_MS"];

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function buildLiveSidecarGenerationStatus(
  generation: IbkrMarketDataDesiredGeneration,
): IbkrMarketDataGenerationStatus {
  const lines = generation.desiredLines.map((line) => ({
    lineKey: line.lineKey,
    assetClass: line.assetClass,
    state: "live" as const,
    contract: line.contract,
    owners: line.owners,
    subscribedAt: null,
    lastTickAt: null,
    releaseRequestedAt: null,
    error: null,
  }));
  return {
    schemaVersion: 1,
    mode: "executor",
    source: "ib-async-sidecar",
    generationId: generation.generationId,
    appliedGenerationId: generation.generationId,
    updatedAt: "2026-06-02T02:45:00.000Z",
    lines,
    summary: {
      liveLineCount: lines.length,
      liveEquityLineCount: lines.filter((line) => line.assetClass === "equity")
        .length,
      liveOptionLineCount: lines.filter((line) => line.assetClass === "option")
        .length,
      subscribingLineCount: 0,
      releasingLineCount: 0,
      failedLineCount: 0,
      unexpectedLineCount: 0,
    },
    throttle: {
      throttled: false,
      queueDepth: null,
      maxRequests: null,
      requestsIntervalSec: null,
      lastThrottleStartAt: null,
      lastThrottleEndAt: null,
    },
  };
}

function structuredOptionProviderContractId(index: number): string {
  return `twsopt:${Buffer.from(
    JSON.stringify({
      v: 1,
      u: "SPY",
      e: "20260619",
      s: 400 + index,
      r: index % 2 === 0 ? "C" : "P",
      x: "SMART",
      tc: "SPY",
      m: 100,
    }),
    "utf8",
  ).toString("base64url")}`;
}

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));
const settleApplyTimeout = async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flushAsyncWork();
  await flushAsyncWork();
};

test.afterEach(() => {
  __setIbkrLineUsageAsyncSidecarClientFactoryForTests(null);
  __setIbkrLineUsageBridgeClientFactoryForTests(null);
  __resetIbkrLineUsageForTests();
  __resetMarketDataAdmissionForTests();
  __resetApiResourcePressureForTests();
  restoreEnv("IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS", originalTimeoutMs);
  restoreEnv("IBKR_ASYNC_SIDECAR_ROUTING_ENABLED", originalRoutingEnabled);
  restoreEnv(
    "IBKR_MARKET_DATA_GENERATION_APPLY_ENABLED",
    originalGenerationApplyEnabled,
  );
  restoreEnv(
    "IBKR_MARKET_DATA_GENERATION_APPLY_TIMEOUT_MS",
    originalGenerationApplyTimeoutMs,
  );
});

test("getIbkrLineUsageSnapshot reports visible prewarm demand without filler", async () => {
  const visibleSymbols = Array.from({ length: 90 }, (_, index) => `WL${index}`);
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 90,
        marketDataLineBudget: 200,
        activeEquitySymbols: visibleSymbols,
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  updateApiResourcePressure({ rssMb: 1_250 });
  admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "visible-live",
    requests: visibleSymbols.map((symbol) => ({
      assetClass: "equity",
      symbol,
    })),
    fallbackProvider: "massive",
  });

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.admission.activeLineCount, 90);
  assert.equal(snapshot.admission.pressure.utilizationPercent, 45);
  assert.equal(snapshot.admission.pressure.utilizationLevel, "normal");
  assert.equal(snapshot.allocation.utilizationPercent, 45);
  assert.equal(snapshot.allocation.utilizationLevel, "normal");
  assert.equal(snapshot.lineUtilizationAudit.targetLineCount, 200);
  assert.equal(snapshot.lineUtilizationAudit.idleToTargetLineCount, 110);
  assert.equal(
    snapshot.lineUtilizationAudit.topLimitingReason,
    "active-demand-satisfied",
  );
  assert.equal(snapshot.lineUtilizationAudit.scanner.maxDeepScanLines, 110);
  assert.equal("watchlist" in snapshot.lineUtilizationAudit, false);
});

test("getIbkrLineUsageSnapshot reports active scanner drift instead of throttling on soft RSS pressure", async () => {
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"] = "false";
  const watchlistSymbols = Array.from({ length: 90 }, (_, index) => `WL${index}`);
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 90,
        marketDataLineBudget: 200,
        activeEquitySymbols: watchlistSymbols,
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  updateApiResourcePressure({
    rssMb: resolveApiRssPressureThresholds().critical + 1,
  });
  admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "visible-live",
    requests: watchlistSymbols.map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
    fallbackProvider: "massive",
  });
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 40 }, (_, index) => ({
      assetClass: "option" as const,
      symbol: `SCAN${index}`,
      providerContractId: structuredOptionProviderContractId(index),
    })),
    fallbackProvider: "none",
  });

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.admission.activeLineCount, 130);
  assert.equal(snapshot.admission.flowScannerLineCount, 40);
  assert.equal(
    snapshot.admission.optionsFlowScanner.backgroundBlockedReason,
    null,
  );
  assert.equal(
    snapshot.admission.optionsFlowScanner.resourcePressure.level,
    "critical",
  );
  assert.equal(
    snapshot.lineUtilizationAudit.topLimitingReason,
    "line-drift",
  );
  assert.equal(snapshot.lineUtilizationAudit.scanner.activeLineCount, 40);
  assert.equal(snapshot.lineUtilizationAudit.admissionVsBridgeLineDelta, 40);
  assert.equal(
    snapshot.drift.reconciliation.status,
    "api_active_bridge_missing",
  );
  assert.equal(snapshot.drift.reconciliation.snapshotOnlyApiLineCount, 0);
  assert.equal(snapshot.drift.reconciliation.apiOnlyLineCount, 40);
  assert.equal(snapshot.marketDataWorkPlan.summary.ibkrOptionLineCount, 40);
  assert.equal(snapshot.sidecar.diagnosticsOnly, true);
  assert.equal(snapshot.sidecar.routingEnabled, false);
  assert.equal(snapshot.sidecar.desiredGeneration.summary.desiredLineCount, 130);
  assert.equal(
    snapshot.sidecar.desiredGeneration.summary.desiredOptionLineCount,
    40,
  );
  assert.equal(snapshot.sidecar.comparison.status, "unknown");
});

test("getIbkrLineUsageSnapshot does not report scanner pressure for automation-only pressure", async () => {
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 0,
        marketDataLineBudget: 200,
        activeEquitySymbols: [],
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  updateApiResourcePressure({ automationActiveLongScanCount: 1 });
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 40 }, (_, index) => ({
      assetClass: "option" as const,
      symbol: "SPY",
      providerContractId: `twsopt:scanner-${index}`,
    })),
    fallbackProvider: "none",
  });

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.admission.optionsFlowScanner.resourcePressure.level, "normal");
  assert.equal(snapshot.admission.optionsFlowScanner.scannerPressure.level, "normal");
  assert.equal(snapshot.lineUtilizationAudit.topLimitingReason, "line-drift");
  assert.equal(snapshot.lineUtilizationAudit.scanner.effectiveConcurrency, 8);
});

test("getIbkrLineUsageSnapshot includes scanner option leases in bridge drift", async () => {
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 2,
        marketDataLineBudget: 200,
        activeEquitySymbols: ["AAPL", "MSFT"],
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "visible-live",
    requests: ["AAPL", "MSFT"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
    fallbackProvider: "massive",
  });
  admitMarketDataLeases({
    owner: "flow-scanner:SPY",
    intent: "flow-scanner-live",
    requests: ["one", "two"].map((suffix, index) => ({
      assetClass: "option" as const,
      symbol: index === 0 ? "SPY" : "QQQ",
      providerContractId: `twsopt:scanner-${suffix}`,
    })),
    fallbackProvider: "none",
  });

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.admission.activeLineCount, 4);
  assert.equal(
    snapshot.drift.reconciliation.status,
    "api_active_bridge_missing",
  );
  assert.equal(snapshot.drift.reconciliation.apiLineCount, 4);
  assert.equal(snapshot.drift.reconciliation.totalApiLineCount, 4);
  assert.equal(snapshot.drift.reconciliation.snapshotOnlyApiLineCount, 0);
  assert.deepEqual(snapshot.drift.reconciliation.apiOnlyLineSample, [
    "option:twsopt:scanner-one",
    "option:twsopt:scanner-two",
  ]);
  assert.equal(snapshot.drift.admissionVsBridgeLineDelta, 2);
  assert.equal(snapshot.lineUtilizationAudit.admissionVsBridgeLineDelta, 2);
  assert.equal(snapshot.marketDataWorkPlan.summary.ibkrOptionLineCount, 2);
});

test("getIbkrLineUsageSnapshot reports bridge prewarm groups without changing leases", async () => {
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 4,
        marketDataLineBudget: 200,
        activeEquitySymbols: ["AAPL", "MSFT", "NVDA", "TSLA"],
        activeOptionProviderContractIds: [],
        prewarmGroups: [
          {
            owner: "watchlist-prewarm",
            symbolCount: 2,
            symbols: ["AAPL", "MSFT"],
          },
          {
            owner: "watchlist-prewarm-filler",
            symbolCount: 2,
            symbols: ["NVDA", "TSLA"],
          },
        ],
      },
    }),
  }));

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.admission.activeLineCount, 0);
  assert.equal(snapshot.admission.visibleLineCount, 0);
  assert.equal("watchlistLineCount" in snapshot.admission, false);
  assert.equal("fillerLineCount" in snapshot.admission, false);
  assert.equal("watchlist" in snapshot.lineUtilizationAudit, false);
  assert.equal(snapshot.drift.reconciliation.apiLineCount, 0);
  assert.equal(snapshot.drift.reconciliation.bridgeLineCount, 4);
  assert.equal(
    snapshot.drift.reconciliation.status,
    "api_released_bridge_active",
  );
});

test("getIbkrLineUsageSnapshot leaves scanner capacity schedulable without filler", async () => {
  const watchlistSymbols = Array.from({ length: 90 }, (_, index) => `WL${index}`);
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 90,
        marketDataLineBudget: 200,
        activeEquitySymbols: watchlistSymbols,
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  admitMarketDataLeases({
    owner: "watchlist-prewarm",
    intent: "visible-live",
    requests: watchlistSymbols.map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
    fallbackProvider: "massive",
  });

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.admission.activeLineCount, 90);
  assert.equal(snapshot.allocation.scannerEffectiveLineCap, 110);
  assert.equal(snapshot.allocation.scannerSchedulableLineCap, 110);
  assert.equal(snapshot.allocation.scannerSchedulableRemainingLineCount, 110);
  assert.equal(
    snapshot.admission.optionsFlowScanner.lineUtilization.schedulablePoolCap,
    110,
  );
  assert.equal(
    snapshot.lineUtilizationAudit.topLimitingReason,
    "active-demand-satisfied",
  );
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
  assert.equal(snapshot.admission.budget.accountMonitorLineCap, 200);
  assert.equal(snapshot.policy.maxLines, 200);
  assert.equal(snapshot.policy.reserveLines, 0);
  assert.equal(snapshot.policy.targetFillLines, 200);
  assert.equal(snapshot.policy.accountMonitorDynamic, true);
  assert.equal(snapshot.allocation.activeLineCount, 1);
  assert.equal(snapshot.allocation.remainingToTargetLineCount, 199);
  assert.equal("elasticLineCount" in snapshot.allocation, false);
  assert.equal("fillerLineCount" in snapshot.allocation, false);
  assert.equal(snapshot.lineUtilizationAudit.targetLineCount, 200);
  assert.equal(snapshot.lineUtilizationAudit.admissionActiveLineCount, 1);
  assert.equal(snapshot.lineUtilizationAudit.idleToTargetLineCount, 199);
  assert.equal(
    snapshot.lineUtilizationAudit.topLimitingReason,
    "bridge-diagnostics-unavailable",
  );
  assert.equal(
    snapshot.lineUtilizationAudit.scanner.configuredConcurrency,
    8,
  );
  assert.equal(snapshot.lineUtilizationAudit.scanner.maxDeepScanLines, 200);
  assert.equal("watchlist" in snapshot.lineUtilizationAudit, false);
  assert.equal(snapshot.admission.poolUsage["account-monitor"]?.maxLines, 200);
  assert.equal(snapshot.admission.poolUsage["account-monitor"]?.dynamic, false);
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

test("getIbkrLineUsageSnapshot exposes shadow account owner-class usage", async () => {
  process.env["IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS"] = "10";
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: () => new Promise(() => {}),
  }));
  admitMarketDataLeases({
    owner: "shadow-position-visible:NVDA",
    intent: "visible-live",
    requests: [
      {
        assetClass: "option",
        symbol: "NVDA",
        providerContractId: "SHADOWOPT1",
      },
    ],
    fallbackProvider: "cache",
  });

  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(snapshot.shadowAccount.activeLineCount, 1);
  assert.equal(snapshot.shadowAccount.ownerCount, 1);
  assert.equal(snapshot.shadowAccount.activeFallbackProviderLineCounts.cache, 1);
  assert.equal(snapshot.allocation.shadowAccountLineCount, 1);
  assert.equal(snapshot.allocation.shadowAccountCacheFallbackLineCount, 1);
  assert.equal(
    snapshot.ownerClasses.summaries["shadow-account"].activeLineCount,
    1,
  );
});

test("getIbkrLineUsageSnapshot keeps shadow and signal option usage separate", async () => {
  process.env["IBKR_LINE_USAGE_BRIDGE_TIMEOUT_MS"] = "10";
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: () => new Promise(() => {}),
  }));
  admitMarketDataLeases({
    owner: "shadow-position-visible:NVDA",
    intent: "visible-live",
    requests: [
      {
        assetClass: "option",
        symbol: "NVDA",
        providerContractId: "SHADOWOPT1",
      },
    ],
    fallbackProvider: "cache",
  });
  admitMarketDataLeases({
    owner: "signal-options-position-mark:deploy-1:position-1",
    intent: "automation-live",
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

  assert.equal(snapshot.shadowAccount.activeLineCount, 1);
  assert.equal(snapshot.signalOptions.activeLineCount, 1);
  assert.equal(
    snapshot.ownerClasses.summaries["shadow-account"].activeOwnerSample[0],
    "shadow-position-visible:NVDA",
  );
  assert.equal(
    snapshot.ownerClasses.summaries["signal-options"].activeOwnerSample[0],
    "signal-options-position-mark:deploy-1:position-1",
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
  assert.equal(snapshot.drift.reconciliation.persistentBridgeOnlyGraceMs, 10_000);
  assert.equal(snapshot.drift.reconciliation.persistentBridgeOnlyLineCount, 0);
  assert.equal(snapshot.drift.reconciliation.persistentApiOnlyGraceMs, 10_000);
  assert.equal(snapshot.drift.reconciliation.persistentApiOnlyLineCount, 0);
  assert.ok(
    snapshot.drift.reconciliation.lineStates.some(
      (line) =>
        line.lineId === "option:twsopt:test-api-only" &&
        line.state === "planned",
    ),
  );
});

test("getIbkrLineUsageSnapshot does not apply desired generation on read", async () => {
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"] = "true";
  let sidecarApplyCount = 0;
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 0,
        marketDataLineBudget: 190,
        activeEquitySymbols: [],
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  __setIbkrLineUsageAsyncSidecarClientFactoryForTests(() => ({
    applyMarketDataGeneration: async (
      generation: IbkrMarketDataDesiredGeneration,
    ) => {
      sidecarApplyCount += 1;
      return buildLiveSidecarGenerationStatus(generation);
    },
  }));
  admitMarketDataLeases({
    owner: "line-usage-equity",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });

  const snapshot = await getIbkrLineUsageSnapshot();
  await flushAsyncWork();

  assert.equal(sidecarApplyCount, 0);
  assert.equal(snapshot.sidecar.applyEnabled, true);
  assert.equal(snapshot.sidecar.applyTarget, "ib-async-sidecar");
  assert.equal(snapshot.sidecar.applyPending, false);
  assert.equal(snapshot.sidecar.applyError, null);
  assert.equal(
    snapshot.sidecar.applyGenerationId,
    snapshot.sidecar.desiredGeneration.generationId,
  );
  assert.equal(snapshot.sidecar.bridgeGenerationStatus, null);
});

test("line-usage generation coordinator applies desired generation to release bridge-only lines", async () => {
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"] = "false";
  let appliedLineKeys: string[] = [];
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 2,
        marketDataLineBudget: 190,
        activeEquitySymbols: ["AAPL", "MSFT"],
        activeOptionProviderContractIds: [],
      },
    }),
    applyMarketDataGeneration: async (
      generation: IbkrMarketDataDesiredGeneration,
    ) => {
      appliedLineKeys = generation.desiredLines.map((line) => line.lineKey);
      return {
        schemaVersion: 1,
        mode: "executor",
        source: "tws-bridge",
        generationId: generation.generationId,
        appliedGenerationId: generation.generationId,
        updatedAt: "2026-06-02T01:00:00.000Z",
        lines: [
          {
            lineKey: "equity:AAPL",
            assetClass: "equity",
            state: "live",
            contract: { symbol: "AAPL", providerContractId: null },
            owners: generation.desiredLines[0]?.owners ?? [],
            subscribedAt: null,
            lastTickAt: null,
            releaseRequestedAt: null,
            error: null,
          },
        ],
        summary: {
          liveLineCount: 1,
          liveEquityLineCount: 1,
          liveOptionLineCount: 0,
          subscribingLineCount: 0,
          releasingLineCount: 0,
          failedLineCount: 0,
          unexpectedLineCount: 0,
        },
        throttle: {
          throttled: false,
          queueDepth: null,
          maxRequests: null,
          requestsIntervalSec: null,
          lastThrottleStartAt: null,
          lastThrottleEndAt: null,
        },
      };
    },
  }));
  admitMarketDataLeases({
    owner: "line-usage-equity",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });

  const firstSnapshot = await runIbkrLineUsageGenerationCoordinatorOnce();
  await flushAsyncWork();
  const snapshot = await getIbkrLineUsageSnapshot();

  assert.deepEqual(appliedLineKeys, ["equity:AAPL"]);
  assert.equal(firstSnapshot.sidecar.applyPending, true);
  assert.equal(snapshot.bridge.activeLineCount, 1);
  assert.equal(snapshot.lineUtilizationAudit.bridgeActiveLineCount, 1);
  assert.equal(snapshot.drift.reconciliation.status, "matched");
  assert.equal(snapshot.drift.reconciliation.bridgeOnlyLineCount, 0);
  assert.equal(snapshot.sidecar.applyEnabled, true);
  assert.equal(snapshot.sidecar.applyError, null);
  assert.equal(snapshot.sidecar.applyPending, false);
  assert.equal(snapshot.sidecar.bridgeGenerationStatus?.summary.liveLineCount, 1);
  assert.equal(snapshot.sidecar.comparison.status, "matched");
});

test("line-usage generation coordinator routes desired generation to Python sidecar when enabled", async () => {
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"] = "true";
  let bridgeApplyCount = 0;
  const sidecarGenerations: IbkrMarketDataDesiredGeneration[] = [];
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 1,
        marketDataLineBudget: 190,
        activeEquitySymbols: ["MSFT"],
        activeOptionProviderContractIds: [],
      },
    }),
    applyMarketDataGeneration: async () => {
      bridgeApplyCount += 1;
      throw new Error("bridge generation apply should not run");
    },
  }));
  __setIbkrLineUsageAsyncSidecarClientFactoryForTests(() => ({
    applyMarketDataGeneration: async (
      generation: IbkrMarketDataDesiredGeneration,
    ) => {
      sidecarGenerations.push(generation);
      return buildLiveSidecarGenerationStatus(generation);
    },
  }));
  admitMarketDataLeases({
    owner: "line-usage-equity",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });

  const firstSnapshot = await runIbkrLineUsageGenerationCoordinatorOnce();
  await flushAsyncWork();
  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(bridgeApplyCount, 0);
  assert.equal(sidecarGenerations.length, 1);
  assert.deepEqual(
    sidecarGenerations[0]?.desiredLines.map((line) => line.lineKey),
    ["equity:AAPL"],
  );
  assert.equal(firstSnapshot.sidecar.applyPending, true);
  assert.equal(snapshot.sidecar.diagnosticsOnly, false);
  assert.equal(snapshot.sidecar.routingEnabled, true);
  assert.equal(snapshot.sidecar.applyEnabled, true);
  assert.equal(snapshot.sidecar.applyTarget, "ib-async-sidecar");
  assert.equal(snapshot.sidecar.applyError, null);
  assert.equal(snapshot.sidecar.applyPending, false);
  assert.equal(snapshot.sidecar.bridgeGenerationStatus?.source, "ib-async-sidecar");
  assert.equal(snapshot.sidecar.bridgeGenerationStatus?.summary.liveLineCount, 1);
  assert.equal(snapshot.bridge.activeLineCount, 1);
  assert.equal(snapshot.lineUtilizationAudit.bridgeActiveLineCount, 1);
  assert.equal(snapshot.drift.reconciliation.status, "matched");
  assert.equal(snapshot.drift.reconciliation.apiOnlyLineCount, 0);
  assert.equal(snapshot.drift.reconciliation.bridgeOnlyLineCount, 0);
  assert.equal(snapshot.sidecar.comparison.status, "matched");
});

test("line-usage generation coordinator does not stack sidecar applies when desired generation changes", async () => {
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"] = "true";
  const sidecarGenerations: IbkrMarketDataDesiredGeneration[] = [];
  let resolveFirstApply:
    | ((status: IbkrMarketDataGenerationStatus) => void)
    | null = null;
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 0,
        marketDataLineBudget: 190,
        activeEquitySymbols: [],
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  __setIbkrLineUsageAsyncSidecarClientFactoryForTests(() => ({
    applyMarketDataGeneration: async (
      generation: IbkrMarketDataDesiredGeneration,
    ) => {
      sidecarGenerations.push(generation);
      return new Promise<IbkrMarketDataGenerationStatus>((resolve) => {
        if (!resolveFirstApply) {
          resolveFirstApply = resolve;
        }
      });
    },
  }));
  admitMarketDataLeases({
    owner: "line-usage-aapl",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });

  const firstSnapshot = await runIbkrLineUsageGenerationCoordinatorOnce();
  admitMarketDataLeases({
    owner: "line-usage-msft",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "MSFT" }],
    fallbackProvider: "cache",
  });
  const secondSnapshot = await runIbkrLineUsageGenerationCoordinatorOnce();

  assert.equal(sidecarGenerations.length, 1);
  assert.equal(firstSnapshot.sidecar.applyPending, true);
  assert.equal(secondSnapshot.sidecar.applyPending, true);
  assert.equal(
    secondSnapshot.sidecar.applyGenerationId,
    firstSnapshot.sidecar.applyGenerationId,
  );
  const firstApplyResolver = resolveFirstApply as
    | ((status: IbkrMarketDataGenerationStatus) => void)
    | null;
  assert.ok(firstApplyResolver);
  firstApplyResolver(buildLiveSidecarGenerationStatus(sidecarGenerations[0]!));
  await flushAsyncWork();
  await flushAsyncWork();
});

test("line-usage generation coordinator times out a hung sidecar apply", async () => {
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"] = "true";
  process.env["IBKR_MARKET_DATA_GENERATION_APPLY_TIMEOUT_MS"] = "5";
  let sidecarApplyCount = 0;
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 0,
        marketDataLineBudget: 190,
        activeEquitySymbols: [],
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  __setIbkrLineUsageAsyncSidecarClientFactoryForTests(() => ({
    applyMarketDataGeneration: async () => {
      sidecarApplyCount += 1;
      return new Promise<IbkrMarketDataGenerationStatus>(() => {});
    },
  }));
  admitMarketDataLeases({
    owner: "line-usage-aapl",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });

  const firstSnapshot = await runIbkrLineUsageGenerationCoordinatorOnce();
  await settleApplyTimeout();
  const secondSnapshot = await runIbkrLineUsageGenerationCoordinatorOnce();

  assert.equal(sidecarApplyCount, 1);
  assert.equal(firstSnapshot.sidecar.applyPending, true);
  assert.equal(secondSnapshot.sidecar.applyPending, false);
  assert.match(
    secondSnapshot.sidecar.applyError ?? "",
    /timed out after 5ms/,
  );
});

test("line-usage generation coordinator compares bridge generation when sidecar apply fails", async () => {
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"] = "true";
  let sidecarApplyCount = 0;
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 1,
        marketDataLineBudget: 190,
        activeEquitySymbols: ["AAPL"],
        activeOptionProviderContractIds: [],
      },
      marketDataGeneration: {
        schemaVersion: 1,
        mode: "executor",
        source: "tws-bridge",
        generationId: "bridge-existing",
        appliedGenerationId: "bridge-existing",
        updatedAt: "2026-06-02T02:45:00.000Z",
        lines: [
          {
            lineKey: "equity:AAPL",
            assetClass: "equity",
            state: "live",
            contract: { symbol: "AAPL", providerContractId: null },
            owners: [
              {
                owner: "line-usage-aapl",
                ownerClass: null,
                intent: "visible-live",
                pool: null,
                priority: null,
              },
            ],
            subscribedAt: null,
            lastTickAt: null,
            releaseRequestedAt: null,
            error: null,
          },
        ],
        summary: {
          liveLineCount: 1,
          liveEquityLineCount: 1,
          liveOptionLineCount: 0,
          subscribingLineCount: 0,
          releasingLineCount: 0,
          failedLineCount: 0,
          unexpectedLineCount: 0,
        },
        throttle: {
          throttled: false,
          queueDepth: null,
          maxRequests: null,
          requestsIntervalSec: null,
          lastThrottleStartAt: null,
          lastThrottleEndAt: null,
        },
      },
    }),
  }));
  __setIbkrLineUsageAsyncSidecarClientFactoryForTests(() => ({
    applyMarketDataGeneration: async () => {
      sidecarApplyCount += 1;
      throw new Error("sidecar offline");
    },
  }));
  admitMarketDataLeases({
    owner: "line-usage-aapl",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });

  const firstSnapshot = await runIbkrLineUsageGenerationCoordinatorOnce();
  await flushAsyncWork();
  const secondSnapshot = await getIbkrLineUsageSnapshot();

  assert.equal(sidecarApplyCount, 1);
  assert.equal(firstSnapshot.sidecar.applyPending, true);
  assert.equal(secondSnapshot.sidecar.applyPending, false);
  assert.match(secondSnapshot.sidecar.applyError ?? "", /sidecar offline/);
  assert.equal(
    secondSnapshot.sidecar.bridgeGenerationStatus?.summary.liveLineCount,
    1,
  );
  assert.equal(secondSnapshot.sidecar.comparison.status, "matched");
});

test("line-usage generation coordinator backs off failed sidecar applies across generation churn", async () => {
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"] = "true";
  process.env["IBKR_MARKET_DATA_GENERATION_APPLY_TIMEOUT_MS"] = "5";
  let sidecarApplyCount = 0;
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 0,
        marketDataLineBudget: 190,
        activeEquitySymbols: [],
        activeOptionProviderContractIds: [],
      },
    }),
  }));
  __setIbkrLineUsageAsyncSidecarClientFactoryForTests(() => ({
    applyMarketDataGeneration: async () => {
      sidecarApplyCount += 1;
      return new Promise<IbkrMarketDataGenerationStatus>(() => {});
    },
  }));
  admitMarketDataLeases({
    owner: "line-usage-aapl",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });

  const firstSnapshot = await runIbkrLineUsageGenerationCoordinatorOnce();
  await settleApplyTimeout();
  const timedOutSnapshot = await getIbkrLineUsageSnapshot();
  admitMarketDataLeases({
    owner: "line-usage-msft",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "MSFT" }],
    fallbackProvider: "cache",
  });
  const secondSnapshot = await getIbkrLineUsageSnapshot();

  assert.equal(sidecarApplyCount, 1);
  assert.equal(firstSnapshot.sidecar.applyPending, true);
  assert.equal(timedOutSnapshot.sidecar.applyPending, false);
  assert.match(
    timedOutSnapshot.sidecar.applyError ?? "",
    /timed out after 5ms/,
  );
  assert.equal(secondSnapshot.sidecar.applyPending, false);
  assert.equal(
    secondSnapshot.sidecar.applyGenerationId,
    firstSnapshot.sidecar.applyGenerationId,
  );
  assert.match(
    secondSnapshot.sidecar.applyError ?? "",
    /timed out after 5ms/,
  );
});

test("line-usage generation coordinator does not fall back to bridge when Python sidecar apply fails", async () => {
  process.env["IBKR_ASYNC_SIDECAR_ROUTING_ENABLED"] = "true";
  let bridgeApplyCount = 0;
  let sidecarApplyCount = 0;
  __setIbkrLineUsageBridgeClientFactoryForTests(() => ({
    getLaneDiagnostics: async () => ({
      subscriptions: {
        activeQuoteSubscriptions: 0,
        marketDataLineBudget: 190,
        activeEquitySymbols: [],
        activeOptionProviderContractIds: [],
      },
    }),
    applyMarketDataGeneration: async () => {
      bridgeApplyCount += 1;
      throw new Error("bridge generation apply should not run");
    },
  }));
  __setIbkrLineUsageAsyncSidecarClientFactoryForTests(() => ({
    applyMarketDataGeneration: async () => {
      sidecarApplyCount += 1;
      throw new Error("sidecar offline");
    },
  }));
  admitMarketDataLeases({
    owner: "line-usage-equity",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "AAPL" }],
    fallbackProvider: "cache",
  });

  const firstSnapshot = await runIbkrLineUsageGenerationCoordinatorOnce();
  await flushAsyncWork();
  const snapshot = await getIbkrLineUsageSnapshot();

  assert.equal(sidecarApplyCount, 1);
  assert.equal(bridgeApplyCount, 0);
  assert.equal(firstSnapshot.sidecar.applyPending, true);
  assert.equal(snapshot.sidecar.diagnosticsOnly, false);
  assert.equal(snapshot.sidecar.routingEnabled, true);
  assert.equal(snapshot.sidecar.applyTarget, "ib-async-sidecar");
  assert.match(snapshot.sidecar.applyError ?? "", /sidecar offline/);
  assert.equal(snapshot.sidecar.applyPending, false);
  assert.equal(snapshot.sidecar.bridgeGenerationStatus, null);
  assert.equal(snapshot.sidecar.comparison.status, "unknown");
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
