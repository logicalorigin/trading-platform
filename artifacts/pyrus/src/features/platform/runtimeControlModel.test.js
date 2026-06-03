import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildRuntimeControlSnapshot,
  isOptionsFlowScannerRuntimeActive,
  lineUsageState,
  lineUsageUtilizationLevel,
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
    "../../screens/algo/AlgoSettingsRegion.jsx",
    "../../screens/algo/algoSettingsFields.js",
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
    portfolio: {
      policy: "pinned-priority-scanner-rotation",
      pinned: { activeLineCount: 12 },
      priority: { activeLineCount: 54 },
      scannerRotating: { activeLineCount: 34 },
      rotatingReclaimableLineCount: 34,
    },
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
  assert.equal("watchlist" in normalized.pools, false);
  assert.equal("convenience" in normalized.pools, false);
  assert.equal(normalized.total.free, 100);
  assert.equal(normalized.allocation.targetFillLines, 200);
  assert.equal(normalized.allocation.remainingToTargetLineCount, 100);
  assert.equal(normalized.allocation.portfolioPolicy, "pinned-priority-scanner-rotation");
  assert.equal(normalized.allocation.pinnedLineCount, 12);
  assert.equal(normalized.allocation.priorityLineCount, 54);
  assert.equal(normalized.allocation.scannerRotatingLineCount, 34);
  assert.equal(normalized.allocation.rotatingReclaimableLineCount, 34);
  assert.equal("fillerLineCount" in normalized.allocation, false);
});

test("does not build retired watchlist or convenience rows from legacy payloads", () => {
  const normalized = normalizeAdmissionDiagnostics(
    {
      activeLineCount: 160,
      visibleLineCount: 120,
      watchlistLineCount: 0,
      budget: {
        maxLines: 200,
        visibleLineCap: 120,
        watchlistLineCap: 0,
        flowScannerLineCap: 80,
      },
      poolUsage: {
        visible: {
          id: "visible",
          label: "Visible",
          activeLineCount: 120,
          maxLines: 120,
          remainingLineCount: 0,
        },
        watchlist: {
          id: "watchlist",
          label: "Watchlist",
          activeLineCount: 0,
          maxLines: 0,
          effectiveMaxLines: 0,
          remainingLineCount: 0,
          strict: true,
        },
        convenience: {
          id: "convenience",
          label: "Convenience",
          activeLineCount: 40,
          maxLines: 0,
          effectiveMaxLines: 40,
          remainingLineCount: 0,
        },
      },
    },
    {
      watchlistPrewarm: {
        primaryActiveSymbolCount: 117,
        primarySymbolLimit: 120,
      },
    },
  );

  assert.equal("watchlist" in normalized.pools, false);
  assert.equal("convenience" in normalized.pools, false);
  assert.deepEqual(
    normalized.rows.map((row) => row.id),
    ["automation", "account-monitor", "visible", "flow-scanner", "total"],
  );
});

test("runtime control rows omit retired stock-line groups", () => {
  const snapshot = buildRuntimeControlSnapshot({
    lineUsageSnapshot: {
      admission: {
        activeLineCount: 121,
        accountMonitorLineCount: 5,
        visibleLineCount: 120,
        watchlistLineCount: 0,
        flowScannerLineCount: 0,
        budget: {
          maxLines: 200,
          accountMonitorLineCap: 5,
          visibleLineCap: 120,
          watchlistLineCap: 0,
          flowScannerLineCap: 80,
        },
        poolUsage: {
          "account-monitor": {
            id: "account-monitor",
            activeLineCount: 5,
            maxLines: 5,
            remainingLineCount: 0,
          },
          visible: {
            id: "visible",
            activeLineCount: 120,
            maxLines: 120,
            remainingLineCount: 0,
          },
          "flow-scanner": {
            id: "flow-scanner",
            activeLineCount: 0,
            maxLines: 80,
            remainingLineCount: 80,
          },
        },
      },
      watchlistPrewarm: {
        primaryActiveSymbolCount: 118,
      },
    },
  });

  assert.equal("watchlist" in snapshot.lineUsage.pools, false);
  assert.equal("convenience" in snapshot.lineUsage.pools, false);
  assert.deepEqual(
    snapshot.lineUsage.rows.map((row) => row.id),
    ["automation", "account-monitor", "visible", "flow-scanner", "total"],
  );
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

test("normalizes the shared Algo & Execution row from bundle diagnostics", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 12,
    automationExecutionLineCount: 7,
    automationLineCount: 4,
    executionLineCount: 3,
    budget: {
      maxLines: 200,
      automationExecutionLineCap: 30,
    },
    poolUsage: {
      automation: {
        id: "automation",
        activeLineCount: 4,
        maxLines: 30,
        effectiveMaxLines: 30,
        remainingLineCount: 23,
      },
    },
  });

  assert.equal(normalized.pools.automation.label, "Algo & Execution");
  assert.equal(normalized.pools.automation.used, 7);
  assert.equal(normalized.pools.automation.cap, 30);
  assert.equal(normalized.pools.automation.free, 23);
  assert.equal(normalized.pools.automation.detail, "3 execution · 4 algo");
});

