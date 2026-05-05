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

const MARKET_GRID_EQUITY_LIKE_MARKETS = new Set([
  "stocks",
  "etf",
  "otc",
  "indices",
]);

export const normalizeMarketGridSlotMarket = (slot = {}) =>
  String(slot?.market || "stocks").trim() || "stocks";

export const isMarketGridEquityLikeChartMarket = (market) =>
  MARKET_GRID_EQUITY_LIKE_MARKETS.has(
    String(market || "stocks").trim() || "stocks",
  );

export const shouldUseMarketGridProviderContractIdentity = (slot = {}) =>
  !isMarketGridEquityLikeChartMarket(normalizeMarketGridSlotMarket(slot));

export const resolveMarketGridChartProviderContractId = (slot = {}) => {
  const providerContractId = String(slot?.providerContractId || "").trim();
  return shouldUseMarketGridProviderContractIdentity(slot) && providerContractId
    ? providerContractId
    : null;
};

export const buildMarketGridViewportIdentity = (slotIndex, slot = {}) => {
  const ticker = normalizeTickerSymbol(slot?.ticker) || "SPY";
  const timeframe = String(slot?.tf || "15m").trim() || "15m";
  const market = normalizeMarketGridSlotMarket(slot);
  const useProviderIdentity = shouldUseMarketGridProviderContractIdentity(slot);
  const provider = useProviderIdentity
    ? String(
        slot?.provider ||
          slot?.tradeProvider ||
          slot?.dataProviderPreference ||
          "",
      ).trim()
    : "";
  const contractId = resolveMarketGridChartProviderContractId(slot) || "";
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
