import assert from "node:assert/strict";
import test from "node:test";

import { IBKR_PORTAL_LOGIN_TIMEOUT_MS } from "./ibkrPortalConnectModel.js";

test("the UI waits beyond the backend's final six-minute login check", () => {
  assert.equal(IBKR_PORTAL_LOGIN_TIMEOUT_MS, 6 * 60_000 + 30_000);
});
