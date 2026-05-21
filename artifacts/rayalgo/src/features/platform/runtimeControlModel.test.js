import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeControlSnapshot,
  isOptionsFlowScannerRuntimeActive,
  normalizeAdmissionDiagnostics,
  selectRuntimeAdmissionDiagnostics,
} from "./runtimeControlModel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const readPlatformSource = (relativePath) =>
  readFileSync(resolve(__dirname, relativePath), "utf8");

test("line allocation UI copy keeps allocator jargon internal", () => {
  const source = [
    "./runtimeControlModel.js",
    "./HeaderStatusCluster.jsx",
    "./IbkrConnectionStatus.jsx",
    "./streamSemantics.ts",
    "./live-streams.ts",
    "../trade/TradeOrderTicket.jsx",
    "../../screens/SettingsScreen.jsx",
    "../../screens/AlgoScreen.jsx",
    "../../screens/FlowScreen.jsx",
    "../../screens/algo/AlgoProfileTab.jsx",
    "../../screens/settings/IbkrLaneArchitecturePanel.jsx",
    "../../screens/settings/ibkrLaneUiModel.js",
  ]
    .map(readPlatformSource)
    .join("\n");
  const forbiddenVisiblePhrases = [
    "Bridge live cap",
    "Scanner effective cap",
    "hard cap",
    "Max Symbols",
    "EXPANDED CAPACITY",
    "Risk caps",
    "\"Capacity\"",
    "capacity limited",
    "Capacity Limited",
    "\"CAPACITY\"",
    "line capacity",
    "quotes next",
    "quote leases",
    "capped at",
    "Lower caps",
    "higher caps",
    "cap increases",
    "balanced cap",
    " at capacity.",
  ];

  for (const phrase of forbiddenVisiblePhrases) {
    assert.equal(source.includes(phrase), false, `${phrase} leaked into UI copy`);
  }
});

test("normalizes complete market data admission pools", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 100,
    budget: {
      maxLines: 200,
      accountMonitorLineCap: 20,
      flowScannerLineCap: 40,
    },
    accountMonitorLineCount: 12,
    flowScannerLineCount: 34,
    poolUsage: {
      "account-monitor": {
        id: "account-monitor",
        label: "Account monitor",
        activeLineCount: 12,
        maxLines: 20,
        remainingLineCount: 8,
        strict: true,
      },
      "flow-scanner": {
        id: "flow-scanner",
        label: "Flow scanner",
        activeLineCount: 34,
        maxLines: 40,
        remainingLineCount: 6,
        strict: true,
      },
      visible: {
        id: "visible",
        label: "Visible",
        activeLineCount: 54,
        maxLines: 88,
        remainingLineCount: 34,
      },
    },
  });

  assert.equal(normalized.summary, "100 of 200");
  assert.equal(normalized.accountMonitor.used, 12);
  assert.equal(normalized.accountMonitor.cap, 20);
  assert.equal(normalized.flowScanner.used, 34);
  assert.equal(normalized.pools.visible.cap, 88);
  assert.equal(normalized.total.free, 100);
  assert.equal(normalized.allocation.targetFillLines, 200);
  assert.equal(normalized.allocation.remainingToTargetLineCount, 100);
  assert.equal(normalized.allocation.fillerLineCount, 0);
});

test("normalizes top-level automation counts when pool rows are absent", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 12,
    automationLineCount: 5,
    budget: {
      maxLines: 200,
      automationLineCap: 25,
    },
  });

  assert.equal(normalized.pools.automation.used, 5);
  assert.equal(normalized.pools.automation.cap, 25);
  assert.equal(normalized.pools.automation.free, 20);
});

test("adds flow scanner runtime detail when active leases are zero", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 12,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 40,
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      lastSkippedReason: "market-data-not-live",
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "skipped: market-data-not-live",
  );
});

test("shows active flow scanner work ahead of a stale skip reason", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 12,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 40,
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      lastSkippedReason: "transport-unavailable",
      deepScanner: {
        activeCount: 2,
      },
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "2 option-chain scans active; 0 quote lines",
  );
});

test("explains queued flow scanner work without active quote lines", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 80,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 100,
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      deepScanner: {
        draining: true,
        activeCount: 3,
        queuedCount: 7,
      },
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "3 option-chain scans active; 0 quote lines",
  );
});

