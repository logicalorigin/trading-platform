import type { MarketBar } from "./types";

export const DISPLAY_CHART_OUTSIDE_RTH = true;
export const DISPLAY_CHART_PRICE_TIMEFRAME = "1m";

export const resolveDisplayChartOutsideRth = (_timeframe?: string): boolean =>
  DISPLAY_CHART_OUTSIDE_RTH;

const resolveFiniteNumber = (
  ...values: Array<number | null | undefined>
): number | null => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
};

const resolveLatestBarClose = (
  bars: MarketBar[] | null | undefined,
): number | null => {
  const latestBar = Array.isArray(bars) ? bars[bars.length - 1] : null;
  return latestBar ? resolveFiniteNumber(latestBar.c, latestBar.close) : null;
};

export const resolveDisplayChartPrice = ({
  quotePrice,
  canonicalBars,
  renderedBars,
}: {
  quotePrice?: number | null;
  canonicalBars?: MarketBar[] | null;
  renderedBars?: MarketBar[] | null;
}): number | null =>
  resolveFiniteNumber(quotePrice) ??
  resolveLatestBarClose(renderedBars) ??
  resolveLatestBarClose(canonicalBars);
