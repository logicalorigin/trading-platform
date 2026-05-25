const EXACT_STRIKE_TOLERANCE = 0.000001;
export const FLOW_OPTION_STRIKE_MATCH_TOLERANCE = 0.01;

const normalizeDateParts = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
};

export function normalizeFlowOptionExpirationIso(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return normalizeDateParts(
        Number(isoMatch[1]),
        Number(isoMatch[2]),
        Number(isoMatch[3]),
      );
    }
    const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactMatch) {
      return normalizeDateParts(
        Number(compactMatch[1]),
        Number(compactMatch[2]),
        Number(compactMatch[3]),
      );
    }
  }

  const date =
    value instanceof Date
      ? value
      : value
        ? new Date(value)
        : null;
  return date && Number.isFinite(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;
}

export function normalizeFlowOptionRight(value, fallback) {
  const normalized = String(value ?? fallback ?? "")
    .trim()
    .toUpperCase();
  if (normalized === "CALL" || normalized === "C") {
    return "call";
  }
  if (normalized === "PUT" || normalized === "P") {
    return "put";
  }
  return null;
}

export function normalizeFlowOptionStrike(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findNearestByStrike(candidates, getStrike, targetStrike) {
  let nearest = null;
  let nearestDistance = Infinity;

  for (const candidate of candidates || []) {
    const strike = Number(getStrike(candidate));
    if (!Number.isFinite(strike)) {
      continue;
    }

    const distance = Math.abs(strike - targetStrike);
    if (distance <= EXACT_STRIKE_TOLERANCE) {
      return candidate;
    }
    if (
      distance <= FLOW_OPTION_STRIKE_MATCH_TOLERANCE &&
      distance < nearestDistance
    ) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function findOptionContractForFlowEvent({
  rows = [],
  contracts = [],
  expirationIso,
  strike,
  right,
}) {
  const normalizedRight = normalizeFlowOptionRight(right);
  const normalizedStrike = normalizeFlowOptionStrike(strike);
  if (!normalizedRight || !Number.isFinite(normalizedStrike)) {
    return null;
  }

  const row = findNearestByStrike(rows, (candidate) => candidate?.k, normalizedStrike);
  const rowContract =
    normalizedRight === "put" ? row?.pContract || null : row?.cContract || null;
  if (rowContract?.providerContractId) {
    return rowContract;
  }

  const normalizedExpirationIso =
    normalizeFlowOptionExpirationIso(expirationIso) || null;
  const candidateContracts = (contracts || [])
    .map((candidate) => candidate?.contract || candidate)
    .filter((contract) => {
      if (normalizeFlowOptionRight(contract?.right) !== normalizedRight) {
        return false;
      }
      if (!normalizedExpirationIso) {
        return true;
      }
      return (
        normalizeFlowOptionExpirationIso(contract?.expirationDate) ===
        normalizedExpirationIso
      );
    });

  return (
    findNearestByStrike(
      candidateContracts,
      (contract) => contract?.strike,
      normalizedStrike,
    ) || null
  );
}
