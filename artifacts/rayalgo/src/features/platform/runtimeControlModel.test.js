import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRuntimeControlSnapshot,
  isOptionsFlowScannerRuntimeActive,
  normalizeAdmissionDiagnostics,
  selectRuntimeAdmissionDiagnostics,
} from "./runtimeControlModel.js";

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

  assert.equal(normalized.summary, "100 / 200");
  assert.equal(normalized.accountMonitor.used, 12);
  assert.equal(normalized.accountMonitor.cap, 20);
  assert.equal(normalized.flowScanner.used, 34);
  assert.equal(normalized.pools.visible.cap, 88);
  assert.equal(normalized.total.free, 100);
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
      radarEnabled: true,
      lastSkippedReason: "market-data-not-live",
    },
  });

  assert.equal(
    normalized.flowScanner.detail,
    "skipped: market-data-not-live",
  );
});

test("recognizes backend flow scanner diagnostics as active", () => {
  assert.equal(
    isOptionsFlowScannerRuntimeActive({
      optionsFlowScanner: {
        enabled: true,
        started: true,
        radarEnabled: true,
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
        radarEnabled: true,
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
          radarEnabled: true,
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
