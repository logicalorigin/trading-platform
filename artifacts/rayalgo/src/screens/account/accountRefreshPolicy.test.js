import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAccountRefreshPolicy } from "./accountRefreshPolicy.js";

test("disables broker account polling while account and order streams are fresh", () => {
  const policy = buildAccountRefreshPolicy({
    isVisible: true,
    accountStreamFresh: true,
    orderStreamFresh: true,
  });

  assert.equal(policy.primary, false);
  assert.equal(policy.secondary, false);
  assert.equal(policy.trades, 60_000);
  assert.equal(policy.streamBacked, true);
});

test("uses fallback broker account polling when either realtime stream is stale", () => {
  const policy = buildAccountRefreshPolicy({
    isVisible: true,
    accountStreamFresh: true,
    orderStreamFresh: false,
  });

  assert.equal(policy.primary, 10_000);
  assert.equal(policy.secondary, 30_000);
  assert.equal(policy.streamBacked, false);
});

test("disables all account polling while hidden", () => {
  const policy = buildAccountRefreshPolicy({
    isVisible: false,
    accountStreamFresh: false,
    orderStreamFresh: false,
  });

  assert.equal(policy.primary, false);
  assert.equal(policy.secondary, false);
  assert.equal(policy.trades, false);
  assert.equal(policy.chart, false);
  assert.equal(policy.health, false);
});
