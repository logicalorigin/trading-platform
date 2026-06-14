import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHeaderIbkrPopoverModel,
  buildHeaderIbkrTriggerModel,
} from "./ibkrPopoverModel.js";
import { normalizeAdmissionDiagnostics } from "./runtimeControlModel.js";

const readyConnection = {
  configured: true,
  reachable: true,
  authenticated: true,
  accountsLoaded: true,
  accounts: [{ id: "DU1234567" }],
  bridgeReachable: true,
  socketConnected: true,
  brokerServerConnected: true,
  configuredLiveMarketDataMode: true,
  healthFresh: true,
  streamFresh: true,
  streamState: "live",
  strictReady: true,
  lastPingMs: 42,
};

const compactLineUsageSnapshot = {
  admission: {
    activeLineCount: 12,
    accountMonitorLineCount: 4,
    budget: {
      maxLines: 200,
      accountMonitorLineCap: 30,
      bridgeLineBudget: 200,
    },
    poolUsage: {
      "account-monitor": {
        id: "account-monitor",
        activeLineCount: 4,
        maxLines: 30,
      },
    },
  },
  bridge: {
    activeLineCount: 12,
    lineBudget: 200,
    remainingLineCount: 188,
  },
  drift: {
    reconciliation: {
      status: "matched",
      apiLineCount: 12,
      bridgeLineCount: 12,
      matchedLineCount: 12,
    },
  },
};

test("closed IBKR trigger model avoids detailed popover diagnostics", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: readyConnection,
    runtimeDiagnostics: null,
    runtimeError: null,
  });

  assert.equal(model.health.status, "healthy");
  assert.deepEqual(model.tiles, []);
  assert.deepEqual(model.providerRows, []);
  assert.deepEqual(model.detailGroups, []);
  assert.equal(model.lineUsage, null);
  assert.equal(model.compactLineUsage, null);
});

test("closed IBKR trigger model exposes compact line usage when a snapshot is available", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: readyConnection,
    runtimeDiagnostics: null,
    runtimeError: null,
    lineUsageSnapshot: compactLineUsageSnapshot,
  });

  assert.equal(model.health.status, "healthy");
  assert.equal(model.lineUsage?.summary, "12 of 200");
  assert.equal(model.compactLineUsage?.summary, "12 of 200");
});

test("closed IBKR trigger treats full matched bridge usage as healthy", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: readyConnection,
    runtimeDiagnostics: null,
    runtimeError: null,
    lineUsageSnapshot: {
      ...compactLineUsageSnapshot,
      admission: {
        ...compactLineUsageSnapshot.admission,
        activeLineCount: 200,
      },
      bridge: {
        activeLineCount: 200,
        lineBudget: 200,
        remainingLineCount: 0,
      },
      drift: {
        reconciliation: {
          status: "matched",
          apiLineCount: 200,
          bridgeLineCount: 200,
          matchedLineCount: 200,
        },
      },
    },
  });

  assert.equal(model.lineUsage?.bridge?.streamState, "healthy");
  assert.equal(model.lineUsage?.bridge?.tone, "var(--ra-stream-healthy)");
  assert.equal(model.compactLineUsage?.summary, "200 of 200");
  assert.equal(model.compactLineUsage?.tone, "var(--ra-stream-healthy)");
});

test("closed IBKR trigger shows settling line churn without hard drift tone", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: readyConnection,
    runtimeDiagnostics: null,
    runtimeError: null,
    lineUsageSnapshot: {
      ...compactLineUsageSnapshot,
      drift: {
        reconciliation: {
          status: "settling",
          settling: true,
          apiLineCount: 200,
          bridgeLineCount: 200,
          matchedLineCount: 134,
          apiOnlyLineCount: 66,
          bridgeOnlyLineCount: 66,
          persistentApiOnlyLineCount: 0,
          persistentBridgeOnlyLineCount: 0,
        },
      },
    },
  });

  assert.equal(model.lineUsage?.drift?.status, "settling");
  assert.equal(model.lineUsage?.drift?.state, "checking");
  assert.equal(model.lineUsage?.drift?.tone, "var(--ra-stream-checking)");
});

