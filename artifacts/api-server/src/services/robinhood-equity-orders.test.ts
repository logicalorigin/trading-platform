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
  cancelRobinhoodEquityOrder,
  placeRobinhoodEquityOrder,
  reviewRobinhoodEquityOrder,
} from "./robinhood-equity-orders";
import {
  beginRobinhoodConnectCustody,
  storeRobinhoodTokens,
} from "./robinhood-user-custody";
import { createTaxOrderPreflight } from "./tax-planning";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64url");
const MCP_URL = "https://agent.robinhood.com/mcp/trading";
const ACCOUNT_NUMBER = "727958282";

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

async function seedRobinhoodAccount(input: {
  appUserId: string;
  agentic?: boolean;
}): Promise<string> {
  const agentic = input.agentic ?? true;
  const [connection] = await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: input.appUserId,
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
      appUserId: input.appUserId,
      connectionId: connection.id,
      providerAccountId: `robinhood:${ACCOUNT_NUMBER}`,
      displayName: "Robinhood Agentic account ...8282",
      mode: "live",
      accountStatus: "open",
      baseCurrency: "USD",
      capabilities: agentic
        ? [
            "accounts",
            "positions",
            "robinhood",
            "robinhood-agentic",
            "orders",
            "executions",
            "execution-ready",
          ]
        : ["accounts", "positions", "robinhood"],
      executionBlockers: agentic ? [] : ["robinhood.account.non_agentic"],
      lastSyncedAt: "2026-07-09T18:00:00.000Z",
    })
    .returning({ id: brokerAccountsTable.id });
  assert.ok(account);
  return account.id;
}

// Minimal MCP transport stub: answers initialize/notifications and returns the
// supplied tool payload as structuredContent, recording each tools/call.
function mcpFetch(toolResult: (name: string, args: Record<string, unknown>) => unknown) {
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

test("review serializes a $5 notional buy as string tool params and passes alerts through", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-review@example.com");
      const accountId = await seedRobinhoodAccount({ appUserId });

      const { fetchImpl, calls } = mcpFetch(() => ({
        // Mirrors the live review_equity_order payload shape.
        data: {
          symbol: "PLUG",
          side: "buy",
          type: "market",
          dollar_amount: "5.00",
          order_checks: { fractional: "Fractional shares are supported." },
          quote_data: {
            last_trade_price: "2.385000",
            bid_price: "2.380000",
            ask_price: "2.390000",
            previous_close: "2.460000",
          },
          market_data_disclosure: "Bid $2.38 · Ask $2.39 · Last $2.38.",
        },
        guide: "This tool does NOT place the order.",
      }));

      const result = await reviewRobinhoodEquityOrder({
        appUserId,
        accountId,
        input: {
          symbol: "plug",
          side: "BUY",
          orderType: "Market",
          timeInForce: "Day",
          notionalValue: 5,
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        fetchImpl,
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.name, "review_equity_order");
      assert.deepEqual(calls[0]!.args, {
        account_number: ACCOUNT_NUMBER,
        symbol: "PLUG",
        side: "buy",
        type: "market",
        time_in_force: "gfd",
        market_hours: "regular_hours",
        dollar_amount: "5.00",
      });
      assert.equal(result.review.lastTradePrice, 2.385);
      assert.equal(result.review.bidPrice, 2.38);
      assert.equal(result.review.askPrice, 2.39);
      assert.equal(result.review.previousClose, 2.46);
      assert.equal(
        result.review.marketDataDisclosure,
        "Bid $2.38 · Ask $2.39 · Last $2.38.",
      );
      assert.deepEqual(result.review.alerts, [
        "fractional: Fractional shares are supported.",
      ]);
      // Full account number is never surfaced.
      assert.equal(result.account.accountNumberLast4, "8282");
      assert.doesNotMatch(JSON.stringify(result), new RegExp(ACCOUNT_NUMBER));
    }),
  );
});

test("place requires explicit confirmation", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-confirm@example.com");
      const accountId = await seedRobinhoodAccount({ appUserId });

      await assert.rejects(
        placeRobinhoodEquityOrder({
          appUserId,
          accountId,
          input: {
            symbol: "PLUG",
            side: "BUY",
            orderType: "Market",
            timeInForce: "Day",
            notionalValue: 5,
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: mcpFetch(() => ({})).fetchImpl,
        }),
        (error: unknown) =>
          (error as { code?: string }).code ===
          "robinhood_order_confirmation_required",
      );
    }),
  );
});

test("place requires a tax/compliance preflight token for live orders", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-tax@example.com");
      const accountId = await seedRobinhoodAccount({ appUserId });

      const stub = mcpFetch(() => ({}));
      await assert.rejects(
        placeRobinhoodEquityOrder({
          appUserId,
          accountId,
          input: {
            confirm: true,
            symbol: "PLUG",
            side: "BUY",
            orderType: "Market",
            timeInForce: "Day",
            notionalValue: 5,
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: stub.fetchImpl,
        }),
        (error: unknown) =>
          (error as { code?: string }).code === "tax_preflight_required",
      );
      // The order must not reach the broker without preflight.
      assert.equal(stub.calls.length, 0);
    }),
  );
});

