import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import { listSchwabRecentOrders } from "./schwab-orders-read";
import {
  beginSchwabConnectCustody,
  storeSchwabTokens,
} from "./schwab-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64url");
const TEST_ENV = {
  SCHWAB_APP_KEY: "app-key-abc",
  SCHWAB_APP_SECRET: "app-secret-xyz",
};

async function withBootstrapToken<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
  process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = "setup-token";
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
    } else {
      process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = previous;
    }
  }
}

// Fresh cached access token so getSchwabAccessToken never hits the network — the
// only fetch this test drives is the /orders read.
async function seedConnectedUser(email: string, now: Date): Promise<string> {
  const auth = await bootstrapInitialUser({
    email,
    password: "correct horse battery staple",
    bootstrapToken: "setup-token",
  });
  await beginSchwabConnectCustody({
    appUserId: auth.user.id,
    oauthState: "state-1",
    encryptionKey: TEST_ENCRYPTION_KEY,
    now,
  });
  await storeSchwabTokens({
    appUserId: auth.user.id,
    accessToken: "fresh-access-token",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    refreshTokenExpiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    scope: "api",
    encryptionKey: TEST_ENCRYPTION_KEY,
    now,
  });
  return auth.user.id;
}

async function createSchwabAccount(input: {
  appUserId: string;
  providerAccountId: string;
  executionReady: boolean;
}) {
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: input.appUserId,
      name: "schwab:trader-api",
      connectionType: "broker",
      brokerProvider: "schwab",
      mode: "live",
      status: "connected",
      capabilities: ["accounts", "positions", "schwab", "orders"],
    })
    .returning({ id: brokerConnectionsTable.id });
  assert.ok(connection);

  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: input.appUserId,
      connectionId: connection.id,
      providerAccountId: input.providerAccountId,
      displayName: "Schwab ...5678",
      mode: "live",
      accountStatus: "open",
      baseCurrency: "USD",
      capabilities: input.executionReady
        ? ["accounts", "positions", "schwab", "orders", "execution-ready"]
        : ["accounts", "positions", "schwab", "orders"],
      executionBlockers: input.executionReady
        ? []
        : ["schwab.order_tooling_unverified"],
      lastSyncedAt: "2026-07-02T19:00:00.000Z",
    })
    .returning({ id: brokerAccountsTable.id });
  assert.ok(account);
  return account;
}

test("listSchwabRecentOrders reads GET /orders and returns sanitized normalized rows", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const now = new Date("2026-07-02T19:30:00.000Z");
      const appUserId = await seedConnectedUser("orders-read@example.com", now);
      const account = await createSchwabAccount({
        appUserId,
        providerAccountId: "schwab:ABC123HASH",
        executionReady: true,
      });

      const result = await listSchwabRecentOrders({
        appUserId,
        accountId: account.id,
        query: { maxResults: 5, status: "FILLED" },
        env: TEST_ENV,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
        fetchImpl: async (url, init) => {
          const requestUrl = new URL(String(url));
          assert.equal(requestUrl.origin, "https://api.schwabapi.com");
          assert.equal(
            requestUrl.pathname,
            "/trader/v1/accounts/ABC123HASH/orders",
          );
          assert.equal(requestUrl.searchParams.get("maxResults"), "5");
          assert.equal(requestUrl.searchParams.get("status"), "FILLED");
          assert.equal(init?.method ?? "GET", "GET");
          assert.equal(
            new Headers(init?.headers).get("Authorization"),
            "Bearer fresh-access-token",
          );
          return new Response(
            JSON.stringify([
              {
                orderId: 1000123456,
                accountNumber: "12345678",
                status: "FILLED",
                orderType: "LIMIT",
                quantity: 10,
                filledQuantity: 10,
                price: 45.97,
                enteredTime: "2026-07-02T14:31:00+0000",
                orderLegCollection: [
                  {
                    instruction: "BUY",
                    quantity: 10,
                    instrument: { symbol: "AAPL", assetType: "EQUITY" },
                  },
                ],
              },
              {
                orderId: 1000123457,
                accountNumber: "12345678",
                status: "WORKING",
                orderType: "LIMIT",
                quantity: 1,
                filledQuantity: 0,
                price: 2.4,
                enteredTime: "2026-07-02T15:02:00+0000",
                orderLegCollection: [
                  {
                    instruction: "BUY_TO_OPEN",
                    quantity: 1,
                    instrument: {
                      symbol: "AAPL  260821C00200000",
                      assetType: "OPTION",
                    },
                  },
                ],
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      });

      assert.equal(result.provider, "schwab");
      assert.equal(result.account.id, account.id);
      assert.equal(result.orders.length, 2);
      assert.deepEqual(result.orders[0], {
        orderId: "1000123456",
        symbol: "AAPL",
        assetType: "EQUITY",
        instruction: "BUY",
        quantity: 10,
        filledQuantity: 10,
        status: "FILLED",
        orderType: "LIMIT",
        price: 45.97,
        enteredTime: "2026-07-02T14:31:00+0000",
      });
      assert.equal(result.orders[1]?.assetType, "OPTION");
      assert.equal(result.orders[1]?.instruction, "BUY_TO_OPEN");
      // Sanitation: neither the raw account number nor the access token leak.
      assert.doesNotMatch(
        JSON.stringify(result),
        /12345678|fresh-access-token|refresh-1/,
      );
    }),
  );
});

test("listSchwabRecentOrders throws 409 while the account is not execution-ready", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const now = new Date("2026-07-02T19:30:00.000Z");
      const appUserId = await seedConnectedUser(
        "orders-read-blocked@example.com",
        now,
      );
      const account = await createSchwabAccount({
        appUserId,
        providerAccountId: "schwab:BLOCKEDHASH",
        executionReady: false,
      });

      let called = false;
      await assert.rejects(
        listSchwabRecentOrders({
          appUserId,
          accountId: account.id,
          env: TEST_ENV,
          encryptionKey: TEST_ENCRYPTION_KEY,
          now,
          fetchImpl: async () => {
            called = true;
            throw new Error("provider fetch should not run while blocked");
          },
        }),
        (error: unknown) => {
          const e = error as { statusCode?: number; code?: string };
          assert.equal(e.statusCode, 409);
          assert.equal(e.code, "schwab_account_execution_blocked");
          return true;
        },
      );
      assert.equal(called, false);
    }),
  );
});
