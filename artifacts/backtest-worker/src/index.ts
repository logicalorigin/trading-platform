import {
  aggregateBars,
  buildCandidatesForMode,
  buildPyrusSignalsSignalTape,
  buildWalkForwardWindows,
  calculateBacktestMetrics,
  calculateBenchmarkMetrics,
  rankCandidateResults,
  signalOptionsRightForDirection,
  runBacktest,
  type BacktestBar,
  type BacktestMetrics,
  type BacktestPoint,
  type BacktestRiskRules,
  type BacktestTrade,
  type SignalOptionsExecutionProfile,
  type StudyDefinition,
} from "@workspace/backtest-core";
import { pathToFileURL } from "node:url";
import {
  backtestRunDatasetsTable,
  backtestRunPointsTable,
  backtestRunTradesTable,
  backtestRunsTable,
  backtestStudiesTable,
  backtestStudyJobsTable,
  backtestSweepsTable,
  db,
  historicalBarDatasetsTable,
  historicalBarsTable,
  mtfPatternOccurrencesTable,
  mtfPatternResultsTable,
  overnightSignalExpectancyResultsTable,
  overnightSignalExpectancySamplesTable,
} from "@workspace/db";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import {
  DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS,
  type PyrusSignalsSignalSettings,
} from "@workspace/pyrus-signals-core";
import { logger } from "./logger";
import {
  computeDirectionEvents,
  DEFAULT_SIGNAL_SETTINGS_BY_TIMEFRAME,
  sampleTransitions,
  scorePatterns,
  warmupDaysForTimeframe,
  type DirectionEvent,
  type PatternDiscoveryConfig,
  type PatternOccurrence,
  type PatternOccurrenceRow,
  type PatternResultRow,
} from "./pattern-discovery";
import {
  OPTIONS_AGGREGATE_BARS_WARNING,
  SIGNAL_OPTIONS_AGGREGATE_BARS_WARNING,
  normalizeApiBar,
  normalizeStoredHistoricalBar,
  toHistoricalBarInsert,
  type ApiBacktestBar,
} from "./backtest-bars";
import {
  shouldRankWalkForwardCandidatesWithSharedCore,
  shouldRunOptionsBacktest,
} from "./backtest-execution";
import {
  formatOptionFillNoFillWarning,
  isQuoteReplayEligible,
  resolveWorkerOptionFill,
  resolveWorkerOptionFillPolicy,
  resolveWorkerSameBarConservativeExit,
} from "./option-fill-policy";
import { resolveWorkerSignalOptionsProfile } from "./signal-options-profile";
import {
  addOvernightSamplesToStats,
  buildCanonicalOvernightReturnMap,
  createOvernightStatsAccumulator,
  filterRegularTradingHoursBars,
  listNyseRthSessions,
  LOAD_TIMEFRAME_BY_SIGNAL_TIMEFRAME,
  normalizeOvernightSignalTimeframes,
  OVERNIGHT_RETURN_TIMEFRAME,
  OVERNIGHT_SIGNAL_EXPECTANCY_KIND,
  rollupBarsForSignalTimeframe,
  sampleOvernightSignalState,
  summarizeOvernightExpectancy,
  WARMUP_DAYS_BY_LOAD_TIMEFRAME,
  type OvernightRthSession,
  type OvernightLoadTimeframe,
  type OvernightSignalSample,
  type OvernightSignalTimeframe,
} from "./overnight-signal-expectancy";
import {
  API_BASE_URL,
  BAR_STORAGE_TARGET_BYTES,
  JOB_STALE_AFTER_MS,
  MAX_JOB_ATTEMPTS,
  MAX_PARALLEL_SWEEP_RUNS,
  WORKER_POLL_INTERVAL_MS,
} from "./runtime";

type ApiBarsResponse = {
  symbol: string;
  timeframe: string;
  bars: ApiBacktestBar[];
  historyPage?: {
    newestBarAt?: string | null;
    hydrationStatus?: string | null;
  } | null;
};

type ApiResolvedOptionContractResponse = {
  contract: {
    ticker: string;
    underlying: string;
    expirationDate: string;
    strike: number;
    right: "call" | "put";
    multiplier: number;
    sharesPerContract: number;
    providerContractId: string | null;
    contractPresetId: string;
    dte: number;
  } | null;
};

type StudyRow = typeof backtestStudiesTable.$inferSelect;
type RunRow = typeof backtestRunsTable.$inferSelect;
type SweepRow = typeof backtestSweepsTable.$inferSelect;
type JobRow = typeof backtestStudyJobsTable.$inferSelect;
type DatasetRow = typeof historicalBarDatasetsTable.$inferSelect;

type LoadedDataset = {
  dataset: DatasetRow;
  bars: BacktestBar[];
};

type RunDatasetBinding = {
  dataset: DatasetRow;
  role: string;
};

type PersistedResult = {
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  points: BacktestPoint[];
  warnings: string[];
};

type HistoricalBarsRequest = {
  symbol: string;
  timeframe: string;
  from: Date;
  to: Date;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  outsideRth?: boolean;
  directMassive?: boolean;
};

type ResolvedOptionContract = {
  ticker: string;
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  multiplier: number;
  sharesPerContract: number;
  providerContractId: string | null;
  contractPresetId: string;
  dte: number;
};

type OptionPositionState = {
  symbol: string;
  right: "call" | "put";
  dataset: DatasetRow;
  bars: BacktestBar[];
  entryBarIndex: number;
  lastRiskBarIndex: number;
  contract: ResolvedOptionContract;
  entryAt: Date;
  entryPrice: number;
  quantity: number;
  entryValue: number;
  entryCommissionPaid: number;
  peakPrice: number;
  trailingStopPrice: number | null;
};

type SimulatedOptionTrade = BacktestTrade & {
  dataset: DatasetRow;
  bars: BacktestBar[];
  contract: ResolvedOptionContract;
  entryCommissionPaid: number;
  exitCommissionPaid: number;
};

const benchmarkSymbols = ["SPY", "QQQ"] as const;
const BACKTEST_IBKR_RECENT_CUTOFF_MINUTES = 30;
const BACKTEST_BARS_FETCH_PRIORITY = 8;
const BACKTEST_BARS_REQUEST_FAMILY = "backtest-worker";
const HISTORICAL_BAR_INSERT_CHUNK_SIZE = 10;
const BACKTEST_BARS_MAX_INCOMPLETE_RETRIES = 3;
const BACKTEST_BARS_INCOMPLETE_RETRY_DELAY_MS = 5_000;
const BACKTEST_BARS_MAX_ACCEPTABLE_HISTORY_GAP_MS = 4 * 24 * 60 * 60 * 1000;
const OVERNIGHT_SYMBOL_CONCURRENCY = Math.max(
  1,
  Math.floor(Number(process.env.OVERNIGHT_SYMBOL_CONCURRENCY ?? 16) || 16),
);
const MASSIVE_DIRECT_MAX_RETRIES = 3;
const MASSIVE_DIRECT_RETRY_DELAY_MS = 1_000;

const MASSIVE_API_KEY_ENV_NAMES = [
  "MASSIVE_API_KEY",
  "MASSIVE_MARKET_DATA_API_KEY",
] as const;
const MASSIVE_API_BASE_URL_ENV_NAMES = ["MASSIVE_API_BASE_URL"] as const;

type MassiveRangeConfig = {
  multiplier: number;
  timespan: string;
};

const MASSIVE_RANGE_BY_TIMEFRAME: Partial<Record<string, MassiveRangeConfig>> = {
  "15m": { multiplier: 15, timespan: "minute" },
  "1h": { multiplier: 1, timespan: "hour" },
};

const newYorkTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readFirstEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function getMassiveDirectConfig(): { apiKey: string; baseUrl: string } {
  const apiKey = readFirstEnv(MASSIVE_API_KEY_ENV_NAMES);
  if (!apiKey) {
    throw new Error("Massive API key is not configured for direct backtest fetches.");
  }

  return {
    apiKey,
    baseUrl:
      readFirstEnv(MASSIVE_API_BASE_URL_ENV_NAMES)?.replace(/\/+$/, "") ??
      "https://api.massive.com",
  };
}

function buildMassiveDirectUrl(
  pathOrUrl: string,
  params: Record<string, string | number | boolean>,
): URL {
  const config = getMassiveDirectConfig();
  const url = new URL(
    pathOrUrl.startsWith("http") ? pathOrUrl : `${config.baseUrl}${pathOrUrl}`,
  );
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("apiKey", config.apiKey);
  return url;
}

function readRetryAfterMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return retryAfter * 1000;
  }
  return MASSIVE_DIRECT_RETRY_DELAY_MS * (attempt + 1);
}

async function fetchMassiveDirectJson(url: URL): Promise<unknown> {
  for (let attempt = 0; attempt <= MASSIVE_DIRECT_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      return response.json();
    }

    const body = await response.text().catch(() => "");
    if (
      attempt < MASSIVE_DIRECT_MAX_RETRIES &&
      (response.status === 429 || response.status >= 500)
    ) {
      await wait(readRetryAfterMs(response, attempt));
      continue;
    }

    throw new Error(
      `Massive aggregate fetch failed with ${response.status}: ${body.slice(0, 300)}`,
    );
  }

  throw new Error("Massive aggregate fetch exhausted retries.");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapMassiveDirectBar(value: unknown): BacktestBar | null {
  const record = asRecord(value);
  if (!record) return null;

  const timestampMs = asNumber(record.t ?? record.timestamp);
  const open = asNumber(record.o ?? record.open);
  const high = asNumber(record.h ?? record.high);
  const low = asNumber(record.l ?? record.low);
  const close = asNumber(record.c ?? record.close);
  const volume = asNumber(record.v ?? record.volume);
  if (
    timestampMs == null ||
    open == null ||
    high == null ||
    low == null ||
    close == null ||
    volume == null
  ) {
    return null;
  }

  return {
    startsAt: new Date(timestampMs),
    open,
    high,
    low,
    close,
    volume,
    source: "massive-direct",
  };
}

function isBacktestBar(value: BacktestBar | null): value is BacktestBar {
  return value !== null;
}

async function fetchMassiveDirectBarsRange(
  input: HistoricalBarsRequest,
): Promise<BacktestBar[]> {
  const range = MASSIVE_RANGE_BY_TIMEFRAME[input.timeframe];
  if (!range) {
    throw new Error(`Direct Massive fetch does not support ${input.timeframe}.`);
  }

  const path =
    `/v2/aggs/ticker/${encodeURIComponent(input.symbol)}` +
    `/range/${range.multiplier}/${range.timespan}` +
    `/${input.from.getTime()}/${input.to.getTime()}`;
  let nextUrl: string | null = buildMassiveDirectUrl(path, {
    adjusted: true,
    sort: "asc",
    limit: 50_000,
  }).toString();
  const bars: BacktestBar[] = [];
  let pageCount = 0;

  while (nextUrl && pageCount < 4) {
    const payload = asRecord(await fetchMassiveDirectJson(new URL(nextUrl)));
    bars.push(...asArray(payload?.results).map(mapMassiveDirectBar).filter(isBacktestBar));
    const providerNextUrl = asString(payload?.next_url);
    nextUrl = providerNextUrl
      ? buildMassiveDirectUrl(providerNextUrl, {}).toString()
      : null;
    pageCount += 1;
  }

  return filterRegularSessionBars(input.timeframe, bars);
}

function isRegularSessionBar(date: Date): boolean {
  const parts = newYorkTimeFormatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }

  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 570 && totalMinutes <= 960;
}

function filterRegularSessionBars(timeframe: string, bars: BacktestBar[]): BacktestBar[] {
  if (timeframe === "1d") {
    return bars;
  }

  return bars.filter((bar) => isRegularSessionBar(bar.startsAt));
}

