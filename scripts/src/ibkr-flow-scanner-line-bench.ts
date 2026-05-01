export {};

import { appendFile } from "node:fs/promises";
import {
  fetchNasdaqListedDirectory,
  parseNasdaqListedDirectory,
} from "../../artifacts/api-server/src/services/nasdaq-symbol-directory";

type CliOptions = {
  apiBaseUrl: string;
  symbols: string[];
  lineBudgets: number[];
  iterations: number;
  maxDte: number | null;
  expirationScanCount: number | null;
  strikeCoverage: "fast" | "standard" | "full" | null;
  maxSymbols: number | null;
  offset: number;
  outputJsonl: string | null;
};

type BenchmarkBudgetResult = {
  underlying: string;
  lineBudget: number;
  status: "loaded" | "empty" | "error";
  expirationCount?: number;
  expirationsCacheStatus?: "hit" | "miss" | "inflight" | null;
  expirationsDegraded?: boolean;
  expirationsDebugReason?: string | null;
  candidateExpirationCount?: number;
  hydratedExpirationCount?: number;
  metadataFailedExpirationCount?: number;
  metadataContractCount: number;
  metadataErrorSamples?: string[];
  metadataDebugReasonCounts?: Array<{ reason: string; count: number }>;
  liveCandidateCount: number;
  acceptedQuoteCount: number;
  rejectedQuoteCount: number;
  returnedQuoteCount: number;
  missingQuoteCount: number;
  timingsMs: {
    total: number;
    expirations: number;
    metadata: number;
    quote: number;
    lineDwell: number;
  };
  errorMessage: string | null;
};

type BenchmarkResponse = {
  underlying: string;
  results: BenchmarkBudgetResult[];
};

