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
