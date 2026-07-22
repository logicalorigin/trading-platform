import {
  formatEnumLabel,
  formatRelativeTimeShort,
} from "../../lib/formatters";
import { formatAppDate } from "../../lib/timeZone";

export const finiteNumber = (value) => {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const positiveNumber = (value) => {
  const numeric = finiteNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
};

const dateValue = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const firstText = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const normalizeQuoteSource = (value, fallback) => {
  const source = firstText(value);
  if (!source) return fallback ?? null;
  if (/massive/i.test(source)) {
    return fallback === "option_quote" ? "option_quote" : "massive";
  }
  return source;
};

const isAutomationEventQuoteSource = (source) =>
  source === "automation_event_quote";

const quoteMetadata = (quote) => ({
  providerContractId: firstText(quote?.providerContractId),
  transport: firstText(quote?.transport),
  delayed: quote?.delayed ?? null,
  latency:
    quote?.latency && typeof quote.latency === "object"
      ? quote.latency
      : null,
  dataUpdatedAt: firstText(quote?.dataUpdatedAt),
  ageMs: finiteNumber(quote?.ageMs),
  cacheAgeMs: finiteNumber(quote?.cacheAgeMs),
  status: firstText(quote?.status, quote?.quoteStatus),
  reason: firstText(quote?.reason),
  quoteStatus: firstText(quote?.quoteStatus, quote?.status),
  quoteReason: firstText(quote?.quoteReason),
  greeksStatus: firstText(quote?.greeksStatus),
  greeksReason: firstText(quote?.greeksReason),
  demandStatus: firstText(quote?.demandStatus),
  demandReason: firstText(quote?.demandReason),
  quoteFreshness: firstText(quote?.quoteFreshness, quote?.freshness),
  greeksFreshness: firstText(quote?.greeksFreshness),
  underlyingPrice: positiveNumber(quote?.underlyingPrice),
  unavailableDetail: firstText(
    quote?.unavailableDetail,
    quote?.quoteReason,
    quote?.reason,
  ),
});

const buildQuote = (quote, fallbackMark, source) => {
  if (!quote) {
    const mark = positiveNumber(fallbackMark);
    return mark == null
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
          source: source === "option_quote" || source === "bridge_quote" ? "position_mark" : source,
        };
  }

  const normalizedSource = normalizeQuoteSource(quote.source, source);
  const automationEventQuote = isAutomationEventQuoteSource(normalizedSource);
  const bid = automationEventQuote ? null : finiteNumber(quote.bid);
  const ask = automationEventQuote ? null : finiteNumber(quote.ask);
  const last = automationEventQuote ? null : positiveNumber(quote.last ?? quote.price);
  const quotedMid = automationEventQuote ? null : positiveNumber(quote.mid);
  const mid =
    bid != null && ask != null && bid > 0 && ask > 0
      ? (bid + ask) / 2
      : quotedMid;
  const mark = mid ?? positiveNumber(quote.mark) ?? last ?? positiveNumber(fallbackMark);
  const spread = automationEventQuote
    ? null
    : bid != null && ask != null ? ask - bid : finiteNumber(quote.spread);
  return {
    bid,
    ask,
    mid,
    last,
    mark,
    spread,
    spreadPercent:
      automationEventQuote
        ? null
        : finiteNumber(quote.spreadPercent) ??
      (spread != null && mark != null && mark > 0 ? (spread / mark) * 100 : null),
    bidSize: automationEventQuote ? null : finiteNumber(quote.bidSize),
    askSize: automationEventQuote ? null : finiteNumber(quote.askSize),
    updatedAt: firstText(quote.updatedAt, quote.dataUpdatedAt, quote.quoteUpdatedAt),
    freshness: firstText(quote.quoteFreshness, quote.freshness),
    marketDataMode: firstText(quote.marketDataMode),
    source: normalizedSource,
    ...quoteMetadata(quote),
  };
};

const markOnlyQuote = (quote, fallbackMark, source) => {
  const mark = positiveNumber(fallbackMark) ?? positiveNumber(quote?.mark);
  if (!quote && mark == null) return null;
  return {
    ...(quote || {}),
    bid: null,
    ask: null,
    mid: null,
    last: null,
    mark,
    spread: null,
    spreadPercent: null,
    bidSize: null,
    askSize: null,
    source,
  };
};

