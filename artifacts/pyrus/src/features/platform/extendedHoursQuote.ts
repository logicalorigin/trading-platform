import { resolveUsEquityMarketSession } from "@workspace/market-calendar";

type ExtendedHoursSessionLabel = "Pre" | "After";
type ExtendedHoursAxisLabel = "PRE" | "AFT";
type ExtendedHoursTone = "positive" | "negative" | "neutral";

export type ExtendedHoursQuoteInput = {
  price?: number | null;
  extendedBaselinePrice?: number | null;
  extendedBaselineAt?: Date | string | number | null;
  extendedBaselineSource?: "regular_close" | null;
  dataUpdatedAt?: Date | string | number | null;
  updatedAt?: Date | string | number | null;
  freshness?: string | null;
  marketDataMode?: string | null;
  delayed?: boolean | null;
};

export type ExtendedHoursQuoteDisplay = {
  visible: boolean;
  sessionKey: "pre" | "after";
  sessionLabel: ExtendedHoursSessionLabel;
  axisLabel: ExtendedHoursAxisLabel;
  price: number;
  baselinePrice: number;
  baselineAt: Date | null;
  change: number;
  changePercent: number;
  tone: ExtendedHoursTone;
  timestamp: Date;
  freshness: string | null;
  marketDataMode: string | null;
  delayed: boolean;
};

const finiteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const dateValue = (value: Date | string | number | null | undefined): Date | null => {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const resolveExtendedHoursQuoteDisplay = ({
  quote,
  now,
}: {
  quote?: ExtendedHoursQuoteInput | null;
  now?: Date | string | number | null;
}): ExtendedHoursQuoteDisplay | null => {
  if (!quote) return null;

  const timestamp =
    dateValue(quote.dataUpdatedAt) ||
    dateValue(quote.updatedAt) ||
    dateValue(now);
  if (!timestamp) {
    return null;
  }

  const session = resolveUsEquityMarketSession(timestamp);
  if (session.key !== "pre" && session.key !== "after") {
    return null;
  }

  const price = finiteNumber(quote.price);
  const baselinePrice = finiteNumber(quote.extendedBaselinePrice);
  if (
    price == null ||
    baselinePrice == null ||
    price <= 0 ||
    baselinePrice <= 0 ||
    quote.extendedBaselineSource !== "regular_close"
  ) {
    return null;
  }

  const change = price - baselinePrice;
  const changePercent = (change / baselinePrice) * 100;
  return {
    visible: true,
    sessionKey: session.key,
    sessionLabel: session.key === "pre" ? "Pre" : "After",
    axisLabel: session.key === "pre" ? "PRE" : "AFT",
    price,
    baselinePrice,
    baselineAt: dateValue(quote.extendedBaselineAt),
    change,
    changePercent,
    tone: change > 0 ? "positive" : change < 0 ? "negative" : "neutral",
    timestamp,
    freshness: quote.freshness ?? null,
    marketDataMode: quote.marketDataMode ?? null,
    delayed: quote.delayed === true,
  };
};
