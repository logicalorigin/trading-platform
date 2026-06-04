import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HttpError } from "../lib/errors";
import {
  getFmpRuntimeConfig,
  getMassiveRuntimeConfig,
} from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import {
  FmpResearchClient,
  type FmpHighBetaScreenerCandidate,
} from "../providers/fmp/client";
import {
  MassiveMarketDataClient,
  type QuoteSnapshot,
  type UniverseTicker,
} from "../providers/massive/market-data";

const HIGH_BETA_UNIVERSE_CACHE_TTL_MS = 30 * 60_000;
const DEFAULT_HIGH_BETA_UNIVERSE_LIMIT = 500;
const DEFAULT_HIGH_BETA_CANDIDATE_LIMIT = 1500;
const DEFAULT_HIGH_BETA_MIN_BETA = 1;
const DEFAULT_HIGH_BETA_MIN_PRICE = 5;
const DEFAULT_HIGH_BETA_MIN_VOLUME = 500_000;
const DEFAULT_HIGH_BETA_MIN_DOLLAR_VOLUME = 10_000_000;
const DEFAULT_HIGH_BETA_MIN_MARKET_CAP = 250_000_000;
const DEFAULT_HIGH_BETA_EXCHANGES = ["NASDAQ", "NYSE", "AMEX"];
const HIGH_BETA_VALIDATION_CHUNK_SIZE = 25;
const HIGH_BETA_OPPORTUNITY_SCORE_SOURCE =
  "blended_options_opportunity_v1" as const;
const HIGH_BETA_OPPORTUNITY_SCORE_WEIGHTS = {
  beta: 0.45,
  intradayVolatility: 0.25,
  liquidity: 0.15,
  optionsTradability: 0.15,
} as const;

const UNSUPPORTED_SECURITY_TYPE_PATTERNS = [
  "WARRANT",
  "RIGHT",
  "UNIT",
  "PFD",
  "PREFERRED",
  "PREFERENCE",
];

export type HighBetaUniverseRejectReason =
  | "invalid_candidate"
  | "inactive_fmp"
  | "non_us_fmp"
  | "reference_unavailable"
  | "inactive_massive"
  | "unsupported_market"
  | "unsupported_security_type"
  | "quote_unavailable"
  | "low_liquidity"
  | "non_optionable";

export type HighBetaUniverseAcceptedSymbol = {
  rank: number;
  symbol: string;
  name: string | null;
  beta: number;
  intradayVolatility: number | null;
  optionContractCount: number;
  opportunityScore: number;
  score: {
    source: typeof HIGH_BETA_OPPORTUNITY_SCORE_SOURCE;
    betaScore: number;
    intradayVolatilityScore: number;
    liquidityScore: number;
    optionsTradabilityScore: number;
    weights: typeof HIGH_BETA_OPPORTUNITY_SCORE_WEIGHTS;
  };
  price: number | null;
  volume: number | null;
  dollarVolume: number | null;
  marketCap: number | null;
  exchange: string | null;
  massiveMarket: string | null;
  massiveType: string | null;
  optionable: true;
  quoteUpdatedAt: Date | null;
};

export type HighBetaUniverseRejectedSymbol = {
  symbol: string;
  beta: number | null;
  reason: HighBetaUniverseRejectReason;
  detail: string | null;
};

export type HighBetaUniversePreview = {
  generatedAt: Date;
  dryRun: boolean;
  sourceStatus: "fresh" | "memory_cache" | "stale_cache";
  limit: number;
  importedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rejectedByReason: Partial<Record<HighBetaUniverseRejectReason, number>>;
  accepted: HighBetaUniverseAcceptedSymbol[];
  rejectedSample: HighBetaUniverseRejectedSymbol[];
  source: {
    provider: "fmp";
    endpoint: "company-screener";
    betaField: "beta";
    candidateLimit: number;
    exchanges: string[];
  };
  validation: {
    provider: "massive";
    minPrice: number;
    minVolume: number;
    minDollarVolume: number;
    minMarketCap: number;
    requireOptionable: true;
  };
};