function timeframeToDays(timeframe: string): number {
  switch (timeframe) {
    case "1s":
    case "5s":
    case "15s":
      return 7;
    case "1m":
      return 45;
    case "5m":
      return 180;
    case "15m":
      return 365;
    case "1h":
      return 365 * 3;
    case "1d":
      return 365 * 15;
    default:
      return 45;
  }
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function newestApiBarTimestampMs(bars: ApiBacktestBar[]): number | null {
  let newestMs: number | null = null;
  for (const bar of bars) {
    const timestampMs = parseTimestampMs(bar.timestamp);
    if (timestampMs == null) {
      continue;
    }
    newestMs = newestMs == null ? timestampMs : Math.max(newestMs, timestampMs);
  }
  return newestMs;
}

function isIncompleteHistoricalBarsResponse(
  payload: ApiBarsResponse,
  input: HistoricalBarsRequest,
): boolean {
  const hydrationStatus = payload.historyPage?.hydrationStatus;
  const historyStillHydrating =
    hydrationStatus === "cold" ||
    hydrationStatus === "partial" ||
    hydrationStatus === "warming";

  if (!historyStillHydrating) {
    return false;
  }

  const newestMs =
    parseTimestampMs(payload.historyPage?.newestBarAt) ??
    newestApiBarTimestampMs(payload.bars);
  if (newestMs == null) {
    return true;
  }

  return (
    input.to.getTime() - newestMs >
    BACKTEST_BARS_MAX_ACCEPTABLE_HISTORY_GAP_MS
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Unexpected ${response.status} from ${url}: ${body.slice(0, 500)}`,
    );
  }

  return (await response.json()) as T;
}

async function fetchBarsRange(input: HistoricalBarsRequest): Promise<BacktestBar[]> {
  if (input.directMassive) {
    return fetchMassiveDirectBarsRange(input);
  }

  const url = new URL(`${API_BASE_URL}/bars`);
  url.searchParams.set("symbol", input.symbol);
  url.searchParams.set("timeframe", input.timeframe);
  url.searchParams.set("from", input.from.toISOString());
  url.searchParams.set("to", input.to.toISOString());
  url.searchParams.set("limit", "50000");
  url.searchParams.set("allowHistoricalSynthesis", "true");
  url.searchParams.set("requireFreshHistorical", "true");
  url.searchParams.set("fetchPriority", String(BACKTEST_BARS_FETCH_PRIORITY));
  url.searchParams.set("requestFamily", BACKTEST_BARS_REQUEST_FAMILY);
  url.searchParams.set(
    "brokerRecentWindowMinutes",
    String(BACKTEST_IBKR_RECENT_CUTOFF_MINUTES),
  );
  if (input.assetClass) {
    url.searchParams.set("assetClass", input.assetClass);
  }
  if (input.providerContractId) {
    url.searchParams.set("providerContractId", input.providerContractId);
  }
  if (input.outsideRth != null) {
    url.searchParams.set("outsideRth", String(input.outsideRth));
  }

  for (let attempt = 0; attempt <= BACKTEST_BARS_MAX_INCOMPLETE_RETRIES; attempt += 1) {
    const payload = await fetchJson<ApiBarsResponse>(url.toString());
    if (!isIncompleteHistoricalBarsResponse(payload, input)) {
      return filterRegularSessionBars(
        input.timeframe,
        payload.bars.map(normalizeApiBar),
      );
    }

    if (attempt === BACKTEST_BARS_MAX_INCOMPLETE_RETRIES) {
      throw new Error(
        `Historical bars response incomplete for ${input.symbol} ${input.timeframe} ` +
          `${input.from.toISOString()}-${input.to.toISOString()}`,
      );
    }

    logger.warn(
      {
        symbol: input.symbol,
        timeframe: input.timeframe,
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        hydrationStatus: payload.historyPage?.hydrationStatus ?? null,
        newestBarAt: payload.historyPage?.newestBarAt ?? null,
        attempt: attempt + 1,
      },
      "Historical bars response is still hydrating; retrying",
    );
    await wait(BACKTEST_BARS_INCOMPLETE_RETRY_DELAY_MS);
  }

  return [];
}

async function fetchBarsSegmented(input: HistoricalBarsRequest): Promise<BacktestBar[]> {
  const segmentDays = timeframeToDays(input.timeframe);
  const results: BacktestBar[] = [];
  let cursor = new Date(input.from.getTime());

  while (cursor < input.to) {
    const segmentEndLimit = new Date(
      cursor.getTime() + segmentDays * 24 * 60 * 60 * 1000 - 1,
    );
    const segmentEndCandidate = endOfUtcDay(segmentEndLimit);
    const segmentEnd =
      segmentEndCandidate >= input.to
        ? input.to
        : segmentEndCandidate <= segmentEndLimit
          ? segmentEndCandidate
          : segmentEndLimit;
    const nextBars = await fetchBarsRange({
      ...input,
      from: cursor,
      to: segmentEnd,
    });
    results.push(...nextBars);
    cursor = new Date(segmentEnd.getTime() + 1);
  }

  return results
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
    .filter((bar, index, allBars) => {
      const previous = allBars[index - 1];
      return !previous || previous.startsAt.getTime() !== bar.startsAt.getTime();
    });
}

function estimateByteSize(bars: BacktestBar[]): number {
  return bars.length * 64;
}

function summarizeDatasetSource(bars: BacktestBar[]): string {
  const sources = new Set(
    bars
      .map((bar) => bar.source)
      .filter((source): source is string => Boolean(source)),
  );
  const hasIbkr = [...sources].some((source) => source.includes("ibkr"));
  const hasMassive = [...sources].some(
    (source) =>
      source.includes("massive") ||
      source.includes("history"),
  );

  if (hasIbkr && hasMassive) {
    return "massive+ibkr_recent";
  }

  if (hasIbkr) {
    return "ibkr_recent";
  }

  return "massive";
}

async function getStoredBarStorageBytes(): Promise<number> {
  const [row] = await db
    .select({
      totalBytes: sql<number>`coalesce(sum(${historicalBarDatasetsTable.byteSize}), 0)`,
    })
    .from(historicalBarDatasetsTable);

  return row?.totalBytes ?? 0;
}

async function evictNonPinnedDatasets(): Promise<void> {
  let totalBytes = await getStoredBarStorageBytes();

  if (totalBytes <= BAR_STORAGE_TARGET_BYTES) {
    return;
  }

  const candidates = await db
    .select()
    .from(historicalBarDatasetsTable)
    .where(eq(historicalBarDatasetsTable.pinnedCount, 0))
    .orderBy(asc(historicalBarDatasetsTable.lastAccessedAt));

  for (const dataset of candidates) {
    if (totalBytes <= BAR_STORAGE_TARGET_BYTES) {
      break;
    }

    await db
      .delete(historicalBarsTable)
      .where(eq(historicalBarsTable.datasetId, dataset.id));
    await db
      .delete(historicalBarDatasetsTable)
      .where(eq(historicalBarDatasetsTable.id, dataset.id));
    totalBytes -= dataset.byteSize;
  }
}

async function insertBars(datasetId: string, bars: BacktestBar[]): Promise<void> {
  for (
    let index = 0;
    index < bars.length;
    index += HISTORICAL_BAR_INSERT_CHUNK_SIZE
  ) {
    const chunk = bars.slice(index, index + HISTORICAL_BAR_INSERT_CHUNK_SIZE);
    await db.insert(historicalBarsTable).values(
      chunk.map((bar) => toHistoricalBarInsert(datasetId, bar)),
    );
  }
}

async function loadBarsFromDataset(
  dataset: DatasetRow,
  from: Date,
  to: Date,
): Promise<BacktestBar[]> {
  const rows = await db
    .select()
    .from(historicalBarsTable)
    .where(
      and(
        eq(historicalBarsTable.datasetId, dataset.id),
        gt(historicalBarsTable.startsAt, new Date(from.getTime() - 1)),
        lte(historicalBarsTable.startsAt, to),
      ),
    )
    .orderBy(asc(historicalBarsTable.startsAt));

  await db
    .update(historicalBarDatasetsTable)
    .set({ lastAccessedAt: new Date(), updatedAt: new Date() })
    .where(eq(historicalBarDatasetsTable.id, dataset.id));

  return rows.map(normalizeStoredHistoricalBar);
}

async function findCoveringDataset(
  symbol: string,
  timeframe: string,
  from: Date,
  to: Date,
): Promise<DatasetRow | null> {
  const [dataset] = await db
    .select()
    .from(historicalBarDatasetsTable)
    .where(
      and(
        eq(historicalBarDatasetsTable.symbol, symbol),
        eq(historicalBarDatasetsTable.timeframe, timeframe),
        eq(historicalBarDatasetsTable.sessionMode, "regular"),
        lte(historicalBarDatasetsTable.startsAt, from),
        gt(historicalBarDatasetsTable.endsAt, new Date(to.getTime() - 1)),
      ),
    )
    .orderBy(desc(historicalBarDatasetsTable.endsAt))
    .limit(1);

  return dataset ?? null;
}

async function findExactDataset(
  symbol: string,
  timeframe: string,
  source: string,
  from: Date,
  to: Date,
): Promise<DatasetRow | null> {
  const [dataset] = await db
    .select()
    .from(historicalBarDatasetsTable)
    .where(
      and(
        eq(historicalBarDatasetsTable.symbol, symbol),
        eq(historicalBarDatasetsTable.timeframe, timeframe),
        eq(historicalBarDatasetsTable.source, source),
        eq(historicalBarDatasetsTable.sessionMode, "regular"),
        eq(historicalBarDatasetsTable.startsAt, from),
        eq(historicalBarDatasetsTable.endsAt, to),
      ),
    )
    .limit(1);

  return dataset ?? null;
}

async function persistDataset(
  symbol: string,
  timeframe: string,
  from: Date,
  to: Date,
  bars: BacktestBar[],
  isSeeded: boolean,
): Promise<DatasetRow> {
  const source = summarizeDatasetSource(bars);
  const [insertedDataset] = await db
    .insert(historicalBarDatasetsTable)
    .values({
      symbol,
      timeframe,
      source,
      sessionMode: "regular",
      startsAt: from,
      endsAt: to,
      barCount: bars.length,
      byteSize: estimateByteSize(bars),
      pinnedCount: 0,
      isSeeded,
      lastAccessedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  if (!insertedDataset) {
    const existingDataset = await findExactDataset(
      symbol,
      timeframe,
      source,
      from,
      to,
    );
    if (existingDataset) {
      await db
        .update(historicalBarDatasetsTable)
        .set({ lastAccessedAt: new Date(), updatedAt: new Date() })
        .where(eq(historicalBarDatasetsTable.id, existingDataset.id));
      return existingDataset;
    }
    throw new Error(`Historical dataset insert conflicted but no row was found for ${symbol}`);
  }

  const dataset = insertedDataset;
  await insertBars(dataset.id, bars);
  await evictNonPinnedDatasets();
  return dataset;
}

async function loadDataset(
  input: {
    symbol: string;
    timeframe: string;
    from: Date;
    to: Date;
    preferSeededMinuteDataset: boolean;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    outsideRth?: boolean;
  },
): Promise<LoadedDataset> {
  const canonicalTimeframe =
    input.preferSeededMinuteDataset && input.timeframe !== "1m"
      ? "1m"
      : input.timeframe;
  const existingDataset = await findCoveringDataset(
    input.symbol,
    canonicalTimeframe,
    input.from,
    input.to,
  );

  if (existingDataset) {
    const existingBars = await loadBarsFromDataset(
      existingDataset,
      input.from,
      input.to,
    );
    return {
      dataset: existingDataset,
      bars:
        canonicalTimeframe === input.timeframe
          ? existingBars
          : aggregateBars(existingBars, input.timeframe as never),
    };
  }

  const fetchedBars = await fetchBarsSegmented({
    symbol: input.symbol,
    timeframe: canonicalTimeframe,
    from: input.from,
    to: input.to,
    assetClass: input.assetClass,
    providerContractId: input.providerContractId,
    outsideRth: input.outsideRth,
  });
  const dataset = await persistDataset(
    input.symbol,
    canonicalTimeframe,
    input.from,
    input.to,
    fetchedBars,
    canonicalTimeframe === "1m" &&
      benchmarkSymbols.includes(input.symbol as never),
  );

  return {
    dataset,
    bars:
      canonicalTimeframe === input.timeframe
        ? fetchedBars
        : aggregateBars(fetchedBars, input.timeframe as never),
  };
}

async function loadBarsWithoutPersistingDataset(
  input: HistoricalBarsRequest,
): Promise<BacktestBar[]> {
  return fetchBarsSegmented({ ...input, directMassive: true });
}

async function loadStudyData(study: StudyRow): Promise<{
  barsBySymbol: Record<string, BacktestBar[]>;
  datasets: DatasetRow[];
}> {
  const barsBySymbol: Record<string, BacktestBar[]> = {};
  const datasets: DatasetRow[] = [];

  for (const symbol of study.symbols) {
    const loaded = await loadDataset({
      symbol,
      timeframe: study.timeframe,
      from: study.startsAt,
      to: study.endsAt,
      preferSeededMinuteDataset: benchmarkSymbols.includes(symbol as never),
      assetClass: "equity",
    });

    barsBySymbol[symbol] = loaded.bars;
    datasets.push(loaded.dataset);
  }

  return { barsBySymbol, datasets };
}

async function loadBenchmarkData(study: StudyRow): Promise<{
  barsBySymbol: Record<string, BacktestBar[]>;
  datasets: DatasetRow[];
}> {
  const barsBySymbol: Record<string, BacktestBar[]> = {};
  const datasets: DatasetRow[] = [];

  for (const symbol of benchmarkSymbols) {
    const loaded = await loadDataset({
      symbol,
      timeframe: study.timeframe,
      from: study.startsAt,
      to: study.endsAt,
      preferSeededMinuteDataset: true,
      assetClass: "equity",
    });

    barsBySymbol[symbol] = loaded.bars;
    datasets.push(loaded.dataset);
  }

  return { barsBySymbol, datasets };
}

function buildDataQualityMetrics(
  datasets: DatasetRow[],
  barsBySymbol: Record<string, BacktestBar[]>,
) {
  const sources = new Set(datasets.map((dataset) => dataset.source));
  const bars = Object.values(barsBySymbol).flat();
  const mixedSources =
    sources.size > 1 ||
    [...sources].some((source) => source.includes("+"));
  const missingBarCount = Object.values(barsBySymbol).filter(
    (symbolBars) => symbolBars.length === 0,
  ).length;

  return {
    sourcePolicy: "massive_historical_with_ibkr_recent_30m",
    primarySource: mixedSources
      ? "mixed"
      : sources.values().next().value ?? "massive",
    ibkrRecentCutoffMinutes: BACKTEST_IBKR_RECENT_CUTOFF_MINUTES,
    coveragePercent:
      Object.keys(barsBySymbol).length > 0
        ? ((Object.keys(barsBySymbol).length - missingBarCount) /
            Object.keys(barsBySymbol).length) *
          100
        : 0,
    missingBarCount,
    delayed: bars.some((bar) => Boolean(bar.delayed)),
    mixedSources,
  };
}

function enrichResultMetrics(input: {
  result: PersistedResult;
  study: StudyDefinition;
  datasets: DatasetRow[];
  barsBySymbol: Record<string, BacktestBar[]>;
  benchmarkBarsBySymbol?: Record<string, BacktestBar[]>;
  trialCount?: number;
  oosWindowCount?: number;
  parameterCount?: number;
}): PersistedResult {
  const benchmarks =
    input.benchmarkBarsBySymbol == null
      ? undefined
      : benchmarkSymbols.flatMap((symbol) => {
          const benchmark = calculateBenchmarkMetrics({
            symbol,
            benchmarkBars: input.benchmarkBarsBySymbol?.[symbol] ?? [],
            strategyPoints: input.result.points,
            initialCapital: input.study.portfolioRules.initialCapital,
          });
          return benchmark ? [benchmark] : [];
        });
  const metrics = calculateBacktestMetrics(
    input.result.points,
    input.result.trades,
    input.study.portfolioRules.initialCapital,
    {
      trialCount: input.trialCount,
      oosWindowCount: input.oosWindowCount,
      parameterCount: input.parameterCount,
      benchmarks,
    },
  );
  metrics.dataQuality = buildDataQualityMetrics(input.datasets, input.barsBySymbol);

  const warnings = [...input.result.warnings];
  if (metrics.dataQuality.mixedSources) {
    warnings.push(
      `Historical policy used Massive data plus IBKR bars inside the final ${BACKTEST_IBKR_RECENT_CUTOFF_MINUTES} minutes.`,
    );
  }
  metrics.validation?.warnings.forEach((warning) => {
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
  });

  return {
    ...input.result,
    metrics,
    warnings,
  };
}

async function pinDatasetsToRun(
  runId: string,
  bindings: RunDatasetBinding[],
): Promise<void> {
  if (bindings.length === 0) {
    return;
  }

  const uniqueBindings = [
    ...new Map(
      bindings.map((binding) => [
        `${binding.dataset.id}:${binding.role}`,
        binding,
      ]),
    ).values(),
  ];

  await db.insert(backtestRunDatasetsTable).values(
    uniqueBindings.map(({ dataset, role }) => ({
      runId,
      datasetId: dataset.id,
      role,
    })),
  ).onConflictDoNothing();

  const uniqueDatasetIds = [...new Set(uniqueBindings.map(({ dataset }) => dataset.id))];

  await db
    .update(historicalBarDatasetsTable)
    .set({
      pinnedCount: sql`${historicalBarDatasetsTable.pinnedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      inArray(
        historicalBarDatasetsTable.id,
        uniqueDatasetIds,
      ),
    );
}

function buildStudyDefinition(
  study: StudyRow,
  parametersOverride?: Record<string, unknown>,
): StudyDefinition {
  const optimizerConfig = (study.optimizerConfig ?? {}) as Record<string, unknown>;
  const rawRiskRules =
    parametersOverride?.riskRules ??
    (study.parameters as Record<string, unknown> | null)?.riskRules ??
    optimizerConfig.riskRules;

  return {
    strategyId: study.strategyId,
    strategyVersion: study.strategyVersion,
    symbols: study.symbols,
    timeframe: study.timeframe as never,
    from: study.startsAt,
    to: study.endsAt,
    parameters: {
      ...(study.parameters ?? {}),
      ...(parametersOverride ?? {}),
    } as Record<string, string | number | boolean>,
    riskRules: normalizeRiskRules(rawRiskRules),
    executionProfile: study.executionProfile as {
      commissionBps: number;
      slippageBps: number;
    },
    portfolioRules: study.portfolioRules as {
      initialCapital: number;
      positionSizePercent: number;
      maxConcurrentPositions: number;
      maxGrossExposurePercent: number;
    },
  };
}

function normalizeRiskRules(value: unknown): BacktestRiskRules | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const readPercent = (key: string): number | null => {
    const raw = record[key];
    const parsed = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const basis =
    record.basis === "underlying_price" ||
    record.basis === "both" ||
    record.basis === "position_price"
      ? record.basis
      : undefined;

  return {
    stopLossPercent: readPercent("stopLossPercent"),
    takeProfitPercent: readPercent("takeProfitPercent"),
    trailingStopPercent: readPercent("trailingStopPercent"),
    trailingActivationPercent: readPercent("trailingActivationPercent"),
    basis,
  };
}

function computeCommission(value: number, commissionBps: number): number {
  return value * (commissionBps / 10_000);
}

function applySlippage(price: number, side: "buy" | "sell", slippageBps: number): number {
  const multiplier = slippageBps / 10_000;
  return side === "buy" ? price * (1 + multiplier) : price * (1 - multiplier);
}

function buildOptionDatasetRole(symbol: string, entryAt: Date): string {
  return `option:${symbol.toUpperCase().slice(0, 8)}:${entryAt.getTime()}`;
}

function findBarIndexAtOrAfter(bars: BacktestBar[], timestampMs: number): number | null {
  for (let index = 0; index < bars.length; index += 1) {
    if (bars[index]!.startsAt.getTime() >= timestampMs) {
      return index;
    }
  }

  return null;
}

function findBarIndexAtOrBefore(bars: BacktestBar[], timestampMs: number): number | null {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (bars[index]!.startsAt.getTime() <= timestampMs) {
      return index;
    }
  }

  return null;
}

function closeOptionTrade(
  position: OptionPositionState,
  exitBar: BacktestBar,
  exitPrice: number,
  exitReason: string,
  commissionPaid: number,
): SimulatedOptionTrade {
  const exitValue = exitPrice * position.quantity * position.contract.multiplier;
  const grossPnl = exitValue - position.entryValue;
  const netPnl = grossPnl - position.entryCommissionPaid - commissionPaid;
  const barsHeld = Math.max(
    (findBarIndexAtOrBefore(position.bars, exitBar.startsAt.getTime()) ?? 0) -
      (findBarIndexAtOrBefore(position.bars, position.entryAt.getTime()) ?? 0),
    1,
  );

  return {
    symbol: position.symbol,
    side: "long",
    instrumentType: "option",
    pricingMode: "option_history",
    underlying: position.symbol,
    optionContract: {
      ticker: position.contract.ticker,
      underlying: position.contract.underlying,
      expirationDate: position.contract.expirationDate.toISOString().slice(0, 10),
      strike: position.contract.strike,
      right: position.contract.right,
      multiplier: position.contract.multiplier,
      providerContractId: position.contract.providerContractId,
      dte: position.contract.dte,
    },
    entryAt: position.entryAt,
    exitAt: exitBar.startsAt,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: position.quantity,
    entryValue: position.entryValue,
    exitValue,
    grossPnl,
    netPnl,
    netPnlPercent: position.entryValue > 0 ? (netPnl / position.entryValue) * 100 : 0,
    barsHeld,
    commissionPaid: position.entryCommissionPaid + commissionPaid,
    exitReason,
    dataset: position.dataset,
    bars: position.bars,
    contract: position.contract,
    entryCommissionPaid: position.entryCommissionPaid,
    exitCommissionPaid: commissionPaid,
  };
}

async function resolveOptionContractForSignal(input: {
  underlying: string;
  occurredAt: Date;
  right: "call" | "put";
  spotPrice: number;
  contractPresetId?: string | null;
  signalOptionsProfile?: SignalOptionsExecutionProfile | null;
}): Promise<ResolvedOptionContract | null> {
  const url = new URL(`${API_BASE_URL}/backtests/internal/resolve-option-contract`);
  const payload = await fetchJson<ApiResolvedOptionContractResponse>(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...input,
      occurredAt: input.occurredAt.toISOString(),
      signalOptionsProfile: input.signalOptionsProfile ?? null,
    }),
  });

  if (!payload.contract) {
    return null;
  }

  return {
    ...payload.contract,
    expirationDate: new Date(payload.contract.expirationDate),
  };
}

