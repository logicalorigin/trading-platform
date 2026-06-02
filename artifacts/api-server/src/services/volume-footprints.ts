import {
  type FootprintAssetClass,
  type FootprintCandle,
  type FootprintClassificationMethod,
  type FootprintDiagnostics,
  type FootprintLevel,
  type FootprintPartialReason,
  type FootprintResponse,
  type FootprintSourcePreference,
  type FootprintSourceProvider,
} from "@workspace/ibkr-contracts";
import {
  getMassiveProviderIdentity,
  getMassiveRuntimeConfig,
} from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import {
  MassiveMarketDataClient,
  type MarketQuoteTick,
  type MarketTradePrint,
} from "../providers/massive/market-data";

export type FootprintTimeframe =
  | "5s"
  | "15s"
  | "30s"
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | "30m"
  | "1h";

export type GetVolumeFootprintsInput = {
  symbol: string;
  assetClass?: FootprintAssetClass;
  timeframe: string;
  from?: Date | null;
  to?: Date | null;
  providerContractId?: string | null;
  optionTicker?: string | null;
  outsideRth?: boolean;
  ticksPerRow?: number;
  imbalancePercent?: number;
  maxBars?: number;
  sourcePreference?: FootprintSourcePreference;
  signal?: AbortSignal;
};

const FOOTPRINT_TIMEFRAME_MS: Record<FootprintTimeframe, number> = {
  "5s": 5_000,
  "15s": 15_000,
  "30s": 30_000,
  "1m": 60_000,
  "2m": 120_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
};
const DEFAULT_TICKS_PER_ROW = 1;
const DEFAULT_IMBALANCE_PERCENT = 300;
const EQUITY_MAX_BARS = 80;
const OPTION_MAX_BARS = 40;
const DEFAULT_LOOKBACK_BARS = 40;
const MAX_QUOTE_MATCH_AGE_MS = 10_000;

const isFootprintTimeframe = (value: string): value is FootprintTimeframe =>
  Object.prototype.hasOwnProperty.call(FOOTPRINT_TIMEFRAME_MS, value);

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const sanitizePositiveInteger = (
  value: number | undefined,
  fallback: number,
  cap: number,
): number => {
  if (!finiteNumber(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(value), cap));
};

const emptyDiagnostics = (
  input: {
    sourceProvider: FootprintSourceProvider;
    sourcePreference: FootprintSourcePreference;
    minTick?: number;
    minTickSource?: FootprintDiagnostics["minTickSource"];
    rowSize?: number;
    capped?: boolean;
  },
): FootprintDiagnostics => ({
  sourceProvider: input.sourceProvider,
  sourcePreference: input.sourcePreference,
  classificationMethod: "unknown",
  classifiedVolume: 0,
  unknownVolume: 0,
  quoteMatchedTradeCount: 0,
  tickRuleTradeCount: 0,
  unknownTradeCount: 0,
  tradeCount: 0,
  quoteCount: 0,
  bidAskCoveragePercent: 0,
  minTick: input.minTick ?? 0.01,
  minTickSource: input.minTickSource ?? "default",
  rowSize: input.rowSize ?? input.minTick ?? 0.01,
  capped: Boolean(input.capped),
});

const emptyResponse = (
  input: GetVolumeFootprintsInput & {
    assetClass: FootprintAssetClass;
    sourcePreference: FootprintSourcePreference;
    from: Date;
    to: Date;
    partialReason: FootprintPartialReason;
    sourceProvider?: FootprintSourceProvider;
    capped?: boolean;
  },
): FootprintResponse => ({
  symbol: normalizeSymbol(input.symbol),
  assetClass: input.assetClass,
  timeframe: input.timeframe as FootprintResponse["timeframe"],
  from: input.from,
  to: input.to,
  providerContractId: input.providerContractId ?? null,
  optionTicker: input.optionTicker ?? null,
  candles: [],
  complete: false,
  partialReason: input.partialReason,
  diagnostics: emptyDiagnostics({
    sourceProvider: input.sourceProvider ?? "none",
    sourcePreference: input.sourcePreference,
    capped: input.capped,
  }),
});

const inferMinTick = (
  trades: readonly MarketTradePrint[],
): { minTick: number; source: FootprintDiagnostics["minTickSource"] } => {
  const prices = Array.from(
    new Set(
      trades
        .map((trade) => trade.price)
        .filter((price) => Number.isFinite(price) && price > 0)
        .map((price) => Number(price.toFixed(6))),
    ),
  ).sort((left, right) => left - right);

  let minDelta = Number.POSITIVE_INFINITY;
  for (let index = 1; index < prices.length; index += 1) {
    const delta = Number((prices[index] - prices[index - 1]).toFixed(6));
    if (delta > 0) {
      minDelta = Math.min(minDelta, delta);
    }
  }

  if (Number.isFinite(minDelta)) {
    return { minTick: minDelta, source: "inferred" };
  }

  const firstPrice = prices[0] ?? 1;
  return {
    minTick: firstPrice >= 1 ? 0.01 : 0.0001,
    source: "default",
  };
};