export type HighBetaUniverseAvailabilityStatus = {
  available: boolean;
  configured: boolean;
  provider: "fmp" | null;
  validatorProvider: "massive" | null;
  limit: number;
  cacheTtlMs: number;
  lastGeneratedAt: Date | null;
  lastAcceptedCount: number | null;
  cacheStatus: "fresh" | "memory_cache" | "stale_cache" | "unavailable";
  unavailableCode: string | null;
  unavailableDetail: string | null;
};

export type HighBetaUniverseFmpClient = Pick<
  FmpResearchClient,
  "getHighBetaScreenerCandidates"
>;

export type HighBetaUniverseMassiveClient = {
  getUniverseTickerByTicker(
    ticker: string,
    signal?: AbortSignal,
  ): Promise<UniverseTicker | null>;
  getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]>;
  getHistoricalOptionContracts(input: {
    underlying: string;
    expirationDateGte?: Date;
    limit?: number;
    maxPages?: number;
    signal?: AbortSignal;
  }): Promise<readonly unknown[]>;
};

type HighBetaUniverseValidationResult =
  | {
      status: "accepted";
      value: Omit<
        HighBetaUniverseAcceptedSymbol,
        "rank" | "opportunityScore" | "score"
      >;
    }
  | {
      status: "rejected";
      symbol: string;
      beta: number | null;
      reason: HighBetaUniverseRejectReason;
      detail: string | null;
    };

type HighBetaUniverseCacheEntry = {
  expiresAt: number;
  preview: HighBetaUniversePreview;
};

const highBetaUniverseCache = new Map<string, HighBetaUniverseCacheEntry>();

function highBetaUniverseDurableCacheFile(): string {
  return (
    process.env["PYRUS_HIGH_BETA_UNIVERSE_CACHE_FILE"] ||
    join(tmpdir(), "pyrus", "high-beta-universe-cache.json")
  );
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedPositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(Math.floor(parsed), max))
    : fallback;
}

function rejectCandidate(
  candidate: FmpHighBetaScreenerCandidate,
  reason: HighBetaUniverseRejectReason,
  detail: string | null = null,
): HighBetaUniverseValidationResult {
  return {
    status: "rejected",
    symbol: normalizeSymbol(candidate.symbol).toUpperCase(),
    beta: finiteNumber(candidate.beta),
    reason,
    detail,
  };
}

function isUnsupportedSecurityType(
  ticker: UniverseTicker,
): { unsupported: boolean; type: string | null } {
  const rawType = String(
    ticker.type ??
      ticker.contractMeta?.massiveType ??
      ticker.contractMeta?.["type"] ??
      "",
  ).trim();
  const normalizedType = rawType.toUpperCase();
  if (!normalizedType) {
    return { unsupported: false, type: null };
  }
  if (
    UNSUPPORTED_SECURITY_TYPE_PATTERNS.some((pattern) =>
      normalizedType.includes(pattern),
    )
  ) {
    return { unsupported: true, type: rawType };
  }
  return { unsupported: false, type: rawType };
}

function quoteDollarVolume(
  candidate: FmpHighBetaScreenerCandidate,
  quote: QuoteSnapshot,
): number | null {
  const price = finiteNumber(quote.price) ?? finiteNumber(candidate.price);
  const volume = finiteNumber(quote.volume) ?? finiteNumber(candidate.volume);
  return price !== null && volume !== null ? price * volume : null;
}

function quoteIntradayVolatility(quote: QuoteSnapshot): number | null {
  const high = finiteNumber(quote.high);
  const low = finiteNumber(quote.low);
  const price =
    finiteNumber(quote.price) ??
    finiteNumber(quote.prevClose) ??
    finiteNumber(quote.open);
  if (high === null || low === null || price === null || price <= 0 || high < low) {
    const changePercent = finiteNumber(quote.changePercent);
    return changePercent === null ? null : Math.abs(changePercent) / 100;
  }
  return Math.round(((high - low) / price) * 1_000_000) / 1_000_000;
}

