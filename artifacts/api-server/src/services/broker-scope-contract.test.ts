import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOMATION_TRADING_PREFERRED_SCOPES,
  AUTOMATION_TRADING_REQUIRED_SCOPES,
  evaluateAutomationTradingScopeReadiness,
  normalizeBrokerExecutionScopes,
} from "./broker-scope-contract";

test("automation trading scope readiness requires every minimum safe scope", async (t) => {
  for (const missingScope of AUTOMATION_TRADING_REQUIRED_SCOPES) {
    await t.test(`blocks when ${missingScope} is missing`, () => {
      const scopes = AUTOMATION_TRADING_REQUIRED_SCOPES.filter(
        (scope) => scope !== missingScope,
      );

      const readiness = evaluateAutomationTradingScopeReadiness(scopes);

      assert.equal(readiness.outcome, "blocked");
      assert.equal(readiness.decisionCode, "BROKER_SCOPE_MISSING");
      assert.equal(readiness.automationTradingConnection, false);
      assert.deepEqual(readiness.missingRequiredScopes, [missingScope]);
    });
  }
});

test("automation trading scope readiness allows missing preferred scopes", () => {
  const readiness = evaluateAutomationTradingScopeReadiness(
    AUTOMATION_TRADING_REQUIRED_SCOPES,
  );

  assert.equal(readiness.outcome, "ready");
  assert.equal(readiness.decisionCode, "BROKER_SCOPE_READY");
  assert.equal(readiness.automationTradingConnection, true);
  assert.deepEqual(
    readiness.missingPreferredScopes,
    [...AUTOMATION_TRADING_PREFERRED_SCOPES],
  );
});

test("disabled market data scope is tracked but not required for trading", () => {
  const readiness = evaluateAutomationTradingScopeReadiness([
    ...AUTOMATION_TRADING_REQUIRED_SCOPES,
    "market_data",
  ]);

  assert.equal(readiness.outcome, "ready");
  assert.deepEqual(readiness.disabledRequestedScopes, ["market_data"]);
});

test("scope normalization deduplicates known scopes and reports unknowns", () => {
  const normalized = normalizeBrokerExecutionScopes([
    " order_submit ",
    "order_submit",
    "",
    "unknown_vendor_scope",
  ]);

  assert.deepEqual(normalized.scopes, ["order_submit"]);
  assert.deepEqual(normalized.unknownScopes, ["unknown_vendor_scope"]);
});
