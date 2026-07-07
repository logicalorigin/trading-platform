import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedSession } from "./auth";
import {
  ENTITLEMENTS,
  defaultEntitlementsForPlan,
  isIbkrMemberConnectEnabled,
  normalizeEntitlements,
  resolveLaunchEntitlements,
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

test("resolveLaunchEntitlements: an EXPLICIT array (incl. empty) is honored verbatim over the plan default", () => {
  // Explicit [] on a paid-plan token = deliberate "zero entitlements"; must NOT
  // be overridden by the plan default (the omitted-vs-empty fix).
  assert.deepEqual(
    resolveLaunchEntitlements({ claim: [], tokenPlan: "pro" }),
    [],
  );
  // Explicit array wins verbatim (trimmed/deduped), no plan merge.
  assert.deepEqual(
    resolveLaunchEntitlements({ claim: ["ibkr_access"], tokenPlan: "pro" }),
    ["ibkr_access"],
  );
});

test("resolveLaunchEntitlements: an ABSENT claim falls back to the effective-plan default", () => {
  // Omitted claim + paid plan -> plan default.
  assert.deepEqual(
    resolveLaunchEntitlements({ claim: undefined, tokenPlan: "pro" }),
    [ENTITLEMENTS.BROKER_CONNECT],
  );
  // Omitted claim + free/no plan -> nothing.
  assert.deepEqual(
    resolveLaunchEntitlements({ claim: undefined, tokenPlan: null }),
    [],
  );
  // Malformed (non-array) claim is treated as absent, not as an explicit grant.
  assert.deepEqual(
    resolveLaunchEntitlements({ claim: "broker_connect", tokenPlan: "pro" }),
    [ENTITLEMENTS.BROKER_CONNECT],
  );
});

test("resolveLaunchEntitlements: bare re-launch derives from the STORED plan (no wipe)", () => {
  // Re-launch token omits plan + entitlements; the stored plan re-grants the
  // default instead of leaving a paid user unentitled.
  assert.deepEqual(
    resolveLaunchEntitlements({
      claim: undefined,
      tokenPlan: null,
      existingPlan: "pro",
    }),
    [ENTITLEMENTS.BROKER_CONNECT],
  );
  // The token's own plan still takes precedence over the stored plan.
  assert.deepEqual(
    resolveLaunchEntitlements({
      claim: undefined,
      tokenPlan: "free",
      existingPlan: "pro",
    }),
    [],
  );
  // Compliance: no plan path ever yields ibkr_access.
  assert.equal(
    resolveLaunchEntitlements({
      claim: undefined,
      tokenPlan: "pro",
      existingPlan: "pro",
    }).includes(ENTITLEMENTS.IBKR_ACCESS),
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
