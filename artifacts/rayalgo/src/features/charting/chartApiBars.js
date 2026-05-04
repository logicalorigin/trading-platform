import { useQuery } from "@tanstack/react-query";
import { getBars as getBarsRequest } from "@workspace/api-client-react";
import {
  DISPLAY_CHART_OUTSIDE_RTH,
  DISPLAY_CHART_PRICE_TIMEFRAME,
} from "./displayChartSession";
import { measureChartBarsRequest } from "./chartHydrationRuntime";
import {
  BARS_QUERY_DEFAULTS,
  BARS_REQUEST_PRIORITY,
  buildBarsRequestOptions,
} from "../platform/queryDefaults";

const DISPLAY_CHART_PRICE_QUERY_DEFAULTS = {
  ...BARS_QUERY_DEFAULTS,
  staleTime: 60_000,
  refetchOnMount: true,
};

export const resolveApiBarTimestampMs = (value) => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

export const buildChartBarsFromApi = (bars) =>
  (bars || []).reduce((result, bar, index) => {
    const timeMs = resolveApiBarTimestampMs(
      bar?.timestamp ?? bar?.ts ?? bar?.time,
    );
    if (timeMs == null) {
      return result;
    }

    result.push({
      time: timeMs,
      timestamp: timeMs,
      ts:
        typeof bar?.timestamp === "string"
          ? bar.timestamp
          : typeof bar?.ts === "string"
            ? bar.ts
            : new Date(timeMs).toISOString(),
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume,
      vwap: Number.isFinite(bar?.vwap) ? bar.vwap : null,
      sessionVwap: Number.isFinite(bar?.sessionVwap)
        ? bar.sessionVwap
        : null,
      accumulatedVolume: Number.isFinite(bar?.accumulatedVolume)
        ? bar.accumulatedVolume
        : null,
      averageTradeSize: Number.isFinite(bar?.averageTradeSize)
        ? bar.averageTradeSize
        : null,
      source: typeof bar?.source === "string" ? bar.source : null,
      freshness: typeof bar?.freshness === "string" ? bar.freshness : null,
      marketDataMode:
        typeof bar?.marketDataMode === "string" ? bar.marketDataMode : null,
      dataUpdatedAt: bar?.dataUpdatedAt ?? null,
      ageMs: Number.isFinite(bar?.ageMs) ? bar.ageMs : null,
      delayed: Boolean(bar?.delayed),
      i: index,
      uoa: 0,
    });
    return result;
  }, []);

export const buildMiniChartBarsFromApi = (bars) => buildChartBarsFromApi(bars);

export const buildTradeBarsFromApi = (bars) => buildChartBarsFromApi(bars);

export const describeBrokerChartSource = (source) => {
  if (typeof source === "string" && source.endsWith(":rollup")) {
    const baseSource = source.replace(/:rollup$/, "");
    const baseLabel = describeBrokerChartSource(baseSource);
    return baseLabel ? `${baseLabel} ROLL` : "ROLL";
  }
  if (source === "ibkr-websocket-derived") return "WS";
  if (source === "polygon-delayed-websocket") return "DELAYED WS";
  if (source === "ibkr-option-quote-derived") return "LIVE";
  if (source === "ibkr+massive-gap-fill") return "IBKR + GAP";
  if (source === "ibkr-history") return "IBKR";
  return source ? "REST" : "";
};

export const describeBrokerChartStatus = (status, timeframe) =>
  status === "live" ? `IBKR ${timeframe}` : status;

const intradayTimeframes = new Set(["5s", "1m", "5m", "15m", "1h"]);

