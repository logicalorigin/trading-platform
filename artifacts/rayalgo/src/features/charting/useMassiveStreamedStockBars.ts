import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarketBar } from "./types";
import {
  getStoredBrokerMinuteAggregates,
  useBrokerStockAggregateStream,
  useStockMinuteAggregateSymbolVersion,
} from "./useMassiveStockAggregateStream";
import { useStoredOptionQuoteSnapshot } from "../platform/live-streams";
import { usePageVisible } from "../platform/usePageVisible";
import { markChartLivePatchPending } from "./chartHydrationStats";
import {
  updateActiveChartBarState,
  useActiveChartBarState,
} from "./activeChartBarStore";

type UseBrokerStreamedBarsInput = {
  symbol: string;
  timeframe: string;
  bars?: MarketBar[] | null;
  enabled?: boolean;
};

type UseOptionQuotePatchedBarsInput = {
  providerContractId?: string | null;
  timeframe: string;
  bars?: MarketBar[] | null;
  enabled?: boolean;
  instrumentationScope?: string | null;
};

type UseHistoricalBarStreamInput = {
  symbol: string;
  timeframe: string;
  bars?: MarketBar[] | null;
  enabled?: boolean;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
  instrumentationScope?: string | null;
};

type UsePrependableHistoricalBarsInput = {
  scopeKey: string;
  timeframe: string;
  bars?: MarketBar[] | null;
  enabled?: boolean;
  fetchOlderBars?: (input: {
    from: Date;
    to: Date;
    limit: number;
  }) => Promise<MarketBar[] | null | undefined>;
};

type LiveOptionQuoteLike = {
  price?: number | null;
  bid?: number | null;
  ask?: number | null;
  updatedAt?: string | Date | null;
};

type HistoricalBarStreamSnapshot = {
  timestamp: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: string;
  providerContractId?: string | null;
};

type HistoricalBarStreamPayload = {
  symbol?: string;
  timeframe?: string;
  bar?: HistoricalBarStreamSnapshot | null;
};

const STREAM_SUPPORTED_TIMEFRAMES = new Set(["1m", "5m", "15m", "1h", "1d"]);

const timeframeToStepMs = (timeframe: string): number => (
  ({
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "1d": 86_400_000,
  }[timeframe] || 0)
);

// For 1d, IBKR timestamps daily bars at the trading-day boundary (typically 04:00 UTC = ET midnight).
// We don't re-bucket — instead we patch the last historical daily bar's OHLCV using all live
// minute-aggregates whose timestamp is >= the bar's start. This keeps daily aligned with IBKR's
// own session boundaries while still reflecting the live last-trade price.
const isDailyTimeframe = (timeframe: string): boolean => timeframe === "1d";

