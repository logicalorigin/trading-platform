import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test, { afterEach } from "node:test";

import {
  __setIbkrAccountBridgeDependenciesForTests,
  listIbkrAccounts,
} from "./ibkr-account-bridge";

afterEach(() => {
  __setIbkrAccountBridgeDependenciesForTests(null);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("account list does not wait on stale bridge health before fallback", async () => {
  let bridgeAccountCalls = 0;
  let observedOptions: unknown = null;

  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      async listAccounts() {
        bridgeAccountCalls += 1;
        return [];
      },
      async listPositions() {
        return [];
      },
      async listExecutions() {
        return [];
      },
    },
    async getBridgeHealthForSession(options) {
      observedOptions = options;
      if (options?.waitForStaleRefresh !== false) {
        await delay(75);
      }
      return {
        bridgeReachable: false,
        socketConnected: false,
        brokerServerConnected: false,
        authenticated: false,
        accountsLoaded: false,
        strictReason: "health_error",
      } as never;
    },
  });

  const startedAt = performance.now();
  const accounts = await listIbkrAccounts("paper");
  const elapsedMs = performance.now() - startedAt;

  assert.deepEqual(accounts, []);
  assert.deepEqual(observedOptions, {
    waitForInitialRefresh: false,
    waitForStaleRefresh: false,
  });
  assert.equal(bridgeAccountCalls, 0);
  assert(
    elapsedMs < 50,
    `expected account list fallback to avoid bridge health wait, took ${elapsedMs.toFixed(1)}ms`,
  );
});
