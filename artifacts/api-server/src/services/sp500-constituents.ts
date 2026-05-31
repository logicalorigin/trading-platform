import { normalizeSymbol } from "../lib/values";
import type { UniverseTicker } from "../providers/polygon/market-data";

export const DEFAULT_SP500_CONSTITUENTS_URL =
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

export type Sp500ConstituentRecord = {
  symbol: string;
  rawSymbol: string;
  security: string;
  gicsSector: string | null;
  gicsSubIndustry: string | null;
  headquartersLocation: string | null;
  dateAdded: string | null;
  cik: string | null;
  founded: string | null;
  sourceLine: number;
};

export type Sp500ConstituentParseResult = {
  records: Sp500ConstituentRecord[];
  parsedAt: Date;
  skippedCount: number;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value.trim()));
}

function buildHeaderIndex(headers: string[]): Map<string, number> {
  return new Map(
    headers.map((header, index) => [header.trim().toLowerCase(), index]),
  );
}

function readCell(
  row: string[],
  headerIndex: Map<string, number>,
  header: string,
): string | null {
  const index = headerIndex.get(header.toLowerCase());
  if (index === undefined) return null;
  return row[index]?.trim() || null;
}

export function parseSp500ConstituentsCsv(
  text: string,
): Sp500ConstituentParseResult {
  const rows = parseCsv(text);
  if (!rows.length) {
    throw new Error("S&P 500 constituents CSV is empty.");
  }

  const headerIndex = buildHeaderIndex(rows[0]);
  if (
    !headerIndex.has("symbol") ||
    !headerIndex.has("security") ||
    !headerIndex.has("gics sector")
  ) {
    throw new Error("S&P 500 constituents CSV header was not recognized.");
  }

  const records: Sp500ConstituentRecord[] = [];
  let skippedCount = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const rawSymbol = readCell(row, headerIndex, "Symbol") ?? "";
    const symbol = normalizeSymbol(rawSymbol);
    const security = readCell(row, headerIndex, "Security") ?? "";
    if (!symbol || !security) {
      skippedCount += 1;
      continue;
    }

    records.push({
      symbol,
      rawSymbol,
      security,
      gicsSector: readCell(row, headerIndex, "GICS Sector"),
      gicsSubIndustry: readCell(row, headerIndex, "GICS Sub-Industry"),
      headquartersLocation: readCell(row, headerIndex, "Headquarters Location"),
      dateAdded: readCell(row, headerIndex, "Date added"),
      cik: readCell(row, headerIndex, "CIK"),
      founded: readCell(row, headerIndex, "Founded"),
      sourceLine: index + 1,
    });
  }

  return {
    records,
    parsedAt: new Date(),
    skippedCount,
  };
}

export function sp500ConstituentToUniverseTicker(
  record: Sp500ConstituentRecord,
): UniverseTicker {
  return {
    ticker: record.symbol,
    name: record.security,
    market: "stocks",
    rootSymbol: record.symbol.split(/[./:\s-]+/)[0] || record.symbol,
    normalizedExchangeMic: null,
    exchangeDisplay: null,
    logoUrl: null,
    countryCode: "US",
    exchangeCountryCode: "US",
    sector: record.gicsSector,
    industry: record.gicsSubIndustry,
    contractDescription: record.security,
    contractMeta: {
      listingSource: "sp500",
      indexMemberships: "sp500",
      sp500Symbol: record.rawSymbol,
      sp500GicsSector: record.gicsSector,
      sp500GicsSubIndustry: record.gicsSubIndustry,
      sp500HeadquartersLocation: record.headquartersLocation,
      sp500DateAdded: record.dateAdded,
      sp500Founded: record.founded,
      sp500SourceLine: record.sourceLine,
    },
    locale: "us",
    type: "CS",
    active: true,
    primaryExchange: null,
    currencyName: "USD",
    cik: record.cik,
    compositeFigi: null,
    shareClassFigi: null,
    lastUpdatedAt: null,
    provider: null,
    providers: [],
    tradeProvider: null,
    dataProviderPreference: null,
    providerContractId: null,
  };
}

export async function fetchSp500ConstituentsCsv(
  url = DEFAULT_SP500_CONSTITUENTS_URL,
): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/csv,text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(
      `S&P 500 constituents request failed with HTTP ${response.status}.`,
    );
  }

  return response.text();
}
