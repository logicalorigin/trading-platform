import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { submitIbkrLiveOrderAfterGate } from "./TradeOrderTicket.jsx";
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
  const previewOrderStart = ticketSource.indexOf("const previewOrder = async () => {");
  const previewShadowStart = ticketSource.indexOf('if (executionMode === "shadow") {', previewOrderStart);
  const previewShadowEnd = ticketSource.indexOf("if (!brokerConfigured) {", previewShadowStart);
  const shadowSubmitStart = ticketSource.indexOf("const submitShadowOrder = () => {");
  const shadowSubmitEnd = ticketSource.indexOf("const automationContract =");
  assert.ok(previewOrderStart >= 0, "preview branch must exist");
  assert.ok(previewShadowStart >= 0, "shadow preview branch must exist");
  assert.ok(
    previewShadowEnd > previewShadowStart,
    "shadow preview branch boundary must exist",
  );
  assert.ok(
    shadowSubmitEnd > shadowSubmitStart,
    "shadow submit branch boundary must exist",
  );

  const previewShadowBranch = ticketSource.slice(
    previewShadowStart,
    previewShadowEnd,
  );
  const shadowSubmitBranch = ticketSource.slice(
    shadowSubmitStart,
    shadowSubmitEnd,
  );

  assert.doesNotMatch(previewShadowBranch, /gatewayTradingBlocked/);
  assert.doesNotMatch(shadowSubmitBranch, /gatewayTradingBlocked/);
  assert.match(
    ticketSource,
    /!executionIsShadow && !liveUsesSnapTrade && !gatewayTradingReady/,
  );
  assert.doesNotMatch(ticketSource, /executionIsShadow && gatewayTradingBlocked/);
});

test("blocked IBKR live submit never invokes live submit continuation", async () => {
  const toasts = [];
  let liveSubmitCalls = 0;

  const result = await submitIbkrLiveOrderAfterGate({
    brokerConfigured: true,
    gatewayTradingBlocked: true,
    gatewayTradingMessage: "Gateway is not ready for trading.",
    accountId: "DU123",
    liveOrderPayloadReady: true,
    orderRequest: { conid: 123 },
    ticketIsShares: false,
    toast: { push: (toast) => toasts.push(toast) },
    submit: async () => {
      liveSubmitCalls += 1;
    },
  });

  assert.equal(liveSubmitCalls, 0);
  assert.deepEqual(result, { submitted: false, reason: "gateway_blocked" });
  assert.deepEqual(toasts, [
    {
      kind: "warn",
      title: "IBKR session unavailable",
      body: "Gateway is not ready for trading.",
    },
  ]);
  assert.match(ticketSource, /await submitIbkrLiveOrderAfterGate\(\{/);
});

test("ready IBKR live submit invokes live submit continuation once", async () => {
  const toasts = [];
  let liveSubmitCalls = 0;

  const result = await submitIbkrLiveOrderAfterGate({
    brokerConfigured: true,
    gatewayTradingBlocked: false,
    gatewayTradingMessage: "",
    accountId: "DU123",
    liveOrderPayloadReady: true,
    orderRequest: { conid: 123 },
    ticketIsShares: false,
    toast: { push: (toast) => toasts.push(toast) },
    submit: async () => {
      liveSubmitCalls += 1;
    },
  });

  assert.equal(liveSubmitCalls, 1);
  assert.deepEqual(result, { submitted: true, reason: null });
  assert.deepEqual(toasts, []);
});

test("SnapTrade equity submit branch is before IBKR broker guards", () => {
  const submitOrderStart = ticketSource.indexOf("const submitOrder = async () => {");
  const snapTradeSubmitStart = ticketSource.indexOf("if (liveUsesSnapTrade) {", submitOrderStart);
  const ibkrBrokerGateStart = ticketSource.indexOf("await submitIbkrLiveOrderAfterGate({", submitOrderStart);
  const previewOrderStart = ticketSource.indexOf("const previewOrder = async () => {");
  const snapTradePreviewStart = ticketSource.indexOf("if (liveUsesSnapTrade) {", previewOrderStart);
  const previewIbkrBrokerGuardStart = ticketSource.indexOf("if (!brokerConfigured) {", previewOrderStart);

  assert.ok(submitOrderStart >= 0, "live submit branch must exist");
  assert.ok(snapTradeSubmitStart > submitOrderStart, "SnapTrade submit branch must exist");
  assert.ok(
    ibkrBrokerGateStart > snapTradeSubmitStart,
    "SnapTrade submit must run before IBKR broker gate",
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
