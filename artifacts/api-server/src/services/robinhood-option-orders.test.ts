import assert from "node:assert/strict";
import test from "node:test";

import { brokerAccountsTable, brokerConnectionsTable, db } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { runAsAppUser } from "./app-user-context";
import { bootstrapInitialUser } from "./auth";
import {
  placeRobinhoodOptionOrder,
  reviewRobinhoodOptionOrder,
  type RobinhoodOptionOrderInput,
} from "./robinhood-option-orders";
import {
  beginRobinhoodConnectCustody,
  storeRobinhoodTokens,
} from "./robinhood-user-custody";
import { createTaxOrderPreflight } from "./tax-planning";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString("base64url");
const MCP_URL = "https://agent.robinhood.com/mcp/trading";
const ACCOUNT_NUMBER = "727958282";
const OPTION_ID = "84f9c2a9-18d4-4f2f-8a41-64c57385fb32";

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
  await beginRobinhoodConnectCustody({
    appUserId: auth.user.id,
    oauthClientId: "client-abc",
    oauthState: "state-1",
    pkceVerifier: "verifier-1",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  await storeRobinhoodTokens({
    appUserId: auth.user.id,
    accessToken: "access-1",
    refreshToken: "refresh-1",
    accessTokenExpiresAt: null,
    scope: "internal",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  return auth.user.id;
}

async function seedRobinhoodAccount(appUserId: string): Promise<string> {
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId,
      name: "robinhood:agentic",
      connectionType: "broker",
      brokerProvider: "robinhood",
      mode: "live",
      status: "connected",
      capabilities: ["accounts", "positions", "robinhood", "robinhood-agentic"],
    })
    .returning({ id: brokerConnectionsTable.id });
  assert.ok(connection);

  const [account] = await db
    .insert(brokerAccountsTable)
    .values({
      appUserId,
      connectionId: connection.id,
      providerAccountId: `robinhood:${ACCOUNT_NUMBER}`,
      displayName: "Robinhood Agentic account ...8282",
      mode: "live",
      accountStatus: "open",
      baseCurrency: "USD",
      capabilities: [
        "accounts",
        "positions",
        "robinhood",
        "robinhood-agentic",
        "orders",
        "executions",
        "execution-ready",
      ],
      executionBlockers: [],
      lastSyncedAt: "2026-07-09T18:00:00.000Z",
    })
    .returning({ id: brokerAccountsTable.id });
  assert.ok(account);
  return account.id;
}

function mcpFetch(
  toolResult: (name: string, args: Record<string, unknown>) => unknown,
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(String(url), MCP_URL);
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (payload["method"] === "initialize") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload["id"],
          result: { protocolVersion: "2025-03-26" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "session-1",
          },
        },
      );
    }
    if (payload["method"] === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    assert.equal(payload["method"], "tools/call");
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer access-1",
    );
    const params = payload["params"] as Record<string, unknown>;
    const name = String(params["name"]);
    const args = (params["arguments"] ?? {}) as Record<string, unknown>;
    calls.push({ name, args });
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: payload["id"],
        result: { structuredContent: toolResult(name, args) },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  return { fetchImpl, calls };
}

function baseOrder(
  overrides: Partial<RobinhoodOptionOrderInput> = {},
): RobinhoodOptionOrderInput {
  return {
    contractSymbol: "O:AAPL260821C00210000",
    multiplier: 100,
    sharesPerContract: 100,
    chainSymbol: "aapl",
    expiration: "2026-08-21",
    strike: 210,
    optionType: "Call",
    side: "Buy",
    positionEffect: "Open",
    orderType: "Limit",
    timeInForce: "Day",
    quantity: 1,
    limitPrice: 2.45,
    ...overrides,
  };
}

function instrumentPayload() {
  return {
    data: {
      instruments: [
        {
          id: OPTION_ID,
          chain_symbol: "AAPL",
          underlying_type: "equity",
          expiration_date: "2026-08-21",
          strike_price: "210.0000",
          type: "call",
          state: "active",
          tradability: "tradable",
        },
      ],
    },
  };
}

