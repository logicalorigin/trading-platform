import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test, { after } from "node:test";
import { GetSessionResponse } from "@workspace/api-zod";

import { HttpError } from "../lib/errors";
import {
  clearIbkrBridgeRuntimeOverride,
  getIbkrBridgeRuntimeOverride,
  setIbkrBridgeRuntimeOverride,
} from "../lib/runtime";
import { setIbkrBridgeRuntimeAvailabilityProvider } from "../providers/ibkr/bridge-client";
import {
  __resetBridgeGovernorForTests,
  getBridgeGovernorSnapshot,
  isBridgeWorkBackedOff,
  recordBridgeWorkFailure,
} from "./bridge-governor";
import {
  __platformBridgeHealthInternalsForTests,
  __setIbkrBridgeClientFactoryForTests,
  getBridgeHealthForSession,
  getRuntimeBridgeHealthState,
  getSessionBridgeHealthFailureState,
  invalidateBridgeHealthCache,
  primeBridgeHealthForSession,
  resolveBridgeConnectivity,
  setDesktopAgentOnlineProvider,
  type BridgeConnectivityInput,
} from "./platform-bridge-health";
import { getIbkrBridgeActivationDiagnostics } from "./ibkr-bridge-runtime";

const testDataDir = mkdtempSync(join(tmpdir(), "pyrus-bridge-health-"));
const previousOverrideFile =
  process.env["PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
process.env["PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = join(
  testDataDir,
  "ibkr-bridge-runtime-override.json",
);

after(() => {
  clearIbkrBridgeRuntimeOverride();
  __setIbkrBridgeClientFactoryForTests(null);
  setDesktopAgentOnlineProvider(() => false);
  setIbkrBridgeRuntimeAvailabilityProvider(null);
  if (previousOverrideFile) {
    process.env["PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] =
      previousOverrideFile;
  } else {
    delete process.env["PYRUS_IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
  }
  rmSync(testDataDir, { force: true, recursive: true });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bridgeHealth(updatedAt: string) {
  return {
    configured: true,
    authenticated: false,
    connected: false,
    competing: false,
    selectedAccountId: null,
    accounts: [],
    lastTickleAt: null,
    lastError: null,
    lastRecoveryAttemptAt: null,
    lastRecoveryError: null,
    updatedAt,
    transport: "tws",
    connectionTarget: null,
    sessionMode: "live",
    clientId: null,
    marketDataMode: "unknown",
    liveMarketDataAvailable: null,
    brokerServerConnected: false,
    diagnostics: {},
  };
}

const CONN_NOW = 1_700_000_000_000;

function connInput(
  overrides: Partial<BridgeConnectivityInput> = {},
): BridgeConnectivityInput {
  return {
    connected: true,
    authenticated: true,
    serverConnectivity: "connected",
    lastTickleAtMs: CONN_NOW - 5_000,
    healthAgeMs: 0,
    forceStale: false,
    streamFresh: false,
    desktopAgentOnline: false,
    continuousOutageMs: null,
    now: CONN_NOW,
    livenessFreshMs: 90_000,
    connectivityFloorMs: 20_000,
    healthFreshMs: 30_000,
    ...overrides,
  };
}

// Case 1 (acceptance): socket up + data clocks stale, cache within the floor -> connected.
test("connectivity stays up when data is stale but the cache is within the floor", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({
      forceStale: true,
      healthAgeMs: 15_000,
      lastTickleAtMs: CONN_NOW - 10_000,
    }),
  );
  assert.equal(verdict.connectivityUp, true);
  assert.equal(verdict.connectivityReason, null);
});

// Case 2 (acceptance): genuine disconnect flips down WITHIN the floor, not at 120s.
test("connectivity flips down past the connectivity floor on a stale cache", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({
      forceStale: true,
      healthAgeMs: 30_000, // > 20s floor
      lastTickleAtMs: CONN_NOW - 30_000,
    }),
  );
  assert.equal(verdict.connectivityUp, false);
  assert.equal(verdict.connectivityReason, "connectivity_floor_exceeded");
});

// Case 3 (acceptance + safety): half-open socket (no successful tickle past liveness) -> down.
test("connectivity reads down on a half-open socket with a stale tickle", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({
      forceStale: false,
      healthAgeMs: 0, // fresh probe, socket "connected" still true
      lastTickleAtMs: CONN_NOW - 120_000, // > 90s liveness window
    }),
  );
  assert.equal(verdict.connectivityUp, false);
  assert.equal(verdict.connectivityReason, "liveness_stale");
});

