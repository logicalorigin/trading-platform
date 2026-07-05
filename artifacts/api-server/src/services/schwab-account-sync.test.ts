import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";
import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import { syncSchwabConnections } from "./schwab-account-sync";
import { beginSchwabConnectCustody, storeSchwabTokens } from "./schwab-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64url");
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

async function seedConnectedUser(email: string): Promise<string> {
  const auth = await bootstrapInitialUser({
    email,
    password: "correct horse battery staple",
    bootstrapToken: "setup-token",
  });
  await beginSchwabConnectCustody({
    appUserId: auth.user.id,
    oauthState: "state-1",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  await storeSchwabTokens({
    appUserId: auth.user.id,
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    scope: "api",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  return auth.user.id;
}

function traderApiFetch(payloads: {
  accountNumbers: unknown;
  accounts: unknown;
}): typeof fetch {
  return async (url, init) => {
    const requestUrl = new URL(String(url));
    assert.equal(requestUrl.origin, "https://api.schwabapi.com");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer access-1");
    if (requestUrl.pathname === "/trader/v1/accounts/accountNumbers") {
      return new Response(JSON.stringify(payloads.accountNumbers), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (requestUrl.pathname === "/trader/v1/accounts") {
      return new Response(JSON.stringify(payloads.accounts), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected path ${requestUrl.pathname}`);
  };
}

const ONE_ACCOUNT_NUMBERS = [{ accountNumber: "12345678", hashValue: "ABC123HASH" }];
const ONE_ACCOUNT = [
  { securitiesAccount: { accountNumber: "12345678", type: "MARGIN" } },
];

test("Schwab sync reads accounts over the Trader API and upserts sanitized broker records", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("owner@example.com");
      const syncedAt = new Date("2026-07-02T19:00:00.000Z");

      const result = await syncSchwabConnections({
        appUserId,
        env: TEST_ENV,
        fetchImpl: traderApiFetch({
          accountNumbers: ONE_ACCOUNT_NUMBERS,
          accounts: ONE_ACCOUNT,
        }),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: syncedAt,
      });

      assert.equal(result.provider, "schwab");
      assert.equal(result.connections.length, 1);
      const connection = result.connections[0]!;
      assert.equal(connection.provider, "schwab");
      assert.equal(connection.executionReady, false);
      assert.ok(
        connection.executionBlockers.includes("schwab.order_tooling_unverified"),
      );

      assert.equal(result.accounts.length, 1);
      const account = result.accounts[0]!;
      assert.equal(account.schwabAccountHash, "ABC123HASH");
      assert.equal(account.executionReady, false);
      assert.ok(
        account.executionBlockers.includes("schwab.order_tooling_unverified"),
      );
      // Only the last four digits of the account number may appear.
      assert.ok(account.displayName.includes("...5678"));
      assert.ok(!account.displayName.includes("12345678"));

      assert.deepEqual(result.totals, {
        upstreamAccounts: 1,
        storedConnections: 1,
        storedAccounts: 1,
      });

      const connectionRows = await db
        .select()
        .from(brokerConnectionsTable)
        .where(eq(brokerConnectionsTable.brokerProvider, "schwab"));
      assert.equal(connectionRows.length, 1);
      assert.equal(connectionRows[0]!.appUserId, appUserId);
      assert.equal(connectionRows[0]!.name, "schwab:trader-api");
      assert.equal(connectionRows[0]!.status, "connected");
      assert.equal(connectionRows[0]!.mode, "live");

      const accountRows = await db
        .select()
        .from(brokerAccountsTable)
        .where(eq(brokerAccountsTable.appUserId, appUserId));
      assert.equal(accountRows.length, 1);
      assert.equal(accountRows[0]!.providerAccountId, "schwab:ABC123HASH");
      assert.ok(!accountRows[0]!.displayName.includes("12345678"));
    }),
  );
});

test("Schwab sync skips accounts with no matching hashValue", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("owner@example.com");

      const result = await syncSchwabConnections({
        appUserId,
        env: TEST_ENV,
        fetchImpl: traderApiFetch({
          accountNumbers: [],
          accounts: ONE_ACCOUNT,
        }),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-02T19:00:00.000Z"),
      });

      assert.equal(result.accounts.length, 0);
      assert.equal(result.totals.upstreamAccounts, 0);
      assert.equal(result.totals.storedAccounts, 0);
      // The connection itself is still upserted even with zero accounts.
      assert.equal(result.connections.length, 1);
      assert.equal(result.connections[0]!.accountCount, 0);

      const accountRows = await db
        .select()
        .from(brokerAccountsTable)
        .where(eq(brokerAccountsTable.appUserId, appUserId));
      assert.equal(accountRows.length, 0);
    }),
  );
});

test("Schwab sync throws 502 when the upstream accounts payload is not an array", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("owner@example.com");

      await assert.rejects(
        syncSchwabConnections({
          appUserId,
          env: TEST_ENV,
          fetchImpl: traderApiFetch({
            accountNumbers: ONE_ACCOUNT_NUMBERS,
            accounts: { not: "an-array" },
          }),
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
        (error: unknown) => {
          const httpError = error as { statusCode?: number; code?: string };
          return httpError.statusCode === 502;
        },
      );
    }),
  );
});
