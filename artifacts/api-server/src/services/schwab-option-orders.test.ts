import assert from "node:assert/strict";
import test from "node:test";

import { and, eq } from "drizzle-orm";
import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
  taxPreflightChecksTable,
  usersTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { runAsAppUser } from "./app-user-context";
import {
  __schwabOptionOrderInternalsForTests,
  buildSchwabOptionSymbol,
  cancelSchwabOptionOrder,
  previewSchwabOptionOrder,
  submitSchwabOptionOrder,
  type SchwabOptionOrderPreviewInput,
} from "./schwab-option-orders";
import { createTaxOrderPreflight } from "./tax-planning";
import { beginSchwabConnectCustody, storeSchwabTokens } from "./schwab-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64url");
const TEST_ENV = {
  SCHWAB_APP_KEY: "app-key-test",
  SCHWAB_APP_SECRET: "app-secret-test",
};

const {
  validateSchwabOptionOrderInput,
  buildSchwabOptionOrderRequest,
  schwabOptionSubmitToTaxOrder,
  resetSubmitRateLimit,
} = __schwabOptionOrderInternalsForTests;

function expectHttpError(fn: () => unknown, statusCode: number, code: string) {
  assert.throws(fn, (error: unknown) => {
    const candidate = error as { statusCode?: number; code?: string };
    assert.equal(candidate.statusCode, statusCode);
    assert.equal(candidate.code, code);
    return true;
  });
}

