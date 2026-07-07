import assert from "node:assert/strict";
import test from "node:test";
import {
  US_TAX_JURISDICTIONS,
  buildStateRuleStatus,
  evaluateTaxOrderPreflight,
  fingerprintTaxOrder,
  normalizeTaxProfileConfig,
} from "./tax-planning-model";

test("state rule status fails closed for every US jurisdiction", () => {
  const status = buildStateRuleStatus({ taxYear: 2026, rows: [] });

  assert.equal(status.taxYear, 2026);
  assert.equal(status.jurisdictions.length, US_TAX_JURISDICTIONS.length);
  assert.equal(status.summary.total, 51);
  assert.equal(status.summary.available, 0);
  assert.equal(status.summary.unavailable, 51);
  assert.equal(status.ready, false);
  assert.ok(status.jurisdictions.every((row) => row.status === "unavailable"));
});

test("state rule status requires source verification evidence before ready", () => {
  const rows = US_TAX_JURISDICTIONS.map((jurisdiction) => ({
    jurisdiction,
    taxYear: 2026,
    status: "available" as const,
    version: "2026.1",
    sourceName: "state department",
    sourceUrl: `https://example.test/${jurisdiction}`,
  }));

  const status = buildStateRuleStatus({ taxYear: 2026, rows });

  assert.equal(status.summary.available, 0);
  assert.equal(status.summary.unavailable, US_TAX_JURISDICTIONS.length);
  assert.equal(status.ready, false);
  assert.ok(
    status.jurisdictions.every(
      (row) => row.status === "unavailable" && row.evidenceStatus === "missing_evidence",
    ),
  );
});

test("state rule status is ready only when every jurisdiction is verified", () => {
  const rows = US_TAX_JURISDICTIONS.map((jurisdiction) => ({
    jurisdiction,
    taxYear: 2026,
    status: "available" as const,
    version: "2026.1",
    sourceName: "state department",
    sourceUrl: `https://example.test/${jurisdiction}`,
    checksum: `sha256-${jurisdiction.toLowerCase()}`,
    verifiedAt: "2026-01-15T00:00:00.000Z",
  }));

  const status = buildStateRuleStatus({ taxYear: 2026, rows });

  assert.equal(status.summary.available, US_TAX_JURISDICTIONS.length);
  assert.equal(status.ready, true);
  assert.ok(status.jurisdictions.every((row) => row.evidenceStatus === "verified"));
});

test("preflight hard-blocks obvious same-account opposite-side crossing", () => {
  const profile = normalizeTaxProfileConfig({
    taxYear: 2026,
    stateEstimateMode: "all_states",
  });

  const result = evaluateTaxOrderPreflight({
    profile,
    order: {
      accountId: "acct-1",
      mode: "live",
      symbol: "AAPL",
      assetClass: "equity",
      side: "sell",
      type: "limit",
      quantity: 10,
      limitPrice: 200,
      timeInForce: "day",
    },
    openOrders: [
      {
        accountId: "acct-1",
        mode: "live",
        symbol: "AAPL",
        assetClass: "equity",
        side: "buy",
        quantity: 10,
        type: "limit",
        limitPrice: 200,
        timeInForce: "day",
      },
    ],
  });

  assert.equal(result.action, "block");
  assert.equal(result.selfTradeRisk, "blocked");
  assert.equal(result.washSaleRisk, "unknown");
  assert.ok(result.reasons.includes("same_account_opposite_open_order"));
});

test("preflight does not block opposite option orders for different contracts", () => {
  const profile = normalizeTaxProfileConfig({ taxYear: 2026 });

  const result = evaluateTaxOrderPreflight({
    profile,
    order: {
      accountId: "acct-1",
      mode: "live",
      symbol: "AAPL",
      assetClass: "option",
      side: "sell",
      type: "limit",
      quantity: 1,
      limitPrice: 3,
      timeInForce: "day",
      optionContract: {
        underlying: "AAPL",
        expirationDate: "2026-08-21",
        strike: 210,
        right: "call",
      },
    },
    openOrders: [
      {
        accountId: "acct-1",
        mode: "live",
        symbol: "AAPL",
        assetClass: "option",
        side: "buy",
        quantity: 1,
        type: "limit",
        limitPrice: 2.5,
        timeInForce: "day",
        optionContract: {
          underlying: "AAPL",
          expirationDate: "2026-08-21",
          strike: 220,
          right: "call",
        },
      },
    ],
  });

  assert.equal(result.selfTradeRisk, "none");
  assert.equal(result.action, "warn_ack_required");
  assert.ok(!result.reasons.includes("same_account_opposite_open_order"));
});

