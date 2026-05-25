import {
  formatOptionContractLabel,
  parseExpirationValue,
} from "../../lib/formatters";
import { MISSING_VALUE, T } from "../../lib/uiTokens";

const buildApiUrl = (path, params = {}) => {
  const url = new URL(path, window.location.origin);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return `${url.pathname}${url.search}`;
};

const requestPlatformJson = async (path, params = {}) => {
  const response = await fetch(buildApiUrl(path, params), {
    headers: { Accept: "application/json" },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || response.statusText);
  }
  return payload;
};

export const listBrokerExecutionsRequest = (params = {}) =>
  requestPlatformJson("/api/executions", params);

export const getBrokerMarketDepthRequest = (params = {}) =>
  requestPlatformJson("/api/market-depth", params);

export const FINAL_ORDER_STATUSES = new Set([
  "filled",
  "canceled",
  "rejected",
  "expired",
]);

export const formatExecutionContractLabel = (execution) => {
  if (!execution) return MISSING_VALUE;
  if (execution.assetClass === "option") {
    return formatOptionContractLabel(execution.optionContract || execution, {
      symbol: execution.symbol,
      fallback: execution.contractDescription || `${execution.symbol} OPTION`,
    });
  }
  return "EQUITY";
};

export const sameOptionContract = (left, right) => {
  if (!left || !right) return false;

  const leftExpiration = parseExpirationValue(left.expirationDate);
  const rightExpiration = parseExpirationValue(right.expirationDate);
  if (!leftExpiration || !rightExpiration) {
    return false;
  }

  return (
    Number(left.strike) === Number(right.strike) &&
    String(left.right).toLowerCase() === String(right.right).toLowerCase() &&
    leftExpiration.toISOString().slice(0, 10) ===
      rightExpiration.toISOString().slice(0, 10)
  );
};

export const orderStatusColor = (status) => {
  switch (status) {
    case "filled":
      return T.green;
    case "accepted":
    case "submitted":
    case "partially_filled":
    case "pending_submit":
      return T.accent;
    case "canceled":
    case "expired":
      return T.textDim;
    case "rejected":
      return T.red;
    default:
      return T.text;
  }
};
