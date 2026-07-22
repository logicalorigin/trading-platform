const SNAPTRADE_ORDER_TYPE_BY_TICKET = {
  MKT: "Market",
  LMT: "Limit",
  STP: "Stop",
  STP_LMT: "StopLimit",
};

const SNAPTRADE_TIME_IN_FORCE_BY_TICKET = {
  DAY: "Day",
  GTC: "GTC",
  IOC: "IOC",
  FOK: "FOK",
};

function normalizeSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._:-]{0,63}$/.test(symbol) ? symbol : "";
}

function positiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function mapTicketOrderTypeToSnapTrade(orderType) {
  return SNAPTRADE_ORDER_TYPE_BY_TICKET[orderType] || null;
}

export function mapTicketTimeInForceToSnapTrade(tif) {
  return (
    SNAPTRADE_TIME_IN_FORCE_BY_TICKET[String(tif || "").toUpperCase()] || null
  );
}

export function buildSnapTradeEquityOrderDraft({
  account,
  symbol,
  side,
  orderType,
  tif,
  quantity,
  orderPrices,
} = {}) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedSide = side === "BUY" || side === "SELL" ? side : null;
  const units = positiveNumber(quantity);
  const snapTradeOrderType = mapTicketOrderTypeToSnapTrade(orderType);
  const timeInForce = mapTicketTimeInForceToSnapTrade(tif);
  const limitPrice = positiveNumber(orderPrices?.limitPrice);
  const stopPrice = positiveNumber(orderPrices?.stopPrice);

  if (account?.executionReady !== true) {
    return {
      ready: false,
      reason: "snaptrade_account",
      body: null,
    };
  }
  if (!normalizedSymbol) {
    return {
      ready: false,
      reason: "symbol",
      body: null,
    };
  }
  if (!normalizedSide) {
    return {
      ready: false,
      reason: "side",
      body: null,
    };
  }
  if (!snapTradeOrderType) {
    return {
      ready: false,
      reason: "order_type",
      body: null,
    };
  }
  if (!timeInForce) {
    return {
      ready: false,
      reason: "time_in_force",
      body: null,
    };
  }
  if (!units) {
    return {
      ready: false,
      reason: "quantity",
      body: null,
    };
  }
  if ((snapTradeOrderType === "Limit" || snapTradeOrderType === "StopLimit") && !limitPrice) {
    return {
      ready: false,
      reason: "price",
      body: null,
    };
  }
  if ((snapTradeOrderType === "Stop" || snapTradeOrderType === "StopLimit") && !stopPrice) {
    return {
      ready: false,
      reason: "stop",
      body: null,
    };
  }

  return {
    ready: true,
    reason: null,
    body: {
      confirm: true,
      action: normalizedSide,
      symbol: normalizedSymbol,
      orderType: snapTradeOrderType,
      timeInForce,
      tradingSession: "REGULAR",
      units,
      notionalValue: null,
      price:
        snapTradeOrderType === "Limit" || snapTradeOrderType === "StopLimit"
          ? limitPrice
          : null,
      stop:
        snapTradeOrderType === "Stop" || snapTradeOrderType === "StopLimit"
          ? stopPrice
          : null,
      clientOrderId: null,
    },
  };
}
