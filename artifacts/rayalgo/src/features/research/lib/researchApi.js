import {
  getBars as getBarsRequest,
  getResearchEarningsCalendar as getResearchEarningsCalendarRequest,
  getResearchFinancials as getResearchFinancialsRequest,
  getResearchFundamentals as getResearchFundamentalsRequest,
  getResearchSnapshots as getResearchSnapshotsRequest,
  getResearchSecFilings as getResearchSecFilingsRequest,
  getResearchStatus as getResearchStatusRequest,
  getResearchTranscript as getResearchTranscriptRequest,
  getResearchTranscripts as getResearchTranscriptsRequest,
} from "@workspace/api-client-react";
import { FMP_REVERSE } from "../data/researchSymbols";

const QUOTE_BATCH_SIZE = 40;

export async function fetchResearchStatus() {
  try {
    return await getResearchStatusRequest();
  } catch (e) {
    return { configured: false, provider: null };
  }
}

export async function fetchQuotes(tickers) {
  const results = {};
  const uniqueTickers = [...new Set(tickers.map(t => String(t || "").trim().toUpperCase()).filter(Boolean))];

  for (let i = 0; i < uniqueTickers.length; i += QUOTE_BATCH_SIZE) {
    const batch = uniqueTickers.slice(i, i + QUOTE_BATCH_SIZE);

    try {
      const payload = await getResearchSnapshotsRequest({
        symbols: batch.join(","),
      });
      const quotes = Array.isArray(payload?.snapshots) ? payload.snapshots : [];

      quotes.forEach(q => {
        const internalTicker = FMP_REVERSE[q.symbol] || q.symbol;
        results[internalTicker] = {
          price: q.price,
          bid: q.bid,
          ask: q.ask,
          change: q.change,
          changePct: q.changePercent,
          dayLow: q.dayLow,
          dayHigh: q.dayHigh,
          yearLow: q.yearLow,
          yearHigh: q.yearHigh,
          mc: q.mc,
          pe: q.pe,
          eps: q.eps,
          sharesOut: q.sharesOut,
        };
      });
    } catch (e) {}
  }

  return results;
}

// Module-level cache for historical data: Map<ticker, {hist: [...], fetchedAt: ms, days: N}>
const histCache = new Map();
const HIST_CACHE_MS = 15 * 60 * 1000; // 15 minutes

// Module-level cache for fundamental ratios: Map<ticker, {data: {...}, fetchedAt: ms}>
// Fetches /ratios-ttm + /key-metrics-ttm + /profile (the last gives us live beta).
// These endpoints are single-ticker, so fetchFund is lazy — called per company on Detail open.
const fundCache = new Map();
const FUND_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

const financialsCache = new Map();
const FINANCIALS_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function fetchFund(ticker) {
  if (!ticker) return null;
  const cached = fundCache.get(ticker);
  if (cached && (Date.now() - cached.fetchedAt) < FUND_CACHE_MS) return cached.data;

  try {
    const payload = await getResearchFundamentalsRequest({ symbol: ticker });
    const data = payload?.fundamentals || null;

    if (!data) return null;

    fundCache.set(ticker, { data, fetchedAt: Date.now() });
    return data;
  } catch (e) {
    return null;
  }
}

export async function fetchFinancials(ticker) {
  if (!ticker) return null;
  const cached = financialsCache.get(ticker);
  if (cached && (Date.now() - cached.fetchedAt) < FINANCIALS_CACHE_MS) return cached.data;

  try {
    const payload = await getResearchFinancialsRequest({ symbol: ticker });
    const data = payload?.financials || null;

    financialsCache.set(ticker, { data, fetchedAt: Date.now() });
    return data;
  } catch (e) {
    return null;
  }
}