const resolveTimestampMs = (value: MarketBar["timestamp"] | MarketBar["time"]): number | null => {
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

const resolveQuoteUpdatedAtMs = (
  value: LiveOptionQuoteLike["updatedAt"],
): number | null => {
  if (typeof value === "object" && value !== null) {
    return value.getTime();
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
};

const resolveLiveQuotePrice = (quote: LiveOptionQuoteLike | null): number | null => {
  if (!quote) {
    return null;
  }

  if (typeof quote.price === "number" && Number.isFinite(quote.price)) {
    return quote.price;
  }

  if (
    typeof quote.bid === "number" &&
    Number.isFinite(quote.bid) &&
    typeof quote.ask === "number" &&
    Number.isFinite(quote.ask)
  ) {
    return (quote.bid + quote.ask) / 2;
  }

  if (typeof quote.bid === "number" && Number.isFinite(quote.bid)) {
    return quote.bid;
  }

  if (typeof quote.ask === "number" && Number.isFinite(quote.ask)) {
    return quote.ask;
  }

  return null;
};

const normalizeBaseBars = (bars: MarketBar[]): MarketBar[] => (
  bars
    .reduce<Array<MarketBar & { _startMs: number }>>((result, bar) => {
      const startMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
      if (startMs == null) {
        return result;
      }

      result.push({
        ...bar,
        timestamp: new Date(startMs),
        ts: typeof bar.ts === "string" ? bar.ts : new Date(startMs).toISOString(),
        open: bar.open ?? bar.o,
        high: bar.high ?? bar.h,
        low: bar.low ?? bar.l,
        close: bar.close ?? bar.c,
        volume: bar.volume ?? bar.v ?? 0,
        _startMs: startMs,
      });
      return result;
    }, [])
    .sort((left, right) => left._startMs - right._startMs)
    .map(({ _startMs: _discard, ...bar }) => bar)
);

const buildHistoricalBarStreamUrl = (input: {
  symbol: string;
  timeframe: string;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
}): string | null => {
  if (!input.symbol || !input.timeframe) {
    return null;
  }

  const params = new URLSearchParams({
    symbol: input.symbol.trim().toUpperCase(),
    timeframe: input.timeframe,
  });

  if (input.assetClass) {
    params.set("assetClass", input.assetClass);
  }
  if (input.providerContractId?.trim()) {
    params.set("providerContractId", input.providerContractId.trim());
  }
  if (typeof input.outsideRth === "boolean") {
    params.set("outsideRth", String(input.outsideRth));
  }
  if (input.source) {
    params.set("source", input.source);
  }

  return `/api/streams/bars?${params.toString()}`;
};

const parseHistoricalBarStreamPayload = (
  value: string,
): HistoricalBarStreamPayload | null => {
  try {
    return JSON.parse(value) as HistoricalBarStreamPayload;
  } catch {
    return null;
  }
};

const weightedAverage = (
  values: Array<{ value: number | null; weight: number }>,
): number | undefined => {
  const weighted = values.filter((entry) => Number.isFinite(entry.value) && entry.weight > 0);
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) {
    return undefined;
  }

  const total = weighted.reduce((sum, entry) => sum + ((entry.value as number) * entry.weight), 0);
  return Number((total / totalWeight).toFixed(6));
};

const mergeBarsWithMinuteAggregates = (
  symbol: string,
  timeframe: string,
  bars: MarketBar[],
): MarketBar[] => {
  const normalizedBars = normalizeBaseBars(bars);
  if (!STREAM_SUPPORTED_TIMEFRAMES.has(timeframe)) {
    return normalizedBars;
  }

  const stepMs = timeframeToStepMs(timeframe);
  if (!stepMs) {
    return normalizedBars;
  }

  const minuteAggregates = getStoredBrokerMinuteAggregates(symbol);
  if (!minuteAggregates.length) {
    return normalizedBars;
  }

  // Daily charts: patch the last historical bar with all live aggregates that fall
  // within its session window, rather than re-bucketing (which would mis-align with
  // IBKR's session-day boundary, typically 04:00 UTC).
  if (isDailyTimeframe(timeframe)) {
    if (!normalizedBars.length) {
      return normalizedBars;
    }
    const lastBar = normalizedBars[normalizedBars.length - 1];
    const lastStartMs =
      resolveTimestampMs(lastBar.timestamp) ?? resolveTimestampMs(lastBar.time);
    if (lastStartMs == null) {
      return normalizedBars;
    }
    const liveSinceLast = minuteAggregates.filter(
      (aggregate) => aggregate.startMs >= lastStartMs,
    );
    if (!liveSinceLast.length) {
      return normalizedBars;
    }
    const ordered = liveSinceLast
      .slice()
      .sort((left, right) => left.startMs - right.startMs);
    const last = ordered[ordered.length - 1];
    const liveHigh = ordered.reduce((max, m) => Math.max(max, m.high), -Infinity);
    const liveLow = ordered.reduce((min, m) => Math.min(min, m.low), Infinity);
    const liveVolume = ordered.reduce((sum, m) => sum + m.volume, 0);
    const patchedLast: MarketBar = {
      ...lastBar,
      high: Math.max(lastBar.high ?? lastBar.h ?? -Infinity, liveHigh),
      low: Math.min(lastBar.low ?? lastBar.l ?? Infinity, liveLow),
      close: last.close,
      // Prefer accumulatedVolume from the most recent live aggregate when present,
      // since IBKR streams report session-cumulative volume; otherwise add live deltas.
      volume:
        last.accumulatedVolume != null
          ? last.accumulatedVolume
          : (lastBar.volume ?? lastBar.v ?? 0) + liveVolume,
      sessionVwap: last.sessionVwap ?? lastBar.sessionVwap,
      accumulatedVolume: last.accumulatedVolume ?? lastBar.accumulatedVolume,
      source: "ibkr-websocket-derived",
    };
    return [...normalizedBars.slice(0, -1), patchedLast];
  }

  const mergedByStart = new Map<number, MarketBar>();
  normalizedBars.forEach((bar) => {
    const startMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
    if (startMs == null) {
      return;
    }

    mergedByStart.set(startMs, bar);
  });

  const bucketedMinutes = new Map<number, ReturnType<typeof getStoredBrokerMinuteAggregates>>();
  minuteAggregates.forEach((aggregate) => {
    const bucketStartMs = Math.floor(aggregate.startMs / stepMs) * stepMs;
    const bucket = bucketedMinutes.get(bucketStartMs) || [];
    bucket.push(aggregate);
    bucketedMinutes.set(bucketStartMs, bucket);
  });

  bucketedMinutes.forEach((bucket, bucketStartMs) => {
    const ordered = bucket.slice().sort((left, right) => left.startMs - right.startMs);
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const volume = ordered.reduce((sum, minute) => sum + minute.volume, 0);
    const open = first.open;
    const high = ordered.reduce((max, minute) => Math.max(max, minute.high), first.high);
    const low = ordered.reduce((min, minute) => Math.min(min, minute.low), first.low);
    const close = last.close;
    const vwap = weightedAverage(
      ordered.map((minute) => ({
        value: minute.vwap,
        weight: minute.volume,
      })),
    );
    const averageTradeSize = weightedAverage(
      ordered.map((minute) => ({
        value: minute.averageTradeSize,
        weight: minute.volume,
      })),
    );

    mergedByStart.set(bucketStartMs, {
      timestamp: new Date(bucketStartMs),
      ts: new Date(bucketStartMs).toISOString(),
      open,
      high,
      low,
      close,
      volume,
      vwap,
      sessionVwap: last.sessionVwap ?? undefined,
      accumulatedVolume: last.accumulatedVolume ?? undefined,
      averageTradeSize,
      source: "ibkr-websocket-derived",
    });
  });

  return Array.from(mergedByStart.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, bar]) => bar);
};