// Case 4 (acceptance): quiet market (socket up, recent tickle, no quotes) -> connected.
test("connectivity stays up in a quiet market with a live socket", () => {
  const verdict = resolveBridgeConnectivity(connInput());
  assert.equal(verdict.connectivityUp, true);
  assert.equal(verdict.connectivityReason, null);
});

test("server connectivity 'disconnected' is immediately not connected", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({ serverConnectivity: "disconnected" }),
  );
  assert.equal(verdict.connectivityUp, false);
  assert.equal(verdict.connectivityReason, "server_disconnected");
});

test("an unauthenticated session is not connected", () => {
  const verdict = resolveBridgeConnectivity(connInput({ authenticated: false }));
  assert.equal(verdict.connectivityUp, false);
  assert.equal(verdict.connectivityReason, "not_authenticated");
});

test("desktop-agent-online proof overrides the connectivity floor", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({
      forceStale: true,
      healthAgeMs: 60_000, // well past the floor
      desktopAgentOnline: true,
      lastTickleAtMs: CONN_NOW - 5_000,
    }),
  );
  assert.equal(verdict.connectivityUp, true);
  assert.equal(verdict.connectivityReason, null);
});

test("a fresh probe with no tickle yet counts as live", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({ lastTickleAtMs: null, forceStale: false, healthAgeMs: 1_000 }),
  );
  assert.equal(verdict.connectivityUp, true);
  assert.equal(verdict.connectivityReason, null);
});

test("a continuous health outage past the floor forces connectivity down", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({
      forceStale: true,
      healthAgeMs: 5_000, // cache itself is recent
      continuousOutageMs: 25_000, // but the circuit has been open > floor
      lastTickleAtMs: CONN_NOW - 5_000,
    }),
  );
  assert.equal(verdict.connectivityUp, false);
  assert.equal(verdict.connectivityReason, "connectivity_floor_exceeded");
});

// SAFETY INVARIANT: desktopAgentOnline overrides the floor but must NEVER satisfy
// liveness. A live helper does not prove the TWS socket is completing round-trips, so
// a half-open gateway with a stale tickle must still read down even with desktop online.
// (Mutation guard: moving desktopAgentOnline into the liveness clause must fail here.)
test("desktop-agent-online does NOT satisfy liveness on a half-open socket", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({
      desktopAgentOnline: true,
      forceStale: true,
      lastTickleAtMs: CONN_NOW - 120_000, // > 90s liveness window
    }),
  );
  assert.equal(verdict.connectivityUp, false);
  assert.equal(verdict.connectivityReason, "liveness_stale");
});

test("a disconnected socket is immediately not connected", () => {
  const verdict = resolveBridgeConnectivity(connInput({ connected: false }));
  assert.equal(verdict.connectivityUp, false);
  assert.equal(verdict.connectivityReason, "socket_disconnected");
});

test("liveness boundary: fresh at exactly the window, stale one ms past it", () => {
  const atBoundary = resolveBridgeConnectivity(
    connInput({ lastTickleAtMs: CONN_NOW - 90_000 }),
  );
  assert.equal(atBoundary.connectivityUp, true);
  const pastBoundary = resolveBridgeConnectivity(
    connInput({ lastTickleAtMs: CONN_NOW - 90_001 }),
  );
  assert.equal(pastBoundary.connectivityUp, false);
  assert.equal(pastBoundary.connectivityReason, "liveness_stale");
});

test("floor boundary: trusted at exactly the floor, dropped one ms past it", () => {
  const atBoundary = resolveBridgeConnectivity(
    connInput({
      forceStale: true,
      healthAgeMs: 20_000,
      lastTickleAtMs: CONN_NOW - 1_000,
    }),
  );
  assert.equal(atBoundary.connectivityUp, true);
  const pastBoundary = resolveBridgeConnectivity(
    connInput({
      forceStale: true,
      healthAgeMs: 20_001,
      lastTickleAtMs: CONN_NOW - 1_000,
    }),
  );
  assert.equal(pastBoundary.connectivityUp, false);
  assert.equal(pastBoundary.connectivityReason, "connectivity_floor_exceeded");
});

