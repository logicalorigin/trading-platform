import assert from "node:assert/strict";
import test from "node:test";
import {
  __setIbkrBridgeClientFactoryForTests,
  listOrdersWithResilience,
} from "./platform";
import { __resetBridgeGovernorForTests, runBridgeWork } from "./bridge-governor";
import {
  __resetBridgeOrderReadSuppressionForTests,
  getBridgeOrderReadSuppression,
  markBridgeOrderReadsSuppressed,
} from "./bridge-order-read-state";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";
process.env["DIAGNOSTICS_SUPPRESS_DB_WARNINGS"] = "1";

const originalOrderReadSuppressionProbeMs =
  process.env["IBKR_ORDER_READ_SUPPRESSION_PROBE_MS"];

test.afterEach(() => {
  __setIbkrBridgeClientFactoryForTests(null);
  __resetBridgeGovernorForTests();
  __resetBridgeOrderReadSuppressionForTests();
  delete process.env["IBKR_ORDER_READ_TIMEOUT_MS"];
  if (originalOrderReadSuppressionProbeMs === undefined) {
    delete process.env["IBKR_ORDER_READ_SUPPRESSION_PROBE_MS"];
  } else {
    process.env["IBKR_ORDER_READ_SUPPRESSION_PROBE_MS"] =
      originalOrderReadSuppressionProbeMs;
  }
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

test("listOrdersWithResilience marks timeout suppression and later probes it clear", async () => {
  process.env["IBKR_ORDER_READ_TIMEOUT_MS"] = "5";
  let readCount = 0;
  let hangReads = true;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        listOrdersWithMeta: async () => {
          readCount += 1;
          if (hangReads) {
            return new Promise(() => {});
          }
          return {
            orders: [{ id: "order-1", symbol: "AAPL" }],
          };
        },
      }) as never,
  );

  const first = await listOrdersWithResilience({ accountId: "U1", mode: "live" });
  const suppression = getBridgeOrderReadSuppression();
  hangReads = false;
  const second = await listOrdersWithResilience({ accountId: "U1", mode: "live" });
  process.env["IBKR_ORDER_READ_SUPPRESSION_PROBE_MS"] = "1";
  await new Promise((resolve) => setTimeout(resolve, 2));
  const third = await listOrdersWithResilience({ accountId: "U1", mode: "live" });

  assert.equal(readCount, 2);
  assert.equal(first.reason, "orders_timeout");
  assert.equal(suppression?.reason, "orders_timeout");
  assert.equal(second.reason, "orders_timeout");
  assert.equal(second.stale, true);
  assert.equal(third.degraded, undefined);
  assert.equal(third.orders.length, 1);
  assert.equal(getBridgeOrderReadSuppression(), null);
});

test("listOrdersWithResilience probes timeout suppression and clears it on success", async () => {
  process.env["IBKR_ORDER_READ_SUPPRESSION_PROBE_MS"] = "1";
  markBridgeOrderReadsSuppressed({
    reason: "orders_timeout",
    message: "Open-orders snapshots are paused after a timeout.",
    ttlMs: 60_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 2));

  let readCount = 0;
  __setIbkrBridgeClientFactoryForTests(
    () =>
      ({
        listOrdersWithMeta: async () => {
          readCount += 1;
          return {
            orders: [{ id: "order-1", symbol: "AAPL" }],
          };
        },
      }) as never,
  );

  const result = await listOrdersWithResilience({ accountId: "U1", mode: "live" });
  const second = await listOrdersWithResilience({ accountId: "U1", mode: "live" });

  assert.equal(readCount, 2);
  assert.equal(result.degraded, undefined);
  assert.equal(result.orders.length, 1);
  assert.equal(getBridgeOrderReadSuppression(), null);
  assert.equal(second.degraded, undefined);
  assert.equal(second.orders.length, 1);
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
