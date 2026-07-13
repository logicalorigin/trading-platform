import assert from "node:assert/strict";
import test from "node:test";

import { brokerAccountsTable, brokerConnectionsTable, db } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { runAsAppUser } from "./app-user-context";
import { bootstrapInitialUser } from "./auth";
import {
  buildOccSymbol,
  cancelSnapTradeOptionOrder,
  checkSnapTradeOptionOrderImpact,
  listSnapTradeRecentOptionOrders,
  submitSnapTradeOptionOrder,
} from "./snaptrade-option-orders";
import {
  deriveSnapTradeUserId,
  recordSnapTradeUserCredential,
} from "./snaptrade-user-custody";
import { createTaxOrderPreflight } from "./tax-planning";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64url");

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
    userSecret: "snaptrade-option-user-secret",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  return snapTradeUserId;
}

async function createSnapTradeAccount(input: {
  appUserId: string;
  providerAccountId: string;
}) {
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: input.appUserId,
      name: input.providerAccountId,
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
      providerAccountId: input.providerAccountId,
      displayName: "Options account",
      mode: "live",
      accountStatus: "open",
      baseCurrency: "USD",
      capabilities: [
        "accounts",
        "positions",
        "snaptrade",
        "orders",
        "executions",
        "execution-ready",
      ],
      executionBlockers: [],
      lastSyncedAt: "2026-07-01T19:10:00.000Z",
    })
    .returning({ id: brokerAccountsTable.id });
  assert.ok(account);
  return account;
}

test("buildOccSymbol builds documented 21-character OCC option symbols", () => {
  const cases = [
    {
      input: {
        underlyingSymbol: "AAPL",
        expiration: "2025-11-14",
        strike: 240,
        optionType: "Call" as const,
      },
      expected: "AAPL  251114C00240000",
    },
    {
      input: {
        underlyingSymbol: "pbi",
        expiration: "2025-07-18",
        strike: 6,
        optionType: "Call" as const,
      },
      expected: "PBI   250718C00006000",
    },
    {
      input: {
        underlyingSymbol: "SPY",
        expiration: "2026-01-16",
        strike: 0.5,
        optionType: "Put" as const,
      },
      expected: "SPY   260116P00000500",
    },
    {
      input: {
        underlyingSymbol: "ABC123",
        expiration: "2027-12-31",
        strike: 99_999.999,
        optionType: "Put" as const,
      },
      expected: "ABC123271231P99999999",
    },
  ];

  for (const { input, expected } of cases) {
    const symbol = buildOccSymbol(input);
    assert.equal(symbol, expected);
    assert.equal(symbol.length, 21);
  }
});

test("SnapTrade option impact signs the documented account-scoped payload with its OCC leg", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("option-impact@example.com");
      const snapTradeUserId = await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-option-impact",
      });
      let requestedBody: Record<string, unknown> | null = null;

      const result = await checkSnapTradeOptionOrderImpact({
        appUserId: auth.user.id,
        accountId: account.id,
        input: {
          contractSymbol: "O:AAPL260821C00200000",
          multiplier: 100,
          sharesPerContract: 100,
          underlyingSymbol: "AAPL",
          expiration: "2026-08-21",
          strike: 200,
          optionType: "Call",
          action: "BUY_TO_OPEN",
          orderType: "Limit",
          timeInForce: "Day",
          units: 2,
          price: 2.4,
        },
        env: {
          SNAPTRADE_CLIENTID: "client-option-123",
          SNAPTRADE_API_KEY: "consumer-option-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:00:00.000Z"),
        fetchImpl: async (url, init) => {
          const requestUrl = new URL(String(url));
          assert.equal(requestUrl.origin, "https://api.snaptrade.com");
          assert.equal(
            requestUrl.pathname,
            "/api/v1/accounts/acct-option-impact/trading/options/impact",
          );
          assert.equal(init?.method, "POST");
          assert.equal(
            requestUrl.searchParams.get("clientId"),
            "client-option-123",
          );
          assert.equal(requestUrl.searchParams.get("timestamp"), "1782936000");
          assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
          assert.equal(
            requestUrl.searchParams.get("userSecret"),
            "snaptrade-option-user-secret",
          );
          assert.ok(
            (new Headers(init?.headers).get("Signature") ?? "").length > 20,
          );
          requestedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return new Response(
            JSON.stringify({
              estimated_cash_change: "-481.30",
              cash_change_direction: "DEBIT",
              estimated_fee_total: "1.30",
              account: { number: "U1234567" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      });

      assert.deepEqual(requestedBody, {
        order_type: "LIMIT",
        time_in_force: "Day",
        limit_price: "2.4",
        price_effect: "DEBIT",
        legs: [
          {
            instrument: {
              symbol: "AAPL  260821C00200000",
              instrument_type: "OPTION",
            },
            action: "BUY_TO_OPEN",
            units: 2,
          },
        ],
      });
      assert.equal(result.provider, "snaptrade");
      assert.equal(result.order.occSymbol, "AAPL  260821C00200000");
      assert.equal(result.impact.estimatedCashChange, -481.3);
      assert.equal(result.impact.cashChangeDirection, "DEBIT");
      assert.equal(result.impact.estimatedFeeTotal, 1.3);
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-option-user-secret|consumer-option-secret|client-option-123|U1234567/,
      );
    }),
  );
});

