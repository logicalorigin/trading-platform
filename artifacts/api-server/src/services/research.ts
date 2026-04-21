import { HttpError } from "../lib/errors";
import { getFmpRuntimeConfig } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import {
  FmpResearchClient,
  type ResearchCalendarEntry,
  type ResearchFiling,
  type ResearchFundamentals,
  type TranscriptDateEntry,
  type TranscriptEntry,
} from "../providers/fmp/client";

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

export async function getResearchStatus() {
  const configured = Boolean(getFmpRuntimeConfig());

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
