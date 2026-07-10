import assert from "node:assert/strict";
import test from "node:test";

import {
  formatIbkrPortalStatus,
  isTerminalIbkrPortalConnectStatus,
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