function buildOptionPoints(
  study: StudyDefinition,
  barsBySymbol: Record<string, BacktestBar[]>,
  trades: SimulatedOptionTrade[],
): BacktestPoint[] {
  const timestamps = [
    ...new Set(
      [
        ...Object.values(barsBySymbol).flatMap((bars) =>
          bars.map((bar) => bar.startsAt.getTime()),
        ),
        ...trades.flatMap((trade) => [
          trade.entryAt.getTime(),
          trade.exitAt.getTime(),
        ]),
      ].sort((left, right) => left - right),
    ),
  ];
  const entriesByTime = new Map<number, SimulatedOptionTrade[]>();
  const exitsByTime = new Map<number, SimulatedOptionTrade[]>();

  trades.forEach((trade) => {
    const entryKey = trade.entryAt.getTime();
    const exitKey = trade.exitAt.getTime();
    entriesByTime.set(entryKey, [...(entriesByTime.get(entryKey) ?? []), trade]);
    exitsByTime.set(exitKey, [...(exitsByTime.get(exitKey) ?? []), trade]);
  });

  const activeTrades = new Map<string, SimulatedOptionTrade>();
  const points: BacktestPoint[] = [];
  let cash = study.portfolioRules.initialCapital;
  let peakEquity = study.portfolioRules.initialCapital;

  timestamps.forEach((timestamp) => {
    const exits = exitsByTime.get(timestamp) ?? [];
    exits.forEach((trade) => {
      cash += trade.exitValue - trade.exitCommissionPaid;
      activeTrades.delete(trade.symbol);
    });

    const entries = entriesByTime.get(timestamp) ?? [];
    entries.forEach((trade) => {
      cash -= trade.entryValue + trade.entryCommissionPaid;
      activeTrades.set(trade.symbol, trade);
    });

    let grossExposure = 0;
    activeTrades.forEach((trade) => {
      const priceIndex =
        findBarIndexAtOrBefore(trade.bars, timestamp) ??
        findBarIndexAtOrBefore(trade.bars, trade.entryAt.getTime());
      const markPrice = priceIndex != null ? trade.bars[priceIndex]?.close : trade.entryPrice;

      if (typeof markPrice === "number" && Number.isFinite(markPrice)) {
        grossExposure += markPrice * trade.quantity * trade.contract.multiplier;
      }
    });

    const equity = cash + grossExposure;
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPercent =
      peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0;

    points.push({
      occurredAt: new Date(timestamp),
      equity,
      cash,
      grossExposure,
      drawdownPercent,
    });
  });

  return points;
}

function utcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function optionPositionUnrealizedAt(
  position: OptionPositionState,
  timestampMs: number,
): number {
  const priceIndex =
    findBarIndexAtOrBefore(position.bars, timestampMs) ??
    findBarIndexAtOrBefore(position.bars, position.entryAt.getTime());
  const markPrice = priceIndex != null ? position.bars[priceIndex]?.close : null;
  return typeof markPrice === "number" && Number.isFinite(markPrice)
    ? (markPrice - position.entryPrice) *
        position.quantity *
        position.contract.multiplier
    : 0;
}

function resolveSignalOptionsRiskExit(
  position: OptionPositionState,
  profile: SignalOptionsExecutionProfile,
  untilMs: number,
): { bar: BacktestBar; price: number; reason: string; index: number } | null {
  for (
    let index = position.lastRiskBarIndex + 1;
    index < position.bars.length;
    index += 1
  ) {
    const bar = position.bars[index]!;
    if (bar.startsAt.getTime() > untilMs) {
      break;
    }

    position.lastRiskBarIndex = index;
    position.peakPrice = Math.max(position.peakPrice, bar.high);
    const fixedStop =
      position.entryPrice * (1 + profile.exitPolicy.hardStopPct / 100);
    const trailActivated =
      position.peakPrice >=
      position.entryPrice *
        (1 + profile.exitPolicy.trailActivationPct / 100);

    if (trailActivated) {
      const giveback =
        position.peakPrice * (1 - profile.exitPolicy.trailGivebackPct / 100);
      const locked =
        position.entryPrice * (1 + profile.exitPolicy.minLockedGainPct / 100);
      const nextTrail = Math.max(giveback, locked);
      position.trailingStopPrice =
        position.trailingStopPrice == null
          ? nextTrail
          : Math.max(position.trailingStopPrice, nextTrail);
    }

    const triggered = [
      bar.low <= fixedStop
        ? { price: fixedStop, reason: "signal_options_hard_stop" }
        : null,
      position.trailingStopPrice != null && bar.low <= position.trailingStopPrice
        ? {
            price: position.trailingStopPrice,
            reason: "signal_options_trailing_stop",
          }
        : null,
    ].filter((item): item is { price: number; reason: string } =>
      Boolean(item),
    );

    if (triggered.length > 0) {
      const conservative = triggered.sort(
        (left, right) => left.price - right.price,
      )[0]!;
      return {
        bar,
        price: bar.open <= conservative.price ? bar.open : conservative.price,
        reason: conservative.reason,
        index,
      };
    }
  }

  return null;
}

type RunOptionsBacktestDependencies = {
  resolveOptionContractForSignal?: typeof resolveOptionContractForSignal;
  loadDataset?: typeof loadDataset;
  deploymentSignalOptionsProfile?: unknown;
};

export async function runOptionsBacktest(
  study: StudyDefinition,
  barsBySymbol: Record<string, BacktestBar[]>,
  dependencies: RunOptionsBacktestDependencies = {},
): Promise<{
  result: PersistedResult;
  datasetBindings: RunDatasetBinding[];
}> {
  const resolveContract =
    dependencies.resolveOptionContractForSignal ?? resolveOptionContractForSignal;
  const loadHistoricalDataset = dependencies.loadDataset ?? loadDataset;
  const optionFillPolicy = resolveWorkerOptionFillPolicy(study.parameters);
  const warnings: string[] = optionFillPolicy ? [] : [OPTIONS_AGGREGATE_BARS_WARNING];
  const trades: SimulatedOptionTrade[] = [];
  const datasetBindings: RunDatasetBinding[] = [];
  const positions = new Map<string, OptionPositionState>();
  const signalOptionsProfile = resolveWorkerSignalOptionsProfile(
    study,
    dependencies.deploymentSignalOptionsProfile,
  );
  const dailyRealizedPnl = new Map<string, number>();
  let cash = study.portfolioRules.initialCapital;
  if (signalOptionsProfile && !optionFillPolicy) {
    warnings.push(SIGNAL_OPTIONS_AGGREGATE_BARS_WARNING);
  }

  const recordClosedPosition = (
    position: OptionPositionState,
    exitBar: BacktestBar,
    exitPrice: number,
    exitReason: string,
  ): void => {
    const exitValue = exitPrice * position.quantity * position.contract.multiplier;
    const exitCommissionPaid = computeCommission(
      exitValue,
      study.executionProfile.commissionBps,
    );
    cash += exitValue - exitCommissionPaid;
    const trade = closeOptionTrade(
      position,
      exitBar,
      exitPrice,
      exitReason,
      exitCommissionPaid,
    );
    trades.push(trade);
    positions.delete(position.symbol);

    if (signalOptionsProfile) {
      const key = utcDateKey(exitBar.startsAt);
      dailyRealizedPnl.set(key, (dailyRealizedPnl.get(key) ?? 0) + trade.netPnl);
    }
  };

  const resolveOptionExitPrice = (
    position: OptionPositionState,
    exitBar: BacktestBar,
    occurredAt: Date,
    side: "sell",
  ): number | null => {
    if (!optionFillPolicy) {
      return applySlippage(
        exitBar.open,
        side,
        study.executionProfile.slippageBps,
      );
    }

    const decision = resolveWorkerOptionFill({
      bar: exitBar,
      side,
      policy: optionFillPolicy,
      occurredAt,
    });
    if (decision.status === "filled") {
      return decision.fillPrice;
    }

    warnings.push(
      formatOptionFillNoFillWarning({
        symbol: position.symbol,
        optionTicker: position.contract.ticker,
        side,
        model: optionFillPolicy.model,
        occurredAt,
        reason: decision.reason,
      }),
    );
    return null;
  };

  const closeSignalOptionsRiskExits = (untilMs: number): void => {
    if (!signalOptionsProfile) {
      return;
    }

    [...positions.values()].forEach((position) => {
      const previousLastRiskBarIndex = position.lastRiskBarIndex;
      const riskExit = resolveSignalOptionsRiskExit(
        position,
        signalOptionsProfile,
        untilMs,
      );
      if (!riskExit) {
        return;
      }

      const exitPrice = optionFillPolicy
        ? resolveOptionExitPrice(position, riskExit.bar, riskExit.bar.startsAt, "sell")
        : applySlippage(
            riskExit.price,
            "sell",
            study.executionProfile.slippageBps,
          );
      if (exitPrice == null) {
        position.lastRiskBarIndex = previousLastRiskBarIndex;
        return;
      }
      recordClosedPosition(position, riskExit.bar, exitPrice, riskExit.reason);
    });
  };

  const signalOptionsDailyPnlAt = (occurredAt: Date): number => {
    if (!signalOptionsProfile) {
      return 0;
    }
    const timestampMs = occurredAt.getTime();
    const openUnrealized = [...positions.values()].reduce(
      (sum, position) => sum + optionPositionUnrealizedAt(position, timestampMs),
      0,
    );
    return (dailyRealizedPnl.get(utcDateKey(occurredAt)) ?? 0) + openUnrealized;
  };

  const signalEvents = Object.entries(barsBySymbol)
    .flatMap(([symbol, bars]) =>
      buildPyrusSignalsSignalTape(bars, study.parameters).events
        .filter((event) => event.kind === "choch")
        .map((event) => ({
          ...event,
          symbol,
          spotBars: bars,
          spotBar: bars[event.barIndex] ?? null,
        })),
    )
    .sort(
      (left, right) =>
        left.occurredAt.getTime() - right.occurredAt.getTime() ||
        left.symbol.localeCompare(right.symbol),
    );

  for (const event of signalEvents) {
    const spotBar = event.spotBar;
    if (!spotBar) {
      continue;
    }

    closeSignalOptionsRiskExits(event.occurredAt.getTime());

    const desiredRight = signalOptionsRightForDirection(event.direction);
    const existingPosition = positions.get(event.symbol) ?? null;

    if (
      existingPosition &&
      existingPosition.right !== desiredRight &&
      (!signalOptionsProfile ||
        signalOptionsProfile.exitPolicy.flipOnOppositeSignal)
    ) {
      const exitBarIndex =
        findBarIndexAtOrAfter(existingPosition.bars, event.occurredAt.getTime()) ??
        existingPosition.bars.length - 1;
      const exitBar = existingPosition.bars[exitBarIndex];

      if (!exitBar) {
        warnings.push(
          `${event.symbol}: unable to find option exit bars for ${existingPosition.contract.ticker}. Trade dropped.`,
        );
        positions.delete(event.symbol);
      } else {
        if (exitBar.startsAt.getTime() < event.occurredAt.getTime()) {
          warnings.push(
            `${event.symbol}: exit for ${existingPosition.contract.ticker} fell back to the last available intraday bar.`,
          );
        }

        const exitPrice = resolveOptionExitPrice(
          existingPosition,
          exitBar,
          event.occurredAt,
          "sell",
        );
        if (exitPrice == null) {
          continue;
        }
        recordClosedPosition(
          existingPosition,
          exitBar,
          exitPrice,
          `${event.direction === "long" ? "bullish" : "bearish"}_choch`,
        );
      }
    }

    if (positions.has(event.symbol)) {
      continue;
    }

    const maxOpenPositions = signalOptionsProfile
      ? Math.min(
          study.portfolioRules.maxConcurrentPositions,
          signalOptionsProfile.riskCaps.maxOpenSymbols,
        )
      : study.portfolioRules.maxConcurrentPositions;

    if (positions.size >= maxOpenPositions) {
      warnings.push(
        `${event.symbol}: skipped ${desiredRight} entry at ${event.occurredAt.toISOString()} because the portfolio was already at max concurrent positions.`,
      );
      continue;
    }

    if (
      signalOptionsProfile &&
      signalOptionsDailyPnlAt(event.occurredAt) <=
        -Math.abs(signalOptionsProfile.riskCaps.maxDailyLoss)
    ) {
      warnings.push(
        `${event.symbol}: skipped ${desiredRight} entry at ${event.occurredAt.toISOString()} because the signal-options daily loss halt was active.`,
      );
      continue;
    }

    const contract = await resolveContract({
      underlying: event.symbol,
      occurredAt: event.occurredAt,
      right: desiredRight,
      spotPrice: spotBar.close,
      contractPresetId: signalOptionsProfile
        ? null
        : typeof study.parameters["contractPresetId"] === "string"
          ? study.parameters["contractPresetId"]
          : null,
      signalOptionsProfile,
    });

    if (!contract) {
      warnings.push(
        `${event.symbol}: no historical ${desiredRight} contract matched the preset at ${event.occurredAt.toISOString()}.`,
      );
      continue;
    }

    const optionTo = new Date(
      Math.min(study.to.getTime(), contract.expirationDate.getTime()),
    );
    const optionData = await loadHistoricalDataset({
      symbol: contract.ticker,
      timeframe: study.timeframe,
      from: event.occurredAt,
      to: optionTo,
      preferSeededMinuteDataset: false,
      assetClass: "option",
      providerContractId: contract.providerContractId,
    });
    const entryBarIndex = findBarIndexAtOrAfter(
      optionData.bars,
      event.occurredAt.getTime(),
    );

    if (entryBarIndex == null) {
      warnings.push(
        `${event.symbol}: ${contract.ticker} had no usable intraday bars at or after ${event.occurredAt.toISOString()}; trade skipped.`,
      );
      continue;
    }

    const entryBar = optionData.bars[entryBarIndex];
    if (!entryBar) {
      continue;
    }

    if (
      optionFillPolicy &&
      !isQuoteReplayEligible(study.timeframe, optionData.bars)
    ) {
      warnings.push(
        `${event.symbol}: ${contract.ticker} ${optionFillPolicy.model} fill skipped at ${event.occurredAt.toISOString()} because quote replay is unavailable for ${study.timeframe} option bars.`,
      );
      continue;
    }

    if (entryBar.startsAt.getTime() > event.occurredAt.getTime()) {
      warnings.push(
        `${event.symbol}: ${contract.ticker} filled on the next available intraday bar after the signal.`,
      );
    }

    const entryFill = optionFillPolicy
      ? resolveWorkerOptionFill({
          bar: entryBar,
          side: "buy",
          policy: optionFillPolicy,
          occurredAt: event.occurredAt,
        })
      : null;
    if (entryFill?.status === "no_fill") {
      warnings.push(
        formatOptionFillNoFillWarning({
          symbol: event.symbol,
          optionTicker: contract.ticker,
          side: "buy",
          model: optionFillPolicy!.model,
          occurredAt: event.occurredAt,
          reason: entryFill.reason,
        }),
      );
      continue;
    }

    const entryPrice =
      entryFill?.status === "filled"
        ? entryFill.fillPrice
        : applySlippage(
            entryBar.open,
            "buy",
            study.executionProfile.slippageBps,
          );
    const contractCost = entryPrice * contract.multiplier;
    const targetPositionValue =
      study.portfolioRules.initialCapital *
      (study.portfolioRules.positionSizePercent / 100);
    const maxByPositionSize = Math.floor(targetPositionValue / contractCost);
    const quantity = signalOptionsProfile
      ? Math.min(
          maxByPositionSize,
          signalOptionsProfile.riskCaps.maxContracts,
          Math.floor(
            signalOptionsProfile.riskCaps.maxPremiumPerEntry / contractCost,
          ),
        )
      : maxByPositionSize;

    if (quantity <= 0) {
      warnings.push(
        `${event.symbol}: ${contract.ticker} premium was too high for the configured position size.`,
      );
      continue;
    }

    const entryValue = entryPrice * quantity * contract.multiplier;
    const entryCommissionPaid = computeCommission(
      entryValue,
      study.executionProfile.commissionBps,
    );
    const totalCost = entryValue + entryCommissionPaid;

    if (cash < totalCost) {
      warnings.push(
        `${event.symbol}: insufficient cash to open ${contract.ticker} at ${entryBar.startsAt.toISOString()}.`,
      );
      continue;
    }

    cash -= totalCost;
    const openedPosition: OptionPositionState = {
      symbol: event.symbol,
      right: desiredRight,
      dataset: optionData.dataset,
      bars: optionData.bars,
      entryBarIndex,
      lastRiskBarIndex: entryBarIndex,
      contract,
      entryAt: entryBar.startsAt,
      entryPrice,
      quantity,
      entryValue,
      entryCommissionPaid,
      peakPrice: entryPrice,
      trailingStopPrice: null,
    };
    positions.set(event.symbol, openedPosition);

    if (optionFillPolicy && signalOptionsProfile) {
      const sameBarExit = resolveWorkerSameBarConservativeExit({
        entryBar,
        entryPrice,
        hardStopPct: signalOptionsProfile.exitPolicy.hardStopPct,
      });
      if (sameBarExit) {
        recordClosedPosition(
          openedPosition,
          entryBar,
          sameBarExit.price,
          sameBarExit.reason,
        );
      }
    }
  }

  closeSignalOptionsRiskExits(study.to.getTime());

  [...positions.entries()].forEach(([symbol, position]) => {
    const exitBar = position.bars[position.bars.length - 1];

    if (!exitBar) {
      warnings.push(`${symbol}: unable to liquidate ${position.contract.ticker} at run end.`);
      return;
    }

    const exitPrice = optionFillPolicy
      ? resolveOptionExitPrice(position, exitBar, exitBar.startsAt, "sell")
      : applySlippage(
          exitBar.close,
          "sell",
          study.executionProfile.slippageBps,
        );
    if (exitPrice == null) {
      warnings.push(`${symbol}: unable to liquidate ${position.contract.ticker} at run end.`);
      return;
    }
    recordClosedPosition(position, exitBar, exitPrice, "end_of_run");
  });

  const sortedTrades = trades.sort(
    (left, right) =>
      left.entryAt.getTime() - right.entryAt.getTime() ||
      left.symbol.localeCompare(right.symbol),
  );
  const points = buildOptionPoints(study, barsBySymbol, sortedTrades);

  sortedTrades.forEach((trade) => {
    datasetBindings.push({
      dataset: trade.dataset,
      role: buildOptionDatasetRole(trade.symbol, trade.entryAt),
    });
  });

  const baseTrades = sortedTrades.map(
    ({
      dataset: _dataset,
      bars: _bars,
      contract: _contract,
      entryCommissionPaid: _entryCommissionPaid,
      exitCommissionPaid: _exitCommissionPaid,
      ...trade
    }) => trade,
  );

  return {
    result: {
      metrics: calculateBacktestMetrics(
        points,
        baseTrades,
        study.portfolioRules.initialCapital,
      ),
      trades: baseTrades,
      points,
      warnings,
    },
    datasetBindings,
  };
}