function baseInput(
  overrides: Partial<SchwabOptionOrderPreviewInput> = {},
): SchwabOptionOrderPreviewInput {
  return {
    underlyingSymbol: "AAPL",
    expiration: "2027-01-15",
    strike: 150,
    optionType: "Call",
    instruction: "BuyToOpen",
    orderType: "Market",
    duration: "Day",
    session: "Normal",
    quantity: 1,
    ...overrides,
  };
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

async function seedSchwabAccount(email: string): Promise<{
  appUserId: string;
  accountId: string;
}> {
  const appUserId = await createUser(email);
  await beginSchwabConnectCustody({
    appUserId,
    oauthState: `state-${appUserId}`,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  await storeSchwabTokens({
    appUserId,
    accessToken: "access-secret-test",
    refreshToken: "refresh-secret-test",
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
    scope: "api",
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId,
      name: `schwab:${email}`,
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
  assert.ok(account);
  return { appUserId, accountId: account.id };
}

type CapturedRequest = {
  url: string;
  method: string;
  body: unknown;
};

function captureFetch(
  responder: (request: CapturedRequest) => Response,
): { calls: CapturedRequest[]; fetchImpl: typeof fetch } {
  const calls: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer access-secret-test",
    );
    const request = {
      url: String(url),
      method: init?.method ?? "GET",
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : null,
    };
    calls.push(request);
    return responder(request);
  };
  return { calls, fetchImpl };
}

test("buildSchwabOptionSymbol emits the exact 21-character OCC series key", () => {
  const cases = [
    {
      input: {
        underlyingSymbol: "aapl",
        expiration: "2024-01-19",
        strike: 150,
        optionType: "Call" as const,
      },
      expected: "AAPL  240119C00150000",
    },
    {
      input: {
        underlyingSymbol: "SPY",
        expiration: "2026-06-18",
        strike: 500,
        optionType: "Put" as const,
      },
      expected: "SPY   260618P00500000",
    },
    {
      input: {
        underlyingSymbol: "BRK.B",
        expiration: "2027-12-17",
        strike: 12.5,
        optionType: "Call" as const,
      },
      expected: "BRK.B 271217C00012500",
    },
    {
      input: {
        underlyingSymbol: "F",
        expiration: "2028-02-29",
        strike: 0.5,
        optionType: "Put" as const,
      },
      expected: "F     280229P00000500",
    },
  ];

  for (const { input, expected } of cases) {
    const symbol = buildSchwabOptionSymbol(input);
    assert.equal(symbol, expected);
    assert.equal(symbol.length, 21);
  }
});

test("OCC construction rejects invalid roots, dates, strikes, and option types", () => {
  expectHttpError(
    () =>
      buildSchwabOptionSymbol({
        underlyingSymbol: "TOOLONG",
        expiration: "2027-01-15",
        strike: 1,
        optionType: "Call",
      }),
    422,
    "schwab_option_order_underlying_invalid",
  );
  expectHttpError(
    () =>
      buildSchwabOptionSymbol({
        underlyingSymbol: "AAPL",
        expiration: "2027-02-29",
        strike: 1,
        optionType: "Call",
      }),
    422,
    "schwab_option_order_expiration_invalid",
  );
  for (const strike of [0, 1.2345, 100_000]) {
    expectHttpError(
      () =>
        buildSchwabOptionSymbol({
          underlyingSymbol: "AAPL",
          expiration: "2027-01-15",
          strike,
          optionType: "Call",
        }),
      422,
      "schwab_option_order_strike_invalid",
    );
  }
  expectHttpError(
    () =>
      buildSchwabOptionSymbol({
        underlyingSymbol: "AAPL",
        expiration: "2027-01-15",
        strike: 1,
        optionType: "Straddle" as never,
      }),
    422,
    "schwab_option_order_option_type_invalid",
  );
});

test("validation requires whole contracts and a positive Limit price", () => {
  expectHttpError(
    () => validateSchwabOptionOrderInput(baseInput({ quantity: 1.5 })),
    422,
    "schwab_option_order_quantity_invalid",
  );
  expectHttpError(
    () =>
      validateSchwabOptionOrderInput(
        baseInput({ orderType: "Limit", limitPrice: undefined }),
      ),
    422,
    "schwab_option_order_limit_price_required",
  );
  expectHttpError(
    () =>
      validateSchwabOptionOrderInput(
        baseInput({ instruction: "Exercise" as never }),
      ),
    422,
    "schwab_option_order_instruction_invalid",
  );
});

test("wire construction maps every option instruction and formats Limit prices", () => {
  const instructions = {
    BuyToOpen: "BUY_TO_OPEN",
    SellToClose: "SELL_TO_CLOSE",
    SellToOpen: "SELL_TO_OPEN",
    BuyToClose: "BUY_TO_CLOSE",
  } as const;
  for (const [instruction, expected] of Object.entries(instructions)) {
    const order = buildSchwabOptionOrderRequest(
      validateSchwabOptionOrderInput(
        baseInput({
          instruction: instruction as keyof typeof instructions,
          orderType: "Limit",
          duration: "GoodTillCancel",
          limitPrice: 1.25,
        }),
      ),
    );
    assert.equal(order.orderType, "LIMIT");
    assert.equal(order.duration, "GOOD_TILL_CANCEL");
    assert.equal(order.price, "1.25");
    assert.equal(order.orderLegCollection[0]!.instruction, expected);
    assert.deepEqual(order.orderLegCollection[0]!.instrument, {
      symbol: "AAPL  270115C00150000",
      assetType: "OPTION",
    });
  }
});

test("preview posts an OPTION order and strips upstream credentials and account numbers", async () => {
  await withTestDb(async () => {
    const { appUserId, accountId } = await seedSchwabAccount(
      "schwab-option-preview@example.com",
    );
    const transport = captureFetch(() =>
      Response.json({
        orderBalance: { projectedAvailableFunds: 1234.56 },
        accountNumber: "12345678",
        accessToken: "upstream-access-secret",
        nested: {
          refresh_token: "upstream-refresh-secret",
          validation: "accepted",
        },
      }),
    );

    const result = await previewSchwabOptionOrder({
      appUserId,
      accountId,
      input: baseInput(),
      env: TEST_ENV,
      encryptionKey: TEST_ENCRYPTION_KEY,
      fetchImpl: transport.fetchImpl,
      now: new Date("2026-07-09T12:00:00.000Z"),
    });

    assert.equal(transport.calls.length, 1);
    assert.equal(
      transport.calls[0]!.url,
      "https://api.schwabapi.com/trader/v1/accounts/ABC123HASH/previewOrder",
    );
    assert.equal(transport.calls[0]!.method, "POST");
    assert.deepEqual(transport.calls[0]!.body, {
      orderType: "MARKET",
      session: "NORMAL",
      duration: "DAY",
      orderStrategyType: "SINGLE",
      orderLegCollection: [
        {
          instruction: "BUY_TO_OPEN",
          quantity: 1,
          instrument: {
            symbol: "AAPL  270115C00150000",
            assetType: "OPTION",
          },
        },
      ],
    });
    assert.deepEqual(result.preview, {
      orderBalance: { projectedAvailableFunds: 1234.56 },
      nested: { validation: "accepted" },
    });
    const serialized = JSON.stringify(result);
    for (const secret of [
      "12345678",
      "access-secret-test",
      "upstream-access-secret",
      "upstream-refresh-secret",
    ]) {
      assert.ok(!serialized.includes(secret));
    }
  });
});

test("submit requires explicit confirmation before any account or provider work", async () => {
  await assert.rejects(
    submitSchwabOptionOrder({
      appUserId: "missing-user",
      accountId: "missing-account",
      input: { ...baseInput(), confirm: false },
    }),
    (error: unknown) => {
      const candidate = error as { statusCode?: number; code?: string };
      assert.equal(candidate.statusCode, 409);
      assert.equal(candidate.code, "schwab_option_order_confirmation_required");
      return true;
    },
  );
});

test("submit requires an option tax preflight, places the order, and records submission", async () => {
  await withTestDb(async () => {
    resetSubmitRateLimit();
    const { appUserId, accountId } = await seedSchwabAccount(
      "schwab-option-submit@example.com",
    );
    const input = { ...baseInput(), confirm: true };
    let providerCalled = false;
    await assert.rejects(
      submitSchwabOptionOrder({
        appUserId,
        accountId,
        input,
        env: TEST_ENV,
        encryptionKey: TEST_ENCRYPTION_KEY,
        fetchImpl: (async () => {
          providerCalled = true;
          throw new Error("provider must not run without tax preflight");
        }) as typeof fetch,
      }),
      (error: unknown) =>
        (error as { code?: string }).code === "tax_preflight_required",
    );
    assert.equal(providerCalled, false);

    const taxOrder = schwabOptionSubmitToTaxOrder({
      accountId,
      order: validateSchwabOptionOrderInput(input),
    });
    assert.deepEqual(taxOrder, {
      accountId,
      mode: "live",
      symbol: "AAPL",
      assetClass: "option",
      side: "buy",
      type: "market",
      quantity: 1,
      limitPrice: null,
      stopPrice: null,
      timeInForce: "day",
      optionContract: {
        ticker: "AAPL  270115C00150000",
        underlying: "AAPL",
        expirationDate: "2027-01-15",
        strike: 150,
        right: "call",
        multiplier: 100,
        sharesPerContract: 100,
        providerContractId: "AAPL  270115C00150000",
        brokerContractId: "AAPL  270115C00150000",
      },
      route: "schwab",
      intent: null,
    });
    const preflight = await runAsAppUser(appUserId, () =>
      createTaxOrderPreflight({ order: taxOrder }),
    );
    const transport = captureFetch(() =>
      new Response(null, {
        status: 201,
        headers: {
          Location:
            "https://api.schwabapi.com/trader/v1/accounts/ABC123HASH/orders/option-order-9",
        },
      }),
    );

    const result = await submitSchwabOptionOrder({
      appUserId,
      accountId,
      input: {
        ...input,
        taxPreflightToken: preflight.preflightToken,
        taxAcknowledgements: preflight.requiredAcknowledgements,
      },
      env: TEST_ENV,
      encryptionKey: TEST_ENCRYPTION_KEY,
      fetchImpl: transport.fetchImpl,
    });

    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0]!.method, "POST");
    assert.equal(
      transport.calls[0]!.url,
      "https://api.schwabapi.com/trader/v1/accounts/ABC123HASH/orders",
    );
    assert.equal(result.orderId, "option-order-9");
    assert.equal(result.status, "submitted");
    const [storedPreflight] = await db
      .select({ submittedOrderId: taxPreflightChecksTable.submittedOrderId })
      .from(taxPreflightChecksTable)
      .where(
        and(
          eq(taxPreflightChecksTable.appUserId, appUserId),
          eq(
            taxPreflightChecksTable.preflightToken,
            preflight.preflightToken,
          ),
        ),
      )
      .limit(1);
    assert.equal(storedPreflight?.submittedOrderId, "option-order-9");
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("access-secret-test"));
    assert.ok(!serialized.includes("12345678"));
  });
});

test("cancel deletes the account-scoped order and returns only sanitized metadata", async () => {
  await withTestDb(async () => {
    const { appUserId, accountId } = await seedSchwabAccount(
      "schwab-option-cancel@example.com",
    );
    const transport = captureFetch(() => new Response(null, { status: 204 }));

    const result = await cancelSchwabOptionOrder({
      appUserId,
      accountId,
      orderId: " option-order-17 ",
      env: TEST_ENV,
      encryptionKey: TEST_ENCRYPTION_KEY,
      fetchImpl: transport.fetchImpl,
      now: new Date("2026-07-09T12:30:00.000Z"),
    });

    assert.equal(transport.calls.length, 1);
    assert.equal(transport.calls[0]!.method, "DELETE");
    assert.equal(
      transport.calls[0]!.url,
      "https://api.schwabapi.com/trader/v1/accounts/ABC123HASH/orders/option-order-17",
    );
    assert.equal(result.orderId, "option-order-17");
    assert.equal(result.status, "canceled");
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("access-secret-test"));
    assert.ok(!serialized.includes("12345678"));
  });
});
