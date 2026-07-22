import { useEffect, useMemo, useState } from "react";
import {
  FootprintTimeframe,
  getFootprints,
} from "@workspace/api-client-react";
import type {
  ChartFootprintContext,
  ChartFootprintDisplayMode,
  ChartFootprintResponse,
} from "./types";

type FootprintVisibleRange = {
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

type FootprintLoadState =
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

const FOOTPRINT_DEBOUNCE_MS = 220;

const resolveFootprintTimeframe = (timeframe: string) =>
  Object.values(FootprintTimeframe).find(
    (candidate) => candidate === timeframe,
  );

export function useFootprintCandles({
  context,
  visibleRange,
  enabled,
  ticksPerRow,
  imbalancePercent,
}: UseFootprintCandlesInput): UseFootprintCandlesResult {
  const normalizedContext = useMemo(() => {
    const symbol = context?.symbol.trim().toUpperCase();
    if (!symbol || !context?.timeframe) {
      return null;
    }
    return {
      ...context,
      symbol,
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
  const visibleFromMs = visibleRange?.from.getTime() ?? NaN;
  const visibleToMs = visibleRange?.to.getTime() ?? NaN;

  useEffect(() => {
    if (!enabled) {
      setResult({ data: null, state: "idle", error: null });
      return undefined;
    }
    const timeframe = normalizedContext
      ? resolveFootprintTimeframe(normalizedContext.timeframe)
      : undefined;
    if (
      !normalizedContext ||
      !timeframe ||
      !Number.isFinite(visibleFromMs) ||
      !Number.isFinite(visibleToMs) ||
      visibleFromMs >= visibleToMs
    ) {
      setResult({ data: null, state: "unsupported", error: null });
      return undefined;
    }

    setResult({ data: null, state: "loading", error: null });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      getFootprints(
        {
          symbol: normalizedContext.symbol,
          assetClass: normalizedContext.assetClass,
          timeframe,
          from: new Date(visibleFromMs).toISOString(),
          to: new Date(visibleToMs).toISOString(),
          providerContractId:
            normalizedContext.providerContractId ?? undefined,
          optionTicker: normalizedContext.optionTicker ?? undefined,
          outsideRth: normalizedContext.outsideRth,
          ticksPerRow,
          imbalancePercent,
          sourcePreference: "massive_first",
          maxBars: normalizedContext.assetClass === "option" ? 40 : 80,
        },
        { signal: controller.signal },
      )
        .then((data) => {
          if (controller.signal.aborted) {
            return;
          }
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
    enabled,
    imbalancePercent,
    normalizedContext,
    ticksPerRow,
    visibleFromMs,
    visibleToMs,
  ]);

  return result;
}
