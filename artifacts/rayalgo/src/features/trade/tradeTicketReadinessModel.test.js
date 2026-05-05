import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTradeTicketReadiness,
  formatTicketFreshnessLabel,
  normalizeTicketFreshness,
} from "./tradeTicketReadinessModel.js";

test("trade ticket readiness reports a ready live option route", () => {
  const readiness = buildTradeTicketReadiness({
    accountId: "DU1234567",
    brokerConfigured: true,
    cp: "C",
    dte: 10,
    environment: "paper",
    expirationLabel: "2026-05-15",
    gatewayTradingReady: true,
    optionQuoteReady: true,
    optionTicketReady: true,
    providerContractId: "SPY-500-C",
    quoteFreshness: "live",
    quoteMarketDataMode: "live",
    strike: 500,
    ticker: "spy",
    tradingExecutionMode: "real",
  });

  assert.equal(readiness.instrumentLabel, "SPY 500C");
  assert.equal(readiness.instrumentDetail, "Exp 2026-05-15 · 10DTE");
  assert.equal(readiness.state, "ready");
  assert.equal(readiness.blockedReason, null);
  assert.equal(readiness.accountLabel, "DU1234567");
  assert.equal(
    readiness.chips.find((chip) => chip.id === "quote")?.value,
    "live option quote",
  );
  assert.equal(
    readiness.chips.find((chip) => chip.id === "provider")?.value,
    "IBKR SPY-500-C · LIVE",
  );
});

test("trade ticket readiness surfaces option and gateway blockers", () => {
  const readiness = buildTradeTicketReadiness({
    gatewayTradingMessage: "Gateway disconnected",
    gatewayTradingReady: false,
    optionQuoteReady: false,
    optionTicketReady: false,
    providerContractId: null,
    strike: 920,
    ticker: "NVDA",
  });

  assert.equal(readiness.state, "blocked");
  assert.equal(readiness.blockers.length, 2);
  assert.match(readiness.blockedReason, /live chain row/);
  assert.equal(
    readiness.chips.find((chip) => chip.id === "provider")?.value,
    "contract id pending",
  );
  assert.equal(
    readiness.chips.find((chip) => chip.id === "quote")?.tone,
    "warn",
  );
});

test("trade ticket readiness keeps shares distinct from options", () => {
  const readiness = buildTradeTicketReadiness({
    equityPrice: 501.25,
    equityQuoteReady: true,
    gatewayTradingReady: true,
    ticketIsShares: true,
    ticker: "SPY",
  });

  assert.equal(readiness.instrumentLabel, "SPY");
  assert.equal(readiness.assetLabel, "SHARES");
  assert.equal(readiness.state, "ready");
  assert.equal(
    readiness.chips.find((chip) => chip.id === "quote")?.value,
    "stock quote ready",
  );
  assert.equal(normalizeTicketFreshness("delayed_frozen"), "delayed_frozen");
  assert.equal(formatTicketFreshnessLabel("delayed_frozen"), "delayed frozen");
});