test("resolves one option and reviews with string params and verbatim broker context", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-option-review@example.com");
      const accountId = await seedRobinhoodAccount(appUserId);
      const orderChecks = {
        alertType: "buying_power_notice",
        details: { required_buying_power: "245.00" },
      };
      const { fetchImpl, calls } = mcpFetch((name) => {
        if (name === "get_option_instruments") return instrumentPayload();
        assert.equal(name, "review_option_order");
        return {
          data: {
            account_number: ACCOUNT_NUMBER,
            order_checks: orderChecks,
            alerts: ["The contract expires on 2026-08-21."],
            option_quotes: [
              {
                instrument_id: OPTION_ID,
                mark_price: "2.4500",
                adjusted_mark_price: "2.4500",
                bid_price: "2.4000",
                ask_price: "2.5000",
                previous_close_price: "2.3000",
                implied_volatility: "0.3125",
                delta: "0.5500",
                gamma: "0.0410",
                theta: "-0.0800",
                vega: "0.1200",
                updated_at: "2026-07-09T18:00:00.000Z",
              },
            ],
            estimated_premium: "245.00",
            fees: { total_fee: "0.03" },
            collateral: {
              account_number: ACCOUNT_NUMBER,
              cash: { amount: "245.00", direction: "debit", infinite: false },
              equities: [],
            },
            market_data_disclosure: "Bid $2.40 · Ask $2.50 · Mark $2.45.",
          },
        };
      });

      const result = await reviewRobinhoodOptionOrder({
        appUserId,
        accountId,
        input: baseOrder(),
        encryptionKey: TEST_ENCRYPTION_KEY,
        fetchImpl,
      });

      assert.equal(calls.length, 2);
      assert.equal(calls[0]!.name, "get_option_instruments");
      assert.deepEqual(calls[0]!.args, {
        chain_symbol: "AAPL",
        expiration_dates: "2026-08-21",
        strike_price: "210",
        type: "call",
        state: "active",
        tradability: "tradable",
      });
      assert.equal(calls[1]!.name, "review_option_order");
      assert.deepEqual(calls[1]!.args, {
        account_number: ACCOUNT_NUMBER,
        legs: [{ option_id: OPTION_ID, side: "buy", position_effect: "open" }],
        type: "limit",
        quantity: "1",
        time_in_force: "gfd",
        market_hours: "regular_hours",
        price: "2.45",
        chain_symbol: "AAPL",
        underlying_type: "equity",
      });
      assert.equal(result.order.optionId, OPTION_ID);
      assert.deepEqual(result.review.orderChecks, orderChecks);
      assert.ok(
        result.review.alerts.includes("The contract expires on 2026-08-21."),
      );
      assert.equal(
        result.review.marketDataDisclosure,
        "Bid $2.40 · Ask $2.50 · Mark $2.45.",
      );
      assert.equal(result.review.quote?.markPrice, 2.45);
      assert.equal(result.review.quote?.askPrice, 2.5);
      assert.equal(result.review.estimate.premium, 245);
      assert.equal(result.review.estimate.totalFee, 0.03);
      assert.equal(result.account.accountNumberLast4, "8282");
      assert.doesNotMatch(JSON.stringify(result), new RegExp(ACCOUNT_NUMBER));
    }),
  );
});

test("place requires explicit confirmation with the option-specific 409", async () => {
  await assert.rejects(
    placeRobinhoodOptionOrder({
      appUserId: "user-1",
      accountId: "account-1",
      input: baseOrder(),
    }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      assert.equal(
        (error as { code?: string }).code,
        "robinhood_option_order_confirmation_required",
      );
      return true;
    },
  );
});

test("place requires tax preflight before any MCP tool call", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-option-tax@example.com");
      const accountId = await seedRobinhoodAccount(appUserId);
      const stub = mcpFetch(() => instrumentPayload());

      await assert.rejects(
        placeRobinhoodOptionOrder({
          appUserId,
          accountId,
          input: { ...baseOrder(), confirm: true },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: stub.fetchImpl,
        }),
        (error: unknown) =>
          (error as { code?: string }).code === "tax_preflight_required",
      );
      assert.equal(stub.calls.length, 0);
    }),
  );
});

test("place rejects an invalid tax preflight before any MCP tool call", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser(
        "rh-option-invalid-tax@example.com",
      );
      const accountId = await seedRobinhoodAccount(appUserId);
      const stub = mcpFetch(() => instrumentPayload());

      await assert.rejects(
        placeRobinhoodOptionOrder({
          appUserId,
          accountId,
          input: {
            ...baseOrder(),
            confirm: true,
            taxPreflightToken: "tax_pf_missing",
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: stub.fetchImpl,
        }),
        (error: unknown) =>
          (error as { code?: string }).code === "tax_preflight_invalid",
      );
      assert.equal(stub.calls.length, 0);
    }),
  );
});

test("place submits the resolved leg after a matching option tax preflight", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-option-place@example.com");
      const accountId = await seedRobinhoodAccount(appUserId);
      const preflight = await runAsAppUser(appUserId, () =>
        createTaxOrderPreflight({
          order: {
            accountId,
            mode: "live",
            symbol: "AAPL",
            assetClass: "option",
            side: "buy",
            type: "limit",
            quantity: 1,
            limitPrice: 2.45,
            stopPrice: null,
            timeInForce: "day",
            optionContract: {
              ticker: "AAPL  260821C00210000",
              underlying: "AAPL",
              expirationDate: "2026-08-21",
              strike: 210,
              right: "call",
              multiplier: 100,
              sharesPerContract: 100,
              providerContractId: "AAPL  260821C00210000",
              brokerContractId: "AAPL  260821C00210000",
            },
            route: "robinhood",
            intent: null,
          },
        }),
      );
      const { fetchImpl, calls } = mcpFetch((name) => {
        if (name === "get_option_instruments") return instrumentPayload();
        assert.equal(name, "place_option_order");
        return {
          data: {
            order: { id: "rh-option-order-1", state: "confirmed" },
          },
        };
      });

      const result = await placeRobinhoodOptionOrder({
        appUserId,
        accountId,
        input: {
          ...baseOrder(),
          confirm: true,
          refId: "11111111-1111-4111-8111-111111111111",
          taxPreflightToken: preflight.preflightToken,
          taxAcknowledgements: preflight.requiredAcknowledgements,
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        fetchImpl,
      });

      assert.equal(calls.length, 2);
      assert.equal(calls[1]!.name, "place_option_order");
      assert.deepEqual(calls[1]!.args, {
        account_number: ACCOUNT_NUMBER,
        legs: [{ option_id: OPTION_ID, side: "buy", position_effect: "open" }],
        type: "limit",
        quantity: "1",
        time_in_force: "gfd",
        market_hours: "regular_hours",
        price: "2.45",
        ref_id: "11111111-1111-4111-8111-111111111111",
      });
      assert.equal(result.order.brokerageOrderId, "rh-option-order-1");
      assert.equal(result.order.state, "confirmed");
    }),
  );
});

