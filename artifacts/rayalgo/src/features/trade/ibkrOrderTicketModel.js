const ORDER_TYPE_MAP = {
  LMT: "limit",
  MKT: "market",
  STP: "stop",
  STP_LMT: "stop_limit",
};

export const TICKET_ORDER_TYPES = ["LMT", "MKT", "STP", "STP_LMT"];
export const TICKET_ASSET_MODES = ["option", "equity"];
export const TRADING_EXECUTION_MODES = ["real", "shadow"];

export function normalizeTicketOrderType(orderType) {
  return ORDER_TYPE_MAP[orderType] || "limit";
}

export function normalizeTradingExecutionMode(mode) {
  const normalized = String(mode || "").toLowerCase();
  if (normalized === "real" || normalized === "live" || normalized === "ibkr") {
    return "real";
  }
  return "shadow";
}

export function normalizeTicketAssetMode(mode) {
  const normalized = String(mode || "").toLowerCase();
  if (normalized === "equity" || normalized === "stock" || normalized === "shares") {
    return "equity";
  }
  return "option";
}

export function formatTicketOrderType(orderType) {
  return orderType === "STP_LMT" ? "STP LMT" : orderType;
}

export function getDefaultTicketRiskPrices(premium, side, assetMode = "option") {
  const price = Number(premium);
  if (!Number.isFinite(price) || price <= 0) {
    return { stopLoss: "", takeProfit: "" };
  }

  if (normalizeTicketAssetMode(assetMode) === "equity") {
    if (side === "SELL") {
      return {
        stopLoss: +(price * 1.02).toFixed(2),
        takeProfit: +(price * 0.98).toFixed(2),
      };
    }

    return {
      stopLoss: +(price * 0.98).toFixed(2),
      takeProfit: +(price * 1.02).toFixed(2),
    };
  }

  if (side === "SELL") {
    return {
      stopLoss: +(price * 1.35).toFixed(2),
      takeProfit: +(price * 0.35).toFixed(2),
    };
  }

  return {
    stopLoss: +(price * 0.65).toFixed(2),
    takeProfit: +(price * 1.75).toFixed(2),
  };
}

export function resolveTicketOrderPrices({
  orderType,
  limitPrice,
  stopPrice,
  fallbackPrice,
}) {
  const normalizedType = normalizeTicketOrderType(orderType);
  const fallback = Number(fallbackPrice);
  const limit = Number(limitPrice);
  const stop = Number(stopPrice);

  if (normalizedType === "market") {
    return {
      fillPrice: Number.isFinite(fallback) ? fallback : 0,
      limitPrice: null,
      stopPrice: null,
    };
  }

  if (normalizedType === "stop") {
    const resolvedStop = Number.isFinite(stop) ? stop : fallback;
    return {
      fillPrice: resolvedStop,
      limitPrice: null,
      stopPrice: resolvedStop,
    };
  }

  if (normalizedType === "stop_limit") {
    const resolvedLimit = Number.isFinite(limit) ? limit : fallback;
    const resolvedStop = Number.isFinite(stop) ? stop : fallback;
    return {
      fillPrice: resolvedLimit,
      limitPrice: resolvedLimit,
      stopPrice: resolvedStop,
    };
  }

  const resolvedLimit = Number.isFinite(limit) ? limit : fallback;
  return {
    fillPrice: resolvedLimit,
    limitPrice: resolvedLimit,
    stopPrice: null,
  };
}

