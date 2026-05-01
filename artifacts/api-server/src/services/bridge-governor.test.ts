import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../lib/errors";
import {
  __resetBridgeGovernorForTests,
  getBridgeGovernorSnapshot,
  isBridgeWorkBackedOff,
  runBridgeWork,
} from "./bridge-governor";

test.afterEach(() => {
  __resetBridgeGovernorForTests();
  delete process.env["IBKR_BRIDGE_GOVERNOR_OPTIONS_CONCURRENCY"];
  delete process.env["IBKR_BRIDGE_GOVERNOR_OPTIONS_BACKOFF_MS"];
  delete process.env["IBKR_BRIDGE_GOVERNOR_OPTIONS_FAILURE_THRESHOLD"];
  delete process.env["IBKR_BRIDGE_GOVERNOR_ACCOUNT_BACKOFF_MS"];
  delete process.env["IBKR_BRIDGE_GOVERNOR_ACCOUNT_FAILURE_THRESHOLD"];
  delete process.env["IBKR_BRIDGE_GOVERNOR_ORDERS_BACKOFF_MS"];
  delete process.env["IBKR_BRIDGE_GOVERNOR_ORDERS_FAILURE_THRESHOLD"];
});

test("bridge governor caps concurrent work by category", async () => {
  process.env["IBKR_BRIDGE_GOVERNOR_OPTIONS_CONCURRENCY"] = "1";
  let active = 0;
  let maxActive = 0;

  await Promise.all(
    [1, 2, 3].map((value) =>
      runBridgeWork("options", async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return value;
      }),
    ),
  );

  assert.equal(maxActive, 1);
});

test("bridge governor opens a category circuit after transient failures", async () => {
  process.env["IBKR_BRIDGE_GOVERNOR_OPTIONS_FAILURE_THRESHOLD"] = "1";
  process.env["IBKR_BRIDGE_GOVERNOR_OPTIONS_BACKOFF_MS"] = "1000";

  await assert.rejects(
    runBridgeWork("options", async () => {
      throw new HttpError(504, "timeout", {
        code: "ibkr_bridge_request_timeout",
      });
    }),
  );

  assert.equal(isBridgeWorkBackedOff("options"), true);
  assert.ok(getBridgeGovernorSnapshot().options.backoffRemainingMs > 0);
});

test("bridge governor backs off order reads after one timeout", async () => {
  process.env["IBKR_BRIDGE_GOVERNOR_ORDERS_FAILURE_THRESHOLD"] = "1";
  process.env["IBKR_BRIDGE_GOVERNOR_ORDERS_BACKOFF_MS"] = "1000";

  await assert.rejects(
    runBridgeWork("orders", async () => {
      throw new HttpError(504, "timeout", {
        code: "orders_timeout",
      });
    }),
  );

  assert.equal(isBridgeWorkBackedOff("orders"), true);
  assert.ok(getBridgeGovernorSnapshot().orders.backoffRemainingMs > 0);
});

test("bridge governor treats account queue saturation as transient", async () => {
  process.env["IBKR_BRIDGE_GOVERNOR_ACCOUNT_FAILURE_THRESHOLD"] = "1";
  process.env["IBKR_BRIDGE_GOVERNOR_ACCOUNT_BACKOFF_MS"] = "1000";

  await assert.rejects(
    runBridgeWork("account", async () => {
      throw new HttpError(429, "too many requests", {
        code: "upstream_http_error",
      });
    }),
  );

  assert.equal(isBridgeWorkBackedOff("account"), true);
  assert.ok(getBridgeGovernorSnapshot().account.backoffRemainingMs > 0);
});

test("bridge governor prevents queued work from starting after a circuit opens", async () => {
  process.env["IBKR_BRIDGE_GOVERNOR_OPTIONS_CONCURRENCY"] = "1";
  process.env["IBKR_BRIDGE_GOVERNOR_OPTIONS_FAILURE_THRESHOLD"] = "1";
  process.env["IBKR_BRIDGE_GOVERNOR_OPTIONS_BACKOFF_MS"] = "1000";

  let secondStarted = false;
  const first = runBridgeWork("options", async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    throw new HttpError(504, "timeout", {
      code: "ibkr_bridge_request_timeout",
    });
  });
  const second = runBridgeWork("options", async () => {
    secondStarted = true;
    return "unexpected";
  });

  const results = await Promise.allSettled([first, second]);

  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "rejected");
  assert.equal(secondStarted, false);
});
