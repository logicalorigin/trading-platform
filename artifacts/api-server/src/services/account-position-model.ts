import type {
  BrokerPositionSnapshot,
  PositionQuoteSnapshot,
  PositionQuoteSource,
  QuoteSnapshot,
} from "../providers/ibkr/client";

export const POSITION_QUANTITY_EPSILON = 1e-9;
const POSITION_MARKET_TIME_ZONE = "America/New_York";

const positionMarketDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: POSITION_MARKET_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type PositionMarketHydration = {
  mark: number | null;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  dayChange: number | null;
  dayChangePercent: number | null;
  source: "IBKR_POSITIONS" | "QUOTE_SNAPSHOT";
};

export type PositionMarketHydrationOptions = {
  openedAt?: Date | string | null;
  now?: Date | string | null;
};

function dateOrNull(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const raw = value.trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    return new Date(
      Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), 12),
    );
  }
  const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dashed) {
    return new Date(
      Date.UTC(Number(dashed[1]), Number(dashed[2]) - 1, Number(dashed[3]), 12),
    );
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnlyMarketDateKey(value: Date | string | null | undefined): string | null {
  if (typeof value === "string") {
    const raw = value.trim();
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const dashed = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  }
  if (
    value instanceof Date &&
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  ) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function marketDateKey(value: Date | string | null | undefined): string | null {
  const dateOnlyKey = dateOnlyMarketDateKey(value);
  if (dateOnlyKey) return dateOnlyKey;
  const date = dateOrNull(value);
  if (!date) return null;
  const parts = positionMarketDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function positionOpenedOnSameMarketDay(
  openedAt: Date | string | null | undefined,
  now: Date | string | null | undefined = new Date(),
): boolean {
  const opened = dateOrNull(openedAt);
  const observedAt = dateOrNull(now);
  if (!opened || !observedAt || opened.getTime() > observedAt.getTime()) {
    return false;
  }
  const openedKey = marketDateKey(opened);
  const nowKey = marketDateKey(observedAt);
  return Boolean(openedKey && nowKey && openedKey === nowKey);
}

function positiveFiniteNumberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function quoteMidOrNull(quote: QuoteSnapshot | null | undefined): number | null {
  const bid = Number(quote?.bid);
  const ask = Number(quote?.ask);
  return Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0
    ? (bid + ask) / 2
    : null;
}

function quoteMarkOrNull(
  quote: QuoteSnapshot | null | undefined,
  preferQuotePrice = false,
): number | null {
  const quotePrice = positiveFiniteNumberOrNull(quote?.price);
  const quoteMid = quoteMidOrNull(quote);
  const rawQuoteMark = positiveFiniteNumberOrNull(
    (quote as (QuoteSnapshot & { mark?: unknown }) | null | undefined)?.mark,
  );
  const quoteLast = positiveFiniteNumberOrNull(
    (quote as (QuoteSnapshot & { last?: unknown }) | null | undefined)?.last,
  );
  const quoteMark = quoteMid ?? rawQuoteMark ?? quotePrice ?? quoteLast;
  return preferQuotePrice ? quotePrice ?? quoteMark : quoteMark;
}

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
    if (position.optionContract) {
      const quantity = Number(position.quantity);
      const multiplier = positionMultiplier(position);
      const marketPrice = positionMarketPrice(position);
      if (
        Number.isFinite(quantity) &&
        Number.isFinite(multiplier) &&
        Number.isFinite(marketPrice) &&
        Math.abs(quantity) > POSITION_QUANTITY_EPSILON &&
        multiplier > 0 &&
        marketPrice > 0
      ) {
        return marketPrice * quantity * multiplier;
      }
    }
    return marketValue;
  }

  const averagePrice = positionAveragePrice(position);
  const quantity = Number(position.quantity);
  const multiplier = positionMultiplier(position);
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
  const multiplier = Number(position.optionContract?.multiplier ?? 1);
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
}

export function canHydratePositionFromEquityQuote(
  position: BrokerPositionSnapshot,
): boolean {
  return !position.optionContract && position.assetClass !== "option";
}

const optionPriceLooksContractScaled = (
  price: number,
  position: BrokerPositionSnapshot,
  multiplier: number,
): boolean => {
  if (!position.optionContract || multiplier <= 1 || price <= 0) {
    return false;
  }

  const quantity = Math.abs(Number(position.quantity));
  const marketValue = Math.abs(Number(position.marketValue));
  const unrealizedPnl = Number(position.unrealizedPnl);
  const rawAveragePrice = Number(position.averagePrice);
  const rawMarketPrice = Number(position.marketPrice);
  const rawPriceIsFlatFallback =
    Number.isFinite(rawAveragePrice) &&
    Number.isFinite(rawMarketPrice) &&
    Math.abs(rawAveragePrice - rawMarketPrice) <= 1e-9 &&
    Number.isFinite(unrealizedPnl) &&
    Math.abs(unrealizedPnl) <= 0.01;
  const inferredCostBasis =
    Number.isFinite(marketValue) && Number.isFinite(unrealizedPnl)
      ? Math.abs(marketValue - unrealizedPnl)
      : null;

  if (
    inferredCostBasis != null &&
    inferredCostBasis > POSITION_QUANTITY_EPSILON &&
    quantity > POSITION_QUANTITY_EPSILON
  ) {
    const contractScaledBasis = Math.abs(price * quantity);
    const premiumBasis = Math.abs(price * quantity * multiplier);
    const contractScaledDistance =
      Math.abs(contractScaledBasis - inferredCostBasis) / inferredCostBasis;
    const premiumDistance =
      Math.abs(premiumBasis - inferredCostBasis) / inferredCostBasis;
    if (contractScaledDistance <= 0.02 && premiumDistance > 0.02) {
      return true;
    }
    if (premiumDistance <= 0.02 && contractScaledDistance > 0.02) {
      return false;
    }
  }

  if (rawPriceIsFlatFallback) {
    return false;
  }

  return price >= multiplier * 0.5;
};

export function normalizePositionOptionPremiumPrice(
  position: BrokerPositionSnapshot,
  value: unknown,
): number {
  const price = Number(value);
  if (!Number.isFinite(price)) {
    return 0;
  }
  const multiplier = positionMultiplier(position);
  return optionPriceLooksContractScaled(price, position, multiplier)
    ? price / multiplier
    : price;
}

export function positionAveragePrice(position: BrokerPositionSnapshot): number {
  return normalizePositionOptionPremiumPrice(position, position.averagePrice);
}

export function positionMarketPrice(position: BrokerPositionSnapshot): number {
  return normalizePositionOptionPremiumPrice(position, position.marketPrice);
}

export function buildPositionMarketHydration(
  position: BrokerPositionSnapshot,
  quote: QuoteSnapshot | null | undefined,
  options: PositionMarketHydrationOptions = {},
): PositionMarketHydration {
  const quantity = Number(position.quantity);
  const averagePrice = positionAveragePrice(position);
  const multiplier = positionMultiplier(position);
  const quoteChange = finiteNumberOrNull(quote?.change);
  const quotePrevClose = finiteNumberOrNull(quote?.prevClose);
  const quoteMark = quoteMarkOrNull(
    quote,
    canHydratePositionFromEquityQuote(position),
  );
  const hasQuoteMark = quoteMark !== null;
  const marketPrice = positionMarketPrice(position);
  const positionMark =
    Math.abs(marketPrice || 0) > POSITION_QUANTITY_EPSILON
      ? marketPrice
      : null;
  const mark = hasQuoteMark
    ? quoteMark
    : positionMark;
  const hasMark = mark !== null && Number.isFinite(mark);
  const marketValue =
    hasMark &&
    Number.isFinite(quantity) &&
    Number.isFinite(multiplier)
      ? mark * quantity * multiplier
      : positionSignedNotional(position);
  const unrealizedPnl =
    hasMark &&
    Number.isFinite(averagePrice) &&
    Number.isFinite(quantity) &&
    Number.isFinite(multiplier)
      ? (mark - averagePrice) * quantity * multiplier
      : position.unrealizedPnl;
  const costBasis =
    Number.isFinite(averagePrice) &&
    Number.isFinite(quantity) &&
    Number.isFinite(multiplier)
      ? Math.abs(averagePrice * quantity * multiplier)
      : null;
  const unrealizedPnlPercent =
    Number.isFinite(unrealizedPnl) && costBasis && costBasis > 0
      ? (unrealizedPnl / costBasis) * 100
      : position.unrealizedPnlPercent;
  const openedAt = options.openedAt ?? position.openedAt ?? null;
  const sameDayPosition = positionOpenedOnSameMarketDay(
    openedAt,
    options.now ?? new Date(),
  );
  let quoteDayChange: number | null = null;
  if (
    hasQuoteMark &&
    Number.isFinite(quantity) &&
    Number.isFinite(multiplier)
  ) {
    if (
      quoteChange !== null &&
      (quoteChange !== 0 || quotePrevClose !== null)
    ) {
      quoteDayChange = quoteChange * quantity * multiplier;
    } else if (quotePrevClose !== null && hasMark) {
      quoteDayChange = (mark - quotePrevClose) * quantity * multiplier;
    }
  }
  const dayChange = sameDayPosition ? unrealizedPnl : quoteDayChange;
  const previousValue =
    quotePrevClose !== null &&
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
      sameDayPosition
        ? unrealizedPnlPercent
        : dayChange !== null && previousValue !== null && previousValue !== 0
        ? (dayChange / Math.abs(previousValue)) * 100
        : null,
    source: hasQuoteMark ? "QUOTE_SNAPSHOT" : "IBKR_POSITIONS",
  };
}

function positiveNumberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function quoteTimestamp(quote: QuoteSnapshot | null | undefined): Date | null {
  const timestamp = quote?.dataUpdatedAt ?? quote?.updatedAt ?? null;
  return timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
    ? timestamp
    : null;
}

export function buildPositionQuoteFromSnapshot(
  quote: QuoteSnapshot | null | undefined,
  fallbackMark: number | null | undefined,
  source: PositionQuoteSource = "bridge_quote",
): PositionQuoteSnapshot | null {
  if (!quote) {
    const mark = positiveNumberOrNull(fallbackMark);
    return mark === null
      ? null
      : {
          bid: null,
          ask: null,
          mid: null,
          last: null,
          mark,
          spread: null,
          spreadPercent: null,
          bidSize: null,
          askSize: null,
          updatedAt: null,
          freshness: null,
          marketDataMode: null,
          source:
            source === "bridge_quote" || source === "option_quote"
              ? "position_mark"
              : source,
        };
  }

  const bid = finiteNumberOrNull(quote.bid);
  const ask = finiteNumberOrNull(quote.ask);
  const quoteRecord = quote as QuoteSnapshot & {
    cacheAgeMs?: unknown;
    dataUpdatedAt?: unknown;
    dayChange?: unknown;
    dayChangePercent?: unknown;
    demandReason?: unknown;
    demandStatus?: unknown;
    greeksFreshness?: unknown;
    greeksReason?: unknown;
    greeksStatus?: unknown;
    last?: unknown;
    mark?: unknown;
    quoteFreshness?: unknown;
    quoteReason?: unknown;
    quoteStatus?: unknown;
    reason?: unknown;
    status?: unknown;
    undPrice?: unknown;
    underlyingPrice?: unknown;
  };
  const last =
    positiveNumberOrNull(quoteRecord.last) ?? positiveNumberOrNull(quote.price);
  const quoteMark = positiveNumberOrNull(quoteRecord.mark);
  const mid =
    bid !== null && ask !== null && bid > 0 && ask > 0
      ? (bid + ask) / 2
      : null;
  const mark =
    mid ?? quoteMark ?? last ?? positiveNumberOrNull(fallbackMark);
  const spread = bid !== null && ask !== null ? ask - bid : null;

  return {
    bid,
    ask,
    mid,
    last,
    mark,
    spread,
    spreadPercent:
      spread !== null && mark !== null && mark > 0 ? (spread / mark) * 100 : null,
    bidSize: finiteNumberOrNull(quote.bidSize),
    askSize: finiteNumberOrNull(quote.askSize),
    updatedAt: quoteTimestamp(quote),
    freshness: quote.freshness ?? null,
    marketDataMode: quote.marketDataMode ?? null,
    source,
    providerContractId: quote.providerContractId ?? null,
    transport: quote.transport ?? null,
    delayed: quote.delayed ?? null,
    dataUpdatedAt:
      quote.dataUpdatedAt instanceof Date && !Number.isNaN(quote.dataUpdatedAt.getTime())
        ? quote.dataUpdatedAt
        : null,
    ageMs: finiteNumberOrNull(quote.ageMs),
    cacheAgeMs: finiteNumberOrNull(quoteRecord.cacheAgeMs),
    status:
      typeof quoteRecord.status === "string"
        ? quoteRecord.status
        : typeof quoteRecord.quoteStatus === "string"
          ? quoteRecord.quoteStatus
          : null,
    reason: typeof quoteRecord.reason === "string" ? quoteRecord.reason : null,
    quoteStatus:
      typeof quoteRecord.quoteStatus === "string" ? quoteRecord.quoteStatus : null,
    quoteReason:
      typeof quoteRecord.quoteReason === "string" ? quoteRecord.quoteReason : null,
    greeksStatus:
      typeof quoteRecord.greeksStatus === "string" ? quoteRecord.greeksStatus : null,
    greeksReason:
      typeof quoteRecord.greeksReason === "string" ? quoteRecord.greeksReason : null,
    demandStatus:
      typeof quoteRecord.demandStatus === "string" ? quoteRecord.demandStatus : null,
    demandReason:
      typeof quoteRecord.demandReason === "string" ? quoteRecord.demandReason : null,
    quoteFreshness:
      typeof quoteRecord.quoteFreshness === "string"
        ? quoteRecord.quoteFreshness
        : quote.freshness ?? null,
    greeksFreshness:
      typeof quoteRecord.greeksFreshness === "string"
        ? quoteRecord.greeksFreshness
        : quote.freshness ?? null,
    unavailableDetail:
      typeof quoteRecord.quoteReason === "string"
        ? quoteRecord.quoteReason
        : typeof quoteRecord.reason === "string"
          ? quoteRecord.reason
          : null,
    price: finiteNumberOrNull(quote.price),
    dayChange: finiteNumberOrNull(quoteRecord.dayChange ?? quote.change),
    dayChangePercent: finiteNumberOrNull(
      quoteRecord.dayChangePercent ?? quote.changePercent,
    ),
    volume: finiteNumberOrNull(quote.volume),
    openInterest: finiteNumberOrNull(quote.openInterest),
    impliedVolatility: finiteNumberOrNull(quote.impliedVolatility),
    delta: finiteNumberOrNull(quote.delta),
    gamma: finiteNumberOrNull(quote.gamma),
    theta: finiteNumberOrNull(quote.theta),
    vega: finiteNumberOrNull(quote.vega),
    underlyingPrice: positiveNumberOrNull(
      quoteRecord.underlyingPrice ?? quoteRecord.undPrice,
    ),
  };
}

export function positionQuoteHasBidAsk(
  quote: PositionQuoteSnapshot | null | undefined,
): boolean {
  return quote?.bid != null && quote.ask != null;
}

export function choosePositionQuote(
  primary: PositionQuoteSnapshot | null | undefined,
  fallback: PositionQuoteSnapshot | null | undefined,
): PositionQuoteSnapshot | null {
  if (positionQuoteHasBidAsk(primary)) {
    return primary ?? null;
  }
  if (positionQuoteHasBidAsk(fallback)) {
    return fallback ?? null;
  }
  return primary ?? fallback ?? null;
}
