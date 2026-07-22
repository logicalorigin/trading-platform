import assert from "node:assert/strict";
import test from "node:test";

import {
  isClientPortalTradingReady,
  resolveClientPortalTradingReadiness,
} from "./clientPortalRuntimeModel.js";

const realAccount = {
  status: "connected",
  gatewayRunning: true,
  authenticated: true,
  established: true,
  isPaper: false,
  selectedAccountId: "U1234567",
  accounts: ["U1234567"],
  executionTargets: [
    {
      accountId: "U1234567",
      maskedAccountId: "••••4567",
      selected: true,
    },
  ],
};

test("Client Portal trading readiness requires explicit real-account proof", () => {
  assert.equal(isClientPortalTradingReady(realAccount), true);
  assert.equal(
    resolveClientPortalTradingReadiness(realAccount).ready,
    true,
  );
  assert.equal(
    isClientPortalTradingReady({ ...realAccount, isPaper: true }),
    false,
  );
  assert.equal(
    isClientPortalTradingReady({ ...realAccount, isPaper: null }),
    false,
  );
});
