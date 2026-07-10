import { asRecord } from "./algoHelpers";

const normalizeIdentity = (value) => String(value ?? "").trim();

const rowDeploymentIds = (row) => {
  const attribution = Array.isArray(row?.sourceAttribution)
    ? row.sourceAttribution
    : [];
  return Array.from(
    new Set(
      [
        row?.deploymentId,
        row?.sourceDeploymentId,
        ...attribution.map((item) => asRecord(item).deploymentId),
      ]
        .map(normalizeIdentity)
        .filter(Boolean),
    ),
  );
};

export const filterAccountPositionRowsForDeployment = ({
  rows = [],
  deploymentId = null,
} = {}) => {
  const normalizedDeploymentId = normalizeIdentity(deploymentId);
  return normalizedDeploymentId
    ? (rows || []).filter((row) =>
        rowDeploymentIds(row).includes(normalizedDeploymentId),
      )
    : rows || [];
};

export const buildAlgoAccountPositionsResponse = (rows = []) => {
  const rowWeights = rows
    .map((row) => Number(row.weightPercent))
    .filter(Number.isFinite);
  const totals = rows.reduce(
    (acc, row) => {
      const marketValue = Number(row.marketValue);
      const unrealizedPnl = Number(row.unrealizedPnl);
      const dayChange = Number(row.dayChange);
      if (Number.isFinite(marketValue)) {
        acc.netExposure += marketValue;
        if (marketValue >= 0) acc.grossLong += marketValue;
        else acc.grossShort += marketValue;
      }
      if (Number.isFinite(unrealizedPnl)) acc.unrealizedPnl += unrealizedPnl;
      if (Number.isFinite(dayChange)) acc.dayChange += dayChange;
      return acc;
    },
    {
      netExposure: 0,
      grossLong: 0,
      grossShort: 0,
      unrealizedPnl: 0,
      dayChange: 0,
      weightPercent: rowWeights.length
        ? rowWeights.reduce((sum, value) => sum + value, 0)
        : null,
    },
  );

  return { positions: rows, totals };
};
