import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildManualIbkrSingleLegOrderRequest,
  buildPreparedIbkrOrderSubmission,
  buildPreparedIbkrReplacementSubmission,
  buildPreparedIbkrReplacementPreview,
  formatIbkrOrderSideSize,
  ibkrCancelToast,
  ibkrLifecycleRequiresReconciliation,
  ibkrOrderHasAnyFill,
  isIbkrOrderReconciliationError,
  isIbkrOrderRejected,
  isIbkrLiveReadinessReady,
  isIbkrReplacementStateError,
  readIbkrOrderWarning,
  resolveExplicitIbkrAccount,
} from "./ibkrLiveEquityOrderModel.js";

const source = readFileSync(
  new URL("./TradeOrderTicket.jsx", import.meta.url),
  "utf8",
);
const brokerDialogSource = readFileSync(
  new URL("./BrokerActionConfirmDialog.jsx", import.meta.url),
  "utf8",
);
const confirmDialogSource = readFileSync(
  new URL("../../components/ui/ConfirmDialog.jsx", import.meta.url),
  "utf8",
);

test("direct IBKR execution requires an explicit eligible account", () => {
  const accounts = [
    {
      accountId: "ibkr-one",
      maskedAccountId: "***1111",
      selected: true,
    },
    {
      accountId: "ibkr-two",
      maskedAccountId: "***2222",
      selected: false,
    },
  ];

  assert.equal(resolveExplicitIbkrAccount(accounts, ""), null);
  assert.equal(resolveExplicitIbkrAccount(accounts, "missing"), null);
  assert.equal(
    resolveExplicitIbkrAccount(accounts, "ibkr-one")?.maskedAccountId,
    "***1111",
  );
});

test("live readiness is strict and fail-closed", () => {
  const target = { accountId: "ibkr-one", maskedAccountId: "***1111" };
  const ready = {
    status: "connected",
    authenticated: true,
    established: true,
    isPaper: false,
  };
  assert.equal(isIbkrLiveReadinessReady(ready, target), true);
  assert.equal(isIbkrLiveReadinessReady({ ...ready, established: null }, target), false);
  assert.equal(isIbkrLiveReadinessReady({ ...ready, isPaper: null }, target), false);
  assert.equal(isIbkrLiveReadinessReady({ ...ready, isPaper: true }, target), false);
  assert.equal(isIbkrLiveReadinessReady(ready, null), false);
});

test("manual direct IBKR equity intent preserves side and whole quantity", () => {
  assert.deepEqual(
    buildManualIbkrSingleLegOrderRequest({
      accountId: "ibkr-one",
      symbol: "aapl",
      assetClass: "equity",
      side: "SELL",
      orderType: "LMT",
      limitPrice: 100.25,
      quantity: 25,
    }),
    {
      accountId: "ibkr-one",
      mode: "live",
      symbol: "AAPL",
      assetClass: "equity",
      side: "sell",
      type: "limit",
      quantity: 25,
      limitPrice: 100.25,
      stopPrice: null,
      timeInForce: "day",
      optionContract: null,
      tradingSession: "regular",
      includeOvernight: false,
      source: "manual",
    },
  );
});

test("manual direct IBKR option intent derives canonical action fields", () => {
  const optionContract = {
    ticker: "AAPL  260918P00150000",
    underlying: "AAPL",
    expirationDate: new Date("2026-09-18T00:00:00.000Z"),
    strike: 150,
    right: "put",
    multiplier: 100,
    sharesPerContract: 100,
    providerContractId: "700001",
  };
  assert.deepEqual(
    buildManualIbkrSingleLegOrderRequest({
      accountId: "ibkr-one",
      symbol: "aapl",
      assetClass: "option",
      optionAction: "sell_to_open",
      optionContract,
      orderType: "MKT",
      limitPrice: 2.22,
      quantity: 2,
    }),
    {
      accountId: "ibkr-one",
      mode: "live",
      symbol: "AAPL",
      assetClass: "option",
      side: "sell",
      type: "market",
      quantity: 2,
      limitPrice: null,
      stopPrice: null,
      timeInForce: "day",
      optionContract,
      optionAction: "sell_to_open",
      positionEffect: "open",
      strategyIntent: "cash_secured_put",
      tradingSession: "regular",
      includeOvernight: false,
      source: "manual",
    },
  );
});

