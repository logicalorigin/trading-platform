import assert from "node:assert/strict";
import test from "node:test";

import {
  isClientPortalTradingReady,
  resolveClientPortalTradingReadiness,
} from "./clientPortalRuntimeModel.js";

const ready = {
  status: "connected",
  gatewayRunning: true,
  authenticated: true,
  established: true,
  isPaper: false,
  selectedAccountId: "DU1234567",
  accounts: ["DU1234567"],
  executionTargets: [
    {
      accountId: "DU1234567",
      maskedAccountId: "••••4567",
      selected: true,
    },
  ],
};

test("Client Portal readiness requires connected authenticated real-account proof", () => {
  assert.equal(isClientPortalTradingReady(ready), true);
  assert.equal(isClientPortalTradingReady({ ...ready, isPaper: true }), false);
  assert.equal(
    isClientPortalTradingReady({ ...ready, established: false }),
    false,
  );
});

test("Client Portal trading readiness fails closed without a verified target", () => {
  const result = resolveClientPortalTradingReadiness({
    ...ready,
    selectedAccountId: null,
    accounts: [],
    executionTargets: [],
  });

  assert.equal(result.ready, false);
  assert.equal(result.reason, "ibkr_client_portal_account_unavailable");
});
