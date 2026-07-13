const BROKER_CONFIG = {
  robinhood: {
    symbolPattern: /^[A-Z0-9][A-Z0-9._:-]{0,63}$/,
    orderTypes: {
      MKT: "Market",
      LMT: "Limit",
      STP: "StopMarket",
      STP_LMT: "StopLimit",
    },
    timeInForce: { DAY: "Day", GTC: "GTC" },
    reviewPath: "/impact",
  },
  snaptrade: {
    symbolPattern: /^[A-Z0-9]{1,6}$/,
    orderTypes: { MKT: "Market", LMT: "Limit" },
    timeInForce: { DAY: "Day", GTC: "GTC", FOK: "FOK", IOC: "IOC" },
    reviewPath: "/impact",
  },
  schwab: {
    symbolPattern: /^[A-Z][A-Z0-9.]{0,5}$/,
    orderTypes: { MKT: "Market", LMT: "Limit" },
    timeInForce: {
      DAY: "Day",
      GTC: "GoodTillCancel",
      FOK: "FillOrKill",
    },
    reviewPath: "/preview",
  },
};

function dateKey(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function optionTypeForRight(value) {
  const right = String(value || "").trim().toLowerCase();
  if (right === "c" || right === "call") return "Call";
  if (right === "p" || right === "put") return "Put";
  return null;
}

function positionEffectLabel(value) {
  const effect = String(value || "").trim().toLowerCase();
  if (effect === "open") return "Open";
  if (effect === "close") return "Close";
  return null;
}

export function readBrokerSubmitReconciliation(value) {
  const data = value?.data;
  const reconciliation = data?.data || data || value;
  const unknownOutcome =
    reconciliation?.outcome === "unknown" &&
    reconciliation?.retryable === false;
  const submittedButUnrecorded =
    typeof reconciliation?.reconciliationReason === "string" &&
    reconciliation.reconciliationReason.length > 0;
  return reconciliation?.reconcileRequired === true &&
    (unknownOutcome || submittedButUnrecorded)
    ? reconciliation
    : null;
}

export function buildBrokerOptionOrderDraft({
  broker,
  account,
  contractSymbol,
  multiplier,
  sharesPerContract,
  underlyingSymbol,
  expiration,
  strike,
  right,
  side,
  positionEffect,
  orderType,
  tif,
  quantity,
  orderPrices,
} = {}) {
  const config = BROKER_CONFIG[broker];
  if (!config) {
    return { ready: false, reason: "broker", body: null };
  }
  if (
    account?.executionReady !== true ||
    (broker === "robinhood" && account?.agentic !== true)
  ) {
    return { ready: false, reason: `${broker}_account`, body: null };
  }

  const symbol = String(underlyingSymbol || "").trim().toUpperCase();
  const normalizedContractSymbol = String(contractSymbol || "")
    .trim()
    .toUpperCase();
  const normalizedMultiplier = positiveInteger(multiplier);
  const normalizedSharesPerContract = positiveInteger(sharesPerContract);
  const normalizedExpiration = dateKey(expiration);
  const normalizedStrike = positiveNumber(strike);
  const optionType = optionTypeForRight(right);
  const normalizedSide = side === "SELL" ? "Sell" : side === "BUY" ? "Buy" : null;
  const normalizedPositionEffect = positionEffectLabel(positionEffect);
  const normalizedOrderType = config.orderTypes[orderType];
  const timeInForce = config.timeInForce[String(tif || "").toUpperCase()];
  const normalizedQuantity = positiveInteger(quantity);
  const limitPrice = positiveNumber(orderPrices?.limitPrice);
  const stopPrice = positiveNumber(orderPrices?.stopPrice);

  if (!normalizedContractSymbol) {
    return { ready: false, reason: "contract_identity", body: null };
  }
  if (
    normalizedMultiplier !== 100 ||
    normalizedSharesPerContract !== 100
  ) {
    return { ready: false, reason: "contract_economics", body: null };
  }
  if (!config.symbolPattern.test(symbol)) {
    return { ready: false, reason: "symbol", body: null };
  }
  if (!normalizedExpiration) {
    return { ready: false, reason: "expiration", body: null };
  }
  if (!normalizedStrike) {
    return { ready: false, reason: "strike", body: null };
  }
  if (!optionType) {
    return { ready: false, reason: "option_type", body: null };
  }
  if (!normalizedSide) {
    return { ready: false, reason: "side", body: null };
  }
  if (!normalizedPositionEffect) {
    return { ready: false, reason: "position_effect", body: null };
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

  const common = {
    contractSymbol: normalizedContractSymbol,
    multiplier: normalizedMultiplier,
    sharesPerContract: normalizedSharesPerContract,
    expiration: normalizedExpiration,
    strike: normalizedStrike,
    optionType,
    orderType: normalizedOrderType,
  };
  if (broker === "robinhood") {
    return {
      ready: true,
      reason: null,
      body: {
        chainSymbol: symbol,
        ...common,
        quantity: normalizedQuantity,
        side: normalizedSide,
        positionEffect: normalizedPositionEffect,
        timeInForce,
        marketHours: "regular_hours",
        limitPrice:
          normalizedOrderType === "Limit" || normalizedOrderType === "StopLimit"
            ? limitPrice
            : null,
        stopPrice:
          normalizedOrderType === "StopMarket" ||
          normalizedOrderType === "StopLimit"
            ? stopPrice
            : null,
      },
    };
  }

  const action = `${normalizedSide.toUpperCase()}_TO_${normalizedPositionEffect.toUpperCase()}`;
  if (broker === "snaptrade") {
    return {
      ready: true,
      reason: null,
      body: {
        underlyingSymbol: symbol,
        ...common,
        action,
        timeInForce,
        units: normalizedQuantity,
        price: normalizedOrderType === "Limit" ? limitPrice : null,
      },
    };
  }

  return {
    ready: true,
    reason: null,
    body: {
      underlyingSymbol: symbol,
      ...common,
      quantity: normalizedQuantity,
      instruction: `${normalizedSide}To${normalizedPositionEffect}`,
      duration: timeInForce,
      session: "Normal",
      limitPrice: normalizedOrderType === "Limit" ? limitPrice : null,
    },
  };
}

async function postBrokerOptionOrder({
  broker,
  accountId,
  path,
  csrfToken,
  body,
  fetchImpl = fetch,
}) {
  if (!BROKER_CONFIG[broker]) {
    throw new Error("Unsupported option broker");
  }
  const response = await fetchImpl(
    `/api/broker-execution/${broker}/accounts/${encodeURIComponent(accountId)}/options${path}`,
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
        `${broker} option request failed (${response.status})`,
    );
    error.status = response.status;
    error.code = payload?.code || null;
    error.data = payload?.data || null;
    throw error;
  }
  return payload;
}

export const reviewBrokerOptionOrderRequest = (input) =>
  postBrokerOptionOrder({
    ...input,
    path: BROKER_CONFIG[input.broker]?.reviewPath || "",
  });

export const placeBrokerOptionOrderRequest = (input) =>
  postBrokerOptionOrder({
    ...input,
    path: "",
    body: { ...input.body, confirm: true },
  });
