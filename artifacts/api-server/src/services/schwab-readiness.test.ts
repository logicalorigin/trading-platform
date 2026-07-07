import assert from "node:assert/strict";
import test from "node:test";

import { readSchwabReadiness } from "./schwab-readiness";
import type { SchwabUserReadiness } from "./schwab-user-custody";

const TEST_ENV = {
  PYRUS_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString("base64url"),
  SCHWAB_APP_KEY: "app-key-abc",
  SCHWAB_APP_SECRET: "app-secret-xyz",
  SCHWAB_OAUTH_REDIRECT_BASE_URL: "https://pyrus.example",
};

const CONNECTED_USER: SchwabUserReadiness = {
  connected: true,
  status: "connected",
  refreshTokenStored: true,
  connectedAt: "2026-07-02T18:00:00.000Z",
  refreshTokenExpiresAt: "2026-07-09T18:00:00.000Z",
  disabledAt: null,
  nextAction: "sync_accounts",
  executionBlockers: [],
};

test("readSchwabReadiness reports configured research_required without user reauth", async () => {
  const readiness = await readSchwabReadiness({
    env: TEST_ENV,
    now: new Date("2026-07-02T18:00:00.000Z"),
    userReadiness: CONNECTED_USER,
  });

  assert.equal(readiness.configured, true);
  assert.equal(readiness.status, "research_required");
  assert.deepEqual(readiness.reauthRequired, {
    required: false,
    reason: null,
  });
  assert.ok(!readiness.limitations.includes("schwab.broker_reauth_required"));
});

test("readSchwabReadiness maps broker_reauth to reauth_required with reason", async () => {
  const readiness = await readSchwabReadiness({
    env: TEST_ENV,
    now: new Date("2026-07-02T18:00:00.000Z"),
    userReadiness: {
      ...CONNECTED_USER,
      connected: false,
      status: "expired",
      nextAction: "reconnect",
      refreshTokenExpiresAt: "2026-07-02T18:00:00.000Z",
      executionBlockers: ["broker_reauth"],
    },
  });

  assert.equal(readiness.configured, true);
  assert.equal(readiness.status, "reauth_required");
  assert.deepEqual(readiness.reauthRequired, {
    required: true,
    reason: "refresh_expired_or_revoked",
  });
  assert.equal(readiness.limitations[0], "schwab.broker_reauth_required");
});
