import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test, { afterEach } from "node:test";

import {
  __setIbkrAccountBridgeDependenciesForTests,
  listIbkrAccounts,
  listIbkrPositions,
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

test("positions refresh to empty rows instead of preserving stale bridge rows", async () => {
  const priorTtl = process.env["IBKR_ACCOUNT_CACHE_TTL_MS"];
  const priorStaleTtl = process.env["IBKR_ACCOUNT_STALE_CACHE_TTL_MS"];
  process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = "1";
  process.env["IBKR_ACCOUNT_STALE_CACHE_TTL_MS"] = "1000";
  let bridgePositionCalls = 0;

  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      async listAccounts() {
        return [];
      },
      async listPositions() {
        bridgePositionCalls += 1;
        return bridgePositionCalls === 1
          ? [
              {
                accountId: "DU123",
                id: "position:SPY",
                symbol: "SPY",
                assetClass: "equity",
                quantity: 1,
                averagePrice: 500,
                marketPrice: 501,
                marketValue: 501,
                unrealizedPnl: 1,
                unrealizedPnlPercent: 0.2,
                realizedPnl: 0,
                currency: "USD",
                optionContract: null,
              },
            ]
          : [];
      },
      async listExecutions() {
        return [];
      },
    },
    async getBridgeHealthForSession() {
      return {
        bridgeReachable: true,
        socketConnected: true,
        brokerServerConnected: true,
        authenticated: true,
        accountsLoaded: true,
      } as never;
    },
  });

  try {
    const first = await listIbkrPositions({ accountId: "DU123", mode: "paper" });
    assert.equal(first.length, 1);

    await delay(10);

    const refreshed = await listIbkrPositions({
      accountId: "DU123",
      mode: "paper",
    });
    assert.deepEqual(refreshed, []);
    assert.equal(bridgePositionCalls, 2);
  } finally {
    if (priorTtl == null) {
      delete process.env["IBKR_ACCOUNT_CACHE_TTL_MS"];
    } else {
      process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = priorTtl;
    }
    if (priorStaleTtl == null) {
      delete process.env["IBKR_ACCOUNT_STALE_CACHE_TTL_MS"];
    } else {
      process.env["IBKR_ACCOUNT_STALE_CACHE_TTL_MS"] = priorStaleTtl;
    }
  }
});
