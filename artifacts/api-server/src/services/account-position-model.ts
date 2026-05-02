import type {
  BrokerPositionSnapshot,
  QuoteSnapshot,
} from "../providers/ibkr/client";

export const POSITION_QUANTITY_EPSILON = 1e-9;

export type PositionMarketHydration = {
  mark: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  dayChange: number | null;
  dayChangePercent: number | null;
  source: "IBKR_POSITIONS" | "QUOTE_SNAPSHOT";
};

export function isOpenBrokerPosition(
  position: Pick<BrokerPositionSnapshot, "quantity">,
): boolean {
  return Math.abs(Number(position.quantity)) > POSITION_QUANTITY_EPSILON;
}

export function filterOpenBrokerPositions<
  T extends Pick<BrokerPositionSnapshot, "quantity">,
>(positions: T[]): T[] {
  return positions.filter(isOpenBrokerPosition);
}

export function positionReferenceSymbol(position: BrokerPositionSnapshot): string {
  return position.optionContract?.underlying ?? position.symbol;
}

export function positionSignedNotional(position: BrokerPositionSnapshot): number {
  const marketValue = Number(position.marketValue);
  if (
    Number.isFinite(marketValue) &&
    Math.abs(marketValue) > POSITION_QUANTITY_EPSILON
  ) {
    return marketValue;
  }

  const averagePrice = Number(position.averagePrice);
  const quantity = Number(position.quantity);
  const multiplier = Number(position.optionContract?.multiplier ?? 1);
  if (
    Number.isFinite(averagePrice) &&
    Number.isFinite(quantity) &&
    Number.isFinite(multiplier) &&
    Math.abs(quantity) > POSITION_QUANTITY_EPSILON &&
    averagePrice > 0 &&
    multiplier > 0
  ) {
    return averagePrice * quantity * multiplier;
  }

  return Number.isFinite(marketValue) ? marketValue : 0;
}

export function positionMultiplier(position: BrokerPositionSnapshot): number {
  return Number(position.optionContract?.multiplier ?? 1);
}

export function canHydratePositionFromEquityQuote(
  position: BrokerPositionSnapshot,
): boolean {
  return !position.optionContract && position.assetClass !== "option";
}

export function buildPositionMarketHydration(
  position: BrokerPositionSnapshot,
  quote: QuoteSnapshot | null | undefined,
): PositionMarketHydration {
  const quantity = Number(position.quantity);
  const averagePrice = Number(position.averagePrice);
  const multiplier = positionMultiplier(position);
  const quotePrice = Number(quote?.price);
  const quoteChange = Number(quote?.change);
  const quotePrevClose = Number(quote?.prevClose);
  const hasQuotePrice =
    canHydratePositionFromEquityQuote(position) &&
    Number.isFinite(quotePrice) &&
    quotePrice > 0;
  const mark = hasQuotePrice
    ? quotePrice
    : Math.abs(Number(position.marketPrice) || 0) > POSITION_QUANTITY_EPSILON
      ? position.marketPrice
      : averagePrice;
  const marketValue =
    Number.isFinite(mark) &&
    Number.isFinite(quantity) &&
    Number.isFinite(multiplier)
      ? mark * quantity * multiplier
      : positionSignedNotional(position);
  const unrealizedPnl =
    Number.isFinite(mark) &&
    Number.isFinite(averagePrice) &&
    Number.isFinite(quantity) &&
    Number.isFinite(multiplier)
      ? (mark - averagePrice) * quantity * multiplier
      : position.unrealizedPnl;
  const unrealizedPnlPercent =
    Number.isFinite(mark) && Number.isFinite(averagePrice) && averagePrice !== 0
      ? ((mark - averagePrice) / averagePrice) * 100
      : position.unrealizedPnlPercent;
  const dayChange =
    hasQuotePrice && Number.isFinite(quoteChange)
      ? quoteChange * quantity * multiplier
      : null;
  const previousValue =
    Number.isFinite(quotePrevClose) &&
    Number.isFinite(quantity) &&
    Number.isFinite(multiplier)
      ? quotePrevClose * quantity * multiplier
      : null;

  return {
    mark,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPercent,
    dayChange,
    dayChangePercent:
      dayChange !== null && previousValue
        ? (dayChange / Math.abs(previousValue)) * 100
        : null,
    source: hasQuotePrice ? "QUOTE_SNAPSHOT" : "IBKR_POSITIONS",
  };
}