test("closed IBKR trigger does not fall back to app demand when bridge usage is unavailable", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: readyConnection,
    runtimeDiagnostics: null,
    runtimeError: null,
    lineUsageSnapshot: {
      admission: {
        activeLineCount: 2,
        budget: {
          maxLines: 200,
        },
      },
      bridge: {
        activeLineCount: null,
        lineBudget: null,
        remainingLineCount: null,
        error: "HTTP 502 Bad Gateway: error code: 502",
      },
    },
  });

  assert.equal(model.lineUsage?.summary, "2 of 200");
  assert.equal(model.compactLineUsage?.summary, "—");
});

test("closed IBKR trigger treats unreachable backed off bridge health as offline", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: {
      configured: true,
      reachable: false,
      authenticated: false,
      accounts: [],
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        runtimeOverrideActive: true,
        desktopAgentOnline: true,
        desktopAgentUpgradeRequired: true,
        healthFresh: false,
        healthError: "IBKR bridge health work is backed off.",
        healthErrorCode: "ibkr_bridge_work_backoff",
        healthErrorDetail: "Bridge health work is backed off for 9198ms.",
        bridgeReachable: false,
        socketConnected: false,
        brokerServerConnected: false,
        connected: false,
        authenticated: false,
        accountsLoaded: false,
        streamFresh: false,
        streamState: "reconnect_needed",
        streamStateReason: "bridge_unreachable",
        strictReady: false,
        strictReason: "health_error",
      },
    },
    runtimeError: null,
  });

  assert.equal(model.health.status, "offline");
  assert.equal(model.health.label, "Offline");
  assert.equal(model.issue.key, "offline");
  assert.equal(model.issue.severity, "error");
  assert.match(model.issue.label, /not reachable/i);
});

test("closed IBKR trigger treats active bridge context with missing health proof as pending", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: {
      configured: true,
      reachable: false,
      authenticated: false,
      accounts: [],
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        runtimeOverrideActive: true,
        desktopAgentOnline: true,
        desktopAgentUpgradeRequired: false,
        healthFresh: false,
        bridgeReachable: false,
        socketConnected: false,
        brokerServerConnected: false,
        connected: false,
        authenticated: false,
        accountsLoaded: false,
        streamFresh: false,
        streamState: "checking",
        streamStateReason: "health_pending",
        strictReady: false,
        strictReason: "health_unavailable",
      },
    },
    runtimeError: null,
  });

  assert.equal(model.health.status, "stale");
  assert.equal(model.health.label, "Health Pending");
  assert.notEqual(model.issue.key, "offline");
  assert.equal(model.issue.severity, "warning");
});

test("open IBKR popover labels active bridge health checks as pending, not server offline", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: false,
      authenticated: false,
      accounts: [],
    },
    latencyStats: null,
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        runtimeOverrideActive: true,
        desktopAgentOnline: true,
        desktopAgentUpgradeRequired: false,
        healthFresh: false,
        bridgeReachable: false,
        socketConnected: false,
        brokerServerConnected: false,
        connected: false,
        authenticated: false,
        accountsLoaded: false,
        streamFresh: false,
        streamState: "checking",
        streamStateReason: "health_pending",
        strictReady: false,
        strictReason: "health_unavailable",
      },
    },
    runtimeError: null,
    lineUsageSnapshot: null,
  });

  const gatewayTile = model.tiles.find((tile) => tile.label === "Gateway");
  assert.equal(model.health.label, "Health Pending");
  assert.equal(gatewayTile?.value, "Health pending");
  assert.notEqual(gatewayTile?.value, "Server offline");
});

test("closed IBKR trigger surfaces dead tunnel failures instead of pending bridge wording", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: {
      configured: true,
      reachable: false,
      authenticated: false,
      accounts: [],
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        runtimeOverrideActive: true,
        desktopAgentOnline: true,
        desktopAgentUpgradeRequired: false,
        healthFresh: false,
        healthError: "IBKR bridge health is temporarily backed off.",
        healthErrorCode: "ibkr_bridge_health_backoff",
        healthErrorDetail: "Bridge health checks are backed off for 2416ms.",
        bridgeReachable: false,
        socketConnected: false,
        brokerServerConnected: false,
        connected: false,
        authenticated: false,
        accountsLoaded: false,
        streamFresh: false,
        streamState: "reconnect_needed",
        streamStateReason: "bridge_unreachable",
        strictReady: false,
        strictReason: "health_error",
        governor: {
          health: {
            lastFailure: "HTTP 530 <none>: error code: 1033",
          },
        },
      },
    },
    runtimeError: null,
  });

  assert.equal(model.health.status, "offline");
  assert.equal(model.health.label, "Offline");
  assert.equal(model.issue.key, "offline");
  assert.equal(model.issue.severity, "error");
  assert.match(model.issue.label, /HTTP 530/);
});