test("a stale cache with no tickle yet is not considered live", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({ lastTickleAtMs: null, forceStale: true, healthAgeMs: 5_000 }),
  );
  assert.equal(verdict.connectivityUp, false);
  assert.equal(verdict.connectivityReason, "liveness_stale");
});

test("fresh stream evidence satisfies liveness and the stale-cache floor", () => {
  const verdict = resolveBridgeConnectivity(
    connInput({
      forceStale: true,
      healthAgeMs: 60_000,
      lastTickleAtMs: null,
      streamFresh: true,
    }),
  );
  assert.equal(verdict.connectivityUp, true);
  assert.equal(verdict.connectivityReason, null);
});

test("annotateBridgeHealth surfaces connectivityUp decoupled from data freshness", () => {
  __resetBridgeGovernorForTests();
  setDesktopAgentOnlineProvider(() => false);
  const annotated = __platformBridgeHealthInternalsForTests.annotateBridgeHealth({
    ...bridgeHealth(new Date().toISOString()),
    connected: true,
    authenticated: true,
    serverConnectivity: "connected",
    lastTickleAt: new Date(),
  } as never);
  assert.equal(annotated.connectivityUp, true);
  assert.equal(annotated.connectivityReason, null);
});

// Proves the decoupling is real end-to-end: under a stale-cache annotation the existing
// socketConnected (which folds in the freshness clocks) goes false, while connectivityUp
// stays true within the floor. Also proves options.forceStale is threaded, not hardcoded.
test("annotateBridgeHealth keeps connectivityUp true under a stale cache where socketConnected goes false", () => {
  __resetBridgeGovernorForTests();
  setDesktopAgentOnlineProvider(() => false);
  const annotated = __platformBridgeHealthInternalsForTests.annotateBridgeHealth(
    {
      ...bridgeHealth(new Date(Date.now() - 15_000).toISOString()), // within the 20s floor
      connected: true,
      authenticated: true,
      serverConnectivity: "connected",
      lastTickleAt: new Date(),
    } as never,
    { forceStale: true },
  );
  assert.equal(annotated.socketConnected, false, "stale cache zeroes socketConnected");
  assert.equal(annotated.connectivityUp, true, "connectivity survives within the floor");
  assert.equal(annotated.connectivityReason, null);
});

test("online desktop agent without runtime override reports unattached bridge health", async () => {
  __resetBridgeGovernorForTests();
  clearIbkrBridgeRuntimeOverride();
  invalidateBridgeHealthCache();
  __setIbkrBridgeClientFactoryForTests(() => {
    throw new Error("health client should not be constructed without runtime URL");
  });
  setIbkrBridgeRuntimeAvailabilityProvider(() => ({
    runtimeOverrideActive: false,
    desktopAgentOnline: true,
    desktopAgentCompatible: true,
  }));

  try {
    const health = await getBridgeHealthForSession({
      waitForInitialRefresh: false,
      waitForStaleRefresh: false,
    });

    assert(health, "expected synthetic bridge health");
    assert.equal(health.configured, true);
    assert.equal(health.connected, false);
    assert.equal(health.authenticated, false);
    assert.equal(health.strictReason, "ibkr_bridge_runtime_unattached");
    assert.equal(health.connectivityReason, "ibkr_bridge_runtime_unattached");
    assert.equal(health.streamState, "checking");
    assert.equal(health.streamStateReason, "ibkr_bridge_runtime_unattached");

    const runtimeHealth = await getRuntimeBridgeHealthState();
    assert.equal(
      runtimeHealth.annotatedHealth?.strictReason,
      "ibkr_bridge_runtime_unattached",
    );
    assert.equal(runtimeHealth.healthErrorCode, null);
  } finally {
    setIbkrBridgeRuntimeAvailabilityProvider(null);
    __setIbkrBridgeClientFactoryForTests(null);
    invalidateBridgeHealthCache();
  }
});

