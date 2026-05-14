import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import type { BrokerOrderSnapshot, PlaceOrderInput } from "../providers/ibkr/client";
import { HttpError } from "../lib/errors";
import { PlaceOrderBody } from "@workspace/api-zod";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";
const previousRuntimeOverrideFile =
  process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] = join(
  tmpdir(),
  `rayalgo-order-gateway-readiness-${process.pid}.json`,
);

const runtimeModule = await import("../lib/runtime");
const platformModule = await import("./platform");
const shadowModule = await import("./shadow-account");
const bridgeGovernorModule = await import("./bridge-governor");

const { clearIbkrBridgeRuntimeOverride, setIbkrBridgeRuntimeOverride } =
  runtimeModule;
const {
  __setIbkrBridgeClientFactoryForTests,
  assertIbkrGatewayTradingAvailable,
  cancelOrder,
  placeOrder,
  previewOrder,
  replaceOrder,
  submitRawOrders,
} = platformModule;
const { placeShadowOrder, previewShadowOrder } = shadowModule;
const { __resetBridgeGovernorForTests } = bridgeGovernorModule;

function configureIbkr() {
  setIbkrBridgeRuntimeOverride({
    baseUrl: "http://127.0.0.1:65535",
    apiToken: "test",
  });
}

function health(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    authenticated: true,
    connected: true,
    competing: false,
    selectedAccountId: "DU1234567",
    accounts: ["DU1234567"],
    lastTickleAt: new Date(),
    lastError: null,
    lastRecoveryAttemptAt: null,
    lastRecoveryError: null,
    updatedAt: new Date(),
    transport: "tws",
    connectionTarget: "127.0.0.1:4001",
    sessionMode: "paper",
    clientId: 101,
    marketDataMode: "delayed",
    liveMarketDataAvailable: false,
    ...overrides,
  };
}

const baseOrder: PlaceOrderInput = {
  accountId: "DU1234567",
  mode: "paper",
  symbol: "SPY",
  assetClass: "equity",
  side: "buy",
  type: "limit",
  quantity: 1,
  limitPrice: 500,
  stopPrice: null,
  timeInForce: "day",
  optionContract: null,
};

function orderSnapshot(): BrokerOrderSnapshot {
  return {
    id: "order-1",
    accountId: "DU1234567",
    mode: "paper",
    symbol: "SPY",
    assetClass: "equity",
    side: "buy",
    type: "limit",
    timeInForce: "day",
    status: "submitted",
    quantity: 1,
    filledQuantity: 0,
    limitPrice: 500,
    stopPrice: null,
    placedAt: new Date(),
    updatedAt: new Date(),
    optionContract: null,
  };
}

function assertGatewayUnavailable(error: unknown, reason: string) {
  assert.ok(error instanceof HttpError);
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, "ibkr_gateway_trading_unavailable");
  assert.equal(error.detail, reason);
}

test("normalized order request schema preserves the live confirmation flag", () => {
  const parsed = PlaceOrderBody.parse({
    ...baseOrder,
    mode: "live",
    confirm: true,
  });

  assert.equal(parsed.confirm, true);
});

test("live order mutations require explicit confirmation before gateway checks", async () => {
  const assertConfirmationRequired = (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, "ibkr_live_order_confirmation_required");
    assert.match(error.message, /confirm=true/);
    return true;
  };

  await assert.rejects(
    () => placeOrder({ ...baseOrder, mode: "live", confirm: false }),
    assertConfirmationRequired,
  );
  await assert.rejects(
    () =>
      submitRawOrders({
        accountId: "DU1234567",
        mode: "live",
        confirm: false,
        ibkrOrders: [{ orderType: "LMT" }],
      }),
    assertConfirmationRequired,
  );
  await assert.rejects(
    () =>
      replaceOrder({
        accountId: "DU1234567",
        orderId: "order-1",
        mode: "live",
        confirm: false,
        order: {},
      }),
    assertConfirmationRequired,
  );
});

test.afterEach(() => {
  __setIbkrBridgeClientFactoryForTests(null);
  __resetBridgeGovernorForTests();
  clearIbkrBridgeRuntimeOverride();
  delete process.env["IBKR_GATEWAY_TRADING_HEALTH_TIMEOUT_MS"];
});

test.after(() => {
  clearIbkrBridgeRuntimeOverride();
  if (previousRuntimeOverrideFile === undefined) {
    delete process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"];
  } else {
    process.env["IBKR_BRIDGE_RUNTIME_OVERRIDE_FILE"] =
      previousRuntimeOverrideFile;
  }
});

