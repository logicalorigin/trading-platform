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
import {
  __snapTradeAccountPortfolioInternalsForTests,
  buildSnapTradeAccountPortfolioTotals,
  getSnapTradeAccountPortfolio,
} from "./snaptrade-account-portfolio";
import {
  deriveSnapTradeUserId,
  recordSnapTradeUserCredential,
} from "./snaptrade-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64url");

test("SnapTrade option position ids distinguish contracts when display symbols collapse", () => {
  const normalize =
    __snapTradeAccountPortfolioInternalsForTests.normalizePosition;
  const position = (rawSymbol: string, index: number) =>
    normalize(
      {
        instrument: {
          kind: "option",
          symbol: "AAPL",
          raw_symbol: rawSymbol,
          currency: "USD",
        },
        units: "1",
        price: "1",
        average_purchase_price: "1",
        cost_basis: "100",
      },
      index,
    );
  const call = position("AAPL  260821C00200000", 0);
  const put = position("AAPL  260821P00200000", 1);

  assert.equal(call.optionContract, null);
  assert.equal(put.optionContract, null);
  assert.equal(call.snapTradePositionId, "option:AAPL260821C00200000");
  assert.equal(put.snapTradePositionId, "option:AAPL260821P00200000");
  assert.notEqual(call.snapTradePositionId, put.snapTradePositionId);
  assert.equal(call.marketValue, null);
  assert.equal(call.averagePurchasePrice, null);
  assert.equal(call.costBasis, null);
});

test("SnapTrade unified stock cost_basis is the per-share book price", () => {
  const position =
    __snapTradeAccountPortfolioInternalsForTests.normalizePosition(
      {
        instrument: {
          kind: "stock",
          symbol: "SIVEF",
          raw_symbol: "SIVEF",
          currency: "USD",
        },
        units: "1400",
        price: "4.0147",
        cost_basis: "3.9518",
        currency: "USD",
      },
      0,
    );

  assert.equal(position.averagePurchasePrice, 3.9518);
  assert.equal(position.costBasis, 5_532.52);
  assert.equal(position.marketValue, 5_620.58);
  assert.equal(position.unrealizedPnl, 88.06);
});

test("SnapTrade unified option cost_basis is the per-contract book price", () => {
  const position =
    __snapTradeAccountPortfolioInternalsForTests.normalizePosition(
      {
        instrument: {
          kind: "option",
          symbol: "BLDP  260821C00005000",
          raw_symbol: "BLDP  260821C00005000",
          currency: "USD",
          multiplier: 100,
        },
        units: "20",
        price: "0.05",
        cost_basis: "83.51",
        currency: "USD",
      },
      0,
    );

  assert.equal(position.averagePurchasePrice, 0.8351);
  assert.equal(position.costBasis, 1_670.2);
  assert.equal(position.marketValue, 100);
  assert.equal(position.unrealizedPnl, -1_570.2);
});

test("SnapTrade explicit option averages use per-contract cost_basis without quantity scaling", () => {
  const position =
    __snapTradeAccountPortfolioInternalsForTests.normalizePosition(
      {
        instrument: {
          kind: "option",
          symbol: "SPY   260821C00400000",
          raw_symbol: "SPY   260821C00400000",
          currency: "USD",
          multiplier: 100,
        },
        units: "20",
        price: "0.17",
        average_purchase_price: "83.51",
        cost_basis: "83.51",
        currency: "USD",
      },
      0,
    );

  assert.equal(position.averagePurchasePrice, 0.8351);
  assert.equal(position.costBasis, 1_670.2);
  assert.equal(position.marketValue, 340);
  assert.equal(position.unrealizedPnl, -1_330.2);
});