test("session bridge health can return stale cached data without awaiting refresh", async () => {
  setIbkrBridgeRuntimeOverride({
    apiToken: "test-token",
    baseUrl: "https://bridge.test",
  });

  const staleUpdatedAt = new Date(Date.now() - 10_000).toISOString();
  const freshUpdatedAt = new Date().toISOString();
  let bridgeHealthCalls = 0;

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        async getHealth() {
          bridgeHealthCalls += 1;
          await delay(75);
          return bridgeHealth(freshUpdatedAt);
        },
      }) as never,
  );
  primeBridgeHealthForSession(bridgeHealth(staleUpdatedAt));

  const startedAt = performance.now();
  const health = await getBridgeHealthForSession({
    waitForInitialRefresh: false,
    waitForStaleRefresh: false,
  });
  const elapsedMs = performance.now() - startedAt;

  assert(health, "expected cached bridge health");
  assert.equal(health.updatedAt, staleUpdatedAt);
  assert.equal(bridgeHealthCalls, 1);
  assert(
    elapsedMs < 50,
    `expected non-blocking stale health read, took ${elapsedMs.toFixed(1)}ms`,
  );

  await delay(100);

  const refreshedHealth = await getBridgeHealthForSession({
    waitForInitialRefresh: false,
    waitForStaleRefresh: false,
  });

  assert.equal(refreshedHealth?.updatedAt, freshUpdatedAt);
});

test("a health probe slower than the session timeout still populates the cache", async () => {
  __resetBridgeGovernorForTests();
  invalidateBridgeHealthCache();
  setIbkrBridgeRuntimeOverride({
    apiToken: "test-token",
    baseUrl: "https://bridge.test",
  });

  // The caller budget (15ms) is far shorter than the probe's response time
  // (90ms), mirroring the real 5s session budget vs a slow market-open bridge
  // that answers within the 12s request budget. The slow-but-successful probe
  // must still refresh lastKnownBridgeHealth; otherwise the cache never
  // populates and every health-gated read (connection, accounts, bars) wedges.
  const previousTimeout = process.env["SESSION_BRIDGE_HEALTH_TIMEOUT_MS"];
  process.env["SESSION_BRIDGE_HEALTH_TIMEOUT_MS"] = "15";

  const freshUpdatedAt = new Date().toISOString();
  let healthCalls = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        async getHealth() {
          healthCalls += 1;
          await delay(90);
          return bridgeHealth(freshUpdatedAt);
        },
      }) as never,
  );

  try {
    // No cache yet: this schedules a background refresh whose caller-side
    // timeout (15ms) fires long before the probe resolves (90ms).
    const initial = await getBridgeHealthForSession({
      waitForInitialRefresh: false,
      waitForStaleRefresh: false,
    });
    assert.equal(initial, null, "expected no cached health on the first read");

    // Wait until well past the probe's completion.
    await delay(150);

    const refreshed = await getBridgeHealthForSession({
      waitForInitialRefresh: false,
      waitForStaleRefresh: false,
    });
    assert.equal(
      refreshed?.updatedAt,
      freshUpdatedAt,
      "a slow-but-successful health probe must still populate the cache",
    );
    assert(healthCalls >= 1, "expected the health probe to run");
  } finally {
    if (previousTimeout === undefined) {
      delete process.env["SESSION_BRIDGE_HEALTH_TIMEOUT_MS"];
    } else {
      process.env["SESSION_BRIDGE_HEALTH_TIMEOUT_MS"] = previousTimeout;
    }
  }
});

