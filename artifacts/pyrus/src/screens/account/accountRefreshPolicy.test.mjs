import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_REFRESH_INTERVALS,
  buildAccountRefreshPolicy,
} from "./accountRefreshPolicy.js";

test("visible live account keeps live data responsive but slows equity history cadence", () => {
  const policy = buildAccountRefreshPolicy({
    isVisible: true,
    brokerConfigured: true,
    brokerAuthenticated: true,
  });

  assert.equal(policy.primary, ACCOUNT_REFRESH_INTERVALS.primaryFallback);
  assert.equal(policy.secondary, ACCOUNT_REFRESH_INTERVALS.secondaryFallback);
  assert.equal(policy.trades, ACCOUNT_REFRESH_INTERVALS.tradesFallback);
  assert.equal(policy.chart, 300_000);
});

test("visible shadow account uses the same slow equity history cadence", () => {
  const policy = buildAccountRefreshPolicy({
    isVisible: true,
    shadowMode: true,
  });

  assert.equal(policy.primary, ACCOUNT_REFRESH_INTERVALS.shadowPrimaryFallback);
  assert.equal(policy.secondary, ACCOUNT_REFRESH_INTERVALS.shadowSecondaryFallback);
  assert.equal(policy.trades, ACCOUNT_REFRESH_INTERVALS.shadowTradesFallback);
  assert.equal(policy.chart, 300_000);
});