function scoreByRank<T>(
  rows: T[],
  readValue: (row: T) => number | null,
): Map<T, number> {
  const scored = rows
    .map((row) => ({ row, value: readValue(row) }))
    .filter((row): row is { row: T; value: number } => row.value !== null)
    .sort((left, right) => right.value - left.value);
  const scores = new Map<T, number>();
  if (!scored.length) {
    rows.forEach((row) => scores.set(row, 0.5));
    return scores;
  }
  if (scored.length === 1) {
    scores.set(scored[0]!.row, 1);
  } else {
    scored.forEach(({ row }, index) => {
      scores.set(row, Math.round((1 - index / (scored.length - 1)) * 1_000_000) / 1_000_000);
    });
  }
  rows.forEach((row) => {
    if (!scores.has(row)) {
      scores.set(row, 0.5);
    }
  });
  return scores;
}

function applyOpportunityScores(
  accepted: Array<Omit<HighBetaUniverseAcceptedSymbol, "rank" | "opportunityScore" | "score">>,
): HighBetaUniverseAcceptedSymbol[] {
  const betaScores = scoreByRank(accepted, (row) => row.beta);
  const volatilityScores = scoreByRank(
    accepted,
    (row) => row.intradayVolatility,
  );
  const liquidityScores = scoreByRank(accepted, (row) => row.dollarVolume);
  const optionsScores = scoreByRank(
    accepted,
    (row) => row.optionContractCount || null,
  );

  return accepted
    .map((row) => {
      const betaScore = betaScores.get(row) ?? 0.5;
      const intradayVolatilityScore = volatilityScores.get(row) ?? 0.5;
      const liquidityScore = liquidityScores.get(row) ?? 0.5;
      const optionsTradabilityScore = optionsScores.get(row) ?? 0.5;
      const opportunityScore =
        betaScore * HIGH_BETA_OPPORTUNITY_SCORE_WEIGHTS.beta +
        intradayVolatilityScore *
          HIGH_BETA_OPPORTUNITY_SCORE_WEIGHTS.intradayVolatility +
        liquidityScore * HIGH_BETA_OPPORTUNITY_SCORE_WEIGHTS.liquidity +
        optionsTradabilityScore *
          HIGH_BETA_OPPORTUNITY_SCORE_WEIGHTS.optionsTradability;

      return {
        ...row,
        rank: 0,
        opportunityScore: Math.round(opportunityScore * 100_000) / 1_000,
        score: {
          source: HIGH_BETA_OPPORTUNITY_SCORE_SOURCE,
          betaScore,
          intradayVolatilityScore,
          liquidityScore,
          optionsTradabilityScore,
          weights: HIGH_BETA_OPPORTUNITY_SCORE_WEIGHTS,
        },
      };
    })
    .sort((left, right) => {
      if (right.opportunityScore !== left.opportunityScore) {
        return right.opportunityScore - left.opportunityScore;
      }
      if (right.beta !== left.beta) return right.beta - left.beta;
      return left.symbol.localeCompare(right.symbol);
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

function cacheKey(input: {
  limit: number;
  candidateLimit: number;
  minBeta: number;
  minPrice: number;
  minVolume: number;
  minDollarVolume: number;
  minMarketCap: number;
  exchanges: string[];
}) {
  return JSON.stringify({
    limit: input.limit,
    candidateLimit: input.candidateLimit,
    minBeta: input.minBeta,
    minPrice: input.minPrice,
    minVolume: input.minVolume,
    minDollarVolume: input.minDollarVolume,
    minMarketCap: input.minMarketCap,
    exchanges: input.exchanges,
  });
}

function previewWithSourceStatus(
  preview: HighBetaUniversePreview,
  sourceStatus: HighBetaUniversePreview["sourceStatus"],
): HighBetaUniversePreview {
  return {
    ...preview,
    sourceStatus,
    generatedAt: new Date(preview.generatedAt),
    accepted: preview.accepted.map((row) => ({
      ...row,
      quoteUpdatedAt: row.quoteUpdatedAt ? new Date(row.quoteUpdatedAt) : null,
    })),
  };
}

function parseHighBetaUniversePreview(value: unknown): HighBetaUniversePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const generatedAt = new Date(String(record.generatedAt || ""));
  const accepted = Array.isArray(record.accepted) ? record.accepted : [];
  if (!Number.isFinite(generatedAt.getTime()) || !accepted.length) {
    return null;
  }
  return previewWithSourceStatus(
    record as HighBetaUniversePreview,
    (record.sourceStatus as HighBetaUniversePreview["sourceStatus"]) || "fresh",
  );
}

function readDurableHighBetaUniversePreview(): HighBetaUniversePreview | null {
  try {
    const parsed = JSON.parse(
      readFileSync(highBetaUniverseDurableCacheFile(), "utf8"),
    ) as unknown;
    const record =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return parseHighBetaUniversePreview(record.preview);
  } catch {
    return null;
  }
}

function readStaleHighBetaUniversePreview(): HighBetaUniversePreview | null {
  const durable = readDurableHighBetaUniversePreview();
  return durable ? previewWithSourceStatus(durable, "stale_cache") : null;
}

function writeDurableHighBetaUniversePreview(
  preview: HighBetaUniversePreview,
): void {
  try {
    const file = highBetaUniverseDurableCacheFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          version: 1,
          savedAt: new Date().toISOString(),
          preview,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } catch {
    // Cache writes are best-effort and must not block live universe generation.
  }
}

function getLatestMemoryHighBetaUniversePreview(): HighBetaUniversePreview | null {
  const now = Date.now();
  let latest: HighBetaUniversePreview | null = null;
  for (const entry of highBetaUniverseCache.values()) {
    if (entry.expiresAt <= now) {
      continue;
    }
    if (
      !latest ||
      new Date(entry.preview.generatedAt).getTime() >
        new Date(latest.generatedAt).getTime()
    ) {
      latest = entry.preview;
    }
  }
  return latest ? previewWithSourceStatus(latest, "memory_cache") : null;
}

function defaultFmpClient(): FmpResearchClient {
  const config = getFmpRuntimeConfig();
  if (!config) {
    throw new HttpError(503, "Research data provider is not configured.", {
      code: "research_not_configured",
      detail:
        "Set FMP_API_KEY, FMP_KEY, or FINANCIAL_MODELING_PREP_API_KEY to enable high-beta universe generation.",
    });
  }
  return new FmpResearchClient(config);
}

function defaultMassiveClient(): MassiveMarketDataClient {
  const config = getMassiveRuntimeConfig();
  if (!config) {
    throw new HttpError(503, "Massive market data is not configured.", {
      code: "massive_not_configured",
      detail: "Set one of MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY.",
    });
  }
  return new MassiveMarketDataClient(config);
}

export async function validateHighBetaUniverseCandidate(input: {
  candidate: FmpHighBetaScreenerCandidate;
  massiveClient: HighBetaUniverseMassiveClient;
  quote: QuoteSnapshot | null | undefined;
  minPrice: number;
  minVolume: number;
  minDollarVolume: number;
  signal?: AbortSignal;
}): Promise<HighBetaUniverseValidationResult> {
  const candidate = input.candidate;
  const symbol = normalizeSymbol(candidate.symbol).toUpperCase();
  const beta = finiteNumber(candidate.beta);
  if (!symbol || beta === null || beta <= 0) {
    return rejectCandidate(candidate, "invalid_candidate", "Missing symbol or beta.");
  }
  if (candidate.isActivelyTrading === false) {
    return rejectCandidate(candidate, "inactive_fmp", "FMP marks the symbol inactive.");
  }
  if (candidate.country && candidate.country.toUpperCase() !== "US") {
    return rejectCandidate(candidate, "non_us_fmp", "FMP country is not US.");
  }

  const ticker = await input.massiveClient
    .getUniverseTickerByTicker(symbol, input.signal)
    .catch(() => null);
  if (!ticker) {
    return rejectCandidate(candidate, "reference_unavailable", "Massive reference lookup failed.");
  }
  if (ticker.active === false) {
    return rejectCandidate(candidate, "inactive_massive", "Massive marks the symbol inactive.");
  }
  if (ticker.market !== "stocks" && ticker.market !== "etf") {
    return rejectCandidate(candidate, "unsupported_market", `Massive market is ${ticker.market}.`);
  }
  const primaryExchange = String(
    ticker.primaryExchange ?? ticker.normalizedExchangeMic ?? "",
  ).toUpperCase();
  if (primaryExchange.includes("OTC")) {
    return rejectCandidate(candidate, "unsupported_market", "OTC symbols are excluded.");
  }
  const securityType = isUnsupportedSecurityType(ticker);
  if (securityType.unsupported) {
    return rejectCandidate(
      candidate,
      "unsupported_security_type",
      securityType.type ? `Massive type is ${securityType.type}.` : null,
    );
  }

  const quote = input.quote ?? null;
  if (!quote) {
    return rejectCandidate(candidate, "quote_unavailable", "Massive quote snapshot is unavailable.");
  }
  const price = finiteNumber(quote.price) ?? finiteNumber(candidate.price);
  const volume = finiteNumber(quote.volume) ?? finiteNumber(candidate.volume);
  const dollarVolume = quoteDollarVolume(candidate, quote);
  if (
    price === null ||
    price < input.minPrice ||
    volume === null ||
    volume < input.minVolume ||
    dollarVolume === null ||
    dollarVolume < input.minDollarVolume
  ) {
    return rejectCandidate(candidate, "low_liquidity", "Price, volume, or dollar volume is below the configured threshold.");
  }

  const optionContracts = await input.massiveClient
    .getHistoricalOptionContracts({
      underlying: symbol,
      expirationDateGte: new Date(),
      limit: 1,
      maxPages: 1,
      signal: input.signal,
    })
    .catch(() => []);
  if (!optionContracts.length) {
    return rejectCandidate(candidate, "non_optionable", "No active Massive option contracts were found.");
  }

  return {
    status: "accepted",
    value: {
      symbol,
      name: candidate.name ?? ticker.name ?? null,
      beta,
      intradayVolatility: quoteIntradayVolatility(quote),
      optionContractCount: optionContracts.length,
      price,
      volume,
      dollarVolume,
      marketCap: finiteNumber(candidate.marketCap),
      exchange:
        candidate.exchangeShortName ??
        candidate.exchange ??
        ticker.primaryExchange ??
        ticker.exchangeDisplay ??
        null,
      massiveMarket: ticker.market,
      massiveType:
        securityType.type ??
        (typeof ticker.type === "string" ? ticker.type : null),
      optionable: true,
      quoteUpdatedAt: quote.updatedAt ?? null,
    },
  };
}

export async function getHighBetaUniversePreview(input: {
  limit?: number;
  candidateLimit?: number;
  minBeta?: number;
  minPrice?: number;
  minVolume?: number;
  minDollarVolume?: number;
  minMarketCap?: number;
  exchanges?: string[];
  dryRun?: boolean;
  refresh?: boolean;
  signal?: AbortSignal;
  fmpClient?: HighBetaUniverseFmpClient;
  massiveClient?: HighBetaUniverseMassiveClient;
} = {}): Promise<HighBetaUniversePreview> {
  const limit = normalizedPositiveInteger(
    input.limit,
    DEFAULT_HIGH_BETA_UNIVERSE_LIMIT,
    500,
  );
  const candidateLimit = normalizedPositiveInteger(
    input.candidateLimit,
    Math.max(DEFAULT_HIGH_BETA_CANDIDATE_LIMIT, limit * 3),
    5000,
  );
  const minBeta = finiteNumber(input.minBeta) ?? DEFAULT_HIGH_BETA_MIN_BETA;
  const minPrice = finiteNumber(input.minPrice) ?? DEFAULT_HIGH_BETA_MIN_PRICE;
  const minVolume = finiteNumber(input.minVolume) ?? DEFAULT_HIGH_BETA_MIN_VOLUME;
  const minDollarVolume =
    finiteNumber(input.minDollarVolume) ??
    DEFAULT_HIGH_BETA_MIN_DOLLAR_VOLUME;
  const minMarketCap =
    finiteNumber(input.minMarketCap) ?? DEFAULT_HIGH_BETA_MIN_MARKET_CAP;
  const exchanges = (input.exchanges?.length
    ? input.exchanges
    : DEFAULT_HIGH_BETA_EXCHANGES
  )
    .map((exchange) => String(exchange || "").trim().toUpperCase())
    .filter(Boolean);
  const key = cacheKey({
    limit,
    candidateLimit,
    minBeta,
    minPrice,
    minVolume,
    minDollarVolume,
    minMarketCap,
    exchanges,
  });
  const useCache = !input.refresh && !input.fmpClient && !input.massiveClient;
  const cached = highBetaUniverseCache.get(key);
  if (useCache && cached && cached.expiresAt > Date.now()) {
    return previewWithSourceStatus(cached.preview, "memory_cache");
  }

  let fmpClient: HighBetaUniverseFmpClient;
  let massiveClient: HighBetaUniverseMassiveClient;
  try {
    fmpClient = input.fmpClient ?? defaultFmpClient();
    massiveClient = input.massiveClient ?? defaultMassiveClient();
  } catch (error) {
    const stalePreview = useCache ? readStaleHighBetaUniversePreview() : null;
    if (stalePreview) {
      return stalePreview;
    }
    throw error;
  }
  let imported: FmpHighBetaScreenerCandidate[];
  try {
    imported = await fmpClient.getHighBetaScreenerCandidates({
      exchanges,
      limit: candidateLimit,
      betaMoreThan: minBeta,
      priceMoreThan: minPrice,
      volumeMoreThan: minVolume,
      marketCapMoreThan: minMarketCap,
      country: "US",
      signal: input.signal,
    });
  } catch (error) {
    const stalePreview = useCache ? readStaleHighBetaUniversePreview() : null;
    if (stalePreview) {
      return stalePreview;
    }
    throw error;
  }
  const candidates = imported
    .filter((candidate) => candidate.beta >= minBeta)
    .sort((left, right) => {
      if (right.beta !== left.beta) return right.beta - left.beta;
      return left.symbol.localeCompare(right.symbol);
    });

  const accepted: Array<
    Omit<HighBetaUniverseAcceptedSymbol, "rank" | "opportunityScore" | "score">
  > = [];
  const rejected: HighBetaUniverseRejectedSymbol[] = [];

  for (
    let index = 0;
    index < candidates.length && accepted.length < limit;
    index += HIGH_BETA_VALIDATION_CHUNK_SIZE
  ) {
    const chunk = candidates.slice(index, index + HIGH_BETA_VALIDATION_CHUNK_SIZE);
    const quoteSnapshots = await massiveClient
      .getQuoteSnapshots(chunk.map((candidate) => candidate.symbol))
      .catch(() => []);
    const quoteBySymbol = new Map(
      quoteSnapshots.map((quote) => [normalizeSymbol(quote.symbol).toUpperCase(), quote]),
    );
    const validations = await Promise.all(
      chunk.map((candidate) =>
        validateHighBetaUniverseCandidate({
          candidate,
          massiveClient,
          quote: quoteBySymbol.get(normalizeSymbol(candidate.symbol).toUpperCase()),
          minPrice,
          minVolume,
          minDollarVolume,
          signal: input.signal,
        }),
      ),
    );

    validations.forEach((result) => {
      if (result.status === "accepted") {
        accepted.push(result.value);
        return;
      }
      rejected.push({
        symbol: result.symbol,
        beta: result.beta,
        reason: result.reason,
        detail: result.detail,
      });
    });
  }

  const acceptedLimited = applyOpportunityScores(accepted)
    .slice(0, limit)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
  const rejectedByReason = rejected.reduce<
    Partial<Record<HighBetaUniverseRejectReason, number>>
  >((totals, row) => {
    totals[row.reason] = (totals[row.reason] ?? 0) + 1;
    return totals;
  }, {});

  const preview: HighBetaUniversePreview = {
    generatedAt: new Date(),
    dryRun: input.dryRun ?? true,
    sourceStatus: "fresh",
    limit,
    importedCount: imported.length,
    acceptedCount: acceptedLimited.length,
    rejectedCount: rejected.length,
    rejectedByReason,
    accepted: acceptedLimited,
    rejectedSample: rejected.slice(0, 100),
    source: {
      provider: "fmp",
      endpoint: "company-screener",
      betaField: "beta",
      candidateLimit,
      exchanges,
    },
    validation: {
      provider: "massive",
      minPrice,
      minVolume,
      minDollarVolume,
      minMarketCap,
      requireOptionable: true,
    },
  };

  highBetaUniverseCache.set(key, {
    expiresAt: Date.now() + HIGH_BETA_UNIVERSE_CACHE_TTL_MS,
    preview,
  });
  writeDurableHighBetaUniversePreview(preview);

  return preview;
}

export async function getHighBetaUniverseAvailabilityStatus(input: {
  limit?: number;
} = {}): Promise<HighBetaUniverseAvailabilityStatus> {
  const limit = normalizedPositiveInteger(
    input.limit,
    DEFAULT_HIGH_BETA_UNIVERSE_LIMIT,
    500,
  );
  const researchConfigured = Boolean(getFmpRuntimeConfig());
  const massiveConfigured = Boolean(getMassiveRuntimeConfig());
  const memoryPreview = getLatestMemoryHighBetaUniversePreview();
  const durablePreview = memoryPreview ? null : readDurableHighBetaUniversePreview();
  const cachedPreview = memoryPreview ?? durablePreview;
  const cacheStatus: HighBetaUniverseAvailabilityStatus["cacheStatus"] =
    memoryPreview ? "memory_cache" : durablePreview ? "stale_cache" : "unavailable";
  const liveAvailable = researchConfigured && massiveConfigured;
  const cacheAvailable = Boolean(cachedPreview?.acceptedCount);
  const unavailableCode = !researchConfigured
    ? "research_not_configured"
    : !massiveConfigured
      ? "massive_not_configured"
      : null;
  const unavailableDetail = !researchConfigured
    ? "Set FMP_API_KEY, FMP_KEY, or FINANCIAL_MODELING_PREP_API_KEY to enable high-beta universe generation."
    : !massiveConfigured
      ? "Set one of MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY."
      : null;

  return {
    available: liveAvailable || cacheAvailable,
    configured: researchConfigured,
    provider: researchConfigured ? "fmp" : null,
    validatorProvider: massiveConfigured ? "massive" : null,
    limit,
    cacheTtlMs: HIGH_BETA_UNIVERSE_CACHE_TTL_MS,
    lastGeneratedAt: cachedPreview?.generatedAt ?? null,
    lastAcceptedCount: cachedPreview?.acceptedCount ?? null,
    cacheStatus: liveAvailable ? "fresh" : cacheStatus,
    unavailableCode: liveAvailable || cacheAvailable ? null : unavailableCode,
    unavailableDetail: liveAvailable || cacheAvailable ? null : unavailableDetail,
  };
}

export function __resetHighBetaUniverseCacheForTests(options: {
  keepDurableCache?: boolean;
} = {}) {
  highBetaUniverseCache.clear();
  if (!options.keepDurableCache) {
    rmSync(highBetaUniverseDurableCacheFile(), { force: true });
  }
}