const mergePatchedBars = (
  baseBars: MarketBar[],
  patchedBars: MarketBar[],
): MarketBar[] => {
  const mergedByTime = new Map<number, MarketBar>();

  baseBars.forEach((bar) => {
    const timeMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
    if (timeMs != null) {
      mergedByTime.set(timeMs, bar);
    }
  });

  patchedBars.forEach((bar) => {
    const timeMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
    if (timeMs != null) {
      mergedByTime.set(timeMs, bar);
    }
  });

  return Array.from(mergedByTime.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, bar]) => bar);
};

const areBarsEquivalent = (
  left: MarketBar[],
  right: MarketBar[],
): boolean => {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    const currentTimeMs =
      resolveTimestampMs(current.timestamp) ?? resolveTimestampMs(current.time);
    const nextTimeMs =
      resolveTimestampMs(next.timestamp) ?? resolveTimestampMs(next.time);
    if (
      currentTimeMs !== nextTimeMs ||
      (current.open ?? current.o ?? null) !== (next.open ?? next.o ?? null) ||
      (current.high ?? current.h ?? null) !== (next.high ?? next.h ?? null) ||
      (current.low ?? current.l ?? null) !== (next.low ?? next.l ?? null) ||
      (current.close ?? current.c ?? null) !== (next.close ?? next.c ?? null) ||
      (current.volume ?? current.v ?? null) !== (next.volume ?? next.v ?? null) ||
      (current.source ?? null) !== (next.source ?? null)
    ) {
      return false;
    }
  }

  return true;
};

