import assert from "node:assert/strict";
import test from "node:test";
import { resolveAlgoGatewayReadiness } from "./algo-gateway";

test("algo Gateway readiness requires a configured, connected, authenticated Gateway", () => {
  assert.equal(
    resolveAlgoGatewayReadiness({ configured: false }).reason,
    "ibkr_not_configured",
  );
  assert.equal(
    resolveAlgoGatewayReadiness({ configured: true, healthFresh: false }).reason,
    "bridge_health_unavailable",
  );
  assert.equal(
    resolveAlgoGatewayReadiness({
      configured: true,
      healthFresh: true,
      connected: false,
    }).reason,
    "gateway_socket_disconnected",
  );
  assert.equal(
    resolveAlgoGatewayReadiness({
      configured: true,
      healthFresh: true,
      connected: true,
      authenticated: false,
    }).reason,
    "gateway_login_required",
  );
  assert.equal(
    resolveAlgoGatewayReadiness({
      configured: true,
      healthFresh: true,
      connected: true,
      authenticated: true,
      accountsLoaded: false,
    }).reason,
    "accounts_unavailable",
  );
  assert.equal(
    resolveAlgoGatewayReadiness({
      configured: true,
      healthFresh: true,
      connected: true,
      authenticated: true,
      accountsLoaded: true,
      configuredLiveMarketDataMode: false,
    }).reason,
    "live_market_data_not_configured",
  );
});

test("algo Gateway readiness accepts the live-data configured state", () => {
  const readiness = resolveAlgoGatewayReadiness({
    configured: true,
    healthFresh: true,
    connected: true,
    authenticated: true,
    accountsLoaded: true,
    configuredLiveMarketDataMode: true,
  });

  assert.equal(readiness.ready, true);
  assert.equal(readiness.reason, null);
});