// Background prefetch: after initial app load, silently fetch TTM fundamentals for every
// enriched company so peer tables and detail panels always show fresh data (not authored fallback).
// Uses a bounded concurrency queue to avoid hammering the free-tier FMP rate limit (300 req/min).
// onProgress called with {done, total} after each completion for optional UI indicator.
export async function backgroundPrefetchFundamentals(tickers = [], onProgress = null) {
  const uniqueTickers = [...new Set(tickers.map(t => String(t || "").trim().toUpperCase()).filter(Boolean))];

  if (!uniqueTickers.length) return {};

  const concurrency = 6;
  const results = {};
  let cursor = 0;
  let done = 0;

  const runWorker = async () => {
    while (cursor < uniqueTickers.length) {
      const ticker = uniqueTickers[cursor++];
      let data = null;
      try {
        data = await fetchFund(ticker);
      } catch (e) {
        data = null;
      }
      results[ticker] = data ?? null;
      done += 1;
      onProgress?.({ done, total: uniqueTickers.length });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, uniqueTickers.length) }, () => runWorker()),
  );

  return results;
}

// Bulk prefetch of 1-hour intraday bars for ALL equities.
// Populates histCache with key `ticker|1hour` — covers last ~30 trading days at hourly resolution.
// Enables sparklines in PeerTable, instant 1M loads in Detail panel, momentum screens.
export async function backgroundPrefetchHist() {
  return;
}

// Module-level cache for earnings calendar — single fetch covers all tickers in a date range.
// Cache for 1 hour; calendar entries can shift as companies announce/reschedule.
let earningsCalCache = null; // { data: [...], fetchedAt: ms, from, to }
const EARNINGS_CAL_CACHE_MS = 60 * 60 * 1000;

export async function fetchEarningsCalendar(from, to) {
  if (earningsCalCache && (Date.now() - earningsCalCache.fetchedAt) < EARNINGS_CAL_CACHE_MS
      && earningsCalCache.from === from && earningsCalCache.to === to) {
    return earningsCalCache.data;
  }
  try {
    const payload = await getResearchEarningsCalendarRequest({ from, to });
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];
    if (Array.isArray(entries)) {
      const mapped = entries.map(entry => ({
        ...entry,
        internalTicker: FMP_REVERSE[entry.symbol] || entry.symbol,
      }));
      earningsCalCache = { data: mapped, fetchedAt: Date.now(), from, to };
      return mapped;
    }
    return null;
  } catch(e) {
    return null;
  }
}

// SEC filings cache: per-ticker list of recent filings. TTL 6 hours.
const secFilingsCache = new Map();
const SEC_FILINGS_CACHE_MS = 6 * 60 * 60 * 1000;

export async function fetchSECFilings(ticker) {
  if (!ticker) return null;
  const cached = secFilingsCache.get(ticker);
  if (cached && (Date.now() - cached.fetchedAt) < SEC_FILINGS_CACHE_MS) return cached.data;
  try {
    const payload = await getResearchSecFilingsRequest({ symbol: ticker, limit: 25 });
    const filings = Array.isArray(payload?.filings) ? payload.filings : null;
    if (Array.isArray(filings)) {
      secFilingsCache.set(ticker, { data: filings, fetchedAt: Date.now() });
      return filings;
    }
    return null;
  } catch(e) {
    return null;
  }
}

// Earnings call transcripts cache: per-ticker latest transcript. TTL 12 hours.
// FMP endpoint returns full transcript text with speaker-turn segmentation.
const transcriptsCache = new Map();
const TRANSCRIPTS_CACHE_MS = 12 * 60 * 60 * 1000;

export async function fetchTranscript(ticker, key, quarter, year) {
  if (!ticker) return null;
  const cacheKey = ticker + (quarter ? `-Q${quarter}` : "") + (year ? `-${year}` : "");
  const cached = transcriptsCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < TRANSCRIPTS_CACHE_MS) return cached.data;
  try {
    const payload = await getResearchTranscriptRequest({
      symbol: ticker,
      quarter,
      year,
    });
    const entry = payload?.transcript || null;
    if (entry) transcriptsCache.set(cacheKey, { data: entry, fetchedAt: Date.now() });
    return entry;
  } catch(e) {
    return null;
  }
}