test("stale connected bridge health is not reported as usable", async () => {
  setIbkrBridgeRuntimeOverride({
    apiToken: "test-token",
    baseUrl: "https://bridge.test",
  });

  const staleConnectedHealth = {
    ...bridgeHealth(new Date(Date.now() - 60_000).toISOString()),
    accounts: ["U123"],
    authenticated: true,
    brokerServerConnected: true,
    connected: true,
    lastTickleAt: new Date(),
    liveMarketDataAvailable: true,
    marketDataMode: "live",
  };
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        async getHealth() {
          await delay(75);
          return staleConnectedHealth;
        },
      }) as never,
  );
  primeBridgeHealthForSession(staleConnectedHealth);

  const health = await getBridgeHealthForSession({
    waitForInitialRefresh: false,
    waitForStaleRefresh: false,
  });

  assert(health, "expected stale cached bridge health");
  assert.equal(health.healthFresh, false);
  assert.equal(health.stale, true);
  assert.equal(health.bridgeReachable, false);
  assert.equal(health.connected, false);
  assert.equal(health.authenticated, false);
  assert.equal(health.socketConnected, false);
  assert.equal(health.connectivityUp, false);
  assert.equal(health.connectivityReason, "connectivity_floor_exceeded");
  assert.equal(health.strictReady, false);
  assert.equal(health.strictReason, "health_stale");
});

test("runtime bridge health applies the stale-cache connectivity floor", async () => {
  setIbkrBridgeRuntimeOverride({
    apiToken: "test-token",
    baseUrl: "https://bridge.test",
  });

  const staleConnectedHealth = {
    ...bridgeHealth(new Date(Date.now() - 60_000).toISOString()),
    accounts: ["U123"],
    authenticated: true,
    brokerServerConnected: true,
    connected: true,
    lastTickleAt: new Date(),
    liveMarketDataAvailable: true,
    marketDataMode: "live",
    serverConnectivity: "connected",
  };
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        async getHealth() {
          await delay(75);
          return {
            ...staleConnectedHealth,
            updatedAt: new Date().toISOString(),
          };
        },
      }) as never,
  );
  primeBridgeHealthForSession(staleConnectedHealth);

  try {
    const runtimeHealth = await getRuntimeBridgeHealthState();
    const health = runtimeHealth.annotatedHealth;

    assert(health, "expected runtime diagnostics to use cached bridge health");
    assert.equal(health.updatedAt, staleConnectedHealth.updatedAt);
    assert.equal(health.healthFresh, false);
    assert.equal(health.connected, false);
    assert.equal(health.connectivityUp, false);
    assert.equal(health.connectivityReason, "connectivity_floor_exceeded");
  } finally {
    await delay(100);
    __setIbkrBridgeClientFactoryForTests(null);
    invalidateBridgeHealthCache();
  }
});

test("stale embedded stream ages do not bypass the connectivity floor", async () => {
  setIbkrBridgeRuntimeOverride({
    apiToken: "test-token",
    baseUrl: "https://bridge.test",
  });

  const staleButStreamingHealth = {
    ...bridgeHealth(new Date(Date.now() - 60_000).toISOString()),
    accounts: ["U123"],
    authenticated: true,
    brokerServerConnected: true,
    connected: true,
    liveMarketDataAvailable: true,
    marketDataMode: "live",
    // This age is relative to the 60s-old health snapshot, not to now.
    diagnostics: { subscriptions: { lastQuoteAgeMs: 5_000, quoteListenerCount: 3 } },
  };
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        async getHealth() {
          await delay(75);
          return staleButStreamingHealth;
        },
      }) as never,
  );
  primeBridgeHealthForSession(staleButStreamingHealth);

  const health = await getBridgeHealthForSession({
    waitForInitialRefresh: false,
    waitForStaleRefresh: false,
  });

  assert(health, "expected cached bridge health");
  assert.equal(health.healthFresh, false, "health probe is still stale");
  assert.equal(health.streamFresh, false, "cached stream age is aged with health");
  assert.equal(health.connected, false);
  assert.equal(health.connectivityUp, false);
  assert.equal(health.connectivityReason, "liveness_stale");
  assert.equal(health.socketConnected, false);
  assert.equal(health.bridgeReachable, false);
  assert.equal(health.authenticated, false);
});

