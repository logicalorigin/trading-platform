import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { runAsAppUser } from "./app-user-context";
import {
  __schwabEquityOrderInternalsForTests,
  replaceSchwabEquityOrder,
  submitSchwabEquityOrder,
  type SchwabEquityOrderAccount,
} from "./schwab-equity-orders";
import { beginSchwabConnectCustody, storeSchwabTokens } from "./schwab-user-custody";
import { createTaxOrderPreflight } from "./tax-planning";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString("base64url");
const TEST_ENV = {
  SCHWAB_APP_KEY: "schwab-app-key",
  SCHWAB_APP_SECRET: "schwab-app-secret",
};

const {
  validateSchwabEquityOrderInput,
  buildSchwabOrderRequest,
  assertExecutionReady,
  executionReady,
  normalizeSchwabSymbol,
  formatPrice,
  schwabSubmitToTaxOrder,
} = __schwabEquityOrderInternalsForTests;

function expectHttpError(fn: () => unknown, statusCode: number, code: string) {
  assert.throws(fn, (err: unknown) => {
    const e = err as { statusCode?: number; code?: string };
    assert.equal(e.statusCode, statusCode);
    assert.equal(e.code, code);
    return true;
  });
}

async function createUser(email: string): Promise<string> {
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      displayName: null,
      passwordHash: "scrypt:v1:test-only",
      role: "member",
    })
    .returning({ id: usersTable.id });
  assert.ok(user);
  return user.id;
}

test("normalizeSchwabSymbol upper-cases, trims, and rejects invalid symbols", () => {
  assert.equal(normalizeSchwabSymbol("aapl"), "AAPL");
  assert.equal(normalizeSchwabSymbol("  msft "), "MSFT");
  assert.equal(normalizeSchwabSymbol("BRK.B"), "BRK.B");
  assert.equal(normalizeSchwabSymbol(""), null);
  assert.equal(normalizeSchwabSymbol("123"), null); // must start with a letter
  assert.equal(normalizeSchwabSymbol("A B"), null);
  assert.equal(normalizeSchwabSymbol(null), null);
});

test("formatPrice renders a Schwab-friendly string, trimming trailing zeros", () => {
  assert.equal(formatPrice(45.97), "45.97");
  assert.equal(formatPrice(10), "10");
  assert.equal(formatPrice(1.5), "1.5");
  assert.equal(formatPrice(0.1234), "0.1234");
  assert.equal(formatPrice(45.970001), "45.97"); // rounded to 4dp then trimmed
});

test("validate accepts a market buy and defaults session to Normal", () => {
  const normalized = validateSchwabEquityOrderInput({
    symbol: "xyz",
    action: "BUY",
    quantity: 15,
    orderType: "Market",
    timeInForce: "Day",
  });
  assert.deepEqual(normalized, {
    symbol: "XYZ",
    action: "BUY",
    quantity: 15,
    orderType: "Market",
    timeInForce: "Day",
    session: "Normal",
    limitPrice: null,
    stopPrice: null,
  });
});

test("validate requires limit/stop prices for the relevant order types", () => {
  expectHttpError(
    () =>
      validateSchwabEquityOrderInput({
        symbol: "XYZ",
        action: "SELL",
        quantity: 2,
        orderType: "Limit",
        timeInForce: "Day",
      }),
    422,
    "schwab_order_limit_price_required",
  );
  expectHttpError(
    () =>
      validateSchwabEquityOrderInput({
        symbol: "XYZ",
        action: "SELL",
        quantity: 2,
        orderType: "Stop",
        timeInForce: "Day",
      }),
    422,
    "schwab_order_stop_price_required",
  );
});

test("validate rejects bad symbol, action, and quantity", () => {
  expectHttpError(
    () => validateSchwabEquityOrderInput({ symbol: "1", action: "BUY", quantity: 1, orderType: "Market", timeInForce: "Day" }),
    422,
    "schwab_order_symbol_invalid",
  );
  expectHttpError(
    () => validateSchwabEquityOrderInput({ symbol: "XYZ", action: "HODL" as never, quantity: 1, orderType: "Market", timeInForce: "Day" }),
    422,
    "schwab_order_action_invalid",
  );
  expectHttpError(
    () => validateSchwabEquityOrderInput({ symbol: "XYZ", action: "BUY", quantity: 1.5, orderType: "Market", timeInForce: "Day" }),
    422,
    "schwab_order_quantity_invalid",
  );
  expectHttpError(
    () => validateSchwabEquityOrderInput({ symbol: "XYZ", action: "BUY", quantity: 0, orderType: "Market", timeInForce: "Day" }),
    422,
    "schwab_order_quantity_invalid",
  );
});