// List of available transcript quarters for a ticker (lightweight metadata endpoint).
export async function fetchTranscriptList(ticker) {
  if (!ticker) return null;
  try {
    const payload = await getResearchTranscriptsRequest({ symbol: ticker });
    return Array.isArray(payload?.transcripts) ? payload.transcripts : null;
  } catch(e) {
    return null;
  }
}

// Pick the broker timeframe/granularity for a given period.
// Intraday gives us 15-min and 1-hour bars for recent short windows; daily otherwise.
// Returns { interval: "15min"|"1hour"|"daily", barsEstimate: number } for the period.
export function pickIntervalForPeriod(period) {
  switch (period) {
    case "1W":   return { interval: "15min", barsEstimate: 130 };   // ~5 days × 26 half-hours
    case "1M":   return { interval: "1hour", barsEstimate: 160 };   // ~22 trading days × 7 hours
    case "3M":   return { interval: "daily", barsEstimate: 66 };
    case "6M":   return { interval: "daily", barsEstimate: 130 };
    case "YTD":  return { interval: "daily", barsEstimate: 260 };
    case "1Y":   return { interval: "daily", barsEstimate: 260 };
    case "5Y":   return { interval: "daily", barsEstimate: 1300 };
    default:     return { interval: "daily", barsEstimate: 66 };
  }
}

export function resolveHistSourceLabel(bars) {
  const sources = new Set((bars || []).map((bar) => bar?.source).filter(Boolean));
  if (sources.has("ibkr+massive-gap-fill")) return "IBKR + GAP";
  if (sources.has("ibkr-history")) return "IBKR";
  if (sources.has("ibkr-websocket-derived")) return "IBKR WS";
  return sources.size ? "BROKER" : "";
}

export async function fetchHist(ticker, periodOrDays) {
  // Accept either a period string ("1W", "1M", ...) or legacy numeric days
  const { interval, barsEstimate } = typeof periodOrDays === "string"
    ? pickIntervalForPeriod(periodOrDays)
    : { interval: "daily", barsEstimate: periodOrDays };

  // Cache keyed by ticker+interval (intraday and daily don't share)
  const cacheKey = ticker + "|" + interval;
  const cached = histCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < HIST_CACHE_MS && cached.hist.length >= Math.min(barsEstimate, cached.hist.length)) {
    return {
      status: "live",
      hist: cached.hist.slice(-barsEstimate),
      interval,
      sourceLabel: cached.sourceLabel || "IBKR",
    };
  }
  try {
    const timeframe = interval === "15min" ? "15m" : interval === "1hour" ? "1h" : "1d";
    const payload = await getBarsRequest({
      symbol: ticker,
      timeframe,
      limit: barsEstimate,
      outsideRth: timeframe !== "1d",
      source: "trades",
    });
    const bars = Array.isArray(payload?.bars) ? payload.bars : [];
    const sourceLabel = resolveHistSourceLabel(bars) || "IBKR";
    let hist;
    if (interval === "daily") {
      if (bars.length > 0) {
        hist = bars.map(h => {
          const iso = new Date(h.timestamp).toISOString();
          return {
            date: iso.slice(5, 10),
            fullDate: iso.slice(0, 10),
            isoDT: iso,
            price: h.close,
          };
        });
      } else {
        return { status: "nodata", hist: null };
      }
    } else {
      if (bars.length > 0) {
        hist = bars.map(h => {
          const iso = new Date(h.timestamp).toISOString();
          return {
            date: iso.slice(11, 16),
            fullDate: iso.slice(0, 10),
            isoDT: iso,
            price: h.close,
          };
        });
      } else {
        return { status: "nodata", hist: null };
      }
    }
    histCache.set(cacheKey, { hist, fetchedAt: Date.now(), interval, sourceLabel });
    return { status: "live", hist: hist.slice(-barsEstimate), interval, sourceLabel };
  } catch(e) {
    return { status: "error", hist: null };
  }
}

/* ════════════════════════ FORMATTING ════════════════════════ */