const patchBarsWithHistoricalBarStream = (
  bars: MarketBar[],
  nextBar: HistoricalBarStreamSnapshot | null | undefined,
): MarketBar[] => {
  const normalizedBars = normalizeBaseBars(bars);
  if (!nextBar) {
    return normalizedBars;
  }

  const timeMs = resolveTimestampMs(nextBar.timestamp);
  if (timeMs == null) {
    return normalizedBars;
  }

  const patchedBar: MarketBar = {
    timestamp: new Date(timeMs),
    time: timeMs,
    ts:
      typeof nextBar.timestamp === "string"
        ? nextBar.timestamp
        : new Date(timeMs).toISOString(),
    open: nextBar.open,
    high: nextBar.high,
    low: nextBar.low,
    close: nextBar.close,
    volume: nextBar.volume,
    source: nextBar.source ?? "ibkr-history",
  };

  const existingIndex = normalizedBars.findIndex((bar) => {
    const startMs = resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
    return startMs === timeMs;
  });

  if (existingIndex >= 0) {
    const nextBars = normalizedBars.slice();
    nextBars[existingIndex] = {
      ...nextBars[existingIndex],
      ...patchedBar,
      o: patchedBar.open,
      h: patchedBar.high,
      l: patchedBar.low,
      c: patchedBar.close,
      v: patchedBar.volume,
    };
    return nextBars;
  }

  return mergePatchedBars(normalizedBars, [patchedBar]);
};

const patchBarsWithLiveQuote = (
  bars: MarketBar[],
  timeframe: string,
  quote: LiveOptionQuoteLike | null,
): MarketBar[] => {
  const normalizedBars = normalizeBaseBars(bars);
  const quotePrice = resolveLiveQuotePrice(quote);
  const quoteUpdatedAtMs = resolveQuoteUpdatedAtMs(quote?.updatedAt);
  const stepMs = timeframeToStepMs(timeframe);

  if (!normalizedBars.length || quotePrice == null || quoteUpdatedAtMs == null || !stepMs) {
    return normalizedBars;
  }

  const nextBars = normalizedBars.slice();
  const lastBar = nextBars[nextBars.length - 1];
  const lastBarStartMs =
    resolveTimestampMs(lastBar.timestamp) ?? resolveTimestampMs(lastBar.time);
  if (lastBarStartMs == null) {
    return normalizedBars;
  }

  const nextBarStartMs =
    isDailyTimeframe(timeframe)
      ? quoteUpdatedAtMs < lastBarStartMs + stepMs
        ? lastBarStartMs
        : lastBarStartMs + stepMs
      : Math.floor(quoteUpdatedAtMs / stepMs) * stepMs;

  if (nextBarStartMs <= lastBarStartMs) {
    nextBars[nextBars.length - 1] = {
      ...lastBar,
      high: Math.max(lastBar.high ?? lastBar.h ?? quotePrice, quotePrice),
      low: Math.min(lastBar.low ?? lastBar.l ?? quotePrice, quotePrice),
      close: quotePrice,
      c: quotePrice,
      source: "ibkr-option-quote-derived",
      ts: new Date(lastBarStartMs).toISOString(),
    };
    return nextBars;
  }

  const previousClose =
    lastBar.close ?? lastBar.c ?? quotePrice;
  nextBars.push({
    timestamp: new Date(nextBarStartMs),
    time: nextBarStartMs,
    ts: new Date(nextBarStartMs).toISOString(),
    open: previousClose,
    high: Math.max(previousClose, quotePrice),
    low: Math.min(previousClose, quotePrice),
    close: quotePrice,
    volume: lastBar.volume ?? lastBar.v ?? 0,
    source: "ibkr-option-quote-derived",
  });
  return nextBars;
};