test("submit reuses the exact preview intent and tax preflight", () => {
  const order = buildManualIbkrSingleLegOrderRequest({
    accountId: "ibkr-one",
    symbol: "AAPL",
    assetClass: "equity",
    side: "BUY",
    quantity: 10,
    limitPrice: 100.25,
  });
  const preview = {
    clientOrderId: "intent-123",
    orderFingerprint: "a".repeat(64),
    taxPreflight: {
      preflightToken: "tax-123",
      requiredAcknowledgements: ["what_if_warning_reviewed"],
    },
  };

  assert.deepEqual(buildPreparedIbkrOrderSubmission(order, preview), {
    ...order,
    confirm: true,
    clientOrderId: "intent-123",
    taxPreflightToken: "tax-123",
    taxAcknowledgements: ["what_if_warning_reviewed"],
  });
});

test("submit reuses the IBKR-resolved option contract identity", () => {
  const order = buildManualIbkrSingleLegOrderRequest({
    accountId: "ibkr-one",
    symbol: "AAPL",
    assetClass: "option",
    optionAction: "sell_to_close",
    optionContract: {
      ticker: "AAPL260918C00150000",
      underlying: "AAPL",
      expirationDate: new Date("2026-09-18T00:00:00.000Z"),
      strike: 150,
      right: "call",
      multiplier: 100,
      sharesPerContract: 100,
      providerContractId: null,
    },
    orderType: "LMT",
    limitPrice: 4.25,
    quantity: 1,
  });
  const submission = buildPreparedIbkrOrderSubmission(order, {
    clientOrderId: "intent-option-1",
    optionContract: {
      ...order.optionContract,
      providerContractId: "700001",
    },
    taxPreflight: {
      preflightToken: "tax-option-1",
      requiredAcknowledgements: [],
    },
  });

  assert.equal(submission.optionContract.providerContractId, "700001");
  assert.equal(submission.optionAction, "sell_to_close");
  assert.equal(submission.positionEffect, "close");
  assert.equal(submission.strategyIntent, "sell_to_close");
});

test("warning challenge is read from the generated ApiError problem payload", () => {
  assert.deepEqual(
    readIbkrOrderWarning({
      data: {
        code: "ibkr_order_warning_confirmation_required",
        data: {
          challengeId: "challenge-1",
          messages: ["Price is away from the market."],
          expiresAt: "2026-07-12T23:00:00.000Z",
        },
      },
    }),
    {
      challengeId: "challenge-1",
      messages: ["Price is away from the market."],
      expiresAt: "2026-07-12T23:00:00.000Z",
    },
  );
  assert.equal(readIbkrOrderWarning(new Error("rejected")), null);
  assert.equal(
    isIbkrOrderRejected({ data: { code: "ibkr_order_rejected" } }),
    true,
  );
  assert.equal(
    isIbkrOrderRejected({
      data: { code: "ibkr_order_reply_reconciliation_required" },
    }),
    false,
  );
  assert.equal(
    isIbkrOrderReconciliationError({
      data: { code: "ibkr_order_reply_reconciliation_required" },
    }),
    true,
  );
  assert.equal(
    isIbkrOrderReconciliationError({
      data: { code: "ibkr_order_rejected" },
    }),
    false,
  );
  assert.equal(
    isIbkrReplacementStateError({
      data: { code: "ibkr_replace_order_has_fills" },
    }),
    true,
  );
  assert.equal(
    isIbkrReplacementStateError({
      data: { code: "ibkr_replace_price_unchanged" },
    }),
    false,
  );
});