test("adds flow scanner runtime detail when active leases are zero", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 12,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 40,
      automationExecutionLineCap: 30,
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      lastSkippedReason: "market-data-not-live",
    },
  });

  assert.equal(normalized.flowScanner.detail, "skipped: market data not live");
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
        snapshotCount: 4,
      },
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "2 option-chain scans active; quotes warming",
  );
});

test("shows current flow scanner pause ahead of a stale transport skip reason", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 80,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 80,
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      backgroundBlockedReason: "line-cap-exhausted",
      lastSkippedReason: "transport-unavailable",
    },
  });

  assert.equal(normalized.flowScanner.detail, "paused: no scanner lines available");
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
    "3 option-chain scans active; quotes warming",
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
        snapshotCount: 5,
      },
    },
  });

  assert.equal(normalized.flowScanner.detail, "paused: no scanner lines available");
});

test("scanner session quiet renders as a data-line detail", () => {
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
      sessionBlockReason: "market-session-quiet",
      coverage: {
        cycleScannedSymbols: 30,
        activeTargetSize: 94,
        lastScanAgeMs: 12_000,
      },
      deepScanner: {
        lastRunAt: "2026-06-02T20:30:00.000Z",
        snapshotCount: 0,
      },
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "market session quiet; 30 of 94 covered, last 12s ago",
  );
});

test("scanner session quiet reads radar coverage from live diagnostics", () => {
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
      sessionBlockReason: "market-session-quiet",
      lastScanAgeMs: 4_500,
      radar: {
        scannedSymbols: 60,
        selectedSymbols: 94,
      },
      deepScanner: {
        lastRunAt: "2026-06-02T20:30:00.000Z",
        snapshotCount: 0,
      },
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "market session quiet; 60 of 94 covered, last 5s ago",
  );
});

test("active scanner rotation renders coverage as a data-line detail", () => {
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
      lastScanAgeMs: 12_300,
      coverage: {
        cycleScannedSymbols: 60,
        activeTargetSize: 94,
      },
      deepScanner: {
        lastRunAt: "2026-06-02T20:30:00.000Z",
        snapshotCount: 0,
      },
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "rotating; 60 of 94 covered, last 13s ago",
  );
});

test("radar quote batch fallback does not hide current scanner coverage", () => {
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
      lastScanAgeMs: 32_000,
      coverage: {
        cycleScannedSymbols: 94,
        activeTargetSize: 746,
        degradedReason: "radar-quote-batch-fallback",
      },
      radar: {
        degradedReason: "radar-quote-batch-fallback",
      },
      deepScanner: {
        lastRunAt: "2026-06-02T20:52:26.513Z",
        snapshotCount: 0,
      },
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "rotating; 94 of 746 covered, last 32s ago",
  );
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
      backgroundBlockedReason: "line-cap-exhausted",
      deepScanner: {
        draining: true,
        queuedCount: 7,
        snapshotCount: 4,
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

test("reports resource-pressure scanner degradation without idle quote-line copy", () => {
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
      backgroundBlockedReason: "resource-pressure",
      deepScanner: {
        draining: false,
        queuedCount: 0,
        activeCount: 0,
        snapshotCount: 0,
      },
    },
  });

  assert.equal(normalized.flowScanner.detail, "degraded: resource pressure");
});

test("reports flow scanner background pauses ahead of cached snapshots", () => {
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
      backgroundBlockedReason: "resource-pressure",
      deepScanner: {
        draining: false,
        queuedCount: 0,
        activeCount: 0,
        snapshotCount: 3,
      },
    },
  });

  assert.equal(normalized.flowScanner.detail, "degraded: resource pressure");
});

test("reports quiet market radar state ahead of cached snapshots", () => {
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
      radarDegradedReason: "market-session-quiet",
      coverage: {
        coverageHealth: "quiet",
        cycleScannedSymbols: 120,
        activeTargetSize: 500,
        lastScanAgeMs: 180_000,
      },
      deepScanner: {
        draining: false,
        queuedCount: 0,
        activeCount: 0,
        snapshotCount: 1,
      },
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "market session quiet; 120 of 500 covered, last 3m ago",
  );
});

