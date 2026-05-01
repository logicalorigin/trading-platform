import type { MarketBar } from "./types";
import { recordChartHydrationCounter } from "./chartHydrationStats";

export type ChartBarsHistoryPage = {
  requestedFrom?: Date | string | null;
  requestedTo?: Date | string | null;
  oldestBarAt?: Date | string | null;
  newestBarAt?: Date | string | null;
  returnedCount?: number | null;
  nextBefore?: Date | string | null;
  provider?: string | null;
  exhaustedBefore?: boolean | null;
  providerCursor?: string | null;
  providerNextUrl?: string | null;
  providerPageCount?: number | null;
  providerPageLimitReached?: boolean | null;
  historyCursor?: string | null;
  hydrationStatus?: "cold" | "partial" | "warm" | "warming" | "exhausted";
  cacheStatus?: "hit" | "miss" | "partial" | null;
};

export type ChartBarsPagePayload<TBar = MarketBar> = {
  bars: TBar[];
  historyPage: ChartBarsHistoryPage | null;
};

type NormalizeChartBarsPayloadOptions<TInputBar, TOutputBar> = {
  context: string;
  scopeKey?: string | null;
  mapBar?: (bar: TInputBar) => TOutputBar;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeChartBarsPagePayload = <TInputBar = MarketBar, TOutputBar = TInputBar>(
  payload: unknown,
  options: NormalizeChartBarsPayloadOptions<TInputBar, TOutputBar>,
): ChartBarsPagePayload<TOutputBar> => {
  if (!isRecord(payload)) {
    if (payload != null) {
      recordChartHydrationCounter("payloadShapeError", options.scopeKey);
    }
    return { bars: [], historyPage: null };
  }

  if (!Array.isArray(payload.bars)) {
    recordChartHydrationCounter("payloadShapeError", options.scopeKey);
    return {
      bars: [],
      historyPage: isRecord(payload.historyPage)
        ? (payload.historyPage as ChartBarsHistoryPage)
        : null,
    };
  }

  return {
    bars: options.mapBar
      ? (payload.bars as TInputBar[]).map(options.mapBar)
      : (payload.bars as TOutputBar[]),
    historyPage: isRecord(payload.historyPage)
      ? (payload.historyPage as ChartBarsHistoryPage)
      : null,
  };
};

export const normalizeLatestChartBarsPayload = <TInputBar = MarketBar, TOutputBar = TInputBar>(
  payload: unknown,
  options: NormalizeChartBarsPayloadOptions<TInputBar, TOutputBar>,
): TOutputBar[] => {
  const page = normalizeChartBarsPagePayload(payload, options);
  return page.bars;
};