test("SnapTrade option submit requires explicit confirmation before provider access", async () => {
  let called = false;
  await assert.rejects(
    submitSnapTradeOptionOrder({
      appUserId: "unused-user",
      accountId: "unused-account",
      input: {
        contractSymbol: "O:AAPL260821C00200000",
        multiplier: 100,
        sharesPerContract: 100,
        underlyingSymbol: "AAPL",
        expiration: "2026-08-21",
        strike: 200,
        optionType: "Call",
        action: "BUY_TO_OPEN",
        orderType: "Market",
        timeInForce: "Day",
        units: 1,
      },
      fetchImpl: async () => {
        called = true;
        throw new Error("fetch should not run");
      },
    }),
    (error) => {
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      assert.equal(
        (error as { code?: string }).code,
        "snaptrade_option_order_confirmation_required",
      );
      return true;
    },
  );
  assert.equal(called, false);
});

test("SnapTrade option submit requires and consumes a matching option tax preflight", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("option-submit@example.com");
      const snapTradeUserId = await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-option-submit",
      });
      const commonInput = {
        confirm: true,
        contractSymbol: "O:MSFT260918P00450000",
        multiplier: 100,
        sharesPerContract: 100,
        underlyingSymbol: "MSFT",
        expiration: "2026-09-18",
        strike: 450,
        optionType: "Put" as const,
        action: "SELL_TO_OPEN" as const,
        orderType: "Limit" as const,
        timeInForce: "GTC" as const,
        units: 1,
        price: 3.25,
      };
      let called = false;

      await assert.rejects(
        submitSnapTradeOptionOrder({
          appUserId: auth.user.id,
          accountId: account.id,
          input: commonInput,
          env: {
            SNAPTRADE_CLIENTID: "client-option-123",
            SNAPTRADE_API_KEY: "consumer-option-secret",
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
            "tax_preflight_required",
          );
          return true;
        },
      );
      assert.equal(called, false);

      const occSymbol = "MSFT  260918P00450000";
      const preflight = await runAsAppUser(auth.user.id, () =>
        createTaxOrderPreflight({
          order: {
            accountId: account.id,
            mode: "live",
            symbol: "MSFT",
            assetClass: "option",
            side: "sell",
            type: "limit",
            quantity: 1,
            limitPrice: 3.25,
            stopPrice: null,
            timeInForce: "gtc",
            optionContract: {
              ticker: occSymbol,
              underlying: "MSFT",
              expirationDate: "2026-09-18",
              strike: 450,
              right: "put",
              multiplier: 100,
              sharesPerContract: 100,
              providerContractId: occSymbol,
              brokerContractId: occSymbol,
            },
            route: "snaptrade",
            intent: null,
          },
        }),
      );
      let requestedBody: Record<string, unknown> | null = null;

      const result = await submitSnapTradeOptionOrder({
        appUserId: auth.user.id,
        accountId: account.id,
        input: {
          ...commonInput,
          taxPreflightToken: preflight.preflightToken,
          taxAcknowledgements: preflight.requiredAcknowledgements,
        },
        env: {
          SNAPTRADE_CLIENTID: "client-option-123",
          SNAPTRADE_API_KEY: "consumer-option-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:10:00.000Z"),
        fetchImpl: async (url, init) => {
          called = true;
          const requestUrl = new URL(String(url));
          assert.equal(
            requestUrl.pathname,
            "/api/v1/accounts/acct-option-submit/trading/options",
          );
          assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
          assert.equal(init?.method, "POST");
          requestedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return new Response(
            JSON.stringify({
              brokerage_order_id: "option-order-123",
              orders: [
                {
                  brokerage_order_id: "option-order-123",
                  status: "ACCEPTED",
                  option_symbol: { ticker: occSymbol },
                  account: { number: "U7654321" },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      });

      assert.equal(called, true);
      assert.deepEqual(requestedBody, {
        order_type: "LIMIT",
        time_in_force: "GTC",
        limit_price: "3.25",
        price_effect: "CREDIT",
        legs: [
          {
            instrument: { symbol: occSymbol, instrument_type: "OPTION" },
            action: "SELL_TO_OPEN",
            units: 1,
          },
        ],
      });
      assert.equal(result.order.brokerageOrderId, "option-order-123");
      assert.equal(result.order.status, "ACCEPTED");
      assert.equal(result.order.occSymbol, occSymbol);
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-option-user-secret|consumer-option-secret|client-option-123|U7654321/,
      );
    }),
  );
});

test("SnapTrade option submit resolves with reconciliation required when the post-submit tax record fails", async (t) => {
  await withBootstrapToken(async () =>
    withTestDb(async (testDb) => {
      const auth = await createUser("option-submit-reconcile@example.com");
      await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-option-submit-reconcile",
      });
      const occSymbol = "MSFT  260918P00450000";
      const preflight = await runAsAppUser(auth.user.id, () =>
        createTaxOrderPreflight({
          order: {
            accountId: account.id,
            mode: "live",
            symbol: "MSFT",
            assetClass: "option",
            side: "sell",
            type: "limit",
            quantity: 1,
            limitPrice: 3.25,
            stopPrice: null,
            timeInForce: "gtc",
            optionContract: {
              ticker: occSymbol,
              underlying: "MSFT",
              expirationDate: "2026-09-18",
              strike: 450,
              right: "put",
              multiplier: 100,
              sharesPerContract: 100,
              providerContractId: occSymbol,
              brokerContractId: occSymbol,
            },
            route: "snaptrade",
            intent: null,
          },
        }),
      );

      const result = await submitSnapTradeOptionOrder({
        appUserId: auth.user.id,
        accountId: account.id,
        input: {
          confirm: true,
          contractSymbol: "O:MSFT260918P00450000",
          multiplier: 100,
          sharesPerContract: 100,
          underlyingSymbol: "MSFT",
          expiration: "2026-09-18",
          strike: 450,
          optionType: "Put",
          action: "SELL_TO_OPEN",
          orderType: "Limit",
          timeInForce: "GTC",
          units: 1,
          price: 3.25,
          taxPreflightToken: preflight.preflightToken,
          taxAcknowledgements: preflight.requiredAcknowledgements,
        },
        env: {
          SNAPTRADE_CLIENTID: "client-option-123",
          SNAPTRADE_API_KEY: "consumer-option-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:20:00.000Z"),
        fetchImpl: async () => {
          t.mock.method(testDb.db, "update", () => {
            throw new Error("tax preflight submit record failed");
          });
          return new Response(
            JSON.stringify({
              brokerage_order_id: "option-order-reconcile",
              orders: [
                {
                  brokerage_order_id: "option-order-reconcile",
                  status: "ACCEPTED",
                  option_symbol: { ticker: occSymbol },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      });

      assert.equal(result.order.brokerageOrderId, "option-order-reconcile");
      assert.equal(result.order.status, "ACCEPTED");
      assert.equal(result.reconcileRequired, true);
      assert.equal(
        result.reconciliationReason,
        "tax_preflight_order_submit_record_failed",
      );
    }),
  );
});

test("SnapTrade option validation rejects malformed contracts and orders before access", async () => {
  const baseInput = {
    contractSymbol: "O:AAPL260821C00200000",
    multiplier: 100,
    sharesPerContract: 100,
    underlyingSymbol: "AAPL",
    expiration: "2026-08-21",
    strike: 200,
    optionType: "Call" as const,
    action: "BUY_TO_OPEN" as const,
    orderType: "Market" as const,
    timeInForce: "Day" as const,
    units: 1,
  };
  const cases = [
    {
      input: { expiration: "2026-02-30" },
      code: "snaptrade_option_expiration_invalid",
    },
    {
      input: { strike: 12.3456 },
      code: "snaptrade_option_strike_invalid",
    },
    {
      input: { units: 1.5 },
      code: "snaptrade_option_order_units_invalid",
    },
    {
      input: { orderType: "Limit" as const },
      code: "snaptrade_option_order_price_required",
    },
    {
      input: { price: 1.25 },
      code: "snaptrade_option_order_price_unsupported",
    },
    {
      input: { contractSymbol: "O:MSFT260821C00200000" },
      code: "option_contract_identity_mismatch",
    },
  ];

  for (const testCase of cases) {
    await assert.rejects(
      checkSnapTradeOptionOrderImpact({
        appUserId: "unused-user",
        accountId: "unused-account",
        input: { ...baseInput, ...testCase.input },
      }),
      (error) => {
        assert.equal((error as { statusCode?: number }).statusCode, 422);
        assert.equal((error as { code?: string }).code, testCase.code);
        return true;
      },
    );
  }
});

test("SnapTrade option cancel posts the documented cancel path with the brokerage order id", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("option-cancel@example.com");
      const snapTradeUserId = await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-option-cancel",
      });

      let requestedBody: Record<string, unknown> | null = null;
      const result = await cancelSnapTradeOptionOrder({
        appUserId: auth.user.id,
        accountId: account.id,
        input: { orderId: "option-order-xyz" },
        env: {
          SNAPTRADE_CLIENTID: "client-option-123",
          SNAPTRADE_API_KEY: "consumer-option-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:30:00.000Z"),
        fetchImpl: async (url, init) => {
          const requestUrl = new URL(String(url));
          assert.equal(requestUrl.origin, "https://api.snaptrade.com");
          assert.equal(
            requestUrl.pathname,
            "/api/v1/accounts/acct-option-cancel/trading/cancel",
          );
          assert.equal(init?.method, "POST");
          assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
          assert.equal(
            requestUrl.searchParams.get("userSecret"),
            "snaptrade-option-user-secret",
          );
          assert.ok(
            (new Headers(init?.headers).get("Signature") ?? "").length > 20,
          );
          requestedBody = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          return new Response(
            JSON.stringify({ status: "CANCELLED", account: { number: "U8888888" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      });

      assert.deepEqual(requestedBody, {
        brokerage_order_id: "option-order-xyz",
      });
      assert.equal(result.provider, "snaptrade");
      assert.equal(result.status, "CANCELLED");
      assert.equal(result.orderId, "option-order-xyz");
      assert.equal(result.account.id, account.id);
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-option-user-secret|consumer-option-secret|client-option-123|U8888888/,
      );
    }),
  );
});

test("SnapTrade option cancel rejects an empty order id", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("option-cancel-empty@example.com");
      await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-option-cancel-empty",
      });
      await assert.rejects(
        cancelSnapTradeOptionOrder({
          appUserId: auth.user.id,
          accountId: account.id,
          input: { orderId: "  " },
          env: {
            SNAPTRADE_CLIENTID: "client-option-123",
            SNAPTRADE_API_KEY: "consumer-option-secret",
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

test("SnapTrade recent option orders reuse recentOrders and exclude equity records", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("option-recent@example.com");
      await createSnapTradeCredential(auth.user.id);
      const account = await createSnapTradeAccount({
        appUserId: auth.user.id,
        providerAccountId: "snaptrade:acct-option-recent",
      });

      const result = await listSnapTradeRecentOptionOrders({
        appUserId: auth.user.id,
        accountId: account.id,
        includeNonExecuted: true,
        env: {
          SNAPTRADE_CLIENTID: "client-option-123",
          SNAPTRADE_API_KEY: "consumer-option-secret",
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T20:20:00.000Z"),
        fetchImpl: async (url, init) => {
          const requestUrl = new URL(String(url));
          assert.equal(
            requestUrl.pathname,
            "/api/v1/accounts/acct-option-recent/recentOrders",
          );
          assert.equal(requestUrl.searchParams.get("only_executed"), "false");
          assert.equal(init?.method, "GET");
          return new Response(
            JSON.stringify({
              orders: [
                {
                  brokerage_order_id: "equity-order",
                  status: "ACCEPTED",
                  universal_symbol: { id: "equity-id", symbol: "AAPL" },
                  option_symbol: null,
                },
                {
                  brokerage_order_id: "option-order",
                  status: "ACCEPTED",
                  universal_symbol: null,
                  option_symbol: {
                    id: "option-id",
                    ticker: "AAPL  260821C00200000",
                  },
                  action: "BUY_OPEN",
                  total_quantity: "1",
                  account: { number: "U9999999" },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      });

      assert.equal(result.orders.length, 1);
      assert.equal(result.orders[0]?.brokerageOrderId, "option-order");
      assert.equal(result.orders[0]?.optionSymbolId, "option-id");
      assert.equal(result.orders[0]?.optionTicker, "AAPL  260821C00200000");
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-option-user-secret|consumer-option-secret|client-option-123|U9999999/,
      );
    }),
  );
});