const precisionForStep = (step: number): number => {
  if (!Number.isFinite(step) || step <= 0) {
    return 2;
  }
  const text = step.toFixed(8).replace(/0+$/, "");
  const dotIndex = text.indexOf(".");
  return dotIndex === -1 ? 0 : Math.min(8, text.length - dotIndex - 1);
};

const roundToStep = (value: number, step: number): number => {
  const precision = precisionForStep(step);
  return Number((Math.round(value / step) * step).toFixed(precision));
};

const resolveWindow = (input: {
  timeframe: FootprintTimeframe;
  from?: Date | null;
  to?: Date | null;
  maxBars: number;
}): { from: Date; to: Date; capped: boolean } => {
  const stepMs = FOOTPRINT_TIMEFRAME_MS[input.timeframe];
  const to =
    input.to && Number.isFinite(input.to.getTime()) ? input.to : new Date();
  const fallbackFrom = new Date(to.getTime() - stepMs * DEFAULT_LOOKBACK_BARS);
  const requestedFrom =
    input.from && Number.isFinite(input.from.getTime()) ? input.from : fallbackFrom;
  const requestedSpanMs = Math.max(0, to.getTime() - requestedFrom.getTime());
  const requestedBars = Math.ceil(requestedSpanMs / stepMs);
  if (requestedBars <= input.maxBars) {
    return { from: requestedFrom, to, capped: false };
  }
  return {
    from: new Date(to.getTime() - stepMs * input.maxBars),
    to,
    capped: true,
  };
};

const bucketStartMs = (timeMs: number, stepMs: number): number =>
  Math.floor(timeMs / stepMs) * stepMs;

const classifyTrades = (input: {
  trades: MarketTradePrint[];
  quotes: MarketQuoteTick[];
}): Array<
  MarketTradePrint & {
    side: "buy" | "sell" | "unknown";
    method: FootprintClassificationMethod;
  }
> => {
  let quoteIndex = 0;
  let previousPrice: number | null = null;
  let previousSide: "buy" | "sell" | "unknown" = "unknown";

  return input.trades.map((trade) => {
    const tradeTimeMs = trade.occurredAt.getTime();
    while (
      quoteIndex + 1 < input.quotes.length &&
      input.quotes[quoteIndex + 1].occurredAt.getTime() <= tradeTimeMs
    ) {
      quoteIndex += 1;
    }

    const quote = input.quotes[quoteIndex];
    const quoteAgeMs = quote
      ? Math.abs(tradeTimeMs - quote.occurredAt.getTime())
      : Number.POSITIVE_INFINITY;
    if (quote && quoteAgeMs <= MAX_QUOTE_MATCH_AGE_MS) {
      if (trade.price >= quote.ask) {
        previousPrice = trade.price;
        previousSide = "buy";
        return { ...trade, side: "buy", method: "quote_match" };
      }
      if (trade.price <= quote.bid) {
        previousPrice = trade.price;
        previousSide = "sell";
        return { ...trade, side: "sell", method: "quote_match" };
      }
    }

    if (previousPrice !== null) {
      if (trade.price > previousPrice) {
        previousPrice = trade.price;
        previousSide = "buy";
        return { ...trade, side: "buy", method: "tick_rule" };
      }
      if (trade.price < previousPrice) {
        previousPrice = trade.price;
        previousSide = "sell";
        return { ...trade, side: "sell", method: "tick_rule" };
      }
      if (previousSide !== "unknown") {
        previousPrice = trade.price;
        return { ...trade, side: previousSide, method: "tick_rule" };
      }
    }

    previousPrice = trade.price;
    return { ...trade, side: "unknown", method: "unknown" };
  });
};

