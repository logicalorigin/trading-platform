import { normalizeSymbol } from "../lib/values";
import type { UniverseTicker } from "../providers/polygon/market-data";

export const NASDAQ_LISTED_SYMBOL_DIRECTORY_URL =
  "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";

export type NasdaqListedSymbolRecord = {
  symbol: string;
  rawSymbol: string;
  securityName: string;
  marketCategory: string | null;
  testIssue: boolean;
  financialStatus: string | null;
  roundLotSize: number | null;
  etf: boolean;
  nextShares: boolean;
  sourceLine: number;
};

export type NasdaqListedParseOptions = {
  includeEtfs?: boolean;
  includeTestIssues?: boolean;
  includeNonCommonStock?: boolean;
  normalFinancialStatusOnly?: boolean;
};

export type NasdaqListedParseResult = {
  records: NasdaqListedSymbolRecord[];
  parsedAt: Date;
  fileCreationTime: string | null;
  skippedCount: number;
};

const NASDAQ_LISTED_HEADER = [
  "Symbol",
  "Security Name",
  "Market Category",
  "Test Issue",
  "Financial Status",
  "Round Lot Size",
  "ETF",
  "NextShares",
];

function readNasdaqFlag(value: string | undefined): boolean {
  return value?.trim().toUpperCase() === "Y";
}

function readNasdaqString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function readNasdaqInteger(value: string | undefined): number | null {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNormalFinancialStatus(status: string | null): boolean {
  return status === null || status === "" || status.toUpperCase() === "N";
}

function isLikelyCommonEquitySecurityName(name: string): boolean {
  const normalized = name.trim().toUpperCase();
  if (
    /\b(RIGHT|RIGHTS|UNIT|UNITS|WARRANT|WARRANTS|PREFERRED|PREFERENCE|NOTE|NOTES|DEBENTURE|BOND)\b/.test(
      normalized,
    )
  ) {
    return false;
  }
  return (
    normalized.includes("COMMON STOCK") ||
    normalized.includes("COMMON SHARES") ||
    normalized.includes("ORDINARY SHARES") ||
    normalized.includes("AMERICAN DEPOSITARY") ||
    /\bADS(S)?\b/.test(normalized) ||
    normalized.includes("SHARES OF BENEFICIAL INTEREST")
  );
}

function shouldIncludeNasdaqRecord(
  record: NasdaqListedSymbolRecord,
  options: Required<NasdaqListedParseOptions>,
): boolean {
  if (!options.includeTestIssues && record.testIssue) {
    return false;
  }
  if (!options.includeEtfs && record.etf) {
    return false;
  }
  if (
    options.normalFinancialStatusOnly &&
    !isNormalFinancialStatus(record.financialStatus)
  ) {
    return false;
  }
  if (
    !options.includeNonCommonStock &&
    !record.etf &&
    !isLikelyCommonEquitySecurityName(record.securityName)
  ) {
    return false;
  }
  return true;
}

export function parseNasdaqListedDirectory(
  text: string,
  options: NasdaqListedParseOptions = {},
): NasdaqListedParseResult {
  const filterOptions: Required<NasdaqListedParseOptions> = {
    includeEtfs: options.includeEtfs ?? false,
    includeTestIssues: options.includeTestIssues ?? false,
    includeNonCommonStock: options.includeNonCommonStock ?? false,
    normalFinancialStatusOnly: options.normalFinancialStatusOnly ?? true,
  };
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    const fields = line.split("|").map((field) => field.trim());
    return NASDAQ_LISTED_HEADER.every((field, index) => fields[index] === field);
  });

  if (headerIndex < 0) {
    throw new Error("NASDAQ listed symbol directory header was not found.");
  }

  const records: NasdaqListedSymbolRecord[] = [];
  let fileCreationTime: string | null = null;
  let skippedCount = 0;

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      continue;
    }
    if (line.startsWith("File Creation Time:")) {
      fileCreationTime =
        line.slice("File Creation Time:".length).split("|")[0]?.trim() || null;
      break;
    }

    const fields = line.split("|");
    if (fields.length < NASDAQ_LISTED_HEADER.length) {
      skippedCount += 1;
      continue;
    }

    const rawSymbol = fields[0]?.trim() ?? "";
    const symbol = normalizeSymbol(rawSymbol);
    const securityName = fields[1]?.trim() ?? "";
    if (!symbol || !securityName) {
      skippedCount += 1;
      continue;
    }

    const record: NasdaqListedSymbolRecord = {
      symbol,
      rawSymbol,
      securityName,
      marketCategory: readNasdaqString(fields[2]),
      testIssue: readNasdaqFlag(fields[3]),
      financialStatus: readNasdaqString(fields[4]),
      roundLotSize: readNasdaqInteger(fields[5]),
      etf: readNasdaqFlag(fields[6]),
      nextShares: readNasdaqFlag(fields[7]),
      sourceLine: index + 1,
    };

    if (shouldIncludeNasdaqRecord(record, filterOptions)) {
      records.push(record);
    } else {
      skippedCount += 1;
    }
  }

  return {
    records,
    parsedAt: new Date(),
    fileCreationTime,
    skippedCount,
  };
}

export function nasdaqListedRecordToUniverseTicker(
  record: NasdaqListedSymbolRecord,
): UniverseTicker {
  return {
    ticker: record.symbol,
    name: record.securityName,
    market: record.etf ? "etf" : "stocks",
    rootSymbol: record.symbol.split(/[./:\s-]+/)[0] || record.symbol,
    normalizedExchangeMic: "XNAS",
    exchangeDisplay: "NASDAQ",
    logoUrl: null,
    countryCode: "US",
    exchangeCountryCode: "US",
    sector: null,
    industry: null,
    contractDescription: record.securityName,
    contractMeta: {
      listingSource: "nasdaqtrader",
      nasdaqSymbol: record.rawSymbol,
      nasdaqMarketCategory: record.marketCategory,
      nasdaqFinancialStatus: record.financialStatus,
      nasdaqRoundLotSize: record.roundLotSize,
      nasdaqEtf: record.etf,
      nasdaqNextShares: record.nextShares,
      nasdaqSourceLine: record.sourceLine,
    },
    locale: "us",
    type: record.etf ? "ETF" : "CS",
    active: true,
    primaryExchange: "NASDAQ",
    currencyName: "USD",
    cik: null,
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

export async function fetchNasdaqListedDirectory(
  url = NASDAQ_LISTED_SYMBOL_DIRECTORY_URL,
): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(
      `NASDAQ listed symbol directory request failed with HTTP ${response.status}.`,
    );
  }

  return response.text();
}
