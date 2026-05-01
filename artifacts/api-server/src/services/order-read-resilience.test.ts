import assert from "node:assert/strict";
import test from "node:test";
import {
  __setIbkrBridgeClientFactoryForTests,
  listOrdersWithResilience,
} from "./platform";
import { __resetBridgeGovernorForTests, runBridgeWork } from "./bridge-governor";
import {
  __resetBridgeOrderReadSuppressionForTests,
  markBridgeOrderReadsSuppressed,
} from "./bridge-order-read-state";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

test.afterEach(() => {
  __setIbkrBridgeClientFactoryForTests(null);
  __resetBridgeGovernorForTests();
  __resetBridgeOrderReadSuppressionForTests();
  delete process.env["IBKR_ORDER_READ_TIMEOUT_MS"];
});

test("listOrdersWithResilience skips known bad legacy bridge order endpoint", async () => {
  markBridgeOrderReadsSuppressed({
    reason: "orders_bridge_update_required",
    message: "The running Windows IBKR bridge is an older build.",
    ttlMs: 60_000,
  });
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        listOrdersWithMeta: async () => {
          throw new Error("suppressed order reads should not reach the bridge");
        },
      }) as never,
  );

  const result = await listOrdersWithResilience({ accountId: "U1", mode: "live" });

  assert.deepEqual(result.orders, []);
  assert.equal(result.degraded, true);
  assert.equal(result.reason, "orders_bridge_update_required");
  assert.equal(result.stale, true);
  assert.equal(result.debug?.code, "orders_bridge_update_required");
});

test("listOrdersWithResilience returns degraded metadata when bridge order read hangs", async () => {
  process.env["IBKR_ORDER_READ_TIMEOUT_MS"] = "5";
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        listOrdersWithMeta: () => new Promise(() => {}),
      }) as never,
  );

  const startedAt = Date.now();
  const result = await listOrdersWithResilience({ accountId: "U1", mode: "live" });

  assert.deepEqual(result.orders, []);
  assert.equal(result.degraded, true);
  assert.equal(result.reason, "orders_timeout");
  assert.equal(result.stale, false);
  assert.equal(result.debug?.code, "orders_timeout");
  assert.ok(Date.now() - startedAt < 500);
});

test("listOrdersWithResilience preserves bridge order degradation metadata", async () => {
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        listOrdersWithMeta: async () => ({
          orders: [],
          degraded: true,
          reason: "open_orders_timeout",
          stale: true,
          timeoutMs: 2500,
        }),
      }) as never,
  );

  const result = await listOrdersWithResilience({ accountId: "U1", mode: "live" });

  assert.deepEqual(result.orders, []);
  assert.equal(result.degraded, true);
  assert.equal(result.reason, "open_orders_timeout");
  assert.equal(result.stale, true);
  assert.equal(result.debug?.timeoutMs, 2500);
});

test("listOrdersWithResilience skips queueing when order lane is busy", async () => {
  let releaseActiveRead!: () => void;
  const activeRead = runBridgeWork(
    "orders",
    () => new Promise((resolve) => {
      releaseActiveRead = () => resolve([]);
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));

  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        listOrdersWithMeta: async () => {
          throw new Error("busy reads should not start another bridge request");
        },
      }) as never,
  );

  const result = await listOrdersWithResilience({ accountId: "U1", mode: "live" });
  releaseActiveRead();
  await activeRead;

  assert.deepEqual(result.orders, []);
  assert.equal(result.degraded, true);
  assert.equal(result.reason, "orders_busy");
  assert.equal(result.stale, true);
});