const buildCandles = (input: {
  trades: ReturnType<typeof classifyTrades>;
  timeframe: FootprintTimeframe;
  from: Date;
  to: Date;
  rowSize: number;
  imbalancePercent: number;
  capped: boolean;
}): FootprintCandle[] => {
  const stepMs = FOOTPRINT_TIMEFRAME_MS[input.timeframe];
  const byCandle = new Map<
    number,
    {
      prices: number[];
      levels: Map<number, FootprintLevel>;
      buyVolume: number;
      sellVolume: number;
      unknownVolume: number;
      tradeCount: number;
    }
  >();

  input.trades.forEach((trade) => {
    const timeMs = trade.occurredAt.getTime();
    if (timeMs < input.from.getTime() || timeMs > input.to.getTime()) {
      return;
    }
    const candleTime = bucketStartMs(timeMs, stepMs);
    const price = roundToStep(trade.price, input.rowSize);
    const candle =
      byCandle.get(candleTime) ??
      {
        prices: [],
        levels: new Map<number, FootprintLevel>(),
        buyVolume: 0,
        sellVolume: 0,
        unknownVolume: 0,
        tradeCount: 0,
      };
    const level =
      candle.levels.get(price) ??
      {
        price,
        buyVolume: 0,
        sellVolume: 0,
        unknownVolume: 0,
        totalVolume: 0,
        delta: 0,
        tradeCount: 0,
        buyImbalance: false,
        sellImbalance: false,
      };

    if (trade.side === "buy") {
      level.buyVolume += trade.size;
      candle.buyVolume += trade.size;
    } else if (trade.side === "sell") {
      level.sellVolume += trade.size;
      candle.sellVolume += trade.size;
    } else {
      level.unknownVolume += trade.size;
      candle.unknownVolume += trade.size;
    }
    level.totalVolume += trade.size;
    level.delta = level.buyVolume - level.sellVolume;
    level.tradeCount += 1;
    candle.tradeCount += 1;
    candle.prices.push(trade.price);
    candle.levels.set(price, level);
    byCandle.set(candleTime, candle);
  });

  const imbalanceRatio = Math.max(100, input.imbalancePercent) / 100;
  return Array.from(byCandle.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([timeMs, candle]) => {
      const levels = Array.from(candle.levels.values()).sort(
        (left, right) => right.price - left.price,
      );
      const levelByPrice = new Map(
        levels.map((level) => [roundToStep(level.price, input.rowSize), level]),
      );
      levels.forEach((level) => {
        const lowerLevel = levelByPrice.get(
          roundToStep(level.price - input.rowSize, input.rowSize),
        );
        const upperLevel = levelByPrice.get(
          roundToStep(level.price + input.rowSize, input.rowSize),
        );
        level.buyImbalance =
          Boolean(lowerLevel) &&
          level.buyVolume > 0 &&
          level.buyVolume >= imbalanceRatio * (lowerLevel?.sellVolume ?? 0);
        level.sellImbalance =
          Boolean(upperLevel) &&
          level.sellVolume > 0 &&
          level.sellVolume >= imbalanceRatio * (upperLevel?.buyVolume ?? 0);
      });
      const poc =
        levels.reduce<FootprintLevel | null>(
          (best, level) =>
            !best || level.totalVolume > best.totalVolume ? level : best,
          null,
        )?.price ?? null;
      const open = candle.prices[0] ?? null;
      const close = candle.prices[candle.prices.length - 1] ?? null;
      const high = candle.prices.length ? Math.max(...candle.prices) : null;
      const low = candle.prices.length ? Math.min(...candle.prices) : null;
      const partialReason = input.capped ? "window_capped" : null;

      return {
        time: new Date(timeMs),
        endTime: new Date(timeMs + stepMs),
        open,
        high,
        low,
        close,
        volume: candle.buyVolume + candle.sellVolume + candle.unknownVolume,
        buyVolume: candle.buyVolume,
        sellVolume: candle.sellVolume,
        unknownVolume: candle.unknownVolume,
        delta: candle.buyVolume - candle.sellVolume,
        tradeCount: candle.tradeCount,
        pocPrice: poc,
        levels,
        complete: !partialReason,
        partialReason,
      };
    });
};

