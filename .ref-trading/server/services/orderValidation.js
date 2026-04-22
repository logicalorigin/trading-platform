const VALID_ASSET_TYPES = new Set(["equity", "option"]);
const VALID_SIDES = new Set(["buy", "sell"]);
const VALID_ORDER_TYPES = new Set(["market", "limit"]);
const VALID_EXECUTION = new Set(["live"]);

export function normalizeOrderPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid order payload");
  }

  const accountId = requiredString(payload.accountId, "accountId");
  const symbol = requiredString(payload.symbol, "symbol").toUpperCase();
  const assetType = optionalString(payload.assetType, "option").toLowerCase();
  const side = optionalString(payload.side, "buy").toLowerCase();
  const orderType = optionalString(payload.orderType, "market").toLowerCase();
  const executionMode = optionalString(payload.executionMode, "live").toLowerCase();
  const quantity = Number(payload.quantity);
  const limitPrice =
    payload.limitPrice == null || payload.limitPrice === ""
      ? null
      : Number(payload.limitPrice);

  if (!VALID_ASSET_TYPES.has(assetType)) {
    throw new Error("assetType must be equity or option");
  }
  if (!VALID_SIDES.has(side)) {
    throw new Error("side must be buy or sell");
  }
  if (!VALID_ORDER_TYPES.has(orderType)) {
    throw new Error("orderType must be market or limit");
  }
  if (!VALID_EXECUTION.has(executionMode)) {
    throw new Error("executionMode must be live");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive number");
  }
  if (orderType === "limit") {
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      throw new Error("limitPrice must be set for limit orders");
    }
  }

  let option = null;
  if (assetType === "option") {
    const expiry = requiredString(payload.expiry, "expiry");
    const strike = Number(payload.strike);
    const right = requiredString(payload.right, "right").toLowerCase();

    if (!Number.isFinite(strike) || strike <= 0) {
      throw new Error("strike must be a positive number for options");
    }
    if (!["call", "put"].includes(right)) {
      throw new Error("right must be call or put for options");
    }

    option = {
      expiry,
      strike,
      right,
    };
  }

  return {
    accountId,
    symbol,
    assetType,
    side,
    orderType,
    quantity,
    limitPrice,
    option,
    executionMode,
    timeInForce: optionalString(payload.timeInForce, "day").toUpperCase(),
  };
}

export function normalizeClosePayload(payload, fallbackAccountId) {
  if (!payload || typeof payload !== "object") {
    return {
      accountId: fallbackAccountId,
      quantity: null,
      limitPrice: null,
      executionMode: "live",
    };
  }

  const accountId = payload.accountId || fallbackAccountId;
  const quantity =
    payload.quantity == null || payload.quantity === ""
      ? null
      : Number(payload.quantity);
  const limitPrice =
    payload.limitPrice == null || payload.limitPrice === ""
      ? null
      : Number(payload.limitPrice);
  const executionMode = optionalString(payload.executionMode, "live").toLowerCase();

  if (!accountId) {
    throw new Error("accountId is required when closing a position");
  }
  if (quantity != null && (!Number.isFinite(quantity) || quantity <= 0)) {
    throw new Error("quantity must be a positive number when provided");
  }
  if (limitPrice != null && (!Number.isFinite(limitPrice) || limitPrice <= 0)) {
    throw new Error("limitPrice must be a positive number when provided");
  }
  if (!VALID_EXECUTION.has(executionMode)) {
    throw new Error("executionMode must be live");
  }

  return {
    accountId,
    quantity,
    limitPrice,
    executionMode,
  };
}

export function buildOrderPreview(order, commissionPerContract = 0.65) {
  const unitPrice =
    order.orderType === "limit"
      ? Number(order.limitPrice)
      : estimateMarketPrice(order.symbol, order.option);

  const multiplier = order.assetType === "option" ? 100 : 1;
  const notional = unitPrice * order.quantity * multiplier;
  const estimatedFees = order.assetType === "option"
    ? commissionPerContract * order.quantity * 2
    : 0;

  return {
    unitPrice: round2(unitPrice),
    quantity: order.quantity,
    multiplier,
    estimatedNotional: round2(notional),
    estimatedFees: round2(estimatedFees),
    estimatedTotal: round2(notional + estimatedFees),
  };
}

function estimateMarketPrice(symbol, option) {
  const base = symbol === "SPY" ? 600 : 100;
  if (!option) {
    return base;
  }

  const moneyness = Math.max(1, Math.abs((option.strike || base) - base));
  const timeValue = 1.5;
  return round2(Math.max(0.5, 0.04 * moneyness + timeValue));
}

function requiredString(value, key) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(value, fallback) {
  if (value == null) {
    return fallback;
  }
  if (typeof value !== "string") {
    return String(value);
  }
  return value.trim() || fallback;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}