test("place submits with ref_id after a matching preflight and parses the order id", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-place@example.com");
      const accountId = await seedRobinhoodAccount({ appUserId });

      const preflight = await runAsAppUser(appUserId, () =>
        createTaxOrderPreflight({
          order: {
            accountId,
            mode: "live",
            symbol: "PLUG",
            assetClass: "equity",
            side: "buy",
            type: "market",
            quantity: 0,
            limitPrice: null,
            stopPrice: null,
            timeInForce: "day",
            optionContract: null,
            route: "robinhood",
            intent: null,
          },
        }),
      );

      const { fetchImpl, calls } = mcpFetch(() => ({
        data: { id: "rh-order-9f2", state: "confirmed" },
      }));

      const result = await placeRobinhoodEquityOrder({
        appUserId,
        accountId,
        input: {
          confirm: true,
          symbol: "PLUG",
          side: "BUY",
          orderType: "Market",
          timeInForce: "Day",
          notionalValue: 5,
          refId: "11111111-1111-4111-8111-111111111111",
          taxPreflightToken: preflight.preflightToken,
          taxAcknowledgements: preflight.requiredAcknowledgements,
        },
        encryptionKey: TEST_ENCRYPTION_KEY,
        fetchImpl,
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.name, "place_equity_order");
      assert.equal(calls[0]!.args["ref_id"], "11111111-1111-4111-8111-111111111111");
      assert.equal(calls[0]!.args["dollar_amount"], "5.00");
      assert.equal(result.order.brokerageOrderId, "rh-order-9f2");
      assert.equal(result.order.state, "confirmed");
      assert.equal(result.order.refId, "11111111-1111-4111-8111-111111111111");
    }),
  );
});

test("non-agentic account is rejected", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-nonagentic@example.com");
      const accountId = await seedRobinhoodAccount({ appUserId, agentic: false });

      await assert.rejects(
        reviewRobinhoodEquityOrder({
          appUserId,
          accountId,
          input: {
            symbol: "PLUG",
            side: "BUY",
            orderType: "Market",
            timeInForce: "Day",
            notionalValue: 5,
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: mcpFetch(() => ({})).fetchImpl,
        }),
        (error: unknown) =>
          (error as { code?: string }).code === "robinhood_account_not_agentic",
      );
    }),
  );
});

test("rejects an order that specifies both quantity and notionalValue", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-xor@example.com");
      const accountId = await seedRobinhoodAccount({ appUserId });

      await assert.rejects(
        reviewRobinhoodEquityOrder({
          appUserId,
          accountId,
          input: {
            symbol: "PLUG",
            side: "BUY",
            orderType: "Market",
            timeInForce: "Day",
            quantity: 1,
            notionalValue: 5,
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: mcpFetch(() => ({})).fetchImpl,
        }),
        (error: unknown) =>
          (error as { code?: string }).code === "robinhood_order_quantity_invalid",
      );
    }),
  );
});

test("cancel sends account_number + order_id and reports canceled", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-cancel@example.com");
      const accountId = await seedRobinhoodAccount({ appUserId });

      const { fetchImpl, calls } = mcpFetch(() => ({
        data: { id: "6a4ff1ab-4b8b-4bb5-b4fc-17a1772ceddc", state: "cancelled" },
      }));

      const result = await cancelRobinhoodEquityOrder({
        appUserId,
        accountId,
        orderId: "6a4ff1ab-4b8b-4bb5-b4fc-17a1772ceddc",
        encryptionKey: TEST_ENCRYPTION_KEY,
        fetchImpl,
      });

      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.name, "cancel_equity_order");
      assert.deepEqual(calls[0]!.args, {
        account_number: ACCOUNT_NUMBER,
        order_id: "6a4ff1ab-4b8b-4bb5-b4fc-17a1772ceddc",
      });
      assert.equal(result.status, "canceled");
      assert.equal(result.state, "cancelled");
      assert.equal(result.orderId, "6a4ff1ab-4b8b-4bb5-b4fc-17a1772ceddc");
    }),
  );
});

test("cancel rejects an empty order id", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const appUserId = await seedConnectedUser("rh-cancel-empty@example.com");
      const accountId = await seedRobinhoodAccount({ appUserId });
      await assert.rejects(
        cancelRobinhoodEquityOrder({
          appUserId,
          accountId,
          orderId: "   ",
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: mcpFetch(() => ({})).fetchImpl,
        }),
        (error: unknown) =>
          (error as { code?: string }).code === "robinhood_order_id_required",
      );
    }),
  );
});