test("scanner line exhaustion renders as a line budget state", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 80,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 100,
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      backgroundBlockedReason: "line-cap-exhausted",
      deepScanner: {
        draining: false,
        queuedCount: 0,
        activeCount: 0,
        snapshotCount: 0,
      },
    },
  });

  assert.equal(normalized.flowScanner.detail, "paused: no scanner lines available");
});

test("reports queued flow scanner work ahead of background pauses", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 80,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 100,
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      backgroundBlockedReason: "options-lane-backoff",
      deepScanner: {
        draining: true,
        queuedCount: 7,
      },
    },
  });

  assert.equal(normalized.flowScanner.detail, "7 scans queued");
});

test("reports flow scanner background pauses when no scanner work is active", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 80,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 100,
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      backgroundBlockedReason: "options-lane-backoff",
      deepScanner: {
        draining: false,
        queuedCount: 0,
        activeCount: 0,
        snapshotCount: 0,
      },
    },
  });

  assert.equal(normalized.flowScanner.detail, "paused: options lane backoff");
});

test("reports live warmup as a temporary foreground-allowed scanner hold", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 80,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 100,
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      backgroundBlockedReason: "live-warmup",
      backgroundHoldRemainingMs: 61_000,
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "warming live watchlist (2m); foreground scans allowed",
  );
});

test("normalizes line pressure and scanner effective cap", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 185,
    usableRemainingLineCount: 0,
    budget: {
      maxLines: 190,
      budgetSource: "bridge-diagnostics",
      flowScannerLineCap: 100,
    },
    pressure: {
      state: "protected",
      policy: "active-ui-first",
      budgetSource: "bridge-diagnostics",
      scannerStaticLineCap: 100,
      scannerEffectiveLineCap: 35,
      usableRemainingLineCount: 0,
    },
    poolUsage: {
      "account-monitor": {
        id: "account-monitor",
        activeLineCount: 0,
        maxLines: 10,
      },
      "flow-scanner": {
        id: "flow-scanner",
        activeLineCount: 20,
        maxLines: 100,
        effectiveMaxLines: 35,
        remainingLineCount: 15,
      },
    },
  });

  assert.equal(normalized.pressure.state, "protected");
  assert.equal(normalized.pressure.budgetSource, "bridge-diagnostics");
  assert.equal(normalized.flowScanner.cap, 100);
  assert.equal(normalized.flowScanner.effectiveCap, 35);
  assert.equal(normalized.flowScanner.free, 15);
});

test("normalizes signal option quote usage separately from flow scanner demand", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 12,
    flowScannerLineCount: 7,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 40,
    },
    signalOptions: {
      activeLineCount: 3,
      leaseCount: 2,
      ownerCount: 2,
      recentRequestedLineCount: 5,
      recentRejectedCount: 1,
      recentCacheFallbackCount: 2,
    },
    poolUsage: {
      "flow-scanner": {
        id: "flow-scanner",
        activeLineCount: 7,
        maxLines: 40,
        effectiveMaxLines: 35,
        remainingLineCount: 28,
      },
    },
  });

  assert.equal(normalized.flowScanner.used, 7);
  assert.equal(normalized.signalOptions.used, 3);
  assert.equal(normalized.signalOptions.effectiveCap, 35);
  assert.equal(normalized.signalOptions.requestedLineCount, 5);
  assert.equal(normalized.signalOptions.rejectedCount, 1);
  assert.equal(normalized.signalOptions.cacheFallbackCount, 2);
  assert.equal(normalized.signalOptions.streamState, "capacity-limited");
});

