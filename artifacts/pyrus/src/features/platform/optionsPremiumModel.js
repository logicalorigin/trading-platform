export const PREMIUM_PRICE_SOURCES = Object.freeze({
  execution: "execution",
  mark: "mark",
  midpoint: "midpoint",
  last: "last",
  unknown: "unknown",
});

export const MONEYNESS = Object.freeze({
  itm: "ITM",
  atm: "ATM",
  otm: "OTM",
  unknown: "UNKNOWN",
});

export const FLOW_BIAS = Object.freeze({
  bullish: "bullish",
  bearish: "bearish",
  neutral: "neutral",
});

const finitePositive = (value) =>
  Number.isFinite(value) && value > 0 ? value : null;

export const resolveOptionPremiumPrice = ({
  executionPrice,
  price,
  mark,
  bid,
  ask,
  last,
} = {}) => {
  const execution = finitePositive(executionPrice) ?? finitePositive(price);
  if (execution !== null) {
    return { price: execution, source: PREMIUM_PRICE_SOURCES.execution };
  }

  const markPrice = finitePositive(mark);
  if (markPrice !== null) {
    return { price: markPrice, source: PREMIUM_PRICE_SOURCES.mark };
  }

  if (finitePositive(bid) !== null && finitePositive(ask) !== null) {
    return {
      price: (bid + ask) / 2,
      source: PREMIUM_PRICE_SOURCES.midpoint,
    };
  }

  const lastPrice = finitePositive(last);
  if (lastPrice !== null) {
    return { price: lastPrice, source: PREMIUM_PRICE_SOURCES.last };
  }

  return { price: null, source: PREMIUM_PRICE_SOURCES.unknown };
};

export const calculateOptionTradePremium = ({
  executionPrice,
  price,
  mark,
  bid,
  ask,
  last,
  size,
  multiplier,
  sharesPerContract,
} = {}) => {
  const resolved = resolveOptionPremiumPrice({
    executionPrice,
    price,
    mark,
    bid,
    ask,
    last,
  });
  const contracts = finitePositive(size);
  const contractMultiplier =
    finitePositive(multiplier) ?? finitePositive(sharesPerContract) ?? 100;

  return {
    premium:
      resolved.price !== null && contracts !== null
        ? resolved.price * contracts * contractMultiplier
        : 0,
    premiumPrice: resolved.price,
    premiumPriceSource: resolved.source,
    multiplier: contractMultiplier,
  };
};

export const classifyOptionMoneyness = ({
  spot,
  strike,
  right,
  strikeSpacing,
  nearestStrikeDistance,
} = {}) => {
  if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(strike)) {
    return MONEYNESS.unknown;
  }

  const spacing =
    finitePositive(strikeSpacing) ??
    finitePositive(nearestStrikeDistance) ??
    Math.max(0.01, spot * 0.005);
  const atmBand = Math.max(spacing / 2, spot * 0.0025);
  if (Math.abs(strike - spot) <= atmBand) {
    return MONEYNESS.atm;
  }

  const normalizedRight = String(right || "").toLowerCase();
  if (normalizedRight === "call" || normalizedRight === "c") {
    return strike < spot ? MONEYNESS.itm : MONEYNESS.otm;
  }
  if (normalizedRight === "put" || normalizedRight === "p") {
    return strike > spot ? MONEYNESS.itm : MONEYNESS.otm;
  }

  return MONEYNESS.unknown;
};

export const inferFlowBias = ({ right, cp, side } = {}) => {
  const normalizedRight = String(cp || right || "").toLowerCase();
  const normalizedSide = String(side || "").toLowerCase();
  const isCall = normalizedRight === "c" || normalizedRight === "call";
  const isPut = normalizedRight === "p" || normalizedRight === "put";
  const isBuy = [
    "buy",
    "bought",
    "ask",
    "at_ask",
    "above_ask",
    "lift",
    "lifted",
  ].includes(normalizedSide);
  const isSell = [
    "sell",
    "sold",
    "bid",
    "at_bid",
    "below_bid",
    "hit",
    "hit_bid",
  ].includes(normalizedSide);

  if (!isCall && !isPut) {
    return FLOW_BIAS.neutral;
  }
  if (!isBuy && !isSell) {
    return FLOW_BIAS.neutral;
  }
  if ((isCall && isBuy) || (isPut && isSell)) {
    return FLOW_BIAS.bullish;
  }
  return FLOW_BIAS.bearish;
};
