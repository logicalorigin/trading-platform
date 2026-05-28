import { useEffect, useMemo, useState } from "react";
import type {
  ChartFootprintContext,
  ChartFootprintDisplayMode,
  ChartFootprintResponse,
} from "./types";

export type FootprintVisibleRange = {
  from: Date;
  to: Date;
} | null;

type UseFootprintCandlesInput = {
  context?: ChartFootprintContext | null;
  visibleRange: FootprintVisibleRange;
  enabled: boolean;
  displayMode: ChartFootprintDisplayMode;
  ticksPerRow: number;
  imbalancePercent: number;
};

export type FootprintLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "unsupported"
  | "error";

type UseFootprintCandlesResult = {
  data: ChartFootprintResponse | null;
  state: FootprintLoadState;
  error: string | null;
};

const SUPPORTED_FOOTPRINT_TIMEFRAMES = new Set([
  "5s",
  "15s",
  "30s",
  "1m",
  "2m",
  "5m",
  "15m",
  "30m",
  "1h",
]);

const FOOTPRINT_DEBOUNCE_MS = 220;

const appendParam = (
  params: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined,
) => {
  if (value === null || value === undefined || value === "") {
    return;
  }
  params.set(key, String(value));
};

const buildFootprintUrl = (input: {
  context: ChartFootprintContext;
  visibleRange: NonNullable<FootprintVisibleRange>;
  ticksPerRow: number;
  imbalancePercent: number;
}): string => {
  const params = new URLSearchParams();
  appendParam(params, "symbol", input.context.symbol);
  appendParam(params, "assetClass", input.context.assetClass);
  appendParam(params, "timeframe", input.context.timeframe);
  appendParam(params, "from", input.visibleRange.from.toISOString());
  appendParam(params, "to", input.visibleRange.to.toISOString());
  appendParam(params, "providerContractId", input.context.providerContractId);
  appendParam(params, "optionTicker", input.context.optionTicker);
  appendParam(params, "outsideRth", input.context.outsideRth);
  appendParam(params, "ticksPerRow", input.ticksPerRow);
  appendParam(params, "imbalancePercent", input.imbalancePercent);
  appendParam(params, "sourcePreference", "massive_first");
  appendParam(
    params,
    "maxBars",
    input.context.assetClass === "option" ? 40 : 80,
  );
  return `/api/footprints?${params.toString()}`;
};

export function useFootprintCandles({
  context,
  visibleRange,
  enabled,
  displayMode,
  ticksPerRow,
  imbalancePercent,
}: UseFootprintCandlesInput): UseFootprintCandlesResult {
  const normalizedContext = useMemo(() => {
    if (!context?.symbol || !context.timeframe) {
      return null;
    }
    return {
      ...context,
      symbol: context.symbol.trim().toUpperCase(),
      assetClass:
        context.assetClass === "option" ? ("option" as const) : ("equity" as const),
    };
  }, [
    context?.assetClass,
    context?.optionTicker,
    context?.outsideRth,
    context?.providerContractId,
    context?.symbol,
    context?.timeframe,
  ]);
  const [result, setResult] = useState<UseFootprintCandlesResult>({
    data: null,
    state: "idle",
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setResult({ data: null, state: "idle", error: null });
      return undefined;
    }
    if (
      !normalizedContext ||
      !visibleRange ||
      !SUPPORTED_FOOTPRINT_TIMEFRAMES.has(normalizedContext.timeframe)
    ) {
      setResult({ data: null, state: "unsupported", error: null });
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setResult((current) => ({
        data: current.data,
        state: current.data ? "ready" : "loading",
        error: null,
      }));
      fetch(
        buildFootprintUrl({
          context: normalizedContext,
          visibleRange,
          ticksPerRow,
          imbalancePercent,
        }),
        { signal: controller.signal },
      )
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`Footprint request failed with ${response.status}`);
          }
          return (await response.json()) as ChartFootprintResponse;
        })
        .then((data) => {
          setResult({
            data,
            state: data.candles.length ? "ready" : "empty",
            error: null,
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            return;
          }
          setResult({
            data: null,
            state: "error",
            error: error instanceof Error ? error.message : "Footprint failed",
          });
        });
    }, FOOTPRINT_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    displayMode,
    enabled,
    imbalancePercent,
    normalizedContext,
    ticksPerRow,
    visibleRange,
  ]);

  return result;
}
