import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealAccountUnavailableProblem,
  shouldAdmitAccountRoute,
} from "./account-route-admission";

test("real account routes are blocked when IBKR is unconfigured", () => {
  assert.equal(
    shouldAdmitAccountRoute({ accountId: "U24762790", ibkrConfigured: false }),
    false,
  );
});

test("real account routes are admitted when SnapTrade accounts are present", () => {
  assert.equal(
    shouldAdmitAccountRoute({
      accountId: "U24762790",
      ibkrConfigured: false,
      snapTradeAccountsPresent: true,
    }),
    true,
  );
});

test("shadow account routes remain available when IBKR is unconfigured", () => {
  assert.equal(
    shouldAdmitAccountRoute({ accountId: "shadow", ibkrConfigured: false }),
    true,
  );
});

test("real account admission problem is explicit and machine readable", () => {
  const problem = buildRealAccountUnavailableProblem();

  assert.equal(problem.status, 503);
  assert.equal(problem.code, "ibkr_not_configured");
});
