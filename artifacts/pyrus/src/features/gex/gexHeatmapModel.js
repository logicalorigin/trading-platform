import {
  contractGex,
  formatGexStrikePrice,
  isGexHalfDollarStrike,
  isFiniteNumber,
} from "./gexModel.js";
import {
  formatGexDteLabel,
  formatGexExpirationHeaderLabel,
  marketDayDistanceFromExpirationKey,
} from "./gexDate.js";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HEATMAP_EXPIRATION_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export const normalizeHeatmapExpirationKey = (value) => {
  const match = String(value || "").match(ISO_DATE_RE);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
};

export const heatmapExpirationIso = (key) => {
  const normalized = normalizeHeatmapExpirationKey(key);
  return normalized ? `${normalized}T00:00:00.000Z` : "";
};

const parseHeatmapExpirationDate = (key) => {
  const normalized = normalizeHeatmapExpirationKey(key);
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatHeatmapExpirationLabel = (key) => {
  const date = parseHeatmapExpirationDate(key);
  return date ? HEATMAP_EXPIRATION_FORMATTER.format(date) : key;
};

export const formatHeatmapExpirationDte = (key, referenceDate = new Date()) => {
  const days = marketDayDistanceFromExpirationKey(key, referenceDate);
  return formatGexDteLabel(days);
};

const formatScaledCurrency = (value, divisor, suffix) => {
  const scaled = Math.abs(value) / divisor;
  return `${scaled.toFixed(1)}${suffix}`;
};

const finiteOrZero = (value) => (isFiniteNumber(value) ? value : 0);

const normalizeHeatmapRight = (value) => {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "C" || normalized === "CALL") return "C";
  if (normalized === "P" || normalized === "PUT") return "P";
  return "";
};

const cloneHeatmapCellStats = (stats) => ({
  netGex: finiteOrZero(stats?.netGex),
  callGex: finiteOrZero(stats?.callGex),
  putGex: finiteOrZero(stats?.putGex),
  callOi: Math.max(0, finiteOrZero(stats?.callOi)),
  putOi: Math.max(0, finiteOrZero(stats?.putOi)),
});

export const formatHeatmapCellValue = (value) => {
  if (!isFiniteNumber(value)) return "$0.0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs === 0) return "$0.0";
  if (abs >= 1_000_000_000) {
    return `${sign}$${formatScaledCurrency(value, 1_000_000_000, "B")}`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${formatScaledCurrency(value, 1_000_000, "M")}`;
  }
  if (abs >= 1_000) {
    return `${sign}$${formatScaledCurrency(value, 1_000, "K")}`;
  }
  return `${sign}$${abs.toFixed(1)}`;
};

export const formatHeatmapStrikeLabel = (strike) => {
  return formatGexStrikePrice(strike);
};

export const buildGexHeatmapModel = (rows = [], spot, referenceDate = new Date()) => {
  const expirationKeys = new Set();
  const cellMap = new Map();
  const cellStatsMap = new Map();

  if (!isFiniteNumber(spot) || spot <= 0) {
    return {
      expirations: [],
      strikes: [],
      cellMap,
      cellStatsMap,
      maxAbs: 0,
      firstExpirationKey: "",
    };
  }

  rows.forEach((row) => {
    const key = normalizeHeatmapExpirationKey(row?.expirationDate);
    const strike = row?.strike;
    const right = normalizeHeatmapRight(row?.cp);
    if (!key || !isFiniteNumber(strike) || !isGexHalfDollarStrike(strike) || !right) return;

    expirationKeys.add(key);
    const value = contractGex(row, spot);
    const openInterest = Math.max(0, finiteOrZero(row?.openInterest));

    const strikeMap = cellMap.get(strike) || new Map();
    const statsMap = cellStatsMap.get(strike) || new Map();
    const stats = cloneHeatmapCellStats(statsMap.get(key));

    stats.netGex += value;
    if (right === "C") {
      stats.callGex += value;
      stats.callOi += openInterest;
    } else if (right === "P") {
      stats.putGex += value;
      stats.putOi += openInterest;
    }

    strikeMap.set(key, stats.netGex);
    statsMap.set(key, stats);
    cellMap.set(strike, strikeMap);
    cellStatsMap.set(strike, statsMap);
  });

  const keys = Array.from(expirationKeys).sort();
  const firstExpirationKey = keys[0] || "";
  let maxAbs = 0;
  cellMap.forEach((strikeMap) => {
    strikeMap.forEach((value) => {
      maxAbs = Math.max(maxAbs, Math.abs(value));
    });
  });

  return {
    expirations: keys.map((key) => {
      const dateLabel = formatHeatmapExpirationLabel(key);
      const days = marketDayDistanceFromExpirationKey(key, referenceDate);
      return {
        key,
        label: formatGexExpirationHeaderLabel(dateLabel, days),
        dateLabel: formatGexExpirationHeaderLabel(dateLabel, days),
        dteLabel: formatGexDteLabel(days),
        iso: heatmapExpirationIso(key),
        daysToExpiration: days,
      };
    }),
    strikes: Array.from(cellMap.keys()).sort((left, right) => left - right),
    cellMap,
    cellStatsMap,
    maxAbs,
    firstExpirationKey,
  };
};

export const getGexHeatmapCellValue = (model, strike, expirationKey) =>
  model?.cellMap?.get(strike)?.get(expirationKey) || 0;

export const hasGexHeatmapCellValue = (model, strike, expirationKey) =>
  Boolean(model?.cellMap?.get(strike)?.has(expirationKey));

export const getGexHeatmapCellStats = (model, strike, expirationKey) =>
  cloneHeatmapCellStats(model?.cellStatsMap?.get(strike)?.get(expirationKey));

export const buildGexHeatmapCellTitle = ({
  strike,
  expiration,
  value,
  valueLabel,
  stats,
}) => {
  const expirationIso = expiration?.iso || heatmapExpirationIso(expiration?.key);
  const cellStats = cloneHeatmapCellStats(stats);
  const callLabel = formatHeatmapCellValue(cellStats.callGex);
  const putLabel = formatHeatmapCellValue(cellStats.putGex);
  const callOiLabel = Math.round(cellStats.callOi).toLocaleString("en-US");
  const putOiLabel = Math.round(cellStats.putOi).toLocaleString("en-US");
  return `${formatHeatmapStrikeLabel(strike)} · ${expirationIso} · Net GEX ${valueLabel || formatHeatmapCellValue(value)} · Call GEX ${callLabel} (${callOiLabel} OI) · Put GEX ${putLabel} (${putOiLabel} OI)`;
};
