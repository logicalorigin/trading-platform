import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { runAsAppUser } from "./app-user-context";
import { bootstrapInitialUser } from "./auth";
import {
  cancelSnapTradeEquityOrder,
  checkSnapTradeEquityOrderImpact,
  listSnapTradeRecentOrders,
  replaceSnapTradeEquityOrder,
  searchSnapTradeAccountSymbols,
  submitSnapTradeEquityOrder,
} from "./snaptrade-equity-orders";
import {
  deriveSnapTradeUserId,
  recordSnapTradeUserCredential,
} from "./snaptrade-user-custody";
import { createTaxOrderPreflight } from "./tax-planning";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64url");

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

async function createSnapTradeCredential(appUserId: string) {
  const snapTradeUserId = deriveSnapTradeUserId(appUserId);
  await recordSnapTradeUserCredential({
    appUserId,
    snapTradeUserId,
    userSecret: "snaptrade-user-secret",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  return snapTradeUserId;
}

async function createSnapTradeAccount(input: {
  appUserId: string;
  providerAccountId?: string;
  capabilities?: string[];
  executionBlockers?: string[];
  accountStatus?: string | null;
}) {
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: input.appUserId,
      name: `snaptrade:${input.providerAccountId ?? "acct-ibkr-1"}`,
      connectionType: "broker",
      brokerProvider: "snaptrade",
      mode: "live",
      status: "connected",
      capabilities: ["accounts", "positions", "snaptrade", "orders"],
    })
    .returning({ id: brokerConnectionsTable.id });
  assert.ok(connection);

  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId: input.appUserId,
      connectionId: connection.id,
      providerAccountId: input.providerAccountId ?? "snaptrade:acct-ibkr-1",
      displayName: "Main IBKR",
      mode: "live",
      accountStatus: input.accountStatus ?? "open",
      baseCurrency: "USD",
      capabilities:
        input.capabilities ?? [
          "accounts",
          "positions",
          "snaptrade",
          "orders",
          "executions",
          "execution-ready",
        ],
      executionBlockers: input.executionBlockers ?? [],
      lastSyncedAt: "2026-07-01T19:10:00.000Z",
    })
    .returning({ id: brokerAccountsTable.id, connectionId: brokerAccountsTable.connectionId });
  assert.ok(account);
  return account;
}

test("SnapTrade equity impact signs the documented order-impact payload and sanitizes response data", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("orders-impact@example.com");
      const snapTradeUserId = await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({ appUserId: auth.user.id });

      let requestedBody: Record<string, unknown> | null = null;
      const fetchImpl: typeof fetch = async (url, init) => {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.origin, "https://api.snaptrade.com");
        assert.equal(requestUrl.pathname, "/api/v1/trade/impact");
        assert.equal(init?.method, "POST");
        assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
        assert.equal(requestUrl.searchParams.get("timestamp"), "1782936000");
        assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
        assert.equal(
          requestUrl.searchParams.get("userSecret"),
          "snaptrade-user-secret",
        );
        assert.ok((new Headers(init?.headers).get("Signature") ?? "").length > 20);
        requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return new Response(
          JSON.stringify({
            trade: {
              id: "139e307a-82f7-4402-b39e-4da7baa87758",
              account: "acct-ibkr-1",
              order_type: "Limit",
              time_in_force: "Day",
              symbol: {
                universal_symbol_id: "2bcd7cc3-e922-4976-bce1-9858296801c3",
                symbol: "AAPL",
                description: "Apple Inc.",
              },
              action: "BUY",
              units: 2,
              price: 123.45,
            },
            trade_impacts: [
              {
                account: "acct-ibkr-1",
                remaining_cash: 753.2,
                estimated_commission: 1.25,
                forex_fees: null,
              },
            ],
            combined_remaining_balance: {
              account: {
                id: "acct-ibkr-1",
                name: "Main IBKR",
                number: "U1234567",
              },
              cash: 753.2,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const result = await checkSnapTradeEquityOrderImpact({
        appUserId: auth.user.id,
        accountId: account.id,
        input: {
          action: "BUY",
          universalSymbolId: "2bcd7cc3-e922-4976-bce1-9858296801c3",
          symbol: "AAPL",
          orderType: "Limit",
          timeInForce: "Day",
          units: 2,
          price: 123.45,
        },
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:00:00.000Z"),
        fetchImpl,
      });

      assert.deepEqual(requestedBody, {
        account_id: "acct-ibkr-1",
        action: "BUY",
        universal_symbol_id: "2bcd7cc3-e922-4976-bce1-9858296801c3",
        order_type: "Limit",
        time_in_force: "Day",
        price: 123.45,
        stop: null,
        units: 2,
        notional_value: null,
      });
      assert.equal(result.provider, "snaptrade");
      assert.equal(result.checkedAt, "2026-07-01T20:00:00.000Z");
      assert.equal(result.trade.id, "139e307a-82f7-4402-b39e-4da7baa87758");
      assert.equal(result.trade.expiresAt, "2026-07-01T20:05:00.000Z");
      assert.equal(result.order.symbol, "AAPL");
      assert.equal(result.impact.remainingCash, 753.2);
      assert.equal(result.impact.estimatedCommission, 1.25);
      assert.equal(result.account.id, account.id);
      assert.equal(result.account.snapTradeAccountId, "acct-ibkr-1");
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|client-123|U1234567|pyrus-/,
      );
    }),
  );
});

