import {
  calculateOptionTradePremium,
  classifyOptionMoneyness,
  inferFlowBias,
} from "../platform/optionsPremiumModel";
import {
  daysToExpiration,
  formatExpirationLabel,
  formatOptionContractLabel,
  isFiniteNumber,
} from "../../lib/formatters";
import {
  formatAppTime,
  formatAppTimeForPreferences,
} from "../../lib/timeZone";

const flowEventSourceLabel = (event) => {
  const provider = (event.provider || "unknown").toUpperCase();
  const basis = event.basis === "trade" ? "TRADE" : "SNAPSHOT";
  return `${provider} ${basis}`;
};

const deriveFlowType = (event) => {
  const conditions = (event.tradeConditions || []).map((condition) =>
    String(condition).toLowerCase(),
  );

  // An "unusual" tag (volume > open interest) trumps the heuristic labels.
  // It is the strongest single signal in the event and what we want to flag.
  if (event.isUnusual) {
    return "UNUSUAL";
  }
  if (event.basis === "snapshot") {
    return event.premium >= 500000 ? "XL" : "ACTIVE";
  }
  if (
    event.premium >= 500000 ||
    conditions.some((condition) => condition.includes("block"))
  ) {
    return "BLOCK";
  }
  if (event.side === "buy" && event.premium >= 100000) {
    return "SWEEP";
  }
  if (conditions.length > 1) {
    return "MULTI";
  }

  return "SPLIT";
};

const deriveFlowScore = (event, dte) => {
  let score = 35;
  score += Math.min(35, event.premium / 20000);
  score += event.side === "buy" ? 12 : event.side === "sell" ? 5 : 0;
  score += event.sentiment === "neutral" ? 0 : 10;
  score -= Math.min(10, dte / 7);
  if (event.isUnusual) {
    // Boost unusual events noticeably so they sort to the top of any
    // score-based view, with extra credit for higher volume/OI ratios.
    score += 18 + Math.min(12, (event.unusualScore || 0) * 4);
  }
  return Math.max(10, Math.min(99, Math.round(score)));
};

export const mapFlowEventToUi = (event, preferences) => {
  const dte = daysToExpiration(event.expirationDate);
  const normalizedRight = String(event.right || event.cp || "").toLowerCase();
  const cp =
    normalizedRight === "call" || normalizedRight === "c"
      ? "C"
      : normalizedRight === "put" || normalizedRight === "p"
        ? "P"
        : "";
  const side = (event.side || "mid").toUpperCase();
  const sourceBasis =
    event.sourceBasis ||
    (event.confidence
      ? event.confidence
      : event.basis === "trade"
        ? "confirmed_trade"
        : event.provider === "polygon"
          ? "fallback_estimate"
          : "snapshot_activity");
  const confidence = event.confidence || sourceBasis;
  const premiumModel = calculateOptionTradePremium({
    executionPrice: event.price,
    mark: event.mark,
    bid: event.bid,
    ask: event.ask,
    last: event.last,
    size: event.size,
    multiplier: event.multiplier,
    sharesPerContract: event.sharesPerContract,
  });
  const premium = premiumModel.premium || event.premium || 0;
  const flowBias = inferFlowBias({ cp, side: event.side });
  const spot = isFiniteNumber(event.underlyingPrice)
    ? event.underlyingPrice
    : isFiniteNumber(event.spotPrice)
      ? event.spotPrice
      : null;
  const moneyness = classifyOptionMoneyness({
    spot,
    strike: event.strike,
    right: event.right,
    strikeSpacing: event.strikeSpacing,
    nearestStrikeDistance: event.nearestStrikeDistance,
  });
  const distancePercent = isFiniteNumber(event.distancePercent)
    ? event.distancePercent
    : spot && isFiniteNumber(event.strike)
      ? ((event.strike - spot) / spot) * 100
      : null;

  return {
    id: event.id,
    time: preferences
      ? formatAppTimeForPreferences(event.occurredAt, preferences)
      : formatAppTime(event.occurredAt),
    ticker: event.underlying || event.symbol,
    provider: event.provider || "unknown",
    basis: event.basis || "trade",
    sourceLabel: flowEventSourceLabel(event),
    side,
    contract: formatOptionContractLabel(event, {
      symbol: event.underlying || event.symbol,
      includeSymbol: true,
      fallback: `${event.underlying || event.symbol || ""} OPTION`.trim(),
    }),
    strike: event.strike,
    cp,
    price: event.price,
    bid: isFiniteNumber(event.bid) ? event.bid : null,
    ask: isFiniteNumber(event.ask) ? event.ask : null,
    last: isFiniteNumber(event.last) ? event.last : null,
    mark: isFiniteNumber(event.mark) ? event.mark : null,
    premium,
    premiumPrice: premiumModel.premiumPrice,
    premiumPriceSource: premiumModel.premiumPriceSource,
    flowBias,
    spot,
    underlyingPrice: spot,
    moneyness:
      event.moneyness && event.moneyness !== "UNKNOWN"
        ? event.moneyness
        : moneyness,
    distancePercent,
    delta: isFiniteNumber(event.delta) ? event.delta : null,
    gamma: isFiniteNumber(event.gamma) ? event.gamma : null,
    theta: isFiniteNumber(event.theta) ? event.theta : null,
    vega: isFiniteNumber(event.vega) ? event.vega : null,
    confidence,
    sourceBasis,
    vol: event.size,
    oi: isFiniteNumber(event.openInterest) ? event.openInterest : null,
    iv: isFiniteNumber(event.impliedVolatility)
      ? event.impliedVolatility
      : null,
    dte,
    type: deriveFlowType(event),
    golden:
      side === "BUY" &&
      premium >= 150000 &&
      event.sentiment === "bullish",
    score: deriveFlowScore(event, dte),
    optionTicker: event.optionTicker,
    providerContractId: event.providerContractId || null,
    expirationDate: event.expirationDate,
    occurredAt: event.occurredAt,
    sentiment: event.sentiment,
    tradeConditions: event.tradeConditions || [],
    isUnusual: Boolean(event.isUnusual),
    unusualScore: isFiniteNumber(event.unusualScore) ? event.unusualScore : 0,
  };
};