test("normalizes cap-zero convenience usage as elastic slack", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 84,
    budget: {
      maxLines: 190,
      targetFillLines: 190,
    },
    lineAllocation: {
      protectedLineCount: 100,
      elasticLineCount: 84,
      reclaimableElasticLineCount: 80,
      sharedElasticLineCount: 4,
      elasticTargetLineCapacity: 90,
      elasticRemainingLineCount: 10,
      fillerLineCount: 54,
      reclaimableFillerLineCount: 52,
    },
    convenienceLineCount: 84,
    fillerLineCount: 54,
    poolUsage: {
      convenience: {
        id: "convenience",
        label: "Convenience",
        activeLineCount: 84,
        maxLines: 0,
        effectiveMaxLines: 90,
        remainingLineCount: 10,
        elastic: true,
        reclaimableLineCount: 80,
        sharedLineCount: 4,
      },
    },
  });

  assert.equal(normalized.allocation.elasticLineCount, 84);
  assert.equal(normalized.allocation.reclaimableElasticLineCount, 80);
  assert.equal(normalized.pools.convenience.used, 80);
  assert.equal(normalized.pools.convenience.activeLineCount, 84);
  assert.equal(normalized.pools.convenience.cap, 90);
  assert.equal(normalized.pools.convenience.effectiveCap, 90);
  assert.equal(normalized.pools.convenience.free, 10);
  assert.equal(normalized.pools.convenience.elastic, true);
  assert.equal(normalized.pools.convenience.streamState, "capacity-limited");
  assert.equal(
    normalized.pools.convenience.detail,
    "84 active of 80 reclaimable",
  );
});

test("uses API-active lines as canonical while retaining bridge reconciliation", () => {
  const normalized = normalizeAdmissionDiagnostics(
    {
      activeLineCount: 143,
      budget: {
        maxLines: 190,
        bridgeLineBudget: 190,
        flowScannerLineCap: 100,
      },
      accountMonitorLineCount: 3,
      flowScannerLineCount: 10,
      poolUsage: {
        "account-monitor": {
          id: "account-monitor",
          activeLineCount: 3,
          maxLines: 10,
          remainingLineCount: 7,
        },
        "flow-scanner": {
          id: "flow-scanner",
          activeLineCount: 10,
          maxLines: 100,
          effectiveMaxLines: 40,
          remainingLineCount: 30,
        },
      },
    },
    {
      bridge: {
        activeLineCount: 15,
        lineBudget: 190,
        remainingLineCount: 175,
        diagnostics: {
          pressure: "stalled",
          subscriptions: {
            activeEquitySubscriptions: 14,
            activeOptionSubscriptions: 1,
            prewarmSymbolCount: 12,
          },
        },
      },
      drift: {
        admissionVsBridgeLineDelta: 128,
        reconciliation: {
          status: "api_active_bridge_missing",
          apiLineCount: 143,
          bridgeLineCount: 15,
        },
      },
    },
  );

  assert.equal(normalized.summary, "143 of 190");
  assert.equal(normalized.activeLineCount, 143);
  assert.equal(normalized.requestedLineCount, 143);
  assert.equal(normalized.pendingLineCount, 128);
  assert.equal(normalized.requestedSummary, "143 of 190");
  assert.equal(normalized.demandSummary, "143 of 190");
  assert.equal(normalized.bridge.summary, "15 of 190");
  assert.equal(normalized.bridge.activeOptions, 1);
  assert.equal(normalized.bridge.prewarm, 12);
  assert.equal(normalized.drift.status, "api_active_bridge_missing");
  assert.equal(normalized.drift.label, "pending bridge");
  assert.equal(normalized.flowScanner.effectiveCap, 40);
});

test("normalizes bridge warm-up coverage from line usage diagnostics", () => {
  const normalized = normalizeAdmissionDiagnostics(
    {
      activeLineCount: 6,
      budget: { maxLines: 190 },
      accountMonitorLineCount: 2,
      poolUsage: {
        "account-monitor": {
          id: "account-monitor",
          activeLineCount: 2,
          maxLines: 10,
        },
      },
    },
    {
      warmup: {
        state: "pending",
        targetLineCount: 6,
        activeBridgeLineCount: 3,
        pendingLineCount: 3,
        accountTargetLineCount: 2,
        accountPendingLineCount: 1,
        visibleTargetLineCount: 4,
        visiblePendingLineCount: 2,
        targetSymbolCount: 6,
      },
    },
  );

  assert.equal(normalized.warmup.available, true);
  assert.equal(normalized.warmup.state, "pending");
  assert.equal(normalized.warmup.label, "pending bridge");
  assert.equal(normalized.warmup.pendingLineCount, 3);
  assert.equal(normalized.warmup.accountPendingLineCount, 1);
  assert.equal(normalized.warmup.summary, "3 / 6 covered");
  assert.equal(normalized.warmup.pendingSummary, "3 pending");
});