test("buildSchwabOrderRequest matches the Schwab doc market-BUY example", () => {
  const request = buildSchwabOrderRequest(
    validateSchwabEquityOrderInput({
      symbol: "XYZ",
      action: "BUY",
      quantity: 15,
      orderType: "Market",
      timeInForce: "Day",
    }),
  );
  assert.deepEqual(request, {
    orderType: "MARKET",
    session: "NORMAL",
    duration: "DAY",
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      { instruction: "BUY", quantity: 15, instrument: { symbol: "XYZ", assetType: "EQUITY" } },
    ],
  });
});

test("buildSchwabOrderRequest matches the Schwab doc limit-SELL example (price as string)", () => {
  const request = buildSchwabOrderRequest(
    validateSchwabEquityOrderInput({
      symbol: "XYZ",
      action: "SELL",
      quantity: 2,
      orderType: "Limit",
      timeInForce: "Day",
      limitPrice: 45.97,
    }),
  );
  assert.deepEqual(request, {
    orderType: "LIMIT",
    session: "NORMAL",
    duration: "DAY",
    price: "45.97",
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      { instruction: "SELL", quantity: 2, instrument: { symbol: "XYZ", assetType: "EQUITY" } },
    ],
  });
});

test("buildSchwabOrderRequest emits both price and stopPrice for a stop-limit", () => {
  const request = buildSchwabOrderRequest(
    validateSchwabEquityOrderInput({
      symbol: "XYZ",
      action: "SELL",
      quantity: 5,
      orderType: "StopLimit",
      timeInForce: "GoodTillCancel",
      session: "Seamless",
      limitPrice: 40.5,
      stopPrice: 41,
    }),
  );
  assert.equal(request.orderType, "STOP_LIMIT");
  assert.equal(request.duration, "GOOD_TILL_CANCEL");
  assert.equal(request.session, "SEAMLESS");
  assert.equal(request.price, "40.5");
  assert.equal(request.stopPrice, "41");
});

function account(overrides: Partial<SchwabEquityOrderAccount>): SchwabEquityOrderAccount {
  return {
    id: "acct-1",
    connectionId: "conn-1",
    accountHash: "HASH",
    displayName: "Schwab Individual",
    baseCurrency: "USD",
    mode: "live",
    accountStatus: "open",
    executionReady: false,
    executionBlockers: [],
    lastSyncedAt: null,
    ...overrides,
  };
}

test("executionReady requires the capability, no blockers, and an open/undefined status", () => {
  assert.equal(
    executionReady({ capabilities: ["execution-ready"], executionBlockers: [], accountStatus: "open" }),
    true,
  );
  assert.equal(
    executionReady({ capabilities: ["execution-ready"], executionBlockers: [], accountStatus: null }),
    true,
  );
  assert.equal(
    executionReady({ capabilities: [], executionBlockers: [], accountStatus: "open" }),
    false,
  );
  assert.equal(
    executionReady({
      capabilities: ["execution-ready"],
      executionBlockers: ["schwab.order_tooling_unverified"],
      accountStatus: "open",
    }),
    false,
  );
});

test("assertExecutionReady throws 409 with the blockers while Schwab is blocked", () => {
  const blocked = account({
    executionReady: false,
    executionBlockers: ["schwab.order_tooling_unverified"],
  });
  assert.throws(
    () => assertExecutionReady(blocked),
    (err: unknown) => {
      const e = err as { statusCode?: number; code?: string; data?: { blockers?: string[] } };
      assert.equal(e.statusCode, 409);
      assert.equal(e.code, "schwab_account_execution_blocked");
      assert.deepEqual(e.data?.blockers, ["schwab.order_tooling_unverified"]);
      return true;
    },
  );
});

test("assertExecutionReady passes through when the account is execution-ready", () => {
  assert.doesNotThrow(() => assertExecutionReady(account({ executionReady: true })));
});

test("submitSchwabEquityOrder requires tax preflight before provider calls", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("schwab-tax-preflight@example.com");
    const [connection] = await db
      .insert(brokerConnectionsTable)
      .values({
        appUserId,
        name: "schwab:tax-preflight",
        connectionType: "broker",
        brokerProvider: "schwab",
        mode: "live",
        status: "connected",
        capabilities: ["accounts", "positions", "schwab", "orders"],
      })
      .returning({ id: brokerConnectionsTable.id });
    assert.ok(connection);
    const [brokerAccount] = await db
      .insert(brokerAccountsTable)
      .values({
        appUserId,
        connectionId: connection.id,
        providerAccountId: "schwab:ABC123HASH",
        displayName: "Schwab ...5678",
        mode: "live",
        accountStatus: "open",
        baseCurrency: "USD",
        capabilities: [
          "accounts",
          "positions",
          "schwab",
          "orders",
          "execution-ready",
        ],
        executionBlockers: [],
      })
      .returning({ id: brokerAccountsTable.id });
    assert.ok(brokerAccount);

    let called = false;
    await assert.rejects(
      submitSchwabEquityOrder({
        appUserId,
        accountId: brokerAccount.id,
        input: {
          confirm: true,
          symbol: "AAPL",
          action: "BUY",
          quantity: 1,
          orderType: "Market",
          timeInForce: "Day",
        },
        fetchImpl: (async () => {
          called = true;
          throw new Error("provider fetch should not run without tax preflight");
        }) as typeof fetch,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "tax_preflight_required");
        return true;
      },
    );
    assert.equal(called, false);
  });
});

