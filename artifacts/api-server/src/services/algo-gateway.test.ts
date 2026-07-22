import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { resolveAlgoTargetDispatchReadiness } from "./algo-gateway";

// 2026-06-08 is a Monday. 15:00Z = 11:00 ET (regular trading hours).
const DURING_RTH = new Date("2026-06-08T15:00:00.000Z");
// 23:30Z = 19:30 ET (after the 16:00 ET close, still a trading day).
const AFTER_CLOSE = new Date("2026-06-08T23:30:00.000Z");

test("provider-target option execution is session-gated without inheriting IBKR readiness", () => {
  const duringSession = resolveAlgoTargetDispatchReadiness(DURING_RTH);
  assert.equal(duringSession.ready, true);
  assert.equal(duringSession.reason, null);
  assert.equal(duringSession.diagnostics.executionPath, "provider_targets");
  assert.doesNotMatch(duringSession.message, /IBKR|Client Portal/i);

  const afterClose = resolveAlgoTargetDispatchReadiness(AFTER_CLOSE);
  assert.equal(afterClose.ready, false);
  assert.equal(afterClose.reason, "market_session_quiet");
});

test("the generic Algo readiness layer contains no retired IBKR bridge gate", () => {
  const gatewaySource = readFileSync(
    new URL("./algo-gateway.ts", import.meta.url),
    "utf8",
  );
  const platformSource = readFileSync(
    new URL("./platform.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(gatewaySource, /IBKR|Client Portal/u);
  assert.doesNotMatch(gatewaySource, /resolveAlgoGatewayReadiness/u);
  assert.doesNotMatch(gatewaySource, /assertAlgoGatewayReady/u);
  assert.doesNotMatch(platformSource, /getAlgoGatewayReadinessSignals/u);
});