export async function getVolumeFootprints(
  input: GetVolumeFootprintsInput,
): Promise<FootprintResponse> {
  const assetClass: FootprintAssetClass =
    input.assetClass === "option" ? "option" : "equity";
  const sourcePreference = input.sourcePreference ?? "massive_first";
  const normalizedSymbol = normalizeSymbol(input.symbol);
  const timeframe = input.timeframe;

  if (!normalizedSymbol || !isFootprintTimeframe(timeframe)) {
    const to = input.to ?? new Date();
    return emptyResponse({
      ...input,
      assetClass,
      sourcePreference,
      from: input.from ?? new Date(to.getTime() - 60_000),
      to,
      partialReason: "unsupported_timeframe",
    });
  }

  const maxBars = sanitizePositiveInteger(
    input.maxBars,
    assetClass === "option" ? OPTION_MAX_BARS : EQUITY_MAX_BARS,
    assetClass === "option" ? OPTION_MAX_BARS : EQUITY_MAX_BARS,
  );
  const window = resolveWindow({
    timeframe,
    from: input.from,
    to: input.to,
    maxBars,
  });
  const ticksPerRow = sanitizePositiveInteger(
    input.ticksPerRow,
    DEFAULT_TICKS_PER_ROW,
    20,
  );
  const imbalancePercent = sanitizePositiveInteger(
    input.imbalancePercent,
    DEFAULT_IMBALANCE_PERCENT,
    10_000,
  );
  const config = getMassiveRuntimeConfig();
  if (!config) {
    return emptyResponse({
      ...input,
      assetClass,
      sourcePreference,
      from: window.from,
      to: window.to,
      sourceProvider: "none",
      partialReason: "provider_unavailable",
      capped: window.capped,
    });
  }

  const sourceProvider: FootprintSourceProvider =
    getMassiveProviderIdentity(config) ?? "massive";
  const client = new MassiveMarketDataClient(config);
  let trades: MarketTradePrint[] = [];
  let quotes: MarketQuoteTick[] = [];

  try {
    if (assetClass === "option") {
      const optionTicker = input.optionTicker?.trim();
      if (!optionTicker) {
        return emptyResponse({
          ...input,
          assetClass,
          sourcePreference,
          from: window.from,
          to: window.to,
          sourceProvider,
          partialReason: "missing_option_ticker",
          capped: window.capped,
        });
      }
      [trades, quotes] = await Promise.all([
        client.getOptionTradePrints({
          optionTicker,
          from: window.from,
          to: window.to,
          maxPages: 20,
          signal: input.signal,
        }),
        client.getOptionQuoteTicks({
          optionTicker,
          from: window.from,
          to: window.to,
          maxPages: 20,
          signal: input.signal,
        }).catch(() => []),
      ]);
    } else {
      [trades, quotes] = await Promise.all([
        client.getStockTradePrints({
          symbol: normalizedSymbol,
          from: window.from,
          to: window.to,
          maxPages: 20,
          signal: input.signal,
        }),
        client.getStockQuoteTicks({
          symbol: normalizedSymbol,
          from: window.from,
          to: window.to,
          maxPages: 20,
          signal: input.signal,
        }).catch(() => []),
      ]);
    }
  } catch {
    return emptyResponse({
      ...input,
      assetClass,
      sourcePreference,
      from: window.from,
      to: window.to,
      sourceProvider,
      partialReason: "request_failed",
      capped: window.capped,
    });
  }

  if (!trades.length) {
    return emptyResponse({
      ...input,
      assetClass,
      sourcePreference,
      from: window.from,
      to: window.to,
      sourceProvider,
      partialReason: "no_trades",
      capped: window.capped,
    });
  }

  const minTick = inferMinTick(trades);
  const rowSize = minTick.minTick * ticksPerRow;
  const classified = classifyTrades({ trades, quotes });
  const candles = buildCandles({
    trades: classified,
    timeframe,
    from: window.from,
    to: window.to,
    rowSize,
    imbalancePercent,
    capped: window.capped,
  });
  const quoteMatchedTradeCount = classified.filter(
    (trade) => trade.method === "quote_match",
  ).length;
  const tickRuleTradeCount = classified.filter(
    (trade) => trade.method === "tick_rule",
  ).length;
  const unknownTradeCount = classified.filter(
    (trade) => trade.method === "unknown",
  ).length;
  const classifiedVolume = classified.reduce(
    (sum, trade) => sum + (trade.side === "unknown" ? 0 : trade.size),
    0,
  );
  const unknownVolume = classified.reduce(
    (sum, trade) => sum + (trade.side === "unknown" ? trade.size : 0),
    0,
  );
  const classificationMethod: FootprintClassificationMethod =
    quoteMatchedTradeCount > 0
      ? "quote_match"
      : tickRuleTradeCount > 0
        ? "tick_rule"
        : "unknown";
  const partialReason = window.capped ? "window_capped" : null;

  return {
    symbol: normalizedSymbol,
    assetClass,
    timeframe,
    from: window.from,
    to: window.to,
    providerContractId: input.providerContractId ?? null,
    optionTicker: input.optionTicker ?? null,
    candles,
    complete: !partialReason,
    partialReason,
    diagnostics: {
      sourceProvider,
      sourcePreference,
      classificationMethod,
      classifiedVolume,
      unknownVolume,
      quoteMatchedTradeCount,
      tickRuleTradeCount,
      unknownTradeCount,
      tradeCount: classified.length,
      quoteCount: quotes.length,
      bidAskCoveragePercent: classified.length
        ? Math.round((quoteMatchedTradeCount / classified.length) * 100)
        : 0,
      minTick: minTick.minTick,
      minTickSource: minTick.source,
      rowSize,
      capped: window.capped,
    },
  };
}

export const __volumeFootprintInternalsForTests = {
  buildCandles,
  classifyTrades,
  inferMinTick,
  isFootprintTimeframe,
  resolveWindow,
};