test("SnapTrade portfolio totals require complete same-currency populations", () => {
  const empty = buildSnapTradeAccountPortfolioTotals({
    baseCurrency: "USD",
    balances: [],
    positions: [],
  });
  assert.deepEqual(empty, {
    cash: 0,
    buyingPower: 0,
    positionMarketValue: 0,
    unrealizedPnl: 0,
    netLiquidation: 0,
    positionCount: 0,
  });

  const incomplete = buildSnapTradeAccountPortfolioTotals({
    baseCurrency: "USD",
    balances: [
      { currency: "USD", cash: 100, buyingPower: 200 },
      { currency: "USD", cash: null, buyingPower: 50 },
    ],
    positions: [
      {
        snapTradePositionId: "stock:AAPL",
        symbol: "AAPL",
        rawSymbol: "AAPL",
        description: null,
        instrumentKind: "stock",
        assetClass: "equity",
        optionContract: null,
        quantity: null,
        side: "long",
        price: null,
        averagePurchasePrice: null,
        marketValue: null,
        costBasis: null,
        unrealizedPnl: 10,
        currency: "USD",
        cashEquivalent: false,
      },
    ],
  });
  assert.equal(incomplete.cash, null);
  assert.equal(incomplete.buyingPower, 250);
  assert.equal(incomplete.positionMarketValue, null);
  assert.equal(incomplete.unrealizedPnl, 10);
  assert.equal(incomplete.netLiquidation, null);

  const mixedCurrency = buildSnapTradeAccountPortfolioTotals({
    baseCurrency: "USD",
    balances: [{ currency: "EUR", cash: 100, buyingPower: 100 }],
    positions: [],
  });
  assert.deepEqual(mixedCurrency, {
    cash: null,
    buyingPower: null,
    positionMarketValue: null,
    unrealizedPnl: null,
    netLiquidation: null,
    positionCount: 0,
  });
});

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
      const stageDurations = new Map<string, number>();
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
                  openPnl: "61.25",
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
                    multiplier: 100,
                  },
                  units: "-1",
                  price: "0.11",
                  cost_basis: "50",
                  currency: "USD",
                  cash_equivalent: false,
                },
                {
                  instrument: {
                    kind: "option",
                    symbol: "SPY   260821C00400000",
                    raw_symbol: "SPY   260821C00400000",
                    description: "SPY Aug 21 2026 400 Call",
                    currency: "USD",
                    multiplier: 100,
                  },
                  units: "20",
                  price: "0.17",
                  average_purchase_price: "83.51",
                  cost_basis: "83.51",
                  currency: "USD",
                  cash_equivalent: false,
                },
                {
                  instrument: {
                    kind: "option",
                    symbol: "XYZ   260821P00005000",
                    raw_symbol: "XYZ   260821P00005000",
                    description: "XYZ Aug 21 2026 5 Put",
                    currency: "USD",
                    multiplier: 100,
                  },
                  units: "3",
                  price: "0.5",
                  cost_basis: "50",
                  currency: "USD",
                  cash_equivalent: false,
                },
                {
                  instrument: {
                    kind: "option",
                    symbol: "QQQ   260821C00300000",
                    raw_symbol: "QQQ   260821C00300000",
                    description: "QQQ Aug 21 2026 300 Call",
                    currency: "USD",
                    multiplier: 100,
                  },
                  units: "2",
                  price: "0.8",
                  average_purchase_price: "0.8",
                  cost_basis: "80",
                  currency: "USD",
                  cash_equivalent: false,
                },
                {
                  instrument: {
                    kind: "option",
                    symbol: "TSLA  260821P00200000",
                    raw_symbol: "TSLA  260821P00200000",
                    description: "TSLA Aug 21 2026 200 Put",
                    currency: "USD",
                    multiplier: 100,
                  },
                  units: "-3",
                  price: "5",
                  average_purchase_price: "500",
                  cost_basis: "-500",
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
        onStageTiming: (stage, durationMs) => {
          stageDurations.set(stage, durationMs);
        },
      });

      assert.equal(
        __snapTradeAccountPortfolioInternalsForTests.readLatestPortfolio({
          appUserId: auth.user.id,
          accountId: account.id,
        }),
        result,
      );

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
      assert.deepEqual([...stageDurations.keys()].sort(), [
        "account_lookup",
        "balances_http",
        "credential_lookup",
        "normalization",
        "positions_http",
      ]);
      assert.ok(
        [...stageDurations.values()].every(
          (durationMs) => Number.isFinite(durationMs) && durationMs >= 0,
        ),
      );

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
      assert.deepEqual(result.positions.slice(0, 2), [
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
          unrealizedPnl: 61.25,
          currency: "USD",
          cashEquivalent: false,
          optionContract: null,
        },
        {
          snapTradePositionId: "option:OPTT260821C00000500",
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

      assert.equal(result.positions.length, 6);
      const positionsByRawSymbol = new Map(
        result.positions.map((position) => [position.rawSymbol, position]),
      );
      const etradeOption = positionsByRawSymbol.get("SPY   260821C00400000");
      assert.ok(etradeOption);
      assert.equal(etradeOption.averagePurchasePrice, 0.8351);
      assert.equal(etradeOption.costBasis, 1670.2);
      assert.equal(etradeOption.marketValue, 340);
      assert.equal(etradeOption.unrealizedPnl, -1330.2);
      assert.equal(
        positionsByRawSymbol.get("XYZ   260821P00005000")?.averagePurchasePrice,
        0.5,
      );
      assert.equal(
        positionsByRawSymbol.get("QQQ   260821C00300000")?.averagePurchasePrice,
        0.8,
      );
      assert.equal(
        positionsByRawSymbol.get("TSLA  260821P00200000")?.averagePurchasePrice,
        5,
      );
      assert.deepEqual(result.totals, {
        cash: 300.71,
        buyingPower: 410.71,
        positionMarketValue: 435.225,
        unrealizedPnl: -1229.95,
        netLiquidation: 735.935,
        positionCount: 6,
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

test("SnapTrade account portfolio aborts slow provider reads", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const auth = await createUser("slow-provider@example.com");
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
          name: "snaptrade:auth-slow-provider",
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
          providerAccountId: "snaptrade:acct-slow-provider",
          displayName: "Slow Provider",
          mode: "live",
          baseCurrency: "USD",
        })
        .returning({ id: brokerAccountsTable.id });

      let sawAbortSignal = false;
      const fetchImpl: typeof fetch = async (_url, init) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal;
          sawAbortSignal = sawAbortSignal || Boolean(signal);
          const timer = setTimeout(() => {
            resolve(
              new Response(JSON.stringify([]), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }, 50);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });

      await assert.rejects(
        getSnapTradeAccountPortfolio({
          appUserId: auth.user.id,
          accountId: account.id,
          env: {
            SNAPTRADE_CLIENTID: "client-123",
            SNAPTRADE_API_KEY: "consumer-secret",
            SNAPTRADE_PORTFOLIO_REQUEST_TIMEOUT_MS: "5",
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl,
        }),
        (error) => {
          assert.equal((error as { statusCode?: number }).statusCode, 502);
          assert.equal(
            (error as { code?: string }).code,
            "snaptrade_portfolio_timeout",
          );
          return true;
        },
      );
      assert.equal(sawAbortSignal, true);
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
