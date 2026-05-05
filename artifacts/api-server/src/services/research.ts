import { HttpError } from "../lib/errors";
import { getFmpRuntimeConfig } from "../lib/runtime";
import {
  FmpResearchClient,
  type ResearchCalendarEntry,
  type ResearchEarningsEvent,
  type ResearchFiling,
  type ResearchFinancials,
  type ResearchFundamentals,
  type ResearchSnapshot,
  type TranscriptDateEntry,
  type TranscriptEntry,
} from "../providers/fmp/client";
import { getQuoteSnapshots } from "./platform";
import { firstDefined, normalizeSymbol } from "../lib/values";

const EARNINGS_EVENT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EARNINGS_EVENT_FETCH_TIMEOUT_MS = 8_000;
const EARNINGS_EVENT_LOOKBACK_YEARS = 2;
const EARNINGS_EVENT_FORWARD_DAYS = 180;

type EarningsEventChunkCache = {
  monthKey: string;
  from: string;
  to: string;
  fetchedAtMs: number;
  eventKeys: Set<string>;
};

const earningsEventCacheByKey = new Map<string, ResearchEarningsEvent>();
const earningsEventChunkCache = new Map<string, EarningsEventChunkCache>();

export function resetResearchEarningsEventCacheForTests(): void {
  earningsEventCacheByKey.clear();
  earningsEventChunkCache.clear();
}

function getResearchClient(): FmpResearchClient {
  const config = getFmpRuntimeConfig();

  if (!config) {
    throw new HttpError(503, "Research data provider is not configured.", {
      code: "research_not_configured",
      detail:
        "Set FMP_API_KEY, FMP_KEY, or FINANCIAL_MODELING_PREP_API_KEY to enable fundamentals, catalyst calendar, filings, and transcript research endpoints.",
    });
  }

  return new FmpResearchClient(config);
}

function getOptionalResearchClient(): FmpResearchClient | null {
  const config = getFmpRuntimeConfig();
  return config ? new FmpResearchClient(config) : null;
}

export async function getResearchStatus() {
  const configured = Boolean(getOptionalResearchClient());

  return {
    configured,
    provider: configured ? ("fmp" as const) : null,
  };
}

function isoDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clampEarningsEventWindow(from: Date, to: Date): { from: Date; to: Date } {
  const now = new Date();
  const earliest = new Date(Date.UTC(
    now.getUTCFullYear() - EARNINGS_EVENT_LOOKBACK_YEARS,
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const latest = addUtcDays(now, EARNINGS_EVENT_FORWARD_DAYS);
  const safeFrom = Number.isFinite(from.getTime()) ? from : earliest;
  const safeTo = Number.isFinite(to.getTime()) ? to : latest;
  const clampedFrom = new Date(Math.max(safeFrom.getTime(), earliest.getTime()));
  const clampedTo = new Date(Math.min(safeTo.getTime(), latest.getTime()));

  if (clampedFrom.getTime() > latest.getTime()) {
    return { from: latest, to: latest };
  }
  if (clampedTo.getTime() < earliest.getTime()) {
    return { from: earliest, to: earliest };
  }
  return clampedFrom.getTime() <= clampedTo.getTime()
    ? { from: clampedFrom, to: clampedTo }
    : { from: clampedFrom, to: clampedFrom };
}

function getEarningsEventMonthKeys(from: Date, to: Date): Date[] {
  const months: Date[] = [];
  let cursor = startOfUtcMonth(from);
  const end = startOfUtcMonth(to);

  while (cursor.getTime() <= end.getTime()) {
    months.push(cursor);
    cursor = addUtcMonths(cursor, 1);
  }

  return months;
}

function getEarningsEventCacheKey(event: ResearchEarningsEvent): string {
  return [
    normalizeSymbol(event.symbol),
    event.date || "unknown-date",
    event.reportingTime || "unknown-time",
  ].join(":");
}

function normalizeCachedEarningsEvent(event: ResearchEarningsEvent): ResearchEarningsEvent | null {
  const symbol = normalizeSymbol(event.symbol);
  if (!symbol || !event.date) {
    return null;
  }
  return {
    ...event,
    symbol,
    reportingTime: event.reportingTime || null,
    provider: "fmp",
  };
}

function cacheEarningsEventChunk(
  month: Date,
  events: ResearchEarningsEvent[],
): void {
  const monthKey = isoDateKey(startOfUtcMonth(month)).slice(0, 7);
  const prior = earningsEventChunkCache.get(monthKey);
  prior?.eventKeys.forEach((eventKey) => earningsEventCacheByKey.delete(eventKey));

  const eventKeys = new Set<string>();
  events.forEach((event) => {
    const normalized = normalizeCachedEarningsEvent(event);
    if (!normalized) return;
    const eventKey = getEarningsEventCacheKey(normalized);
    earningsEventCacheByKey.set(eventKey, normalized);
    eventKeys.add(eventKey);
  });

  earningsEventChunkCache.set(monthKey, {
    monthKey,
    from: isoDateKey(startOfUtcMonth(month)),
    to: isoDateKey(endOfUtcMonth(month)),
    fetchedAtMs: Date.now(),
    eventKeys,
  });
}

function isEarningsEventChunkFresh(month: Date): boolean {
  const monthKey = isoDateKey(startOfUtcMonth(month)).slice(0, 7);
  const chunk = earningsEventChunkCache.get(monthKey);
  return Boolean(
    chunk && Date.now() - chunk.fetchedAtMs <= EARNINGS_EVENT_CACHE_TTL_MS,
  );
}

async function withEarningsEventTimeout<T>(
  promise: Promise<T>,
  timeoutMs = EARNINGS_EVENT_FETCH_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new HttpError(504, "Earnings events provider timed out.", {
              code: "earnings_events_timeout",
            }),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function refreshEarningsEventChunk(
  client: FmpResearchClient,
  month: Date,
): Promise<void> {
  const events = await withEarningsEventTimeout(
    client.getEarningsCalendarEvents(startOfUtcMonth(month), endOfUtcMonth(month)),
  );
  cacheEarningsEventChunk(month, events);
}

function selectCachedEarningsEvents(input: {
  symbol: string;
  from: Date;
  to: Date;
}): ResearchEarningsEvent[] {
  const fromKey = isoDateKey(input.from);
  const toKey = isoDateKey(input.to);

  return Array.from(earningsEventCacheByKey.values())
    .filter((event) => {
      if (event.symbol !== input.symbol) return false;
      if (!event.date) return false;
      return event.date >= fromKey && event.date <= toKey;
    })
    .sort((left, right) => {
      if (left.date !== right.date) {
        return (left.date || "") < (right.date || "") ? -1 : 1;
      }
      return (left.reportingTime || "").localeCompare(right.reportingTime || "");
    });
}

export async function getResearchFundamentals(input: {
  symbol: string;
}): Promise<{ symbol: string; fundamentals: ResearchFundamentals | null }> {
  const symbol = normalizeSymbol(input.symbol);
  const client = getResearchClient();

  return {
    symbol,
    fundamentals: await client.getFundamentals(symbol),
  };
}

export async function getResearchFinancials(input: {
  symbol: string;
}): Promise<{ symbol: string; financials: ResearchFinancials | null }> {
  const symbol = normalizeSymbol(input.symbol);
  const client = getOptionalResearchClient();

  return {
    symbol,
    financials: client ? await client.getFinancials(symbol).catch(() => null) : null,
  };
}

export async function getResearchSnapshots(input: {
  symbols: string;
}): Promise<{ snapshots: ResearchSnapshot[] }> {
  const symbols = input.symbols
    .split(",")
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean);

  if (symbols.length === 0) {
    return { snapshots: [] };
  }

  const researchClient = getOptionalResearchClient();
  const [quotePayload, enrichedSnapshots] = await Promise.all([
    getQuoteSnapshots({ symbols: symbols.join(",") }).catch(() => ({
      quotes: [],
      transport: null,
      delayed: false,
      fallbackUsed: false,
    })),
    researchClient?.getSnapshots(symbols).catch(() => []) ?? Promise.resolve([]),
  ]);

  const brokerQuotesBySymbol = new Map(
    quotePayload.quotes.map((quote) => [quote.symbol, quote]),
  );
  const enrichedBySymbol = new Map(
    enrichedSnapshots.map((snapshot) => [snapshot.symbol, snapshot]),
  );

  return {
    snapshots: symbols.map((symbol) => {
      const quote = brokerQuotesBySymbol.get(symbol);
      const enriched = enrichedBySymbol.get(symbol);

      return {
        symbol,
        price: firstDefined(quote?.price, enriched?.price),
        bid: firstDefined(quote?.bid, enriched?.bid),
        ask: firstDefined(quote?.ask, enriched?.ask),
        change: firstDefined(quote?.change, enriched?.change),
        changePercent: firstDefined(quote?.changePercent, enriched?.changePercent),
        dayLow: firstDefined(quote?.low, enriched?.dayLow),
        dayHigh: firstDefined(quote?.high, enriched?.dayHigh),
        yearLow: enriched?.yearLow ?? null,
        yearHigh: enriched?.yearHigh ?? null,
        mc: enriched?.mc ?? null,
        pe: enriched?.pe ?? null,
        eps: enriched?.eps ?? null,
        sharesOut: enriched?.sharesOut ?? null,
      };
    }),
  };
}

export async function getResearchCalendar(input: {
  from: Date;
  to: Date;
}): Promise<{ entries: ResearchCalendarEntry[] }> {
  const client = getResearchClient();

  return {
    entries: await client.getEarningsCalendar(input.from, input.to),
  };
}

export async function getResearchEarningsEvents(input: {
  symbol: string;
  from: Date;
  to: Date;
}): Promise<{
  symbol: string;
  from: string;
  to: string;
  events: ResearchEarningsEvent[];
}> {
  const symbol = normalizeSymbol(input.symbol);
  const { from, to } = clampEarningsEventWindow(input.from, input.to);
  const months = getEarningsEventMonthKeys(from, to);
  const staleMonths = months.filter((month) => !isEarningsEventChunkFresh(month));
  const client = getResearchClient();

  const refreshResults = await Promise.allSettled(
    staleMonths.map((month) => refreshEarningsEventChunk(client, month)),
  );
  const cachedEvents = selectCachedEarningsEvents({ symbol, from, to });
  const everyRefreshFailed =
    staleMonths.length > 0 &&
    refreshResults.length > 0 &&
    refreshResults.every((result) => result.status === "rejected");

  if (!cachedEvents.length && everyRefreshFailed) {
    const failure = refreshResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure?.reason instanceof HttpError) {
      throw failure.reason;
    }
    throw new HttpError(503, "Earnings events provider unavailable.", {
      code: "earnings_events_unavailable",
      cause: failure?.reason,
    });
  }

  return {
    symbol,
    from: isoDateKey(from),
    to: isoDateKey(to),
    events: cachedEvents,
  };
}

export async function getResearchFilings(input: {
  symbol: string;
  limit?: number;
}): Promise<{ symbol: string; filings: ResearchFiling[] }> {
  const symbol = normalizeSymbol(input.symbol);
  const client = getResearchClient();

  return {
    symbol,
    filings: await client.getSecFilings(symbol, input.limit ?? 25),
  };
}

export async function getResearchTranscriptDates(input: {
  symbol: string;
}): Promise<{ symbol: string; transcripts: TranscriptDateEntry[] }> {
  const symbol = normalizeSymbol(input.symbol);
  const client = getResearchClient();

  return {
    symbol,
    transcripts: await client.getTranscriptDates(symbol),
  };
}

export async function getResearchTranscript(input: {
  symbol: string;
  quarter?: number;
  year?: number;
}): Promise<{ symbol: string; transcript: TranscriptEntry | null }> {
  const symbol = normalizeSymbol(input.symbol);
  const client = getResearchClient();

  return {
    symbol,
    transcript: await client.getTranscript(symbol, input.quarter, input.year),
  };
}