test("fresh quote stream transport prevents false stale state when quote data is quiet", () => {
  const staleButTransportAliveHealth = {
    ...bridgeHealth(new Date(Date.now() - 60_000).toISOString()),
    accounts: ["U123"],
    authenticated: true,
    brokerServerConnected: true,
    connected: true,
    liveMarketDataAvailable: true,
    marketDataMode: "live",
    diagnostics: { subscriptions: { quoteListenerCount: 3 } },
  };

  const health =
    __platformBridgeHealthInternalsForTests.annotateBridgeHealth(
      staleButTransportAliveHealth as never,
      {
        bridgeQuoteDiagnostics: {
          activeConsumerCount: 3,
          unionSymbolCount: 3,
          streamActive: true,
          dataFreshnessAgeMs: 120_000,
          lastEventAgeMs: 120_000,
          transportFreshnessAgeMs: 1_000,
        } as never,
      },
    );

  assert(health, "expected cached bridge health");
  assert.equal(health.healthFresh, false);
  assert.equal(health.streamFresh, true, "transport heartbeat is fresh");
  assert.equal(health.streamState, "live");
  assert.equal(health.strictReady, true);
  assert.equal(health.connected, true);
  assert.equal(health.connectivityUp, true);
});

test("invalidateBridgeHealthCache drops the cache so a deactivate reads disconnected immediately", async () => {
  setIbkrBridgeRuntimeOverride({
    apiToken: "test-token",
    baseUrl: "https://bridge.test",
  });

  const connectedHealth = {
    ...bridgeHealth(new Date().toISOString()),
    connected: true,
    authenticated: true,
    brokerServerConnected: true,
  };
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        async getHealth() {
          await delay(75);
          return connectedHealth;
        },
      }) as never,
  );
  // A fresh, operational health snapshot would otherwise read as connected for
  // ~IBKR_BRIDGE_HEALTH_FRESH_MS (30s) — the source of the deactivate lag.
  primeBridgeHealthForSession(connectedHealth);

  const before = await getBridgeHealthForSession({
    waitForInitialRefresh: false,
    waitForStaleRefresh: false,
  });
  assert.equal(before?.connected, true, "primed health should read connected");

  // User-initiated deactivate clears the override and invalidates the cache.
  invalidateBridgeHealthCache();

  const after = await getBridgeHealthForSession({
    waitForInitialRefresh: false,
    waitForStaleRefresh: false,
  });
  assert.equal(
    after,
    null,
    "after invalidation the read must be disconnected, not stale-connected",
  );
});

test("session bridge health failure state summarizes health governor backoff", () => {
  setIbkrBridgeRuntimeOverride({
    apiToken: "test-token",
    baseUrl: "https://bridge.test",
  });
  __resetBridgeGovernorForTests();

  try {
    const bridgeError = new HttpError(530, "HTTP 530 <none>: error code: 1033", {
      code: "upstream_http_error",
    });
    recordBridgeWorkFailure("health", bridgeError);
    recordBridgeWorkFailure("health", bridgeError);

    const state = getSessionBridgeHealthFailureState();

    assert(state, "expected compact session bridge failure state");
    assert.equal(state.healthFresh, false);
    assert.equal(state.bridgeReachable, false);
    assert.equal(state.socketConnected, false);
    assert.equal(state.connected, false);
    assert.equal(state.strictReady, false);
    assert.equal(state.strictReason, "health_error");
    assert.equal(state.streamState, "reconnect_needed");
    assert.equal(state.streamStateReason, "bridge_unreachable");
    assert.equal(state.healthErrorCode, "ibkr_bridge_health_backoff");
    assert.match(state.healthError, /temporarily backed off/i);
    assert.equal(
      state.governor.health.lastFailure,
      "HTTP 530 <none>: error code: 1033",
    );
  } finally {
    __resetBridgeGovernorForTests();
  }
});

