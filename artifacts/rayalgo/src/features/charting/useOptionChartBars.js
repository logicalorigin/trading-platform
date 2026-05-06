import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getOptionChartBars as getOptionChartBarsRequest } from "@workspace/api-client-react";
import {
  buildHydrationRequestOptions,
  HYDRATION_PRIORITY,
  useHydrationIntent,
} from "../platform/hydrationCoordinator";
import {
  expandLocalRollupLimit,
  resolveLocalRollupBaseTimeframe,
  rollupMarketBars,
} from "./timeframeRollups";
import {
  getChartBarLimit,
  getInitialChartBarLimit,
} from "./timeframes";
import {
  useHistoricalBarStreamState,
  useOptionQuotePatchedBars,
  usePrependableHistoricalBars,
} from "./useMassiveStreamedStockBars";
import {
  isChartBarsPayloadCacheStale,
  normalizeChartBarsPagePayload,
  normalizeLatestChartBarsPayload,
} from "./chartBarsPayloads";

export const OPTION_CHART_BARS_QUERY_DEFAULTS = {
  staleTime: 30_000,
  refetchInterval: false,
  refetchOnMount: "always",
  refetchOnReconnect: true,
  refetchOnWindowFocus: true,
  retry: false,
  gcTime: 5 * 60_000,
};

export const normalizeBrokerProviderContractId = (value) => {
  const normalized = value?.trim?.() || "";
  return /^\d+$/.test(normalized) || normalized.startsWith("twsopt:")
    ? normalized
    : null;
};

export const normalizeApiBarForChart = (bar) => ({
  ts: bar.timestamp,
  timestamp: bar.timestamp,
  time: bar.timestamp,
  o: bar.open,
  h: bar.high,
  l: bar.low,
  c: bar.close,
  v: bar.volume,
  source: bar.source || bar.transport || "ibkr-history",
  freshness: bar.freshness,
  marketDataMode: bar.marketDataMode,
  dataUpdatedAt: bar.dataUpdatedAt,
  studyFallback: Boolean(bar.source === "option-study-quote-fallback"),
});

export const buildOptionChartIdentityKey = ({
  underlying,
  expirationDate,
  right,
  strike,
  optionTicker,
  providerContractId,
}) =>
  [
    underlying || "",
    expirationDate || "",
    right || "",
    Number.isFinite(strike) ? strike : "",
    optionTicker || "",
    providerContractId || "",
  ].join("::");

export const buildOptionChartBarsRequest = ({
  underlying,
  expirationDate,
  right,
  strike,
  optionTicker = null,
  providerContractId = null,
  timeframe,
  limit,
  from,
  to,
  outsideRth = false,
  historyCursor = null,
  preferCursor = false,
}) => ({
  underlying,
  expirationDate,
  strike,
  right,
  optionTicker: optionTicker || undefined,
  providerContractId:
    normalizeBrokerProviderContractId(providerContractId) || undefined,
  timeframe,
  limit,
  from,
  to,
  outsideRth,
  historyCursor: historyCursor || undefined,
  preferCursor: historyCursor && preferCursor ? true : undefined,
});

export const shouldPatchOptionChartWithLiveQuote = ({
  liveEnabled,
  providerContractId,
}) =>
  Boolean(liveEnabled && normalizeBrokerProviderContractId(providerContractId));