test("preflight blocks opposite option orders for the same contract", () => {
  const profile = normalizeTaxProfileConfig({ taxYear: 2026 });
  const optionContract = {
    underlying: "AAPL",
    expirationDate: "2026-08-21",
    strike: 210,
    right: "call",
  };

  const result = evaluateTaxOrderPreflight({
    profile,
    order: {
      accountId: "acct-1",
      mode: "live",
      symbol: "AAPL",
      assetClass: "option",
      side: "sell",
      type: "limit",
      quantity: 1,
      limitPrice: 3,
      timeInForce: "day",
      optionContract,
    },
    openOrders: [
      {
        accountId: "acct-1",
        mode: "live",
        symbol: "AAPL",
        assetClass: "option",
        side: "buy",
        quantity: 1,
        type: "limit",
        limitPrice: 3,
        timeInForce: "day",
        optionContract,
      },
    ],
  });

  assert.equal(result.action, "block");
  assert.equal(result.selfTradeRisk, "blocked");
  assert.ok(result.reasons.includes("same_account_opposite_open_order"));
});

test("option order fingerprint is stable across raw JSON dates and parsed Date objects", () => {
  const baseOrder = {
    accountId: "U123",
    mode: "live" as const,
    symbol: "AAPL",
    assetClass: "option",
    side: "buy",
    type: "limit",
    quantity: 1,
    limitPrice: 2.25,
    timeInForce: "day",
    route: "ibkr",
    intent: "long_option",
  };

  const rawFingerprint = fingerprintTaxOrder({
    ...baseOrder,
    optionContract: {
      ticker: "AAPL",
      underlying: "AAPL",
      expirationDate: "2026-08-21",
      strike: 210,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "123",
    },
  });
  const parsedFingerprint = fingerprintTaxOrder({
    ...baseOrder,
    optionContract: {
      ticker: "AAPL",
      underlying: "AAPL",
      expirationDate: new Date("2026-08-21T00:00:00.000Z"),
      strike: 210,
      right: "C",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: "123",
    },
  });

  assert.equal(parsedFingerprint, rawFingerprint);
});

test("tax order fingerprint ignores provider route for broker-agnostic preflight", () => {
  const baseOrder = {
    accountId: "acct-1",
    mode: "live" as const,
    symbol: "AAPL",
    assetClass: "equity",
    side: "buy",
    type: "limit",
    quantity: 1,
    limitPrice: 210,
    timeInForce: "day",
  };

  assert.equal(
    fingerprintTaxOrder({ ...baseOrder, route: "ibkr" }),
    fingerprintTaxOrder({ ...baseOrder, route: "schwab" }),
  );
});

test("preflight treats sell-side tax uncertainty as acknowledgement warning", () => {
  const profile = normalizeTaxProfileConfig({ taxYear: 2026 });
  const result = evaluateTaxOrderPreflight({
    profile,
    order: {
      accountId: "acct-1",
      mode: "live",
      symbol: "MSFT",
      assetClass: "equity",
      side: "sell",
      type: "market",
      quantity: 5,
      timeInForce: "day",
    },
    openOrders: [],
  });

  assert.equal(result.action, "warn_ack_required");
  assert.equal(result.selfTradeRisk, "none");
  assert.equal(result.washSaleRisk, "unknown");
  assert.deepEqual(result.requiredAcknowledgements, [
    "tax_estimate_visible_accounts_only",
    "wash_sale_basis_not_final",
  ]);
});