const normalizeText = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const resolveBrokerChartSourceState = ({
  latestBar,
  status,
  timeframe,
  streamingEnabled = false,
  market = "stocks",
  nowMs = Date.now(),
} = {}) => {
  const source = normalizeText(latestBar?.source);
  const freshness = normalizeText(latestBar?.freshness);
  const marketDataMode = normalizeText(latestBar?.marketDataMode);
  const sourceLabel = describeBrokerChartSource(latestBar?.source);
  const dataUpdatedAtMs = resolveApiBarTimestampMs(latestBar?.dataUpdatedAt);
  const ageMs = Number.isFinite(latestBar?.ageMs)
    ? latestBar.ageMs
    : dataUpdatedAtMs != null
      ? Math.max(0, nowMs - dataUpdatedAtMs)
      : null;
  const isIntraday = intradayTimeframes.has(normalizeText(timeframe));
  const isEquityLike = ["stocks", "etf", "otc", "indices"].includes(
    normalizeText(market),
  );
  const statusText = normalizeText(status);

  if (!latestBar) {
    return {
      state: statusText === "loading" ? "loading" : "empty",
      label: statusText === "loading" ? "LOADING" : "NO DATA",
      shortLabel: statusText === "loading" ? "LOAD" : "EMPTY",
      detail: statusText === "loading" ? "Chart bars are loading" : "No chart bars are hydrated",
      tone: statusText === "loading" ? "info" : "muted",
      sourceLabel: "",
      freshness,
      marketDataMode,
      ageMs,
      dataUpdatedAtMs,
      isRealtime: false,
      isDelayed: false,
      isStale: false,
      isFallback: false,
      isDegraded: false,
    };
  }

  const isDelayed =
    Boolean(latestBar.delayed) ||
    freshness === "delayed" ||
    marketDataMode === "delayed" ||
    source.includes("delayed") ||
    source.includes("polygon");
  const isFallback =
    source.includes("massive") ||
    source.includes("gap-fill") ||
    source.includes("polygon");
  const isStale =
    freshness === "stale" ||
    marketDataMode === "stale" ||
    statusText === "stale";
  const isIbkr =
    source.startsWith("ibkr") ||
    marketDataMode === "live" ||
    sourceLabel === "IBKR" ||
    sourceLabel === "WS" ||
    sourceLabel === "LIVE";
  const isRealtime =
    !isDelayed &&
    !isStale &&
    (source === "ibkr-websocket-derived" ||
      source === "ibkr-option-quote-derived" ||
      (source !== "ibkr-history" &&
        isIbkr &&
        marketDataMode === "live" &&
        freshness !== "stale"));
  const historicalButExpectedLive =
    Boolean(streamingEnabled && isEquityLike && isIntraday && source === "ibkr-history");
  const isDegraded = isStale || isDelayed || isFallback || historicalButExpectedLive;

  let state = "historical";
  let label = sourceLabel || "REST";
  let shortLabel = label;
  let tone = "muted";

  if (isRealtime) {
    state = "live";
    label = source === "ibkr-websocket-derived" ? "IBKR WS" : "IBKR LIVE";
    shortLabel = source === "ibkr-websocket-derived" ? "WS" : "LIVE";
    tone = "good";
  } else if (isStale) {
    state = "stale";
    label = "STALE";
    shortLabel = "STALE";
    tone = "warn";
  } else if (isDelayed) {
    state = "delayed";
    label = "DELAYED";
    shortLabel = "DELAY";
    tone = "warn";
  } else if (source === "ibkr-history") {
    state = historicalButExpectedLive ? "degraded" : "historical";
    label = "IBKR HIST";
    shortLabel = "HIST";
    tone = historicalButExpectedLive ? "warn" : "neutral";
  } else if (source === "ibkr+massive-gap-fill") {
    state = "fallback";
    label = "IBKR + GAP";
    shortLabel = "GAP";
    tone = "warn";
  } else if (sourceLabel) {
    state = sourceLabel === "REST" ? "historical" : "source";
    tone = sourceLabel === "REST" ? "muted" : "neutral";
  }

  const detailParts = [
    label,
    timeframe ? `${timeframe} bars` : null,
    freshness ? `freshness ${freshness}` : null,
    marketDataMode ? `mode ${marketDataMode}` : null,
    ageMs != null ? `age ${formatChartSourceAge(ageMs)}` : null,
    historicalButExpectedLive ? "stream expected" : null,
  ].filter(Boolean);

  return {
    state,
    label,
    shortLabel,
    detail: detailParts.join(" / "),
    tone,
    sourceLabel,
    freshness,
    marketDataMode,
    ageMs,
    dataUpdatedAtMs,
    isRealtime,
    isDelayed,
    isStale,
    isFallback,
    isDegraded,
  };
};

const formatChartSourceAge = (ageMs) => {
  if (!Number.isFinite(ageMs) || ageMs < 0) return "";
  if (ageMs < 60_000) return `${Math.max(0, Math.round(ageMs / 1000))}s`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m`;
  return `${Math.round(ageMs / 3_600_000)}h`;
};

const normalizeChartSymbol = (value) => value?.trim?.().toUpperCase?.() || "";

export const useDisplayChartPriceFallbackBars = ({
  symbol,
  market,
  providerContractId,
  enabled,
  scopeKey,
  priority = BARS_REQUEST_PRIORITY.visible,
  metric = "displayPriceRequestMs",
}) => {
  const normalizedSymbol = normalizeChartSymbol(symbol);
  const normalizedMarket = market || null;
  const normalizedProviderContractId = providerContractId || null;

  return useQuery({
    queryKey: [
      "display-chart-price-bars",
      normalizedSymbol,
      normalizedMarket,
      normalizedProviderContractId,
    ],
    queryFn: () =>
      measureChartBarsRequest({
        scopeKey,
        metric,
        request: () =>
          getBarsRequest(
            {
              symbol: normalizedSymbol,
              timeframe: DISPLAY_CHART_PRICE_TIMEFRAME,
              limit: 2,
              market: normalizedMarket || undefined,
              outsideRth: DISPLAY_CHART_OUTSIDE_RTH,
              source: "trades",
              allowHistoricalSynthesis: true,
              providerContractId: normalizedProviderContractId || undefined,
            },
            buildBarsRequestOptions(priority),
          ),
      }),
    enabled: Boolean(enabled && normalizedSymbol),
    ...DISPLAY_CHART_PRICE_QUERY_DEFAULTS,
  });
};
