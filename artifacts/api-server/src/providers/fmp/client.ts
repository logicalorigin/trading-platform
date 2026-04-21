import {
  asArray,
  asNumber,
  asRecord,
  asString,
  firstDefined,
  normalizeSymbol,
  toDate,
  toIsoDateString,
} from "../../lib/values";
import { fetchJson, withSearchParams, type QueryValue } from "../../lib/http";
import type { FmpRuntimeConfig } from "../../lib/runtime";

export type ResearchFundamentals = {
  symbol: string;
  revenueTTM: number | null;
  grossMarginTTM: number | null;
  netMarginTTM: number | null;
  operMarginTTM: number | null;
  roeTTM: number | null;
  debtToEquity: number | null;
  evToEBITDA: number | null;
  priceToSales: number | null;
  beta: number | null;
  sector: string | null;
  industry: string | null;
  ceo: string | null;
};

export type ResearchCalendarEntry = {
  symbol: string;
  date: string | null;
  time: string | null;
  epsEstimated: number | null;
  revenueEstimated: number | null;
  fiscalDateEnding: string | null;
};

export type ResearchFiling = {
  symbol: string;
  type: string | null;
  filingDate: string | null;
  acceptedDate: string | null;
  finalLink: string | null;
  link: string | null;
};

export type TranscriptDateEntry = {
  year: number | null;
  quarter: number | null;
  date: string | null;
};

export type TranscriptEntry = {
  symbol: string;
  quarter: number | null;
  year: number | null;
  date: string | null;
  content: string | null;
};

function round(value: number | null, digits: number): number | null {
  if (value === null) {
    return null;
  }

  return Number(value.toFixed(digits));
}

function normalizePercent(value: unknown): number | null {
  const numeric = asNumber(value);

  if (numeric === null) {
    return null;
  }

  return Math.abs(numeric) <= 1 ? round(numeric * 100, 1) : round(numeric, 1);
}

function normalizeIsoDate(value: unknown): string | null {
  const date = toDate(value);
  return date ? toIsoDateString(date) : null;
}

function getRecordArray(payload: unknown): Record<string, unknown>[] {
  return asArray(payload).flatMap((entry) => {
    const record = asRecord(entry);
    return record ? [record] : [];
  });
}

function mapTranscriptDate(entry: unknown): TranscriptDateEntry | null {
  if (Array.isArray(entry)) {
    return {
      year: asNumber(entry[0]),
      quarter: asNumber(entry[1]),
      date: normalizeIsoDate(entry[2]),
    };
  }

  const record = asRecord(entry);

  if (!record) {
    return null;
  }

  return {
    year: firstDefined(
      asNumber(record["year"]),
      asNumber(record["calendarYear"]),
      asNumber(record["fiscalYear"]),
    ),
    quarter: firstDefined(asNumber(record["quarter"]), asNumber(record["fiscalQuarter"])),
    date: normalizeIsoDate(
      firstDefined(record["date"], record["fillingDate"], record["filingDate"]),
    ),
  };
}

export class FmpResearchClient {
  constructor(private readonly config: FmpRuntimeConfig) {}

  private buildUrl(path: string, params: Record<string, QueryValue> = {}): URL {
    return withSearchParams(`${this.config.baseUrl}${path}`, params);
  }

  private async fetchStable<T>(
    path: string,
    params: Record<string, QueryValue> = {},
  ): Promise<T> {
    return fetchJson<T>(this.buildUrl(path, params), {
      headers: {
        accept: "application/json",
        apikey: this.config.apiKey,
      },
    });
  }

