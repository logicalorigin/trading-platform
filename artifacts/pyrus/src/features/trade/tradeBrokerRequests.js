import { formatOptionContractLabel } from "../../lib/formatters";
import { CSS_COLOR, MISSING_VALUE, T } from "../../lib/uiTokens";
import { platformJsonRequest } from "../platform/platformJsonRequest";

const invalidExecutionPayload = (path) => {
  throw new TypeError(`Invalid broker executions payload at ${path}.`);
};

const requiredString = (value, path) => {
  if (typeof value !== "string" || !value.trim()) invalidExecutionPayload(path);
  return value.trim();
};

const nullableString = (value, path) =>
  value === null ? null : requiredString(value, path);

const positiveNumber = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    invalidExecutionPayload(path);
  return value;
};

const normalizeOptionContract = (value, path) => {
  if (value == null) return value;
  if (typeof value !== "object" || Array.isArray(value))
    invalidExecutionPayload(path);
  const expirationDate = requiredString(
    value.expirationDate,
    `${path}.expirationDate`,
  );
  const expirationMs = Date.parse(expirationDate);
  if (!Number.isFinite(expirationMs))
    invalidExecutionPayload(`${path}.expirationDate`);
  if (!["call", "put"].includes(value.right))
    invalidExecutionPayload(`${path}.right`);

  return {
    ...value,
    ticker: requiredString(value.ticker, `${path}.ticker`),
    underlying: requiredString(value.underlying, `${path}.underlying`),
    expirationDate: new Date(expirationMs).toISOString(),
    strike: positiveNumber(value.strike, `${path}.strike`),
    right: value.right,
    multiplier: positiveNumber(value.multiplier, `${path}.multiplier`),
    sharesPerContract: positiveNumber(
      value.sharesPerContract,
      `${path}.sharesPerContract`,
    ),
  };
};

const normalizeBrokerExecution = (value, index) => {
  const path = `executions[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalidExecutionPayload(path);
  if (!["equity", "option"].includes(value.assetClass))
    invalidExecutionPayload(`${path}.assetClass`);
  if (!["buy", "sell"].includes(value.side))
    invalidExecutionPayload(`${path}.side`);
  if (value.netAmount !== null &&
      (typeof value.netAmount !== "number" || !Number.isFinite(value.netAmount)))
    invalidExecutionPayload(`${path}.netAmount`);
  const executedAt = requiredString(value.executedAt, `${path}.executedAt`);
  const executedAtMs = Date.parse(executedAt);
  if (!Number.isFinite(executedAtMs))
    invalidExecutionPayload(`${path}.executedAt`);
  const optionContract = normalizeOptionContract(
    value.optionContract,
    `${path}.optionContract`,
  );
  if (value.assetClass === "equity" && optionContract != null)
    invalidExecutionPayload(`${path}.optionContract`);
  if (value.assetClass === "option" && optionContract == null)
    invalidExecutionPayload(`${path}.optionContract`);

  return {
    ...value,
    id: requiredString(value.id, `${path}.id`),
    accountId: requiredString(value.accountId, `${path}.accountId`),
    symbol: requiredString(value.symbol, `${path}.symbol`).toUpperCase(),
    quantity: positiveNumber(value.quantity, `${path}.quantity`),
    price: positiveNumber(value.price, `${path}.price`),
    exchange: nullableString(value.exchange, `${path}.exchange`),
    executedAt: new Date(executedAtMs).toISOString(),
    orderDescription: nullableString(
      value.orderDescription,
      `${path}.orderDescription`,
    ),
    contractDescription: nullableString(
      value.contractDescription,
      `${path}.contractDescription`,
    ),
    providerContractId: nullableString(
      value.providerContractId,
      `${path}.providerContractId`,
    ),
    optionContract,
    orderRef: nullableString(value.orderRef, `${path}.orderRef`),
  };
};

export const normalizeBrokerExecutionsPayload = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Array.isArray(value.executions))
    invalidExecutionPayload("executions");
  return {
    ...value,
    executions: value.executions.map(normalizeBrokerExecution),
  };
};

const buildApiUrl = (path, params = {}) => {
  const url = new URL(path, window.location.origin);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return `${url.pathname}${url.search}`;
};

export const listBrokerExecutionsRequest = async (params = {}) =>
  normalizeBrokerExecutionsPayload(
    await platformJsonRequest(buildApiUrl("/api/executions", params)),
  );

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

export const orderStatusColor = (status) => {
  switch (status) {
    case "filled":
      return CSS_COLOR.green;
    case "accepted":
    case "submitted":
    case "partially_filled":
    case "pending_submit":
      return CSS_COLOR.accent;
    case "canceled":
    case "expired":
      return CSS_COLOR.textDim;
    case "rejected":
      return CSS_COLOR.red;
    default:
      return CSS_COLOR.text;
  }
};