test("SnapTrade equity submit requires an execution-ready account and explicit confirmation before calling the provider", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("orders-blocked@example.com");
      await createSnapTradeCredential(auth.user.id);
      const blockedAccount = await createSnapTradeAccount({
        appUserId: auth.user.id,
        capabilities: ["accounts", "positions", "snaptrade", "read-only"],
        executionBlockers: ["connection_type_not_trade"],
      });
      let called = false;

      await assert.rejects(
        submitSnapTradeEquityOrder({
          appUserId: auth.user.id,
          accountId: blockedAccount.id,
          input: {
            confirm: true,
            action: "BUY",
            symbol: "AAPL",
            orderType: "Market",
            timeInForce: "Day",
            units: 1,
          },
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
          assert.equal((error as { statusCode?: number }).statusCode, 409);
          assert.equal(
            (error as { code?: string }).code,
            "snaptrade_account_execution_blocked",
          );
          return true;
        },
      );
      assert.equal(called, false);

      const readyAccount = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-ready-2",
      });
      await assert.rejects(
        submitSnapTradeEquityOrder({
          appUserId: auth.user.id,
          accountId: readyAccount.id,
          input: {
            action: "BUY",
            symbol: "AAPL",
            orderType: "Market",
            timeInForce: "Day",
            units: 1,
          },
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
          assert.equal((error as { statusCode?: number }).statusCode, 409);
          assert.equal(
            (error as { code?: string }).code,
            "snaptrade_order_confirmation_required",
          );
          return true;
        },
      );
      assert.equal(called, false);
    }),
  );
});

test("SnapTrade equity submit places a documented direct equity order and returns sanitized status", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("orders-submit@example.com");
      const snapTradeUserId = await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-submit-1",
      });

      let requestedBody: Record<string, unknown> | null = null;
      const fetchImpl: typeof fetch = async (url, init) => {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.origin, "https://api.snaptrade.com");
        assert.equal(requestUrl.pathname, "/api/v1/trade/place");
        assert.equal(init?.method, "POST");
        assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
        assert.equal(requestUrl.searchParams.get("timestamp"), "1782936600");
        assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
        assert.equal(
          requestUrl.searchParams.get("userSecret"),
          "snaptrade-user-secret",
        );
        assert.ok((new Headers(init?.headers).get("Signature") ?? "").length > 20);
        requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return new Response(
          JSON.stringify({
            brokerage_order_id: "broker-order-123",
            status: "ACCEPTED",
            universal_symbol: {
              id: "2bcd7cc3-e922-4976-bce1-9858296801c3",
              symbol: "MSFT",
              raw_symbol: "MSFT",
              description: "Microsoft Corporation",
            },
            action: "BUY",
            order_type: "Limit",
            time_in_force: "Day",
            units: 3,
            price: 402.1,
            account: {
              id: "acct-submit-1",
              number: "U7654321",
            },
          }),
        { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const preflight = await runAsAppUser(auth.user.id, () =>
        createTaxOrderPreflight({
          order: {
            accountId: account.id,
            mode: "live",
            symbol: "MSFT",
            assetClass: "equity",
            side: "buy",
            type: "limit",
            quantity: 3,
            limitPrice: 402.1,
            stopPrice: null,
            timeInForce: "day",
            optionContract: null,
            route: "snaptrade",
            intent: null,
          },
        }),
      );

      const result = await submitSnapTradeEquityOrder({
        appUserId: auth.user.id,
        accountId: account.id,
        input: {
          confirm: true,
          action: "BUY",
          symbol: "MSFT",
          orderType: "Limit",
          timeInForce: "Day",
          tradingSession: "REGULAR",
          units: 3,
          price: 402.1,
          clientOrderId: "44444444-4444-4444-8444-444444444444",
          taxPreflightToken: preflight.preflightToken,
          taxAcknowledgements: preflight.requiredAcknowledgements,
        },
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:10:00.000Z"),
        fetchImpl,
      });

      assert.deepEqual(requestedBody, {
        account_id: "acct-submit-1",
        action: "BUY",
        universal_symbol_id: null,
        symbol: "MSFT",
        order_type: "Limit",
        time_in_force: "Day",
        trading_session: "REGULAR",
        expiry_date: null,
        price: 402.1,
        stop: null,
        units: 3,
        notional_value: null,
        client_order_id: "44444444-4444-4444-8444-444444444444",
      });
      assert.equal(result.provider, "snaptrade");
      assert.equal(result.submittedAt, "2026-07-01T20:10:00.000Z");
      assert.equal(result.order.brokerageOrderId, "broker-order-123");
      assert.equal(result.order.status, "ACCEPTED");
      assert.equal(result.order.symbol, "MSFT");
      assert.equal(result.order.units, 3);
      assert.equal(result.account.id, account.id);
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|client-123|U7654321|pyrus-/,
      );
    }),
  );
});

