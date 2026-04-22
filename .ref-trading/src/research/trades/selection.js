function sanitizeTradeIdSegment(value, fallback = "NA") {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  return normalized || fallback;
}

function formatTradeTimestampSegment(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!match) {
    return sanitizeTradeIdSegment(value, "UNSTAMPED").slice(0, 16);
  }
  return `${match[1]}${match[2]}${match[3]}-${match[4]}${match[5]}`;
}

export function buildResearchTradeId(trade = {}, sequence = 1) {
  const sequenceValue = Number.isFinite(Number(sequence)) && Number(sequence) > 0
    ? Math.round(Number(sequence))
    : 1;
  const sequenceLabel = String(sequenceValue).padStart(4, "0");
  const entryLabel = formatTradeTimestampSegment(trade?.ts || trade?.entryTs || trade?.signalTs || "");
  const strategyLabel = sanitizeTradeIdSegment(trade?.strat || trade?.strategy || "TRADE").slice(0, 12);
  const directionLabel = String(trade?.dir || "").trim().toLowerCase() === "short" ? "S" : "L";
  const optionTicker = String(trade?.optionTicker || "").trim().toUpperCase().replace(/^O:/, "");
  if (optionTicker) {
    return `BT-${sequenceLabel}-${entryLabel}-${strategyLabel}-${directionLabel}-${sanitizeTradeIdSegment(optionTicker).slice(0, 32)}`;
  }

  const expiryLabel = sanitizeTradeIdSegment(String(trade?.expiryDate || "").replace(/-/g, ""), "NOEXP");
  const optionRight = trade?.ic === false ? "P" : "C";
  const strike = Number.isFinite(Number(trade?.k))
    ? String(Math.round(Number(trade.k) * 1000)).padStart(8, "0")
    : "NOSTRIKE";
  return `BT-${sequenceLabel}-${entryLabel}-${strategyLabel}-${directionLabel}-${expiryLabel}-${optionRight}-${strike}`;
}

export function getResearchTradeSelectionId(trade = {}) {
  const stableTradeId = String(trade?.tradeId || trade?.tradeSelectionId || trade?.id || "").trim();
  if (stableTradeId) {
    return stableTradeId;
  }
  const qty = Number.isFinite(Number(trade?.qty)) ? Number(trade.qty) : 0;
  const entryOption = Number.isFinite(Number(trade?.oe)) ? Number(trade.oe).toFixed(4) : "";
  const pnl = Number.isFinite(Number(trade?.pnl)) ? Number(trade.pnl).toFixed(2) : "";
  const strike = Number.isFinite(Number(trade?.k)) ? Number(trade.k).toFixed(2) : "";
  return [
    trade?.ts || "",
    trade?.et || "",
    trade?.strat || "",
    trade?.dir || "",
    qty,
    entryOption,
    trade?.optionTicker || "",
    trade?.expiryDate || "",
    strike,
    pnl,
  ].join("|");
}