test("session response preserves compact IBKR runtime bridge failure fields", () => {
  const session = {
    brokerProvider: "ibkr",
    configured: {
      ibkr: true,
      massive: false,
      research: true,
    },
    environment: "live",
    ibkrBridge: null,
    marketDataProvider: "ibkr",
    marketDataProviders: {
      historical: "ibkr",
      live: "ibkr",
      research: "fmp",
    },
    runtime: {
      ibkr: {
        runtimeOverrideActive: true,
        runtimeOverrideUpdatedAt: new Date().toISOString(),
        desktopAgentOnline: false,
        desktopAgentRegistered: true,
        desktopAgentRegisteredCount: 1,
        desktopAgentCompatibility: "known_bad",
        desktopAgentCompatible: false,
        desktopAgentHelperVersion: "2026-06-10.ib-async-sidecar-v21-continuous-claim",
        desktopAgentKnownBad: true,
        desktopAgentExpectedHelperVersion:
          "2026-06-22.ib-async-sidecar-v24-long-poll-claim",
        desktopAgentUpgradeRequired: true,
        reconnectAvailable: false,
        activation: getIbkrBridgeActivationDiagnostics(),
        reachable: false,
        healthError: "IBKR bridge health is temporarily backed off.",
        healthErrorCode: "ibkr_bridge_health_backoff",
        healthFresh: false,
        bridgeReachable: false,
        socketConnected: false,
        connected: false,
        streamFresh: false,
        streamState: "reconnect_needed",
        streamStateReason: "bridge_unreachable",
        strictReady: false,
        strictReason: "health_error",
      },
    },
    timestamp: new Date().toISOString(),
  };

  // The generated zod schema enumerates only a subset of runtime.ibkr keys and
  // strips the rest, so the /session route re-merges the source object to honor
  // SessionIbkrRuntime additionalProperties:true (see routes/platform.ts
  // "/session"). This mirrors that merge to assert the contract holds end-to-end.
  const parsed = GetSessionResponse.parse(session);
  const runtime = {
    ...(session.runtime.ibkr as Record<string, unknown>),
    ...(parsed.runtime.ibkr as Record<string, unknown>),
  };

  // Passthrough fields survive only via the route merge.
  assert.equal(runtime.healthErrorCode, "ibkr_bridge_health_backoff");
  assert.equal(runtime.streamState, "reconnect_needed");
  assert.equal(runtime.strictReason, "health_error");
  assert.equal(runtime.desktopAgentUpgradeRequired, true);
  assert.equal(
    runtime.desktopAgentHelperVersion,
    "2026-06-10.ib-async-sidecar-v21-continuous-claim",
  );
});

test("dead bridge override is abandoned via firstOpenedAt, which survives backoff-window resets", () => {
  __resetBridgeGovernorForTests();
  setIbkrBridgeRuntimeOverride({ apiToken: "t", baseUrl: "https://dead.bridge" });
  const { maybeAbandonDeadBridgeOverride, DEAD_BRIDGE_OVERRIDE_ABANDON_MS } =
    __platformBridgeHealthInternalsForTests;
  // "health" failureThreshold is 2; a health-timeout error is transient and counts.
  const transient = new HttpError(504, "timeout", {
    code: "ibkr_bridge_health_timeout",
  });

  const realNow = Date.now;
  try {
    recordBridgeWorkFailure("health", transient);
    recordBridgeWorkFailure("health", transient);
    const opened = getBridgeGovernorSnapshot().health;
    assert.notEqual(opened.openedAt, null);
    assert.notEqual(opened.firstOpenedAt, null);
    const firstOpenedAt = opened.firstOpenedAt;
    if (firstOpenedAt === null) throw new Error("expected firstOpenedAt to be set");

    // Advance past the health backoff window so isBridgeWorkBackedOff runs its
    // expiry branch — this is exactly what wipes openedAt on the real read path.
    Date.now = () => realNow() + 11_000;
    assert.equal(isBridgeWorkBackedOff("health"), false);
    const afterExpiry = getBridgeGovernorSnapshot().health;
    assert.equal(afterExpiry.openedAt, null, "openedAt is wiped by backoff expiry");
    assert.notEqual(
      afterExpiry.firstOpenedAt,
      null,
      "firstOpenedAt must survive the backoff-expiry reset (the bug openedAt had)",
    );

    // Recent outage relative to firstOpenedAt: a transient blip must not abandon it.
    setDesktopAgentOnlineProvider(() => false);
    assert.equal(maybeAbandonDeadBridgeOverride(firstOpenedAt + 1_000), false);
    assert.notEqual(getIbkrBridgeRuntimeOverride(), null);

    // While the desktop agent is ONLINE, a sustained health outage must NOT abandon
    // the override: an online agent is proof the helper/Gateway is alive and the
    // health probes are merely failing (e.g. sidecar slowness). Abandoning here
    // would falsely flip the UI to disconnected for a live connection.
    setDesktopAgentOnlineProvider(() => true);
    assert.equal(
      maybeAbandonDeadBridgeOverride(
        firstOpenedAt + DEAD_BRIDGE_OVERRIDE_ABANDON_MS + 5_000,
      ),
      false,
    );
    assert.notEqual(getIbkrBridgeRuntimeOverride(), null);

    // Agent offline + sustained continuous outage past the window: the dead
    // override is abandoned — and this only works because firstOpenedAt (not
    // openedAt) is the clock.
    setDesktopAgentOnlineProvider(() => false);
    assert.equal(
      maybeAbandonDeadBridgeOverride(
        firstOpenedAt + DEAD_BRIDGE_OVERRIDE_ABANDON_MS + 5_000,
      ),
      true,
    );
    assert.equal(getIbkrBridgeRuntimeOverride(), null);
  } finally {
    Date.now = realNow;
    setDesktopAgentOnlineProvider(() => false);
    __resetBridgeGovernorForTests();
  }
});

