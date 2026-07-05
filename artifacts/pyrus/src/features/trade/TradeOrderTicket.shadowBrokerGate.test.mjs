import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTicketReadinessModel } from "./tradeTicketReadinessModel.js";

const ticketSource = readFileSync(
  new URL("./TradeOrderTicket.jsx", import.meta.url),
  "utf8",
);

test("shadow ticket readiness does not warn on missing gateway", () => {
  const model = buildTicketReadinessModel({
    executionMode: "shadow",
    gatewayTradingReady: false,
    brokerConfigured: false,
    brokerAuthenticated: false,
    accountId: null,
    ticketInstrumentReady: true,
    quoteReady: true,
  });

  assert.equal(model.label, "Ready");
  assert.equal(model.detail, "Shadow route ready");
  assert.deepEqual(model.issues, []);
  assert.deepEqual(model.warnings, []);
});

test("live ticket readiness still warns on missing gateway", () => {
  const model = buildTicketReadinessModel({
    executionMode: "real",
    brokerRoute: "ibkr",
    gatewayTradingReady: false,
    brokerConfigured: true,
    brokerAuthenticated: true,
    accountId: "DU123",
    ticketInstrumentReady: true,
    quoteReady: true,
  });

  assert.equal(model.label, "Check");
  assert.deepEqual(model.issues, []);
  assert.deepEqual(model.warnings, ["gateway"]);
});

test("SnapTrade equity readiness does not require IBKR gateway", () => {
  const model = buildTicketReadinessModel({
    executionMode: "real",
    brokerRoute: "snaptrade",
    gatewayTradingReady: false,
    brokerConfigured: false,
    brokerAuthenticated: false,
    accountId: null,
    snapTradeExecutionReady: true,
    ticketInstrumentReady: true,
    quoteReady: true,
  });

  assert.equal(model.label, "Ready");
  assert.equal(model.detail, "SnapTrade route ready");
  assert.deepEqual(model.issues, []);
  assert.deepEqual(model.warnings, []);
});

test("SnapTrade equity readiness blocks when no execution-ready account is selected", () => {
  const model = buildTicketReadinessModel({
    executionMode: "real",
    brokerRoute: "snaptrade",
    snapTradeExecutionReady: false,
    snapTradeExecutionBlockers: ["snaptrade.connection.read_only"],
    ticketInstrumentReady: true,
    quoteReady: true,
  });

  assert.equal(model.label, "Blocked");
  assert.deepEqual(model.issues, ["snaptrade.connection.read_only"]);
  assert.deepEqual(model.warnings, []);
});

test("shadow preview and fill branches are not gated by broker connection", () => {
  const previewShadowStart = ticketSource.indexOf('if (executionMode === "shadow") {');
  const previewShadowEnd = ticketSource.indexOf("if (!brokerConfigured) {");
  const liveSubmitStart = ticketSource.indexOf("const submitOrder = () => {");
  const shadowSubmitStart = ticketSource.indexOf("const submitShadowOrder = () => {");
  const shadowSubmitEnd = ticketSource.indexOf("const automationContract =");
  assert.ok(previewShadowStart >= 0, "shadow preview branch must exist");
  assert.ok(
    previewShadowEnd > previewShadowStart,
    "shadow preview branch boundary must exist",
  );
  assert.ok(liveSubmitStart >= 0, "live submit branch must exist");
  assert.ok(
    shadowSubmitStart > liveSubmitStart,
    "shadow submit branch must follow live submit branch",
  );
  assert.ok(
    shadowSubmitEnd > shadowSubmitStart,
    "shadow submit branch boundary must exist",
  );

  const previewShadowBranch = ticketSource.slice(
    previewShadowStart,
    previewShadowEnd,
  );
  const liveSubmitBranch = ticketSource.slice(
    liveSubmitStart,
    shadowSubmitStart,
  );
  const shadowSubmitBranch = ticketSource.slice(
    shadowSubmitStart,
    shadowSubmitEnd,
  );

  assert.doesNotMatch(previewShadowBranch, /gatewayTradingBlocked/);
  assert.match(liveSubmitBranch, /if \(gatewayTradingBlocked\) \{/);
  assert.doesNotMatch(shadowSubmitBranch, /gatewayTradingBlocked/);
  assert.match(
    ticketSource,
    /!executionIsShadow && !liveUsesSnapTrade && !gatewayTradingReady/,
  );
  assert.doesNotMatch(ticketSource, /executionIsShadow && gatewayTradingBlocked/);
});

test("SnapTrade equity submit branch is before IBKR broker guards", () => {
  const submitOrderStart = ticketSource.indexOf("const submitOrder = () => {");
  const snapTradeSubmitStart = ticketSource.indexOf("if (liveUsesSnapTrade) {", submitOrderStart);
  const ibkrBrokerGuardStart = ticketSource.indexOf("if (!brokerConfigured) {", submitOrderStart);
  const previewOrderStart = ticketSource.indexOf("const previewOrder = async () => {");
  const snapTradePreviewStart = ticketSource.indexOf("if (liveUsesSnapTrade) {", previewOrderStart);
  const previewIbkrBrokerGuardStart = ticketSource.indexOf("if (!brokerConfigured) {", previewOrderStart);

  assert.ok(submitOrderStart >= 0, "live submit branch must exist");
  assert.ok(snapTradeSubmitStart > submitOrderStart, "SnapTrade submit branch must exist");
  assert.ok(
    ibkrBrokerGuardStart > snapTradeSubmitStart,
    "SnapTrade submit must run before IBKR brokerConfigured guard",
  );
  assert.ok(previewOrderStart >= 0, "preview branch must exist");
  assert.ok(snapTradePreviewStart > previewOrderStart, "SnapTrade preview branch must exist");
  assert.ok(
    previewIbkrBrokerGuardStart > snapTradePreviewStart,
    "SnapTrade preview must run before IBKR brokerConfigured guard",
  );
  assert.match(ticketSource, /useSubmitSnapTradeEquityOrder/);
  assert.match(ticketSource, /buildSnapTradeEquityOrderDraft/);
  assert.match(ticketSource, /confirmLabel: `\$\{ticketActionLabel\} SNAPTRADE ORDER`/);
});

test("SnapTrade equity submit reconciles recent order status after success", () => {
  assert.match(ticketSource, /useGetSnapTradeRecentOrders/);
  assert.match(ticketSource, /getGetSnapTradeRecentOrdersQueryKey/);
  assert.match(
    ticketSource,
    /queryKey: getGetSnapTradeRecentOrdersQueryKey\(submittedAccountId\)/,
  );
  assert.match(ticketSource, /snapTradeRecentOrdersQuery/);
});

test("SnapTrade equity preview resolves account symbol and checks impact", () => {
  assert.match(ticketSource, /useSearchSnapTradeAccountSymbols/);
  assert.match(ticketSource, /useCheckSnapTradeEquityOrderImpact/);
  assert.match(ticketSource, /snapTradeSymbolSearchQuery/);
  assert.match(ticketSource, /snapTradeBestSymbol/);
  assert.match(ticketSource, /snapTradeImpactMutation/);
  assert.match(
    ticketSource,
    /universalSymbolId: snapTradeBestSymbol\.id/,
  );
  assert.doesNotMatch(ticketSource, /SnapTrade preview unavailable/);
  assert.match(ticketSource, /"PREVIEW SNAPTRADE"/);
});