test("place resolves with reconciliation required when the post-submit tax record fails", async (t) => {
  await withBootstrapToken(async () =>
    withTestDb(async (testDb) => {
      const appUserId = await seedConnectedUser(
        "rh-option-reconcile@example.com",
      );
      const accountId = await seedRobinhoodAccount(appUserId);
      const preflight = await runAsAppUser(appUserId, () =>
        createTaxOrderPreflight({
          order: {
            accountId,
            mode: "live",
            symbol: "AAPL",
            assetClass: "option",
            side: "buy",
            type: "limit",
            quantity: 1,
            limitPrice: 2.45,
            stopPrice: null,
            timeInForce: "day",
            optionContract: {
              ticker: "AAPL  260821C00210000",
              underlying: "AAPL",
              expirationDate: "2026-08-21",
              strike: 210,
              right: "call",
              multiplier: 100,
              sharesPerContract: 100,
              providerContractId: "AAPL  260821C00210000",
              brokerContractId: "AAPL  260821C00210000",
            },
            route: "robinhood",
            intent: null,
          },
        }),
      );
      const { fetchImpl } = mcpFetch((name) => {
        if (name === "get_option_instruments") return instrumentPayload();
        assert.equal(name, "place_option_order");
        t.mock.method(testDb.db, "update", () => {
          throw new Error("tax preflight submit record failed");
        });
        return {
          data: {
            order: { id: "rh-option-order-reconcile", state: "confirmed" },
          },
        };
      });

      const result = await placeRobinhoodOptionOrder({
        appUserId,
        accountId,
        input: {
          ...baseOrder(),
          confirm: true,
          refId: "22222222-2222-4222-8222-222222222222",
          taxPreflightToken: preflight.preflightToken,
          taxAcknowledgements: preflight.requiredAcknowledgements,
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        fetchImpl,
      });

      assert.equal(
        result.order.brokerageOrderId,
        "rh-option-order-reconcile",
      );
      assert.equal(result.order.state, "confirmed");
      assert.equal(result.reconcileRequired, true);
      assert.equal(
        result.reconciliationReason,
        "tax_preflight_order_submit_record_failed",
      );
    }),
  );
});

test("rejects an invalid stop-market leg before account or MCP access", async () => {
  await assert.rejects(
    reviewRobinhoodOptionOrder({
      appUserId: "user-1",
      accountId: "account-1",
      input: baseOrder({
        side: "Buy",
        positionEffect: "Open",
        orderType: "StopMarket",
        limitPrice: null,
        stopPrice: 2.1,
      }),
    }),
    (error: unknown) =>
      (error as { code?: string }).code ===
      "robinhood_option_order_leg_invalid",
  );
});

test("rejects a contract ticker that disagrees with the selected tuple", async () => {
  await assert.rejects(
    reviewRobinhoodOptionOrder({
      appUserId: "user-1",
      accountId: "account-1",
      input: baseOrder({ contractSymbol: "O:AAPL260821P00210000" }),
    }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 422);
      assert.equal(
        (error as { code?: string }).code,
        "option_contract_identity_mismatch",
      );
      return true;
    },
  );
});

test("enforces option limit and stop price requirements", async () => {
  const cases: Array<{
    input: RobinhoodOptionOrderInput;
    code: string;
  }> = [
    {
      input: baseOrder({ limitPrice: null }),
      code: "robinhood_option_limit_price_required",
    },
    {
      input: baseOrder({ orderType: "StopLimit", stopPrice: null }),
      code: "robinhood_option_stop_price_required",
    },
    {
      input: baseOrder({
        side: "Sell",
        positionEffect: "Close",
        orderType: "StopMarket",
        limitPrice: null,
        stopPrice: null,
      }),
      code: "robinhood_option_stop_price_required",
    },
    {
      input: baseOrder({ orderType: "Market", limitPrice: 2.45 }),
      code: "robinhood_option_limit_price_unsupported",
    },
  ];

  for (const entry of cases) {
    await assert.rejects(
      reviewRobinhoodOptionOrder({
        appUserId: "user-1",
        accountId: "account-1",
        input: entry.input,
      }),
      (error: unknown) => (error as { code?: string }).code === entry.code,
    );
  }
});