export function useOptionChartBars({
  scope,
  underlying,
  expirationDate,
  right,
  strike,
  optionTicker = null,
  providerContractId = null,
  timeframe = "1m",
  barsLimit = null,
  enabled = true,
  liveEnabled = true,
  outsideRth = false,
  queryDefaults = OPTION_CHART_BARS_QUERY_DEFAULTS,
  requestPriority = HYDRATION_PRIORITY.active,
  prewarmPriority = HYDRATION_PRIORITY.near,
  streamPriority = 80,
  hydrationLabel = null,
  hydrationActive = true,
  hydrationMeta = null,
  allowedTimeframes = null,
  getPrewarmLimit = null,
}) {
  const queryClient = useQueryClient();
  const normalizedProviderContractId =
    normalizeBrokerProviderContractId(providerContractId);
  const identityReady = Boolean(
    underlying &&
      expirationDate &&
      right &&
      Number.isFinite(strike) &&
      strike > 0,
  );
  const baseTimeframe = useMemo(
    () =>
      resolveLocalRollupBaseTimeframe(
        timeframe,
        getChartBarLimit(timeframe, "option"),
        "option",
      ),
    [timeframe],
  );
  const baseLimit = useMemo(
    () =>
      expandLocalRollupLimit(
        barsLimit ?? getChartBarLimit(timeframe, "option"),
        timeframe,
        baseTimeframe,
      ),
    [barsLimit, baseTimeframe, timeframe],
  );
  const queryKey = useMemo(
    () => [
      "option-chart-bars",
      scope || "option-chart",
      underlying || "__missing__",
      expirationDate || "__missing__",
      right || "__missing__",
      Number.isFinite(strike) ? strike : "__missing__",
      optionTicker || "__missing__",
      normalizedProviderContractId || "__missing__",
      baseTimeframe,
      baseLimit,
    ],
    [
      baseLimit,
      baseTimeframe,
      expirationDate,
      normalizedProviderContractId,
      optionTicker,
      right,
      scope,
      strike,
      underlying,
    ],
  );
  const queryEnabled = Boolean(enabled && identityReady);
  const buildRequest = useCallback(
    ({
      timeframe: requestedTimeframe,
      limit,
      providerContractId: requestProviderContractId,
      from,
      to,
      historyCursor,
      preferCursor,
    } = {}) =>
      buildOptionChartBarsRequest({
        underlying,
        expirationDate,
        strike,
        right,
        optionTicker,
        providerContractId:
          normalizeBrokerProviderContractId(requestProviderContractId) ||
          normalizedProviderContractId,
        timeframe: requestedTimeframe || baseTimeframe,
        limit: limit ?? baseLimit,
        from,
        to,
        outsideRth,
        historyCursor,
        preferCursor,
      }),
    [
      baseLimit,
      baseTimeframe,
      expirationDate,
      normalizedProviderContractId,
      optionTicker,
      outsideRth,
      right,
      strike,
      underlying,
    ],
  );
  const query = useQuery({
    queryKey,
    queryFn: () =>
      getOptionChartBarsRequest(
        buildRequest(),
        buildHydrationRequestOptions(requestPriority),
      ),
    ...queryDefaults,
    enabled: queryEnabled,
  });
  const chartProviderContractId =
    normalizeBrokerProviderContractId(query.data?.providerContractId) ||
    normalizedProviderContractId ||
    null;
  const identityKey = buildOptionChartIdentityKey({
    underlying,
    expirationDate,
    right,
    strike,
    optionTicker,
    providerContractId: chartProviderContractId,
  });

  useHydrationIntent({
    key: [
      scope || "option-chart",
      identityKey,
      timeframe,
    ].join("::"),
    family: "chart-bars",
    label: hydrationLabel || `${underlying || "option"} ${timeframe}`,
    priority: requestPriority,
    active: Boolean(hydrationActive && queryEnabled),
    meta: {
      role: "option",
      timeframe,
      providerContractId: chartProviderContractId,
      optionTicker,
      ...(hydrationMeta || {}),
    },
  });

  const basePage = useMemo(
    () =>
      normalizeChartBarsPagePayload(query.data, {
        context: "option-chart-base",
        scopeKey: scope || "option-chart",
        mapBar: normalizeApiBarForChart,
      }),
    [query.data, scope],
  );
  const baseBars = basePage.bars;
  const baseBarsCacheStale = isChartBarsPayloadCacheStale(
    query.data,
    basePage.historyPage,
  );
  const baseBarsReady = Boolean(
    query.isSuccess &&
      query.fetchStatus !== "fetching" &&
      !baseBarsCacheStale,
  );
  const baseBarsScopeKey = useMemo(
    () => [
      "option-chart-bars-base",
      scope || "option-chart",
      identityKey,
      baseTimeframe,
    ].join("::"),
    [baseTimeframe, identityKey, scope],
  );
  const prependableBars = usePrependableHistoricalBars({
    scopeKey: baseBarsScopeKey,
    timeframe: baseTimeframe,
    pageSizeTimeframe: timeframe,
    bars: baseBars,
    baseBarsReady,
    enabled: queryEnabled,
    fetchOlderBars: useCallback(
      async ({ from, to, limit, historyCursor, preferCursor }) => {
        const fromIso = from.toISOString();
        const toIso = to.toISOString();
        const payload = await queryClient.fetchQuery({
          queryKey: [
            "option-chart-bars-prepend",
            scope || "option-chart",
            underlying || "__missing__",
            expirationDate || "__missing__",
            right || "__missing__",
            Number.isFinite(strike) ? strike : "__missing__",
            optionTicker || "__missing__",
            chartProviderContractId ||
              normalizedProviderContractId ||
              "__missing__",
            baseTimeframe,
            limit,
            fromIso,
            toIso,
            historyCursor || "__missing__",
            Boolean(historyCursor && preferCursor),
          ],
          queryFn: () =>
            getOptionChartBarsRequest(
              buildRequest({
                timeframe: baseTimeframe,
                limit,
                providerContractId:
                  chartProviderContractId || normalizedProviderContractId,
                from: fromIso,
                to: toIso,
                historyCursor: historyCursor || undefined,
                preferCursor: historyCursor && preferCursor ? true : undefined,
              }),
              buildHydrationRequestOptions(requestPriority),
            ),
          ...queryDefaults,
        });

        return normalizeChartBarsPagePayload(payload, {
          context: "option-chart-prepend",
          scopeKey: scope || "option-chart",
          mapBar: normalizeApiBarForChart,
        });
      },
      [
        baseTimeframe,
        buildRequest,
        chartProviderContractId,
        expirationDate,
        normalizedProviderContractId,
        optionTicker,
        queryClient,
        queryDefaults,
        requestPriority,
        right,
        scope,
        strike,
        underlying,
      ],
    ),
  });
  const fetchLatestBars = useCallback(async () => {
    const fallbackLimit = Math.max(2, Math.min(baseLimit, 500));
    const payload = await getOptionChartBarsRequest(
      buildRequest({
        providerContractId: chartProviderContractId || normalizedProviderContractId,
        limit: fallbackLimit,
      }),
      buildHydrationRequestOptions(requestPriority),
    );

    return normalizeLatestChartBarsPayload(payload, {
      context: "option-chart-live-fallback",
      scopeKey: scope || "option-chart",
      mapBar: normalizeApiBarForChart,
    });
  }, [
    baseLimit,
    buildRequest,
    chartProviderContractId,
    normalizedProviderContractId,
    requestPriority,
    scope,
  ]);
  const streamedBarsState = useHistoricalBarStreamState({
    symbol: underlying,
    timeframe: baseTimeframe,
    bars: prependableBars.bars,
    assetClass: "option",
    providerContractId: chartProviderContractId,
    outsideRth,
    source: "midpoint",
    enabled: Boolean(liveEnabled && underlying && chartProviderContractId),
    fetchLatestBars,
    instrumentationScope: baseBarsScopeKey,
    streamPriority,
  });
  const streamedBars = streamedBarsState.bars;
  const patchedBars = useOptionQuotePatchedBars({
    providerContractId: chartProviderContractId,
    timeframe: baseTimeframe,
    bars: streamedBars,
    enabled: shouldPatchOptionChartWithLiveQuote({
      liveEnabled,
      providerContractId: chartProviderContractId,
    }),
  });
  const displayBars = useMemo(
    () => rollupMarketBars(patchedBars, baseTimeframe, timeframe),
    [baseTimeframe, patchedBars, timeframe],
  );
  const prewarmTimeframe = useCallback(
    (nextTimeframe) => {
      if (
        !queryEnabled ||
        nextTimeframe === timeframe ||
        (Array.isArray(allowedTimeframes) &&
          !allowedTimeframes.some((option) =>
            typeof option === "string"
              ? option === nextTimeframe
              : option?.value === nextTimeframe,
          ))
      ) {
        return;
      }

      const favoriteBaseTimeframe = resolveLocalRollupBaseTimeframe(
        nextTimeframe,
        getChartBarLimit(nextTimeframe, "option"),
        "option",
      );
      const preferredLimit =
        typeof getPrewarmLimit === "function"
          ? getPrewarmLimit(nextTimeframe)
          : getInitialChartBarLimit(nextTimeframe, "option");
      const favoriteLimit = expandLocalRollupLimit(
        preferredLimit,
        nextTimeframe,
        favoriteBaseTimeframe,
      );
      const favoriteKey = [
        "option-chart-bars",
        scope || "option-chart",
        underlying || "__missing__",
        expirationDate || "__missing__",
        right || "__missing__",
        Number.isFinite(strike) ? strike : "__missing__",
        optionTicker || "__missing__",
        chartProviderContractId ||
          normalizedProviderContractId ||
          "__missing__",
        favoriteBaseTimeframe,
        favoriteLimit,
      ];

      queryClient.prefetchQuery({
        queryKey: favoriteKey,
        queryFn: () =>
          getOptionChartBarsRequest(
            buildRequest({
              timeframe: favoriteBaseTimeframe,
              limit: favoriteLimit,
              providerContractId:
                chartProviderContractId || normalizedProviderContractId,
            }),
            buildHydrationRequestOptions(prewarmPriority),
          ),
        ...queryDefaults,
      });
    },
    [
      allowedTimeframes,
      buildRequest,
      chartProviderContractId,
      expirationDate,
      getPrewarmLimit,
      normalizedProviderContractId,
      optionTicker,
      prewarmPriority,
      queryEnabled,
      queryClient,
      queryDefaults,
      right,
      scope,
      strike,
      timeframe,
      underlying,
    ],
  );

  return {
    baseBars: prependableBars.bars,
    baseLimit,
    baseTimeframe,
    baseBarsCacheStale,
    baseBarsReady,
    baseHistoryPage: basePage.historyPage,
    bars: patchedBars,
    chartProviderContractId,
    displayBars,
    emptyOlderHistoryWindowCount:
      prependableBars.emptyOlderHistoryWindowCount,
    fetchLatestBars,
    hasExhaustedOlderHistory: prependableBars.hasExhaustedOlderHistory,
    identityKey,
    identityReady,
    isPrependingOlder: prependableBars.isPrependingOlder,
    loadedBarCount: prependableBars.loadedBarCount,
    oldestLoadedAtMs: prependableBars.oldestLoadedAtMs,
    olderHistoryExhaustionReason:
      prependableBars.olderHistoryExhaustionReason,
    olderHistoryNextBeforeMs: prependableBars.olderHistoryNextBeforeMs,
    olderHistoryPageCount: prependableBars.olderHistoryPageCount,
    olderHistoryProvider: prependableBars.olderHistoryProvider,
    olderHistoryProviderCursor: prependableBars.olderHistoryProviderCursor,
    olderHistoryProviderNextUrl: prependableBars.olderHistoryProviderNextUrl,
    olderHistoryProviderPageCount: prependableBars.olderHistoryProviderPageCount,
    olderHistoryProviderPageLimitReached:
      prependableBars.olderHistoryProviderPageLimitReached,
    olderHistoryCursor: prependableBars.olderHistoryCursor,
    prependOlderBars: prependableBars.prependOlderBars,
    prewarmTimeframe,
    query,
    streamedBars,
    streamStatus: streamedBarsState.status,
  };
}
