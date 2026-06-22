import assert from "node:assert/strict";
import test from "node:test";

import { isPersistableQueryKey } from "./queryPersistence.ts";

// Run: npx tsx --test src/app/queryPersistence.test.mjs

test("persists the allowlisted reference/structural query keys", () => {
  for (const path of [
    "/api/session",
    "/api/watchlists",
    "/api/accounts",
    "/api/signal-monitor/profile",
    "/api/universe/tickers",
    "/api/algo/deployments",
    "/api/settings/backend",
    "/api/settings/preferences",
  ]) {
    assert.equal(isPersistableQueryKey([path]), true, `${path} should persist`);
    assert.equal(
      isPersistableQueryKey([path, { active: true, limit: 25 }]),
      true,
      `${path} with params should persist`,
    );
  }
});

test("NEVER persists live market data or account financials (trading-safety boundary)", () => {
  // Account financials live UNDER /api/accounts/${id}/..., so the exact
  // /api/accounts allowlist entry (the account list) must not capture them.
  for (const path of [
    "/api/accounts/acc-1/summary",
    "/api/accounts/acc-1/positions",
    "/api/accounts/acc-1/orders",
    "/api/accounts/acc-1/equity-history",
    "/api/accounts/acc-1/cash-activity",
    "/api/option-quotes",
    "/api/signal-monitor/state",
    "/api/signal-monitor/events",
    "/api/market/flow",
    "/api/diagnostics/runtime",
  ]) {
    assert.equal(
      isPersistableQueryKey([path]),
      false,
      `${path} must NOT be persisted`,
    );
  }
});

test("rejects malformed query keys", () => {
  assert.equal(isPersistableQueryKey([]), false);
  assert.equal(isPersistableQueryKey(undefined), false);
  assert.equal(isPersistableQueryKey(null), false);
  assert.equal(isPersistableQueryKey([{ not: "a string" }]), false);
  assert.equal(isPersistableQueryKey("/api/session"), false);
});