// END-TO-END SEAM: a connected bridge -> annotateBridgeHealth -> the /session payload
// shape -> GetSessionResponse.parse must preserve connectivityUp inside
// ibkrBridge.connections.tws (the exact path the header reads via getIbkrConnection).
// The /session route passes data.ibkrBridge straight through from the parse (it only
// re-merges runtime.ibkr), so survival depends entirely on the IbkrBridgeConnectionHealth
// schema declaring connectivityUp.
test("GetSessionResponse preserves connectivityUp through ibkrBridge.connections.tws (bridge up)", () => {
  __resetBridgeGovernorForTests();
  setDesktopAgentOnlineProvider(() => false);

  const connectedHealth = {
    ...bridgeHealth(new Date().toISOString()),
    connected: true,
    authenticated: true,
    brokerServerConnected: true,
    serverConnectivity: "connected",
    lastTickleAt: new Date(),
    accounts: ["U123"],
    marketDataMode: "live",
    liveMarketDataAvailable: true,
    connections: {
      tws: {
        transport: "tws",
        role: "market_data",
        configured: true,
        reachable: true,
        authenticated: true,
        competing: false,
        target: "host:4002",
        mode: "live",
        clientId: 1,
        selectedAccountId: "U123",
        accounts: ["U123"],
        lastPingMs: 5,
        lastPingAt: new Date().toISOString(),
        lastTickleAt: new Date().toISOString(),
        lastError: null,
        marketDataMode: "live",
        liveMarketDataAvailable: true,
      },
    },
  };

  const annotated =
    __platformBridgeHealthInternalsForTests.annotateBridgeHealth(
      connectedHealth as never,
    );
  assert.equal(annotated.connectivityUp, true, "annotate computes connectivityUp");
  const annotatedTws = annotated.connections?.tws as
    | { connectivityUp?: boolean }
    | undefined;
  assert.equal(
    annotatedTws?.connectivityUp,
    true,
    "annotate enriches connections.tws with connectivityUp",
  );

  const session = {
    brokerProvider: "ibkr",
    configured: { ibkr: true, massive: false, research: true },
    environment: "live",
    ibkrBridge: annotated,
    marketDataProvider: "ibkr",
    marketDataProviders: { historical: "ibkr", live: "ibkr", research: "fmp" },
    runtime: {
      ibkr: {
        runtimeOverrideActive: false,
        runtimeOverrideUpdatedAt: null,
        desktopAgentOnline: true,
        desktopAgentRegistered: true,
        desktopAgentRegisteredCount: 1,
        desktopAgentCompatibility: "compatible",
        desktopAgentCompatible: true,
        desktopAgentHelperVersion: "2026-06-13.ib-async-sidecar-v23",
        desktopAgentKnownBad: false,
        desktopAgentExpectedHelperVersion: "2026-06-13.ib-async-sidecar-v23",
        desktopAgentUpgradeRequired: false,
        reconnectAvailable: false,
        activation: getIbkrBridgeActivationDiagnostics(),
      },
    },
    timestamp: new Date().toISOString(),
  };

  const parsed = GetSessionResponse.parse(session);
  assert.equal(
    parsed.ibkrBridge?.connections?.tws?.connectivityUp,
    true,
    "connectivityUp survives GetSessionResponse.parse in connections.tws",
  );
});
