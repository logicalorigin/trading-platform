import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHeaderIbkrPopoverModel,
  buildHeaderIbkrTriggerModel,
} from "./ibkrPopoverModel.js";
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
  });

  const gatewayTile = model.tiles.find((tile) => tile.label === "Gateway");
  assert.equal(model.health.label, "Health Pending");
  assert.equal(gatewayTile?.value, "Health pending");
  assert.notEqual(gatewayTile?.value, "Server offline");
});

test("closed IBKR trigger treats active bridge health backoff as pending", () => {
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
        lastError: "HTTP 502 Bad Gateway: error code: 502",
      },
    },
    runtimeError: null,
  });

  assert.equal(model.health.status, "stale");
  assert.equal(model.health.label, "Health Pending");
  assert.equal(model.issue.key, "stale");
  assert.equal(model.issue.severity, "warning");
  assert.match(model.issue.label, /HTTP 502/);
});

test("open IBKR popover does not call active bridge health backoff server offline", () => {
  const model = buildHeaderIbkrPopoverModel({
    connection: {
      configured: true,
      reachable: false,
      authenticated: false,
      accounts: [],
    },
    latencyStats: {
      stream: {
        activeConsumerCount: 1,
        unionSymbolCount: 500,
        eventCount: 42,
        streamGapCount: 0,
        lastEventAgeMs: 100,
      },
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
        healthErrorDetail: "Bridge health checks are backed off for 1974ms.",
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
        lastError: "HTTP 502 Bad Gateway: error code: 502",
      },
    },
    runtimeError: null,
  });

  const gatewayTile = model.tiles.find((tile) => tile.label === "Gateway");
  const streamTile = model.tiles.find((tile) => tile.label === "Stream");
  assert.equal(model.health.status, "stale");
  assert.equal(model.health.label, "Health Pending");
  assert.equal(gatewayTile?.value, "Health pending");
  assert.notEqual(gatewayTile?.value, "Server offline");
  assert.equal(streamTile?.value, "1 consumer · 500 symbols");
  assert.match(model.issue.label, /HTTP 502/);
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
  });

  const streamTile = model.tiles.find((tile) => tile.label === "Stream");
  assert.equal(streamTile?.value, "1 consumer · 3 symbols");
  assert.ok(!streamTile.value.includes("/"));

  const streamGroup = model.detailGroups.find((group) => group.title === "Stream");
  assert.ok(streamGroup);
  assert.ok(
    streamGroup.rows.some((row) => row.label === "Consumers" && row.value === "1"),
  );
  assert.ok(
    streamGroup.rows.some((row) => row.label === "Symbols" && row.value === "3"),
  );
});
