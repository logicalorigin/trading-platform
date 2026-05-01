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

const buildSectorRows = (positions) => {
  const sectors = new Map();
  positions.forEach((position) => {
    const sector = position.sector || "Unknown";
    const current = sectors.get(sector) || {
      sector,
      value: 0,
      weightPercent: null,
    };
    current.value += finiteNumber(position.marketValue) ?? 0;
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
      marketValue: finiteNumber(position.marketValue) ?? 0,
      weightPercent: finiteNumber(position.weightPercent),
      unrealizedPnl: finiteNumber(position.unrealizedPnl) ?? 0,
      sector: position.sector || "Unknown",
    }))
    .sort((left, right) => Math.abs(right.marketValue) - Math.abs(left.marketValue));

const buildExpiryConcentrationFromPositions = (positions) => {
  const optionRows = positions.filter((position) => position.optionContract);
  if (!optionRows.length) {
    return {
      thisWeek: 0,
      thisMonth: 0,
      next90Days: 0,
    };
  }

  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const month = now + 30 * 86_400_000;
  const ninety = now + 90 * 86_400_000;
  const buckets = {
    thisWeek: 0,
    thisMonth: 0,
    next90Days: 0,
  };

  optionRows.forEach((position) => {
    const expiry = new Date(position.optionContract.expirationDate).getTime();
    if (!Number.isFinite(expiry)) {
      return;
    }
    const notional = Math.abs(finiteNumber(position.marketValue) ?? 0);
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
  const openSymbols = new Set(openPositions.map((position) => normalizeKey(position.symbol)));
  const openUnderlyings = new Set(
    openPositions.map((position) => normalizeKey(positionReferenceSymbol(position))),
  );
  const perUnderlying = (riskData.greeks?.perUnderlying || []).filter((row) => {
    const key = normalizeKey(row.underlying);
    return openUnderlyings.has(key) || openSymbols.has(key);
  });

  return {
    ...riskData,
    concentration: {
      ...(riskData.concentration || {}),
      topPositions: currentRows.slice(0, 5),
      sectors: buildSectorRows(openPositions),
    },
    winnersLosers: {
      ...(riskData.winnersLosers || {}),
      todayWinners: currentRows
        .filter((row) => row.unrealizedPnl > 0)
        .sort((left, right) => right.unrealizedPnl - left.unrealizedPnl)
        .slice(0, 5),
      todayLosers: currentRows
        .filter((row) => row.unrealizedPnl < 0)
        .sort((left, right) => left.unrealizedPnl - right.unrealizedPnl)
        .slice(0, 5),
    },
    greeks: {
      ...(riskData.greeks || {}),
      perUnderlying,
    },
    expiryConcentration: buildExpiryConcentrationFromPositions(openPositions),
  };
};
