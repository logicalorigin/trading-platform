import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { HttpError } from "../lib/errors";
import { getCurrentAppUserId, runAsAppUser } from "./app-user-context";
import {
  __resetIbkrAccountBridgeCacheForTests,
  __setIbkrAccountBridgeDependenciesForTests,
  listIbkrAccounts,
  listIbkrExecutions,
  listIbkrOrders,
  listIbkrPositions,
} from "./ibkr-account-bridge";
import {
  ensureGateway,
  markGatewayPaperAccountVerified,
  refreshGateway,
  stopGateway,
} from "./ibkr-portal-gateway-manager";
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

test("a user without a verified gateway cannot consume the global account cache", async () => {
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

  await listIbkrAccounts("shadow");

  await assert.rejects(
    runAsAppUser("bridge-cache-user-without-gateway", () =>
      listIbkrAccounts("shadow"),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === "ibkr_client_portal_not_configured",
  );
  assert.equal(accountCalls, 1);
});

test("all account bridge caches and singleflights are isolated by user and gateway login generation", async () => {
  const previousEnabled = process.env["IBKR_SESSION_HOST_ENABLED"];
  const previousToken = process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
  const previousAccountConcurrency =
    process.env["WORK_GOVERNOR_ACCOUNT_CONCURRENCY"];
  const previousOrderConcurrency =
    process.env["WORK_GOVERNOR_ORDERS_CONCURRENCY"];
  const previousFetch = globalThis.fetch;
  const userA = "bridge-cache-user-a";
  const userB = "bridge-cache-user-b";
  const loginCompletions = new Map([
    [userA, 0],
    [userB, 0],
  ]);
  const calls = { accounts: 0, positions: 0, executions: 0, orders: 0 };
  let blockedRead: keyof typeof calls | null = null;
  let releaseBlockedReads = () => {};
  let blockedReads = Promise.resolve();
  const block = async (read: keyof typeof calls): Promise<void> => {
    calls[read] += 1;
    assert.ok(getCurrentAppUserId());
    if (blockedRead === read) await blockedReads;
  };

  process.env["IBKR_SESSION_HOST_ENABLED"] = "1";
  process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = "host-token";
  process.env["WORK_GOVERNOR_ACCOUNT_CONCURRENCY"] = "8";
  process.env["WORK_GOVERNOR_ORDERS_CONCURRENCY"] = "8";
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("/release")) return Response.json({ released: true });
    const appUserId = [...loginCompletions.keys()].find((candidate) =>
      url.includes(`/sessions/${candidate}/`),
    );
    assert.ok(appUserId);
    const capsule = {
      loginCompletions: loginCompletions.get(appUserId),
      name: `pyrus-${appUserId}`,
      status: "ready" as const,
    };
    if (url.endsWith("/status")) return Response.json({ capsule });
    return Response.json({
      capsule,
      targets: {
        cpg: { host: "127.0.0.1", port: 15000 },
        console: { host: "127.0.0.1", port: 16080 },
      },
    });
  }) as typeof fetch;

  __setIbkrAccountBridgeDependenciesForTests({
    bridgeClient: {
      async listAccounts() {
        await block("accounts");
        return [];
      },
      async listPositions() {
        await block("positions");
        return [];
      },
      async listExecutions() {
        await block("executions");
        return [];
      },
      async listOrders() {
        await block("orders");
        return [];
      },
    },
  });

  const reads = {
    accounts: () => listIbkrAccounts("shadow"),
    positions: () =>
      listIbkrPositions({ accountId: "DU123", mode: "shadow" }),
    executions: () =>
      listIbkrExecutions({ accountId: "DU123", mode: "shadow" }),
    orders: () => listIbkrOrders({ accountId: "DU123", mode: "shadow" }),
  };
  const readAll = (appUserId: string) =>
    runAsAppUser(appUserId, () => Promise.all(Object.values(reads).map((read) => read())));

  try {
    await ensureGateway(userA);
    await ensureGateway(userB);
    assert.equal(markGatewayPaperAccountVerified(userA), true);
    assert.equal(markGatewayPaperAccountVerified(userB), true);

    await readAll(userA);
    await readAll(userA);
    await readAll(userB);
    assert.deepEqual(calls, {
      accounts: 2,
      positions: 2,
      executions: 2,
      orders: 2,
    });

    loginCompletions.set(userA, 1);
    await refreshGateway(userA);
    await readAll(userA);
    assert.deepEqual(calls, {
      accounts: 3,
      positions: 3,
      executions: 3,
      orders: 3,
    });

    for (const [name, read] of Object.entries(reads) as Array<
      [keyof typeof reads, () => Promise<unknown[]>]
    >) {
      __resetIbkrAccountBridgeCacheForTests();
      blockedRead = name;
      blockedReads = new Promise<void>((resolve) => {
        releaseBlockedReads = resolve;
      });
      const before = calls[name];
      const pending = [
        runAsAppUser(userA, read),
        runAsAppUser(userA, read),
        runAsAppUser(userB, read),
      ];
      try {
        await delay(20);
        assert.equal(calls[name] - before, 2, name);
      } finally {
        releaseBlockedReads();
        await Promise.allSettled(pending);
        blockedRead = null;
      }
    }
  } finally {
    releaseBlockedReads();
    await stopGateway(userA);
    await stopGateway(userB);
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) {
      delete process.env["IBKR_SESSION_HOST_ENABLED"];
    } else {
      process.env["IBKR_SESSION_HOST_ENABLED"] = previousEnabled;
    }
    if (previousToken === undefined) {
      delete process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"];
    } else {
      process.env["IBKR_SESSION_HOST_CONTROL_TOKEN"] = previousToken;
    }
    if (previousAccountConcurrency === undefined) {
      delete process.env["WORK_GOVERNOR_ACCOUNT_CONCURRENCY"];
    } else {
      process.env["WORK_GOVERNOR_ACCOUNT_CONCURRENCY"] =
        previousAccountConcurrency;
    }
    if (previousOrderConcurrency === undefined) {
      delete process.env["WORK_GOVERNOR_ORDERS_CONCURRENCY"];
    } else {
      process.env["WORK_GOVERNOR_ORDERS_CONCURRENCY"] = previousOrderConcurrency;
    }
  }
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
