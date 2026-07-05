import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import { getSnapTradeAccountPortfolio } from "./snaptrade-account-portfolio";
import {
  deriveSnapTradeUserId,
  recordSnapTradeUserCredential,
} from "./snaptrade-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64url");

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

test("SnapTrade account portfolio signs user-scoped balance and position reads", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const auth = await createUser("owner@example.com");
      const snapTradeUserId = deriveSnapTradeUserId(auth.user.id);
      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId,
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      const [connection] = await db
        .insert(brokerConnectionsTable)
        .values({
          appUserId: auth.user.id,
          name: "snaptrade:auth-ibkr-1",
          connectionType: "broker",
          brokerProvider: "snaptrade",
          mode: "live",
          status: "connected",
          capabilities: ["accounts", "positions", "snaptrade"],
        })
        .returning({ id: brokerConnectionsTable.id });
      const [account] = await db
        .insert(brokerAccountsTable)
        .values({
          appUserId: auth.user.id,
          connectionId: connection.id,
          providerAccountId: "snaptrade:acct-ibkr-1",
          displayName: "Main IBKR",
          mode: "live",
          baseCurrency: "USD",
          lastSyncedAt: "2026-07-01T19:10:00.000Z",
        })
        .returning({ id: brokerAccountsTable.id });

      const requestedUrls: string[] = [];
      const requestedSignatures: string[] = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        requestedUrls.push(String(url));
        requestedSignatures.push(new Headers(init?.headers).get("Signature") ?? "");
        assert.equal(init?.method, "GET");

        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.origin, "https://api.snaptrade.com");
        assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
        assert.equal(requestUrl.searchParams.get("timestamp"), "1782934200");
        assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
        assert.equal(
          requestUrl.searchParams.get("userSecret"),
          "snaptrade-user-secret",
        );

        if (requestUrl.pathname === "/api/v1/accounts/acct-ibkr-1/balances") {
          return new Response(
            JSON.stringify([
              {
                currency: { code: "USD", name: "US Dollar" },
                cash: 300.71,
                buying_power: 410.71,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (requestUrl.pathname === "/api/v1/accounts/acct-ibkr-1/positions/all") {
          return new Response(
            JSON.stringify({
              results: [
                {
                  instrument: {
                    kind: "stock",
                    symbol: "AAPL",
                    raw_symbol: "AAPL",
                    description: "Apple Inc.",
                    currency: "USD",
                  },
                  units: "10.5",
                  price: "123.45",
                  cost_basis: "118.20",
                  currency: "USD",
                  cash_equivalent: false,
                },
                {
                  instrument: {
                    kind: "option",
                    symbol: "OPTT  260821C00000500",
                    raw_symbol: "OPTT  260821C00000500",
                    description: "OPTT Aug 21 2026 0.5 Call",
                    currency: "USD",
                  },
                  units: "-1",
                  price: "0.11",
                  cost_basis: "50",
                  currency: "USD",
                  cash_equivalent: false,
                },
              ],
              data_freshness: { as_of: "2026-07-01T19:29:00.000Z" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ message: "unexpected path" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      };

      const result = await getSnapTradeAccountPortfolio({
        appUserId: auth.user.id,
        accountId: account.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T19:30:00.000Z"),
        fetchImpl,
      });

      assert.deepEqual(
        requestedUrls.map((url) => new URL(url).pathname).sort(),
        [
          "/api/v1/accounts/acct-ibkr-1/balances",
          "/api/v1/accounts/acct-ibkr-1/positions/all",
        ],
      );
      assert.equal(requestedSignatures.length, 2);
      assert.ok(requestedSignatures.every((signature) => signature.length > 20));
      assert.doesNotMatch(requestedUrls.join("\n"), /consumer-secret/);

      assert.equal(result.provider, "snaptrade");
      assert.equal(result.syncedAt, "2026-07-01T19:30:00.000Z");
      assert.equal(result.account.id, account.id);
      assert.equal(result.account.snapTradeAccountId, "acct-ibkr-1");
      assert.equal(result.account.displayName, "Main IBKR");
      assert.deepEqual(result.balances, [
        {
          currency: "USD",
          cash: 300.71,
          buyingPower: 410.71,
        },
      ]);
      assert.deepEqual(result.positions, [
        {
          snapTradePositionId: "stock:AAPL",
          symbol: "AAPL",
          rawSymbol: "AAPL",
          description: "Apple Inc.",
          instrumentKind: "stock",
          assetClass: "equity",
          quantity: 10.5,
          side: "long",
          price: 123.45,
          averagePurchasePrice: 118.2,
          marketValue: 1296.225,
          costBasis: 1241.1,
          unrealizedPnl: 55.125,
          currency: "USD",
          cashEquivalent: false,
          optionContract: null,
        },
        {
          snapTradePositionId: "option:OPTT  260821C00000500",
          symbol: "OPTT",
          rawSymbol: "OPTT  260821C00000500",
          description: "OPTT Aug 21 2026 0.5 Call",
          instrumentKind: "option",
          assetClass: "option",
          quantity: -1,
          side: "short",
          price: 0.11,
          averagePurchasePrice: 0.5,
          marketValue: -11,
          costBasis: -50,
          unrealizedPnl: 39,
          currency: "USD",
          cashEquivalent: false,
          optionContract: {
            ticker: "OPTT260821C00000500",
            underlying: "OPTT",
            expirationDate: "2026-08-21",
            strike: 0.5,
            right: "call",
            multiplier: 100,
            sharesPerContract: 100,
            providerContractId: null,
            brokerContractId: null,
          },
        },
      ]);
      assert.deepEqual(result.totals, {
        cash: 300.71,
        buyingPower: 410.71,
        positionMarketValue: 1285.225,
        netLiquidation: 1585.935,
        positionCount: 2,
      });
      assert.equal(result.dataFreshness.asOf, "2026-07-01T19:29:00.000Z");
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|client-123|pyrus-/,
      );
    }),
  );
});

test("SnapTrade account portfolio rejects non-SnapTrade local accounts", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const auth = await createUser("owner@example.com");
      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId: deriveSnapTradeUserId(auth.user.id),
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      const [connection] = await db
        .insert(brokerConnectionsTable)
        .values({
          name: "Interactive Brokers Bridge",
          connectionType: "broker",
          brokerProvider: "ibkr",
          mode: "live",
          status: "connected",
          capabilities: ["accounts"],
        })
        .returning({ id: brokerConnectionsTable.id });
      const [account] = await db
        .insert(brokerAccountsTable)
        .values({
          connectionId: connection.id,
          providerAccountId: "U1234567",
          displayName: "IBKR",
          mode: "live",
          baseCurrency: "USD",
        })
        .returning({ id: brokerAccountsTable.id });

      let called = false;
      await assert.rejects(
        getSnapTradeAccountPortfolio({
          appUserId: auth.user.id,
          accountId: account.id,
          env: {
            SNAPTRADE_CLIENTID: "client-123",
            SNAPTRADE_API_KEY: "consumer-secret",
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: async () => {
            called = true;
            throw new Error("fetch should not run");
          },
        }),
        (error) => {
          assert.equal((error as { statusCode?: number }).statusCode, 404);
          assert.equal(
            (error as { code?: string }).code,
            "snaptrade_account_not_found",
          );
          return true;
        },
      );
      assert.equal(called, false);
    }),
  );
});