test("closed IBKR trigger still marks an unreachable inactive bridge offline", () => {
  const model = buildHeaderIbkrTriggerModel({
    connection: {
      configured: true,
      reachable: false,
      authenticated: false,
      accounts: [],
    },
    runtimeDiagnostics: {
      ibkr: {
        configured: true,
        bridgeUrlConfigured: true,
        runtimeOverrideActive: false,
        desktopAgentOnline: false,
        healthFresh: false,
        healthError: "connect ECONNREFUSED 127.0.0.1:5001",
        healthErrorCode: "ECONNREFUSED",
        bridgeReachable: false,
        socketConnected: false,
        brokerServerConnected: false,
        connected: false,
        authenticated: false,
        accountsLoaded: false,
        streamFresh: false,
        streamState: "reconnect_needed",
        streamStateReason: "bridge_unreachable",
        strictReady: false,
        strictReason: "bridge_unreachable",
      },
    },
    runtimeError: null,
  });

  assert.equal(model.health.status, "offline");
  assert.equal(model.health.label, "Offline");
  assert.equal(model.issue.key, "offline");
  assert.equal(model.issue.severity, "error");
});

test("line usage rows display shared app headroom instead of per-pool ceilings", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 30,
    accountMonitorLineCount: 5,
    flowScannerLineCount: 25,
    automationExecutionLineCount: 0,
    automationLineCount: 0,
    accountMonitor: {
      neededLineCount: 5,
      coveredLineCount: 5,
    },
    budget: {
      maxLines: 200,
      flowScannerLineCap: 200,
    },
    poolUsage: {
      automation: {
        id: "automation",
        activeLineCount: 0,
        maxLines: 200,
        effectiveMaxLines: 200,
        remainingLineCount: 200,
      },
      "account-monitor": {
        id: "account-monitor",
        activeLineCount: 5,
        maxLines: 200,
        effectiveMaxLines: 200,
        remainingLineCount: 195,
      },
      visible: {
        id: "visible",
        activeLineCount: 0,
        maxLines: 200,
        effectiveMaxLines: 200,
        remainingLineCount: 200,
      },
      "flow-scanner": {
        id: "flow-scanner",
        activeLineCount: 25,
        maxLines: 200,
        effectiveMaxLines: 195,
        remainingLineCount: 170,
      },
    },
  });

  const rows = Object.fromEntries(normalized.rows.map((row) => [row.id, row]));

  assert.equal(rows.visible.label, "Trade Options Chain");
  assert.deepEqual(
    {
      active: rows["account-monitor"].displayActive,
      usable: rows["account-monitor"].displayAvailable,
      headroom: rows["account-monitor"].displayFree,
    },
    { active: 5, usable: 5, headroom: 0 },
  );
  assert.deepEqual(
    {
      active: rows.visible.displayActive,
      usable: rows.visible.displayAvailable,
      headroom: rows.visible.displayFree,
    },
    { active: 0, usable: 170, headroom: 170 },
  );
  assert.deepEqual(
    {
      active: rows["flow-scanner"].displayActive,
      usable: rows["flow-scanner"].displayAvailable,
      headroom: rows["flow-scanner"].displayFree,
    },
    { active: 25, usable: 195, headroom: 170 },
  );
  assert.deepEqual(
    {
      active: rows.total.displayActive,
      usable: rows.total.displayAvailable,
      headroom: rows.total.displayFree,
    },
    { active: 30, usable: 200, headroom: 170 },
  );
});

test("line usage warning count ignores expected scanner rotation demotions", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 200,
    budget: {
      maxLines: 200,
    },
    counters: {
      "flow-scanner-live": {
        admitted: 300,
        rejected: 0,
        demoted: 270,
        released: 0,
        expired: 0,
        fallback: 0,
      },
    },
    recentEvents: [
      {
        action: "demoted",
        reason: "flow_scanner_rotated",
        intent: "flow-scanner-live",
        pool: "flow-scanner",
      },
      {
        action: "demoted",
        reason: "flow_scanner_underlying_rotated",
        intent: "flow-scanner-live",
        pool: "flow-scanner",
      },
    ],
  });

  assert.equal(normalized.warnings, 0);
  assert.equal(normalized.total.streamState, "capacity-limited");
});

