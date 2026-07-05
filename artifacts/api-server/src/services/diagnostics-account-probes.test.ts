import assert from "node:assert/strict";
import test from "node:test";

import {
  diagnosticsPositionProbeForTarget,
  selectDiagnosticsAccountProbeTarget,
} from "./diagnostics-account-probes";

test("selectDiagnosticsAccountProbeTarget prefers SnapTrade accounts over stale legacy accounts", () => {
  const target = selectDiagnosticsAccountProbeTarget([
    {
      id: "U123",
      providerAccountId: "U123",
      provider: "ibkr",
      displayName: "IBKR U123",
    },
    {
      id: "local-snaptrade-account",
      providerAccountId: "snaptrade-account-id",
      provider: "snaptrade",
      displayName: "E*Trade Growth",
    },
  ]);

  assert.equal(target.accountId, "snaptrade-account-id");
  assert.equal(target.provider, "snaptrade");
  assert.equal(target.displayName, "E*Trade Growth");
  assert.equal(target.accountCount, 2);
  assert.equal(target.snapTradeAccountCount, 1);
  assert.equal(target.positionProbeProvider, "snaptrade");
});

test("diagnosticsPositionProbeForTarget skips the legacy position bridge when SnapTrade accounts are observed", () => {
  const probe = diagnosticsPositionProbeForTarget({
    accountId: "snaptrade-account-id",
    provider: "snaptrade",
    displayName: "E*Trade Growth",
    accountCount: 2,
    snapTradeAccountCount: 1,
    positionProbeProvider: "snaptrade",
  });

  assert.deepEqual(probe, {
    ok: true,
    count: 0,
    provider: "snaptrade",
    accountId: "snaptrade-account-id",
    accountCount: 1,
    source: "diagnostics-collector",
    skippedLegacyBridgeProbe: true,
    reason: "snaptrade_accounts_observed",
  });
});

test("selectDiagnosticsAccountProbeTarget preserves legacy probing when no SnapTrade accounts exist", () => {
  const target = selectDiagnosticsAccountProbeTarget([
    {
      id: "U123",
      providerAccountId: "U123",
      provider: "ibkr",
    },
  ]);

  assert.equal(target.accountId, "U123");
  assert.equal(target.provider, "ibkr");
  assert.equal(target.snapTradeAccountCount, 0);
  assert.equal(target.positionProbeProvider, "legacy");
});
