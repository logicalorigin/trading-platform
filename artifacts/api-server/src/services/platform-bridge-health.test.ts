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
  getSessionBridgeHealthFailureState,
  invalidateBridgeHealthCache,
  primeBridgeHealthForSession,
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
  assert.equal(health.strictReady, false);
  assert.equal(health.strictReason, "health_stale");
});

test("stale health with a fresh data stream stays connected (health-probe false negative)", async () => {
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
    // Fresh stream evidence: a recent quote age proves the gateway is live even
    // though the cached health snapshot is 60s stale and /healthz is erroring.
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
  assert.equal(health.streamFresh, true, "stream is fresh");
  assert.equal(health.connected, true, "a fresh stream keeps the connection live");
  assert.equal(health.socketConnected, true);
  assert.equal(health.bridgeReachable, true);
  assert.equal(health.authenticated, true);
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
          "2026-06-13.ib-async-sidecar-v23-responsive-agent-loop",
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
    assert.equal(maybeAbandonDeadBridgeOverride(firstOpenedAt + 1_000), false);
    assert.notEqual(getIbkrBridgeRuntimeOverride(), null);

    // Sustained continuous outage past the window: the dead override is abandoned —
    // and this only works because firstOpenedAt (not openedAt) is the clock.
    assert.equal(
      maybeAbandonDeadBridgeOverride(
        firstOpenedAt + DEAD_BRIDGE_OVERRIDE_ABANDON_MS + 5_000,
      ),
      true,
    );
    assert.equal(getIbkrBridgeRuntimeOverride(), null);
  } finally {
    Date.now = realNow;
    __resetBridgeGovernorForTests();
  }
});