test("SnapTrade account portfolio rejects another user's local account", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const owner = await createUser("owner@example.com");
      await recordSnapTradeUserCredential({
        appUserId: owner.user.id,
        snapTradeUserId: deriveSnapTradeUserId(owner.user.id),
        userSecret: "owner-snaptrade-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      const other = await createAdditionalUser("other@example.com");
      await recordSnapTradeUserCredential({
        appUserId: other.id,
        snapTradeUserId: deriveSnapTradeUserId(other.id),
        userSecret: "other-snaptrade-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      const [connection] = await db
        .insert(brokerConnectionsTable)
        .values({
          appUserId: owner.user.id,
          name: "snaptrade:owner-auth-ibkr-1",
          connectionType: "broker",
          brokerProvider: "snaptrade",
          mode: "live",
          status: "connected",
          capabilities: ["accounts", "positions", "snaptrade"],
        })
        .returning({ id: brokerConnectionsTable.id });
      const [account] = await db
        .insert(brokerAccountsTable)
        .values({
          appUserId: owner.user.id,
          connectionId: connection.id,
          providerAccountId: "snaptrade:owner-acct-ibkr-1",
          displayName: "Owner IBKR",
          mode: "live",
          baseCurrency: "USD",
        })
        .returning({ id: brokerAccountsTable.id });

      let called = false;
      await assert.rejects(
        getSnapTradeAccountPortfolio({
          appUserId: other.id,
          accountId: account.id,
          env: {
            SNAPTRADE_CLIENTID: "client-123",
            SNAPTRADE_API_KEY: "consumer-secret",
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: async () => {
            called = true;
            throw new Error("fetch should not run");
          },
        }),
        (error) => {
          assert.equal((error as { statusCode?: number }).statusCode, 404);
          assert.equal(
            (error as { code?: string }).code,
            "snaptrade_account_not_found",
          );
          return true;
        },
      );
      assert.equal(called, false);
    }),
  );
});

test("SnapTrade account portfolio rejects invalid positions payloads", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const auth = await createUser("invalid-positions@example.com");
      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId: deriveSnapTradeUserId(auth.user.id),
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      const [connection] = await db
        .insert(brokerConnectionsTable)
        .values({
          appUserId: auth.user.id,
          name: "snaptrade:auth-invalid-positions",
          connectionType: "broker",
          brokerProvider: "snaptrade",
          mode: "live",
          status: "connected",
          capabilities: ["accounts", "positions", "snaptrade"],
        })
        .returning({ id: brokerConnectionsTable.id });
      const [account] = await db
        .insert(brokerAccountsTable)
        .values({
          appUserId: auth.user.id,
          connectionId: connection.id,
          providerAccountId: "snaptrade:acct-invalid-positions",
          displayName: "Invalid Positions",
          mode: "live",
          baseCurrency: "USD",
        })
        .returning({ id: brokerAccountsTable.id });

      const fetchImpl: typeof fetch = async (url) => {
        const requestUrl = new URL(String(url));
        if (requestUrl.pathname.endsWith("/balances")) {
          return new Response(
            JSON.stringify([
              {
                currency: { code: "USD" },
                cash: 100,
                buying_power: 100,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      await assert.rejects(
        getSnapTradeAccountPortfolio({
          appUserId: auth.user.id,
          accountId: account.id,
          env: {
            SNAPTRADE_CLIENTID: "client-123",
            SNAPTRADE_API_KEY: "consumer-secret",
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl,
        }),
        (error) => {
          assert.equal((error as { statusCode?: number }).statusCode, 502);
          assert.equal(
            (error as { code?: string }).code,
            "snaptrade_positions_invalid_response",
          );
          return true;
        },
      );
    }),
  );
});