export function validateTicketBracket({
  side,
  entryPrice,
  stopLoss,
  takeProfit,
  assetMode = "option",
  includeStopLoss = true,
  includeTakeProfit = true,
}) {
  const entry = Number(entryPrice);
  const stop = Number(stopLoss);
  const target = Number(takeProfit);
  const hasStopLoss = includeStopLoss === true;
  const hasTakeProfit = includeTakeProfit === true;
  const normalizedAssetMode = normalizeTicketAssetMode(assetMode);
  const longLabel = normalizedAssetMode === "equity" ? "long shares" : "long premium";
  const shortLabel = normalizedAssetMode === "equity" ? "short shares" : "short premium";

  if (!hasStopLoss && !hasTakeProfit) {
    return null;
  }
  if (!Number.isFinite(entry) || entry <= 0) {
    return "Enter a valid parent order price before attaching exit orders.";
  }
  if (hasStopLoss && (!Number.isFinite(stop) || stop <= 0)) {
    return "Enter a positive stop-loss price before attaching a stop order.";
  }
  if (hasTakeProfit && (!Number.isFinite(target) || target <= 0)) {
    return "Enter a positive take-profit price before attaching a target order.";
  }

  if (side === "SELL") {
    if (hasStopLoss && stop <= entry) {
      return `For ${shortLabel}, the stop-loss must be above entry.`;
    }
    if (hasTakeProfit && target >= entry) {
      return `For ${shortLabel}, the take-profit must be below entry.`;
    }
    return null;
  }

  if (hasStopLoss && stop >= entry) {
    return `For ${longLabel}, the stop-loss must be below entry.`;
  }
  if (hasTakeProfit && target <= entry) {
    return `For ${longLabel}, the take-profit must be above entry.`;
  }
  return null;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord(value) {
  return JSON.parse(JSON.stringify(value));
}

export function isTwsStructuredOrderPayload(payload) {
  return isRecord(payload) && isRecord(payload.contract) && isRecord(payload.order);
}

export function buildTwsBracketOrders({
  previewPayload,
  side,
  quantity,
  stopLossPrice,
  takeProfitPrice,
  includeStopLoss = true,
  includeTakeProfit = true,
  childTimeInForce = "GTC",
}) {
  if (!isTwsStructuredOrderPayload(previewPayload)) {
    throw new Error("Attached exit orders require a structured TWS order preview payload.");
  }

  const parentOrder = cloneRecord(previewPayload.order);
  const contract = cloneRecord(previewPayload.contract);
  const exitAction =
    String(parentOrder.action || side).toUpperCase() === "SELL" ? "BUY" : "SELL";
  const resolvedQuantity = Number(parentOrder.totalQuantity ?? quantity);
  const stopLoss = Number(stopLossPrice);
  const takeProfit = Number(takeProfitPrice);
  const hasStopLoss = includeStopLoss === true;
  const hasTakeProfit = includeTakeProfit === true;

  if (!Number.isFinite(resolvedQuantity) || resolvedQuantity <= 0) {
    throw new Error("Attached exit orders require a positive quantity.");
  }
  if (hasStopLoss && (!Number.isFinite(stopLoss) || stopLoss <= 0)) {
    throw new Error("Attached stop orders require a positive stop-loss price.");
  }
  if (hasTakeProfit && (!Number.isFinite(takeProfit) || takeProfit <= 0)) {
    throw new Error("Attached target orders require a positive take-profit price.");
  }

  const childOrders = [];
  if (hasStopLoss) {
    childOrders.push({
      contract: cloneRecord(contract),
      order: {
        account: parentOrder.account,
        action: exitAction,
        totalQuantity: resolvedQuantity,
        orderType: "STP",
        auxPrice: stopLoss,
        tif: childTimeInForce,
        parentOrderIndex: 0,
        transmit: false,
      },
    });
  }
  if (hasTakeProfit) {
    childOrders.push({
      contract: cloneRecord(contract),
      order: {
        account: parentOrder.account,
        action: exitAction,
        totalQuantity: resolvedQuantity,
        orderType: "LMT",
        lmtPrice: takeProfit,
        tif: childTimeInForce,
        parentOrderIndex: 0,
        transmit: false,
      },
    });
  }
  childOrders.forEach((child, index) => {
    child.order.transmit = index === childOrders.length - 1;
  });

  return [
    {
      contract,
      order: {
        ...parentOrder,
        transmit: childOrders.length === 0,
      },
    },
    ...childOrders,
  ];
}
