import { resolveOptionOrderIntent } from "./optionOrderIntentModel.js";

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

export const buildManualIbkrSingleLegOrderRequest = ({
  accountId,
  symbol,
  assetClass,
  side,
  quantity,
  orderType,
  limitPrice,
  optionAction,
  optionContract,
}) => {
  const market = String(orderType || "").trim().toUpperCase() === "MKT";
  const normalizedAssetClass = assetClass === "option" ? "option" : "equity";
  const optionIntent =
    normalizedAssetClass === "option"
      ? resolveOptionOrderIntent({
          action: optionAction,
          right: optionContract?.right,
        })
      : null;
  if (normalizedAssetClass === "option" && !optionIntent) {
    throw new TypeError("A valid canonical option action and contract are required.");
  }
  const normalizedSide = optionIntent?.side || String(side || "").toUpperCase();
  if (normalizedSide !== "BUY" && normalizedSide !== "SELL") {
    throw new TypeError("IBKR orders require an explicit buy or sell side.");
  }

  return {
    accountId: String(accountId || "").trim(),
    mode: "live",
    symbol: String(symbol || "").trim().toUpperCase(),
    assetClass: normalizedAssetClass,
    side: normalizedSide.toLowerCase(),
    type: market ? "market" : "limit",
    quantity: Number(quantity),
    limitPrice: market ? null : Number(limitPrice),
    stopPrice: null,
    timeInForce: "day",
    optionContract: normalizedAssetClass === "option" ? optionContract : null,
    ...(optionIntent
      ? {
          optionAction: optionIntent.action,
          positionEffect: optionIntent.positionEffect,
          ...(optionIntent.strategyIntent
            ? { strategyIntent: optionIntent.strategyIntent }
            : {}),
        }
      : {}),
    tradingSession: "regular",
    includeOvernight: false,
    source: "manual",
  };
};

export const buildManualIbkrEquityOrderRequest = (input) =>
  buildManualIbkrSingleLegOrderRequest({
    ...input,
    assetClass: "equity",
    quantity: input?.quantity ?? 1,
  });

const preparedTaxFields = (preview) => ({
  taxPreflightToken: String(preview?.taxPreflight?.preflightToken || ""),
  taxAcknowledgements: Array.isArray(
    preview?.taxPreflight?.requiredAcknowledgements,
  )
    ? preview.taxPreflight.requiredAcknowledgements
    : [],
});

export const buildPreparedIbkrOrderSubmission = (order, preview) => ({
  ...order,
  ...(order?.assetClass === "option" && preview?.optionContract
    ? {
        optionContract: {
          ...order.optionContract,
          providerContractId: preview.optionContract.providerContractId,
          ...(preview.optionContract.brokerContractId
            ? { brokerContractId: preview.optionContract.brokerContractId }
            : {}),
        },
      }
    : {}),
  confirm: true,
  clientOrderId: String(preview?.clientOrderId || ""),
  ...preparedTaxFields(preview),
});

export const buildPreparedIbkrEquityOrderSubmission =
  buildPreparedIbkrOrderSubmission;

export const formatIbkrOrderSideSize = (order) => {
  const side = String(order?.side || "").trim().toUpperCase() || "UNKNOWN";
  const numericQuantity = Number(order?.quantity);
  const quantity =
    Number.isFinite(numericQuantity) && numericQuantity > 0
      ? numericQuantity
      : "?";
  const option = order?.assetClass === "option";
  const unit = option
    ? numericQuantity === 1
      ? "CONTRACT"
      : "CONTRACTS"
    : numericQuantity === 1
      ? "SHARE"
      : "SHARES";
  return `${side} ${quantity} ${unit}`;
};

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
