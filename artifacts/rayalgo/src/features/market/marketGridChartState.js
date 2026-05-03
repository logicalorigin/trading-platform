import { RAY_REPLICA_PINE_SCRIPT_KEY } from "../charting/rayReplicaPineAdapter";
import {
  mergeIndicatorSelections,
  normalizeIndicatorSelection,
} from "../charting/chartIndicatorPersistence";
import { normalizeTickerSymbol } from "../platform/tickerIdentity";

export const DEFAULT_MINI_CHART_STUDIES = [
  RAY_REPLICA_PINE_SCRIPT_KEY,
  "ema-21",
  "vwap",
];

export const normalizeMiniChartStudies = (
  value,
  includeRayReplicaByDefault = false,
) => {
  const normalized = normalizeIndicatorSelection(
    value,
    DEFAULT_MINI_CHART_STUDIES,
  );
  return includeRayReplicaByDefault
    ? mergeIndicatorSelections([RAY_REPLICA_PINE_SCRIPT_KEY], normalized)
    : normalized;
};

export const buildMarketBarsPageQueryKey = ({
  queryBase,
  timeframe,
  limit,
  from,
  to,
  market = null,
  assetClass = null,
  providerContractId = null,
  historyCursor = null,
  preferCursor = false,
}) => [
  ...queryBase,
  timeframe,
  limit,
  from,
  to,
  market,
  assetClass,
  providerContractId,
  historyCursor,
  Boolean(preferCursor),
];

export const buildMarketGridVisibleRangeSignature = (range) => {
  if (!range || typeof range !== "object") {
    return "";
  }
  const from = Number.isFinite(range.from) ? range.from : null;
  const to = Number.isFinite(range.to) ? range.to : null;
  return `${from ?? ""}:${to ?? ""}`;
};

export const buildMarketGridViewportIdentity = (slotIndex, slot = {}) => {
  const ticker = normalizeTickerSymbol(slot?.ticker) || "SPY";
  const timeframe = String(slot?.tf || "15m").trim() || "15m";
  const market = String(slot?.market || "stocks").trim() || "stocks";
  const provider = String(
    slot?.provider ||
      slot?.tradeProvider ||
      slot?.dataProviderPreference ||
      "",
  ).trim();
  const contractId = String(slot?.providerContractId || "").trim();
  return [
    "market-grid",
    Number.isFinite(slotIndex) ? slotIndex : 0,
    ticker,
    timeframe,
    market,
    provider,
    contractId,
  ].join("|");
};

export const buildMarketGridViewportRevisionIdentity = (
  slotIndex,
  slot,
  revision = 0,
) =>
  `${buildMarketGridViewportIdentity(slotIndex, slot)}|revision:${
    Number.isFinite(revision) ? revision : 0
  }`;

export const deleteMarketGridViewportSnapshots = (snapshots, identityKey) => {
  if (!snapshots || typeof snapshots !== "object" || !identityKey) {
    return false;
  }
  let changed = false;
  const revisionPrefix = `${identityKey}|revision:`;
  Object.keys(snapshots).forEach((key) => {
    if (key === identityKey || key.startsWith(revisionPrefix)) {
      delete snapshots[key];
      changed = true;
    }
  });
  return changed;
};
