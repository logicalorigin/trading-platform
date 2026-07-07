import assert from "node:assert/strict";
import test from "node:test";

import {
  isSchwabReauthRequired,
  schwabConnectActionLabel,
} from "./schwabConnectModel.js";

test("isSchwabReauthRequired accepts backend reauth state and legacy user blockers", () => {
  assert.equal(
    isSchwabReauthRequired({
      status: "reauth_required",
      reauthRequired: { required: true, reason: "refresh_expired_or_revoked" },
      user: { status: "connected", nextAction: "sync_accounts", executionBlockers: [] },
    }),
    true,
  );
  assert.equal(
    isSchwabReauthRequired({
      status: "research_required",
      reauthRequired: { required: false, reason: null },
      user: {
        status: "connected",
        nextAction: "reconnect",
        executionBlockers: ["broker_reauth"],
      },
    }),
    true,
  );
  assert.equal(
    isSchwabReauthRequired({
      status: "research_required",
      user: { status: "connected", nextAction: "sync_accounts", executionBlockers: [] },
    }),
    false,
  );
});

test("schwabConnectActionLabel uses explicit reconnect CTA for reauth", () => {
  assert.equal(
    schwabConnectActionLabel({ connected: true, reauthRequired: true }),
    "Reconnect Schwab",
  );
  assert.equal(
    schwabConnectActionLabel({ connected: true, reauthRequired: false }),
    "Reconnect",
  );
  assert.equal(
    schwabConnectActionLabel({ connected: false, reauthRequired: false }),
    "Connect",
  );
});