  async getFundamentals(symbol: string): Promise<ResearchFundamentals | null> {
    const normalized = normalizeSymbol(symbol);
    const [ratios, metrics, profiles] = await Promise.all([
      this.fetchStable<unknown>("/ratios-ttm", { symbol: normalized }),
      this.fetchStable<unknown>("/key-metrics-ttm", { symbol: normalized }),
      this.fetchStable<unknown>("/profile", { symbol: normalized }),
    ]);

    const ratio = getRecordArray(ratios)[0] ?? null;
    const metric = getRecordArray(metrics)[0] ?? null;
    const profile = getRecordArray(profiles)[0] ?? null;

    if (!ratio && !metric && !profile) {
      return null;
    }

    const marketCap = asNumber(profile?.["mktCap"] ?? profile?.["marketCap"]);
    const price = asNumber(profile?.["price"]);
    const sharesOutstanding = firstDefined(
      asNumber(profile?.["sharesOutstanding"]),
      marketCap !== null && price ? marketCap / price : null,
    );
    const revenuePerShare = asNumber(
      metric?.["revenuePerShareTTM"] ?? metric?.["revenuePerShare"],
    );

    return {
      symbol: normalized,
      revenueTTM:
        revenuePerShare !== null && sharesOutstanding !== null
          ? Math.round((revenuePerShare * sharesOutstanding) / 1_000_000)
          : null,
      grossMarginTTM: normalizePercent(
        ratio?.["grossProfitMarginTTM"] ?? ratio?.["grossProfitMargin"],
      ),
      netMarginTTM: normalizePercent(
        ratio?.["netProfitMarginTTM"] ?? ratio?.["netProfitMargin"],
      ),
      operMarginTTM: normalizePercent(
        ratio?.["operatingProfitMarginTTM"] ?? ratio?.["operatingProfitMargin"],
      ),
      roeTTM: normalizePercent(ratio?.["returnOnEquityTTM"] ?? ratio?.["returnOnEquity"]),
      debtToEquity: round(
        asNumber(ratio?.["debtEquityRatioTTM"] ?? ratio?.["debtEquityRatio"]),
        2,
      ),
      evToEBITDA: round(
        asNumber(
          metric?.["enterpriseValueOverEBITDATTM"] ?? metric?.["enterpriseValueOverEBITDA"],
        ),
        1,
      ),
      priceToSales: round(
        asNumber(metric?.["priceToSalesRatioTTM"] ?? metric?.["priceToSalesRatio"]),
        2,
      ),
      beta: round(asNumber(profile?.["beta"]), 2),
      sector: asString(profile?.["sector"]),
      industry: asString(profile?.["industry"]),
      ceo: asString(profile?.["ceo"]),
    };
  }

  async getEarningsCalendar(from: Date, to: Date): Promise<ResearchCalendarEntry[]> {
    const payload = await this.fetchStable<unknown>("/earnings-calendar", {
      from: toIsoDateString(from),
      to: toIsoDateString(to),
    });

    return getRecordArray(payload).map((entry) => ({
      symbol: normalizeSymbol(asString(entry["symbol"]) ?? ""),
      date: normalizeIsoDate(entry["date"]),
      time: asString(entry["time"])?.toLowerCase() ?? null,
      epsEstimated: asNumber(entry["epsEstimated"] ?? entry["eps"]),
      revenueEstimated: asNumber(entry["revenueEstimated"] ?? entry["revenue"]),
      fiscalDateEnding: normalizeIsoDate(
        firstDefined(entry["fiscalDateEnding"], entry["fiscalDate"]),
      ),
    }));
  }

  async getSecFilings(symbol: string, limit = 25): Promise<ResearchFiling[]> {
    const payload = await this.fetchStable<unknown>("/sec-filings-search/symbol", {
      symbol: normalizeSymbol(symbol),
      limit,
    });

    return getRecordArray(payload).map((entry) => ({
      symbol: normalizeSymbol(asString(entry["symbol"]) ?? symbol),
      type: asString(entry["type"] ?? entry["formType"] ?? entry["form"]),
      filingDate: normalizeIsoDate(entry["fillingDate"] ?? entry["filingDate"] ?? entry["date"]),
      acceptedDate: asString(entry["acceptedDate"]),
      finalLink: asString(entry["finalLink"] ?? entry["finalURL"] ?? entry["finalUrl"]),
      link: asString(entry["link"] ?? entry["url"]),
    }));
  }

  async getTranscriptDates(symbol: string): Promise<TranscriptDateEntry[]> {
    const payload = await this.fetchStable<unknown>("/earning-call-transcript-dates", {
      symbol: normalizeSymbol(symbol),
    });

    return asArray(payload).flatMap((entry) => {
      const mapped = mapTranscriptDate(entry);
      return mapped ? [mapped] : [];
    });
  }

  async getTranscript(
    symbol: string,
    quarter?: number,
    year?: number,
  ): Promise<TranscriptEntry | null> {
    const payload = await this.fetchStable<unknown>("/earning-call-transcript", {
      symbol: normalizeSymbol(symbol),
      quarter,
      year,
    });

    const record = getRecordArray(payload)[0] ?? asRecord(payload);

    if (!record) {
      return null;
    }

    return {
      symbol: normalizeSymbol(asString(record["symbol"]) ?? symbol),
      quarter: firstDefined(asNumber(record["quarter"]), asNumber(record["fiscalQuarter"])),
      year: firstDefined(asNumber(record["year"]), asNumber(record["calendarYear"])),
      date: normalizeIsoDate(record["date"]),
      content: asString(
        record["content"] ??
          record["transcript"] ??
          record["text"] ??
          record["body"],
      ),
    };
  }
}