export const usePrependableHistoricalBars = ({
  scopeKey,
  timeframe,
  bars,
  enabled = true,
  fetchOlderBars,
}: UsePrependableHistoricalBarsInput): {
  bars: MarketBar[];
  prependOlderBars: (input?: { pageSize?: number }) => Promise<number>;
  oldestLoadedAtMs: number | null;
  loadedBarCount: number;
  isPrependingOlder: boolean;
  hasExhaustedOlderHistory: boolean;
} => {
  const normalizedBaseBars = useMemo(
    () => normalizeBaseBars(bars || []),
    [bars],
  );
  const sharedState = useActiveChartBarState(scopeKey);
  const [isPrependingOlder, setIsPrependingOlder] = useState(false);
  const activeScopeKeyRef = useRef(scopeKey);
  const inFlightOlderKeyRef = useRef<string | null>(null);

  useEffect(() => {
    activeScopeKeyRef.current = scopeKey;
    inFlightOlderKeyRef.current = null;
    setIsPrependingOlder(false);
  }, [scopeKey]);

  useEffect(() => {
    if (!enabled || !scopeKey?.trim()) {
      return;
    }

    updateActiveChartBarState(scopeKey, (current) => {
      const mergedHistoricalBars = current.historicalBars.length
        ? mergePatchedBars(current.historicalBars, normalizedBaseBars)
        : normalizedBaseBars;

      if (areBarsEquivalent(current.historicalBars, mergedHistoricalBars)) {
        return current;
      }

      return {
        ...current,
        historicalBars: mergedHistoricalBars,
      };
    });
  }, [enabled, normalizedBaseBars, scopeKey]);

  const mergedBars = useMemo(() => {
    if (!sharedState.historicalBars.length) {
      return normalizedBaseBars;
    }
    if (!normalizedBaseBars.length) {
      return sharedState.historicalBars;
    }
    return mergePatchedBars(normalizedBaseBars, sharedState.historicalBars);
  }, [normalizedBaseBars, sharedState.historicalBars]);
  const oldestLoadedAtMs = useMemo(
    () =>
      mergedBars.length
        ? (resolveTimestampMs(mergedBars[0]?.timestamp) ??
          resolveTimestampMs(mergedBars[0]?.time))
        : null,
    [mergedBars],
  );

  const prependOlderBars = useCallback(
    async (input?: { pageSize?: number }): Promise<number> => {
      if (
        !enabled ||
        !fetchOlderBars ||
        !mergedBars.length ||
        isPrependingOlder ||
        sharedState.hasExhaustedOlderHistory
      ) {
        return 0;
      }

      const oldestMs = oldestLoadedAtMs;
      const stepMs = timeframeToStepMs(timeframe);
      if (oldestMs == null || !stepMs) {
        return 0;
      }

      const requestedPageSize = Math.max(1, Math.ceil(input?.pageSize ?? 0));
      const prependKey = `${scopeKey}::${oldestMs}::${requestedPageSize}`;
      if (inFlightOlderKeyRef.current === prependKey) {
        return 0;
      }

      const toMs = Math.max(0, oldestMs - 1);
      const fromMs = Math.max(0, oldestMs - stepMs * requestedPageSize);
      inFlightOlderKeyRef.current = prependKey;
      setIsPrependingOlder(true);

      try {
        const olderBars = normalizeBaseBars(
          (await fetchOlderBars({
            from: new Date(fromMs),
            to: new Date(toMs),
            limit: requestedPageSize,
          })) || [],
        );

        if (activeScopeKeyRef.current !== scopeKey) {
          return 0;
        }

        const nextState = updateActiveChartBarState(scopeKey, (current) => {
          const existingTimes = new Set(
            current.historicalBars
              .map((bar) => resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time))
              .filter((value): value is number => value != null),
          );
          let addedCount = 0;
          olderBars.forEach((bar) => {
            const timeMs =
              resolveTimestampMs(bar.timestamp) ?? resolveTimestampMs(bar.time);
            if (timeMs != null && !existingTimes.has(timeMs)) {
              addedCount += 1;
            }
          });

          const mergedHistoricalBars = addedCount
            ? mergePatchedBars(current.historicalBars, olderBars)
            : current.historicalBars;
          const hasExhaustedOlderHistory =
            current.hasExhaustedOlderHistory ||
            !olderBars.length ||
            olderBars.length < requestedPageSize ||
            addedCount === 0;

          if (
            mergedHistoricalBars === current.historicalBars &&
            hasExhaustedOlderHistory === current.hasExhaustedOlderHistory
          ) {
            return current;
          }

          return {
            ...current,
            historicalBars: mergedHistoricalBars,
            hasExhaustedOlderHistory,
          };
        });

        return Math.max(0, nextState.historicalBars.length - mergedBars.length);
      } finally {
        if (activeScopeKeyRef.current === scopeKey) {
          setIsPrependingOlder(false);
          if (inFlightOlderKeyRef.current === prependKey) {
            inFlightOlderKeyRef.current = null;
          }
        }
      }
    },
    [
      enabled,
      fetchOlderBars,
      isPrependingOlder,
      mergedBars.length,
      oldestLoadedAtMs,
      sharedState.hasExhaustedOlderHistory,
      scopeKey,
      timeframe,
    ],
  );

  return {
    bars: mergedBars,
    prependOlderBars,
    oldestLoadedAtMs,
    loadedBarCount: mergedBars.length,
    isPrependingOlder,
    hasExhaustedOlderHistory: sharedState.hasExhaustedOlderHistory,
  };
};

