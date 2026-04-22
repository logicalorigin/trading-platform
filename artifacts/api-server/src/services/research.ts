import { HttpError } from "../lib/errors";
import { getFmpRuntimeConfig } from "../lib/runtime";
import {
  FmpResearchClient,
  type ResearchCalendarEntry,
  type ResearchFiling,
  type ResearchFinancials,
  type ResearchFundamentals,
  type ResearchSnapshot,
  type TranscriptDateEntry,
  type TranscriptEntry,
} from "../providers/fmp/client";
import { getQuoteSnapshots } from "./platform";
import { firstDefined, normalizeSymbol } from "../lib/values";

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
