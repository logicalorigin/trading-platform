import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test, { after } from "node:test";

import {
  clearIbkrBridgeRuntimeOverride,
  setIbkrBridgeRuntimeOverride,
} from "../lib/runtime";
import {
  __setIbkrBridgeClientFactoryForTests,
  getBridgeHealthForSession,
  invalidateBridgeHealthCache,
  primeBridgeHealthForSession,
} from "./platform-bridge-health";

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