const quoteHasBidAsk = (quote) => quote?.bid != null && quote.ask != null;

const quoteHasMark = (quote) => quote?.mark != null || quote?.mid != null || quote?.last != null;

const chooseBestQuote = (...quotes) =>
  quotes.find(quoteHasBidAsk) ??
  quotes.find(quoteHasMark) ??
  quotes.find(Boolean) ??
  null;

export const getPositionOpenedAt = (row) => {
  const automation = row?.automationContext || null;
  const automationOpened = firstText(
    automation?.openedAt,
    automation?.purchasedAt,
    automation?.signalAt,
  );
  if (automationOpened) {
    return {
      openedAt: automationOpened,
      openedAtSource: "automation",
    };
  }

  const openedAt = firstText(row?.openedAt);
  return {
    openedAt,
    openedAtSource: openedAt ? firstText(row?.openedAtSource) ?? "unknown" : null,
  };
};

export const getPositionQuote = (row, liveOptionQuote = null) => {
  const backendQuote = buildQuote(row?.quote, row?.mark ?? row?.marketPrice, "bridge_quote");
  const backendDisplayQuote = isAutomationEventQuoteSource(row?.optionQuote?.source)
    ? markOnlyQuote(backendQuote, row?.mark ?? row?.marketPrice, "automation_event_quote")
    : backendQuote;
  return chooseBestQuote(
    liveOptionQuote ? buildQuote(liveOptionQuote, row?.mark, "option_quote") : null,
    row?.optionQuote ? buildQuote(row.optionQuote, row?.mark, "option_quote") : null,
    backendDisplayQuote,
  );
};

export const positionCostBasis = (row) => {
  const quantity = finiteNumber(row?.quantity);
  const averageCost = finiteNumber(row?.averageCost ?? row?.averagePrice);
  const multiplier = finiteNumber(row?.optionContract?.multiplier ?? row?.optionContract?.sharesPerContract) ?? 1;
  if (quantity == null || averageCost == null) return null;
  return averageCost * quantity * multiplier;
};

export const formatPositionOpenedLabel = (openedAt) => {
  const date = dateValue(openedAt);
  return date
    ? formatAppDate(date, {
        month: "2-digit",
        day: "2-digit",
        year: "2-digit",
      })
    : null;
};

export const formatPositionAgeLabel = (openedAt) => {
  const date = dateValue(openedAt);
  return date ? formatRelativeTimeShort(date) : null;
};

export const formatPositionOpenedSource = (source) =>
  source ? formatEnumLabel(source) : null;

export const formatPositionBidAskLabel = (quote, formatter) => {
  if (!quote || quote.bid == null || quote.ask == null) return null;
  return `${formatter(quote.bid)} / ${formatter(quote.ask)}`;
};

export const formatPositionSpreadLabel = (quote, percentFormatter) => {
  if (!quote) return null;
  if (quote.spreadPercent != null) return `${percentFormatter(quote.spreadPercent)} sprd`;
  if (quote.spread != null) return `${quote.spread.toFixed(2)} sprd`;
  return null;
};

export const formatPositionQuoteFreshnessLabel = (quote) => {
  if (!quote) return null;
  const freshnessAt = firstText(
    quote.latency?.apiServerReceivedAt,
    quote.latency?.apiServerEmittedAt,
    quote.updatedAt,
  );
  const updated = freshnessAt ? formatRelativeTimeShort(freshnessAt) : null;
  return [quote.freshness, updated].filter(Boolean).join(" · ") || null;
};

export const buildPositionDisplayModel = (row, liveOptionQuote = null) => {
  const opened = getPositionOpenedAt(row);
  return {
    ...opened,
    openedLabel: formatPositionOpenedLabel(opened.openedAt),
    ageLabel: formatPositionAgeLabel(opened.openedAt),
    openedSourceLabel: formatPositionOpenedSource(opened.openedAtSource),
    quote: getPositionQuote(row, liveOptionQuote),
    costBasis: positionCostBasis(row),
  };
};