test("IBKR warning side and size reflects the exact prepared instrument", () => {
  assert.equal(
    formatIbkrOrderSideSize({
      assetClass: "equity",
      side: "sell",
      quantity: 25,
    }),
    "SELL 25 SHARES",
  );
  assert.equal(
    formatIbkrOrderSideSize({
      assetClass: "option",
      side: "buy",
      quantity: 1,
    }),
    "BUY 1 CONTRACT",
  );
  assert.equal(
    formatIbkrOrderSideSize({
      assetClass: "option",
      side: "sell",
      quantity: 2,
    }),
    "SELL 2 CONTRACTS",
  );
});

test("price-only replacement uses the prepared fingerprint and preflight", () => {
  assert.deepEqual(
    buildPreparedIbkrReplacementPreview({
      accountId: "ibkr-one",
      limitPrice: 99.5,
    }),
    { accountId: "ibkr-one", mode: "live", limitPrice: 99.5 },
  );
  assert.deepEqual(
    buildPreparedIbkrReplacementSubmission({
      accountId: "ibkr-one",
      limitPrice: 99.5,
      preview: {
        orderFingerprint: "b".repeat(64),
        taxPreflight: {
          preflightToken: "tax-replace",
          requiredAcknowledgements: [],
        },
      },
    }),
    {
      accountId: "ibkr-one",
      mode: "live",
      confirm: true,
      limitPrice: 99.5,
      orderFingerprint: "b".repeat(64),
      taxPreflightToken: "tax-replace",
      taxAcknowledgements: [],
    },
  );
});

test("cancel is successful only after IBKR confirms cancellation", () => {
  assert.equal(
    ibkrCancelToast({
      cancelConfirmed: true,
      status: "canceled",
      reconciliationRequired: false,
      message: "Cancelled",
    }).kind,
    "success",
  );
  assert.equal(
    ibkrCancelToast({
      cancelConfirmed: false,
      status: "pending_cancel",
      reconciliationRequired: true,
      message: "Request submitted",
    }).kind,
    "warn",
  );
});

test("ambiguous lifecycle responses require reconciliation before another action", () => {
  assert.equal(
    ibkrLifecycleRequiresReconciliation("place", {
      placementConfirmed: true,
      reconciliationRequired: false,
    }),
    false,
  );
  assert.equal(
    ibkrLifecycleRequiresReconciliation("place", {
      placementConfirmed: false,
      reconciliationRequired: false,
    }),
    true,
  );
  assert.equal(
    ibkrLifecycleRequiresReconciliation("place", {
      status: "filled",
      quantity: 1,
      filledQuantity: 1,
      placementConfirmed: true,
      reconciliationRequired: false,
    }),
    false,
  );
  assert.equal(
    ibkrLifecycleRequiresReconciliation("place", {
      status: "filled",
      quantity: 1,
      filledQuantity: 0,
      placementConfirmed: true,
      reconciliationRequired: false,
    }),
    true,
  );
  assert.equal(
    ibkrLifecycleRequiresReconciliation("place", {
      status: "partially_filled",
      quantity: 1,
      filledQuantity: 0.5,
      placementConfirmed: true,
      reconciliationRequired: false,
    }),
    true,
  );
  assert.equal(
    ibkrLifecycleRequiresReconciliation("replace", {
      replacementConfirmed: true,
      reconciliationRequired: true,
    }),
    true,
  );
  assert.equal(
    ibkrLifecycleRequiresReconciliation("cancel", {
      cancelConfirmed: false,
      reconciliationRequired: false,
    }),
    true,
  );
  assert.equal(ibkrOrderHasAnyFill({ filledQuantity: 0.25 }), true);
  assert.equal(ibkrOrderHasAnyFill({ status: "filled" }), true);
  assert.equal(
    ibkrLifecycleRequiresReconciliation("cancel", {
      status: "canceled",
      filledQuantity: 0.25,
      cancelConfirmed: true,
      reconciliationRequired: false,
    }),
    true,
  );
});

