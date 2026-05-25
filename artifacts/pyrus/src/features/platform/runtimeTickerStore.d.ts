export type RuntimeTickerSnapshot = {
  name?: string | null;
  price?: number | null;
  bid?: number | null;
  ask?: number | null;
  chg?: number | null;
  pct?: number | null;
  iv?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  prevClose?: number | null;
  volume?: number | null;
  updatedAt?: string | Date | number | null;
  dataUpdatedAt?: string | Date | number | null;
  freshness?: string | null;
  marketDataMode?: string | null;
  spark?: Array<Record<string, unknown>>;
  sparkBars?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export const TRADE_TICKER_INFO: Record<string, RuntimeTickerSnapshot>;

export function ensureTradeTickerInfo(
  symbol: string,
  fallbackName?: string,
): RuntimeTickerSnapshot;

export function applyRuntimeTickerInfoPatch(
  symbol: string,
  fallbackName: string | null | undefined,
  patch: Record<string, unknown>,
): {
  tradeInfo: RuntimeTickerSnapshot;
  changed: boolean;
};

export function notifyRuntimeTickerSnapshotSymbols(symbols: string[]): void;

export function getRuntimeTickerSnapshot<TFallback = null>(
  symbol: string | null | undefined,
  fallback?: TFallback,
): RuntimeTickerSnapshot | TFallback;

export function useRuntimeTickerSnapshot<TFallback = null>(
  symbol: string | null | undefined,
  fallback?: TFallback,
  options?: { subscribe?: boolean },
): RuntimeTickerSnapshot | TFallback;

export function useRuntimeTickerSnapshots(
  symbols: Array<string | null | undefined>,
): Record<string, RuntimeTickerSnapshot | null>;

export function publishRuntimeTickerSnapshot(
  symbol: string | null | undefined,
  fallbackName: string | null | undefined,
  patch: Record<string, unknown>,
): RuntimeTickerSnapshot | null;
