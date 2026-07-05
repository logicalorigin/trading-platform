import assert from "node:assert/strict";
import test from "node:test";

import {
  SNAPTRADE_BROKER_CHOICES,
  buildSnapTradeBrokerChoices,
  buildSnapTradeConnectionPortalBody,
  canManageSnapTradeConnections,
} from "./snapTradeConnectModel.js";

test("SnapTrade broker choices prioritize IBKR first and E*TRADE fallback", () => {
  assert.deepEqual(
    SNAPTRADE_BROKER_CHOICES.map((choice) => choice.value),
    ["INTERACTIVE-BROKERS-FLEX", "ETRADE", "ALPACA-PAPER"],
  );
});

test("SnapTrade portal body defaults to trade-if-available and omits empty broker", () => {
  assert.deepEqual(buildSnapTradeConnectionPortalBody(""), {
    connectionType: "trade-if-available",
    showCloseButton: true,
  });
});

test("SnapTrade portal body includes selected broker slug", () => {
  assert.deepEqual(buildSnapTradeConnectionPortalBody("ETRADE"), {
    broker: "ETRADE",
    connectionType: "trade-if-available",
    showCloseButton: true,
  });
});

test("SnapTrade broker choices from the live list keep only trade-capable brokerages", () => {
  const choices = buildSnapTradeBrokerChoices([
    {
      slug: "ETRADE",
      displayName: "E*Trade",
      allowsTrading: true,
      enabled: true,
      maintenanceMode: false,
      isDegraded: false,
      logoUrl: "https://logos.test/etrade.png",
      squareLogoUrl: "https://logos.test/etrade-square.jpg",
    },
    {
      slug: "INTERACTIVE-BROKERS-FLEX",
      displayName: "Interactive Brokers",
      allowsTrading: false,
      enabled: true,
    },
    {
      slug: "WEBULL",
      displayName: "Webull",
      allowsTrading: true,
      enabled: true,
      maintenanceMode: true,
      isDegraded: false,
      squareLogoUrl: null,
      logoUrl: "https://logos.test/webull.png",
    },
    { slug: "DISABLED", displayName: "Disabled", allowsTrading: true, enabled: false },
    { displayName: "No slug", allowsTrading: true, enabled: true },
  ]);

  assert.deepEqual(
    choices.map((choice) => choice.value),
    ["ETRADE", "WEBULL"],
  );
  assert.deepEqual(choices[0], {
    value: "ETRADE",
    label: "E*Trade",
    detail: "Live trading",
    logoUrl: "https://logos.test/etrade-square.jpg",
    impaired: false,
  });
  assert.deepEqual(choices[1], {
    value: "WEBULL",
    label: "Webull",
    detail: "Under maintenance",
    logoUrl: "https://logos.test/webull.png",
    impaired: true,
  });
});

test("SnapTrade broker choices fall back to the static defaults without live data", () => {
  assert.deepEqual(buildSnapTradeBrokerChoices(undefined), SNAPTRADE_BROKER_CHOICES);
  assert.deepEqual(buildSnapTradeBrokerChoices([]), SNAPTRADE_BROKER_CHOICES);
  assert.deepEqual(
    buildSnapTradeBrokerChoices([
      { slug: "READ-ONLY", displayName: "Read Only", allowsTrading: false, enabled: true },
    ]),
    SNAPTRADE_BROKER_CHOICES,
  );
});

test("SnapTrade setup is admin-gated for the interim rollout", () => {
  assert.equal(canManageSnapTradeConnections({ role: "admin" }), true);
  assert.equal(canManageSnapTradeConnections({ role: "user" }), false);
  assert.equal(canManageSnapTradeConnections(null), false);
});
