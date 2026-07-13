import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildManualIbkrEquityOrderRequest,
  buildPreparedIbkrEquityOrderSubmission,
  buildPreparedIbkrReplacementSubmission,
  buildPreparedIbkrReplacementPreview,
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

test("manual direct IBKR equity intent is exactly one-share LMT DAY regular-hours live", () => {
  assert.deepEqual(
    buildManualIbkrEquityOrderRequest({
      accountId: "ibkr-one",
      symbol: "aapl",
      side: "SELL",
      limitPrice: 100.25,
    }),
    {
      accountId: "ibkr-one",
      mode: "live",
      symbol: "AAPL",
      assetClass: "equity",
      side: "buy",
      type: "limit",
      quantity: 1,
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

test("submit reuses the exact preview intent and tax preflight", () => {
  const order = buildManualIbkrEquityOrderRequest({
    accountId: "ibkr-one",
    symbol: "AAPL",
    side: "BUY",
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

  assert.deepEqual(buildPreparedIbkrEquityOrderSubmission(order, preview), {
    ...order,
    confirm: true,
    clientOrderId: "intent-123",
    taxPreflightToken: "tax-123",
    taxAcknowledgements: ["what_if_warning_reviewed"],
  });
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
  assert.match(source, /STOP \/ RECONCILE/);
  assert.match(source, /setIbkrCancelAttempted\(true\)/);
  assert.match(
    source,
    /gatewayTradingBlocked: liveUsesIbkrEquity \? false : gatewayTradingBlocked/,
  );
  assert.match(source, /"CHANGE USED"/);
  assert.match(source, /ibkrLifecyclePending \|\| ibkrWarningDecisionOpen/);
  assert.match(source, /isIbkrOrderRejected/);
  assert.match(source, /trackedIbkrOrderRequiresReconciliation \|\|/);
});

test("warning dialog exposes an explicit decline action", () => {
  assert.match(source, /cancelLabel: "DECLINE ORDER"/);
  assert.match(brokerDialogSource, /cancelLabel = "Cancel"/);
  assert.match(brokerDialogSource, /cancelLabel=\{cancelLabel\}/);
  assert.match(brokerDialogSource, /requireExplicitDecision/);
  assert.match(confirmDialogSource, /\{cancelLabel\}/);
  assert.match(confirmDialogSource, /!requireExplicitDecision/);
});
