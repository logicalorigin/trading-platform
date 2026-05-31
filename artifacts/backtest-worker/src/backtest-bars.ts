import type { BacktestBar } from "@workspace/backtest-core";

export const OPTIONS_AGGREGATE_BARS_WARNING =
  "Options backtests use trade-derived option aggregates/bars; historical quote/NBBO replay is not available on the current Massive Developer plans.";

export const SIGNAL_OPTIONS_AGGREGATE_BARS_WARNING =
  "Signal-options backtests replay real option aggregate bars; historical bid/ask freshness gates are reported as configuration only.";

export type ApiBacktestBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  quoteAsOf?: string | null;
  providerContractId?: string | null;
  source?: string;
  delayed?: boolean;
};

export type StoredHistoricalBarRow = {
  startsAt: Date;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  bid?: unknown;
  ask?: unknown;
  mid?: unknown;
  quoteAsOf?: unknown;
  providerContractId?: unknown;
} & Record<string, unknown>;

function nullableNumber(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nullableDate(value: unknown): Date | null {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function quoteNumberForInsert(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

export function safeNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function normalizeApiBar(bar: ApiBacktestBar): BacktestBar {
  return {
    startsAt: new Date(bar.timestamp),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    bid: nullableNumber(bar.bid),
    ask: nullableNumber(bar.ask),
    mid: nullableNumber(bar.mid),
    quoteAsOf: nullableDate(bar.quoteAsOf),
    providerContractId: nullableString(bar.providerContractId),
    source: bar.source,
    delayed: bar.delayed,
  };
}

export function toHistoricalBarInsert(datasetId: string, bar: BacktestBar): {
  datasetId: string;
  startsAt: Date;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  bid: string | null;
  ask: string | null;
  mid: string | null;
  quoteAsOf: Date | null;
  providerContractId: string | null;
} {
  return {
    datasetId,
    startsAt: bar.startsAt,
    open: String(bar.open),
    high: String(bar.high),
    low: String(bar.low),
    close: String(bar.close),
    volume: String(bar.volume),
    bid: quoteNumberForInsert(bar.bid),
    ask: quoteNumberForInsert(bar.ask),
    mid: quoteNumberForInsert(bar.mid),
    quoteAsOf: nullableDate(bar.quoteAsOf),
    providerContractId: nullableString(bar.providerContractId),
  };
}

export function normalizeStoredHistoricalBar(
  row: StoredHistoricalBarRow,
): BacktestBar {
  return {
    startsAt: row.startsAt,
    open: safeNumber(row.open),
    high: safeNumber(row.high),
    low: safeNumber(row.low),
    close: safeNumber(row.close),
    volume: safeNumber(row.volume),
    bid: nullableNumber(row.bid),
    ask: nullableNumber(row.ask),
    mid: nullableNumber(row.mid),
    quoteAsOf: nullableDate(row.quoteAsOf),
    providerContractId: nullableString(row.providerContractId),
  };
}

export function hasHistoricalQuoteFields(bar: BacktestBar): boolean {
  return (
    bar.bid != null ||
    bar.ask != null ||
    bar.mid != null ||
    bar.quoteAsOf != null ||
    bar.providerContractId != null
  );
}
