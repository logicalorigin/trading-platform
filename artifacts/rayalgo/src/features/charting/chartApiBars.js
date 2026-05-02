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
