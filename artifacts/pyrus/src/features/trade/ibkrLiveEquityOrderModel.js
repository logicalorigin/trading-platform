export const resolveExplicitIbkrAccount = (accounts, selectedAccountId) => {
  const selected = String(selectedAccountId || "").trim();
  if (!selected) return null;
  return (
    (Array.isArray(accounts) ? accounts : []).find(
      (account) => account?.accountId === selected,
    ) || null
  );
};

export const isIbkrLiveReadinessReady = (readiness, selectedTarget) =>
  Boolean(
    selectedTarget &&
      readiness?.status === "connected" &&
      readiness?.authenticated === true &&
      readiness?.established === true &&
      readiness?.isPaper === false,
  );

export const buildManualIbkrEquityOrderRequest = ({
  accountId,
  symbol,
  orderType,
  limitPrice,
}) => {
  const market = String(orderType || "").trim().toUpperCase() === "MKT";
  return {
    accountId: String(accountId || "").trim(),
    mode: "live",
    symbol: String(symbol || "").trim().toUpperCase(),
    assetClass: "equity",
    side: "buy",
    type: market ? "market" : "limit",
    quantity: 1,
    limitPrice: market ? null : Number(limitPrice),
    stopPrice: null,
    timeInForce: "day",
    optionContract: null,
    tradingSession: "regular",
    includeOvernight: false,
    source: "manual",
  };
};

const preparedTaxFields = (preview) => ({
  taxPreflightToken: String(preview?.taxPreflight?.preflightToken || ""),
  taxAcknowledgements: Array.isArray(
    preview?.taxPreflight?.requiredAcknowledgements,
  )
    ? preview.taxPreflight.requiredAcknowledgements
    : [],
});

export const buildPreparedIbkrEquityOrderSubmission = (order, preview) => ({
  ...order,
  confirm: true,
  clientOrderId: String(preview?.clientOrderId || ""),
  ...preparedTaxFields(preview),
});

export const readIbkrOrderWarning = (error) => {
  if (error?.data?.code !== "ibkr_order_warning_confirmation_required") {
    return null;
  }
  const challenge = error.data.data;
  return challenge?.challengeId
    ? {
        challengeId: challenge.challengeId,
        messages: Array.isArray(challenge.messages) ? challenge.messages : [],
        expiresAt: challenge.expiresAt,
      }
    : null;
};

export const isIbkrOrderRejected = (error) =>
  error?.data?.code === "ibkr_order_rejected";

export const isIbkrOrderReconciliationError = (error) =>
  String(error?.data?.code || "").includes("reconciliation_required");

const IBKR_REPLACEMENT_STATE_ERROR_CODES = new Set([
  "ibkr_replace_intent_mismatch",
  "ibkr_replace_order_has_fills",
  "ibkr_replace_order_not_active",
  "ibkr_replace_order_not_editable",
  "ibkr_replace_verification_conflict",
  "ibkr_replace_verification_incomplete",
]);

export const isIbkrReplacementStateError = (error) =>
  IBKR_REPLACEMENT_STATE_ERROR_CODES.has(String(error?.data?.code || ""));

export const buildPreparedIbkrReplacementPreview = ({
  accountId,
  limitPrice,
}) => ({
  accountId: String(accountId || "").trim(),
  mode: "live",
  limitPrice: Number(limitPrice),
});

export const buildPreparedIbkrReplacementSubmission = ({
  accountId,
  limitPrice,
  preview,
}) => ({
  accountId: String(accountId || "").trim(),
  mode: "live",
  confirm: true,
  limitPrice: Number(limitPrice),
  orderFingerprint: String(preview?.orderFingerprint || ""),
  ...preparedTaxFields(preview),
});

export const ibkrCancelToast = (result) =>
  result?.cancelConfirmed === true
    ? {
        kind: "success",
        title: "Cancellation confirmed",
        body: result.message || "IBKR confirmed the order is canceled.",
      }
    : {
        kind: "warn",
        title: "Cancellation not confirmed",
        body:
          result?.message ||
          `IBKR reports ${String(result?.status || "unknown").toUpperCase()}; reconcile before another action.`,
      };

export const ibkrOrderHasAnyFill = (order) => {
  const status = String(order?.status || "").trim().toLowerCase();
  return (
    Number(order?.filledQuantity || 0) > 0 ||
    status === "filled" ||
    status === "partially_filled" ||
    status === "partiallyfilled"
  );
};

export const ibkrOrderNeedsFillReconciliation = (order) =>
  ibkrOrderHasAnyFill(order) &&
  !(
    String(order?.status || "").trim().toLowerCase() === "filled" &&
    Number(order?.quantity) > 0 &&
    Number(order?.filledQuantity) === Number(order?.quantity)
  );

export const ibkrLifecycleRequiresReconciliation = (operation, result) =>
  (operation === "place"
    ? ibkrOrderNeedsFillReconciliation(result)
    : ibkrOrderHasAnyFill(result)) ||
  result?.reconciliationRequired === true ||
  (operation === "place" && result?.placementConfirmed !== true) ||
  (operation === "replace" && result?.replacementConfirmed !== true) ||
  (operation === "cancel" && result?.cancelConfirmed !== true);
