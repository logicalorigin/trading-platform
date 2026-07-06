import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedSession } from "./auth";
import {
  ENTITLEMENTS,
  defaultEntitlementsForPlan,
  isIbkrMemberConnectEnabled,
  normalizeEntitlements,
  sessionHasEntitlement,
} from "./entitlements";

function sessionWith(role: string, entitlements: string[]): AuthenticatedSession {
  return {
    id: "session-1",
    user: {
      id: "user-1",
      email: "u@example.com",
      displayName: null,
      role,
      entitlements,
    },
    csrfTokenHash: "hash",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  };
}

test("sessionHasEntitlement: admins bypass every entitlement", () => {
  const admin = sessionWith("admin", []);
  assert.equal(sessionHasEntitlement(admin, ENTITLEMENTS.BROKER_CONNECT), true);
  assert.equal(sessionHasEntitlement(admin, ENTITLEMENTS.IBKR_ACCESS), true);
});

test("sessionHasEntitlement: members are gated on the explicit key", () => {
  const member = sessionWith("member", [ENTITLEMENTS.BROKER_CONNECT]);
  assert.equal(sessionHasEntitlement(member, ENTITLEMENTS.BROKER_CONNECT), true);
  assert.equal(sessionHasEntitlement(member, ENTITLEMENTS.IBKR_ACCESS), false);

  const plain = sessionWith("member", []);
  assert.equal(sessionHasEntitlement(plain, ENTITLEMENTS.BROKER_CONNECT), false);
});

test("normalizeEntitlements: guards, trims, dedupes, drops non-strings", () => {
  assert.deepEqual(
    normalizeEntitlements([
      "broker_connect",
      " broker_connect ",
      "",
      5,
      null,
      "ibkr_access",
    ]),
    ["broker_connect", "ibkr_access"],
  );
  assert.deepEqual(normalizeEntitlements("broker_connect"), []);
  assert.deepEqual(normalizeEntitlements(undefined), []);
});

test("defaultEntitlementsForPlan: known paid plans grant broker_connect only", () => {
  for (const plan of ["pro", "Premium", " plus ", "PAID"]) {
    assert.deepEqual(defaultEntitlementsForPlan(plan), [
      ENTITLEMENTS.BROKER_CONNECT,
    ]);
  }
  assert.deepEqual(defaultEntitlementsForPlan("free"), []);
  assert.deepEqual(defaultEntitlementsForPlan(null), []);
  // Compliance: a plan can never grant ibkr_access.
  assert.equal(
    defaultEntitlementsForPlan("pro").includes(ENTITLEMENTS.IBKR_ACCESS),
    false,
  );
});

test("isIbkrMemberConnectEnabled: only literal 'true' enables", () => {
  const previous = process.env["IBKR_MEMBER_CONNECT_ENABLED"];
  try {
    delete process.env["IBKR_MEMBER_CONNECT_ENABLED"];
    assert.equal(isIbkrMemberConnectEnabled(), false);
    process.env["IBKR_MEMBER_CONNECT_ENABLED"] = "false";
    assert.equal(isIbkrMemberConnectEnabled(), false);
    process.env["IBKR_MEMBER_CONNECT_ENABLED"] = "TRUE";
    assert.equal(isIbkrMemberConnectEnabled(), true);
    process.env["IBKR_MEMBER_CONNECT_ENABLED"] = "true";
    assert.equal(isIbkrMemberConnectEnabled(), true);
  } finally {
    if (previous === undefined) {
      delete process.env["IBKR_MEMBER_CONNECT_ENABLED"];
    } else {
      process.env["IBKR_MEMBER_CONNECT_ENABLED"] = previous;
    }
  }
});