test("SnapTrade recent orders signs the documented realtime order-status request and sanitizes response data", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("orders-recent@example.com");
      const snapTradeUserId = await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-recent-1",
      });

      const fetchImpl: typeof fetch = async (url, init) => {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.origin, "https://api.snaptrade.com");
        assert.equal(
          requestUrl.pathname,
          "/api/v1/accounts/acct-recent-1/recentOrders",
        );
        assert.equal(init?.method, "GET");
        assert.equal(init?.body, undefined);
        assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
        assert.equal(requestUrl.searchParams.get("timestamp"), "1782937200");
        assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
        assert.equal(
          requestUrl.searchParams.get("userSecret"),
          "snaptrade-user-secret",
        );
        assert.equal(requestUrl.searchParams.get("only_executed"), "false");
        assert.ok((new Headers(init?.headers).get("Signature") ?? "").length > 20);

        return new Response(
          JSON.stringify({
            orders: [
              {
                brokerage_order_id: "broker-order-456",
                brokerage_group_order_id: "broker-group-456",
                order_role: "TRIGGER",
                status: "ACCEPTED",
                universal_symbol: {
                  id: "2bcd7cc3-e922-4976-bce1-9858296801c3",
                  symbol: "AAPL",
                  raw_symbol: "AAPL",
                  description: "Apple Inc.",
                },
                option_symbol: null,
                action: "BUY",
                total_quantity: "3",
                open_quantity: "3",
                canceled_quantity: "0",
                filled_quantity: "0",
                execution_price: null,
                limit_price: "182.5",
                stop_price: null,
                order_type: "Limit",
                time_in_force: "Day",
                time_placed: "2026-07-01T20:19:30.000Z",
                time_updated: "2026-07-01T20:20:00.000Z",
                time_executed: null,
                expiry_date: null,
                account: {
                  id: "acct-recent-1",
                  number: "U5555555",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const result = await listSnapTradeRecentOrders({
        appUserId: auth.user.id,
        accountId: account.id,
        includeNonExecuted: true,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:20:00.000Z"),
        fetchImpl,
      });

      assert.equal(result.provider, "snaptrade");
      assert.equal(result.checkedAt, "2026-07-01T20:20:00.000Z");
      assert.equal(result.account.id, account.id);
      assert.equal(result.account.snapTradeAccountId, "acct-recent-1");
      assert.deepEqual(result.orders, [
        {
          brokerageOrderId: "broker-order-456",
          brokerageGroupOrderId: "broker-group-456",
          orderRole: "TRIGGER",
          status: "ACCEPTED",
          symbol: "AAPL",
          rawSymbol: "AAPL",
          description: "Apple Inc.",
          universalSymbolId: "2bcd7cc3-e922-4976-bce1-9858296801c3",
          optionSymbolId: null,
          optionTicker: null,
          action: "BUY",
          totalQuantity: 3,
          openQuantity: 3,
          canceledQuantity: 0,
          filledQuantity: 0,
          executionPrice: null,
          limitPrice: 182.5,
          stopPrice: null,
          orderType: "Limit",
          timeInForce: "Day",
          timePlaced: "2026-07-01T20:19:30.000Z",
          timeUpdated: "2026-07-01T20:20:00.000Z",
          timeExecuted: null,
          expiryDate: null,
        },
      ]);
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|client-123|U5555555|pyrus-/,
      );
    }),
  );
});