async function executeStudyRun(
  study: StudyDefinition,
  barsBySymbol: Record<string, BacktestBar[]>,
  primaryDatasetBindings: RunDatasetBinding[],
  deploymentSignalOptionsProfile?: unknown,
): Promise<{
  result: PersistedResult;
  datasetBindings: RunDatasetBinding[];
}> {
  if (
    shouldRunOptionsBacktest({
      strategyId: study.strategyId,
      parameters: study.parameters,
    })
  ) {
    const optionResult = await runOptionsBacktest(study, barsBySymbol, {
      deploymentSignalOptionsProfile,
    });
    return {
      result: optionResult.result,
      datasetBindings: [...primaryDatasetBindings, ...optionResult.datasetBindings],
    };
  }

  return {
    result: runBacktest(study, barsBySymbol),
    datasetBindings: primaryDatasetBindings,
  };
}

async function clearRunArtifacts(runId: string): Promise<void> {
  await db.delete(backtestRunTradesTable).where(eq(backtestRunTradesTable.runId, runId));
  await db.delete(backtestRunPointsTable).where(eq(backtestRunPointsTable.runId, runId));
  await db.delete(backtestRunDatasetsTable).where(eq(backtestRunDatasetsTable.runId, runId));
}

async function persistRunArtifacts(
  run: RunRow,
  datasetBindings: RunDatasetBinding[],
  result: PersistedResult,
): Promise<void> {
  await clearRunArtifacts(run.id);

  if (result.trades.length > 0) {
    await db.insert(backtestRunTradesTable).values(
      result.trades.map((trade) => ({
        runId: run.id,
        symbol: trade.symbol,
        side: trade.side,
        entryAt: trade.entryAt,
        exitAt: trade.exitAt,
        entryPrice: String(trade.entryPrice),
        exitPrice: String(trade.exitPrice),
        quantity: String(trade.quantity),
        entryValue: String(trade.entryValue),
        exitValue: String(trade.exitValue),
        grossPnl: String(trade.grossPnl),
        netPnl: String(trade.netPnl),
        netPnlPercent: String(trade.netPnlPercent),
        barsHeld: trade.barsHeld,
        commissionPaid: String(trade.commissionPaid),
        exitReason: trade.exitReason,
      })),
    );
  }

  if (result.points.length > 0) {
    const pointChunkSize = 1000;
    for (let index = 0; index < result.points.length; index += pointChunkSize) {
      const chunk = result.points.slice(index, index + pointChunkSize);
      await db.insert(backtestRunPointsTable).values(
        chunk.map((point) => ({
          runId: run.id,
          occurredAt: point.occurredAt,
          equity: String(point.equity),
          cash: String(point.cash),
          grossExposure: String(point.grossExposure),
          drawdownPercent: String(point.drawdownPercent),
        })),
      );
    }
  }

  await pinDatasetsToRun(run.id, datasetBindings);

  await db
    .update(backtestRunsTable)
    .set({
      status: "completed",
      metrics: result.metrics,
      warnings: result.warnings,
      errorMessage: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backtestRunsTable.id, run.id));
}

async function markRunFailed(runId: string, errorMessage: string): Promise<void> {
  await db
    .update(backtestRunsTable)
    .set({
      status: "failed",
      errorMessage: compactErrorMessage(errorMessage),
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backtestRunsTable.id, runId));
}

async function heartbeat(jobId: string, progressPercent: number): Promise<void> {
  await db
    .update(backtestStudyJobsTable)
    .set({
      lastHeartbeatAt: new Date(),
      progressPercent,
      updatedAt: new Date(),
    })
    .where(eq(backtestStudyJobsTable.id, jobId));
}

async function markJobFailed(jobId: string, error: Error): Promise<void> {
  await db
    .update(backtestStudyJobsTable)
    .set({
      status: "failed",
      errorMessage: compactErrorMessage(error.message),
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backtestStudyJobsTable.id, jobId));
}

async function markJobCompleted(jobId: string): Promise<void> {
  await db
    .update(backtestStudyJobsTable)
    .set({
      status: "completed",
      progressPercent: 100,
      finishedAt: new Date(),
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backtestStudyJobsTable.id, jobId));
}

async function getFreshJob(jobId: string): Promise<JobRow | null> {
  const [job] = await db
    .select()
    .from(backtestStudyJobsTable)
    .where(eq(backtestStudyJobsTable.id, jobId))
    .limit(1);

  return job ?? null;
}

async function shouldCancel(jobId: string): Promise<boolean> {
  const job = await getFreshJob(jobId);
  return job?.status === "cancel_requested";
}

