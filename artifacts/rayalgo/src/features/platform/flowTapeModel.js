export const FLOW_SORT_DEFAULT_DIRECTIONS = Object.freeze({
  confidence: "desc",
  dte: "asc",
  expiration: "asc",
  iv: "desc",
  mark: "desc",
  moneyness: "asc",
  otmPercent: "asc",
  premium: "desc",
  ratio: "desc",
  right: "asc",
  score: "desc",
  size: "desc",
  spot: "desc",
  strike: "asc",
  ticker: "asc",
  time: "desc",
});

export const normalizeFlowSortBy = (value) => {
  if (value === "age") return "time";
  return Object.prototype.hasOwnProperty.call(FLOW_SORT_DEFAULT_DIRECTIONS, value)
    ? value
    : "time";
};

export const getDefaultFlowSortDir = (sortBy) =>
  FLOW_SORT_DEFAULT_DIRECTIONS[normalizeFlowSortBy(sortBy)] || "desc";

export const normalizeFlowSortDir = (value, sortBy = "time") =>
  value === "asc" || value === "desc" ? value : getDefaultFlowSortDir(sortBy);

export const formatFlowTradeAge = (occurredAt, nowMs = Date.now()) => {
  const timestamp = Date.parse(occurredAt || "");
  if (!Number.isFinite(timestamp)) return "N/A";
  const ageMs = Math.max(0, nowMs - timestamp);
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

export const classifyFlowSentiment = (event) => {
  const side = String(event?.side || "").toUpperCase();
  const right = String(event?.cp || "").toUpperCase();
  if (side === "BUY" && right === "C") return "bull";
  if (side === "SELL" && right === "P") return "bull";
  if (side === "BUY" && right === "P") return "bear";
  if (side === "SELL" && right === "C") return "bear";
  return "neutral";
};

export const summarizeFlowSentiment = (events = []) => {
  const summary = {
    bullPremium: 0,
    bearPremium: 0,
    neutralPremium: 0,
    bullCount: 0,
    bearCount: 0,
    neutralCount: 0,
    totalPremium: 0,
    totalCount: 0,
  };

  events.forEach((event) => {
    const premium = Number.isFinite(event?.premium) ? Math.max(0, event.premium) : 0;
    const sentiment = classifyFlowSentiment(event);
    summary.totalPremium += premium;
    summary.totalCount += 1;
    if (sentiment === "bull") {
      summary.bullPremium += premium;
      summary.bullCount += 1;
    } else if (sentiment === "bear") {
      summary.bearPremium += premium;
      summary.bearCount += 1;
    } else {
      summary.neutralPremium += premium;
      summary.neutralCount += 1;
    }
  });

  const denominator = summary.totalPremium || 1;
  return {
    ...summary,
    netPremium: summary.bullPremium - summary.bearPremium,
    bullShare: summary.bullPremium / denominator,
    bearShare: summary.bearPremium / denominator,
    neutralShare: summary.neutralPremium / denominator,
  };
};

const numberValue = (value, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

const expirationValue = (event) => {
  const parsed = Date.parse(event?.expirationDate || "");
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const getFlowSortValue = (event, sortBy) => {
  if (sortBy === "ticker") return String(event?.ticker || "");
  if (sortBy === "expiration") return expirationValue(event);
  if (sortBy === "right") return String(event?.cp || "");
  if (sortBy === "strike") return numberValue(event?.strike, Number.POSITIVE_INFINITY);
  if (sortBy === "premium") return numberValue(event?.premium);
  if (sortBy === "score") return numberValue(event?.score);
  if (sortBy === "ratio") return numberValue(event?.unusualScore);
  if (sortBy === "size") return numberValue(event?.vol);
  if (sortBy === "oi") return numberValue(event?.oi);
  if (sortBy === "dte") return numberValue(event?.dte, Number.POSITIVE_INFINITY);
  if (sortBy === "iv") return numberValue(event?.iv);
  if (sortBy === "mark") return numberValue(event?.mark);
  if (sortBy === "spot") return numberValue(event?.spot);
  if (sortBy === "moneyness") return String(event?.moneyness || "");
  if (sortBy === "otmPercent") return numberValue(event?.otmPercent);
  if (sortBy === "distance") return numberValue(event?.distancePercent);
  if (sortBy === "delta") return numberValue(event?.delta);
  if (sortBy === "gamma") return numberValue(event?.gamma);
  if (sortBy === "theta") return numberValue(event?.theta);
  if (sortBy === "vega") return numberValue(event?.vega);
  if (sortBy === "sourceBasis") return String(event?.sourceBasis || "");
  if (sortBy === "confidence") return String(event?.confidence || "");
  return Date.parse(event?.occurredAt || "") || 0;
};

export const compareFlowEvents = (left, right, rawSortBy = "time", rawSortDir) => {
  const sortBy = normalizeFlowSortBy(rawSortBy);
  const sortDir = normalizeFlowSortDir(rawSortDir, sortBy);
  const leftValue = getFlowSortValue(left, sortBy);
  const rightValue = getFlowSortValue(right, sortBy);
  let comparison = 0;

  if (typeof leftValue === "string" || typeof rightValue === "string") {
    comparison = String(leftValue).localeCompare(String(rightValue));
  } else {
    comparison = leftValue - rightValue;
  }

  if (comparison === 0 && sortBy !== "time") {
    comparison =
      (Date.parse(left?.occurredAt || "") || 0) -
      (Date.parse(right?.occurredAt || "") || 0);
  }

  return sortDir === "asc" ? comparison : -comparison;
};