test("recognizes backend flow scanner diagnostics as active", () => {
  assert.equal(
    isOptionsFlowScannerRuntimeActive({
      optionsFlowScanner: {
        enabled: true,
        started: true,
        deepScanner: { draining: true, queuedCount: 12 },
      },
    }),
    true,
  );
  assert.equal(
    isOptionsFlowScannerRuntimeActive({
      optionsFlowScanner: {
        enabled: true,
        started: false,
      },
    }),
    false,
  );
});

test("normalizes legacy admission by adding account monitor and adjusting visible once", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 100,
    budget: { maxLines: 200, flowScannerLineCap: 40 },
    flowScannerLineCount: 0,
    poolUsage: {
      visible: {
        id: "visible",
        label: "Visible",
        activeLineCount: 40,
        maxLines: 108,
        remainingLineCount: 68,
      },
    },
  });

  assert.equal(normalized.legacyNormalized, true);
  assert.equal(normalized.accountMonitor.used, 0);
  assert.equal(normalized.accountMonitor.cap, 20);
  assert.equal(normalized.accountMonitor.legacyNormalized, true);
  assert.equal(normalized.pools.visible.cap, 88);
  assert.equal(normalized.pools.visible.free, 48);
});

test("prefers explicit line usage admission for realtime line counts", () => {
  const selected = selectRuntimeAdmissionDiagnostics({
    runtimeDiagnostics: {
      ibkr: {
        streams: {
          marketDataAdmission: {
            accountMonitorLineCount: 3,
            budget: { accountMonitorLineCap: 20 },
          },
        },
      },
    },
    lineUsageSnapshot: {
      admission: {
        accountMonitorLineCount: 9,
        budget: { accountMonitorLineCap: 20 },
      },
    },
  });

  assert.equal(selected.accountMonitorLineCount, 9);
});

test("uses runtime admission when no explicit line usage snapshot exists", () => {
  const selected = selectRuntimeAdmissionDiagnostics({
    runtimeDiagnostics: {
      ibkr: {
        streams: {
          marketDataAdmission: {
            accountMonitorLineCount: 3,
            budget: { accountMonitorLineCap: 20 },
          },
        },
      },
    },
  });

  assert.equal(selected.accountMonitorLineCount, 3);
});

test("falls back to line usage snapshot when runtime admission is legacy", () => {
  const selected = selectRuntimeAdmissionDiagnostics({
    runtimeDiagnostics: {
      ibkr: {
        streams: {
          marketDataAdmission: {
            budget: { maxLines: 200 },
            poolUsage: { visible: { maxLines: 108 } },
          },
        },
      },
    },
    lineUsageSnapshot: {
      admission: {
        accountMonitorLineCount: 9,
        budget: { accountMonitorLineCap: 20 },
      },
    },
  });

  assert.equal(selected.accountMonitorLineCount, 9);
});

test("builds runtime control snapshot with root line usage governor", () => {
  const snapshot = buildRuntimeControlSnapshot({
    lineUsageSnapshot: {
      governor: {
        account: { active: 1, queued: 0 },
      },
      admission: {
        activeLineCount: 10,
        budget: { maxLines: 200 },
      },
    },
    brokerStreamFreshness: {
      accountFresh: true,
      orderFresh: true,
      accountLastEventAt: 1,
      orderLastEventAt: 2,
    },
  });

  assert.equal(snapshot.bridgeGovernor.account.active, 1);
  assert.equal(snapshot.streams.tradingFresh, true);
});

test("exposes active flow scanner when backend scanner is running", () => {
  const snapshot = buildRuntimeControlSnapshot({
    lineUsageSnapshot: {
      admission: {
        activeLineCount: 12,
        flowScannerLineCount: 0,
        budget: { maxLines: 200, flowScannerLineCap: 40 },
        optionsFlowScanner: {
          enabled: true,
          started: true,
          scannerAlwaysOn: true,
        },
      },
    },
    flowScannerControl: {
      enabled: true,
      ownerActive: false,
      config: { intervalMs: 15_000, mode: "all_watchlists_plus_universe", scope: "unusual" },
    },
  });

  assert.equal(snapshot.flowScanner.ownerActive, false);
  assert.equal(snapshot.flowScanner.backendActive, true);
  assert.equal(snapshot.flowScanner.active, true);
});