async function markSweepStatus(
  sweepId: string,
  status: "running" | "completed" | "failed" | "canceled",
  updates: Partial<SweepRow> = {},
): Promise<void> {
  await db
    .update(backtestSweepsTable)
    .set({
      status,
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(backtestSweepsTable.id, sweepId));
}

async function processSingleRun(job: JobRow): Promise<void> {
  if (!job.runId) {
    throw new Error(`Job ${job.id} has no runId.`);
  }

  const [run, study] = await Promise.all([
    db
      .select()
      .from(backtestRunsTable)
      .where(eq(backtestRunsTable.id, job.runId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(backtestStudiesTable)
      .where(eq(backtestStudiesTable.id, job.studyId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!run || !study) {
    throw new Error(`Job ${job.id} references missing study or run.`);
  }

  await db
    .update(backtestRunsTable)
    .set({ status: "preparing_data", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(backtestRunsTable.id, run.id));

  await heartbeat(job.id, 10);
  const { barsBySymbol, datasets } = await loadStudyData(study);
  const benchmarkData = await loadBenchmarkData(study);

  if (await shouldCancel(job.id)) {
    await db
      .update(backtestRunsTable)
      .set({ status: "canceled", finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(backtestRunsTable.id, run.id));
    return;
  }

  await db
    .update(backtestRunsTable)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(backtestRunsTable.id, run.id));

  await heartbeat(job.id, 40);
  const payload = (job.payload ?? {}) as {
    deploymentSignalOptionsProfile?: unknown;
  };
  const primaryDatasetBindings = datasets.map((dataset) => ({
    dataset,
    role: "primary",
  }));
  const benchmarkDatasetBindings = benchmarkData.datasets.map((dataset) => ({
    dataset,
    role: `benchmark:${dataset.symbol}`,
  }));
  const studyDefinition = buildStudyDefinition(study, run.parameters);
  const execution = await executeStudyRun(
    studyDefinition,
    barsBySymbol,
    primaryDatasetBindings,
    payload.deploymentSignalOptionsProfile,
  );
  const enrichedResult = enrichResultMetrics({
    result: execution.result,
    study: studyDefinition,
    datasets: [...datasets, ...benchmarkData.datasets],
    barsBySymbol,
    benchmarkBarsBySymbol: benchmarkData.barsBySymbol,
  });
  await db
    .update(backtestRunsTable)
    .set({ status: "aggregating", updatedAt: new Date() })
    .where(eq(backtestRunsTable.id, run.id));

  await heartbeat(job.id, 80);
  await persistRunArtifacts(
    run,
    [...execution.datasetBindings, ...benchmarkDatasetBindings],
    enrichedResult,
  );
}

function sliceBarsByWindow(
  barsBySymbol: Record<string, BacktestBar[]>,
  from: Date,
  to: Date,
): Record<string, BacktestBar[]> {
  return Object.fromEntries(
    Object.entries(barsBySymbol).map(([symbol, bars]) => [
      symbol,
      bars.filter((bar) => bar.startsAt >= from && bar.startsAt <= to),
    ]),
  );
}

function mergeWindowMetrics(results: PersistedResult[]): BacktestMetrics {
  return results.reduce<BacktestMetrics>(
    (aggregate, result, index) => ({
      netPnl: aggregate.netPnl + result.metrics.netPnl,
      totalReturnPercent:
        aggregate.totalReturnPercent +
        result.metrics.totalReturnPercent / results.length,
      maxDrawdownPercent:
        index === 0
          ? result.metrics.maxDrawdownPercent
          : Math.min(aggregate.maxDrawdownPercent, result.metrics.maxDrawdownPercent),
      tradeCount: aggregate.tradeCount + result.metrics.tradeCount,
      winRatePercent:
        aggregate.winRatePercent + result.metrics.winRatePercent / results.length,
      profitFactor:
        aggregate.profitFactor + result.metrics.profitFactor / results.length,
      sharpeRatio:
        aggregate.sharpeRatio + result.metrics.sharpeRatio / results.length,
      returnOverMaxDrawdown:
        aggregate.returnOverMaxDrawdown +
        result.metrics.returnOverMaxDrawdown / results.length,
    }),
    {
      netPnl: 0,
      totalReturnPercent: 0,
      maxDrawdownPercent: 0,
      tradeCount: 0,
      winRatePercent: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      returnOverMaxDrawdown: 0,
    },
  );
}

async function processSweep(job: JobRow): Promise<void> {
  if (!job.sweepId) {
    throw new Error(`Job ${job.id} has no sweepId.`);
  }

  const [study, sweep] = await Promise.all([
    db
      .select()
      .from(backtestStudiesTable)
      .where(eq(backtestStudiesTable.id, job.studyId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(backtestSweepsTable)
      .where(eq(backtestSweepsTable.id, job.sweepId!))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!study || !sweep) {
    throw new Error(`Job ${job.id} references missing study or sweep.`);
  }

  await markSweepStatus(sweep.id, "running", { startedAt: new Date() });
  await heartbeat(job.id, 10);

  const payload = (job.payload ?? {}) as {
    mode?: "grid" | "random" | "walk_forward";
    baseParameters?: Record<string, unknown>;
    dimensions?: Array<{ key: string; values: unknown[] }>;
    randomCandidateBudget?: number;
    walkForwardTrainingMonths?: number;
    walkForwardTestMonths?: number;
    walkForwardStepMonths?: number;
    deploymentSignalOptionsProfile?: unknown;
  };

  const baseParameters = {
    ...(study.parameters ?? {}),
    ...(payload.baseParameters ?? {}),
  } as Record<string, string | number | boolean>;
  const dimensions =
    payload.dimensions?.map((dimension) => ({
      key: dimension.key,
      values: dimension.values.filter(
        (value): value is string | number | boolean =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      ),
    })) ?? [];
  const candidateParameters = buildCandidatesForMode(
    payload.mode ?? sweep.mode,
    baseParameters,
    dimensions,
    payload.randomCandidateBudget ?? 100,
  );

  const { barsBySymbol, datasets } = await loadStudyData(study);
  const benchmarkData = await loadBenchmarkData(study);
  const results: Array<{
    run: RunRow;
    datasetBindings: RunDatasetBinding[];
    result: PersistedResult;
  }> = [];

  const windows =
    sweep.mode === "walk_forward"
      ? buildWalkForwardWindows(
          study.startsAt,
          study.endsAt,
          payload.walkForwardTrainingMonths ?? 24,
          payload.walkForwardTestMonths ?? 6,
          payload.walkForwardStepMonths ?? 6,
        )
      : [];

  let effectiveCandidates = candidateParameters;

  if (
    shouldRankWalkForwardCandidatesWithSharedCore({
      sweepMode: sweep.mode,
      windowsCount: windows.length,
      parameters: buildStudyDefinition(study, baseParameters).parameters,
    })
  ) {
    const firstTrainingWindow = windows[0]!;
    const trainingBars = sliceBarsByWindow(
      barsBySymbol,
      firstTrainingWindow.trainingFrom,
      firstTrainingWindow.trainingTo,
    );
    const trainingResults = rankCandidateResults(
      candidateParameters.map((parameters) => ({
        parameters,
        result: runBacktest(
          {
            ...buildStudyDefinition(study),
            from: firstTrainingWindow.trainingFrom,
            to: firstTrainingWindow.trainingTo,
            parameters,
          },
          trainingBars,
        ),
      })),
    );
    effectiveCandidates = trainingResults.slice(0, 20).map((candidate) => candidate.parameters);
  }

  for (let index = 0; index < effectiveCandidates.length; index += MAX_PARALLEL_SWEEP_RUNS) {
    if (await shouldCancel(job.id)) {
      await markSweepStatus(sweep.id, "canceled", { finishedAt: new Date() });
      return;
    }

    const batch = effectiveCandidates.slice(index, index + MAX_PARALLEL_SWEEP_RUNS);

    const batchRunValues: Array<typeof backtestRunsTable.$inferInsert> = batch.map(
      (parameters, batchIndex) => ({
        studyId: study.id,
        sweepId: sweep.id,
        name: `${study.name} Candidate ${index + batchIndex + 1}`,
        strategyId: study.strategyId,
        strategyVersion: study.strategyVersion,
        directionMode: study.directionMode,
        status: "running",
        symbolUniverse: study.symbols,
        parameters,
        portfolioRules: study.portfolioRules,
        executionProfile: study.executionProfile,
        startedAt: new Date(),
      }),
    );

    const batchRuns = await db
      .insert(backtestRunsTable)
      .values(batchRunValues)
      .returning();

    const batchResults = await Promise.all(
      batchRuns.map(async (run) => {
        const parameters = run.parameters as Record<string, string | number | boolean>;
        const studyDefinition = buildStudyDefinition(study, parameters);
        const primaryDatasetBindings = datasets.map((dataset) => ({
          dataset,
          role: "primary",
        }));
        const benchmarkDatasetBindings = benchmarkData.datasets.map((dataset) => ({
          dataset,
          role: `benchmark:${dataset.symbol}`,
        }));

        if (sweep.mode === "walk_forward" && windows.length > 0) {
          const windowResults = await Promise.all(
            windows.map(async (window) =>
              (
                await executeStudyRun(
                  {
                    ...studyDefinition,
                    from: window.testFrom,
                    to: window.testTo,
                    parameters,
                  },
                  sliceBarsByWindow(barsBySymbol, window.testFrom, window.testTo),
                  primaryDatasetBindings,
                  payload.deploymentSignalOptionsProfile,
                )
              ).result,
            ),
          );

          return {
            run,
            datasetBindings: [
              ...primaryDatasetBindings,
              ...benchmarkDatasetBindings,
            ],
            result: enrichResultMetrics({
              result: {
                metrics: mergeWindowMetrics(windowResults),
                trades: windowResults.flatMap((windowResult) => windowResult.trades),
                points: windowResults.flatMap((windowResult) => windowResult.points),
                warnings: windowResults.flatMap((windowResult) => windowResult.warnings),
              },
              study: studyDefinition,
              datasets: [...datasets, ...benchmarkData.datasets],
              barsBySymbol,
              benchmarkBarsBySymbol: benchmarkData.barsBySymbol,
              trialCount: candidateParameters.length,
              oosWindowCount: windows.length,
              parameterCount: dimensions.length,
            }),
          };
        }

        const execution = await executeStudyRun(
          studyDefinition,
          barsBySymbol,
          primaryDatasetBindings,
          payload.deploymentSignalOptionsProfile,
        );

        return {
          run,
          datasetBindings: [
            ...execution.datasetBindings,
            ...benchmarkDatasetBindings,
          ],
          result: enrichResultMetrics({
            result: execution.result,
            study: studyDefinition,
            datasets: [...datasets, ...benchmarkData.datasets],
            barsBySymbol,
            benchmarkBarsBySymbol: benchmarkData.barsBySymbol,
            trialCount: candidateParameters.length,
            parameterCount: dimensions.length,
          }),
        };
      }),
    );

    for (const batchResult of batchResults) {
      await persistRunArtifacts(
        batchResult.run,
        batchResult.datasetBindings,
        batchResult.result,
      );
      results.push(batchResult);
    }

    const completedCount = Math.min(index + batch.length, effectiveCandidates.length);
    await db
      .update(backtestSweepsTable)
      .set({
        candidateCompletedCount: completedCount,
        updatedAt: new Date(),
      })
      .where(eq(backtestSweepsTable.id, sweep.id));

    await heartbeat(
      job.id,
      Math.round((completedCount / Math.max(effectiveCandidates.length, 1)) * 100),
    );
  }

  const ranked = rankCandidateResults(
    results.map(({ run, result }) => ({
      parameters: run.parameters as Record<string, string | number | boolean>,
      result,
    })),
  );

  const runByMetricKey = new Map(
    results.map(({ run, result }) => [
      JSON.stringify(run.parameters),
      { run, result },
    ]),
  );

  for (const [rank, candidate] of ranked.entries()) {
    const matched = runByMetricKey.get(JSON.stringify(candidate.parameters));
    if (!matched) {
      continue;
    }

    await db
      .update(backtestRunsTable)
      .set({
        sortRank: rank + 1,
        updatedAt: new Date(),
      })
      .where(eq(backtestRunsTable.id, matched.run.id));
  }

  const winningCandidate = ranked[0];
  const winningRun = winningCandidate
    ? runByMetricKey.get(JSON.stringify(winningCandidate.parameters))?.run ?? null
    : null;

  await markSweepStatus(sweep.id, "completed", {
    bestRunId: winningRun?.id ?? null,
    finishedAt: new Date(),
    rankingSummary: {
      bestRunId: winningRun?.id ?? null,
      candidateCount: ranked.length,
    },
  });
}

async function recoverStaleJobs(): Promise<void> {
  const staleThreshold = new Date(Date.now() - JOB_STALE_AFTER_MS);
  const jobs = await db
    .select()
    .from(backtestStudyJobsTable)
    .where(
      and(
        inArray(backtestStudyJobsTable.status, [
          "preparing_data",
          "running",
          "aggregating",
        ]),
        lte(backtestStudyJobsTable.lastHeartbeatAt, staleThreshold),
      ),
    );

  for (const job of jobs) {
    if (job.attemptCount < MAX_JOB_ATTEMPTS) {
      await db
        .update(backtestStudyJobsTable)
        .set({
          status: "queued",
          errorMessage: "Recovered stale job for retry.",
          updatedAt: new Date(),
        })
        .where(eq(backtestStudyJobsTable.id, job.id));
      continue;
    }

    await db
      .update(backtestStudyJobsTable)
      .set({
        status: "failed",
        errorMessage: "Job became stale too many times.",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(backtestStudyJobsTable.id, job.id));
  }

  const canceledQueuedJobs = await db
    .select()
    .from(backtestStudyJobsTable)
    .where(eq(backtestStudyJobsTable.status, "cancel_requested"));

  for (const job of canceledQueuedJobs) {
    if (job.startedAt) {
      continue;
    }

    await db
      .update(backtestStudyJobsTable)
      .set({
        status: "canceled",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(backtestStudyJobsTable.id, job.id));
  }
}

async function claimNextJob(): Promise<JobRow | null> {
  const [job] = await db
    .select()
    .from(backtestStudyJobsTable)
    .where(eq(backtestStudyJobsTable.status, "queued"))
    .orderBy(asc(backtestStudyJobsTable.createdAt))
    .limit(1);

  if (!job) {
    return null;
  }

  const [claimed] = await db
    .update(backtestStudyJobsTable)
    .set({
      status: "preparing_data",
      startedAt: job.startedAt ?? new Date(),
      lastHeartbeatAt: new Date(),
      attemptCount: job.attemptCount + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(backtestStudyJobsTable.id, job.id),
        eq(backtestStudyJobsTable.status, "queued"),
      ),
    )
    .returning();

  return claimed ?? null;
}

async function claimJobById(jobId: string): Promise<JobRow> {
  const [job] = await db
    .select()
    .from(backtestStudyJobsTable)
    .where(eq(backtestStudyJobsTable.id, jobId))
    .limit(1);

  if (!job) {
    throw new Error(`Backtest job ${jobId} was not found.`);
  }
  if (job.status !== "queued") {
    throw new Error(`Backtest job ${jobId} is ${job.status}, expected queued.`);
  }

  const [claimed] = await db
    .update(backtestStudyJobsTable)
    .set({
      status: "preparing_data",
      startedAt: job.startedAt ?? new Date(),
      lastHeartbeatAt: new Date(),
      attemptCount: job.attemptCount + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(backtestStudyJobsTable.id, job.id),
        eq(backtestStudyJobsTable.status, "queued"),
      ),
    )
    .returning();

  if (!claimed) {
    throw new Error(`Backtest job ${jobId} could not be claimed.`);
  }
  return claimed;
}

function parsePatternDiscoveryConfig(
  study: typeof backtestStudiesTable.$inferSelect,
): PatternDiscoveryConfig {
  const params = (study.parameters ?? {}) as Record<string, unknown>;
  const studySymbols = Array.isArray(study.symbols) ? study.symbols : [];
  const symbols =
    studySymbols.length > 0
      ? studySymbols
      : Array.isArray(params.symbols)
        ? (params.symbols as string[])
        : [];
  const timeframeSet =
    Array.isArray(params.timeframeSet) && params.timeframeSet.length > 0
      ? (params.timeframeSet as string[])
      : ["1m", "2m", "5m", "15m"];
  const baseTimeframe =
    typeof params.baseTimeframe === "string" &&
    timeframeSet.includes(params.baseTimeframe)
      ? params.baseTimeframe
      : timeframeSet[0];
  const forwardHorizonsBars =
    Array.isArray(params.forwardHorizonsBars) &&
    params.forwardHorizonsBars.length > 0
      ? (params.forwardHorizonsBars as number[]).filter(
          (horizon) => Number.isInteger(horizon) && horizon > 0,
        )
      : [3, 6, 12];
  const minSampleThreshold =
    typeof params.minSampleThreshold === "number" &&
    params.minSampleThreshold >= 0
      ? params.minSampleThreshold
      : 30;
  return {
    symbols,
    timeframeSet,
    baseTimeframe,
    forwardHorizonsBars,
    minSampleThreshold,
    signalSettingsByTimeframe:
      (params.signalSettingsByTimeframe as Record<
        string,
        Partial<PyrusSignalsSignalSettings>
      >) ?? {},
    persistOccurrences: params.persistOccurrences === true,
  };
}

function resolveSignalSettings(
  config: PatternDiscoveryConfig,
  timeframe: string,
): PyrusSignalsSignalSettings {
  // Layered: global default -> per-TF calibrated default -> study override.
  return {
    ...DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS,
    ...(DEFAULT_SIGNAL_SETTINGS_BY_TIMEFRAME[timeframe] ?? {}),
    ...(config.signalSettingsByTimeframe?.[timeframe] ?? {}),
  };
}

const patternNumericString = (value: number | null): string | null =>
  value == null ? null : String(value);

async function persistPatternResults(
  studyId: string,
  jobId: string,
  config: PatternDiscoveryConfig,
  results: PatternResultRow[],
  occurrenceRows: PatternOccurrenceRow[],
  coverageWarnings: string[],
): Promise<void> {
  const dataQuality = {
    signalSource: "pyrus-signals-core",
    timeframeSet: config.timeframeSet,
    baseTimeframe: config.baseTimeframe,
    coverageWarnings: coverageWarnings.slice(0, 50),
  };

  await db.transaction(async (tx) => {
    // Re-runnable: atomically replace any prior results for this study.
    await tx
      .delete(mtfPatternResultsTable)
      .where(eq(mtfPatternResultsTable.studyId, studyId));
    await tx
      .delete(mtfPatternOccurrencesTable)
      .where(eq(mtfPatternOccurrencesTable.studyId, studyId));

    for (let index = 0; index < results.length; index += 500) {
      const chunk = results.slice(index, index + 500).map((row) => ({
        studyId,
        jobId,
        patternKey: row.patternKey,
        timeframeSet: config.timeframeSet,
        baseTimeframe: config.baseTimeframe,
        horizonBars: row.horizonBars,
        sampleCount: row.sampleCount,
        bias: row.bias,
        winRatePct: patternNumericString(row.winRatePct),
        meanReturnPct: patternNumericString(row.meanReturnPct),
        medianReturnPct: patternNumericString(row.medianReturnPct),
        stdReturnPct: patternNumericString(row.stdReturnPct),
        avgMaePct: patternNumericString(row.avgMaePct),
        avgMfePct: patternNumericString(row.avgMfePct),
        score: patternNumericString(row.score),
        tStat: patternNumericString(row.tStat),
        rank: row.rank,
        dataQuality,
      }));
      await tx.insert(mtfPatternResultsTable).values(chunk);
    }

    for (let index = 0; index < occurrenceRows.length; index += 1000) {
      const chunk = occurrenceRows.slice(index, index + 1000).map((row) => ({
        studyId,
        symbol: row.symbol,
        occurredAt: row.occurredAt,
        patternKey: row.patternKey,
        horizonBars: row.horizonBars,
        realizedReturnPct: patternNumericString(row.realizedReturnPct),
        maePct: patternNumericString(row.maePct),
        mfePct: patternNumericString(row.mfePct),
      }));
      await tx.insert(mtfPatternOccurrencesTable).values(chunk);
    }
  });
}

type OvernightSignalExpectancyConfig = {
  symbols: string[];
  signalTimeframes: OvernightSignalTimeframe[];
  signalSettingsByTimeframe: Record<
    string,
    Partial<PyrusSignalsSignalSettings>
  >;
  persistSamples: boolean;
};

const OVERNIGHT_SAMPLE_INSERT_CHUNK_SIZE = 25;
const OVERNIGHT_SAMPLE_DELETE_CHUNK_SIZE = 5000;
const JOB_ERROR_MESSAGE_MAX_LENGTH = 1200;

function maybeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactErrorMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (compact.length <= JOB_ERROR_MESSAGE_MAX_LENGTH) return compact;

  const headLength = Math.floor((JOB_ERROR_MESSAGE_MAX_LENGTH - 5) / 2);
  const tailLength = JOB_ERROR_MESSAGE_MAX_LENGTH - 5 - headLength;
  return `${compact.slice(0, headLength)} ... ${compact.slice(-tailLength)}`;
}

function parseOvernightSignalExpectancyConfig(
  study: StudyRow,
): OvernightSignalExpectancyConfig {
  const parameters = maybeRecord(study.parameters);
  const signalSettingsByTimeframe = maybeRecord(
    parameters.signalSettingsByTimeframe,
  );
  const persistSamples =
    typeof parameters.persistSamples === "boolean"
      ? parameters.persistSamples
      : true;

  return {
    symbols: study.symbols,
    signalTimeframes: normalizeOvernightSignalTimeframes(
      Array.isArray(parameters.signalTimeframes)
        ? parameters.signalTimeframes.map(String)
        : null,
    ),
    signalSettingsByTimeframe: Object.fromEntries(
      Object.entries(signalSettingsByTimeframe).map(([timeframe, settings]) => [
        timeframe,
        maybeRecord(settings) as Partial<PyrusSignalsSignalSettings>,
      ]),
    ),
    persistSamples,
  };
}

const numericString = (value: number | null | undefined): string | null =>
  value == null || !Number.isFinite(value) ? null : value.toFixed(6);

type OvernightSymbolResult = {
  samples: OvernightSignalSample[];
  coverageWarnings: string[];
};

async function processOvernightSymbol(input: {
  symbol: string;
  startsAt: Date;
  dataTo: Date;
  sessions: OvernightRthSession[];
  loadTimeframes: OvernightLoadTimeframe[];
  signalTimeframes: OvernightSignalTimeframe[];
  signalSettingsByTimeframe: Record<
    string,
    Partial<PyrusSignalsSignalSettings>
  >;
}): Promise<OvernightSymbolResult> {
  const coverageWarnings: string[] = [];
  const barsByLoadTimeframe: Partial<Record<OvernightLoadTimeframe, BacktestBar[]>> =
    {};

  for (const timeframe of input.loadTimeframes) {
    const warmupFrom = new Date(
      input.startsAt.getTime() -
        WARMUP_DAYS_BY_LOAD_TIMEFRAME[timeframe] * 86_400_000,
    );
    try {
      const bars = await loadBarsWithoutPersistingDataset({
        symbol: input.symbol,
        timeframe,
        from: warmupFrom,
        to: input.dataTo,
        assetClass: "equity",
        outsideRth: false,
      });
      const rthBars = filterRegularTradingHoursBars(timeframe, bars);
      barsByLoadTimeframe[timeframe] = rthBars;
      if (rthBars.length === 0) {
        coverageWarnings.push(`${input.symbol} ${timeframe}: no strict RTH bars`);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      coverageWarnings.push(
        `${input.symbol} ${timeframe}: bar load failed: ${message.slice(0, 220)}`,
      );
      barsByLoadTimeframe[timeframe] = [];
    }
  }

  const canonical15mBars = barsByLoadTimeframe["15m"] ?? [];
  if (canonical15mBars.length === 0) {
    return { samples: [], coverageWarnings };
  }

  const overnightReturns = buildCanonicalOvernightReturnMap({
    canonical15mBars,
    sessions: input.sessions,
  });
  const samples: OvernightSignalSample[] = [];
  for (const signalTimeframe of input.signalTimeframes) {
    const sourceTimeframe = LOAD_TIMEFRAME_BY_SIGNAL_TIMEFRAME[signalTimeframe];
    const sourceBars = barsByLoadTimeframe[sourceTimeframe] ?? [];
    const signalBars = rollupBarsForSignalTimeframe(
      sourceBars,
      sourceTimeframe,
      signalTimeframe,
    );
    if (signalBars.length === 0) {
      coverageWarnings.push(`${input.symbol} ${signalTimeframe}: no signal bars`);
      continue;
    }
    samples.push(
      ...sampleOvernightSignalState({
        symbol: input.symbol,
        timeframe: signalTimeframe,
        bars: signalBars,
        sessions: input.sessions,
        overnightReturns,
        settings: input.signalSettingsByTimeframe[signalTimeframe],
      }),
    );
  }

  return { samples, coverageWarnings };
}

async function persistOvernightSamples(
  studyId: string,
  jobId: string,
  samples: OvernightSignalSample[],
): Promise<void> {
  for (
    let index = 0;
    index < samples.length;
    index += OVERNIGHT_SAMPLE_INSERT_CHUNK_SIZE
  ) {
    const chunk = samples.slice(index, index + OVERNIGHT_SAMPLE_INSERT_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await db.insert(overnightSignalExpectancySamplesTable).values(
      chunk.map((sample) => ({
        studyId,
        jobId,
        symbol: sample.symbol,
        sessionDate: sample.sessionDate,
        timeframe: sample.timeframe,
        status: sample.status,
        exclusionReason: sample.exclusionReason,
        signalAt: sample.signalAt,
        signalAvailableAt: sample.signalAvailableAt,
        entryAt: sample.entryAt,
        entryPrice: numericString(sample.entryPrice),
        exitAt: sample.exitAt,
        exitPrice: numericString(sample.exitPrice),
        returnPct: numericString(sample.returnPct),
        metadata: sample.metadata,
      })),
    );
  }
}

async function deleteOvernightSamplesForStudy(studyId: string): Promise<void> {
  for (;;) {
    const result = await db.execute(sql`
      with batch as (
        select id
        from ${overnightSignalExpectancySamplesTable}
        where study_id = ${studyId}
        limit ${OVERNIGHT_SAMPLE_DELETE_CHUNK_SIZE}
      )
      delete from ${overnightSignalExpectancySamplesTable}
      where id in (select id from batch)
      returning id
    `);
    const deleted = Number(
      (result as { rowCount?: unknown; rows?: unknown[] }).rowCount ??
        (result as { rowCount?: unknown; rows?: unknown[] }).rows?.length ??
        0,
    );
    if (deleted === 0) return;
  }
}

async function processOvernightSignalExpectancy(job: JobRow): Promise<void> {
  const study = await db
    .select()
    .from(backtestStudiesTable)
    .where(eq(backtestStudiesTable.id, job.studyId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!study) {
    throw new Error(`Job ${job.id} references missing study.`);
  }

  const config = parseOvernightSignalExpectancyConfig(study);
  if (config.symbols.length === 0) {
    throw new Error("Overnight signal-expectancy study has no symbols.");
  }

  await heartbeat(job.id, 2);
  const sessions = listNyseRthSessions({
    from: study.startsAt,
    to: study.endsAt,
  });
  if (sessions.length === 0) {
    throw new Error("Overnight signal-expectancy study has no NYSE RTH sessions.");
  }

  const lastNextOpenMs = sessions.reduce((latest, session) => {
    const openMs = session.nextRegularOpenAt?.getTime() ?? 0;
    return Math.max(latest, openMs + 15 * 60_000);
  }, study.endsAt.getTime());
  const dataTo = new Date(Math.max(study.endsAt.getTime(), lastNextOpenMs));
  const loadTimeframes = [
    ...new Set([
      OVERNIGHT_RETURN_TIMEFRAME,
      ...config.signalTimeframes.map(
        (timeframe) => LOAD_TIMEFRAME_BY_SIGNAL_TIMEFRAME[timeframe],
      ),
    ]),
  ] as OvernightLoadTimeframe[];
  const accumulator = createOvernightStatsAccumulator(config.signalTimeframes);
  const coverageWarnings: string[] = [];

  await deleteOvernightSamplesForStudy(study.id);
  await db
    .delete(overnightSignalExpectancyResultsTable)
    .where(eq(overnightSignalExpectancyResultsTable.studyId, study.id));

  let processedSymbolCount = 0;

  for (
    let symbolIndex = 0;
    symbolIndex < config.symbols.length;
    symbolIndex += OVERNIGHT_SYMBOL_CONCURRENCY
  ) {
    if (await shouldCancel(job.id)) return;

    const symbols = config.symbols.slice(
      symbolIndex,
      symbolIndex + OVERNIGHT_SYMBOL_CONCURRENCY,
    );
    const symbolResults = await Promise.all(
      symbols.map((symbol) =>
        processOvernightSymbol({
          symbol,
          startsAt: study.startsAt,
          dataTo,
          sessions,
          loadTimeframes,
          signalTimeframes: config.signalTimeframes,
          signalSettingsByTimeframe: config.signalSettingsByTimeframe,
        }),
      ),
    );

    for (const result of symbolResults) {
      coverageWarnings.push(...result.coverageWarnings);
      addOvernightSamplesToStats(accumulator, result.samples);
      if (config.persistSamples) {
        await persistOvernightSamples(study.id, job.id, result.samples);
      }
    }

    processedSymbolCount += symbols.length;
    await heartbeat(
      job.id,
      5 + Math.floor((processedSymbolCount / config.symbols.length) * 85),
    );
  }

  if (await shouldCancel(job.id)) return;
  await heartbeat(job.id, 92);

  const globalDataQuality = {
    sourcePolicy: "massive_adjusted_rth_outsideRth_false",
    returnPricePolicy: "15m_regular_close_to_next_regular_open",
    signalAvailabilityPolicy: "bar_start_plus_timeframe_step_lte_regular_close",
    universeSymbols: config.symbols.length,
    processedSymbols: processedSymbolCount,
    sessionCount: sessions.length,
    coverageWarningCount: coverageWarnings.length,
    coverageWarnings: coverageWarnings.slice(0, 100),
    survivorshipBias:
      "Current signal_universe_rankings.member snapshot; delisted and prior non-members are not reconstructed.",
  };
  const results = summarizeOvernightExpectancy(accumulator);

  if (results.length > 0) {
    await db.insert(overnightSignalExpectancyResultsTable).values(
      results.map((result) => ({
        studyId: study.id,
        jobId: job.id,
        timeframe: result.timeframe,
        sampleCount: result.sampleCount,
        eligibleSampleCount: result.eligibleSampleCount,
        buyStateCount: result.buyStateCount,
        validReturnCoveragePct: numericString(result.validReturnCoveragePct),
        buyStateFrequencyPct: numericString(result.buyStateFrequencyPct),
        expectancyPct: numericString(result.expectancyPct),
        medianReturnPct: numericString(result.medianReturnPct),
        winRatePct: numericString(result.winRatePct),
        avgWinPct: numericString(result.avgWinPct),
        avgLossPct: numericString(result.avgLossPct),
        payoffRatio: numericString(result.payoffRatio),
        stdReturnPct: numericString(result.stdReturnPct),
        tStat: numericString(result.tStat),
        ci95LowPct: numericString(result.ci95LowPct),
        ci95HighPct: numericString(result.ci95HighPct),
        rank: result.rank,
        winnerStatus: result.winnerStatus,
        pairwiseSummary: result.pairwiseSummary,
        dataQuality: {
          ...result.dataQuality,
          ...globalDataQuality,
        },
      })),
    );
  }

  await heartbeat(job.id, 100);
  logger.info(
    {
      jobId: job.id,
      studyId: study.id,
      symbols: config.symbols.length,
      sessions: sessions.length,
      timeframes: config.signalTimeframes,
    },
    "Overnight signal expectancy completed",
  );
}

async function processPatternDiscovery(job: JobRow): Promise<void> {
  const study = await db
    .select()
    .from(backtestStudiesTable)
    .where(eq(backtestStudiesTable.id, job.studyId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!study) {
    throw new Error(`Job ${job.id} references missing study.`);
  }
  const config = parsePatternDiscoveryConfig(study);
  if (config.symbols.length === 0) {
    throw new Error("Pattern discovery study has no symbols.");
  }

  await heartbeat(job.id, 5);
  const { startsAt: from, endsAt: to } = study;
  const loadTimeframes = [
    ...new Set([...config.timeframeSet, config.baseTimeframe]),
  ];

  const occurrences: PatternOccurrence[] = [];
  const baseBarsBySymbol: Record<string, BacktestBar[]> = {};
  const coverageWarnings: string[] = [];

  for (let symbolIndex = 0; symbolIndex < config.symbols.length; symbolIndex += 1) {
    if (await shouldCancel(job.id)) return;
    const symbol = config.symbols[symbolIndex];
    // Load each TF from a warmup buffer BEFORE the window so signals are stable at
    // the window start; sampling later restricts occurrences to the study window.
    const barsByTimeframe: Record<string, BacktestBar[]> = {};
    for (const timeframe of loadTimeframes) {
      const warmupFrom = new Date(
        from.getTime() - warmupDaysForTimeframe(timeframe) * 86_400_000,
      );
      const dataset = await loadDataset({
        symbol,
        timeframe,
        from: warmupFrom,
        to,
        preferSeededMinuteDataset: false,
      });
      barsByTimeframe[timeframe] = filterRegularSessionBars(
        timeframe,
        dataset.bars,
      );
    }
    const baseBars = barsByTimeframe[config.baseTimeframe] ?? [];
    baseBarsBySymbol[symbol] = baseBars;

    const eventsByTimeframe: Record<string, DirectionEvent[]> = {};
    for (const timeframe of config.timeframeSet) {
      const events = computeDirectionEvents(
        barsByTimeframe[timeframe] ?? [],
        resolveSignalSettings(config, timeframe),
      );
      eventsByTimeframe[timeframe] = events;
      if (events.length === 0) {
        coverageWarnings.push(
          `${symbol} ${timeframe}: no signal events (insufficient history?)`,
        );
      }
    }
    // Occurrences only within the study window; warmup bars prime the readers but
    // are not themselves occurrences.
    const baseBarsInWindow = baseBars.filter(
      (bar) => bar.startsAt.getTime() >= from.getTime(),
    );
    occurrences.push(
      ...sampleTransitions({
        symbol,
        timeframeSet: config.timeframeSet,
        baseBars: baseBarsInWindow,
        eventsByTimeframe,
      }),
    );
    await heartbeat(
      job.id,
      5 + Math.floor(((symbolIndex + 1) / config.symbols.length) * 75),
    );
  }

  if (await shouldCancel(job.id)) return;
  await heartbeat(job.id, 85);
  const { results, occurrenceRows } = scorePatterns({
    occurrences,
    barsBySymbol: baseBarsBySymbol,
    baseTimeframe: config.baseTimeframe,
    horizonsBars: config.forwardHorizonsBars,
    minSampleThreshold: config.minSampleThreshold,
  });

  await persistPatternResults(
    study.id,
    job.id,
    config,
    results,
    config.persistOccurrences ? occurrenceRows : [],
    coverageWarnings,
  );
  await heartbeat(job.id, 100);
  logger.info(
    {
      jobId: job.id,
      studyId: study.id,
      patternCount: results.length,
      occurrences: occurrences.length,
    },
    "Pattern discovery completed",
  );
}

async function processJob(job: JobRow): Promise<void> {
  try {
    if (job.kind === "single_run") {
      await processSingleRun(job);
    } else if (job.kind === "sweep") {
      await processSweep(job);
    } else if (job.kind === "pattern_discovery") {
      await processPatternDiscovery(job);
    } else if (job.kind === OVERNIGHT_SIGNAL_EXPECTANCY_KIND) {
      await processOvernightSignalExpectancy(job);
    } else {
      throw new Error(`Unsupported job kind: ${job.kind}`);
    }

    const freshJob = await getFreshJob(job.id);
    if (freshJob?.status === "cancel_requested") {
      await db
        .update(backtestStudyJobsTable)
        .set({
          status: "canceled",
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(backtestStudyJobsTable.id, job.id));
      return;
    }

    await markJobCompleted(job.id);
  } catch (error) {
    const resolvedError =
      error instanceof Error ? error : new Error(String(error));
    logger.error({ err: resolvedError, jobId: job.id }, "Backtest job failed");

    if (job.runId) {
      await markRunFailed(job.runId, resolvedError.message);
    }

    if (job.sweepId) {
      await markSweepStatus(job.sweepId, "failed", {
        finishedAt: new Date(),
      });
    }

    await markJobFailed(job.id, resolvedError);
  }
}

async function seedBenchmarks(): Promise<void> {
  const now = new Date();
  const from = new Date(now.getTime());
  from.setUTCFullYear(from.getUTCFullYear() - 10);

  for (const symbol of benchmarkSymbols) {
    const existing = await findCoveringDataset(symbol, "1m", from, now);
    if (existing) {
      logger.info({ symbol, datasetId: existing.id }, "Benchmark dataset already seeded");
      continue;
    }

    logger.info({ symbol }, "Seeding benchmark dataset");
    const bars = await fetchBarsSegmented({
      symbol,
      timeframe: "1m",
      from,
      to: now,
      assetClass: "equity",
    });
    await persistDataset(symbol, "1m", from, now, bars, true);
    logger.info({ symbol, barCount: bars.length }, "Benchmark dataset seeded");
  }
}

async function runWorkerLoop(): Promise<void> {
  logger.info({ apiBaseUrl: API_BASE_URL }, "Backtest worker started");

  while (true) {
    try {
      await recoverStaleJobs();
      const job = await claimNextJob();
      if (job) {
        logger.info({ jobId: job.id, kind: job.kind }, "Claimed backtest job");
        await processJob(job);
      } else {
        await wait(WORKER_POLL_INTERVAL_MS);
      }
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        "Backtest worker loop failed",
      );
      await wait(WORKER_POLL_INTERVAL_MS);
    }
  }
}

const entrypointPath = process.argv[1];
const isDirectEntrypoint =
  entrypointPath != null && import.meta.url === pathToFileURL(entrypointPath).href;

if (isDirectEntrypoint) {
  const command = process.argv[2];

  if (command === "seed-benchmarks") {
    seedBenchmarks()
      .then(() => {
        logger.info("Benchmark seed complete");
        process.exit(0);
      })
      .catch((error) => {
        logger.error(
          { err: error instanceof Error ? error : new Error(String(error)) },
          "Benchmark seed failed",
        );
        process.exit(1);
      });
  } else if (command === "run-job") {
    const jobId = process.argv[3];
    if (!jobId) {
      logger.error("Missing job id for run-job command");
      process.exit(1);
    }
    claimJobById(jobId)
      .then((job) => processJob(job))
      .then(() => {
        logger.info({ jobId }, "Backtest job complete");
        process.exit(0);
      })
      .catch((error) => {
        logger.error(
          { err: error instanceof Error ? error : new Error(String(error)), jobId },
          "Backtest job command failed",
        );
        process.exit(1);
      });
  } else {
    runWorkerLoop().catch((error) => {
      logger.error(
        { err: error instanceof Error ? error : new Error(String(error)) },
        "Backtest worker crashed",
      );
      process.exit(1);
    });
  }
}
