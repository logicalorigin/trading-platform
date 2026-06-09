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