test("reports active-session flow scanner coverage lag", () => {
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
      coverage: {
        coverageHealth: "lagging",
        cycleScannedSymbols: 7,
        activeTargetSize: 500,
        lastScanAgeMs: 360_000,
      },
      deepScanner: {
        draining: false,
        queuedCount: 0,
        activeCount: 0,
        snapshotCount: 0,
      },
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "coverage lagging: 7 of 500 covered, last 6m ago",
  );
});

test("reports failed flow scanner symbols when no current work is active", () => {
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
        draining: false,
        queuedCount: 0,
        activeCount: 0,
        snapshotCount: 0,
        lastFailedSymbols: ["NVDA", "QQQ", "SPY", "TSLA"],
      },
    },
  });

  assert.equal(normalized.flowScanner.detail, "last scan failed: NVDA, QQQ, SPY +1");
});

test("reports enabled flow scanner as rotating between batches", () => {
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
      lastBatch: ["SPY"],
      deepScanner: {
        draining: false,
        queuedCount: 0,
        activeCount: 0,
        snapshotCount: 0,
        lastRunAt: "2026-05-26T13:29:51.212Z",
      },
    },
  });

  assert.equal(normalized.flowScanner.detail, "rotating; awaiting next batch");
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
    "warming live data (2m); foreground scans allowed",
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
      utilizationLevel: "protected",
      utilizationPercent: 97.4,
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
  assert.equal(normalized.pressure.utilizationLevel, "protected");
  assert.equal(normalized.pressure.utilizationPercent, 97.4);
  assert.equal(normalized.pressure.budgetSource, "bridge-diagnostics");
  assert.equal(normalized.flowScanner.cap, 100);
  assert.equal(normalized.flowScanner.effectiveCap, 35);
  assert.equal(normalized.flowScanner.free, 15);
});

test("line utilization model keeps half usage healthy", () => {
  assert.equal(lineUsageState(100, 200), "healthy");
  assert.equal(lineUsageUtilizationLevel(100, 200, 100), "normal");
  assert.equal(lineUsageState(140, 200), "healthy");
  assert.equal(lineUsageUtilizationLevel(140, 200, 60), "watch");
  assert.equal(lineUsageState(176, 200), "capacity-limited");
  assert.equal(lineUsageUtilizationLevel(176, 200, 24), "constrained");
  assert.equal(lineUsageUtilizationLevel(190, 200, 10), "protected");
});

test("uses schedulable scanner capacity when filler holds reclaimable lines", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 200,
    flowScannerLineCount: 0,
    budget: {
      maxLines: 200,
      flowScannerLineCap: 40,
    },
    pressure: {
      scannerStaticLineCap: 40,
      scannerEffectiveLineCap: 0,
      scannerActiveLineCount: 0,
      scannerRemainingLineCount: 0,
    },
    lineAllocation: {
      reclaimableFillerLineCount: 80,
    },
    poolUsage: {
      "flow-scanner": {
        id: "flow-scanner",
        activeLineCount: 0,
        maxLines: 40,
        effectiveMaxLines: 0,
        remainingLineCount: 0,
      },
      convenience: {
        id: "convenience",
        activeLineCount: 80,
        reclaimableLineCount: 80,
        effectiveMaxLines: 80,
      },
    },
    optionsFlowScanner: {
      enabled: true,
      started: true,
      lineUtilization: {
        schedulablePoolCap: 40,
      },
      deepScanner: {
        snapshotCount: 12,
      },
    },
  });

  assert.equal(normalized.allocation.scannerEffectiveLineCap, 40);
  assert.equal(normalized.allocation.scannerSchedulableLineCap, 40);
  assert.equal(normalized.flowScanner.effectiveCap, 40);
  assert.equal(normalized.flowScanner.free, 40);
  assert.equal(
    normalized.flowScanner.detail,
    "12 cached flow snapshots",
  );
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
      automation: {
        id: "automation",
        activeLineCount: 3,
        maxLines: 30,
        effectiveMaxLines: 30,
        remainingLineCount: 27,
      },
    },
  });

  assert.equal(normalized.flowScanner.used, 7);
  assert.equal(normalized.signalOptions.used, 3);
  assert.equal(normalized.signalOptions.effectiveCap, 30);
  assert.equal(normalized.signalOptions.requestedLineCount, 5);
  assert.equal(normalized.signalOptions.rejectedCount, 1);
  assert.equal(normalized.signalOptions.cacheFallbackCount, 2);
  assert.equal(normalized.signalOptions.streamState, "capacity-limited");
});

