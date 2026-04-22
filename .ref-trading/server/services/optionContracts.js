const CONTRACT_ID_PATTERN = /^(.+)-(\d{4}-\d{2}-\d{2})-([0-9]+(?:\.[0-9]+)?)-(call|put)$/i;

export function buildOptionContractId(contract) {
  const normalized = normalizeOptionContractPayload(contract);
  if (!normalized) {
    return null;
  }
  return `${normalized.symbol}-${normalized.expiry}-${stripTrailingZeros(normalized.strike)}-${normalized.right}`;
}

export function parseOptionContractId(contractId) {
  if (contractId == null || contractId === "") {
    return null;
  }
  const text = String(contractId).trim();
  if (!text) {
    return null;
  }
  const match = text.match(CONTRACT_ID_PATTERN);
  if (!match) {
    return null;
  }
  const strike = Number(match[3]);
  if (!Number.isFinite(strike) || strike <= 0) {
    return null;
  }
  return {
    symbol: match[1].toUpperCase(),
    expiry: match[2],
    strike: stripToStrikePrecision(strike),
    right: match[4].toLowerCase(),
    contractId: `${match[1].toUpperCase()}-${match[2]}-${stripTrailingZeros(strike)}-${match[4].toLowerCase()}`,
  };
}

export function normalizeOptionContractPayload(payload, defaults = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const fallback = defaults && typeof defaults === "object" ? defaults : {};
  const fromId = parseOptionContractId(
    source.contractId
    || source.optionContractId
    || source.option_id
    || fallback.contractId
    || fallback.optionContractId,
  );

  const symbol = firstNonEmptyValue(
    source.symbol,
    source.underlying,
    source.underlyingSymbol,
    fromId?.symbol,
    fallback.symbol,
  );
  const expiry = normalizeIsoDate(
    firstNonEmptyValue(
      source.expiry,
      source.expiration,
      source.expirationDate,
      source.expiryDate,
      fromId?.expiry,
      fallback.expiry,
    ),
  );
  const strike = normalizeStrike(
    firstFiniteNumber(
      source.strike,
      source.strikePrice,
      source.exercisePrice,
      fromId?.strike,
      fallback.strike,
    ),
  );
  const right = normalizeRight(
    firstNonEmptyValue(
      source.right,
      source.callPut,
      source.putCall,
      source.optionType,
      fromId?.right,
      fallback.right,
    ),
  );

  if (!symbol || !expiry || !Number.isFinite(strike) || !right) {
    return null;
  }

  const normalized = {
    symbol: symbol.toUpperCase(),
    expiry,
    strike,
    right,
  };

  return {
    ...normalized,
    contractId: `${normalized.symbol}-${normalized.expiry}-${stripTrailingZeros(normalized.strike)}-${normalized.right}`,
  };
}

function normalizeIsoDate(value) {
  if (value == null || value === "") {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    const ms = numeric > 100000000000 ? numeric : numeric * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeRight(value) {
  if (value == null || value === "") {
    return null;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) {
    return null;
  }
  if (text.startsWith("c")) {
    return "call";
  }
  if (text.startsWith("p")) {
    return "put";
  }
  return null;
}

function normalizeStrike(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return stripToStrikePrecision(numeric);
}

function stripToStrikePrecision(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function stripTrailingZeros(value) {
  return Number(value).toString();
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function firstNonEmptyValue(...values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }
    const text = String(value).trim();
    if (text) {
      return text;
    }
  }
  return null;
}