test("ticket wires generated direct IBKR lifecycle hooks", () => {
  assert.match(source, /value: "ibkr", label: "IBKR"/);
  assert.match(source, /useGetIbkrPortalReadiness/);
  assert.doesNotMatch(source, /useListAccounts/);
  assert.match(source, /useContinueIbkrOrderReply/);
  assert.match(source, /usePreviewOrderReplacement/);
  assert.match(source, /useReplaceOrder/);
  assert.match(source, /useCancelOrder/);
  assert.match(source, /mode: "live"/);
  assert.match(source, /liveUsesIbkr\s*\? \["MKT", "LMT"\]/);
  assert.match(
    source,
    /buildManualIbkrSingleLegOrderRequest\(\{[\s\S]*?optionAction,[\s\S]*?orderType,[\s\S]*?quantity:/,
  );
  assert.match(source, /variables\?\.data\?\.quantity \?\? qtyNum/);
  assert.match(
    source,
    /variables\?\.data\?\.type \?\? normalizeTicketOrderType\(orderType\)/,
  );
  assert.doesNotMatch(source, /preview\.quantity/);
  assert.match(source, /STOP \/ RECONCILE/);
  assert.match(source, /setIbkrCancelAttempted\(true\)/);
  assert.match(
    source,
    /gatewayTradingBlocked: liveUsesIbkr \? false : gatewayTradingBlocked/,
  );
  assert.match(source, /"CHANGE USED"/);
  assert.match(source, /ibkrLifecyclePending \|\| ibkrWarningDecisionOpen/);
  assert.match(source, /isIbkrOrderRejected/);
  assert.match(source, /trackedIbkrOrderRequiresReconciliation \|\|/);
  assert.match(source, /controlledIbkrOrder\.status === "reconciliation_required"/);
  assert.match(source, /recoveredIbkrLifecycleKeyRef/);
  assert.match(source, /formatIbkrOrderSideSize\(warningOrder\)/);
  assert.doesNotMatch(source, /BUY 1 SHARE/);
  assert.doesNotMatch(source, /one-share limit order/);
});

test("warning dialog exposes an explicit decline action", () => {
  assert.match(source, /cancelLabel: "DECLINE ORDER"/);
  assert.match(brokerDialogSource, /cancelLabel = "Cancel"/);
  assert.match(brokerDialogSource, /cancelLabel=\{cancelLabel\}/);
  assert.match(brokerDialogSource, /requireExplicitDecision/);
  assert.match(confirmDialogSource, /\{cancelLabel\}/);
  assert.match(confirmDialogSource, /!requireExplicitDecision/);
});

test("position close review fails closed on identity, lifecycle, and quote readiness", () => {
  assert.match(source, /getIbkrCloseReviewIntentIssue/);
  assert.match(source, /getIbkrCloseReviewPositionIssue/);
  assert.match(source, /controlledIbkrOrder\.status !== "none"/);
  assert.match(source, /finish or reconcile the existing IBKR order/i);
  assert.match(source, /ticketGenerationRef/);
  assert.match(source, /liveConfirmState[\s\S]*previewOrderMutation\.isPending/);
  assert.match(source, /confirmation expired/i);
  assert.match(source, /EXIT REVIEW/);
  assert.match(source, /closeReviewQuoteReady/);
  assert.match(source, /isCloseReviewQuoteTimestampCurrent/);
  assert.match(source, /closeReviewBlockReason/);
  assert.match(source, /previewDisabled[\s\S]*Boolean\(closeReviewBlockReason\)/);
  assert.match(source, /data-testid="trade-ticket-close-review"/);
  assert.match(source, /!ibkrReadinessQuery\.isError/);
  assert.match(source, /!ibkrReadinessQuery\.isFetching/);
  assert.match(source, /leftProvider === rightProvider/);
  assert.match(source, /Number\(leftContract\.multiplier\)/);
});

test("IBKR completion refreshes the exact selected execution account", () => {
  assert.match(
    source,
    /const submittedAccountId = liveUsesIbkr\s*\? selectedIbkrAccount\?\.accountId\s*:\s*accountId;/,
  );
  assert.match(
    source,
    /`\/api\/accounts\/\$\{submittedAccountId\}\/positions`/,
  );
});