test("normalizes shadow account quote usage separately from visible demand", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 4,
    budget: {
      maxLines: 200,
      visibleLineCap: 200,
    },
    shadowAccount: {
      activeLineCount: 2,
      leaseCount: 2,
      ownerCount: 2,
      recentRequestedLineCount: 2,
      recentRejectedCount: 0,
      activeFallbackProviderLineCounts: {
        cache: 2,
        massive: 0,
      },
    },
    ownerClasses: {
      summaries: {
        "shadow-account": {
          activeLineCount: 2,
        },
      },
    },
    allocation: {
      shadowAccountLineCount: 2,
      shadowAccountCacheFallbackLineCount: 2,
      shadowAccountMassiveFallbackLineCount: 0,
    },
    poolUsage: {
      visible: {
        id: "visible",
        activeLineCount: 4,
        maxLines: 200,
        effectiveMaxLines: 200,
        remainingLineCount: 196,
      },
    },
  });

  assert.equal(normalized.pools.visible.used, 4);
  assert.equal(normalized.shadowAccount.used, 2);
  assert.equal(normalized.shadowAccount.cacheFallbackLineCount, 2);
  assert.equal(normalized.shadowAccount.massiveFallbackLineCount, 0);
  assert.equal(normalized.shadowAccount.detail, "IBKR live · 2 cache fallback policy");
  assert.equal(normalized.shadowAccount.streamState, "healthy");
  assert.equal(normalized.allocation.shadowAccountLineCount, 2);
  assert.equal(normalized.allocation.shadowAccountCacheFallbackLineCount, 2);
});

test("drops obsolete convenience allocation fields from normalized rows", () => {
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

  assert.equal("elasticLineCount" in normalized.allocation, false);
  assert.equal("reclaimableElasticLineCount" in normalized.allocation, false);
  assert.equal("convenience" in normalized.pools, false);
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
  assert.equal(normalized.foregroundPendingLineCount, 128);
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
  assert.equal(normalized.foregroundPendingLineCount, 3);
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

test("recognizes flow scanner line leases as backend activity", () => {
  const snapshot = buildRuntimeControlSnapshot({
    lineUsageSnapshot: {
      admission: {
        activeLineCount: 50,
        budget: { maxLines: 200, flowScannerLineCap: 80 },
        poolUsage: {
          "flow-scanner": {
            id: "flow-scanner",
            activeLineCount: 48,
            maxLines: 80,
            effectiveMaxLines: 80,
          },
        },
      },
    },
    flowScannerControl: {
      enabled: true,
      ownerActive: false,
      config: { intervalMs: 15_000, mode: "all_watchlists_plus_universe" },
    },
  });

  assert.equal(snapshot.flowScanner.ownerActive, false);
  assert.equal(snapshot.flowScanner.backendActive, true);
  assert.equal(snapshot.flowScanner.active, true);
  assert.equal(snapshot.flowScanner.lineUsage.used, 48);
});

test("recognizes planned scanner horizon as backend activity", () => {
  assert.equal(
    isOptionsFlowScannerRuntimeActive({
      flowScannerLineCount: 0,
      optionsFlowScanner: {
        enabled: true,
        started: true,
        plannedHorizon: { symbolCount: 733 },
        deepScanner: { queuedCount: 0, activeCount: 0 },
      },
    }),
    true,
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
  assert.equal(normalized.accountMonitor.cap, 30);
  assert.equal(normalized.accountMonitor.legacyNormalized, true);
  assert.equal(normalized.pools.visible.cap, 78);
  assert.equal(normalized.pools.visible.free, 38);
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

test("builds runtime control snapshot with Massive diagnostics", () => {
  const snapshot = buildRuntimeControlSnapshot({
    runtimeDiagnostics: {
      providers: {
        massive: {
          configured: true,
          providerIdentity: "massive",
          baseUrlHost: "api.massive.com",
          stocksRealtimeConfigured: true,
          rest: {
            status: "ok",
            lastRequest: {
              purpose: "bars",
              symbol: "SPY",
              timeframe: "1 minute",
              resultCount: 2,
              durationMs: 42,
            },
            recentRequests: [],
          },
          websocket: {
            status: "ok",
            mode: "real-time",
            activeChannels: ["AM", "Q", "T"],
            availableChannels: ["AM", "Q", "T"],
            subscribedSymbolCount: 12,
            activeConsumerCount: 2,
            eventCount: 30,
            lastMessageAgeMs: 500,
          },
        },
      },
    },
  });

  assert.equal(snapshot.massive.configured, true);
  assert.equal(snapshot.massive.label, "OK");
  assert.equal(snapshot.massive.rest.lastRequestSummary, "bars SPY 1 minute · 2 rows");
  assert.equal(snapshot.massive.websocket.channelSummary, "AM, Q, T");
  assert.equal(snapshot.massive.websocket.subscribedSymbolCount, 12);
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
