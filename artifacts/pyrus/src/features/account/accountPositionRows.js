const POSITION_QUANTITY_EPSILON = 1e-9;

export const finiteNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export const isOpenPositionRow = (row) => {
  const quantity = finiteNumber(row?.quantity);
  return quantity == null || Math.abs(quantity) > POSITION_QUANTITY_EPSILON;
};

export const getOpenPositionRows = (positions = []) =>
  positions.filter(isOpenPositionRow);

const normalizeKey = (value) => String(value || "").trim().toUpperCase();

const positionReferenceSymbol = (position) =>
  position?.optionContract?.underlying || position?.symbol || "";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ACCOUNT_MARKET_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const calendarDayMs = (year, monthIndex, day) => {
  const timestamp = Date.UTC(year, monthIndex, day);
  const date = new Date(timestamp);
  return year >= 1000 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === monthIndex &&
    date.getUTCDate() === day
    ? timestamp
    : null;
};

export const accountExpirationConcentrationMs = (value) => {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    const match = DATE_ONLY_RE.exec(value.trim());
    if (match) {
      const year = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      const day = Number(match[3]);
      return calendarDayMs(year, monthIndex, day);
    }
  }

  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = ACCOUNT_MARKET_DATE_FORMATTER.formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);
  return calendarDayMs(read("year"), read("month") - 1, read("day"));
};

const buildSectorRows = (positions) => {
  const sectors = new Map();
  positions.forEach((position) => {
    const sector = position.sector || "Unknown";
    const current = sectors.get(sector) || {
      sector,
      value: 0,
      weightPercent: null,
    };
    current.value += finiteNumber(position.marketValue);
    const weight = finiteNumber(position.weightPercent);
    if (weight != null) {
      current.weightPercent = (current.weightPercent ?? 0) + weight;
    }
    sectors.set(sector, current);
  });

  return Array.from(sectors.values()).sort(
    (left, right) => Math.abs(right.value) - Math.abs(left.value),
  );
};

const buildRiskRowsFromPositions = (positions) =>
  positions
    .map((position) => ({
      symbol: position.symbol,
      marketValue: finiteNumber(position.marketValue),
      weightPercent: finiteNumber(position.weightPercent),
      unrealizedPnl: finiteNumber(position.unrealizedPnl),
      sector: position.sector || "Unknown",
    }))
    .sort(
      (left, right) =>
        Math.abs(right.marketValue ?? 0) - Math.abs(left.marketValue ?? 0),
    );

const buildExpiryConcentrationFromPositions = (positions) => {
  const optionRows = positions.filter((position) => position.optionContract);
  if (!optionRows.length) {
    return {
      thisWeek: 0,
      thisMonth: 0,
      next90Days: 0,
    };
  }

  const now = accountExpirationConcentrationMs(new Date(Date.now()));
  if (now == null) return null;
  const week = now + 7 * 86_400_000;
  const month = now + 30 * 86_400_000;
  const ninety = now + 90 * 86_400_000;
  const buckets = {
    thisWeek: 0,
    thisMonth: 0,
    next90Days: 0,
  };

  optionRows.forEach((position) => {
    const expiry = accountExpirationConcentrationMs(
      position.optionContract.expirationDate,
    );
    if (expiry == null) {
      buckets.incomplete = true;
      return;
    }
    if (expiry < now) {
      return;
    }
    const marketValue = finiteNumber(position.marketValue);
    if (marketValue == null) {
      buckets.incomplete = true;
      return;
    }
    const notional = Math.abs(marketValue);
    if (expiry <= week) {
      buckets.thisWeek += notional;
    }
    if (expiry <= month) {
      buckets.thisMonth += notional;
    }
    if (expiry <= ninety) {
      buckets.next90Days += notional;
    }
  });

  if (buckets.incomplete) return null;
  delete buckets.incomplete;
  return buckets;
};

export const buildAccountRiskDisplayModel = (riskData, positionsResponse) => {
  if (!riskData) {
    return riskData;
  }

  if (!Array.isArray(positionsResponse?.positions)) {
    return riskData;
  }

  const openPositions = getOpenPositionRows(positionsResponse.positions);
  const currentRows = buildRiskRowsFromPositions(openPositions);
  const hasCompleteMarketValues = currentRows.every(
    (row) => row.marketValue != null,
  );
  const hasCompleteWeights = currentRows.every(
    (row) => row.weightPercent != null,
  );
  const hasCompleteUnrealizedPnl = currentRows.every(
    (row) => row.unrealizedPnl != null,
  );
  const openSymbols = new Set(openPositions.map((position) => normalizeKey(position.symbol)));
  const openUnderlyings = new Set(
    openPositions.map((position) => normalizeKey(positionReferenceSymbol(position))),
  );
  const hasCompleteGreekReferences = openPositions.every((position) =>
    normalizeKey(positionReferenceSymbol(position)),
  );
  const perUnderlying = hasCompleteGreekReferences
    ? (riskData.greeks?.perUnderlying || []).filter((row) => {
        const key = normalizeKey(row.underlying);
        return openUnderlyings.has(key) || openSymbols.has(key);
      })
    : riskData.greeks?.perUnderlying || [];

  return {
    ...riskData,
    concentration: hasCompleteMarketValues && hasCompleteWeights
      ? {
          ...(riskData.concentration || {}),
          topPositions: currentRows.slice(0, 5),
          sectors: buildSectorRows(openPositions),
        }
      : riskData.concentration,
    winnersLosers: hasCompleteUnrealizedPnl
      ? {
          ...(riskData.winnersLosers || {}),
          todayWinners: currentRows
            .filter((row) => row.unrealizedPnl > 0)
            .sort((left, right) => right.unrealizedPnl - left.unrealizedPnl)
            .slice(0, 5),
          todayLosers: currentRows
            .filter((row) => row.unrealizedPnl < 0)
            .sort((left, right) => left.unrealizedPnl - right.unrealizedPnl)
            .slice(0, 5),
        }
      : riskData.winnersLosers,
    greeks: {
      ...(riskData.greeks || {}),
      perUnderlying,
    },
    expiryConcentration:
      buildExpiryConcentrationFromPositions(openPositions) ??
      riskData.expiryConcentration,
  };
};
