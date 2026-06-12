import assert from "node:assert/strict";
import test from "node:test";

import { buildIbkrConnectionSnapshot } from "./ibkrConnectionSnapshot.js";

test("builds a ready broker runtime view from warm session state", () => {
  const session = {
    configured: { ibkr: true },
    environment: "paper",
    ibkrBridge: {
      connected: true,
      authenticated: true,
      accountsLoaded: true,
      bridgeReachable: true,
      socketConnected: true,
      brokerServerConnected: true,
      healthFresh: true,
      streamFresh: true,
      streamState: "live",
      strictReady: true,
      selectedAccountId: "DU1234567",
      accounts: [{ id: "DU1234567" }],
      marketDataMode: "live",
      liveMarketDataAvailable: true,
      configuredLiveMarketDataMode: true,
      connectionTarget: "127.0.0.1:4001",
      clientId: 42,
    },
    runtime: {
      ibkr: {
        runtimeOverrideActive: true,
        runtimeOverrideUpdatedAt: "2026-06-08T13:40:00.000Z",
        desktopAgentOnline: true,
        desktopAgentRegistered: true,
        desktopAgentRegisteredCount: 1,
        desktopAgentCompatibility: "compatible",
        desktopAgentCompatible: true,
        desktopAgentHelperVersion: "2026-06-07.ib-async-sidecar-v10-agent-self-update",
        desktopAgentKnownBad: false,
        desktopAgentExpectedHelperVersion:
          "2026-06-07.ib-async-sidecar-v10-agent-self-update",
        desktopAgentUpgradeRequired: false,
        reconnectAvailable: true,
        activation: { active: false },
      },
    },
    timestamp: "2026-06-08T13:41:00.000Z",
  };

  const snapshot = buildIbkrConnectionSnapshot({
    session,
    connection: {
      configured: true,
      reachable: true,
      authenticated: true,
      accounts: [{ id: "DU1234567" }],
      target: "127.0.0.1:4001",
      mode: "paper",
      clientId: 42,
    },
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.lineUsageEnabled, true);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.configured, true);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.bridgeReachable, true);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.socketConnected, true);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.authenticated, true);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.accountsLoaded, true);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.strictReady, true);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.accountCount, 1);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.selectedAccountId, "DU1234567");
  assert.equal(snapshot.runtimeDiagnostics.ibkr.desktopAgentOnline, true);
});

test("keeps launch activity visible before the bridge is connected", () => {
  const snapshot = buildIbkrConnectionSnapshot({
    session: {
      configured: { ibkr: true },
      environment: "paper",
      ibkrBridge: null,
      runtime: {
        ibkr: {
          runtimeOverrideActive: false,
          runtimeOverrideUpdatedAt: null,
          desktopAgentOnline: false,
          desktopAgentRegistered: true,
          desktopAgentRegisteredCount: 1,
          desktopAgentCompatibility: "compatible",
          desktopAgentCompatible: true,
          desktopAgentHelperVersion: null,
          desktopAgentKnownBad: false,
          desktopAgentExpectedHelperVersion:
            "2026-06-07.ib-async-sidecar-v10-agent-self-update",
          desktopAgentUpgradeRequired: false,
          reconnectAvailable: false,
          activation: {
            active: true,
            latestActivation: {
              activationId: "activation-1",
              loginHandoffReady: false,
            },
          },
        },
      },
    },
    connection: { configured: true, reachable: false, authenticated: false },
    launch: {
      activationId: "activation-1",
      managementToken: "token-1",
      inFlight: true,
      busy: true,
    },
    nowMs: 1_717_855_000_000,
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.activityPresent, true);
  assert.equal(snapshot.lineUsageEnabled, true);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.connected, false);
  assert.equal(snapshot.runtimeDiagnostics.ibkr.activation.active, true);
});