test("Gateway disconnected blocks live order mutations but still allows live preview", async () => {
  configureIbkr();
  const calls: string[] = [];
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => {
          calls.push("getHealth");
          return health({
            authenticated: false,
            connected: false,
            selectedAccountId: null,
            accounts: [],
          });
        },
        previewOrder: async () => {
          calls.push("previewOrder");
          return {
            accountId: "DU1234567",
            mode: "paper",
            symbol: "SPY",
            assetClass: "equity",
            resolvedContractId: 0,
            orderPayload: {},
            optionContract: null,
          };
        },
        placeOrder: async () => {
          throw new Error("placeOrder should be blocked before reaching bridge");
        },
        submitRawOrders: async () => {
          throw new Error("submitRawOrders should be blocked before reaching bridge");
        },
        replaceOrder: async () => {
          throw new Error("replaceOrder should be blocked before reaching bridge");
        },
        cancelOrder: async () => {
          throw new Error("cancelOrder should be blocked before reaching bridge");
        },
      }) as unknown as IbkrBridgeClient,
  );

  await assert.rejects(
    () => placeOrder(baseOrder),
    (error) => {
      assertGatewayUnavailable(error, "gateway_socket_disconnected");
      return true;
    },
  );
  await assert.rejects(
    () =>
      submitRawOrders({
        accountId: "DU1234567",
        mode: "paper",
        confirm: true,
        ibkrOrders: [{ orderType: "LMT" }],
      }),
    (error) => {
      assertGatewayUnavailable(error, "gateway_socket_disconnected");
      return true;
    },
  );
  await assert.rejects(
    () =>
      replaceOrder({
        accountId: "DU1234567",
        orderId: "order-1",
        mode: "paper",
        confirm: true,
        order: {},
      }),
    (error) => {
      assertGatewayUnavailable(error, "gateway_socket_disconnected");
      return true;
    },
  );
  await assert.rejects(
    () => cancelOrder({ accountId: "DU1234567", orderId: "order-1", confirm: true }),
    (error) => {
      assertGatewayUnavailable(error, "gateway_socket_disconnected");
      return true;
    },
  );

  await previewOrder(baseOrder);
  assert.equal(calls.filter((call) => call === "previewOrder").length, 1);
});

test("Gateway order readiness does not require live market data or fresh quote streams", async () => {
  configureIbkr();
  const calls: string[] = [];
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () => {
          calls.push("getHealth");
          return health({
            marketDataMode: "delayed",
            liveMarketDataAvailable: false,
            strictReady: false,
            strictReason: "live_market_data_not_configured",
            streamFresh: false,
          });
        },
        placeOrder: async () => {
          calls.push("placeOrder");
          return orderSnapshot();
        },
      }) as unknown as IbkrBridgeClient,
  );

  const order = await placeOrder(baseOrder);

  assert.equal(order.id, "order-1");
  assert.deepEqual(calls, ["getHealth", "placeOrder"]);
});

test("Gateway readiness reports stale health, login, and account failures", async () => {
  configureIbkr();
  for (const [reason, overrides] of [
    ["health_stale", { updatedAt: new Date(Date.now() - 120_000) }],
    ["gateway_login_required", { authenticated: false }],
    ["accounts_unavailable", { accounts: [], selectedAccountId: null }],
  ] as const) {
    __setIbkrBridgeClientFactoryForTests(
      () =>
        ({
          getHealth: async () => health(overrides),
        }) as unknown as IbkrBridgeClient,
    );
    await assert.rejects(
      () => assertIbkrGatewayTradingAvailable(),
      (error) => {
        assertGatewayUnavailable(error, reason);
        return true;
      },
    );
    __resetBridgeGovernorForTests();
  }
});

test("Gateway disconnected blocks shadow preview and fill before ledger work", async () => {
  configureIbkr();
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        getHealth: async () =>
          health({
            authenticated: false,
            connected: false,
            selectedAccountId: null,
            accounts: [],
          }),
      }) as unknown as IbkrBridgeClient,
  );

  await assert.rejects(
    () => previewShadowOrder(baseOrder),
    (error) => {
      assertGatewayUnavailable(error, "gateway_socket_disconnected");
      return true;
    },
  );
  await assert.rejects(
    () => placeShadowOrder(baseOrder),
    (error) => {
      assertGatewayUnavailable(error, "gateway_socket_disconnected");
      return true;
    },
  );
});
