function normalizeOptionTickerCandidate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  if (/^O:/i.test(text)) {
    return text.toUpperCase();
  }
  return null;
}

export function parseOptionTicker(value) {
  const normalized = normalizeOptionTickerCandidate(value);
  if (!normalized) {
    return null;
  }

  const match = /^O:([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(normalized);
  if (!match) {
    return null;
  }

  const [, root, yy, mm, dd, rightCode, strikeCode] = match;
  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  const strike = Number(strikeCode) / 1000;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(strike) || strike <= 0) {
    return null;
  }

  return {
    optionTicker: normalized,
    root,
    expiry: year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
    rightCode,
    right: rightCode === "C" ? "call" : "put",
    strike,
  };
}

export function buildOptionTicker(contract, fallbackSymbol) {
  const source = contract && typeof contract === "object" ? contract : {};
  const directCandidates = [
    source.optionTicker,
    source.contractSymbol,
    source.occSymbol,
    source.occ,
    source.symbol,
    source.contractId,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeOptionTickerCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const root = String(source.symbol || source.underlying || fallbackSymbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 6);
  const expiry = String(source.expiry || "").trim();
  const strike = Number(source.strike);
  const right = String(source.right || "").trim().toUpperCase();

  if (!root || !/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(strike) || strike <= 0 || !right) {
    return null;
  }

  const yymmdd = expiry.slice(2).replace(/-/g, "");
  const cp = right.startsWith("P") ? "P" : "C";
  const strikeScaled = Math.round(strike * 1000);
  if (!Number.isFinite(strikeScaled) || strikeScaled < 0) {
    return null;
  }

  return "O:" + root + yymmdd + cp + String(strikeScaled).padStart(8, "0");
}
