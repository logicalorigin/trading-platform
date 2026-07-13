const SCHWAB_ORDER_TYPE_BY_TICKET = {
  MKT: "Market",
  LMT: "Limit",
  STP: "Stop",
  STP_LMT: "StopLimit",
};

const SCHWAB_TIME_IN_FORCE_BY_TICKET = {
  DAY: "Day",
  GTC: "GoodTillCancel",
  FOK: "FillOrKill",
};

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function buildSchwabEquityOrderDraft({
  account,
  symbol,
  side,
  orderType,
  tif,
  quantity,
  orderPrices,
} = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const normalizedOrderType = SCHWAB_ORDER_TYPE_BY_TICKET[orderType];
  const timeInForce =
    SCHWAB_TIME_IN_FORCE_BY_TICKET[String(tif || "").toUpperCase()];
  const normalizedQuantity = positiveInteger(quantity);
  const limitPrice = positiveNumber(orderPrices?.limitPrice);
  const stopPrice = positiveNumber(orderPrices?.stopPrice);

  if (account?.executionReady !== true) {
    return { ready: false, reason: "schwab_account", body: null };
  }
  if (!/^[A-Z][A-Z0-9.]*$/.test(normalizedSymbol)) {
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
    (normalizedOrderType === "Stop" || normalizedOrderType === "StopLimit") &&
    !stopPrice
  ) {
    return { ready: false, reason: "stop", body: null };
  }

  return {
    ready: true,
    reason: null,
    body: {
      symbol: normalizedSymbol,
      action: side === "SELL" ? "SELL" : "BUY",
      quantity: normalizedQuantity,
      orderType: normalizedOrderType,
      timeInForce,
      session: "Normal",
      limitPrice:
        normalizedOrderType === "Limit" || normalizedOrderType === "StopLimit"
          ? limitPrice
          : null,
      stopPrice:
        normalizedOrderType === "Stop" || normalizedOrderType === "StopLimit"
          ? stopPrice
          : null,
    },
  };
}

async function postSchwabEquityOrder({
  accountId,
  path,
  csrfToken,
  body,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(
    `/api/broker-execution/schwab/accounts/${encodeURIComponent(accountId)}/orders${path}`,
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
        `Schwab request failed (${response.status})`,
    );
    error.status = response.status;
    error.code = payload?.code || null;
    error.data = payload?.data || null;
    throw error;
  }
  return payload;
}

export const previewSchwabEquityOrderRequest = (input) =>
  postSchwabEquityOrder({ ...input, path: "/preview" });

export const submitSchwabEquityOrderRequest = (input) =>
  postSchwabEquityOrder({
    ...input,
    path: "",
    body: { ...input.body, confirm: true },
  });