const DEFAULT_API_BASE_URL =
  process.env["API_BASE_URL"] ?? "http://127.0.0.1:8080/api";

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parsePositiveInteger(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNullableInteger(raw: string | null): number | null {
  if (raw === null || raw === "" || raw === "null") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function normalizeSymbols(raw: string | null): string[] {
  const source = raw ?? "SPY,QQQ,AAPL";
  return Array.from(
    new Set(
      source
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

async function resolveSymbols(options: {
  rawSymbols: string | null;
  offset: number;
  maxSymbols: number | null;
}): Promise<string[]> {
  if (options.rawSymbols?.trim().toLowerCase() === "nasdaq") {
    const text = await fetchNasdaqListedDirectory();
    const parsed = parseNasdaqListedDirectory(text);
    const symbols = parsed.records.map((record) => record.symbol);
    return symbols.slice(
      options.offset,
      options.maxSymbols === null
        ? symbols.length
        : options.offset + options.maxSymbols,
    );
  }

  return normalizeSymbols(options.rawSymbols).slice(
    options.offset,
    options.maxSymbols === null ? undefined : options.offset + options.maxSymbols,
  );
}

function normalizeLineBudgets(raw: string | null): number[] {
  const source = raw ?? "10,20,40";
  return Array.from(
    new Set(
      source
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value)),
    ),
  ).sort((left, right) => left - right);
}

function parseStrikeCoverage(raw: string | null): CliOptions["strikeCoverage"] {
  if (raw === "fast" || raw === "standard" || raw === "full") {
    return raw;
  }
  return null;
}

function parseOptions(): CliOptions {
  const rawSymbols = parseArg("symbols");
  return {
    apiBaseUrl: parseArg("api-base-url") ?? DEFAULT_API_BASE_URL,
    symbols: normalizeSymbols(rawSymbols),
    lineBudgets: normalizeLineBudgets(parseArg("line-budgets")),
    iterations: parsePositiveInteger(parseArg("iterations"), 1),
    maxDte: parseNullableInteger(parseArg("max-dte")),
    expirationScanCount: parseNullableInteger(parseArg("expiration-scan-count")),
    strikeCoverage: parseStrikeCoverage(parseArg("strike-coverage")),
    maxSymbols: parseNullableInteger(parseArg("max-symbols")),
    offset: parseNullableInteger(parseArg("offset")) ?? 0,
    outputJsonl: parseArg("output-jsonl"),
  };
}

function buildUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const basePath = url.pathname.replace(/\/+$/, "");
  const nextPath = path.replace(/^\/+/, "");
  url.pathname = `${basePath}/${nextPath}`.replace(/\/{2,}/g, "/");
  return url;
}

async function requestJson<T>(url: URL, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${url.toString()} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function percentile(values: number[], percentileValue: number): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function summarize(results: BenchmarkBudgetResult[]) {
  const byBudget = new Map<number, BenchmarkBudgetResult[]>();
  for (const result of results) {
    const current = byBudget.get(result.lineBudget) ?? [];
    current.push(result);
    byBudget.set(result.lineBudget, current);
  }

  return Array.from(byBudget.entries()).map(([lineBudget, budgetResults]) => ({
    lineBudget,
    runs: budgetResults.length,
    errors: budgetResults.filter((result) => result.status === "error").length,
    loadedRuns: budgetResults.filter((result) => result.status === "loaded")
      .length,
    emptyRuns: budgetResults.filter((result) => result.status === "empty")
      .length,
    expirationDegradedRuns: budgetResults.filter(
      (result) => result.expirationsDegraded,
    ).length,
    expirationsP50: percentile(
      budgetResults.map((result) => result.expirationCount ?? 0),
      50,
    ),
    candidateExpirationsP50: percentile(
      budgetResults.map((result) => result.candidateExpirationCount ?? 0),
      50,
    ),
    hydratedExpirationsP50: percentile(
      budgetResults.map((result) => result.hydratedExpirationCount ?? 0),
      50,
    ),
    metadataFailedExpirationsP50: percentile(
      budgetResults.map((result) => result.metadataFailedExpirationCount ?? 0),
      50,
    ),
    metadataContractsP50: percentile(
      budgetResults.map((result) => result.metadataContractCount),
      50,
    ),
    liveCandidatesP50: percentile(
      budgetResults.map((result) => result.liveCandidateCount),
      50,
    ),
    acceptedQuotesP50: percentile(
      budgetResults.map((result) => result.acceptedQuoteCount),
      50,
    ),
    returnedQuotesP50: percentile(
      budgetResults.map((result) => result.returnedQuoteCount),
      50,
    ),
    totalP50Ms: percentile(
      budgetResults.map((result) => result.timingsMs.total),
      50,
    ),
    totalP95Ms: percentile(
      budgetResults.map((result) => result.timingsMs.total),
      95,
    ),
    quoteDwellP50Ms: percentile(
      budgetResults.map((result) => result.timingsMs.lineDwell),
      50,
    ),
    quoteDwellP95Ms: percentile(
      budgetResults.map((result) => result.timingsMs.lineDwell),
      95,
    ),
  }));
}

async function main() {
  const options = parseOptions();
  options.symbols = await resolveSymbols({
    rawSymbols: parseArg("symbols"),
    offset: options.offset,
    maxSymbols: options.maxSymbols,
  });
  const responses: BenchmarkResponse[] = [];
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    for (const symbol of options.symbols) {
      const response = await requestJson<BenchmarkResponse>(
          buildUrl(options.apiBaseUrl, "/flow/scanner/benchmark"),
          {
            method: "POST",
            body: JSON.stringify({
              underlying: symbol,
              lineBudgets: options.lineBudgets,
              maxDte: options.maxDte,
              expirationScanCount: options.expirationScanCount,
              strikeCoverage: options.strikeCoverage,
            }),
          },
        );
      responses.push(response);
      if (options.outputJsonl) {
        await appendFile(
          options.outputJsonl,
          `${JSON.stringify({ iteration, symbol, response, writtenAt: new Date().toISOString() })}\n`,
        );
      }
    }
  }

  const allResults = responses.flatMap((response) => response.results);
  console.log(
    JSON.stringify(
      {
        options,
        summary: summarize(allResults),
        responses,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
