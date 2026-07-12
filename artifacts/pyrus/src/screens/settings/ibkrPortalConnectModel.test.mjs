import assert from "node:assert/strict";
import test from "node:test";

import {
  IBKR_PORTAL_LOGIN_TIMEOUT_MS,
  formatIbkrPortalStatus,
  hasIbkrPortalLoginTimedOut,
  isTerminalIbkrPortalConnectStatus,
  restoreIbkrPortalFocus,
} from "./ibkrPortalConnectModel.js";

test("IBKR portal model recognizes terminal hosted-login failures", () => {
  assert.equal(formatIbkrPortalStatus("disconnected"), "not connected");
  assert.equal(
    isTerminalIbkrPortalConnectStatus({
      status: "disconnected",
      gatewayRunning: false,
    }),
    true,
  );
  assert.equal(
    isTerminalIbkrPortalConnectStatus({
      status: "needs_login",
      gatewayRunning: true,
    }),
    false,
  );
});

test("IBKR portal timeout preserves the post-login finalization grace", () => {
  const startedAt = 1_000;

  assert.equal(IBKR_PORTAL_LOGIN_TIMEOUT_MS, 5 * 60_000 + 30_000);
  assert.equal(
    hasIbkrPortalLoginTimedOut(
      startedAt,
      startedAt + IBKR_PORTAL_LOGIN_TIMEOUT_MS,
    ),
    false,
  );
  assert.equal(
    hasIbkrPortalLoginTimedOut(
      startedAt,
      startedAt + IBKR_PORTAL_LOGIN_TIMEOUT_MS + 1,
    ),
    true,
  );
});

test("IBKR portal focus returns only to a stable mounted target", () => {
  let focusCalls = 0;
  const target = {
    isConnected: true,
    focus() {
      focusCalls += 1;
    },
  };

  assert.equal(restoreIbkrPortalFocus(target), true);
  assert.equal(focusCalls, 1);
  assert.equal(
    restoreIbkrPortalFocus({
      isConnected: false,
      focus() {
        focusCalls += 1;
      },
    }),
    false,
  );
  assert.equal(restoreIbkrPortalFocus(null), false);
  assert.equal(focusCalls, 1);
});