test("suppresses stale broker proof after deactivation clears configuration", () => {
  const snapshot = buildIbkrConnectionSnapshot({
    session: {
      configured: { ibkr: false },
      environment: "paper",
      ibkrBridge: null,
      runtime: {
        ibkr: {
          runtimeOverrideActive: false,
          runtimeOverrideUpdatedAt: null,
          desktopAgentOnline: true,
          desktopAgentRegistered: true,
          desktopAgentRegisteredCount: 1,
          desktopAgentCompatibility: "update_required",
          desktopAgentCompatible: false,
          desktopAgentHelperVersion:
            "2026-06-07.ib-async-sidecar-v13-desktop-agent",
          desktopAgentExpectedHelperVersion:
            "2026-06-09.ib-async-sidecar-v14-sidecar-import-stderr-not-error",
          desktopAgentUpgradeRequired: true,
          reconnectAvailable: true,
          activation: { active: false },
          reachable: true,
          connected: true,
          authenticated: true,
          bridgeReachable: true,
          socketConnected: true,
          brokerServerConnected: true,
          accountsLoaded: true,
          accountCount: 1,
          selectedAccountId: "DU1234567",
          configuredLiveMarketDataMode: true,
          healthFresh: true,
          streamFresh: true,
          streamState: "live",
          strictReady: true,
        },
      },
      timestamp: "2026-06-09T03:32:46.000Z",
    },
    nowMs: Date.parse("2026-06-09T03:32:46.000Z"),
  });

  const ibkr = snapshot.runtimeDiagnostics.ibkr;

  assert.equal(snapshot.available, true);
  assert.equal(ibkr.configured, false);
  assert.equal(ibkr.desktopAgentOnline, true);
  assert.equal(ibkr.reconnectAvailable, true);
  assert.equal(ibkr.bridgeUrlConfigured, false);
  assert.equal(ibkr.reachable, false);
  assert.equal(ibkr.connected, false);
  assert.equal(ibkr.authenticated, false);
  assert.equal(ibkr.bridgeReachable, false);
  assert.equal(ibkr.socketConnected, false);
  assert.equal(ibkr.brokerServerConnected, false);
  assert.equal(ibkr.accountsLoaded, false);
  assert.equal(ibkr.accountCount, 0);
  assert.equal(ibkr.selectedAccountId, null);
  assert.equal(ibkr.configuredLiveMarketDataMode, false);
  assert.equal(ibkr.healthFresh, false);
  assert.equal(ibkr.streamFresh, false);
  assert.equal(ibkr.strictReady, false);
});

test("carries session bridge health failures through the header runtime snapshot", () => {
  const snapshot = buildIbkrConnectionSnapshot({
    session: {
      configured: { ibkr: true },
      environment: "paper",
      ibkrBridge: null,
      runtime: {
        ibkr: {
          runtimeOverrideActive: true,
          runtimeOverrideUpdatedAt: "2026-06-12T19:16:53.215Z",
          desktopAgentOnline: true,
          desktopAgentRegistered: true,
          desktopAgentRegisteredCount: 1,
          desktopAgentCompatibility: "compatible",
          desktopAgentCompatible: true,
          desktopAgentHelperVersion: "2026-06-10.ib-async-sidecar-v21-continuous-claim",
          desktopAgentKnownBad: false,
          desktopAgentExpectedHelperVersion:
            "2026-06-10.ib-async-sidecar-v21-continuous-claim",
          desktopAgentUpgradeRequired: false,
          reconnectAvailable: false,
          activation: { active: false },
          healthError: "IBKR bridge health is temporarily backed off.",
          healthErrorCode: "ibkr_bridge_health_backoff",
          healthErrorStatusCode: 503,
          healthErrorDetail: "Bridge health checks are backed off for 2416ms.",
          reachable: false,
          healthFresh: false,
          stale: true,
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
    },
    nowMs: Date.parse("2026-06-12T20:30:00.000Z"),
  });

  const ibkr = snapshot.runtimeDiagnostics.ibkr;

  assert.equal(snapshot.available, true);
  assert.equal(ibkr.configured, true);
  assert.equal(ibkr.runtimeOverrideActive, true);
  assert.equal(ibkr.desktopAgentOnline, true);
  assert.equal(ibkr.healthFresh, false);
  assert.equal(ibkr.bridgeReachable, false);
  assert.equal(ibkr.streamState, "reconnect_needed");
  assert.equal(ibkr.streamStateReason, "bridge_unreachable");
  assert.equal(ibkr.strictReason, "health_error");
  assert.equal(ibkr.healthErrorCode, "ibkr_bridge_health_backoff");
  assert.equal(
    ibkr.governor.health.lastFailure,
    "HTTP 530 <none>: error code: 1033",
  );
});
