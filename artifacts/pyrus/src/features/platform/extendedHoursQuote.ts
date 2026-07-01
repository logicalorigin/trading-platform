import { resolveUsEquityMarketSession } from "@workspace/market-calendar";

type ExtendedHoursSessionLabel = "Pre" | "After" | "Overnight";
type ExtendedHoursAxisLabel = "PRE" | "AFT" | "OVN";
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
  sessionKey: "pre" | "after" | "overnight";
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

  const tickTimestamp =
    dateValue(quote.dataUpdatedAt) || dateValue(quote.updatedAt);
  const nowTimestamp = dateValue(now);
  // The price shown is the latest tick, but the session we LABEL is a function of
  // the wall clock when a caller supplies one: a frozen tick carried over from an
  // earlier session (e.g. an after-hours print still on screen during overnight)
  // is labeled by the session we are actually in, not the one it was stamped in.
  // Callers that pass no clock (e.g. historical chart legends) fall back to the
  // tick's own session.
  const sessionAnchor = nowTimestamp || tickTimestamp;
  const timestamp = tickTimestamp || nowTimestamp;
  if (!timestamp || !sessionAnchor) {
    return null;
  }

  const session = resolveUsEquityMarketSession(sessionAnchor);
  if (
    session.key !== "pre" &&
    session.key !== "after" &&
    session.key !== "overnight"
  ) {
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
    sessionLabel:
      session.key === "pre"
        ? "Pre"
        : session.key === "after"
          ? "After"
          : "Overnight",
    axisLabel:
      session.key === "pre" ? "PRE" : session.key === "after" ? "AFT" : "OVN",
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