test("replaceSchwabEquityOrder requires explicit confirmation", async () => {
  await assert.rejects(
    replaceSchwabEquityOrder({
      appUserId: "missing-user",
      accountId: "missing-account",
      orderId: "old-order-id",
      input: {
        confirm: false,
        symbol: "AAPL",
        action: "BUY",
        quantity: 1,
        orderType: "Market",
        timeInForce: "Day",
      },
    }),
    (error: unknown) => {
      const candidate = error as { statusCode?: number; code?: string };
      assert.equal(candidate.statusCode, 409);
      assert.equal(candidate.code, "schwab_order_replace_confirmation_required");
      return true;
    },
  );
});

test("replaceSchwabEquityOrder puts the replacement body and returns sanitized ids", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser("schwab-replace@example.com");
    await beginSchwabConnectCustody({
      appUserId,
      oauthState: "replace-state",
      encryptionKey: TEST_ENCRYPTION_KEY,
    });
    await storeSchwabTokens({
      appUserId,
      accessToken: "schwab-access-secret",
      refreshToken: "schwab-refresh-secret",
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
      scope: "api",
      encryptionKey: TEST_ENCRYPTION_KEY,
    });
    const [connection] = await db
      .insert(brokerConnectionsTable)
      .values({
        appUserId,
        name: "schwab:replace",
        connectionType: "broker",
        brokerProvider: "schwab",
        mode: "live",
        status: "connected",
        capabilities: ["accounts", "positions", "schwab", "orders"],
      })
      .returning({ id: brokerConnectionsTable.id });
    assert.ok(connection);
    const [brokerAccount] = await db
      .insert(brokerAccountsTable)
      .values({
        appUserId,
        connectionId: connection.id,
        providerAccountId: "schwab:ABC123HASH",
        displayName: "Schwab ...5678",
        mode: "live",
        accountStatus: "open",
        baseCurrency: "USD",
        capabilities: [
          "accounts",
          "positions",
          "schwab",
          "orders",
          "execution-ready",
        ],
        executionBlockers: [],
      })
      .returning({ id: brokerAccountsTable.id });
    assert.ok(brokerAccount);

    const input = {
      confirm: true as const,
      symbol: "msft",
      action: "SELL" as const,
      quantity: 2,
      orderType: "Limit" as const,
      timeInForce: "Day" as const,
      limitPrice: 405.5,
    };
    const preflight = await runAsAppUser(appUserId, () =>
      createTaxOrderPreflight({
        order: schwabSubmitToTaxOrder({
          accountId: brokerAccount.id,
          order: validateSchwabEquityOrderInput(input),
        }),
      }),
    );
    let requestedBody: unknown;
    const fetchImpl: typeof fetch = async (url, init) => {
      assert.equal(
        String(url),
        "https://api.schwabapi.com/trader/v1/accounts/ABC123HASH/orders/old-order-id",
      );
      assert.equal(init?.method, "PUT");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer schwab-access-secret",
      );
      requestedBody = JSON.parse(String(init?.body));
      return new Response(null, {
        status: 201,
        headers: {
          Location:
            "https://api.schwabapi.com/trader/v1/accounts/ABC123HASH/orders/new-order-id",
        },
      });
    };

    const result = await replaceSchwabEquityOrder({
      appUserId,
      accountId: brokerAccount.id,
      orderId: " old-order-id ",
      input: {
        ...input,
        taxPreflightToken: preflight.preflightToken,
        taxAcknowledgements: preflight.requiredAcknowledgements,
      },
      env: TEST_ENV,
      encryptionKey: TEST_ENCRYPTION_KEY,
      now: new Date("2026-07-09T18:00:00.000Z"),
      fetchImpl,
    });

    assert.deepEqual(requestedBody, {
      orderType: "LIMIT",
      session: "NORMAL",
      duration: "DAY",
      orderStrategyType: "SINGLE",
      orderLegCollection: [
        {
          instruction: "SELL",
          quantity: 2,
          instrument: { symbol: "MSFT", assetType: "EQUITY" },
        },
      ],
      price: "405.5",
    });
    assert.equal(result.replacedAt, "2026-07-09T18:00:00.000Z");
    assert.equal(result.orderId, "new-order-id");
    assert.equal(result.previousOrderId, "old-order-id");
    assert.equal(result.status, "replaced");
    assert.doesNotMatch(
      JSON.stringify(result),
      /schwab-access-secret|schwab-refresh-secret|schwab-app-secret/,
    );
  });
});
