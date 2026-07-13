const ROBINHOOD_ORDER_TYPE_BY_TICKET = {
  MKT: "Market",
  LMT: "Limit",
  STP: "StopMarket",
  STP_LMT: "StopLimit",
};

const ROBINHOOD_TIME_IN_FORCE_BY_TICKET = {
  DAY: "Day",
  GTC: "GTC",
};

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function buildRobinhoodEquityOrderDraft({
  account,
  symbol,
  side,
  orderType,
  tif,
  quantity,
  orderPrices,
} = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const normalizedOrderType = ROBINHOOD_ORDER_TYPE_BY_TICKET[orderType];
  const timeInForce = ROBINHOOD_TIME_IN_FORCE_BY_TICKET[String(tif || "").toUpperCase()];
  const normalizedQuantity = positiveNumber(quantity);
  const limitPrice = positiveNumber(orderPrices?.limitPrice);
  const stopPrice = positiveNumber(orderPrices?.stopPrice);

  if (account?.agentic !== true || account?.executionReady !== true) {
    return { ready: false, reason: "robinhood_account", body: null };
  }
  if (!/^[A-Z0-9][A-Z0-9._:-]{0,63}$/.test(normalizedSymbol)) {
    return { ready: false, reason: "symbol", body: null };
  }
  if (!normalizedOrderType) {
    return { ready: false, reason: "order_type", body: null };
  }
  if (!timeInForce) {
    return { ready: false, reason: "time_in_force", body: null };
  }
  if (!normalizedQuantity) {
    return { ready: false, reason: "quantity", body: null };
  }
  if (
    (normalizedOrderType === "Limit" || normalizedOrderType === "StopLimit") &&
    !limitPrice
  ) {
    return { ready: false, reason: "price", body: null };
  }
  if (
    (normalizedOrderType === "StopMarket" || normalizedOrderType === "StopLimit") &&
    !stopPrice
  ) {
    return { ready: false, reason: "stop", body: null };
  }

  return {
    ready: true,
    reason: null,
    body: {
      symbol: normalizedSymbol,
      side: side === "SELL" ? "SELL" : "BUY",
      orderType: normalizedOrderType,
      timeInForce,
      marketHours: "regular_hours",
      quantity: normalizedQuantity,
      notionalValue: null,
      limitPrice:
        normalizedOrderType === "Limit" || normalizedOrderType === "StopLimit"
          ? limitPrice
          : null,
      stopPrice:
        normalizedOrderType === "StopMarket" || normalizedOrderType === "StopLimit"
          ? stopPrice
          : null,
    },
  };
}

async function postRobinhoodOrder({
  accountId,
  path,
  csrfToken,
  body,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(
    `/api/broker-execution/robinhood/accounts/${encodeURIComponent(accountId)}/orders${path}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify(body),
    },
  );
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(
      payload?.detail ||
        payload?.title ||
        payload?.message ||
        payload?.error ||
        `Robinhood request failed (${response.status})`,
    );
    error.status = response.status;
    error.code = payload?.code || null;
    error.data = payload?.data || null;
    throw error;
  }
  return payload;
}

export const reviewRobinhoodEquityOrderRequest = (input) =>
  postRobinhoodOrder({ ...input, path: "/impact" });

export const placeRobinhoodEquityOrderRequest = (input) =>
  postRobinhoodOrder({
    ...input,
    path: "",
    body: { ...input.body, confirm: true },
  });