export const useBrokerStreamedBars = ({
  symbol,
  timeframe,
  bars,
  enabled = true,
}: UseBrokerStreamedBarsInput): MarketBar[] => {
  useBrokerStockAggregateStream({
    symbols: symbol ? [symbol] : [],
    enabled: Boolean(enabled && symbol && STREAM_SUPPORTED_TIMEFRAMES.has(timeframe)),
  });

  const symbolAggregateVersion = useStockMinuteAggregateSymbolVersion(symbol);

  return useMemo(
    () => mergeBarsWithMinuteAggregates(symbol, timeframe, bars || []),
    [bars, symbolAggregateVersion, symbol, timeframe],
  );
};

export const useOptionQuotePatchedBars = ({
  providerContractId,
  timeframe,
  bars,
  enabled = true,
  instrumentationScope,
}: UseOptionQuotePatchedBarsInput): MarketBar[] => {
  const liveQuote = useStoredOptionQuoteSnapshot(providerContractId);
  const normalizedBaseBars = useMemo(
    () => normalizeBaseBars(bars || []),
    [bars],
  );
  const scopeKey = `${providerContractId?.trim?.() || ""}:${timeframe}`;
  const [patchedBars, setPatchedBars] = useState<MarketBar[]>(normalizedBaseBars);
  const baseBarsRef = useRef(normalizedBaseBars);
  const lastAppliedQuoteSignatureRef = useRef<string | null>(null);
  const quoteSignature = [
    resolveQuoteUpdatedAtMs(liveQuote?.updatedAt) ?? "",
    liveQuote?.price ?? "",
    liveQuote?.bid ?? "",
    liveQuote?.ask ?? "",
  ].join("|");

  useEffect(() => {
    baseBarsRef.current = normalizedBaseBars;
  }, [normalizedBaseBars]);

  useEffect(() => {
    setPatchedBars(normalizedBaseBars);
    lastAppliedQuoteSignatureRef.current = quoteSignature;
  }, [scopeKey]);

  useEffect(() => {
    setPatchedBars((current) => mergePatchedBars(normalizedBaseBars, current));
  }, [normalizedBaseBars]);

  useEffect(() => {
    if (!enabled || !providerContractId || !liveQuote) {
      return;
    }

    if (lastAppliedQuoteSignatureRef.current === quoteSignature) {
      return;
    }

    lastAppliedQuoteSignatureRef.current = quoteSignature;
    markChartLivePatchPending(instrumentationScope);
    setPatchedBars((current) =>
      patchBarsWithLiveQuote(
        current.length ? current : baseBarsRef.current,
        timeframe,
        liveQuote,
      ),
    );
  }, [
    enabled,
    liveQuote,
    normalizedBaseBars,
    providerContractId,
    quoteSignature,
    timeframe,
    instrumentationScope,
  ]);

  return patchedBars;
};