test("SnapTrade account symbol search signs the documented account-scoped request and sanitizes response data", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("orders-symbol-search@example.com");
      const snapTradeUserId = await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-symbol-1",
      });

      let requestedBody: Record<string, unknown> | null = null;
      const fetchImpl: typeof fetch = async (url, init) => {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.origin, "https://api.snaptrade.com");
        assert.equal(
          requestUrl.pathname,
          "/api/v1/accounts/acct-symbol-1/symbols",
        );
        assert.equal(init?.method, "POST");
        assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
        assert.equal(requestUrl.searchParams.get("timestamp"), "1782937800");
        assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
        assert.equal(
          requestUrl.searchParams.get("userSecret"),
          "snaptrade-user-secret",
        );
        assert.ok((new Headers(init?.headers).get("Signature") ?? "").length > 20);
        requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return new Response(
          JSON.stringify([
            {
              id: "2bcd7cc3-e922-4976-bce1-9858296801c3",
              symbol: "AAPL",
              raw_symbol: "AAPL",
              description: "Apple Inc.",
              currency: {
                id: "c4f5e6d7-a8b9-4c0d-8e1f-234567890abc",
                code: "USD",
                name: "US Dollar",
              },
              exchange: {
                id: "11111111-2222-4333-8444-555555555555",
                code: "NASDAQ",
                mic_code: "XNAS",
                name: "Nasdaq",
                suffix: null,
              },
              type: {
                id: "22222222-3333-4444-8555-666666666666",
                code: "cs",
                description: "Common Stock",
              },
              account: {
                id: "acct-symbol-1",
                number: "U1111111",
              },
            },
            {
              id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
              symbol: "AAPL.BA",
              raw_symbol: "AAPL",
              description: "Apple Inc. CEDEAR",
              currency: { code: "ARS" },
              exchange: { code: "BCBA", mic_code: "XBUE", name: "Buenos Aires" },
              type: { code: "cs", description: "Common Stock" },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      };

      const result = await searchSnapTradeAccountSymbols({
        appUserId: auth.user.id,
        accountId: account.id,
        query: "AAPL",
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:30:00.000Z"),
        fetchImpl,
      });

      assert.deepEqual(requestedBody, { substring: "AAPL" });
      assert.equal(result.provider, "snaptrade");
      assert.equal(result.checkedAt, "2026-07-01T20:30:00.000Z");
      assert.equal(result.query, "AAPL");
      assert.equal(result.account.id, account.id);
      assert.equal(result.account.snapTradeAccountId, "acct-symbol-1");
      assert.equal(result.bestMatch?.id, "2bcd7cc3-e922-4976-bce1-9858296801c3");
      assert.deepEqual(result.symbols[0], {
        id: "2bcd7cc3-e922-4976-bce1-9858296801c3",
        symbol: "AAPL",
        rawSymbol: "AAPL",
        description: "Apple Inc.",
        currencyCode: "USD",
        exchangeCode: "NASDAQ",
        exchangeMicCode: "XNAS",
        exchangeName: "Nasdaq",
        exchangeSuffix: null,
        securityTypeCode: "cs",
        securityTypeDescription: "Common Stock",
      });
      assert.equal(result.symbols[1]?.symbol, "AAPL.BA");
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|client-123|U1111111|pyrus-/,
      );
    }),
  );
});

test("SnapTrade cancel posts the documented cancel path with the brokerage order id", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("orders-cancel@example.com");
      const snapTradeUserId = await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-cancel-1",
      });

      let requestedBody: Record<string, unknown> | null = null;
      const fetchImpl: typeof fetch = async (url, init) => {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.origin, "https://api.snaptrade.com");
        assert.equal(
          requestUrl.pathname,
          "/api/v1/accounts/acct-cancel-1/trading/cancel",
        );
        assert.equal(init?.method, "POST");
        assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
        assert.equal(
          requestUrl.searchParams.get("userSecret"),
          "snaptrade-user-secret",
        );
        assert.ok((new Headers(init?.headers).get("Signature") ?? "").length > 20);
        requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ status: "CANCELLED" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const result = await cancelSnapTradeEquityOrder({
        appUserId: auth.user.id,
        accountId: account.id,
        orderId: "brokerage-order-xyz",
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:10:00.000Z"),
        fetchImpl,
      });

      assert.deepEqual(requestedBody, {
        brokerage_order_id: "brokerage-order-xyz",
      });
      assert.equal(result.provider, "snaptrade");
      assert.equal(result.status, "CANCELLED");
      assert.equal(result.orderId, "brokerage-order-xyz");
      assert.equal(result.account.id, account.id);
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|client-123/,
      );
    }),
  );
});

