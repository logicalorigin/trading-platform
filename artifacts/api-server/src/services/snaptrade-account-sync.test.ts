import assert from "node:assert/strict";
import test from "node:test";

import { eq } from "drizzle-orm";
import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import { syncSnapTradeBrokerageConnections } from "./snaptrade-account-sync";
import {
  deriveSnapTradeUserId,
  recordSnapTradeUserCredential,
} from "./snaptrade-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64url");

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

async function createUser(email: string) {
  return bootstrapInitialUser({
    email,
    password: "correct horse battery staple",
    bootstrapToken: "setup-token",
  });
}

async function createAdditionalUser(email: string) {
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      displayName: null,
      passwordHash: "scrypt:v1:test-only",
      role: "user",
    })
    .returning({ id: usersTable.id });
  assert.ok(user);
  return user;
}

test("SnapTrade account sync signs user-scoped reads and upserts sanitized broker records", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const auth = await createUser("owner@example.com");
      const snapTradeUserId = deriveSnapTradeUserId(auth.user.id);
      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId,
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T19:00:00.000Z"),
      });

      const requestedUrls: string[] = [];
      const requestedSignatures: string[] = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        requestedUrls.push(String(url));
        requestedSignatures.push(new Headers(init?.headers).get("Signature") ?? "");
        assert.equal(init?.method, "GET");

        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.origin, "https://api.snaptrade.com");
        assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
        assert.equal(requestUrl.searchParams.get("timestamp"), "1782933000");
        assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
        assert.equal(
          requestUrl.searchParams.get("userSecret"),
          "snaptrade-user-secret",
        );

        if (requestUrl.pathname === "/api/v1/authorizations") {
          return new Response(
            JSON.stringify([
              {
                id: "auth-ibkr-1",
                type: "trade",
                disabled: false,
                brokerage: {
                  slug: "INTERACTIVE-BROKERS-FLEX",
                  name: "Interactive Brokers",
                  allows_trading: true,
                },
              },
              {
                id: "auth-etrade-1",
                type: "read",
                disabled: false,
                brokerage: {
                  slug: "ETRADE",
                  name: "E*TRADE",
                  allows_trading: true,
                },
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (requestUrl.pathname === "/api/v1/accounts") {
          return new Response(
            JSON.stringify([
              {
                id: "acct-ibkr-1",
                brokerage_authorization: "auth-ibkr-1",
                name: "Main IBKR",
                number: "U1234567",
                institution_name: "Interactive Brokers",
                balance: { currency: { code: "USD" } },
                status: "open",
              },
              {
                id: "acct-etrade-1",
                brokerage_authorization: { id: "auth-etrade-1" },
                number: "7788992222",
                institution_name: "E*TRADE",
                balance: { currency: "USD" },
                status: "closed",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ message: "unexpected path" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      };

      const result = await syncSnapTradeBrokerageConnections({
        appUserId: auth.user.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T19:10:00.000Z"),
        fetchImpl,
      });

      assert.equal(requestedUrls.length, 2);
      assert.ok(
        requestedUrls.some(
          (url) => new URL(url).pathname === "/api/v1/authorizations",
        ),
      );
      assert.ok(
        requestedUrls.some(
          (url) => new URL(url).pathname === "/api/v1/accounts",
        ),
      );
      assert.equal(requestedSignatures.length, 2);
      assert.ok(requestedSignatures.every((signature) => signature.length > 20));
      assert.doesNotMatch(requestedUrls.join("\n"), /consumer-secret/);

      assert.equal(result.provider, "snaptrade");
      assert.equal(result.syncedAt, "2026-07-01T19:10:00.000Z");
      assert.equal(result.connections.length, 2);
      assert.equal(result.accounts.length, 2);
      assert.deepEqual(result.totals, {
        upstreamConnections: 2,
        upstreamAccounts: 2,
        storedConnections: 2,
        storedAccounts: 2,
      });
      assert.equal(result.connections[0]?.snapTradeConnectionId, "auth-ibkr-1");
      assert.equal(result.connections[0]?.connectionType, "trade");
      assert.equal(result.connections[0]?.tradeEnabled, true);
      assert.equal(result.connections[0]?.executionReady, true);
      assert.deepEqual(result.connections[0]?.executionBlockers, []);
      assert.equal(result.connections[1]?.snapTradeConnectionId, "auth-etrade-1");
      assert.equal(result.connections[1]?.connectionType, "read");
      assert.equal(result.connections[1]?.tradeEnabled, false);
      assert.equal(result.connections[1]?.executionReady, false);
      assert.deepEqual(result.connections[1]?.executionBlockers, [
        "snaptrade.connection.read_only",
      ]);
      assert.equal(result.accounts[0]?.snapTradeAccountId, "acct-ibkr-1");
      assert.equal(result.accounts[0]?.displayName, "Main IBKR");
      assert.equal(result.accounts[0]?.status, "open");
      assert.equal(result.accounts[0]?.executionReady, true);
      assert.deepEqual(result.accounts[0]?.executionBlockers, []);
      assert.equal(result.accounts[1]?.displayName, "E*TRADE account ...2222");
      assert.equal(result.accounts[1]?.status, "closed");
      assert.equal(result.accounts[1]?.executionReady, false);
      assert.deepEqual(result.accounts[1]?.executionBlockers, [
        "snaptrade.connection.read_only",
        "snaptrade.account.closed",
      ]);
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|client-123|pyrus-|U1234567|7788992222/,
      );

      const storedConnections = await db.select().from(brokerConnectionsTable);
      assert.equal(storedConnections.length, 2);
      assert.deepEqual(
        storedConnections
          .map((connection) => ({
            name: connection.name,
            brokerProvider: connection.brokerProvider,
            mode: connection.mode,
            status: connection.status,
            capabilities: connection.capabilities,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        [
          {
            name: "snaptrade:auth-etrade-1",
            brokerProvider: "snaptrade",
            mode: "live",
            status: "connected",
            capabilities: [
              "accounts",
              "positions",
              "snaptrade",
              "snaptrade-brokerage:ETRADE",
              "read-only",
            ],
          },
          {
            name: "snaptrade:auth-ibkr-1",
            brokerProvider: "snaptrade",
            mode: "live",
            status: "connected",
            capabilities: [
              "accounts",
              "positions",
              "snaptrade",
              "snaptrade-brokerage:INTERACTIVE-BROKERS-FLEX",
              "orders",
              "executions",
              "execution-ready",
            ],
          },
        ],
      );

      const storedAccounts = await db.select().from(brokerAccountsTable);
      assert.equal(storedAccounts.length, 2);
      assert.deepEqual(
        storedAccounts
          .map((account) => ({
            providerAccountId: account.providerAccountId,
            displayName: account.displayName,
            capabilities: account.capabilities,
            mode: account.mode,
            baseCurrency: account.baseCurrency,
            lastSyncedAt: account.lastSyncedAt,
          }))
          .sort((a, b) => a.providerAccountId.localeCompare(b.providerAccountId)),
        [
          {
            providerAccountId: "snaptrade:acct-etrade-1",
            displayName: "E*TRADE account ...2222",
            capabilities: [
              "accounts",
              "positions",
              "snaptrade",
              "snaptrade-account-last4:2222",
            ],
            mode: "live",
            baseCurrency: "USD",
            lastSyncedAt: "2026-07-01T19:10:00.000Z",
          },
          {
            providerAccountId: "snaptrade:acct-ibkr-1",
            displayName: "Main IBKR",
            capabilities: [
              "accounts",
              "positions",
              "snaptrade",
              "snaptrade-account-last4:4567",
              "orders",
              "executions",
              "execution-ready",
            ],
            mode: "live",
            baseCurrency: "USD",
            lastSyncedAt: "2026-07-01T19:10:00.000Z",
          },
        ],
      );

      await syncSnapTradeBrokerageConnections({
        appUserId: auth.user.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T19:10:00.000Z"),
        fetchImpl,
      });

      const connectionCount = await db
        .select()
        .from(brokerConnectionsTable)
        .where(eq(brokerConnectionsTable.brokerProvider, "snaptrade"));
      const accountCount = await db
        .select()
        .from(brokerAccountsTable)
        .where(eq(brokerAccountsTable.mode, "live"));

      assert.equal(connectionCount.length, 2);
      assert.equal(accountCount.length, 2);
    }),
  );
});

test("SnapTrade account sync keeps identical upstream ids isolated per app user", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const owner = await createUser("owner@example.com");
      const other = await createAdditionalUser("other@example.com");
      await recordSnapTradeUserCredential({
        appUserId: owner.user.id,
        snapTradeUserId: deriveSnapTradeUserId(owner.user.id),
        userSecret: "owner-snaptrade-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      await recordSnapTradeUserCredential({
        appUserId: other.id,
        snapTradeUserId: deriveSnapTradeUserId(other.id),
        userSecret: "other-snaptrade-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      const fetchImpl: typeof fetch = async (url) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname === "/api/v1/authorizations") {
          return new Response(
            JSON.stringify([
              {
                id: "auth-shared-1",
                type: "trade",
                disabled: false,
                brokerage: {
                  slug: "INTERACTIVE-BROKERS-FLEX",
                  name: "Interactive Brokers",
                },
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (requestUrl.pathname === "/api/v1/accounts") {
          return new Response(
            JSON.stringify([
              {
                id: "acct-shared-1",
                brokerage_authorization: "auth-shared-1",
                name: "Shared ID Account",
                number: "U000111",
                institution_name: "Interactive Brokers",
                balance: { currency: { code: "USD" } },
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ message: "unexpected path" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      };

      const ownerResult = await syncSnapTradeBrokerageConnections({
        appUserId: owner.user.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T19:20:00.000Z"),
        fetchImpl,
      });
      const otherResult = await syncSnapTradeBrokerageConnections({
        appUserId: other.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T19:25:00.000Z"),
        fetchImpl,
      });

      assert.notEqual(ownerResult.connections[0]?.id, otherResult.connections[0]?.id);
      assert.notEqual(ownerResult.accounts[0]?.id, otherResult.accounts[0]?.id);

      const storedConnections = await db
        .select()
        .from(brokerConnectionsTable)
        .where(eq(brokerConnectionsTable.brokerProvider, "snaptrade"));
      const storedAccounts = await db
        .select()
        .from(brokerAccountsTable)
        .where(eq(brokerAccountsTable.providerAccountId, "snaptrade:acct-shared-1"));

      assert.equal(storedConnections.length, 2);
      assert.equal(storedAccounts.length, 2);
    }),
  );
});

test("SnapTrade account sync classifies new accounts and preserves manual inclusion on re-sync", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const auth = await createUser("snaptrade-categories@example.com");
      const snapTradeUserId = deriveSnapTradeUserId(auth.user.id);
      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId,
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      let accountName = "Webull Individual Cash";
      const fetchImpl: typeof fetch = async (url) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname === "/api/v1/authorizations") {
          return new Response(
            JSON.stringify([
              {
                id: "auth-webull-1",
                type: "trade",
                disabled: false,
                brokerage: {
                  slug: "WEBULL",
                  name: "Webull",
                  allows_trading: true,
                },
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (requestUrl.pathname === "/api/v1/accounts") {
          return new Response(
            JSON.stringify([
              {
                id: "acct-webull-equity",
                brokerage_authorization: "auth-webull-1",
                name: accountName,
                number: "11112222",
                institution_name: "Webull",
                balance: { currency: { code: "USD" } },
                status: "open",
              },
              {
                id: "acct-webull-futures",
                brokerage_authorization: "auth-webull-1",
                name: "Webull Futures",
                number: "33334444",
                institution_name: "Webull",
                balance: { currency: { code: "USD" } },
                status: "open",
              },
              {
                id: "acct-webull-events",
                brokerage_authorization: "auth-webull-1",
                name: "Webull Events Cash",
                number: "55556666",
                institution_name: "Webull",
                balance: { currency: { code: "USD" } },
                status: "open",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ message: "unexpected path" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      };

      const inserted = await syncSnapTradeBrokerageConnections({
        appUserId: auth.user.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T21:00:00.000Z"),
        fetchImpl,
      });

      assert.deepEqual(
        inserted.accounts.map((account) => ({
          snapTradeAccountId: account.snapTradeAccountId,
          accountType: account.accountType,
          includedInTrading: account.includedInTrading,
        })),
        [
          {
            snapTradeAccountId: "acct-webull-equity",
            accountType: "equity",
            includedInTrading: true,
          },
          {
            snapTradeAccountId: "acct-webull-futures",
            accountType: "futures",
            includedInTrading: false,
          },
          {
            snapTradeAccountId: "acct-webull-events",
            accountType: "prediction",
            includedInTrading: false,
          },
        ],
      );

      const equityAccount = inserted.accounts.find(
        (account) => account.snapTradeAccountId === "acct-webull-equity",
      );
      assert.ok(equityAccount);
      await db
        .update(brokerAccountsTable)
        .set({ includedInTrading: false })
        .where(eq(brokerAccountsTable.id, equityAccount.id));

      accountName = "Webull Crypto Cash";
      const resynced = await syncSnapTradeBrokerageConnections({
        appUserId: auth.user.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T21:05:00.000Z"),
        fetchImpl,
      });
      const renamed = resynced.accounts.find(
        (account) => account.snapTradeAccountId === "acct-webull-equity",
      );
      assert.equal(renamed?.displayName, "Webull Crypto Cash");
      assert.equal(renamed?.accountType, "crypto");
      assert.equal(renamed?.includedInTrading, false);

      const [storedRenamed] = await db
        .select({
          displayName: brokerAccountsTable.displayName,
          accountType: brokerAccountsTable.accountType,
          includedInTrading: brokerAccountsTable.includedInTrading,
        })
        .from(brokerAccountsTable)
        .where(eq(brokerAccountsTable.id, equityAccount.id))
        .limit(1);
      assert.deepEqual(storedRenamed, {
        displayName: "Webull Crypto Cash",
        accountType: "crypto",
        includedInTrading: false,
      });
    }),
  );
});

test("SnapTrade account sync blocks execution for disabled and non-trading connections", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("blocked@example.com");
      const snapTradeUserId = deriveSnapTradeUserId(auth.user.id);
      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId,
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      const fetchImpl: typeof fetch = async (url) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname === "/api/v1/authorizations") {
          return new Response(
            JSON.stringify([
              {
                id: "auth-disabled-1",
                type: "trade",
                disabled: true,
                brokerage: {
                  slug: "BROKER-DISABLED",
                  name: "Disabled Broker",
                  allows_trading: true,
                },
              },
              {
                id: "auth-no-trading-1",
                type: "trade",
                disabled: false,
                brokerage: {
                  slug: "BROKER-NO-TRADING",
                  name: "No Trading Broker",
                  allows_trading: false,
                },
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (requestUrl.pathname === "/api/v1/accounts") {
          return new Response(
            JSON.stringify([
              {
                id: "acct-disabled-1",
                brokerage_authorization: "auth-disabled-1",
                name: "Disabled Account",
                institution_name: "Disabled Broker",
                balance: { currency: { code: "USD" } },
                status: "open",
              },
              {
                id: "acct-no-trading-1",
                brokerage_authorization: "auth-no-trading-1",
                name: "Archived Account",
                institution_name: "No Trading Broker",
                balance: { currency: { code: "USD" } },
                status: "archived",
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ message: "unexpected path" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      };

      const result = await syncSnapTradeBrokerageConnections({
        appUserId: auth.user.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:05:00.000Z"),
        fetchImpl,
      });

      const disabledConnection = result.connections.find(
        (connection) => connection.snapTradeConnectionId === "auth-disabled-1",
      );
      assert.equal(disabledConnection?.connectionType, "trade");
      assert.equal(disabledConnection?.tradeEnabled, true);
      assert.equal(disabledConnection?.status, "disconnected");
      assert.equal(disabledConnection?.executionReady, false);
      assert.deepEqual(disabledConnection?.executionBlockers, [
        "snaptrade.connection.disabled",
      ]);

      const unsupportedConnection = result.connections.find(
        (connection) =>
          connection.snapTradeConnectionId === "auth-no-trading-1",
      );
      assert.equal(unsupportedConnection?.connectionType, "trade");
      assert.equal(unsupportedConnection?.tradeEnabled, true);
      assert.equal(unsupportedConnection?.executionReady, false);
      assert.deepEqual(unsupportedConnection?.executionBlockers, [
        "snaptrade.brokerage.trading_not_supported",
      ]);

      const disabledAccount = result.accounts.find(
        (account) => account.snapTradeAccountId === "acct-disabled-1",
      );
      assert.equal(disabledAccount?.status, "open");
      assert.equal(disabledAccount?.executionReady, false);
      assert.deepEqual(disabledAccount?.executionBlockers, [
        "snaptrade.connection.disabled",
      ]);

      const archivedAccount = result.accounts.find(
        (account) => account.snapTradeAccountId === "acct-no-trading-1",
      );
      assert.equal(archivedAccount?.status, "archived");
      assert.equal(archivedAccount?.executionReady, false);
      assert.deepEqual(archivedAccount?.executionBlockers, [
        "snaptrade.brokerage.trading_not_supported",
        "snaptrade.account.archived",
      ]);
    }),
  );
});
