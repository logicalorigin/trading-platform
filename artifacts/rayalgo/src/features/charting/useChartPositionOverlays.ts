import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetQuoteSnapshots,
  useListPositions,
} from "@workspace/api-client-react";
import { useUserPreferences } from "../preferences/useUserPreferences";
import { useAccountSelection } from "../platform/platformContexts.jsx";
import { useStoredOptionQuoteSnapshot } from "../platform/live-streams";
import { listBrokerExecutionsRequest } from "../trade/tradeBrokerRequests.js";
import type { ChartModel } from "./types";
import {
  buildChartPositionOverlays,
  EMPTY_CHART_POSITION_OVERLAYS,
  type ChartPositionOverlayContext,
  type ChartPositionOverlays,
} from "./chartPositionOverlays";

const POSITION_OVERLAY_STORAGE_PREFIX = "chart-positions-overlay";

const normalizeSymbol = (value: unknown): string =>
  String(value || "")
    .trim()
    .toUpperCase();

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readStoredVisibility = (surfaceKind: string | null): boolean => {
  if (typeof window === "undefined" || !surfaceKind) {
    return true;
  }
  const stored = window.localStorage.getItem(
    `${POSITION_OVERLAY_STORAGE_PREFIX}:${surfaceKind}`,
  );
  return stored == null ? true : stored !== "false";
};

const writeStoredVisibility = (surfaceKind: string | null, value: boolean) => {
  if (typeof window === "undefined" || !surfaceKind) {
    return;
  }
  window.localStorage.setItem(
    `${POSITION_OVERLAY_STORAGE_PREFIX}:${surfaceKind}`,
    value ? "true" : "false",
  );
};

export const useChartPositionOverlays = ({
  chartContext,
  model,
}: {
  chartContext?: ChartPositionOverlayContext | null;
  model: ChartModel;
}): {
  available: boolean;
  enabled: boolean;
  localEnabled: boolean;
  setLocalEnabled: (next: boolean | ((value: boolean) => boolean)) => void;
  overlays: ChartPositionOverlays;
} => {
  const { preferences } = useUserPreferences();
  const { selectedAccountId } = useAccountSelection();
  const surfaceKind = chartContext?.surfaceKind ?? null;
  const globalEnabled = preferences.trading.showPositionLines;
  const available = Boolean(chartContext?.symbol && globalEnabled);
  const [localEnabled, setLocalEnabledState] = useState(() =>
    readStoredVisibility(surfaceKind),
  );

  useEffect(() => {
    setLocalEnabledState(readStoredVisibility(surfaceKind));
  }, [surfaceKind]);

  const setLocalEnabled = useCallback(
    (next: boolean | ((value: boolean) => boolean)) => {
      setLocalEnabledState((current) => {
        const resolved =
          typeof next === "function"
            ? (next as (value: boolean) => boolean)(current)
            : next;
        writeStoredVisibility(surfaceKind, resolved);
        return resolved;
      });
    },
    [surfaceKind],
  );

  const enabled = Boolean(
    available && globalEnabled && localEnabled && selectedAccountId,
  );
  const symbol = normalizeSymbol(chartContext?.symbol);
  const isOption = chartContext?.surfaceKind === "option";
  const isMini = chartContext?.surfaceKind === "mini";
  const providerContractId =
    chartContext?.optionContract?.providerContractId || null;

  const positionsQuery = useListPositions(
    { accountId: selectedAccountId || undefined },
    {
      query: {
        queryKey: [
          "/api/positions",
          { accountId: selectedAccountId || undefined },
        ],
        enabled,
        staleTime: 5_000,
        refetchInterval: false,
        retry: false,
      },
    },
  );

  const executionsQuery = useQuery({
    queryKey: [
      "chart-position-executions",
      selectedAccountId,
      symbol,
      providerContractId || null,
      isOption ? "option" : "equity",
    ],
    queryFn: () =>
      listBrokerExecutionsRequest({
        accountId: selectedAccountId,
        symbol,
        providerContractId: isOption ? providerContractId : null,
        days: 14,
        limit: 100,
      }),
    enabled: Boolean(enabled && !isMini && symbol),
    staleTime: 5_000,
    refetchInterval: false,
    retry: false,
  });

  const quoteQuery = useGetQuoteSnapshots(
    { symbols: symbol || "__none__" },
    {
      query: {
        queryKey: [
          "/api/quotes/snapshot",
          { symbols: symbol || "__none__" },
        ],
        enabled: Boolean(enabled && !isOption && symbol),
        staleTime: 60_000,
        refetchInterval: false,
        retry: false,
      },
    },
  );
  const optionQuote = useStoredOptionQuoteSnapshot(
    isOption ? providerContractId : null,
  );

  const mark = useMemo(() => {
    if (isOption) {
      return finiteNumber(optionQuote?.price);
    }
    const quote = quoteQuery.data?.quotes?.find(
      (item) => normalizeSymbol(item.symbol) === symbol,
    );
    return finiteNumber(quote?.price);
  }, [isOption, optionQuote?.price, quoteQuery.data, symbol]);

  return useMemo(() => {
    if (!enabled || !chartContext) {
      return {
        available,
        enabled,
        localEnabled,
        setLocalEnabled,
        overlays: {
          ...EMPTY_CHART_POSITION_OVERLAYS,
          density: chartContext?.surfaceKind === "mini" ? "mini" : "full",
        },
      };
    }

    return {
      available,
      enabled,
      localEnabled,
      setLocalEnabled,
      overlays: buildChartPositionOverlays({
        chartContext,
        mark,
        positions: positionsQuery.data?.positions || [],
        executions: executionsQuery.data?.executions || [],
        chartBars: model.chartBars,
        chartBarRanges: model.chartBarRanges,
      }),
    };
  }, [
    available,
    chartContext,
    enabled,
    executionsQuery.data,
    localEnabled,
    mark,
    model.chartBarRanges,
    model.chartBars,
    positionsQuery.data,
    setLocalEnabled,
  ]);
};