test("SnapTrade cancel rejects an empty order id", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("orders-cancel-empty@example.com");
      await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-cancel-2",
      });
      await assert.rejects(
        cancelSnapTradeEquityOrder({
          appUserId: auth.user.id,
          accountId: account.id,
          orderId: "  ",
          env: {
            SNAPTRADE_CLIENTID: "client-123",
            SNAPTRADE_API_KEY: "consumer-secret",
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: async () => new Response("{}", { status: 200 }),
        }),
        (error: unknown) =>
          (error as { code?: string }).code === "snaptrade_order_id_required",
      );
    }),
  );
});

test("SnapTrade replace requires explicit confirmation", async () => {
  await assert.rejects(
    replaceSnapTradeEquityOrder({
      appUserId: "missing-user",
      accountId: "missing-account",
      orderId: "old-order-id",
      input: {
        confirm: false,
        action: "BUY",
        symbol: "AAPL",
        orderType: "Market",
        timeInForce: "Day",
        units: 1,
      },
    }),
    (error: unknown) => {
      const candidate = error as { statusCode?: number; code?: string };
      assert.equal(candidate.statusCode, 409);
      assert.equal(
        candidate.code,
        "snaptrade_order_replace_confirmation_required",
      );
      return true;
    },
  );
});

test("SnapTrade replace posts the documented body and returns sanitized replacement metadata", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("orders-replace@example.com");
      const snapTradeUserId = await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-replace-1",
      });
      const preflight = await runAsAppUser(auth.user.id, () =>
        createTaxOrderPreflight({
          order: {
            accountId: account.id,
            mode: "live",
            symbol: "AAPL",
            assetClass: "equity",
            side: "sell",
            type: "limit",
            quantity: 4,
            limitPrice: 210.25,
            stopPrice: null,
            timeInForce: "gtc",
            optionContract: null,
            route: "snaptrade",
            intent: null,
          },
        }),
      );

      let requestedBody: Record<string, unknown> | null = null;
      const fetchImpl: typeof fetch = async (url, init) => {
        const requestUrl = new URL(String(url));
        assert.equal(requestUrl.origin, "https://api.snaptrade.com");
        assert.equal(
          requestUrl.pathname,
          "/api/v1/accounts/acct-replace-1/trading/replace",
        );
        assert.equal(init?.method, "POST");
        assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
        assert.equal(requestUrl.searchParams.get("timestamp"), "1783620000");
        assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
        assert.equal(
          requestUrl.searchParams.get("userSecret"),
          "snaptrade-user-secret",
        );
        assert.ok((new Headers(init?.headers).get("Signature") ?? "").length > 20);
        requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          brokerage_order_id: "new-brokerage-order-id",
          status: "REPLACE_PENDING",
          account: { id: "acct-replace-1", number: "U12345678" },
          userSecret: "upstream-user-secret",
        });
      };

      const result = await replaceSnapTradeEquityOrder({
        appUserId: auth.user.id,
        accountId: account.id,
        orderId: " old-brokerage-order-id ",
        input: {
          confirm: true,
          action: "SELL",
          symbol: "aapl",
          orderType: "Limit",
          timeInForce: "GTC",
          units: 4,
          price: 210.25,
          taxPreflightToken: preflight.preflightToken,
          taxAcknowledgements: preflight.requiredAcknowledgements,
        },
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-09T18:00:00.000Z"),
        fetchImpl,
      });

      assert.deepEqual(requestedBody, {
        brokerage_order_id: "old-brokerage-order-id",
        action: "SELL",
        order_type: "Limit",
        time_in_force: "GTC",
        price: 210.25,
        symbol: "AAPL",
        stop: null,
        units: 4,
      });
      assert.equal(result.provider, "snaptrade");
      assert.equal(result.replacedAt, "2026-07-09T18:00:00.000Z");
      assert.equal(result.orderId, "new-brokerage-order-id");
      assert.equal(result.previousOrderId, "old-brokerage-order-id");
      assert.equal(result.status, "REPLACE_PENDING");
      assert.equal(result.account.id, account.id);
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|client-123|U12345678|upstream-user-secret/,
      );
    }),
  );
});
