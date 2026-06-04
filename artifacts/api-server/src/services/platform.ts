import {
  and,
  asc,
  desc,
  eq,
  inArray,
  like,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import {
  db,
  instrumentsTable,
  watchlistItemsTable,
  watchlistsTable,
} from "@workspace/db";
import { universeCatalogListingsTable } from "@workspace/db/schema";
import { HttpError, isHttpError } from "../lib/errors";
import {
  getIbkrBridgeRuntimeConfig,
  getIbkrBridgeRuntimeOverride,
  getMassiveProviderIdentity,
  getMassiveRuntimeConfig,
  getFmpRuntimeConfig,
  getIgnoredIbkrBridgeRuntimeEnvNames,
  isMassiveStocksRealtimeConfigured,
  getProviderConfiguration,
  getRuntimeMode,
} from "../lib/runtime";
import { logger } from "../lib/logger";
import {
  getApiResourcePressureSnapshot,
  isApiResourcePressureHardBlock,
  type ApiResourcePressureDriver,
  type ApiResourcePressureLevel,
  type ApiResourcePressureSnapshot,
} from "./resource-pressure";
import {
  createTransientPostgresBackoff,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import {
  getIbkrBridgeActivationDiagnostics,
  getIbkrBridgeRuntimeSessionState,
} from "./ibkr-bridge-runtime";
import { getCachedStorageHealthSnapshot } from "./storage-health";
import { normalizeSymbol } from "../lib/values";
import {
  type BrokerBarSnapshot,
  type BrokerOrderSnapshot,
  type BrokerPositionSnapshot,
  type HistoryBarTimeframe,
  type MarketDataFreshness,
  type PlaceOrderInput,
  type QuoteSnapshot,
} from "../providers/ibkr/client";
import {
  buildPositionQuoteFromSnapshot,
  choosePositionQuote,
  positionReferenceSymbol,
} from "./account-position-model";
import {
  IbkrBridgeClient,
  type BridgeOrdersResult,
} from "../providers/ibkr/bridge-client";
import {
  MassiveMarketDataClient,
  computeUnusualMetrics,
  resolvePremiumDistributionClassificationConfidence,
  type BarSnapshot as MassiveBarSnapshot,
  type MarketDataProvider,
  type OptionChainContract as MassiveOptionChainContract,
  type OptionPremiumDistribution,
  type OptionTradePrint,
  type PremiumDistributionClassificationConfidence,
  type PremiumDistributionDataAccess,
  type PremiumDistributionHydrationDiagnostics,
  type PremiumDistributionSideBasis,
  type PremiumDistributionTimeframe,
  type MassiveAggregateBarsPage,
  type QuoteSnapshot as MassiveQuoteSnapshot,
  type StockGroupedDailyAggregate,
  type UniverseTicker,
  type UniverseMarket,
} from "../providers/massive/market-data";
export type { OptionTradePrint } from "../providers/massive/market-data";
import { FmpResearchClient } from "../providers/fmp/client";
import {
  createOptionsFlowScanner,
  type OptionsFlowScannerRequest,
  type OptionsFlowScannerScanPhase,
} from "./options-flow-scanner";
import {
  deferredFlowEventsResult as buildDeferredFlowEventsResult,
  filterFlowEventsForRequest,
  flowEventMatchesFilters,
  flowEventsFilterCacheKey,
  getExpirationDte,
  flowSource as buildFlowSource,
  hasNarrowFlowFilters,
  isCacheableFlowEventsResult,
  isFlowScannerSnapshotAllowedForFallbackPolicy,
  normalizeFlowEventsFilters,
  shouldPreserveCachedFlowEvents,
  type DeferredFlowEventsResultInput,
  type FlowDataProvider,
  type FlowEventsFilters,
  type FlowEventsResult,
  type FlowEventsScope,
  type FlowEventsSource,
  type FlowSourceInput,
} from "./flow-events-model";
import {
  createFlowUniverseManager,
  getFlowScannerIntervalMs,
  isRegularTradingHours,
  type FlowUniverseCoverage,
  type FlowUniverseMode,
} from "./flow-universe";
import { createFlowUniverseOptionabilityVerifier } from "./flow-universe-optionability-verifier";
import { createFlowUniversePlanner } from "./flow-universe-planner";
import { fetchBridgeQuoteSnapshots } from "./bridge-quote-stream";
import {
  getCurrentStockMinuteAggregates,
  subscribeStockMinuteAggregates,
} from "./stock-aggregate-stream";
import { getCurrentMassiveStockQuoteSnapshots } from "./massive-stock-quote-stream";
import {
  enrichStockQuoteWithDayChangeContext,
  getSymbolsNeedingStockQuoteDayChangeContext,
  recordStockQuoteDayChangeContexts,
} from "./stock-quote-day-change-context";
import {
  fetchBridgeOptionQuoteSnapshots,
  getCurrentBridgeOptionQuoteSnapshots,
} from "./bridge-option-quote-stream";
import { recordServerDiagnosticEvent } from "./diagnostics";
import {
  getBridgeGovernorConfigSnapshot,
  getBridgeGovernorSnapshot,
  isBridgeWorkBackedOff,
  recordBridgeWorkFailure,
  runBridgeWork,
} from "./bridge-governor";
import { listIbkrExecutions } from "./ibkr-account-bridge";
import {
  clearBridgeOrderReadSuppression,
  getBridgeOrderReadSuppression,
  markBridgeOrderReadsSuppressed,
  shouldProbeBridgeOrderReadSuppression,
} from "./bridge-order-read-state";
import { resolveIbkrLaneSymbols } from "./ibkr-lane-policy";
import {
  loadStoredMarketBars,
  normalizeBarsToStoreTimeframe,
  persistMarketDataBars,
} from "./market-data-store";
import {
  getMarketDataIngestDiagnostics,
  isMarketDataIngestConfigured,
  isMarketDataIngestProviderConfigured,
  type MarketDataIngestDiagnostics,
} from "./market-data-ingest";
import { buildMarketDataWorkPlan } from "./market-data-work-planner";
import {
  listHistoricalFlowEvents,
  listRecentStoredHistoricalFlowEvents,
  normalizeHistoricalFlowSampleBucketSeconds,
  __resetHistoricalFlowEventsForTests,
  __setHistoricalFlowDirectFallbackTimeoutMsForTests,
  __setHistoricalFlowStoreDisabledForTests,
  __setHistoricalFlowStoreReadTimeoutMsForTests,
} from "./historical-flow-events";
import {
  admitMarketDataLeases,
  getMarketDataAdmissionBudget,
  getMarketDataAdmissionDiagnostics,
  getMarketDataLeasesSnapshot,
  getMarketDataPoolEffectiveLineCap,
  recordMarketDataFallback,
  releaseMarketDataLeases,
  setMarketDataAdmissionRuntimeDefaults,
  subscribeMarketDataLeaseChanges,
  type MarketDataFallbackProvider,
  type MarketDataIntent,
} from "./market-data-admission";
import {
  isIbkrHistoricalAdmissionError,
  runIbkrHistoricalRequest,
} from "./ibkr-historical-admission";
import {
  normalizeUniverseMarket,
  resolveMarketIdentityFields,
  resolveMarketIdentityMetadata,
} from "./market-identity";
import {
  getDurableOptionMetadataDiagnostics,
  loadDurableOptionChain,
  loadDurableOptionExpirations,
  persistDurableOptionChain,
} from "./option-metadata-store";
import { validateSellCallOrderIntent } from "./option-order-intent";
import {
  getAnnotatedBridgeHealthForTradingGuard,
  getBridgeHealthForSession,
  getIbkrClient,
  getRuntimeBridgeHealthState,
} from "./platform-bridge-health";
import {
  getRuntimeMarketDataDiagnostics,
  getRuntimeMassiveProviderDiagnostics,
} from "./platform-market-data-diagnostics";
import { getPythonComputeDiagnostics } from "./python-compute";
import { getSseStreamDiagnostics } from "./sse-stream-diagnostics";
export { __setIbkrBridgeClientFactoryForTests } from "./platform-bridge-health";
export type { IbkrRuntimeStreamState } from "./platform-runtime-status";
export {
  isLikelyUsEquitySession,
  resolveIbkrRuntimeStreamState as __resolveIbkrRuntimeStreamStateForTests,
  resolveIbkrRuntimeStrictReason as __resolveIbkrRuntimeStrictReasonForTests,
} from "./platform-runtime-status";
export {
  __setHistoricalFlowDirectFallbackTimeoutMsForTests,
  __setHistoricalFlowStoreDisabledForTests,
  __setHistoricalFlowStoreReadTimeoutMsForTests,
};

const BUILT_IN_WATCHLISTS = [
  {
    name: "Core",
    isDefault: true,
    items: [
      { symbol: "SPY", name: "SPDR S&P 500" },
      { symbol: "QQQ", name: "Invesco QQQ" },
      { symbol: "TQQQ", name: "ProShares UltraPro QQQ" },
      { symbol: "SQQQ", name: "ProShares UltraPro Short QQQ" },
      { symbol: "IWM", name: "iShares Russell 2000" },
      { symbol: "DIA", name: "SPDR Dow Jones Industrial Average ETF" },
      { symbol: "AAPL", name: "Apple Inc" },
      { symbol: "MSFT", name: "Microsoft Corp" },
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "TSLA", name: "Tesla Inc" },
    ],
  },
  {
    name: "Mag 7",
    isDefault: false,
    items: [
      { symbol: "AAPL", name: "Apple Inc" },
      { symbol: "MSFT", name: "Microsoft Corp" },
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "AMZN", name: "Amazon.com Inc" },
      { symbol: "META", name: "Meta Platforms Inc" },
      { symbol: "GOOGL", name: "Alphabet Inc" },
      { symbol: "TSLA", name: "Tesla Inc" },
    ],
  },
  {
    name: "Semis + AI",
    isDefault: false,
    items: [
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "AMD", name: "Advanced Micro Devices" },
      { symbol: "AVGO", name: "Broadcom Inc" },
      { symbol: "TSM", name: "Taiwan Semiconductor" },
      { symbol: "MU", name: "Micron Technology" },
      { symbol: "QCOM", name: "Qualcomm Inc" },
      { symbol: "ARM", name: "Arm Holdings" },
      { symbol: "SOXX", name: "iShares Semiconductor ETF" },
      { symbol: "SMH", name: "VanEck Semiconductor ETF" },
      { symbol: "ASML", name: "ASML Holding" },
      { symbol: "MRVL", name: "Marvell Technology" },
      { symbol: "ANET", name: "Arista Networks" },
    ],
  },
  {
    name: "Macro",
    isDefault: false,
    items: [
      {
        symbol: "VXX",
        name: "iPath Series B S&P 500 VIX Short-Term Futures ETN",
      },
      { symbol: "VIXY", name: "ProShares VIX Short-Term Futures ETF" },
      { symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF" },
      { symbol: "IEF", name: "iShares 7-10 Year Treasury Bond ETF" },
      { symbol: "UUP", name: "Invesco DB US Dollar Index Bullish Fund" },
      { symbol: "GLD", name: "SPDR Gold Shares" },
      { symbol: "USO", name: "United States Oil Fund" },
    ],
  },
  {
    name: "High Beta",
    isDefault: false,
    items: [
      { symbol: "TSLA", name: "Tesla Inc" },
      { symbol: "PLTR", name: "Palantir Technologies" },
      { symbol: "COIN", name: "Coinbase Global" },
      { symbol: "HOOD", name: "Robinhood Markets" },
      { symbol: "RBLX", name: "Roblox Corp" },
      { symbol: "RKLB", name: "Rocket Lab USA" },
      { symbol: "SMCI", name: "Super Micro Computer" },
    ],
  },
] as const;

const BUILT_IN_SYMBOLS = [
  ...new Set(
    BUILT_IN_WATCHLISTS.flatMap((watchlist) =>
      watchlist.items.map((item) => item.symbol),
    ),
  ),
];

const BUILT_IN_INSTRUMENT_NAMES = Object.fromEntries(
  BUILT_IN_WATCHLISTS.flatMap((watchlist) =>
    watchlist.items.map((item) => [item.symbol, item.name]),
  ),
);

type WatchlistMutationSymbol = {
  symbol: string;
  name?: string | null;
  market?: UniverseMarket | string | null;
  normalizedExchangeMic?: string | null;
  exchangeDisplay?: string | null;
  countryCode?: string | null;
  exchangeCountryCode?: string | null;
  sector?: string | null;
  industry?: string | null;
};

type WatchlistItemRecord = {
  id: string;
  symbol: string;
  name?: string | null;
  market: UniverseMarket | null;
  normalizedExchangeMic: string | null;
  exchangeDisplay: string | null;
  countryCode: string | null;
  exchangeCountryCode: string | null;
  sector: string | null;
  industry: string | null;
  sortOrder: number;
  addedAt: Date;
};

type WatchlistRecord = {
  id: string;
  name: string;
  isDefault: boolean;
  items: WatchlistItemRecord[];
  updatedAt: Date;
};

type WatchlistIdentityFields = {
  market: UniverseMarket | null;
  normalizedExchangeMic: string | null;
  exchangeDisplay: string | null;
  countryCode: string | null;
  exchangeCountryCode: string | null;
  sector: string | null;
  industry: string | null;
};

const WATCHLIST_IDENTITY_METADATA_KEY = "marketIdentity";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readIdentityString(value: unknown, maxLength = 160): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function compactWatchlistIdentityMetadata(
  identity: WatchlistIdentityFields,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(identity).filter(([, value]) => value != null),
  );
}

function readWatchlistIdentityMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Partial<WatchlistIdentityFields> {
  if (!isRecord(metadata)) {
    return {};
  }

  const nested = isRecord(metadata[WATCHLIST_IDENTITY_METADATA_KEY])
    ? (metadata[WATCHLIST_IDENTITY_METADATA_KEY] as Record<string, unknown>)
    : {};
  const readFromMetadata = (key: keyof WatchlistIdentityFields) =>
    nested[key] ?? metadata[key];

  return {
    market: normalizeUniverseMarket(readFromMetadata("market")) ?? undefined,
    normalizedExchangeMic:
      readIdentityString(readFromMetadata("normalizedExchangeMic"), 32) ??
      undefined,
    exchangeDisplay:
      readIdentityString(readFromMetadata("exchangeDisplay"), 80) ?? undefined,
    countryCode:
      readIdentityString(readFromMetadata("countryCode"), 8) ?? undefined,
    exchangeCountryCode:
      readIdentityString(readFromMetadata("exchangeCountryCode"), 8) ??
      undefined,
    sector: readIdentityString(readFromMetadata("sector"), 80) ?? undefined,
    industry:
      readIdentityString(readFromMetadata("industry"), 120) ?? undefined,
  };
}

function buildWatchlistIdentityFields(
  symbol: string,
  input: Partial<WatchlistMutationSymbol>,
  existing: Partial<WatchlistIdentityFields> = {},
): WatchlistIdentityFields {
  const incomingNormalizedExchangeMic = readIdentityString(
    input.normalizedExchangeMic,
    32,
  );
  const normalizedExchangeMic =
    (
      incomingNormalizedExchangeMic ??
      existing.normalizedExchangeMic ??
      null
    )?.toUpperCase() ?? null;
  const exchangeDisplay =
    readIdentityString(input.exchangeDisplay, 80) ??
    (incomingNormalizedExchangeMic
      ? normalizedExchangeMic
      : existing.exchangeDisplay) ??
    normalizedExchangeMic;
  const market =
    normalizeUniverseMarket(input.market) ?? existing.market ?? null;
  const countryCode =
    readIdentityString(input.countryCode, 8) ?? existing.countryCode ?? null;
  const exchangeCountryCode =
    readIdentityString(input.exchangeCountryCode, 8) ??
    existing.exchangeCountryCode ??
    null;
  const sector =
    readIdentityString(input.sector, 80) ?? existing.sector ?? null;
  const industry =
    readIdentityString(input.industry, 120) ?? existing.industry ?? null;
  const resolved = resolveMarketIdentityFields({
    ticker: symbol,
    market,
    normalizedExchangeMic,
    exchangeDisplay,
    countryCode,
    exchangeCountryCode,
    sector,
    industry,
  });

  return {
    market: resolved.market ?? market,
    normalizedExchangeMic,
    exchangeDisplay,
    countryCode: resolved.countryCode,
    exchangeCountryCode: resolved.exchangeCountryCode,
    sector: resolved.sector,
    industry: resolved.industry,
  };
}

function mergeInstrumentMetadata(
  metadata: Record<string, unknown> | null | undefined,
  identity: WatchlistIdentityFields,
): Record<string, unknown> {
  const base = isRecord(metadata) ? metadata : {};
  return {
    ...base,
    [WATCHLIST_IDENTITY_METADATA_KEY]:
      compactWatchlistIdentityMetadata(identity),
  };
}

async function ensureDefaultWatchlistSeeded(): Promise<void> {
  const existing = await db
    .select({ id: watchlistsTable.id })
    .from(watchlistsTable)
    .limit(1);

  if (existing.length > 0) {
    return;
  }

  await db
    .insert(instrumentsTable)
    .values(
      BUILT_IN_SYMBOLS.map((symbol) => ({
        symbol,
        assetClass: "equity" as const,
        name: BUILT_IN_INSTRUMENT_NAMES[symbol] || symbol,
      })),
    )
    .onConflictDoNothing();

  const instruments = await db
    .select({
      id: instrumentsTable.id,
      symbol: instrumentsTable.symbol,
    })
    .from(instrumentsTable)
    .where(inArray(instrumentsTable.symbol, BUILT_IN_SYMBOLS));

  const instrumentBySymbol = new Map(
    instruments.map((instrument) => [instrument.symbol, instrument]),
  );
  await db.transaction(async (tx) => {
    for (const watchlistSpec of BUILT_IN_WATCHLISTS) {
      const [watchlist] = await tx
        .insert(watchlistsTable)
        .values({
          name: watchlistSpec.name,
          isDefault: watchlistSpec.isDefault,
        })
        .returning({ id: watchlistsTable.id });

      const values = watchlistSpec.items.flatMap((item, index) => {
        const instrument = instrumentBySymbol.get(item.symbol);
        return instrument
          ? [
              {
                watchlistId: watchlist.id,
                instrumentId: instrument.id,
                sortOrder: index,
              },
            ]
          : [];
      });

      if (values.length) {
        await tx
          .insert(watchlistItemsTable)
          .values(values)
          .onConflictDoNothing();
      }
    }
  });
}

async function selectWatchlistRows(watchlistId?: string) {
  await ensureDefaultWatchlistSeeded();

  const query = db
    .select({
      watchlistId: watchlistsTable.id,
      watchlistName: watchlistsTable.name,
      isDefault: watchlistsTable.isDefault,
      watchlistUpdatedAt: watchlistsTable.updatedAt,
      itemId: watchlistItemsTable.id,
      symbol: instrumentsTable.symbol,
      instrumentName: instrumentsTable.name,
      instrumentExchange: instrumentsTable.exchange,
      instrumentMetadata: instrumentsTable.metadata,
      sortOrder: watchlistItemsTable.sortOrder,
      addedAt: watchlistItemsTable.createdAt,
    })
    .from(watchlistsTable)
    .leftJoin(
      watchlistItemsTable,
      eq(watchlistsTable.id, watchlistItemsTable.watchlistId),
    )
    .leftJoin(
      instrumentsTable,
      eq(watchlistItemsTable.instrumentId, instrumentsTable.id),
    );

  const filteredQuery = watchlistId
    ? query.where(eq(watchlistsTable.id, watchlistId))
    : query;

  return filteredQuery.orderBy(
    desc(watchlistsTable.isDefault),
    asc(watchlistsTable.name),
    asc(watchlistItemsTable.sortOrder),
  );
}

function mapWatchlistRows(
  rows: Awaited<ReturnType<typeof selectWatchlistRows>>,
) {
  const grouped = new Map<string, WatchlistRecord>();

  rows.forEach((row) => {
    const existing = grouped.get(row.watchlistId) ?? {
      id: row.watchlistId,
      name: row.watchlistName,
      isDefault: row.isDefault,
      items: [],
      updatedAt: row.watchlistUpdatedAt,
    };

    if (row.itemId && row.symbol) {
      const storedIdentity = readWatchlistIdentityMetadata(
        row.instrumentMetadata,
      );
      const identity = buildWatchlistIdentityFields(
        row.symbol,
        {
          normalizedExchangeMic:
            storedIdentity.normalizedExchangeMic ??
            row.instrumentExchange ??
            null,
          exchangeDisplay:
            storedIdentity.exchangeDisplay ?? row.instrumentExchange ?? null,
          market: storedIdentity.market,
          countryCode: storedIdentity.countryCode,
          exchangeCountryCode: storedIdentity.exchangeCountryCode,
          sector: storedIdentity.sector,
          industry: storedIdentity.industry,
        },
        storedIdentity,
      );

      existing.items.push({
        id: row.itemId,
        symbol: row.symbol,
        name: row.instrumentName ?? row.symbol,
        market: identity.market,
        normalizedExchangeMic: identity.normalizedExchangeMic,
        exchangeDisplay: identity.exchangeDisplay,
        countryCode: identity.countryCode,
        exchangeCountryCode: identity.exchangeCountryCode,
        sector: identity.sector,
        industry: identity.industry,
        sortOrder: row.sortOrder ?? 0,
        addedAt: row.addedAt ?? row.watchlistUpdatedAt,
      });
    }

    grouped.set(row.watchlistId, existing);
  });

  return {
    watchlists: Array.from(grouped.values()),
  };
}

function buildBuiltInWatchlistSnapshot(): { watchlists: WatchlistRecord[] } {
  const now = new Date();
  return {
    watchlists: BUILT_IN_WATCHLISTS.map((watchlist, watchlistIndex) => ({
      id: `built-in-${watchlist.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: watchlist.name,
      isDefault: watchlist.isDefault,
      updatedAt: now,
      items: watchlist.items.map((item, itemIndex) => ({
        id: `built-in-${watchlistIndex}-${item.symbol}`,
        symbol: item.symbol,
        name: item.name,
        market: "stocks" as UniverseMarket,
        normalizedExchangeMic: null,
        exchangeDisplay: null,
        countryCode: "US",
        exchangeCountryCode: "US",
        sector: null,
        industry: null,
        sortOrder: itemIndex,
        addedAt: now,
      })),
    })),
  };
}

export function listWatchlistsRuntimeFallback() {
  return buildBuiltInWatchlistSnapshot();
}

async function listWatchlistsFromDb() {
  return mapWatchlistRows(await selectWatchlistRows());
}

export async function listWatchlistsForDiagnostics() {
  return listWatchlistsFromDb();
}

async function getWatchlistById(
  watchlistId: string,
): Promise<WatchlistRecord | null> {
  const rows = await selectWatchlistRows(watchlistId);
  const [watchlist] = mapWatchlistRows(rows).watchlists;
  return watchlist ?? null;
}

let pendingIbkrWatchlistPrewarmSignature: string | null = null;
let pendingIbkrWatchlistPrewarmRerunReason: string | null = null;
let ibkrWatchlistPrewarmSequence = 0;
let ibkrWatchlistPrewarmRotationOffset = 0;
let liveWarmupBackgroundHoldUntil = 0;
const watchlistDbBackoff = createTransientPostgresBackoff();
const IBKR_BRIDGE_STARTUP_PREWARM_OWNER = "bridge-startup";
const IBKR_WATCHLIST_PREWARM_OWNER = "watchlist-prewarm";
const IBKR_WATCHLIST_PREWARM_FILLER_OWNER = "watchlist-prewarm-filler";
const IBKR_WATCHLIST_PREWARM_BRIDGE_RESYNC_MS = readPositiveIntegerEnv(
  "IBKR_WATCHLIST_PREWARM_BRIDGE_RESYNC_MS",
  15_000,
);
const IBKR_WATCHLIST_PREWARM_BRIDGE_RECONCILE_TIMEOUT_MS =
  readPositiveIntegerEnv(
    "IBKR_WATCHLIST_PREWARM_BRIDGE_RECONCILE_TIMEOUT_MS",
    1_500,
  );
const WATCHLIST_LIST_CACHE_TTL_MS = 5_000;
const WATCHLIST_LIST_STALE_TTL_MS = 60_000;
const WATCHLIST_LIST_PREWARM_THROTTLE_MS = 15_000;
const LIVE_WARMUP_BACKGROUND_HOLD_MS = Math.max(
  5_000,
  Number.parseInt(
    process.env["IBKR_LIVE_WARMUP_BACKGROUND_HOLD_MS"] ?? "15000",
    10,
) || 15_000,
);

type WatchlistSnapshot = Awaited<ReturnType<typeof listWatchlistsFromDb>>;

let watchlistListCache:
  | {
      value: WatchlistSnapshot;
      freshUntil: number;
      staleUntil: number;
    }
  | null = null;
let watchlistListInFlight: Promise<WatchlistSnapshot> | null = null;
let lastListWatchlistPrewarmSignature: string | null = null;
let lastListWatchlistPrewarmAt = 0;

function cacheWatchlistSnapshot(
  snapshot: WatchlistSnapshot,
  nowMs = Date.now(),
): WatchlistSnapshot {
  watchlistListCache = {
    value: snapshot,
    freshUntil: nowMs + WATCHLIST_LIST_CACHE_TTL_MS,
    staleUntil: nowMs + WATCHLIST_LIST_STALE_TTL_MS,
  };
  return snapshot;
}

function invalidateWatchlistListCache(): void {
  watchlistListCache = null;
  watchlistListInFlight = null;
}

function scheduleIbkrWatchlistPrewarmFromListRead(
  watchlists: WatchlistRecord[],
  reason: string,
  nowMs = Date.now(),
): void {
  const signature = collectWatchlistSymbols(watchlists).join(",");
  if (
    signature === lastListWatchlistPrewarmSignature &&
    nowMs - lastListWatchlistPrewarmAt < WATCHLIST_LIST_PREWARM_THROTTLE_MS
  ) {
    return;
  }
  lastListWatchlistPrewarmSignature = signature;
  lastListWatchlistPrewarmAt = nowMs;
  scheduleIbkrWatchlistPrewarm(watchlists, reason);
}

export function resolveIbkrWatchlistPrewarmSymbolLimit(
  candidateSymbolCount: number,
): number {
  const normalizedCandidateSymbolCount = Math.max(
    0,
    Math.floor(
      Number.isFinite(candidateSymbolCount) ? candidateSymbolCount : 0,
    ),
  );
  const visibleLineCap = getMarketDataAdmissionBudget().visibleLineCap;
  return Math.min(normalizedCandidateSymbolCount, visibleLineCap);
}

export function getIbkrWatchlistPrewarmDiagnostics() {
  const symbols = latestWatchlistLaneSymbols;
  const resolvedSymbols = resolveEquityLiveQuoteLaneSymbols(symbols);
  const primarySymbolLimit = resolveIbkrWatchlistPrewarmSymbolLimit(
    resolvedSymbols.admittedSymbols.length,
  );
  const primarySymbols = leaseSymbolsForOwner(IBKR_WATCHLIST_PREWARM_OWNER);
  const primarySymbolSet = new Set(primarySymbols);
  const primaryActiveSourceSymbols = symbols.filter((symbol) =>
    primarySymbolSet.has(symbol),
  );
  const primaryMissingSourceSymbols = symbols.filter(
    (symbol) => !primarySymbolSet.has(symbol),
  );
  const droppedAfterPrimarySymbolCount = Math.max(
    0,
    resolvedSymbols.admittedSymbols.length - primarySymbolLimit,
  );

  return {
    sourceSymbolCount: symbols.length,
    admittedLaneSymbolCount: resolvedSymbols.admittedSymbols.length,
    laneDroppedSymbolCount: resolvedSymbols.droppedSymbols.length,
    primarySymbolLimit,
    primaryActiveSymbolCount: primarySymbols.length,
    primaryActiveSourceSymbolCount: primaryActiveSourceSymbols.length,
    primaryMissingSourceSymbolCount: primaryMissingSourceSymbols.length,
    primaryMissingSourceSymbolSample: primaryMissingSourceSymbols.slice(0, 20),
    primaryRemainingSymbolCount: Math.max(
      0,
      primarySymbolLimit - primarySymbols.length,
    ),
    droppedAfterPrimarySymbolCount,
    fillerCandidateSymbolCount: 0,
    fillerActiveSymbolCount: 0,
    fillerEnabled: false,
    fillerConfiguredMaxSymbolCount: 0,
  };
}

function resolveEquityLiveQuoteLaneSymbols(watchlistSymbols: string[]) {
  const flowLaneSources = getOptionsFlowLaneSourceSymbols();
  return resolveIbkrLaneSymbols("equity-live-quotes", {
    "built-in": flowLaneSources.builtInSymbols,
    watchlists: watchlistSymbols,
    "flow-universe": flowLaneSources.flowUniverseSymbols,
  });
}

function collectWatchlistSymbols(watchlists: WatchlistRecord[]): string[] {
  return Array.from(
    new Set(
      watchlists.flatMap((watchlist) =>
        watchlist.items
          .map((item) => normalizeSymbol(item.symbol).toUpperCase())
          .filter(Boolean),
      ),
    ),
  );
}

function collectDefaultWatchlistSymbols(
  watchlists: WatchlistRecord[],
): string[] {
  return Array.from(
    new Set(
      watchlists
        .filter((watchlist) => watchlist.isDefault)
        .flatMap((watchlist) =>
          watchlist.items
            .map((item) => normalizeSymbol(item.symbol).toUpperCase())
            .filter(Boolean),
        ),
    ),
  ).sort();
}

let latestWatchlistLaneSymbols = collectWatchlistSymbols(
  buildBuiltInWatchlistSnapshot().watchlists,
);

function collectAccountMonitorQuoteSymbols(): string[] {
  return Array.from(
    new Set(
      getMarketDataLeasesSnapshot()
        .filter((lease) => lease.intent === "account-monitor-live")
        .map((lease) => normalizeSymbol(lease.symbol ?? "").toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
}

function collectFlowScannerPriorityLeaseSymbols(): string[] {
  const priorityIntents = new Set([
    "execution-live",
    "account-monitor-live",
    "automation-live",
    "visible-live",
  ]);
  return Array.from(
    new Set(
      getMarketDataLeasesSnapshot()
        .filter(
          (lease) =>
            priorityIntents.has(lease.intent) &&
            lease.pool !== "flow-scanner" &&
            lease.assetClass === "equity",
        )
        .map((lease) => normalizeSymbol(lease.symbol ?? "").toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
}

function buildWatchlistPrewarmLineRequests(
  symbols: string[],
  sourceSymbols: string[] = latestWatchlistLaneSymbols,
): Array<{
  assetClass: "equity";
  symbol: string;
  priorityOffset: number;
}> {
  const sourceSymbolSet = new Set(
    sourceSymbols
      .map((symbol) => normalizeSymbol(symbol).toUpperCase())
      .filter(Boolean),
  );
  return symbols
    .map((symbol) => normalizeSymbol(symbol).toUpperCase())
    .filter(Boolean)
    .map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
      priorityOffset: sourceSymbolSet.has(symbol) ? 1 : -1,
    }));
}

export function __buildWatchlistPrewarmLineRequestsForTests(
  symbols: string[],
  sourceSymbols: string[],
) {
  return buildWatchlistPrewarmLineRequests(symbols, sourceSymbols);
}

function orderWarmupSymbols(input: {
  admittedSymbols: string[];
  watchlistSymbols: string[];
  defaultSymbols: string[];
  accountSymbols: string[];
  limit: number;
  rotationOffset: number;
  advanceRotation: boolean;
}): {
  symbols: string[];
  nextRotationOffset: number;
  overflowCount: number;
} {
  const admitted = new Set(input.admittedSymbols);
  const pinned: string[] = [];
  const watchlistCandidates: string[] = [];
  const extraCandidates: string[] = [];
  const seen = new Set<string>();
  const normalize = (symbol: string) => normalizeSymbol(symbol).toUpperCase();
  const addPinned = (symbol: string, requireAdmitted: boolean) => {
    const normalized = normalizeSymbol(symbol).toUpperCase();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    if (requireAdmitted && !admitted.has(normalized)) {
      return;
    }
    seen.add(normalized);
    pinned.push(normalized);
  };
  const addCandidate = (
    target: string[],
    symbol: string,
    requireAdmitted: boolean,
  ) => {
    const normalized = normalize(symbol);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    if (requireAdmitted && !admitted.has(normalized)) {
      return;
    }
    seen.add(normalized);
    target.push(normalized);
  };

  input.defaultSymbols.forEach((symbol) => addPinned(symbol, true));
  input.watchlistSymbols.forEach((symbol) =>
    addCandidate(watchlistCandidates, symbol, true),
  );
  input.accountSymbols.forEach((symbol) =>
    addCandidate(extraCandidates, symbol, false),
  );
  input.admittedSymbols.forEach((symbol) =>
    addCandidate(extraCandidates, symbol, true),
  );

  const limit = Math.max(0, Math.floor(input.limit));
  const candidateSlots = Math.max(0, limit - pinned.length);
  const watchlistOverflowCount = Math.max(
    0,
    watchlistCandidates.length - candidateSlots,
  );
  const rotate = (symbols: string[], rotationOffset: number) =>
    symbols.length > 0
      ? [...symbols.slice(rotationOffset), ...symbols.slice(0, rotationOffset)]
      : symbols;
  let selectedCandidates: string[];
  let nextRotationOffset = Math.max(0, Math.floor(input.rotationOffset));
  if (watchlistOverflowCount > 0) {
    const rotationOffset = nextRotationOffset % watchlistCandidates.length;
    selectedCandidates = rotate(watchlistCandidates, rotationOffset).slice(
      0,
      candidateSlots,
    );
    nextRotationOffset =
      input.advanceRotation && watchlistCandidates.length > 0
        ? (rotationOffset + Math.max(1, candidateSlots)) %
          watchlistCandidates.length
        : rotationOffset;
  } else {
    const extraSlots = Math.max(0, candidateSlots - watchlistCandidates.length);
    const extraOverflowCount = Math.max(0, extraCandidates.length - extraSlots);
    const rotationOffset =
      extraCandidates.length > 0
        ? nextRotationOffset % extraCandidates.length
        : 0;
    const selectedExtras =
      extraOverflowCount > 0
        ? rotate(extraCandidates, rotationOffset).slice(0, extraSlots)
        : extraCandidates.slice(0, extraSlots);
    selectedCandidates = [...watchlistCandidates, ...selectedExtras];
    nextRotationOffset =
      input.advanceRotation &&
      extraOverflowCount > 0 &&
      extraCandidates.length > 0
        ? (rotationOffset + Math.max(1, extraSlots)) % extraCandidates.length
        : rotationOffset;
  }
  const overflowCount = Math.max(
    0,
    watchlistCandidates.length + extraCandidates.length - candidateSlots,
  );
  const symbols = [...pinned, ...selectedCandidates].slice(0, limit);

  return {
    symbols,
    nextRotationOffset,
    overflowCount,
  };
}

export function __orderWatchlistWarmupSymbolsForTests(input: {
  admittedSymbols: string[];
  watchlistSymbols: string[];
  defaultSymbols: string[];
  accountSymbols: string[];
  limit: number;
  rotationOffset?: number;
  advanceRotation?: boolean;
}) {
  return orderWarmupSymbols({
    ...input,
    rotationOffset: input.rotationOffset ?? 0,
    advanceRotation: input.advanceRotation ?? false,
  });
}

function leaseSymbolsForOwner(owner: string): string[] {
  return Array.from(
    new Set(
      getMarketDataLeasesSnapshot()
        .filter((lease) => lease.owner === owner)
        .map((lease) => normalizeSymbol(lease.symbol ?? "").toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
}

function readPrewarmBridgeGroupSymbols(
  diagnostics: unknown,
  owner: string,
): string[] {
  if (!isRecord(diagnostics) || !isRecord(diagnostics.subscriptions)) {
    return [];
  }
  const groups = diagnostics.subscriptions.prewarmGroups;
  if (!Array.isArray(groups)) {
    return [];
  }
  const group = groups.find(
    (entry) => isRecord(entry) && entry.owner === owner,
  );
  if (!isRecord(group) || !Array.isArray(group.symbols)) {
    return [];
  }
  return Array.from(
    new Set(
      group.symbols
        .map((symbol) => normalizeSymbol(String(symbol)).toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
}

export function reconcileIbkrWatchlistPrewarmFromBridgeDiagnostics(
  diagnostics: unknown,
): void {
  const primarySymbols = readPrewarmBridgeGroupSymbols(
    diagnostics,
    IBKR_WATCHLIST_PREWARM_OWNER,
  );
  const fillerSymbols = readPrewarmBridgeGroupSymbols(
    diagnostics,
    IBKR_WATCHLIST_PREWARM_FILLER_OWNER,
  );

  if (primarySymbols.length > 0) {
    admitMarketDataLeases({
      owner: IBKR_WATCHLIST_PREWARM_OWNER,
      intent: "visible-live",
      requests: buildWatchlistPrewarmLineRequests(primarySymbols),
      fallbackProvider: "cache",
    });
  }

  if (fillerSymbols.length > 0) {
    releaseMarketDataLeases(
      IBKR_WATCHLIST_PREWARM_FILLER_OWNER,
      "retired_filler_reconcile",
    );
    void syncWatchlistPrewarmBridgeGroups({
      primarySymbols,
    }).catch((error) => {
      logger.debug(
        { err: error },
        "IBKR bridge retired watchlist filler clear skipped",
      );
    });
  }
}

function reconcileIbkrWatchlistPrewarmFromBridgeSoon(reason: string): void {
  if (!getProviderConfiguration().ibkr) {
    return;
  }
  void withTimeout(
    runBridgeWork("health", () => getIbkrClient().getLaneDiagnostics(), {
      bypassBackoff: true,
      recordFailure: false,
    }),
    IBKR_WATCHLIST_PREWARM_BRIDGE_RECONCILE_TIMEOUT_MS,
    () =>
      new Error(
        `IBKR bridge prewarm reconciliation timed out after ${IBKR_WATCHLIST_PREWARM_BRIDGE_RECONCILE_TIMEOUT_MS}ms.`,
      ),
  )
    .then((diagnostics) => {
      reconcileIbkrWatchlistPrewarmFromBridgeDiagnostics(diagnostics);
    })
    .catch((error) => {
      logger.debug(
        { err: error, reason },
        "IBKR bridge watchlist prewarm reconciliation skipped",
      );
    });
}

function isLiveWarmupHoldingBackgroundWork(): boolean {
  return Date.now() < liveWarmupBackgroundHoldUntil;
}

function getLiveWarmupBackgroundHoldRemainingMs(): number {
  return Math.max(0, liveWarmupBackgroundHoldUntil - Date.now());
}

function holdOptionsFlowScannerBackgroundWork(
  durationMs = LIVE_WARMUP_BACKGROUND_HOLD_MS,
): void {
  liveWarmupBackgroundHoldUntil = Math.max(
    liveWarmupBackgroundHoldUntil,
    Date.now() + Math.max(0, durationMs),
  );
}

function getOptionsFlowScannerSchedulableLineCap(): number {
  const diagnostics = getMarketDataAdmissionDiagnostics();
  const staticLineCap =
    diagnostics.pressure.scannerStaticLineCap ??
    diagnostics.budget.flowScannerLineCap;
  const effectiveLineCap = diagnostics.pressure.scannerEffectiveLineCap ?? 0;
  return Math.max(0, Math.min(staticLineCap, effectiveLineCap));
}

function isOptionsFlowScannerResourcePressureBlocked(): boolean {
  return getOptionsFlowScannerPressureGate().hardBlocked;
}

const PRESSURE_LEVEL_RANK: Record<ApiResourcePressureLevel, number> = {
  normal: 0,
  watch: 1,
  high: 2,
  critical: 3,
};

function maxPressureDriverLevel(
  drivers: readonly ApiResourcePressureDriver[],
): ApiResourcePressureLevel {
  return drivers.reduce<ApiResourcePressureLevel>((level, driver) => {
    return PRESSURE_LEVEL_RANK[driver.level] > PRESSURE_LEVEL_RANK[level]
      ? driver.level
      : level;
  }, "normal");
}

function getOptionsFlowScannerPressureGate(
  snapshot: ApiResourcePressureSnapshot = getApiResourcePressureSnapshot(),
): {
  level: ApiResourcePressureLevel;
  globalLevel: ApiResourcePressureLevel;
  hardBlocked: boolean;
  throttled: boolean;
  drivers: ApiResourcePressureDriver[];
  ignoredDrivers: ApiResourcePressureDriver[];
} {
  const ignoredDrivers = [
    ...snapshot.drivers.filter((driver) => driver.kind === "automation"),
    ...(snapshot.scannerPressure?.drivers ?? []),
  ];
  const scannerDrivers = snapshot.drivers.filter(
    (driver) => driver.kind !== "automation",
  );
  const level = maxPressureDriverLevel(scannerDrivers);
  const hardBlocked = isApiResourcePressureHardBlock(snapshot);
  return {
    level: hardBlocked ? snapshot.level : level,
    globalLevel: snapshot.level,
    hardBlocked,
    throttled: false,
    drivers: scannerDrivers,
    ignoredDrivers,
  };
}

function releaseOptionsFlowScannerMarketDataLeases(reason: string): void {
  const owners = new Set(
    getMarketDataLeasesSnapshot()
      .filter(
        (lease) =>
          lease.ownerClass === "flow-scanner" ||
          lease.ownerClass === "flow-scanner-benchmark",
      )
      .map((lease) => lease.owner),
  );
  owners.forEach((owner) => releaseMarketDataLeases(owner, reason));
}

function enforceOptionsFlowScannerPressureControls(): string | null {
  if (!isOptionsFlowScannerResourcePressureBlocked()) {
    return null;
  }
  releaseOptionsFlowScannerMarketDataLeases("resource_pressure");
  return "resource-pressure";
}

let optionsFlowSessionBlockReason: string | null = null;
let optionsFlowSessionBlockCheckedAt = 0;

function normalizeOptionsFlowSessionBlockReason(
  reason: unknown,
): string | null {
  if (reason === "market_session_quiet") {
    return "market-session-quiet";
  }
  if (
    reason === "not_configured" ||
    reason === "ibkr_bridge_not_configured" ||
    reason === "bridge_unreachable" ||
    reason === "health_error" ||
    reason === "health_stale" ||
    reason === "gateway_socket_disconnected" ||
    reason === "gateway_server_disconnected" ||
    reason === "gateway_login_required" ||
    reason === "accounts_unavailable" ||
    reason === "live_market_data_not_configured" ||
    reason === "stream_not_fresh" ||
    reason === "quote_stream_starting" ||
    reason === "quote_stream_reconnecting" ||
    reason === "quote_stream_error"
  ) {
    return "transport-unavailable";
  }
  return null;
}

function getCachedOptionsFlowSessionBlockReason(): string | null {
  if (Date.now() - optionsFlowSessionBlockCheckedAt > 90_000) {
    return null;
  }
  return optionsFlowSessionBlockReason;
}

function effectiveOptionsFlowSessionBlockReason(
  reason: string | null,
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): string | null {
  if (reason === "market-session-quiet" && config.scannerAlwaysOn) {
    return null;
  }
  return reason;
}

async function refreshOptionsFlowSessionBlockReason(
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): Promise<string | null> {
  if (!config.scannerSessionGuardEnabled) {
    optionsFlowSessionBlockReason = null;
    optionsFlowSessionBlockCheckedAt = Date.now();
    return null;
  }

  try {
    const { annotatedHealth, fallbackStreamState, healthErrorCode } =
      await getRuntimeBridgeHealthState();
    const marketDataMode = String(
      annotatedHealth?.marketDataMode ??
        (fallbackStreamState as { marketDataMode?: unknown }).marketDataMode ??
        "",
    ).toLowerCase();
    const normalizedReason = normalizeOptionsFlowSessionBlockReason(
      annotatedHealth?.strictReason ??
        annotatedHealth?.streamStateReason ??
        healthErrorCode ??
        fallbackStreamState.streamStateReason,
    );
    const reason =
      marketDataMode === "delayed"
        ? null
        : marketDataMode === "frozen"
          ? "market-data-frozen"
          : marketDataMode === "delayed_frozen"
            ? "market-data-delayed-frozen"
            : normalizedReason;
    optionsFlowSessionBlockReason = reason;
    optionsFlowSessionBlockCheckedAt = Date.now();
    return effectiveOptionsFlowSessionBlockReason(reason, config);
  } catch (error) {
    logger.debug(
      { err: error },
      "Options flow scanner session guard check skipped",
    );
    optionsFlowSessionBlockReason = null;
    optionsFlowSessionBlockCheckedAt = Date.now();
    return null;
  }
}

function getOptionsFlowScannerBackgroundBlockReason(
  input: {
    ignoreLiveWarmup?: boolean;
    ignoreLineCapacity?: boolean;
    config?: OptionsFlowRuntimeConfig;
  } = {},
): string | null {
  const config = input.config ?? getOptionsFlowRuntimeConfig();
  if (isOptionsFlowScannerResourcePressureBlocked()) {
    return "resource-pressure";
  }
  if (!input.ignoreLiveWarmup && isLiveWarmupHoldingBackgroundWork()) {
    return "live-warmup";
  }
  const sessionBlockReason = effectiveOptionsFlowSessionBlockReason(
    getCachedOptionsFlowSessionBlockReason(),
    config,
  );
  if (sessionBlockReason) {
    return sessionBlockReason;
  }
  if (!input.ignoreLineCapacity) {
    if (getOptionsFlowScannerSchedulableLineCap() <= 0) {
      return "line-cap-exhausted";
    }
  }
  return null;
}

type BridgePrewarmSyncState = {
  signature: string | null;
  syncedAt: number;
};

type WatchlistPrewarmBridgeHealth = Pick<
  NonNullable<Awaited<ReturnType<typeof getBridgeHealthForSession>>>,
  "strictReady" | "strictReason" | "streamStateReason"
>;

const lastBridgePrimaryPrewarmSync: BridgePrewarmSyncState = {
  signature: null,
  syncedAt: 0,
};
const lastBridgeFillerPrewarmSync: BridgePrewarmSyncState = {
  signature: null,
  syncedAt: 0,
};
const lastBridgeStartupPrewarmClearSync: BridgePrewarmSyncState = {
  signature: null,
  syncedAt: 0,
};

function shouldSyncBridgePrewarmGroup(
  signature: string,
  state: BridgePrewarmSyncState,
  now = Date.now(),
): boolean {
  return (
    signature !== state.signature ||
    now - state.syncedAt >= IBKR_WATCHLIST_PREWARM_BRIDGE_RESYNC_MS
  );
}

function isBridgeWorkBackoffError(error: unknown): boolean {
  return isHttpError(error) && error.code === "ibkr_bridge_work_backoff";
}

function getWatchlistPrewarmBridgeSyncBlockReason(
  health: WatchlistPrewarmBridgeHealth | null | undefined,
  quotesBackedOff = isBridgeWorkBackedOff("quotes"),
): string | null {
  if (quotesBackedOff) {
    return "quotes_backoff";
  }
  if (!health?.strictReady) {
    const reason = health?.strictReason ?? health?.streamStateReason;
    if (reason === "market_session_quiet") {
      return null;
    }
    return typeof reason === "string" && reason ? reason : "health_unavailable";
  }
  return null;
}

export function __getWatchlistPrewarmBridgeSyncBlockReasonForTests(
  health: Partial<WatchlistPrewarmBridgeHealth> | null | undefined,
  quotesBackedOff = false,
): string | null {
  return getWatchlistPrewarmBridgeSyncBlockReason(
    health as WatchlistPrewarmBridgeHealth | null | undefined,
    quotesBackedOff,
  );
}

async function syncWatchlistPrewarmBridgeGroups(input: {
  primarySymbols: string[];
}): Promise<void> {
  const groups = [
    {
      owner: IBKR_BRIDGE_STARTUP_PREWARM_OWNER,
      symbols: [],
      state: lastBridgeStartupPrewarmClearSync,
    },
    {
      owner: IBKR_WATCHLIST_PREWARM_OWNER,
      symbols: input.primarySymbols,
      state: lastBridgePrimaryPrewarmSync,
    },
    {
      owner: IBKR_WATCHLIST_PREWARM_FILLER_OWNER,
      symbols: [],
      state: lastBridgeFillerPrewarmSync,
    },
  ];
  const now = Date.now();
  const health = await getBridgeHealthForSession();
  const blockReason = getWatchlistPrewarmBridgeSyncBlockReason(health);
  if (blockReason) {
    logger.debug(
      {
        blockReason,
        primarySymbolCount: input.primarySymbols.length,
      },
      "IBKR bridge watchlist prewarm sync skipped",
    );
    return;
  }

  await Promise.all(
    groups.map(async (group) => {
      const signature = group.symbols.join(",");
      if (!shouldSyncBridgePrewarmGroup(signature, group.state, now)) {
        return;
      }
      if (isBridgeWorkBackedOff("quotes")) {
        logger.debug(
          {
            blockReason: "quotes_backoff",
            owner: group.owner,
            symbolCount: group.symbols.length,
          },
          "IBKR bridge watchlist prewarm sync skipped",
        );
        return;
      }
      const client = getIbkrClient();
      if (typeof client.prewarmQuoteSubscriptions !== "function") {
        return;
      }
      try {
        await runBridgeWork(
          "quotes",
          () => client.prewarmQuoteSubscriptions(group.symbols, group.owner),
          { recordFailure: false },
        );
      } catch (error) {
        if (isBridgeWorkBackoffError(error)) {
          logger.debug(
            {
              err: error,
              owner: group.owner,
              symbolCount: group.symbols.length,
            },
            "IBKR bridge watchlist prewarm sync skipped",
          );
          return;
        }
        throw error;
      }
      group.state.signature = signature;
      group.state.syncedAt = Date.now();
    }),
  );
}

function scheduleIbkrWatchlistPrewarm(
  watchlists: WatchlistRecord[],
  reason: string,
) {
  if (
    !getProviderConfiguration().ibkr ||
    isBridgeWorkBackedOff("health") ||
    isBridgeWorkBackedOff("quotes")
  ) {
    return;
  }

  const symbols = collectWatchlistSymbols(watchlists);
  latestWatchlistLaneSymbols = symbols;
  if (isMassiveStocksRealtimeConfigured()) {
    ibkrWatchlistPrewarmSequence += 1;
    pendingIbkrWatchlistPrewarmSignature = null;
    pendingIbkrWatchlistPrewarmRerunReason = null;
    releaseMarketDataLeases(
      IBKR_WATCHLIST_PREWARM_OWNER,
      "massive_stock_primary",
    );
    releaseMarketDataLeases(
      IBKR_WATCHLIST_PREWARM_FILLER_OWNER,
      "massive_stock_primary",
    );
    void syncWatchlistPrewarmBridgeGroups({
      primarySymbols: [],
    }).catch((error) => {
      logger.warn(
        { err: error, reason },
        "IBKR bridge prewarm clear failed while Massive stocks are primary",
      );
    });
    logger.debug(
      { reason, symbolCount: symbols.length },
      "IBKR bridge watchlist prewarm disabled while Massive stocks are primary",
    );
    return;
  }
  const resourcePressure = getApiResourcePressureSnapshot();
  if (resourcePressure.caps.signalOptions.watchlistPrewarmAllowed === false) {
    ibkrWatchlistPrewarmSequence += 1;
    pendingIbkrWatchlistPrewarmSignature = null;
    pendingIbkrWatchlistPrewarmRerunReason = null;
    releaseMarketDataLeases(IBKR_WATCHLIST_PREWARM_OWNER, "resource_pressure");
    releaseMarketDataLeases(
      IBKR_WATCHLIST_PREWARM_FILLER_OWNER,
      "resource_pressure",
    );
    void syncWatchlistPrewarmBridgeGroups({
      primarySymbols: [],
    }).catch((error) => {
      logger.warn(
        { err: error, reason, pressureLevel: resourcePressure.level },
        "IBKR bridge prewarm clear failed under resource pressure",
      );
    });
    logger.debug(
      { reason, pressureLevel: resourcePressure.level },
      "IBKR bridge watchlist prewarm deferred under resource pressure",
    );
    return;
  }

  const defaultSymbols = collectDefaultWatchlistSymbols(watchlists);
  const accountSymbols = collectAccountMonitorQuoteSymbols();
  const resolvedSymbols = resolveEquityLiveQuoteLaneSymbols(symbols);
  const warmupLimit = resolveIbkrWatchlistPrewarmSymbolLimit(
    resolvedSymbols.admittedSymbols.length,
  );
  const orderedWarmup = orderWarmupSymbols({
    admittedSymbols: resolvedSymbols.admittedSymbols,
    watchlistSymbols: symbols,
    defaultSymbols,
    accountSymbols,
    limit: warmupLimit,
    rotationOffset: ibkrWatchlistPrewarmRotationOffset,
    advanceRotation: reason.includes("runtime-resync"),
  });
  ibkrWatchlistPrewarmRotationOffset = orderedWarmup.nextRotationOffset;
  const warmupSymbols = orderedWarmup.symbols;
  const cappedWarmupSymbols = warmupSymbols.slice(0, warmupLimit);
  const prewarmDroppedSymbols = warmupSymbols.slice(warmupLimit);
  const requestedSignature = cappedWarmupSymbols.join(",");
  if (!requestedSignature) {
    ibkrWatchlistPrewarmSequence += 1;
    pendingIbkrWatchlistPrewarmSignature = null;
    pendingIbkrWatchlistPrewarmRerunReason = null;
    releaseMarketDataLeases(IBKR_WATCHLIST_PREWARM_OWNER, "prewarm_empty");
    releaseMarketDataLeases(
      IBKR_WATCHLIST_PREWARM_FILLER_OWNER,
      "retired_filler_clear",
    );
    void syncWatchlistPrewarmBridgeGroups({
      primarySymbols: [],
    }).catch((error) => {
      logger.warn({ err: error, reason }, "IBKR bridge prewarm clear failed");
    });
    return;
  }

  if (requestedSignature === pendingIbkrWatchlistPrewarmSignature) {
    pendingIbkrWatchlistPrewarmRerunReason = reason;
    return;
  }

  const sequence = ibkrWatchlistPrewarmSequence + 1;
  ibkrWatchlistPrewarmSequence = sequence;
  pendingIbkrWatchlistPrewarmSignature = requestedSignature;

  void getBridgeHealthForSession()
    .then((health) => {
      if (sequence !== ibkrWatchlistPrewarmSequence) {
        return;
      }
      const healthBlockReason = getWatchlistPrewarmBridgeSyncBlockReason(
        health,
        false,
      );
      if (healthBlockReason) {
        logger.debug(
          {
            reason,
            strictReason: healthBlockReason,
          },
          "IBKR bridge watchlist prewarm skipped until Gateway is ready",
        );
        return;
      }

      const primaryAdmission = admitMarketDataLeases({
        owner: IBKR_WATCHLIST_PREWARM_OWNER,
        intent: "visible-live",
        requests: buildWatchlistPrewarmLineRequests(
          cappedWarmupSymbols,
          symbols,
        ),
        fallbackProvider: "cache",
      });
      const admittedSymbols = primaryAdmission.admitted
        .map((lease) => lease.symbol)
        .filter((symbol): symbol is string => Boolean(symbol));
      if (!admittedSymbols.length) {
        releaseMarketDataLeases(IBKR_WATCHLIST_PREWARM_OWNER, "prewarm_empty");
        releaseMarketDataLeases(
          IBKR_WATCHLIST_PREWARM_FILLER_OWNER,
          "retired_filler_clear",
        );
        return syncWatchlistPrewarmBridgeGroups({
          primarySymbols: [],
        });
      }
      releaseMarketDataLeases(
        IBKR_WATCHLIST_PREWARM_FILLER_OWNER,
        "retired_filler_clear",
      );

      const primarySymbols = leaseSymbolsForOwner(IBKR_WATCHLIST_PREWARM_OWNER);

      return syncWatchlistPrewarmBridgeGroups({
        primarySymbols,
      }).then(() => {
        if (sequence !== ibkrWatchlistPrewarmSequence) {
          return;
        }

        logger.info(
          {
            symbols: primarySymbols,
            accountSymbols,
            defaultSymbols,
            droppedSymbols: [
              ...resolvedSymbols.droppedSymbols,
              ...prewarmDroppedSymbols,
            ],
            prewarmLimit: warmupLimit,
            reason,
          },
          "IBKR bridge watchlist prewarm synced",
        );
      });
    })
    .catch((error) => {
      if (sequence === ibkrWatchlistPrewarmSequence) {
        releaseMarketDataLeases(IBKR_WATCHLIST_PREWARM_OWNER, "prewarm_failed");
        releaseMarketDataLeases(
          IBKR_WATCHLIST_PREWARM_FILLER_OWNER,
          "retired_filler_clear",
        );
      }
      logger.warn(
        { err: error, symbols: cappedWarmupSymbols, reason },
        "IBKR bridge watchlist prewarm failed",
      );
    })
    .finally(() => {
      if (sequence === ibkrWatchlistPrewarmSequence) {
        pendingIbkrWatchlistPrewarmSignature = null;
        const rerunReason = pendingIbkrWatchlistPrewarmRerunReason;
        pendingIbkrWatchlistPrewarmRerunReason = null;
        if (rerunReason) {
          scheduleIbkrWatchlistPrewarm(
            watchlists,
            `${rerunReason}-after-pending`,
          );
        }
      }
    });
}

export function __holdOptionsFlowScannerBackgroundForTests(
  durationMs = LIVE_WARMUP_BACKGROUND_HOLD_MS,
): void {
  holdOptionsFlowScannerBackgroundWork(durationMs);
}

export function __clearOptionsFlowScannerBackgroundHoldForTests(): void {
  liveWarmupBackgroundHoldUntil = 0;
}

function scheduleIbkrWatchlistPrewarmFromDb(reason: string) {
  if (!getProviderConfiguration().ibkr) {
    return;
  }

  void listWatchlistsFromDb()
    .then((snapshot) =>
      scheduleIbkrWatchlistPrewarm(snapshot.watchlists, reason),
    )
    .catch((error) => {
      logger.warn(
        { err: error, reason },
        "IBKR bridge watchlist prewarm snapshot failed",
      );
    });
}

let ibkrWatchlistPrewarmResyncTimer: NodeJS.Timeout | null = null;
let ibkrWatchlistPrewarmRuntimeTimer: NodeJS.Timeout | null = null;

function scheduleIbkrWatchlistPrewarmFromDbSoon(reason: string): void {
  if (!getProviderConfiguration().ibkr || ibkrWatchlistPrewarmResyncTimer) {
    return;
  }
  ibkrWatchlistPrewarmResyncTimer = setTimeout(() => {
    ibkrWatchlistPrewarmResyncTimer = null;
    scheduleIbkrWatchlistPrewarmFromDb(reason);
  }, 1_000);
  ibkrWatchlistPrewarmResyncTimer.unref?.();
}

export function startIbkrWatchlistPrewarmRuntime(): void {
  if (ibkrWatchlistPrewarmRuntimeTimer) {
    return;
  }
  reconcileIbkrWatchlistPrewarmFromBridgeSoon("startup");
  scheduleIbkrWatchlistPrewarmFromDbSoon("startup");
  ibkrWatchlistPrewarmRuntimeTimer = setInterval(() => {
    reconcileIbkrWatchlistPrewarmFromBridgeSoon("runtime-resync");
    scheduleIbkrWatchlistPrewarmFromDbSoon("runtime-resync");
  }, IBKR_WATCHLIST_PREWARM_BRIDGE_RESYNC_MS);
  ibkrWatchlistPrewarmRuntimeTimer.unref?.();
}

subscribeMarketDataLeaseChanges((event) => {
  if (!["released", "demoted", "expired"].includes(event.action)) {
    return;
  }
  scheduleIbkrWatchlistPrewarmFromDbSoon(`lease_${event.action}`);
});

async function ensureInstrumentForSymbol({
  symbol,
  name,
  ...identityInput
}: WatchlistMutationSymbol) {
  const normalized = normalizeSymbol(symbol).toUpperCase();
  if (!normalized) {
    throw new HttpError(400, "Symbol is required.", {
      code: "watchlist_symbol_required",
    });
  }

  const existing = await db
    .select({
      id: instrumentsTable.id,
      symbol: instrumentsTable.symbol,
      exchange: instrumentsTable.exchange,
      metadata: instrumentsTable.metadata,
    })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, normalized))
    .limit(1);

  if (existing[0]) {
    const storedMetadataIdentity = readWatchlistIdentityMetadata(
      existing[0].metadata,
    );
    const storedIdentity = {
      ...storedMetadataIdentity,
      normalizedExchangeMic:
        storedMetadataIdentity.normalizedExchangeMic ??
        existing[0].exchange ??
        undefined,
      exchangeDisplay:
        storedMetadataIdentity.exchangeDisplay ??
        existing[0].exchange ??
        undefined,
    };
    const identity = buildWatchlistIdentityFields(
      normalized,
      identityInput,
      storedIdentity,
    );
    await db
      .update(instrumentsTable)
      .set({
        exchange: identity.normalizedExchangeMic ?? identity.exchangeDisplay,
        metadata: mergeInstrumentMetadata(existing[0].metadata, identity),
      })
      .where(eq(instrumentsTable.id, existing[0].id));

    return {
      id: existing[0].id,
      symbol: existing[0].symbol,
    };
  }

  const identity = buildWatchlistIdentityFields(normalized, identityInput);
  const [created] = await db
    .insert(instrumentsTable)
    .values({
      symbol: normalized,
      assetClass: "equity",
      name: name?.trim() || BUILT_IN_INSTRUMENT_NAMES[normalized] || normalized,
      exchange: identity.normalizedExchangeMic ?? identity.exchangeDisplay,
      metadata: mergeInstrumentMetadata(null, identity),
    })
    .onConflictDoNothing()
    .returning({
      id: instrumentsTable.id,
      symbol: instrumentsTable.symbol,
    });

  if (created) {
    return created;
  }

  const fallback = await db
    .select({
      id: instrumentsTable.id,
      symbol: instrumentsTable.symbol,
      metadata: instrumentsTable.metadata,
    })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, normalized))
    .limit(1);

  if (!fallback[0]) {
    throw new HttpError(500, "Unable to create instrument.", {
      code: "watchlist_instrument_unavailable",
    });
  }

  await db
    .update(instrumentsTable)
    .set({
      exchange: identity.normalizedExchangeMic ?? identity.exchangeDisplay,
      metadata: mergeInstrumentMetadata(fallback[0].metadata, identity),
    })
    .where(eq(instrumentsTable.id, fallback[0].id));

  return {
    id: fallback[0].id,
    symbol: fallback[0].symbol,
  };
}

async function rebalanceWatchlistSortOrder(watchlistId: string) {
  const items = await db
    .select({
      id: watchlistItemsTable.id,
    })
    .from(watchlistItemsTable)
    .where(eq(watchlistItemsTable.watchlistId, watchlistId))
    .orderBy(
      asc(watchlistItemsTable.sortOrder),
      asc(watchlistItemsTable.createdAt),
    );

  await Promise.all(
    items.map((item, index) =>
      db
        .update(watchlistItemsTable)
        .set({ sortOrder: index })
        .where(eq(watchlistItemsTable.id, item.id)),
    ),
  );
}

async function setDefaultWatchlistIfNeeded(watchlistId: string) {
  await db.update(watchlistsTable).set({ isDefault: false });
  await db
    .update(watchlistsTable)
    .set({ isDefault: true })
    .where(eq(watchlistsTable.id, watchlistId));
}

type MassiveMarketDataClientFactory = (
  config: NonNullable<ReturnType<typeof getMassiveRuntimeConfig>>,
) => MassiveMarketDataClient;

let massiveMarketDataClientFactory: MassiveMarketDataClientFactory | null =
  null;

function getMassiveClient(): MassiveMarketDataClient {
  const config = getMassiveRuntimeConfig();

  if (!config) {
    throw new HttpError(503, "Massive market data is not configured.", {
      code: "massive_not_configured",
      detail: "Set one of MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY.",
    });
  }

  return (
    massiveMarketDataClientFactory?.(config) ??
    new MassiveMarketDataClient(config)
  );
}

export function __setMassiveMarketDataClientFactoryForTests(
  factory: MassiveMarketDataClientFactory | null,
): void {
  massiveMarketDataClientFactory = factory;
}

function getMarketDataConnectionName() {
  const config = getMassiveRuntimeConfig();
  return getMassiveProviderIdentity(config) === "massive"
    ? "Massive Market Data"
    : "Massive Market Data";
}

function getMarketDataConnectionCapabilities(): string[] {
  const config = getMassiveRuntimeConfig();
  if (getMassiveProviderIdentity(config) === "massive") {
    return isMassiveStocksRealtimeConfigured(config)
      ? ["quotes", "bars", "historical-bars", "stock-stream", "ticker-search"]
      : ["historical-bars", "delayed-bars", "stock-stream", "ticker-search"];
  }

  return ["quotes", "bars", "options-chain", "stock-stream", "options-flow"];
}

const FLOW_EVENTS_CACHE_TTL_MS = 60_000;
const FLOW_EVENTS_CACHE_STALE_TTL_MS = 5 * 60_000;
const OPTIONS_FLOW_SCANNER_SNAPSHOT_STALE_TTL_MS = readPositiveIntegerEnv(
  "OPTIONS_FLOW_SCANNER_SNAPSHOT_STALE_TTL_MS",
  30 * 60_000,
);
const OPTIONS_FLOW_AGGREGATE_MIN_SNAPSHOT_SYMBOLS = readPositiveIntegerEnv(
  "OPTIONS_FLOW_AGGREGATE_MIN_SNAPSHOT_SYMBOLS",
  8,
);
const OPTIONS_FLOW_AGGREGATE_SEED_BATCH_SIZE = readPositiveIntegerEnv(
  "OPTIONS_FLOW_AGGREGATE_SEED_BATCH_SIZE",
  Math.min(2, OPTIONS_FLOW_AGGREGATE_MIN_SNAPSHOT_SYMBOLS),
);
const OPTIONS_FLOW_COVERAGE_ACTIVE_TARGET_MS = readPositiveIntegerEnv(
  "OPTIONS_FLOW_COVERAGE_ACTIVE_TARGET_MS",
  5 * 60_000,
);
const HISTORICAL_FLOW_TIMEOUT_COOLDOWN_MS = 30_000;
const HISTORICAL_FLOW_REFRESHING_REASON = "options_flow_historical_refreshing";
const HISTORICAL_FLOW_PROVIDER_TIMEOUT_REASON =
  "options_flow_historical_provider_timeout";
const FLOW_PREMIUM_DISTRIBUTION_CACHE_TTL_MS = 45_000;
const FLOW_PREMIUM_DISTRIBUTION_STALE_TTL_MS = 10 * 60_000;
const FLOW_PREMIUM_DISTRIBUTION_DEFAULT_LIMIT = 10;
const FLOW_PREMIUM_DISTRIBUTION_MAX_LIMIT = 16;
const FLOW_PREMIUM_DISTRIBUTION_CANDIDATE_LIMIT = 24;
const FLOW_PREMIUM_DISTRIBUTION_MAX_CANDIDATES = 60;
const FLOW_PREMIUM_DISTRIBUTION_CONCURRENCY = 4;
const FLOW_PREMIUM_DISTRIBUTION_CANDIDATE_TIMEOUT_MS = readPositiveIntegerEnv(
  "FLOW_PREMIUM_DISTRIBUTION_CANDIDATE_TIMEOUT_MS",
  60_000,
);
const FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_CANDIDATES = readPositiveIntegerEnv(
  "FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_CANDIDATES",
  10,
);
const FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_TIMEOUT_MS = readPositiveIntegerEnv(
  "FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_TIMEOUT_MS",
  5_000,
);
const FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_MAX_PAGES = readPositiveIntegerEnv(
  "FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_MAX_PAGES",
  2,
);
const FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_TRADE_CONTRACT_LIMIT =
  readPositiveIntegerEnv(
    "FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_TRADE_CONTRACT_LIMIT",
    8,
  );
const FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_CLASSIFICATION_TARGET =
  readUnitIntervalEnv(
    "FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_CLASSIFICATION_TARGET",
    0.25,
  );
const FLOW_PREMIUM_DISTRIBUTION_DEEP_CANDIDATE_TIMEOUT_MS =
  readPositiveIntegerEnv(
    "FLOW_PREMIUM_DISTRIBUTION_DEEP_CANDIDATE_TIMEOUT_MS",
    Math.max(FLOW_PREMIUM_DISTRIBUTION_CANDIDATE_TIMEOUT_MS, 300_000),
  );
const FLOW_PREMIUM_DISTRIBUTION_MAX_PAGES = readPositiveIntegerEnv(
  "FLOW_PREMIUM_DISTRIBUTION_MAX_PAGES",
  20,
);
const FLOW_PREMIUM_DISTRIBUTION_UNIVERSE_MAX_SYMBOLS = readPositiveIntegerEnv(
  "FLOW_PREMIUM_DISTRIBUTION_UNIVERSE_MAX_SYMBOLS",
  500,
);
const FLOW_PREMIUM_DISTRIBUTION_BASE_TRADE_CONTRACT_LIMIT =
  readPositiveIntegerEnv(
    "FLOW_PREMIUM_DISTRIBUTION_BASE_TRADE_CONTRACT_LIMIT",
    60,
  );
const FLOW_PREMIUM_DISTRIBUTION_TRADE_CONTRACT_LIMIT = readPositiveIntegerEnv(
  "FLOW_PREMIUM_DISTRIBUTION_TRADE_CONTRACT_LIMIT",
  800,
);
const FLOW_PREMIUM_DISTRIBUTION_CLASSIFICATION_TARGET = readUnitIntervalEnv(
  "FLOW_PREMIUM_DISTRIBUTION_CLASSIFICATION_TARGET",
  0.9,
);
const FLOW_PREMIUM_DISTRIBUTION_TRADE_LIMIT = readPositiveIntegerEnv(
  "FLOW_PREMIUM_DISTRIBUTION_TRADE_LIMIT",
  50_000,
);
const FLOW_EVENTS_ON_DEMAND_MAX_ACTIVE = readPositiveIntegerEnv(
  "FLOW_EVENTS_ON_DEMAND_MAX_ACTIVE",
  1,
);
const flowEventsCache = new Map<
  string,
  { value: FlowEventsResult; expiresAt: number; staleExpiresAt: number }
>();
const flowEventsInFlight = new Map<string, Promise<FlowEventsResult>>();
const historicalFlowCooldowns = new Map<
  string,
  { value: FlowEventsResult; expiresAt: number }
>();
let lastHistoricalFlowCooldownPruneMs = 0;
let flowEventsOnDemandActive = 0;

export type FlowPremiumDistributionStatus =
  | "ok"
  | "empty"
  | "degraded"
  | "unconfigured";
export type FlowPremiumDistributionCoverageMode = "universe" | "ranked";
export type FlowPremiumDistributionHydrationStatus =
  | "complete"
  | "partial"
  | "refreshing"
  | "failed";

export type FlowPremiumDistributionResponse = {
  status: FlowPremiumDistributionStatus;
  asOf: Date;
  timeframe: PremiumDistributionTimeframe;
  source: {
    provider: "massive";
    label: string;
    timeframe: PremiumDistributionTimeframe;
    providerHost: string | null;
    sideBasis: PremiumDistributionSideBasis;
    quoteAccess: PremiumDistributionDataAccess;
    tradeAccess: PremiumDistributionDataAccess;
    classifiedPremium: number;
    classificationCoverage: number;
    classificationConfidence: PremiumDistributionClassificationConfidence;
    coverageMode: FlowPremiumDistributionCoverageMode;
    hydrationStatus: FlowPremiumDistributionHydrationStatus;
    hydrationWarning: string | null;
    hydratedSymbolCount: number;
    hydrationDiagnostics: PremiumDistributionHydrationDiagnostics;
    candidateDate: string | null;
    candidateCount: number;
    rankedCount: number;
    errorCount: number;
    errorMessage: string | null;
    cache: "fresh" | "stale" | "miss";
  };
  widgets: Array<OptionPremiumDistribution & { rank: number }>;
};

const flowPremiumDistributionCache = new Map<
  string,
  {
    value: FlowPremiumDistributionResponse;
    expiresAt: number;
    staleExpiresAt: number;
  }
>();
const flowPremiumDistributionInFlight = new Map<
  string,
  Promise<FlowPremiumDistributionResponse>
>();
const flowPremiumDistributionDeepRefreshInFlight = new Map<
  string,
  Promise<void>
>();

function pruneFlowPremiumDistributionCache(now: number): void {
  for (const [key, entry] of flowPremiumDistributionCache) {
    if (entry.staleExpiresAt <= now) {
      flowPremiumDistributionCache.delete(key);
    }
  }
}

function getMassiveProviderHost(): string | null {
  const config = getMassiveRuntimeConfig();
  if (!config) return null;

  try {
    return new URL(config.baseUrl).host;
  } catch {
    return config.baseUrl;
  }
}

function combinePremiumDistributionAccess(
  widgets: Array<OptionPremiumDistribution & { rank: number }>,
  key: "quoteAccess" | "tradeAccess",
): PremiumDistributionDataAccess {
  const values = new Set(widgets.map((widget) => widget[key]));
  if (values.has("available")) return "available";
  if (values.has("forbidden")) return "forbidden";
  if (values.has("unavailable")) return "unavailable";
  return "unknown";
}

function combinePremiumDistributionSideBasis(
  widgets: Array<OptionPremiumDistribution & { rank: number }>,
): PremiumDistributionSideBasis {
  const values = new Set(widgets.map((widget) => widget.sideBasis));
  if (values.has("mixed")) return "mixed";
  if (values.has("quote_match") && values.has("tick_test")) return "mixed";
  if (values.has("quote_match")) return "quote_match";
  if (values.has("tick_test")) return "tick_test";
  return "none";
}

function emptyFlowPremiumHydrationDiagnostics(): PremiumDistributionHydrationDiagnostics {
  return {
    snapshotCount: 0,
    usablePremiumSnapshotCount: 0,
    usablePremiumTotal: 0,
    selectedPremiumTotal: 0,
    classificationTargetPremiumCoverage: 0,
    selectedPremiumCoverage: 0,
    pageCount: 0,
    snapshotTradingDate: null,
    tradeLookbackStartDate: null,
    quoteProbeDate: null,
    quoteProbeStatus: "not_attempted",
    quoteProbeMessage: null,
    tradeContractCandidateCount: 0,
    tradeContractHydratedCount: 0,
    tradeCallAttemptCount: 0,
    tradeCallSuccessCount: 0,
    tradeCallErrorCount: 0,
    tradeCallForbiddenCount: 0,
    eligibleTradeCount: 0,
    ineligibleTradeCount: 0,
    unknownConditionTradeCount: 0,
    conditionCodes: [],
    exchangeCodes: [],
    classifiedContractCoverage: 0,
  };
}

function combinePremiumHydrationDiagnostics(
  widgets: Array<OptionPremiumDistribution & { rank: number }>,
): PremiumDistributionHydrationDiagnostics {
  const combined = emptyFlowPremiumHydrationDiagnostics();
  const conditionCodes = new Set<string>();
  const exchangeCodes = new Set<string>();
  let latestSnapshotTradingDate: string | null = null;
  let earliestTradeLookbackStartDate: string | null = null;
  let earliestQuoteProbeDate: string | null = null;
  let quoteProbeStatus: PremiumDistributionHydrationDiagnostics["quoteProbeStatus"] =
    "not_attempted";
  let quoteProbeMessage: string | null = null;

  widgets.forEach((widget) => {
    const diagnostics = widget.hydrationDiagnostics;
    combined.snapshotCount += diagnostics.snapshotCount;
    combined.usablePremiumSnapshotCount +=
      diagnostics.usablePremiumSnapshotCount;
    combined.usablePremiumTotal += diagnostics.usablePremiumTotal;
    combined.selectedPremiumTotal += diagnostics.selectedPremiumTotal;
    combined.classificationTargetPremiumCoverage = Math.max(
      combined.classificationTargetPremiumCoverage,
      diagnostics.classificationTargetPremiumCoverage,
    );
    combined.pageCount += diagnostics.pageCount;
    combined.tradeContractCandidateCount +=
      diagnostics.tradeContractCandidateCount;
    combined.tradeContractHydratedCount +=
      diagnostics.tradeContractHydratedCount;
    combined.tradeCallAttemptCount += diagnostics.tradeCallAttemptCount;
    combined.tradeCallSuccessCount += diagnostics.tradeCallSuccessCount;
    combined.tradeCallErrorCount += diagnostics.tradeCallErrorCount;
    combined.tradeCallForbiddenCount += diagnostics.tradeCallForbiddenCount;
    combined.eligibleTradeCount += diagnostics.eligibleTradeCount;
    combined.ineligibleTradeCount += diagnostics.ineligibleTradeCount;
    combined.unknownConditionTradeCount +=
      diagnostics.unknownConditionTradeCount;
    diagnostics.conditionCodes.forEach((code) => conditionCodes.add(code));
    diagnostics.exchangeCodes.forEach((code) => exchangeCodes.add(code));
    if (
      diagnostics.snapshotTradingDate &&
      (!latestSnapshotTradingDate ||
        diagnostics.snapshotTradingDate > latestSnapshotTradingDate)
    ) {
      latestSnapshotTradingDate = diagnostics.snapshotTradingDate;
    }
    if (
      diagnostics.tradeLookbackStartDate &&
      (!earliestTradeLookbackStartDate ||
        diagnostics.tradeLookbackStartDate < earliestTradeLookbackStartDate)
    ) {
      earliestTradeLookbackStartDate = diagnostics.tradeLookbackStartDate;
    }
    if (
      diagnostics.quoteProbeDate &&
      (!earliestQuoteProbeDate ||
        diagnostics.quoteProbeDate < earliestQuoteProbeDate)
    ) {
      earliestQuoteProbeDate = diagnostics.quoteProbeDate;
    }
    if (diagnostics.quoteProbeStatus === "forbidden") {
      quoteProbeStatus = "forbidden";
      quoteProbeMessage = quoteProbeMessage ?? diagnostics.quoteProbeMessage;
    } else if (
      quoteProbeStatus !== "forbidden" &&
      diagnostics.quoteProbeStatus === "available"
    ) {
      quoteProbeStatus = "available";
    } else if (
      quoteProbeStatus === "not_attempted" &&
      diagnostics.quoteProbeStatus !== "not_attempted"
    ) {
      quoteProbeStatus = diagnostics.quoteProbeStatus;
      quoteProbeMessage = quoteProbeMessage ?? diagnostics.quoteProbeMessage;
    }
  });

  combined.snapshotTradingDate = latestSnapshotTradingDate;
  combined.tradeLookbackStartDate = earliestTradeLookbackStartDate;
  combined.quoteProbeDate = earliestQuoteProbeDate;
  combined.quoteProbeStatus = quoteProbeStatus;
  combined.quoteProbeMessage = quoteProbeMessage;
  combined.conditionCodes = [...conditionCodes].sort();
  combined.exchangeCodes = [...exchangeCodes].sort();
  combined.classifiedContractCoverage =
    combined.usablePremiumSnapshotCount > 0
      ? combined.tradeContractHydratedCount /
        combined.usablePremiumSnapshotCount
      : 0;
  combined.selectedPremiumCoverage =
    combined.usablePremiumTotal > 0
      ? Math.min(1, combined.selectedPremiumTotal / combined.usablePremiumTotal)
      : 0;
  return combined;
}

function buildFlowPremiumHydrationWarning(input: {
  quoteAccess: PremiumDistributionDataAccess;
  tradeAccess: PremiumDistributionDataAccess;
  classificationConfidence: PremiumDistributionClassificationConfidence;
  classificationCoverage: number;
}): string | null {
  if (input.quoteAccess === "forbidden" && input.tradeAccess === "forbidden") {
    return "Option quote-match and option trades are unavailable from the current Massive endpoints; totals are hydrated but side bars are unavailable.";
  }
  if (input.quoteAccess === "forbidden") {
    return "Option quote-match data is unavailable from the current Massive endpoint; side bars use option trade tick-test.";
  }
  if (input.tradeAccess === "forbidden") {
    return "Option trades are unavailable from the current Massive endpoint; side bars are unavailable.";
  }
  if (
    input.classificationConfidence === "none" ||
    input.classificationConfidence === "very_low"
  ) {
    const classified =
      input.classificationCoverage > 0 && input.classificationCoverage < 0.01
        ? "<1%"
        : `${Math.round(input.classificationCoverage * 100)}%`;
    return `${classified} trade-classified; totals are hydrated but side split is uncertain.`;
  }
  return null;
}

function buildFlowPremiumDistributionSourceDiagnostics(
  widgets: Array<OptionPremiumDistribution & { rank: number }>,
): Pick<
  FlowPremiumDistributionResponse["source"],
  | "providerHost"
  | "sideBasis"
  | "quoteAccess"
  | "tradeAccess"
  | "classifiedPremium"
  | "classificationCoverage"
  | "classificationConfidence"
  | "hydrationWarning"
  | "hydratedSymbolCount"
  | "hydrationDiagnostics"
> {
  const classifiedPremium = widgets.reduce(
    (sum, widget) => sum + widget.classifiedPremium,
    0,
  );
  const premiumTotal = widgets.reduce(
    (sum, widget) => sum + widget.premiumTotal,
    0,
  );
  const classificationCoverage =
    premiumTotal > 0 ? classifiedPremium / premiumTotal : 0;
  const sideBasis = combinePremiumDistributionSideBasis(widgets);
  const quoteAccess = combinePremiumDistributionAccess(widgets, "quoteAccess");
  const tradeAccess = combinePremiumDistributionAccess(widgets, "tradeAccess");
  const classificationConfidence =
    resolvePremiumDistributionClassificationConfidence({
      classificationCoverage,
      sideBasis,
      quoteAccess,
      tradeAccess,
    });
  const hydrationDiagnostics = combinePremiumHydrationDiagnostics(widgets);

  return {
    providerHost: getMassiveProviderHost(),
    sideBasis,
    quoteAccess,
    tradeAccess,
    classifiedPremium,
    classificationCoverage,
    classificationConfidence,
    hydrationWarning: buildFlowPremiumHydrationWarning({
      quoteAccess,
      tradeAccess,
      classificationConfidence,
      classificationCoverage,
    }),
    hydratedSymbolCount: widgets.length,
    hydrationDiagnostics,
  };
}

function isPremiumDistributionCandidate(symbol: string): boolean {
  return /^[A-Z][A-Z0-9.]{0,7}$/.test(symbol);
}

function normalizeFlowPremiumDistributionLimit(
  value: number | undefined,
): number {
  if (!Number.isFinite(value)) return FLOW_PREMIUM_DISTRIBUTION_DEFAULT_LIMIT;
  return Math.max(
    1,
    Math.min(Math.floor(value as number), FLOW_PREMIUM_DISTRIBUTION_MAX_LIMIT),
  );
}

function normalizeFlowPremiumDistributionCandidateLimit(
  value: number | undefined,
): number {
  if (!Number.isFinite(value)) return FLOW_PREMIUM_DISTRIBUTION_CANDIDATE_LIMIT;
  return Math.max(
    6,
    Math.min(
      Math.floor(value as number),
      FLOW_PREMIUM_DISTRIBUTION_MAX_CANDIDATES,
    ),
  );
}

function normalizeFlowPremiumDistributionTimeframe(
  value: unknown,
): PremiumDistributionTimeframe {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "week"
    ? "week"
    : "today";
}

function normalizeFlowPremiumDistributionCoverageMode(
  value: unknown,
): FlowPremiumDistributionCoverageMode {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "ranked"
    ? "ranked"
    : "universe";
}

function flowPremiumDistributionCacheKey(input: {
  limit: number;
  candidateLimit: number;
  timeframe: PremiumDistributionTimeframe;
  coverageMode: FlowPremiumDistributionCoverageMode;
  symbols: readonly string[];
}): string {
  return `${input.coverageMode}:${input.timeframe}:${input.limit}:${input.candidateLimit}:${input.symbols.join(",")}`;
}

async function fetchLatestGroupedStockAggregates(input: {
  client: MassiveMarketDataClient;
  now: Date;
  timeframe: PremiumDistributionTimeframe;
}): Promise<{
  aggregates: StockGroupedDailyAggregate[];
  candidateDate: string | null;
  errorMessage: string | null;
}> {
  let errorMessage: string | null = null;
  const collected: StockGroupedDailyAggregate[][] = [];
  const candidateDates: string[] = [];
  const maxTradingDays = input.timeframe === "week" ? 5 : 1;
  const maxCalendarLookback = input.timeframe === "week" ? 10 : 6;

  for (let offset = 0; offset < maxCalendarLookback; offset += 1) {
    const date = new Date(
      Date.UTC(
        input.now.getUTCFullYear(),
        input.now.getUTCMonth(),
        input.now.getUTCDate() - offset,
      ),
    );

    try {
      const aggregates = await input.client.getGroupedDailyStockAggregates({
        date,
      });
      if (aggregates.length) {
        collected.push(aggregates);
        candidateDates.push(date.toISOString().slice(0, 10));
        if (collected.length >= maxTradingDays) {
          break;
        }
      }
    } catch (error) {
      errorMessage =
        error instanceof Error && error.message
          ? error.message
          : "Massive grouped daily stock aggregates failed.";
    }
  }

  if (!collected.length) {
    return { aggregates: [], candidateDate: null, errorMessage };
  }

  if (input.timeframe === "today") {
    return {
      aggregates: collected[0] ?? [],
      candidateDate: candidateDates[0] ?? null,
      errorMessage: null,
    };
  }

  const bySymbol = new Map<string, StockGroupedDailyAggregate>();
  collected.flat().forEach((aggregate) => {
    const existing = bySymbol.get(aggregate.symbol);
    if (!existing) {
      bySymbol.set(aggregate.symbol, { ...aggregate });
      return;
    }
    existing.volume += aggregate.volume;
    existing.transactions =
      existing.transactions === null && aggregate.transactions === null
        ? null
        : (existing.transactions ?? 0) + (aggregate.transactions ?? 0);
  });

  return {
    aggregates: Array.from(bySymbol.values()),
    candidateDate: candidateDates[0] ?? null,
    errorMessage,
  };
}

function withFlowPremiumDistributionCacheState(
  value: FlowPremiumDistributionResponse,
  cache: FlowPremiumDistributionResponse["source"]["cache"],
  hydrationStatus = value.source.hydrationStatus,
): FlowPremiumDistributionResponse {
  return {
    ...value,
    source: {
      ...value.source,
      cache,
      hydrationStatus,
    },
  };
}

async function runWithAbortTimeout<T>(
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  timeoutId.unref?.();

  try {
    return await task(controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}
function flowSource(input: FlowSourceInput): FlowEventsSource {
  return buildFlowSource({
    ...input,
    scannerCoverage: input.scannerCoverage ?? getOptionsFlowUniverseCoverage(),
  });
}

function deferredFlowEventsResult(
  input: DeferredFlowEventsResultInput,
): FlowEventsResult {
  return buildDeferredFlowEventsResult({
    ...input,
    scannerCoverage: input.scannerCoverage ?? getOptionsFlowUniverseCoverage(),
  });
}

function historicalFlowEventsTransientResult(input: {
  unusualThreshold?: number;
  reason: string;
}): FlowEventsResult {
  return {
    events: [],
    source: flowSource({
      provider: "massive",
      status: "empty",
      attemptedProviders: ["massive"],
      unusualThreshold: input.unusualThreshold ?? 1,
      ibkrStatus: "empty",
      ibkrReason: input.reason,
    }),
  };
}

function isHistoricalFlowProviderTimeoutResult(
  value: FlowEventsResult,
): boolean {
  return (
    value.events.length === 0 &&
    value.source.ibkrReason === HISTORICAL_FLOW_PROVIDER_TIMEOUT_REASON
  );
}

function pruneHistoricalFlowCooldowns(requestedAt: number): void {
  if (
    requestedAt - lastHistoricalFlowCooldownPruneMs <
    HISTORICAL_FLOW_TIMEOUT_COOLDOWN_MS
  ) {
    return;
  }
  lastHistoricalFlowCooldownPruneMs = requestedAt;
  historicalFlowCooldowns.forEach((cooldown, cacheKey) => {
    if (cooldown.expiresAt <= requestedAt) {
      historicalFlowCooldowns.delete(cacheKey);
    }
  });
}

function getHistoricalFlowCooldown(
  cacheKey: string,
  requestedAt: number,
): FlowEventsResult | null {
  pruneHistoricalFlowCooldowns(requestedAt);
  const cooldown = historicalFlowCooldowns.get(cacheKey);
  if (!cooldown) {
    return null;
  }
  if (cooldown.expiresAt > requestedAt) {
    return cooldown.value;
  }
  historicalFlowCooldowns.delete(cacheKey);
  return null;
}

function recordHistoricalFlowCooldown(
  cacheKey: string,
  value: FlowEventsResult,
  settledAt: number,
): void {
  pruneHistoricalFlowCooldowns(settledAt);
  historicalFlowCooldowns.set(cacheKey, {
    value,
    expiresAt: settledAt + HISTORICAL_FLOW_TIMEOUT_COOLDOWN_MS,
  });
}

function shouldDeferOnDemandFlowRefresh(): string | null {
  if (flowEventsOnDemandActive >= FLOW_EVENTS_ON_DEMAND_MAX_ACTIVE) {
    return "options_flow_on_demand_saturated";
  }

  const optionsLane = getBridgeGovernorSnapshot().options;
  if (optionsLane.queued > 0) {
    return "options_lane_queued";
  }

  return null;
}

function queueOptionsFlowScannerRefresh(input: {
  underlying: string;
  scannerRequest: OptionsFlowScannerRequest;
  phase: string;
}): boolean {
  if (!getOptionsFlowRuntimeConfig().scannerEnabled) {
    return false;
  }
  if (enforceOptionsFlowScannerPressureControls()) {
    return false;
  }
  if (getOptionsFlowScannerBackgroundBlockReason()) {
    return false;
  }
  syncOptionsFlowScannerEffectiveConcurrency();
  const [underlying] = selectOptionsFlowScannerPromotableSymbols([
    input.underlying,
  ]);
  if (!underlying) {
    return false;
  }
  optionsFlowScanner
    .requestScan([underlying], {
      ...input.scannerRequest,
      phase:
        input.scannerRequest.phase ??
        (input.phase === "nonblocking-miss" || input.phase === "aggregate-seed"
          ? "seed"
          : "manual"),
    })
    .catch((error) => {
      logger.warn(
        { err: error, underlying: input.underlying, phase: input.phase },
        "Failed to queue options flow scanner refresh",
      );
    });
  return true;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === "string" && error.trim()
    ? error
    : "Unknown provider error.";
}

export async function getSession() {
  const bridgeHealth = await getBridgeHealthForSession();
  const ibkrRuntime = getIbkrBridgeRuntimeSessionState();
  const massiveConfig = getMassiveRuntimeConfig();
  const stockMarketDataProvider: "massive" | "ibkr" =
    isMassiveStocksRealtimeConfigured(massiveConfig) ? "massive" : "ibkr";
  return {
    environment: getRuntimeMode(),
    brokerProvider: "ibkr" as const,
    marketDataProvider: stockMarketDataProvider,
    configured: getProviderConfiguration(),
    marketDataProviders: {
      live: stockMarketDataProvider,
      historical: isMassiveStocksRealtimeConfigured(massiveConfig)
        ? "massive"
        : "ibkr",
      research: "fmp" as const,
    },
    ibkrBridge: bridgeHealth,
    runtime: {
      ibkr: ibkrRuntime,
    },
    timestamp: new Date(),
  };
}

function maskAccountId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value.length <= 4) {
    return "****";
  }

  return `${value.slice(0, 2)}...${value.slice(-4)}`;
}

function mb(value: number): number {
  return Math.round((value / 1024 / 1024) * 10) / 10;
}

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

function nsToMs(value: number): number {
  return Math.round((value / 1_000_000) * 10) / 10;
}

function orderReadTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env["IBKR_ORDER_READ_TIMEOUT_MS"] ?? "9000",
    10,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 9_000;
}

function gatewayTradingHealthTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env["IBKR_GATEWAY_TRADING_HEALTH_TIMEOUT_MS"] ?? "2500",
    10,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 2_500;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(timeoutError());
    }, timeoutMs);
    timeout.unref?.();

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function serializeOrderReadDebug(error: unknown, timeoutMs: number) {
  const cause = isHttpError(error) ? error.cause : null;
  const causeCode = cause instanceof HttpError ? cause.code : null;
  const code =
    causeCode === "orders_timeout"
      ? "orders_timeout"
      : isHttpError(error)
        ? (error.code ?? "orders_timeout")
        : "orders_timeout";
  return {
    message:
      error instanceof Error && error.message
        ? error.message
        : "IBKR order read timed out.",
    code,
    timeoutMs,
  };
}

function getBridgeBackoffRemainingMs(
  category: "orders" | "options" | "health",
): number {
  return getBridgeGovernorSnapshot()[category].backoffRemainingMs;
}

async function recordOrderReadDegraded(input: {
  accountId?: string;
  mode?: "paper" | "live";
  reason: string;
  message: string;
  timeoutMs?: number;
  stale?: boolean;
  detail?: string | null;
}) {
  await recordServerDiagnosticEvent({
    subsystem: "orders",
    category: "visibility",
    code: input.reason,
    severity: "warning",
    message: input.message,
    dimensions: {
      accountId: input.accountId ?? null,
      mode: input.mode ?? null,
      timeoutMs: input.timeoutMs ?? null,
      stale: input.stale ?? null,
    },
    raw: {
      detail: input.detail ?? null,
    },
  }).catch(() => {});
}

export type ResilientOrdersResponse = {
  orders: BrokerOrderSnapshot[];
  degraded?: boolean;
  reason?: string;
  stale?: boolean;
  debug?: {
    message: string;
    code: string;
    timeoutMs?: number;
  };
};

type OrderVisibilityCacheEntry = {
  payload: ResilientOrdersResponse;
  cachedAt: number;
  expiresAt: number;
  staleExpiresAt: number;
};

const orderVisibilityCache = new Map<string, OrderVisibilityCacheEntry>();
const orderVisibilityInFlight = new Map<
  string,
  Promise<ResilientOrdersResponse>
>();

function orderVisibilityCacheTtlMs(): number {
  const configured = Number.parseInt(
    process.env["IBKR_ORDER_VISIBILITY_CACHE_TTL_MS"] ?? "2000",
    10,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 2_000;
}

function orderVisibilityStaleTtlMs(): number {
  const configured = Number.parseInt(
    process.env["IBKR_ORDER_VISIBILITY_STALE_TTL_MS"] ?? "120000",
    10,
  );
  return Number.isFinite(configured) && configured > 0 ? configured : 120_000;
}

function orderVisibilityWaitMs(): number {
  const configured = Number.parseInt(
    process.env["IBKR_ORDER_VISIBILITY_WAIT_MS"] ?? "1200",
    10,
  );
  return Number.isFinite(configured) && configured >= 0 ? configured : 1_200;
}

function markOrderVisibilitySnapshotStale(
  payload: ResilientOrdersResponse,
  input: {
    reason: string;
    message: string;
    timeoutMs?: number;
  },
): ResilientOrdersResponse {
  return {
    ...payload,
    degraded: true,
    stale: true,
    reason: input.reason,
    debug: {
      message: input.message,
      code: input.reason,
      timeoutMs: input.timeoutMs,
    },
  };
}

function orderVisibilityFallback(input: {
  reason: string;
  message: string;
  timeoutMs?: number;
}): ResilientOrdersResponse {
  return {
    orders: [],
    degraded: true,
    stale: true,
    reason: input.reason,
    debug: {
      message: input.message,
      code: input.reason,
      timeoutMs: input.timeoutMs,
    },
  };
}

function orderVisibilityCacheKey(input: {
  accountId?: string;
  mode?: "paper" | "live";
  status?:
    | "pending_submit"
    | "submitted"
    | "accepted"
    | "partially_filled"
    | "filled"
    | "canceled"
    | "rejected"
    | "expired";
}): string {
  return JSON.stringify({
    accountId: input.accountId ?? null,
    mode: input.mode ?? getRuntimeMode(),
    status: input.status ?? null,
  });
}

export async function listOrdersWithResilience(input: {
  accountId?: string;
  mode?: "paper" | "live";
  status?:
    | "pending_submit"
    | "submitted"
    | "accepted"
    | "partially_filled"
    | "filled"
    | "canceled"
    | "rejected"
    | "expired";
}): Promise<ResilientOrdersResponse> {
  const client = getIbkrClient();
  const timeoutMs = orderReadTimeoutMs();
  const suppression = getBridgeOrderReadSuppression();
  if (suppression && !shouldProbeBridgeOrderReadSuppression(suppression)) {
    void recordOrderReadDegraded({
      accountId: input.accountId,
      mode: input.mode,
      reason: suppression.reason,
      message:
        "Skipping open-orders read while the IBKR bridge order endpoint is suppressed.",
      stale: true,
      detail: suppression.message,
    });
    return {
      orders: [],
      degraded: true,
      reason: suppression.reason,
      stale: true,
      debug: {
        message: suppression.message,
        code: suppression.reason,
      },
    };
  }
  const governor = getBridgeGovernorSnapshot().orders;
  if (isBridgeWorkBackedOff("orders")) {
    void recordOrderReadDegraded({
      accountId: input.accountId,
      mode: input.mode,
      reason: "orders_backoff",
      message: "Skipping open-orders read while the IBKR bridge is backed off.",
      timeoutMs,
      stale: true,
      detail: `Bridge order reads are backed off for ${governor.backoffRemainingMs}ms.`,
    });
    return {
      orders: [],
      degraded: true,
      reason: "orders_backoff",
      stale: true,
      debug: {
        message: "Bridge order reads are temporarily backed off.",
        code: "orders_backoff",
        timeoutMs,
      },
    };
  }
  if (governor.active > 0 || governor.queued > 0) {
    void recordOrderReadDegraded({
      accountId: input.accountId,
      mode: input.mode,
      reason: "orders_busy",
      message: "Skipping open-orders read while another order read is active.",
      timeoutMs,
      stale: true,
      detail: `Bridge order reads are busy (active=${governor.active}, queued=${governor.queued}).`,
    });
    return {
      orders: [],
      degraded: true,
      reason: "orders_busy",
      stale: true,
      debug: {
        message: "Bridge order reads are busy; skipping queued read.",
        code: "orders_busy",
        timeoutMs,
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new HttpError(504, "IBKR order read timed out.", {
        code: "orders_timeout",
        detail: `Order read did not respond within ${timeoutMs}ms.`,
      }),
    );
  }, timeoutMs);
  timeout.unref?.();

  try {
    const result: BridgeOrdersResult = await runBridgeWork("orders", () =>
      withTimeout(
        client.listOrdersWithMeta({
          accountId: input.accountId,
          mode: input.mode ?? getRuntimeMode(),
          status: input.status,
          signal: controller.signal,
        }),
        timeoutMs,
        () =>
          new HttpError(504, "IBKR order read timed out.", {
            code: "orders_timeout",
            detail: `Order read did not respond within ${timeoutMs}ms.`,
        }),
      ),
    );
    if (!result.degraded) {
      clearBridgeOrderReadSuppression("orders_timeout");
    }
    if (result.degraded) {
      void recordOrderReadDegraded({
        accountId: input.accountId,
        mode: input.mode,
        reason: result.reason ?? "orders_degraded",
        message: "Open-orders snapshot timed out; using cached order stream.",
        timeoutMs: result.timeoutMs,
        stale: result.stale,
        detail: result.detail ?? null,
      });
    }
    return {
      orders: result.orders,
      degraded: result.degraded,
      reason: result.reason,
      stale: result.stale,
      debug: result.degraded
        ? {
            message:
              result.detail ||
              "Open-orders snapshot timed out; using cached order stream.",
            code: result.reason ?? "orders_degraded",
            timeoutMs: result.timeoutMs,
          }
        : undefined,
    };
  } catch (error) {
    const debug = serializeOrderReadDebug(error, timeoutMs);
    if (debug.code === "orders_timeout") {
      markBridgeOrderReadsSuppressed({
        reason: "orders_timeout",
        message:
          "Open-orders reads are paused after the bridge order endpoint did not respond.",
        ttlMs: 60_000,
      });
    }
    void recordOrderReadDegraded({
      accountId: input.accountId,
      mode: input.mode,
      reason: "orders_timeout",
      message: "IBKR order read timed out before the bridge responded.",
      timeoutMs,
      stale: false,
      detail: debug.message,
    });
    return {
      orders: [],
      degraded: true,
      reason: "orders_timeout",
      stale: false,
      debug,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function listOrdersForVisibility(input: {
  accountId?: string;
  mode?: "paper" | "live";
  status?:
    | "pending_submit"
    | "submitted"
    | "accepted"
    | "partially_filled"
    | "filled"
    | "canceled"
    | "rejected"
    | "expired";
}): Promise<ResilientOrdersResponse> {
  const key = orderVisibilityCacheKey(input);
  const now = Date.now();
  const cached = orderVisibilityCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }
  if (cached && cached.staleExpiresAt <= now) {
    orderVisibilityCache.delete(key);
  }
  const staleCached =
    cached && cached.staleExpiresAt > now ? cached.payload : null;
  const pending = orderVisibilityInFlight.get(key);
  if (pending) {
    if (staleCached) {
      return markOrderVisibilitySnapshotStale(staleCached, {
        reason: "orders_refreshing",
        message: "Open-orders visibility is refreshing in the background.",
      });
    }
    const waitMs = orderVisibilityWaitMs();
    return Promise.race([
      pending,
      new Promise<ResilientOrdersResponse>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(
            orderVisibilityFallback({
              reason: "orders_refreshing",
              message:
                "Open-orders visibility is refreshing in the background.",
              timeoutMs: waitMs,
            }),
          );
        }, waitMs);
        timeout.unref?.();
      }),
    ]);
  }

  const request = listOrdersWithResilience(input)
    .then((payload) => {
      const cachedAt = Date.now();
      orderVisibilityCache.set(key, {
        payload,
        cachedAt,
        expiresAt: cachedAt + orderVisibilityCacheTtlMs(),
        staleExpiresAt: cachedAt + orderVisibilityStaleTtlMs(),
      });
      return payload;
    })
    .catch((error) => {
      logger.warn(
        { err: error, key },
        "Open-orders visibility refresh failed",
      );
      return orderVisibilityFallback({
        reason: "orders_visibility_error",
        message:
          error instanceof Error && error.message
            ? error.message
            : "Open-orders visibility refresh failed.",
      });
    })
    .finally(() => {
      if (orderVisibilityInFlight.get(key) === request) {
        orderVisibilityInFlight.delete(key);
      }
    });
  orderVisibilityInFlight.set(key, request);

  if (staleCached) {
    request.catch(() => {});
    return markOrderVisibilitySnapshotStale(staleCached, {
      reason: "orders_refreshing",
      message: "Open-orders visibility is refreshing in the background.",
    });
  }

  const waitMs = orderVisibilityWaitMs();
  return Promise.race([
    request,
    new Promise<ResilientOrdersResponse>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(
          orderVisibilityFallback({
            reason: "orders_refreshing",
            message: "Open-orders visibility is refreshing in the background.",
            timeoutMs: waitMs,
          }),
        );
      }, waitMs);
      timeout.unref?.();
    }),
  ]);
}

const DEFAULT_RUNTIME_DIAGNOSTICS_MARKET_DATA_INGEST_TIMEOUT_MS = 1_500;

function runtimeDiagnosticsMarketDataIngestTimeoutMs(): number {
  return positiveIntegerEnv(
    "RUNTIME_DIAGNOSTICS_MARKET_DATA_INGEST_TIMEOUT_MS",
    DEFAULT_RUNTIME_DIAGNOSTICS_MARKET_DATA_INGEST_TIMEOUT_MS,
  );
}

function marketDataIngestDiagnosticsTimeoutFallback(
  timeoutMs: number,
): MarketDataIngestDiagnostics {
  return {
    configured: isMarketDataIngestConfigured(),
    providerConfigured: isMarketDataIngestProviderConfigured(),
    queueDepth: {},
    oldestQueuedAgeMs: null,
    runningCount: 0,
    expiredLeaseCount: 0,
    blockedGexJobCount: 0,
    oldestBlockedGexAgeMs: null,
    blockedGexJobs: [],
    recentProviderFailures: [],
    recentCompletedJobs: [],
    degraded: true,
    reason: "market_data_ingest_diagnostics_timeout",
    timeoutMs,
  };
}

async function getRuntimeMarketDataIngestDiagnostics(): Promise<MarketDataIngestDiagnostics> {
  const timeoutMs = runtimeDiagnosticsMarketDataIngestTimeoutMs();
  return resolveWithin(
    getMarketDataIngestDiagnostics(),
    timeoutMs,
    marketDataIngestDiagnosticsTimeoutFallback(timeoutMs),
  );
}

export async function getRuntimeDiagnostics() {
  const bridgeConfig = getIbkrBridgeRuntimeConfig();
  const bridgeOverride = getIbkrBridgeRuntimeOverride();
  const ibkrRuntime = getIbkrBridgeRuntimeSessionState();
  const ignoredBridgeEnvNames = getIgnoredIbkrBridgeRuntimeEnvNames();
  const configured = getProviderConfiguration();
  const {
    annotatedHealth,
    bridgeQuoteDiagnostics,
    fallbackStreamState,
    healthError,
    healthErrorCode,
    healthErrorStatusCode,
    healthErrorDetail,
  } = await getRuntimeBridgeHealthState();
  const memory = process.memoryUsage();
  const resourceCaches = getPlatformResourceDiagnostics();
  const marketDataStreams = getRuntimeMarketDataDiagnostics({
    bridgeQuoteDiagnostics,
  });
  const marketDataIngest = await getRuntimeMarketDataIngestDiagnostics();
  const massiveRuntimeConfig = getMassiveRuntimeConfig();
  const { getAccountPageStreamDiagnostics } = await import(
    "./account-page-streams"
  );
  const optionsFlowScannerDiagnostics = getOptionsFlowScannerDiagnostics();
  const marketDataAdmissionWithScanner = {
    ...marketDataStreams.marketDataAdmission,
    optionsFlowScanner: optionsFlowScannerDiagnostics,
  };
  const marketDataStreamsWithIngest = {
    ...marketDataStreams,
    marketDataIngest,
  };
  const marketDataWorkPlan = buildMarketDataWorkPlan({
    admission: marketDataAdmissionWithScanner,
    optionsFlowScanner: optionsFlowScannerDiagnostics,
    ingest: marketDataIngest,
    stockAggregates: marketDataStreams.stockAggregates,
  });

  return {
    timestamp: new Date(),
    marketDataWorkPlan,
    api: {
      uptimeMs: Math.round(process.uptime() * 1000),
      memoryMb: {
        rss: mb(memory.rss),
        heapUsed: mb(memory.heapUsed),
        heapTotal: mb(memory.heapTotal),
        external: mb(memory.external),
        arrayBuffers: mb(memory.arrayBuffers),
      },
      resourceCaches,
      accountPage: getAccountPageStreamDiagnostics(),
      pythonCompute: getPythonComputeDiagnostics(),
      eventLoopDelayMs: {
        mean: nsToMs(eventLoopDelay.mean),
        max: nsToMs(eventLoopDelay.max),
        p95: nsToMs(eventLoopDelay.percentile(95)),
      },
    },
    providers: {
      massive: getRuntimeMassiveProviderDiagnostics({
        config: massiveRuntimeConfig,
        streams: marketDataStreams,
      }),
    },
    storage: getCachedStorageHealthSnapshot(),
    ibkr: {
      transport: "tws" as const,
      configured: configured.ibkr,
      bridgeUrlConfigured: Boolean(bridgeConfig?.baseUrl),
      bridgeTokenConfigured: Boolean(bridgeConfig?.apiToken),
      runtimeOverrideActive: Boolean(bridgeOverride),
      runtimeOverrideUpdatedAt: bridgeOverride?.updatedAt ?? null,
      desktopAgentOnline: ibkrRuntime.desktopAgentOnline,
      desktopAgentCompatibility: ibkrRuntime.desktopAgentCompatibility,
      desktopAgentCompatible: ibkrRuntime.desktopAgentCompatible,
      desktopAgentHelperVersion: ibkrRuntime.desktopAgentHelperVersion,
      desktopAgentKnownBad: ibkrRuntime.desktopAgentKnownBad,
      desktopAgentExpectedHelperVersion:
        ibkrRuntime.desktopAgentExpectedHelperVersion,
      desktopAgentUpgradeRequired: ibkrRuntime.desktopAgentUpgradeRequired,
      reconnectAvailable: ibkrRuntime.reconnectAvailable,
      activation: getIbkrBridgeActivationDiagnostics(),
      ignoredBridgeEnvNames,
      ignoredBridgeEnvConfigured: ignoredBridgeEnvNames.length > 0,
      reachable: Boolean(annotatedHealth?.bridgeReachable),
      healthError,
      healthErrorCode,
      healthErrorStatusCode,
      healthErrorDetail,
      healthFresh: annotatedHealth?.healthFresh ?? false,
      healthAgeMs: annotatedHealth?.healthAgeMs ?? null,
      stale: annotatedHealth?.stale ?? true,
      bridgeReachable: annotatedHealth?.bridgeReachable ?? false,
      socketConnected: annotatedHealth?.socketConnected ?? false,
      brokerServerConnected: annotatedHealth?.brokerServerConnected ?? false,
      serverConnectivity: annotatedHealth?.serverConnectivity ?? null,
      lastServerConnectivityAt:
        annotatedHealth?.lastServerConnectivityAt ?? null,
      lastServerConnectivityError:
        annotatedHealth?.lastServerConnectivityError ?? null,
      accountsLoaded: annotatedHealth?.accountsLoaded ?? false,
      configuredLiveMarketDataMode:
        annotatedHealth?.configuredLiveMarketDataMode ?? false,
      streamFresh: annotatedHealth?.streamFresh ?? false,
      lastStreamEventAgeMs: annotatedHealth?.lastStreamEventAgeMs ?? null,
      strictReady: annotatedHealth?.strictReady ?? false,
      strictReason: annotatedHealth
        ? annotatedHealth.strictReason
        : healthErrorCode || healthError
          ? "health_error"
          : "health_unavailable",
      streamState:
        annotatedHealth?.streamState ?? fallbackStreamState.streamState,
      streamStateReason:
        annotatedHealth?.streamStateReason ??
        fallbackStreamState.streamStateReason,
      connected: annotatedHealth?.connected ?? false,
      authenticated: annotatedHealth?.authenticated ?? false,
      competing: annotatedHealth?.competing ?? false,
      selectedAccountId: maskAccountId(annotatedHealth?.selectedAccountId),
      accountCount: annotatedHealth?.accounts?.length ?? 0,
      connectionTarget: annotatedHealth?.connectionTarget ?? null,
      sessionMode: annotatedHealth?.sessionMode ?? null,
      clientId: annotatedHealth?.clientId ?? null,
      marketDataMode: annotatedHealth?.marketDataMode ?? null,
      liveMarketDataAvailable: annotatedHealth?.liveMarketDataAvailable ?? null,
      lastTickleAt: annotatedHealth?.lastTickleAt ?? null,
      lastRecoveryAttemptAt: annotatedHealth?.lastRecoveryAttemptAt ?? null,
      lastRecoveryError: annotatedHealth?.lastRecoveryError ?? null,
      lastError: annotatedHealth?.lastError ?? null,
      bridgeDiagnostics: annotatedHealth?.diagnostics ?? null,
      orderCapability: {
        orderDataVisible: Boolean(
          annotatedHealth?.healthFresh &&
            annotatedHealth.connected &&
            annotatedHealth.authenticated,
        ),
        readOnlyModeLikely:
          typeof annotatedHealth?.lastError === "string" &&
          /read.?only/i.test(annotatedHealth.lastError),
        liveActionConfirmationRequired: true,
        diagnosticsMutateOrders: false,
      },
      governor: getBridgeGovernorSnapshot(),
      streams: {
        ...marketDataStreamsWithIngest,
        massiveStockUniverse: getMassiveStockUniverseStreamDiagnostics(),
        marketDataAdmission: marketDataAdmissionWithScanner,
        marketDataWorkPlan,
        sse: getSseStreamDiagnostics(),
      },
    },
  };
}

export function getPlatformResourceDiagnostics() {
  const now = Date.now();
  const countExpired = <
    T extends { expiresAt?: number; staleExpiresAt?: number },
  >(
    entries: Iterable<T>,
  ) => {
    let expired = 0;
    let staleExpired = 0;
    for (const entry of entries) {
      if (typeof entry.expiresAt === "number" && entry.expiresAt <= now) {
        expired += 1;
      }
      if (
        typeof entry.staleExpiresAt === "number" &&
        entry.staleExpiresAt <= now
      ) {
        staleExpired += 1;
      }
    }
    return { expired, staleExpired };
  };

  return {
    bars: {
      entries: barsCache.size,
      maxEntries: BARS_CACHE_MAX_ENTRIES,
      inFlight: barsInFlight.size,
      historyCursorEntries: chartHistoryCursors.size,
      historyCursorMaxEntries: CHART_HISTORY_CURSOR_MAX_ENTRIES,
      historyCursorTtlMs: CHART_HISTORY_CURSOR_TTL_MS,
      cursorEnabled: isChartHydrationCursorEnabled(),
      dedupeEnabled: isChartHydrationDedupeEnabled(),
      backgroundEnabled: isChartHydrationBackgroundEnabled(),
      hydration: { ...barsHydrationCounters },
      hydrationBreakdown: {
        byFamily: { ...barsHydrationBreakdown.byFamily },
        byPriority: { ...barsHydrationBreakdown.byPriority },
        byPayloadClass: { ...barsHydrationBreakdown.byPayloadClass },
        byFamilyCacheStatus: {
          ...barsHydrationBreakdown.byFamilyCacheStatus,
        },
      },
      ttlMs: BARS_CACHE_TTL_MS,
      staleTtlMs: BARS_CACHE_STALE_TTL_MS,
      synthesisOnlyCacheTtlMs: BARS_SYNTHESIS_ONLY_CACHE_TTL_MS,
      ...countExpired(barsCache.values()),
    },
    optionChains: {
      entries: optionChainCache.size,
      maxEntries: OPTION_CHAIN_CACHE_MAX_ENTRIES,
      inFlight: optionChainInFlight.size,
      ttlMs: OPTION_CHAIN_CACHE_TTL_MS,
      metadataTtlMs: OPTION_CHAIN_METADATA_CACHE_TTL_MS,
      metadataStaleTtlMs: OPTION_CHAIN_METADATA_STALE_TTL_MS,
      durable: getDurableOptionMetadataDiagnostics(),
      ...countExpired(optionChainCache.values()),
    },
    optionExpirations: {
      entries: optionExpirationCache.size,
      maxEntries: OPTION_CHAIN_CACHE_MAX_ENTRIES,
      inFlight: optionExpirationInFlight.size,
      ttlMs: OPTION_EXPIRATION_CACHE_TTL_MS,
      ...countExpired(optionExpirationCache.values()),
    },
    optionContracts: {
      entries: optionContractResolutionCache.size,
      inFlight: 0,
      ttlMs: OPTION_CONTRACT_RESOLUTION_CACHE_TTL_MS,
      ...countExpired(optionContractResolutionCache.values()),
    },
    flowEvents: {
      entries: flowEventsCache.size,
      inFlight: flowEventsInFlight.size,
      ttlMs: FLOW_EVENTS_CACHE_TTL_MS,
      ...countExpired(flowEventsCache.values()),
    },
    universeSearch: {
      entries: universeSearchCache.size,
      inFlight: universeSearchInFlight.size,
      ttlMs: UNIVERSE_SEARCH_CACHE_TTL_MS,
      ...countExpired(universeSearchCache.values()),
    },
    universeLogos: {
      entries: universeLogoCache.size,
      inFlight: universeLogoInFlight.size,
      ttlMs: UNIVERSE_LOGO_CACHE_TTL_MS,
      ...countExpired(universeLogoCache.values()),
    },
    quoteSnapshots: {
      entries: quoteSnapshotCache.size,
      inFlight: quoteSnapshotInFlight.size,
      ttlMs: quoteSnapshotCacheTtlMs(),
      staleTtlMs: quoteSnapshotStaleTtlMs(),
      ...countExpired(quoteSnapshotCache.values()),
    },
    flowPremiumDistribution: {
      entries: flowPremiumDistributionCache.size,
      inFlight: flowPremiumDistributionInFlight.size,
      ttlMs: FLOW_PREMIUM_DISTRIBUTION_CACHE_TTL_MS,
      ...countExpired(flowPremiumDistributionCache.values()),
    },
    universeIbkrHydration: {
      queued: universeCatalogIbkrHydrationQueue.length,
      queuedUnique: universeCatalogIbkrHydrationQueued.size,
      inFlight: universeCatalogIbkrHydrationInFlight.size,
    },
  };
}

export async function listBrokerConnections() {
  const configured = getProviderConfiguration();
  const timestamp = new Date();
  const marketDataName = getMarketDataConnectionName();
  const marketDataCapabilities = getMarketDataConnectionCapabilities();
  const bridgeHealth = await getIbkrClient()
    .getHealth()
    .catch(() => null);
  const ibkrConnectionName = "Interactive Brokers Gateway";
  const ibkrStatus = !configured.ibkr
    ? ("disconnected" as const)
    : bridgeHealth?.connected
      ? ("connected" as const)
      : bridgeHealth?.lastError
        ? ("error" as const)
        : ("configured" as const);

  return {
    connections: [
      {
        id: "massive-paper",
        provider: "massive" as const,
        name: marketDataName,
        mode: "paper" as const,
        status: configured.massive
          ? ("configured" as const)
          : ("disconnected" as const),
        capabilities: marketDataCapabilities,
        updatedAt: timestamp,
      },
      {
        id: "massive-live",
        provider: "massive" as const,
        name: marketDataName,
        mode: "live" as const,
        status: configured.massive
          ? ("configured" as const)
          : ("disconnected" as const),
        capabilities: marketDataCapabilities,
        updatedAt: timestamp,
      },
      {
        id: "ibkr-paper",
        provider: "ibkr" as const,
        name: ibkrConnectionName,
        mode: "paper" as const,
        status: ibkrStatus,
        capabilities: [
          "accounts",
          "positions",
          "orders",
          "executions",
          "market-depth",
          "paper-trading",
          "quotes",
          "bars",
          "options-chain",
          "stock-stream",
        ],
        updatedAt: timestamp,
      },
      {
        id: "ibkr-live",
        provider: "ibkr" as const,
        name: ibkrConnectionName,
        mode: "live" as const,
        status: ibkrStatus,
        capabilities: [
          "accounts",
          "positions",
          "orders",
          "executions",
          "market-depth",
          "live-trading",
          "quotes",
          "bars",
          "options-chain",
          "stock-stream",
        ],
        updatedAt: timestamp,
      },
    ],
  };
}

export async function listWatchlists() {
  const nowMs = Date.now();
  if (watchlistListCache && watchlistListCache.freshUntil > nowMs) {
    scheduleIbkrWatchlistPrewarmFromListRead(
      watchlistListCache.value.watchlists,
      "list-cache",
      nowMs,
    );
    return watchlistListCache.value;
  }

  if (watchlistDbBackoff.isActive(nowMs)) {
    if (watchlistListCache && watchlistListCache.staleUntil > nowMs) {
      scheduleIbkrWatchlistPrewarmFromListRead(
        watchlistListCache.value.watchlists,
        "list-stale-db-backoff",
        nowMs,
      );
      return watchlistListCache.value;
    }
    const fallback = cacheWatchlistSnapshot(buildBuiltInWatchlistSnapshot(), nowMs);
    scheduleIbkrWatchlistPrewarmFromListRead(
      fallback.watchlists,
      "list-fallback",
      nowMs,
    );
    return fallback;
  }

  const inFlight = watchlistListInFlight;
  if (inFlight) {
    if (watchlistListCache && watchlistListCache.staleUntil > nowMs) {
      scheduleIbkrWatchlistPrewarmFromListRead(
        watchlistListCache.value.watchlists,
        "list-stale-inflight",
        nowMs,
      );
      return watchlistListCache.value;
    }
    const result = await inFlight;
    scheduleIbkrWatchlistPrewarmFromListRead(
      result.watchlists,
      "list-inflight",
      Date.now(),
    );
    return result;
  }

  const request = listWatchlistsFromDb()
    .then((result) => {
      watchlistDbBackoff.clear();
      return cacheWatchlistSnapshot(result);
    })
    .finally(() => {
      if (watchlistListInFlight === request) {
        watchlistListInFlight = null;
      }
    });
  watchlistListInFlight = request;

  if (watchlistListCache && watchlistListCache.staleUntil > nowMs) {
    void request
      .then((result) =>
        scheduleIbkrWatchlistPrewarmFromListRead(
          result.watchlists,
          "list-refresh",
          Date.now(),
        ),
      )
      .catch((error) => {
        logger.warn(
          { err: error },
          "watchlist database refresh failed after stale list read",
        );
      });
    scheduleIbkrWatchlistPrewarmFromListRead(
      watchlistListCache.value.watchlists,
      "list-stale-refreshing",
      nowMs,
    );
    return watchlistListCache.value;
  }

  try {
    const result = await request;
    scheduleIbkrWatchlistPrewarmFromListRead(
      result.watchlists,
      "list",
      Date.now(),
    );
    return result;
  } catch (error) {
    if (isTransientPostgresError(error)) {
      watchlistDbBackoff.markFailure({
        error,
        logger,
        message: "watchlist database unavailable; serving built-in watchlists",
        nowMs,
      });
      const fallback = cacheWatchlistSnapshot(buildBuiltInWatchlistSnapshot(), nowMs);
      scheduleIbkrWatchlistPrewarmFromListRead(
        fallback.watchlists,
        "list-fallback",
        nowMs,
      );
      return fallback;
    }
    logger.warn(
      { err: error },
      "watchlist database unavailable; serving built-in watchlists",
    );
    const fallback = cacheWatchlistSnapshot(buildBuiltInWatchlistSnapshot(), nowMs);
    scheduleIbkrWatchlistPrewarmFromListRead(
      fallback.watchlists,
      "list-fallback",
      nowMs,
    );
    return fallback;
  }
}

export async function createWatchlist(input: {
  name: string;
  isDefault?: boolean;
  symbols?: WatchlistMutationSymbol[];
}) {
  const name = input.name.trim();
  if (!name) {
    throw new HttpError(400, "Watchlist name is required.", {
      code: "watchlist_name_required",
    });
  }

  const symbols = Array.from(
    new Map(
      (input.symbols || [])
        .map((item) => ({
          symbol: normalizeSymbol(item.symbol).toUpperCase(),
          name: item.name?.trim() || null,
          market: item.market ?? null,
          normalizedExchangeMic: item.normalizedExchangeMic ?? null,
          exchangeDisplay: item.exchangeDisplay ?? null,
          countryCode: item.countryCode ?? null,
          exchangeCountryCode: item.exchangeCountryCode ?? null,
          sector: item.sector ?? null,
          industry: item.industry ?? null,
        }))
        .filter((item) => item.symbol)
        .map((item) => [item.symbol, item]),
    ).values(),
  );

  const [watchlist] = await db
    .insert(watchlistsTable)
    .values({
      name,
      isDefault: Boolean(input.isDefault),
    })
    .returning({ id: watchlistsTable.id });

  if (input.isDefault) {
    await setDefaultWatchlistIfNeeded(watchlist.id);
  }

  for (const [index, symbolInput] of symbols.entries()) {
    const instrument = await ensureInstrumentForSymbol(symbolInput);
    await db.insert(watchlistItemsTable).values({
      watchlistId: watchlist.id,
      instrumentId: instrument.id,
      sortOrder: index,
    });
  }

  const created = await getWatchlistById(watchlist.id);
  invalidateWatchlistListCache();
  scheduleIbkrWatchlistPrewarmFromDb("create");
  return created;
}

export async function updateWatchlist(
  watchlistId: string,
  input: {
    name?: string;
    isDefault?: boolean;
  },
) {
  const current = await getWatchlistById(watchlistId);
  if (!current) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const patch: { name?: string; isDefault?: boolean } = {};
  if (typeof input.name === "string") {
    const nextName = input.name.trim();
    if (!nextName) {
      throw new HttpError(400, "Watchlist name is required.", {
        code: "watchlist_name_required",
      });
    }
    patch.name = nextName;
  }
  if (typeof input.isDefault === "boolean") {
    patch.isDefault = input.isDefault;
  }

  if (Object.keys(patch).length) {
    await db
      .update(watchlistsTable)
      .set(patch)
      .where(eq(watchlistsTable.id, watchlistId));
  }

  if (input.isDefault) {
    await setDefaultWatchlistIfNeeded(watchlistId);
  }

  const updated = await getWatchlistById(watchlistId);
  invalidateWatchlistListCache();
  scheduleIbkrWatchlistPrewarmFromDb("update");
  return updated;
}

export async function deleteWatchlist(watchlistId: string) {
  const current = await getWatchlistById(watchlistId);
  if (!current) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const all = await listWatchlistsFromDb();
  if (all.watchlists.length <= 1) {
    throw new HttpError(400, "At least one watchlist must remain.", {
      code: "watchlist_last_delete_blocked",
    });
  }

  await db
    .delete(watchlistItemsTable)
    .where(eq(watchlistItemsTable.watchlistId, watchlistId));
  await db.delete(watchlistsTable).where(eq(watchlistsTable.id, watchlistId));

  if (current.isDefault) {
    const nextDefault = await db
      .select({ id: watchlistsTable.id })
      .from(watchlistsTable)
      .orderBy(asc(watchlistsTable.name))
      .limit(1);
    if (nextDefault[0]) {
      await setDefaultWatchlistIfNeeded(nextDefault[0].id);
    }
  }

  invalidateWatchlistListCache();
  scheduleIbkrWatchlistPrewarmFromDb("delete");
  return { ok: true };
}

export async function addWatchlistSymbol(
  watchlistId: string,
  input: WatchlistMutationSymbol,
) {
  const current = await getWatchlistById(watchlistId);
  if (!current) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const instrument = await ensureInstrumentForSymbol(input);
  const exists = await db
    .select({ id: watchlistItemsTable.id })
    .from(watchlistItemsTable)
    .where(
      and(
        eq(watchlistItemsTable.watchlistId, watchlistId),
        eq(watchlistItemsTable.instrumentId, instrument.id),
      ),
    )
    .limit(1);

  if (exists[0]) {
    return getWatchlistById(watchlistId);
  }

  const [lastItem] = await db
    .select({ sortOrder: watchlistItemsTable.sortOrder })
    .from(watchlistItemsTable)
    .where(eq(watchlistItemsTable.watchlistId, watchlistId))
    .orderBy(desc(watchlistItemsTable.sortOrder))
    .limit(1);

  await db.insert(watchlistItemsTable).values({
    watchlistId,
    instrumentId: instrument.id,
    sortOrder: (lastItem?.sortOrder ?? -1) + 1,
  });

  const updated = await getWatchlistById(watchlistId);
  invalidateWatchlistListCache();
  scheduleIbkrWatchlistPrewarmFromDb("add-symbol");
  return updated;
}

export async function removeWatchlistSymbol(
  watchlistId: string,
  itemId: string,
) {
  const item = await db
    .select({
      id: watchlistItemsTable.id,
    })
    .from(watchlistItemsTable)
    .where(
      and(
        eq(watchlistItemsTable.id, itemId),
        eq(watchlistItemsTable.watchlistId, watchlistId),
      ),
    )
    .limit(1);

  if (!item[0]) {
    throw new HttpError(404, "Watchlist item not found.", {
      code: "watchlist_item_not_found",
    });
  }

  await db
    .delete(watchlistItemsTable)
    .where(eq(watchlistItemsTable.id, itemId));
  await rebalanceWatchlistSortOrder(watchlistId);
  const updated = await getWatchlistById(watchlistId);
  invalidateWatchlistListCache();
  scheduleIbkrWatchlistPrewarmFromDb("remove-symbol");
  return updated;
}

export async function reorderWatchlistSymbols(
  watchlistId: string,
  itemIds: string[],
) {
  const current = await getWatchlistById(watchlistId);
  if (!current) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const existingIds = current.items.map((item) => item.id);
  const normalizedIds = Array.from(
    new Set(itemIds.filter((itemId) => typeof itemId === "string" && itemId)),
  );
  if (
    normalizedIds.length !== existingIds.length ||
    existingIds.some((itemId) => !normalizedIds.includes(itemId))
  ) {
    throw new HttpError(
      400,
      "Reorder payload must include every watchlist item exactly once.",
      {
        code: "watchlist_reorder_invalid",
      },
    );
  }

  await Promise.all(
    normalizedIds.map((itemId, index) =>
      db
        .update(watchlistItemsTable)
        .set({ sortOrder: index })
        .where(
          and(
            eq(watchlistItemsTable.id, itemId),
            eq(watchlistItemsTable.watchlistId, watchlistId),
          ),
        ),
    ),
  );

  const updated = await getWatchlistById(watchlistId);
  invalidateWatchlistListCache();
  scheduleIbkrWatchlistPrewarmFromDb("reorder");
  return updated;
}

async function enrichBrokerPositionsForDisplay(
  positions: BrokerPositionSnapshot[],
): Promise<BrokerPositionSnapshot[]> {
  if (!positions.length) {
    return positions;
  }

  const equitySymbols = Array.from(
    new Set(
      positions
        .filter(
          (position) =>
            !position.optionContract && position.assetClass !== "option",
        )
        .map((position) => normalizeSymbol(positionReferenceSymbol(position)))
        .filter(Boolean),
    ),
  );
  const equityQuotes =
    equitySymbols.length > 0
      ? await getQuoteSnapshots({ symbols: equitySymbols.join(",") }).catch(
          () => ({
            quotes: [],
          }),
        )
      : { quotes: [] };
  const equityQuoteBySymbol = new Map(
    (equityQuotes.quotes || []).map((quote) => [
      normalizeSymbol(quote.symbol),
      quote,
    ]),
  );

  const optionPositionsByUnderlying = positions.reduce((map, position) => {
    const providerContractId =
      position.optionContract?.providerContractId?.trim();
    const underlying = normalizeSymbol(
      position.optionContract?.underlying ?? "",
    );
    if (!providerContractId || !underlying) {
      return map;
    }
    map.set(underlying, [...(map.get(underlying) ?? []), providerContractId]);
    return map;
  }, new Map<string, string[]>());
  const optionQuoteEntries = await Promise.all(
    Array.from(optionPositionsByUnderlying.entries()).map(
      async ([underlying, providerContractIds]) =>
        fetchBridgeOptionQuoteSnapshots({
          underlying,
          providerContractIds: Array.from(new Set(providerContractIds)),
          intent: "visible-live",
          fallbackProvider: "cache",
          requiresGreeks: false,
        })
          .then((payload) => payload.quotes || [])
          .catch(() => []),
    ),
  );
  const optionQuotePairs: Array<[string, QuoteSnapshot]> = optionQuoteEntries
    .flat()
    .flatMap((quote) => {
      const providerContractId = String(quote.providerContractId ?? "");
      return providerContractId ? [[providerContractId, quote]] : [];
    });
  const optionQuoteByProviderContractId = new Map(optionQuotePairs);

  return positions.map((position) => {
    const providerContractId =
      position.optionContract?.providerContractId ?? "";
    const quoteSnapshot = position.optionContract
      ? optionQuoteByProviderContractId.get(providerContractId)
      : equityQuoteBySymbol.get(
          normalizeSymbol(positionReferenceSymbol(position)),
        );
    const quote = choosePositionQuote(
      position.quote,
      buildPositionQuoteFromSnapshot(
        quoteSnapshot,
        position.marketPrice,
        position.optionContract ? "option_quote" : "bridge_quote",
      ),
    );
    return {
      ...position,
      quote,
    };
  });
}

export async function listPositions(input: {
  accountId?: string;
  mode?: "paper" | "live";
}) {
  const client = getIbkrClient();
  const positions = (
    await client.listPositions({
      accountId: input.accountId,
      mode: input.mode ?? getRuntimeMode(),
    })
  ).filter((position) => Math.abs(Number(position.quantity)) > 1e-9);

  return {
    positions: await enrichBrokerPositionsForDisplay(positions),
  };
}

export async function listOrders(input: {
  accountId?: string;
  mode?: "paper" | "live";
  status?:
    | "pending_submit"
    | "submitted"
    | "accepted"
    | "partially_filled"
    | "filled"
    | "canceled"
    | "rejected"
    | "expired";
}) {
  return listOrdersForVisibility(input);
}

export async function listExecutions(input: {
  accountId?: string;
  days?: number;
  limit?: number;
  symbol?: string;
  providerContractId?: string | null;
}) {
  return {
    executions: await listIbkrExecutions(input),
  };
}

function assertLiveOrderConfirmed(
  mode: "paper" | "live" | null | undefined,
  confirm: boolean | null | undefined,
) {
  if (mode !== "live" || confirm === true) {
    return;
  }

  throw new HttpError(
    409,
    "Live IBKR order actions require explicit confirmation. Retry with confirm=true after the user reviews the order details.",
    {
      code: "ibkr_live_order_confirmation_required",
    },
  );
}

function requireExplicitOrderActionMode(
  mode: "paper" | "live" | null | undefined,
  action: string,
): "paper" | "live" {
  if (mode === "paper" || mode === "live") {
    return mode;
  }

  throw new HttpError(
    400,
    `${action} requires an explicit paper or live mode.`,
    {
      code: "ibkr_order_mode_required",
      detail: "mode must be either 'paper' or 'live'.",
      expose: true,
    },
  );
}

type GatewayTradingHealth = Partial<
  Awaited<ReturnType<IbkrBridgeClient["getHealth"]>>
>;

type GatewayTradingReadiness = {
  ready: boolean;
  reason: string | null;
  message: string;
};

function gatewayTradingUnavailable(
  reason: string,
  message: string,
): GatewayTradingReadiness {
  return { ready: false, reason, message };
}

export function resolveIbkrGatewayTradingReadinessForTests(input: {
  configured: boolean;
  health: GatewayTradingHealth | null | undefined;
}): GatewayTradingReadiness {
  if (!input.configured) {
    return gatewayTradingUnavailable(
      "ibkr_not_configured",
      "Interactive Brokers is not configured for order routing.",
    );
  }

  const health = input.health;
  if (!health) {
    return gatewayTradingUnavailable(
      "bridge_health_unavailable",
      "IB Gateway trading is unavailable until Gateway health is verified.",
    );
  }

  if (health.competing === true) {
    return gatewayTradingUnavailable(
      "gateway_competing_session",
      "IB Gateway is connected, but another session is competing for the broker connection.",
    );
  }

  if (health.healthFresh === false) {
    return gatewayTradingUnavailable(
      "health_stale",
      "IB Gateway trading is unavailable until Gateway health is current.",
    );
  }

  if (health.connected !== true) {
    return gatewayTradingUnavailable(
      "gateway_socket_disconnected",
      "IB Gateway is disconnected. Reconnect Gateway before trading.",
    );
  }

  if (health.authenticated !== true) {
    return gatewayTradingUnavailable(
      "gateway_login_required",
      "IB Gateway is connected, but the broker session is not authenticated.",
    );
  }

  const accountsLoaded =
    health.accountsLoaded === true ||
    (Array.isArray(health.accounts) && health.accounts.length > 0) ||
    Boolean(health.selectedAccountId);
  if (!accountsLoaded) {
    return gatewayTradingUnavailable(
      "accounts_unavailable",
      "IB Gateway is connected, but no broker accounts are loaded yet.",
    );
  }

  return {
    ready: true,
    reason: null,
    message: "IB Gateway is connected and ready for trading.",
  };
}

function throwGatewayTradingUnavailable(
  readiness: GatewayTradingReadiness,
  cause?: unknown,
): never {
  throw new HttpError(409, readiness.message, {
    code: "ibkr_gateway_trading_unavailable",
    detail: readiness.reason ?? "gateway_trading_unavailable",
    data: { reason: readiness.reason },
    expose: true,
    cause,
  });
}

export async function assertIbkrGatewayTradingAvailable() {
  if (!getProviderConfiguration().ibkr) {
    throwGatewayTradingUnavailable(
      resolveIbkrGatewayTradingReadinessForTests({
        configured: false,
        health: null,
      }),
    );
  }

  let annotatedHealth: GatewayTradingHealth;
  try {
    annotatedHealth = await getAnnotatedBridgeHealthForTradingGuard(
      gatewayTradingHealthTimeoutMs(),
    );
  } catch (error) {
    throwGatewayTradingUnavailable(
      gatewayTradingUnavailable(
        "bridge_health_unavailable",
        "IB Gateway trading is unavailable until Gateway health is verified.",
      ),
      error,
    );
  }

  const readiness = resolveIbkrGatewayTradingReadinessForTests({
    configured: true,
    health: annotatedHealth,
  });
  if (!readiness.ready) {
    throwGatewayTradingUnavailable(readiness);
  }
}

async function validateOrderIntentForRouting(
  input: PlaceOrderInput,
  client: ReturnType<typeof getIbkrClient>,
) {
  if (
    input.assetClass !== "option" ||
    input.side !== "sell" ||
    input.optionContract?.right !== "call"
  ) {
    return;
  }

  let positions: BrokerPositionSnapshot[];
  try {
    positions = await client.listPositions({
      accountId: input.accountId,
      mode: input.mode,
    });
  } catch (error) {
    throw new HttpError(
      409,
      "Cannot validate the call sale until IBKR positions are available.",
      {
        code: "ibkr_option_order_position_check_unavailable",
        expose: true,
        cause: error,
      },
    );
  }

  const orders = await listOrdersWithResilience({
    accountId: input.accountId,
    mode: input.mode,
  });
  if (orders.degraded) {
    throw new HttpError(
      409,
      "Cannot validate the call sale until open IBKR orders are available.",
      {
        code: "ibkr_option_order_open_orders_unavailable",
        expose: true,
        data: {
          reason: orders.reason ?? "orders_unavailable",
          debug: orders.debug ?? null,
        },
      },
    );
  }

  validateSellCallOrderIntent({
    order: input,
    positions,
    orders: orders.orders,
  });
}

export async function placeOrder(input: PlaceOrderInput) {
  assertLiveOrderConfirmed(input.mode, input.confirm);
  await assertIbkrGatewayTradingAvailable();
  const client = getIbkrClient();
  await validateOrderIntentForRouting(input, client);
  return client.placeOrder(input);
}

export async function previewOrder(input: PlaceOrderInput) {
  const client = getIbkrClient();
  await validateOrderIntentForRouting(input, client);
  return client.previewOrder(input);
}

export async function submitRawOrders(input: {
  accountId?: string | null;
  mode?: "paper" | "live" | null;
  confirm?: boolean | null;
  parentOrderRequest?: PlaceOrderInput | null;
  ibkrOrders: Record<string, unknown>[];
}) {
  assertLiveOrderConfirmed(input.mode ?? getRuntimeMode(), input.confirm);
  await assertIbkrGatewayTradingAvailable();
  const client = getIbkrClient();
  if (input.parentOrderRequest) {
    await validateOrderIntentForRouting(
      {
        ...input.parentOrderRequest,
        accountId: input.accountId || input.parentOrderRequest.accountId,
        mode: input.mode ?? input.parentOrderRequest.mode ?? getRuntimeMode(),
      },
      client,
    );
  }
  return client.submitRawOrders(input);
}

export async function replaceOrder(input: {
  accountId: string;
  orderId: string;
  order: Record<string, unknown>;
  mode?: "paper" | "live";
  confirm?: boolean | null;
}) {
  assertLiveOrderConfirmed(input.mode ?? getRuntimeMode(), input.confirm);
  await assertIbkrGatewayTradingAvailable();
  const client = getIbkrClient();
  return client.replaceOrder({
    accountId: input.accountId,
    orderId: input.orderId,
    order: input.order,
    mode: input.mode ?? getRuntimeMode(),
    confirm: input.confirm,
  });
}

export async function cancelOrder(input: {
  accountId: string;
  orderId: string;
  mode?: "paper" | "live" | null;
  confirm?: boolean | null;
  manualIndicator?: boolean | null;
  extOperator?: string | null;
}) {
  const mode = requireExplicitOrderActionMode(input.mode, "Order cancellation");
  assertLiveOrderConfirmed(mode, input.confirm);
  await assertIbkrGatewayTradingAvailable();
  const client = getIbkrClient();
  return client.cancelOrder({
    ...input,
    mode,
  });
}

function positiveIntegerEnv(name: string, fallback: number): number {
  const configured = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

type StockQuoteSnapshotSource = "ibkr" | "massive";

function massiveQuoteToBrokerQuote(
  quote: MassiveQuoteSnapshot,
): QuoteSnapshot & {
  source: Exclude<StockQuoteSnapshotSource, "ibkr">;
} {
  const config = getMassiveRuntimeConfig();
  const source = "massive";
  const delayed = !isMassiveStocksRealtimeConfigured(config);
  return {
    symbol: quote.symbol,
    price: quote.price,
    bid: quote.bid,
    ask: quote.ask,
    bidSize: quote.bidSize,
    askSize: quote.askSize,
    change: quote.change,
    changePercent: quote.changePercent,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    prevClose: quote.prevClose,
    volume: quote.volume,
    openInterest: null,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    updatedAt: quote.updatedAt,
    providerContractId: null,
    transport: "tws",
    delayed,
    freshness: delayed ? "delayed" : "live",
    marketDataMode: delayed ? "delayed" : "live",
    dataUpdatedAt: quote.updatedAt,
    ageMs: getAgeMs(quote.updatedAt),
    cacheAgeMs: null,
    latency: null,
    source,
  };
}

function massiveAggregateToBrokerQuote(
  aggregate: ReturnType<typeof getCurrentStockMinuteAggregates>[number],
): (QuoteSnapshot & {
  source: Exclude<StockQuoteSnapshotSource, "ibkr">;
}) | null {
  const price = Number(aggregate.close);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }
  const updatedAtMs = Number.isFinite(aggregate.startMs)
    ? Math.min(Date.now(), Number(aggregate.startMs))
    : Date.now();
  const updatedAt = new Date(updatedAtMs);
  const delayed = Boolean(aggregate.delayed);
  return {
    symbol: aggregate.symbol,
    price,
    bid: price,
    ask: price,
    bidSize: 0,
    askSize: 0,
    change: 0,
    changePercent: 0,
    open: aggregate.open,
    high: aggregate.high,
    low: aggregate.low,
    prevClose: null,
    volume: aggregate.accumulatedVolume ?? aggregate.volume ?? null,
    openInterest: null,
    impliedVolatility: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    updatedAt,
    providerContractId: null,
    transport: "tws",
    delayed,
    freshness: delayed ? "delayed" : "live",
    marketDataMode: delayed ? "delayed" : "live",
    dataUpdatedAt: updatedAt,
    ageMs: getAgeMs(updatedAt),
    cacheAgeMs: null,
    latency: aggregate.latency ?? null,
    source: "massive",
  };
}

function getMassiveRealtimeSocketQuoteSnapshots(symbols: string[]): Array<
  QuoteSnapshot & {
    source: Exclude<StockQuoteSnapshotSource, "ibkr">;
  }
> {
  const quotesBySymbol = new Map<
    string,
    QuoteSnapshot & { source: Exclude<StockQuoteSnapshotSource, "ibkr"> }
  >();
  getCurrentMassiveStockQuoteSnapshots(symbols).forEach((quote) => {
    const symbol = normalizeSymbol(quote.symbol);
    if (symbol) {
      quotesBySymbol.set(
        symbol,
        enrichStockQuoteWithDayChangeContext({
          ...quote,
          source: "massive",
        }),
      );
    }
  });
  getCurrentStockMinuteAggregates(symbols).forEach((aggregate) => {
    const symbol = normalizeSymbol(aggregate.symbol);
    if (!symbol || quotesBySymbol.has(symbol)) {
      return;
    }
    const quote = massiveAggregateToBrokerQuote(aggregate);
    if (quote) {
      quotesBySymbol.set(symbol, enrichStockQuoteWithDayChangeContext(quote));
    }
  });
  return symbols.flatMap((symbol) => {
    const quote = quotesBySymbol.get(symbol);
    return quote ? [quote] : [];
  });
}

type GetQuoteSnapshotsInput = {
  symbols: string;
  allowMassiveFallback?: boolean;
  admissionOwner?: string;
  admissionIntent?: MarketDataIntent;
  admissionFallbackProvider?: MarketDataFallbackProvider;
  ttlMs?: number | null;
  tradingSession?: "overnight" | null;
};

type QuoteSnapshotsServiceResponse = {
  quotes: Array<QuoteSnapshot & { source: StockQuoteSnapshotSource }>;
  transport: unknown | null;
  delayed: boolean;
  fallbackUsed: boolean;
};

type QuoteSnapshotCacheEntry = {
  cachedAt: number;
  expiresAt: number;
  staleExpiresAt: number;
  value: QuoteSnapshotsServiceResponse;
};

const quoteSnapshotCache = new Map<string, QuoteSnapshotCacheEntry>();
const quoteSnapshotInFlight = new Map<
  string,
  Promise<QuoteSnapshotsServiceResponse>
>();
const massiveQuoteDayChangeContextInFlight = new Map<
  string,
  Promise<Array<QuoteSnapshot & { source: Exclude<StockQuoteSnapshotSource, "ibkr"> }>>
>();
let quoteSnapshotCacheTtlMsForTests: number | null = null;
let quoteSnapshotStaleTtlMsForTests: number | null = null;
let quoteSnapshotStaleWaitMsForTests: number | null = null;

function quoteSnapshotCacheTtlMs(): number {
  return (
    quoteSnapshotCacheTtlMsForTests ??
    positiveIntegerEnv("QUOTE_SNAPSHOT_CACHE_TTL_MS", 1_000)
  );
}

function quoteSnapshotStaleTtlMs(): number {
  return (
    quoteSnapshotStaleTtlMsForTests ??
    positiveIntegerEnv("QUOTE_SNAPSHOT_STALE_TTL_MS", 60_000)
  );
}

function quoteSnapshotStaleWaitMs(): number {
  return (
    quoteSnapshotStaleWaitMsForTests ??
    positiveIntegerEnv("QUOTE_SNAPSHOT_STALE_WAIT_MS", 1_500)
  );
}

function quoteSnapshotHealthTimeoutMs(): number {
  return positiveIntegerEnv("QUOTE_SNAPSHOT_HEALTH_TIMEOUT_MS", 750);
}

function quoteSnapshotBridgeFetchTimeoutMs(): number {
  return positiveIntegerEnv("QUOTE_SNAPSHOT_BRIDGE_FETCH_TIMEOUT_MS", 3_000);
}

function quoteSnapshotMassiveFallbackTimeoutMs(): number {
  return positiveIntegerEnv(
    "QUOTE_SNAPSHOT_MASSIVE_FALLBACK_TIMEOUT_MS",
    2_000,
  );
}

async function refreshMassiveQuoteDayChangeContext(
  symbols: string[],
): Promise<
  Array<QuoteSnapshot & { source: Exclude<StockQuoteSnapshotSource, "ibkr"> }>
> {
  const missingOrStaleSymbols = getSymbolsNeedingStockQuoteDayChangeContext(
    symbols,
  );
  if (!missingOrStaleSymbols.length || !getMassiveRuntimeConfig()) {
    return [];
  }

  const key = missingOrStaleSymbols.join(",");
  const existing = massiveQuoteDayChangeContextInFlight.get(key);
  if (existing) {
    return existing;
  }

  let request!: Promise<
    Array<QuoteSnapshot & { source: Exclude<StockQuoteSnapshotSource, "ibkr"> }>
  >;
  request = withTimeout(
    getMassiveClient().getQuoteSnapshots(missingOrStaleSymbols),
    quoteSnapshotMassiveFallbackTimeoutMs(),
    () =>
      new Error(
        `Quote snapshot Massive day-change context timed out after ${quoteSnapshotMassiveFallbackTimeoutMs()}ms.`,
      ),
  )
    .then((quotes) => {
      const mapped = quotes.map(massiveQuoteToBrokerQuote);
      recordStockQuoteDayChangeContexts(mapped);
      return mapped;
    })
    .catch((error): Array<
      QuoteSnapshot & { source: Exclude<StockQuoteSnapshotSource, "ibkr"> }
    > => {
      logger.debug(
        { err: error, symbols: missingOrStaleSymbols },
        "Massive quote day-change context refresh failed",
      );
      return [];
    })
    .finally(() => {
      if (massiveQuoteDayChangeContextInFlight.get(key) === request) {
        massiveQuoteDayChangeContextInFlight.delete(key);
      }
    });

  massiveQuoteDayChangeContextInFlight.set(key, request);
  return request;
}

function quoteSnapshotCacheKey(input: {
  symbols: string[];
  allowMassiveFallback?: boolean;
  admissionOwner?: string | null;
  admissionIntent?: MarketDataIntent | null;
  admissionFallbackProvider?: MarketDataFallbackProvider | null;
  tradingSession?: "overnight" | null;
}): string {
  const providerMode = isMassiveStocksRealtimeConfigured()
    ? "massive"
    : input.allowMassiveFallback === true
      ? "massive"
      : "ibkr";
  const ownerKey = input.admissionOwner
    ? `:${input.admissionOwner}:${input.admissionIntent ?? ""}:${
        input.admissionFallbackProvider ?? ""
      }`
    : "";
  const sessionKey = input.tradingSession ? `:${input.tradingSession}` : "";
  return `${providerMode}:${input.symbols.join(",")}${ownerKey}${sessionKey}`;
}

function markQuoteSnapshotResponseStale(
  entry: QuoteSnapshotCacheEntry,
  now: number,
): QuoteSnapshotsServiceResponse {
  return {
    ...entry.value,
    quotes: entry.value.quotes.map((quote) => {
      const updatedAtMs =
        quote.updatedAt instanceof Date
          ? quote.updatedAt.getTime()
          : new Date(quote.updatedAt).getTime();
      return {
        ...quote,
        freshness: "stale" as const,
        cacheAgeMs: Math.max(0, now - entry.cachedAt),
        ageMs: Number.isFinite(updatedAtMs)
          ? Math.max(0, now - updatedAtMs)
          : (quote.ageMs ?? null),
      };
    }),
  };
}

async function resolveQuoteSnapshotRequest(
  request: Promise<QuoteSnapshotsServiceResponse>,
  cached: QuoteSnapshotCacheEntry | undefined,
): Promise<QuoteSnapshotsServiceResponse> {
  const now = Date.now();
  if (!cached || cached.staleExpiresAt <= now) {
    return request;
  }

  return Promise.race([
    request,
    new Promise<QuoteSnapshotsServiceResponse>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(markQuoteSnapshotResponseStale(cached, Date.now()));
      }, quoteSnapshotStaleWaitMs());
      timeout.unref?.();
    }),
  ]);
}

async function getQuoteSnapshotsUncached(input: {
  symbolsList: string[];
  allowMassiveFallback?: boolean;
  admissionOwner?: string;
  admissionIntent?: MarketDataIntent;
  admissionFallbackProvider?: MarketDataFallbackProvider;
  ttlMs?: number | null;
  tradingSession?: "overnight" | null;
}): Promise<QuoteSnapshotsServiceResponse> {
  const symbols = input.symbolsList;
  if (!symbols.length) {
    return {
      quotes: [],
      transport: null,
      delayed: false,
      fallbackUsed: false,
    };
  }
  const massiveConfig = getMassiveRuntimeConfig();
  const useMassiveRealtimePrimary =
    input.tradingSession !== "overnight" &&
    isMassiveStocksRealtimeConfigured(massiveConfig);
  if (useMassiveRealtimePrimary) {
    const contextQuotes = await refreshMassiveQuoteDayChangeContext(symbols);
    const quotesBySymbol = new Map<
      string,
      QuoteSnapshot & { source: Exclude<StockQuoteSnapshotSource, "ibkr"> }
    >();
    contextQuotes.forEach((quote) => {
      const symbol = normalizeSymbol(quote.symbol);
      if (symbol) {
        quotesBySymbol.set(symbol, quote);
      }
    });
    getMassiveRealtimeSocketQuoteSnapshots(symbols).forEach((quote) => {
      const symbol = normalizeSymbol(quote.symbol);
      if (symbol) {
        quotesBySymbol.set(symbol, quote);
      }
    });
    const quotes = symbols.flatMap((symbol) => {
      const quote = quotesBySymbol.get(symbol);
      return quote ? [quote] : [];
    });
    const liveSymbols = new Set(
      getMassiveRealtimeSocketQuoteSnapshots(symbols).map((quote) =>
        normalizeSymbol(quote.symbol),
      ),
    );

    return {
      quotes,
      transport: quotes[0]?.transport ?? null,
      delayed: quotes.some((quote) => quote.delayed),
      fallbackUsed: contextQuotes.some(
        (quote) => !liveSymbols.has(normalizeSymbol(quote.symbol)),
      ),
    };
  }
  const bridgeClient = getIbkrClient();
  type BridgeQuoteSnapshotPayload = Awaited<
    ReturnType<typeof fetchBridgeQuoteSnapshots>
  >;
  const [bridgeHealth, payload] = await Promise.all([
    withTimeout(
      bridgeClient.getHealth(),
      quoteSnapshotHealthTimeoutMs(),
      () =>
        new Error(
          `Quote snapshot bridge health timed out after ${quoteSnapshotHealthTimeoutMs()}ms.`,
        ),
    ).catch(() => null),
    withTimeout(
      fetchBridgeQuoteSnapshots(symbols, {
        owner: input.admissionOwner,
        intent: input.admissionIntent,
        fallbackProvider:
          input.admissionFallbackProvider ??
          (input.allowMassiveFallback === true ? "massive" : "cache"),
        ttlMs: input.ttlMs,
        tradingSession: input.tradingSession,
      }),
      quoteSnapshotBridgeFetchTimeoutMs(),
      () =>
        new Error(
          `Quote snapshot bridge fetch timed out after ${quoteSnapshotBridgeFetchTimeoutMs()}ms.`,
        ),
    ).catch((): BridgeQuoteSnapshotPayload => ({ quotes: [] })),
  ]);
  const ibkrQuotes = payload.quotes;
  const ibkrSymbols = new Set(
    ibkrQuotes.map((quote) => normalizeSymbol(quote.symbol)),
  );
  const missingSymbols = symbols.filter((symbol) => !ibkrSymbols.has(symbol));
  let massiveQuotes: Array<
    QuoteSnapshot & { source: Exclude<StockQuoteSnapshotSource, "ibkr"> }
  > = [];

  if (
    input.allowMassiveFallback === true &&
    missingSymbols.length > 0 &&
    massiveConfig
  ) {
    try {
      massiveQuotes = (
        await withTimeout(
          getMassiveClient().getQuoteSnapshots(missingSymbols),
          quoteSnapshotMassiveFallbackTimeoutMs(),
          () =>
            new Error(
              `Quote snapshot Massive fallback timed out after ${quoteSnapshotMassiveFallbackTimeoutMs()}ms.`,
            ),
        )
      ).map(massiveQuoteToBrokerQuote);
      recordStockQuoteDayChangeContexts(massiveQuotes);
      massiveQuotes.forEach((quote) => {
        recordMarketDataFallback({
          owner: "quote-snapshot",
          intent: "visible-live",
          fallbackProvider: quote.source === "massive" ? "massive" : "massive",
          reason: "ibkr_missing_or_not_admitted",
          instrumentKey: `equity:${quote.symbol}`,
        });
      });
    } catch {
      massiveQuotes = [];
    }
  }
  const quotesBySymbol = new Map<
    string,
    QuoteSnapshot & { source: StockQuoteSnapshotSource }
  >();
  ibkrQuotes.forEach((quote) => {
    quotesBySymbol.set(normalizeSymbol(quote.symbol), {
      ...quote,
      providerContractId: quote.providerContractId ?? null,
      source: "ibkr" as const,
    });
  });
  massiveQuotes.forEach((quote) => {
    const symbol = normalizeSymbol(quote.symbol);
    if (!quotesBySymbol.has(symbol)) {
      quotesBySymbol.set(symbol, quote);
    }
  });
  const quotes = symbols.flatMap((symbol) => {
    const quote = quotesBySymbol.get(symbol);
    return quote ? [quote] : [];
  });

  return {
    quotes,
    transport: quotes[0]?.transport ?? bridgeHealth?.transport ?? null,
    delayed: quotes.some((quote) => quote.delayed),
    fallbackUsed: massiveQuotes.length > 0,
  };
}

function pruneQuoteSnapshotCache(now: number): void {
  // The entry TTL fields only gate fresh-vs-stale at read time; without this
  // eviction pass expired entries are never freed, so the cache would grow one
  // entry per distinct symbol-set seen for the whole process lifetime. Dropping
  // entries past their stale window keeps the cache proportional to live demand
  // within the stale TTL instead.
  for (const [key, entry] of quoteSnapshotCache) {
    if (entry.staleExpiresAt <= now) {
      quoteSnapshotCache.delete(key);
    }
  }
}

export async function getQuoteSnapshots(
  input: GetQuoteSnapshotsInput,
): Promise<QuoteSnapshotsServiceResponse> {
  const symbols = input.symbols
    .split(",")
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean);
  const allowMassiveFallback = input.allowMassiveFallback === true;
  const key = quoteSnapshotCacheKey({
    symbols,
    allowMassiveFallback,
    admissionOwner: input.admissionOwner,
    admissionIntent: input.admissionIntent,
    admissionFallbackProvider: input.admissionFallbackProvider,
    tradingSession: input.tradingSession,
  });
  const now = Date.now();
  const cached = quoteSnapshotCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const existingRequest = quoteSnapshotInFlight.get(key);
  if (existingRequest) {
    return resolveQuoteSnapshotRequest(existingRequest, cached);
  }

  const request = getQuoteSnapshotsUncached({
    symbolsList: symbols,
    allowMassiveFallback,
    admissionOwner: input.admissionOwner,
    admissionIntent: input.admissionIntent,
    admissionFallbackProvider: input.admissionFallbackProvider,
    ttlMs: input.ttlMs,
    tradingSession: input.tradingSession,
  })
    .then((value) => {
      const cachedAt = Date.now();
      quoteSnapshotCache.set(key, {
        value,
        cachedAt,
        expiresAt: cachedAt + quoteSnapshotCacheTtlMs(),
        staleExpiresAt: cachedAt + quoteSnapshotStaleTtlMs(),
      });
      pruneQuoteSnapshotCache(cachedAt);
      return value;
    })
    .finally(() => {
      if (quoteSnapshotInFlight.get(key) === request) {
        quoteSnapshotInFlight.delete(key);
      }
    });
  quoteSnapshotInFlight.set(key, request);
  request.catch((error) => {
    logger.debug({ err: error, key }, "Quote snapshot refresh failed");
  });

  return resolveQuoteSnapshotRequest(request, cached);
}

export async function getNews(input: { ticker?: string; limit?: number }) {
  // IBKR is the primary news source (user has Reuters subscription via IBKR).
  // We only fall back to Massive when IBKR returns no headlines — typically
  // for tickerless requests, since IBKR's /iserver/news requires a conid.
  const ibkrClient = getIbkrClient();
  let articles: Awaited<ReturnType<IbkrBridgeClient["getNews"]>> = [];
  try {
    articles = await ibkrClient.getNews(input);
  } catch {
    articles = [];
  }

  if (articles.length === 0 && getMassiveRuntimeConfig()) {
    try {
      const massiveArticles = await getMassiveClient().getNews(input);
      return { articles: massiveArticles };
    } catch {
      // fall through to empty IBKR result
    }
  }

  return { articles };
}

type SearchUniverseTickersInput = {
  search?: string;
  market?: UniverseMarket;
  markets?: UniverseMarket[];
  type?: string;
  active?: boolean;
  limit?: number;
  mode?: "search" | "trade-resolve";
  strictTrade?: boolean;
};

type SearchUniverseTickersOptions = {
  signal?: AbortSignal;
};

type UniverseSearchResponse = { count: number; results: UniverseTicker[] };
type UniverseLogoRecord = {
  symbol: string;
  logoUrl: string | null;
  source: "tradingview" | "massive" | "fmp" | "none";
  assetType: "symbol_icon" | "provider_logo" | "unknown";
  confidence: number;
  updatedAt: string;
};

const UNIVERSE_LOGO_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const UNIVERSE_LOGO_BATCH_LIMIT = 50;
const TRADINGVIEW_SYMBOL_LOGO_BASE_URL =
  "https://s3-symbol-logo.tradingview.com";
const TRADINGVIEW_LOGO_SLUGS: Record<string, string> = {
  AAPL: "apple",
  ABBV: "abbvie",
  ABNB: "airbnb",
  AMD: "advanced-micro-devices",
  AMZN: "amazon",
  ARM: "arm",
  AVGO: "broadcom",
  BAC: "bank-of-america",
  BRK: "berkshire-hathaway",
  "BRK.B": "berkshire-hathaway",
  COIN: "coinbase",
  COST: "costco-wholesale",
  CRM: "salesforce",
  CVX: "chevron",
  DIS: "walt-disney",
  GOOGL: "alphabet",
  GOOG: "alphabet",
  HD: "home-depot",
  HOOD: "robinhood",
  INTC: "intel",
  JPM: "jpmorgan-chase",
  MA: "mastercard",
  META: "meta-platforms",
  MSFT: "microsoft",
  MU: "micron-technology",
  NFLX: "netflix",
  NVDA: "nvidia",
  ORCL: "oracle",
  PLTR: "palantir",
  QCOM: "qualcomm",
  SHOP: "shopify",
  TSLA: "tesla",
  TSM: "taiwan-semiconductor",
  UNH: "unitedhealth",
  V: "visa",
  WMT: "walmart",
  XOM: "exxon-mobil",
};
const universeLogoCache = new Map<
  string,
  { expiresAt: number; value: UniverseLogoRecord }
>();
const universeLogoInFlight = new Map<string, Promise<UniverseLogoRecord>>();

function pruneUniverseLogoCache(now: number): void {
  for (const [key, entry] of universeLogoCache) {
    if (entry.expiresAt <= now) {
      universeLogoCache.delete(key);
    }
  }
}
type UniverseCatalogSearchResponse = UniverseSearchResponse & {
  listingRows: UniverseCatalogListingHydrationRecord[];
};

const ALL_UNIVERSE_MARKETS: UniverseMarket[] = [
  "stocks",
  "etf",
  "indices",
  "futures",
  "fx",
  "crypto",
  "otc",
];
const MASSIVE_SEARCH_MARKETS: UniverseMarket[] = [
  "stocks",
  "etf",
  "indices",
  "fx",
  "crypto",
  "otc",
];
const INTERACTIVE_IBKR_MARKET_GROUPS: UniverseMarket[][] = [
  ["stocks", "etf", "otc"],
  ["indices"],
  ["futures"],
  ["fx"],
  ["crypto"],
];
const UNIVERSE_SEARCH_DEFAULT_LIMIT = 40;
const UNIVERSE_SEARCH_CACHE_TTL_MS = 30_000;
const UNIVERSE_SEARCH_IBKR_BUDGET_MS = 6_000;
const UNIVERSE_SEARCH_MASSIVE_EXACT_BUDGET_MS = 1_500;
const UNIVERSE_SEARCH_BACKGROUND_BUDGET_MS = 12_000;
const UNIVERSE_CATALOG_IBKR_HYDRATION_QUEUE_CONCURRENCY = 2;
const UNIVERSE_CATALOG_IBKR_RETRY_COOLDOWN_MS = 30 * 60_000;
const universeSearchCache = new Map<
  string,
  { expiresAt: number; data: UniverseSearchResponse }
>();
const universeSearchInFlight = new Map<
  string,
  {
    controller: AbortController;
    consumers: number;
    settled: boolean;
    promise: Promise<UniverseSearchResponse>;
  }
>();
const universeSearchBackgroundInFlight = new Set<string>();
const universeCatalogIbkrHydrationQueue: string[] = [];
const universeCatalogIbkrHydrationQueued = new Set<string>();
const universeCatalogIbkrHydrationInFlight = new Set<string>();

const EXCHANGE_MIC_ALIASES: Record<string, string> = {
  NASDAQ: "XNAS",
  NASD: "XNAS",
  NMS: "XNAS",
  XNAS: "XNAS",
  NYSE: "XNYS",
  NYS: "XNYS",
  ARCA: "ARCX",
  ARCX: "ARCX",
  XNYS: "XNYS",
  AMEX: "XASE",
  ASE: "XASE",
  XASE: "XASE",
  CME: "XCME",
  GLOBEX: "XCME",
  XCME: "XCME",
  CBOE: "XCBO",
  BATS: "BATS",
  OTC: "OTC",
  OTCM: "OTC",
  PINK: "OTC",
  PINX: "OTC",
  OTCLINK: "OTC",
};
const US_PRIMARY_EXCHANGE_MICS = new Set([
  "XNAS",
  "XNYS",
  "ARCX",
  "XASE",
  "BATS",
]);
const US_EXCHANGE_PREFERENCE_SCORE: Record<string, number> = {
  XNAS: 680,
  XNYS: 660,
  ARCX: 640,
  XASE: 520,
  BATS: 500,
};
const FX_CURRENCY_CODES = new Set([
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNH",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "ILS",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
]);
const INDEX_TICKER_HINTS = new Set([
  "DJI",
  "DOW",
  "MID",
  "NDX",
  "NYA",
  "OEX",
  "RUA",
  "RUT",
  "RVX",
  "SKEW",
  "SOX",
  "SPX",
  "VIX",
  "VXN",
  "XAU",
]);
const CRYPTO_TICKER_HINTS = new Set([
  "AAVE",
  "ADA",
  "ATOM",
  "AVAX",
  "BCH",
  "BTC",
  "DOGE",
  "DOT",
  "ETC",
  "ETH",
  "LINK",
  "LTC",
  "MATIC",
  "SHIB",
  "SOL",
  "UNI",
  "XLM",
  "XRP",
]);
const FUTURES_TICKER_HINTS = new Set([
  "6A",
  "6B",
  "6C",
  "6E",
  "6J",
  "6N",
  "6S",
  "CL",
  "ES",
  "GC",
  "GF",
  "HE",
  "HG",
  "HO",
  "KE",
  "LE",
  "M2K",
  "M6E",
  "MCL",
  "MES",
  "MGC",
  "MNQ",
  "MYM",
  "NG",
  "NQ",
  "PA",
  "PL",
  "RB",
  "RTY",
  "SI",
  "UB",
  "YM",
  "ZB",
  "ZC",
  "ZF",
  "ZL",
  "ZM",
  "ZN",
  "ZS",
  "ZT",
  "ZW",
]);

function normalizeTickerSearchQuery(value: string) {
  return normalizeSymbol(value).toUpperCase();
}

function normalizeUniverseSearchInput(value: string) {
  const raw = value
    .trim()
    .toUpperCase()
    .replace(/^[\s$^]+/, "");
  if (!raw) return "";

  const compact = raw.replace(/^X:/, "").replace(/[\s./-]+/g, "");
  if (
    /^[A-Z]{6}$/.test(compact) &&
    FX_CURRENCY_CODES.has(compact.slice(0, 3)) &&
    FX_CURRENCY_CODES.has(compact.slice(3))
  ) {
    return compact.slice(0, 3);
  }

  const cryptoBase = compact.endsWith("USD") ? compact.slice(0, -3) : compact;
  if (CRYPTO_TICKER_HINTS.has(cryptoBase)) {
    return cryptoBase;
  }

  const shareClass = /^([A-Z]{1,5})[ .\/-]([A-Z]{1,2})$/.exec(raw);
  if (shareClass) {
    return `${shareClass[1]}.${shareClass[2]}`;
  }

  return normalizeSymbol(raw);
}

function isLikelyFxTickerSearch(query: string) {
  const normalized = normalizeTickerSearchQuery(query);
  if (FX_CURRENCY_CODES.has(normalized)) return true;
  if (!/^[A-Z]{6}$/.test(normalized)) return false;
  return (
    FX_CURRENCY_CODES.has(normalized.slice(0, 3)) &&
    FX_CURRENCY_CODES.has(normalized.slice(3))
  );
}

function isLikelyIndexTickerSearch(query: string) {
  return INDEX_TICKER_HINTS.has(normalizeTickerSearchQuery(query));
}

function isLikelyCryptoTickerSearch(query: string) {
  const normalized = normalizeTickerSearchQuery(query).replace(/^X:/, "");
  if (CRYPTO_TICKER_HINTS.has(normalized)) return true;
  return (
    normalized.endsWith("USD") &&
    CRYPTO_TICKER_HINTS.has(normalized.slice(0, -3))
  );
}

function isLikelyFuturesTickerSearch(query: string) {
  return FUTURES_TICKER_HINTS.has(normalizeTickerSearchQuery(query));
}

function getInteractivePrimaryUniverseMarkets(
  normalizedSearch: string,
  requestedMarkets: UniverseMarket[],
) {
  const requestedMarketSet = new Set(requestedMarkets);
  const primaryMarkets: UniverseMarket[] = [];

  if (
    isLikelyFxTickerSearch(normalizedSearch) &&
    requestedMarketSet.has("fx")
  ) {
    primaryMarkets.push("fx");
  }
  if (
    isLikelyCryptoTickerSearch(normalizedSearch) &&
    requestedMarketSet.has("crypto")
  ) {
    primaryMarkets.push("crypto");
  }
  if (
    isLikelyIndexTickerSearch(normalizedSearch) &&
    requestedMarketSet.has("indices")
  ) {
    primaryMarkets.push("indices");
  }
  if (
    isLikelyFuturesTickerSearch(normalizedSearch) &&
    requestedMarketSet.has("futures")
  ) {
    primaryMarkets.push("futures");
  }

  if (primaryMarkets.length > 0) {
    return primaryMarkets;
  }

  return (["stocks", "etf", "otc"] as const).filter((market) =>
    requestedMarketSet.has(market),
  );
}

function getInteractiveIbkrMarketGroupKey(markets: UniverseMarket[]) {
  return markets.join("+");
}

function resolveRequestedUniverseMarkets(input: SearchUniverseTickersInput) {
  const raw = input.markets?.length
    ? input.markets
    : input.market
      ? [input.market]
      : ALL_UNIVERSE_MARKETS;
  const allowed = new Set(ALL_UNIVERSE_MARKETS);
  return Array.from(new Set(raw.filter((market) => allowed.has(market))));
}

function normalizeExchangeMic(
  exchange: string | null | undefined,
  market: UniverseMarket,
) {
  const raw = exchange?.trim().toUpperCase() ?? "";
  if (!raw) {
    if (market === "fx") return "FX";
    if (market === "crypto") return "COIN";
    if (market === "futures") return "FUT";
    return "";
  }
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  return EXCHANGE_MIC_ALIASES[compact] ?? compact;
}

function extractExchangeHintFromText(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  const match = text.match(/\(([A-Z0-9._ -]{2,16})\)\s*$/);
  return match?.[1]?.trim() ?? null;
}

function inferLegacyIbkrUniverseMarket(ticker: UniverseTicker): UniverseMarket {
  if (ticker.provider !== "ibkr" || ticker.market !== "stocks") {
    return ticker.market;
  }

  const type = ticker.type?.trim().toUpperCase() ?? "";
  const name = ticker.name.trim().toUpperCase();

  if (type === "ETF") return "etf";
  if (
    type === "STK" &&
    /\b(ETF|ETN|ETP|UCITS|SPDR|ISHARES|PROSHARES|INVESCO|VANGUARD|DIREXION|WISDOMTREE|GLOBAL X|GRAYSCALE)\b/.test(
      name,
    )
  ) {
    return "etf";
  }

  return ticker.market;
}

function normalizeRootSymbol(ticker: UniverseTicker) {
  const root =
    ticker.rootSymbol?.trim() ||
    normalizeSymbol(ticker.ticker)
      .replace(/^X:/, "")
      .split(/[./:\s-]+/)[0] ||
    normalizeSymbol(ticker.ticker);
  return normalizeSymbol(root);
}

function hydrateUniverseTickerMetadata(ticker: UniverseTicker): UniverseTicker {
  const normalizedTicker = normalizeSymbol(ticker.ticker);
  const market = inferLegacyIbkrUniverseMarket(ticker);
  const exchangeHint =
    ticker.normalizedExchangeMic ??
    ticker.primaryExchange ??
    ticker.exchangeDisplay ??
    extractExchangeHintFromText(ticker.name) ??
    extractExchangeHintFromText(ticker.contractDescription);
  const normalizedExchangeMic = normalizeExchangeMic(exchangeHint, market);
  const providers = Array.from(
    new Set(
      [
        ...(ticker.providers ?? []),
        ...(ticker.provider ? [ticker.provider] : []),
      ].filter(
        (provider): provider is MarketDataProvider =>
          provider === "ibkr" ||
          provider === "massive" ||
          provider === "massive",
      ),
    ),
  ).sort((left, right) =>
    left === "ibkr" ? -1 : right === "ibkr" ? 1 : left.localeCompare(right),
  );
  const dataProviderPreference =
    ticker.dataProviderPreference ??
    (providers.includes("massive")
      ? "massive"
      : providers.includes("massive")
        ? "massive"
        : providers.includes("ibkr")
          ? "ibkr"
          : null);
  const tradeProvider =
    ticker.tradeProvider ??
    (ticker.providerContractId && providers.includes("ibkr") ? "ibkr" : null);
  const identityMetadata = resolveMarketIdentityMetadata({
    ...ticker,
    ticker: normalizedTicker,
    market,
    normalizedExchangeMic,
    exchangeDisplay:
      ticker.exchangeDisplay ??
      ticker.primaryExchange ??
      exchangeHint ??
      (normalizedExchangeMic || null),
  });

  return {
    ...ticker,
    ticker: normalizedTicker,
    market,
    rootSymbol: ticker.rootSymbol ?? normalizeRootSymbol(ticker),
    normalizedExchangeMic,
    exchangeDisplay:
      ticker.exchangeDisplay ??
      ticker.primaryExchange ??
      exchangeHint ??
      (normalizedExchangeMic || null),
    logoUrl: ticker.logoUrl ?? null,
    countryCode: identityMetadata.countryCode,
    exchangeCountryCode: identityMetadata.exchangeCountryCode,
    sector: identityMetadata.sector,
    industry: identityMetadata.industry,
    contractDescription: ticker.contractDescription ?? ticker.name,
    contractMeta: ticker.contractMeta ?? null,
    providers,
    provider: tradeProvider ?? ticker.provider ?? dataProviderPreference,
    tradeProvider,
    dataProviderPreference,
  };
}

function normalizeUniverseTickerContractMeta(
  value: unknown,
): UniverseTicker["contractMeta"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const normalizedEntries = Object.entries(
    value as Record<string, unknown>,
  ).filter(
    ([, entryValue]) =>
      typeof entryValue === "string" ||
      typeof entryValue === "number" ||
      typeof entryValue === "boolean" ||
      entryValue === null,
  );

  return normalizedEntries.length
    ? (Object.fromEntries(normalizedEntries) as NonNullable<
        UniverseTicker["contractMeta"]
      >)
    : null;
}

type UniverseCatalogListingRecord =
  typeof universeCatalogListingsTable.$inferSelect;

type SqlCondition = SQL<unknown>;
type UniverseCatalogHydrationStatus =
  | "pending"
  | "hydrated"
  | "not_found"
  | "ambiguous"
  | "failed";
type UniverseCatalogListingHydrationRecord = UniverseCatalogListingRecord & {
  ibkrHydrationStatus: UniverseCatalogHydrationStatus;
  ibkrHydrationAttemptedAt: Date | null;
  ibkrHydratedAt: Date | null;
  ibkrHydrationError: string | null;
};

function normalizeUniverseCatalogName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

type UniverseCatalogListingUpdateSet = PgUpdateSetSource<
  typeof universeCatalogListingsTable
>;

function normalizeUniverseCatalogHydrationStatus(
  value: string | null | undefined,
): UniverseCatalogHydrationStatus {
  switch (value) {
    case "hydrated":
    case "not_found":
    case "ambiguous":
    case "failed":
      return value;
    default:
      return "pending";
  }
}

function buildUniverseCatalogHydrationState(ticker: UniverseTicker): {
  ibkrHydrationStatus: UniverseCatalogHydrationStatus;
  ibkrHydrationAttemptedAt: Date | null;
  ibkrHydratedAt: Date | null;
  ibkrHydrationError: string | null;
} {
  const hasIbkrMapping =
    ticker.tradeProvider === "ibkr" &&
    ticker.providers.includes("ibkr") &&
    Boolean(ticker.providerContractId);
  const now = hasIbkrMapping ? new Date() : null;

  return {
    ibkrHydrationStatus: hasIbkrMapping ? "hydrated" : "pending",
    ibkrHydrationAttemptedAt: now,
    ibkrHydratedAt: now,
    ibkrHydrationError: null,
  };
}

function buildUniverseCatalogListingKey(ticker: UniverseTicker) {
  const hydrated = hydrateUniverseTickerMetadata(ticker);
  return [
    hydrated.ticker,
    hydrated.market,
    hydrated.normalizedExchangeMic ?? "",
  ].join("|");
}

function mapUniverseCatalogRowToUniverseTicker(
  row: UniverseCatalogListingRecord,
): UniverseTicker {
  const hydrationRow = row as UniverseCatalogListingHydrationRecord;
  const hydrationStatus = normalizeUniverseCatalogHydrationStatus(
    hydrationRow.ibkrHydrationStatus,
  );
  return hydrateUniverseTickerMetadata({
    ticker: row.ticker,
    name: row.name,
    market: row.market,
    rootSymbol: row.rootSymbol ?? null,
    normalizedExchangeMic: row.normalizedExchangeMic ?? null,
    exchangeDisplay: row.exchangeDisplay ?? null,
    logoUrl: null,
    countryCode: null,
    exchangeCountryCode: null,
    sector: null,
    industry: null,
    contractDescription: row.contractDescription ?? null,
    locale: row.locale ?? null,
    type: row.type ?? null,
    active: row.active,
    primaryExchange: row.primaryExchange ?? null,
    currencyName: row.currencyName ?? null,
    cik: row.cik ?? null,
    compositeFigi: row.compositeFigi ?? null,
    shareClassFigi: row.shareClassFigi ?? null,
    lastUpdatedAt: row.lastUpdatedAt ? new Date(row.lastUpdatedAt) : null,
    provider: (row.tradeProvider as MarketDataProvider | null) ?? null,
    providers: (row.providers ?? []).filter(
      (provider): provider is MarketDataProvider =>
        provider === "ibkr" || provider === "massive",
    ),
    tradeProvider: (row.tradeProvider as MarketDataProvider | null) ?? null,
    dataProviderPreference:
      (row.dataProviderPreference as MarketDataProvider | null) ?? null,
    providerContractId: row.providerContractId ?? null,
    contractMeta: {
      ...(normalizeUniverseTickerContractMeta(row.contractMeta) ?? {}),
      catalogHydrationStatus: hydrationStatus,
      catalogHydrationPending:
        hydrationStatus !== "hydrated" && !row.providerContractId,
    },
  });
}

function buildUniverseCatalogRow(ticker: UniverseTicker) {
  const hydrated = hydrateUniverseTickerMetadata(ticker);
  const hydrationState = buildUniverseCatalogHydrationState(hydrated);
  return {
    listingKey: buildUniverseCatalogListingKey(hydrated),
    market: hydrated.market,
    ticker: hydrated.ticker,
    normalizedTicker: hydrated.ticker,
    rootSymbol: hydrated.rootSymbol ?? null,
    name: hydrated.name,
    normalizedName: normalizeUniverseCatalogName(hydrated.name),
    normalizedExchangeMic: hydrated.normalizedExchangeMic ?? null,
    exchangeDisplay: hydrated.exchangeDisplay ?? null,
    locale: hydrated.locale ?? null,
    type: hydrated.type ?? null,
    active: hydrated.active,
    primaryExchange: hydrated.primaryExchange ?? null,
    currencyName: hydrated.currencyName ?? null,
    cik: hydrated.cik ?? null,
    compositeFigi: hydrated.compositeFigi ?? null,
    shareClassFigi: hydrated.shareClassFigi ?? null,
    providerContractId: hydrated.providerContractId ?? null,
    providers: hydrated.providers,
    tradeProvider: hydrated.tradeProvider ?? null,
    dataProviderPreference: hydrated.dataProviderPreference ?? null,
    ibkrHydrationStatus: hydrationState.ibkrHydrationStatus,
    ibkrHydrationAttemptedAt: hydrationState.ibkrHydrationAttemptedAt,
    ibkrHydratedAt: hydrationState.ibkrHydratedAt,
    ibkrHydrationError: hydrationState.ibkrHydrationError,
    contractDescription: hydrated.contractDescription ?? null,
    contractMeta: hydrated.contractMeta ?? null,
    lastUpdatedAt: hydrated.lastUpdatedAt ?? null,
    lastSeenAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildUniverseTickerMergeKey(ticker: UniverseTicker) {
  const hydrated = hydrateUniverseTickerMetadata(ticker);
  return [
    normalizeRootSymbol(hydrated),
    hydrated.market,
    hydrated.normalizedExchangeMic ?? "",
  ].join("|");
}

function buildTickerSearchAliases(ticker: UniverseTicker): string[] {
  const normalizedTicker = normalizeSymbol(ticker.ticker);
  const withoutProviderPrefix = normalizedTicker.replace(/^[A-Z]:/, "");
  const aliases = new Set([
    normalizedTicker,
    withoutProviderPrefix,
    normalizeRootSymbol(ticker),
  ]);

  if (ticker.market === "crypto" && withoutProviderPrefix.endsWith("USD")) {
    aliases.add(withoutProviderPrefix.slice(0, -3));
  }
  if (ticker.market === "crypto" && !withoutProviderPrefix.endsWith("USD")) {
    aliases.add(`${withoutProviderPrefix}USD`);
  }
  if (ticker.market === "fx" && /^[A-Z]{3}$/.test(withoutProviderPrefix)) {
    aliases.add(`${withoutProviderPrefix}USD`);
    aliases.add(`${withoutProviderPrefix}.USD`);
  }
  if (/^[A-Z]{1,5}\.[A-Z]{1,2}$/.test(withoutProviderPrefix)) {
    aliases.add(withoutProviderPrefix.replace(".", " "));
    aliases.add(withoutProviderPrefix.replace(".", ""));
  }

  return Array.from(aliases).filter(Boolean);
}

function mergeUniverseTicker(
  current: UniverseTicker | undefined,
  incoming: UniverseTicker,
): UniverseTicker {
  const next = hydrateUniverseTickerMetadata(incoming);
  if (!current) return next;

  const existing = hydrateUniverseTickerMetadata(current);
  const providers = Array.from(
    new Set([...existing.providers, ...next.providers]),
  ).sort((left, right) =>
    left === "ibkr" ? -1 : right === "ibkr" ? 1 : left.localeCompare(right),
  );
  const ibkrProviderContractId =
    existing.provider === "ibkr" || existing.tradeProvider === "ibkr"
      ? existing.providerContractId
      : next.provider === "ibkr" || next.tradeProvider === "ibkr"
        ? next.providerContractId
        : null;
  const providerContractId =
    ibkrProviderContractId ??
    existing.providerContractId ??
    next.providerContractId ??
    null;
  const tradeProvider =
    providerContractId && providers.includes("ibkr") ? "ibkr" : null;
  const dataProviderPreference = providers.includes("massive")
    ? "massive"
    : providers.includes("massive")
      ? "massive"
      : providers.includes("ibkr")
        ? "ibkr"
        : null;

  return {
    ...existing,
    ...next,
    name: next.name.length > existing.name.length ? next.name : existing.name,
    rootSymbol: existing.rootSymbol || next.rootSymbol,
    normalizedExchangeMic:
      existing.normalizedExchangeMic || next.normalizedExchangeMic,
    exchangeDisplay: existing.exchangeDisplay || next.exchangeDisplay,
    logoUrl: existing.logoUrl || next.logoUrl,
    countryCode: existing.countryCode || next.countryCode,
    exchangeCountryCode:
      existing.exchangeCountryCode || next.exchangeCountryCode,
    sector: existing.sector || next.sector,
    industry: existing.industry || next.industry,
    contractDescription:
      next.contractDescription &&
      next.contractDescription.length >
        (existing.contractDescription ?? "").length
        ? next.contractDescription
        : existing.contractDescription || next.contractDescription,
    contractMeta: {
      ...(existing.contractMeta ?? {}),
      ...(next.contractMeta ?? {}),
    },
    primaryExchange: existing.primaryExchange || next.primaryExchange,
    currencyName: existing.currencyName || next.currencyName,
    cik: existing.cik || next.cik,
    compositeFigi: existing.compositeFigi || next.compositeFigi,
    shareClassFigi: existing.shareClassFigi || next.shareClassFigi,
    lastUpdatedAt: existing.lastUpdatedAt || next.lastUpdatedAt,
    providers,
    provider: tradeProvider ?? dataProviderPreference ?? providers[0] ?? null,
    tradeProvider,
    dataProviderPreference,
    providerContractId,
  };
}

function scoreUniverseTicker(
  ticker: UniverseTicker,
  query: string,
  requestedMarkets: Set<UniverseMarket>,
): number {
  const normalizedTicker = normalizeSymbol(ticker.ticker);
  const normalizedName = ticker.name.trim().toLowerCase();
  const queryUpper = query.toUpperCase();
  const queryLower = query.toLowerCase();
  const tickerAliases = buildTickerSearchAliases(ticker);
  const strongNamePrefixMatch =
    normalizedName === queryLower || normalizedName.startsWith(queryLower);
  let score = 0;

  if (ticker.contractMeta?.identifierMatch) score += 3_000;
  if (ticker.providerContractId === query) score += 2_000;

  if (tickerAliases.includes(queryUpper)) score += 3_000;
  else if (normalizedTicker === queryUpper) score += 3_000;
  else if (normalizedTicker.startsWith(queryUpper)) score += 1_050;
  else if (normalizedTicker.includes(queryUpper)) score += 800;

  if (normalizedName === queryLower) score += 720;
  else if (normalizedName.startsWith(queryLower)) score += 560;
  else if (
    normalizedName.split(/[\s./-]+/).some((part) => part.startsWith(queryLower))
  ) {
    score += 500;
  } else if (normalizedName.includes(queryLower)) {
    score += 320;
  }

  if (requestedMarkets.has(ticker.market)) score += 80;
  if (ticker.providers.includes("ibkr")) score += 45;
  if (ticker.providerContractId) score += 30;
  if (
    ticker.providers.includes("massive") ||
    ticker.providers.includes("massive")
  )
    score += 12;
  if (ticker.active) score += 10;
  if (strongNamePrefixMatch) {
    if (/^[A-Z]{1,6}$/.test(normalizedTicker)) score += 180;
    if (/^\d/.test(normalizedTicker)) score -= 260;
    if (
      ticker.normalizedExchangeMic &&
      US_PRIMARY_EXCHANGE_MICS.has(ticker.normalizedExchangeMic) &&
      (ticker.market === "stocks" ||
        ticker.market === "etf" ||
        ticker.market === "otc")
    ) {
      score +=
        US_EXCHANGE_PREFERENCE_SCORE[ticker.normalizedExchangeMic] ?? 450;
      if (ticker.providers.includes("ibkr")) score += 160;
      if (ticker.providerContractId) score += 120;
    }
  }
  if (tickerAliases.includes(queryUpper)) {
    if (ticker.market === "fx" && isLikelyFxTickerSearch(queryUpper))
      score += 1_500;
    if (ticker.market === "crypto" && isLikelyCryptoTickerSearch(queryUpper))
      score += 1_500;
    if (ticker.market === "indices" && isLikelyIndexTickerSearch(queryUpper))
      score += 1_500;
    if (ticker.market === "futures" && isLikelyFuturesTickerSearch(queryUpper))
      score += 1_500;
  }
  if (
    ticker.normalizedExchangeMic &&
    US_PRIMARY_EXCHANGE_MICS.has(ticker.normalizedExchangeMic)
  ) {
    score +=
      tickerAliases.includes(queryUpper) &&
      (ticker.market === "stocks" ||
        ticker.market === "etf" ||
        ticker.market === "otc")
        ? (US_EXCHANGE_PREFERENCE_SCORE[ticker.normalizedExchangeMic] ?? 450)
        : 220;
  }
  if (ticker.normalizedExchangeMic || ticker.primaryExchange) score += 5;

  return score;
}

function getUniverseSearchCacheKey(
  input: SearchUniverseTickersInput,
  markets: UniverseMarket[],
  limit: number,
) {
  return JSON.stringify({
    search: input.search?.trim().toUpperCase() ?? "",
    market: input.market ?? null,
    markets: [...markets].sort(),
    type: input.type ?? null,
    active: input.active ?? null,
    mode: input.mode ?? (input.strictTrade ? "trade-resolve" : "search"),
    limit,
  });
}

function readUniverseSearchCache(key: string) {
  const cached = universeSearchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    universeSearchCache.delete(key);
    return null;
  }
  universeSearchCache.delete(key);
  universeSearchCache.set(key, cached);
  return sanitizeUniverseSearchResponse(cached.data);
}

function writeUniverseSearchCache(key: string, data: UniverseSearchResponse) {
  const sanitized = sanitizeUniverseSearchResponse(data);
  const now = Date.now();
  universeSearchCache.set(key, {
    expiresAt: now + UNIVERSE_SEARCH_CACHE_TTL_MS,
    data: sanitized,
  });
  for (const [cacheKey, cached] of universeSearchCache) {
    if (cached.expiresAt <= now) {
      universeSearchCache.delete(cacheKey);
    }
  }
}

export async function searchUniverseCatalog(input: {
  normalizedSearch: string;
  requestedMarkets: UniverseMarket[];
  resultLimit: number;
  active?: boolean;
}) {
  const normalizedTickerQuery = normalizeSymbol(
    input.normalizedSearch,
  ).toUpperCase();
  const normalizedNameQuery = normalizeUniverseCatalogName(
    input.normalizedSearch,
  );
  if (!normalizedTickerQuery && !normalizedNameQuery) {
    return {
      count: 0,
      results: [],
      listingRows: [],
    } satisfies UniverseCatalogSearchResponse;
  }

  const filters = [
    inArray(universeCatalogListingsTable.market, input.requestedMarkets),
  ] as SqlCondition[];
  if (typeof input.active === "boolean") {
    filters.push(
      eq(universeCatalogListingsTable.active, input.active) as SqlCondition,
    );
  }

  const exactConditions = [] as SqlCondition[];
  if (normalizedTickerQuery) {
    exactConditions.push(
      eq(
        universeCatalogListingsTable.normalizedTicker,
        normalizedTickerQuery,
      ) as SqlCondition,
      eq(
        universeCatalogListingsTable.rootSymbol,
        normalizedTickerQuery,
      ) as SqlCondition,
      eq(
        universeCatalogListingsTable.compositeFigi,
        normalizedTickerQuery,
      ) as SqlCondition,
      eq(
        universeCatalogListingsTable.shareClassFigi,
        normalizedTickerQuery,
      ) as SqlCondition,
      eq(
        universeCatalogListingsTable.cik,
        normalizedTickerQuery,
      ) as SqlCondition,
    );
  }
  if (input.normalizedSearch) {
    exactConditions.push(
      eq(
        universeCatalogListingsTable.providerContractId,
        input.normalizedSearch,
      ) as SqlCondition,
    );
  }
  if (normalizedNameQuery) {
    exactConditions.push(
      eq(
        universeCatalogListingsTable.normalizedName,
        normalizedNameQuery,
      ) as SqlCondition,
    );
  }

  const prefixConditions = [] as SqlCondition[];
  if (normalizedTickerQuery) {
    prefixConditions.push(
      like(
        universeCatalogListingsTable.normalizedTicker,
        `${normalizedTickerQuery}%`,
      ) as SqlCondition,
      like(
        universeCatalogListingsTable.rootSymbol,
        `${normalizedTickerQuery}%`,
      ) as SqlCondition,
    );
  }
  if (normalizedNameQuery) {
    prefixConditions.push(
      like(
        universeCatalogListingsTable.normalizedName,
        `${normalizedNameQuery}%`,
      ) as SqlCondition,
    );
  }
  if (normalizedNameQuery.length >= 2) {
    prefixConditions.push(
      like(
        universeCatalogListingsTable.normalizedName,
        `% ${normalizedNameQuery}%`,
      ) as SqlCondition,
    );
  }

  const containsConditions =
    !isTickerLikeSearch(input.normalizedSearch) &&
    normalizedNameQuery.length >= 3
      ? [
          like(
            universeCatalogListingsTable.normalizedName,
            `%${normalizedNameQuery}%`,
          ) as SqlCondition,
        ]
      : [];

  const runCatalogQuery = (conditions: SqlCondition[], limit: number) =>
    conditions.length
      ? db
          .select()
          .from(universeCatalogListingsTable)
          .where(and(...filters, or(...conditions)))
          .limit(limit)
      : Promise.resolve([]);

  const [exactRows, prefixRows, containsRows] = await Promise.all([
    runCatalogQuery(exactConditions, Math.max(input.resultLimit * 2, 12)),
    runCatalogQuery(prefixConditions, Math.max(input.resultLimit * 4, 24)),
    runCatalogQuery(containsConditions, Math.max(input.resultLimit * 3, 18)),
  ]);

  const merged = new Map<string, UniverseTicker>();
  const listingRowMap = new Map<
    string,
    UniverseCatalogListingHydrationRecord
  >();
  for (const row of [...exactRows, ...prefixRows, ...containsRows]) {
    const ticker = mapUniverseCatalogRowToUniverseTicker(row);
    listingRowMap.set(
      row.listingKey,
      row as UniverseCatalogListingHydrationRecord,
    );
    merged.set(
      buildUniverseTickerMergeKey(ticker),
      mergeUniverseTicker(
        merged.get(buildUniverseTickerMergeKey(ticker)),
        ticker,
      ),
    );
  }

  const requestedMarketSet = new Set(input.requestedMarkets);
  const results = Array.from(merged.values())
    .sort((left, right) => {
      const scoreDiff =
        scoreUniverseTicker(right, input.normalizedSearch, requestedMarketSet) -
        scoreUniverseTicker(left, input.normalizedSearch, requestedMarketSet);
      if (scoreDiff !== 0) return scoreDiff;
      const tickerDiff = left.ticker.localeCompare(right.ticker);
      if (tickerDiff !== 0) return tickerDiff;
      return (left.normalizedExchangeMic ?? "").localeCompare(
        right.normalizedExchangeMic ?? "",
      );
    })
    .slice(0, input.resultLimit);
  const listingRows = Array.from(listingRowMap.values()).sort((left, right) => {
    const scoreDiff =
      scoreUniverseTicker(
        mapUniverseCatalogRowToUniverseTicker(right),
        input.normalizedSearch,
        requestedMarketSet,
      ) -
      scoreUniverseTicker(
        mapUniverseCatalogRowToUniverseTicker(left),
        input.normalizedSearch,
        requestedMarketSet,
      );
    if (scoreDiff !== 0) return scoreDiff;
    return left.listingKey.localeCompare(right.listingKey);
  });

  return {
    ...sanitizeUniverseSearchResponse({ count: results.length, results }),
    listingRows,
  } satisfies UniverseCatalogSearchResponse;
}

export async function upsertUniverseCatalogRows(rows: UniverseTicker[]) {
  const values = rows
    .map(buildUniverseCatalogRow)
    .filter((row) => row.ticker && row.name && row.market);
  if (!values.length) return;

  await db.transaction(async (tx) => {
    for (const value of values) {
      const conflictSet = {
        market: value.market,
        ticker: value.ticker,
        normalizedTicker: value.normalizedTicker,
        rootSymbol: value.rootSymbol,
        name: value.name,
        normalizedName: value.normalizedName,
        normalizedExchangeMic: value.normalizedExchangeMic,
        exchangeDisplay: value.exchangeDisplay,
        locale: value.locale,
        type: value.type,
        active: value.active,
        primaryExchange: value.primaryExchange,
        currencyName: value.currencyName,
        cik: value.cik,
        compositeFigi: value.compositeFigi,
        shareClassFigi: value.shareClassFigi,
        providerContractId: sql<string | null>`coalesce(
          excluded.provider_contract_id,
          ${universeCatalogListingsTable.providerContractId}
        )`,
        providers: sql<MarketDataProvider[]>`(
          select coalesce(
            array_agg(distinct provider),
            '{}'::text[]
          )
          from unnest(
            coalesce(${universeCatalogListingsTable.providers}, '{}'::text[]) ||
            coalesce(excluded.providers, '{}'::text[])
          ) as provider
        )`,
        tradeProvider: sql<string | null>`case
          when coalesce(excluded.provider_contract_id, ${universeCatalogListingsTable.providerContractId}) is not null
            then 'ibkr'
          else coalesce(excluded.trade_provider, ${universeCatalogListingsTable.tradeProvider})
        end`,
        dataProviderPreference: sql<string | null>`case
          when coalesce(excluded.provider_contract_id, ${universeCatalogListingsTable.providerContractId}) is not null
            then 'ibkr'
          else coalesce(
            excluded.data_provider_preference,
            ${universeCatalogListingsTable.dataProviderPreference}
          )
        end`,
        ibkrHydrationStatus: sql<UniverseCatalogHydrationStatus>`case
          when coalesce(excluded.provider_contract_id, ${universeCatalogListingsTable.providerContractId}) is not null
            then 'hydrated'::universe_hydration_status
          else ${universeCatalogListingsTable.ibkrHydrationStatus}
        end`,
        ibkrHydrationAttemptedAt: sql<Date | null>`case
          when excluded.provider_contract_id is not null
            then coalesce(excluded.ibkr_hydration_attempted_at, now())
          else ${universeCatalogListingsTable.ibkrHydrationAttemptedAt}
        end`,
        ibkrHydratedAt: sql<Date | null>`case
          when coalesce(excluded.provider_contract_id, ${universeCatalogListingsTable.providerContractId}) is not null
            then coalesce(excluded.ibkr_hydrated_at, now())
          else ${universeCatalogListingsTable.ibkrHydratedAt}
        end`,
        ibkrHydrationError: sql<string | null>`case
          when coalesce(excluded.provider_contract_id, ${universeCatalogListingsTable.providerContractId}) is not null
            then null
          else ${universeCatalogListingsTable.ibkrHydrationError}
        end`,
        contractDescription: value.contractDescription,
        contractMeta: sql<Record<string, unknown> | null>`case
          when ${universeCatalogListingsTable.contractMeta} is null then excluded.contract_meta
          when excluded.contract_meta is null then ${universeCatalogListingsTable.contractMeta}
          else ${universeCatalogListingsTable.contractMeta} || excluded.contract_meta
        end`,
        lastUpdatedAt: value.lastUpdatedAt,
        lastSeenAt: value.lastSeenAt,
        updatedAt: value.updatedAt,
      } satisfies UniverseCatalogListingUpdateSet;
      await tx
        .insert(universeCatalogListingsTable)
        .values(value)
        .onConflictDoUpdate({
          target: universeCatalogListingsTable.listingKey,
          set: conflictSet,
        });
    }
  });
}

function shouldUseUniverseCatalogResponse(input: {
  response: UniverseSearchResponse;
  normalizedSearch: string;
  requestedMarkets: UniverseMarket[];
}) {
  if (!input.response.results.length) return false;
  if (hasExactCatalogIdentifierMatch(input.response, input.normalizedSearch)) {
    return true;
  }
  if (hasExactIbkrTradableTickerMatch(input.response, input.normalizedSearch)) {
    return true;
  }

  if (
    !isTickerLikeSearch(input.normalizedSearch) &&
    hasStrongPrimaryIbkrNameMatch(
      input.response,
      input.normalizedSearch,
      getInteractivePrimaryUniverseMarkets(
        input.normalizedSearch,
        input.requestedMarkets,
      ),
    )
  ) {
    return true;
  }

  return false;
}

function hasExactIbkrTradableTickerMatchInMarkets(input: {
  response: UniverseSearchResponse;
  normalizedSearch: string;
  markets: UniverseMarket[];
}) {
  const normalizedQuery = normalizeSymbol(input.normalizedSearch).toUpperCase();
  if (!normalizedQuery || input.markets.length === 0) return false;

  const marketSet = new Set(input.markets);
  return input.response.results.some(
    (row) =>
      marketSet.has(row.market) &&
      row.providers.includes("ibkr") &&
      row.tradeProvider === "ibkr" &&
      row.providerContractId &&
      buildTickerSearchAliases(row).includes(normalizedQuery),
  );
}

function shouldUseUniverseCatalogImmediateResponse(input: {
  response: UniverseSearchResponse;
  normalizedSearch: string;
  requestedMarkets: UniverseMarket[];
}) {
  if (!input.response.results.length) return false;

  const primaryMarkets = getInteractivePrimaryUniverseMarkets(
    input.normalizedSearch,
    input.requestedMarkets,
  );

  if (
    hasExactIbkrTradableTickerMatchInMarkets({
      response: input.response,
      normalizedSearch: input.normalizedSearch,
      markets: primaryMarkets,
    })
  ) {
    return true;
  }

  if (
    hasPrimaryTickerPrefixMatchInMarkets({
      response: input.response,
      normalizedSearch: input.normalizedSearch,
      markets: primaryMarkets,
    })
  ) {
    return true;
  }

  return hasStrongPrimaryIbkrNameMatch(
    input.response,
    input.normalizedSearch,
    primaryMarkets,
  );
}

function hasPrimaryTickerPrefixMatchInMarkets(input: {
  response: UniverseSearchResponse;
  normalizedSearch: string;
  markets: UniverseMarket[];
}) {
  const normalizedQuery = normalizeSymbol(input.normalizedSearch).toUpperCase();
  if (!normalizedQuery || input.markets.length === 0) return false;

  const marketSet = new Set(input.markets);
  return input.response.results.some((row) => {
    if (!marketSet.has(row.market)) return false;
    if (!row.providers.length) return false;
    return buildTickerSearchAliases(row).some((alias) =>
      alias.startsWith(normalizedQuery),
    );
  });
}

function hasExactCatalogIdentifierMatch(
  response: UniverseSearchResponse,
  normalizedSearch: string,
) {
  const normalizedQuery = normalizedSearch.trim().toUpperCase();
  if (!normalizedQuery) return false;

  return response.results.some(
    (row) =>
      row.providerContractId === normalizedQuery ||
      row.compositeFigi === normalizedQuery ||
      row.shareClassFigi === normalizedQuery ||
      row.cik === normalizedQuery,
  );
}

function isUniverseIdentifierSearch(query: string) {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return false;
  if (/^\d+$/.test(normalized)) return true;
  if (normalized.startsWith("BBG") && /^[A-Z0-9]{12}$/.test(normalized))
    return true;
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(normalized)) return true;
  if (/^[A-Z0-9]{9}$/.test(normalized) && !/^[A-Z]{1,6}$/.test(normalized))
    return true;
  return false;
}

function isUniverseCatalogRowIbkrHydrated(
  row: UniverseCatalogListingHydrationRecord,
) {
  return (
    row.tradeProvider === "ibkr" &&
    (row.providers ?? []).includes("ibkr") &&
    Boolean(row.providerContractId)
  );
}

function shouldAttemptUniverseCatalogIbkrHydration(
  row: UniverseCatalogListingHydrationRecord,
  force = false,
) {
  if (isUniverseCatalogRowIbkrHydrated(row)) return false;
  if (force) return true;

  const status = normalizeUniverseCatalogHydrationStatus(
    row.ibkrHydrationStatus,
  );
  if (status === "pending") return true;

  const attemptedAt =
    row.ibkrHydrationAttemptedAt instanceof Date
      ? row.ibkrHydrationAttemptedAt.getTime()
      : row.ibkrHydrationAttemptedAt
        ? new Date(row.ibkrHydrationAttemptedAt).getTime()
        : 0;
  if (!attemptedAt) return true;
  return Date.now() - attemptedAt >= UNIVERSE_CATALOG_IBKR_RETRY_COOLDOWN_MS;
}

function getUniverseCatalogIbkrHydrationMarkets(
  market: UniverseMarket,
): UniverseMarket[] {
  if (market === "stocks" || market === "etf" || market === "otc") {
    return ["stocks", "etf", "otc"];
  }
  return [market];
}

function scoreUniverseCatalogIbkrCandidate(
  row: UniverseCatalogListingHydrationRecord,
  candidate: UniverseTicker,
) {
  const rowTicker = normalizeSymbol(row.ticker).toUpperCase();
  const rowRoot = normalizeSymbol(row.rootSymbol ?? row.ticker).toUpperCase();
  const rowName = normalizeUniverseCatalogName(row.name);
  const candidateAliases = buildTickerSearchAliases(candidate);
  const candidateName = normalizeUniverseCatalogName(candidate.name);
  const rowExchange = row.normalizedExchangeMic
    ? normalizeExchangeMic(row.normalizedExchangeMic, row.market)
    : null;
  const candidateExchange = candidate.normalizedExchangeMic
    ? normalizeExchangeMic(candidate.normalizedExchangeMic, candidate.market)
    : candidate.primaryExchange
      ? normalizeExchangeMic(candidate.primaryExchange, candidate.market)
      : null;
  const exactTickerMatch =
    candidateAliases.includes(rowTicker) || candidateAliases.includes(rowRoot);
  if (!exactTickerMatch) return Number.NEGATIVE_INFINITY;

  let score = 5_000;
  if (candidate.market === row.market) score += 800;
  if (rowExchange && candidateExchange && rowExchange === candidateExchange)
    score += 400;
  if (candidate.primaryExchange && row.primaryExchange) {
    const normalizedPrimaryExchange = normalizeExchangeMic(
      row.primaryExchange,
      row.market,
    );
    if (
      normalizeExchangeMic(candidate.primaryExchange, candidate.market) ===
      normalizedPrimaryExchange
    ) {
      score += 240;
    }
  }
  if (candidateName === rowName) score += 360;
  else if (
    candidateName.startsWith(rowName) ||
    rowName.startsWith(candidateName)
  )
    score += 220;
  else if (candidateName.includes(rowName) || rowName.includes(candidateName))
    score += 120;
  if (candidate.tradeProvider === "ibkr" && candidate.providerContractId)
    score += 160;
  if (candidate.providers.includes("ibkr")) score += 80;
  return score;
}

export async function hydrateUniverseCatalogListingWithIbkr(
  input: {
    listingKey: string;
    force?: boolean;
  },
  options: SearchUniverseTickersOptions = {},
): Promise<{
  listingKey: string;
  status: UniverseCatalogHydrationStatus | "skipped";
  providerContractId: string | null;
}> {
  const [rowRecord] = await db
    .select()
    .from(universeCatalogListingsTable)
    .where(eq(universeCatalogListingsTable.listingKey, input.listingKey))
    .limit(1);
  const row = rowRecord as UniverseCatalogListingHydrationRecord | undefined;
  if (!row) {
    return {
      listingKey: input.listingKey,
      status: "not_found",
      providerContractId: null,
    };
  }

  if (!shouldAttemptUniverseCatalogIbkrHydration(row, input.force)) {
    return {
      listingKey: row.listingKey,
      status: isUniverseCatalogRowIbkrHydrated(row)
        ? "hydrated"
        : normalizeUniverseCatalogHydrationStatus(row.ibkrHydrationStatus),
      providerContractId: row.providerContractId ?? null,
    };
  }

  const attemptedAt = new Date();
  try {
    const results = await getIbkrClient().searchTickers({
      search: row.ticker,
      markets: getUniverseCatalogIbkrHydrationMarkets(row.market),
      limit: UNIVERSE_SEARCH_DEFAULT_LIMIT,
      signal: options.signal,
    });
    const bestCandidate = results.results
      .map((candidate) => ({
        candidate,
        score: scoreUniverseCatalogIbkrCandidate(row, candidate),
      }))
      .sort((left, right) => right.score - left.score)[0];

    if (
      bestCandidate &&
      Number.isFinite(bestCandidate.score) &&
      bestCandidate.score > 0
    ) {
      const mergedTicker = mergeUniverseTicker(
        mapUniverseCatalogRowToUniverseTicker(row),
        bestCandidate.candidate,
      );
      const mergedValue = buildUniverseCatalogRow(mergedTicker);
      const hydratedSet = {
        listingKey: mergedValue.listingKey,
        market: mergedValue.market,
        ticker: mergedValue.ticker,
        normalizedTicker: mergedValue.normalizedTicker,
        rootSymbol: mergedValue.rootSymbol,
        name: mergedValue.name,
        normalizedName: mergedValue.normalizedName,
        normalizedExchangeMic: mergedValue.normalizedExchangeMic,
        exchangeDisplay: mergedValue.exchangeDisplay,
        locale: mergedValue.locale,
        type: mergedValue.type,
        active: mergedValue.active,
        primaryExchange: mergedValue.primaryExchange,
        currencyName: mergedValue.currencyName,
        cik: mergedValue.cik,
        compositeFigi: mergedValue.compositeFigi,
        shareClassFigi: mergedValue.shareClassFigi,
        providerContractId: mergedValue.providerContractId,
        providers: mergedValue.providers,
        tradeProvider: "ibkr",
        dataProviderPreference: "ibkr",
        ibkrHydrationStatus: "hydrated",
        ibkrHydrationAttemptedAt: attemptedAt,
        ibkrHydratedAt: attemptedAt,
        ibkrHydrationError: null,
        contractDescription: mergedValue.contractDescription,
        contractMeta: mergedValue.contractMeta,
        lastUpdatedAt: mergedValue.lastUpdatedAt,
        lastSeenAt: row.lastSeenAt,
        updatedAt: new Date(),
      } satisfies UniverseCatalogListingUpdateSet;
      await db
        .update(universeCatalogListingsTable)
        .set(hydratedSet)
        .where(eq(universeCatalogListingsTable.id, row.id));

      return {
        listingKey: mergedValue.listingKey,
        status: "hydrated",
        providerContractId: mergedValue.providerContractId ?? null,
      };
    }

    const status: UniverseCatalogHydrationStatus = results.results.length
      ? "ambiguous"
      : "not_found";
    const unresolvedSet = {
      ibkrHydrationStatus: status,
      ibkrHydrationAttemptedAt: attemptedAt,
      ibkrHydrationError:
        status === "ambiguous"
          ? `IBKR returned ${results.results.length} non-matching candidates for ${row.ticker}.`
          : `IBKR returned no tradable match for ${row.ticker}.`,
      updatedAt: new Date(),
    } satisfies UniverseCatalogListingUpdateSet;
    await db
      .update(universeCatalogListingsTable)
      .set(unresolvedSet)
      .where(eq(universeCatalogListingsTable.id, row.id));
    return {
      listingKey: row.listingKey,
      status,
      providerContractId: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown IBKR hydration error.";
    const failedSet = {
      ibkrHydrationStatus: "failed",
      ibkrHydrationAttemptedAt: attemptedAt,
      ibkrHydrationError: message,
      updatedAt: new Date(),
    } satisfies UniverseCatalogListingUpdateSet;
    await db
      .update(universeCatalogListingsTable)
      .set(failedSet)
      .where(eq(universeCatalogListingsTable.id, row.id));
    return {
      listingKey: row.listingKey,
      status: "failed",
      providerContractId: null,
    };
  }
}

function enqueueUniverseCatalogIbkrHydrationRows(
  rows: UniverseCatalogListingHydrationRecord[],
) {
  const candidates = rows.filter((row) =>
    shouldAttemptUniverseCatalogIbkrHydration(row),
  );

  for (const row of candidates) {
    if (
      universeCatalogIbkrHydrationQueued.has(row.listingKey) ||
      universeCatalogIbkrHydrationInFlight.has(row.listingKey)
    ) {
      continue;
    }
    universeCatalogIbkrHydrationQueued.add(row.listingKey);
    universeCatalogIbkrHydrationQueue.push(row.listingKey);
  }

  drainUniverseCatalogIbkrHydrationQueue();
}

function drainUniverseCatalogIbkrHydrationQueue() {
  while (
    universeCatalogIbkrHydrationInFlight.size <
      UNIVERSE_CATALOG_IBKR_HYDRATION_QUEUE_CONCURRENCY &&
    universeCatalogIbkrHydrationQueue.length > 0
  ) {
    const listingKey = universeCatalogIbkrHydrationQueue.shift();
    if (!listingKey) break;
    universeCatalogIbkrHydrationQueued.delete(listingKey);
    universeCatalogIbkrHydrationInFlight.add(listingKey);
    void hydrateUniverseCatalogListingWithIbkr({ listingKey })
      .catch((error) => {
        logger.debug(
          { err: error, listingKey },
          "background IBKR hydration for universe catalog failed",
        );
      })
      .finally(() => {
        universeCatalogIbkrHydrationInFlight.delete(listingKey);
        drainUniverseCatalogIbkrHydrationQueue();
      });
  }
}

function createClientAbortedError() {
  return new HttpError(499, "Ticker search request was aborted.", {
    code: "ticker_search_aborted",
  });
}

function isClientAbortedTickerSearchError(error: unknown): boolean {
  return error instanceof HttpError && error.code === "ticker_search_aborted";
}

function throwIfSignalAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createClientAbortedError();
  }
}

async function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  throwIfSignalAborted(signal);

  let abortListener: (() => void) | null = null;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(createClientAbortedError());
    signal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
}

function createBudgetSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => {
      if (!controller.signal.aborted) {
        controller.abort(
          new Error(`Ticker search budget exceeded after ${timeoutMs}ms.`),
        );
      }
    },
    Math.max(1, timeoutMs),
  );
  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function isTickerLikeSearch(query: string) {
  return /^[A-Z][A-Z0-9.:-]{0,15}$/i.test(query.trim());
}

function sanitizeUniverseSearchResponse(
  response: UniverseSearchResponse,
): UniverseSearchResponse {
  return {
    count: response.results.length,
    results: response.results.map((ticker) => ({
      ...ticker,
      logoUrl: null,
    })),
  };
}

function normalizeUniverseLogoSymbols(symbols: string[] | string | undefined) {
  const rawSymbols = Array.isArray(symbols)
    ? symbols
    : typeof symbols === "string"
      ? symbols.split(",")
      : [];
  return Array.from(
    new Set(
      rawSymbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
    ),
  ).slice(0, UNIVERSE_LOGO_BATCH_LIMIT);
}

function getTradingViewSymbolLogoUrl(symbol: string): string | null {
  const normalizedSymbol = normalizeSymbol(symbol);
  const rootSymbol = normalizedSymbol.replace(/^[A-Z]:/, "").split(/[/:]/)[0];
  const slug =
    TRADINGVIEW_LOGO_SLUGS[normalizedSymbol] ??
    TRADINGVIEW_LOGO_SLUGS[rootSymbol] ??
    null;

  return slug ? `${TRADINGVIEW_SYMBOL_LOGO_BASE_URL}/${slug}.svg` : null;
}

async function fetchUniverseLogoRecord(
  symbol: string,
  signal?: AbortSignal,
): Promise<UniverseLogoRecord> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const nowIso = new Date().toISOString();
  const tradingViewLogoUrl = getTradingViewSymbolLogoUrl(normalizedSymbol);
  if (tradingViewLogoUrl) {
    return {
      symbol: normalizedSymbol,
      logoUrl: tradingViewLogoUrl,
      source: "tradingview",
      assetType: "symbol_icon",
      confidence: 0.95,
      updatedAt: nowIso,
    };
  }

  const massiveClient = getMassiveRuntimeConfig() ? getMassiveClient() : null;
  if (massiveClient) {
    const massiveLogoUrl = await massiveClient.getTickerLogoUrl(
      normalizedSymbol,
      signal,
    );
    if (massiveLogoUrl) {
      return {
        symbol: normalizedSymbol,
        logoUrl: massiveLogoUrl,
        source: "massive",
        assetType: "provider_logo",
        confidence: 0.65,
        updatedAt: nowIso,
      };
    }
  }

  const fmpConfig = getFmpRuntimeConfig();
  if (fmpConfig) {
    try {
      const fmpLogoUrl = await new FmpResearchClient(
        fmpConfig,
      ).getCompanyLogoUrl(normalizedSymbol);
      if (fmpLogoUrl) {
        return {
          symbol: normalizedSymbol,
          logoUrl: fmpLogoUrl,
          source: "fmp",
          assetType: "provider_logo",
          confidence: 0.5,
          updatedAt: nowIso,
        };
      }
    } catch (error) {
      logger.debug(
        { err: error, symbol: normalizedSymbol },
        "FMP logo lookup failed",
      );
    }
  }

  return {
    symbol: normalizedSymbol,
    logoUrl: null,
    source: "none",
    assetType: "unknown",
    confidence: 0,
    updatedAt: nowIso,
  };
}

async function getUniverseLogoRecord(symbol: string, signal?: AbortSignal) {
  const normalizedSymbol = normalizeSymbol(symbol);
  pruneUniverseLogoCache(Date.now());
  const cached = universeLogoCache.get(normalizedSymbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const existingFlight = universeLogoInFlight.get(normalizedSymbol);
  if (existingFlight) {
    return existingFlight;
  }

  const flight = fetchUniverseLogoRecord(normalizedSymbol, signal)
    .then((value) => {
      universeLogoCache.set(normalizedSymbol, {
        expiresAt: Date.now() + UNIVERSE_LOGO_CACHE_TTL_MS,
        value,
      });
      return value;
    })
    .finally(() => {
      universeLogoInFlight.delete(normalizedSymbol);
    });
  universeLogoInFlight.set(normalizedSymbol, flight);
  return flight;
}

export async function getUniverseLogos(
  input: { symbols?: string[] | string },
  options: { signal?: AbortSignal } = {},
): Promise<{ logos: UniverseLogoRecord[] }> {
  const symbols = normalizeUniverseLogoSymbols(input.symbols);
  if (!symbols.length) {
    return { logos: [] };
  }

  const logos = await Promise.all(
    symbols.map((symbol) => getUniverseLogoRecord(symbol, options.signal)),
  );
  return { logos };
}

function finalizeUniverseSearchResponse(input: {
  providerResults: UniverseTicker[];
  requestedMarketSet: Set<UniverseMarket>;
  normalizedSearch: string;
  resultLimit: number;
}): UniverseSearchResponse {
  const merged = new Map<string, UniverseTicker>();

  for (const ticker of input.providerResults) {
    const hydrated = hydrateUniverseTickerMetadata(ticker);
    if (!input.requestedMarketSet.has(hydrated.market)) continue;
    const key = buildUniverseTickerMergeKey(hydrated);
    merged.set(key, mergeUniverseTicker(merged.get(key), hydrated));
  }

  const results = Array.from(merged.values())
    .sort((left, right) => {
      const scoreDiff =
        scoreUniverseTicker(
          right,
          input.normalizedSearch,
          input.requestedMarketSet,
        ) -
        scoreUniverseTicker(
          left,
          input.normalizedSearch,
          input.requestedMarketSet,
        );
      if (scoreDiff !== 0) return scoreDiff;
      const tickerDiff = left.ticker.localeCompare(right.ticker);
      if (tickerDiff !== 0) return tickerDiff;
      return (left.normalizedExchangeMic ?? "").localeCompare(
        right.normalizedExchangeMic ?? "",
      );
    })
    .slice(0, input.resultLimit);

  return sanitizeUniverseSearchResponse({ count: results.length, results });
}

async function runUniverseSearchTask(
  label: string,
  budgetMs: number,
  signal: AbortSignal | undefined,
  task: (
    signal: AbortSignal,
  ) => Promise<{ count: number; results: UniverseTicker[] }>,
): Promise<{
  label: string;
  elapsedMs: number;
  result: { count: number; results: UniverseTicker[] } | null;
}> {
  const startedAt = Date.now();
  const budgetSignal = createBudgetSignal(signal, budgetMs);

  try {
    const result = await task(budgetSignal.signal);
    return {
      label,
      elapsedMs: Date.now() - startedAt,
      result,
    };
  } catch (error) {
    logger.debug(
      { err: error, provider: label, elapsedMs: Date.now() - startedAt },
      "ticker search provider did not return within interactive budget",
    );
    return {
      label,
      elapsedMs: Date.now() - startedAt,
      result: null,
    };
  } finally {
    budgetSignal.dispose();
  }
}

function deriveCusipCandidates(query: string) {
  const normalized = query.trim().toUpperCase();
  const candidates = new Set<string>();
  if (/^[A-Z0-9]{9}$/.test(normalized)) candidates.add(normalized);
  if (
    /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(normalized) &&
    !normalized.startsWith("BBG")
  ) {
    candidates.add(normalized.slice(2, 11));
  }
  return Array.from(candidates);
}

function resolveInteractiveIbkrMarketGroups(
  input: SearchUniverseTickersInput,
  requestedMarkets: UniverseMarket[],
) {
  const hasExplicitMarketFilter = Boolean(
    input.market || input.markets?.length,
  );
  if (hasExplicitMarketFilter) {
    return [requestedMarkets];
  }

  const requestedMarketSet = new Set(requestedMarkets);
  const groups = INTERACTIVE_IBKR_MARKET_GROUPS.map((group) =>
    group.filter((market) => requestedMarketSet.has(market)),
  ).filter((group): group is UniverseMarket[] => group.length > 0);

  return groups.length ? groups : [requestedMarkets];
}

function normalizeUniverseSearchLimit(
  value: number | undefined,
  fallback = UNIVERSE_SEARCH_DEFAULT_LIMIT,
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.floor(numeric));
}

function getInteractiveUniverseSearchLimit(resultLimit: number) {
  return Math.max(resultLimit + 12, UNIVERSE_SEARCH_DEFAULT_LIMIT);
}

function shouldRunUniverseSearchBackgroundEnrichment(input: {
  normalizedSearch: string;
  response: UniverseSearchResponse;
}) {
  if (input.normalizedSearch.length < 3) return false;
  if (
    isTickerLikeSearch(input.normalizedSearch) &&
    hasExactIbkrTradableTickerMatch(input.response, input.normalizedSearch)
  ) {
    return false;
  }
  return true;
}

function hasIbkrTradableResult(response: UniverseSearchResponse) {
  return response.results.some(
    (row) =>
      row.providers.includes("ibkr") &&
      row.tradeProvider === "ibkr" &&
      row.providerContractId,
  );
}

function hasExactIbkrTradableTickerMatch(
  response: UniverseSearchResponse,
  normalizedSearch: string,
) {
  return response.results.some((row) =>
    isExactIbkrTradableTickerMatch(row, normalizedSearch),
  );
}

function isExactIbkrTradableTickerMatch(
  row: UniverseTicker,
  normalizedSearch: string,
) {
  const normalizedQuery = normalizeSymbol(normalizedSearch).toUpperCase();
  if (!normalizedQuery) return false;

  return (
    row.providers.includes("ibkr") &&
    row.tradeProvider === "ibkr" &&
    Boolean(row.providerContractId) &&
    buildTickerSearchAliases(row).includes(normalizedQuery)
  );
}

function filterExactIbkrTradableTickerMatches(input: {
  response: UniverseSearchResponse;
  normalizedSearch: string;
  requestedMarketSet: Set<UniverseMarket>;
  resultLimit: number;
}): UniverseSearchResponse {
  const results = input.response.results
    .filter(
      (row) =>
        input.requestedMarketSet.has(row.market) &&
        isExactIbkrTradableTickerMatch(row, input.normalizedSearch),
    )
    .slice(0, input.resultLimit);

  return sanitizeUniverseSearchResponse({
    count: results.length,
    results,
  });
}

function hasStrongPrimaryIbkrNameMatch(
  response: UniverseSearchResponse,
  normalizedSearch: string,
  primaryMarkets: UniverseMarket[],
) {
  const normalizedQuery = normalizedSearch.trim().toLowerCase();
  if (!normalizedQuery || primaryMarkets.length === 0) return false;

  const primaryMarketSet = new Set(primaryMarkets);
  const [first] = response.results;
  if (!first || !primaryMarketSet.has(first.market)) return false;
  if (
    !first.providers.includes("ibkr") ||
    first.tradeProvider !== "ibkr" ||
    !first.providerContractId
  ) {
    return false;
  }

  const normalizedName = first.name.trim().toLowerCase();
  if (
    normalizedName === normalizedQuery ||
    normalizedName.startsWith(normalizedQuery)
  ) {
    return true;
  }

  return normalizedName
    .split(/[\s./-]+/)
    .some((part) => part.startsWith(normalizedQuery));
}

async function runInteractiveUniverseSearch(input: {
  searchInput: SearchUniverseTickersInput;
  normalizedSearch: string;
  requestedMarkets: UniverseMarket[];
  requestedMarketSet: Set<UniverseMarket>;
  resultLimit: number;
  cacheKey: string;
  strictTradeResolve: boolean;
  signal: AbortSignal;
}): Promise<UniverseSearchResponse> {
  const startedAt = Date.now();
  const searchLimit = getInteractiveUniverseSearchLimit(input.resultLimit);
  const massiveConfig = getMassiveRuntimeConfig();
  const massiveClient = massiveConfig ? getMassiveClient() : null;
  const interactiveIbkrMarketGroups = resolveInteractiveIbkrMarketGroups(
    input.searchInput,
    input.requestedMarkets,
  );
  const primaryInteractiveIbkrMarkets = getInteractivePrimaryUniverseMarkets(
    input.normalizedSearch,
    input.requestedMarkets,
  );
  const primaryInteractiveIbkrGroupKeySet = new Set(
    interactiveIbkrMarketGroups
      .filter((markets) =>
        markets.some((market) =>
          primaryInteractiveIbkrMarkets.includes(market),
        ),
      )
      .map((markets) => getInteractiveIbkrMarketGroupKey(markets)),
  );
  const ibkrGroupEntries = interactiveIbkrMarketGroups.map(
    (markets, index) => ({
      markets,
      index,
    }),
  );
  const interactiveProviderController = new AbortController();
  const abortInteractiveProviders = () => {
    if (!interactiveProviderController.signal.aborted) {
      interactiveProviderController.abort(input.signal.reason);
    }
  };

  if (input.signal.aborted) {
    abortInteractiveProviders();
  } else {
    input.signal.addEventListener("abort", abortInteractiveProviders, {
      once: true,
    });
  }
  const buildIbkrTask = ({
    markets,
    index,
  }: {
    markets: UniverseMarket[];
    index: number;
  }) =>
    runUniverseSearchTask(
      `ibkr-${markets.join("+")}`,
      UNIVERSE_SEARCH_IBKR_BUDGET_MS,
      interactiveProviderController.signal,
      (signal) =>
        getIbkrClient().searchTickers({
          search: input.normalizedSearch,
          markets,
          limit: searchLimit,
          signal,
        }),
    ).then((result) => ({
      ...result,
      index,
      markets,
    }));
  const massiveInteractiveTasks: Array<
    Promise<{
      label: string;
      elapsedMs: number;
      result: { count: number; results: UniverseTicker[] } | null;
    }>
  > = [];

  if (massiveClient && isTickerLikeSearch(input.normalizedSearch)) {
    massiveInteractiveTasks.push(
      runUniverseSearchTask(
        "massive-exact",
        UNIVERSE_SEARCH_MASSIVE_EXACT_BUDGET_MS,
        interactiveProviderController.signal,
        async (signal) => {
          const ticker = await massiveClient.getUniverseTickerByTicker(
            input.normalizedSearch,
            signal,
          );
          return {
            count: ticker ? 1 : 0,
            results: ticker ? [ticker] : [],
          };
        },
      ),
    );
  }

  if (massiveClient) {
    const massiveMarkets = MASSIVE_SEARCH_MARKETS.filter(
      (market) =>
        input.requestedMarketSet.has(market) &&
        (market === "stocks" || market === "etf" || market === "otc"),
    );
    for (const cusip of deriveCusipCandidates(input.normalizedSearch)) {
      for (const market of massiveMarkets) {
        massiveInteractiveTasks.push(
          runUniverseSearchTask(
            `massive-cusip-${market}`,
            UNIVERSE_SEARCH_MASSIVE_EXACT_BUDGET_MS,
            interactiveProviderController.signal,
            (signal) =>
              massiveClient.searchUniverseTickers({
                market,
                markets: [market],
                cusip,
                active: input.searchInput.active,
                limit: searchLimit,
                signal,
              }),
          ),
        );
      }
    }
  }

  try {
    const providerResults: UniverseTicker[] = [];
    const settledIbkrResults: Array<{
      label: string;
      elapsedMs: number;
      result: { count: number; results: UniverseTicker[] } | null;
      index: number;
      markets: UniverseMarket[];
    }> = [];
    const pendingIbkrTasks = new Map(
      ibkrGroupEntries.map(
        (entry) => [entry.index, buildIbkrTask(entry)] as const,
      ),
    );

    while (pendingIbkrTasks.size > 0) {
      const nextResult = await awaitWithAbort(
        Promise.race(pendingIbkrTasks.values()),
        input.signal,
      );
      pendingIbkrTasks.delete(nextResult.index);
      settledIbkrResults.push(nextResult);
      if (nextResult.result) {
        providerResults.push(...nextResult.result.results);
      }

      const exactResponse = finalizeUniverseSearchResponse({
        providerResults,
        requestedMarketSet: input.requestedMarketSet,
        normalizedSearch: input.normalizedSearch,
        resultLimit: input.resultLimit,
      });
      const settledPrimaryGroupKeys = new Set(
        settledIbkrResults
          .filter((result) =>
            primaryInteractiveIbkrGroupKeySet.has(
              getInteractiveIbkrMarketGroupKey(result.markets),
            ),
          )
          .map((result) => getInteractiveIbkrMarketGroupKey(result.markets)),
      );
      const primaryGroupsSettled = Array.from(
        primaryInteractiveIbkrGroupKeySet,
      ).every((key) => settledPrimaryGroupKeys.has(key));
      const hasEarlyExactMatch = hasExactIbkrTradableTickerMatch(
        exactResponse,
        input.normalizedSearch,
      );
      const hasEarlyPrimaryNameMatch =
        !input.strictTradeResolve &&
        hasStrongPrimaryIbkrNameMatch(
          exactResponse,
          input.normalizedSearch,
          primaryInteractiveIbkrMarkets,
        );
      if (
        (hasEarlyExactMatch || hasEarlyPrimaryNameMatch) &&
        primaryGroupsSettled
      ) {
        abortInteractiveProviders();
        if (hasIbkrTradableResult(exactResponse)) {
          writeUniverseSearchCache(input.cacheKey, exactResponse);
        }
        if (
          !input.strictTradeResolve &&
          shouldRunUniverseSearchBackgroundEnrichment({
            normalizedSearch: input.normalizedSearch,
            response: exactResponse,
          })
        ) {
          startUniverseSearchBackgroundEnrichment({
            ...input,
            searchLimit,
            seedResults: providerResults,
            massiveClient,
          });
        }

        logger.debug(
          {
            search: input.normalizedSearch,
            elapsedMs: Date.now() - startedAt,
            ibkrElapsedMs: settledIbkrResults.reduce(
              (max, result) => Math.max(max, result.elapsedMs),
              0,
            ),
            massiveInteractiveElapsedMs: 0,
            count: exactResponse.count,
            firstTicker: exactResponse.results[0]?.ticker ?? null,
            firstTradeProvider: exactResponse.results[0]?.tradeProvider ?? null,
            earlyReturn: true,
            earlyMatchReason: hasEarlyExactMatch
              ? "exact_ticker"
              : "primary_name",
          },
          "ticker search completed",
        );

        return exactResponse;
      }
    }

    const massiveInteractiveResults = await Promise.all(
      massiveInteractiveTasks,
    );
    providerResults.push(
      ...massiveInteractiveResults.flatMap(
        (result) => result.result?.results ?? [],
      ),
    );
    const response = finalizeUniverseSearchResponse({
      providerResults,
      requestedMarketSet: input.requestedMarketSet,
      normalizedSearch: input.normalizedSearch,
      resultLimit: input.resultLimit,
    });

    if (
      hasIbkrTradableResult(response) &&
      (!input.strictTradeResolve ||
        hasExactIbkrTradableTickerMatch(response, input.normalizedSearch))
    ) {
      writeUniverseSearchCache(input.cacheKey, response);
    }
    if (
      !input.strictTradeResolve &&
      shouldRunUniverseSearchBackgroundEnrichment({
        normalizedSearch: input.normalizedSearch,
        response,
      })
    ) {
      startUniverseSearchBackgroundEnrichment({
        ...input,
        searchLimit,
        seedResults: providerResults,
        massiveClient,
      });
    }

    logger.debug(
      {
        search: input.normalizedSearch,
        elapsedMs: Date.now() - startedAt,
        ibkrElapsedMs: settledIbkrResults.reduce(
          (max, result) => Math.max(max, result.elapsedMs),
          0,
        ),
        massiveInteractiveElapsedMs: massiveInteractiveResults.reduce(
          (max, result) => Math.max(max, result.elapsedMs),
          0,
        ),
        count: response.count,
        firstTicker: response.results[0]?.ticker ?? null,
        firstTradeProvider: response.results[0]?.tradeProvider ?? null,
        earlyReturn: false,
      },
      "ticker search completed",
    );

    return response;
  } finally {
    input.signal.removeEventListener("abort", abortInteractiveProviders);
  }
}

function observeAbandonedUniverseSearchFlight(
  promise: Promise<UniverseSearchResponse>,
  cacheKey: string,
): void {
  void promise.catch((error) => {
    if (isClientAbortedTickerSearchError(error)) {
      logger.debug({ cacheKey }, "abandoned ticker search flight was aborted");
      return;
    }

    logger.debug(
      { err: error, cacheKey },
      "abandoned ticker search flight failed",
    );
  });
}

function startUniverseSearchBackgroundEnrichment(input: {
  searchInput: SearchUniverseTickersInput;
  normalizedSearch: string;
  requestedMarkets: UniverseMarket[];
  requestedMarketSet: Set<UniverseMarket>;
  resultLimit: number;
  cacheKey: string;
  searchLimit: number;
  seedResults: UniverseTicker[];
  massiveClient: MassiveMarketDataClient | null;
}) {
  if (!input.massiveClient || input.normalizedSearch.length < 2) return;
  if (universeSearchBackgroundInFlight.has(input.cacheKey)) return;

  const massiveClient = input.massiveClient;
  universeSearchBackgroundInFlight.add(input.cacheKey);

  void (async () => {
    const budgetSignal = createBudgetSignal(
      undefined,
      UNIVERSE_SEARCH_BACKGROUND_BUDGET_MS,
    );
    const providerResults = [
      ...input.seedResults,
      ...(readUniverseSearchCache(input.cacheKey)?.results ?? []),
    ];

    try {
      const massiveMarkets = MASSIVE_SEARCH_MARKETS.filter((market) =>
        input.requestedMarketSet.has(market),
      );
      const tasks: Array<
        Promise<{ count: number; results: UniverseTicker[] }>
      > = [];

      if (isTickerLikeSearch(input.normalizedSearch)) {
        tasks.push(
          massiveClient
            .getUniverseTickerByTicker(
              input.normalizedSearch,
              budgetSignal.signal,
            )
            .then((ticker) => ({
              count: ticker ? 1 : 0,
              results: ticker ? [ticker] : [],
            })),
        );
      }

      for (const cusip of deriveCusipCandidates(input.normalizedSearch)) {
        for (const market of massiveMarkets.filter(
          (candidate) =>
            candidate === "stocks" ||
            candidate === "etf" ||
            candidate === "otc",
        )) {
          tasks.push(
            massiveClient.searchUniverseTickers({
              market,
              markets: [market],
              cusip,
              active: input.searchInput.active,
              limit: input.searchLimit,
              signal: budgetSignal.signal,
            }),
          );
        }
      }

      for (const market of massiveMarkets) {
        tasks.push(
          massiveClient.searchUniverseTickers({
            search: input.normalizedSearch,
            market,
            markets: [market],
            type: input.searchInput.type,
            active: input.searchInput.active,
            limit: input.searchLimit,
            signal: budgetSignal.signal,
          }),
        );
      }

      const settled = await Promise.allSettled(tasks);
      for (const result of settled) {
        if (result.status === "fulfilled") {
          providerResults.push(...result.value.results);
        }
      }

      const response = finalizeUniverseSearchResponse({
        providerResults,
        requestedMarketSet: input.requestedMarketSet,
        normalizedSearch: input.normalizedSearch,
        resultLimit: input.resultLimit,
      });
      if (hasIbkrTradableResult(response)) {
        writeUniverseSearchCache(input.cacheKey, response);
      }
    } catch (error) {
      logger.debug(
        { err: error, search: input.normalizedSearch },
        "ticker search background enrichment failed",
      );
    } finally {
      budgetSignal.dispose();
      universeSearchBackgroundInFlight.delete(input.cacheKey);
    }
  })();
}

export async function searchUniverseTickers(
  input: SearchUniverseTickersInput,
  options: SearchUniverseTickersOptions = {},
) {
  const normalizedSearch = normalizeUniverseSearchInput(input.search ?? "");
  if (!normalizedSearch) return { count: 0, results: [] };

  const searchInput = {
    ...input,
    search: normalizedSearch,
  };
  const resultLimit = normalizeUniverseSearchLimit(input.limit);
  const requestedMarkets = resolveRequestedUniverseMarkets(input);
  const requestedMarketSet = new Set(requestedMarkets);
  const identifierSearch = isUniverseIdentifierSearch(normalizedSearch);
  const strictTradeResolve =
    input.mode === "trade-resolve" || input.strictTrade === true;
  const cacheKey = getUniverseSearchCacheKey(
    searchInput,
    requestedMarkets,
    resultLimit,
  );
  const cached = readUniverseSearchCache(cacheKey);
  if (cached) return cached;

  let catalogResponse: UniverseCatalogSearchResponse | null = null;
  try {
    catalogResponse = await searchUniverseCatalog({
      normalizedSearch,
      requestedMarkets,
      resultLimit,
      active: input.active,
    });
    if (catalogResponse.results.length) {
      if (strictTradeResolve) {
        enqueueUniverseCatalogIbkrHydrationRows(catalogResponse.listingRows);
        const exactCatalogResponse = filterExactIbkrTradableTickerMatches({
          response: catalogResponse,
          normalizedSearch,
          requestedMarketSet,
          resultLimit,
        });
        if (exactCatalogResponse.results.length) {
          writeUniverseSearchCache(cacheKey, exactCatalogResponse);
          logger.debug(
            {
              search: normalizedSearch,
              outcome: "catalog_exact",
              count: exactCatalogResponse.count,
              firstTicker: exactCatalogResponse.results[0]?.ticker ?? null,
            },
            "strict trade ticker resolution completed",
          );
          return exactCatalogResponse;
        }
      }

      if (!strictTradeResolve && !identifierSearch) {
        enqueueUniverseCatalogIbkrHydrationRows(catalogResponse.listingRows);
        if (
          shouldUseUniverseCatalogImmediateResponse({
            response: catalogResponse,
            normalizedSearch,
            requestedMarkets,
          })
        ) {
          if (hasIbkrTradableResult(catalogResponse)) {
            writeUniverseSearchCache(cacheKey, catalogResponse);
          }
          return catalogResponse;
        }
      }

      if (
        !strictTradeResolve &&
        identifierSearch &&
        shouldUseUniverseCatalogResponse({
          response: catalogResponse,
          normalizedSearch,
          requestedMarkets,
        })
      ) {
        if (hasIbkrTradableResult(catalogResponse)) {
          writeUniverseSearchCache(cacheKey, catalogResponse);
        }
        return catalogResponse;
      }
    }
  } catch (error) {
    logger.debug(
      { err: error, search: normalizedSearch },
      "persisted universe catalog search unavailable; falling back to live providers",
    );
  }

  let flight = universeSearchInFlight.get(cacheKey);
  if (!flight) {
    const controller = new AbortController();
    flight = {
      controller,
      consumers: 0,
      settled: false,
      promise: runInteractiveUniverseSearch({
        searchInput,
        normalizedSearch,
        requestedMarkets,
        requestedMarketSet,
        resultLimit,
        cacheKey,
        strictTradeResolve,
        signal: controller.signal,
      }).finally(() => {
        const current = universeSearchInFlight.get(cacheKey);
        if (current) current.settled = true;
        universeSearchInFlight.delete(cacheKey);
      }),
    };
    universeSearchInFlight.set(cacheKey, flight);
  }

  flight.consumers += 1;
  try {
    const liveResponse = await awaitWithAbort(flight.promise, options.signal);
    const response = catalogResponse?.results.length
      ? finalizeUniverseSearchResponse({
          providerResults: [
            ...catalogResponse.results,
            ...liveResponse.results,
          ],
          requestedMarketSet,
          normalizedSearch,
          resultLimit,
        })
      : liveResponse;
    const finalResponse = strictTradeResolve
      ? filterExactIbkrTradableTickerMatches({
          response,
          normalizedSearch,
          requestedMarketSet,
          resultLimit,
        })
      : response;
    void upsertUniverseCatalogRows(finalResponse.results).catch((error) => {
      logger.debug(
        { err: error, search: normalizedSearch },
        "persisted universe catalog upsert failed",
      );
    });
    if (hasIbkrTradableResult(finalResponse)) {
      writeUniverseSearchCache(cacheKey, finalResponse);
    }
    if (strictTradeResolve) {
      if (!finalResponse.results.length) {
        universeSearchCache.delete(cacheKey);
      }
      logger.debug(
        {
          search: normalizedSearch,
          outcome: finalResponse.results.length
            ? "ibkr_live_exact"
            : "ibkr_no_exact",
          rawCount: response.count,
          count: finalResponse.count,
          firstTicker: finalResponse.results[0]?.ticker ?? null,
        },
        "strict trade ticker resolution completed",
      );
    }
    return finalResponse;
  } finally {
    flight.consumers -= 1;
    if (flight.consumers <= 0 && !flight.settled) {
      flight.controller.abort();
      observeAbandonedUniverseSearchFlight(flight.promise, cacheKey);
    }
  }
}

type NativeBarTimeframe = Parameters<
  MassiveMarketDataClient["getBars"]
>[0]["timeframe"];
type ChartBarTimeframe = NativeBarTimeframe | "30s" | "30m" | "4h";

type GetBarsInput = {
  symbol: string;
  timeframe: ChartBarTimeframe;
  limit?: number;
  from?: Date;
  to?: Date;
  historyCursor?: string | null;
  preferCursor?: boolean;
  assetClass?: "equity" | "option";
  market?: UniverseMarket;
  providerContractId?: string | null;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
  allowHistoricalSynthesis?: boolean;
  allowStudyFallback?: boolean;
  brokerRecentWindowMinutes?: number | null;
};
type NativeGetBarsInput = Omit<GetBarsInput, "timeframe"> & {
  timeframe: NativeBarTimeframe;
};
type GetBarsOptions = {
  signal?: AbortSignal;
  priority?: number;
  family?: string | null;
};

type BarsHistoryPage = {
  requestedFrom: Date | null;
  requestedTo: Date | null;
  oldestBarAt: Date | null;
  newestBarAt: Date | null;
  returnedCount: number;
  nextBefore: Date | null;
  provider: string | null;
  exhaustedBefore: boolean;
  providerCursor: string | null;
  providerNextUrl: string | null;
  providerPageCount: number | null;
  providerPageLimitReached: boolean;
  historyCursor: string | null;
  hydrationStatus: "cold" | "partial" | "warm" | "warming" | "exhausted";
  cacheStatus: "hit" | "miss" | "partial" | null;
};

type GetBarsResult = {
  symbol: string;
  timeframe: GetBarsInput["timeframe"];
  bars: BrokerBarSnapshot[];
  transport: BrokerBarSnapshot["transport"] | null;
  delayed: boolean;
  gapFilled: boolean;
  freshness: MarketDataFreshness;
  marketDataMode: string | null;
  dataUpdatedAt: Date | null;
  ageMs: number | null;
  emptyReason: string | null;
  historySource: string | null;
  studyFallback: boolean;
  historyPage: BarsHistoryPage;
};
type BarsPayloadClass = "broker-backed" | "mixed" | "synthesis-only" | "empty";
type RequestDebugMetadata = {
  cacheStatus: "hit" | "miss" | "inflight";
  totalMs: number;
  upstreamMs: number | null;
  stale?: boolean;
  ageMs?: number | null;
  degraded?: boolean;
  reason?: string | null;
  backoffRemainingMs?: number | null;
  requestedCount?: number;
  returnedCount?: number;
  complete?: boolean;
  capped?: boolean;
  family?: string | null;
  priority?: number | null;
  priorityBucket?: string | null;
  payloadClass?: BarsPayloadClass;
};
type GetBarsRequestDebug = RequestDebugMetadata & {
  gapFilled: boolean;
};
type GetBarsResultWithDebug = GetBarsResult & {
  debug: GetBarsRequestDebug;
};
type GetOptionChainResult = {
  underlying: string;
  expirationDate: Date | null;
  contracts: IbkrOptionChainContracts;
};
type GetOptionChainResultWithDebug = GetOptionChainResult & {
  debug: RequestDebugMetadata;
};
type BatchOptionChainResult = {
  expirationDate: Date;
  status: "loaded" | "empty" | "failed";
  contracts: IbkrOptionChainContracts;
  error?: string | null;
  debug?: RequestDebugMetadata;
};
type BatchOptionChainsResult = {
  underlying: string;
  results: BatchOptionChainResult[];
  debug?: RequestDebugMetadata & {
    requestedCount: number;
    returnedCount: number;
  };
};
type GetOptionExpirationsResult = {
  underlying: string;
  expirations: Array<{ expirationDate: Date }>;
};
type GetOptionExpirationsResultWithDebug = GetOptionExpirationsResult & {
  debug: RequestDebugMetadata;
};
type ResolveOptionContractResult = {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  status: "resolved" | "not_found" | "error";
  providerContractId: string | null;
  contract: IbkrOptionChainContracts[number]["contract"] | null;
  errorMessage: string | null;
  debug: RequestDebugMetadata;
};
type OptionChartBarsResolutionSource =
  | "chain"
  | "provided"
  | "resolver"
  | "none";
type OptionChartBarsDataSource =
  | "ibkr-history"
  | "mixed-history"
  | "massive-option-aggregates"
  | "none";
type OptionChartBarsResult = GetBarsResult & {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  optionTicker: string | null;
  contract: IbkrOptionChainContracts[number]["contract"] | null;
  providerContractId: string | null;
  resolutionSource: OptionChartBarsResolutionSource;
  dataSource: OptionChartBarsDataSource;
  feedIssue: boolean;
  debug: RequestDebugMetadata;
};

const BAR_LIMIT_CAPS_BY_TIMEFRAME: Partial<
  Record<GetBarsInput["timeframe"], number>
> = {
  "1s": 7_200,
  "5s": 8_640,
  "15s": 2_880,
  "30s": 1_440,
  "1m": 20_000,
  "2m": 10_000,
  "5m": 20_000,
  "15m": 15_000,
  "30m": 6_000,
  "1h": 10_000,
  "4h": 2_500,
  "1d": 5_000,
};
const OPTION_BAR_LIMIT_CAPS_BY_TIMEFRAME: Partial<
  Record<GetBarsInput["timeframe"], number>
> = {
  "1s": 900,
  "5s": 1_800,
  "15s": 600,
  "30s": 300,
  "1m": 5_000,
  "2m": 2_500,
  "5m": 5_000,
  "15m": 5_000,
  "30m": 2_500,
  "1h": 5_000,
  "4h": 1_250,
  "1d": 1_000,
};
const DEFAULT_BARS_LIMIT = 200;
const BROKER_RECENT_HISTORY_MS = 60 * 60 * 1_000;
const BROKER_HISTORY_STEP_MS: Partial<
  Record<GetBarsInput["timeframe"], number>
> = {
  "5s": 5_000,
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
const BROKER_HISTORY_TIMEFRAMES = new Set<HistoryBarTimeframe>([
  "5s",
  "1m",
  "5m",
  "15m",
  "1h",
  "1d",
]);
const IBKR_OVERNIGHT_EXCHANGE = "OVERNIGHT";
const IBKR_OVERNIGHT_FALLBACK_EXCHANGE = "IBEOS";
const IBKR_HISTORY_SOURCE = "ibkr-history";
const IBKR_OVERNIGHT_HISTORY_SOURCE = "ibkr-overnight-history";
const IBKR_OVERNIGHT_HISTORY_TIMEFRAMES = new Set<HistoryBarTimeframe>([
  "5s",
  "1m",
  "5m",
  "15m",
  "1h",
]);
const NEW_YORK_OVERNIGHT_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type BrokerRecentHistoryOptions = {
  historicalSynthesisAvailable?: boolean;
};

function shouldLimitBrokerHistoryToRecent(
  input: GetBarsInput,
  options: BrokerRecentHistoryOptions = {},
): boolean {
  return (
    Boolean(options.historicalSynthesisAvailable) &&
    input.assetClass !== "option" &&
    input.market !== "futures"
  );
}

function sanitizeBarsLimit(input: GetBarsInput): number {
  const rawLimit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.floor(input.limit)
      : DEFAULT_BARS_LIMIT;
  const normalizedLimit = Math.max(1, rawLimit);
  const caps =
    input.assetClass === "option"
      ? OPTION_BAR_LIMIT_CAPS_BY_TIMEFRAME
      : BAR_LIMIT_CAPS_BY_TIMEFRAME;
  const cap = caps[input.timeframe] ?? DEFAULT_BARS_LIMIT;

  return Math.min(normalizedLimit, cap);
}

function sanitizeBarsInput(input: GetBarsInput): GetBarsInput {
  return {
    ...input,
    limit: sanitizeBarsLimit(input),
  };
}

function buildRecentBrokerHistoryInput(
  input: GetBarsInput,
  now: Date,
  options: BrokerRecentHistoryOptions = {},
): GetBarsInput | null {
  if (!shouldLimitBrokerHistoryToRecent(input, options)) {
    return input;
  }

  const stepMs = BROKER_HISTORY_STEP_MS[input.timeframe];
  if (!stepMs) {
    return input;
  }

  const requestedTo = input.to ?? now;
  const brokerTo = new Date(Math.min(requestedTo.getTime(), now.getTime()));
  const brokerRecentWindowMs =
    typeof input.brokerRecentWindowMinutes === "number" &&
    Number.isFinite(input.brokerRecentWindowMinutes) &&
    input.brokerRecentWindowMinutes >= 0
      ? input.brokerRecentWindowMinutes * 60_000
      : BROKER_RECENT_HISTORY_MS;
  const recentBoundaryMs = now.getTime() - brokerRecentWindowMs;
  if (brokerTo.getTime() < recentBoundaryMs) {
    return null;
  }

  const explicitFromMs = input.from?.getTime();
  const recentFromMs = Math.max(
    explicitFromMs ?? recentBoundaryMs,
    recentBoundaryMs,
  );
  const recentFrom = new Date(Math.min(recentFromMs, brokerTo.getTime()));
  if (recentFrom.getTime() > brokerTo.getTime()) {
    return null;
  }

  const expectedRecentBars = Math.max(
    1,
    Math.ceil((brokerTo.getTime() - recentFrom.getTime()) / stepMs) + 1,
  );

  return {
    ...input,
    from: recentFrom,
    to: brokerTo,
    limit: Math.min(input.limit ?? expectedRecentBars, expectedRecentBars),
  };
}

function shouldRestrictHistoricalSynthesisToBrokerBackfill(
  input: GetBarsInput,
  brokerBars: BrokerBarSnapshot[],
): boolean {
  return Boolean(
    brokerBars.length &&
      input.assetClass !== "option" &&
      input.market !== "futures",
  );
}

function isHistoricalSynthesisBar(bar: BrokerBarSnapshot): boolean {
  const source =
    typeof bar.source === "string" ? bar.source.trim().toLowerCase() : "";
  const massiveDelayed =
    source.includes("massive") &&
    (bar.delayed === true ||
      bar.freshness === "delayed" ||
      bar.marketDataMode === "delayed" ||
      !isMassiveStocksRealtimeConfigured());
  return massiveDelayed || Boolean(bar.delayed);
}

function restrictHistoricalSynthesisToBrokerBackfill(
  input: GetBarsInput,
  synthesisBars: BrokerBarSnapshot[],
  brokerBars: BrokerBarSnapshot[],
): BrokerBarSnapshot[] {
  if (
    !synthesisBars.length ||
    !shouldRestrictHistoricalSynthesisToBrokerBackfill(input, brokerBars)
  ) {
    return synthesisBars;
  }

  const oldestBrokerTimestampMs = brokerBars.reduce((oldest, bar) => {
    const timestampMs = bar.timestamp.getTime();
    return Number.isFinite(timestampMs)
      ? Math.min(oldest, timestampMs)
      : oldest;
  }, Number.POSITIVE_INFINITY);
  if (!Number.isFinite(oldestBrokerTimestampMs)) {
    return synthesisBars;
  }

  return synthesisBars.filter((bar) => {
    if (!isHistoricalSynthesisBar(bar)) {
      return true;
    }
    return bar.timestamp.getTime() < oldestBrokerTimestampMs;
  });
}

const RECENT_COVERAGE_STALE_TOLERANCE_MS = 20 * 60_000;

function resolveBrokerBarTimestampMs(
  bar: BrokerBarSnapshot | null | undefined,
): number | null {
  const timestampMs = bar?.timestamp?.getTime();
  return typeof timestampMs === "number" && Number.isFinite(timestampMs)
    ? timestampMs
    : null;
}

function resolveNewestBarTimestampMs(
  bars: readonly BrokerBarSnapshot[],
): number | null {
  const latestMs = resolveBrokerBarTimestampMs(getLatestBar(bars));
  return latestMs == null ? null : latestMs;
}

function shouldFetchHistoricalSynthesisForRecentCoverage(input: {
  request: GetBarsInput;
  storedHistoricalBars: BrokerBarSnapshot[];
  brokerBars: BrokerBarSnapshot[];
  now: Date;
  enabled: boolean;
  staleToleranceMs?: number | null;
}): boolean {
  if (!input.enabled) {
    return false;
  }

  const stepMs = BROKER_HISTORY_STEP_MS[input.request.timeframe];
  if (!stepMs) {
    return false;
  }

  const desiredBars = Math.max(1, input.request.limit ?? DEFAULT_BARS_LIMIT);
  if (input.brokerBars.length >= desiredBars) {
    return false;
  }

  const requestedToMs = Math.min(
    (input.request.to ?? input.now).getTime(),
    input.now.getTime(),
  );
  if (!Number.isFinite(requestedToMs)) {
    return false;
  }

  const newestStoredMs = resolveNewestBarTimestampMs(
    input.storedHistoricalBars,
  );
  const newestBrokerMs = resolveNewestBarTimestampMs(input.brokerBars);
  const newestExistingMs = Math.max(
    newestStoredMs ?? Number.NEGATIVE_INFINITY,
    newestBrokerMs ?? Number.NEGATIVE_INFINITY,
  );
  const configuredStaleToleranceMs = Number(input.staleToleranceMs);
  const staleToleranceMs =
    Number.isFinite(configuredStaleToleranceMs) &&
    configuredStaleToleranceMs >= 0
      ? configuredStaleToleranceMs
      : Math.max(RECENT_COVERAGE_STALE_TOLERANCE_MS, stepMs * 3);

  if (
    !Number.isFinite(newestExistingMs) ||
    requestedToMs - newestExistingMs > staleToleranceMs
  ) {
    return true;
  }

  const oldestBrokerMs = resolveBrokerBarTimestampMs(
    getOldestBar(input.brokerBars),
  );
  if (
    newestStoredMs != null &&
    oldestBrokerMs != null &&
    oldestBrokerMs - newestStoredMs > stepMs * 2
  ) {
    return true;
  }

  return false;
}

function isRealtimeMassiveSignalMatrixBarsRequest(input: {
  providerIdentity: ReturnType<typeof getMassiveProviderIdentity>;
  massiveConfig: ReturnType<typeof getMassiveRuntimeConfig>;
  options: GetBarsOptions;
}) {
  return (
    input.providerIdentity === "massive" &&
    isMassiveStocksRealtimeConfigured(input.massiveConfig) &&
    normalizeBarsRequestFamily(input.options.family) === "signal-matrix"
  );
}

function resolveRecentCoverageStaleToleranceMs(input: {
  request: GetBarsInput;
  providerIdentity: ReturnType<typeof getMassiveProviderIdentity>;
  massiveConfig: ReturnType<typeof getMassiveRuntimeConfig>;
  options: GetBarsOptions;
}): number | null {
  const stepMs = BROKER_HISTORY_STEP_MS[input.request.timeframe];
  if (
    stepMs &&
    isRealtimeMassiveSignalMatrixBarsRequest({
      providerIdentity: input.providerIdentity,
      massiveConfig: input.massiveConfig,
      options: input.options,
    })
  ) {
    return Math.max(stepMs, 60_000);
  }
  return null;
}

function shouldFetchIbkrOvernightHistory(
  input: GetBarsInput,
  outsideRth: boolean,
): boolean {
  return Boolean(
    outsideRth &&
      input.outsideRth === true &&
      input.assetClass !== "option" &&
      input.market !== "futures" &&
      (input.source == null || input.source === "trades") &&
      IBKR_OVERNIGHT_HISTORY_TIMEFRAMES.has(
        input.timeframe as HistoryBarTimeframe,
      ),
  );
}

function markIbkrOvernightHistoryBars(
  bars: BrokerBarSnapshot[],
): BrokerBarSnapshot[] {
  return bars.map((bar) => ({
    ...bar,
    source: IBKR_OVERNIGHT_HISTORY_SOURCE,
    outsideRth: true,
    transport: "tws",
  }));
}

function readNewYorkOvernightClockParts(
  value: Date,
): { weekday: number; minutes: number } | null {
  if (!Number.isFinite(value.getTime())) {
    return null;
  }
  const parts = NEW_YORK_OVERNIGHT_CLOCK_FORMATTER.formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = WEEKDAY_INDEX[read("weekday")];
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  if (weekday == null || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return { weekday, minutes: hour * 60 + minute };
}

function isUsEquityOvernightTradingTime(value: Date): boolean {
  const parts = readNewYorkOvernightClockParts(value);
  if (!parts) {
    return false;
  }
  if (parts.minutes < 3 * 60 + 50) {
    return parts.weekday >= 1 && parts.weekday <= 5;
  }
  if (parts.minutes >= 20 * 60) {
    return parts.weekday >= 0 && parts.weekday <= 4;
  }
  return false;
}

function filterIbkrOvernightHistoryBars(
  bars: BrokerBarSnapshot[],
): BrokerBarSnapshot[] {
  return bars.filter((bar) => isUsEquityOvernightTradingTime(bar.timestamp));
}

function decorateIbkrHistoryBar(bar: BrokerBarSnapshot): BrokerBarSnapshot {
  const source =
    bar.source === IBKR_OVERNIGHT_HISTORY_SOURCE
      ? IBKR_OVERNIGHT_HISTORY_SOURCE
      : IBKR_HISTORY_SOURCE;
  return {
    ...bar,
    source,
    transport: "tws",
  };
}

function mergeBrokerHistoryBars(
  primaryBars: BrokerBarSnapshot[],
  overnightBars: BrokerBarSnapshot[],
): BrokerBarSnapshot[] {
  if (!overnightBars.length) {
    return primaryBars;
  }

  const merged = new Map<number, BrokerBarSnapshot>();
  overnightBars.forEach((bar) => {
    merged.set(bar.timestamp.getTime(), bar);
  });
  primaryBars.forEach((bar) => {
    merged.set(bar.timestamp.getTime(), bar);
  });
  return Array.from(merged.values()).sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
}

// Coalesce identical /api/bars requests so multiple chart panels
// (or refetches racing each other) share a single upstream IBKR/Massive
// fetch. The bridge can hold an upstream history slot for 7-15s, so even
// a small TTL of a few seconds dramatically reduces request volume.
const BARS_CACHE_TTL_MS = 30_000;
const BARS_CACHE_STALE_TTL_MS = 10 * 60_000;
const BARS_CACHE_MAX_ENTRIES = 1_024;
const BARS_PROVIDER_BUDGET_MS = readPositiveIntegerEnv(
  "BARS_PROVIDER_BUDGET_MS",
  3_000,
);
const BARS_BROKER_BACKFILL_BUDGET_MS = readPositiveIntegerEnv(
  "BARS_BROKER_BACKFILL_BUDGET_MS",
  Math.max(BARS_PROVIDER_BUDGET_MS, 8_000),
);
const BARS_BROKER_BACKFILL_EMPTY_RETRY_DELAY_MS = readPositiveIntegerEnv(
  "BARS_BROKER_BACKFILL_EMPTY_RETRY_DELAY_MS",
  750,
);
const BARS_BROKER_LIVE_EDGE_MIN_PRIORITY = 6;
const BARS_HIGH_PRESSURE_STALE_REFRESH_MIN_PRIORITY = 8;
const BARS_FULL_BROKER_RECOVERY_MIN_PRIORITY = 8;
const BARS_SYNTHESIS_ONLY_CACHE_TTL_MS = readPositiveIntegerEnv(
  "BARS_SYNTHESIS_ONLY_CACHE_TTL_MS",
  BARS_CACHE_TTL_MS,
);
const BARS_IN_FLIGHT_STALE_MS = readPositiveIntegerEnv(
  "BARS_IN_FLIGHT_STALE_MS",
  Math.max(30_000, BARS_BROKER_BACKFILL_BUDGET_MS * 4),
);
const OPTION_HISTORY_REFERENCE_PROVIDER_FRESH_MS = readPositiveIntegerEnv(
  "OPTION_HISTORY_REFERENCE_PROVIDER_FRESH_MS",
  15 * 60_000,
);
const CHART_HISTORY_CURSOR_TTL_MS = readPositiveIntegerEnv(
  "CHART_HISTORY_CURSOR_TTL_MS",
  10 * 60_000,
);
const CHART_HISTORY_CURSOR_MAX_ENTRIES = readPositiveIntegerEnv(
  "CHART_HISTORY_CURSOR_MAX_ENTRIES",
  512,
);
type ChartHistoryCursorRecord = {
  signature: string;
  providerNextUrl: string;
  createdAt: number;
  expiresAt: number;
};
const chartHistoryCursors = new Map<string, ChartHistoryCursorRecord>();
const barsHydrationCounters = {
  cacheHit: 0,
  cacheMiss: 0,
  cacheInvalidated: 0,
  inFlightJoin: 0,
  staleServed: 0,
  providerFetch: 0,
  providerPage: 0,
  chartBackfillProviderFetch: 0,
  chartBackfillCursorFetch: 0,
  cursorContinuation: 0,
  cursorFallback: 0,
  backgroundRefresh: 0,
  backgroundRefreshPressureSkipped: 0,
  synthesisCacheServed: 0,
  synthesisCacheBypassed: 0,
};
const barsHydrationBreakdown = {
  byFamily: {} as Record<string, number>,
  byPriority: {} as Record<string, number>,
  byPayloadClass: {} as Record<string, number>,
  byFamilyCacheStatus: {} as Record<string, number>,
};
function createBarsRequestAbortedError() {
  return new HttpError(499, "Bars request was aborted.", {
    code: "bars_request_aborted",
  });
}

function throwIfBarsSignalAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createBarsRequestAbortedError();
  }
}

async function awaitWithBarsAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  throwIfBarsSignalAborted(signal);

  let abortListener: (() => void) | null = null;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(createBarsRequestAbortedError());
    signal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
}
const barsCache = new Map<
  string,
  {
    input: GetBarsInput;
    value: GetBarsResult;
    cachedAt: number;
    expiresAt: number;
    staleExpiresAt: number;
  }
>();
const barsInFlight = new Map<
  string,
  { input: GetBarsInput; promise: Promise<GetBarsResult>; startedAt: number }
>();
let barsCacheInvalidationVersion = 0;

function pruneBarsCache(now: number): void {
  for (const [key, entry] of barsCache) {
    if (entry.staleExpiresAt <= now) {
      barsCache.delete(key);
    }
  }
  if (barsCache.size <= BARS_CACHE_MAX_ENTRIES) {
    return;
  }
  // Map preserves insertion order, so dropping the oldest entries first
  // gives us a simple FIFO bound to keep memory in check on long runs
  // with many unique symbol/timeframe combinations.
  const overflow = barsCache.size - BARS_CACHE_MAX_ENTRIES;
  let removed = 0;
  for (const key of barsCache.keys()) {
    if (removed >= overflow) break;
    barsCache.delete(key);
    removed += 1;
  }
}

function buildBarsCacheKey(input: GetBarsInput): string {
  return JSON.stringify({
    symbol: normalizeSymbol(input.symbol),
    timeframe: input.timeframe,
    limit: input.limit ?? null,
    from: input.from ? input.from.getTime() : null,
    to: input.to ? input.to.getTime() : null,
    historyCursor: input.historyCursor ?? null,
    preferCursor: input.preferCursor ?? null,
    assetClass: input.assetClass ?? null,
    market: input.market ?? null,
    providerContractId: input.providerContractId ?? null,
    outsideRth: input.outsideRth ?? null,
    source: input.source ?? null,
    allowHistoricalSynthesis: input.allowHistoricalSynthesis ?? null,
    allowStudyFallback: input.allowStudyFallback ?? null,
    brokerRecentWindowMinutes: input.brokerRecentWindowMinutes ?? null,
  });
}

function buildBarsScopeKey(input: GetBarsInput): string {
  return JSON.stringify({
    symbol: normalizeSymbol(input.symbol),
    timeframe: input.timeframe,
    from: input.from ? input.from.getTime() : null,
    to: input.to ? input.to.getTime() : null,
    assetClass: input.assetClass ?? null,
    market: input.market ?? null,
    providerContractId: input.providerContractId ?? null,
    outsideRth: input.outsideRth ?? null,
    source: input.source ?? null,
    allowHistoricalSynthesis: input.allowHistoricalSynthesis ?? null,
    allowStudyFallback: input.allowStudyFallback ?? null,
    brokerRecentWindowMinutes: input.brokerRecentWindowMinutes ?? null,
  });
}

function shouldInvalidateBarsEntryForDurableWrite(
  entryInput: GetBarsInput,
  writeInput: GetBarsInput,
): boolean {
  if (
    normalizeSymbol(entryInput.symbol) !== normalizeSymbol(writeInput.symbol)
  ) {
    return false;
  }
  if (entryInput.timeframe !== writeInput.timeframe) {
    return false;
  }
  if (
    entryInput.assetClass === "option" ||
    entryInput.providerContractId?.trim()
  ) {
    return false;
  }
  if (entryInput.source && entryInput.source !== "trades") {
    return false;
  }
  return true;
}

function invalidateBarsCacheForDurableWrite(writeInput: GetBarsInput): void {
  let removed = 0;
  for (const [key, entry] of barsCache) {
    if (shouldInvalidateBarsEntryForDurableWrite(entry.input, writeInput)) {
      barsCache.delete(key);
      removed += 1;
    }
  }
  for (const [key, entry] of barsInFlight) {
    if (shouldInvalidateBarsEntryForDurableWrite(entry.input, writeInput)) {
      barsInFlight.delete(key);
      removed += 1;
    }
  }
  if (removed > 0) {
    barsCacheInvalidationVersion += 1;
    barsHydrationCounters.cacheInvalidated += removed;
  }
}

function isBarsInFlightStale(
  entry: { startedAt: number },
  now = Date.now(),
): boolean {
  return now - entry.startedAt > BARS_IN_FLIGHT_STALE_MS;
}

function isChartHydrationCursorEnabled(): boolean {
  return readBooleanEnv("CHART_HYDRATION_CURSOR_ENABLED", true);
}

function isChartHydrationDedupeEnabled(): boolean {
  return readBooleanEnv("CHART_HYDRATION_DEDUPE_ENABLED", true);
}

function isChartHydrationBackgroundEnabled(): boolean {
  return readBooleanEnv("CHART_HYDRATION_BACKGROUND_ENABLED", true);
}

function shouldRefreshStaleBarsInBackground(
  options: GetBarsOptions = {},
): boolean {
  if (!isChartHydrationBackgroundEnabled() || options.signal?.aborted) {
    return false;
  }
  const pressureLevel = getApiResourcePressureSnapshot().level;
  if (pressureLevel === "critical") {
    return false;
  }
  if (pressureLevel === "high") {
    return (
      typeof options.priority === "number" &&
      Number.isFinite(options.priority) &&
      options.priority >= BARS_HIGH_PRESSURE_STALE_REFRESH_MIN_PRIORITY
    );
  }
  return true;
}

function pruneChartHistoryCursors(now = Date.now()): void {
  for (const [token, record] of chartHistoryCursors) {
    if (record.expiresAt <= now) {
      chartHistoryCursors.delete(token);
    }
  }

  if (chartHistoryCursors.size <= CHART_HISTORY_CURSOR_MAX_ENTRIES) {
    return;
  }

  const overflow = chartHistoryCursors.size - CHART_HISTORY_CURSOR_MAX_ENTRIES;
  let removed = 0;
  for (const token of chartHistoryCursors.keys()) {
    if (removed >= overflow) break;
    chartHistoryCursors.delete(token);
    removed += 1;
  }
}

function createChartHistoryCursor(
  signature: string | null | undefined,
  providerNextUrl?: string | null,
): string | null {
  if (
    !isChartHydrationCursorEnabled() ||
    !signature ||
    !providerNextUrl?.trim()
  ) {
    return null;
  }

  const now = Date.now();
  pruneChartHistoryCursors(now);
  const token = randomUUID();
  chartHistoryCursors.set(token, {
    signature,
    providerNextUrl,
    createdAt: now,
    expiresAt: now + CHART_HISTORY_CURSOR_TTL_MS,
  });
  return token;
}

function resolveChartHistoryCursor(input: {
  token?: string | null;
  signature: string;
}):
  | { ok: true; providerNextUrl: string }
  | {
      ok: false;
      reason:
        | "disabled"
        | "missing"
        | "not_found"
        | "expired"
        | "signature_mismatch";
    } {
  if (!isChartHydrationCursorEnabled()) {
    return { ok: false, reason: "disabled" };
  }
  if (!input.token?.trim()) {
    return { ok: false, reason: "missing" };
  }

  const token = input.token.trim();
  const record = chartHistoryCursors.get(token);
  if (!record) {
    return { ok: false, reason: "not_found" };
  }
  if (record.expiresAt <= Date.now()) {
    chartHistoryCursors.delete(token);
    return { ok: false, reason: "expired" };
  }
  if (record.signature !== input.signature) {
    return { ok: false, reason: "signature_mismatch" };
  }

  return { ok: true, providerNextUrl: record.providerNextUrl };
}

function buildBarsHistoryCursorSignature(input: GetBarsInput): string {
  return JSON.stringify({
    kind: "bars",
    symbol: normalizeSymbol(input.symbol),
    timeframe: input.timeframe,
    assetClass: input.assetClass ?? "equity",
    market: input.market ?? null,
    providerContractId: input.providerContractId ?? null,
    outsideRth: input.outsideRth ?? null,
    source: input.source ?? null,
  });
}

function buildOptionChartHistoryCursorSignature(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  optionTicker: string | null;
  providerContractId?: string | null;
  timeframe: GetBarsInput["timeframe"];
  outsideRth?: boolean;
}): string {
  return JSON.stringify({
    kind: "option-chart-bars",
    underlying: normalizeSymbol(input.underlying),
    expirationDate: input.expirationDate.toISOString().slice(0, 10),
    strike: Number.isFinite(input.strike) ? input.strike : null,
    right: input.right,
    optionTicker: input.optionTicker ?? null,
    providerContractId: input.providerContractId ?? null,
    timeframe: input.timeframe,
    outsideRth: input.outsideRth ?? null,
  });
}

function sliceBarsResultForRequest(
  value: GetBarsResult,
  input: GetBarsInput,
): GetBarsResult {
  const desiredBars = Math.max(input.limit ?? value.bars.length ?? 0, 1);
  const bars =
    value.bars.length > desiredBars
      ? value.bars.slice(-desiredBars)
      : value.bars;
  return {
    ...value,
    bars,
    historyPage: buildBarsHistoryPage({
      request: input,
      bars,
      provider:
        bars[bars.length - 1]?.source ?? value.historyPage?.provider ?? null,
      exhaustedBefore: value.historyPage?.exhaustedBefore ?? false,
      providerCursor: value.historyPage?.providerCursor ?? null,
      providerNextUrl: value.historyPage?.providerNextUrl ?? null,
      providerPageCount: value.historyPage?.providerPageCount ?? null,
      providerPageLimitReached:
        value.historyPage?.providerPageLimitReached ?? false,
      historyCursor: value.historyPage?.historyCursor ?? null,
      hydrationStatus: value.historyPage?.hydrationStatus,
      cacheStatus: value.historyPage?.cacheStatus ?? null,
    }),
  };
}

type ReusableCachedBarsEntry = {
  input: GetBarsInput;
  value: GetBarsResult;
  fresh: boolean;
  ageMs: number | null;
};

const DEFAULT_BARS_REQUEST_FAMILY = "unspecified";

function normalizeBarsRequestFamily(value?: string | null): string {
  const normalized =
    typeof value === "string"
      ? value
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_.:-]+/g, "-")
      : "";
  return normalized ? normalized.slice(0, 64) : DEFAULT_BARS_REQUEST_FAMILY;
}

function resolveBarsPriorityBucket(priority?: number | null): string {
  if (!Number.isFinite(priority)) {
    return "unknown";
  }
  if ((priority as number) >= 8) return "active";
  if ((priority as number) >= BARS_BROKER_LIVE_EDGE_MIN_PRIORITY) {
    return "visible";
  }
  if ((priority as number) >= 4) return "near";
  if ((priority as number) >= 0) return "background";
  return "idle";
}

function incrementBarsBreakdown(
  record: Record<string, number>,
  key: string | null | undefined,
): void {
  const normalizedKey = key?.trim() || "unknown";
  record[normalizedKey] = (record[normalizedKey] || 0) + 1;
}

function resetBarsHydrationBreakdown(): void {
  barsHydrationBreakdown.byFamily = {};
  barsHydrationBreakdown.byPriority = {};
  barsHydrationBreakdown.byPayloadClass = {};
  barsHydrationBreakdown.byFamilyCacheStatus = {};
}

function recordBarsHydrationBreakdown(debug: RequestDebugMetadata): void {
  const family = normalizeBarsRequestFamily(debug.family);
  const priorityBucket =
    debug.priorityBucket ?? resolveBarsPriorityBucket(debug.priority);
  const payloadClass = debug.payloadClass ?? "empty";

  incrementBarsBreakdown(barsHydrationBreakdown.byFamily, family);
  incrementBarsBreakdown(barsHydrationBreakdown.byPriority, priorityBucket);
  incrementBarsBreakdown(barsHydrationBreakdown.byPayloadClass, payloadClass);
  incrementBarsBreakdown(
    barsHydrationBreakdown.byFamilyCacheStatus,
    `${family}:${debug.cacheStatus}`,
  );
}

function isBrokerBackfillSensitiveBarsRequest(input: GetBarsInput): boolean {
  return Boolean(
    input.allowHistoricalSynthesis !== false &&
      input.assetClass !== "option" &&
      input.market !== "futures" &&
      input.outsideRth !== false &&
      (input.source == null || input.source === "trades") &&
      BROKER_HISTORY_TIMEFRAMES.has(input.timeframe as HistoryBarTimeframe),
  );
}

function isChartBackfillBarsRequest(
  input: GetBarsInput,
  options: GetBarsOptions = {},
): boolean {
  if (
    input.allowHistoricalSynthesis === false ||
    input.assetClass === "option" ||
    input.market === "futures" ||
    (input.source != null && input.source !== "trades")
  ) {
    return false;
  }

  if (normalizeBarsRequestFamily(options.family) === "chart-backfill") {
    return true;
  }

  return Boolean(
    input.from &&
      input.to &&
      input.brokerRecentWindowMinutes === 0 &&
      BROKER_HISTORY_TIMEFRAMES.has(input.timeframe as HistoryBarTimeframe),
  );
}

function isBarsProviderCursorContinuationRequested(
  input: GetBarsInput,
): boolean {
  return Boolean(input.preferCursor && input.historyCursor?.trim());
}

function hasBrokerHistoryBars(value: GetBarsResult): boolean {
  return value.bars.some((bar) => {
    const source = String(bar.source || "")
      .trim()
      .toLowerCase();
    return (
      source === IBKR_HISTORY_SOURCE || source === IBKR_OVERNIGHT_HISTORY_SOURCE
    );
  });
}

function classifyBarsPayload(value: GetBarsResult): BarsPayloadClass {
  if (!value.bars.length) {
    return "empty";
  }
  const hasBroker = hasBrokerHistoryBars(value);
  const hasSynthesis = value.bars.some(isHistoricalSynthesisBar);
  if (hasBroker && hasSynthesis) return "mixed";
  if (hasBroker) return "broker-backed";
  return hasSynthesis ? "synthesis-only" : "broker-backed";
}

type BarsCacheServeOptions = {
  priority?: number;
  now: number;
  cachedAt?: number;
  allowStale?: boolean;
};

function shouldServeBarsCacheEntry(
  requestInput: GetBarsInput,
  cachedValue: GetBarsResult,
  options: BarsCacheServeOptions,
): boolean {
  if (!isBrokerBackfillSensitiveBarsRequest(requestInput)) {
    return true;
  }
  if (!cachedValue.bars.length || hasBrokerHistoryBars(cachedValue)) {
    return true;
  }
  if (!cachedValue.bars.some(isHistoricalSynthesisBar)) {
    return true;
  }

  if (shouldAttemptFullBrokerHistoryRecovery({ priority: options.priority })) {
    return false;
  }
  if (options.allowStale) {
    return false;
  }

  const ageMs = Number.isFinite(options.cachedAt)
    ? Math.max(0, options.now - (options.cachedAt as number))
    : Number.POSITIVE_INFINITY;
  if (ageMs <= BARS_SYNTHESIS_ONLY_CACHE_TTL_MS) {
    return true;
  }

  return false;
}

function findReusableCachedBarsEntry(
  input: GetBarsInput,
  now: number,
  allowStale = false,
  options: Pick<BarsCacheServeOptions, "priority"> = {},
): ReusableCachedBarsEntry | null {
  if (input.preferCursor && input.historyCursor) {
    return null;
  }
  const scopeKey = buildBarsScopeKey(input);
  const desiredLimit = input.limit ?? DEFAULT_BARS_LIMIT;

  for (const [key, entry] of barsCache) {
    if (entry.staleExpiresAt <= now) {
      barsCache.delete(key);
      continue;
    }

    const fresh = entry.expiresAt > now;
    if (!fresh && !allowStale) {
      continue;
    }
    if (
      !shouldServeBarsCacheEntry(input, entry.value, {
        ...options,
        now,
        cachedAt: entry.cachedAt,
        allowStale: !fresh,
      })
    ) {
      continue;
    }

    if (buildBarsScopeKey(entry.input) !== scopeKey) {
      continue;
    }

    if ((entry.input.limit ?? DEFAULT_BARS_LIMIT) < desiredLimit) {
      continue;
    }

    return {
      input: entry.input,
      value: sliceBarsResultForRequest(entry.value, input),
      fresh,
      ageMs: Number.isFinite(entry.cachedAt)
        ? Math.max(0, now - entry.cachedAt)
        : null,
    };
  }

  return null;
}

function findReusableBarsInFlight(
  input: GetBarsInput,
): Promise<GetBarsResult> | null {
  if (input.preferCursor && input.historyCursor) {
    return null;
  }
  const scopeKey = buildBarsScopeKey(input);
  const desiredLimit = input.limit ?? DEFAULT_BARS_LIMIT;
  const now = Date.now();

  for (const [key, entry] of barsInFlight) {
    if (isBarsInFlightStale(entry, now)) {
      barsInFlight.delete(key);
      continue;
    }

    if (buildBarsScopeKey(entry.input) !== scopeKey) {
      continue;
    }

    if ((entry.input.limit ?? DEFAULT_BARS_LIMIT) < desiredLimit) {
      continue;
    }

    return entry.promise.then((value) =>
      sliceBarsResultForRequest(value, input),
    );
  }

  return null;
}

function withBarsDebug(
  value: GetBarsResult,
  debug: GetBarsRequestDebug,
): GetBarsResultWithDebug {
  const family = normalizeBarsRequestFamily(debug.family);
  const priority =
    typeof debug.priority === "number" && Number.isFinite(debug.priority)
      ? debug.priority
      : null;
  const priorityBucket = resolveBarsPriorityBucket(priority);
  const payloadClass = classifyBarsPayload(value);
  const enrichedDebug: GetBarsRequestDebug = {
    ...debug,
    family,
    priority,
    priorityBucket,
    payloadClass,
  };
  if (
    enrichedDebug.cacheStatus === "hit" &&
    payloadClass === "synthesis-only"
  ) {
    barsHydrationCounters.synthesisCacheServed += 1;
  }
  recordBarsHydrationBreakdown(enrichedDebug);
  const hydrationStatus: BarsHistoryPage["hydrationStatus"] =
    enrichedDebug.stale
      ? "warming"
      : (value.historyPage?.hydrationStatus ??
        (value.bars.length ? "warm" : "cold"));
  return {
    ...value,
    historyPage: value.historyPage
      ? {
          ...value.historyPage,
          cacheStatus:
            enrichedDebug.cacheStatus === "inflight"
              ? "partial"
              : enrichedDebug.cacheStatus,
          hydrationStatus,
        }
      : value.historyPage,
    debug: enrichedDebug,
  };
}

function resolveWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  options: { signal?: AbortSignal; createAbortError?: () => Error } = {},
): Promise<T> {
  if (options.signal?.aborted) {
    throw (options.createAbortError ?? createBarsRequestAbortedError)();
  }
  let timeoutId: NodeJS.Timeout | null = null;
  let abortListener: (() => void) | null = null;
  const timeout = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
    timeoutId.unref?.();
  });
  const abort = options.signal
    ? new Promise<never>((_resolve, reject) => {
        abortListener = () =>
          reject((options.createAbortError ?? createBarsRequestAbortedError)());
        options.signal?.addEventListener("abort", abortListener, {
          once: true,
        });
      })
    : null;

  return Promise.race(
    abort ? [promise, timeout, abort] : [promise, timeout],
  ).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (abortListener) {
      options.signal?.removeEventListener("abort", abortListener);
    }
  });
}

function shouldAttemptFullBrokerHistoryRecovery(
  options: GetBarsOptions,
): boolean {
  const priority = Number(options.priority);
  return (
    Number.isFinite(priority) &&
    priority >= BARS_FULL_BROKER_RECOVERY_MIN_PRIORITY
  );
}

function shouldAttemptBrokerLiveEdgeHistory(options: GetBarsOptions): boolean {
  const priority = Number(options.priority);
  return (
    Number.isFinite(priority) && priority >= BARS_BROKER_LIVE_EDGE_MIN_PRIORITY
  );
}

function delayBarsRetry(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  if (signal?.aborted) {
    throw createBarsRequestAbortedError();
  }
  let onAbort: (() => void) | null = null;
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    timeout.unref?.();
    onAbort = () => {
      clearTimeout(timeout);
      reject(createBarsRequestAbortedError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  }).finally(() => {
    if (onAbort) {
      signal?.removeEventListener("abort", onAbort);
    }
  });
}

export async function getBarsWithDebug(
  input: GetBarsInput,
  options: GetBarsOptions = {},
): Promise<GetBarsResultWithDebug> {
  const sanitizedInput = sanitizeBarsInput(input);
  const key = buildBarsCacheKey(sanitizedInput);
  const requestedAt = Date.now();
  const dedupeEnabled = isChartHydrationDedupeEnabled();
  const debugContext = {
    family: normalizeBarsRequestFamily(options.family),
    priority:
      typeof options.priority === "number" && Number.isFinite(options.priority)
        ? options.priority
        : null,
  };
  throwIfBarsSignalAborted(options.signal);

  if (!dedupeEnabled) {
    const upstreamStartedAt = Date.now();
    barsHydrationCounters.cacheMiss += 1;
    const value = await getBarsImpl(sanitizedInput, options);
    return withBarsDebug(value, {
      ...debugContext,
      cacheStatus: "miss",
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
      gapFilled: value.gapFilled,
    });
  }

  const reusableCached = findReusableCachedBarsEntry(
    sanitizedInput,
    requestedAt,
    false,
    { priority: options.priority },
  );

  if (reusableCached) {
    barsHydrationCounters.cacheHit += 1;
    return withBarsDebug(reusableCached.value, {
      ...debugContext,
      cacheStatus: "hit",
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs: null,
      gapFilled: reusableCached.value.gapFilled,
      ageMs: reusableCached.ageMs,
    });
  }

  const cached = barsCache.get(key);
  const freshCachedServeable = Boolean(
    cached?.expiresAt &&
      cached.expiresAt > requestedAt &&
      shouldServeBarsCacheEntry(sanitizedInput, cached.value, {
        priority: options.priority,
        now: requestedAt,
        cachedAt: cached.cachedAt,
        allowStale: false,
      }),
  );
  if (freshCachedServeable && cached) {
    barsHydrationCounters.cacheHit += 1;
    return withBarsDebug(cached.value, {
      ...debugContext,
      cacheStatus: "hit",
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs: null,
      gapFilled: cached.value.gapFilled,
      ageMs: Number.isFinite(cached.cachedAt)
        ? Math.max(0, requestedAt - cached.cachedAt)
        : null,
    });
  }
  if (
    cached &&
    cached.expiresAt > requestedAt &&
    classifyBarsPayload(cached.value) === "synthesis-only"
  ) {
    barsHydrationCounters.synthesisCacheBypassed += 1;
  }

  const reusableStale = findReusableCachedBarsEntry(
    sanitizedInput,
    requestedAt,
    true,
    { priority: options.priority },
  );
  if (reusableStale) {
    barsHydrationCounters.cacheHit += 1;
    barsHydrationCounters.staleServed += 1;
    if (
      shouldRefreshStaleBarsInBackground({
        priority: options.priority,
        family: debugContext.family,
        signal: options.signal,
      })
    ) {
      barsHydrationCounters.backgroundRefresh += 1;
      refreshBarsCache(key, sanitizedInput, {
        priority: options.priority,
        family: debugContext.family,
      }).catch(() => {});
    } else if (isChartHydrationBackgroundEnabled()) {
      barsHydrationCounters.backgroundRefreshPressureSkipped += 1;
    }
    return withBarsDebug(reusableStale.value, {
      ...debugContext,
      cacheStatus: "hit",
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs: null,
      gapFilled: reusableStale.value.gapFilled,
      stale: true,
      ageMs: reusableStale.ageMs,
    });
  }
  if (cached) {
    barsCache.delete(key);
  }

  const reusableInFlight = findReusableBarsInFlight(sanitizedInput);
  if (reusableInFlight) {
    barsHydrationCounters.inFlightJoin += 1;
    const value = await awaitWithBarsAbort(reusableInFlight, options.signal);
    return withBarsDebug(value, {
      ...debugContext,
      cacheStatus: "inflight",
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs: null,
      gapFilled: value.gapFilled,
    });
  }
  const inFlight = barsInFlight.get(key);
  if (inFlight) {
    if (isBarsInFlightStale(inFlight, requestedAt)) {
      barsInFlight.delete(key);
    } else {
      barsHydrationCounters.inFlightJoin += 1;
      const value = await awaitWithBarsAbort(inFlight.promise, options.signal);
      return withBarsDebug(value, {
        ...debugContext,
        cacheStatus: "inflight",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        gapFilled: value.gapFilled,
      });
    }
  }

  const upstreamStartedAt = Date.now();
  barsHydrationCounters.cacheMiss += 1;
  const value = await refreshBarsCache(key, sanitizedInput, options);

  return withBarsDebug(value, {
    ...debugContext,
    cacheStatus: "miss",
    totalMs: Math.max(0, Date.now() - requestedAt),
    upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
    gapFilled: value.gapFilled,
  });
}

function refreshBarsCache(
  key: string,
  input: GetBarsInput,
  options: GetBarsOptions = {},
): Promise<GetBarsResult> {
  throwIfBarsSignalAborted(options.signal);
  const existing = barsInFlight.get(key);
  if (existing && !isBarsInFlightStale(existing)) {
    return awaitWithBarsAbort(existing.promise, options.signal);
  }
  if (existing) {
    barsInFlight.delete(key);
  }

  let promise: Promise<GetBarsResult> | null = null;
  const startedInvalidationVersion = barsCacheInvalidationVersion;
  promise = (async () => {
    try {
      const value = await getBarsImpl(input, options);
      const settledAt = Date.now();
      if (
        startedInvalidationVersion === barsCacheInvalidationVersion &&
        value.emptyReason !== "broker-history-error"
      ) {
        barsCache.set(key, {
          input,
          value,
          cachedAt: settledAt,
          expiresAt: settledAt + BARS_CACHE_TTL_MS,
          staleExpiresAt: settledAt + BARS_CACHE_STALE_TTL_MS,
        });
        pruneBarsCache(settledAt);
      }
      return value;
    } finally {
      const current = barsInFlight.get(key);
      if (promise && current?.promise === promise) {
        barsInFlight.delete(key);
      }
    }
  })();

  barsInFlight.set(key, {
    input,
    promise,
    startedAt: Date.now(),
  });
  return promise;
}

export async function getBars(input: GetBarsInput): Promise<GetBarsResult> {
  const { debug: _debug, ...value } = await getBarsWithDebug(input);
  return value;
}

const BAR_TIMEFRAME_MS: Partial<Record<GetBarsInput["timeframe"], number>> = {
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "30s": 30_000,
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const BASE_TIMEFRAME_BY_TIMEFRAME: Record<
  ChartBarTimeframe,
  NativeBarTimeframe
> = {
  "1s": "1s",
  "5s": "5s",
  "15s": "5s",
  "30s": "5s",
  "1m": "1m",
  "2m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "15m",
  "1h": "1h",
  "4h": "1h",
  "1d": "1d",
};

function getBaseBarsTimeframe(
  timeframe: ChartBarTimeframe,
): NativeBarTimeframe {
  return BASE_TIMEFRAME_BY_TIMEFRAME[timeframe] ?? timeframe;
}

function expandBarsLimitForBaseTimeframe(input: {
  limit: number;
  timeframe: ChartBarTimeframe;
  baseTimeframe: NativeBarTimeframe;
}): number {
  const targetStepMs = BAR_TIMEFRAME_MS[input.timeframe] ?? 0;
  const baseStepMs = BAR_TIMEFRAME_MS[input.baseTimeframe] ?? 0;
  if (!targetStepMs || !baseStepMs || baseStepMs >= targetStepMs) {
    return input.limit;
  }
  return Math.max(1, Math.ceil((input.limit * targetStepMs) / baseStepMs));
}

function rollupBarsResultToTimeframe(input: {
  requestedInput: GetBarsInput;
  baseResult: GetBarsResult;
}): GetBarsResult {
  const targetLimit = Math.max(
    input.requestedInput.limit ?? DEFAULT_BARS_LIMIT,
    1,
  );
  const rolledBars = normalizeBarsToStoreTimeframe(
    input.baseResult.bars,
    input.requestedInput.timeframe,
  ).slice(-targetLimit);
  const latestBar = getLatestBar(rolledBars);
  const dataUpdatedAt = getBarDataUpdatedAt(latestBar);
  const latestFreshness = latestBar
    ? normalizeFreshness({
        freshness: latestBar.freshness,
        marketDataMode:
          latestBar.marketDataMode ?? input.baseResult.marketDataMode,
        delayed: latestBar.delayed,
      })
    : "unavailable";
  const freshness =
    latestFreshness !== "frozen" &&
    latestFreshness !== "delayed_frozen" &&
    isBarStaleForTimeframe({
      bar: latestBar,
      timeframe: input.requestedInput.timeframe,
      assetClass: input.requestedInput.assetClass,
    })
      ? "stale"
      : latestFreshness;

  return {
    ...input.baseResult,
    timeframe: input.requestedInput.timeframe,
    bars: rolledBars,
    transport: latestBar?.transport ?? input.baseResult.transport,
    delayed: rolledBars.some((bar) => bar.delayed),
    freshness,
    marketDataMode:
      latestBar?.marketDataMode ?? input.baseResult.marketDataMode,
    dataUpdatedAt,
    ageMs: getAgeMs(dataUpdatedAt),
    emptyReason: rolledBars.length ? null : input.baseResult.emptyReason,
    historySource: latestBar?.source ?? input.baseResult.historySource,
    historyPage: buildBarsHistoryPage({
      request: input.requestedInput,
      bars: rolledBars,
      provider:
        latestBar?.source ??
        input.baseResult.historyPage?.provider ??
        input.baseResult.historySource ??
        null,
      exhaustedBefore: input.baseResult.historyPage?.exhaustedBefore ?? false,
      providerCursor: input.baseResult.historyPage?.providerCursor ?? null,
      providerNextUrl: input.baseResult.historyPage?.providerNextUrl ?? null,
      providerPageCount:
        input.baseResult.historyPage?.providerPageCount ?? null,
      providerPageLimitReached:
        input.baseResult.historyPage?.providerPageLimitReached ?? false,
      historyCursor: input.baseResult.historyPage?.historyCursor ?? null,
      hydrationStatus: input.baseResult.historyPage?.hydrationStatus,
      cacheStatus: input.baseResult.historyPage?.cacheStatus ?? null,
    }),
  };
}

function normalizeFreshness(input: {
  freshness?: MarketDataFreshness | string | null;
  marketDataMode?: string | null;
  delayed?: boolean | null;
}): MarketDataFreshness {
  const freshness = input.freshness;
  if (
    freshness === "live" ||
    freshness === "delayed" ||
    freshness === "frozen" ||
    freshness === "delayed_frozen" ||
    freshness === "stale" ||
    freshness === "metadata" ||
    freshness === "unavailable" ||
    freshness === "pending"
  ) {
    return freshness;
  }
  if (input.marketDataMode === "frozen") return "frozen";
  if (input.marketDataMode === "delayed_frozen") return "delayed_frozen";
  if (input.marketDataMode === "delayed" || input.delayed) return "delayed";
  if (input.marketDataMode === "live") return "live";
  return "unavailable";
}

function getLatestBar(
  bars: readonly BrokerBarSnapshot[],
): BrokerBarSnapshot | null {
  return bars.length ? (bars[bars.length - 1] ?? null) : null;
}

function getBarDataUpdatedAt(bar: BrokerBarSnapshot | null): Date | null {
  return bar?.dataUpdatedAt ?? bar?.timestamp ?? null;
}

function getAgeMs(value: Date | null, now = Date.now()): number | null {
  if (!value || Number.isNaN(value.getTime())) {
    return null;
  }
  return Math.max(0, now - value.getTime());
}

function getOldestBar(
  bars: readonly BrokerBarSnapshot[],
): BrokerBarSnapshot | null {
  return bars.length ? (bars[0] ?? null) : null;
}

function sanitizeProviderNextUrl(value?: string | null): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const url = new URL(value);
    url.searchParams.delete("apiKey");
    url.searchParams.delete("apikey");
    return url.toString();
  } catch {
    return /apiKey=/i.test(value) ? null : value;
  }
}

function buildMassiveHistoryPageMetadata(
  page?: MassiveAggregateBarsPage | null,
  cursorSignature?: string | null,
): Pick<
  BarsHistoryPage,
  | "providerCursor"
  | "providerNextUrl"
  | "providerPageCount"
  | "providerPageLimitReached"
  | "historyCursor"
> {
  const providerNextUrl = sanitizeProviderNextUrl(page?.nextUrl);
  return {
    providerCursor: providerNextUrl,
    providerNextUrl,
    providerPageCount:
      typeof page?.pageCount === "number" ? page.pageCount : null,
    providerPageLimitReached: Boolean(page?.pageLimitReached),
    historyCursor: createChartHistoryCursor(cursorSignature, page?.nextUrl),
  };
}

function mapMassiveBarsToBrokerBars(input: {
  bars: MassiveBarSnapshot[];
  sourceName: string;
  outsideRth: boolean;
  delayed: boolean;
}): BrokerBarSnapshot[] {
  return input.bars.map(
    (bar): BrokerBarSnapshot => ({
      timestamp: bar.timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      source: input.sourceName,
      providerContractId: null,
      outsideRth: input.outsideRth,
      partial: false,
      transport: "tws",
      delayed: input.delayed,
      freshness: input.delayed ? "delayed" : "live",
      marketDataMode: input.delayed ? "delayed" : "live",
      dataUpdatedAt: bar.timestamp,
      ageMs: getAgeMs(bar.timestamp),
    }),
  );
}

async function fetchMassiveBarsPage(
  client: MassiveMarketDataClient,
  input: Parameters<MassiveMarketDataClient["getBars"]>[0],
): Promise<MassiveAggregateBarsPage> {
  const pageFetcher = (
    client as Partial<Pick<MassiveMarketDataClient, "getBarsPage">>
  ).getBarsPage;
  if (typeof pageFetcher === "function") {
    return pageFetcher.call(client, input);
  }

  const bars = await client.getBars(input);
  return {
    bars,
    nextUrl: null,
    pageCount: bars.length ? 1 : 0,
    pageLimitReached: false,
    requestedFrom: input.from ?? new Date(0),
    requestedTo: input.to ?? new Date(),
  };
}

async function fetchMassiveOptionBarsPage(
  client: MassiveMarketDataClient,
  input: Parameters<MassiveMarketDataClient["getOptionAggregateBars"]>[0],
): Promise<MassiveAggregateBarsPage> {
  const pageFetcher = (
    client as Partial<
      Pick<MassiveMarketDataClient, "getOptionAggregateBarsPage">
    >
  ).getOptionAggregateBarsPage;
  if (typeof pageFetcher === "function") {
    return pageFetcher.call(client, input);
  }

  const bars = await client.getOptionAggregateBars(input);
  return {
    bars,
    nextUrl: null,
    pageCount: bars.length ? 1 : 0,
    pageLimitReached: false,
    requestedFrom: input.from ?? new Date(0),
    requestedTo: input.to ?? new Date(),
  };
}

async function fetchMassiveBarsProviderCursorPage(
  client: MassiveMarketDataClient,
  input: Parameters<MassiveMarketDataClient["getBarsProviderCursorPage"]>[0],
): Promise<MassiveAggregateBarsPage> {
  return client.getBarsProviderCursorPage(input);
}

function buildBarsHistoryPage(input: {
  request: GetBarsInput;
  bars: BrokerBarSnapshot[];
  provider: string | null;
  exhaustedBefore?: boolean;
  providerCursor?: string | null;
  providerNextUrl?: string | null;
  providerPageCount?: number | null;
  providerPageLimitReached?: boolean | null;
  historyCursor?: string | null;
  hydrationStatus?: BarsHistoryPage["hydrationStatus"];
  cacheStatus?: BarsHistoryPage["cacheStatus"];
}): BarsHistoryPage {
  const oldestBar = getOldestBar(input.bars);
  const newestBar = getLatestBar(input.bars);
  const stepMs = BAR_TIMEFRAME_MS[input.request.timeframe] ?? 0;
  const oldestBarAt = oldestBar?.timestamp ?? null;
  const newestBarAt = newestBar?.timestamp ?? null;
  const fallbackNextBefore =
    !oldestBarAt && input.request.from && stepMs > 0
      ? new Date(Math.max(0, input.request.from.getTime() - stepMs))
      : null;
  const nextBefore =
    oldestBarAt && stepMs > 0
      ? new Date(Math.max(0, oldestBarAt.getTime() - 1))
      : fallbackNextBefore;

  return {
    requestedFrom: input.request.from ?? null,
    requestedTo: input.request.to ?? null,
    oldestBarAt,
    newestBarAt,
    returnedCount: input.bars.length,
    nextBefore,
    provider: input.provider,
    exhaustedBefore: Boolean(input.exhaustedBefore),
    providerCursor: input.providerCursor ?? input.providerNextUrl ?? null,
    providerNextUrl: input.providerNextUrl ?? null,
    providerPageCount: input.providerPageCount ?? null,
    providerPageLimitReached: Boolean(input.providerPageLimitReached),
    historyCursor: input.historyCursor ?? null,
    hydrationStatus:
      input.hydrationStatus ??
      (input.exhaustedBefore
        ? "exhausted"
        : input.bars.length
          ? "warm"
          : "cold"),
    cacheStatus: input.cacheStatus ?? null,
  };
}

function isBarStaleForTimeframe(input: {
  bar: BrokerBarSnapshot | null;
  timeframe: GetBarsInput["timeframe"];
  assetClass?: GetBarsInput["assetClass"];
}): boolean {
  if (!input.bar) {
    return false;
  }
  const stepMs = BAR_TIMEFRAME_MS[input.timeframe] ?? 60_000;
  const freshness = normalizeFreshness(input.bar);
  const expectedDelayMs =
    freshness === "delayed" || input.bar.delayed ? 20 * 60_000 : 0;
  const staleAfterMs =
    input.timeframe === "1d"
      ? 36 * 60 * 60_000
      : Math.max(10 * 60_000, stepMs * 3) + expectedDelayMs;
  const ageMs = getAgeMs(getBarDataUpdatedAt(input.bar));
  return ageMs !== null && ageMs > staleAfterMs;
}

function resolveBarsEmptyReason(input: {
  request: GetBarsInput;
  attemptedBrokerHistory: boolean;
  brokerHistoryError: unknown;
}): string | null {
  if (
    input.request.assetClass === "option" &&
    !input.request.providerContractId
  ) {
    return "missing-provider-contract-id";
  }
  if (!input.attemptedBrokerHistory) {
    return "unsupported-broker-timeframe";
  }
  if (input.brokerHistoryError) {
    return "broker-history-error";
  }
  return "broker-history-empty";
}

function getOptionQuoteMark(quote: QuoteSnapshot | null): number | null {
  if (!quote) {
    return null;
  }
  if (quote.bid > 0 && quote.ask > 0) {
    return (quote.bid + quote.ask) / 2;
  }
  if (quote.price > 0) {
    return quote.price;
  }
  if (quote.ask > 0) {
    return quote.ask;
  }
  if (quote.bid > 0) {
    return quote.bid;
  }
  return null;
}

function buildOptionStudyFallbackBar(input: {
  request: GetBarsInput;
  quote: QuoteSnapshot;
  fallbackTransport: BrokerBarSnapshot["transport"];
}): BrokerBarSnapshot | null {
  const mark = getOptionQuoteMark(input.quote);
  if (mark === null || mark <= 0) {
    return null;
  }
  const dataUpdatedAt = input.quote.dataUpdatedAt ?? input.quote.updatedAt;
  const timestamp = dataUpdatedAt ?? new Date();

  return {
    timestamp,
    open: mark,
    high: mark,
    low: mark,
    close: mark,
    volume: input.quote.volume ?? 0,
    source: "option-study-quote-fallback",
    providerContractId: input.request.providerContractId ?? null,
    outsideRth: Boolean(input.request.outsideRth),
    partial: true,
    transport: input.quote.transport ?? input.fallbackTransport,
    delayed: Boolean(input.quote.delayed),
    freshness: normalizeFreshness(input.quote),
    marketDataMode: input.quote.marketDataMode ?? null,
    dataUpdatedAt,
    ageMs: getAgeMs(dataUpdatedAt),
  };
}

async function fetchOptionStudyFallbackBar(input: {
  request: GetBarsInput;
  bridgeClient: IbkrBridgeClient;
  fallbackTransport: BrokerBarSnapshot["transport"];
}): Promise<BrokerBarSnapshot | null> {
  const providerContractId = input.request.providerContractId?.trim();
  if (
    input.request.assetClass !== "option" ||
    !input.request.allowStudyFallback ||
    !providerContractId
  ) {
    return null;
  }

  const cachedQuote = getCurrentBridgeOptionQuoteSnapshots({
    underlying: input.request.symbol,
    providerContractIds: [providerContractId],
  }).find(
    (entry) =>
      entry.providerContractId === providerContractId &&
      entry.freshness !== "stale" &&
      entry.freshness !== "unavailable" &&
      entry.freshness !== "pending",
  );
  const quotes = cachedQuote
    ? [cachedQuote]
    : await resolveWithin(
        fetchBridgeOptionQuoteSnapshots({
          underlying: input.request.symbol,
          providerContractIds: [providerContractId],
          intent: "historical",
          fallbackProvider: "cache",
          requiresGreeks: false,
        }).then((payload) => payload.quotes),
        BARS_PROVIDER_BUDGET_MS,
        [],
      );
  const quote =
    quotes.find((entry) => entry.providerContractId === providerContractId) ??
    quotes[0] ??
    null;

  return quote
    ? buildOptionStudyFallbackBar({
        request: input.request,
        quote,
        fallbackTransport: input.fallbackTransport,
      })
    : null;
}

function decorateBarsResult(input: {
  request: GetBarsInput;
  bars: BrokerBarSnapshot[];
  bridgeHealth: Awaited<ReturnType<IbkrBridgeClient["getHealth"]>> | null;
  gapFilled: boolean;
  emptyReason: string | null;
  studyFallback: boolean;
  historyProvider?: string | null;
  historyPageMetadata?: Partial<
    Pick<
      BarsHistoryPage,
      | "providerCursor"
      | "providerNextUrl"
      | "providerPageCount"
      | "providerPageLimitReached"
      | "historyCursor"
    >
  >;
  exhaustedBefore?: boolean;
  hydrationStatus?: BarsHistoryPage["hydrationStatus"];
  cacheStatus?: BarsHistoryPage["cacheStatus"];
}) {
  const latestBar = getLatestBar(input.bars);
  const dataUpdatedAt = getBarDataUpdatedAt(latestBar);
  const ageMs = getAgeMs(dataUpdatedAt);
  const latestFreshness = latestBar
    ? normalizeFreshness({
        freshness: latestBar.freshness,
        marketDataMode:
          latestBar.marketDataMode ?? input.bridgeHealth?.marketDataMode,
        delayed: latestBar.delayed,
      })
    : "unavailable";
  const freshness =
    latestFreshness !== "frozen" &&
    latestFreshness !== "delayed_frozen" &&
    isBarStaleForTimeframe({
      bar: latestBar,
      timeframe: input.request.timeframe,
      assetClass: input.request.assetClass,
    })
      ? "stale"
      : latestFreshness;

  return {
    symbol: normalizeSymbol(input.request.symbol),
    timeframe: input.request.timeframe,
    bars: input.bars,
    transport: latestBar?.transport ?? input.bridgeHealth?.transport ?? null,
    delayed: input.bars.some((bar) => bar.delayed),
    gapFilled: input.gapFilled,
    freshness,
    marketDataMode:
      latestBar?.marketDataMode ?? input.bridgeHealth?.marketDataMode ?? null,
    dataUpdatedAt,
    ageMs,
    emptyReason: input.bars.length ? null : input.emptyReason,
    historySource: latestBar?.source ?? null,
    studyFallback: input.studyFallback,
    historyPage: buildBarsHistoryPage({
      request: input.request,
      bars: input.bars,
      provider: input.historyProvider ?? latestBar?.source ?? null,
      exhaustedBefore: Boolean(input.exhaustedBefore),
      providerCursor: input.historyPageMetadata?.providerCursor ?? null,
      providerNextUrl: input.historyPageMetadata?.providerNextUrl ?? null,
      providerPageCount: input.historyPageMetadata?.providerPageCount ?? null,
      providerPageLimitReached:
        input.historyPageMetadata?.providerPageLimitReached ?? false,
      historyCursor: input.historyPageMetadata?.historyCursor ?? null,
      hydrationStatus: input.hydrationStatus,
      cacheStatus: input.cacheStatus ?? null,
    }),
  };
}

async function getBarsImpl(input: GetBarsInput, options: GetBarsOptions = {}) {
  const baseTimeframe = getBaseBarsTimeframe(input.timeframe);
  if (baseTimeframe === input.timeframe) {
    return getBaseBarsImpl(input as NativeGetBarsInput, options);
  }

  const baseInput = sanitizeBarsInput({
    ...input,
    timeframe: baseTimeframe,
    limit: expandBarsLimitForBaseTimeframe({
      limit: input.limit ?? DEFAULT_BARS_LIMIT,
      timeframe: input.timeframe,
      baseTimeframe,
    }),
  }) as NativeGetBarsInput;
  const baseResult = await getBaseBarsImpl(baseInput, options);
  return rollupBarsResultToTimeframe({
    requestedInput: input,
    baseResult,
  });
}

async function getBaseBarsImpl(
  input: NativeGetBarsInput,
  options: GetBarsOptions = {},
) {
  throwIfBarsSignalAborted(options.signal);
  const bridgeClient = getIbkrClient();
  const bridgeHealth = await awaitWithBarsAbort(
    bridgeClient.getHealth().catch(() => null),
    options.signal,
  );
  const massiveConfig = getMassiveRuntimeConfig();
  const massiveClient = massiveConfig ? getMassiveClient() : null;
  const massiveProviderIdentity = getMassiveProviderIdentity(massiveConfig);
  const massiveBarsDelayed =
    massiveProviderIdentity === "massive" &&
    !isMassiveStocksRealtimeConfigured(massiveConfig);
  const historicalStoreSource =
    massiveProviderIdentity === "massive"
      ? "massive-history"
      : "massive-history";
  const historicalFallbackProvider = massiveClient
    ? massiveProviderIdentity === "massive"
      ? "massive"
      : "massive"
    : "cache";
  // Default to including extended hours across ALL timeframes so the "last close"
  // a chart shows is consistent regardless of the selected interval. Without this,
  // 1d returned RTH-only bars while 1m/5m/15m/1h returned extended-hours bars,
  // causing the most-recent price to differ depending on which interval was active.
  // Callers (e.g. backtest) can still pass outsideRth=false explicitly for strict RTH.
  const outsideRth =
    typeof input.outsideRth === "boolean" ? input.outsideRth : true;
  const isBrokerHistoryTimeframe = BROKER_HISTORY_TIMEFRAMES.has(
    input.timeframe as HistoryBarTimeframe,
  );
  const allowHistoricalSynthesis = input.allowHistoricalSynthesis !== false;
  const historicalSynthesisAvailable = Boolean(
    allowHistoricalSynthesis && input.market !== "futures" && massiveClient,
  );
  const brokerHistoryMayBeRecentLimited = shouldLimitBrokerHistoryToRecent(
    input,
    {
      historicalSynthesisAvailable,
    },
  );
  let ibkrBars: Awaited<ReturnType<IbkrBridgeClient["getHistoricalBars"]>> = [];
  let attemptedBrokerHistory = false;
  let brokerHistoryError: unknown = null;
  const fetchBrokerHistory = async (
    brokerHistoryInput: GetBarsInput,
    brokerHistoryOptions: { recoveryMode?: "live-edge" | "full" } = {},
  ) => {
    const recoveryMode = brokerHistoryOptions.recoveryMode ?? "live-edge";
    const fullBrokerRecovery =
      recoveryMode === "full" &&
      isBrokerBackfillSensitiveBarsRequest(brokerHistoryInput);
    const liveEdgeBrokerBackfill =
      recoveryMode === "live-edge" &&
      shouldAttemptBrokerLiveEdgeHistory(options) &&
      isBrokerBackfillSensitiveBarsRequest(brokerHistoryInput);
    const brokerBackfillBudget = fullBrokerRecovery || liveEdgeBrokerBackfill;
    const brokerHistoryBudgetMs = brokerBackfillBudget
      ? BARS_BROKER_BACKFILL_BUDGET_MS
      : BARS_PROVIDER_BUDGET_MS;
    const fetchBridgeHistory = (exchange?: string | null) =>
      runIbkrHistoricalRequest(
        {
          family: options.family,
          priority: options.priority,
          symbol: brokerHistoryInput.symbol,
          timeframe: brokerHistoryInput.timeframe,
          providerContractId: brokerHistoryInput.providerContractId,
          source: brokerHistoryInput.source,
          exchange,
          signal: options.signal,
        },
        () =>
          bridgeClient.getHistoricalBars({
            symbol: brokerHistoryInput.symbol,
            timeframe: brokerHistoryInput.timeframe as HistoryBarTimeframe,
            limit: brokerHistoryInput.limit,
            from: brokerHistoryInput.from,
            to: brokerHistoryInput.to,
            assetClass: brokerHistoryInput.assetClass,
            providerContractId: brokerHistoryInput.providerContractId,
            outsideRth,
            source: brokerHistoryInput.source,
            exchange,
            signal: options.signal,
            priority: options.priority,
          }),
      );

    const fetchOnce = async () => {
      const primaryBarsPromise = resolveWithin(
        fetchBridgeHistory(),
        brokerHistoryBudgetMs,
        [],
        {
          signal: options.signal,
          createAbortError: createBarsRequestAbortedError,
        },
      );
      if (!shouldFetchIbkrOvernightHistory(brokerHistoryInput, outsideRth)) {
        return primaryBarsPromise;
      }

      const fetchOvernightExchangeBars = (exchange: string) =>
        resolveWithin(
          fetchBridgeHistory(exchange)
            .then(filterIbkrOvernightHistoryBars)
            .catch(() => []),
          brokerHistoryBudgetMs,
          [],
          {
            signal: options.signal,
            createAbortError: createBarsRequestAbortedError,
          },
        );
      const overnightBarsPromise = fetchOvernightExchangeBars(
        IBKR_OVERNIGHT_EXCHANGE,
      );
      const [primaryBars, overnightBars] = await Promise.all([
        primaryBarsPromise,
        overnightBarsPromise,
      ]);
      const shouldFetchFallbackOvernightExchange =
        fullBrokerRecovery || !brokerHistoryMayBeRecentLimited;
      const fallbackOvernightBars =
        overnightBars.length || !shouldFetchFallbackOvernightExchange
          ? []
          : await fetchOvernightExchangeBars(IBKR_OVERNIGHT_FALLBACK_EXCHANGE);
      return mergeBrokerHistoryBars(
        primaryBars,
        markIbkrOvernightHistoryBars(
          overnightBars.length ? overnightBars : fallbackOvernightBars,
        ),
      );
    };

    const startedAt = Date.now();
    const bars = await fetchOnce();
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    if (
      brokerBackfillBudget &&
      bars.length === 0 &&
      elapsedMs < brokerHistoryBudgetMs - 250
    ) {
      await delayBarsRetry(
        BARS_BROKER_BACKFILL_EMPTY_RETRY_DELAY_MS,
        options.signal,
      );
      return fetchOnce();
    }
    return bars;
  };

  if (isBrokerHistoryTimeframe) {
    throwIfBarsSignalAborted(options.signal);
    try {
      const brokerHistoryInput = buildRecentBrokerHistoryInput(
        input,
        new Date(),
        { historicalSynthesisAvailable },
      );
      const skipBackgroundBrokerHistory =
        brokerHistoryMayBeRecentLimited &&
        !shouldAttemptBrokerLiveEdgeHistory(options);
      if (brokerHistoryInput && !skipBackgroundBrokerHistory) {
        attemptedBrokerHistory = true;
        ibkrBars = await fetchBrokerHistory(brokerHistoryInput, {
          recoveryMode: "live-edge",
        });
      } else if (brokerHistoryMayBeRecentLimited) {
        recordMarketDataFallback({
          owner: "bars-history",
          intent: "historical",
          fallbackProvider: historicalFallbackProvider,
          reason: skipBackgroundBrokerHistory
            ? "background_historical_synthesis"
            : "outside_recent_live_window",
          instrumentKey: `equity:${normalizeSymbol(input.symbol)}`,
        });
      }
    } catch (error) {
      if (error instanceof HttpError && error.code === "bars_request_aborted") {
        throw error;
      }
      if (isIbkrHistoricalAdmissionError(error)) {
        recordMarketDataFallback({
          owner: "bars-history",
          intent: "historical",
          fallbackProvider: historicalFallbackProvider,
          reason: "ibkr_historical_admission_rejected",
          instrumentKey: `equity:${normalizeSymbol(input.symbol)}`,
        });
      }
      brokerHistoryError = error;
      ibkrBars = [];
    }
  }
  const storedHistoricalBars = allowHistoricalSynthesis
    ? restrictHistoricalSynthesisToBrokerBackfill(
        input,
        await resolveWithin(
          loadStoredMarketBars({
            symbol: input.symbol,
            timeframe: input.timeframe,
            limit: input.limit,
            from: input.from,
            to: input.to,
            assetClass: input.assetClass,
            market: input.market,
            providerContractId: input.providerContractId,
            outsideRth,
            source: input.source,
            recentWindowMinutes: input.brokerRecentWindowMinutes ?? null,
            sourceName: historicalStoreSource,
          }),
          BARS_PROVIDER_BUDGET_MS,
          [],
          {
            signal: options.signal,
            createAbortError: createBarsRequestAbortedError,
          },
        ),
        ibkrBars,
      )
    : [];
  throwIfBarsSignalAborted(options.signal);
  const desiredBars = Math.max(
    input.limit ?? ibkrBars.length + storedHistoricalBars.length,
    1,
  );
  const recentCoverageNeedsGapFill =
    shouldFetchHistoricalSynthesisForRecentCoverage({
      request: input,
      storedHistoricalBars,
      brokerBars: ibkrBars,
      now: new Date(),
      enabled:
        allowHistoricalSynthesis &&
        Boolean(massiveClient) &&
        brokerHistoryMayBeRecentLimited &&
        isBrokerHistoryTimeframe,
      staleToleranceMs: resolveRecentCoverageStaleToleranceMs({
        request: input,
        providerIdentity: massiveProviderIdentity,
        massiveConfig,
        options,
      }),
    });
  const chartBackfillRequest = isChartBackfillBarsRequest(input, options);
  const providerCursorContinuationRequested =
    isBarsProviderCursorContinuationRequested(input);
  const historicalProviderAvailable = Boolean(
    allowHistoricalSynthesis &&
      input.market !== "futures" &&
      massiveClient &&
      desiredBars > 0,
  );
  const needsGapFill =
    historicalProviderAvailable &&
    (storedHistoricalBars.length + ibkrBars.length < desiredBars ||
      recentCoverageNeedsGapFill);
  const needsProviderHistoryFetch =
    historicalProviderAvailable &&
    (needsGapFill ||
      chartBackfillRequest ||
      providerCursorContinuationRequested);

  let bars = [...storedHistoricalBars, ...ibkrBars];
  let gapFilled = false;
  let massiveBarsPage: MassiveAggregateBarsPage | null = null;
  let massiveCursorExhausted = false;

  if (needsProviderHistoryFetch && massiveClient) {
    let massiveBars: BrokerBarSnapshot[] = [];
    let attemptedCursorContinuation = false;
    let usedCursorContinuation = false;
    const cursorSignature = buildBarsHistoryCursorSignature(input);
    const cursorResolution = input.preferCursor
      ? resolveChartHistoryCursor({
          token: input.historyCursor,
          signature: cursorSignature,
        })
      : ({ ok: false, reason: "missing" } as const);
    try {
      if (cursorResolution.ok) {
        attemptedCursorContinuation = true;
        massiveBarsPage = await resolveWithin(
          fetchMassiveBarsProviderCursorPage(massiveClient, {
            symbol: input.symbol,
            timeframe: input.timeframe,
            limit: desiredBars,
            providerNextUrl: cursorResolution.providerNextUrl,
          }).catch(() => null),
          BARS_PROVIDER_BUDGET_MS,
          null,
          {
            signal: options.signal,
            createAbortError: createBarsRequestAbortedError,
          },
        );
        usedCursorContinuation = Boolean(massiveBarsPage);
      }
      if (!massiveBarsPage) {
        if (attemptedCursorContinuation) {
          barsHydrationCounters.cursorFallback += 1;
        } else if (input.preferCursor && input.historyCursor) {
          barsHydrationCounters.cursorFallback += 1;
        }
        massiveBarsPage = await resolveWithin(
          fetchMassiveBarsPage(massiveClient, {
            symbol: input.symbol,
            timeframe: input.timeframe,
            limit: desiredBars,
            from: input.from,
            to: input.to,
          }),
          BARS_PROVIDER_BUDGET_MS,
          null,
          {
            signal: options.signal,
            createAbortError: createBarsRequestAbortedError,
          },
        );
      }
      if (massiveBarsPage) {
        barsHydrationCounters.providerFetch += 1;
        barsHydrationCounters.providerPage += massiveBarsPage.pageCount;
        if (chartBackfillRequest) {
          barsHydrationCounters.chartBackfillProviderFetch += 1;
        }
      }
      if (usedCursorContinuation) {
        barsHydrationCounters.cursorContinuation += 1;
        if (chartBackfillRequest) {
          barsHydrationCounters.chartBackfillCursorFetch += 1;
        }
        massiveCursorExhausted = Boolean(
          massiveBarsPage &&
            massiveBarsPage.bars.length === 0 &&
            !massiveBarsPage.nextUrl,
        );
      }
      massiveBars = normalizeBarsToStoreTimeframe(
        mapMassiveBarsToBrokerBars({
          bars: massiveBarsPage?.bars ?? [],
          sourceName: historicalStoreSource,
          outsideRth,
          delayed: massiveBarsDelayed,
        }),
        input.timeframe,
      );
    } catch (error) {
      if (error instanceof HttpError && error.code === "bars_request_aborted") {
        throw error;
      }
      massiveBarsPage = null;
      massiveBars = [];
    }
    if (!options.signal?.aborted && massiveBars.length) {
      const persistRequest = {
        symbol: input.symbol,
        timeframe: input.timeframe,
        limit: input.limit,
        from: input.from,
        to: input.to,
        assetClass: input.assetClass,
        market: input.market,
        providerContractId: input.providerContractId,
        outsideRth,
        source: input.source,
        recentWindowMinutes: input.brokerRecentWindowMinutes ?? null,
      };
      // This request's response already includes these bars; durable storage is
      // catching up and must not evict the fresh in-memory chart cache entry.
      void persistMarketDataBars({
        request: persistRequest,
        sourceName: historicalStoreSource,
        bars: massiveBars,
      });
    }
    const mergeableMassiveBars = restrictHistoricalSynthesisToBrokerBackfill(
      input,
      massiveBars,
      ibkrBars,
    );
    const merged = new Map<number, BrokerBarSnapshot>();

    // Tag each bar honestly with its actual source so the chart UI / debugging
    // can tell what came from where. IBKR bars always overwrite Massive bars at
    // the same timestamp because IBKR is the authoritative live broker feed.
    storedHistoricalBars.forEach((bar) => {
      merged.set(bar.timestamp.getTime(), bar);
    });
    mergeableMassiveBars.forEach((bar) => {
      gapFilled = true;
      merged.set(bar.timestamp.getTime(), {
        ...bar,
        source: historicalStoreSource,
        providerContractId: null,
        outsideRth,
        partial: false,
        transport: "tws",
        delayed: massiveBarsDelayed,
        freshness: massiveBarsDelayed ? "delayed" : "live",
        dataUpdatedAt: bar.timestamp,
      });
    });
    ibkrBars.forEach((bar) => {
      merged.set(bar.timestamp.getTime(), decorateIbkrHistoryBar(bar));
    });
    bars = Array.from(merged.values())
      .sort(
        (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
      )
      .slice(-desiredBars);
  } else if (bars.length) {
    const merged = new Map<number, BrokerBarSnapshot>();
    storedHistoricalBars.forEach((bar) => {
      merged.set(bar.timestamp.getTime(), bar);
    });
    ibkrBars.forEach((bar) => {
      merged.set(bar.timestamp.getTime(), decorateIbkrHistoryBar(bar));
    });
    bars = Array.from(merged.values())
      .sort(
        (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
      )
      .slice(-desiredBars);
  }

  if (
    brokerHistoryMayBeRecentLimited &&
    isBrokerHistoryTimeframe &&
    bars.length < desiredBars &&
    shouldAttemptFullBrokerHistoryRecovery(options)
  ) {
    recordMarketDataFallback({
      owner: "bars-history",
      intent: "historical",
      fallbackProvider: "ibkr",
      reason: "historical_synthesis_underfilled",
      instrumentKey: `equity:${normalizeSymbol(input.symbol)}`,
    });
    try {
      attemptedBrokerHistory = true;
      const fullBrokerBars = await fetchBrokerHistory(input, {
        recoveryMode: "full",
      });
      if (fullBrokerBars.length) {
        const merged = new Map<number, BrokerBarSnapshot>();
        bars.forEach((bar) => {
          merged.set(bar.timestamp.getTime(), bar);
        });
        fullBrokerBars.forEach((bar) => {
          merged.set(bar.timestamp.getTime(), decorateIbkrHistoryBar(bar));
        });
        bars = Array.from(merged.values())
          .sort(
            (left, right) =>
              left.timestamp.getTime() - right.timestamp.getTime(),
          )
          .slice(-desiredBars);
      }
    } catch (error) {
      brokerHistoryError = brokerHistoryError ?? error;
    }
  }

  let emptyReason = bars.length
    ? null
    : resolveBarsEmptyReason({
        request: input,
        attemptedBrokerHistory,
        brokerHistoryError,
      });
  let studyFallback = false;

  if (!bars.length && input.allowStudyFallback) {
    const fallbackBar = await fetchOptionStudyFallbackBar({
      request: input,
      bridgeClient,
      fallbackTransport: bridgeHealth?.transport ?? "tws",
    }).catch(() => null);

    if (fallbackBar) {
      bars = [fallbackBar];
      emptyReason = null;
      studyFallback = true;
    }
  }

  return decorateBarsResult({
    request: input,
    bars,
    bridgeHealth,
    gapFilled,
    emptyReason,
    studyFallback,
    historyProvider: massiveClient ? historicalStoreSource : null,
    historyPageMetadata: buildMassiveHistoryPageMetadata(
      massiveBarsPage,
      buildBarsHistoryCursorSignature(input),
    ),
    exhaustedBefore: massiveCursorExhausted,
  });
}

type IbkrOptionChainInput = {
  underlying: string;
  expirationDate?: Date;
  contractType?: "call" | "put";
  maxExpirations?: number;
  strikesAroundMoney?: number;
  strikeCoverage?: OptionChainStrikeCoverage;
  underlyingSpotPrice?: number | null;
  quoteHydration?: OptionChainQuoteHydration;
  allowDelayedSnapshotHydration?: boolean;
  recordBridgeFailure?: boolean;
  bypassBridgeBackoff?: boolean;
  signal?: AbortSignal;
  emptyRetryDelaysMs?: readonly number[];
};
type IbkrOptionChainContracts = Awaited<
  ReturnType<IbkrBridgeClient["getOptionChain"]>
>;
type FlowScannerContract = IbkrOptionChainContracts[number] & {
  flowOccurredAt?: Date | null;
};
type FlowScannerContracts = FlowScannerContract[];
type IbkrOptionExpirationsInput = {
  underlying: string;
  maxExpirations?: number;
  recordBridgeFailure?: boolean;
  bypassBridgeBackoff?: boolean;
  foregroundWaitMs?: number | null;
  signal?: AbortSignal;
};
type IbkrOptionExpirationDates = Awaited<
  ReturnType<IbkrBridgeClient["getOptionExpirations"]>
>;
type OptionChainStrikeCoverage = "fast" | "standard" | "full";
type OptionChainQuoteHydration = "metadata" | "snapshot";

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalPositiveIntegerEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readUnitIntervalEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return Math.max(0, Math.min(1, fallback));
  }

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(1, parsed))
    : Math.max(0, Math.min(1, fallback));
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readSymbolListEnv(
  name: string,
  fallback: readonly string[],
): string[] {
  const raw = process.env[name];
  const symbols = (raw && raw.trim() ? raw.split(",") : fallback)
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean);

  return [...new Set(symbols)];
}

function readStringListEnv(
  name: string,
  fallback: readonly string[],
): string[] {
  const raw = process.env[name];
  const values = (raw && raw.trim() ? raw.split(",") : fallback)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set(values)];
}

function readFlowUniverseModeEnv(): FlowUniverseMode {
  const normalized = process.env["OPTIONS_FLOW_UNIVERSE_MODE"]
    ?.trim()
    .toLowerCase();
  return normalized === "watchlist" ||
    normalized === "market" ||
    normalized === "hybrid"
    ? normalized
    : "hybrid";
}

function readOptionChainStrikeCoverageEnv(
  name: string,
  fallback: OptionChainStrikeCoverage,
): OptionChainStrikeCoverage {
  const normalized = process.env[name]?.trim().toLowerCase();
  return normalized === "fast" ||
    normalized === "standard" ||
    normalized === "full"
    ? normalized
    : fallback;
}

const OPTION_CHAIN_CACHE_TTL_MS = readPositiveIntegerEnv(
  "OPTION_CHAIN_CACHE_TTL_MS",
  2 * 60_000,
);
const OPTION_CHAIN_CACHE_STALE_TTL_MS = readPositiveIntegerEnv(
  "OPTION_CHAIN_CACHE_STALE_TTL_MS",
  15 * 60_000,
);
const OPTION_CHAIN_METADATA_CACHE_TTL_MS = readPositiveIntegerEnv(
  "OPTION_CHAIN_METADATA_CACHE_TTL_MS",
  15 * 60_000,
);
const OPTION_CHAIN_METADATA_STALE_TTL_MS = readPositiveIntegerEnv(
  "OPTION_CHAIN_METADATA_STALE_TTL_MS",
  2 * 60 * 60_000,
);
const OPTION_EXPIRATION_CACHE_TTL_MS = readPositiveIntegerEnv(
  "OPTION_EXPIRATION_CACHE_TTL_MS",
  2 * 60 * 60_000,
);
const OPTION_EXPIRATION_STALE_TTL_MS = readPositiveIntegerEnv(
  "OPTION_EXPIRATION_STALE_TTL_MS",
  24 * 60 * 60_000,
);
export const OPTION_EXPIRATION_PUBLIC_FOREGROUND_WAIT_MS = readPositiveIntegerEnv(
  "OPTION_EXPIRATION_PUBLIC_FOREGROUND_WAIT_MS",
  1_500,
);
const OPTION_CONTRACT_RESOLUTION_CACHE_TTL_MS = readPositiveIntegerEnv(
  "OPTION_CONTRACT_RESOLUTION_CACHE_TTL_MS",
  24 * 60 * 60_000,
);
const OPTION_CONTRACT_STRIKE_EXACT_TOLERANCE = 0.000001;
const OPTION_CONTRACT_STRIKE_MATCH_TOLERANCE = 0.01;
const OPTION_UPSTREAM_BACKOFF_MS = readPositiveIntegerEnv(
  "OPTION_UPSTREAM_BACKOFF_MS",
  readPositiveIntegerEnv("IBKR_BRIDGE_OPTIONS_BACKOFF_MS", 60_000),
);
const OPTION_CHAIN_CACHE_MAX_ENTRIES = 128;
const OPTION_CHAIN_STRIKES_AROUND_MONEY = 6;
const OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY = 2;
const OPTION_CHAIN_PUBLIC_MAX_STRIKES_AROUND_MONEY = 50;
const OPTION_CHAIN_BATCH_CONCURRENCY = readPositiveIntegerEnv(
  "OPTION_CHAIN_BATCH_CONCURRENCY",
  3,
);
const OPTION_CHAIN_BATCH_EMERGENCY_MAX_EXPIRATIONS = readNonNegativeIntegerEnv(
  "OPTION_CHAIN_BATCH_EMERGENCY_MAX_EXPIRATIONS",
  0,
);
const OPTION_CHAIN_EMPTY_RETRY_DELAYS_MS = [250, 750] as const;
const OPTIONS_FLOW_SCANNER_ENABLED = readBooleanEnv(
  "OPTIONS_FLOW_SCANNER_ENABLED",
  true,
);
const OPTIONS_FLOW_SCANNER_INTERVAL_MS = readPositiveIntegerEnv(
  "OPTIONS_FLOW_SCANNER_INTERVAL_MS",
  15_000,
);
const OPTIONS_FLOW_SCANNER_SYMBOL_TIMEOUT_MS = readPositiveIntegerEnv(
  "OPTIONS_FLOW_SCANNER_SYMBOL_TIMEOUT_MS",
  Math.max(45_000, OPTIONS_FLOW_SCANNER_INTERVAL_MS * 2),
);
const OPTIONS_FLOW_UNIVERSE_MODE = readFlowUniverseModeEnv();
const OPTIONS_FLOW_UNIVERSE_SIZE = readPositiveIntegerEnv(
  "OPTIONS_FLOW_UNIVERSE_SIZE",
  500,
);
const OPTIONS_FLOW_UNIVERSE_REFRESH_MS = readPositiveIntegerEnv(
  "OPTIONS_FLOW_UNIVERSE_REFRESH_MS",
  15 * 60_000,
);
const OPTIONS_FLOW_UNIVERSE_MARKETS = readStringListEnv(
  "OPTIONS_FLOW_UNIVERSE_MARKETS",
  ["stocks", "etf"],
);
const OPTIONS_FLOW_UNIVERSE_MIN_PRICE = readPositiveNumberEnv(
  "OPTIONS_FLOW_UNIVERSE_MIN_PRICE",
  5,
);
const OPTIONS_FLOW_UNIVERSE_MIN_DOLLAR_VOLUME = readPositiveNumberEnv(
  "OPTIONS_FLOW_UNIVERSE_MIN_DOLLAR_VOLUME",
  25_000_000,
);
const OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFIER_ENABLED = readBooleanEnv(
  "OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFIER_ENABLED",
  true,
);
const OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_INTERVAL_MS =
  readPositiveIntegerEnv(
    "OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_INTERVAL_MS",
    60_000,
  );
const OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_INITIAL_DELAY_MS =
  readNonNegativeIntegerEnv(
    "OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_INITIAL_DELAY_MS",
    15_000,
  );
const OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_BATCH_SIZE =
  readPositiveIntegerEnv(
    "OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_BATCH_SIZE",
    5,
  );
const OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_DELAY_MS =
  readNonNegativeIntegerEnv(
    "OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_DELAY_MS",
    1_000,
  );
const OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_BACKOFF_MS =
  readPositiveIntegerEnv(
    "OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_BACKOFF_MS",
    5 * 60_000,
  );
const OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_MAX_ERRORS =
  readPositiveIntegerEnv(
    "OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_MAX_ERRORS",
    3,
  );
const OPTIONS_FLOW_SCANNER_ALWAYS_ON = readBooleanEnv(
  "OPTIONS_FLOW_SCANNER_ALWAYS_ON",
  true,
);
const OPTIONS_FLOW_SCANNER_SESSION_GUARD_ENABLED = readBooleanEnv(
  "OPTIONS_FLOW_SCANNER_SESSION_GUARD_ENABLED",
  true,
);
const OPTIONS_FLOW_SCANNER_DEFAULT_LINE_BUDGET = 200;
const OPTIONS_FLOW_SCANNER_DEFAULT_PER_SCAN_LINE_BUDGET = 1;
const OPTIONS_FLOW_SCANNER_PER_TICKER_LINE_BUDGET = readPositiveIntegerEnv(
  "OPTIONS_FLOW_SCANNER_PER_TICKER_LINE_BUDGET",
  OPTIONS_FLOW_SCANNER_DEFAULT_PER_SCAN_LINE_BUDGET,
);
const OPTIONS_FLOW_SCANNER_BATCH_SIZE = readPositiveIntegerEnv(
  "OPTIONS_FLOW_SCANNER_BATCH_SIZE",
  OPTIONS_FLOW_SCANNER_DEFAULT_LINE_BUDGET,
);
const OPTIONS_FLOW_SCANNER_MAX_CONCURRENCY = 8;
const OPTIONS_FLOW_SCANNER_CONCURRENCY = Math.min(
  OPTIONS_FLOW_SCANNER_MAX_CONCURRENCY,
  readPositiveIntegerEnv("OPTIONS_FLOW_SCANNER_CONCURRENCY", 8),
);
const OPTIONS_FLOW_SCANNER_LIMIT = readPositiveIntegerEnv(
  "OPTIONS_FLOW_SCANNER_LIMIT",
  120,
);
const OPTIONS_FLOW_SCANNER_LINE_BUDGET = readPositiveIntegerEnv(
  "OPTIONS_FLOW_SCANNER_LINE_BUDGET",
  OPTIONS_FLOW_SCANNER_DEFAULT_LINE_BUDGET,
);
const OPTIONS_FLOW_SCANNER_STRIKE_COVERAGE = readOptionChainStrikeCoverageEnv(
  "OPTIONS_FLOW_SCANNER_STRIKE_COVERAGE",
  "standard",
);
const OPTIONS_FLOW_EXPIRATION_SCAN_COUNT = readNonNegativeIntegerEnv(
  "OPTIONS_FLOW_EXPIRATION_SCAN_COUNT",
  1,
);
const OPTIONS_FLOW_SCANNER_SEED_LINE_BUDGET = readPositiveIntegerEnv(
  "OPTIONS_FLOW_SCANNER_SEED_LINE_BUDGET",
  OPTIONS_FLOW_SCANNER_DEFAULT_PER_SCAN_LINE_BUDGET,
);
const OPTIONS_FLOW_SCANNER_EXPANDED_LINE_BUDGET = readPositiveIntegerEnv(
  "OPTIONS_FLOW_SCANNER_EXPANDED_LINE_BUDGET",
  OPTIONS_FLOW_SCANNER_DEFAULT_PER_SCAN_LINE_BUDGET,
);
const OPTIONS_FLOW_SCANNER_EXPANDED_MIN_PREMIUM = readPositiveNumberEnv(
  "OPTIONS_FLOW_SCANNER_EXPANDED_MIN_PREMIUM",
  250_000,
);
const OPTIONS_FLOW_HISTORICAL_CANDIDATE_LIMIT = readPositiveIntegerEnv(
  "OPTIONS_FLOW_HISTORICAL_CANDIDATE_LIMIT",
  8,
);
const OPTIONS_FLOW_HISTORICAL_CONCURRENCY = readPositiveIntegerEnv(
  "OPTIONS_FLOW_HISTORICAL_CONCURRENCY",
  2,
);
export type OptionsFlowRuntimeConfig = {
  optionUpstreamBackoffMs: number;
  optionChainBatchConcurrency: number;
  scannerEnabled: boolean;
  scannerIntervalMs: number;
  scannerSymbolTimeoutMs: number;
  universeMode: FlowUniverseMode;
  universeSize: number;
  universeRefreshMs: number;
  universeMarkets: string[];
  universeMinPrice: number;
  universeMinDollarVolume: number;
  scannerAlwaysOn: boolean;
  scannerSessionGuardEnabled: boolean;
  scannerBatchSize: number;
  scannerConcurrency: number;
  scannerLimit: number;
  scannerLineBudget: number;
  scannerStrikeCoverage: OptionChainStrikeCoverage;
  expirationScanCount: number;
};

export type OptionsFlowRuntimeConfigSnapshot = OptionsFlowRuntimeConfig & {
  defaults: OptionsFlowRuntimeConfig;
  overrides: Partial<OptionsFlowRuntimeConfig>;
  sources: Record<keyof OptionsFlowRuntimeConfig, "default" | "override">;
};

const OPTIONS_FLOW_DEFAULT_CONFIG: OptionsFlowRuntimeConfig = {
  optionUpstreamBackoffMs: OPTION_UPSTREAM_BACKOFF_MS,
  optionChainBatchConcurrency: OPTION_CHAIN_BATCH_CONCURRENCY,
  scannerEnabled: OPTIONS_FLOW_SCANNER_ENABLED,
  scannerIntervalMs: OPTIONS_FLOW_SCANNER_INTERVAL_MS,
  scannerSymbolTimeoutMs: OPTIONS_FLOW_SCANNER_SYMBOL_TIMEOUT_MS,
  universeMode: OPTIONS_FLOW_UNIVERSE_MODE,
  universeSize: OPTIONS_FLOW_UNIVERSE_SIZE,
  universeRefreshMs: OPTIONS_FLOW_UNIVERSE_REFRESH_MS,
  universeMarkets: OPTIONS_FLOW_UNIVERSE_MARKETS,
  universeMinPrice: OPTIONS_FLOW_UNIVERSE_MIN_PRICE,
  universeMinDollarVolume: OPTIONS_FLOW_UNIVERSE_MIN_DOLLAR_VOLUME,
  scannerAlwaysOn: OPTIONS_FLOW_SCANNER_ALWAYS_ON,
  scannerSessionGuardEnabled: OPTIONS_FLOW_SCANNER_SESSION_GUARD_ENABLED,
  scannerBatchSize: OPTIONS_FLOW_SCANNER_BATCH_SIZE,
  scannerConcurrency: OPTIONS_FLOW_SCANNER_CONCURRENCY,
  scannerLimit: OPTIONS_FLOW_SCANNER_LIMIT,
  scannerLineBudget: OPTIONS_FLOW_SCANNER_LINE_BUDGET,
  scannerStrikeCoverage: OPTIONS_FLOW_SCANNER_STRIKE_COVERAGE,
  expirationScanCount: OPTIONS_FLOW_EXPIRATION_SCAN_COUNT,
};

let optionsFlowRuntimeOverrides: Partial<OptionsFlowRuntimeConfig> = {};

function cloneOptionsFlowConfig(
  config: OptionsFlowRuntimeConfig,
): OptionsFlowRuntimeConfig {
  return {
    ...config,
    universeMarkets: [...config.universeMarkets],
  };
}

export function getOptionsFlowRuntimeConfig(): OptionsFlowRuntimeConfig {
  const config = {
    ...OPTIONS_FLOW_DEFAULT_CONFIG,
    ...optionsFlowRuntimeOverrides,
    universeMarkets:
      optionsFlowRuntimeOverrides.universeMarkets ??
      OPTIONS_FLOW_DEFAULT_CONFIG.universeMarkets,
  };
  return cloneOptionsFlowConfig({
    ...config,
    scannerConcurrency: Math.min(
      OPTIONS_FLOW_SCANNER_MAX_CONCURRENCY,
      Math.max(1, Math.floor(config.scannerConcurrency || 1)),
    ),
  });
}

export function resolveOptionsFlowScannerEffectiveConcurrency(
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): number {
  const configuredConcurrency = Math.max(
    1,
    Math.min(
      OPTIONS_FLOW_SCANNER_MAX_CONCURRENCY,
      Math.floor(config.scannerConcurrency || 1),
    ),
  );
  const flowScannerLineCap = Math.max(
    0,
    Math.min(
      Math.floor(getOptionsFlowScannerSchedulableLineCap()),
      Math.max(0, Math.floor(config.scannerLineBudget || 0)),
    ),
  );
  const pressureSnapshot = getApiResourcePressureSnapshot();
  const scannerPressure = getOptionsFlowScannerPressureGate(pressureSnapshot);
  const pressureAdjustedConcurrency = scannerPressure.hardBlocked
    ? 0
    : scannerPressure.throttled
      ? Math.min(configuredConcurrency, 1)
      : configuredConcurrency;
  return flowScannerLineCap <= 0 || pressureAdjustedConcurrency <= 0
    ? 0
    : Math.max(1, Math.min(pressureAdjustedConcurrency, flowScannerLineCap));
}

function resolveOptionsFlowScannerTickerSlotCapacity(
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): number {
  if (resolveOptionsFlowScannerEffectiveConcurrency(config) <= 0) {
    return 0;
  }
  const schedulableLineCap = Math.max(
    0,
    Math.floor(getOptionsFlowScannerSchedulableLineCap()),
  );
  return Math.max(
    0,
    Math.min(
      Math.max(0, Math.floor(config.scannerLineBudget || 0)),
      schedulableLineCap,
    ),
  );
}

function resolveOptionsFlowScannerPerScanLineBudget(
  config: OptionsFlowRuntimeConfig,
  phaseLineCap: number,
): number {
  const configuredConcurrency = Math.max(
    1,
    Math.min(
      OPTIONS_FLOW_SCANNER_MAX_CONCURRENCY,
      Math.floor(config.scannerConcurrency || 1),
    ),
  );
  const effectiveConcurrency =
    resolveOptionsFlowScannerEffectiveConcurrency(config) ||
    configuredConcurrency;
  const schedulableLineCap = Math.max(
    0,
    Math.floor(getOptionsFlowScannerSchedulableLineCap()),
  );
  const targetLineBudget = Math.max(
    1,
    Math.min(
      Math.max(1, Math.floor(config.scannerLineBudget || 1)),
      schedulableLineCap > 0 ? schedulableLineCap : config.scannerLineBudget,
    ),
  );
  return Math.max(
    1,
    Math.min(
      Math.max(1, Math.floor(phaseLineCap || 1)),
      Math.ceil(targetLineBudget / Math.max(1, effectiveConcurrency)),
    ),
  );
}

function resolveOptionsFlowScannerTickerLineBudget(input: {
  config: OptionsFlowRuntimeConfig;
  explicitLineBudget?: number | null;
  phaseLineCap?: number;
}): number {
  if (
    Number.isFinite(input.explicitLineBudget) &&
    (input.explicitLineBudget ?? 0) > 0
  ) {
    return Math.max(
      1,
      Math.min(
        Math.floor(input.explicitLineBudget as number),
        Math.max(1, Math.floor(input.config.scannerLineBudget || 1)),
      ),
    );
  }

  const phaseLineBudget =
    typeof input.phaseLineCap === "number" && Number.isFinite(input.phaseLineCap)
      ? resolveOptionsFlowScannerPerScanLineBudget(
          input.config,
          input.phaseLineCap,
        )
      : resolveOptionsFlowScannerPerScanLineBudget(
          input.config,
          input.config.scannerLineBudget,
        );
  return Math.max(
    1,
    Math.min(
      phaseLineBudget,
      Math.max(1, Math.floor(OPTIONS_FLOW_SCANNER_PER_TICKER_LINE_BUDGET)),
    ),
  );
}

function syncOptionsFlowScannerEffectiveConcurrency(
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): number {
  syncMarketDataAdmissionRuntimeDefaults(config);
  const effectiveConcurrency =
    resolveOptionsFlowScannerEffectiveConcurrency(config);
  optionsFlowScanner.setMaxConcurrency(effectiveConcurrency);
  return effectiveConcurrency;
}

function syncMarketDataAdmissionRuntimeDefaults(
  config: OptionsFlowRuntimeConfig,
): void {
  setMarketDataAdmissionRuntimeDefaults({
    flowScannerLineBudget: config.scannerLineBudget,
    flowScannerConcurrency: config.scannerConcurrency,
  });
}

function getOptionsFlowScannerQuoteLeaseTtlMs(): number {
  return readPositiveIntegerEnv(
    "OPTIONS_FLOW_SCANNER_QUOTE_SAMPLE_TIMEOUT_MS",
    300_000,
  );
}

function buildOptionsFlowSeedScannerRequest(
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): OptionsFlowScannerRequest {
  const lineBudget = resolveOptionsFlowScannerTickerLineBudget({
    config,
    phaseLineCap: OPTIONS_FLOW_SCANNER_SEED_LINE_BUDGET,
  });
  return {
    limit: Math.min(config.scannerLimit, lineBudget),
    lineBudget,
    phase: "seed",
    expirationScanCount: 1,
    strikeCoverage: "standard",
    allowPartial: true,
  };
}

function buildOptionsFlowExpandedScannerRequest(
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): OptionsFlowScannerRequest {
  const lineBudget = resolveOptionsFlowScannerTickerLineBudget({
    config,
    phaseLineCap: OPTIONS_FLOW_SCANNER_EXPANDED_LINE_BUDGET,
  });
  return {
    limit: Math.min(config.scannerLimit, lineBudget),
    lineBudget,
    phase: "expanded",
    expirationScanCount: Math.max(1, config.expirationScanCount || 1),
    strikeCoverage: "standard",
    allowPartial: true,
  };
}

function flowScanHasExpandedCandidate(input: {
  result?: { events?: unknown[] } | null;
  unusualThreshold?: number;
}): boolean {
  const threshold =
    Number.isFinite(input.unusualThreshold) && (input.unusualThreshold ?? 0) > 0
      ? (input.unusualThreshold as number)
      : 1;
  return Boolean(
    input.result?.events?.some((event) => {
      const row = event as {
        premium?: unknown;
        isUnusual?: unknown;
        unusualScore?: unknown;
      };
      return (
        Boolean(row.isUnusual) ||
        Number(row.unusualScore) >= threshold ||
        Number(row.premium) >= OPTIONS_FLOW_SCANNER_EXPANDED_MIN_PREMIUM
      );
    }),
  );
}

export function getOptionsFlowRuntimeConfigSnapshot(): OptionsFlowRuntimeConfigSnapshot {
  const current = getOptionsFlowRuntimeConfig();
  return {
    ...current,
    defaults: cloneOptionsFlowConfig(OPTIONS_FLOW_DEFAULT_CONFIG),
    overrides: {
      ...optionsFlowRuntimeOverrides,
      universeMarkets: optionsFlowRuntimeOverrides.universeMarkets
        ? [...optionsFlowRuntimeOverrides.universeMarkets]
        : undefined,
    },
    sources: Object.fromEntries(
      (
        Object.keys(OPTIONS_FLOW_DEFAULT_CONFIG) as Array<
          keyof OptionsFlowRuntimeConfig
        >
      ).map((key) => [
        key,
        optionsFlowRuntimeOverrides[key] === undefined ? "default" : "override",
      ]),
    ) as OptionsFlowRuntimeConfigSnapshot["sources"],
  };
}

export function setOptionsFlowRuntimeOverrides(
  overrides: Partial<OptionsFlowRuntimeConfig>,
): void {
  const previous = getOptionsFlowRuntimeConfig();
  optionsFlowRuntimeOverrides = {
    ...optionsFlowRuntimeOverrides,
    ...overrides,
    universeMarkets: overrides.universeMarkets
      ? [...overrides.universeMarkets]
      : optionsFlowRuntimeOverrides.universeMarkets,
  };
  const next = getOptionsFlowRuntimeConfig();
  syncMarketDataAdmissionRuntimeDefaults(next);
  syncOptionsFlowScannerEffectiveConcurrency(next);
  updateFlowUniverseRuntimePlanningConfig(next);
  if (
    optionsFlowScannerStarted &&
    JSON.stringify(previous) !== JSON.stringify(next)
  ) {
    stopOptionsFlowScanner();
    startOptionsFlowScanner();
  }
}

export function resetOptionsFlowRuntimeOverrides(
  keys?: Array<keyof OptionsFlowRuntimeConfig>,
): void {
  if (!keys || keys.length === 0) {
    optionsFlowRuntimeOverrides = {};
  } else {
    keys.forEach((key) => {
      delete optionsFlowRuntimeOverrides[key];
    });
  }
  const next = getOptionsFlowRuntimeConfig();
  syncMarketDataAdmissionRuntimeDefaults(next);
  syncOptionsFlowScannerEffectiveConcurrency(next);
  updateFlowUniverseRuntimePlanningConfig(next);
  if (optionsFlowScannerStarted) {
    stopOptionsFlowScanner();
    startOptionsFlowScanner();
  }
}
const initialOptionsFlowConfig = getOptionsFlowRuntimeConfig();
syncMarketDataAdmissionRuntimeDefaults(initialOptionsFlowConfig);
const flowUniverseManager = createFlowUniverseManager({
  db,
  mode: initialOptionsFlowConfig.universeMode,
  targetSize:
    initialOptionsFlowConfig.universeMode === "watchlist"
      ? BUILT_IN_SYMBOLS.length
      : initialOptionsFlowConfig.universeSize,
  refreshMs: initialOptionsFlowConfig.universeRefreshMs,
  markets: initialOptionsFlowConfig.universeMarkets,
  minPrice: initialOptionsFlowConfig.universeMinPrice,
  minDollarVolume: initialOptionsFlowConfig.universeMinDollarVolume,
  fallbackSymbols: BUILT_IN_SYMBOLS,
  fetchLiquiditySnapshots: async (symbols) => {
    const payload = await getQuoteSnapshots({
      symbols: [...symbols].join(","),
    }).catch(() => ({
      quotes: [],
    }));
    return payload.quotes.map((snapshot) => ({
      symbol: snapshot.symbol,
      price: snapshot.price,
      volume: snapshot.volume,
      source:
        typeof snapshot.source === "string" && snapshot.source.trim()
          ? snapshot.source.trim().toLowerCase()
          : null,
    }));
  },
});

function flowUniversePlannerRefreshMs(
  config: OptionsFlowRuntimeConfig,
): number {
  return Math.max(1_000, getOptionsFlowDeepScannerIntervalMs(config));
}

const flowUniversePlanner = createFlowUniversePlanner({
  db,
  markets: initialOptionsFlowConfig.universeMarkets,
  minPrice: initialOptionsFlowConfig.universeMinPrice,
  minDollarVolume: initialOptionsFlowConfig.universeMinDollarVolume,
  refreshMs: flowUniversePlannerRefreshMs(initialOptionsFlowConfig),
});

const flowUniverseOptionabilityVerifier =
  createFlowUniverseOptionabilityVerifier({
    db,
    enabled: OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFIER_ENABLED,
    intervalMs: OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_INTERVAL_MS,
    initialDelayMs: OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_INITIAL_DELAY_MS,
    batchSize: OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_BATCH_SIZE,
    delayMs: OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_DELAY_MS,
    backoffMs: OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_BACKOFF_MS,
    maxConsecutiveErrors: OPTIONS_FLOW_UNIVERSE_OPTIONABILITY_VERIFY_MAX_ERRORS,
    markets: initialOptionsFlowConfig.universeMarkets,
    prioritySymbols: () =>
      getOptionsFlowLaneSourceSymbols().verificationSymbols,
    shouldRun: async () => {
      const config = getOptionsFlowRuntimeConfig();
      if (!config.scannerEnabled) {
        return "scanner-disabled";
      }
      const sessionBlockReason =
        await refreshOptionsFlowSessionBlockReason(config);
      if (sessionBlockReason) {
        return sessionBlockReason;
      }
      if (isBridgeWorkBackedOff("options")) {
        return "options-backoff";
      }
      const backgroundBlockReason =
        getOptionsFlowScannerBackgroundBlockReason();
      if (backgroundBlockReason) {
        return backgroundBlockReason;
      }
      if (getOptionsFlowScannerPressureGate().throttled) {
        return "resource-pressure";
      }
      return null;
    },
    fetchExpirations: (input) => getOptionExpirationsWithDebug(input),
  });

function updateFlowUniverseRuntimePlanningConfig(
  config: OptionsFlowRuntimeConfig,
): void {
  flowUniverseManager.updateConfig({
    mode: config.universeMode,
    targetSize:
      config.universeMode === "watchlist"
        ? BUILT_IN_SYMBOLS.length
        : config.universeSize,
    refreshMs: config.universeRefreshMs,
    markets: config.universeMarkets,
    minPrice: config.universeMinPrice,
    minDollarVolume: config.universeMinDollarVolume,
  });
  flowUniversePlanner.updateConfig({
    markets: config.universeMarkets,
    minPrice: config.universeMinPrice,
    minDollarVolume: config.universeMinDollarVolume,
    refreshMs: flowUniversePlannerRefreshMs(config),
  });
  flowUniverseOptionabilityVerifier.updateConfig({
    markets: config.universeMarkets,
  });
}

const optionsFlowExpandedSymbolsThisCycle = new Set<string>();

const optionsFlowScanner = createOptionsFlowScanner<unknown>({
  normalizeSymbol,
  maxConcurrency: resolveOptionsFlowScannerEffectiveConcurrency(
    initialOptionsFlowConfig,
  ),
  scanTimeoutMs: () => getOptionsFlowRuntimeConfig().scannerSymbolTimeoutMs,
  snapshotTtlMs: FLOW_EVENTS_CACHE_TTL_MS,
  snapshotStaleTtlMs: OPTIONS_FLOW_SCANNER_SNAPSHOT_STALE_TTL_MS,
  preferredTransport: "tws",
  allowFallbackTransport: false,
  getTransport: async () => {
    const health = await getIbkrClient()
      .getHealth()
      .catch(() => null);
    return health
      ? {
          transport: health.transport,
          connected: health.connected,
          configured: health.configured,
          authenticated: health.authenticated,
          liveMarketDataAvailable: health.liveMarketDataAvailable,
          marketDataMode: health.marketDataMode,
          lastError: health.lastError,
        }
      : null;
  },
  fetchSymbol: ({
    symbol,
    limit,
    unusualThreshold,
    lineBudget,
    phase,
    expirationScanCount,
    strikeCoverage,
    signal,
  }) =>
    listFlowEventsUncached({
      underlying: symbol,
      limit,
      filters: normalizeFlowEventsFilters({ scope: "all" }),
      unusualThreshold,
      allowMassiveFallback: false,
      lineBudget,
      scanPhase: phase,
      expirationScanCount,
      strikeCoverage,
      bypassBridgeBackoff: false,
      signal,
    }),
  onBatch: (symbols) => {
    flowUniverseManager.noteBatch(symbols);
  },
  onResult: ({ symbol, request, result, failed, error }) => {
    flowUniverseManager.recordObservation({
      symbol,
      events: (result?.events ?? []) as Array<{
        premium?: number;
        unusualScore?: number;
        isUnusual?: boolean;
      }>,
      failed,
      reason:
        error ?? result?.source?.errorMessage ?? result?.source?.status ?? null,
    });
    if (
      !failed &&
      request.phase === "seed" &&
      flowScanHasExpandedCandidate({
        result,
        unusualThreshold: request.unusualThreshold,
      })
    ) {
      const normalizedSymbol = normalizeSymbol(symbol);
      if (
        normalizedSymbol &&
        !optionsFlowExpandedSymbolsThisCycle.has(normalizedSymbol)
      ) {
        const expandedRequest = buildOptionsFlowExpandedScannerRequest(
          getOptionsFlowRuntimeConfig(),
        );
        const [expandedSymbol] = selectOptionsFlowScannerPromotableSymbols([
          normalizedSymbol,
        ]);
        if (!expandedSymbol) {
          return;
        }
        optionsFlowExpandedSymbolsThisCycle.add(normalizedSymbol);
        optionsFlowScanner
          .requestScan([expandedSymbol], {
            ...expandedRequest,
            unusualThreshold: request.unusualThreshold,
          })
          .catch((queueError) => {
            logger.warn(
              { err: queueError, symbol: normalizedSymbol, phase: "expanded" },
              "Failed to queue expanded options flow scanner refresh",
            );
          });
      }
    }
  },
  onError: (error, context) => {
    logger.warn({ err: error, ...context }, "Options flow scanner error");
  },
});

function resolveOptionsFlowScannerDeepQueueLimit(
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): number {
  return Math.max(0, resolveOptionsFlowScannerTickerSlotCapacity(config));
}

function getOptionsFlowScannerDeepQueueState(
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): {
  limit: number;
  backlog: number;
  available: number;
  busySymbols: Set<string>;
} {
  const diagnostics = optionsFlowScanner.getDiagnostics();
  const limit = resolveOptionsFlowScannerDeepQueueLimit(config);
  const busySymbols = new Set(
    [
      ...diagnostics.activeSymbols,
      ...diagnostics.queuedSymbols,
      ...diagnostics.drainingSymbols,
    ].map((symbol) => normalizeSymbol(symbol).toUpperCase()),
  );
  const backlog = busySymbols.size;
  return {
    limit,
    backlog,
    available: Math.max(0, limit - backlog),
    busySymbols,
  };
}

function selectOptionsFlowScannerPromotableSymbols(
  symbols: readonly string[],
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): string[] {
  const queueState = getOptionsFlowScannerDeepQueueState(config);
  if (queueState.available <= 0) {
    return [];
  }
  const selected: string[] = [];
  const seen = new Set<string>();
  for (const symbol of symbols) {
    const normalized = normalizeSymbol(symbol).toUpperCase();
    if (
      !normalized ||
      seen.has(normalized) ||
      queueState.busySymbols.has(normalized)
    ) {
      continue;
    }
    selected.push(normalized);
    seen.add(normalized);
    if (selected.length >= queueState.available) {
      break;
    }
  }
  return selected;
}

let optionsFlowScannerStarted = false;

function getFlowScannerPinnedSymbols(): string[] {
  const configuredSymbols = readSymbolListEnv(
    "OPTIONS_FLOW_SCANNER_SYMBOLS",
    [],
  );
  return configuredSymbols.length ? configuredSymbols : BUILT_IN_SYMBOLS;
}

export function getOptionsFlowScannerLaneResolution() {
  const sources = getOptionsFlowLaneSourceSymbols();
  const resolution = resolveIbkrLaneSymbols("flow-scanner", {
    "built-in": sources.builtInSymbols,
    watchlists: sources.watchlistSymbols,
    "flow-universe": sources.flowUniverseSymbols,
  });
  return orderOptionsFlowScannerLaneResolution(sources, resolution);
}

function orderOptionsFlowScannerLaneResolution(
  sources: {
    builtInSymbols: string[];
    watchlistSymbols: string[];
    flowUniverseSymbols: string[];
  },
  resolution: ReturnType<typeof resolveIbkrLaneSymbols>,
) {
  const admitted = new Set(resolution.admittedSymbols);
  const orderedSymbols = Array.from(
    new Set([
      ...resolution.desiredSymbols
        .filter(
          (entry) =>
            admitted.has(entry.symbol) && entry.sources.includes("manual"),
        )
        .map((entry) => entry.symbol),
      ...sources.watchlistSymbols,
      ...sources.flowUniverseSymbols,
      ...sources.builtInSymbols,
      ...resolution.admittedSymbols,
    ]),
  ).filter((symbol) => admitted.has(symbol));
  return {
    ...resolution,
    admittedSymbols: orderedSymbols.slice(0, resolution.maxSymbols),
  };
}

function orderOptionsFlowUniverseLaneResolution(
  sources: {
    builtInSymbols: string[];
    watchlistSymbols: string[];
    flowUniverseSymbols: string[];
  },
  resolution: ReturnType<typeof resolveIbkrLaneSymbols>,
) {
  const admitted = new Set(resolution.admittedSymbols);
  const orderedSymbols = Array.from(
    new Set([
      ...resolution.desiredSymbols
        .filter(
          (entry) =>
            admitted.has(entry.symbol) && entry.sources.includes("manual"),
        )
        .map((entry) => entry.symbol),
      ...sources.watchlistSymbols,
      ...sources.flowUniverseSymbols,
      ...sources.builtInSymbols,
      ...resolution.admittedSymbols,
    ]),
  ).filter((symbol) => admitted.has(symbol));
  return {
    ...resolution,
    admittedSymbols: orderedSymbols.slice(0, resolution.maxSymbols),
  };
}

export function __orderOptionsFlowScannerLaneResolutionForTests(
  sources: {
    builtInSymbols: string[];
    watchlistSymbols: string[];
    flowUniverseSymbols: string[];
  },
  resolution: ReturnType<typeof resolveIbkrLaneSymbols>,
) {
  return orderOptionsFlowScannerLaneResolution(sources, resolution);
}

export function getOptionsFlowLaneSourceSymbols(): {
  builtInSymbols: string[];
  watchlistSymbols: string[];
  flowUniverseSymbols: string[];
  candidateBuiltInSymbols: string[];
  candidateWatchlistSymbols: string[];
  candidatePrioritySymbols: string[];
  verificationSymbols: string[];
  planner: Record<string, unknown>;
} {
  const config = getOptionsFlowRuntimeConfig();
  const candidateBuiltInSymbols = getFlowScannerPinnedSymbols();
  const candidateWatchlistSymbols = latestWatchlistLaneSymbols;
  const candidatePrioritySymbols = collectFlowScannerPriorityLeaseSymbols();
  const schedulableLineCap = getOptionsFlowScannerSchedulableLineCap();
  const tickerSlotCapacity = resolveOptionsFlowScannerTickerSlotCapacity(config);
  const directScannerLineBudget = resolveOptionsFlowScannerPerScanLineBudget(
    config,
    OPTIONS_FLOW_SCANNER_SEED_LINE_BUDGET,
  );
  const plannerBatchSize = Math.max(
    0,
    Math.min(
      config.scannerBatchSize,
      tickerSlotCapacity,
    ),
  );
  const plannerPerScanLineBudget = directScannerLineBudget;
  const plannerEffectiveConcurrency = Math.max(
    resolveOptionsFlowScannerEffectiveConcurrency(config),
    tickerSlotCapacity > 0 ? 1 : 0,
  );
  const plannerPlan = flowUniversePlanner.getPlan({
    prioritySymbolGroups: {
      account: candidatePrioritySymbols,
      runtime: [],
      watchlists: candidateWatchlistSymbols,
      "built-in": candidateBuiltInSymbols,
    },
    targetSize:
      config.universeMode === "watchlist"
        ? Math.max(
            candidateWatchlistSymbols.length,
            candidateBuiltInSymbols.length,
            1,
          )
        : config.universeSize,
    batchSize: plannerBatchSize,
    lineBudget: schedulableLineCap,
    perScanLineBudget: plannerPerScanLineBudget,
    effectiveConcurrency: plannerEffectiveConcurrency,
  });
  const builtInSymbols = plannerPlan.prioritySymbolsBySource["built-in"];
  const watchlistSymbols = plannerPlan.prioritySymbolsBySource.watchlists;
  const flowUniverseSymbols = plannerPlan.nextScanBatch;
  const verificationSymbols = plannerPlan.verificationSymbols;
  return {
    builtInSymbols,
    watchlistSymbols,
    flowUniverseSymbols,
    candidateBuiltInSymbols,
    candidateWatchlistSymbols,
    candidatePrioritySymbols,
    verificationSymbols,
    planner: plannerPlan as unknown as Record<string, unknown>,
  };
}

const MASSIVE_STOCK_UNIVERSE_STREAM_REFRESH_MS = 30_000;
const MASSIVE_STOCK_UNIVERSE_STREAM_DEFAULT_SYMBOL_CAP = 1_000;
const MASSIVE_STOCK_UNIVERSE_STREAM_ENABLED = readBooleanEnv(
  "MASSIVE_STOCK_UNIVERSE_STREAM_ENABLED",
  false,
);
let massiveStockUniverseAggregateUnsubscribe: (() => void) | null = null;
let massiveStockUniverseRefreshTimer: NodeJS.Timeout | null = null;
let massiveStockUniverseSignature = "";
let massiveStockUniverseLastRefreshAt: Date | null = null;
let massiveStockUniverseLastSubscribedAt: Date | null = null;
let massiveStockUniverseLastReason: string | null = null;
let massiveStockUniverseLastStatus:
  | "idle"
  | "active"
  | "disabled"
  | "empty"
  | "not_configured"
  | "resource_pressure"
  | "error" = "idle";
let massiveStockUniverseLastError: string | null = null;
let massiveStockUniverseLastPressureLevel: string | null = null;

function massiveStockUniverseStreamSymbolCap(): number {
  return positiveIntegerEnv(
    "MASSIVE_STOCK_UNIVERSE_STREAM_SYMBOL_CAP",
    MASSIVE_STOCK_UNIVERSE_STREAM_DEFAULT_SYMBOL_CAP,
  );
}

function resolveMassiveStockUniverseSymbols(): string[] {
  const sources = getOptionsFlowLaneSourceSymbols();
  const symbolCap = massiveStockUniverseStreamSymbolCap();
  return Array.from(
    new Set(
      [
        ...sources.candidateBuiltInSymbols,
        ...sources.candidateWatchlistSymbols,
        ...sources.candidatePrioritySymbols,
        ...sources.flowUniverseSymbols,
      ]
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  )
    .slice(0, symbolCap)
    .sort();
}

function closeMassiveStockUniverseStreams(
  status: typeof massiveStockUniverseLastStatus,
): void {
  massiveStockUniverseAggregateUnsubscribe?.();
  massiveStockUniverseAggregateUnsubscribe = null;
  massiveStockUniverseSignature = "";
  massiveStockUniverseLastStatus = status;
}

function refreshMassiveStockUniverseStreams(reason: string): void {
  massiveStockUniverseLastRefreshAt = new Date();
  massiveStockUniverseLastReason = reason;
  massiveStockUniverseLastError = null;
  const resourcePressure = getApiResourcePressureSnapshot();
  massiveStockUniverseLastPressureLevel = resourcePressure.level;

  if (!MASSIVE_STOCK_UNIVERSE_STREAM_ENABLED) {
    closeMassiveStockUniverseStreams("disabled");
    return;
  }
  if (!isMassiveStocksRealtimeConfigured()) {
    closeMassiveStockUniverseStreams("not_configured");
    return;
  }
  if (resourcePressure.level === "critical") {
    closeMassiveStockUniverseStreams("resource_pressure");
    return;
  }

  const symbols = resolveMassiveStockUniverseSymbols();
  const signature = symbols.join(",");
  if (!signature) {
    closeMassiveStockUniverseStreams("empty");
    return;
  }
  if (signature === massiveStockUniverseSignature) {
    massiveStockUniverseLastStatus = "active";
    return;
  }

  closeMassiveStockUniverseStreams("idle");
  try {
    massiveStockUniverseAggregateUnsubscribe = subscribeStockMinuteAggregates(
      symbols,
      () => {},
    );
    massiveStockUniverseSignature = signature;
    massiveStockUniverseLastSubscribedAt = new Date();
    massiveStockUniverseLastStatus = "active";
  } catch (error) {
    closeMassiveStockUniverseStreams("error");
    massiveStockUniverseLastError =
      error instanceof Error ? error.message : String(error);
    logger.warn(
      { err: error, reason },
      "Massive stock universe stream subscription failed",
    );
  }
}

export function startMassiveStockUniverseStreams(): void {
  if (!MASSIVE_STOCK_UNIVERSE_STREAM_ENABLED) {
    closeMassiveStockUniverseStreams("disabled");
    return;
  }
  if (massiveStockUniverseRefreshTimer) {
    return;
  }
  refreshMassiveStockUniverseStreams("startup");
  massiveStockUniverseRefreshTimer = setInterval(
    () => refreshMassiveStockUniverseStreams("runtime-resync"),
    MASSIVE_STOCK_UNIVERSE_STREAM_REFRESH_MS,
  );
  massiveStockUniverseRefreshTimer.unref?.();
}

export function stopMassiveStockUniverseStreams(): void {
  if (massiveStockUniverseRefreshTimer) {
    clearInterval(massiveStockUniverseRefreshTimer);
    massiveStockUniverseRefreshTimer = null;
  }
  closeMassiveStockUniverseStreams("idle");
}

export function getMassiveStockUniverseStreamDiagnostics() {
  const symbols = massiveStockUniverseSignature
    ? massiveStockUniverseSignature.split(",").filter(Boolean)
    : [];
  return {
    configured: isMassiveStocksRealtimeConfigured(),
    active: massiveStockUniverseLastStatus === "active",
    status: massiveStockUniverseLastStatus,
    symbolCount: symbols.length,
    symbolSample: symbols.slice(0, 20),
    symbolCap: massiveStockUniverseStreamSymbolCap(),
    refreshIntervalMs: MASSIVE_STOCK_UNIVERSE_STREAM_REFRESH_MS,
    pressureLevel: massiveStockUniverseLastPressureLevel,
    pressureBlocked: massiveStockUniverseLastStatus === "resource_pressure",
    lastRefreshAt: massiveStockUniverseLastRefreshAt?.toISOString() ?? null,
    lastSubscribedAt:
      massiveStockUniverseLastSubscribedAt?.toISOString() ?? null,
    lastReason: massiveStockUniverseLastReason,
    lastError: massiveStockUniverseLastError,
  };
}

export const __massiveStockUniverseStreamsForTests = {
  refresh: refreshMassiveStockUniverseStreams,
  reset() {
    stopMassiveStockUniverseStreams();
    massiveStockUniverseLastRefreshAt = null;
    massiveStockUniverseLastSubscribedAt = null;
    massiveStockUniverseLastReason = null;
    massiveStockUniverseLastStatus = "idle";
    massiveStockUniverseLastError = null;
    massiveStockUniverseLastPressureLevel = null;
  },
  resolveSymbols: resolveMassiveStockUniverseSymbols,
};

export function getOptionsFlowDeepScannerIntervalMs(
  config: OptionsFlowRuntimeConfig = getOptionsFlowRuntimeConfig(),
): number {
  return getFlowScannerIntervalMs({
    baseIntervalMs: config.scannerIntervalMs,
    alwaysOn: config.scannerAlwaysOn,
  });
}

function estimateOptionsFlowScannerCycleMs(input: {
  activeTargetSize: number;
  batchSize: number;
  intervalMs: number;
}): number | null {
  const activeTargetSize = Math.max(0, Math.floor(input.activeTargetSize || 0));
  if (activeTargetSize <= 0) {
    return null;
  }
  const batchSize = Math.max(1, Math.floor(input.batchSize || 1));
  const intervalMs = Math.max(1_000, Math.floor(input.intervalMs || 1_000));
  return Math.max(
    intervalMs,
    Math.ceil(activeTargetSize / Math.min(batchSize, activeTargetSize)) *
      intervalMs,
  );
}

function currentOptionsFlowScannerSkipReason(
  deepScanner: ReturnType<typeof optionsFlowScanner.getDiagnostics>,
  config: OptionsFlowRuntimeConfig,
  backgroundBlockedReason: string | null,
): string | null {
  if (!deepScanner.lastSkippedReason || backgroundBlockedReason) {
    return null;
  }
  const lastRunAtMs = deepScanner.lastRunAt?.getTime();
  if (!Number.isFinite(lastRunAtMs)) {
    return null;
  }
  const maxSkipAgeMs = Math.max(1, config.scannerIntervalMs * 2);
  return Date.now() - (lastRunAtMs as number) <= maxSkipAgeMs
    ? deepScanner.lastSkippedReason
    : null;
}

export function startOptionsFlowScanner(): void {
  const config = getOptionsFlowRuntimeConfig();
  syncMarketDataAdmissionRuntimeDefaults(config);
  if (optionsFlowScannerStarted || !config.scannerEnabled) {
    return;
  }

  const resolveScannerSymbols = () => {
    if (
      enforceOptionsFlowScannerPressureControls() ||
      getOptionsFlowScannerBackgroundBlockReason()
    ) {
      stopMassiveStockUniverseStreams();
      return [];
    }
    const admittedSymbols = getOptionsFlowScannerLaneResolution().admittedSymbols;
    if (admittedSymbols.length > 0) {
      startMassiveStockUniverseStreams();
    } else {
      stopMassiveStockUniverseStreams();
    }
    return admittedSymbols;
  };
  const initialSymbols = resolveScannerSymbols();

  const effectiveScannerConcurrency =
    syncOptionsFlowScannerEffectiveConcurrency(config);
  const resolveDeepIntervalMs = () => getOptionsFlowDeepScannerIntervalMs();
  optionsFlowScanner.startRotation({
    symbols: () =>
      enforceOptionsFlowScannerPressureControls() ||
      getOptionsFlowScannerBackgroundBlockReason()
        ? []
        : resolveScannerSymbols(),
    request: () => {
      const runtimeConfig = getOptionsFlowRuntimeConfig();
      syncMarketDataAdmissionRuntimeDefaults(runtimeConfig);
      return buildOptionsFlowSeedScannerRequest(runtimeConfig);
    },
    intervalMs: resolveDeepIntervalMs,
    batchSize: () => {
      const runtimeConfig = getOptionsFlowRuntimeConfig();
      syncOptionsFlowScannerEffectiveConcurrency(runtimeConfig);
      const queueState = getOptionsFlowScannerDeepQueueState(runtimeConfig);
      return Math.max(
        0,
        Math.min(
          Math.floor(runtimeConfig.scannerBatchSize || 0),
          queueState.available,
        ),
      );
    },
    onCycle: () => {
      optionsFlowExpandedSymbolsThisCycle.clear();
    },
  });
  optionsFlowScannerStarted = true;
  logger.info(
    {
      symbols: initialSymbols.length,
      batchSize: config.scannerBatchSize,
      concurrency: config.scannerConcurrency,
      effectiveConcurrency: effectiveScannerConcurrency,
      lineBudget: config.scannerLineBudget,
      strikeCoverage: config.scannerStrikeCoverage,
      intervalMs: config.scannerIntervalMs,
      universeMode: config.universeMode,
      universeTargetSize: config.universeSize,
      preferredTransport: "tws",
    },
    "Started options flow scanner",
  );
}

export function stopOptionsFlowScanner(): void {
  stopMassiveStockUniverseStreams();
  optionsFlowScanner.stop();
  optionsFlowScannerStarted = false;
}

export function startFlowUniverseOptionabilityVerifier(): void {
  flowUniverseOptionabilityVerifier.start();
}

export function stopFlowUniverseOptionabilityVerifier(): void {
  flowUniverseOptionabilityVerifier.stop();
}

export function getFlowUniverseOptionabilityVerifierDiagnostics() {
  return flowUniverseOptionabilityVerifier.getDiagnostics();
}

export function getOptionsFlowUniverseCoverage(): FlowUniverseCoverage {
  const config = getOptionsFlowRuntimeConfig();
  const intervalMs = getOptionsFlowDeepScannerIntervalMs(config);
  const batchSize = Math.max(1, Math.floor(config.scannerBatchSize || 1));
  const deepScanner = optionsFlowScanner.getDiagnostics();
  const laneSources = getOptionsFlowLaneSourceSymbols();
  const planner = laneSources.planner;
  const plannerDiagnostics = isRecord(planner.diagnostics)
    ? planner.diagnostics
    : {};
  const plannerSelectableSymbols =
    typeof plannerDiagnostics.selectableSymbols === "number"
      ? plannerDiagnostics.selectableSymbols
      : 0;
  const plannerCandidateSymbols =
    typeof plannerDiagnostics.candidateSymbols === "number"
      ? plannerDiagnostics.candidateSymbols
      : 0;
  const plannerLastError =
    typeof plannerDiagnostics.lastError === "string" &&
    plannerDiagnostics.lastError.trim()
      ? plannerDiagnostics.lastError
      : null;
  const rawCoverage = flowUniverseManager.getCoverage();
  const estimatedCycleMs = estimateOptionsFlowScannerCycleMs({
    activeTargetSize: Math.max(
      rawCoverage.activeTargetSize,
      plannerSelectableSymbols,
    ),
    batchSize,
    intervalMs,
  });
  const coverage = flowUniverseManager.getCoverage({
    scanWindowMs:
      estimatedCycleMs === null ? undefined : estimatedCycleMs + intervalMs,
  });
  const mergedActiveTargetSize = Math.max(
    coverage.activeTargetSize,
    plannerSelectableSymbols,
  );
  const mergedSelectedSymbols = Math.max(
    coverage.selectedSymbols,
    plannerSelectableSymbols,
  );
  const mergedSelectedShortfall = Math.max(
    0,
    coverage.targetSize - mergedSelectedSymbols,
  );
  const mergedFillShortReason =
    mergedSelectedShortfall > 0
      ? `Universe fill short: ${mergedSelectedSymbols}/${coverage.targetSize}`
      : null;
  const managerShortfallOnly =
    typeof coverage.degradedReason === "string" &&
    coverage.degradedReason.startsWith("Universe fill short:");
  const plannerErrorReason = plannerLastError
    ? `Flow universe planner unavailable: ${plannerLastError}`
    : null;
  const mergedDegradedReason =
    plannerErrorReason ??
    (managerShortfallOnly
      ? mergedFillShortReason
      : (coverage.degradedReason ?? mergedFillShortReason));
  const baseCoverage = {
    ...coverage,
    activeTargetSize: mergedActiveTargetSize,
    selectedSymbols: mergedSelectedSymbols,
    selectedShortfall: mergedSelectedShortfall,
    verifiedSymbols: Math.max(
      coverage.verifiedSymbols,
      plannerCandidateSymbols,
    ),
    currentBatch: coverage.currentBatch.length
      ? coverage.currentBatch
      : laneSources.flowUniverseSymbols,
    degradedReason: mergedDegradedReason,
    fallbackUsed: Boolean(mergedDegradedReason),
    planner,
    batchSize,
    intervalMs,
    lineBudget: config.scannerLineBudget,
    concurrency: resolveOptionsFlowScannerEffectiveConcurrency(config),
    estimatedCycleMs,
  };
  const backgroundBlockedReason = getOptionsFlowScannerBackgroundBlockReason();
  const deepPhaseActive = Boolean(
    deepScanner.activeSymbols.length ||
      deepScanner.draining ||
      baseCoverage.currentBatch.length ||
      deepScanner.lastBatch.length,
  );
  const scannerPhase =
    backgroundBlockedReason !== null
      ? "blocked"
      : deepPhaseActive
        ? "deep"
        : "idle";
  const marketSessionQuiet = backgroundBlockedReason === "market-session-quiet";
  const resolveCoverageHealth = (cycleMs: number | null) => {
    if (marketSessionQuiet) return "quiet";
    if (backgroundBlockedReason) return "blocked";
    if (
      isRegularTradingHours() &&
      cycleMs !== null &&
      cycleMs > OPTIONS_FLOW_COVERAGE_ACTIVE_TARGET_MS
    ) {
      return "lagging";
    }
    return "healthy";
  };
  const lastScanAgeMs = (value: Date | null | undefined) => {
    const time = value instanceof Date ? value.getTime() : null;
    return Number.isFinite(time)
      ? Math.max(0, Date.now() - (time as number))
      : null;
  };
  return {
    ...baseCoverage,
    deepActiveSymbols: deepScanner.activeSymbols,
    deepLastBatch: deepScanner.lastBatch,
    scannerPhase,
    lastScanAgeMs: lastScanAgeMs(baseCoverage.lastScanAt),
    coverageHealth: resolveCoverageHealth(baseCoverage.estimatedCycleMs),
    marketSessionQuiet,
    coverageTargetMs: OPTIONS_FLOW_COVERAGE_ACTIVE_TARGET_MS,
  };
}

export function getOptionsFlowUniverse() {
  const sources = getOptionsFlowLaneSourceSymbols();
  const laneResolution = resolveIbkrLaneSymbols("flow-scanner", {
    "built-in": sources.builtInSymbols,
    watchlists: sources.watchlistSymbols,
    "flow-universe": sources.flowUniverseSymbols,
  });
  const orderedLaneResolution = orderOptionsFlowUniverseLaneResolution(
    sources,
    laneResolution,
  );
  return {
    coverage: getOptionsFlowUniverseCoverage(),
    symbols: orderedLaneResolution.admittedSymbols,
    sources,
  };
}

function getFlowPremiumDistributionUniverseSymbols(): string[] {
  const universe = getOptionsFlowUniverse();
  const symbols = universe.symbols.length
    ? universe.symbols
    : [
        ...universe.sources.candidateBuiltInSymbols,
        ...universe.sources.candidateWatchlistSymbols,
        ...universe.sources.candidatePrioritySymbols,
        ...universe.sources.verificationSymbols,
        ...universe.sources.flowUniverseSymbols,
      ];

  return Array.from(
    new Set(
      symbols
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(isPremiumDistributionCandidate),
    ),
  ).slice(0, FLOW_PREMIUM_DISTRIBUTION_UNIVERSE_MAX_SYMBOLS);
}

function flowEventDateMs(value: unknown): number {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  if (typeof value === "string" || typeof value === "number") {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
  }
  return 0;
}

function flowEventNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function flowEventAggregateIdentity(event: unknown): string {
  const record =
    event && typeof event === "object"
      ? (event as Record<string, unknown>)
      : {};
  const id = String(record.id || "").trim();
  if (id) {
    return id;
  }

  return [
    record.underlying,
    record.optionSymbol ?? record.symbol,
    record.expirationDate,
    record.strike,
    record.right,
    record.side,
    record.occurredAt ?? record.updatedAt ?? record.timestamp,
    record.premium,
  ]
    .map((part) => String(part ?? ""))
    .join("|");
}

function dedupeAggregateFlowEvents(events: unknown[]): unknown[] {
  const seenEvents = new Set<string>();
  return events.filter((event) => {
    const identity = flowEventAggregateIdentity(event);
    if (!identity || seenEvents.has(identity)) {
      return false;
    }
    seenEvents.add(identity);
    return true;
  });
}

function compareAggregateFlowEvents(left: unknown, right: unknown): number {
  const leftRecord =
    left && typeof left === "object" ? (left as Record<string, unknown>) : {};
  const rightRecord =
    right && typeof right === "object"
      ? (right as Record<string, unknown>)
      : {};

  const leftUnusual = Boolean(leftRecord.isUnusual);
  const rightUnusual = Boolean(rightRecord.isUnusual);
  if (leftUnusual !== rightUnusual) {
    return leftUnusual ? -1 : 1;
  }

  const unusualScore =
    flowEventNumber(rightRecord.unusualScore) -
    flowEventNumber(leftRecord.unusualScore);
  if (unusualScore !== 0) {
    return unusualScore;
  }

  const premium =
    flowEventNumber(rightRecord.premium) - flowEventNumber(leftRecord.premium);
  if (premium !== 0) {
    return premium;
  }

  return (
    flowEventDateMs(rightRecord.occurredAt ?? rightRecord.updatedAt) -
    flowEventDateMs(leftRecord.occurredAt ?? leftRecord.updatedAt)
  );
}

function compareAggregateFlowEventsByRecency(
  left: unknown,
  right: unknown,
): number {
  const leftRecord =
    left && typeof left === "object" ? (left as Record<string, unknown>) : {};
  const rightRecord =
    right && typeof right === "object"
      ? (right as Record<string, unknown>)
      : {};

  const occurredAt =
    flowEventDateMs(rightRecord.occurredAt ?? rightRecord.updatedAt) -
    flowEventDateMs(leftRecord.occurredAt ?? leftRecord.updatedAt);
  if (occurredAt !== 0) {
    return occurredAt;
  }

  return (
    flowEventNumber(rightRecord.premium) - flowEventNumber(leftRecord.premium)
  );
}

let optionsFlowAggregateSeedOffset = 0;

function selectAggregateFlowSeedSymbols(input: {
  prioritySymbols: readonly string[];
  laneSymbols: readonly string[];
  fallbackSymbols?: readonly string[];
  snapshotSymbols: ReadonlySet<string>;
  batchSize: number;
}): string[] {
  const batchSize = Math.max(0, Math.floor(input.batchSize || 0));
  if (batchSize <= 0) {
    return [];
  }
  const selected: string[] = [];
  const seen = new Set<string>();
  const append = (symbolInput: string): boolean => {
    if (selected.length >= batchSize) {
      return false;
    }
    const symbol = normalizeSymbol(symbolInput);
    if (!symbol || seen.has(symbol) || input.snapshotSymbols.has(symbol)) {
      return false;
    }
    selected.push(symbol);
    seen.add(symbol);
    return true;
  };

  for (const symbol of input.prioritySymbols) {
    append(symbol);
  }

  const laneSymbols = Array.from(
    new Set(
      input.laneSymbols
        .map((symbol) => normalizeSymbol(symbol))
        .filter(Boolean),
    ),
  );
  if (laneSymbols.length && selected.length < batchSize) {
    const start = optionsFlowAggregateSeedOffset % laneSymbols.length;
    for (
      let index = 0;
      index < laneSymbols.length && selected.length < batchSize;
      index += 1
    ) {
      append(laneSymbols[(start + index) % laneSymbols.length]);
    }
    optionsFlowAggregateSeedOffset =
      (start + Math.max(1, batchSize)) % laneSymbols.length;
  }

  for (const symbol of input.fallbackSymbols ?? []) {
    append(symbol);
  }

  return selected;
}

export function __selectAggregateFlowSeedSymbolsForTests(input: {
  prioritySymbols: readonly string[];
  laneSymbols: readonly string[];
  fallbackSymbols?: readonly string[];
  snapshotSymbols: ReadonlySet<string>;
  batchSize: number;
}): string[] {
  return selectAggregateFlowSeedSymbols(input);
}

export async function listAggregateFlowEvents(
  input: {
    limit?: number;
    scope?: FlowEventsScope;
    minPremium?: number;
    maxDte?: number;
    unusualThreshold?: number;
    lineBudget?: number;
  } = {},
): Promise<FlowEventsResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 1_000));
  const unusualThreshold =
    Number.isFinite(input.unusualThreshold) && (input.unusualThreshold ?? 0) > 0
      ? Math.min(100, Math.max(0.1, input.unusualThreshold as number))
      : undefined;
  const filters = normalizeFlowEventsFilters(input);
  const runtimeConfig = getOptionsFlowRuntimeConfig();
  const requestedLineBudget = resolveOptionsFlowScannerTickerLineBudget({
    config: runtimeConfig,
    explicitLineBudget: input.lineBudget,
  });
  const snapshotLimit = Math.max(
    1,
    Math.min(limit, runtimeConfig.scannerLimit, requestedLineBudget),
  );
  const scannerCoverage = getOptionsFlowUniverseCoverage();

  if (!runtimeConfig.scannerEnabled) {
    return {
      events: [],
      source: flowSource({
        provider: "none",
        status: "empty",
        unusualThreshold: unusualThreshold ?? 1,
        ibkrStatus: "empty",
        ibkrReason: "options_flow_scanner_disabled",
        scannerCoverage,
      }),
    };
  }

  const scannerRequest = {
    limit: snapshotLimit,
    lineBudget: requestedLineBudget,
    allowPartial: true,
    phase: "seed" as const,
    expirationScanCount: 1,
    strikeCoverage: "standard" as const,
  };
  const snapshots = optionsFlowScanner.listSnapshots(scannerRequest);
  let queuedSeedRefresh = false;
  let aggregateSeedBlockReason: string | null = null;
  const snapshotSymbols = new Set(
    snapshots
      .map((snapshot) => normalizeSymbol(snapshot.symbol))
      .filter(Boolean),
  );
  const minSeededSnapshotSymbols = Math.min(
    limit,
    Math.max(1, OPTIONS_FLOW_AGGREGATE_MIN_SNAPSHOT_SYMBOLS),
  );
  const aggregateSeedQueueState =
    getOptionsFlowScannerDeepQueueState(runtimeConfig);
  const seedBatchSize = Math.max(
    0,
    Math.min(
      runtimeConfig.scannerBatchSize,
      OPTIONS_FLOW_AGGREGATE_SEED_BATCH_SIZE,
      aggregateSeedQueueState.available,
      Math.max(1, minSeededSnapshotSymbols - snapshots.length),
    ),
  );
  const currentBatchSymbols = (scannerCoverage.currentBatch ?? [])
    .map((symbol) => normalizeSymbol(String(symbol || "")))
    .filter(Boolean);
  if (
    snapshots.length === 0 ||
    (currentBatchSymbols.length > 0 &&
      snapshots.length < minSeededSnapshotSymbols)
  ) {
    const diagnostics = optionsFlowScanner.getDiagnostics();
    const seedSymbols = selectAggregateFlowSeedSymbols({
      prioritySymbols: [],
      laneSymbols: getOptionsFlowScannerLaneResolution().admittedSymbols,
      fallbackSymbols: currentBatchSymbols,
      snapshotSymbols,
      batchSize: seedBatchSize,
    });
    aggregateSeedBlockReason =
      enforceOptionsFlowScannerPressureControls() ??
      getOptionsFlowScannerBackgroundBlockReason({
        ignoreLiveWarmup: true,
      }) ??
      (await refreshOptionsFlowSessionBlockReason(runtimeConfig));
    if (
      seedSymbols.length > 0 &&
      diagnostics.queuedCount === 0 &&
      !diagnostics.draining &&
      !aggregateSeedBlockReason
    ) {
      queuedSeedRefresh = true;
      syncOptionsFlowScannerEffectiveConcurrency(runtimeConfig);
      optionsFlowScanner
        .requestScan(seedSymbols, scannerRequest)
        .catch((error) => {
          logger.warn(
            { err: error, symbols: seedSymbols, phase: "aggregate-seed" },
            "Failed to queue aggregate options flow scanner refresh",
          );
        });
    }
  }
  const snapshotEvents = dedupeAggregateFlowEvents(
    snapshots.flatMap((snapshot) => snapshot.events),
  )
    .sort(compareAggregateFlowEvents);

  const storedEvents = await listRecentStoredHistoricalFlowEvents({
    providerName: getMarketDataConnectionName(),
    limit,
    filters,
    unusualThreshold,
    candidateLimit: Math.max(limit * 10, 250),
  });
  const filteredEvents = filterFlowEventsForRequest(
    dedupeAggregateFlowEvents([...snapshotEvents, ...storedEvents]).sort(
      compareAggregateFlowEventsByRecency,
    ),
    filters,
    unusualThreshold,
    limit,
  );
  const hasStoredEvents = storedEvents.length > 0;
  const hasSnapshotEvents = filteredEvents.some((event) => {
    const provider =
      event && typeof event === "object"
        ? (event as Record<string, unknown>).provider
        : null;
    return provider === "ibkr";
  });
  const freshSnapshots = snapshots.filter(
    (snapshot) => snapshot.freshness === "fresh",
  ).length;
  const staleSnapshots = snapshots.length - freshSnapshots;
  const sourceStatus = filteredEvents.length
    ? hasSnapshotEvents && freshSnapshots > 0
      ? "live"
      : "fallback"
    : "empty";
  const sourceProvider = hasSnapshotEvents
    ? "ibkr"
    : filteredEvents.length && hasStoredEvents
      ? "massive"
      : "none";
  const attemptedProviders: FlowDataProvider[] = ["ibkr", "massive"];

  return {
    events: filteredEvents,
    source: flowSource({
      provider: sourceProvider,
      status: sourceStatus,
      fallbackUsed:
        hasStoredEvents ||
        staleSnapshots > 0 ||
        Boolean(scannerCoverage.fallbackUsed),
      attemptedProviders,
      unusualThreshold: unusualThreshold ?? 1,
      ibkrStatus: hasSnapshotEvents ? "loaded" : "empty",
      ibkrReason:
        filteredEvents.length > 0
          ? hasSnapshotEvents
            ? scannerCoverage.degradedReason
            : "options_flow_historical_store"
          : queuedSeedRefresh
            ? "options_flow_scanner_queued"
            : aggregateSeedBlockReason
              ? `options_flow_scanner_${aggregateSeedBlockReason.replace(/-/g, "_")}`
              : scannerCoverage.lastScanAt
                ? "options_flow_scanner_no_cached_events"
                : "options_flow_scanner_snapshot_pending",
      scannerCoverage,
    }),
  };
}

export async function getFlowPremiumDistribution(
  input: {
    limit?: number;
    candidateLimit?: number;
    coverageMode?: FlowPremiumDistributionCoverageMode;
    timeframe?: PremiumDistributionTimeframe;
  } = {},
): Promise<FlowPremiumDistributionResponse> {
  const requestedAt = Date.now();
  const limit = normalizeFlowPremiumDistributionLimit(input.limit);
  const candidateLimit = normalizeFlowPremiumDistributionCandidateLimit(
    input.candidateLimit,
  );
  const timeframe = normalizeFlowPremiumDistributionTimeframe(input.timeframe);
  const coverageMode = normalizeFlowPremiumDistributionCoverageMode(
    input.coverageMode,
  );
  const universeSymbols =
    coverageMode === "universe"
      ? getFlowPremiumDistributionUniverseSymbols()
      : [];
  const cacheKey = flowPremiumDistributionCacheKey({
    limit,
    candidateLimit,
    timeframe,
    coverageMode,
    symbols: universeSymbols,
  });
  pruneFlowPremiumDistributionCache(requestedAt);
  const cached = flowPremiumDistributionCache.get(cacheKey);
  if (cached && cached.expiresAt > requestedAt) {
    return withFlowPremiumDistributionCacheState(cached.value, "fresh");
  }
  if (
    cached &&
    cached.staleExpiresAt > requestedAt &&
    coverageMode === "universe"
  ) {
    return withFlowPremiumDistributionCacheState(
      cached.value,
      "stale",
      cached.value.source.hydrationStatus === "refreshing"
        ? "refreshing"
        : undefined,
    );
  }

  const inFlight = flowPremiumDistributionInFlight.get(cacheKey);
  if (inFlight) {
    if (cached && cached.staleExpiresAt > requestedAt) {
      return withFlowPremiumDistributionCacheState(
        cached.value,
        "stale",
        "refreshing",
      );
    }
    return inFlight;
  }

  if (
    flowPremiumDistributionDeepRefreshInFlight.has(cacheKey) &&
    cached &&
    cached.staleExpiresAt > requestedAt
  ) {
    return withFlowPremiumDistributionCacheState(
      cached.value,
      "stale",
      "refreshing",
    );
  }

  const config = getMassiveRuntimeConfig();
  if (!config) {
    return {
      status: "unconfigured",
      asOf: new Date(),
      timeframe,
      source: {
        provider: "massive",
        label: "Massive premium snapshots",
        timeframe,
        providerHost: null,
        sideBasis: "none",
        quoteAccess: "unknown",
        tradeAccess: "unknown",
        classifiedPremium: 0,
        classificationCoverage: 0,
        classificationConfidence: "none",
        coverageMode,
        hydrationStatus: "failed",
        hydrationWarning: "Massive market data is not configured.",
        hydratedSymbolCount: 0,
        hydrationDiagnostics: emptyFlowPremiumHydrationDiagnostics(),
        candidateDate: null,
        candidateCount: 0,
        rankedCount: 0,
        errorCount: 0,
        errorMessage: "Massive market data is not configured.",
        cache: "miss",
      },
      widgets: [],
    };
  }

  const request = (async (): Promise<FlowPremiumDistributionResponse> => {
    const now = new Date();
    const client = getMassiveClient();
    const grouped = await fetchLatestGroupedStockAggregates({
      client,
      now,
      timeframe,
    });
    if (!grouped.aggregates.length && coverageMode === "ranked") {
      const empty: FlowPremiumDistributionResponse = {
        status: grouped.errorMessage ? "degraded" : "empty",
        asOf: now,
        timeframe,
        source: {
          provider: "massive",
          label: "Massive premium snapshots",
          timeframe,
          providerHost: getMassiveProviderHost(),
          sideBasis: "none",
          quoteAccess: "unknown",
          tradeAccess: "unknown",
          classifiedPremium: 0,
          classificationCoverage: 0,
          classificationConfidence: "none",
          coverageMode,
          hydrationStatus: grouped.errorMessage ? "failed" : "complete",
          hydrationWarning: grouped.errorMessage,
          hydratedSymbolCount: 0,
          hydrationDiagnostics: emptyFlowPremiumHydrationDiagnostics(),
          candidateDate: grouped.candidateDate,
          candidateCount: 0,
          rankedCount: 0,
          errorCount: grouped.errorMessage ? 1 : 0,
          errorMessage: grouped.errorMessage,
          cache: "miss",
        },
        widgets: [],
      };
      flowPremiumDistributionCache.set(cacheKey, {
        value: empty,
        expiresAt: Date.now() + FLOW_PREMIUM_DISTRIBUTION_CACHE_TTL_MS,
        staleExpiresAt: Date.now() + FLOW_PREMIUM_DISTRIBUTION_STALE_TTL_MS,
      });
      return empty;
    }

    const groupedBySymbol = new Map(
      grouped.aggregates.map((aggregate) => [aggregate.symbol, aggregate]),
    );
    const candidates =
      coverageMode === "universe"
        ? universeSymbols.map((symbol, index) => ({
            symbol,
            volume: groupedBySymbol.get(symbol)?.volume ?? 0,
            rank: index + 1,
          }))
        : grouped.aggregates
            .filter((aggregate) =>
              isPremiumDistributionCandidate(aggregate.symbol),
            )
            .sort((left, right) => right.volume - left.volume)
            .slice(0, candidateLimit)
            .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    if (!candidates.length) {
      const empty: FlowPremiumDistributionResponse = {
        status: "empty",
        asOf: now,
        timeframe,
        source: {
          provider: "massive",
          label: "Massive premium snapshots",
          timeframe,
          providerHost: getMassiveProviderHost(),
          sideBasis: "none",
          quoteAccess: "unknown",
          tradeAccess: "unknown",
          classifiedPremium: 0,
          classificationCoverage: 0,
          classificationConfidence: "none",
          coverageMode,
          hydrationStatus: "complete",
          hydrationWarning: "No premium-distribution candidates are available.",
          hydratedSymbolCount: 0,
          hydrationDiagnostics: emptyFlowPremiumHydrationDiagnostics(),
          candidateDate: grouped.candidateDate,
          candidateCount: 0,
          rankedCount: 0,
          errorCount: grouped.errorMessage ? 1 : 0,
          errorMessage: grouped.errorMessage,
          cache: "miss",
        },
        widgets: [],
      };
      flowPremiumDistributionCache.set(cacheKey, {
        value: empty,
        expiresAt: Date.now() + FLOW_PREMIUM_DISTRIBUTION_CACHE_TTL_MS,
        staleExpiresAt: Date.now() + FLOW_PREMIUM_DISTRIBUTION_STALE_TTL_MS,
      });
      return empty;
    }
    const classificationTarget =
      coverageMode === "universe"
        ? FLOW_PREMIUM_DISTRIBUTION_CLASSIFICATION_TARGET
        : 0;
    const baselineTradeContractLimit = Math.min(
      FLOW_PREMIUM_DISTRIBUTION_BASE_TRADE_CONTRACT_LIMIT,
      FLOW_PREMIUM_DISTRIBUTION_TRADE_CONTRACT_LIMIT,
    );
    type PremiumDistributionCandidate = (typeof candidates)[number];
    type HydrationRun = {
      rankedDistributions: Array<OptionPremiumDistribution & { rank: number }>;
      errorCount: number;
      errorMessage: string | null;
    };

    const rankDistributions = (
      distributions: OptionPremiumDistribution[],
    ): Array<OptionPremiumDistribution & { rank: number }> =>
      distributions
        .filter(
          (distribution): distribution is OptionPremiumDistribution =>
            distribution !== null &&
            distribution.contractCount > 0 &&
            distribution.premiumTotal > 0,
        )
        .sort((left, right) => {
          const premiumDelta = right.premiumTotal - left.premiumTotal;
          if (premiumDelta !== 0) return premiumDelta;

          const classifiedDelta =
            right.classifiedPremium - left.classifiedPremium;
          if (classifiedDelta !== 0) return classifiedDelta;

          const volumeDelta =
            (right.stockDayVolume ?? 0) - (left.stockDayVolume ?? 0);
          if (volumeDelta !== 0) return volumeDelta;

          return left.symbol.localeCompare(right.symbol);
        })
        .map((distribution, index) => ({
          ...distribution,
          rank: index + 1,
        }));

    const hydrateCandidates = async (input: {
      candidateList?: PremiumDistributionCandidate[];
      tradeContractLimit: number;
      tradePremiumCoverageTarget: number;
      candidateTimeoutMs: number;
      enrichTrades?: boolean;
      maxPages?: number;
    }): Promise<HydrationRun> => {
      let errorCount = 0;
      let errorMessage: string | null = grouped.errorMessage;
      const distributions = await mapWithConcurrency(
        input.candidateList ?? candidates,
        FLOW_PREMIUM_DISTRIBUTION_CONCURRENCY,
        async (candidate) => {
          try {
            return await runWithAbortTimeout(
              input.candidateTimeoutMs,
              (signal) =>
                client.getOptionPremiumDistribution({
                  underlying: candidate.symbol,
                  stockDayVolume: candidate.volume,
                  timeframe,
                  maxPages:
                    input.maxPages ?? FLOW_PREMIUM_DISTRIBUTION_MAX_PAGES,
                  enrichTrades: input.enrichTrades ?? true,
                  tradeContractLimit: input.tradeContractLimit,
                  tradePremiumCoverageTarget: input.tradePremiumCoverageTarget,
                  tradeLimit: FLOW_PREMIUM_DISTRIBUTION_TRADE_LIMIT,
                  signal,
                }),
            );
          } catch (error) {
            errorCount += 1;
            errorMessage =
              errorMessage ??
              (error instanceof Error && error.message
                ? error.message
                : "Massive options premium snapshot failed.");
            return null;
          }
        },
      );
      const rankedDistributions = rankDistributions(
        distributions.filter(
          (distribution): distribution is OptionPremiumDistribution =>
            distribution !== null,
        ),
      );

      return { rankedDistributions, errorCount, errorMessage };
    };

    const buildResponse = (
      input: HydrationRun,
      hydrationStatus: FlowPremiumDistributionHydrationStatus,
      asOf: Date,
    ): FlowPremiumDistributionResponse => {
      const widgets = input.rankedDistributions.slice(0, limit);
      const sourceDiagnostics = buildFlowPremiumDistributionSourceDiagnostics(
        input.rankedDistributions,
      );

      return {
        status:
          input.rankedDistributions.length > 0
            ? input.errorCount > 0
              ? "degraded"
              : "ok"
            : input.errorCount > 0
              ? "degraded"
              : "empty",
        asOf,
        timeframe,
        source: {
          provider: "massive",
          label: "Massive premium snapshots",
          timeframe,
          ...sourceDiagnostics,
          coverageMode,
          hydrationStatus,
          candidateDate: grouped.candidateDate,
          candidateCount: candidates.length,
          rankedCount: input.rankedDistributions.length,
          errorCount: input.errorCount,
          errorMessage: input.errorMessage,
          cache: "miss",
        },
        widgets,
      };
    };

    const resolveHydrationStatus = (
      input: HydrationRun,
      sourceDiagnostics: ReturnType<
        typeof buildFlowPremiumDistributionSourceDiagnostics
      >,
      refreshing: boolean,
    ): FlowPremiumDistributionHydrationStatus => {
      if (input.errorCount > 0) {
        return input.rankedDistributions.length > 0 ? "partial" : "failed";
      }
      if (refreshing) {
        return "refreshing";
      }
      const selectedCoverage =
        sourceDiagnostics.hydrationDiagnostics.selectedPremiumCoverage;
      if (
        classificationTarget > 0 &&
        selectedCoverage + 0.005 < classificationTarget
      ) {
        return "partial";
      }
      return "complete";
    };

    const cacheResponse = (response: FlowPremiumDistributionResponse): void => {
      const settledAt = Date.now();
      flowPremiumDistributionCache.set(cacheKey, {
        value: response,
        expiresAt: settledAt + FLOW_PREMIUM_DISTRIBUTION_CACHE_TTL_MS,
        staleExpiresAt: settledAt + FLOW_PREMIUM_DISTRIBUTION_STALE_TTL_MS,
      });
    };

    const firstPaintCandidateCount = Math.min(
      candidates.length,
      Math.max(
        limit,
        Math.min(
          candidateLimit,
          FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_CANDIDATES,
        ),
      ),
    );
    const firstPaintCandidates = candidates.slice(0, firstPaintCandidateCount);
    const firstPaintMaxPages = Math.max(
      1,
      Math.min(
        FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_MAX_PAGES,
        FLOW_PREMIUM_DISTRIBUTION_MAX_PAGES,
      ),
    );
    const baseline = await hydrateCandidates({
      candidateList: firstPaintCandidates,
      tradeContractLimit: Math.min(
        FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_TRADE_CONTRACT_LIMIT,
        FLOW_PREMIUM_DISTRIBUTION_TRADE_CONTRACT_LIMIT,
      ),
      tradePremiumCoverageTarget:
        FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_CLASSIFICATION_TARGET,
      candidateTimeoutMs: FLOW_PREMIUM_DISTRIBUTION_FIRST_PAINT_TIMEOUT_MS,
      enrichTrades: true,
      maxPages: firstPaintMaxPages,
    });
    const baselineSourceDiagnostics =
      buildFlowPremiumDistributionSourceDiagnostics(
        baseline.rankedDistributions,
      );
    const shouldDeepRefresh =
      !flowPremiumDistributionDeepRefreshInFlight.has(cacheKey) &&
      candidates.length > 0 &&
      (firstPaintCandidates.length < candidates.length ||
        firstPaintMaxPages < FLOW_PREMIUM_DISTRIBUTION_MAX_PAGES ||
        classificationTarget > 0 ||
        FLOW_PREMIUM_DISTRIBUTION_TRADE_CONTRACT_LIMIT >
          baselineTradeContractLimit);
    const response = buildResponse(
      baseline,
      resolveHydrationStatus(
        baseline,
        baselineSourceDiagnostics,
        shouldDeepRefresh,
      ),
      now,
    );
    cacheResponse(response);

    if (shouldDeepRefresh) {
      const deepRefresh = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          void (async () => {
            const deepCandidates = candidates;
            const combinedBySymbol = new Map<
              string,
              OptionPremiumDistribution
            >();
            baseline.rankedDistributions.forEach((distribution) => {
              combinedBySymbol.set(distribution.symbol, distribution);
            });
            let combinedErrorCount = baseline.errorCount;
            let combinedErrorMessage = baseline.errorMessage;
            const firstChunkSize = Math.max(limit, 10);
            const deepChunkSizes = [firstChunkSize, 40];
            let offset = 0;

            while (offset < deepCandidates.length) {
              const configuredChunkSize =
                deepChunkSizes.shift() ??
                Math.max(40, Math.min(80, candidateLimit));
              const chunk = deepCandidates.slice(
                offset,
                offset + configuredChunkSize,
              );
              offset += chunk.length;
              if (!chunk.length) break;

              const deepChunk = await hydrateCandidates({
                candidateList: chunk,
                tradeContractLimit:
                  FLOW_PREMIUM_DISTRIBUTION_TRADE_CONTRACT_LIMIT,
                tradePremiumCoverageTarget: classificationTarget,
                candidateTimeoutMs:
                  FLOW_PREMIUM_DISTRIBUTION_DEEP_CANDIDATE_TIMEOUT_MS,
              });
              deepChunk.rankedDistributions.forEach((distribution) => {
                combinedBySymbol.set(distribution.symbol, distribution);
              });
              combinedErrorCount += deepChunk.errorCount;
              combinedErrorMessage =
                combinedErrorMessage ?? deepChunk.errorMessage ?? null;
              const combined: HydrationRun = {
                rankedDistributions: rankDistributions([
                  ...combinedBySymbol.values(),
                ]),
                errorCount: combinedErrorCount,
                errorMessage: combinedErrorMessage,
              };
              const combinedSourceDiagnostics =
                buildFlowPremiumDistributionSourceDiagnostics(
                  combined.rankedDistributions,
                );
              const refreshing =
                offset < deepCandidates.length &&
                combinedSourceDiagnostics.hydrationDiagnostics
                  .selectedPremiumCoverage +
                  0.005 <
                  classificationTarget;
              const deepResponse = buildResponse(
                combined,
                resolveHydrationStatus(
                  combined,
                  combinedSourceDiagnostics,
                  refreshing,
                ),
                new Date(),
              );
              cacheResponse(deepResponse);
            }
          })().then(resolve, resolve);
        }, 25);
        timer.unref?.();
      });
      const trackedRefresh = deepRefresh;
      flowPremiumDistributionDeepRefreshInFlight.set(cacheKey, trackedRefresh);
      trackedRefresh.finally(() => {
        if (
          flowPremiumDistributionDeepRefreshInFlight.get(cacheKey) ===
          trackedRefresh
        ) {
          flowPremiumDistributionDeepRefreshInFlight.delete(cacheKey);
        }
      });
    }

    return response;
  })();

  flowPremiumDistributionInFlight.set(cacheKey, request);
  request.finally(() => {
    if (flowPremiumDistributionInFlight.get(cacheKey) === request) {
      flowPremiumDistributionInFlight.delete(cacheKey);
    }
  });
  return request;
}

export function getOptionsFlowScannerDiagnostics() {
  const config = getOptionsFlowRuntimeConfig();
  syncMarketDataAdmissionRuntimeDefaults(config);
  const resourcePressure = getApiResourcePressureSnapshot();
  const scannerPressure = getOptionsFlowScannerPressureGate(resourcePressure);
  const sessionBlockReason =
    getCachedOptionsFlowSessionBlockReason() ??
    (isRegularTradingHours() ? null : "market-session-quiet");
  const backgroundBlockedReason = getOptionsFlowScannerBackgroundBlockReason();
  const scannerFillMode =
    backgroundBlockedReason === "live-warmup"
      ? "startup-protected"
      : backgroundBlockedReason
        ? "blocked"
        : "steady-state";
  const limitingReason =
    backgroundBlockedReason === "live-warmup"
      ? "startup-protected"
      : backgroundBlockedReason === "resource-pressure"
        ? "api-pressure-gate"
        : backgroundBlockedReason;
  const effectiveConcurrency = backgroundBlockedReason
    ? 0
    : resolveOptionsFlowScannerEffectiveConcurrency(config);
  const deepScanner = optionsFlowScanner.getDiagnostics();
  const coverage = getOptionsFlowUniverseCoverage();
  const admissionBudget = getMarketDataAdmissionBudget();
  const admissionDiagnostics = getMarketDataAdmissionDiagnostics();
  const effectiveFlowScannerLineCap = getMarketDataPoolEffectiveLineCap(
    "flow-scanner",
    admissionBudget,
  );
  const schedulableFlowScannerLineCap =
    getOptionsFlowScannerSchedulableLineCap();
  const scannerTargetLineBudget = Math.min(
    config.scannerLineBudget,
    schedulableFlowScannerLineCap,
  );
  const eligibleOptionableTickerCount = Math.max(
    0,
    coverage.activeTargetSize ?? coverage.selectedSymbols ?? 0,
  );
  const targetActiveTickerSlots = Math.max(
    0,
    Math.min(scannerTargetLineBudget, eligibleOptionableTickerCount),
  );
  const activeTickerSlotCount =
    admissionDiagnostics.flowScannerTickerSlots.activeTickerSlotCount;
  const tickerSlotShortfall = Math.max(
    0,
    targetActiveTickerSlots - activeTickerSlotCount,
  );
  const seedLineBudget = resolveOptionsFlowScannerTickerLineBudget({
    config,
    phaseLineCap: OPTIONS_FLOW_SCANNER_SEED_LINE_BUDGET,
  });
  const expandedLineBudget = resolveOptionsFlowScannerTickerLineBudget({
    config,
    phaseLineCap: OPTIONS_FLOW_SCANNER_EXPANDED_LINE_BUDGET,
  });
  const maxDeepScanLines =
    effectiveConcurrency <= 0
      ? 0
      : Math.min(effectiveFlowScannerLineCap, scannerTargetLineBudget);
  const deepQueueState = getOptionsFlowScannerDeepQueueState(config);
  const deepQueueLimit = deepQueueState.limit;
  const deepQueueBacklog = deepQueueState.backlog;
  const deepQueueAvailable = deepQueueState.available;
  const lastSkippedReason = currentOptionsFlowScannerSkipReason(
    deepScanner,
    config,
    backgroundBlockedReason,
  );
  const diagnosticDeepScanner =
    lastSkippedReason === deepScanner.lastSkippedReason
      ? deepScanner
      : { ...deepScanner, lastSkippedReason };
  const marketDataMode = deepScanner.lastMarketDataMode ?? null;
  const delayedMarketData = marketDataMode === "delayed";
  const marketDataModeDegraded =
    marketDataMode === "delayed" ||
    marketDataMode === "frozen" ||
    marketDataMode === "delayed_frozen";
  const shortfallReason =
    tickerSlotShortfall <= 0
      ? null
      : backgroundBlockedReason
        ? backgroundBlockedReason
        : lastSkippedReason
          ? lastSkippedReason
          : effectiveFlowScannerLineCap <= 0 ||
              schedulableFlowScannerLineCap <= 0
            ? "protected-app-demand"
            : eligibleOptionableTickerCount <= activeTickerSlotCount
              ? "insufficient-eligible-tickers"
              : deepQueueBacklog > 0 || deepScanner.draining || deepScanner.activeCount > 0
                ? "metadata-workers-filling-slots"
                : coverage.degradedReason
                  ? "optionability-filtering"
                  : "scanner-awaiting-next-cycle";
  return {
    enabled: config.scannerEnabled,
    started: optionsFlowScannerStarted,
    resourcePressure: {
      level: resourcePressure.level,
      drivers: resourcePressure.drivers,
      inputs: resourcePressure.inputs,
      caps: resourcePressure.caps,
    },
    scannerPressure,
    scannerMode: "direct-rotation",
    scannerFillMode,
    limitingReason,
    activeScanPhase: deepScanner.lastScanPhase,
    marketDataMode,
    delayedMarketData,
    marketDataModeDegraded,
    scannerAlwaysOn: config.scannerAlwaysOn,
    sessionBlockReason,
    snapshotTtlMs: FLOW_EVENTS_CACHE_TTL_MS,
    snapshotStaleTtlMs: OPTIONS_FLOW_SCANNER_SNAPSHOT_STALE_TTL_MS,
    aggregateMinSnapshotSymbols: OPTIONS_FLOW_AGGREGATE_MIN_SNAPSHOT_SYMBOLS,
    optionabilityVerifier: getFlowUniverseOptionabilityVerifierDiagnostics(),
    coverage,
    plannedHorizon: {
      symbolCount:
        coverage.activeTargetSize ?? coverage.selectedSymbols ?? null,
      symbols: coverage.currentBatch.length
        ? coverage.currentBatch
        : deepScanner.lastBatch.length
          ? deepScanner.lastBatch
          : [],
      batchSize: coverage.batchSize,
      intervalMs: coverage.intervalMs,
      estimatedCycleMs: coverage.estimatedCycleMs,
      coverageHealth: coverage.coverageHealth,
      scannerPhase: coverage.scannerPhase,
    },
    backgroundBlockedReason,
    backgroundHoldRemainingMs: getLiveWarmupBackgroundHoldRemainingMs(),
    lineBudget: config.scannerLineBudget,
    seedLineBudget,
    expandedLineBudget,
    expandedMinPremium: OPTIONS_FLOW_SCANNER_EXPANDED_MIN_PREMIUM,
    scanTimeoutMs: config.scannerSymbolTimeoutMs,
    lineUtilization: {
      poolCap: admissionBudget.flowScannerLineCap,
      effectivePoolCap: effectiveFlowScannerLineCap,
      schedulablePoolCap: schedulableFlowScannerLineCap,
      targetActiveTickerSlots,
      activeTickerSlotCount,
      eligibleOptionableTickerCount,
      perTickerLiveContractLimit:
        admissionDiagnostics.flowScannerTickerSlots.perTickerLiveContractLimit,
      tickerSlotShortfall,
      shortfallReason,
      duplicateActiveUnderlyingCount:
        admissionDiagnostics.flowScannerTickerSlots.duplicateActiveUnderlyingCount,
      configuredConcurrency: config.scannerConcurrency,
      effectiveConcurrency,
      deepQueueLimit,
      deepQueueBacklog,
      deepQueueAvailable,
      scannerLineBudget: config.scannerLineBudget,
      scannerTargetLineBudget,
      seedLineBudget,
      expandedLineBudget,
      effectiveDeepLineBudget: expandedLineBudget,
      maxDeepScanLines,
      unusedPoolLines: Math.max(
        0,
        effectiveFlowScannerLineCap - maxDeepScanLines,
      ),
    },
    deepScanner: diagnosticDeepScanner,
    lastSkippedReason,
    lastBatch: deepScanner.lastBatch,
  };
}

export async function __runOptionsFlowScannerOnceForTests(
  symbols: readonly string[],
  input: Partial<OptionsFlowScannerRequest> = {},
) {
  const config = getOptionsFlowRuntimeConfig();
  const lineBudget =
    input.lineBudget ??
    resolveOptionsFlowScannerTickerLineBudget({
      config,
      phaseLineCap: config.scannerLineBudget,
    });
  return optionsFlowScanner.runOnce(symbols, {
    limit: Math.max(
      1,
      Math.min(
        input.limit ?? config.scannerLimit,
        input.lineBudget ?? config.scannerLineBudget,
      ),
    ),
    unusualThreshold: input.unusualThreshold,
    lineBudget,
    phase: input.phase ?? "manual",
    expirationScanCount: input.expirationScanCount,
    strikeCoverage: input.strikeCoverage,
  });
}

export function __setOptionsFlowSessionBlockReasonForTests(
  reason: string | null,
): void {
  optionsFlowSessionBlockReason = reason;
  optionsFlowSessionBlockCheckedAt = Date.now();
}

export function __normalizeOptionsFlowSessionBlockReasonForTests(
  reason: unknown,
): string | null {
  return normalizeOptionsFlowSessionBlockReason(reason);
}

export function __queueOptionsFlowScannerRefreshForTests(input: {
  underlying: string;
  scannerRequest: OptionsFlowScannerRequest;
  phase: string;
}): boolean {
  return queueOptionsFlowScannerRefresh(input);
}

const optionChainCache = new Map<
  string,
  {
    input: IbkrOptionChainInput;
    value: IbkrOptionChainContracts;
    centerPrice: number | null;
    cachedAt: number;
    expiresAt: number;
    staleExpiresAt: number;
  }
>();
const optionChainInFlight = new Map<
  string,
  Promise<IbkrOptionChainContracts>
>();
const optionExpirationCache = new Map<
  string,
  {
    value: IbkrOptionExpirationDates;
    expiresAt: number;
    staleExpiresAt: number;
  }
>();
const optionExpirationInFlight = new Map<
  string,
  Promise<IbkrOptionExpirationDates>
>();
const optionContractResolutionCache = new Map<
  string,
  {
    value: ResolveOptionContractResult;
    expiresAt: number;
  }
>();
const optionUpstreamBackoffUntilByKey = new Map<string, number>();
const flowScannerExpirationRotationOffsets = new Map<string, number>();
const flowScannerContractRotationOffsets = new Map<string, number>();

export function __resetOptionChainCachesForTests(input?: {
  resetFlowScanner?: boolean;
}): void {
  optionChainCache.clear();
  optionChainInFlight.clear();
  optionExpirationCache.clear();
  optionExpirationInFlight.clear();
  optionContractResolutionCache.clear();
  optionUpstreamBackoffUntilByKey.clear();
  optionsFlowAggregateSeedOffset = 0;
  flowScannerExpirationRotationOffsets.clear();
  flowScannerContractRotationOffsets.clear();
  barsCache.clear();
  barsInFlight.clear();
  barsCacheInvalidationVersion = 0;
  chartHistoryCursors.clear();
  Object.keys(barsHydrationCounters).forEach((key) => {
    barsHydrationCounters[key as keyof typeof barsHydrationCounters] = 0;
  });
  resetBarsHydrationBreakdown();
  flowEventsCache.clear();
  flowEventsInFlight.clear();
  historicalFlowCooldowns.clear();
  lastHistoricalFlowCooldownPruneMs = 0;
  flowEventsOnDemandActive = 0;
  liveWarmupBackgroundHoldUntil = 0;
  optionsFlowSessionBlockReason = null;
  optionsFlowSessionBlockCheckedAt = 0;
  __resetHistoricalFlowEventsForTests();
  if (input?.resetFlowScanner !== false) {
    optionsFlowScanner.reset();
    optionsFlowScannerStarted = false;
    flowUniverseManager.reset();
  }
}

export const __platformBarsCacheTestInternals = {
  invalidateBarsCacheForDurableWrite,
  getBarsHydrationCounters: () => ({ ...barsHydrationCounters }),
  getBarsHydrationBreakdown: () => ({
    byFamily: { ...barsHydrationBreakdown.byFamily },
    byPriority: { ...barsHydrationBreakdown.byPriority },
    byPayloadClass: { ...barsHydrationBreakdown.byPayloadClass },
    byFamilyCacheStatus: { ...barsHydrationBreakdown.byFamilyCacheStatus },
  }),
  shouldRefreshStaleBarsInBackground,
  shouldFetchHistoricalSynthesisForRecentCoverage,
  resolveRecentCoverageStaleToleranceMs,
};

export const __platformTickerSearchTestInternals = {
  isTickerLikeSearch,
  shouldUseUniverseCatalogImmediateResponse,
};

export const __platformQuoteSnapshotTestInternals = {
  resetQuoteSnapshotCache() {
    quoteSnapshotCache.clear();
    quoteSnapshotInFlight.clear();
    massiveQuoteDayChangeContextInFlight.clear();
    quoteSnapshotCacheTtlMsForTests = null;
    quoteSnapshotStaleTtlMsForTests = null;
    quoteSnapshotStaleWaitMsForTests = null;
  },
  setQuoteSnapshotCacheWindowsForTests(input: {
    ttlMs?: number | null;
    staleTtlMs?: number | null;
    staleWaitMs?: number | null;
  }) {
    quoteSnapshotCacheTtlMsForTests =
      typeof input.ttlMs === "number" ? Math.max(0, input.ttlMs) : null;
    quoteSnapshotStaleTtlMsForTests =
      typeof input.staleTtlMs === "number"
        ? Math.max(0, input.staleTtlMs)
        : null;
    quoteSnapshotStaleWaitMsForTests =
      typeof input.staleWaitMs === "number"
        ? Math.max(0, input.staleWaitMs)
        : null;
  },
};

function pruneOptionChainCache(now: number): void {
  for (const [key, entry] of optionChainCache) {
    if (entry.staleExpiresAt <= now) {
      optionChainCache.delete(key);
    }
  }
  for (const [key, entry] of optionExpirationCache) {
    if (entry.staleExpiresAt <= now) {
      optionExpirationCache.delete(key);
    }
  }
  for (const [key, entry] of optionContractResolutionCache) {
    if (entry.expiresAt <= now) {
      optionContractResolutionCache.delete(key);
    }
  }

  if (optionChainCache.size <= OPTION_CHAIN_CACHE_MAX_ENTRIES) {
    if (optionExpirationCache.size <= OPTION_CHAIN_CACHE_MAX_ENTRIES) {
      return;
    }
  }

  const overflow = optionChainCache.size - OPTION_CHAIN_CACHE_MAX_ENTRIES;
  let removed = 0;
  for (const key of optionChainCache.keys()) {
    if (removed >= overflow) break;
    optionChainCache.delete(key);
    removed += 1;
  }

  const expirationOverflow =
    optionExpirationCache.size - OPTION_CHAIN_CACHE_MAX_ENTRIES;
  removed = 0;
  for (const key of optionExpirationCache.keys()) {
    if (removed >= expirationOverflow) break;
    optionExpirationCache.delete(key);
    removed += 1;
  }
}

function buildOptionChainCacheKey(input: IbkrOptionChainInput): string {
  const underlyingSpotPrice = normalizeUnderlyingSpotPrice(
    input.underlyingSpotPrice,
  );
  return JSON.stringify({
    underlying: normalizeSymbol(input.underlying),
    expirationDate: input.expirationDate
      ? input.expirationDate.toISOString().slice(0, 10)
      : null,
    contractType: input.contractType ?? null,
    maxExpirations: input.maxExpirations ?? null,
    strikeCoverage: input.strikeCoverage ?? null,
    strikesAroundMoney: input.strikesAroundMoney ?? null,
    underlyingSpotPrice:
      underlyingSpotPrice === null
        ? null
        : Number(underlyingSpotPrice.toFixed(4)),
    quoteHydration: input.quoteHydration ?? "snapshot",
    delayedSnapshotHydration: input.allowDelayedSnapshotHydration !== false,
  });
}

function buildOptionChainScopeKey(input: IbkrOptionChainInput): string {
  const underlyingSpotPrice = normalizeUnderlyingSpotPrice(
    input.underlyingSpotPrice,
  );
  return JSON.stringify({
    underlying: normalizeSymbol(input.underlying),
    expirationDate: input.expirationDate
      ? input.expirationDate.toISOString().slice(0, 10)
      : null,
    contractType: input.contractType ?? null,
    maxExpirations: input.maxExpirations ?? null,
    underlyingSpotPrice:
      underlyingSpotPrice === null
        ? null
        : Number(underlyingSpotPrice.toFixed(4)),
    quoteHydration: input.quoteHydration ?? "snapshot",
    delayedSnapshotHydration: input.allowDelayedSnapshotHydration !== false,
  });
}

function buildOptionExpirationCacheKey(
  input: IbkrOptionExpirationsInput,
): string {
  return JSON.stringify({
    underlying: normalizeSymbol(input.underlying),
    maxExpirations: input.maxExpirations ?? null,
  });
}

function deferredOptionExpirationsResponse(input: {
  requestedAt: number;
  durable: {
    expirations: IbkrOptionExpirationDates;
    debug: RequestDebugMetadata;
  } | null;
  reason: string;
}): {
  expirations: IbkrOptionExpirationDates;
  debug: RequestDebugMetadata;
} {
  if (input.durable?.expirations.length) {
    return {
      expirations: input.durable.expirations,
      debug: {
        ...input.durable.debug,
        totalMs: Math.max(0, Date.now() - input.requestedAt),
        upstreamMs: null,
        stale: true,
        degraded: true,
        reason: input.reason,
      },
    };
  }
  return {
    expirations: [],
    debug: {
      cacheStatus: "miss",
      totalMs: Math.max(0, Date.now() - input.requestedAt),
      upstreamMs: null,
      stale: true,
      degraded: true,
      reason: input.reason,
    },
  };
}

function buildOptionContractResolutionCacheKey(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
}): string {
  return JSON.stringify({
    underlying: normalizeSymbol(input.underlying),
    expirationDate: input.expirationDate.toISOString().slice(0, 10),
    strike: Number(input.strike),
    right: input.right,
  });
}

function findResolvedOptionContractMatch(
  contracts: IbkrOptionChainContracts,
  input: {
    expirationKey: string;
    right: "call" | "put";
    strike: number;
  },
): IbkrOptionChainContracts[number] | null {
  let nearest: IbkrOptionChainContracts[number] | null = null;
  let nearestDistance = Infinity;

  for (const candidate of contracts) {
    const contract = candidate.contract;
    if (
      contract.right !== input.right ||
      contract.expirationDate.toISOString().slice(0, 10) !== input.expirationKey
    ) {
      continue;
    }

    const distance = Math.abs(contract.strike - input.strike);
    if (distance <= OPTION_CONTRACT_STRIKE_EXACT_TOLERANCE) {
      return candidate;
    }
    if (
      distance <= OPTION_CONTRACT_STRIKE_MATCH_TOLERANCE &&
      distance < nearestDistance
    ) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function buildMassiveOptionTicker(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
}): string | null {
  const underlying = normalizeSymbol(input.underlying).replace(
    /[^A-Z0-9]/g,
    "",
  );
  if (!underlying || !Number.isFinite(input.strike) || input.strike <= 0) {
    return null;
  }

  const expiration = input.expirationDate;
  if (Number.isNaN(expiration.getTime())) {
    return null;
  }

  const yy = String(expiration.getUTCFullYear()).slice(-2);
  const mm = String(expiration.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expiration.getUTCDate()).padStart(2, "0");
  const side = input.right === "put" ? "P" : "C";
  const strike = String(Math.round(input.strike * 1000)).padStart(8, "0");
  return `O:${underlying}${yy}${mm}${dd}${side}${strike}`;
}

function normalizeMassiveOptionTicker(value: unknown): string | null {
  const normalized =
    typeof value === "string"
      ? value.trim().toUpperCase().replace(/\s+/g, "")
      : "";
  if (!normalized) {
    return null;
  }

  const ticker = normalized.startsWith("O:") ? normalized : `O:${normalized}`;
  return /^O:[A-Z0-9.-]+\d{6}[CP]\d{8}$/.test(ticker) ? ticker : null;
}

function mapMassiveOptionBarsToBrokerBars(input: {
  bars: MassiveBarSnapshot[];
  providerContractId: string | null;
  delayed: boolean;
  outsideRth: boolean;
}): BrokerBarSnapshot[] {
  return input.bars.map((bar) => ({
    timestamp: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    source: "massive-option-aggregates",
    providerContractId: input.providerContractId,
    outsideRth: input.outsideRth,
    partial: false,
    transport: "tws",
    delayed: input.delayed,
    freshness: input.delayed ? "delayed" : "live",
    marketDataMode: input.delayed ? "delayed" : "live",
    dataUpdatedAt: bar.timestamp,
    ageMs: getAgeMs(bar.timestamp),
  }));
}

function optionBarsHavePositiveVolume(
  bars: readonly BrokerBarSnapshot[],
): boolean {
  return bars.some((bar) => Number.isFinite(bar.volume) && bar.volume > 0);
}

function barTimestampMs(bar: {
  timestamp: Date | string | number;
}): number | null {
  const value =
    bar.timestamp instanceof Date
      ? bar.timestamp.getTime()
      : new Date(bar.timestamp).getTime();
  return Number.isFinite(value) ? value : null;
}

type OptionChartMassiveBarsResult = {
  bars: BrokerBarSnapshot[];
  page: MassiveAggregateBarsPage;
  cursorSignature: string;
  cursorExhausted: boolean;
};

function mergeIbkrAndMassiveOptionBars(input: {
  ibkrBars: readonly BrokerBarSnapshot[];
  massiveBars: readonly BrokerBarSnapshot[];
  limit?: number;
}): { bars: BrokerBarSnapshot[]; gapFilled: boolean } {
  if (!input.massiveBars.length) {
    return {
      bars: input.ibkrBars.map(decorateIbkrHistoryBar),
      gapFilled: false,
    };
  }

  const desiredBars = Math.max(
    input.limit ?? Math.max(input.ibkrBars.length, input.massiveBars.length),
    1,
  );
  const massiveByTimestamp = new Map<number, BrokerBarSnapshot>();
  input.massiveBars.forEach((bar) => {
    const timestampMs = barTimestampMs(bar);
    if (timestampMs !== null) {
      massiveByTimestamp.set(timestampMs, bar);
    }
  });

  const merged = new Map<number, BrokerBarSnapshot>();
  input.massiveBars.forEach((bar) => {
    const timestampMs = barTimestampMs(bar);
    if (timestampMs !== null) {
      merged.set(timestampMs, bar);
    }
  });
  input.ibkrBars.forEach((bar) => {
    const timestampMs = barTimestampMs(bar);
    if (timestampMs === null) {
      return;
    }
    const massiveBar = massiveByTimestamp.get(timestampMs);
    const massiveVolume = massiveBar?.volume;
    const shouldUseMassiveVolume =
      (!Number.isFinite(bar.volume) || bar.volume <= 0) &&
      Number.isFinite(massiveVolume) &&
      (massiveVolume ?? 0) > 0;
    const volume =
      shouldUseMassiveVolume && massiveVolume !== undefined
        ? massiveVolume
        : bar.volume;
    merged.set(timestampMs, {
      ...decorateIbkrHistoryBar(bar),
      volume,
    });
  });

  const bars = Array.from(merged.values())
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
    .slice(-desiredBars);
  return {
    bars,
    gapFilled: bars.some((bar) => bar.source === "massive-option-aggregates"),
  };
}

function shouldFetchMassiveOptionBarsForIbkrResult(input: {
  bars: readonly BrokerBarSnapshot[];
  timeframe: GetBarsInput["timeframe"];
  limit?: number;
  from?: Date;
  to?: Date;
}): boolean {
  if (!input.bars.length) {
    return false;
  }
  const desiredBars = Math.max(input.limit ?? DEFAULT_BARS_LIMIT, 1);
  if (input.bars.length < desiredBars) {
    return true;
  }
  if (!optionBarsHavePositiveVolume(input.bars)) {
    return true;
  }

  const stepMs = BAR_TIMEFRAME_MS[input.timeframe] ?? 0;
  if (!stepMs) {
    return false;
  }
  const oldestMs = resolveBrokerBarTimestampMs(getOldestBar(input.bars));
  const newestMs = resolveNewestBarTimestampMs(input.bars);
  const toleranceMs = Math.max(stepMs * 2, 1_000);
  if (
    input.from &&
    oldestMs !== null &&
    oldestMs - input.from.getTime() > toleranceMs
  ) {
    return true;
  }
  if (
    input.to &&
    newestMs !== null &&
    input.to.getTime() - newestMs > toleranceMs
  ) {
    return true;
  }

  return false;
}

function shouldPreferReferenceOptionHistory(input: {
  to?: Date;
  nowMs?: number;
}): boolean {
  const toMs = input.to?.getTime();
  if (!Number.isFinite(toMs)) {
    return false;
  }
  return (
    (input.nowMs ?? Date.now()) - (toMs as number) >=
    OPTION_HISTORY_REFERENCE_PROVIDER_FRESH_MS
  );
}

async function fetchOptionChartMassiveBars(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  optionTicker: string;
  providerContractId: string | null;
  timeframe: GetBarsInput["timeframe"];
  limit?: number;
  from?: Date;
  to?: Date;
  historyCursor?: string | null;
  preferCursor?: boolean;
  outsideRth: boolean;
  delayed: boolean;
}): Promise<OptionChartMassiveBarsResult> {
  const aggregateBaseTimeframe = getBaseBarsTimeframe(input.timeframe);
  const aggregateBaseLimit = expandBarsLimitForBaseTimeframe({
    limit: input.limit ?? DEFAULT_BARS_LIMIT,
    timeframe: input.timeframe,
    baseTimeframe: aggregateBaseTimeframe,
  });
  const cursorSignature = buildOptionChartHistoryCursorSignature({
    underlying: input.underlying,
    expirationDate: input.expirationDate,
    strike: input.strike,
    right: input.right,
    optionTicker: input.optionTicker,
    providerContractId: input.providerContractId,
    timeframe: aggregateBaseTimeframe,
    outsideRth: input.outsideRth,
  });
  const cursorResolution = input.preferCursor
    ? resolveChartHistoryCursor({
        token: input.historyCursor,
        signature: cursorSignature,
      })
    : ({ ok: false, reason: "missing" } as const);
  let massivePage: MassiveAggregateBarsPage | null = null;
  let attemptedCursorContinuation = false;
  let usedCursorContinuation = false;
  if (cursorResolution.ok) {
    attemptedCursorContinuation = true;
    massivePage = await resolveWithin(
      fetchMassiveBarsProviderCursorPage(getMassiveClient(), {
        symbol: input.optionTicker,
        timeframe: aggregateBaseTimeframe,
        limit: aggregateBaseLimit,
        providerNextUrl: cursorResolution.providerNextUrl,
      }).catch(() => null),
      BARS_PROVIDER_BUDGET_MS,
      null,
    );
    usedCursorContinuation = Boolean(massivePage);
  }
  if (!massivePage) {
    if (
      attemptedCursorContinuation ||
      (input.preferCursor && input.historyCursor)
    ) {
      barsHydrationCounters.cursorFallback += 1;
    }
    massivePage = await fetchMassiveOptionBarsPage(getMassiveClient(), {
      optionTicker: input.optionTicker,
      timeframe: aggregateBaseTimeframe,
      limit: aggregateBaseLimit,
      from: input.from,
      to: input.to,
    });
  }
  barsHydrationCounters.providerFetch += 1;
  barsHydrationCounters.providerPage += massivePage.pageCount;
  if (usedCursorContinuation) {
    barsHydrationCounters.cursorContinuation += 1;
  }
  const baseBars = mapMassiveOptionBarsToBrokerBars({
    bars: massivePage.bars,
    providerContractId: input.providerContractId,
    delayed: input.delayed,
    outsideRth: input.outsideRth,
  });
  const bars =
    aggregateBaseTimeframe === input.timeframe
      ? baseBars
      : normalizeBarsToStoreTimeframe(baseBars, input.timeframe).slice(
          -(input.limit ?? DEFAULT_BARS_LIMIT),
        );
  return {
    bars,
    page: massivePage,
    cursorSignature,
    cursorExhausted:
      usedCursorContinuation &&
      massivePage.bars.length === 0 &&
      !massivePage.nextUrl,
  };
}

async function tryFetchOptionChartMassiveBars(
  input: Parameters<typeof fetchOptionChartMassiveBars>[0],
): Promise<OptionChartMassiveBarsResult | null> {
  try {
    return await fetchOptionChartMassiveBars(input);
  } catch {
    return null;
  }
}

function mergeMassiveOptionSnapshotIntoIbkrContract(
  contract: IbkrOptionChainContracts[number],
  snapshot: MassiveOptionChainContract,
  delayed: boolean,
): IbkrOptionChainContracts[number] {
  const updatedAt = snapshot.updatedAt;
  return {
    ...contract,
    bid: snapshot.bid,
    ask: snapshot.ask,
    last: snapshot.last,
    mark: snapshot.mark,
    impliedVolatility: snapshot.impliedVolatility,
    delta: snapshot.delta,
    gamma: snapshot.gamma,
    theta: snapshot.theta,
    vega: snapshot.vega,
    openInterest: snapshot.openInterest,
    volume: snapshot.volume,
    updatedAt,
    quoteFreshness: delayed ? "delayed" : "live",
    marketDataMode: delayed ? "delayed" : "live",
    quoteUpdatedAt: updatedAt,
    dataUpdatedAt: updatedAt,
    ageMs: getAgeMs(updatedAt),
  };
}

async function hydrateOptionChainWithMassiveSnapshots(input: {
  request: IbkrOptionChainInput;
  contracts: IbkrOptionChainContracts;
}): Promise<IbkrOptionChainContracts> {
  const massiveConfig = getMassiveRuntimeConfig();
  if (!massiveConfig || input.contracts.length === 0) {
    return input.contracts;
  }

  try {
    const snapshots = await getMassiveClient().getOptionChain({
      underlying: input.request.underlying,
      expirationDate: input.request.expirationDate,
      contractType: input.request.contractType,
    });
    const byTicker = new Map(
      snapshots.map((snapshot) => [
        normalizeMassiveOptionTicker(snapshot.contract.ticker),
        snapshot,
      ]),
    );
    const delayed = massiveConfig.baseUrl.includes("massive.com");
    return input.contracts.map((contract) => {
      const massiveTicker = buildMassiveOptionTicker({
        underlying: contract.contract.underlying,
        expirationDate: contract.contract.expirationDate,
        strike: contract.contract.strike,
        right: contract.contract.right,
      });
      const snapshot = massiveTicker ? byTicker.get(massiveTicker) : null;
      return snapshot
        ? mergeMassiveOptionSnapshotIntoIbkrContract(
            contract,
            snapshot,
            delayed,
          )
        : contract;
    });
  } catch (error) {
    logger.debug(
      { err: error, underlying: input.request.underlying },
      "Massive option-chain snapshot hydration failed",
    );
    return input.contracts;
  }
}

function isIbkrOptionHistoryFeedIssue(input: {
  barsResult: GetBarsResult | null;
  error: unknown;
}): boolean {
  if (input.error) {
    return true;
  }

  const emptyReason = input.barsResult?.emptyReason ?? null;
  return emptyReason === "broker-history-error";
}

function normalizePublicOptionChainStrikeWindow(
  value: number | undefined,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return OPTION_CHAIN_STRIKES_AROUND_MONEY;
  }

  return Math.min(
    OPTION_CHAIN_PUBLIC_MAX_STRIKES_AROUND_MONEY,
    Math.max(1, Math.floor(value)),
  );
}

function normalizePublicOptionChainStrikeSelection(input: {
  strikeCoverage?: OptionChainStrikeCoverage;
  strikesAroundMoney?: number;
}): {
  strikeCoverage?: OptionChainStrikeCoverage;
  strikesAroundMoney?: number;
} {
  if (input.strikeCoverage === "full") {
    return {
      strikeCoverage: "full",
      strikesAroundMoney: undefined,
    };
  }

  if (typeof input.strikesAroundMoney === "number") {
    return {
      strikeCoverage: input.strikeCoverage,
      strikesAroundMoney: normalizePublicOptionChainStrikeWindow(
        input.strikesAroundMoney,
      ),
    };
  }

  if (input.strikeCoverage === "fast") {
    return {
      strikeCoverage: "fast",
      strikesAroundMoney: OPTION_CHAIN_FAST_STRIKES_AROUND_MONEY,
    };
  }

  return {
    strikeCoverage: input.strikeCoverage ?? "standard",
    strikesAroundMoney: OPTION_CHAIN_STRIKES_AROUND_MONEY,
  };
}

function normalizePublicOptionChainQuoteHydration(
  value: OptionChainQuoteHydration | undefined,
): OptionChainQuoteHydration {
  return value === "metadata" ? "metadata" : "snapshot";
}

function normalizeUnderlyingSpotPrice(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeIbkrOptionChainInput(
  input: IbkrOptionChainInput,
): IbkrOptionChainInput {
  return {
    ...input,
    ...normalizePublicOptionChainStrikeSelection(input),
    quoteHydration: normalizePublicOptionChainQuoteHydration(
      input.quoteHydration,
    ),
    underlyingSpotPrice: normalizeUnderlyingSpotPrice(
      input.underlyingSpotPrice,
    ),
    allowDelayedSnapshotHydration:
      input.allowDelayedSnapshotHydration !== false,
  };
}

function resolveOptionChainCacheWindows(input: IbkrOptionChainInput): {
  ttlMs: number;
  staleTtlMs: number;
} {
  if (input.quoteHydration === "metadata") {
    return {
      ttlMs: OPTION_CHAIN_METADATA_CACHE_TTL_MS,
      staleTtlMs: Math.max(
        OPTION_CHAIN_METADATA_CACHE_TTL_MS,
        OPTION_CHAIN_METADATA_STALE_TTL_MS,
      ),
    };
  }

  return {
    ttlMs: OPTION_CHAIN_CACHE_TTL_MS,
    staleTtlMs: Math.max(
      OPTION_CHAIN_CACHE_TTL_MS,
      OPTION_CHAIN_CACHE_STALE_TTL_MS,
    ),
  };
}

function getOptionChainStrikeWindow(input: IbkrOptionChainInput): number {
  if (input.strikeCoverage === "full") {
    return Number.POSITIVE_INFINITY;
  }

  return (
    normalizePublicOptionChainStrikeSelection(input).strikesAroundMoney ??
    OPTION_CHAIN_STRIKES_AROUND_MONEY
  );
}

function isOptionChainCacheSuperset(
  cachedInput: IbkrOptionChainInput,
  requestedInput: IbkrOptionChainInput,
): boolean {
  if (
    buildOptionChainScopeKey(cachedInput) !==
    buildOptionChainScopeKey(requestedInput)
  ) {
    return false;
  }

  if (requestedInput.strikeCoverage === "full") {
    return cachedInput.strikeCoverage === "full";
  }

  return (
    cachedInput.strikeCoverage === "full" ||
    getOptionChainStrikeWindow(cachedInput) >=
      getOptionChainStrikeWindow(requestedInput)
  );
}

function readOptionChainUnderlyingPrice(
  contracts: IbkrOptionChainContracts,
): number | null {
  const prices = contracts
    .map((contract) =>
      typeof contract.underlyingPrice === "number" &&
      Number.isFinite(contract.underlyingPrice) &&
      contract.underlyingPrice > 0
        ? contract.underlyingPrice
        : null,
    )
    .filter((price): price is number => price !== null);

  if (!prices.length) {
    return null;
  }

  return prices[Math.floor((prices.length - 1) / 2)];
}

async function fetchMassiveStockSpotPrice(
  symbol: string,
): Promise<number | null> {
  if (!isMassiveStocksRealtimeConfigured()) {
    return null;
  }
  const normalized = normalizeSymbol(symbol);
  if (!normalized) {
    return null;
  }
  const payload = await getQuoteSnapshots({ symbols: normalized }).catch(
    (): QuoteSnapshotsServiceResponse => ({
      quotes: [],
      transport: null,
      delayed: false,
      fallbackUsed: false,
    }),
  );
  const quote = payload.quotes.find(
    (candidate) => normalizeSymbol(candidate.symbol) === normalized,
  );
  const price =
    typeof quote?.price === "number" &&
    Number.isFinite(quote.price) &&
    quote.price > 0
      ? quote.price
      : typeof quote?.bid === "number" &&
          typeof quote?.ask === "number" &&
          Number.isFinite(quote.bid) &&
          Number.isFinite(quote.ask) &&
          quote.bid > 0 &&
          quote.ask > 0
        ? (quote.bid + quote.ask) / 2
        : null;
  return price;
}

function deriveOptionChainQuotedCenterStrike(
  contracts: IbkrOptionChainContracts,
): number | null {
  const byStrike = new Map<
    number,
    { call: number | null; put: number | null }
  >();

  contracts.forEach((contract) => {
    const strike = contract.contract.strike;
    if (!Number.isFinite(strike)) {
      return;
    }
    const entry = byStrike.get(strike) ?? { call: null, put: null };
    const mark =
      contract.mark != null && contract.mark > 0
        ? contract.mark
        : contract.last != null && contract.last > 0
          ? contract.last
          : contract.bid != null &&
              contract.ask != null &&
              contract.bid > 0 &&
              contract.ask > 0
            ? (contract.bid + contract.ask) / 2
            : null;
    if (contract.contract.right === "call") {
      entry.call = mark;
    } else {
      entry.put = mark;
    }
    byStrike.set(strike, entry);
  });

  const quotedPairs = Array.from(byStrike.entries())
    .map(([strike, entry]) =>
      entry.call !== null && entry.put !== null
        ? { strike, score: Math.abs(entry.call - entry.put) }
        : null,
    )
    .filter((entry): entry is { strike: number; score: number } =>
      Boolean(entry),
    )
    .sort(
      (left, right) => left.score - right.score || left.strike - right.strike,
    );

  if (quotedPairs[0]) {
    return quotedPairs[0].strike;
  }

  return null;
}

function deriveOptionChainMedianStrike(
  contracts: IbkrOptionChainContracts,
): number | null {
  const strikes = Array.from(
    new Set(
      contracts
        .map((contract) => contract.contract.strike)
        .filter((strike) => Number.isFinite(strike)),
    ),
  ).sort((left, right) => left - right);
  return strikes.length ? strikes[Math.floor((strikes.length - 1) / 2)] : null;
}

function deriveOptionChainCenterPrice(
  contracts: IbkrOptionChainContracts,
): number | null {
  return (
    readOptionChainUnderlyingPrice(contracts) ??
    deriveOptionChainQuotedCenterStrike(contracts) ??
    deriveOptionChainMedianStrike(contracts)
  );
}

function deriveOptionChainCenterStrike(
  contracts: IbkrOptionChainContracts,
  preferredCenterPrice?: number | null,
): number | null {
  if (
    typeof preferredCenterPrice === "number" &&
    Number.isFinite(preferredCenterPrice) &&
    preferredCenterPrice > 0
  ) {
    return preferredCenterPrice;
  }

  const quotedCenterStrike = deriveOptionChainQuotedCenterStrike(contracts);
  if (quotedCenterStrike !== null) {
    return quotedCenterStrike;
  }

  return deriveOptionChainMedianStrike(contracts);
}

function sliceOptionChainContractsForRequest(
  contracts: IbkrOptionChainContracts,
  input: IbkrOptionChainInput,
  options: {
    centerPrice?: number | null;
  } = {},
): IbkrOptionChainContracts {
  let filtered = contracts.filter((contract) => {
    if (
      input.expirationDate &&
      contract.contract.expirationDate.toISOString().slice(0, 10) !==
        input.expirationDate.toISOString().slice(0, 10)
    ) {
      return false;
    }

    return (
      !input.contractType || contract.contract.right === input.contractType
    );
  });

  if (input.strikeCoverage !== "full") {
    const strikesAroundMoney = getOptionChainStrikeWindow(input);
    if (Number.isFinite(strikesAroundMoney)) {
      const strikes = Array.from(
        new Set(
          filtered
            .map((contract) => contract.contract.strike)
            .filter((strike) => Number.isFinite(strike)),
        ),
      ).sort((left, right) => left - right);
      const maxStrikeCount = strikesAroundMoney * 2 + 1;

      if (strikes.length > maxStrikeCount) {
        const centerStrike = deriveOptionChainCenterStrike(
          filtered,
          options.centerPrice,
        );
        const closestIndex =
          centerStrike === null
            ? Math.floor((strikes.length - 1) / 2)
            : strikes.reduce(
                (bestIndex, strike, index) =>
                  Math.abs(strike - centerStrike) <
                  Math.abs(strikes[bestIndex] - centerStrike)
                    ? index
                    : bestIndex,
                0,
              );
        const start = Math.max(0, closestIndex - strikesAroundMoney);
        const end = Math.min(
          strikes.length,
          closestIndex + strikesAroundMoney + 1,
        );
        const allowedStrikes = new Set(strikes.slice(start, end));
        filtered = filtered.filter((contract) =>
          allowedStrikes.has(contract.contract.strike),
        );
      }
    }
  }

  return filtered.sort(
    (left, right) =>
      left.contract.expirationDate.getTime() -
        right.contract.expirationDate.getTime() ||
      left.contract.strike - right.contract.strike ||
      left.contract.right.localeCompare(right.contract.right),
  );
}

function isUnderlyingResolutionError(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }

  if (error.code === "ibkr_contract_not_found") {
    return true;
  }

  if (error.code !== "upstream_http_error") {
    return false;
  }

  const data = error.data;
  return Boolean(
    data &&
      typeof data === "object" &&
      "code" in data &&
      (data as { code?: unknown }).code === "ibkr_contract_not_found",
  );
}

function isTransientOptionUpstreamError(error: unknown): boolean {
  if (!(error instanceof HttpError)) {
    return false;
  }

  if (
    error.code === "ibkr_bridge_request_timeout" ||
    error.code === "ibkr_bridge_health_timeout" ||
    error.code === "upstream_request_failed"
  ) {
    return true;
  }

  if (error.code !== "upstream_http_error") {
    return false;
  }

  return error.statusCode >= 500 || error.statusCode === 429;
}

function getOptionBackoffKey(
  kind: "chain" | "expiration",
  key: string,
): string {
  return `${kind}:${key}`;
}

function isOptionUpstreamBackedOff(
  kind: "chain" | "expiration",
  key: string,
): boolean {
  return getOptionUpstreamBackoffRemainingMs(kind, key) > 0;
}

function getOptionUpstreamBackoffRemainingMs(
  kind: "chain" | "expiration",
  key: string,
): number {
  const until = optionUpstreamBackoffUntilByKey.get(
    getOptionBackoffKey(kind, key),
  );
  if (!until) {
    return 0;
  }
  if (until <= Date.now()) {
    optionUpstreamBackoffUntilByKey.delete(getOptionBackoffKey(kind, key));
    return 0;
  }
  return Math.max(0, until - Date.now());
}

function recordOptionUpstreamBackoff(
  kind: "chain" | "expiration",
  key: string,
  error: unknown,
): void {
  if (!isTransientOptionUpstreamError(error)) {
    return;
  }

  optionUpstreamBackoffUntilByKey.set(
    getOptionBackoffKey(kind, key),
    Date.now() + getOptionsFlowRuntimeConfig().optionUpstreamBackoffMs,
  );
}

function recordOptionDegradedEvent(input: {
  kind: "chain" | "expiration";
  underlying: string;
  reason: string;
  message: string;
  expirationDate?: Date | null;
  detail?: string | null;
}): void {
  void recordServerDiagnosticEvent({
    subsystem: "market-data",
    category: "options",
    code: input.reason,
    severity: "warning",
    message: input.message,
    dimensions: {
      kind: input.kind,
      underlying: input.underlying,
      expirationDate: input.expirationDate?.toISOString().slice(0, 10) ?? null,
    },
    raw: {
      detail: input.detail ?? null,
    },
  }).catch(() => {});
}

function formatOptionChainBatchError(error: unknown): string {
  if (error instanceof HttpError) {
    return error.message || error.detail || "Option chain request failed.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Option chain request failed.";
}

function optionRequestAbortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new Error("Option metadata request aborted.");
}

function throwIfOptionRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw optionRequestAbortReason(signal);
  }
}

function waitForOptionChainRetry(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(optionRequestAbortReason(signal));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let cleanup = () => {};
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      cleanup();
      reject(optionRequestAbortReason(signal));
    };
    cleanup = () => {
      signal?.removeEventListener("abort", abort);
    };
    timeout = setTimeout(finish, ms);
    timeout.unref?.();
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function normalizeOptionForegroundWaitMs(
  value: number | null | undefined,
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

function optionForegroundTimeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve("timeout"), ms);
    timeout.unref?.();
  });
}

function optionChainCacheInput(
  input: IbkrOptionChainInput,
): IbkrOptionChainInput {
  const {
    signal: _signal,
    emptyRetryDelaysMs: _emptyRetryDelaysMs,
    ...cacheInput
  } = input;
  return cacheInput;
}

function shouldRetryEmptyOptionChain(input: IbkrOptionChainInput): boolean {
  return Boolean(input.expirationDate);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(values.length, Math.max(1, concurrency));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    }),
  );

  return results;
}

async function getCachedIbkrOptionChain(
  input: IbkrOptionChainInput,
): Promise<IbkrOptionChainContracts> {
  const { contracts } = await getCachedIbkrOptionChainWithDebug(input);
  return contracts;
}

function seedOptionChainCache(input: {
  key: string;
  cacheInput: IbkrOptionChainInput;
  contracts: IbkrOptionChainContracts;
  cachedAt: number;
  expiresAt: number;
  staleExpiresAt: number;
}): void {
  if (!input.contracts.length) {
    return;
  }

  optionChainCache.set(input.key, {
    input: optionChainCacheInput(input.cacheInput),
    value: input.contracts,
    centerPrice: deriveOptionChainCenterPrice(input.contracts),
    cachedAt: input.cachedAt,
    expiresAt: input.expiresAt,
    staleExpiresAt: input.staleExpiresAt,
  });
  pruneOptionChainCache(Date.now());
}

async function loadDurableOptionChainForRequest(input: {
  key: string;
  normalizedInput: IbkrOptionChainInput;
  requestedAt: number;
}): Promise<{
  contracts: IbkrOptionChainContracts;
  debug: RequestDebugMetadata;
} | null> {
  if (input.normalizedInput.quoteHydration !== "metadata") {
    return null;
  }

  const cacheWindows = resolveOptionChainCacheWindows(input.normalizedInput);
  const durable = await loadDurableOptionChain({
    underlying: input.normalizedInput.underlying,
    expirationDate: input.normalizedInput.expirationDate,
    contractType: input.normalizedInput.contractType,
    maxExpirations: input.normalizedInput.maxExpirations,
    maxAgeMs: cacheWindows.ttlMs,
    staleMaxAgeMs: cacheWindows.staleTtlMs,
  });
  if (!durable?.value.length) {
    return null;
  }

  const centerPrice = deriveOptionChainCenterPrice(durable.value);
  const contracts = sliceOptionChainContractsForRequest(
    durable.value,
    input.normalizedInput,
    { centerPrice },
  );
  if (!contracts.length) {
    return null;
  }

  const now = Date.now();
  const cachedAt =
    typeof durable.ageMs === "number" && Number.isFinite(durable.ageMs)
      ? Math.max(0, now - durable.ageMs)
      : now;
  seedOptionChainCache({
    key: input.key,
    cacheInput: input.normalizedInput,
    contracts,
    cachedAt,
    expiresAt: cachedAt + cacheWindows.ttlMs,
    staleExpiresAt: cachedAt + cacheWindows.staleTtlMs,
  });

  return {
    contracts,
    debug: {
      cacheStatus: "hit",
      totalMs: Math.max(0, Date.now() - input.requestedAt),
      upstreamMs: null,
      stale: durable.freshness === "stale",
      ageMs: durable.ageMs,
      reason: "durable_option_chain",
    },
  };
}

async function getCachedIbkrOptionChainWithDebug(
  input: IbkrOptionChainInput,
): Promise<{
  contracts: IbkrOptionChainContracts;
  debug: RequestDebugMetadata;
}> {
  throwIfOptionRequestAborted(input.signal);
  const normalizedInput = normalizeIbkrOptionChainInput(input);
  const key = buildOptionChainCacheKey(normalizedInput);
  const requestedAt = Date.now();
  const cached = optionChainCache.get(key);

  if (cached && cached.expiresAt > requestedAt) {
    return {
      contracts: cached.value,
      debug: {
        cacheStatus: "hit",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        ageMs: Number.isFinite(cached.cachedAt)
          ? Math.max(0, requestedAt - cached.cachedAt)
          : null,
      },
    };
  }

  const inFlight = optionChainInFlight.get(key);
  if (cached && cached.staleExpiresAt > requestedAt) {
    if (!inFlight) {
      refreshOptionChainCache(
        key,
        optionChainCacheInput(normalizedInput),
      ).catch(() => {});
    }
    return {
      contracts: cached.value,
      debug: {
        cacheStatus: "hit",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        stale: true,
        ageMs: Number.isFinite(cached.cachedAt)
          ? Math.max(0, requestedAt - cached.cachedAt)
          : null,
      },
    };
  }
  if (cached && isOptionUpstreamBackedOff("chain", key)) {
    return {
      contracts: sliceOptionChainContractsForRequest(
        cached.value,
        normalizedInput,
        { centerPrice: cached.centerPrice },
      ),
      debug: {
        cacheStatus: "hit",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        stale: true,
        ageMs: Number.isFinite(cached.cachedAt)
          ? Math.max(0, requestedAt - cached.cachedAt)
          : null,
      },
    };
  }

  for (const [cachedKey, reusable] of optionChainCache) {
    if (cachedKey === key) {
      continue;
    }
    if (reusable.staleExpiresAt <= requestedAt) {
      optionChainCache.delete(cachedKey);
      continue;
    }
    if (!isOptionChainCacheSuperset(reusable.input, normalizedInput)) {
      continue;
    }

    if (reusable.expiresAt > requestedAt) {
      return {
        contracts: sliceOptionChainContractsForRequest(
          reusable.value,
          normalizedInput,
          { centerPrice: reusable.centerPrice },
        ),
        debug: {
          cacheStatus: "hit",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: null,
          ageMs: Number.isFinite(reusable.cachedAt)
            ? Math.max(0, requestedAt - reusable.cachedAt)
            : null,
        },
      };
    }

    if (!optionChainInFlight.has(cachedKey)) {
      refreshOptionChainCache(cachedKey, reusable.input).catch(() => {});
    }
    return {
      contracts: sliceOptionChainContractsForRequest(
        reusable.value,
        normalizedInput,
        { centerPrice: reusable.centerPrice },
      ),
      debug: {
        cacheStatus: "hit",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        stale: true,
        ageMs: Number.isFinite(reusable.cachedAt)
          ? Math.max(0, requestedAt - reusable.cachedAt)
          : null,
      },
    };
  }

  const durable = await loadDurableOptionChainForRequest({
    key,
    normalizedInput,
    requestedAt,
  });
  if (durable && durable.debug.stale !== true) {
    return durable;
  }
  const optionChainBackoffRemainingMs = getOptionUpstreamBackoffRemainingMs(
    "chain",
    key,
  );
  if (
    !normalizedInput.bypassBridgeBackoff &&
    optionChainBackoffRemainingMs > 0
  ) {
    return (
      durable ?? {
        contracts: [],
        debug: {
          cacheStatus: "miss",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: null,
          stale: true,
          degraded: true,
          reason: "options_backoff",
          backoffRemainingMs: optionChainBackoffRemainingMs,
        },
      }
    );
  }

  if (
    !cached &&
    !normalizedInput.bypassBridgeBackoff &&
    isBridgeWorkBackedOff("options")
  ) {
    return (
      durable ?? {
        contracts: [],
        debug: {
          cacheStatus: "miss",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: null,
          stale: true,
          degraded: true,
          reason: "options_backoff",
          backoffRemainingMs: getBridgeBackoffRemainingMs("options"),
        },
      }
    );
  }

  if (inFlight) {
    try {
      const contracts = await inFlight;
      return {
        contracts,
        debug: {
          cacheStatus: "inflight",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: null,
        },
      };
    } catch (error) {
      recordOptionUpstreamBackoff("chain", key, error);
      if (cached && isTransientOptionUpstreamError(error)) {
        return {
          contracts: sliceOptionChainContractsForRequest(
            cached.value,
            normalizedInput,
            { centerPrice: cached.centerPrice },
          ),
          debug: {
            cacheStatus: "hit",
            totalMs: Math.max(0, Date.now() - requestedAt),
            upstreamMs: null,
            stale: true,
            ageMs: Number.isFinite(cached.cachedAt)
              ? Math.max(0, requestedAt - cached.cachedAt)
              : null,
          },
        };
      }
      if (durable && isTransientOptionUpstreamError(error)) {
        return {
          contracts: durable.contracts,
          debug: {
            ...durable.debug,
            stale: true,
            degraded: true,
            reason: "durable_option_chain_after_upstream_failure",
          },
        };
      }
      throw error;
    }
  }

  const upstreamStartedAt = Date.now();
  let contracts: IbkrOptionChainContracts;
  try {
    contracts = await refreshOptionChainCache(key, normalizedInput);
  } catch (error) {
    recordOptionUpstreamBackoff("chain", key, error);
    if (cached && isTransientOptionUpstreamError(error)) {
      return {
        contracts: sliceOptionChainContractsForRequest(
          cached.value,
          normalizedInput,
          { centerPrice: cached.centerPrice },
        ),
        debug: {
          cacheStatus: "hit",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
          stale: true,
          ageMs: Number.isFinite(cached.cachedAt)
            ? Math.max(0, requestedAt - cached.cachedAt)
            : null,
        },
      };
    }
    if (durable && isTransientOptionUpstreamError(error)) {
      return {
        contracts: durable.contracts,
        debug: {
          ...durable.debug,
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
          stale: true,
          degraded: true,
          reason: "durable_option_chain_after_upstream_failure",
        },
      };
    }
    throw error;
  }

  return {
    contracts,
    debug: {
      cacheStatus: "miss",
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
    },
  };
}

function refreshOptionChainCache(
  key: string,
  input: IbkrOptionChainInput,
): Promise<IbkrOptionChainContracts> {
  const existing = optionChainInFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const bridgeWorkOptions = {
        bypassBackoff: input.bypassBridgeBackoff === true,
        recordFailure: input.recordBridgeFailure !== false,
        signal: input.signal,
      };
      let ibkrValue = await runBridgeWork(
        "options",
        () => getIbkrClient().getOptionChain(input),
        bridgeWorkOptions,
      );
      const emptyRetryDelaysMs =
        input.emptyRetryDelaysMs ?? OPTION_CHAIN_EMPTY_RETRY_DELAYS_MS;
      if (!ibkrValue.length && shouldRetryEmptyOptionChain(input)) {
        for (const delayMs of emptyRetryDelaysMs) {
          await waitForOptionChainRetry(delayMs, input.signal);
          ibkrValue = await runBridgeWork(
            "options",
            () => getIbkrClient().getOptionChain(input),
            bridgeWorkOptions,
          );
          if (ibkrValue.length) {
            break;
          }
        }
      }
      const value =
        input.quoteHydration === "metadata" &&
        input.allowDelayedSnapshotHydration !== false
          ? await hydrateOptionChainWithMassiveSnapshots({
              request: input,
              contracts: ibkrValue,
            })
          : ibkrValue;
      const settledAt = Date.now();
      if (value.length > 0) {
        const cacheWindows = resolveOptionChainCacheWindows(input);
        seedOptionChainCache({
          key,
          cacheInput: input,
          contracts: value,
          cachedAt: settledAt,
          expiresAt: settledAt + cacheWindows.ttlMs,
          staleExpiresAt: settledAt + cacheWindows.staleTtlMs,
        });
        void persistDurableOptionChain({
          contracts: value,
          source:
            input.quoteHydration === "metadata"
              ? "ibkr-metadata"
              : "ibkr-snapshot",
          asOf: new Date(settledAt),
        });
      } else if (!optionChainCache.has(key)) {
        optionChainCache.delete(key);
      }
      return value;
    } finally {
      optionChainInFlight.delete(key);
    }
  })();

  optionChainInFlight.set(key, promise);
  return promise;
}

function seedOptionExpirationCache(input: {
  key: string;
  expirations: IbkrOptionExpirationDates;
  cachedAt: number;
  expiresAt: number;
  staleExpiresAt: number;
}): void {
  if (!input.expirations.length) {
    return;
  }

  optionExpirationCache.set(input.key, {
    value: input.expirations,
    expiresAt: input.expiresAt,
    staleExpiresAt: input.staleExpiresAt,
  });
  pruneOptionChainCache(Date.now());
}

async function loadDurableOptionExpirationsForRequest(input: {
  key: string;
  request: IbkrOptionExpirationsInput;
  requestedAt: number;
}): Promise<{
  expirations: IbkrOptionExpirationDates;
  debug: RequestDebugMetadata;
} | null> {
  const durable = await loadDurableOptionExpirations({
    underlying: input.request.underlying,
    maxExpirations: input.request.maxExpirations,
    maxAgeMs: OPTION_EXPIRATION_CACHE_TTL_MS,
    staleMaxAgeMs: OPTION_EXPIRATION_STALE_TTL_MS,
  });
  if (!durable?.value.length) {
    return null;
  }

  const now = Date.now();
  const cachedAt =
    typeof durable.ageMs === "number" && Number.isFinite(durable.ageMs)
      ? Math.max(0, now - durable.ageMs)
      : now;
  seedOptionExpirationCache({
    key: input.key,
    expirations: durable.value,
    cachedAt,
    expiresAt: cachedAt + OPTION_EXPIRATION_CACHE_TTL_MS,
    staleExpiresAt: cachedAt + OPTION_EXPIRATION_STALE_TTL_MS,
  });

  return {
    expirations: durable.value,
    debug: {
      cacheStatus: "hit",
      totalMs: Math.max(0, Date.now() - input.requestedAt),
      upstreamMs: null,
      stale: durable.freshness === "stale",
      ageMs: durable.ageMs,
      reason: "durable_option_expirations",
    },
  };
}

export function shouldUseDurableOptionExpirationsForRequest(
  input: IbkrOptionExpirationsInput,
  durable: {
    expirations: IbkrOptionExpirationDates;
    debug: RequestDebugMetadata;
  } | null,
): boolean {
  if (!durable || durable.debug.stale === true) {
    return false;
  }
  if (
    typeof input.maxExpirations !== "number" ||
    !Number.isFinite(input.maxExpirations)
  ) {
    return false;
  }

  return (
    durable.expirations.length >= Math.max(1, Math.floor(input.maxExpirations))
  );
}

async function getCachedIbkrOptionExpirationsWithDebug(
  input: IbkrOptionExpirationsInput,
): Promise<{
  expirations: IbkrOptionExpirationDates;
  debug: RequestDebugMetadata;
}> {
  throwIfOptionRequestAborted(input.signal);
  const key = buildOptionExpirationCacheKey(input);
  const requestedAt = Date.now();
  const cached = optionExpirationCache.get(key);

  if (cached && cached.expiresAt > requestedAt) {
    return {
      expirations: cached.value,
      debug: {
        cacheStatus: "hit",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
      },
    };
  }

  const inFlight = optionExpirationInFlight.get(key);
  if (cached && cached.staleExpiresAt > requestedAt) {
    if (!inFlight) {
      refreshOptionExpirationCache(key, input).catch(() => {});
    }
    return {
      expirations: cached.value,
      debug: {
        cacheStatus: "hit",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
      },
    };
  }
  if (cached && isOptionUpstreamBackedOff("expiration", key)) {
    return {
      expirations: cached.value,
      debug: {
        cacheStatus: "hit",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        stale: true,
      },
    };
  }

  const foregroundWaitMs = normalizeOptionForegroundWaitMs(
    input.foregroundWaitMs,
  );
  const durableRequest = loadDurableOptionExpirationsForRequest({
    key,
    request: input,
    requestedAt,
  });
  const durable =
    foregroundWaitMs === null
      ? await durableRequest
      : await Promise.race([
          durableRequest.catch(() => null),
          optionForegroundTimeout(Math.min(250, foregroundWaitMs)),
        ]).then((result) => (result === "timeout" ? null : result));
  if (durable && shouldUseDurableOptionExpirationsForRequest(input, durable)) {
    return durable;
  }
  const optionExpirationBackoffRemainingMs = getOptionUpstreamBackoffRemainingMs(
    "expiration",
    key,
  );
  if (!input.bypassBridgeBackoff && optionExpirationBackoffRemainingMs > 0) {
    return (
      durable ?? {
        expirations: [],
        debug: {
          cacheStatus: "miss",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: null,
          stale: true,
          degraded: true,
          reason: "options_backoff",
          backoffRemainingMs: optionExpirationBackoffRemainingMs,
        },
      }
    );
  }

  if (
    !cached &&
    !input.bypassBridgeBackoff &&
    isBridgeWorkBackedOff("options")
  ) {
    return (
      durable ?? {
        expirations: [],
        debug: {
          cacheStatus: "miss",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: null,
          stale: true,
          degraded: true,
          reason: "options_backoff",
          backoffRemainingMs: getBridgeBackoffRemainingMs("options"),
        },
      }
    );
  }

  if (inFlight) {
    try {
      if (foregroundWaitMs !== null) {
        const timedResult = await Promise.race([
          inFlight,
          optionForegroundTimeout(foregroundWaitMs),
        ]);
        if (timedResult === "timeout") {
          return deferredOptionExpirationsResponse({
            requestedAt,
            durable,
            reason: "option_expirations_refresh_inflight_deferred",
          });
        }
        return {
          expirations: timedResult,
          debug: {
            cacheStatus: "inflight",
            totalMs: Math.max(0, Date.now() - requestedAt),
            upstreamMs: null,
          },
        };
      }
      const expirations = await inFlight;
      return {
        expirations,
        debug: {
          cacheStatus: "inflight",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: null,
        },
      };
    } catch (error) {
      recordOptionUpstreamBackoff("expiration", key, error);
      if (cached && isTransientOptionUpstreamError(error)) {
        return {
          expirations: cached.value,
          debug: {
            cacheStatus: "hit",
            totalMs: Math.max(0, Date.now() - requestedAt),
            upstreamMs: null,
            stale: true,
          },
        };
      }
      if (durable && isTransientOptionUpstreamError(error)) {
        return {
          expirations: durable.expirations,
          debug: {
            ...durable.debug,
            stale: true,
            degraded: true,
            reason: "durable_option_expirations_after_upstream_failure",
          },
        };
      }
      if (isTransientOptionUpstreamError(error)) {
        return {
          expirations: [],
          debug: {
            cacheStatus: "miss",
            totalMs: Math.max(0, Date.now() - requestedAt),
            upstreamMs: null,
            stale: true,
            degraded: true,
            reason:
              !input.bypassBridgeBackoff && isBridgeWorkBackedOff("options")
                ? "options_backoff"
                : "options_upstream_failure",
            backoffRemainingMs: getBridgeBackoffRemainingMs("options"),
          },
        };
      }
      throw error;
    }
  }

  const upstreamStartedAt = Date.now();
  let expirations: IbkrOptionExpirationDates;
  try {
    const refresh = refreshOptionExpirationCache(key, input);
    if (foregroundWaitMs !== null) {
      const timedResult = await Promise.race([
        refresh,
        optionForegroundTimeout(foregroundWaitMs),
      ]);
      if (timedResult === "timeout") {
        return deferredOptionExpirationsResponse({
          requestedAt,
          durable,
          reason: "option_expirations_refresh_deferred",
        });
      }
      expirations = timedResult;
    } else {
      expirations = await refresh;
    }
  } catch (error) {
    recordOptionUpstreamBackoff("expiration", key, error);
    if (cached && isTransientOptionUpstreamError(error)) {
      return {
        expirations: cached.value,
        debug: {
          cacheStatus: "hit",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
          stale: true,
        },
      };
    }
    if (durable && isTransientOptionUpstreamError(error)) {
      return {
        expirations: durable.expirations,
        debug: {
          ...durable.debug,
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
          stale: true,
          degraded: true,
          reason: "durable_option_expirations_after_upstream_failure",
        },
      };
    }
    if (isTransientOptionUpstreamError(error)) {
      return {
        expirations: [],
        debug: {
          cacheStatus: "miss",
          totalMs: Math.max(0, Date.now() - requestedAt),
          upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
          stale: true,
          degraded: true,
          reason:
            !input.bypassBridgeBackoff && isBridgeWorkBackedOff("options")
              ? "options_backoff"
              : "options_upstream_failure",
          backoffRemainingMs: getBridgeBackoffRemainingMs("options"),
        },
      };
    }
    throw error;
  }

  return {
    expirations,
    debug: {
      cacheStatus: "miss",
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
    },
  };
}

function refreshOptionExpirationCache(
  key: string,
  input: IbkrOptionExpirationsInput,
): Promise<IbkrOptionExpirationDates> {
  const existing = optionExpirationInFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const value = await runBridgeWork(
        "options",
        () => getIbkrClient().getOptionExpirations(input),
        {
          bypassBackoff: input.bypassBridgeBackoff === true,
          recordFailure: input.recordBridgeFailure !== false,
          signal: input.signal,
        },
      );
      const settledAt = Date.now();
      if (value.length > 0) {
        seedOptionExpirationCache({
          key,
          expirations: value,
          cachedAt: settledAt,
          expiresAt: settledAt + OPTION_EXPIRATION_CACHE_TTL_MS,
          staleExpiresAt: settledAt + OPTION_EXPIRATION_STALE_TTL_MS,
        });
      } else if (!optionExpirationCache.has(key)) {
        optionExpirationCache.delete(key);
      }
      return value;
    } finally {
      optionExpirationInFlight.delete(key);
    }
  })();

  optionExpirationInFlight.set(key, promise);
  return promise;
}

export async function getOptionChainWithDebug(input: {
  underlying: string;
  expirationDate?: Date;
  contractType?: "call" | "put";
  maxExpirations?: number;
  strikesAroundMoney?: number;
  strikeCoverage?: OptionChainStrikeCoverage;
  quoteHydration?: OptionChainQuoteHydration;
  allowDelayedSnapshotHydration?: boolean;
  recordBridgeFailure?: boolean;
  bypassBridgeBackoff?: boolean;
  signal?: AbortSignal;
}): Promise<GetOptionChainResultWithDebug> {
  const requestedAt = Date.now();
  const normalizedUnderlying = normalizeSymbol(input.underlying);
  const optionChain = await getCachedIbkrOptionChainWithDebug({
    ...input,
  }).catch((error) => {
    if (
      isUnderlyingResolutionError(error) ||
      !isTransientOptionUpstreamError(error)
    ) {
      throw error;
    }

    logger.warn(
      { err: error, underlying: normalizedUnderlying },
      "Returning degraded empty option chain after transient upstream failure",
    );
    return {
      contracts: [],
      debug: {
        cacheStatus: "miss" as const,
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        stale: true,
        degraded: true,
        reason: "options_upstream_failure",
      },
    };
  });
  if (optionChain.contracts.length === 0) {
    optionChain.debug.degraded = true;
    optionChain.debug.reason ??= optionChain.debug.stale
      ? "options_degraded_empty"
      : "options_successful_empty";
    recordOptionDegradedEvent({
      kind: "chain",
      underlying: normalizedUnderlying,
      expirationDate: input.expirationDate ?? null,
      reason: optionChain.debug.reason,
      message:
        optionChain.debug.reason === "options_successful_empty"
          ? "IBKR returned an empty option chain."
          : "Option chain is degraded or stale.",
    });
  }

  return {
    underlying: normalizedUnderlying,
    expirationDate: input.expirationDate ?? null,
    contracts: optionChain.contracts,
    debug: optionChain.debug,
  };
}

export async function getOptionChain(input: {
  underlying: string;
  expirationDate?: Date;
  contractType?: "call" | "put";
  maxExpirations?: number;
  strikesAroundMoney?: number;
  strikeCoverage?: OptionChainStrikeCoverage;
  underlyingSpotPrice?: number | null;
  quoteHydration?: OptionChainQuoteHydration;
  allowDelayedSnapshotHydration?: boolean;
  recordBridgeFailure?: boolean;
  bypassBridgeBackoff?: boolean;
}): Promise<GetOptionChainResult> {
  const { debug: _debug, ...value } = await getOptionChainWithDebug(input);
  return value;
}

export async function batchOptionChains(input: {
  underlying: string;
  expirationDates: Date[];
  contractType?: "call" | "put";
  strikesAroundMoney?: number;
  strikeCoverage?: OptionChainStrikeCoverage;
  underlyingSpotPrice?: number | null;
  quoteHydration?: OptionChainQuoteHydration;
  allowDelayedSnapshotHydration?: boolean;
  recordBridgeFailure?: boolean;
  bypassBridgeBackoff?: boolean;
  signal?: AbortSignal;
}): Promise<BatchOptionChainsResult> {
  throwIfOptionRequestAborted(input.signal);
  const requestedAt = Date.now();
  const underlying = normalizeSymbol(input.underlying);
  const expirationDates = Array.from(
    new Map(
      input.expirationDates
        .filter((date) => date instanceof Date && !Number.isNaN(date.getTime()))
        .map((date) => [date.toISOString().slice(0, 10), date]),
    ).values(),
  );

  if (
    OPTION_CHAIN_BATCH_EMERGENCY_MAX_EXPIRATIONS > 0 &&
    expirationDates.length > OPTION_CHAIN_BATCH_EMERGENCY_MAX_EXPIRATIONS
  ) {
    throw new HttpError(
      413,
      `Option-chain batch requested ${expirationDates.length} expirations, above the configured emergency ceiling of ${OPTION_CHAIN_BATCH_EMERGENCY_MAX_EXPIRATIONS}.`,
      {
        code: "option_chain_batch_too_large",
      },
    );
  }

  type BatchOptionChainFetchResult = {
    expirationDate: Date;
    contracts: IbkrOptionChainContracts;
    debug: RequestDebugMetadata;
    error: string | null;
  };
  const fetchBatchExpiration = async (
    expirationDate: Date,
  ): Promise<BatchOptionChainFetchResult> => {
    try {
      throwIfOptionRequestAborted(input.signal);
      const { contracts, debug } = await getCachedIbkrOptionChainWithDebug({
        underlying,
        expirationDate,
        contractType: input.contractType,
        maxExpirations: 1,
        strikesAroundMoney: input.strikesAroundMoney,
        strikeCoverage: input.strikeCoverage,
        underlyingSpotPrice: input.underlyingSpotPrice,
        quoteHydration: input.quoteHydration,
        allowDelayedSnapshotHydration: input.allowDelayedSnapshotHydration,
        recordBridgeFailure: input.recordBridgeFailure,
        bypassBridgeBackoff: input.bypassBridgeBackoff,
        signal: input.signal,
        emptyRetryDelaysMs: [],
      });

      return {
        expirationDate,
        contracts,
        debug,
        error: null,
      };
    } catch (error) {
      if (isUnderlyingResolutionError(error)) {
        throw error;
      }

      return {
        expirationDate,
        contracts: [],
        error: formatOptionChainBatchError(error),
        debug: {
          cacheStatus: "miss",
          totalMs: 0,
          upstreamMs: null,
          degraded: true,
          reason: "options_batch_failure",
        },
      };
    }
  };
  const finalizeBatchResult = (
    entry: BatchOptionChainFetchResult,
  ): BatchOptionChainResult => {
    if (entry.error) {
      return {
        expirationDate: entry.expirationDate,
        status: "failed",
        contracts: [],
        error: entry.error,
        debug: entry.debug,
      };
    }

    const resultDebug: RequestDebugMetadata =
      entry.contracts.length > 0
        ? entry.debug
        : {
            ...entry.debug,
            degraded: true,
            reason: entry.debug.reason ?? "options_successful_empty",
          };
    if (entry.contracts.length === 0) {
      recordOptionDegradedEvent({
        kind: "chain",
        underlying,
        expirationDate: entry.expirationDate,
        reason: resultDebug.reason ?? "options_successful_empty",
        message: "IBKR returned an empty option-chain batch result.",
      });
    }

    return {
      expirationDate: entry.expirationDate,
      status: entry.contracts.length ? "loaded" : "failed",
      contracts: entry.contracts,
      error: entry.contracts.length
        ? null
        : "IBKR returned an empty option chain.",
      debug: resultDebug,
    };
  };

  const fetchResults = await mapWithConcurrency(
    expirationDates,
    Math.min(1, getOptionsFlowRuntimeConfig().optionChainBatchConcurrency),
    async (expirationDate) => fetchBatchExpiration(expirationDate),
  );

  for (const entry of fetchResults) {
    if (entry.error || entry.contracts.length > 0) {
      continue;
    }
    for (const delayMs of OPTION_CHAIN_EMPTY_RETRY_DELAYS_MS) {
      await waitForOptionChainRetry(delayMs, input.signal);
      const retry = await fetchBatchExpiration(entry.expirationDate);
      entry.contracts = retry.contracts;
      entry.debug = retry.debug;
      entry.error = retry.error;
      if (entry.error || entry.contracts.length > 0) {
        break;
      }
    }
  }

  const results = fetchResults.map(finalizeBatchResult);

  const returnedCount = results.reduce(
    (total, result) => total + result.contracts.length,
    0,
  );
  const upstreamMsValues = results
    .map((result) => result.debug?.upstreamMs)
    .filter((value): value is number => typeof value === "number");

  return {
    underlying,
    results,
    debug: {
      cacheStatus: results.some(
        (result) => result.debug?.cacheStatus === "miss",
      )
        ? "miss"
        : results.some((result) => result.debug?.cacheStatus === "inflight")
          ? "inflight"
          : "hit",
      totalMs: Math.max(0, Date.now() - requestedAt),
      upstreamMs: upstreamMsValues.length
        ? upstreamMsValues.reduce((total, value) => total + value, 0)
        : null,
      requestedCount: expirationDates.length,
      returnedCount,
    },
  };
}

export async function getOptionExpirationsWithDebug(input: {
  underlying: string;
  maxExpirations?: number;
  recordBridgeFailure?: boolean;
  bypassBridgeBackoff?: boolean;
  foregroundWaitMs?: number | null;
  signal?: AbortSignal;
}): Promise<GetOptionExpirationsResultWithDebug> {
  const requestedAt = Date.now();
  const normalizedUnderlying = normalizeSymbol(input.underlying);
  const optionExpirations = await getCachedIbkrOptionExpirationsWithDebug({
    underlying: input.underlying,
    maxExpirations: input.maxExpirations,
    recordBridgeFailure: input.recordBridgeFailure,
    bypassBridgeBackoff: input.bypassBridgeBackoff,
    foregroundWaitMs: input.foregroundWaitMs,
    signal: input.signal,
  }).catch((error) => {
    if (
      isUnderlyingResolutionError(error) ||
      !isTransientOptionUpstreamError(error)
    ) {
      throw error;
    }

    logger.warn(
      { err: error, underlying: normalizedUnderlying },
      "Returning degraded empty option expirations after transient upstream failure",
    );
    return {
      expirations: [],
      debug: {
        cacheStatus: "miss" as const,
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        stale: true,
        degraded: true,
        reason: "options_upstream_failure",
      },
    };
  });
  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const expirations = Array.from(
    new Map(
      optionExpirations.expirations
        .filter((expirationDate) => expirationDate.getTime() >= todayUtc)
        .map((expirationDate) => [
          expirationDate.toISOString().slice(0, 10),
          { expirationDate },
        ]),
    ).values(),
  ).sort(
    (left, right) =>
      left.expirationDate.getTime() - right.expirationDate.getTime(),
  );
  if (expirations.length === 0) {
    optionExpirations.debug.degraded = true;
    optionExpirations.debug.reason ??= optionExpirations.debug.stale
      ? "option_expirations_degraded_empty"
      : "option_expirations_successful_empty";
    recordOptionDegradedEvent({
      kind: "expiration",
      underlying: normalizedUnderlying,
      reason: optionExpirations.debug.reason,
      message:
        optionExpirations.debug.reason === "option_expirations_successful_empty"
          ? "IBKR returned no option expirations."
          : "Option expirations are degraded or stale.",
    });
  }

  return {
    underlying: normalizedUnderlying,
    expirations,
    debug: {
      ...optionExpirations.debug,
      requestedCount: input.maxExpirations ?? expirations.length,
      returnedCount: expirations.length,
      complete: input.maxExpirations === undefined,
      capped: input.maxExpirations !== undefined,
    },
  };
}

export async function getOptionExpirations(input: {
  underlying: string;
  maxExpirations?: number;
  recordBridgeFailure?: boolean;
  bypassBridgeBackoff?: boolean;
}): Promise<GetOptionExpirationsResult> {
  const { debug: _debug, ...value } =
    await getOptionExpirationsWithDebug(input);
  return value;
}

export async function resolveOptionContractWithDebug(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
}): Promise<ResolveOptionContractResult> {
  const requestedAt = Date.now();
  const underlying = normalizeSymbol(input.underlying);
  const expirationDate = input.expirationDate;
  const strike = Number(input.strike);
  const right = input.right;
  const key = buildOptionContractResolutionCacheKey({
    underlying,
    expirationDate,
    strike,
    right,
  });
  const cached = optionContractResolutionCache.get(key);
  if (cached && cached.expiresAt > requestedAt) {
    return {
      ...cached.value,
      debug: {
        ...cached.value.debug,
        cacheStatus: "hit",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
      },
    };
  }

  if (!underlying || !Number.isFinite(strike) || strike <= 0) {
    return {
      underlying,
      expirationDate,
      strike,
      right,
      status: "error",
      providerContractId: null,
      contract: null,
      errorMessage: "Invalid option contract identity.",
      debug: {
        cacheStatus: "miss",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: null,
        degraded: true,
        reason: "invalid_option_contract_identity",
      },
    };
  }

  const upstreamStartedAt = Date.now();
  try {
    const { contracts, debug } = await getCachedIbkrOptionChainWithDebug({
      underlying,
      expirationDate,
      contractType: right,
      strikeCoverage: "full",
      quoteHydration: "metadata",
    });
    const expirationKey = expirationDate.toISOString().slice(0, 10);
    const match = findResolvedOptionContractMatch(contracts, {
      expirationKey,
      right,
      strike,
    });
    const providerContractId =
      match?.contract.providerContractId?.trim() || null;
    const result: ResolveOptionContractResult = {
      underlying,
      expirationDate,
      strike,
      right,
      status: providerContractId ? "resolved" : "not_found",
      providerContractId,
      contract: providerContractId ? (match?.contract ?? null) : null,
      errorMessage: providerContractId
        ? null
        : match
          ? "IBKR returned the option contract without a provider contract id."
          : "IBKR did not return a matching option contract for this expiration, side, and strike.",
      debug: {
        ...debug,
        cacheStatus: debug.cacheStatus,
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs:
          debug.upstreamMs ?? Math.max(0, Date.now() - upstreamStartedAt),
        requestedCount: 1,
        returnedCount: providerContractId ? 1 : 0,
        degraded: providerContractId ? debug.degraded : true,
        reason: providerContractId
          ? (debug.reason ?? null)
          : match
            ? "option_contract_missing_provider_contract_id"
            : "option_contract_not_found",
      },
    };

    if (providerContractId) {
      optionContractResolutionCache.set(key, {
        value: result,
        expiresAt: Date.now() + OPTION_CONTRACT_RESOLUTION_CACHE_TTL_MS,
      });
    }

    return result;
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      underlying,
      expirationDate,
      strike,
      right,
      status: "error",
      providerContractId: null,
      contract: null,
      errorMessage: message,
      debug: {
        cacheStatus: "miss",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: Math.max(0, Date.now() - upstreamStartedAt),
        degraded: true,
        reason: isTransientOptionUpstreamError(error)
          ? "options_upstream_failure"
          : "option_contract_resolution_error",
      },
    };
  }
}

export async function getOptionChartBarsWithDebug(input: {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  optionTicker?: string | null;
  providerContractId?: string | null;
  skipBrokerContractResolution?: boolean;
  timeframe: GetBarsInput["timeframe"];
  limit?: number;
  from?: Date;
  to?: Date;
  historyCursor?: string | null;
  preferCursor?: boolean;
  outsideRth?: boolean;
}): Promise<OptionChartBarsResult> {
  const requestedAt = Date.now();
  const underlying = normalizeSymbol(input.underlying);
  const expirationDate = input.expirationDate;
  const strike = Number(input.strike);
  const right = input.right;
  const providedOptionTicker = normalizeMassiveOptionTicker(input.optionTicker);
  const skipBrokerContractResolution = Boolean(
    input.skipBrokerContractResolution && providedOptionTicker,
  );
  const rawProvidedProviderContractId =
    typeof input.providerContractId === "string"
      ? input.providerContractId.trim()
      : "";
  const providedProviderContractId =
    rawProvidedProviderContractId &&
    rawProvidedProviderContractId !== "null" &&
    rawProvidedProviderContractId !== "undefined"
      ? rawProvidedProviderContractId
      : null;
  const outsideRth = Boolean(input.outsideRth);
  const baseResult = {
    underlying,
    expirationDate,
    strike,
    right,
    optionTicker: providedOptionTicker,
    symbol: underlying,
    timeframe: input.timeframe,
    transport: null,
    delayed: false,
    gapFilled: false,
    freshness: "unavailable" as MarketDataFreshness,
    marketDataMode: null,
    dataUpdatedAt: null,
    ageMs: null,
    historySource: null,
    studyFallback: false,
  };

  const finish = (
    value: Omit<OptionChartBarsResult, "debug" | "historyPage"> & {
      historyPage?: BarsHistoryPage;
    },
    debug: Partial<RequestDebugMetadata>,
  ): OptionChartBarsResult => {
    const historyProvider =
      value.historySource ??
      (value.dataSource !== "none"
        ? value.dataSource
        : value.emptyReason === "no-option-aggregate-bars"
          ? "massive-option-aggregates"
          : null);
    return {
      ...value,
      historyPage:
        value.historyPage ??
        buildBarsHistoryPage({
          request: {
            symbol: underlying,
            timeframe: input.timeframe,
            limit: input.limit,
            from: input.from,
            to: input.to,
            assetClass: "option",
            providerContractId: value.providerContractId,
            outsideRth,
            source: "midpoint",
          },
          bars: value.bars,
          provider: historyProvider,
          exhaustedBefore: false,
        }),
      debug: {
        cacheStatus: debug.cacheStatus ?? "miss",
        totalMs: Math.max(0, Date.now() - requestedAt),
        upstreamMs: debug.upstreamMs ?? null,
        requestedCount: 1,
        returnedCount: value.bars.length,
        degraded:
          debug.degraded ??
          (value.dataSource !== "ibkr-history" ||
            value.feedIssue ||
            value.bars.length === 0),
        reason: debug.reason ?? value.emptyReason ?? null,
        stale: debug.stale,
        ageMs: debug.ageMs,
        backoffRemainingMs: debug.backoffRemainingMs,
        complete: debug.complete,
        capped: debug.capped,
      },
    };
  };

  if (
    !underlying ||
    !expirationDate ||
    Number.isNaN(expirationDate.getTime()) ||
    !Number.isFinite(strike) ||
    strike <= 0
  ) {
    return finish(
      {
        ...baseResult,
        bars: [],
        contract: null,
        providerContractId: null,
        resolutionSource: "none",
        dataSource: "none",
        emptyReason: "invalid-option-contract-identity",
        feedIssue: false,
      },
      { degraded: true, reason: "invalid_option_contract_identity" },
    );
  }

  let contract: IbkrOptionChainContracts[number]["contract"] | null = null;
  let providerContractId: string | null = providedProviderContractId;
  let resolutionSource: OptionChartBarsResolutionSource = providerContractId
    ? "provided"
    : "none";
  let chainDebug: RequestDebugMetadata | null = null;
  let chainError: unknown = null;
  const massiveConfig = getMassiveRuntimeConfig();
  const massiveOptionBarsDelayed =
    massiveConfig?.baseUrl.includes("massive.com") ?? false;

  const fetchReferenceOptionChartBars = async (request: {
    optionTicker: string;
    feedIssue: boolean;
    debugReason?: string | null;
  }): Promise<OptionChartBarsResult> => {
    const massiveBarsResult = await fetchOptionChartMassiveBars({
      underlying,
      expirationDate,
      strike,
      right,
      optionTicker: request.optionTicker,
      providerContractId,
      timeframe: input.timeframe,
      limit: input.limit,
      from: input.from,
      to: input.to,
      historyCursor: input.historyCursor,
      preferCursor: input.preferCursor,
      outsideRth,
      delayed: massiveOptionBarsDelayed,
    });
    const bars = massiveBarsResult.bars;
    const latestBar = getLatestBar(bars);
    const dataUpdatedAt = getBarDataUpdatedAt(latestBar);
    const historySource = "massive-option-aggregates";
    const historyPage = buildBarsHistoryPage({
      request: {
        symbol: underlying,
        timeframe: input.timeframe,
        limit: input.limit,
        from: input.from,
        to: input.to,
        assetClass: "option",
        providerContractId,
        outsideRth,
        source: "midpoint",
      },
      bars,
      provider: historySource,
      exhaustedBefore: massiveBarsResult.cursorExhausted,
      ...buildMassiveHistoryPageMetadata(
        massiveBarsResult.page,
        massiveBarsResult.cursorSignature,
      ),
    });

    return finish(
      {
        ...baseResult,
        optionTicker: request.optionTicker,
        bars,
        contract,
        providerContractId,
        resolutionSource,
        dataSource: bars.length ? "massive-option-aggregates" : "none",
        emptyReason: bars.length ? null : "no-option-aggregate-bars",
        feedIssue: request.feedIssue,
        transport: null,
        delayed: bars.some((bar) => bar.delayed),
        freshness: bars.length
          ? bars.some((bar) => bar.delayed)
            ? "delayed"
            : "live"
          : "unavailable",
        marketDataMode: bars.length
          ? bars.some((bar) => bar.delayed)
            ? "delayed"
            : "live"
          : null,
        dataUpdatedAt,
        ageMs: getAgeMs(dataUpdatedAt),
        historySource: bars.length ? historySource : null,
        studyFallback: false,
        historyPage,
      },
      {
        degraded: request.feedIssue || bars.length === 0,
        reason: bars.length
          ? (request.debugReason ?? null)
          : "no-option-aggregate-bars",
      },
    );
  };

  const referenceOptionTicker =
    providedOptionTicker ??
    buildMassiveOptionTicker({
      underlying,
      expirationDate,
      strike,
      right,
    });
  if (
    massiveConfig &&
    referenceOptionTicker &&
    !(input.preferCursor && input.historyCursor) &&
    shouldPreferReferenceOptionHistory({ to: input.to, nowMs: requestedAt })
  ) {
    try {
      return await fetchReferenceOptionChartBars({
        optionTicker: referenceOptionTicker,
        feedIssue: false,
        debugReason: "reference_option_history_preferred",
      });
    } catch (error) {
      logger.debug(
        { err: error, underlying, optionTicker: referenceOptionTicker },
        "Reference option history preference failed; falling back to IBKR path",
      );
    }
  }

  const resolveFromOptionChain = async () => {
    const chain = await getCachedIbkrOptionChainWithDebug({
      underlying,
      expirationDate,
      contractType: right,
      strikeCoverage: "full",
      quoteHydration: "metadata",
    });
    chainDebug = chain.debug;
    const match = findResolvedOptionContractMatch(chain.contracts, {
      expirationKey: expirationDate.toISOString().slice(0, 10),
      right,
      strike,
    });
    contract = match?.contract ?? null;
    const chainProviderContractId =
      contract?.providerContractId?.trim() || null;
    if (chainProviderContractId) {
      providerContractId = chainProviderContractId;
      resolutionSource = "chain";
    }
  };

  if (!providerContractId && !skipBrokerContractResolution) {
    try {
      await resolveFromOptionChain();
    } catch (error) {
      chainError = error;
    }
  }

  if (!providerContractId && !chainError && !skipBrokerContractResolution) {
    const resolved = await resolveOptionContractWithDebug({
      underlying,
      expirationDate,
      strike,
      right,
    });
    if (resolved.providerContractId) {
      contract = resolved.contract;
      providerContractId = resolved.providerContractId;
      resolutionSource = "resolver";
    }
  }

  let ibkrBarsResult: GetBarsResult | null = null;
  let ibkrBarsDebug: RequestDebugMetadata | null = null;
  let ibkrBarsError: unknown = null;
  if (providerContractId) {
    try {
      const { debug, ...barsResult } = await getBarsWithDebug(
        {
          symbol: underlying,
          timeframe: input.timeframe,
          limit: input.limit,
          from: input.from,
          to: input.to,
          assetClass: "option",
          providerContractId,
          source: "midpoint",
          outsideRth,
          allowHistoricalSynthesis: false,
          allowStudyFallback: false,
        },
        {
          family: "option-chart-bars",
          priority: 6,
        },
      );
      ibkrBarsResult = barsResult;
      ibkrBarsDebug = debug;
    } catch (error) {
      ibkrBarsError = error;
    }
  }

  const massiveOptionTicker =
    providedOptionTicker ??
    normalizeMassiveOptionTicker(contract?.ticker) ??
    buildMassiveOptionTicker({
      underlying,
      expirationDate,
      strike: contract?.strike ?? strike,
      right: contract?.right ?? right,
    });

  if (ibkrBarsResult?.bars.length) {
    const desiredOptionBars = Math.max(
      input.limit ?? DEFAULT_BARS_LIMIT,
      ibkrBarsResult.bars.length,
    );
    const shouldFetchMassiveBars = Boolean(
      massiveConfig &&
        massiveOptionTicker &&
        shouldFetchMassiveOptionBarsForIbkrResult({
          bars: ibkrBarsResult.bars,
          timeframe: input.timeframe,
          limit: input.limit,
          from: input.from,
          to: input.to,
        }),
    );
    const massiveBarsResult = shouldFetchMassiveBars
      ? await tryFetchOptionChartMassiveBars({
          underlying,
          expirationDate,
          strike,
          right,
          optionTicker: massiveOptionTicker as string,
          providerContractId,
          timeframe: input.timeframe,
          limit: desiredOptionBars,
          from: input.from,
          to: input.to,
          historyCursor: input.historyCursor,
          preferCursor: input.preferCursor,
          outsideRth,
          delayed: massiveOptionBarsDelayed,
        })
      : null;
    const merged = massiveBarsResult
      ? mergeIbkrAndMassiveOptionBars({
          ibkrBars: ibkrBarsResult.bars,
          massiveBars: massiveBarsResult.bars,
          limit: desiredOptionBars,
        })
      : {
          bars: ibkrBarsResult.bars.map(decorateIbkrHistoryBar),
          gapFilled: false,
        };
    const bars = merged.bars;
    const latestBar = getLatestBar(bars);
    const dataUpdatedAt = getBarDataUpdatedAt(latestBar);
    const dataSource: OptionChartBarsDataSource = merged.gapFilled
      ? "mixed-history"
      : "ibkr-history";
    const historySource = merged.gapFilled
      ? "mixed-option-history"
      : (ibkrBarsResult.historySource ?? "ibkr-history");
    const historyPage = merged.gapFilled
      ? buildBarsHistoryPage({
          request: {
            symbol: underlying,
            timeframe: input.timeframe,
            limit: input.limit,
            from: input.from,
            to: input.to,
            assetClass: "option",
            providerContractId,
            outsideRth,
            source: "midpoint",
          },
          bars,
          provider: historySource,
          exhaustedBefore:
            massiveBarsResult?.cursorExhausted ??
            ibkrBarsResult.historyPage.exhaustedBefore,
          ...buildMassiveHistoryPageMetadata(
            massiveBarsResult?.page,
            massiveBarsResult?.cursorSignature,
          ),
        })
      : ibkrBarsResult.historyPage;
    const stale =
      (ibkrBarsDebug as RequestDebugMetadata | null)?.stale ??
      (chainDebug as RequestDebugMetadata | null)?.stale;
    return finish(
      {
        ...baseResult,
        ...ibkrBarsResult,
        bars,
        gapFilled: ibkrBarsResult.gapFilled || merged.gapFilled,
        optionTicker: massiveOptionTicker,
        contract,
        providerContractId,
        resolutionSource,
        dataSource,
        emptyReason: null,
        feedIssue: false,
        delayed: merged.gapFilled
          ? bars.some((bar) => bar.delayed)
          : ibkrBarsResult.delayed,
        freshness: merged.gapFilled
          ? normalizeFreshness({
              freshness: latestBar?.freshness,
              marketDataMode: latestBar?.marketDataMode,
              delayed: latestBar?.delayed,
            })
          : ibkrBarsResult.freshness,
        marketDataMode: merged.gapFilled
          ? (latestBar?.marketDataMode ?? ibkrBarsResult.marketDataMode)
          : ibkrBarsResult.marketDataMode,
        dataUpdatedAt: merged.gapFilled
          ? dataUpdatedAt
          : ibkrBarsResult.dataUpdatedAt,
        ageMs: merged.gapFilled
          ? getAgeMs(dataUpdatedAt)
          : ibkrBarsResult.ageMs,
        historySource,
        historyPage,
      },
      {
        cacheStatus:
          (ibkrBarsDebug as RequestDebugMetadata | null)?.cacheStatus ??
          (chainDebug as RequestDebugMetadata | null)?.cacheStatus ??
          "miss",
        upstreamMs:
          (ibkrBarsDebug as RequestDebugMetadata | null)?.upstreamMs ??
          (chainDebug as RequestDebugMetadata | null)?.upstreamMs ??
          null,
        stale: stale,
        ageMs:
          (ibkrBarsDebug as RequestDebugMetadata | null)?.ageMs ??
          (chainDebug as RequestDebugMetadata | null)?.ageMs,
        degraded: Boolean(stale),
        reason: (ibkrBarsDebug as RequestDebugMetadata | null)?.stale
          ? "stale_ibkr_option_history_cache"
          : (chainDebug as RequestDebugMetadata | null)?.stale
            ? "stale_option_chain_cache"
            : null,
      },
    );
  }

  const feedIssue =
    !skipBrokerContractResolution &&
    (isIbkrOptionHistoryFeedIssue({
      barsResult: ibkrBarsResult,
      error: ibkrBarsError,
    }) ||
      Boolean(
        !providerContractId &&
          (chainError || (chainDebug as RequestDebugMetadata | null)?.degraded),
      ));

  if (!massiveOptionTicker) {
    return finish(
      {
        ...baseResult,
        bars: [],
        optionTicker: massiveOptionTicker,
        contract,
        providerContractId,
        resolutionSource,
        dataSource: "none",
        emptyReason: "missing-massive-option-ticker",
        feedIssue,
      },
      { degraded: true },
    );
  }

  if (!massiveConfig) {
    return finish(
      {
        ...baseResult,
        bars: [],
        optionTicker: massiveOptionTicker,
        contract,
        providerContractId,
        resolutionSource,
        dataSource: "none",
        emptyReason: "massive-not-configured",
        feedIssue,
      },
      { degraded: true },
    );
  }

  try {
    return await fetchReferenceOptionChartBars({
      optionTicker: massiveOptionTicker,
      feedIssue,
    });
  } catch {
    return finish(
      {
        ...baseResult,
        bars: [],
        optionTicker: massiveOptionTicker,
        contract,
        providerContractId,
        resolutionSource,
        dataSource: "none",
        emptyReason: "massive-history-error",
        feedIssue,
      },
      { degraded: true },
    );
  }
}

export async function getHistoricalOptionTrades(input: {
  optionTicker: string;
  from: Date;
  to: Date;
  limit?: number;
  maxPages?: number;
  signal?: AbortSignal;
}): Promise<OptionTradePrint[]> {
  return getMassiveClient().getOptionTradePrints(input);
}

export async function getMarketDepth(input: {
  accountId?: string;
  symbol: string;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  exchange?: string | null;
}) {
  const client = getIbkrClient();
  return {
    depth: await client.getMarketDepth({
      accountId: input.accountId,
      symbol: normalizeSymbol(input.symbol),
      assetClass: input.assetClass,
      providerContractId: input.providerContractId,
      exchange: input.exchange,
    }),
  };
}

function selectFlowScannerExpirationDates(input: {
  expirations: readonly Date[];
  maxDte: number | null;
  expirationScanCount?: number;
  rotationKey?: string | null;
}): Date[] {
  const maxDte = input.maxDte;
  const expirationsByDte =
    maxDte === null
      ? [...input.expirations]
      : input.expirations.filter(
          (expirationDate) =>
            (getExpirationDte(expirationDate) ?? Number.POSITIVE_INFINITY) <=
            maxDte,
        );
  const expirationScanCount =
    typeof input.expirationScanCount === "number" &&
    Number.isFinite(input.expirationScanCount) &&
    input.expirationScanCount >= 0
      ? Math.floor(input.expirationScanCount)
      : getOptionsFlowRuntimeConfig().expirationScanCount;

  return expirationScanCount > 0
    ? selectRotatingWindow({
        values: expirationsByDte,
        count: expirationScanCount,
        offsets: flowScannerExpirationRotationOffsets,
        rotationKey: input.rotationKey,
      })
    : expirationsByDte;
}

function nextRotationOffset(
  offsets: Map<string, number>,
  rotationKey: string | null | undefined,
  length: number,
): number {
  const key = normalizeSymbol(rotationKey ?? "");
  if (!key || length <= 1) {
    return 0;
  }
  const offset = offsets.get(key) ?? 0;
  offsets.set(key, (offset + 1) % length);
  return offset % length;
}

function selectRotatingWindow<T>(input: {
  values: readonly T[];
  count: number;
  offsets: Map<string, number>;
  rotationKey?: string | null;
}): T[] {
  const count = Math.max(0, Math.floor(input.count));
  if (count <= 0) {
    return [];
  }
  if (input.values.length <= count) {
    return [...input.values];
  }
  const offset = nextRotationOffset(
    input.offsets,
    input.rotationKey,
    input.values.length,
  );
  return Array.from(
    { length: count },
    (_unused, index) => input.values[(offset + index) % input.values.length],
  );
}

function buildFlowScannerMetadataSelection(input: {
  lineBudget: number;
  expirationCount: number;
  strikeCoverage?: OptionChainStrikeCoverage;
}): Pick<IbkrOptionChainInput, "strikeCoverage" | "strikesAroundMoney"> {
  const strikeCoverage =
    input.strikeCoverage ?? getOptionsFlowRuntimeConfig().scannerStrikeCoverage;
  if (strikeCoverage === "full" || strikeCoverage === "fast") {
    return { strikeCoverage };
  }

  const linesPerExpiration = Math.max(
    2,
    Math.floor(input.lineBudget / Math.max(1, input.expirationCount)),
  );
  const scannerStrikesAroundMoney = Math.max(
    1,
    Math.min(
      OPTION_CHAIN_STRIKES_AROUND_MONEY,
      Math.floor((linesPerExpiration / 2 - 1) / 2),
    ),
  );

  return {
    strikeCoverage: "standard",
    strikesAroundMoney: scannerStrikesAroundMoney,
  };
}

function selectFlowScannerLiveCandidateContracts(
  contracts: IbkrOptionChainContracts,
  lineBudget: number,
  rotationKey?: string | null,
): IbkrOptionChainContracts {
  const underlyingPrice = readOptionChainUnderlyingPrice(contracts);
  const limit = Math.max(1, lineBudget);

  const candidateContracts = contracts.filter(
    (contract) => contract.contract.providerContractId,
  );

  if (candidateContracts.length <= limit) {
    return candidateContracts;
  }

  const expirationKeys = Array.from(
    new Set(
      candidateContracts
        .map((contract) =>
          contract.contract.expirationDate.toISOString().slice(0, 10),
        )
        .sort(),
    ),
  );
  const quartileCount = Math.min(4, Math.max(1, expirationKeys.length));
  const quartileByExpiration = new Map<string, number>();
  expirationKeys.forEach((expirationKey, index) => {
    quartileByExpiration.set(
      expirationKey,
      Math.min(
        quartileCount - 1,
        Math.floor((index * quartileCount) / expirationKeys.length),
      ),
    );
  });

  const heatRank = (
    left: IbkrOptionChainContracts[number],
    right: IbkrOptionChainContracts[number],
  ) => {
    const leftExpiration = left.contract.expirationDate.getTime();
    const rightExpiration = right.contract.expirationDate.getTime();
    if (leftExpiration !== rightExpiration) {
      return leftExpiration - rightExpiration;
    }

    const leftMark = left.mark ?? left.last ?? 0;
    const rightMark = right.mark ?? right.last ?? 0;
    const leftVolume = left.volume ?? 0;
    const rightVolume = right.volume ?? 0;
    const leftPremium = leftMark * leftVolume * left.contract.sharesPerContract;
    const rightPremium =
      rightMark * rightVolume * right.contract.sharesPerContract;
    if (leftPremium !== rightPremium) return rightPremium - leftPremium;
    if (leftVolume !== rightVolume) return rightVolume - leftVolume;
    if ((left.openInterest ?? 0) !== (right.openInterest ?? 0)) {
      return (right.openInterest ?? 0) - (left.openInterest ?? 0);
    }

    const leftUnderlyingPrice =
      typeof left.underlyingPrice === "number" &&
      Number.isFinite(left.underlyingPrice) &&
      left.underlyingPrice > 0
        ? left.underlyingPrice
        : underlyingPrice;
    const rightUnderlyingPrice =
      typeof right.underlyingPrice === "number" &&
      Number.isFinite(right.underlyingPrice) &&
      right.underlyingPrice > 0
        ? right.underlyingPrice
        : underlyingPrice;
    const leftDistance =
      leftUnderlyingPrice !== null && leftUnderlyingPrice > 0
        ? Math.abs(left.contract.strike - leftUnderlyingPrice) /
          leftUnderlyingPrice
        : Number.POSITIVE_INFINITY;
    const rightDistance =
      rightUnderlyingPrice !== null && rightUnderlyingPrice > 0
        ? Math.abs(right.contract.strike - rightUnderlyingPrice) /
          rightUnderlyingPrice
        : Number.POSITIVE_INFINITY;
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;

    return (
      left.contract.right.localeCompare(right.contract.right) ||
      left.contract.strike - right.contract.strike
    );
  };

  const quartileQueues = Array.from(
    { length: quartileCount },
    () => [] as IbkrOptionChainContracts,
  );
  candidateContracts.forEach((contract) => {
    const expirationKey = contract.contract.expirationDate
      .toISOString()
      .slice(0, 10);
    quartileQueues[quartileByExpiration.get(expirationKey) ?? 0]?.push(
      contract,
    );
  });
  quartileQueues.forEach((queue) => queue.sort(heatRank));

  const selected: IbkrOptionChainContracts = [];
  const startOffset = nextRotationOffset(
    flowScannerContractRotationOffsets,
    rotationKey,
    quartileCount,
  );
  while (
    selected.length < limit &&
    quartileQueues.some((queue) => queue.length > 0)
  ) {
    for (let offset = 0; offset < quartileCount; offset += 1) {
      if (selected.length >= limit) break;
      const queue = quartileQueues[(startOffset + offset) % quartileCount];
      const contract = queue?.shift();
      if (contract) {
        selected.push(contract);
      }
    }
  }

  return selected;
}

function selectFlowScannerHistoricalCandidateContracts(
  contracts: IbkrOptionChainContracts,
  lineBudget: number,
): IbkrOptionChainContracts {
  return contracts.slice(
    0,
    Math.max(1, Math.min(lineBudget, OPTIONS_FLOW_HISTORICAL_CANDIDATE_LIMIT)),
  );
}

function mergeFlowScannerHydratedContracts(
  baseContracts: IbkrOptionChainContracts,
  hydratedContracts: FlowScannerContracts,
): FlowScannerContracts {
  const hydratedByProviderContractId = new Map(
    hydratedContracts
      .map(
        (contract) =>
          [
            contract.contract.providerContractId?.trim?.() ?? "",
            contract,
          ] as const,
      )
      .filter(([providerContractId]) => Boolean(providerContractId)),
  );

  return baseContracts.map((contract): FlowScannerContract => {
    const providerContractId =
      contract.contract.providerContractId?.trim?.() ?? "";
    return hydratedByProviderContractId.get(providerContractId) ?? contract;
  });
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveValue(value: unknown): number | null {
  const numeric = numericValue(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function sumPositiveBarVolume(bars: readonly BrokerBarSnapshot[]): number {
  return bars.reduce((total, bar) => {
    const volume = numericValue(bar.volume);
    return volume !== null && volume > 0 ? total + volume : total;
  }, 0);
}

function normalizeContractMarketDataMode(
  mode: string | null | undefined,
): IbkrOptionChainContracts[number]["marketDataMode"] {
  if (
    mode === "live" ||
    mode === "frozen" ||
    mode === "delayed" ||
    mode === "delayed_frozen" ||
    mode === "unknown"
  ) {
    return mode;
  }
  return null;
}

function applyHistoricalBarsToFlowScannerContract(
  candidate: IbkrOptionChainContracts[number],
  barsResult: GetBarsResultWithDebug | null,
): FlowScannerContract {
  const bars = barsResult?.bars ?? [];
  const latestBar = getLatestBar(bars);
  if (!latestBar) {
    return candidate;
  }

  const historicalClose = positiveValue(latestBar.close);
  const historicalVolume = sumPositiveBarVolume(bars);
  const bid = numericValue(candidate.bid);
  const ask = numericValue(candidate.ask);
  const fallbackLast = positiveValue(candidate.last);
  const last = historicalClose ?? fallbackLast ?? candidate.last;
  const mark =
    bid !== null && bid > 0 && ask !== null && ask > 0
      ? (bid + ask) / 2
      : (historicalClose ??
        positiveValue(candidate.mark) ??
        fallbackLast ??
        candidate.mark);
  const dataUpdatedAt = getBarDataUpdatedAt(latestBar);
  const marketDataMode =
    normalizeContractMarketDataMode(latestBar.marketDataMode) ??
    normalizeContractMarketDataMode(barsResult?.marketDataMode) ??
    candidate.marketDataMode;

  return {
    ...candidate,
    last,
    mark,
    volume: historicalVolume > 0 ? historicalVolume : candidate.volume,
    updatedAt: dataUpdatedAt ?? candidate.updatedAt,
    quoteUpdatedAt: dataUpdatedAt ?? candidate.quoteUpdatedAt,
    dataUpdatedAt: dataUpdatedAt ?? candidate.dataUpdatedAt,
    flowOccurredAt: dataUpdatedAt ?? null,
    quoteFreshness:
      latestBar.freshness ?? barsResult?.freshness ?? candidate.quoteFreshness,
    marketDataMode,
    ageMs: dataUpdatedAt ? getAgeMs(dataUpdatedAt) : (candidate.ageMs ?? null),
  };
}

type FlowScannerHistoricalHydration = {
  contracts: FlowScannerContracts;
  requestedCount: number;
  returnedCount: number;
  missingCount: number;
  errorCount: number;
  marketDataMode: string | null;
  firstError: string | null;
};

function emptyFlowScannerHistoricalHydration(): FlowScannerHistoricalHydration {
  return {
    contracts: [],
    requestedCount: 0,
    returnedCount: 0,
    missingCount: 0,
    errorCount: 0,
    marketDataMode: null,
    firstError: null,
  };
}

async function hydrateFlowScannerContractsFromHistoricalBars(input: {
  underlying: string;
  candidates: IbkrOptionChainContracts;
  scanPhase: OptionsFlowScannerScanPhase;
  signal?: AbortSignal;
}): Promise<FlowScannerHistoricalHydration> {
  if (!input.candidates.length) {
    return emptyFlowScannerHistoricalHydration();
  }

  let firstError: string | null = null;
  let returnedCount = 0;
  let missingCount = 0;
  let errorCount = 0;
  let marketDataMode: string | null = null;
  const priority = input.scanPhase === "manual" ? 6 : 4;
  const contracts = await mapWithConcurrency(
    input.candidates,
    OPTIONS_FLOW_HISTORICAL_CONCURRENCY,
    async (candidate) => {
      const providerContractId = candidate.contract.providerContractId ?? null;
      if (!providerContractId) {
        missingCount += 1;
        return candidate;
      }

      try {
        const barsResult = await getBarsWithDebug(
          {
            symbol: input.underlying,
            timeframe: "1m",
            limit: 5,
            assetClass: "option",
            providerContractId,
            outsideRth: false,
            source: "midpoint",
            allowHistoricalSynthesis: false,
            allowStudyFallback: false,
          },
          {
            family: "option-flow-history",
            priority,
            signal: input.signal,
          },
        );
        if (barsResult.bars.length > 0) {
          returnedCount += 1;
          marketDataMode ??= barsResult.marketDataMode ?? null;
        } else {
          missingCount += 1;
          if (barsResult.emptyReason === "broker-history-error") {
            errorCount += 1;
            firstError ??= "broker-history-error";
          }
        }
        return applyHistoricalBarsToFlowScannerContract(candidate, barsResult);
      } catch (error) {
        errorCount += 1;
        firstError ??= getErrorMessage(error);
        return candidate;
      }
    },
  );

  return {
    contracts,
    requestedCount: input.candidates.length,
    returnedCount,
    missingCount,
    errorCount,
    marketDataMode,
    firstError,
  };
}

function applyLiveQuoteToFlowScannerContract(
  candidate: FlowScannerContract,
  quote: QuoteSnapshot | null,
): FlowScannerContract {
  if (!quote) {
    return candidate;
  }

  const bid = quote.bid ?? candidate.bid ?? null;
  const ask = quote.ask ?? candidate.ask ?? null;
  const last = quote.price ?? candidate.last ?? null;
  return {
    ...candidate,
    bid,
    ask,
    last,
    mark:
      bid !== null && ask !== null && bid > 0 && ask > 0
        ? (bid + ask) / 2
        : (last ?? candidate.mark),
    impliedVolatility:
      quote.impliedVolatility ?? candidate.impliedVolatility ?? null,
    delta: quote.delta ?? candidate.delta ?? null,
    gamma: quote.gamma ?? candidate.gamma ?? null,
    theta: quote.theta ?? candidate.theta ?? null,
    vega: quote.vega ?? candidate.vega ?? null,
    openInterest: quote.openInterest ?? candidate.openInterest ?? null,
    volume: quote.volume ?? candidate.volume ?? null,
    updatedAt: quote.updatedAt ?? candidate.updatedAt,
    quoteFreshness: quote.freshness ?? candidate.quoteFreshness,
    marketDataMode: quote.marketDataMode ?? candidate.marketDataMode,
    quoteUpdatedAt:
      quote.dataUpdatedAt ?? quote.updatedAt ?? candidate.quoteUpdatedAt,
    dataUpdatedAt:
      quote.dataUpdatedAt ?? quote.updatedAt ?? candidate.dataUpdatedAt,
    ageMs: quote.ageMs ?? candidate.ageMs ?? null,
  };
}

async function hydrateFlowScannerContractsFromLiveQuotes(input: {
  underlying: string;
  candidates: FlowScannerContracts;
  owner: string;
  signal?: AbortSignal;
}): Promise<{
  contracts: FlowScannerContracts;
  requestedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  returnedCount: number;
  missingCount: number;
  admissionBridgeMismatchCount: number;
  marketDataMode: string | null;
  errorMessage: string | null;
  blockedReason: string | null;
}> {
  const providerContractIds = input.candidates
    .map((contract) => contract.contract.providerContractId)
    .filter((providerContractId): providerContractId is string =>
      Boolean(providerContractId),
    );

  if (!providerContractIds.length) {
    return {
      contracts: input.candidates,
      requestedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      returnedCount: 0,
      missingCount: 0,
      admissionBridgeMismatchCount: 0,
      marketDataMode: null,
      errorMessage: null,
      blockedReason: null,
    };
  }

  const quotePayload = await fetchBridgeOptionQuoteSnapshots({
    underlying: input.underlying,
    providerContractIds,
    owner: input.owner,
    intent: "flow-scanner-live",
    ttlMs: getOptionsFlowScannerQuoteLeaseTtlMs(),
    fallbackProvider: "none",
    requiresGreeks: false,
    releaseLeasesOnComplete: false,
    releaseLeasesOnAbort: false,
    signal: input.signal,
  }).catch((error) => ({
    underlying: input.underlying,
    quotes: [] as QuoteSnapshot[],
    transport: null,
    delayed: false,
    fallbackUsed: false,
    debug: {
      totalMs: 0,
      upstreamMs: null,
      requestedCount: providerContractIds.length,
      acceptedCount: 0,
      rejectedCount: providerContractIds.length,
      returnedCount: 0,
      bridgeChunks: 0,
      providerMode: null,
      liveMarketDataAvailable: null,
      errorMessage: getErrorMessage(error),
      blockedReason: "options_flow_live_quote_unavailable",
      acceptedProviderContractIds: [],
      missingProviderContractIds: providerContractIds,
    },
  }));

  const quotesByProviderContractId = new Map(
    quotePayload.quotes
      .map(
        (quote) => [quote.providerContractId?.trim?.() || "", quote] as const,
      )
      .filter(([providerContractId]) => Boolean(providerContractId)),
  );
  const quoteDebug = quotePayload.debug ?? {
    acceptedCount: 0,
    rejectedCount: providerContractIds.length,
    returnedCount: quotePayload.quotes.length,
    missingProviderContractIds: providerContractIds,
    errorMessage: null,
    blockedReason: null,
  };
  const acceptedCount = quoteDebug.acceptedCount ?? 0;
  const returnedCount =
    quoteDebug.returnedCount ?? quotePayload.quotes.length ?? 0;
  const missingCount = quoteDebug.missingProviderContractIds?.length ?? 0;
  const contracts = input.candidates.map((contract) =>
    applyLiveQuoteToFlowScannerContract(
      contract,
      quotesByProviderContractId.get(
        contract.contract.providerContractId ?? "",
      ) ?? null,
    ),
  );

  return {
    contracts,
    requestedCount: providerContractIds.length,
    acceptedCount,
    rejectedCount: quoteDebug.rejectedCount ?? 0,
    returnedCount,
    missingCount,
    admissionBridgeMismatchCount:
      Math.max(0, returnedCount - acceptedCount) +
      Math.max(0, acceptedCount - returnedCount - missingCount),
    marketDataMode:
      quotePayload.quotes.find((quote) => quote.marketDataMode)
        ?.marketDataMode ?? null,
    errorMessage: quoteDebug.errorMessage ?? null,
    blockedReason: quoteDebug.blockedReason ?? null,
  };
}

type FlowEventsTimeWindow = {
  from?: Date;
  to?: Date;
};

type NewYorkFlowClockParts = {
  year: number;
  month: number;
  day: number;
  weekday: string;
  minutes: number;
};

const FLOW_REGULAR_SESSION_OPEN_MINUTES = 9 * 60 + 30;
const FLOW_REGULAR_SESSION_CLOSE_MINUTES = 16 * 60;
const NEW_YORK_FLOW_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseFlowEventsBoundary(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeFlowEventsTimeWindow(input: {
  from?: unknown;
  to?: unknown;
}): FlowEventsTimeWindow | null {
  const from = parseFlowEventsBoundary(input.from);
  const to = parseFlowEventsBoundary(input.to);
  if (!from && !to) {
    return null;
  }
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

function flowEventsTimeWindowCacheKey(
  window: FlowEventsTimeWindow | null,
): string {
  return window
    ? `from=${window.from?.toISOString() ?? ""}:to=${
        window.to?.toISOString() ?? ""
      }`
    : "current";
}

function readNewYorkFlowClockParts(date: Date): NewYorkFlowClockParts | null {
  const parts = NEW_YORK_FLOW_CLOCK_FORMATTER.formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  const weekday = read("weekday");
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }
  return {
    year,
    month,
    day,
    weekday,
    minutes: hour * 60 + minute,
  };
}

function isWeekendFlowClockDay(parts: NewYorkFlowClockParts): boolean {
  return parts.weekday === "Sat" || parts.weekday === "Sun";
}

function newYorkWallTimeToUtcDate(
  parts: Pick<NewYorkFlowClockParts, "year" | "month" | "day">,
  minutes: number,
): Date {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const guess = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0),
  );
  const guessParts = readNewYorkFlowClockParts(guess);
  if (!guessParts) {
    return guess;
  }
  const expectedWallTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    minute,
    0,
    0,
  );
  const actualWallTime = Date.UTC(
    guessParts.year,
    guessParts.month - 1,
    guessParts.day,
    Math.floor(guessParts.minutes / 60),
    guessParts.minutes % 60,
    0,
    0,
  );
  return new Date(guess.getTime() - (actualWallTime - expectedWallTime));
}

function previousWeekdayFlowClockParts(
  parts: NewYorkFlowClockParts,
): NewYorkFlowClockParts {
  const cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  for (let index = 0; index < 7; index += 1) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const candidate = readNewYorkFlowClockParts(cursor);
    if (candidate && !isWeekendFlowClockDay(candidate)) {
      return candidate;
    }
  }
  return parts;
}

function coerceIbkrSnapshotFlowOccurredAt(candidate: Date): Date {
  const parts = readNewYorkFlowClockParts(candidate);
  if (!parts) {
    return candidate;
  }
  if (isWeekendFlowClockDay(parts)) {
    return newYorkWallTimeToUtcDate(
      previousWeekdayFlowClockParts(parts),
      FLOW_REGULAR_SESSION_CLOSE_MINUTES,
    );
  }
  if (parts.minutes < FLOW_REGULAR_SESSION_OPEN_MINUTES) {
    return newYorkWallTimeToUtcDate(
      previousWeekdayFlowClockParts(parts),
      FLOW_REGULAR_SESSION_CLOSE_MINUTES,
    );
  }
  if (parts.minutes >= FLOW_REGULAR_SESSION_CLOSE_MINUTES) {
    return newYorkWallTimeToUtcDate(parts, FLOW_REGULAR_SESSION_CLOSE_MINUTES);
  }
  return candidate;
}

export async function listFlowEvents(input: {
  underlying?: string;
  limit?: number;
  scope?: FlowEventsScope;
  minPremium?: number;
  maxDte?: number;
  unusualThreshold?: number;
  lineBudget?: number;
  historicalBucketSeconds?: number;
  from?: Date | string;
  to?: Date | string;
  blocking?: boolean;
  queueRefresh?: boolean;
  allowMassiveFallback?: boolean;
}): Promise<FlowEventsResult> {
  const underlying = normalizeSymbol(input.underlying ?? "");
  const limit = Math.max(1, Math.min(input.limit ?? 50, 1_000));
  const blocking = input.blocking ?? true;
  const unusualThreshold =
    Number.isFinite(input.unusualThreshold) && (input.unusualThreshold ?? 0) > 0
      ? Math.min(100, Math.max(0.1, input.unusualThreshold as number))
      : undefined;
  const filters = normalizeFlowEventsFilters(input);
  const timeWindow = normalizeFlowEventsTimeWindow(input);
  const historicalBucketSeconds = normalizeHistoricalFlowSampleBucketSeconds(
    input.historicalBucketSeconds,
  );
  const runtimeConfig = getOptionsFlowRuntimeConfig();
  const shouldQueueRefresh = input.queueRefresh !== false;
  const allowMassiveFallback = input.allowMassiveFallback === true;
  const nonblockingScannerRead = !blocking;
  const nonblockingScannerRefresh =
    nonblockingScannerRead &&
    shouldQueueRefresh &&
    allowMassiveFallback !== true;
  const explicitLineBudget =
    Number.isFinite(input.lineBudget) && (input.lineBudget ?? 0) > 0
      ? Math.max(
          1,
          Math.min(
            Math.floor(input.lineBudget as number),
            runtimeConfig.scannerLineBudget,
          ),
        )
      : null;
  const scannerLineBudget = resolveOptionsFlowScannerTickerLineBudget({
    config: runtimeConfig,
    explicitLineBudget,
  });
  const scannerLimitFloor = nonblockingScannerRead
    ? scannerLineBudget
    : runtimeConfig.scannerLimit;

  if (!underlying) {
    return {
      events: [],
      source: flowSource({
        provider: "none",
        status: "empty",
        unusualThreshold: unusualThreshold ?? 1,
      }),
    };
  }

  if (timeWindow) {
    if (!getMassiveRuntimeConfig()) {
      return {
        events: [],
        source: flowSource({
          provider: "none",
          status: "empty",
          attemptedProviders: ["massive"],
          unusualThreshold: unusualThreshold ?? 1,
          ibkrStatus: "empty",
          ibkrReason: "options_flow_historical_requires_massive",
        }),
      };
    }

    const cacheKey = `${underlying}:${limit}:${
      unusualThreshold ?? "default"
    }:${flowEventsFilterCacheKey(filters)}:${flowEventsTimeWindowCacheKey(
      timeWindow,
    )}:${historicalBucketSeconds ?? "default"}:historical-window`;
    const historicalChartWindowRequest = historicalBucketSeconds !== undefined;
    const requestedAt = Date.now();
    let cached = flowEventsCache.get(cacheKey);
    if (cached && !isCacheableFlowEventsResult(cached.value)) {
      flowEventsCache.delete(cacheKey);
      cached = undefined;
    }
    if (cached && cached.expiresAt > requestedAt) {
      return cached.value;
    }
    const inFlight = flowEventsInFlight.get(cacheKey);
    if (cached && cached.staleExpiresAt > requestedAt) {
      if (!inFlight) {
        const cooldown = historicalChartWindowRequest
          ? getHistoricalFlowCooldown(cacheKey, requestedAt)
          : null;
        if (!cooldown) {
          refreshHistoricalFlowEventsCache(cacheKey, {
            underlying,
            limit,
            filters,
            unusualThreshold,
            from: timeWindow.from,
            to: timeWindow.to,
            blocking: historicalChartWindowRequest ? false : undefined,
            historicalBucketSeconds,
          }).catch(() => {});
        }
      }
      return cached.value;
    }
    if (cached) {
      flowEventsCache.delete(cacheKey);
    }
    if (inFlight) {
      if (!blocking) {
        if (historicalChartWindowRequest) {
          return historicalFlowEventsTransientResult({
            unusualThreshold,
            reason: HISTORICAL_FLOW_REFRESHING_REASON,
          });
        }
        return listHistoricalFlowEvents({
          underlying,
          providerName: getMarketDataConnectionName(),
          client: getMassiveClient(),
          limit,
          filters,
          unusualThreshold,
          from: timeWindow.from,
          to: timeWindow.to,
          blocking: false,
          historicalBucketSeconds,
        });
      }
      return inFlight;
    }

    if (historicalChartWindowRequest) {
      const cooldown = getHistoricalFlowCooldown(cacheKey, requestedAt);
      if (cooldown) {
        return cooldown;
      }
    }

    if (!blocking) {
      if (historicalChartWindowRequest) {
        refreshHistoricalFlowEventsCache(cacheKey, {
          underlying,
          limit,
          filters,
          unusualThreshold,
          from: timeWindow.from,
          to: timeWindow.to,
          blocking: false,
          historicalBucketSeconds,
        }).catch(() => {});
        return historicalFlowEventsTransientResult({
          unusualThreshold,
          reason: HISTORICAL_FLOW_REFRESHING_REASON,
        });
      }
      return listHistoricalFlowEvents({
        underlying,
        providerName: getMarketDataConnectionName(),
        client: getMassiveClient(),
        limit,
        filters,
        unusualThreshold,
        from: timeWindow.from,
        to: timeWindow.to,
        blocking: false,
        historicalBucketSeconds,
      });
    }

    const refresh = refreshHistoricalFlowEventsCache(cacheKey, {
      underlying,
      limit,
      filters,
      unusualThreshold,
      from: timeWindow.from,
      to: timeWindow.to,
      blocking,
      historicalBucketSeconds,
    });
    return refresh;
  }

  const scannerRequest = {
    limit: Math.max(limit, scannerLimitFloor),
    unusualThreshold,
    lineBudget: scannerLineBudget,
    allowMassiveFallback,
    phase: nonblockingScannerRefresh ? ("seed" as const) : ("manual" as const),
    expirationScanCount: nonblockingScannerRefresh
      ? 1
      : runtimeConfig.expirationScanCount,
    strikeCoverage: "standard" as const,
  };
  const scannerSnapshotLimit = scannerRequest.limit;
  const rawScannerSnapshot = getOptionsFlowRuntimeConfig().scannerEnabled
    ? optionsFlowScanner.getSnapshot(underlying, {
        limit: scannerSnapshotLimit,
        unusualThreshold,
        lineBudget: scannerRequest.lineBudget,
        allowPartial: nonblockingScannerRead,
        phase: scannerRequest.phase,
        expirationScanCount: scannerRequest.expirationScanCount,
        strikeCoverage: scannerRequest.strikeCoverage,
      })
    : null;
  const scannerSnapshot = isFlowScannerSnapshotAllowedForFallbackPolicy(
    rawScannerSnapshot,
    scannerRequest.allowMassiveFallback,
  )
    ? rawScannerSnapshot
    : null;
  if (scannerSnapshot?.freshness === "fresh") {
    return {
      events: filterFlowEventsForRequest(
        scannerSnapshot.events,
        filters,
        unusualThreshold,
        limit,
      ),
      source:
        (scannerSnapshot.source as FlowEventsSource | null) ??
        flowSource({
          provider: "none",
          status: "empty",
          unusualThreshold: unusualThreshold ?? 1,
        }),
    };
  }

  const cacheKey = `${underlying}:${limit}:${
    unusualThreshold ?? "default"
  }:${flowEventsFilterCacheKey(filters)}:${
    scannerRequest.allowMassiveFallback ? "massive-fallback" : "ibkr-only"
  }:${scannerRequest.lineBudget}`;
  const requestedAt = Date.now();
  let cached = flowEventsCache.get(cacheKey);
  if (cached && !isCacheableFlowEventsResult(cached.value)) {
    flowEventsCache.delete(cacheKey);
    cached = undefined;
  }
  if (cached && cached.expiresAt > requestedAt) {
    return cached.value;
  }
  const inFlight = flowEventsInFlight.get(cacheKey);

  if (scannerSnapshot?.freshness === "stale") {
    if (shouldQueueRefresh) {
      queueOptionsFlowScannerRefresh({
        underlying,
        scannerRequest,
        phase: "stale-snapshot",
      });
    }
    return {
      events: filterFlowEventsForRequest(
        scannerSnapshot.events,
        filters,
        unusualThreshold,
        limit,
      ),
      source:
        (scannerSnapshot.source as FlowEventsSource | null) ??
        flowSource({
          provider: "none",
          status: "empty",
          unusualThreshold: unusualThreshold ?? 1,
        }),
    };
  }

  if (cached && cached.staleExpiresAt > requestedAt) {
    if (!inFlight && shouldQueueRefresh) {
      refreshFlowEventsCache(cacheKey, {
        underlying,
        limit,
        filters,
        unusualThreshold,
        lineBudget: scannerRequest.lineBudget,
        scanPhase: scannerRequest.phase,
        expirationScanCount: scannerRequest.expirationScanCount,
        strikeCoverage: scannerRequest.strikeCoverage,
        allowMassiveFallback: scannerRequest.allowMassiveFallback,
      }).catch(() => {});
    }
    return cached.value;
  }
  if (cached) {
    flowEventsCache.delete(cacheKey);
  }

  if (inFlight) {
    if (!blocking) {
      return deferredFlowEventsResult({
        underlying,
        limit,
        filters,
        unusualThreshold,
        reason: "options_flow_on_demand_refreshing",
      });
    }
    return inFlight;
  }

  if (!blocking && !shouldQueueRefresh) {
    return deferredFlowEventsResult({
      underlying,
      limit,
      filters,
      unusualThreshold,
      reason: "options_flow_scanner_snapshot_pending",
    });
  }

  if (
    nonblockingScannerRefresh &&
    queueOptionsFlowScannerRefresh({
      underlying,
      scannerRequest,
      phase: "nonblocking-miss",
    })
  ) {
    return deferredFlowEventsResult({
      underlying,
      limit,
      filters,
      unusualThreshold,
      reason: "options_flow_scanner_queued",
    });
  }

  const deferReason = shouldDeferOnDemandFlowRefresh();
  if (deferReason) {
    return deferredFlowEventsResult({
      underlying,
      limit,
      filters,
      unusualThreshold,
      reason: deferReason,
    });
  }

  const refresh = refreshFlowEventsCache(cacheKey, {
    underlying,
    limit,
    filters,
    unusualThreshold,
    lineBudget: scannerRequest.lineBudget,
    scanPhase: scannerRequest.phase,
    expirationScanCount: scannerRequest.expirationScanCount,
    strikeCoverage: scannerRequest.strikeCoverage,
    allowMassiveFallback: scannerRequest.allowMassiveFallback,
  });
  if (!blocking) {
    return deferredFlowEventsResult({
      underlying,
      limit,
      filters,
      unusualThreshold,
      reason: "options_flow_on_demand_refreshing",
    });
  }

  return refresh;
}

function refreshFlowEventsCache(
  cacheKey: string,
  input: {
    underlying: string;
    limit: number;
    filters: FlowEventsFilters;
    unusualThreshold?: number;
    lineBudget?: number;
    scanPhase?: OptionsFlowScannerScanPhase;
    expirationScanCount?: number;
    strikeCoverage?: OptionChainStrikeCoverage;
    allowMassiveFallback?: boolean;
  },
): Promise<FlowEventsResult> {
  const existing = flowEventsInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const cached = flowEventsCache.get(cacheKey);
  flowEventsOnDemandActive += 1;
  const request = listFlowEventsUncached({
    ...input,
    bypassBridgeBackoff: false,
  }).then((value) => {
    const settledAt = Date.now();
    const nextValue = shouldPreserveCachedFlowEvents(cached, value, settledAt)
      ? cached!.value
      : value;
    const cacheable = isCacheableFlowEventsResult(nextValue);
    if (cacheable) {
      flowEventsCache.set(cacheKey, {
        value: nextValue,
        expiresAt: settledAt + FLOW_EVENTS_CACHE_TTL_MS,
        staleExpiresAt: settledAt + FLOW_EVENTS_CACHE_STALE_TTL_MS,
      });
    } else {
      flowEventsCache.delete(cacheKey);
    }
    if (
      cacheable &&
      getOptionsFlowRuntimeConfig().scannerEnabled &&
      input.allowMassiveFallback !== true &&
      !hasNarrowFlowFilters(input.filters)
    ) {
      optionsFlowScanner.storeSnapshot(
        input.underlying,
        {
          limit: input.limit,
          unusualThreshold: input.unusualThreshold,
          lineBudget: input.lineBudget,
          phase: input.scanPhase,
          expirationScanCount: input.expirationScanCount,
          strikeCoverage: input.strikeCoverage,
        },
        nextValue,
      );
    }
    return nextValue;
  });
  flowEventsInFlight.set(cacheKey, request);

  request.then(
    () => {
      flowEventsOnDemandActive = Math.max(0, flowEventsOnDemandActive - 1);
      flowEventsInFlight.delete(cacheKey);
    },
    () => {
      flowEventsOnDemandActive = Math.max(0, flowEventsOnDemandActive - 1);
      flowEventsInFlight.delete(cacheKey);
    },
  );
  return request;
}

function refreshHistoricalFlowEventsCache(
  cacheKey: string,
  input: {
    underlying: string;
    limit: number;
    filters: FlowEventsFilters;
    unusualThreshold?: number;
    from?: Date;
    to?: Date;
    blocking?: boolean;
    historicalBucketSeconds?: number;
  },
): Promise<FlowEventsResult> {
  const existing = flowEventsInFlight.get(cacheKey);
  if (existing) {
    return existing;
  }

  const cached = flowEventsCache.get(cacheKey);
  flowEventsOnDemandActive += 1;
  const request = listHistoricalFlowEvents({
    underlying: input.underlying,
    providerName: getMarketDataConnectionName(),
    client: getMassiveClient(),
    limit: input.limit,
    filters: input.filters,
    unusualThreshold: input.unusualThreshold,
    from: input.from,
    to: input.to,
    blocking: input.blocking,
    historicalBucketSeconds: input.historicalBucketSeconds,
  }).then((value) => {
    const settledAt = Date.now();
    if (
      input.historicalBucketSeconds !== undefined &&
      isHistoricalFlowProviderTimeoutResult(value)
    ) {
      recordHistoricalFlowCooldown(cacheKey, value, settledAt);
    } else {
      historicalFlowCooldowns.delete(cacheKey);
    }
    const nextValue = shouldPreserveCachedFlowEvents(cached, value, settledAt)
      ? cached!.value
      : value;
    const cacheable = isCacheableFlowEventsResult(nextValue);
    if (cacheable) {
      flowEventsCache.set(cacheKey, {
        value: nextValue,
        expiresAt: settledAt + FLOW_EVENTS_CACHE_TTL_MS,
        staleExpiresAt: settledAt + FLOW_EVENTS_CACHE_STALE_TTL_MS,
      });
    } else {
      flowEventsCache.delete(cacheKey);
    }
    return nextValue;
  });
  flowEventsInFlight.set(cacheKey, request);

  request.then(
    () => {
      flowEventsOnDemandActive = Math.max(0, flowEventsOnDemandActive - 1);
      flowEventsInFlight.delete(cacheKey);
    },
    () => {
      flowEventsOnDemandActive = Math.max(0, flowEventsOnDemandActive - 1);
      flowEventsInFlight.delete(cacheKey);
    },
  );
  return request;
}

async function listFlowEventsUncached(input: {
  underlying: string;
  limit: number;
  filters: FlowEventsFilters;
  unusualThreshold?: number;
  allowMassiveFallback?: boolean;
  lineBudget?: number;
  scanPhase?: OptionsFlowScannerScanPhase;
  expirationScanCount?: number;
  strikeCoverage?: OptionChainStrikeCoverage;
  bypassBridgeBackoff?: boolean;
  signal?: AbortSignal;
}): Promise<FlowEventsResult> {
  // Derive IBKR flow from option-chain snapshots. These are not consolidated
  // time-and-sales events, so callers receive `basis: "snapshot"` and the UI
  // labels them as active/unusual contracts rather than verified sweeps.
  let contracts: FlowScannerContracts = [];
  const attemptedProviders: FlowDataProvider[] = [];
  let ibkrError: string | null = null;
  let ibkrReason: string | null = null;
  let ibkrStatus: FlowEventsSource["ibkrStatus"] = "empty";
  let ibkrExpirationCount = 0;
  let ibkrHydratedExpirationCount = 0;
  let ibkrContractCount = 0;
  let ibkrQualifiedContractCount = 0;
  let ibkrCandidateExpirationCount = 0;
  let ibkrMetadataContractCount = 0;
  let ibkrLiveCandidateCount = 0;
  let ibkrAcceptedQuoteCount = 0;
  let ibkrRejectedQuoteCount = 0;
  let ibkrReturnedQuoteCount = 0;
  let ibkrMissingQuoteCount = 0;
  let ibkrFilteredEventCount = 0;
  let ibkrAdmissionBridgeMismatchCount = 0;
  let ibkrMarketDataMode: string | null = null;
  let underlyingSpotPrice: number | null = null;
  let underlyingSpotSource: "massive" | "ibkr" | null = null;
  let massiveError: string | null = null;
  const scanPhase = input.scanPhase ?? "manual";
  const expirationScanCount =
    Number.isFinite(input.expirationScanCount) &&
    (input.expirationScanCount ?? 0) >= 0
      ? Math.max(0, Math.floor(input.expirationScanCount as number))
      : getOptionsFlowRuntimeConfig().expirationScanCount;
  const strikeCoverage = input.strikeCoverage ?? "standard";

  const ibkrSourceDiagnostics = () => ({
    ibkrExpirationCount,
    ibkrHydratedExpirationCount,
    ibkrContractCount,
    ibkrQualifiedContractCount,
    ibkrCandidateExpirationCount,
    ibkrMetadataContractCount,
    ibkrLiveCandidateCount,
    ibkrAcceptedQuoteCount,
    ibkrRejectedQuoteCount,
    ibkrReturnedQuoteCount,
    ibkrMissingQuoteCount,
    ibkrFilteredEventCount,
    ibkrAdmissionBridgeMismatchCount,
    ibkrMarketDataMode,
    ibkrDelayedMarketData: ibkrMarketDataMode === "delayed",
    scannerPhase: scanPhase,
    scannerLineBudget: input.lineBudget,
    scannerExpirationScanCount: expirationScanCount,
    scannerStrikeCoverage: strikeCoverage,
    underlyingSpotPrice,
    underlyingSpotSource,
  });

  attemptedProviders.push("ibkr");
  try {
    const expirationsResult = await getCachedIbkrOptionExpirationsWithDebug({
      underlying: input.underlying,
      recordBridgeFailure: false,
      bypassBridgeBackoff: input.bypassBridgeBackoff === true,
      signal: input.signal,
    });
    ibkrExpirationCount = expirationsResult.expirations.length;
    ibkrReason = expirationsResult.debug.reason ?? null;

    const candidateExpirations = selectFlowScannerExpirationDates({
      expirations: expirationsResult.expirations,
      maxDte: input.filters.maxDte,
      expirationScanCount,
      rotationKey: input.underlying,
    });
    ibkrCandidateExpirationCount = candidateExpirations.length;

    if (candidateExpirations.length > 0) {
      const stockSpotPrice = await fetchMassiveStockSpotPrice(input.underlying);
      if (stockSpotPrice !== null) {
        underlyingSpotPrice = stockSpotPrice;
        underlyingSpotSource = "massive";
      }
      const lineBudget = Math.max(
        1,
        input.lineBudget ?? getOptionsFlowRuntimeConfig().scannerLineBudget,
      );
      const metadataSelection = buildFlowScannerMetadataSelection({
        lineBudget,
        expirationCount: candidateExpirations.length,
        strikeCoverage,
      });
      const batch = await batchOptionChains({
        underlying: input.underlying,
        expirationDates: candidateExpirations,
        ...metadataSelection,
        underlyingSpotPrice,
        quoteHydration: "metadata",
        allowDelayedSnapshotHydration: false,
        recordBridgeFailure: false,
        bypassBridgeBackoff: input.bypassBridgeBackoff === true,
        signal: input.signal,
      });
      const metadataContracts = batch.results.flatMap(
        (result) => result.contracts,
      );
      ibkrMetadataContractCount = metadataContracts.length;
      const liveCandidateContracts = selectFlowScannerLiveCandidateContracts(
        metadataContracts,
        lineBudget,
        input.underlying,
      );
      ibkrLiveCandidateCount = liveCandidateContracts.length;
      const historicalCandidateContracts =
        selectFlowScannerHistoricalCandidateContracts(
          liveCandidateContracts,
          lineBudget,
        );
      const shouldHydrateHistoricalBars = true;
      const shouldReportHistoricalHydration =
        shouldHydrateHistoricalBars && scanPhase === "manual";
      const historicalHydration = shouldHydrateHistoricalBars
        ? await hydrateFlowScannerContractsFromHistoricalBars({
            underlying: input.underlying,
            candidates: historicalCandidateContracts,
            scanPhase,
            signal: input.signal,
          })
        : emptyFlowScannerHistoricalHydration();
      const liveHydrationCandidates = shouldHydrateHistoricalBars
        ? mergeFlowScannerHydratedContracts(
            liveCandidateContracts,
            historicalHydration.contracts,
          )
        : liveCandidateContracts;
      const liveHydration = await hydrateFlowScannerContractsFromLiveQuotes({
        underlying: input.underlying,
        candidates: liveHydrationCandidates,
        owner: `flow-scanner:${normalizeSymbol(input.underlying)}`,
        signal: input.signal,
      });
      ibkrAcceptedQuoteCount = liveHydration.acceptedCount;
      ibkrRejectedQuoteCount = liveHydration.rejectedCount;
      ibkrReturnedQuoteCount = liveHydration.returnedCount;
      ibkrMissingQuoteCount = liveHydration.missingCount;
      ibkrAdmissionBridgeMismatchCount =
        liveHydration.admissionBridgeMismatchCount;
      ibkrMarketDataMode =
        liveHydration.marketDataMode ?? historicalHydration.marketDataMode;
      if (shouldReportHistoricalHydration && historicalHydration.firstError) {
        ibkrError ??= historicalHydration.firstError;
        ibkrReason ??= "options_flow_historical_hydration_degraded";
      }
      if (liveHydration.errorMessage) {
        if (
          liveHydration.blockedReason === "market_session_quiet" ||
          liveHydration.blockedReason === "market-session-quiet"
        ) {
          ibkrReason ??= "options_flow_scanner_market_session_quiet";
        } else {
          ibkrError ??= liveHydration.errorMessage;
          ibkrReason ??= liveHydration.blockedReason
            ? "options_flow_live_quote_blocked"
            : "options_flow_quote_hydration_failed";
        }
      } else if (
        liveHydration.acceptedCount > 0 &&
        liveHydration.returnedCount === 0 &&
        liveHydration.missingCount > 0
      ) {
        ibkrReason ??= "options_flow_quote_hydration_empty";
      }
      if (
        shouldReportHistoricalHydration &&
        historicalHydration.requestedCount > 0 &&
        historicalHydration.returnedCount === 0 &&
        liveHydration.returnedCount === 0 &&
        historicalCandidateContracts.every(
          (contract) =>
            (contract.mark ?? 0) <= 0 || (contract.volume ?? 0) <= 0,
        )
      ) {
        ibkrReason ??= "options_flow_historical_hydration_empty";
      }
      contracts = liveHydration.contracts;
      ibkrHydratedExpirationCount = batch.results.filter(
        (result) => result.contracts.length > 0,
      ).length;
      ibkrReason ??=
        batch.results.length > 0 && contracts.length === 0
          ? "options_flow_no_hydrated_contracts"
          : null;
    } else {
      ibkrReason ??= expirationsResult.debug.stale
        ? "options_flow_expirations_degraded_empty"
        : "options_flow_no_expirations";
    }
  } catch (error) {
    ibkrError = getErrorMessage(error);
    ibkrReason = "options_flow_ibkr_error";
    ibkrStatus = "error";
    contracts = [];
  }

  ibkrContractCount = contracts.length;
  const qualifiedContracts = contracts.filter(
    (c) => (c.mark ?? 0) > 0 && (c.volume ?? 0) > 0,
  );
  ibkrQualifiedContractCount = qualifiedContracts.length;
  if (
    !isRegularTradingHours() &&
    ibkrError === null &&
    ibkrQualifiedContractCount === 0 &&
    ibkrReason !== "options_flow_no_expirations" &&
    ibkrReason !== "options_flow_expirations_degraded_empty" &&
    input.allowMassiveFallback !== true
  ) {
    ibkrReason = "options_flow_scanner_market_session_quiet";
  }
  if (ibkrStatus !== "error") {
    ibkrStatus =
      ibkrQualifiedContractCount > 0
        ? "loaded"
        : ibkrReason?.includes("degraded") ||
            ibkrReason?.includes("quote_hydration")
          ? "degraded"
          : "empty";
  }
  if (!ibkrReason && contracts.length > 0 && ibkrQualifiedContractCount === 0) {
    ibkrReason = "options_flow_no_volume_candidates";
  }
  const ibkrUnderlyingPrice = readOptionChainUnderlyingPrice(contracts);
  if (ibkrUnderlyingPrice !== null) {
    underlyingSpotPrice = ibkrUnderlyingPrice;
    underlyingSpotSource = "ibkr";
  }

  // IBKR snapshots now include OPRA volume (field 7762) and option open
  // interest (field 7638), so flow events can rank by real traded premium.
  // Require both a marked contract and non-zero day volume to filter out the
  // inactive long tail.
  const candidateEvents = qualifiedContracts.map((c) => {
    const mark = c.mark ?? 0;
    const mid = ((c.bid ?? 0) + (c.ask ?? 0)) / 2;
    const side: "buy" | "sell" | "unknown" =
      (c.bid ?? 0) > 0 && (c.ask ?? 0) > 0 && c.last != null
        ? c.last >= (c.ask ?? 0)
          ? "buy"
          : c.last <= (c.bid ?? 0)
            ? "sell"
            : c.last > mid
              ? "buy"
              : c.last < mid
                ? "sell"
                : "unknown"
        : "unknown";
    const sentiment: "bullish" | "bearish" | "neutral" =
      side === "unknown"
        ? "neutral"
        : (c.contract.right === "call" && side === "buy") ||
            (c.contract.right === "put" && side === "sell")
          ? "bullish"
          : "bearish";
    const price = (c.last ?? 0) > 0 ? (c.last ?? mark) : mark;
    const size = c.volume ?? 0;
    const { unusualScore, isUnusual } = computeUnusualMetrics(
      size,
      c.openInterest ?? 0,
      input.unusualThreshold,
    );
    const underlyingPrice =
      typeof c.underlyingPrice === "number" &&
      Number.isFinite(c.underlyingPrice) &&
      c.underlyingPrice > 0
        ? c.underlyingPrice
        : underlyingSpotPrice;
    const distancePercent =
      underlyingPrice !== null && underlyingPrice > 0
        ? ((c.contract.strike - underlyingPrice) / underlyingPrice) * 100
        : null;
    const atmBand =
      underlyingPrice !== null && underlyingPrice > 0
        ? Math.max(0.01, underlyingPrice * 0.0025)
        : null;
    const absoluteDistance =
      underlyingPrice !== null
        ? Math.abs(c.contract.strike - underlyingPrice)
        : null;
    const moneyness =
      underlyingPrice === null || atmBand === null || absoluteDistance === null
        ? null
        : absoluteDistance <= atmBand
          ? "ATM"
          : c.contract.right === "call"
            ? c.contract.strike < underlyingPrice
              ? "ITM"
              : "OTM"
            : c.contract.strike > underlyingPrice
              ? "ITM"
              : "OTM";
    // Rank by mark-based premium (mark × volume × multiplier) so the
    // ordering is stable even when `last` is stale or zero. The display
    // `price` still prefers the last field when available.
    const historicalOccurredAt =
      c.flowOccurredAt instanceof Date &&
      !Number.isNaN(c.flowOccurredAt.getTime())
        ? c.flowOccurredAt
        : null;
    const occurredAt = coerceIbkrSnapshotFlowOccurredAt(
      historicalOccurredAt ??
        c.dataUpdatedAt ??
        c.quoteUpdatedAt ??
        c.updatedAt ??
        new Date(),
    );
    return {
      id: `${c.contract.ticker}-${occurredAt.getTime()}`,
      underlying: normalizeSymbol(c.contract.underlying),
      provider: "ibkr" as const,
      basis: "snapshot" as const,
      optionTicker: c.contract.ticker,
      providerContractId: c.contract.providerContractId ?? null,
      strike: c.contract.strike,
      expirationDate: c.contract.expirationDate,
      right: c.contract.right,
      price,
      bid: c.bid,
      ask: c.ask,
      last: c.last,
      mark,
      size,
      premium: mark * size * c.contract.sharesPerContract,
      multiplier: c.contract.multiplier,
      sharesPerContract: c.contract.sharesPerContract,
      openInterest: c.openInterest ?? 0,
      impliedVolatility: c.impliedVolatility,
      delta: c.delta,
      gamma: c.gamma,
      theta: c.theta,
      vega: c.vega,
      underlyingPrice,
      moneyness,
      distancePercent,
      confidence: "snapshot_activity" as const,
      sourceBasis: "snapshot_activity" as const,
      exchange: "IBKR",
      side,
      sentiment,
      tradeConditions: [] as string[],
      occurredAt,
      unusualScore,
      isUnusual,
    };
  });
  const filteredEvents = candidateEvents.filter((event) =>
    flowEventMatchesFilters(event, input.filters, input.unusualThreshold),
  );
  ibkrFilteredEventCount = candidateEvents.length - filteredEvents.length;
  const events = filteredEvents
    // Surface unusual contracts (volume > open interest) above routine flow,
    // then fall back to premium so the highest-conviction events win ties.
    .sort((a, b) => {
      if (a.isUnusual !== b.isUnusual) return a.isUnusual ? -1 : 1;
      if (a.isUnusual && b.isUnusual && a.unusualScore !== b.unusualScore) {
        return b.unusualScore - a.unusualScore;
      }
      return b.premium - a.premium;
    })
    .slice(0, input.limit);

  if (events.length > 0) {
    return {
      events,
      source: flowSource({
        provider: "ibkr",
        status: "live",
        attemptedProviders,
        unusualThreshold: input.unusualThreshold ?? 1,
        ibkrStatus,
        ibkrReason,
        ...ibkrSourceDiagnostics(),
      }),
    };
  }

  if (
    input.allowMassiveFallback === true &&
    getMassiveRuntimeConfig() &&
    !attemptedProviders.includes("massive")
  ) {
    attemptedProviders.push("massive");
    try {
      const massiveCandidateLimit = hasNarrowFlowFilters(input.filters)
        ? Math.min(
            250,
            Math.max(
              input.limit * 4,
              input.limit,
              getOptionsFlowRuntimeConfig().scannerLimit,
            ),
          )
        : input.limit;
      const massiveEvents = await getMassiveClient().getDerivedFlowEvents({
        underlying: input.underlying,
        limit: massiveCandidateLimit,
        unusualThreshold: input.unusualThreshold,
      });
      const filteredMassiveEvents = filterFlowEventsForRequest(
        massiveEvents,
        input.filters,
        input.unusualThreshold,
        input.limit,
      );

      if (filteredMassiveEvents.length > 0) {
        return {
          events: filteredMassiveEvents,
          source: flowSource({
            provider: "massive",
            status: "fallback",
            fallbackUsed: true,
            attemptedProviders,
            errorMessage: ibkrError,
            unusualThreshold: input.unusualThreshold ?? 1,
            ibkrStatus,
            ibkrReason,
            ...ibkrSourceDiagnostics(),
          }),
        };
      }
    } catch (error) {
      massiveError = getErrorMessage(error);
    }
  }

  const ibkrLoadedEmptySnapshot = ibkrStatus === "loaded";
  const errorMessage = ibkrLoadedEmptySnapshot
    ? null
    : (massiveError ?? ibkrError);
  return {
    events: [],
    source: flowSource({
      provider: ibkrLoadedEmptySnapshot ? "ibkr" : "none",
      status: errorMessage ? "error" : "empty",
      fallbackUsed: attemptedProviders.includes("massive"),
      attemptedProviders,
      errorMessage,
      unusualThreshold: input.unusualThreshold ?? 1,
      ibkrStatus,
      ibkrReason,
      ...ibkrSourceDiagnostics(),
    }),
  };
}

type FlowScannerBenchmarkLineUsage = {
  activeLineCount: number;
  activeOptionLineCount: number;
  accountMonitorLineCount: number;
  accountMonitorRemainingLineCount: number;
  flowScannerLineCount: number;
  flowScannerRemainingLineCount: number;
  usableRemainingLineCount: number;
  leaseCount: number;
};

export type FlowScannerBenchmarkBudgetResult = {
  underlying: string;
  lineBudget: number;
  status: "loaded" | "empty" | "error";
  strikeCoverage: OptionChainStrikeCoverage;
  strikesAroundMoney: number | null;
  expirationCount: number;
  expirationsCacheStatus: RequestDebugMetadata["cacheStatus"] | null;
  expirationsDegraded: boolean;
  expirationsDebugReason: string | null;
  candidateExpirationCount: number;
  hydratedExpirationCount: number;
  metadataFailedExpirationCount: number;
  metadataContractCount: number;
  metadataErrorSamples: string[];
  metadataDebugReasonCounts: Array<{ reason: string; count: number }>;
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
  lineUsageBefore: FlowScannerBenchmarkLineUsage;
  lineUsageBeforeQuotes: FlowScannerBenchmarkLineUsage;
  lineUsageAfter: FlowScannerBenchmarkLineUsage;
  errorMessage: string | null;
};

export type FlowScannerBenchmarkResult = {
  underlying: string;
  startedAt: Date;
  finishedAt: Date;
  config: {
    lineBudgets: number[];
    maxDte: number | null;
    expirationScanCount: number;
    strikeCoverage: OptionChainStrikeCoverage;
    scannerIntervalMs: number;
  };
  results: FlowScannerBenchmarkBudgetResult[];
};

function summarizeMarketDataLineUsage(
  diagnostics: ReturnType<typeof getMarketDataAdmissionDiagnostics>,
): FlowScannerBenchmarkLineUsage {
  return {
    activeLineCount: diagnostics.activeLineCount,
    activeOptionLineCount: diagnostics.activeOptionLineCount,
    accountMonitorLineCount: diagnostics.accountMonitorLineCount,
    accountMonitorRemainingLineCount:
      diagnostics.accountMonitorRemainingLineCount,
    flowScannerLineCount: diagnostics.flowScannerLineCount,
    flowScannerRemainingLineCount: diagnostics.flowScannerRemainingLineCount,
    usableRemainingLineCount: diagnostics.usableRemainingLineCount,
    leaseCount: diagnostics.leaseCount,
  };
}

function normalizeFlowScannerBenchmarkLineBudgets(
  values: readonly number[] | undefined,
): number[] {
  const rawValues = values?.length ? values : [10, 20, 30];
  return Array.from(
    new Set(
      rawValues
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.max(1, Math.min(150, value))),
    ),
  ).sort((left, right) => left - right);
}

function summarizeBenchmarkBatchDebug(batch: BatchOptionChainsResult | null): {
  failedExpirationCount: number;
  errorSamples: string[];
  debugReasonCounts: Array<{ reason: string; count: number }>;
} {
  if (!batch) {
    return {
      failedExpirationCount: 0,
      errorSamples: [],
      debugReasonCounts: [],
    };
  }

  const errorSamples = new Set<string>();
  const reasonCounts = new Map<string, number>();

  for (const result of batch.results) {
    const error = typeof result.error === "string" ? result.error.trim() : "";
    if (error) {
      errorSamples.add(error);
    }

    const reason =
      typeof result.debug?.reason === "string" && result.debug.reason.trim()
        ? result.debug.reason.trim()
        : result.status === "loaded"
          ? "loaded"
          : "unknown";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }

  return {
    failedExpirationCount: batch.results.filter(
      (result) => result.status !== "loaded",
    ).length,
    errorSamples: Array.from(errorSamples).slice(0, 5),
    debugReasonCounts: Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count),
  };
}

export async function benchmarkOptionsFlowScannerTickerPass(input: {
  underlying: string;
  lineBudgets?: readonly number[];
  maxDte?: number | null;
  expirationScanCount?: number | null;
  strikeCoverage?: OptionChainStrikeCoverage;
}): Promise<FlowScannerBenchmarkResult> {
  const underlying = normalizeSymbol(input.underlying);
  if (!underlying) {
    throw new HttpError(400, "underlying is required.", {
      code: "invalid_flow_scanner_benchmark_request",
    });
  }

  const runtimeConfig = getOptionsFlowRuntimeConfig();
  const lineBudgets = normalizeFlowScannerBenchmarkLineBudgets(
    input.lineBudgets,
  );
  const maxDte =
    input.maxDte === undefined
      ? null
      : input.maxDte === null
        ? null
        : Math.max(0, Math.floor(input.maxDte));
  const expirationScanCount =
    typeof input.expirationScanCount === "number" &&
    Number.isFinite(input.expirationScanCount) &&
    input.expirationScanCount >= 0
      ? Math.floor(input.expirationScanCount)
      : runtimeConfig.expirationScanCount;
  const strikeCoverage =
    input.strikeCoverage ?? runtimeConfig.scannerStrikeCoverage;
  const startedAt = new Date();
  const results: FlowScannerBenchmarkBudgetResult[] = [];
  const underlyingSpotPrice = await fetchMassiveStockSpotPrice(underlying);

  for (const lineBudget of lineBudgets) {
    const totalStartedAt = Date.now();
    const lineUsageBefore = summarizeMarketDataLineUsage(
      getMarketDataAdmissionDiagnostics(),
    );
    let expirationCount = 0;
    let expirationsCacheStatus: RequestDebugMetadata["cacheStatus"] | null =
      null;
    let expirationsDegraded = false;
    let expirationsDebugReason: string | null = null;
    let candidateExpirationCount = 0;
    let hydratedExpirationCount = 0;
    let metadataFailedExpirationCount = 0;
    let metadataContractCount = 0;
    let metadataErrorSamples: string[] = [];
    let metadataDebugReasonCounts: Array<{ reason: string; count: number }> =
      [];
    let liveCandidateCount = 0;
    let acceptedQuoteCount = 0;
    let rejectedQuoteCount = 0;
    let returnedQuoteCount = 0;
    let missingQuoteCount = 0;
    let expirationsMs = 0;
    let metadataMs = 0;
    let quoteMs = 0;
    let lineDwellMs = 0;
    let lineUsageBeforeQuotes = lineUsageBefore;
    let selectedStrikeCoverage = strikeCoverage;
    let selectedStrikesAroundMoney: number | null = null;

    try {
      const expirationsStartedAt = Date.now();
      const expirationsResult = await getCachedIbkrOptionExpirationsWithDebug({
        underlying,
        bypassBridgeBackoff: true,
      });
      expirationsMs = Math.max(0, Date.now() - expirationsStartedAt);
      expirationCount = expirationsResult.expirations.length;
      expirationsCacheStatus = expirationsResult.debug.cacheStatus ?? null;
      expirationsDegraded = Boolean(expirationsResult.debug.degraded);
      expirationsDebugReason = expirationsResult.debug.reason ?? null;
      const candidateExpirations = selectFlowScannerExpirationDates({
        expirations: expirationsResult.expirations,
        maxDte,
        expirationScanCount,
      });
      candidateExpirationCount = candidateExpirations.length;

      const metadataSelection = buildFlowScannerMetadataSelection({
        lineBudget,
        expirationCount: candidateExpirations.length,
        strikeCoverage,
      });
      selectedStrikeCoverage = metadataSelection.strikeCoverage ?? "standard";
      selectedStrikesAroundMoney = metadataSelection.strikesAroundMoney ?? null;

      const metadataStartedAt = Date.now();
      const batch =
        candidateExpirations.length > 0
          ? await batchOptionChains({
              underlying,
              expirationDates: candidateExpirations,
              ...metadataSelection,
              underlyingSpotPrice,
              quoteHydration: "metadata",
              allowDelayedSnapshotHydration: false,
              bypassBridgeBackoff: true,
            })
          : null;
      metadataMs = Math.max(0, Date.now() - metadataStartedAt);
      hydratedExpirationCount =
        batch?.results.filter((result) => result.contracts.length > 0).length ??
        0;
      const batchDebugSummary = summarizeBenchmarkBatchDebug(batch);
      metadataFailedExpirationCount = batchDebugSummary.failedExpirationCount;
      metadataErrorSamples = batchDebugSummary.errorSamples;
      metadataDebugReasonCounts = batchDebugSummary.debugReasonCounts;
      const metadataContracts =
        batch?.results.flatMap((result) => result.contracts) ?? [];
      metadataContractCount = metadataContracts.length;
      const liveCandidateContracts = selectFlowScannerLiveCandidateContracts(
        metadataContracts,
        lineBudget,
        underlying,
      );
      liveCandidateCount = liveCandidateContracts.length;

      lineUsageBeforeQuotes = summarizeMarketDataLineUsage(
        getMarketDataAdmissionDiagnostics(),
      );
      const quoteStartedAt = Date.now();
      const historicalCandidateContracts =
        selectFlowScannerHistoricalCandidateContracts(
          liveCandidateContracts,
          lineBudget,
        );
      const historicalHydration =
        await hydrateFlowScannerContractsFromHistoricalBars({
          underlying,
          candidates: historicalCandidateContracts,
          scanPhase: "manual",
        });
      const liveHydrationCandidates = mergeFlowScannerHydratedContracts(
        liveCandidateContracts,
        historicalHydration.contracts,
      );
      const liveHydration = await hydrateFlowScannerContractsFromLiveQuotes({
        underlying,
        candidates: liveHydrationCandidates,
        owner: `flow-scanner-benchmark:${underlying}:${lineBudget}:${quoteStartedAt}`,
      });
      quoteMs = Math.max(0, Date.now() - quoteStartedAt);
      lineDwellMs = quoteMs;
      acceptedQuoteCount = liveHydration.acceptedCount;
      rejectedQuoteCount = liveHydration.rejectedCount;
      returnedQuoteCount =
        liveHydration.returnedCount || historicalHydration.returnedCount;
      missingQuoteCount = liveHydration.missingCount;

      results.push({
        underlying,
        lineBudget,
        status:
          returnedQuoteCount > 0 || metadataContractCount > 0
            ? "loaded"
            : "empty",
        strikeCoverage: selectedStrikeCoverage,
        strikesAroundMoney: selectedStrikesAroundMoney,
        expirationCount,
        expirationsCacheStatus,
        expirationsDegraded,
        expirationsDebugReason,
        candidateExpirationCount,
        hydratedExpirationCount,
        metadataFailedExpirationCount,
        metadataContractCount,
        metadataErrorSamples,
        metadataDebugReasonCounts,
        liveCandidateCount,
        acceptedQuoteCount,
        rejectedQuoteCount,
        returnedQuoteCount,
        missingQuoteCount,
        timingsMs: {
          total: Math.max(0, Date.now() - totalStartedAt),
          expirations: expirationsMs,
          metadata: metadataMs,
          quote: quoteMs,
          lineDwell: lineDwellMs,
        },
        lineUsageBefore,
        lineUsageBeforeQuotes,
        lineUsageAfter: summarizeMarketDataLineUsage(
          getMarketDataAdmissionDiagnostics(),
        ),
        errorMessage: null,
      });
    } catch (error) {
      results.push({
        underlying,
        lineBudget,
        status: "error",
        strikeCoverage: selectedStrikeCoverage,
        strikesAroundMoney: selectedStrikesAroundMoney,
        expirationCount,
        expirationsCacheStatus,
        expirationsDegraded,
        expirationsDebugReason,
        candidateExpirationCount,
        hydratedExpirationCount,
        metadataFailedExpirationCount,
        metadataContractCount,
        metadataErrorSamples,
        metadataDebugReasonCounts,
        liveCandidateCount,
        acceptedQuoteCount,
        rejectedQuoteCount,
        returnedQuoteCount,
        missingQuoteCount,
        timingsMs: {
          total: Math.max(0, Date.now() - totalStartedAt),
          expirations: expirationsMs,
          metadata: metadataMs,
          quote: quoteMs,
          lineDwell: lineDwellMs,
        },
        lineUsageBefore,
        lineUsageBeforeQuotes,
        lineUsageAfter: summarizeMarketDataLineUsage(
          getMarketDataAdmissionDiagnostics(),
        ),
        errorMessage: getErrorMessage(error),
      });
    }
  }

  return {
    underlying,
    startedAt,
    finishedAt: new Date(),
    config: {
      lineBudgets,
      maxDte,
      expirationScanCount,
      strikeCoverage,
      scannerIntervalMs: runtimeConfig.scannerIntervalMs,
    },
    results,
  };
}
