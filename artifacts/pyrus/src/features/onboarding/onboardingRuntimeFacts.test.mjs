import assert from "node:assert/strict";
import test from "node:test";

import { deriveConnectAccountReadiness } from "./onboardingRuntimeFacts.ts";

const account = (overrides = {}) => ({
  id: "account-1",
  providerAccountId: "provider-account-1",
  provider: "snaptrade",
  mode: "live",
  displayName: "Individual",
  accountType: "equity",
  includedInTrading: false,
  connectionVerified: false,
  executionReady: false,
  executionBlockers: [],
  updatedAt: "2026-07-18T00:00:00.000Z",
  ...overrides,
});

test("connect completion requires a server-verified account connection", () => {
  assert.equal(
    deriveConnectAccountReadiness({
      accounts: [
        account({
          includedInTrading: true,
          executionReady: true,
        }),
      ],
    }).satisfied,
    false,
  );
  assert.equal(
    deriveConnectAccountReadiness({
      accounts: [
        account({
          connectionVerified: true,
          executionReady: false,
        }),
      ],
    }).satisfied,
    true,
  );
});

test("connect readiness reports only server-provided blocker codes", () => {
  const readiness = deriveConnectAccountReadiness({
    accounts: [
      account({
        includedInTrading: true,
        executionBlockers: [
          "snaptrade.connection.read_only",
          "broker.execution_unavailable",
          "snaptrade.connection.read_only",
        ],
      }),
    ],
  });

  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.includedAccountCount, 1);
  assert.equal(readiness.verifiedAccountCount, 0);
  assert.deepEqual(readiness.blockerCodes, [
    "snaptrade.connection.read_only",
    "broker.execution_unavailable",
  ]);
});

test("connect readiness distinguishes an empty account list", () => {
  assert.deepEqual(deriveConnectAccountReadiness(undefined), {
    status: "empty",
    satisfied: false,
    accountCount: 0,
    includedAccountCount: 0,
    verifiedAccountCount: 0,
    blockerCodes: [],
  });
});
