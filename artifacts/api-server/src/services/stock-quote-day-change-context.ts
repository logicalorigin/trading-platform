import type { QuoteSnapshot } from "../providers/ibkr/client";
import { normalizeSymbol } from "../lib/values";

type QuoteDayChangeFields = Pick<
  QuoteSnapshot,
  | "symbol"
  | "price"
  | "change"
  | "changePercent"
  | "open"
  | "high"
  | "low"
  | "prevClose"
  | "volume"
  | "updatedAt"
>;

type DayChangeContext = {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  volume: number | null;
  updatedAtMs: number;
  recordedAtMs: number;
};

const contextBySymbol = new Map<string, DayChangeContext>();

function positiveIntegerEnv(name: string, fallback: number): number {
  const configured = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

function dayChangeContextTtlMs(): number {
  return positiveIntegerEnv("STOCK_QUOTE_DAY_CHANGE_CONTEXT_TTL_MS", 30_000);
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  }
  return null;
}

function hasUsablePrevClose(value: unknown): value is number {
  const number = finiteNumber(value);
  return number !== null && number !== 0;
}

function hasUsableDayChangeContext(quote: QuoteDayChangeFields): boolean {
  return (
    hasUsablePrevClose(quote.prevClose) ||
    finiteNumber(quote.open) !== null ||
    finiteNumber(quote.high) !== null ||
    finiteNumber(quote.low) !== null ||
    finiteNumber(quote.volume) !== null
  );
}

export function recordStockQuoteDayChangeContext(
  quote: QuoteDayChangeFields,
  recordedAtMs = Date.now(),
): boolean {
  const symbol = normalizeSymbol(quote.symbol);
  if (!symbol || !hasUsableDayChangeContext(quote)) {
    return false;
  }

  const updatedAtMs = timestampMs(quote.updatedAt) ?? recordedAtMs;
  const existing = contextBySymbol.get(symbol);
  if (existing && updatedAtMs < existing.updatedAtMs) {
    return false;
  }

  contextBySymbol.set(symbol, {
    symbol,
    price: finiteNumber(quote.price) ?? existing?.price ?? 0,
    change: finiteNumber(quote.change) ?? existing?.change ?? 0,
    changePercent:
      finiteNumber(quote.changePercent) ?? existing?.changePercent ?? 0,
    open: finiteNumber(quote.open) ?? existing?.open ?? null,
    high: finiteNumber(quote.high) ?? existing?.high ?? null,
    low: finiteNumber(quote.low) ?? existing?.low ?? null,
    prevClose: finiteNumber(quote.prevClose) ?? existing?.prevClose ?? null,
    volume: finiteNumber(quote.volume) ?? existing?.volume ?? null,
    updatedAtMs,
    recordedAtMs,
  });
  return true;
}

export function recordStockQuoteDayChangeContexts(
  quotes: QuoteDayChangeFields[],
  recordedAtMs = Date.now(),
): void {
  quotes.forEach((quote) => {
    recordStockQuoteDayChangeContext(quote, recordedAtMs);
  });
}

export function getSymbolsNeedingStockQuoteDayChangeContext(
  symbols: string[],
  nowMs = Date.now(),
): string[] {
  const ttlMs = dayChangeContextTtlMs();
  return Array.from(
    new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
  ).filter((symbol) => {
    const context = contextBySymbol.get(symbol);
    return !context || nowMs - context.recordedAtMs >= ttlMs;
  });
}

export function enrichStockQuoteWithDayChangeContext<
  T extends QuoteDayChangeFields,
>(quote: T): T {
  const symbol = normalizeSymbol(quote.symbol);
  if (!symbol) {
    return quote;
  }

  if (hasUsableDayChangeContext(quote) && hasUsablePrevClose(quote.prevClose)) {
    recordStockQuoteDayChangeContext(quote);
    return quote;
  }

  const context = contextBySymbol.get(symbol);
  if (!context) {
    return quote;
  }

  const price = finiteNumber(quote.price);
  const prevClose = hasUsablePrevClose(quote.prevClose)
    ? quote.prevClose
    : context.prevClose;
  const canComputeDayChange = price !== null && hasUsablePrevClose(prevClose);
  const change = canComputeDayChange ? price - prevClose : context.change;
  const changePercent = canComputeDayChange
    ? (change / Math.abs(prevClose)) * 100
    : context.changePercent;
  const high =
    context.high !== null && price !== null
      ? Math.max(context.high, price)
      : (quote.high ?? context.high);
  const low =
    context.low !== null && price !== null
      ? Math.min(context.low, price)
      : (quote.low ?? context.low);

  return {
    ...quote,
    change,
    changePercent,
    open: quote.open ?? context.open,
    high,
    low,
    prevClose: quote.prevClose ?? context.prevClose,
    volume: quote.volume ?? context.volume,
  };
}

export const __stockQuoteDayChangeContextTestInternals = {
  reset() {
    contextBySymbol.clear();
  },
  snapshot() {
    return Array.from(contextBySymbol.values()).map((context) => ({
      ...context,
    }));
  },
};
