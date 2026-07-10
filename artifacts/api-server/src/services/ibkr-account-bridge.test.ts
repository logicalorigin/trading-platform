import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { HttpError } from "../lib/errors";
import {
  __setIbkrAccountBridgeDependenciesForTests,
  listIbkrAccounts,
  listIbkrExecutions,
  listIbkrOrders,
  listIbkrPositions,
} from "./ibkr-account-bridge";
import { __resetWorkGovernorForTests } from "./work-governor";

afterEach(() => {
  __setIbkrAccountBridgeDependenciesForTests(null);
  __resetWorkGovernorForTests();
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
      async listOrders() {
        return [];
      },
    },
  });

  const accounts = await listIbkrAccounts("shadow");

  assert.deepEqual(accounts, []);
  assert.equal(accountCalls, 1);
});

test("missing broker order reads reject instead of fabricating an empty snapshot", async () => {
  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      async listAccounts() {
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

  await assert.rejects(
    listIbkrOrders({ accountId: "DU123", mode: "shadow" }),
    (error: unknown) =>
      error instanceof HttpError && error.code === "ibkr_orders_unavailable",
  );
});

test("expired position reads join the current broker request without a cached timeout fallback", async () => {
  const priorTtl = process.env["IBKR_ACCOUNT_CACHE_TTL_MS"];
  process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = "1";
  let positionCalls = 0;
  let releaseCurrentRead!: () => void;
  const currentRead = new Promise<void>((resolve) => {
    releaseCurrentRead = resolve;
  });

  const cachedPosition = {
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
  const currentPosition = {
    ...cachedPosition,
    id: "position:QQQ",
    symbol: "QQQ",
  };

  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      async listAccounts() {
        return [];
      },
      async listPositions() {
        positionCalls += 1;
        if (positionCalls === 1) {
          return [cachedPosition];
        }
        await currentRead;
        return [currentPosition];
      },
      async listExecutions() {
        return [];
      },
      async listOrders() {
        return [];
      },
    },
  });

  try {
    const first = await listIbkrPositions({
      accountId: "DU123",
      mode: "shadow",
    });
    assert.equal(first.length, 1);

    await delay(10);

    let settled = false;
    const refreshed = listIbkrPositions({
      accountId: "DU123",
      mode: "shadow",
    });
    const joined = listIbkrPositions({ accountId: "DU123", mode: "shadow" });
    void refreshed.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await delay(20);
    assert.equal(settled, false);
    assert.equal(positionCalls, 2);

    releaseCurrentRead();
    assert.deepEqual(await refreshed, [currentPosition]);
    assert.deepEqual(await joined, [currentPosition]);
    assert.equal(positionCalls, 2);
  } finally {
    releaseCurrentRead();
    if (priorTtl == null) {
      delete process.env["IBKR_ACCOUNT_CACHE_TTL_MS"];
    } else {
      process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = priorTtl;
    }
  }
});

test("positions refresh to empty rows instead of preserving stale broker rows", async () => {
  const priorTtl = process.env["IBKR_ACCOUNT_CACHE_TTL_MS"];
  process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = "1";
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
      async listOrders() {
        return [];
      },
    },
  });

  try {
    const first = await listIbkrPositions({
      accountId: "DU123",
      mode: "shadow",
    });
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
  }
});

test("expired account, execution, and order failures reject instead of replaying cached data", async () => {
  const priorAccountTtl = process.env["IBKR_ACCOUNT_CACHE_TTL_MS"];
  const priorExecutionTtl = process.env["IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS"];
  process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = "1";
  process.env["IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS"] = "1";
  let accountCalls = 0;
  let executionCalls = 0;
  let orderCalls = 0;
  const failure = () =>
    new HttpError(503, "IBKR unavailable.", {
      code: "upstream_request_failed",
    });

  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      async listAccounts() {
        accountCalls += 1;
        if (accountCalls > 1) throw failure();
        return [
          {
            id: "DU123",
            providerAccountId: "DU123",
            provider: "ibkr" as const,
            mode: "shadow" as const,
            displayName: "IBKR DU123",
            currency: "USD",
            buyingPower: 1,
            cash: 1,
            netLiquidation: 1,
            updatedAt: new Date("2026-07-10T00:00:00.000Z"),
          },
        ];
      },
      async listPositions() {
        return [];
      },
      async listExecutions() {
        executionCalls += 1;
        if (executionCalls > 1) throw failure();
        return [{ id: "execution-old" }] as never;
      },
      async listOrders() {
        orderCalls += 1;
        if (orderCalls > 1) throw failure();
        return [{ id: "order-old" }] as never;
      },
    },
  });

  try {
    await listIbkrAccounts("shadow");
    await listIbkrExecutions({ accountId: "DU123", mode: "shadow" });
    await listIbkrOrders({ accountId: "DU123", mode: "shadow" });
    await delay(10);

    await assert.rejects(listIbkrAccounts("shadow"), HttpError);
    await assert.rejects(
      listIbkrExecutions({ accountId: "DU123", mode: "shadow" }),
      HttpError,
    );
    await assert.rejects(
      listIbkrOrders({ accountId: "DU123", mode: "shadow" }),
      HttpError,
    );
  } finally {
    if (priorAccountTtl == null) {
      delete process.env["IBKR_ACCOUNT_CACHE_TTL_MS"];
    } else {
      process.env["IBKR_ACCOUNT_CACHE_TTL_MS"] = priorAccountTtl;
    }
    if (priorExecutionTtl == null) {
      delete process.env["IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS"];
    } else {
      process.env["IBKR_ACCOUNT_EXECUTION_CACHE_TTL_MS"] = priorExecutionTtl;
    }
  }
});