export const useHistoricalBarStream = ({
  symbol,
  timeframe,
  bars,
  enabled = true,
  assetClass,
  providerContractId,
  outsideRth,
  source,
  instrumentationScope,
}: UseHistoricalBarStreamInput): MarketBar[] => {
  const normalizedBaseBars = useMemo(
    () => normalizeBaseBars(bars || []),
    [bars],
  );
  const scopeKey = [
    symbol?.trim?.().toUpperCase?.() || "",
    timeframe,
    assetClass || "equity",
    providerContractId?.trim?.() || "",
    typeof outsideRth === "boolean" ? String(outsideRth) : "",
    source || "",
  ].join("::");
  const [streamedBars, setStreamedBars] = useState<MarketBar[]>(normalizedBaseBars);
  const baseBarsRef = useRef(normalizedBaseBars);
  const lastStreamSignatureRef = useRef<string | null>(null);
  const pageVisible = usePageVisible();
  const streamUrl = useMemo(
    () =>
      buildHistoricalBarStreamUrl({
        symbol,
        timeframe,
        assetClass,
        providerContractId,
        outsideRth,
        source,
      }),
    [assetClass, outsideRth, providerContractId, source, symbol, timeframe],
  );

  useEffect(() => {
    baseBarsRef.current = normalizedBaseBars;
  }, [normalizedBaseBars]);

  useEffect(() => {
    setStreamedBars(normalizedBaseBars);
    lastStreamSignatureRef.current = null;
  }, [scopeKey]);

  useEffect(() => {
    setStreamedBars((current) => mergePatchedBars(normalizedBaseBars, current));
  }, [normalizedBaseBars]);

  useEffect(() => {
    if (
      !enabled ||
      !pageVisible ||
      !streamUrl ||
      typeof window === "undefined" ||
      typeof window.EventSource === "undefined"
    ) {
      return;
    }

    const sourceConnection = new EventSource(streamUrl);
    const handleBar = (event: MessageEvent<string>) => {
      const payload = parseHistoricalBarStreamPayload(event.data);
      if (!payload?.bar) {
        return;
      }

      const nextSignature = JSON.stringify({
        timestamp:
          payload.bar.timestamp instanceof Date
            ? payload.bar.timestamp.toISOString()
            : String(payload.bar.timestamp),
        open: payload.bar.open,
        high: payload.bar.high,
        low: payload.bar.low,
        close: payload.bar.close,
        volume: payload.bar.volume,
      });
      if (nextSignature === lastStreamSignatureRef.current) {
        return;
      }
      lastStreamSignatureRef.current = nextSignature;

      markChartLivePatchPending(instrumentationScope);
      setStreamedBars((current) =>
        patchBarsWithHistoricalBarStream(
          current.length ? current : baseBarsRef.current,
          payload.bar,
        ),
      );
    };

    sourceConnection.addEventListener("bar", handleBar as EventListener);
    return () => {
      sourceConnection.removeEventListener("bar", handleBar as EventListener);
      sourceConnection.close();
    };
  }, [enabled, instrumentationScope, pageVisible, scopeKey, streamUrl]);

  return streamedBars;
};

export const useMassiveStreamedStockBars = useBrokerStreamedBars;
