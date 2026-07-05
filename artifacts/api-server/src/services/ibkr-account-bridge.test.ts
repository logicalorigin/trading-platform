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

test("account list reads through broker client without bridge health", async () => {
  let accountCalls = 0;

  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      async listAccounts() {
        accountCalls += 1;
        return [];
      },
      async listPositions() {
        return [];
      },
      async listExecutions() {
        return [];
      },
    },
  });

  const startedAt = performance.now();
  const accounts = await listIbkrAccounts("shadow");
  const elapsedMs = performance.now() - startedAt;

  assert.deepEqual(accounts, []);
  assert.equal(accountCalls, 1);
  assert(
    elapsedMs < 50,
    `expected account list to avoid bridge health wait, took ${elapsedMs.toFixed(1)}ms`,
  );
});

test("positions return cached rows within the initial-wait budget when the broker read is slow", async () => {
  const priorTtl = process.env["IBKR_ACCOUNT_CACHE_TTL_MS"];
  const priorStaleTtl = process.env["IBKR_ACCOUNT_STALE_CACHE_TTL_MS"];
  const priorWait = process.env["IBKR_ACCOUNT_POSITIONS_INITIAL_WAIT_MS"];
  process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = "1";
  process.env["IBKR_ACCOUNT_STALE_CACHE_TTL_MS"] = "120000";
  process.env["IBKR_ACCOUNT_POSITIONS_INITIAL_WAIT_MS"] = "150";
  let positionCalls = 0;

  const position = {
    accountId: "DU123",
    id: "position:SPY",
    symbol: "SPY",
    assetClass: "equity" as const,
    quantity: 1,
    averagePrice: 500,
    marketPrice: 501,
    marketValue: 501,
    unrealizedPnl: 1,
    unrealizedPnlPercent: 0.2,
    realizedPnl: 0,
    currency: "USD",
    optionContract: null,
  };

  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      async listAccounts() {
        return [];
      },
      async listPositions() {
        positionCalls += 1;
        // First read populates the cache fast; the second read simulates a
        // slow broker read that exceeds the initial-wait budget.
        if (positionCalls === 1) {
          return [position];
        }
        await delay(2_000);
        return [position];
      },
      async listExecutions() {
        return [];
      },
    },
  });

  try {
    const first = await listIbkrPositions({ accountId: "DU123", mode: "shadow" });
    assert.equal(first.length, 1);

    await delay(10);

    const startedAt = performance.now();
    const refreshed = await listIbkrPositions({
      accountId: "DU123",
      mode: "shadow",
    });
    const elapsedMs = performance.now() - startedAt;

    // The slow refresh must not block the request: it returns the cached rows
    // within the ~150ms budget rather than hanging for the full 2s broker read.
    assert.equal(refreshed.length, 1);
    assert(
      elapsedMs < 900,
      `expected cached positions within the initial-wait budget, took ${elapsedMs.toFixed(1)}ms`,
    );
  } finally {
    for (const [key, value] of [
      ["IBKR_ACCOUNT_CACHE_TTL_MS", priorTtl],
      ["IBKR_ACCOUNT_STALE_CACHE_TTL_MS", priorStaleTtl],
      ["IBKR_ACCOUNT_POSITIONS_INITIAL_WAIT_MS", priorWait],
    ] as const) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("positions refresh to empty rows instead of preserving stale broker rows", async () => {
  const priorTtl = process.env["IBKR_ACCOUNT_CACHE_TTL_MS"];
  const priorStaleTtl = process.env["IBKR_ACCOUNT_STALE_CACHE_TTL_MS"];
  process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = "1";
  process.env["IBKR_ACCOUNT_STALE_CACHE_TTL_MS"] = "1000";
  let positionCalls = 0;

  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      async listAccounts() {
        return [];
      },
      async listPositions() {
        positionCalls += 1;
        return positionCalls === 1
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
  });

  try {
    const first = await listIbkrPositions({ accountId: "DU123", mode: "shadow" });
    assert.equal(first.length, 1);

    await delay(10);

    const refreshed = await listIbkrPositions({
      accountId: "DU123",
      mode: "shadow",
    });
    assert.deepEqual(refreshed, []);
    assert.equal(positionCalls, 2);
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