test("line usage warning count keeps real recent admission failures", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 199,
    budget: {
      maxLines: 200,
    },
    counters: {
      "flow-scanner-live": {
        admitted: 300,
        rejected: 0,
        demoted: 270,
        released: 0,
        expired: 0,
        fallback: 0,
      },
    },
    recentEvents: [
      {
        action: "rejected",
        reason: "budget",
        intent: "flow-scanner-live",
        pool: "flow-scanner",
      },
    ],
  });

  assert.equal(normalized.warnings, 1);
});

test("Trade Options Chain demand is derived from live allocation, not budget defaults", () => {
  const normalized = normalizeAdmissionDiagnostics({
    activeLineCount: 0,
    budget: {
      maxLines: 200,
      visibleOptionQuoteLineReserve: 41,
      targetFillLines: 200,
    },
    poolUsage: {
      visible: {
        id: "visible",
        activeLineCount: 0,
        maxLines: 200,
        effectiveMaxLines: 200,
        remainingLineCount: 200,
      },
      "flow-scanner": {
        id: "flow-scanner",
        activeLineCount: 0,
        maxLines: 200,
        effectiveMaxLines: 200,
        remainingLineCount: 200,
      },
    },
  });

  assert.equal(normalized.allocation.tradeOptionsChainReserveLineCount, null);
  assert.equal(normalized.allocation.optionReserveLineCount, null);
});

test("account monitor needed count falls back to warm-up target demand", () => {
  const normalized = normalizeAdmissionDiagnostics(
    {
      activeLineCount: 0,
      accountMonitorLineCount: 0,
      accountMonitor: {
        neededLineCount: 0,
        coveredLineCount: 0,
      },
      budget: {
        maxLines: 200,
        accountMonitorLineCap: 200,
      },
      poolUsage: {
        "account-monitor": {
          id: "account-monitor",
          activeLineCount: 0,
          maxLines: 200,
          effectiveMaxLines: 200,
          remainingLineCount: 200,
        },
      },
    },
    {
      accountMonitor: {
        targetLineCount: 8,
        pendingLineCount: 8,
      },
      warmup: {
        accountTargetLineCount: 8,
        accountPendingLineCount: 8,
      },
    },
  );

  const rows = Object.fromEntries(normalized.rows.map((row) => [row.id, row]));

  assert.equal(rows["account-monitor"].needed, 8);
  assert.equal(rows["account-monitor"].covered, 0);
  assert.equal(rows["account-monitor"].detail, "0 covered of 8 needed");
});

test("closed IBKR trigger model surfaces live Massive provider status", () => {
  // Regression: the trigger model used to hardcode massive:null, so the
  // always-visible footer showed "No checks yet" while the popover was closed
  // even when Massive was streaming. Massive status comes from runtimeDiagnostics
  // (polled regardless of popover), so it must be populated here.
  const model = buildHeaderIbkrTriggerModel({
    connection: readyConnection,
    runtimeDiagnostics: {
      providers: {
        massive: {
          configured: true,
          rest: { status: "ok" },
          websocket: {
            status: "ok",
            configured: true,
            activeChannels: ["AM", "Q", "T"],
          },
        },
      },
    },
    runtimeError: null,
  });

  assert.ok(model.massive, "trigger model should expose massive status");
  assert.equal(model.massive.status, "ok");
});

test("open IBKR popover model keeps detailed stream diagnostics", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: readyConnection,
    latencyStats: {
      bridgeToApiMs: { p50: 10, p95: 15 },
      apiToReactMs: { p50: 4, p95: 8 },
      totalMs: { p50: 20, p95: 30 },
      stream: {
        activeConsumerCount: 1,
        unionSymbolCount: 3,
        eventCount: 7,
        streamGapCount: 0,
        maxGapMs: 0,
        lastEventAgeMs: 100,
      },
    },
    runtimeDiagnostics: null,
    runtimeError: null,
    lineUsageSnapshot: null,
  });

  assert.ok(model.tiles.some((tile) => tile.label === "Stream"));
  assert.ok(model.detailGroups.some((group) => group.title === "Stream"));
});
