import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS,
  evaluatePyrusSignalsSignals,
  PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
  type PyrusSignalsSignalEvent,
} from "@workspace/pyrus-signals-core";
import {
  resolveSignalOptionsExecutionProfile,
  type SignalOptionsExecutionProfile,
} from "@workspace/backtest-core";
import {
  addTradingDays,
  listNyseEarlyCloses,
  previousTradingDayOrSame,
  resolveUsEquityMarketSession,
  resolveUsEquityMarketStatus,
  rthBarsBack,
} from "@workspace/market-calendar";
import {
  calculateTransferAdjustedReturnSeries,
  externalTransferAmount,
} from "@workspace/account-math";
import {
  algoDeploymentsTable,
  backtestRunPointsTable,
  db,
  dbTrading,
  pool,
  executionEventsTable,
  shadowAccountsTable,
  shadowBalanceSnapshotsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
  type AlgoDeployment,
  type ExecutionEvent,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { getMassiveRuntimeConfig, type RuntimeMode } from "../lib/runtime";
import {
  createTransientPostgresBackoff,
  isPoolContentionError,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import { asRecord as readRecord, normalizeSymbol } from "../lib/values";
import type {
  BrokerBarSnapshot,
  BrokerPositionSnapshot,
  OptionChainContract,
  PlaceOrderInput,
  QuoteSnapshot,
} from "../providers/ibkr/client";
import {
  declareIbkrLiveDemand,
  readIbkrLiveDemandState,
} from "./option-quote-demand-coordinator";
import {
  notifyShadowAccountChanged,
  type ShadowAccountChangeReason,
} from "./shadow-account-events";
import { loadStoredMarketBars } from "./market-data-store";
import type { MarketDataIntent } from "./market-data-admission";
import {
  normalizeLegacyAlgoBranding,
  normalizeLegacyAlgoBrandText,
} from "./algo-branding";
import { notifyAlgoCockpitChanged } from "./algo-cockpit-events";
import {
  computeSignalOptionsPositionStop,
  type SignalOptionsEntryQuality,
} from "./signal-options-exit-policy";
import {
  batchOptionChains,
  getBars,
  getOptionChartBarsWithDebug,
  getQuoteSnapshots,
  listWatchlists,
} from "./platform";
import {
  accountBenchmarkLimitForRange,
  accountBenchmarkTimeframeForRange,
  accountRangeStart,
  accountSnapshotBucketSizeMs,
  normalizeAccountRange,
  type AccountRange,
} from "./account-ranges";
import { buildPositionQuoteFromSnapshot } from "./account-position-model";
import { fetchBridgeOptionQuoteSnapshots } from "./bridge-option-quote-stream";
import {
  betaForSymbol,
  buildNotionalExposure,
  hasOptionContract,
  scaleOptionGreek,
  sumNullableValues,
  type PositionGreekSnapshot,
} from "./account-risk-model";
import {
  resolveAccountGreekScenarios,
  type AccountGreekScenarios,
} from "./account-greek-scenarios";
import { resolveAccountPortfolioRisk } from "./account-portfolio-risk";
import { buildAccountRiskRecommendations } from "./account-risk-recommendations";
import { getApiResourcePressureSnapshot } from "./resource-pressure";
import {
  currentShadowAccountId,
  runWithShadowAccountId,
} from "./shadow-account-context";
import { requireCurrentAppUserId } from "./app-user-context";
import {
  accountPositionTypeDisplayLabel,
  accountPositionTypeMatchesFilter,
  classifyAccountPositionType,
  normalizeAccountPositionTypeFilter,
  type AccountPositionTypeFilter,
} from "./account-position-type";

export const SHADOW_ACCOUNT_ID = "shadow";
export const SHADOW_ACCOUNT_DISPLAY_NAME = "Shadow";
export const SHADOW_STARTING_BALANCE = 25_000;
export const SHADOW_EQUITY_COLOR = "#ec4899";

const SHADOW_CURRENCY = "USD";
const SIGNAL_OPTIONS_BACKFILL_SOURCE = "signal_options_backfill";
const STOCK_FIXED_COMMISSION_PER_SHARE = 0.005;
const STOCK_FIXED_COMMISSION_MIN = 1;
const STOCK_FIXED_COMMISSION_MAX_RATE = 0.01;
const OPTION_FIXED_COMMISSION_PER_CONTRACT = 0.65;
const OPTION_ORF_PER_CONTRACT = 0.02295;
const WATCHLIST_BACKTEST_SOURCE = "watchlist_backtest";
const WATCHLIST_BACKTEST_MARK_SOURCE = "watchlist_backtest_mark";
export const SIGNAL_OPTIONS_REPLAY_SOURCE = "signal_options_replay";
export const SIGNAL_OPTIONS_REPLAY_MARK_SOURCE = "signal_options_replay_mark";
const SHADOW_EQUITY_FORWARD_POSITION_PREFIX = "shadow_equity_forward:";
const WATCHLIST_BACKTEST_TIMEFRAME_MS: Record<ShadowWatchlistBacktestTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
const WATCHLIST_BACKTEST_COMPLETED_BAR_SAFETY_MS = 2_000;
const WATCHLIST_BACKTEST_MAX_BAR_LIMIT = 50_000;
const WATCHLIST_BACKTEST_HYDRATION_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;
const WATCHLIST_BACKTEST_MAX_POSITION_FRACTION = 0.1;
const WATCHLIST_BACKTEST_MAX_OPEN_POSITIONS = 10;
const WATCHLIST_BACKTEST_TARGET_OUTPERFORMANCE_MULTIPLE = 1.5;
const WATCHLIST_BACKTEST_TIME_ZONE = "America/New_York";
const SHADOW_OPTION_EXTENDED_CLOSE_UNDERLYINGS = new Set([
  "DIA",
  "IWM",
  "QQQ",
  "SPY",
]);
const WATCHLIST_BACKTEST_OUTSIDE_RTH = false;
const WATCHLIST_BACKTEST_PROXY_SYMBOLS = ["VXX", "SQQQ"] as const;
const WATCHLIST_BACKTEST_PROXY_TIMEFRAMES = ["5m", "15m", "1h"] as const;
const WATCHLIST_BACKTEST_REGIME_ACTIONS = [
  "pause_new_longs",
  "exit_longs_buy_proxy",
  "scale_down_longs",
] as const;
const WATCHLIST_BACKTEST_REGIME_EXPIRATIONS = [
  "until_proxy_sell",
  "fixed_12_5m_bars",
  "session_close",
] as const;
const WATCHLIST_BACKTEST_SCALE_DOWN_FRACTION = 0.5;
const WATCHLIST_BACKTEST_FIXED_REGIME_BARS = 12;
const SHADOW_ORDER_HISTORY_LIMIT = 5_000;
const SHADOW_STATE_REFRESH_TTL_MS = 2_000;
const SHADOW_BENCHMARK_BARS_CACHE_TTL_MS = 60_000;
const SHADOW_BENCHMARK_BARS_MAX_WAIT_MS = 750;
const SHADOW_EQUITY_HISTORY_MARK_REFRESH_MAX_WAIT_MS = 1_000;
const SHADOW_SUMMARY_EQUITY_HISTORY_MAX_WAIT_MS = 500;
const SHADOW_DAY_CHANGE_QUOTE_MAX_WAIT_MS = 1_250;
const SHADOW_DAY_CHANGE_QUOTE_TASK_MAX_WAIT_MS = Math.max(
  250,
  SHADOW_DAY_CHANGE_QUOTE_MAX_WAIT_MS - 100,
);
const SHADOW_VISIBLE_OPTION_QUOTE_TASK_MAX_WAIT_MS = 3_000;
const SHADOW_GREEK_QUOTE_MAX_WAIT_MS = 3_500;
const SHADOW_GREEK_QUOTE_TASK_MAX_WAIT_MS = Math.max(
  500,
  SHADOW_GREEK_QUOTE_MAX_WAIT_MS - 250,
);
const SHADOW_UNDERLYING_QUOTE_MAX_WAIT_MS = 750;
const SHADOW_EQUITY_POSITION_QUOTE_MAX_WAIT_MS = 750;
const SHADOW_OPTION_DAY_CHANGE_BAR_LOOKBACK_WEEKDAYS = 5;
const SHADOW_OPTION_DAY_CHANGE_BAR_LIMIT = 3_000;
const SHADOW_ACCOUNT_DB_FALLBACK_REASON =
  "Shadow account database is unavailable; using runtime-only shadow account fallback.";
const SIGNAL_OPTIONS_SHADOW_ENTRY_EVENT = "signal_options_shadow_entry";
const SIGNAL_OPTIONS_SHADOW_EXIT_EVENT = "signal_options_shadow_exit";
const SIGNAL_OPTIONS_SHADOW_MARK_EVENT = "signal_options_shadow_mark";
const SIGNAL_OPTIONS_SHADOW_ENTRY_EXIT_EVENT_PREDICATE = sql`${executionEventsTable.eventType} IN ('signal_options_shadow_entry', 'signal_options_shadow_exit')`;
const SIGNAL_OPTIONS_SHADOW_MARK_EVENT_PREDICATE = sql`${executionEventsTable.eventType} = 'signal_options_shadow_mark'`;
const SHADOW_AUTOMATION_MIRROR_REPAIR_LIMIT = 10_000;
const SHADOW_AUTOMATION_MIRROR_REPAIR_TTL_MS = 60_000;

const shadowAccountDbBackoff = createTransientPostgresBackoff({
  warningCooldownMs: 60_000,
});

type OrderTab = "working" | "history";
type ShadowAssetClass = "equity" | "option";
type ShadowSide = "buy" | "sell";
type ShadowOrderSource =
  | "manual"
  | "automation"
  | "watchlist_backtest"
  | "signal_options_replay";
type ShadowOptionContract = NonNullable<PlaceOrderInput["optionContract"]>;
type ShadowBenchmarkBars = Awaited<ReturnType<typeof getBars>>["bars"];
type ShadowOrderInput = Omit<PlaceOrderInput, "accountId" | "mode"> & {
  accountId?: string | null;
  mode?: RuntimeMode;
  source?: ShadowOrderSource;
  sourceEventId?: string | null;
  clientOrderId?: string | null;
  positionKey?: string | null;
  requestedFillPrice?: number | null;
  payload?: Record<string, unknown>;
  placedAt?: Date | null;
};

export type ShadowOptionMaintenanceSummary = {
  checkedCount: number;
  dueCount: number;
  closedCount: number;
  skippedCount: number;
  orphanCount: number;
  // Fix B(i): lingering breached-stop positions force-closed at best-available price.
  forceClosedCount: number;
  // Fix B(ii): closed-without-exit rows healed with a missing ledger-sync exit event.
  reconciledCount: number;
  errors: Array<{
    positionId: string;
    symbol: string;
    reason: string;
  }>;
};

type ShadowPositionRow = typeof shadowPositionsTable.$inferSelect;
type ShadowPositionMarkRow = typeof shadowPositionMarksTable.$inferSelect;
type ShadowAccountRow = typeof shadowAccountsTable.$inferSelect;
type ShadowFillRow = typeof shadowFillsTable.$inferSelect;
type ShadowOrderRow = typeof shadowOrdersTable.$inferSelect;
type ShadowBalanceSnapshotRow = typeof shadowBalanceSnapshotsTable.$inferSelect;

type ShadowPositionDayChange = {
  dayChange: number | null;
  dayChangePercent: number | null;
};

type ShadowQuoteDayChangeInput = {
  quantity: number;
  multiplier: number;
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined;
};

type ShadowOptionPricingPolicy = {
  valuationMark: number | null;
  valuationEligible: boolean;
  valuationSource: string;
  valuationReason: string;
  quoteMark: number | null;
  quoteBid: number | null;
  quoteAsk: number | null;
  quoteMid: number | null;
  quoteSource: string;
  quoteFreshness: string | null;
  marketDataMode: string | null;
  quoteAsOf: Date | null;
};

type ShadowResolvedMark = {
  price: number | null;
  bid: number | null;
  ask: number | null;
  source: string;
  asOf: Date;
};

type ShadowPositionMarkRefreshWrite = {
  position: ShadowPositionRow;
  contract: ShadowOptionContract | null;
  optionQuote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined;
  optionPricing: ShadowOptionPricingPolicy | null;
  markPrice: number;
  mark: string;
  marketValue: string;
  unrealizedPnl: string;
  source: string;
  asOf: Date;
  updatedAt: Date;
};

type SignalOptionsShadowMarkExitContext = {
  deployment: AlgoDeployment;
  profile: SignalOptionsExecutionProfile;
  entryOrder: ShadowOrderRow;
  entryEvent: ExecutionEvent | null;
  signalQuality: SignalOptionsEntryQuality | null;
};

type ShadowTotals = {
  cash: number;
  startingBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
  marketValue: number;
  netLiquidation: number;
  updatedAt: Date;
};

type ShadowAutomationMirrorRepairSummary = {
  checkedCount: number;
  missingCount: number;
  repairedCount: number;
  errorCount: number;
};

let shadowAutomationMirrorRepairInFlight: Promise<ShadowAutomationMirrorRepairSummary> | null =
  null;
let shadowAutomationMirrorRepairCheckedAt = 0;

function buildFallbackShadowTotals(now = new Date()): ShadowTotals {
  return {
    cash: SHADOW_STARTING_BALANCE,
    startingBalance: SHADOW_STARTING_BALANCE,
    realizedPnl: 0,
    unrealizedPnl: 0,
    fees: 0,
    marketValue: 0,
    netLiquidation: SHADOW_STARTING_BALANCE,
    updatedAt: now,
  };
}

function isShadowAccountDbBackoffActive(nowMs = Date.now()): boolean {
  return shadowAccountDbBackoff.isActive(nowMs);
}

function markShadowAccountDbUnavailable(error: unknown): void {
  // Pool-acquire timeouts mean the connection pool is momentarily saturated, not
  // that Postgres is down. Treat them as a per-read "busy" condition and do NOT
  // arm the global DB-unavailable backoff, which would otherwise poison every
  // other shadow read for the full backoff window under sustained load.
  if (isPoolContentionError(error)) {
    logger.debug?.(
      { err: error },
      "Shadow read deferred on pool contention; not arming DB-unavailable backoff",
    );
    return;
  }
  shadowAccountDbBackoff.markFailure({
    error,
    logger,
    message: "Shadow account database unavailable; using runtime fallback",
    nowMs: Date.now(),
  });
}

function clearShadowAccountDbBackoff(): void {
  shadowAccountDbBackoff.clear();
}

type WatchlistBacktestStartingBook = {
  totals: ShadowTotals;
  baseMarketValue: number;
  existingOpenPositionCount: number;
  existingOpenSymbols: string[];
};

type ShadowFillPlan = {
  price: number;
  fees: number;
  grossAmount: number;
  cashDelta: number;
  realizedPnl: number;
  multiplier: number;
  positionKey: string;
  markSource: string;
};

type ShadowTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ShadowWatchlistBacktestTimeframe = "1m" | "5m" | "15m" | "1h" | "1d";

type WatchlistBacktestRiskOverlay = {
  label: string;
  stopLossPercent: number | null;
  trailingStopPercent: number | null;
  sellSignalTrailingStopPercent: number | null;
};

type WatchlistBacktestSizingOverlay = {
  label: string;
  maxPositionFraction: number;
  maxOpenPositions: number;
  cashOnly: true;
};

type WatchlistBacktestSelectionMode =
  | "first_signal"
  | "ranked_batch"
  | "ranked_rebalance";

type WatchlistBacktestSelectionOverlay = {
  label: string;
  mode: WatchlistBacktestSelectionMode;
  minScoreEdge: number;
};

type WatchlistBacktestEntryGateOverlay = {
  label: string;
  emaFastWindow: number;
  emaSlowWindow: number;
  minConfirmations: number;
  adxMin: number;
  volatilityScoreMin: number;
  volatilityScoreMax: number;
};

const DEFAULT_WATCHLIST_BACKTEST_SIZING: WatchlistBacktestSizingOverlay = {
  label: "P10x10",
  maxPositionFraction: WATCHLIST_BACKTEST_MAX_POSITION_FRACTION,
  maxOpenPositions: WATCHLIST_BACKTEST_MAX_OPEN_POSITIONS,
  cashOnly: true,
};

const DEFAULT_WATCHLIST_BACKTEST_SELECTION: WatchlistBacktestSelectionOverlay = {
  label: "FIFO",
  mode: "first_signal",
  minScoreEdge: 0,
};

type WatchlistBacktestProxySymbol = (typeof WATCHLIST_BACKTEST_PROXY_SYMBOLS)[number];
type WatchlistBacktestRegimeAction =
  (typeof WATCHLIST_BACKTEST_REGIME_ACTIONS)[number];
type WatchlistBacktestRegimeExpiration =
  (typeof WATCHLIST_BACKTEST_REGIME_EXPIRATIONS)[number];

type WatchlistBacktestRegimeOverlay = {
  label: string;
  proxySymbol: WatchlistBacktestProxySymbol;
  signalTimeframe: ShadowWatchlistBacktestTimeframe;
  action: WatchlistBacktestRegimeAction;
  expiration: WatchlistBacktestRegimeExpiration;
  fixedBars: number;
  scaleDownFraction: number;
};

type WatchlistBacktestFill = {
  symbol: string;
  side: ShadowSide;
  quantity: number;
  price: number;
  fees: number;
  grossAmount: number;
  cashDelta: number;
  realizedPnl: number;
  positionKey: string;
  placedAt: Date;
  signalAt: Date;
  signalPrice: number | null;
  signalClose: number | null;
  signalScore?: number | null;
  signalScoreDetails?: Record<string, number> | null;
  watchlists: Array<{ id: string; name: string }>;
  fillSource: string;
  regime?: Record<string, unknown> | null;
};

type WatchlistBacktestSkip = {
  symbol: string;
  reason: string;
  detail: string;
  signalAt?: Date | null;
  watchlists?: Array<{ id: string; name: string }>;
};

type WatchlistBacktestSignalCandidate = {
  symbol: string;
  side: ShadowSide;
  signal: PyrusSignalsSignalEvent;
  signalAt: Date;
  signalPrice: number | null;
  signalClose: number | null;
  fillPrice: number;
  placedAt: Date;
  fillSource: string;
  timeframe: ShadowWatchlistBacktestTimeframe;
  watchlists: Array<{ id: string; name: string }>;
  signalScore: number;
  signalScoreDetails: Record<string, number>;
};

type WatchlistBacktestPreparedBar = {
  bar: PyrusSignalsBar;
  at: Date;
  atMs: number;
};

// Slice 5.5: per-account (keyed by the resolved shadow account id) so a user's
// fresh totals + in-flight compute can never be served to another. Platform-scoped
// callers (background/marketing) share the "shadow" key, matching prior behavior.
const shadowFreshStateCache = new Map<
  string,
  {
    totals: ShadowTotals;
    expiresAt: number;
  }
>();
const shadowFreshStateInFlight = new Map<string, Promise<ShadowTotals>>();
let shadowFreshStateCacheVersion = 0;
let shadowPositionMarkRefreshInFlight:
  | Promise<Awaited<ReturnType<typeof refreshShadowPositionMarks>>>
  | null = null;
const SHADOW_READ_CACHE_TTL_MS = 2_500;
const SHADOW_READ_CACHE_STALE_TTL_MS = 60_000;
const SHADOW_READ_CACHE_STALE_WAIT_MS = 1_500;
const SHADOW_DERIVED_READ_CACHE_TTL_MS = 30_000;
const SHADOW_LEDGER_DASHBOARD_READ_LIMIT = Math.max(
  1_000,
  Number(process.env["SHADOW_LEDGER_DASHBOARD_READ_LIMIT"]) || 20_000,
);
const SHADOW_TRADE_DIAGNOSTICS_CACHE_TTL_MS = 30_000;
const SHADOW_TRADE_DIAGNOSTICS_CACHE_STALE_TTL_MS = 300_000;
const SHADOW_OPTION_QUOTE_CACHE_TTL_MS = 15_000;
const SHADOW_OPTION_QUOTE_STALE_TTL_MS = 60_000;
const SHADOW_OPTION_PROVIDER_ID_CACHE_TTL_MS = 60 * 60_000;
const shadowReadCache = new Map<
  string,
  {
    cachedAt: number;
    expiresAt: number;
    staleExpiresAt: number;
    value: unknown;
  }
>();
const shadowReadInFlight = new Map<string, Promise<unknown>>();
let shadowReadCacheVersion = 0;
// Mark refreshes only invalidate the SHADOW_MARK_REFRESH_CACHE_KEY_PREFIXES keys
// (open-position valuation/totals). A separate counter lets an in-flight compute
// for a NON-mark-affected key (e.g. equity-history, dashboard) still be stored
// when a mark tick lands mid-flight, instead of being discarded by the coarse
// global version guard and re-missing on every subsequent read.
let shadowReadMarkRefreshVersion = 0;
let shadowReadCacheTtlMsForTests: number | null = null;
let shadowReadCacheStaleTtlMsForTests: number | null = null;
let shadowReadCacheStaleWaitMsForTests: number | null = null;
let shadowOptionQuoteCacheTtlMsForTests: number | null = null;
let shadowOptionQuoteCacheStaleTtlMsForTests: number | null = null;
let resolveEquityMarkForTests:
  | ((
      symbol: string,
      position: ShadowPositionRow,
    ) => Promise<ShadowResolvedMark> | ShadowResolvedMark)
  | null = null;
// Mark refresh mutates open-position valuation and account totals. It does not
  // mutate orders/fills, and equity-history has its own derived-read TTL; expiring
  // those on every mark tick made the marketing stream rebuild expensive DB reads
  // every 5s.
const SHADOW_MARK_REFRESH_CACHE_KEY_PREFIXES = [
  "allocation:",
  "ledger-bundle:",
  "open-positions:",
  "positions:",
  "positions-fast:",
  "risk:",
  "summary:",
] as const;

function shadowOptionQuoteCacheTtlMs() {
  return shadowOptionQuoteCacheTtlMsForTests ?? SHADOW_OPTION_QUOTE_CACHE_TTL_MS;
}

function shadowOptionQuoteCacheStaleTtlMs() {
  return (
    shadowOptionQuoteCacheStaleTtlMsForTests ??
    SHADOW_OPTION_QUOTE_STALE_TTL_MS
  );
}
type ShadowReadCacheOptions = {
  allowStale?: (value: unknown) => boolean;
  staleStrategy?: "wait" | "immediate" | "never";
  ttlMs?: number;
  staleTtlMs?: number;
};
type ShadowReadDiagnosticStatus =
  | "cache_hit"
  | "cache_miss"
  | "inflight_join"
  | "operation"
  | "error";
type ShadowReadDiagnosticEvent = {
  key: string;
  route: string;
  status: ShadowReadDiagnosticStatus;
  durationMs: number;
  servedStale: boolean;
  cacheAgeMs: number | null;
  observedAt: Date;
};
type ShadowReadDiagnosticStats = {
  route: string;
  count: number;
  hitCount: number;
  missCount: number;
  inFlightJoinCount: number;
  operationCount: number;
  staleServedCount: number;
  errorCount: number;
  totalMs: number;
  maxMs: number;
  samplesMs: number[];
  lastKey: string;
  lastStatus: ShadowReadDiagnosticStatus;
  lastDurationMs: number;
  lastSeenAt: Date;
};
const SHADOW_READ_DIAGNOSTIC_RECENT_LIMIT = 80;
const SHADOW_READ_DIAGNOSTIC_SAMPLE_LIMIT = 120;
const shadowReadDiagnosticRecent: ShadowReadDiagnosticEvent[] = [];
const shadowReadDiagnosticStatsByRoute = new Map<
  string,
  ShadowReadDiagnosticStats
>();
const shadowOptionQuoteCache = new Map<
  string,
  {
    expiresAt: number;
    staleExpiresAt: number;
    quote: Partial<QuoteSnapshot> | Record<string, unknown>;
  }
>();
const shadowOptionGreekQuoteCache = new Map<
  string,
  {
    expiresAt: number;
    quote: Partial<QuoteSnapshot> | Record<string, unknown>;
  }
>();
const shadowOptionProviderIdCache = new Map<
  string,
  {
    expiresAt: number;
    providerContractId: string;
  }
>();
const shadowBenchmarkBarsCache = new Map<
  string,
  { expiresAt: number; bars: ShadowBenchmarkBars }
>();
const shadowBenchmarkBarsInFlight = new Map<
  string,
  Promise<ShadowBenchmarkBars | null>
>();
type SignalOptionsTrailingStopEnforcementFailureDiagnostic = {
  positionId: string;
  symbol: string;
  message: string;
  name: string | null;
  markPrice: number;
  markAt: Date;
  observedAt: Date;
};
const signalOptionsTrailingStopEnforcementFailures: {
  count: number;
  recent: SignalOptionsTrailingStopEnforcementFailureDiagnostic[];
} = {
  count: 0,
  recent: [],
};
const SIGNAL_OPTIONS_TRAILING_STOP_ENFORCEMENT_FAILURE_LIMIT = 20;

function shadowLedgerDashboardReadLimit(): number {
  return SHADOW_LEDGER_DASHBOARD_READ_LIMIT;
}

function invalidateShadowFreshStateCache() {
  // Global clear across accounts is correct (never serves wrong data); per-account
  // invalidation is a later perf optimization, not a leak fix.
  shadowFreshStateCache.clear();
  shadowFreshStateInFlight.clear();
  shadowFreshStateCacheVersion += 1;
  shadowReadCache.clear();
  shadowReadInFlight.clear();
  shadowReadCacheVersion += 1;
}

function invalidateShadowReadCachesAfterBackgroundMarkRefresh() {
  shadowFreshStateCache.clear();
  shadowFreshStateCacheVersion += 1;
  const now = Date.now();
  for (const [key, entry] of shadowReadCache) {
    if (!isShadowReadCacheKeyExpiredByMarkRefresh(key)) {
      continue;
    }
    entry.expiresAt = Math.min(entry.expiresAt, now);
  }
  shadowReadMarkRefreshVersion += 1;
}

function isShadowReadCacheKeyExpiredByMarkRefresh(key: string): boolean {
  // Cache keys are account-partitioned as "<accountId> <route:...>" (Slice 5.5).
  // Match the route prefix after the partition too — plain startsWith stopped
  // matching when the account prefix landed, which silently turned mark-refresh
  // invalidation into a no-op (stale summaries/positions until natural TTL).
  return SHADOW_MARK_REFRESH_CACHE_KEY_PREFIXES.some(
    (prefix) => key.startsWith(prefix) || key.includes(` ${prefix}`),
  );
}

function shadowReadDiagnosticRoute(key: string): string {
  const route = key.split(":")[0]?.trim();
  return route || "unknown";
}

function roundShadowReadDurationMs(startedAt: number, endedAt = Date.now()) {
  return Math.max(0, Math.round(endedAt - startedAt));
}

function shadowReadValueIsMarkedStale(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      ((value as { stale?: unknown }).stale === true ||
        (value as { reason?: unknown }).reason === "shadow_read_stale_cache"),
  );
}

function shadowReadPercentile(samples: number[], percentile: number): number {
  if (!samples.length) {
    return 0;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function recordShadowReadDiagnostic(input: {
  key: string;
  status: ShadowReadDiagnosticStatus;
  startedAt: number;
  servedStale?: boolean;
  cacheAgeMs?: number | null;
  endedAt?: number;
}) {
  const route = shadowReadDiagnosticRoute(input.key);
  const durationMs = roundShadowReadDurationMs(input.startedAt, input.endedAt);
  const observedAt = new Date(input.endedAt ?? Date.now());
  const event: ShadowReadDiagnosticEvent = {
    key: input.key,
    route,
    status: input.status,
    durationMs,
    servedStale: Boolean(input.servedStale),
    cacheAgeMs:
      typeof input.cacheAgeMs === "number"
        ? Math.max(0, Math.round(input.cacheAgeMs))
        : null,
    observedAt,
  };

  shadowReadDiagnosticRecent.push(event);
  while (shadowReadDiagnosticRecent.length > SHADOW_READ_DIAGNOSTIC_RECENT_LIMIT) {
    shadowReadDiagnosticRecent.shift();
  }

  const stats =
    shadowReadDiagnosticStatsByRoute.get(route) ?? {
      route,
      count: 0,
      hitCount: 0,
      missCount: 0,
      inFlightJoinCount: 0,
      operationCount: 0,
      staleServedCount: 0,
      errorCount: 0,
      totalMs: 0,
      maxMs: 0,
      samplesMs: [],
      lastKey: input.key,
      lastStatus: input.status,
      lastDurationMs: durationMs,
      lastSeenAt: observedAt,
    };
  stats.count += 1;
  stats.totalMs += durationMs;
  stats.maxMs = Math.max(stats.maxMs, durationMs);
  stats.lastKey = input.key;
  stats.lastStatus = input.status;
  stats.lastDurationMs = durationMs;
  stats.lastSeenAt = observedAt;
  stats.samplesMs.push(durationMs);
  while (stats.samplesMs.length > SHADOW_READ_DIAGNOSTIC_SAMPLE_LIMIT) {
    stats.samplesMs.shift();
  }
  if (event.status === "cache_hit") {
    stats.hitCount += 1;
  } else if (event.status === "cache_miss") {
    stats.missCount += 1;
  } else if (event.status === "inflight_join") {
    stats.inFlightJoinCount += 1;
  } else if (event.status === "operation") {
    stats.operationCount += 1;
  } else if (event.status === "error") {
    stats.errorCount += 1;
  }
  if (event.servedStale) {
    stats.staleServedCount += 1;
  }
  shadowReadDiagnosticStatsByRoute.set(route, stats);
}

export function getShadowAccountReadDiagnostics() {
  const routes = Array.from(shadowReadDiagnosticStatsByRoute.values())
    .map((stats) => ({
      route: stats.route,
      count: stats.count,
      hitCount: stats.hitCount,
      missCount: stats.missCount,
      inFlightJoinCount: stats.inFlightJoinCount,
      operationCount: stats.operationCount,
      staleServedCount: stats.staleServedCount,
      errorCount: stats.errorCount,
      averageMs: stats.count ? Math.round(stats.totalMs / stats.count) : 0,
      p95Ms: shadowReadPercentile(stats.samplesMs, 95),
      maxMs: stats.maxMs,
      lastKey: stats.lastKey,
      lastStatus: stats.lastStatus,
      lastDurationMs: stats.lastDurationMs,
      lastSeenAt: stats.lastSeenAt,
    }))
    .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime());

  return {
    cache: {
      entries: shadowReadCache.size,
      inFlight: shadowReadInFlight.size,
      version: shadowReadCacheVersion,
      ttlMs: shadowReadCacheTtlMs(),
      staleTtlMs: shadowReadCacheStaleTtlMs(),
      staleWaitMs: shadowReadStaleWaitMs(),
    },
    recent: shadowReadDiagnosticRecent.map((event) => ({ ...event })),
    routes,
  };
}

function resetShadowAccountReadDiagnosticsForTests() {
  shadowReadDiagnosticRecent.length = 0;
  shadowReadDiagnosticStatsByRoute.clear();
}

async function withShadowReadCache<T>(
  rawKey: string,
  factory: () => Promise<T>,
  options: ShadowReadCacheOptions = {},
): Promise<T> {
  // Slice 5.5: partition every read cache + in-flight join by the resolved account
  // so one user's cached ledger can never be served to another. Defaults to the
  // platform account (background/marketing/unauthenticated), preserving prior keys.
  const key = `${currentShadowAccountId()} ${rawKey}`;
  const now = Date.now();
  const cached = shadowReadCache.get(key);
  if (cached && cached.expiresAt > now) {
    recordShadowReadDiagnostic({
      key,
      status: "cache_hit",
      startedAt: now,
      cacheAgeMs: now - cached.cachedAt,
    });
    return cached.value as T;
  }
  if (cached && cached.staleExpiresAt <= now) {
    shadowReadCache.delete(key);
  }
  const inFlight = shadowReadInFlight.get(key);
  if (inFlight) {
    const startedAt = Date.now();
    try {
      const value = await resolveShadowReadRequest(
        inFlight as Promise<T>,
        cached,
        options,
      );
      recordShadowReadDiagnostic({
        key,
        status: "inflight_join",
        startedAt,
        servedStale: shadowReadValueIsMarkedStale(value),
        cacheAgeMs: cached ? startedAt - cached.cachedAt : null,
      });
      return value;
    } catch (error) {
      recordShadowReadDiagnostic({
        key,
        status: "error",
        startedAt,
        cacheAgeMs: cached ? startedAt - cached.cachedAt : null,
      });
      throw error;
    }
  }
  const version = shadowReadCacheVersion;
  const markRefreshVersion = shadowReadMarkRefreshVersion;
  const markRefreshAffected = isShadowReadCacheKeyExpiredByMarkRefresh(key);
  const startedAt = Date.now();
  const request = factory()
    .then((value) => {
      const serveCachedValue =
        cached &&
        cached.staleExpiresAt > Date.now() &&
        options.allowStale &&
        options.allowStale(cached.value) &&
        !options.allowStale(value);
      if (serveCachedValue) {
        return markShadowReadValueStale(cached.value as T, {
          cachedAt: cached.cachedAt,
          now: Date.now(),
        });
      }
      if (
        version === shadowReadCacheVersion &&
        (!markRefreshAffected ||
          markRefreshVersion === shadowReadMarkRefreshVersion)
      ) {
        const cachedAt = Date.now();
        shadowReadCache.set(key, {
          value,
          cachedAt,
          expiresAt: cachedAt + shadowReadCacheTtlMs(options),
          staleExpiresAt: cachedAt + shadowReadCacheStaleTtlMs(options),
        });
      }
      return value;
    })
    .finally(() => {
      if (shadowReadInFlight.get(key) === request) {
        shadowReadInFlight.delete(key);
      }
    });
  shadowReadInFlight.set(key, request);
  request.catch((error) => {
    logger.debug({ err: error, key }, "Shadow account cached read failed");
  });
  try {
    const value = await resolveShadowReadRequest(request, cached, options);
    recordShadowReadDiagnostic({
      key,
      status: "cache_miss",
      startedAt,
      servedStale: shadowReadValueIsMarkedStale(value),
      cacheAgeMs: cached ? startedAt - cached.cachedAt : null,
    });
    return value;
  } catch (error) {
    recordShadowReadDiagnostic({
      key,
      status: "error",
      startedAt,
      cacheAgeMs: cached ? startedAt - cached.cachedAt : null,
    });
    throw error;
  }
}

function shadowReadCacheTtlMs(options: ShadowReadCacheOptions = {}): number {
  if (typeof options.ttlMs === "number") {
    return Math.max(0, options.ttlMs);
  }
  return shadowReadCacheTtlMsForTests ?? SHADOW_READ_CACHE_TTL_MS;
}

function shadowReadCacheStaleTtlMs(options: ShadowReadCacheOptions = {}): number {
  if (typeof options.staleTtlMs === "number") {
    return Math.max(0, options.staleTtlMs);
  }
  return shadowReadCacheStaleTtlMsForTests ?? SHADOW_READ_CACHE_STALE_TTL_MS;
}

function shadowReadStaleWaitMs(): number {
  return shadowReadCacheStaleWaitMsForTests ?? SHADOW_READ_CACHE_STALE_WAIT_MS;
}

function markShadowReadValueStale<T>(
  value: T,
  input: { cachedAt: number; now: number },
): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = { ...(value as Record<string, unknown>) };
  record["degraded"] = true;
  record["stale"] = true;
  record["reason"] = "shadow_read_stale_cache";
  if ("isStale" in record) {
    record["isStale"] = true;
  }
  if ("staleReason" in record) {
    record["staleReason"] = "shadow_read_stale_cache";
  }
  if ("debug" in record) {
    const debug =
      record["debug"] && typeof record["debug"] === "object"
        ? { ...(record["debug"] as Record<string, unknown>) }
        : {};
    debug["message"] =
      "Shadow account read exceeded its response budget; serving cached data.";
    debug["code"] = "shadow_read_stale_cache";
    debug["timeoutMs"] = shadowReadStaleWaitMs();
    debug["cacheAgeMs"] = Math.max(0, input.now - input.cachedAt);
    record["debug"] = debug;
  }
  return record as T;
}

async function resolveShadowReadRequest<T>(
  request: Promise<T>,
  cached:
    | {
        cachedAt: number;
        staleExpiresAt: number;
        value: unknown;
      }
    | undefined,
  options: ShadowReadCacheOptions = {},
): Promise<T> {
  const now = Date.now();
  if (!cached || cached.staleExpiresAt <= now) {
    return request;
  }
  if (options.allowStale && !options.allowStale(cached.value)) {
    return request;
  }
  if (options.staleStrategy === "immediate") {
    return markShadowReadValueStale(cached.value as T, {
      cachedAt: cached.cachedAt,
      now,
    });
  }
  if (options.staleStrategy === "never") {
    return request;
  }

  return Promise.race([
    request,
    new Promise<T>((resolve) => {
      const timeout = setTimeout(() => {
        resolve(
          markShadowReadValueStale(cached.value as T, {
            cachedAt: cached.cachedAt,
            now: Date.now(),
          }),
        );
      }, shadowReadStaleWaitMs());
      timeout.unref?.();
    }),
  ]);
}

function shadowReadCacheValueHasRows(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (!value || typeof value !== "object") {
    return true;
  }
  const positions = (value as { positions?: unknown }).positions;
  return Array.isArray(positions) ? positions.length > 0 : true;
}

function trackShadowFreshStateRefresh(
  accountId: string,
  request: Promise<ShadowTotals>,
  version = shadowFreshStateCacheVersion,
) {
  const trackedRequest = request
    .then((totals) => {
      if (version === shadowFreshStateCacheVersion) {
        shadowFreshStateCache.set(accountId, {
          totals,
          expiresAt: Date.now() + SHADOW_STATE_REFRESH_TTL_MS,
        });
      }
      return totals;
    })
    .finally(() => {
      if (shadowFreshStateInFlight.get(accountId) === trackedRequest) {
        shadowFreshStateInFlight.delete(accountId);
      }
    });
  shadowFreshStateInFlight.set(accountId, trackedRequest);
  return trackedRequest;
}

function kickShadowPositionMarkRefresh() {
  if (shadowPositionMarkRefreshInFlight) {
    return shadowPositionMarkRefreshInFlight;
  }

  shadowPositionMarkRefreshInFlight = refreshShadowPositionMarks()
    .catch((error) => {
      logger.debug?.({ err: error }, "Shadow mark refresh failed");
      return { updatedCount: 0 };
    })
    .finally(() => {
      shadowPositionMarkRefreshInFlight = null;
    });

  return shadowPositionMarkRefreshInFlight;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function money(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function cents(value: number): number {
  return Number(value.toFixed(2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOrderTab(raw: unknown): OrderTab {
  return raw === "history" ? "history" : "working";
}

function weightPercent(value: number, nav: number | null): number | null {
  return nav && nav !== 0 ? (value / nav) * 100 : null;
}

type ShadowPositionTypeFilter = "option" | "stock" | "etf" | "equity" | "all" | null;

function shadowPositionTypeFilterFromAccountFilter(
  filter: AccountPositionTypeFilter,
): ShadowPositionTypeFilter {
  if (filter.kind === "all") return "all";
  if (filter.kind === "equity") return "equity";
  if (filter.kind === "single") return filter.value;
  return null;
}

function normalizePositionAssetClass(value: unknown): ShadowPositionTypeFilter {
  const filter = normalizeAccountPositionTypeFilter(value);
  if (filter.kind === "invalid") {
    throw new HttpError(400, "Unsupported account position type filter.", {
      code: "invalid_account_position_type",
      detail:
        "Use all, stock, etf, option, or the legacy equity alias for account position filters.",
      expose: true,
    });
  }
  return shadowPositionTypeFilterFromAccountFilter(filter);
}

function shadowPositionType(position: {
  assetClass: string;
  symbol: string;
  positionType?: string | null;
  optionContract?: unknown;
}) {
  return classifyAccountPositionType({
    symbol: position.symbol,
    assetClass: position.assetClass,
    positionType: position.positionType,
    optionContract: position.optionContract,
  });
}

function assetClassLabel(position: {
  assetClass: string;
  symbol: string;
  positionType?: string | null;
  optionContract?: unknown;
}): string {
  return accountPositionTypeDisplayLabel(shadowPositionType(position));
}

function shadowPositionMatchesAssetClass(
  position: {
    assetClass: string;
    symbol: string;
    positionType?: string | null;
    optionContract?: unknown;
  },
  assetClassFilter: ShadowPositionTypeFilter,
): boolean {
  if (!assetClassFilter || assetClassFilter === "all") {
    return true;
  }
  const positionType = shadowPositionType(position);
  if (assetClassFilter === "equity") {
    return accountPositionTypeMatchesFilter(positionType, { kind: "equity" });
  }
  return accountPositionTypeMatchesFilter(positionType, {
    kind: "single",
    value: assetClassFilter,
  });
}

function marketMultiplier(input: {
  assetClass: ShadowAssetClass;
  optionContract?: ShadowOptionContract | null;
}): number {
  if (input.assetClass === "option") {
    return (
      toNumber(input.optionContract?.sharesPerContract) ??
      toNumber(input.optionContract?.multiplier) ??
      100
    );
  }
  return 1;
}

function optionDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function shadowOptionMarketDateKey(value: Date): string {
  return (
    resolveUsEquityMarketStatus(value).calendarDay?.date ??
    marketDateParts(value).key
  );
}

function marketDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return {
    key: `${part("year")}-${part("month")}-${part("day")}`,
    weekday: part("weekday"),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
  };
}

function shadowOptionRegularCloseAt(value: Date): Date | null {
  const status = resolveUsEquityMarketStatus(value);
  const day = status.calendarDay;
  if (!day?.tradingDay || !day.regularCloseAt) {
    return null;
  }
  const earlyClose = listNyseEarlyCloses(Number(day.date.slice(0, 4))).find(
    (close) => close.date === day.date,
  );
  const closeAt = new Date(earlyClose?.regularCloseAt ?? day.regularCloseAt);
  return Number.isNaN(closeAt.getTime()) ? null : closeAt;
}

function isMarketCloseOrLater(value: Date) {
  const closeAt = shadowOptionRegularCloseAt(value);
  if (closeAt) {
    return value.getTime() >= closeAt.getTime();
  }
  return resolveUsEquityMarketStatus(value).calendarDay?.tradingDay === false;
}

function shadowOptionSessionCloseAt(
  value: Date,
  contract?: ShadowOptionContract | null,
): Date | null {
  const regularCloseAt = shadowOptionRegularCloseAt(value);
  if (!regularCloseAt) {
    return null;
  }
  const status = resolveUsEquityMarketStatus(value);
  const underlying = normalizeSymbol(String(contract?.underlying ?? "")).toUpperCase();
  if (
    status.calendarDay?.earlyClose !== true &&
    SHADOW_OPTION_EXTENDED_CLOSE_UNDERLYINGS.has(underlying)
  ) {
    return new Date(regularCloseAt.getTime() + 15 * 60_000);
  }
  return regularCloseAt;
}

function isShadowOptionTradingSession(
  value: Date,
  contract?: ShadowOptionContract | null,
) {
  const session = resolveUsEquityMarketSession(value);
  if (session.key !== "rth" && session.key !== "after") {
    return false;
  }
  const status = resolveUsEquityMarketStatus(value);
  const openAt = status.calendarDay?.regularOpenAt
    ? new Date(status.calendarDay.regularOpenAt)
    : null;
  const closeAt = shadowOptionSessionCloseAt(value, contract);
  if (
    !status.calendarDay?.tradingDay ||
    !openAt ||
    !closeAt ||
    Number.isNaN(openAt.getTime()) ||
    Number.isNaN(closeAt.getTime())
  ) {
    return false;
  }
  const time = value.getTime();
  return time >= openAt.getTime() && time < closeAt.getTime();
}

function shouldCloseOptionForShadowMaintenance(
  contract: ShadowOptionContract,
  now = new Date(),
) {
  const expiration = optionDateKey(contract.expirationDate);
  const marketDate = shadowOptionMarketDateKey(now);
  return expiration < marketDate || (expiration === marketDate && isMarketCloseOrLater(now));
}

function isHistoricalSignalOptionsShadowOrder(order: Pick<ShadowOrderRow, "payload">) {
  const payload = readRecord(order.payload) ?? {};
  const backfill = readRecord(payload.backfill) ?? {};
  const metadata = readRecord(payload.metadata) ?? {};
  const replay = readRecord(payload.replay) ?? {};
  return (
    readString(backfill.source) === SIGNAL_OPTIONS_BACKFILL_SOURCE ||
    readString(backfill.source) === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    readString(metadata.runSource) === SIGNAL_OPTIONS_BACKFILL_SOURCE ||
    readString(metadata.runSource) === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    readString(metadata.sourceType) === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    readString(replay.source) === SIGNAL_OPTIONS_REPLAY_SOURCE
  );
}

function isSignalOptionsBackfillShadowOrder(
  order: Pick<ShadowOrderRow, "payload"> | null | undefined,
) {
  const payload = readRecord(order?.payload) ?? {};
  const backfill = readRecord(payload.backfill) ?? {};
  const metadata = readRecord(payload.metadata) ?? {};
  return (
    readString(backfill.source) === SIGNAL_OPTIONS_BACKFILL_SOURCE ||
    readString(metadata.runSource) === SIGNAL_OPTIONS_BACKFILL_SOURCE
  );
}

function isHistoricalSignalOptionsShadowEvent(
  event: Pick<ExecutionEvent, "payload"> | null | undefined,
) {
  return isHistoricalSignalOptionsShadowOrder({
    payload: event?.payload ?? {},
  } as Pick<ShadowOrderRow, "payload">);
}

function isSignalOptionsAutomationMirrorEvent(event: ExecutionEvent) {
  return (
    (event.eventType === SIGNAL_OPTIONS_SHADOW_ENTRY_EVENT ||
      event.eventType === SIGNAL_OPTIONS_SHADOW_EXIT_EVENT) &&
    !isHistoricalSignalOptionsShadowEvent(event)
  );
}

function shouldRepairSignalOptionsAutomationMirrors(
  source: ShadowSourceScope | null,
) {
  return source == null || source === "automation";
}

async function repairSignalOptionsAutomationMirrorsForRead(
  source: ShadowSourceScope | null,
): Promise<ShadowAutomationMirrorRepairSummary> {
  if (!shouldRepairSignalOptionsAutomationMirrors(source)) {
    return {
      checkedCount: 0,
      missingCount: 0,
      repairedCount: 0,
      errorCount: 0,
    };
  }

  const now = Date.now();
  if (shadowAutomationMirrorRepairInFlight) {
    return shadowAutomationMirrorRepairInFlight;
  }
  if (
    !shadowAutomationMirrorRepairInFlight &&
    now - shadowAutomationMirrorRepairCheckedAt < SHADOW_AUTOMATION_MIRROR_REPAIR_TTL_MS
  ) {
    return {
      checkedCount: 0,
      missingCount: 0,
      repairedCount: 0,
      errorCount: 0,
    };
  }

  shadowAutomationMirrorRepairInFlight = (async () => {
    const candidates = await db
      .select()
      .from(executionEventsTable)
      .where(SIGNAL_OPTIONS_SHADOW_ENTRY_EXIT_EVENT_PREDICATE)
      .orderBy(desc(executionEventsTable.occurredAt))
      .limit(SHADOW_AUTOMATION_MIRROR_REPAIR_LIMIT);
    const events = candidates
      .filter(isSignalOptionsAutomationMirrorEvent)
      .sort(
        (left, right) =>
          left.occurredAt.getTime() - right.occurredAt.getTime(),
      );
    const eventIds = events.map((event) => event.id);
    const mirrored = eventIds.length
      ? await db
          .select({ sourceEventId: shadowOrdersTable.sourceEventId })
          .from(shadowOrdersTable)
          .where(
            and(
              eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID),
              inArray(shadowOrdersTable.sourceEventId, eventIds),
            ),
          )
      : [];
    const mirroredEventIds = new Set(
      mirrored
        .map((row) => row.sourceEventId)
        .filter((id): id is string => Boolean(id)),
    );
    const missing = events.filter((event) => !mirroredEventIds.has(event.id));
    let repairedCount = 0;
    let errorCount = 0;

    for (const event of missing) {
      try {
        const repaired = await recordShadowAutomationEvent(event, {
          source: "automation",
        });
        if (repaired) {
          repairedCount += 1;
        }
      } catch (error) {
        errorCount += 1;
        logger.warn?.(
          { err: error, eventId: event.id, eventType: event.eventType },
          "Failed to repair signal-options Shadow account ledger mirror",
        );
      }
    }

    if (repairedCount > 0) {
      invalidateShadowFreshStateCache();
      notifyShadowAccountChanged();
    }

    return {
      checkedCount: events.length,
      missingCount: missing.length,
      repairedCount,
      errorCount,
    };
  })().finally(() => {
    shadowAutomationMirrorRepairCheckedAt = Date.now();
    shadowAutomationMirrorRepairInFlight = null;
  });

  return shadowAutomationMirrorRepairInFlight;
}

function kickSignalOptionsAutomationMirrorRepairForRead(
  source: ShadowSourceScope | null,
) {
  if (!shouldRepairSignalOptionsAutomationMirrors(source)) {
    return;
  }
  void repairSignalOptionsAutomationMirrorsForRead(source).catch((error) => {
    if (isTransientPostgresError(error)) {
      markShadowAccountDbUnavailable(error);
      return;
    }
    logger.debug?.(
      { err: error, source },
      "Signal-options Shadow account mirror repair failed in background",
    );
  });
}

function shadowDateWindowUtc(value: string | Date): {
  date: string;
  start: Date;
  end: Date;
} {
  const parsed = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "Invalid inspection date.", {
      code: "invalid_shadow_inspection_date",
      expose: true,
    });
  }
  const start = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
  return {
    date: start.toISOString().slice(0, 10),
    start,
    end: new Date(start.getTime() + 24 * 60 * 60_000),
  };
}

function positionKey(input: {
  symbol: string;
  assetClass: ShadowAssetClass;
  optionContract?: ShadowOptionContract | null;
}): string {
  if (input.assetClass === "option" && input.optionContract) {
    return [
      "option",
      normalizeSymbol(input.optionContract.underlying || input.symbol).toUpperCase(),
      optionDateKey(input.optionContract.expirationDate),
      input.optionContract.strike,
      input.optionContract.right,
      input.optionContract.providerContractId || input.optionContract.ticker,
    ].join(":");
  }
  return `equity:${normalizeSymbol(input.symbol).toUpperCase()}`;
}

function normalizeShadowMarketDataSymbol(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || /^twsopt:/i.test(text)) {
    return "";
  }
  return normalizeSymbol(text).toUpperCase();
}

function shadowPositionKeyMarketDataSymbol(positionKey?: string | null): string {
  const [kind, symbol] = String(positionKey ?? "").split(":");
  if ((kind === "option" || kind === "equity") && symbol) {
    return normalizeShadowMarketDataSymbol(symbol);
  }
  return "";
}

function shadowPositionMarketDataSymbol(input: {
  symbol?: unknown;
  optionContract?: unknown;
  positionKey?: string | null;
}): string {
  const contract = asOptionContract(input.optionContract);
  return (
    normalizeShadowMarketDataSymbol(contract?.underlying) ||
    shadowPositionKeyMarketDataSymbol(input.positionKey) ||
    normalizeShadowMarketDataSymbol(input.symbol)
  );
}

function positionDescription(position: ShadowPositionRow): string {
  const contract = asOptionContract(position.optionContract);
  if (!contract) {
    return position.symbol;
  }
  return `${contract.underlying} ${optionDateKey(contract.expirationDate)} ${contract.strike} ${String(contract.right).toUpperCase()}`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readPositiveNumber(value: unknown): number | null {
  const numeric = toNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function isWatchlistBacktestPositionKey(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(`${WATCHLIST_BACKTEST_SOURCE}:`);
}

function isSignalOptionsReplayPositionKey(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(`${SIGNAL_OPTIONS_REPLAY_SOURCE}:`);
}

function isShadowEquityForwardPositionKey(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(SHADOW_EQUITY_FORWARD_POSITION_PREFIX)
  );
}

function isForwardTestShadowOrder(
  order?: Pick<ShadowOrderRow, "payload" | "clientOrderId"> | null,
): boolean {
  const payload = readRecord(order?.payload) ?? {};
  const forwardTest = payload.forwardTest;
  return (
    forwardTest === true ||
    readString(forwardTest)?.toLowerCase() === "true" ||
    Boolean(order?.clientOrderId?.startsWith("shadow-equity-forward-"))
  );
}

function isSimulationShadowOrderSource(source: string | null | undefined): boolean {
  return source === WATCHLIST_BACKTEST_SOURCE || source === SIGNAL_OPTIONS_REPLAY_SOURCE;
}

function shadowPositionKeySource(
  positionKey: string | null | undefined,
): ShadowAttributionSource | null {
  if (isWatchlistBacktestPositionKey(positionKey)) {
    return WATCHLIST_BACKTEST_SOURCE;
  }
  if (isSignalOptionsReplayPositionKey(positionKey)) {
    return SIGNAL_OPTIONS_REPLAY_SOURCE;
  }
  return null;
}

function shadowPayloadEffectiveSource(payload: unknown): ShadowAttributionSource | null {
  const payloadRecord = readRecord(payload) ?? {};
  const metadata = readRecord(payloadRecord.metadata) ?? {};
  const replay = readRecord(payloadRecord.replay) ?? {};
  const backfill = readRecord(payloadRecord.backfill) ?? {};
  const sourceCandidates = [
    readString(payloadRecord.source),
    readString(payloadRecord.sourceType),
    readString(payloadRecord.runSource),
    readString(metadata.source),
    readString(metadata.sourceType),
    readString(metadata.runSource),
    readString(replay.source),
    readString(backfill.source),
  ];

  if (sourceCandidates.includes(SIGNAL_OPTIONS_REPLAY_SOURCE)) {
    return SIGNAL_OPTIONS_REPLAY_SOURCE;
  }
  if (sourceCandidates.includes(WATCHLIST_BACKTEST_SOURCE)) {
    return WATCHLIST_BACKTEST_SOURCE;
  }

  return shadowPositionKeySource(shadowPayloadPositionKey(payload));
}

function shadowOrderEffectiveSource(
  order?: Pick<ShadowOrderRow, "source" | "payload"> | null,
): ShadowAttributionSource {
  const payloadSource = shadowPayloadEffectiveSource(order?.payload);
  if (payloadSource) {
    return payloadSource;
  }
  if (order?.source === WATCHLIST_BACKTEST_SOURCE) {
    return WATCHLIST_BACKTEST_SOURCE;
  }
  if (order?.source === SIGNAL_OPTIONS_REPLAY_SOURCE) {
    return SIGNAL_OPTIONS_REPLAY_SOURCE;
  }
  if (order?.source === "automation") {
    return "automation";
  }
  return "manual";
}

function shadowBalanceSnapshotSourceForOrder(input: {
  source?: ShadowOrderSource | null;
  payload?: unknown;
  positionKey?: string | null;
}) {
  const effectiveSource =
    input.source === SIGNAL_OPTIONS_REPLAY_SOURCE
      ? SIGNAL_OPTIONS_REPLAY_SOURCE
      : input.source === WATCHLIST_BACKTEST_SOURCE
        ? WATCHLIST_BACKTEST_SOURCE
        : shadowPayloadEffectiveSource(input.payload) ??
          shadowPositionKeySource(input.positionKey);

  if (effectiveSource === SIGNAL_OPTIONS_REPLAY_SOURCE) {
    return SIGNAL_OPTIONS_REPLAY_SOURCE;
  }
  if (effectiveSource === WATCHLIST_BACKTEST_SOURCE) {
    return WATCHLIST_BACKTEST_SOURCE;
  }
  return input.source === "automation" ? "automation" : "ledger";
}

function isLiveShadowOrder(order?: ShadowOrderRow | null): boolean {
  const effectiveSource = shadowOrderEffectiveSource(order);
  return (
    !isSimulationShadowOrderSource(effectiveSource) &&
    !isForwardTestShadowOrder(order)
  );
}

function isDefaultShadowLedgerAnalyticsOrder(
  order?: Pick<ShadowOrderRow, "source" | "clientOrderId" | "payload"> | null,
): boolean {
  if (!order || isForwardTestShadowOrder(order)) {
    return false;
  }
  const effectiveSource = shadowOrderEffectiveSource(order);
  return (
    effectiveSource === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    !isSimulationShadowOrderSource(effectiveSource)
  );
}

// Per-order analytics-classification memo for recomputeShadowAccountFromLedger.
// The recompute runs once per automation execution event inside the held write
// transaction; without the memo it re-materialized EVERY historical order's
// ~4KB jsonb payload on every event (1,894 orders ≈ 8.8MB per event, measured
// 2026-07-09 — the top-4 pool consumer in the slow-query firehose) purely to
// re-derive a boolean. The classification inputs (source, clientOrderId,
// payload) only change at placeShadowOrder's source-conflict dedup update,
// which invalidates below; order ids are UUIDs and never reused. Bounded FIFO.
const shadowLedgerAnalyticsOrderMemo = new Map<string, boolean>();
const SHADOW_LEDGER_ANALYTICS_MEMO_MAX = 65_536;
let shadowLedgerAnalyticsMemoGeneration = 0;

export function invalidateShadowLedgerAnalyticsOrderClassification(
  orderId: string,
): void {
  shadowLedgerAnalyticsMemoGeneration += 1;
  shadowLedgerAnalyticsOrderMemo.delete(orderId);
}

function shadowOrderMatchesSource(order: ShadowOrderRow | undefined, source: string) {
  if (!order) {
    return false;
  }
  const effectiveSource = shadowOrderEffectiveSource(order);
  if (source === "automation") {
    return (
      effectiveSource === "automation" &&
      !isForwardTestShadowOrder(order)
    );
  }
  return effectiveSource === source;
}

function isLiveShadowPosition(position: Pick<ShadowPositionRow, "positionKey">): boolean {
  return (
    !isWatchlistBacktestPositionKey(position.positionKey) &&
    !isSignalOptionsReplayPositionKey(position.positionKey) &&
    !isShadowEquityForwardPositionKey(position.positionKey)
  );
}

function isDefaultShadowLedgerAnalyticsPosition(
  position: Pick<ShadowPositionRow, "positionKey">,
): boolean {
  return (
    isLiveShadowPosition(position) ||
    isSignalOptionsReplayPositionKey(position.positionKey)
  );
}

function positionMatchesShadowSource(
  position: Pick<ShadowPositionRow, "positionKey">,
  source: string,
): boolean {
  if (source === WATCHLIST_BACKTEST_SOURCE) {
    return isWatchlistBacktestPositionKey(position.positionKey);
  }
  if (source === SIGNAL_OPTIONS_REPLAY_SOURCE) {
    return isSignalOptionsReplayPositionKey(position.positionKey);
  }
  if (source === "automation") {
    return (
      !isWatchlistBacktestPositionKey(position.positionKey) &&
      !isSignalOptionsReplayPositionKey(position.positionKey) &&
      !isShadowEquityForwardPositionKey(position.positionKey)
    );
  }
  return (
    !isWatchlistBacktestPositionKey(position.positionKey) &&
    !isSignalOptionsReplayPositionKey(position.positionKey) &&
    !isShadowEquityForwardPositionKey(position.positionKey)
  );
}

function shadowMarkSnapshotSourceForPosition(
  position: Pick<ShadowPositionRow, "positionKey">,
) {
  if (isWatchlistBacktestPositionKey(position.positionKey)) {
    return WATCHLIST_BACKTEST_MARK_SOURCE;
  }
  if (isSignalOptionsReplayPositionKey(position.positionKey)) {
    return SIGNAL_OPTIONS_REPLAY_MARK_SOURCE;
  }
  return "mark";
}

function withCurrentOpenPositionTerminalTimestamp(
  totals: ShadowTotals,
  openPositionCount: number,
  now = new Date(),
): ShadowTotals {
  if (openPositionCount <= 0 || totals.updatedAt.getTime() >= now.getTime()) {
    return totals;
  }
  return {
    ...totals,
    updatedAt: now,
  };
}

type ShadowAttributionSource =
  | "manual"
  | "automation"
  | "watchlist_backtest"
  | "signal_options_replay";

type ShadowSourceScope = ShadowAttributionSource;

function normalizeShadowSourceScope(source: string | null | undefined): ShadowSourceScope | null {
  if (
    source === "manual" ||
    source === "automation" ||
    source === WATCHLIST_BACKTEST_SOURCE ||
    source === SIGNAL_OPTIONS_REPLAY_SOURCE
  ) {
    return source;
  }
  return null;
}

function shadowSourceCacheKey(source: string | null | undefined) {
  return normalizeShadowSourceScope(source) ?? "ledger";
}

function isAutomatedShadowSource(source: ShadowOrderSource | null | undefined) {
  return source === "automation" || source === SIGNAL_OPTIONS_REPLAY_SOURCE;
}

function shadowSourceType(order?: ShadowOrderRow | null): ShadowAttributionSource {
  const effectiveSource = shadowOrderEffectiveSource(order);
  if (effectiveSource === "automation") {
    return "automation";
  }
  if (effectiveSource === WATCHLIST_BACKTEST_SOURCE) {
    return WATCHLIST_BACKTEST_SOURCE;
  }
  if (effectiveSource === SIGNAL_OPTIONS_REPLAY_SOURCE) {
    return SIGNAL_OPTIONS_REPLAY_SOURCE;
  }
  return "manual";
}

function shadowSourceLabel(sourceType: string, fallback: string | null = null) {
  if (sourceType === "automation") {
    return "Signal Options";
  }
  if (sourceType === WATCHLIST_BACKTEST_SOURCE) {
    return "Watchlist Backtest";
  }
  if (sourceType === SIGNAL_OPTIONS_REPLAY_SOURCE) {
    return "Options Backtest";
  }
  return fallback;
}

function shadowSourceMetadata(order?: ShadowOrderRow | null) {
  const payload = readRecord(order?.payload) ?? {};
  const candidate = readRecord(payload.candidate) ?? readRecord(payload.automationCandidate) ?? {};
  const position = readRecord(payload.position) ?? {};
  const metadata = readRecord(payload.metadata) ?? {};
  const sourceType = shadowSourceType(order);
  const candidateId =
    readString(candidate.id) ??
    readString(position.candidateId) ??
    readString(payload.candidateId) ??
    readString(metadata.runId);
  const deploymentId =
    readString(candidate.deploymentId) ??
    readString(metadata.deploymentId) ??
    readString(payload.deploymentId);
  const deploymentName =
    readString(candidate.deploymentName) ??
    readString(metadata.deploymentName) ??
    readString(payload.deploymentName);

  return {
    sourceType,
    strategyLabel: shadowSourceLabel(sourceType, candidateId ? "Signal Options" : null),
    candidateId,
    deploymentId,
    deploymentName: deploymentName
      ? normalizeLegacyAlgoBrandText(deploymentName)
      : null,
    sourceEventId: order?.sourceEventId ?? null,
    attributionStatus:
      candidateId ||
      sourceType === "automation" ||
      sourceType === WATCHLIST_BACKTEST_SOURCE ||
      sourceType === SIGNAL_OPTIONS_REPLAY_SOURCE
        ? "attributed"
        : "unknown",
  };
}

function shadowPayloadPositionKey(payload: unknown): string | null {
  const payloadRecord = readRecord(payload) ?? {};
  const metadata = readRecord(payloadRecord.metadata) ?? {};
  const position = readRecord(payloadRecord.position) ?? {};
  return (
    readString(metadata.positionKey) ??
    readString(payloadRecord.positionKey) ??
    readString(position.positionKey)
  );
}

function shadowPositionKeyForOrder(order?: ShadowOrderRow | null): string | null {
  if (!order) {
    return null;
  }
  const payloadKey = shadowPayloadPositionKey(order.payload);
  if (payloadKey) {
    return payloadKey;
  }
  return positionKey({
    symbol: order.symbol,
    assetClass: order.assetClass === "option" ? "option" : "equity",
    optionContract: asOptionContract(order.optionContract),
  });
}

function shadowPositionKeysForOrders(orders: Array<ShadowOrderRow | undefined>) {
  return new Set(
    orders
      .map((order) => shadowPositionKeyForOrder(order))
      .filter((key): key is string => Boolean(key)),
  );
}

function shadowOrdersByPositionKey(orders: Array<ShadowOrderRow | undefined>) {
  const byPositionKey = new Map<string, ShadowOrderRow>();
  orders.forEach((order) => {
    const key = shadowPositionKeyForOrder(order);
    if (!key || !order) {
      return;
    }
    const current = byPositionKey.get(key);
    if (
      !current ||
      order.side === "buy" ||
      isHistoricalSignalOptionsShadowOrder(order)
    ) {
      byPositionKey.set(key, order);
    }
  });
  return byPositionKey;
}

function isExpiredHistoricalShadowOptionPosition(
  position: Pick<ShadowPositionRow, "optionContract">,
  sourceOrder?: ShadowOrderRow | null,
  now = new Date(),
) {
  const contract = asOptionContract(position.optionContract);
  return Boolean(
    contract &&
      isPriorOptionExpiration(contract, now) &&
      sourceOrder &&
      isHistoricalSignalOptionsShadowOrder(sourceOrder),
  );
}

function buildPositionSourceAttribution(
  position: ShadowPositionRow,
  orders: ShadowOrderRow[],
) {
  const key = position.positionKey;
  const buckets = new Map<
    string,
    {
      sourceType: ShadowAttributionSource;
      strategyLabel: string | null;
      candidateId: string | null;
      deploymentId: string | null;
      deploymentName: string | null;
      sourceEventId: string | null;
      quantity: number;
    }
  >();

  orders
    .filter(
      (order) => {
        const payload = readRecord(order.payload) ?? {};
        const metadata = readRecord(payload.metadata) ?? {};
        const attributedPositionKey =
          readString(metadata.positionKey) ?? readString(payload.positionKey);
        return (
          attributedPositionKey ??
          positionKey({
          symbol: order.symbol,
          assetClass: order.assetClass as ShadowAssetClass,
          optionContract: asOptionContract(order.optionContract),
          })
        ) === key;
      },
    )
    .forEach((order) => {
      const metadata = shadowSourceMetadata(order);
      const sourceType =
        metadata.sourceType === "automation" ||
        metadata.sourceType === WATCHLIST_BACKTEST_SOURCE ||
        metadata.sourceType === SIGNAL_OPTIONS_REPLAY_SOURCE
          ? metadata.sourceType
          : "manual";
      const bucketKey = [
        sourceType,
        metadata.strategyLabel ?? "Manual",
        metadata.candidateId ?? "none",
      ].join(":");
      const current =
        buckets.get(bucketKey) ?? {
          sourceType,
          strategyLabel: metadata.strategyLabel,
          candidateId: metadata.candidateId,
          deploymentId: metadata.deploymentId,
          deploymentName:
            typeof metadata.deploymentName === "string"
              ? normalizeLegacyAlgoBrandText(metadata.deploymentName)
              : metadata.deploymentName,
          sourceEventId: metadata.sourceEventId,
          quantity: 0,
        };
      const signedQuantity =
        (toNumber(order.filledQuantity) ?? toNumber(order.quantity) ?? 0) *
        (order.side === "sell" ? -1 : 1);
      current.quantity += signedQuantity;
      buckets.set(bucketKey, current);
    });

  const attribution = Array.from(buckets.values())
    .filter((bucket) => Math.abs(bucket.quantity) > 0.000001)
    .map((bucket) => ({
      ...bucket,
      quantity: Number(bucket.quantity.toFixed(6)),
    }));
  const sourceTypes = new Set(attribution.map((bucket) => bucket.sourceType));
  const hasMultipleAutomationDeployments =
    new Set(
      attribution
        .filter((bucket) => bucket.sourceType === "automation")
        .map((bucket) => bucket.deploymentId ?? bucket.deploymentName ?? "automation"),
    ).size > 1;
  const sourceType =
    sourceTypes.size > 1 || hasMultipleAutomationDeployments
      ? "mixed"
      : attribution[0]?.sourceType ?? "manual";

  return {
    sourceType,
    strategyLabel:
      sourceType === "automation"
        ? attribution[0]?.strategyLabel ?? "Signal Options"
        : sourceType === WATCHLIST_BACKTEST_SOURCE
          ? attribution[0]?.strategyLabel ?? "Watchlist Backtest"
        : sourceType === SIGNAL_OPTIONS_REPLAY_SOURCE
          ? attribution[0]?.strategyLabel ?? "Options Backtest"
        : sourceType === "mixed"
          ? "Mixed"
          : null,
    attributionStatus:
      attribution.length === 0
        ? "unknown"
        : sourceType === "mixed"
          ? "mixed"
          : "attributed",
    sourceAttribution: attribution,
  };
}

function shadowAutomationEventPositionKey(event: ExecutionEvent): string | null {
  const payload = readRecord(event.payload) ?? {};
  const explicit = shadowPayloadPositionKey(payload);
  if (explicit) return explicit;

  const position = readRecord(payload.position) ?? {};
  const contract = asOptionContract(payload.selectedContract ?? position.selectedContract);
  const symbol = normalizeSymbol(
    String(event.symbol ?? position.symbol ?? contract?.underlying ?? ""),
  ).toUpperCase();
  return symbol && contract
    ? positionKey({ symbol, assetClass: "option", optionContract: contract })
    : null;
}

async function latestShadowAutomationManagementEvents(
  positions: ShadowPositionRow[],
  ordersByPositionKey: Map<string, ShadowOrderRow>,
) {
  const automationPositionKeys = new Set(
    positions
      .filter(
        (position) =>
          shadowSourceType(ordersByPositionKey.get(position.positionKey)) === "automation",
      )
      .map((position) => position.positionKey),
  );
  if (!automationPositionKeys.size) {
    return new Map<string, ExecutionEvent>();
  }

  const symbols = Array.from(
    new Set(
      positions
        .filter((position) => automationPositionKeys.has(position.positionKey))
        .map((position) => normalizeSymbol(position.symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
  if (!symbols.length) {
    return new Map<string, ExecutionEvent>();
  }

  const events = await db
    .select()
    .from(executionEventsTable)
    .where(
      and(
        SIGNAL_OPTIONS_SHADOW_MARK_EVENT_PREDICATE,
        inArray(executionEventsTable.symbol, symbols),
      ),
    )
    .orderBy(desc(executionEventsTable.occurredAt))
    .limit(1000);
  const byPositionKey = new Map<string, ExecutionEvent>();
  for (const event of events) {
    const key = shadowAutomationEventPositionKey(event);
    if (key && automationPositionKeys.has(key) && !byPositionKey.has(key)) {
      byPositionKey.set(key, event);
    }
  }
  return byPositionKey;
}

function buildShadowAutomationContext(input: {
  position: ShadowPositionRow;
  sourceOrder?: ShadowOrderRow | null;
  latestEvent?: ExecutionEvent | null;
  peakMarkPrice?: number | null;
}) {
  const sourceOrder = input.sourceOrder ?? null;
  const latestEvent = input.latestEvent ?? null;
  if (shadowSourceType(sourceOrder) !== "automation" && !latestEvent) {
    return null;
  }

  const sourcePayload = readRecord(sourceOrder?.payload) ?? {};
  const eventPayload = readRecord(latestEvent?.payload) ?? {};
  const sourcePosition = readRecord(sourcePayload.position) ?? {};
  const eventPosition = readRecord(eventPayload.position) ?? {};
  const sourceCandidate = readRecord(sourcePayload.candidate) ?? {};
  const eventCandidate = readRecord(eventPayload.candidate) ?? {};
  const sourceOrderPlan = readRecord(sourcePayload.orderPlan) ?? {};
  const eventStop = readRecord(eventPayload.stop) ?? {};
  const sourceProfile = readRecord(sourcePayload.profile) ?? {};
  const eventProfile = readRecord(eventPayload.profile) ?? {};
  const sourceExitPolicy = readRecord(sourceProfile.exitPolicy) ?? {};
  const eventExitPolicy = readRecord(eventProfile.exitPolicy) ?? {};
  const signalQuality = firstRecord(
    eventPosition.signalQuality,
    sourcePosition.signalQuality,
    eventCandidate.signalQuality,
    sourceCandidate.signalQuality,
  );
  const profilePayload =
    Object.keys(eventProfile).length > 0
      ? eventProfile
      : Object.keys(sourceProfile).length > 0
        ? sourceProfile
        : null;
  const entryPrice =
    toNumber(eventPosition.entryPrice) ??
    toNumber(sourcePosition.entryPrice) ??
    toNumber(input.position.averageCost);
  const eventStopPrice =
    toNumber(eventStop.stopPrice) ??
    toNumber(eventPosition.stopPrice) ??
    toNumber(sourcePosition.stopPrice);
  const trailActivationPct =
    toNumber(eventStop.trailActivationPct) ??
    toNumber(eventExitPolicy.trailActivationPct) ??
    toNumber(sourceExitPolicy.trailActivationPct);
  const trailActivationPrice =
    entryPrice != null && trailActivationPct != null
      ? cents(entryPrice * (1 + trailActivationPct / 100))
      : null;
  const takeProfitPrice =
    toNumber(eventStop.takeProfitPrice) ??
    toNumber(eventStop.profitTargetPrice) ??
    toNumber(eventStop.targetPrice) ??
    toNumber(eventPosition.takeProfitPrice) ??
    toNumber(eventPosition.profitTargetPrice) ??
    toNumber(eventPosition.targetPrice) ??
    toNumber(sourcePosition.takeProfitPrice) ??
    toNumber(sourcePosition.profitTargetPrice) ??
    toNumber(sourcePosition.targetPrice) ??
    toNumber(sourceOrderPlan.takeProfitPrice) ??
    toNumber(sourceOrderPlan.profitTargetPrice) ??
    toNumber(sourceOrderPlan.targetPrice);
  const markPrice = toNumber(input.position.mark);
  const peakPriceCandidates = [
    toNumber(input.peakMarkPrice),
    toNumber(eventPosition.peakPrice),
    toNumber(sourcePosition.peakPrice),
    markPrice,
  ].filter((value): value is number => value != null);
  const peakPrice = peakPriceCandidates.length ? Math.max(...peakPriceCandidates) : null;
  const persistedStopPrice = toNumber(eventStop.stopPrice);
  const displayStop =
    persistedStopPrice == null &&
    profilePayload &&
    entryPrice != null &&
    markPrice != null &&
    peakPrice != null
      ? computeSignalOptionsPositionStop({
          entryPrice,
          peakPrice,
          markPrice,
          profile: resolveSignalOptionsExecutionProfile(profilePayload),
        })
      : null;
  const eventTrailActive =
    typeof eventStop.trailActive === "boolean" ? eventStop.trailActive : null;
  const eventTrailHasTakenOver =
    typeof eventStop.trailHasTakenOver === "boolean"
      ? eventStop.trailHasTakenOver
      : null;
  const eventActiveStopKind = readString(eventStop.activeStopKind);
  const hardStopPrice =
    toNumber(eventStop.hardStopPrice) ?? displayStop?.hardStopPrice ?? eventStopPrice;
  const rawStopPrice = persistedStopPrice ?? displayStop?.stopPrice ?? eventStopPrice;
  const trailStopPrice = toNumber(eventStop.trailStopPrice) ?? displayStop?.trailStopPrice;
  const trailActive = eventTrailActive ?? displayStop?.trailActive ?? false;
  const trailHasTakenOver =
    eventTrailHasTakenOver ??
    displayStop?.trailHasTakenOver ??
    (trailActive && hardStopPrice != null && trailStopPrice != null
      ? trailStopPrice > hardStopPrice
      : trailActive && trailStopPrice != null && hardStopPrice == null);
  const activeStopKind =
    (eventActiveStopKind === "trailing_stop" || eventActiveStopKind === "hard_stop"
      ? eventActiveStopKind
      : displayStop?.activeStopKind) ??
    (trailHasTakenOver
      ? "trailing_stop"
      : hardStopPrice != null
        ? "hard_stop"
        : trailStopPrice != null
          ? "trailing_stop"
          : null);
  const activeStopPrice =
    toNumber(eventStop.activeStopPrice) ??
    displayStop?.activeStopPrice ??
    (activeStopKind === "trailing_stop" ? trailStopPrice : hardStopPrice) ??
    rawStopPrice;
  const stopPrice = persistedStopPrice ?? activeStopPrice ?? rawStopPrice;

  return {
    entryPrice,
    peakPrice,
    stopPrice,
    activeStopPrice,
    activeStopKind,
    trailHasTakenOver,
    stopLossPrice: hardStopPrice,
    targetPrice: takeProfitPrice,
    takeProfitPrice,
    trailActivationPrice,
    premiumAtRisk:
      toNumber(eventPosition.premiumAtRisk) ??
      toNumber(sourcePosition.premiumAtRisk) ??
      toNumber(sourceOrderPlan.premiumAtRisk),
    purchasedAt:
      readString(eventPosition.purchasedAt) ??
      readString(sourcePosition.purchasedAt) ??
      readString(eventPosition.openedAt) ??
      readString(sourcePosition.openedAt),
    openedAt: readString(eventPosition.openedAt) ?? readString(sourcePosition.openedAt),
    signalAt: readString(eventPosition.signalAt) ?? readString(sourcePosition.signalAt),
    barsSinceSignal: toNumber(eventStop.barsSinceEntry),
    signalDirection:
      readString(eventPosition.direction) ??
      readString(sourcePosition.direction) ??
      readString(eventCandidate.direction) ??
      readString(sourceCandidate.direction),
    lastMarkedAt:
      readString(eventPosition.lastMarkedAt) ?? latestEvent?.occurredAt?.toISOString?.() ?? null,
    timeframe: readString(eventPosition.timeframe) ?? readString(sourcePosition.timeframe),
    signalScore: toNumber(signalQuality.score),
    signalTier: readString(signalQuality.tier),
    signalReasons: Array.isArray(signalQuality.reasons) ? signalQuality.reasons : [],
    tradeManagement: {
      sourceEventId: latestEvent?.id ?? sourceOrder?.sourceEventId ?? null,
      hardStopPrice,
      trailActivationPct,
      trailActivationPrice,
      targetKind: takeProfitPrice != null ? "take_profit" : null,
      activeStopPrice,
      activeStopKind,
      trailActive,
      trailStopPrice,
      trailHasTakenOver,
      givebackPct: displayStop?.givebackPct ?? toNumber(eventStop.givebackPct),
      minLockedGainPct:
        displayStop?.progressiveTrailStep?.minLockedGainPct ??
        toNumber(eventStop.minLockedGainPct),
      returnPct: displayStop?.returnPct ?? toNumber(eventStop.returnPct),
      markReturnPct: displayStop?.markReturnPct ?? toNumber(eventStop.markReturnPct),
      barsSinceEntry: toNumber(eventStop.barsSinceEntry),
    },
  };
}

function buildShadowPositionRiskOverlay(input: {
  automationContext: ReturnType<typeof buildShadowAutomationContext>;
  openedAt?: Date | string | null;
}) {
  const automationContext = input.automationContext;
  if (!automationContext) {
    return null;
  }

  const management = readRecord(automationContext.tradeManagement) ?? {};
  const hardStopPrice =
    toNumber(management.hardStopPrice) ?? toNumber(automationContext.stopLossPrice);
  const trailStopPrice = toNumber(management.trailStopPrice);
  const stopPrice = toNumber(automationContext.stopPrice) ?? toNumber(management.stopPrice);
  const takeProfitPrice =
    toNumber(management.takeProfitPrice) ??
    toNumber(management.targetPrice) ??
    toNumber(management.profitTargetPrice) ??
    toNumber(automationContext.takeProfitPrice) ??
    toNumber(automationContext.targetPrice);
  const trailActive = management.trailActive === true || trailStopPrice != null;
  const explicitActiveStopKind = readString(
    management.activeStopKind ?? automationContext.activeStopKind,
  );
  const explicitTrailHasTakenOver =
    management.trailHasTakenOver === true ||
    automationContext.trailHasTakenOver === true ||
    explicitActiveStopKind === "trailing_stop";
  const trailHasTakenOver =
    explicitActiveStopKind === "hard_stop"
      ? false
      : explicitTrailHasTakenOver ||
        (trailActive && trailStopPrice != null && hardStopPrice != null
          ? trailStopPrice > hardStopPrice
          : trailActive && trailStopPrice != null && hardStopPrice == null);
  const activeStopKind =
    explicitActiveStopKind === "trailing_stop" || explicitActiveStopKind === "hard_stop"
      ? explicitActiveStopKind
      : trailHasTakenOver
        ? "trailing_stop"
        : hardStopPrice != null
          ? "hard_stop"
          : trailStopPrice != null
            ? "trailing_stop"
            : null;
  const activeStopPrice =
    toNumber(management.activeStopPrice) ??
    toNumber(automationContext.activeStopPrice) ??
    (activeStopKind === "trailing_stop" ? trailStopPrice : hardStopPrice) ??
    stopPrice;

  if (hardStopPrice == null && trailStopPrice == null && takeProfitPrice == null) {
    return null;
  }

  const openedAt =
    readString(automationContext.purchasedAt) ??
    readString(automationContext.openedAt) ??
    (input.openedAt instanceof Date
      ? input.openedAt.toISOString()
      : readString(input.openedAt));

  return {
    source: "shadow_automation",
    openedAt: openedAt ?? null,
    entryPrice: toNumber(automationContext.entryPrice) ?? null,
    hardStopPrice: hardStopPrice ?? null,
    stopPrice: stopPrice ?? null,
    takeProfitPrice: takeProfitPrice ?? null,
    activeStopPrice: activeStopPrice ?? null,
    activeStopKind,
    trailActive,
    trailStopPrice: trailStopPrice ?? null,
    trailHasTakenOver,
    trailActivationPrice:
      toNumber(management.trailActivationPrice) ??
      toNumber(automationContext.trailActivationPrice) ??
      null,
    trailActivationPct: toNumber(management.trailActivationPct) ?? null,
    givebackPct: toNumber(management.givebackPct) ?? null,
    minLockedGainPct: toNumber(management.minLockedGainPct) ?? null,
    peakPrice: toNumber(automationContext.peakPrice) ?? null,
  };
}

function asOptionContract(value: unknown): ShadowOptionContract | null {
  if (!isRecord(value)) {
    return null;
  }
  const expirationDate =
    value.expirationDate instanceof Date
      ? value.expirationDate
      : new Date(String(value.expirationDate ?? ""));
  const right = String(value.right ?? "").toLowerCase();
  const ticker = String(value.ticker ?? "");
  const underlying = normalizeSymbol(String(value.underlying ?? ticker));
  const strike = toNumber(value.strike);
  if (
    !ticker ||
    !underlying ||
    Number.isNaN(expirationDate.getTime()) ||
    strike == null ||
    (right !== "call" && right !== "put")
  ) {
    return null;
  }
  return {
    ticker,
    underlying,
    expirationDate,
    strike,
    right,
    multiplier: toNumber(value.multiplier) ?? 100,
    sharesPerContract: toNumber(value.sharesPerContract) ?? 100,
    providerContractId:
      typeof value.providerContractId === "string" && value.providerContractId.trim()
        ? value.providerContractId.trim()
        : null,
  };
}

function optionPayload(
  value: ShadowOptionContract | null | undefined,
  providerContractIdOverride: string | null = null,
) {
  const providerContractId =
    typeof providerContractIdOverride === "string" &&
    providerContractIdOverride.trim()
      ? providerContractIdOverride.trim()
      : typeof value?.providerContractId === "string" &&
          value.providerContractId.trim()
        ? value.providerContractId.trim()
        : null;
  return value
    ? {
        ticker: value.ticker,
        underlying: value.underlying,
        expirationDate: value.expirationDate,
        strike: value.strike,
        right: value.right,
        multiplier: value.multiplier,
        sharesPerContract: value.sharesPerContract,
        providerContractId,
      }
    : null;
}

function shadowOptionQuoteIdentifier(
  contract: ShadowOptionContract | null | undefined,
): string | null {
  const providerContractId =
    typeof contract?.providerContractId === "string"
      ? contract.providerContractId.trim()
      : "";
  if (providerContractId && isOpraOptionTicker(providerContractId)) {
    return providerContractId;
  }
  const ticker = typeof contract?.ticker === "string" ? contract.ticker.trim() : "";
  if (ticker && isOpraOptionTicker(ticker)) {
    return ticker;
  }
  return providerContractId || null;
}

function rememberShadowOptionQuote(
  providerContractId: string | null | undefined,
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
) {
  const key = providerContractId?.trim();
  if (!key || !quote) {
    return;
  }
  const now = Date.now();
  const existing = shadowOptionQuoteCache.get(key);
  if (
    existing &&
    existing.staleExpiresAt > now &&
    shadowOptionQuoteHasDisplayMarketData(existing.quote) &&
    !shadowOptionQuoteHasDisplayMarketData(quote)
  ) {
    shadowOptionQuoteCache.set(key, {
      quote: existing.quote,
      expiresAt: now + shadowOptionQuoteCacheTtlMs(),
      staleExpiresAt: now + shadowOptionQuoteCacheStaleTtlMs(),
    });
    return;
  }
  shadowOptionQuoteCache.set(key, {
    quote,
    expiresAt: now + shadowOptionQuoteCacheTtlMs(),
    staleExpiresAt: now + shadowOptionQuoteCacheStaleTtlMs(),
  });
}

function readCachedShadowOptionQuotes(
  positions: Array<{
    optionContract?: unknown;
  }>,
  options: {
    allowStale?: boolean;
  } = {},
): Map<string, Partial<QuoteSnapshot> | Record<string, unknown>> {
  const now = Date.now();
  const quotes = new Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>();
  positions.forEach((position) => {
    const providerContractId = shadowOptionQuoteIdentifier(
      asOptionContract(position.optionContract),
    );
    if (!providerContractId) {
      return;
    }
    const cached = shadowOptionQuoteCache.get(providerContractId);
    if (!cached) {
      return;
    }
    if (cached.staleExpiresAt <= now) {
      shadowOptionQuoteCache.delete(providerContractId);
      return;
    }
    if (cached.expiresAt <= now && !options.allowStale) {
      return;
    }
    quotes.set(providerContractId, cached.quote);
  });
  return quotes;
}

function rememberShadowOptionGreekQuote(
  providerContractId: string | null | undefined,
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
) {
  const key = providerContractId?.trim();
  const quoteRecord = readRecord(quote);
  if (!key || !quoteRecord || !shadowQuoteHasAnyGreek(quoteRecord)) {
    return;
  }
  shadowOptionGreekQuoteCache.set(key, {
    quote: quoteRecord,
    expiresAt: Date.now() + 2 * 60_000,
  });
}

function readCachedShadowOptionGreekQuotes(
  positions: Array<{
    symbol: string;
    optionContract?: unknown;
  }>,
): Map<string, Partial<QuoteSnapshot> | Record<string, unknown>> {
  const now = Date.now();
  const quotes = new Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>();
  positions.forEach((position) => {
    const providerContractId = shadowOptionQuoteIdentifier(
      asOptionContract(position.optionContract),
    );
    if (!providerContractId) {
      return;
    }
    const cached = shadowOptionGreekQuoteCache.get(providerContractId);
    if (!cached) {
      return;
    }
    if (cached.expiresAt <= now) {
      shadowOptionGreekQuoteCache.delete(providerContractId);
      return;
    }
    quotes.set(providerContractId, cached.quote);
  });
  return quotes;
}

function declareShadowPositionOptionQuoteDemands(
  positions: Array<{
    symbol: string;
    optionContract?: unknown;
  }>,
  options: {
    intent?: MarketDataIntent;
    ownerPrefix?: string;
    requiresGreeks?: boolean;
  } = {},
) {
  const idsByUnderlying = new Map<string, Set<string>>();
  const aliasesByProviderContractId = new Map<string, Set<string>>();
  const addProviderContractId = (
    underlying: string,
    providerContractId: string | null | undefined,
    alias?: string | null,
  ) => {
    const normalizedUnderlying = normalizeSymbol(underlying).toUpperCase();
    const normalizedProviderContractId = String(providerContractId ?? "").trim();
    if (!normalizedUnderlying || !normalizedProviderContractId) {
      return;
    }
    const ids = idsByUnderlying.get(normalizedUnderlying) ?? new Set<string>();
    ids.add(normalizedProviderContractId);
    idsByUnderlying.set(normalizedUnderlying, ids);
    if (alias && alias !== normalizedProviderContractId) {
      const aliases =
        aliasesByProviderContractId.get(normalizedProviderContractId) ??
        new Set<string>();
      aliases.add(alias);
      aliasesByProviderContractId.set(normalizedProviderContractId, aliases);
    }
  };

  positions.forEach((position) => {
    const contract = asOptionContract(position.optionContract);
    if (!contract || isPriorOptionExpiration(contract)) {
      return;
    }
    const underlying = normalizeSymbol(contract.underlying || position.symbol).toUpperCase();
    const quoteIdentifier = shadowOptionQuoteIdentifier(contract);
    const providerContractId = shadowOptionProviderContractIdForContract(contract);
    addProviderContractId(underlying, providerContractId, quoteIdentifier);
  });

  idsByUnderlying.forEach((providerContractIdsForUnderlying, underlying) => {
    const providerContractIds = Array.from(providerContractIdsForUnderlying);
    if (!providerContractIds.length) {
      return;
    }
    const owner = options.ownerPrefix ?? "shadow-position:ledger:day-change";
    declareIbkrLiveDemand({
      underlying,
      providerContractIds,
      owner,
      intent: options.intent ?? "account-monitor-live",
      fallbackProvider: "cache",
      requiresGreeks: options.requiresGreeks ?? false,
      ttlMs: SHADOW_OPTION_QUOTE_CACHE_TTL_MS,
    });
    readIbkrLiveDemandState({
      underlying,
      providerContractIds,
      owner,
      requiresGreeks: options.requiresGreeks ?? false,
    }).states.flatMap((state) => (state.quote ? [state.quote] : [])).forEach((quote) => {
      const providerContractId = String(quote.providerContractId || "").trim();
      if (!providerContractId) {
        return;
      }
      rememberShadowOptionQuote(providerContractId, quote);
      if (options.requiresGreeks) {
        rememberShadowOptionGreekQuote(providerContractId, quote);
      }
      (aliasesByProviderContractId.get(providerContractId) ?? new Set()).forEach(
        (alias) => {
          rememberShadowOptionQuote(alias, quote);
          if (options.requiresGreeks) {
            rememberShadowOptionGreekQuote(alias, quote);
          }
        },
      );
    });
  });
}

async function fetchVisibleShadowOptionQuotes(
  positions: Array<{
    symbol: string;
    optionContract?: unknown;
  }>,
  options: {
    intent?: MarketDataIntent;
    ownerPrefix?: string;
    taskMaxWaitMs?: number;
    requiresGreeks?: boolean;
  } = {},
): Promise<Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>> {
  const idsByUnderlying = new Map<string, Set<string>>();
  const aliasesByProviderContractId = new Map<string, Set<string>>();
  const resolutionGroupsByKey = new Map<string, ShadowOptionProviderResolutionGroup>();
  const addProviderContractId = (
    underlying: string,
    providerContractId: string | null | undefined,
    alias?: string | null,
  ) => {
    const normalizedUnderlying = normalizeSymbol(underlying).toUpperCase();
    const normalizedProviderContractId = String(providerContractId ?? "").trim();
    if (!normalizedUnderlying || !normalizedProviderContractId) {
      return;
    }
    const ids = idsByUnderlying.get(normalizedUnderlying) ?? new Set<string>();
    ids.add(normalizedProviderContractId);
    idsByUnderlying.set(normalizedUnderlying, ids);
    if (alias && alias !== normalizedProviderContractId) {
      const aliases =
        aliasesByProviderContractId.get(normalizedProviderContractId) ??
        new Set<string>();
      aliases.add(alias);
      aliasesByProviderContractId.set(normalizedProviderContractId, aliases);
    }
  };

  positions.forEach((position) => {
    const contract = asOptionContract(position.optionContract);
    const quoteIdentifier = shadowOptionQuoteIdentifier(contract);
    const underlying = normalizeSymbol(contract?.underlying || position.symbol).toUpperCase();
    if (
      !contract ||
      !quoteIdentifier ||
      !underlying ||
      isPriorOptionExpiration(contract)
    ) {
      return;
    }
    const providerContractId = shadowOptionProviderContractIdForContract(contract);
    if (providerContractId) {
      addProviderContractId(underlying, providerContractId, quoteIdentifier);
      return;
    }
    if (!isOpraOptionTicker(quoteIdentifier)) {
      return;
    }
    const groupKey = [
      underlying,
      optionDateKey(contract.expirationDate),
      contract.right,
    ].join("|");
    const group =
      resolutionGroupsByKey.get(groupKey) ??
      {
        underlying,
        expirationDate: contract.expirationDate,
        right: contract.right,
        contracts: [],
      };
    group.contracts.push(contract);
    resolutionGroupsByKey.set(groupKey, group);
  });

  const resolvedProviderIds = await resolveShadowIbkrOptionProviderIds(
    Array.from(resolutionGroupsByKey.values()),
  );
  positions.forEach((position) => {
    const contract = asOptionContract(position.optionContract);
    const quoteIdentifier = shadowOptionQuoteIdentifier(contract);
    if (!contract || !quoteIdentifier || !isOpraOptionTicker(quoteIdentifier)) {
      return;
    }
    const providerContractId = resolvedProviderIds.get(quoteIdentifier);
    if (!providerContractId) {
      return;
    }
    const underlying = normalizeSymbol(contract.underlying || position.symbol).toUpperCase();
    addProviderContractId(underlying, providerContractId, quoteIdentifier);
  });

  const quotesByProviderContractId = new Map<
    string,
    Partial<QuoteSnapshot> | Record<string, unknown>
  >();
  const rememberQuote = (quote: Partial<QuoteSnapshot> | Record<string, unknown>) => {
    const providerContractId = String(
      (quote as Record<string, unknown>).providerContractId ?? "",
    ).trim();
    if (!providerContractId) {
      return;
    }
    quotesByProviderContractId.set(providerContractId, quote);
    rememberShadowOptionQuote(providerContractId, quote);
    if (options.requiresGreeks ?? true) {
      rememberShadowOptionGreekQuote(providerContractId, quote);
    }
    (aliasesByProviderContractId.get(providerContractId) ?? new Set()).forEach(
      (alias) => {
        quotesByProviderContractId.set(alias, quote);
        rememberShadowOptionQuote(alias, quote);
        if (options.requiresGreeks ?? true) {
          rememberShadowOptionGreekQuote(alias, quote);
        }
      },
    );
  };

  const taskMaxWaitMs =
    options.taskMaxWaitMs ?? SHADOW_VISIBLE_OPTION_QUOTE_TASK_MAX_WAIT_MS;
  await Promise.allSettled(
    Array.from(idsByUnderlying.entries()).map(([underlying, providerContractIdsForUnderlying]) => {
      const providerContractIds = Array.from(providerContractIdsForUnderlying);
      const demandOwner = options.ownerPrefix ?? "shadow-position:visible-option";
      const snapshotOwner = `${demandOwner}:snapshot`;
      const request = fetchBridgeOptionQuoteSnapshots({
        underlying,
        providerContractIds,
        owner: snapshotOwner,
        intent: options.intent ?? "visible-live",
        fallbackProvider: "cache",
        requiresGreeks: options.requiresGreeks ?? true,
        ttlMs: SHADOW_OPTION_QUOTE_CACHE_TTL_MS,
      })
        .then((payload) => {
          const returnedProviderContractIds = new Set<string>();
          payload.quotes.forEach((quote) => {
            const providerContractId = String(
              (quote as Record<string, unknown>).providerContractId ?? "",
            ).trim();
            if (providerContractId) {
              returnedProviderContractIds.add(providerContractId);
            }
            rememberQuote(quote);
          });
          const missingProviderContractIds = providerContractIds.filter(
            (providerContractId) => !returnedProviderContractIds.has(providerContractId),
          );
          if (!missingProviderContractIds.length) {
            return;
          }
          readIbkrLiveDemandState({
            underlying,
            providerContractIds: missingProviderContractIds,
            owner: demandOwner,
            requiresGreeks: options.requiresGreeks ?? true,
          }).states.flatMap((state) => (state.quote ? [state.quote] : [])).forEach(rememberQuote);
        })
        .catch((error) => {
          logger.debug?.(
            { err: error },
            "Shadow visible option quote snapshot failed",
          );
        });
      return Promise.race([
        request,
        sleep(taskMaxWaitMs).then(() => undefined),
      ]);
    }),
  );

  return quotesByProviderContractId;
}

function mergeShadowGreekQuoteMaps(
  cachedQuotes: Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>,
  liveQuotes: Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>,
): Map<string, Partial<QuoteSnapshot> | Record<string, unknown>> {
  const merged = new Map(cachedQuotes);
  liveQuotes.forEach((quote, providerContractId) => {
    if (shadowQuoteHasAnyGreek(readRecord(quote)) || !merged.has(providerContractId)) {
      merged.set(providerContractId, quote);
    }
  });
  return merged;
}

function rememberShadowOptionProviderContractId(
  optionTicker: string,
  providerContractId: string,
) {
  if (!optionTicker || !providerContractId || isOpraOptionTicker(providerContractId)) {
    return;
  }
  shadowOptionProviderIdCache.set(optionTicker, {
    providerContractId,
    expiresAt: Date.now() + SHADOW_OPTION_PROVIDER_ID_CACHE_TTL_MS,
  });
}

function readCachedShadowOptionProviderContractId(optionTicker: string) {
  const cached = shadowOptionProviderIdCache.get(optionTicker);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    shadowOptionProviderIdCache.delete(optionTicker);
    return null;
  }
  return cached.providerContractId;
}

function shadowOptionProviderContractIdForContract(
  contract: ShadowOptionContract | null | undefined,
): string | null {
  const quoteIdentifier = shadowOptionQuoteIdentifier(contract);
  if (!contract || !quoteIdentifier) {
    return null;
  }
  if (!isOpraOptionTicker(quoteIdentifier)) {
    return quoteIdentifier;
  }
  return quoteIdentifier;
}

function isExpiredOptionContractForShadowClose(
  contract: ShadowOptionContract,
  now = new Date(),
) {
  return optionDateKey(contract.expirationDate) <= optionDateKey(now);
}

function isPriorOptionExpiration(
  contract: ShadowOptionContract,
  now = new Date(),
) {
  return optionDateKey(contract.expirationDate) < optionDateKey(now);
}

export function computeShadowOrderFees(input: {
  assetClass: ShadowAssetClass;
  quantity: number;
  price: number;
  multiplier?: number;
}): number {
  const quantity = Math.abs(input.quantity);
  if (!quantity) {
    return 0;
  }
  if (input.assetClass === "option") {
    return cents(quantity * (OPTION_FIXED_COMMISSION_PER_CONTRACT + OPTION_ORF_PER_CONTRACT));
  }
  const gross = Math.abs(input.price * quantity * (input.multiplier ?? 1));
  const perShare = quantity * STOCK_FIXED_COMMISSION_PER_SHARE;
  const capped = gross > 0 ? Math.min(perShare, gross * STOCK_FIXED_COMMISSION_MAX_RATE) : perShare;
  return cents(Math.max(STOCK_FIXED_COMMISSION_MIN, capped));
}

// Slice 5.5: per-user shadow resolution.
//
// A user's own standalone shadow (source_broker_account_id IS NULL) is found/created
// by app_user_id. Until they have a persisted row, reads run against a per-user
// VIRTUAL id ("u:<uid>") that matches no rows -> the caller sees an empty $25k book,
// without a GET writing a row (create-on-first-trade mode). The founding admin's
// backfilled row ("shadow") is their standalone, so their view === the platform ledger.
const VIRTUAL_SHADOW_ACCOUNT_PREFIX = "u:";

function virtualUserShadowAccountId(appUserId: string): string {
  return `${VIRTUAL_SHADOW_ACCOUNT_PREFIX}${appUserId}`;
}

function isVirtualShadowAccountId(id: string): boolean {
  return id.startsWith(VIRTUAL_SHADOW_ACCOUNT_PREFIX);
}

// Auto-create the caller's shadow row on first VIEW (default), vs. defer creation to
// their first trade. Configurable via SHADOW_ACCOUNT_AUTOCREATE_ON_VIEW.
function shadowAutoCreateOnView(): boolean {
  return process.env["SHADOW_ACCOUNT_AUTOCREATE_ON_VIEW"] !== "false";
}

function buildSyntheticShadowAccountRow(id: string): ShadowAccountRow {
  const now = new Date();
  return {
    id,
    appUserId: null,
    sourceBrokerAccountId: null,
    displayName: SHADOW_ACCOUNT_DISPLAY_NAME,
    currency: SHADOW_CURRENCY,
    startingBalance: money(SHADOW_STARTING_BALANCE),
    cash: money(SHADOW_STARTING_BALANCE),
    realizedPnl: money(0),
    fees: money(0),
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

// Resolve the shadow account the CURRENT authenticated user operates on. Only call at
// gated boundaries (requireCurrentAppUserId is fail-closed). create=true finds-or-creates
// the persisted standalone row; create=false returns the existing id or a virtual id.
export async function resolveCurrentUserShadowAccountId(
  opts: { create?: boolean } = {},
): Promise<string> {
  const appUserId = requireCurrentAppUserId();
  const [existing] = await db
    .select({ id: shadowAccountsTable.id })
    .from(shadowAccountsTable)
    .where(
      and(
        eq(shadowAccountsTable.appUserId, appUserId),
        isNull(shadowAccountsTable.sourceBrokerAccountId),
        eq(shadowAccountsTable.status, "active"),
      ),
    )
    .limit(1);
  if (existing) {
    return existing.id;
  }
  if (!opts.create) {
    return virtualUserShadowAccountId(appUserId);
  }
  const id = randomUUID();
  const [inserted] = await db
    .insert(shadowAccountsTable)
    .values({
      id,
      appUserId,
      displayName: SHADOW_ACCOUNT_DISPLAY_NAME,
      currency: SHADOW_CURRENCY,
      startingBalance: money(SHADOW_STARTING_BALANCE),
      cash: money(SHADOW_STARTING_BALANCE),
      status: "active",
    })
    .onConflictDoNothing()
    .returning({ id: shadowAccountsTable.id });
  return inserted?.id ?? (await resolveCurrentUserShadowAccountId({ create: false }));
}

// Bind the caller's shadow scope around a shadow-account read/write. For non-shadow
// account ids it is a passthrough (never creates a shadow row when viewing an IBKR/
// SnapTrade account). create defaults to the auto-create-on-view flag.
export async function withCallerShadowScope<T>(
  accountId: string | null | undefined,
  fn: () => Promise<T>,
  opts: { create?: boolean } = {},
): Promise<T> {
  if (!isShadowAccountId(accountId)) {
    return fn();
  }
  const create = opts.create ?? shadowAutoCreateOnView();
  const id = await resolveCurrentUserShadowAccountId({ create });
  return runWithShadowAccountId(id, fn);
}

async function ensureShadowAccount(): Promise<ShadowAccountRow> {
  const existing = await readShadowAccount();
  if (existing) {
    return existing;
  }

  // create-on-first-trade: a per-user virtual scope has no persisted row on reads.
  // Return a synthetic empty $25k book; the real row is created on first write.
  const scopedId = currentShadowAccountId();
  if (isVirtualShadowAccountId(scopedId)) {
    return buildSyntheticShadowAccountRow(scopedId);
  }

  const [inserted] = await db
    .insert(shadowAccountsTable)
    .values({
      id: currentShadowAccountId(),
      displayName: SHADOW_ACCOUNT_DISPLAY_NAME,
      currency: SHADOW_CURRENCY,
      startingBalance: money(SHADOW_STARTING_BALANCE),
      cash: money(SHADOW_STARTING_BALANCE),
      status: "active",
    })
    .onConflictDoUpdate({
      target: shadowAccountsTable.id,
      set: {
        displayName: SHADOW_ACCOUNT_DISPLAY_NAME,
        currency: SHADOW_CURRENCY,
        status: "active",
      },
    })
    .returning();

  const account = inserted ?? (await readShadowAccount());
  if (!account) {
    throw new HttpError(500, "Shadow account could not be initialized.", {
      code: "shadow_account_init_failed",
      expose: true,
    });
  }

  return account;
}

async function readShadowAccount(): Promise<ShadowAccountRow | null> {
  const [row] = await db
    .select()
    .from(shadowAccountsTable)
    .where(eq(shadowAccountsTable.id, currentShadowAccountId()))
    .limit(1);
  return row ?? null;
}

async function readOpenShadowPositions(): Promise<ShadowPositionRow[]> {
  return db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, currentShadowAccountId()),
        eq(shadowPositionsTable.status, "open"),
      ),
    )
    .orderBy(desc(shadowPositionsTable.updatedAt));
}

async function readOpenShadowPositionsForKeys(
  positionKeys: Iterable<string>,
): Promise<ShadowPositionRow[]> {
  const keys = Array.from(
    new Set(
      Array.from(positionKeys)
        .map((key) => String(key || "").trim())
        .filter(Boolean),
    ),
  );
  if (!keys.length) {
    return [];
  }

  const chunks: string[][] = [];
  for (let index = 0; index < keys.length; index += 500) {
    chunks.push(keys.slice(index, index + 500));
  }
  const rows = await Promise.all(
    chunks.map((chunk) =>
      db
        .select()
        .from(shadowPositionsTable)
        .where(
          and(
            eq(shadowPositionsTable.accountId, currentShadowAccountId()),
            eq(shadowPositionsTable.status, "open"),
            inArray(shadowPositionsTable.positionKey, chunk),
          ),
        ),
    ),
  );
  return rows
    .flat()
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

async function readOpenDefaultShadowLedgerAnalyticsPositions(): Promise<ShadowPositionRow[]> {
  const selectedOrders = (await readShadowOrdersForAccount()).filter((order) =>
    isDefaultShadowLedgerAnalyticsOrder(order),
  );
  const positionKeys = shadowPositionKeysForOrders(selectedOrders);
  const ordersByPositionKey = shadowOrdersByPositionKey(selectedOrders);
  return (await readOpenShadowPositions()).filter(
    (position) =>
      isDefaultShadowLedgerAnalyticsPosition(position) &&
      positionKeys.has(position.positionKey) &&
      !isExpiredHistoricalShadowOptionPosition(
        position,
        ordersByPositionKey.get(position.positionKey),
      ),
  );
}

async function readOpenShadowPositionsForSource(
  source: ShadowSourceScope | null,
): Promise<ShadowPositionRow[]> {
  if (!source) {
    return readOpenDefaultShadowLedgerAnalyticsPositions();
  }
  const { fills, ordersById } = await readShadowFillsWithOrdersForSource(source);
  const sourceOrders = fills
    .filter((fill) => shadowOrderMatchesSource(ordersById.get(fill.orderId), source))
    .map((fill) => ordersById.get(fill.orderId));
  const sourcePositionKeys = shadowPositionKeysForOrders(sourceOrders);
  const sourceOrdersByPositionKey = shadowOrdersByPositionKey(sourceOrders);
  return (await readOpenShadowPositionsForKeys(sourcePositionKeys)).filter(
    (position) =>
      sourcePositionKeys.has(position.positionKey) &&
      positionMatchesShadowSource(position, source) &&
      !isExpiredHistoricalShadowOptionPosition(
        position,
        sourceOrdersByPositionKey.get(position.positionKey),
      ),
  );
}

async function readOpenShadowPositionsForSourceCached(
  source: ShadowSourceScope | null,
): Promise<ShadowPositionRow[]> {
  return withShadowReadCache(
    `open-positions:${shadowSourceCacheKey(source)}`,
    () => readOpenShadowPositionsForSource(source),
    {
      allowStale: shadowReadCacheValueHasRows,
      staleStrategy: "immediate",
      ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    },
  );
}

async function readShadowOrdersByFillOrderId(
  fills: Pick<ShadowFillRow, "orderId">[],
): Promise<Map<string, ShadowOrderRow>> {
  const orderIds = Array.from(new Set(fills.map((fill) => fill.orderId)));
  const orders = orderIds.length
    ? await db
        .select()
        .from(shadowOrdersTable)
        .where(inArray(shadowOrdersTable.id, orderIds))
    : [];
  return new Map(orders.map((order) => [order.id, order]));
}

type ShadowFillsWithOrders = {
  fills: ShadowFillRow[];
  ordersById: Map<string, ShadowOrderRow>;
};

async function readShadowFillsWithOrders(): Promise<ShadowFillsWithOrders> {
  const fills = await db
    .select()
    .from(shadowFillsTable)
    .where(eq(shadowFillsTable.accountId, currentShadowAccountId()));
  return {
    fills,
    ordersById: await readShadowOrdersByFillOrderId(fills),
  };
}

async function readBoundedShadowFillsWithOrders(): Promise<ShadowFillsWithOrders> {
  const fills = (
    await db
      .select()
      .from(shadowFillsTable)
      .where(eq(shadowFillsTable.accountId, currentShadowAccountId()))
      .orderBy(desc(shadowFillsTable.occurredAt))
      .limit(shadowLedgerDashboardReadLimit())
  ).sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  return {
    fills,
    ordersById: await readShadowOrdersByFillOrderId(fills),
  };
}

// Single-flighted shared read of the account's bounded shadow fills+orders for the
// dashboard widgets. The account screen mounts ~10 widget endpoints at once,
// several of which independently re-read the same fills+orders concurrently
// against the 12-connection pool (the startup pool-saturation root cause).
// Routing the dashboard reads through one withShadowReadCache entry collapses
// them into a single read. The raw readShadowFillsWithOrders above stays for
// write-adjacent recompute paths that need an uncached fresh read.
//
// Under a large signal universe the DB pool is saturated and this bounded
// fills+orders scan (the dominant shadow-read cost in the flight recorder,
// ~1.7s) was on the critical path for equity-history / positions / cash-activity:
// the DEFAULT "wait" stale strategy blocked each stale miss for
// up to staleWaitMs (1.5s) before serving the same cached value it would have
// served anyway (the fresh read almost always exceeds 1.5s under load). Serve the
// last cached fills+orders immediately and refresh in the background instead. The
// 30s derived-read TTL is aligned with the slow account-page derived cadence while
// shadow write invalidation still clears this cache on ledger mutations. Staleness
// bound is unchanged (staleExpiresAt still SHADOW_READ_CACHE_STALE_TTL_MS = 60s);
// trading logic never reads this cached path (it uses readShadowFillsWithOrders).
function readShadowDashboardFillsWithOrders(
  reader: () => Promise<ShadowFillsWithOrders> = readBoundedShadowFillsWithOrders,
) {
  return withShadowReadCache("dashboard:fills-with-orders", reader, {
    ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    staleStrategy: "immediate",
  });
}

async function readShadowFillsForOrderIds(
  orderIds: string[],
): Promise<ShadowFillRow[]> {
  const uniqueOrderIds = Array.from(new Set(orderIds.filter(Boolean)));
  if (!uniqueOrderIds.length) {
    return [];
  }
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueOrderIds.length; index += 500) {
    chunks.push(uniqueOrderIds.slice(index, index + 500));
  }
  const rows = await Promise.all(
    chunks.map((chunk) =>
      db
        .select()
        .from(shadowFillsTable)
        .where(
          and(
            eq(shadowFillsTable.accountId, currentShadowAccountId()),
            inArray(shadowFillsTable.orderId, chunk),
          ),
        ),
    ),
  );
  return rows.flat();
}

async function readShadowOrdersForAccount(): Promise<ShadowOrderRow[]> {
  return await db
    .select()
    .from(shadowOrdersTable)
    .where(eq(shadowOrdersTable.accountId, currentShadowAccountId()))
    .orderBy(desc(shadowOrdersTable.placedAt))
    .limit(shadowLedgerDashboardReadLimit());
}

async function readShadowOrdersForSource(
  source: ShadowSourceScope,
): Promise<ShadowOrderRow[]> {
  if (source !== "automation") {
    return (await readShadowOrdersForAccount()).filter((order) =>
      shadowOrderMatchesSource(order, source),
    );
  }

  const orders = await db
    .select()
    .from(shadowOrdersTable)
    .where(
      and(
        eq(shadowOrdersTable.accountId, currentShadowAccountId()),
        eq(shadowOrdersTable.source, "automation"),
      ),
    );
  return orders.filter((order) => shadowOrderMatchesSource(order, source));
}

async function readShadowFillsWithOrdersForSource(
  source: ShadowSourceScope | null,
) {
  if (!source) {
    return readShadowFillsWithOrders();
  }
  const orders = await readShadowOrdersForSource(source);
  const orderIds = orders.map((order) => order.id);
  return {
    fills: await readShadowFillsForOrderIds(orderIds),
    ordersById: new Map(orders.map((order) => [order.id, order])),
  };
}

function latestShadowTotalsDate(
  account: ShadowAccountRow,
  positions: ShadowPositionRow[],
  fills: ShadowFillRow[],
) {
  const initial = account.createdAt ?? new Date();
  const fromPositions = positions.reduce(
    (latest, position) => {
      const candidate = position.updatedAt ?? position.asOf;
      return candidate && candidate > latest ? candidate : latest;
    },
    initial,
  );
  return fills.reduce(
    (latest, fill) => (fill.occurredAt && fill.occurredAt > latest ? fill.occurredAt : latest),
    fromPositions,
  );
}

function latestHistoricalShadowTotalsDate(
  positions: Array<Pick<ShadowPositionRow, "asOf" | "updatedAt">>,
  fills: Array<Pick<ShadowFillRow, "occurredAt">>,
  fallback: Date,
) {
  const fromPositions = positions.reduce<Date | null>((latest, position) => {
    const candidate = position.asOf ?? position.updatedAt;
    if (!candidate) return latest;
    return !latest || candidate > latest ? candidate : latest;
  }, null);
  return fills.reduce(
    (latest, fill) =>
      fill.occurredAt && fill.occurredAt > latest ? fill.occurredAt : latest,
    fromPositions ?? fallback,
  );
}

function buildShadowTotalsFromLedger(input: {
  account: ShadowAccountRow;
  fills: ShadowFillRow[];
  positions: ShadowPositionRow[];
}): ShadowTotals {
  const { account, fills, positions } = input;
  const startingBalance = toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE;
  const cash = fills.reduce(
    (sum, fill) => sum + (toNumber(fill.cashDelta) ?? 0),
    startingBalance,
  );
  const realizedPnl = fills.reduce(
    (sum, fill) => sum + (toNumber(fill.realizedPnl) ?? 0),
    0,
  );
  const fees = fills.reduce((sum, fill) => sum + (toNumber(fill.fees) ?? 0), 0);
  const marketValue = positions.reduce(
    (sum, position) => sum + (toNumber(position.marketValue) ?? 0),
    0,
  );
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + (toNumber(position.unrealizedPnl) ?? 0),
    0,
  );
  return {
    cash,
    startingBalance,
    realizedPnl,
    unrealizedPnl,
    fees,
    marketValue,
    netLiquidation: cash + marketValue,
    updatedAt: latestShadowTotalsDate(account, positions, fills),
  };
}

function shadowSnapshotLedgerSource(source: string | null | undefined): ShadowSourceScope | null {
  if (source === SIGNAL_OPTIONS_REPLAY_SOURCE || source === SIGNAL_OPTIONS_REPLAY_MARK_SOURCE) {
    return SIGNAL_OPTIONS_REPLAY_SOURCE;
  }
  if (
    source === WATCHLIST_BACKTEST_SOURCE ||
    source === WATCHLIST_BACKTEST_MARK_SOURCE ||
    isWatchlistBacktestRunSnapshotSource(source)
  ) {
    return WATCHLIST_BACKTEST_SOURCE;
  }
  return null;
}

type ShadowLedgerBundleForSource = {
  account: ShadowAccountRow;
  fills: ShadowFillRow[];
  ordersById: Map<string, ShadowOrderRow>;
  selectedFills: ShadowFillRow[];
  selectedOrders: ShadowOrderRow[];
  selectedOrdersByPositionKey: Map<string, ShadowOrderRow>;
  positions: ShadowPositionRow[];
  totals: ShadowTotals;
};

async function readShadowLedgerBundleForSource(
  source: ShadowSourceScope | null,
  options: {
    useCurrentTimestampForOpenPositions?: boolean;
    now?: Date;
  } = {},
): Promise<ShadowLedgerBundleForSource> {
  return withShadowReadCache(
    `ledger-bundle:${shadowSourceCacheKey(source)}`,
    async () => {
      const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
      const { fills, ordersById } = source
        ? await readShadowFillsWithOrdersForSource(source)
        : await readShadowDashboardFillsWithOrders();
      const selectedFills = source
        ? fills.filter((fill) =>
            shadowOrderMatchesSource(ordersById.get(fill.orderId), source),
          )
        : fills.filter((fill) =>
            isDefaultShadowLedgerAnalyticsOrder(ordersById.get(fill.orderId)),
          );
      const selectedOrders = selectedFills
        .map((fill) => ordersById.get(fill.orderId))
        .filter((order): order is ShadowOrderRow => Boolean(order));
      const selectedPositionKeys = shadowPositionKeysForOrders(selectedOrders);
      const selectedOrdersByPositionKey =
        shadowOrdersByPositionKey(selectedOrders);
      const positionCandidates = source
        ? await readOpenShadowPositionsForKeys(selectedPositionKeys)
        : await readOpenShadowPositions();
      const positions = positionCandidates.filter(
        (position) =>
          selectedPositionKeys.has(position.positionKey) &&
          (source
            ? positionMatchesShadowSource(position, source)
            : isDefaultShadowLedgerAnalyticsPosition(position)) &&
          !isExpiredHistoricalShadowOptionPosition(
            position,
            selectedOrdersByPositionKey.get(position.positionKey),
            options.now,
          ),
      );
      const totals = buildShadowTotalsFromLedger({
        account,
        fills: selectedFills,
        positions,
      });
      const historicalSignalOptionsOpenPositions =
        source !== "automation" &&
        positions.length > 0 &&
        positions.every((position) => {
          const sourceOrder = selectedOrdersByPositionKey.get(position.positionKey);
          return Boolean(
            sourceOrder && isHistoricalSignalOptionsShadowOrder(sourceOrder),
          );
        });
      const terminalTotals = historicalSignalOptionsOpenPositions
        ? {
            ...totals,
            updatedAt: latestHistoricalShadowTotalsDate(
              positions,
              selectedFills,
              totals.updatedAt,
            ),
          }
        : totals;
      const responseTotals =
        options.useCurrentTimestampForOpenPositions &&
        !historicalSignalOptionsOpenPositions
          ? withCurrentOpenPositionTerminalTimestamp(
              terminalTotals,
              positions.length,
              options.now,
            )
          : terminalTotals;

      return {
        account,
        fills,
        ordersById,
        selectedFills,
        selectedOrders,
        selectedOrdersByPositionKey,
        positions,
        totals: responseTotals,
      };
    },
    {
      // Serve the last bundle immediately and rebuild in the background instead
      // of blocking the request on a fresh rebuild every TTL (observed ~950ms
      // cache-miss stalls that drive API pressure "high"). Shadow ledger
      // analytics tolerate one stale cycle — same tradeoff already adopted for
      // shadow positions.
      staleStrategy: "immediate",
      ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    },
  );
}

type ShadowPositionBookEntry = {
  key: string;
  quantity: number;
  averageCost: number;
  multiplier: number;
};

function applyShadowFillToBook(
  book: Map<string, ShadowPositionBookEntry>,
  input: {
    fill: ShadowFillRow;
    order?: ShadowOrderRow | null;
  },
) {
  const key = shadowPositionKeyForOrder(input.order);
  if (!key) return;
  const quantity = Math.abs(toNumber(input.fill.quantity) ?? 0);
  if (!quantity) return;
  const price = toNumber(input.fill.price) ?? 0;
  const multiplier = marketMultiplier({
    assetClass: input.fill.assetClass as ShadowAssetClass,
    optionContract: asOptionContract(input.fill.optionContract),
  });
  const current =
    book.get(key) ??
    ({
      key,
      quantity: 0,
      averageCost: price,
      multiplier,
    } satisfies ShadowPositionBookEntry);

  if (input.fill.side === "buy") {
    const nextQuantity = current.quantity + quantity;
    const nextAverageCost =
      nextQuantity > 0
        ? (current.quantity * current.averageCost + quantity * price) / nextQuantity
        : price;
    book.set(key, {
      key,
      quantity: nextQuantity,
      averageCost: nextAverageCost,
      multiplier,
    });
    return;
  }

  const nextQuantity = Math.max(0, current.quantity - quantity);
  if (nextQuantity <= 1e-9) {
    book.delete(key);
    return;
  }
  book.set(key, {
    ...current,
    quantity: nextQuantity,
    multiplier,
  });
}

async function latestShadowPositionMarksAt(
  positions: ShadowPositionRow[],
  asOf: Date,
) {
  const positionIds = Array.from(
    new Set(positions.map((position) => position.id).filter(Boolean)),
  );
  if (!positionIds.length) {
    return new Map<string, ShadowPositionMarkRow>();
  }
  const result = await pool.query<ShadowPositionMarkRow>(
    `
      select
        mark.id,
        mark.account_id as "accountId",
        mark.position_id as "positionId",
        mark.mark,
        mark.market_value as "marketValue",
        mark.unrealized_pnl as "unrealizedPnl",
        mark.source,
        mark.as_of as "asOf",
        mark.created_at as "createdAt",
        mark.updated_at as "updatedAt"
      from unnest($2::uuid[]) as requested(position_id)
      join lateral (
        select *
        from shadow_position_marks
        where account_id = $1
          and position_id = requested.position_id
          and as_of <= $3
        order by as_of desc, created_at desc
        limit 1
      ) mark on true
    `,
    [currentShadowAccountId(), positionIds, asOf],
  );
  return result.rows.reduce((map, mark) => {
    map.set(mark.positionId, mark);
    return map;
  }, new Map<string, ShadowPositionMarkRow>());
}

async function computeShadowSnapshotTotalsAt(
  source: string | null | undefined,
  asOf: Date,
): Promise<ShadowTotals> {
  const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
  const { fills, ordersById } = await readShadowFillsWithOrders();
  const scopedSource = shadowSnapshotLedgerSource(source);
  const selectedFills = fills
    .filter((fill) => {
      const order = ordersById.get(fill.orderId);
      return scopedSource
        ? shadowOrderMatchesSource(order, scopedSource)
        : isDefaultShadowLedgerAnalyticsOrder(order);
    })
    .filter((fill) => fill.occurredAt.getTime() <= asOf.getTime())
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  const startingBalance = toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE;
  const cash = selectedFills.reduce(
    (sum, fill) => sum + (toNumber(fill.cashDelta) ?? 0),
    startingBalance,
  );
  const realizedPnl = selectedFills.reduce(
    (sum, fill) => sum + (toNumber(fill.realizedPnl) ?? 0),
    0,
  );
  const fees = selectedFills.reduce((sum, fill) => sum + (toNumber(fill.fees) ?? 0), 0);
  const book = new Map<string, ShadowPositionBookEntry>();
  selectedFills.forEach((fill) => {
    applyShadowFillToBook(book, {
      fill,
      order: ordersById.get(fill.orderId),
    });
  });
  const openKeys = new Set(
    Array.from(book.values())
      .filter((entry) => entry.quantity > 1e-9)
      .map((entry) => entry.key),
  );
  const positions = openKeys.size
    ? (await readOpenShadowPositions()).filter((position) => openKeys.has(position.positionKey))
    : [];
  const allPositions = openKeys.size
    ? await db
        .select()
        .from(shadowPositionsTable)
        .where(
          and(
            eq(shadowPositionsTable.accountId, currentShadowAccountId()),
            inArray(shadowPositionsTable.positionKey, Array.from(openKeys)),
          ),
        )
    : [];
  const positionRows = allPositions.length ? allPositions : positions;
  const positionsByKey = new Map(positionRows.map((position) => [position.positionKey, position]));
  const marksByPositionId = await latestShadowPositionMarksAt(positionRows, asOf);
  let marketValue = 0;
  let unrealizedPnl = 0;
  book.forEach((entry) => {
    if (entry.quantity <= 1e-9) return;
    const position = positionsByKey.get(entry.key);
    const mark = position ? marksByPositionId.get(position.id) : null;
    const markPrice = toNumber(mark?.mark) ?? entry.averageCost;
    const positionMarketValue = markPrice * entry.quantity * entry.multiplier;
    marketValue += positionMarketValue;
    unrealizedPnl += (markPrice - entry.averageCost) * entry.quantity * entry.multiplier;
  });
  return {
    cash,
    startingBalance,
    realizedPnl,
    unrealizedPnl,
    fees,
    marketValue,
    netLiquidation: cash + marketValue,
    updatedAt: asOf,
  };
}

async function computeShadowTotalsForSource(
  source: string | null,
  options: {
    useCurrentTimestampForOpenPositions?: boolean;
    now?: Date;
  } = {},
): Promise<ShadowTotals> {
  return (
    await readShadowLedgerBundleForSource(
      source as ShadowSourceScope | null,
      options,
    )
  ).totals;
}

async function computeShadowTotals(): Promise<ShadowTotals> {
  return computeShadowTotalsForSource(null);
}

/**
 * Lifetime, fee-aware realized P&L (and total fees) for a single algo
 * deployment, reconstructed from the shadow ledger — the source of truth for
 * fills. Scoped to the "automation" source, which excludes synthetic
 * replay/backtest trades while including real live trades and their idempotent
 * backfill-repair mirrors (deduped by positionKey/clientOrderId), so it is
 * replay-safe. Open exposure and unrealized P&L are intentionally NOT returned:
 * the signal-options scan loop already holds the deployment's fresh in-memory
 * open positions and computes those from live marks.
 */
export async function computeSignalOptionsLedgerRealizedForDeployment(
  deploymentId: string,
): Promise<{ realizedNet: number; fees: number }> {
  if (!deploymentId) {
    return { realizedNet: 0, fees: 0 };
  }
  const bundle = await readShadowLedgerBundleForSource("automation");
  let realizedNet = 0;
  let fees = 0;
  for (const fill of bundle.selectedFills) {
    const order = bundle.ordersById.get(fill.orderId) ?? null;
    if (sourceDeploymentIdFromShadowOrder(order) !== deploymentId) {
      continue;
    }
    realizedNet += toNumber(fill.realizedPnl) ?? 0;
    fees += toNumber(fill.fees) ?? 0;
  }
  return {
    realizedNet: Number(realizedNet.toFixed(2)),
    fees: Number(fees.toFixed(2)),
  };
}

function buildShadowCashActivityTotalsFromAccount(account: ShadowAccountRow): ShadowTotals {
  const startingBalance = toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE;
  const cash = toNumber(account.cash) ?? startingBalance;
  const realizedPnl = toNumber(account.realizedPnl) ?? 0;
  const fees = toNumber(account.fees) ?? 0;
  return {
    cash,
    startingBalance,
    realizedPnl,
    unrealizedPnl: 0,
    fees,
    marketValue: 0,
    netLiquidation: cash,
    updatedAt: account.updatedAt,
  };
}

async function resolveShadowCashActivityTotals(input: {
  source: ShadowSourceScope | null;
  account: ShadowAccountRow;
}): Promise<ShadowTotals> {
  if (!input.source) {
    return buildShadowCashActivityTotalsFromAccount(input.account);
  }
  return computeShadowTotalsForSource(input.source);
}

async function computeWatchlistBacktestStartingBook(): Promise<WatchlistBacktestStartingBook> {
  const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
  const startingBalance = toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE;
  const { fills, ordersById } = await readShadowFillsWithOrders();
  const baselineFills = fills.filter((fill) => isLiveShadowOrder(ordersById.get(fill.orderId)));
  const baselinePositionKeys = shadowPositionKeysForOrders(
    baselineFills.map((fill) => ordersById.get(fill.orderId)),
  );
  const positions = (await readOpenShadowPositions()).filter(
    (position) =>
      isLiveShadowPosition(position) && baselinePositionKeys.has(position.positionKey),
  );
  const cash = baselineFills.reduce(
    (sum, fill) => sum + (toNumber(fill.cashDelta) ?? 0),
    startingBalance,
  );
  const realizedPnl = baselineFills.reduce(
    (sum, fill) => sum + (toNumber(fill.realizedPnl) ?? 0),
    0,
  );
  const fees = baselineFills.reduce((sum, fill) => sum + (toNumber(fill.fees) ?? 0), 0);
  const marketValue = positions.reduce(
    (sum, position) => sum + (toNumber(position.marketValue) ?? 0),
    0,
  );
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + (toNumber(position.unrealizedPnl) ?? 0),
    0,
  );
  const updatedAt = positions.reduce(
    (latest, position) =>
      position.updatedAt && position.updatedAt > latest ? position.updatedAt : latest,
    account.updatedAt ?? new Date(),
  );
  const totals = {
    cash,
    startingBalance,
    realizedPnl,
    unrealizedPnl,
    fees,
    marketValue,
    netLiquidation: cash + marketValue,
    updatedAt,
  };
  return {
    totals,
    baseMarketValue: marketValue,
    existingOpenPositionCount: positions.length,
    existingOpenSymbols: Array.from(
      new Set(positions.map((position) => normalizeSymbol(position.symbol).toUpperCase())),
    ).filter(Boolean),
  };
}

async function writeShadowBalanceSnapshot(
  source = "ledger",
  asOf = new Date(),
  options: {
    changeReason?: ShadowAccountChangeReason;
    invalidateCaches?: boolean;
  } = {},
) {
  const changeReason = options.changeReason ?? "ledger";
  const totals = await computeShadowSnapshotTotalsAt(source, asOf);
  await db.insert(shadowBalanceSnapshotsTable).values({
    accountId: currentShadowAccountId(),
    currency: SHADOW_CURRENCY,
    cash: money(totals.cash),
    buyingPower: money(Math.max(0, totals.cash)),
    netLiquidation: money(totals.netLiquidation),
    realizedPnl: money(totals.realizedPnl),
    unrealizedPnl: money(totals.unrealizedPnl),
    fees: money(totals.fees),
    source,
    asOf,
  });
  if (changeReason === "mark_refresh") {
    if (options.invalidateCaches !== false) {
      invalidateShadowReadCachesAfterBackgroundMarkRefresh();
    }
  } else {
    invalidateShadowFreshStateCache();
  }
  notifyShadowAccountChanged({ reason: changeReason });
  return totals;
}

async function resolveEquityMark(symbol: string): Promise<ShadowResolvedMark> {
  const normalized = normalizeSymbol(symbol).toUpperCase();
  const quotes = await getQuoteSnapshots({
    symbols: normalized,
    allowMassiveFallback: false,
    admissionOwner: `shadow-equity-mark:${normalized}`,
    admissionIntent: "account-monitor-live",
    admissionFallbackProvider: "cache",
  }).catch(() => ({
    quotes: [],
  }));
  const quoteList = Array.isArray(quotes.quotes)
    ? (quotes.quotes as Array<Record<string, unknown>>)
    : [];
  const quote = quoteList.find(
    (candidate) => normalizeSymbol(String(candidate.symbol ?? "")).toUpperCase() === normalized,
  );
  if (quote) {
    return {
      price: toNumber(quote.price),
      bid: toNumber(quote.bid),
      ask: toNumber(quote.ask),
      source: "quote",
      asOf: quote.updatedAt instanceof Date ? quote.updatedAt : new Date(),
    };
  }

  const bars = await getBars({
    symbol: normalized,
    timeframe: "1m",
    limit: 1,
    outsideRth: true,
    allowHistoricalSynthesis: true,
  }).catch(() => ({ bars: [] }));
  const bar = bars.bars.at(-1);
  return {
    price: toNumber(bar?.close),
    bid: null,
    ask: null,
    source: "bar_fallback",
    asOf: bar?.timestamp instanceof Date ? bar.timestamp : new Date(),
  };
}

async function resolveEquityMarkForShadowRefresh(
  position: ShadowPositionRow,
): Promise<ShadowResolvedMark> {
  return resolveEquityMarkForTests
    ? resolveEquityMarkForTests(position.symbol, position)
    : resolveEquityMark(position.symbol);
}

async function resolveOptionMark(contract: ShadowOptionContract): Promise<{
  price: number | null;
  bid: number | null;
  ask: number | null;
  source: string;
  asOf: Date;
}> {
  const quoteIdentifier = shadowOptionQuoteIdentifier(contract);
  if (!quoteIdentifier) {
    return { price: null, bid: null, ask: null, source: "missing_contract_id", asOf: new Date() };
  }
  if (isPriorOptionExpiration(contract)) {
    return { price: null, bid: null, ask: null, source: "expired_contract", asOf: new Date() };
  }
  const providerContractId = quoteIdentifier;
  const owner = `shadow-option-mark:${providerContractId}`;
  declareIbkrLiveDemand({
    owner,
    underlying: contract.underlying,
    providerContractIds: [providerContractId],
    intent: "visible-live",
    fallbackProvider: "cache",
    requiresGreeks: false,
    ttlMs: SHADOW_OPTION_QUOTE_CACHE_TTL_MS,
  });
  const quote =
    readIbkrLiveDemandState({
      owner,
      underlying: contract.underlying,
      providerContractIds: [providerContractId],
      requiresGreeks: false,
    }).states.find((state) => state.providerContractId === providerContractId)
      ?.quote ?? null;
  if (!quote) {
    return { price: null, bid: null, ask: null, source: "quote_unavailable", asOf: new Date() };
  }
  rememberShadowOptionQuote(providerContractId, quote);
  if (isOpraOptionTicker(quoteIdentifier)) {
    rememberShadowOptionQuote(quoteIdentifier, quote);
  }
  return optionMarkFromQuoteRecord(quote as Record<string, unknown>, "option_quote");
}

function shadowOptionQuoteTimestamp(quoteRecord: Record<string, unknown>) {
  const timestamp =
    quoteRecord.updatedAt ??
    quoteRecord.quoteUpdatedAt ??
    quoteRecord.dataUpdatedAt ??
    null;
  if (timestamp instanceof Date && !Number.isNaN(timestamp.getTime())) {
    return timestamp;
  }
  if (typeof timestamp === "string" && timestamp.trim()) {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  return new Date();
}

function nonOpraProviderContractId(value: unknown): string | null {
  const providerContractId = typeof value === "string" ? value.trim() : "";
  return providerContractId && !isOpraOptionTicker(providerContractId)
    ? providerContractId
    : null;
}

function shadowOptionQuoteProviderContractId(
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
  fallback: string | null | undefined,
): string | null {
  const quoteRecord = quote as Record<string, unknown> | null | undefined;
  return (
    nonOpraProviderContractId(quoteRecord?.providerContractId) ??
    nonOpraProviderContractId(fallback)
  );
}

function shadowOptionQuoteHasDisplayMarketData(
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
) {
  const quoteRecord = quote as Record<string, unknown> | null | undefined;
  return (
    toNumber(quoteRecord?.bid) != null ||
    toNumber(quoteRecord?.ask) != null ||
    toNumber(quoteRecord?.delta) != null ||
    toNumber(quoteRecord?.gamma) != null ||
    toNumber(quoteRecord?.theta) != null ||
    toNumber(quoteRecord?.vega) != null ||
    toNumber(quoteRecord?.impliedVolatility) != null
  );
}

function optionMarkFromQuoteRecord(
  quoteRecord: Record<string, unknown>,
  source: string,
) {
  return {
    price: shadowQuoteMarkPrice(quoteRecord),
    bid: toNumber(quoteRecord.bid),
    ask: toNumber(quoteRecord.ask),
    source,
    asOf: shadowOptionQuoteTimestamp(quoteRecord),
  };
}

function shadowQuoteSnapshotFromOptionRecord(input: {
  symbol: string;
  providerContractId: string | null;
  quote: Partial<QuoteSnapshot> | Record<string, unknown>;
}): QuoteSnapshot {
  const quoteRecord = input.quote as Record<string, unknown>;
  const updatedAt = shadowOptionQuoteTimestamp(quoteRecord);
  return {
    symbol: input.symbol,
    price:
      readPositiveNumber(quoteRecord.last) ??
      readPositiveNumber(quoteRecord.price) ??
      readPositiveNumber(quoteRecord.mark) ??
      0,
    bid: toNumber(quoteRecord.bid),
    ask: toNumber(quoteRecord.ask),
    bidSize: toNumber(quoteRecord.bidSize),
    askSize: toNumber(quoteRecord.askSize),
    change: toNumber(quoteRecord.change),
    changePercent: toNumber(quoteRecord.changePercent),
    open: toNumber(quoteRecord.open),
    high: toNumber(quoteRecord.high),
    low: toNumber(quoteRecord.low),
    prevClose: toNumber(quoteRecord.prevClose),
    volume: toNumber(quoteRecord.volume),
    openInterest: toNumber(quoteRecord.openInterest),
    impliedVolatility: toNumber(quoteRecord.impliedVolatility),
    delta: toNumber(quoteRecord.delta),
    gamma: toNumber(quoteRecord.gamma),
    theta: toNumber(quoteRecord.theta),
    vega: toNumber(quoteRecord.vega),
    providerContractId: input.providerContractId,
    delayed: Boolean(quoteRecord.delayed),
    freshness:
      typeof quoteRecord.freshness === "string" ? quoteRecord.freshness : null,
    marketDataMode:
      typeof quoteRecord.marketDataMode === "string"
        ? quoteRecord.marketDataMode
        : null,
    dataUpdatedAt: updatedAt,
    ageMs: toNumber(quoteRecord.ageMs),
    cacheAgeMs: toNumber(quoteRecord.cacheAgeMs),
    latency: toNumber(quoteRecord.latency),
    transport: typeof quoteRecord.transport === "string" ? quoteRecord.transport : null,
    updatedAt,
    mark: readPositiveNumber(quoteRecord.mark),
    last: readPositiveNumber(quoteRecord.last),
  } as QuoteSnapshot;
}

function shadowOptionQuotePayload(input: {
  symbol: string;
  providerContractId: string | null;
  quote: Partial<QuoteSnapshot> | Record<string, unknown>;
  fallbackMark: number;
  source: string;
  pricing?: ShadowOptionPricingPolicy;
}) {
  const quoteRecord = input.quote as Record<string, unknown>;
  const automationEventQuote = input.source === "automation_event_quote";
  const snapshot = shadowQuoteSnapshotFromOptionRecord(input);
  const displayQuote = automationEventQuote
    ? null
    : buildPositionQuoteFromSnapshot(
        snapshot,
        input.fallbackMark,
        "option_quote",
      );
  const updatedAt = shadowOptionQuoteTimestamp(quoteRecord);
  const valuationEligible = input.pricing?.valuationEligible ?? true;
  const mark =
    automationEventQuote || !valuationEligible
      ? input.fallbackMark
      : displayQuote?.mark ?? shadowQuoteMarkPrice(quoteRecord) ?? input.fallbackMark;
  const spreadPercent =
    !automationEventQuote && displayQuote?.spread != null && mark > 0
      ? (displayQuote.spread / mark) * 100
      : displayQuote?.spreadPercent ?? null;
  const hasTwoSidedQuote =
    !automationEventQuote &&
    displayQuote?.bid != null &&
    displayQuote.ask != null;
  return {
    providerContractId: input.providerContractId,
    bid: hasTwoSidedQuote ? displayQuote?.bid ?? null : null,
    ask: hasTwoSidedQuote ? displayQuote?.ask ?? null : null,
    mid: hasTwoSidedQuote ? displayQuote?.mid ?? null : null,
    last: automationEventQuote ? null : displayQuote?.last ?? toNumber(quoteRecord.last),
    price:
      automationEventQuote
        ? mark ?? null
        : readPositiveNumber(quoteRecord.price) ??
          displayQuote?.last ??
          mark ??
          null,
    mark,
    spread: hasTwoSidedQuote ? displayQuote?.spread ?? null : null,
    spreadPercent: hasTwoSidedQuote ? spreadPercent : null,
    bidSize: hasTwoSidedQuote ? displayQuote?.bidSize ?? toNumber(quoteRecord.bidSize) : null,
    askSize: hasTwoSidedQuote ? displayQuote?.askSize ?? toNumber(quoteRecord.askSize) : null,
    prevClose: toNumber(quoteRecord.prevClose),
    change: toNumber(quoteRecord.change),
    changePercent: toNumber(quoteRecord.changePercent),
    dayChange: toNumber(quoteRecord.change),
    dayChangePercent: toNumber(quoteRecord.changePercent),
    impliedVolatility: toNumber(quoteRecord.impliedVolatility),
    delta: toNumber(quoteRecord.delta),
    gamma: toNumber(quoteRecord.gamma),
    theta: toNumber(quoteRecord.theta),
    vega: toNumber(quoteRecord.vega),
    openInterest: toNumber(quoteRecord.openInterest),
    volume: toNumber(quoteRecord.volume),
    underlyingPrice:
      readPositiveNumber(quoteRecord.underlyingPrice) ??
      readPositiveNumber(quoteRecord.undPrice),
    updatedAt,
    dataUpdatedAt: updatedAt,
    quoteUpdatedAt: updatedAt,
    freshness: displayQuote?.freshness ?? snapshot.freshness ?? null,
    marketDataMode: displayQuote?.marketDataMode ?? snapshot.marketDataMode ?? null,
    source: input.source,
    pricingPolicy: "shadow_canonical",
    valuationEligible,
    valuationSource: input.pricing?.valuationSource ?? input.source,
    valuationReason: input.pricing?.valuationReason ?? "quote_eligible",
  };
}

async function getBoundedShadowUnderlyingQuoteSnapshots(
  symbols: string,
): Promise<Awaited<ReturnType<typeof getQuoteSnapshots>>> {
  const fallback: Awaited<ReturnType<typeof getQuoteSnapshots>> = {
    quotes: [],
    transport: "client_portal",
    delayed: false,
    fallbackUsed: false,
  };
  return Promise.race([
    getQuoteSnapshots({
      symbols,
      allowMassiveFallback: false,
      admissionOwner: `shadow-underlying-mark:${symbols}`,
      admissionIntent: "account-monitor-live",
      admissionFallbackProvider: "cache",
    }).catch(() => fallback),
    sleep(SHADOW_UNDERLYING_QUOTE_MAX_WAIT_MS).then(() => fallback),
  ]);
}

async function fetchShadowOptionUnderlyingMarkets(
  positions: ShadowPositionRow[],
): Promise<Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>> {
  const symbols = Array.from(
    new Set(
      positions
        .map((position) => asOptionContract(position.optionContract))
        .map((contract) => normalizeSymbol(String(contract?.underlying ?? "")).toUpperCase())
        .filter(Boolean),
    ),
  );

  if (!symbols.length) {
    return new Map();
  }

  const payload = await getBoundedShadowUnderlyingQuoteSnapshots(
    symbols.join(","),
  );

  const quoteList = Array.isArray(payload.quotes)
    ? (payload.quotes as Array<Partial<QuoteSnapshot> | Record<string, unknown>>)
    : [];
  return new Map(
    quoteList
      .map((quote) => {
        const symbol = normalizeSymbol(
          String((quote as Record<string, unknown>).symbol ?? ""),
        ).toUpperCase();
        return [symbol, quote] as const;
      })
      .filter((entry): entry is readonly [string, Partial<QuoteSnapshot> | Record<string, unknown>] =>
        Boolean(entry[0]),
      ),
  );
}

async function fetchShadowEquityPositionQuotes(
  positions: ShadowPositionRow[],
  options: { owner?: string | null } = {},
): Promise<Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>> {
  const symbols = Array.from(
    new Set(
      positions
        .filter(
          (position) =>
            position.assetClass === "equity" &&
            !asOptionContract(position.optionContract),
        )
        .map((position) => normalizeSymbol(position.symbol).toUpperCase())
        .filter(Boolean),
    ),
  );

  if (!symbols.length) {
    return new Map();
  }

  const emptyPayload = { quotes: [] };
  const payload = await Promise.race([
    getQuoteSnapshots({
      symbols: symbols.join(","),
      allowMassiveFallback: true,
      admissionOwner: options.owner ?? "shadow-equity-position-quotes:positions",
      admissionIntent: "visible-live",
      admissionFallbackProvider: "massive",
      ttlMs: 15_000,
    }).catch(() => emptyPayload),
    sleep(SHADOW_EQUITY_POSITION_QUOTE_MAX_WAIT_MS).then(() => emptyPayload),
  ]);

  const quoteList = Array.isArray(payload.quotes)
    ? (payload.quotes as Array<Partial<QuoteSnapshot> | Record<string, unknown>>)
    : [];
  return new Map(
    quoteList
      .map((quote) => {
        const symbol = normalizeSymbol(
          String((quote as Record<string, unknown>).symbol ?? ""),
        ).toUpperCase();
        return [symbol, quote] as const;
      })
      .filter((entry): entry is readonly [string, Partial<QuoteSnapshot> | Record<string, unknown>] =>
        Boolean(entry[0]),
      ),
  );
}

function shadowUnderlyingMarketPayload(input: {
  symbol: string;
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined;
}) {
  const symbol = normalizeSymbol(input.symbol).toUpperCase();
  const quoteRecord = input.quote as Record<string, unknown> | null | undefined;
  if (!symbol || !quoteRecord) {
    return null;
  }

  const price =
    readPositiveNumber(quoteRecord.price) ??
    readPositiveNumber(quoteRecord.mark) ??
    readPositiveNumber(quoteRecord.last);
  const bid = readPositiveNumber(quoteRecord.bid);
  const ask = readPositiveNumber(quoteRecord.ask);
  if (price == null && bid == null && ask == null) {
    return null;
  }

  const updatedAt = shadowOptionQuoteTimestamp(quoteRecord);
  const previousClose =
    readPositiveNumber(quoteRecord.previousClose) ??
    readPositiveNumber(quoteRecord.prevClose);
  return {
    symbol,
    price,
    bid,
    ask,
    previousClose,
    prevClose: previousClose,
    change: toNumber(quoteRecord.change),
    changePercent: toNumber(quoteRecord.changePercent),
    dayChange: toNumber(quoteRecord.change),
    dayChangePercent: toNumber(quoteRecord.changePercent),
    updatedAt,
    dataUpdatedAt: updatedAt,
    quoteUpdatedAt: updatedAt,
    freshness: readString(quoteRecord.freshness),
    marketDataMode: readString(quoteRecord.marketDataMode),
    source: "underlying_quote",
  };
}

function shadowUnderlyingQuoteFromOptionQuote(
  symbol: string,
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const quoteRecord = quote as Record<string, unknown> | null | undefined;
  const price =
    readPositiveNumber(quoteRecord?.underlyingPrice) ??
    readPositiveNumber(quoteRecord?.undPrice);
  if (price == null) {
    return null;
  }
  return {
    symbol,
    price,
    mark: price,
    updatedAt:
      quoteRecord?.dataUpdatedAt ??
      quoteRecord?.updatedAt ??
      quoteRecord?.quoteUpdatedAt,
    dataUpdatedAt:
      quoteRecord?.dataUpdatedAt ??
      quoteRecord?.updatedAt ??
      quoteRecord?.quoteUpdatedAt,
    freshness: quoteRecord?.freshness ?? quoteRecord?.quoteFreshness,
    marketDataMode: quoteRecord?.marketDataMode,
  };
}

async function resolveFillPrice(input: ShadowOrderInput): Promise<{
  price: number;
  markSource: string;
}> {
  const requestedFillPrice = toNumber(input.requestedFillPrice);
  if (requestedFillPrice != null && requestedFillPrice > 0) {
    return { price: requestedFillPrice, markSource: "requested_fill" };
  }

  if (input.assetClass === "option") {
    const contract = asOptionContract(input.optionContract);
    if (!contract) {
      throw new HttpError(400, "Shadow option orders require a resolved option contract.", {
        code: "shadow_option_contract_required",
        expose: true,
      });
    }
    const mark = await resolveOptionMark(contract);
    const explicitLimit = toNumber(input.limitPrice);
    const price =
      input.side === "buy"
        ? mark.ask ?? mark.price ?? toNumber(input.limitPrice)
        : mark.bid ?? mark.price ?? explicitLimit;
    if (
      (price == null || price <= 0) &&
      input.side === "sell" &&
      explicitLimit != null &&
      explicitLimit >= 0 &&
      isExpiredOptionContractForShadowClose(contract)
    ) {
      return { price: cents(explicitLimit), markSource: "expired_option_limit" };
    }
    if (price == null || price <= 0) {
      throw new HttpError(409, "No option quote is available for the Shadow fill.", {
        code: "shadow_option_quote_unavailable",
        expose: true,
      });
    }
    enforceLimitMarketability(input, price);
    return { price: cents(price), markSource: mark.source };
  }

  const mark = await resolveEquityMark(input.symbol);
  const price =
    input.side === "buy"
      ? mark.ask ?? mark.price ?? toNumber(input.limitPrice)
      : mark.bid ?? mark.price ?? toNumber(input.limitPrice);
  if (price == null || price <= 0) {
    throw new HttpError(409, "No equity quote is available for the Shadow fill.", {
      code: "shadow_equity_quote_unavailable",
      expose: true,
    });
  }
  enforceLimitMarketability(input, price);
  return { price: cents(price), markSource: mark.source };
}

function enforceLimitMarketability(input: ShadowOrderInput, fillPrice: number) {
  const limit = toNumber(input.limitPrice);
  if (input.type !== "limit" || limit == null) {
    return;
  }
  if (input.side === "buy" && limit < fillPrice) {
    throw new HttpError(409, "Shadow buy limit is below the current simulated fill.", {
      code: "shadow_limit_not_marketable",
      expose: true,
      data: { limitPrice: limit, fillPrice },
    });
  }
  if (input.side === "sell" && limit > fillPrice) {
    throw new HttpError(409, "Shadow sell limit is above the current simulated fill.", {
      code: "shadow_limit_not_marketable",
      expose: true,
      data: { limitPrice: limit, fillPrice },
    });
  }
}

async function buildShadowFillPlan(input: ShadowOrderInput): Promise<ShadowFillPlan> {
  const symbol = normalizeSymbol(input.symbol).toUpperCase();
  const quantity = toNumber(input.quantity) ?? 0;
  if (quantity <= 0) {
    throw new HttpError(400, "Shadow orders require a positive quantity.", {
      code: "shadow_invalid_quantity",
      expose: true,
    });
  }
  if (input.assetClass === "option" && !asOptionContract(input.optionContract)) {
    throw new HttpError(400, "Shadow option orders require a resolved option contract.", {
      code: "shadow_option_contract_required",
      expose: true,
    });
  }
  if (
    input.assetClass === "option" &&
    input.side === "sell" &&
    input.optionContract?.right === "call" &&
    (input.positionEffect === "open" ||
      input.strategyIntent === "covered_call" ||
      input.strategyIntent === "uncovered_short_call")
  ) {
    throw new HttpError(409, "Shadow covered-call and uncovered-call sell-to-open fills are not enabled yet.", {
      code: "shadow_short_call_open_disabled",
      expose: true,
    });
  }

  const fill = await resolveFillPrice(input);
  const multiplier = marketMultiplier({
    assetClass: input.assetClass,
    optionContract: asOptionContract(input.optionContract),
  });
  const grossAmount = fill.price * quantity * multiplier;
  const fees = computeShadowOrderFees({
    assetClass: input.assetClass,
    quantity,
    price: fill.price,
    multiplier,
  });
  const requestedPositionKey =
    typeof input.positionKey === "string" && input.positionKey.trim()
      ? input.positionKey.trim()
      : null;
  const key = isAutomatedShadowSource(input.source) && requestedPositionKey
    ? requestedPositionKey
    : positionKey({
    symbol,
    assetClass: input.assetClass,
    optionContract: asOptionContract(input.optionContract),
  });
  const [position] = await db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, currentShadowAccountId()),
        eq(shadowPositionsTable.positionKey, key),
      ),
    )
    .limit(1);

  if (input.side === "buy") {
    const totals = await computeShadowTotalsForSource(null);
    const cash = totals.cash;
    const cashNeeded = grossAmount + fees;
    if (cashNeeded > cash) {
      throw new HttpError(409, "Shadow account has insufficient cash for this fill.", {
        code: "shadow_insufficient_cash",
        expose: true,
        data: { cash, cashNeeded },
      });
    }
    return {
      price: fill.price,
      fees,
      grossAmount,
      cashDelta: -(grossAmount + fees),
      realizedPnl: 0,
      multiplier,
      positionKey: key,
      markSource: fill.markSource,
    };
  }

  const openQuantity =
    position && position.status === "open" ? toNumber(position.quantity) ?? 0 : 0;
  if (openQuantity < quantity) {
    throw new HttpError(409, "Shadow account cannot sell more than the open position.", {
      code: "shadow_long_only_position_required",
      expose: true,
      data: { openQuantity, requestedQuantity: quantity },
    });
  }

  const averageCost = toNumber(position?.averageCost) ?? 0;
  const realizedPnl = (fill.price - averageCost) * quantity * multiplier - fees;
  return {
    price: fill.price,
    fees,
    grossAmount,
    cashDelta: grossAmount - fees,
    realizedPnl,
    multiplier,
    positionKey: key,
    markSource: fill.markSource,
  };
}

export async function previewShadowOrder(input: ShadowOrderInput) {
  const normalized = normalizeShadowOrderInput(input);
  await ensureShadowAccount();
  const plan = await buildShadowFillPlan(normalized);
  return {
    accountId: SHADOW_ACCOUNT_ID,
    mode: normalized.mode ?? "shadow",
    symbol: normalized.symbol,
    assetClass: normalized.assetClass,
    resolvedContractId: Number(
      asOptionContract(normalized.optionContract)?.providerContractId ?? 0,
    ),
    fillPrice: plan.price,
    fees: plan.fees,
    estimatedGrossAmount: plan.grossAmount,
    estimatedCashDelta: plan.cashDelta,
    orderPayload: {
      accountId: SHADOW_ACCOUNT_ID,
      symbol: normalized.symbol,
      assetClass: normalized.assetClass,
      side: normalized.side,
      type: normalized.type,
      quantity: normalized.quantity,
      limitPrice: normalized.limitPrice ?? null,
      stopPrice: normalized.stopPrice ?? null,
      timeInForce: normalized.timeInForce,
      optionContract: optionPayload(asOptionContract(normalized.optionContract)),
      source: normalized.source ?? "manual",
      fillModel: "internal_shadow_ledger",
      feeModel: "ibkr_pro_fixed",
      quoteSource: plan.markSource,
    },
    optionContract: optionPayload(asOptionContract(normalized.optionContract)),
  };
}

export async function placeShadowOrder(input: ShadowOrderInput) {
  const normalized = normalizeShadowOrderInput(input);
  await ensureShadowAccount();

  if (normalized.sourceEventId) {
    const [existing] = await dbTrading
      .select()
      .from(shadowOrdersTable)
      .where(eq(shadowOrdersTable.sourceEventId, normalized.sourceEventId))
      .limit(1);
    if (existing) {
      if (existing.source !== normalized.source) {
        const [updated] = await dbTrading
          .update(shadowOrdersTable)
          .set({
            source: normalized.source,
            clientOrderId: normalized.clientOrderId ?? existing.clientOrderId,
            updatedAt: new Date(),
          })
          .where(eq(shadowOrdersTable.id, existing.id))
          .returning();
        // source/clientOrderId are analytics-classification inputs — drop the
        // memoized verdict so the next recompute re-reads this order.
        invalidateShadowLedgerAnalyticsOrderClassification(existing.id);
        invalidateShadowFreshStateCache();
        notifyShadowAccountChanged();
        return orderRowToResponse(updated);
      }
      return orderRowToResponse(existing);
    }
  }
  if (normalized.clientOrderId) {
    const [existing] = await dbTrading
      .select()
      .from(shadowOrdersTable)
      .where(eq(shadowOrdersTable.clientOrderId, normalized.clientOrderId))
      .limit(1);
    if (existing) {
      return orderRowToResponse(existing);
    }
  }

  const plan = await buildShadowFillPlan(normalized);
  const snapshotSource = shadowBalanceSnapshotSourceForOrder({
    source: input.source ?? normalized.source,
    payload: normalized.payload,
    positionKey: plan.positionKey,
  });
  const now = normalized.placedAt ?? new Date();
  const orderId = randomUUID();
  const fillId = randomUUID();
  const optionContract = asOptionContract(normalized.optionContract);
  const quantity = toNumber(normalized.quantity) ?? 0;
  const symbol = normalizeSymbol(normalized.symbol).toUpperCase();
  const positionType = classifyAccountPositionType({
    symbol,
    assetClass: normalized.assetClass,
    optionContract,
  });

  await dbTrading.transaction(async (tx) => {
    await tx.insert(shadowOrdersTable).values({
      id: orderId,
      accountId: currentShadowAccountId(),
      source: normalized.source ?? "manual",
      sourceEventId: normalized.sourceEventId ?? null,
      clientOrderId:
        normalized.clientOrderId ??
        `shadow-${normalized.source ?? "manual"}-${orderId}`,
      symbol,
      assetClass: normalized.assetClass,
      positionType,
      side: normalized.side,
      type: normalized.type,
      timeInForce: normalized.timeInForce,
      status: "filled",
      quantity: money(quantity),
      filledQuantity: money(quantity),
      limitPrice: normalized.limitPrice == null ? null : money(normalized.limitPrice),
      stopPrice: normalized.stopPrice == null ? null : money(normalized.stopPrice),
      averageFillPrice: money(plan.price),
      fees: money(plan.fees),
      optionContract: optionPayload(optionContract),
      payload: normalized.payload ?? {},
      placedAt: now,
      filledAt: now,
    });

    await tx.insert(shadowFillsTable).values({
      id: fillId,
      accountId: currentShadowAccountId(),
      orderId,
      sourceEventId: normalized.sourceEventId ?? null,
      symbol,
      assetClass: normalized.assetClass,
      positionType,
      side: normalized.side,
      quantity: money(quantity),
      price: money(plan.price),
      grossAmount: money(plan.grossAmount),
      fees: money(plan.fees),
      realizedPnl: money(plan.realizedPnl),
      cashDelta: money(plan.cashDelta),
      optionContract: optionPayload(optionContract),
      occurredAt: now,
    });

    await upsertPositionForFill(tx, {
      symbol,
      assetClass: normalized.assetClass,
      optionContract,
      positionKey: plan.positionKey,
      side: normalized.side,
      quantity,
      price: plan.price,
      fees: plan.fees,
      realizedPnl: plan.realizedPnl,
      multiplier: plan.multiplier,
      occurredAt: now,
    });

    await recomputeShadowAccountFromLedger(tx, now);
  });

  await writeShadowBalanceSnapshot(snapshotSource, now);

  const [order] = await dbTrading
    .select()
    .from(shadowOrdersTable)
    .where(eq(shadowOrdersTable.id, orderId))
    .limit(1);
  return orderRowToResponse(order);
}

function isSignalOptionsShadowSource(source: string | null | undefined) {
  return source === "automation" || source === SIGNAL_OPTIONS_REPLAY_SOURCE;
}

function shadowMaintenanceOrderSource(
  _order: ShadowOrderRow | null,
): ShadowOrderSource {
  return "automation";
}

function sourceDeploymentIdFromShadowOrder(order: ShadowOrderRow | null) {
  const payload = readRecord(order?.payload) ?? {};
  const metadata = readRecord(payload.metadata) ?? {};
  const replay = readRecord(payload.replay) ?? {};
  const candidate = readRecord(payload.candidate) ?? {};
  return (
    readString(metadata.deploymentId) ??
    readString(replay.deploymentId) ??
    readString(candidate.deploymentId)
  );
}

async function findSignalOptionsEntryOrderForPosition(
  position: ShadowPositionRow,
) {
  const orders = await db
    .select()
    .from(shadowOrdersTable)
    .where(
      and(
        eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowOrdersTable.assetClass, "option"),
        eq(shadowOrdersTable.side, "buy"),
        eq(shadowOrdersTable.symbol, position.symbol),
      ),
    )
    .orderBy(desc(shadowOrdersTable.placedAt))
    .limit(100);

  return (
    orders.find(
      (order) =>
        isSignalOptionsShadowSource(order.source) &&
        shadowPositionKeyForOrder(order) === position.positionKey,
      ) ?? null
  );
}

function signalOptionsEntryQualityFromRecord(
  value: unknown,
): SignalOptionsEntryQuality | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  const tier = readString(record.tier);
  const liquidityTier = readString(record.liquidityTier);
  if (
    tier !== "high" &&
    tier !== "standard" &&
    tier !== "low" &&
    liquidityTier !== "strong" &&
    liquidityTier !== "standard" &&
    liquidityTier !== "weak"
  ) {
    return null;
  }
  if (tier !== "high" && tier !== "standard" && tier !== "low") {
    return null;
  }
  if (
    liquidityTier !== "strong" &&
    liquidityTier !== "standard" &&
    liquidityTier !== "weak"
  ) {
    return null;
  }
  const mtfDirections = Array.isArray(record.mtfDirections)
    ? record.mtfDirections.map(toNumber).filter((item): item is number => item != null)
    : [];
  const reasons = Array.isArray(record.reasons)
    ? record.reasons
        .map((item) => readString(item))
        .filter((item): item is string => Boolean(item))
    : [];
  return {
    tier,
    liquidityTier,
    score: toNumber(record.score) ?? 0,
    reasons,
    raw: readRecord(record.raw) ?? undefined,
    adx: toNumber(record.adx),
    mtfMatches: toNumber(record.mtfMatches) ?? 0,
    mtfDirections,
    spreadPctOfMid: toNumber(record.spreadPctOfMid),
    bullishRegime: record.bullishRegime === true,
  };
}

async function resolveSignalOptionsShadowMarkExitContext(
  position: ShadowPositionRow,
): Promise<SignalOptionsShadowMarkExitContext | null> {
  const entryOrder = await findSignalOptionsEntryOrderForPosition(position);
  if (!entryOrder || entryOrder.source !== "automation") {
    return null;
  }
  const [entryEvent] = entryOrder.sourceEventId
    ? await db
        .select()
        .from(executionEventsTable)
        .where(eq(executionEventsTable.id, entryOrder.sourceEventId))
        .limit(1)
    : [];
  const deploymentId =
    (entryEvent?.deploymentId ? String(entryEvent.deploymentId) : null) ??
    sourceDeploymentIdFromShadowOrder(entryOrder);
  if (!deploymentId) {
    return null;
  }
  const [deployment] = await db
    .select()
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, deploymentId))
    .limit(1);
  if (!deployment?.enabled) {
    return null;
  }
  const payload = readRecord(entryEvent?.payload) ?? readRecord(entryOrder.payload) ?? {};
  const positionPayload = readRecord(payload.position) ?? {};
  const candidatePayload = readRecord(payload.candidate) ?? {};
  return {
    deployment,
    profile: resolveSignalOptionsExecutionProfile(deployment.config),
    entryOrder,
    entryEvent: entryEvent ?? null,
    signalQuality:
      signalOptionsEntryQualityFromRecord(positionPayload.signalQuality) ??
      signalOptionsEntryQualityFromRecord(candidatePayload.signalQuality),
  };
}

async function readShadowPositionPeakMarkPrice(
  position: Pick<ShadowPositionRow, "id" | "openedAt" | "averageCost">,
) {
  const result = await pool.query<{ peak: string | null }>(
    `
      select mark as peak
      from shadow_position_marks
      where position_id = $1
        and as_of >= $2
      order by mark desc
      limit 1
    `,
    [position.id, position.openedAt],
  );
  const row = result.rows[0];
  return Math.max(
    toNumber(row?.peak) ?? 0,
    toNumber(position.averageCost) ?? 0,
  );
}

async function readShadowPositionPeakMarkPrices(
  positions: Pick<ShadowPositionRow, "id" | "averageCost">[],
) {
  const positionIds = Array.from(
    new Set(positions.map((position) => position.id).filter(Boolean)),
  );
  if (!positionIds.length) {
    return new Map<string, number>();
  }
  const result = await pool.query<{ positionId: string; peak: string | null }>(
    `
      select
        requested.position_id as "positionId",
        mark.mark as peak
      from unnest($1::uuid[]) as requested(position_id)
      left join lateral (
        select mark
        from shadow_position_marks
        where position_id = requested.position_id
        order by mark desc
        limit 1
      ) mark on true
    `,
    [positionIds],
  );
  const averageCostById = new Map(
    positions.map((position) => [position.id, toNumber(position.averageCost) ?? 0]),
  );
  const peakById = new Map<string, number>();
  for (const row of result.rows) {
    peakById.set(
      row.positionId,
      Math.max(toNumber(row.peak) ?? 0, averageCostById.get(row.positionId) ?? 0),
    );
  }
  return peakById;
}

function signalOptionsShadowQuotePayload(input: {
  contract: ShadowOptionContract;
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined;
  pricing: ShadowOptionPricingPolicy;
}) {
  const quote = (input.quote ?? {}) as Record<string, unknown>;
  return {
    contract: optionPayload(input.contract),
    bid: toNumber(quote.bid),
    ask: toNumber(quote.ask),
    last: toNumber(quote.last ?? quote.price),
    mark: input.pricing.quoteMark,
    quoteFreshness: input.pricing.quoteFreshness,
    marketDataMode: input.pricing.marketDataMode,
    quoteUpdatedAt:
      quote.updatedAt instanceof Date
        ? quote.updatedAt.toISOString()
        : readString(quote.updatedAt),
    dataUpdatedAt:
      quote.dataUpdatedAt instanceof Date
        ? quote.dataUpdatedAt.toISOString()
        : readString(quote.dataUpdatedAt),
    ageMs: toNumber(quote.ageMs),
  };
}

function signalOptionsShadowMarkExitPositionPayload(input: {
  position: ShadowPositionRow;
  contract: ShadowOptionContract;
  context: SignalOptionsShadowMarkExitContext;
  markPrice: number;
  peakPrice: number;
  stopPrice: number;
  markAt: Date;
}) {
  const entryPayload =
    readRecord(input.context.entryEvent?.payload) ??
    readRecord(input.context.entryOrder.payload) ??
    {};
  const entryPosition = readRecord(entryPayload.position) ?? {};
  const candidate = readRecord(entryPayload.candidate) ?? {};
  const quantity = toNumber(input.position.quantity) ?? 0;
  const entryPrice = toNumber(input.position.averageCost) ?? 0;
  const multiplier = marketMultiplier({
    assetClass: "option",
    optionContract: input.contract,
  });
  const direction =
    candidate.direction === "sell" || entryPosition.direction === "sell"
      ? "sell"
      : "buy";
  return {
    id:
      readString(entryPosition.id) ??
      `${input.context.deployment.id}:${input.position.symbol}`,
    candidateId:
      readString(entryPosition.candidateId) ??
      readString(candidate.id) ??
      `${input.context.deployment.id}:${input.position.symbol}`,
    symbol: input.position.symbol,
    direction,
    optionRight: input.contract.right,
    timeframe: readString(entryPosition.timeframe) ?? readString(candidate.timeframe) ?? "5m",
    signalAt:
      readString(entryPosition.signalAt) ??
      readString(candidate.signalAt) ??
      input.position.openedAt.toISOString(),
    openedAt: input.position.openedAt.toISOString(),
    entryPrice,
    quantity,
    peakPrice: input.peakPrice,
    stopPrice: input.stopPrice,
    premiumAtRisk: Number((entryPrice * quantity * multiplier).toFixed(2)),
    selectedContract: optionPayload(input.contract),
    lastMarkPrice: Number(input.markPrice.toFixed(2)),
    lastMarkedAt: input.markAt.toISOString(),
    signalQuality: input.context.signalQuality,
  };
}

type SignalOptionsShadowExitEventCandidate = {
  deploymentId: string;
  symbol: string;
  since: Date;
};

type SignalOptionsShadowExitEventRow = {
  deploymentId: string | null;
  symbol: string | null;
  occurredAt: Date;
  payload?: unknown | null;
};

// Dedup rule shared by the force-close pass, the mark-time stop emitter, and the
// expiration ledger-sync emitter: a candidate final exit is a duplicate if a
// non-partial SIGNAL_OPTIONS_SHADOW_EXIT_EVENT already exists for the same
// deployment+symbol at/after the position's openedAt. Partial scale-outs have
// their own identity and must not block the later final exit.
function signalOptionsShadowExitEventIsDuplicate(
  candidate: SignalOptionsShadowExitEventCandidate,
  existingEvents: SignalOptionsShadowExitEventRow[],
): boolean {
  const normalizedSymbol = normalizeSymbol(candidate.symbol).toUpperCase();
  return existingEvents.some(
    (event) =>
      readRecord(event.payload)?.partial !== true &&
      event.deploymentId === candidate.deploymentId &&
      event.symbol != null &&
      normalizeSymbol(event.symbol).toUpperCase() === normalizedSymbol &&
      event.occurredAt.getTime() >= candidate.since.getTime(),
  );
}

async function hasExistingSignalOptionsShadowExitEvent(
  candidate: SignalOptionsShadowExitEventCandidate,
): Promise<boolean> {
  const normalizedSymbol = normalizeSymbol(candidate.symbol).toUpperCase();
  const existing = await db
    .select({
      deploymentId: executionEventsTable.deploymentId,
      symbol: executionEventsTable.symbol,
      occurredAt: executionEventsTable.occurredAt,
      payload: executionEventsTable.payload,
    })
    .from(executionEventsTable)
    .where(
      and(
        eq(executionEventsTable.deploymentId, candidate.deploymentId),
        eq(executionEventsTable.eventType, SIGNAL_OPTIONS_SHADOW_EXIT_EVENT),
        eq(executionEventsTable.symbol, normalizedSymbol),
        gte(executionEventsTable.occurredAt, candidate.since),
        sql`${executionEventsTable.payload}->>'partial' is distinct from 'true'`,
      ),
    )
    .limit(1);
  return signalOptionsShadowExitEventIsDuplicate(candidate, existing);
}

async function recordSignalOptionsShadowMarkExit(input: {
  position: ShadowPositionRow;
  contract: ShadowOptionContract;
  context: SignalOptionsShadowMarkExitContext;
  exitReason: "hard_stop" | "runner_trail_stop";
  markPrice: number;
  peakPrice: number;
  exitPrice: number;
  stop: ReturnType<typeof computeSignalOptionsPositionStop>;
  pricing: ShadowOptionPricingPolicy;
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined;
  markAt: Date;
}) {
  const [current] = await db
    .select({ status: shadowPositionsTable.status })
    .from(shadowPositionsTable)
    .where(eq(shadowPositionsTable.id, input.position.id))
    .limit(1);
  if (current?.status !== "open") {
    return null;
  }
  // Dedup guard (same rule as the force-close pass): the mark-time stop chain
  // only mutates shadow_positions via a downstream mirror-sell reaction to the
  // event inserted below. If that mirror sell warn-swallows a failure, this row
  // stays status='open' with the exit event already recorded — without this
  // check the next mark refresh would re-breach the same stop and emit a SECOND
  // pnl-bearing exit event, double-counting the daily-loss halt.
  if (
    await hasExistingSignalOptionsShadowExitEvent({
      deploymentId: input.context.deployment.id,
      symbol: input.position.symbol,
      since: input.position.openedAt,
    })
  ) {
    return null;
  }
  const quantity = toNumber(input.position.quantity) ?? 0;
  const entryPrice = toNumber(input.position.averageCost) ?? 0;
  if (quantity <= 0 || entryPrice <= 0) {
    return null;
  }
  // Use the real contract multiplier (matches premiumAtRisk) instead of a
  // hardcoded 100 so realized exit P&L is correct for adjusted/mini contracts.
  const multiplier = marketMultiplier({
    assetClass: "option",
    optionContract: input.contract,
  });
  const positionPayload = signalOptionsShadowMarkExitPositionPayload({
    position: input.position,
    contract: input.contract,
    context: input.context,
    markPrice: input.markPrice,
    peakPrice: input.peakPrice,
    stopPrice: input.stop.stopPrice,
    markAt: input.markAt,
  });
  const payload = {
    metadata: {
      deploymentId: input.context.deployment.id,
      deploymentName: normalizeLegacyAlgoBrandText(input.context.deployment.name),
      positionKey: input.position.positionKey,
      runMode: "live_shadow_mark",
      runSource: "shadow_mark",
      runPhase: "mark_enforcement",
    },
    reason: input.exitReason,
    enforcementSource: "shadow_mark",
    exitPrice: input.exitPrice,
    markPrice: input.markPrice,
    pnl: Number(
      ((input.exitPrice - entryPrice) * quantity * multiplier).toFixed(2),
    ),
    position: positionPayload,
    selectedContract: optionPayload(input.contract),
    quote: signalOptionsShadowQuotePayload({
      contract: input.contract,
      quote: input.quote,
      pricing: input.pricing,
    }),
    liquidity: {
      bid: input.pricing.quoteBid,
      ask: input.pricing.quoteAsk,
      mid: input.pricing.quoteMid,
    },
    markResolution: {
      source: input.pricing.valuationSource,
      reason: input.pricing.valuationReason,
      quoteFreshness: input.pricing.quoteFreshness,
      marketDataMode: input.pricing.marketDataMode,
      markSource: "shadow_position_marks",
    },
    stop: {
      ...input.stop,
      enforcementSource: "shadow_mark",
    },
  };
  const [event] = await db
    .insert(executionEventsTable)
    .values({
      deploymentId: input.context.deployment.id,
      providerAccountId: input.context.deployment.providerAccountId,
      symbol: normalizeSymbol(input.position.symbol).toUpperCase(),
      eventType: SIGNAL_OPTIONS_SHADOW_EXIT_EVENT,
      summary: `${input.position.symbol} shadow exit ${input.exitReason} at ${input.exitPrice.toFixed(2)}`,
      payload,
      occurredAt: input.markAt,
    })
    .returning();
  await recordShadowAutomationEvent(event, { source: "automation" }).catch((error) => {
    logger.warn?.(
      { err: error, eventId: event.id, eventType: event.eventType },
      "Failed to mirror signal-options mark-time stop exit into Shadow account ledger",
    );
  });
  notifyAlgoCockpitChanged({
    deploymentId: input.context.deployment.id,
    mode: input.context.deployment.mode,
    reason: SIGNAL_OPTIONS_SHADOW_EXIT_EVENT,
  });
  return event;
}

function isSignalOptionsShadowMarkStopExitReason(
  reason: unknown,
): reason is "hard_stop" | "runner_trail_stop" {
  return reason === "hard_stop" || reason === "runner_trail_stop";
}

type SignalOptionsTrailingStopEnforcementInput = {
  position: ShadowPositionRow;
  contract: ShadowOptionContract;
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined;
  pricing: ShadowOptionPricingPolicy;
  markPrice: number;
  markAt: Date;
};

function recordSignalOptionsTrailingStopEnforcementFailure(input: {
  error: unknown;
  position: ShadowPositionRow;
  markPrice: number;
  markAt: Date;
}) {
  const error =
    input.error instanceof Error
      ? input.error
      : new Error(String(input.error ?? "Unknown enforcement failure"));
  const diagnostic: SignalOptionsTrailingStopEnforcementFailureDiagnostic = {
    positionId: input.position.id,
    symbol: input.position.symbol,
    message: error.message,
    name: error.name || null,
    markPrice: input.markPrice,
    markAt: input.markAt,
    observedAt: new Date(),
  };
  signalOptionsTrailingStopEnforcementFailures.count += 1;
  signalOptionsTrailingStopEnforcementFailures.recent.push(diagnostic);
  while (
    signalOptionsTrailingStopEnforcementFailures.recent.length >
    SIGNAL_OPTIONS_TRAILING_STOP_ENFORCEMENT_FAILURE_LIMIT
  ) {
    signalOptionsTrailingStopEnforcementFailures.recent.shift();
  }
  return diagnostic;
}

function getSignalOptionsTrailingStopEnforcementFailureDiagnostics() {
  return {
    count: signalOptionsTrailingStopEnforcementFailures.count,
    recent: signalOptionsTrailingStopEnforcementFailures.recent.map((event) => ({
      ...event,
    })),
  };
}

function resetSignalOptionsTrailingStopEnforcementFailureDiagnosticsForTests() {
  signalOptionsTrailingStopEnforcementFailures.count = 0;
  signalOptionsTrailingStopEnforcementFailures.recent.length = 0;
}

async function enforceSignalOptionsTrailingStopFromShadowMark(
  input: SignalOptionsTrailingStopEnforcementInput,
) {
  const context = await resolveSignalOptionsShadowMarkExitContext(input.position);
  if (!context) {
    return { exited: false, reason: "not_signal_options_position" };
  }
  const peakPrice = Math.max(
    await readShadowPositionPeakMarkPrice(input.position),
    input.markPrice,
  );
  const entryPrice = toNumber(input.position.averageCost) ?? 0;
  const decision = computeSignalOptionsShadowMarkExitDecision({
    contract: input.contract,
    entryPrice,
    markPrice: input.markPrice,
    peakPrice,
    profile: context.profile,
    pricing: input.pricing,
    markAt: input.markAt,
    signalQuality: context.signalQuality,
  });
  if (
    !isSignalOptionsShadowMarkStopExitReason(decision.exitReason) ||
    decision.exitPrice == null ||
    !decision.stop
  ) {
    return { exited: false, reason: decision.skipReason ?? "stop_not_breached" };
  }
  await recordSignalOptionsShadowMarkExit({
    position: input.position,
    contract: input.contract,
    context,
    exitReason: decision.exitReason,
    markPrice: input.markPrice,
    peakPrice,
    exitPrice: decision.exitPrice,
    stop: decision.stop,
    pricing: input.pricing,
    quote: input.quote,
    markAt: input.markAt,
  });
  return { exited: true, reason: decision.exitReason };
}

async function enforceSignalOptionsTrailingStopFromShadowMarkSafely(
  input: SignalOptionsTrailingStopEnforcementInput,
  options: {
    enforce?: (
      enforcementInput: SignalOptionsTrailingStopEnforcementInput,
    ) => Promise<{ exited: boolean; reason: string }>;
  } = {},
) {
  try {
    const enforce =
      options.enforce ?? enforceSignalOptionsTrailingStopFromShadowMark;
    return await enforce(input);
  } catch (error) {
    const diagnostic = recordSignalOptionsTrailingStopEnforcementFailure({
      error,
      position: input.position,
      markPrice: input.markPrice,
      markAt: input.markAt,
    });
    logger.warn?.(
      {
        err: error,
        positionId: input.position.id,
        symbol: input.position.symbol,
        enforcementFailureCount:
          signalOptionsTrailingStopEnforcementFailures.count,
      },
      "Signal-options mark-time trailing stop enforcement failed",
    );
    return {
      exited: false,
      reason: "enforcement_failed",
      diagnostic,
    };
  }
}

async function resolveMaintenanceOptionExitPrice(input: {
  position: ShadowPositionRow;
  contract: ShadowOptionContract;
  now: Date;
}): Promise<{ price: number; source: string }> {
  const quote = await resolveOptionMark(input.contract).catch(() => null);
  const quotePrice = toNumber(quote?.bid) ?? toNumber(quote?.price);
  if (quotePrice != null && quotePrice > 0) {
    return { price: cents(quotePrice), source: quote?.source ?? "option_quote" };
  }

  const rowMark = toNumber(input.position.mark);
  if (rowMark != null && rowMark > 0) {
    return { price: cents(rowMark), source: "shadow_position_mark" };
  }

  const underlying = await resolveEquityMark(input.contract.underlying).catch(() => null);
  const underlyingPrice = toNumber(underlying?.price);
  if (underlyingPrice != null && underlyingPrice > 0) {
    const intrinsic =
      input.contract.right === "call"
        ? Math.max(0, underlyingPrice - input.contract.strike)
        : Math.max(0, input.contract.strike - underlyingPrice);
    return {
      price: cents(intrinsic),
      source: intrinsic > 0 ? "expiration_intrinsic" : "expiration_otm_zero",
    };
  }

  return { price: 0, source: "expiration_unpriced_zero" };
}

function resolveHistoricalBackfillExpirationExitPrice(input: {
  position: Pick<ShadowPositionRow, "mark" | "averageCost">;
}): { price: number; source: string } {
  const rowMark = toNumber(input.position.mark);
  if (rowMark != null && rowMark > 0) {
    return { price: cents(rowMark), source: "historical_backfill_last_mark" };
  }

  const averageCost = toNumber(input.position.averageCost);
  if (averageCost != null && averageCost > 0) {
    return { price: cents(averageCost), source: "historical_backfill_average_cost" };
  }

  return { price: 0, source: "historical_backfill_unpriced_zero" };
}

// Fix B(i): a "hard breach" that should have already closed the position but
// lingered (typically because the in-scan mark-stop path requires an actionable
// option_quote — `computeSignalOptionsShadowMarkExitDecision` returns
// `mark_not_actionable` when no live quote exists — so a position whose recorded
// mark is already through its stop never got force-closed). We re-derive the stop
// from the position's recorded mark (entry=averageCost, peak=recorded peak mark)
// using the same `computeSignalOptionsPositionStop` as the live path, so the
// breach predicate is identical to enforcement; the only difference is we admit it
// without requiring a fresh quote. We treat as a breach: a premium stop
// (hard_stop / runner_trail_stop), a wire structure break, or a large markReturn
// drawdown floor (defense for stops that didn't latch). Greek/wire context is
// unavailable here, so the structure-break leg is best-effort; the hard_stop and
// drawdown legs are the load-bearing backstops.
const SHADOW_FORCE_CLOSE_MARK_DRAWDOWN_PCT = -90;

type ShadowMaintenanceBreach = {
  exitReason:
    | "hard_stop"
    | "runner_trail_stop"
    | "wire_structure_break"
    | "mark_drawdown";
  markReturnPct: number;
};

async function detectShadowMaintenanceBreach(input: {
  contract: ShadowOptionContract;
  position: ShadowPositionRow;
  context: SignalOptionsShadowMarkExitContext;
}): Promise<ShadowMaintenanceBreach | null> {
  const entryPrice = toNumber(input.position.averageCost) ?? 0;
  const markPrice = toNumber(input.position.mark);
  if (entryPrice <= 0 || markPrice == null || markPrice < 0) {
    return null;
  }
  // Peak is read from the live path's source of truth (shadow_position_marks),
  // floored at entry and at the current mark — so a position that peaked high then
  // fell back to its trail-stop level is still detected (don't understate the peak).
  const recordedPeak = await readShadowPositionPeakMarkPrice(input.position);
  const stop = computeSignalOptionsPositionStop({
    entryPrice,
    peakPrice: Math.max(recordedPeak, markPrice),
    markPrice,
    profile: input.context.profile,
    signalQuality: input.context.signalQuality ?? null,
  });
  if (
    stop.exitReason === "hard_stop" ||
    stop.exitReason === "runner_trail_stop" ||
    // wire_structure_break is UNREACHABLE here: this sweep calls
    // computeSignalOptionsPositionStop WITHOUT a wireContext, and structureBreak
    // requires a selected wire (exit-policy.ts:393-406), so the exit reason can never
    // be "wire_structure_break". The branch only satisfies the exhaustive union. If this
    // sweep is ever given a wireContext, it MUST gate this reason on
    // isSignalOptionsWireTrailEnforceEnabled() to preserve the shadow-first invariant.
    stop.exitReason === "wire_structure_break"
  ) {
    return { exitReason: stop.exitReason, markReturnPct: stop.markReturnPct };
  }
  if (stop.markReturnPct <= SHADOW_FORCE_CLOSE_MARK_DRAWDOWN_PCT) {
    return { exitReason: "mark_drawdown", markReturnPct: stop.markReturnPct };
  }
  return null;
}

// Fix B(i): "force at any price" close-price ladder — the backstop for the
// no-quote case the user routed here. Recorded mark -> intrinsic (from underlying)
// -> a 0.01 floor (never 0, so the settling sell still books a defined exit).
async function resolveShadowForceCloseExitPrice(input: {
  position: ShadowPositionRow;
  contract: ShadowOptionContract;
}): Promise<{ price: number; source: "force" }> {
  const rowMark = toNumber(input.position.mark);
  if (rowMark != null && rowMark > 0) {
    return { price: cents(rowMark), source: "force" };
  }
  const underlying = await resolveEquityMark(input.contract.underlying).catch(
    () => null,
  );
  const underlyingPrice = toNumber(underlying?.price);
  if (underlyingPrice != null && underlyingPrice > 0) {
    const intrinsic =
      input.contract.right === "call"
        ? Math.max(0, underlyingPrice - input.contract.strike)
        : Math.max(0, input.contract.strike - underlyingPrice);
    if (intrinsic > 0) {
      return { price: cents(intrinsic), source: "force" };
    }
  }
  return { price: 0.01, source: "force" };
}

// Fix B(i)/B(ii): robustly recover the `<deploymentId>:<SYMBOL>` ledger position
// id and deploymentId even when the source entry event has aged out. The DB row
// id is a random uuid and positionKey carries no deployment, so the only place the
// deployment is encoded on the position is the entry event's `deployment_id`
// column or a previously-written ledger position id of the form `<uuid>:<SYMBOL>`.
function recoverDeploymentIdFromLedgerPositionId(
  value: unknown,
): string | null {
  const text = readString(value);
  if (!text) {
    return null;
  }
  const separator = text.lastIndexOf(":");
  if (separator <= 0) {
    return null;
  }
  const candidate = text.slice(0, separator);
  return /^[0-9a-f-]{36}$/i.test(candidate) ? candidate : null;
}

export async function runShadowOptionMaintenance(input: {
  source?: "worker";
  now?: Date;
} = {}): Promise<ShadowOptionMaintenanceSummary> {
  const now = input.now ?? new Date();
  const openPositions = await db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.assetClass, "option"),
        eq(shadowPositionsTable.status, "open"),
      ),
    )
    .orderBy(desc(shadowPositionsTable.updatedAt));
  const deployments = await db
    .select({ id: algoDeploymentsTable.id })
    .from(algoDeploymentsTable);
  const deploymentIds = new Set(deployments.map((deployment) => deployment.id));
  const summary: ShadowOptionMaintenanceSummary = {
    checkedCount: openPositions.length,
    dueCount: 0,
    closedCount: 0,
    skippedCount: 0,
    orphanCount: 0,
    forceClosedCount: 0,
    reconciledCount: 0,
    errors: [],
  };

  for (const position of openPositions) {
    const contract = asOptionContract(position.optionContract);
    if (!contract || !shouldCloseOptionForShadowMaintenance(contract, now)) {
      continue;
    }
    summary.dueCount += 1;

    const sourceOrder = await findSignalOptionsEntryOrderForPosition(position);
    if (!sourceOrder) {
      summary.skippedCount += 1;
      continue;
    }
    const isBackfillOrder = isSignalOptionsBackfillShadowOrder(sourceOrder);
    if (isHistoricalSignalOptionsShadowOrder(sourceOrder) && !isBackfillOrder) {
      summary.skippedCount += 1;
      continue;
    }
    const deploymentId = sourceDeploymentIdFromShadowOrder(sourceOrder);
    const sourceEntryEvent =
      sourceOrder.sourceEventId != null
        ? (await db
            .select()
            .from(executionEventsTable)
            .where(eq(executionEventsTable.id, sourceOrder.sourceEventId))
            .limit(1))[0]
        : undefined;
    const sourceEventMissing =
      sourceOrder.sourceEventId != null && !sourceEntryEvent;
    const orphanedDeployment =
      sourceEventMissing || (deploymentId ? !deploymentIds.has(deploymentId) : false);
    if ((deploymentId && !deploymentIds.has(deploymentId)) || sourceEventMissing) {
      summary.orphanCount += 1;
    }

    try {
      const quantity = toNumber(position.quantity) ?? 0;
      if (quantity <= 0) {
        summary.skippedCount += 1;
        continue;
      }
      const exit = isBackfillOrder
        ? resolveHistoricalBackfillExpirationExitPrice({ position })
        : await resolveMaintenanceOptionExitPrice({
            position,
            contract,
            now,
          });
      const source = shadowMaintenanceOrderSource(sourceOrder);
      const dateKey = marketDateParts(now).key;
      await placeShadowOrder({
        accountId: SHADOW_ACCOUNT_ID,
        mode: "shadow",
        symbol: position.symbol,
        assetClass: "option",
        side: "sell",
        type: "limit",
        quantity,
        limitPrice: exit.price,
        stopPrice: null,
        timeInForce: "day",
        optionContract: contract,
        source,
        clientOrderId: `shadow-expiry-maintenance-${position.id}-${dateKey}`,
        positionKey: position.positionKey,
        requestedFillPrice: exit.price > 0 ? exit.price : null,
        payload: {
          maintenance: true,
          maintenanceReason: isBackfillOrder
            ? "historical_backfill_option_expiration"
            : "option_expiration",
          exitReason: "expiration",
          priceSource: exit.source,
          backfill: isBackfillOrder ? { source: SIGNAL_OPTIONS_BACKFILL_SOURCE } : null,
          sourceOrderId: sourceOrder.id,
          sourceEventId: sourceOrder.sourceEventId,
          sourceEventMissing,
          sourceDeploymentId: deploymentId,
          orphanedDeployment,
          positionId: position.id,
          positionKey: position.positionKey,
          previousMark: toNumber(position.mark),
          optionContract: optionPayload(contract),
        },
        placedAt: now,
      });
      summary.closedCount += 1;

      // Sync the expiration close into the execution-events ledger so the entry
      // gate's active-position view (deriveActivePositions) stops treating the
      // expired position as phantom-open and unblocks same-direction re-entry.
      // Only real deployment positions get a ledger exit: backfill expirations
      // already emit their own exit elsewhere, and orphaned/missing-source
      // positions have no entry event to reconcile against. This event carries
      // `pnl` (like the force-close / live exit paths) so the realized loss lands
      // in the daily-loss halt: at close-time the position leaves the open
      // unrealized term, so WITHOUT `pnl` here its loss would vanish from the halt
      // budget entirely (counted as neither realized nor unrealized) and the cap
      // could un-trip and keep trading. It is the ONLY exit event for this
      // position (the maintenance sell does not emit one), so `pnl` is banked
      // exactly once; it stays ledger-sync-only (no second sell, not mirrored).
      const isRealDeploymentExit =
        !isBackfillOrder &&
        !orphanedDeployment &&
        !sourceEventMissing &&
        deploymentId != null &&
        deploymentIds.has(deploymentId);
      // Dedup guard (same rule as the force-close pass): a prior mark-time stop
      // exit can leave this row status='open' if its mirror sell warn-swallowed a
      // failure (see recordSignalOptionsShadowMarkExit). The settling sell above
      // still runs unconditionally to actually close out shadow_positions, but
      // skip this ledger-sync pnl event if one was already banked for this
      // deployment+symbol since the position opened, so the daily-loss halt only
      // counts the close once.
      const alreadyExited =
        isRealDeploymentExit && deploymentId != null
          ? await hasExistingSignalOptionsShadowExitEvent({
              deploymentId,
              symbol: position.symbol,
              since: position.openedAt,
            })
          : false;
      if (isRealDeploymentExit && !alreadyExited) {
        const entryPayload = readRecord(sourceEntryEvent?.payload) ?? {};
        const entryPosition = readRecord(entryPayload.position) ?? {};
        const entryCandidate = readRecord(entryPayload.candidate) ?? {};
        const candidateId =
          readString(entryCandidate.id) ??
          readString(entryPosition.candidateId) ??
          null;
        const ledgerPositionId =
          readString(entryPosition.id) ?? position.id;
        const expirationRealizedPnl = Number(
          (
            (exit.price - (toNumber(position.averageCost) ?? 0)) *
            quantity *
            (toNumber(contract.multiplier) ?? 100)
          ).toFixed(2),
        );
        await db.insert(executionEventsTable).values({
          deploymentId,
          providerAccountId: sourceEntryEvent?.providerAccountId ?? null,
          symbol: normalizeSymbol(position.symbol).toUpperCase(),
          eventType: SIGNAL_OPTIONS_SHADOW_EXIT_EVENT,
          summary: `${position.symbol} shadow exit expiration at ${exit.price.toFixed(2)}`,
          payload: {
            reason: "expiration",
            exitReason: "expiration",
            maintenance: true,
            exitPrice: exit.price,
            pnl: expirationRealizedPnl,
            occurredAt: now.toISOString(),
            sourceOrderId: sourceOrder.id,
            sourceEventId: sourceOrder.sourceEventId,
            candidateId,
            candidate: candidateId ? { id: candidateId } : null,
            position: {
              id: ledgerPositionId,
              candidateId,
              symbol: position.symbol,
            },
          },
          occurredAt: now,
        });
        notifyAlgoCockpitChanged({
          deploymentId,
          reason: SIGNAL_OPTIONS_SHADOW_EXIT_EVENT,
        });
      }
    } catch (error) {
      summary.skippedCount += 1;
      summary.errors.push({
        positionId: position.id,
        symbol: position.symbol,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fix B(i): force-close lingering breached-stop positions. Re-scan the open
  // option positions that survived the expiration pass above; any whose recorded
  // mark is already through its stop (and that didn't expire) is force-closed at
  // the best available price. Real-deployment-only: the breach context is resolved
  // via resolveSignalOptionsShadowMarkExitContext (rejects non-automation/disabled
  // rows) and we additionally skip backfill/historical rows explicitly below.
  // DAILY-LOSS HALT: the settling sell realizes P&L in shadow_positions/cash (the
  // trading-allowance budget); the ledger-sync exit event below ALSO carries the
  // realized `pnl` so the loss feeds the events-ledger daily-loss halt
  // (computeSignalOptionsDailyRealizedPnl) — without it a deep-loss force-close
  // would vanish from the halt entirely (counted as neither realized nor
  // unrealized). A dedup guard (one shadow_exit per deployment+symbol since
  // openedAt) ensures the close is banked into the halt exactly once.
  for (const position of openPositions) {
    const contract = asOptionContract(position.optionContract);
    if (!contract) {
      continue;
    }
    // Skip rows the expiration pass already settled (its sell flips status to
    // closed); re-read status so we never double-sell.
    const [currentStatus] = await db
      .select({ status: shadowPositionsTable.status })
      .from(shadowPositionsTable)
      .where(eq(shadowPositionsTable.id, position.id))
      .limit(1);
    if (currentStatus?.status !== "open") {
      continue;
    }
    const quantity = toNumber(position.quantity) ?? 0;
    if (quantity <= 0) {
      continue;
    }
    try {
      const context = await resolveSignalOptionsShadowMarkExitContext(position);
      if (!context) {
        continue;
      }
      // Never force-close backfill/historical positions: a force sell would mutate
      // research/backfill data and inject a live-tagged exit that
      // deriveActivePositions honors by symbol. The context resolver only rejects
      // non-automation/disabled rows (backfill orders carry source:"automation"),
      // so guard explicitly here — matching the expiration and reconcile passes.
      if (
        isHistoricalSignalOptionsShadowOrder(context.entryOrder) ||
        isSignalOptionsBackfillShadowOrder(context.entryOrder)
      ) {
        continue;
      }
      const breach = await detectShadowMaintenanceBreach({ contract, position, context });
      if (!breach) {
        continue;
      }

      const deploymentId = context.deployment.id;
      if (!deploymentIds.has(deploymentId)) {
        summary.orphanCount += 1;
        continue;
      }

      // Dedup guard: never bank a force-close realized loss into the daily-loss
      // halt twice. If a shadow_exit already exists for this deployment+symbol
      // since the position opened, it was already exited and counted — skip the
      // sell and the second pnl-bearing exit. Bounded to THIS position's lifecycle
      // (>= openedAt) so a prior entry->exit cycle's exit can't suppress it.
      const normalizedSymbol = normalizeSymbol(position.symbol).toUpperCase();
      const alreadyExited = await hasExistingSignalOptionsShadowExitEvent({
        deploymentId,
        symbol: position.symbol,
        since: position.openedAt,
      });
      if (alreadyExited) {
        continue;
      }

      const exit = await resolveShadowForceCloseExitPrice({ position, contract });
      const dateKey = marketDateParts(now).key;
      await placeShadowOrder({
        accountId: SHADOW_ACCOUNT_ID,
        mode: "shadow",
        symbol: position.symbol,
        assetClass: "option",
        side: "sell",
        type: "limit",
        quantity,
        limitPrice: exit.price,
        stopPrice: null,
        timeInForce: "day",
        optionContract: contract,
        source: "automation",
        clientOrderId: `shadow-force-stop-maintenance-${position.id}-${dateKey}`,
        positionKey: position.positionKey,
        requestedFillPrice: exit.price > 0 ? exit.price : null,
        payload: {
          maintenance: true,
          maintenanceReason: "force_stop",
          exitReason: breach.exitReason,
          priceSource: exit.source,
          fillQuoteSource: exit.source,
          markReturnPct: breach.markReturnPct,
          sourceDeploymentId: deploymentId,
          positionId: position.id,
          positionKey: position.positionKey,
          previousMark: toNumber(position.mark),
          optionContract: optionPayload(contract),
        },
        placedAt: now,
      });
      summary.forceClosedCount += 1;

      // Realized loss for the daily-loss halt, computed exactly as the live exit
      // path does (signalOptionsRealizedPnl): (exit - entry) * qty * multiplier,
      // multiplier basis = contract.multiplier ?? 100 to stay consistent with the
      // halt's unrealized term (signalOptionsContractMultiplier).
      const forceCloseRealizedPnl = Number(
        (
          (exit.price - (toNumber(position.averageCost) ?? 0)) *
          quantity *
          (toNumber(contract.multiplier) ?? 100)
        ).toFixed(2),
      );

      // Ledger-sync exit per the PAYLOAD CONTRACT: reason/exitReason = the breach
      // reason, maintenance:true, fillQuoteSource:"force", exitPrice = the close
      // price, NO selectedContract (admits via maintenance:true + the no-contract
      // branch), and `pnl` = the realized loss so it feeds the daily-loss halt
      // (dedup-guarded above so it is banked once). Resolve the ledger position id
      // / candidateId from the source entry event when present, else fall back to
      // the live path's `${deploymentId}:${symbol}` synthetic id.
      const entryPayload = readRecord(context.entryEvent?.payload) ?? {};
      const entryPosition = readRecord(entryPayload.position) ?? {};
      const entryCandidate = readRecord(entryPayload.candidate) ?? {};
      const ledgerPositionId =
        readString(entryPosition.id) ?? `${deploymentId}:${position.symbol}`;
      const candidateId =
        readString(entryCandidate.id) ??
        readString(entryPosition.candidateId) ??
        null;
      await db.insert(executionEventsTable).values({
        deploymentId,
        providerAccountId:
          context.entryEvent?.providerAccountId ??
          context.deployment.providerAccountId ??
          null,
        symbol: normalizedSymbol,
        eventType: SIGNAL_OPTIONS_SHADOW_EXIT_EVENT,
        summary: `${position.symbol} shadow exit ${breach.exitReason} (force) at ${exit.price.toFixed(2)}`,
        payload: {
          reason: breach.exitReason,
          exitReason: breach.exitReason,
          maintenance: true,
          exitPrice: exit.price,
          pnl: forceCloseRealizedPnl,
          occurredAt: now.toISOString(),
          fillQuoteSource: "force",
          candidateId,
          candidate: candidateId ? { id: candidateId } : null,
          position: {
            id: ledgerPositionId,
            candidateId,
            symbol: position.symbol,
          },
        },
        occurredAt: now,
      });
      notifyAlgoCockpitChanged({
        deploymentId,
        reason: SIGNAL_OPTIONS_SHADOW_EXIT_EVENT,
      });
    } catch (error) {
      summary.skippedCount += 1;
      summary.errors.push({
        positionId: position.id,
        symbol: position.symbol,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Fix B(ii): reconcile closed-without-exit drift. Scan recently status='closed'
  // shadow OPTION rows whose deployment lacks a corresponding
  // signal_options_shadow_exit event for that symbol, and emit the missing
  // ledger-sync exit so the entry gate's active-position view (which closes by
  // SYMBOL) stops treating the position as phantom-open. NO DOUBLE-COUNT: the cash
  // was already realized when the row closed; the event omits `pnl`. Idempotent:
  // we only emit for closed rows that have NO matching exit event, so re-running
  // never double-emits, and this pass never touches open rows (the force-close
  // pass above owns those).
  try {
    await reconcileShadowOptionClosedWithoutExit({
      now,
      deploymentIds,
      summary,
    });
  } catch (error) {
    summary.errors.push({
      positionId: "reconcile",
      symbol: "*",
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  return summary;
}

const SHADOW_RECONCILE_LOOKBACK_DAYS = 30;

async function reconcileShadowOptionClosedWithoutExit(input: {
  now: Date;
  deploymentIds: Set<string>;
  summary: ShadowOptionMaintenanceSummary;
}): Promise<void> {
  const since = new Date(
    input.now.getTime() - SHADOW_RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  const closedRows = await db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.assetClass, "option"),
        eq(shadowPositionsTable.status, "closed"),
        gte(shadowPositionsTable.closedAt, since),
      ),
    )
    .orderBy(desc(shadowPositionsTable.closedAt));

  for (const position of closedRows) {
    const contract = asOptionContract(position.optionContract);
    if (!contract) {
      continue;
    }
    try {
      // Resolve the source entry order/event to recover the real deployment.
      // Backfill/historical/orphaned rows are skipped (no real deployment to
      // reconcile against), mirroring the expiration pass guards.
      const sourceOrder = await findSignalOptionsEntryOrderForPosition(position);
      if (!sourceOrder) {
        continue;
      }
      // Skip replay/historical AND backfill rows. The original `&& !isBackfill`
      // let backfill orders through, which then received a live-tagged
      // ledger_reconcile exit; deriveActivePositions closes by symbol and would
      // phantom-delete a genuinely-open live position for the same
      // deployment+symbol. Only real automation positions are reconciled.
      if (
        isHistoricalSignalOptionsShadowOrder(sourceOrder) ||
        isSignalOptionsBackfillShadowOrder(sourceOrder)
      ) {
        continue;
      }
      const sourceEntryEvent =
        sourceOrder.sourceEventId != null
          ? (
              await db
                .select()
                .from(executionEventsTable)
                .where(eq(executionEventsTable.id, sourceOrder.sourceEventId))
                .limit(1)
            )[0]
          : undefined;
      const entryPayload = readRecord(sourceEntryEvent?.payload) ?? {};
      const entryPosition = readRecord(entryPayload.position) ?? {};
      const entryCandidate = readRecord(entryPayload.candidate) ?? {};
      const deploymentId =
        (sourceEntryEvent?.deploymentId
          ? String(sourceEntryEvent.deploymentId)
          : null) ??
        sourceDeploymentIdFromShadowOrder(sourceOrder) ??
        recoverDeploymentIdFromLedgerPositionId(entryPosition.id);
      if (!deploymentId || !input.deploymentIds.has(deploymentId)) {
        continue;
      }

      // Idempotency guard: skip if ANY exit event already exists for this
      // deployment + symbol (deriveActivePositions closes by symbol, so a single
      // matching exit already heals this position). Never double-emit.
      const normalizedSymbol = normalizeSymbol(position.symbol).toUpperCase();
      const [existingExit] = await db
        .select({ id: executionEventsTable.id })
        .from(executionEventsTable)
        .where(
          and(
            eq(executionEventsTable.deploymentId, deploymentId),
            eq(executionEventsTable.eventType, SIGNAL_OPTIONS_SHADOW_EXIT_EVENT),
            eq(executionEventsTable.symbol, normalizedSymbol),
            // Bound to THIS position's lifecycle so a prior entry->exit cycle's
            // exit event can't suppress healing a later close-without-exit.
            gte(executionEventsTable.occurredAt, position.openedAt),
          ),
        )
        .limit(1);
      if (existingExit) {
        continue;
      }

      const ledgerPositionId =
        readString(entryPosition.id) ?? `${deploymentId}:${position.symbol}`;
      const candidateId =
        readString(entryCandidate.id) ??
        readString(entryPosition.candidateId) ??
        null;
      const occurredAt = position.closedAt ?? input.now;
      await db.insert(executionEventsTable).values({
        deploymentId,
        providerAccountId:
          sourceEntryEvent?.providerAccountId ?? null,
        symbol: normalizedSymbol,
        eventType: SIGNAL_OPTIONS_SHADOW_EXIT_EVENT,
        summary: `${position.symbol} shadow exit ledger_reconcile`,
        payload: {
          reason: "ledger_reconcile",
          exitReason: "ledger_reconcile",
          maintenance: true,
          exitPrice: toNumber(position.mark) ?? 0,
          // Carry the position's banked realized P&L so a SAME-DAY close-without-
          // exit still lands in the daily-loss halt (the halt date-filters on
          // occurredAt=closedAt, so prior-day reconciles are naturally excluded).
          // The idempotency guard above guarantees this is the only exit event for
          // the position, so the loss is banked exactly once — never doubled.
          pnl: toNumber(position.realizedPnl) ?? 0,
          occurredAt: occurredAt.toISOString(),
          fillQuoteSource: "reconcile",
          candidateId,
          candidate: candidateId ? { id: candidateId } : null,
          position: {
            id: ledgerPositionId,
            candidateId,
            symbol: position.symbol,
          },
        },
        occurredAt,
      });
      input.summary.reconciledCount += 1;
      notifyAlgoCockpitChanged({
        deploymentId,
        reason: SIGNAL_OPTIONS_SHADOW_EXIT_EVENT,
      });
    } catch (error) {
      input.summary.errors.push({
        positionId: position.id,
        symbol: position.symbol,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function upsertPositionForFill(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    symbol: string;
    assetClass: ShadowAssetClass;
    optionContract: ShadowOptionContract | null;
    positionKey: string;
    side: ShadowSide;
    quantity: number;
    price: number;
    fees: number;
    realizedPnl: number;
    multiplier: number;
    occurredAt: Date;
  },
) {
  const [current] = await tx
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, currentShadowAccountId()),
        eq(shadowPositionsTable.positionKey, input.positionKey),
      ),
    )
    .limit(1);

  const currentQuantity = toNumber(current?.quantity) ?? 0;
  const currentAverageCost = toNumber(current?.averageCost) ?? 0;
  const currentRealized = toNumber(current?.realizedPnl) ?? 0;
  const currentFees = toNumber(current?.fees) ?? 0;
  const positionType = classifyAccountPositionType({
    symbol: input.symbol,
    assetClass: input.assetClass,
    optionContract: input.optionContract,
  });

  if (input.side === "buy") {
    const nextQuantity = current?.status === "open" ? currentQuantity + input.quantity : input.quantity;
    const existingCost =
      current?.status === "open" ? currentQuantity * currentAverageCost : 0;
    const nextAverageCost =
      nextQuantity > 0
        ? (existingCost + input.quantity * input.price) / nextQuantity
        : input.price;
    const marketValue = nextQuantity * input.price * input.multiplier;
    if (current) {
      await tx
        .update(shadowPositionsTable)
        .set({
          positionType,
          quantity: money(nextQuantity),
          averageCost: money(nextAverageCost),
          mark: money(input.price),
          marketValue: money(marketValue),
          unrealizedPnl: money((input.price - nextAverageCost) * nextQuantity * input.multiplier),
          fees: money(currentFees + input.fees),
          openedAt:
            current.status === "open" ? current.openedAt : input.occurredAt,
          closedAt: null,
          asOf: input.occurredAt,
          status: "open",
          updatedAt: input.occurredAt,
        })
        .where(eq(shadowPositionsTable.id, current.id));
    } else {
      await tx.insert(shadowPositionsTable).values({
        accountId: currentShadowAccountId(),
        positionKey: input.positionKey,
        symbol: input.symbol,
        assetClass: input.assetClass,
        positionType,
        quantity: money(nextQuantity),
        averageCost: money(nextAverageCost),
        mark: money(input.price),
        marketValue: money(marketValue),
        unrealizedPnl: "0",
        realizedPnl: "0",
        fees: money(input.fees),
        optionContract: optionPayload(input.optionContract),
        openedAt: input.occurredAt,
        asOf: input.occurredAt,
        status: "open",
      });
    }
    return;
  }

  const nextQuantity = Math.max(0, currentQuantity - input.quantity);
  const marketValue = nextQuantity * input.price * input.multiplier;
  await tx
    .update(shadowPositionsTable)
    .set({
      positionType,
      quantity: money(nextQuantity),
      mark: money(input.price),
      marketValue: money(marketValue),
      unrealizedPnl: money((input.price - currentAverageCost) * nextQuantity * input.multiplier),
      realizedPnl: money(currentRealized + input.realizedPnl),
      fees: money(currentFees + input.fees),
      closedAt: nextQuantity <= 0 ? input.occurredAt : current?.closedAt ?? null,
      asOf: input.occurredAt,
      status: nextQuantity <= 0 ? "closed" : "open",
      updatedAt: input.occurredAt,
    })
    .where(eq(shadowPositionsTable.id, current!.id));
}

function normalizeShadowOrderInput(input: ShadowOrderInput): ShadowOrderInput & {
  symbol: string;
  assetClass: ShadowAssetClass;
  side: ShadowSide;
} {
  const symbol = normalizeSymbol(input.symbol).toUpperCase();
  if (!symbol) {
    throw new HttpError(400, "Shadow orders require a symbol.", {
      code: "shadow_symbol_required",
      expose: true,
    });
  }
  if (input.assetClass !== "equity" && input.assetClass !== "option") {
    throw new HttpError(400, "Shadow orders support stocks and options only.", {
      code: "shadow_asset_class_invalid",
      expose: true,
    });
  }
  if (input.side !== "buy" && input.side !== "sell") {
    throw new HttpError(400, "Shadow order side must be buy or sell.", {
      code: "shadow_side_invalid",
      expose: true,
    });
  }
  return {
    ...input,
    accountId: SHADOW_ACCOUNT_ID,
    mode: input.mode ?? "shadow",
    symbol,
    assetClass: input.assetClass,
    side: input.side,
    type: input.type ?? "market",
    timeInForce: input.timeInForce ?? "day",
    source: input.source ?? "manual",
  };
}

function orderRowToResponse(order: typeof shadowOrdersTable.$inferSelect | undefined) {
  if (!order) {
    throw new HttpError(500, "Shadow order was not recorded.", {
      code: "shadow_order_missing",
      expose: true,
    });
  }
  const metadata = shadowSourceMetadata(order);
  return {
    id: order.id,
    accountId: order.accountId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    assetClass: order.assetClass,
    quantity: toNumber(order.quantity) ?? 0,
    filledQuantity: toNumber(order.filledQuantity) ?? 0,
    limitPrice: toNumber(order.limitPrice),
    stopPrice: toNumber(order.stopPrice),
    timeInForce: order.timeInForce,
    status: order.status,
    placedAt: order.placedAt,
    filledAt: order.filledAt,
    updatedAt: order.updatedAt,
    averageFillPrice: toNumber(order.averageFillPrice),
    commission: toNumber(order.fees),
    source:
      order.source === "automation"
        ? "SHADOW_AUTO"
        : order.source === WATCHLIST_BACKTEST_SOURCE
          ? "SHADOW_BACKTEST"
        : order.source === SIGNAL_OPTIONS_REPLAY_SOURCE
          ? "SHADOW_OPTIONS_REPLAY"
          : "SHADOW",
    ...metadata,
  };
}

async function writeShadowPositionMarkBatch(
  writes: ShadowPositionMarkRefreshWrite[],
) {
  if (!writes.length) {
    return;
  }

  const positionIds = sql.join(
    writes.map((write) => sql`${write.position.id}`),
    sql`, `,
  );
  const marks = sql.join(writes.map((write) => sql`${write.mark}`), sql`, `);
  const marketValues = sql.join(
    writes.map((write) => sql`${write.marketValue}`),
    sql`, `,
  );
  const unrealizedPnls = sql.join(
    writes.map((write) => sql`${write.unrealizedPnl}`),
    sql`, `,
  );
  const asOfs = sql.join(writes.map((write) => sql`${write.asOf}`), sql`, `);
  const updatedAts = sql.join(
    writes.map((write) => sql`${write.updatedAt}`),
    sql`, `,
  );

  await db.transaction(async (tx) => {
    await tx.insert(shadowPositionMarksTable).values(
      writes.map((write) => ({
        accountId: SHADOW_ACCOUNT_ID,
        positionId: write.position.id,
        mark: write.mark,
        marketValue: write.marketValue,
        unrealizedPnl: write.unrealizedPnl,
        source: write.source,
        asOf: write.asOf,
      })),
    );

    await tx.execute(sql`
      update shadow_positions as p
      set
        mark = batched.mark,
        market_value = batched.market_value,
        unrealized_pnl = batched.unrealized_pnl,
        as_of = batched.as_of,
        updated_at = batched.updated_at
      from unnest(
        array[${positionIds}]::uuid[],
        array[${marks}]::numeric[],
        array[${marketValues}]::numeric[],
        array[${unrealizedPnls}]::numeric[],
        array[${asOfs}]::timestamptz[],
        array[${updatedAts}]::timestamptz[]
      ) as batched(
        position_id,
        mark,
        market_value,
        unrealized_pnl,
        as_of,
        updated_at
      )
      where p.id = batched.position_id
    `);
  });
}

export async function refreshShadowPositionMarks() {
  await ensureShadowAccount();
  const positions = await readOpenShadowPositions();
  const optionPositions = positions.filter(
    (position) =>
      position.assetClass === "option" &&
      Boolean(asOptionContract(position.optionContract)),
  );
  const optionQuoteByProviderContractId = optionPositions.length
    ? await fetchShadowOptionDayChangeQuotes(optionPositions).catch(() => new Map())
    : new Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>();
  const latestMarkAtBySnapshotSource = new Map<string, Date>();
  const observedAt = new Date();
  const markWrites: ShadowPositionMarkRefreshWrite[] = [];

  for (const position of positions) {
    const contract = asOptionContract(position.optionContract);
    const providerContractId = shadowOptionQuoteIdentifier(contract);
    const optionQuote =
      providerContractId != null
        ? optionQuoteByProviderContractId.get(providerContractId)
        : null;
    const optionPricing =
      position.assetClass === "option" && contract
        ? buildShadowOptionPricingPolicy({
            quote: isShadowOptionTradingSession(observedAt, contract)
              ? optionQuote
              : null,
            fallbackMark: toNumber(position.mark),
            fallbackSource: "shadow_ledger",
            quoteSource: "option_quote",
          })
        : null;
    const mark =
      position.assetClass === "option" && contract
        ? optionPricing?.valuationEligible && optionQuote
          ? optionMarkFromQuoteRecord(
              optionQuote as Record<string, unknown>,
              optionPricing.valuationSource,
            )
          : {
              price: null,
              bid: optionPricing?.quoteBid ?? null,
              ask: optionPricing?.quoteAsk ?? null,
              source: optionPricing?.valuationReason ?? "quote_unavailable",
              asOf: optionPricing?.quoteAsOf ?? new Date(),
            }
        : await resolveEquityMarkForShadowRefresh(position);
    const price = mark.price;
    if (price == null || price <= 0) {
      continue;
    }
    const quantity = toNumber(position.quantity) ?? 0;
    const averageCost = toNumber(position.averageCost) ?? 0;
    const multiplier = marketMultiplier({
      assetClass: position.assetClass as ShadowAssetClass,
      optionContract: contract,
    });
    const marketValue = quantity * price * multiplier;
    const unrealizedPnl = (price - averageCost) * quantity * multiplier;
    markWrites.push({
      position,
      contract,
      optionQuote,
      optionPricing,
      markPrice: price,
      mark: money(price),
      marketValue: money(marketValue),
      unrealizedPnl: money(unrealizedPnl),
      source: mark.source,
      asOf: mark.asOf,
      updatedAt: new Date(),
    });
    const snapshotSource = shadowMarkSnapshotSourceForPosition(position);
    const latestMarkAt = latestMarkAtBySnapshotSource.get(snapshotSource);
    if (!latestMarkAt || mark.asOf.getTime() > latestMarkAt.getTime()) {
      latestMarkAtBySnapshotSource.set(snapshotSource, mark.asOf);
    }
  }

  await writeShadowPositionMarkBatch(markWrites);

  for (const write of markWrites) {
    if (
      write.position.assetClass === "option" &&
      write.contract &&
      write.optionPricing
    ) {
      await enforceSignalOptionsTrailingStopFromShadowMarkSafely({
        position: write.position,
        contract: write.contract,
        quote: write.optionQuote,
        pricing: write.optionPricing,
        markPrice: write.markPrice,
        markAt: write.asOf,
      });
    }
  }

  const updatedCount = markWrites.length;
  if (updatedCount) {
    invalidateShadowReadCachesAfterBackgroundMarkRefresh();
    for (const [source, latestMarkAt] of latestMarkAtBySnapshotSource) {
      await writeShadowBalanceSnapshot(source, latestMarkAt, {
        changeReason: "mark_refresh",
        invalidateCaches: false,
      });
    }
  }

  return { updatedCount };
}

async function ensureFreshShadowState(refreshMarks = false) {
  try {
    if (isShadowAccountDbBackoffActive()) {
      return buildFallbackShadowTotals();
    }

    const accountId = currentShadowAccountId();
    await ensureShadowAccount();
    if (!refreshMarks) {
      const pending = shadowFreshStateInFlight.get(accountId);
      if (pending) {
        return pending;
      }
      return computeShadowTotals();
    }

    const now = Date.now();
    const cached = shadowFreshStateCache.get(accountId);
    if (cached && cached.expiresAt > now) {
      return cached.totals;
    }
    const pending = shadowFreshStateInFlight.get(accountId);
    if (pending) {
      return await pending;
    }

    kickShadowPositionMarkRefresh();
    const version = shadowFreshStateCacheVersion;
    const request = computeShadowTotals();

    return await trackShadowFreshStateRefresh(accountId, request, version);
  } catch (error) {
    if (isTransientPostgresError(error)) {
      markShadowAccountDbUnavailable(error);
      return buildFallbackShadowTotals();
    }
    throw error;
  }
}

function buildShadowPositionDayChange(input: {
  currentMarketValue: number | null;
  baselineMarketValue: number | null;
}): ShadowPositionDayChange {
  if (input.currentMarketValue === null || input.baselineMarketValue === null) {
    return { dayChange: null, dayChangePercent: null };
  }
  const dayChange = input.currentMarketValue - input.baselineMarketValue;
  return {
    dayChange,
    dayChangePercent: input.baselineMarketValue
      ? (dayChange / Math.abs(input.baselineMarketValue)) * 100
      : null,
  };
}

// Picks the day change shown for a shadow position row.
// - Same-day positions use the live-mark valuation (their day change IS the full move
//   since entry).
// - Prior-day positions use the accurate baseline-mark day change (storedDayChange,
//   computed from real captured prior-day-close marks). The option quote's own day
//   change is unreliable (option prevClose/change is frequently 0/absent) and must NOT
//   override a valid baseline — that regression rendered gaining prior-day options as $0.
// - quoteDayChange is only a fallback when there is no stored baseline at all.
export function selectShadowPositionDayChange(input: {
  sameDayPosition: boolean;
  valuationEligible: boolean;
  valuationDayChange: ShadowPositionDayChange | null;
  storedDayChange: ShadowPositionDayChange;
  quoteDayChange: ShadowPositionDayChange | null;
}): ShadowPositionDayChange {
  if (
    input.sameDayPosition &&
    input.valuationEligible &&
    input.valuationDayChange?.dayChange != null
  ) {
    return input.valuationDayChange;
  }
  if (input.storedDayChange.dayChange != null) {
    return input.storedDayChange;
  }
  if (input.quoteDayChange?.dayChange != null) {
    return input.quoteDayChange;
  }
  return input.storedDayChange;
}

function shadowPositionDayChangeBaselineMarketValue(input: {
  baselineMarkMarketValue: number | null;
  openedAt: Date;
  dayStart: Date;
  averageCost: number;
  quantity: number;
  multiplier: number;
}): number | null {
  const entryCostBasis =
    Number.isFinite(input.averageCost) &&
    Number.isFinite(input.quantity) &&
    Number.isFinite(input.multiplier)
      ? input.averageCost * input.quantity * input.multiplier
      : null;
  if (
    input.baselineMarkMarketValue !== null &&
    input.baselineMarkMarketValue !== 0
  ) {
    return input.baselineMarkMarketValue;
  }
  if (entryCostBasis !== null && entryCostBasis !== 0) {
    return entryCostBasis;
  }
  return input.openedAt.getTime() >= input.dayStart.getTime()
    ? entryCostBasis
    : input.baselineMarkMarketValue;
}

function shadowDayChangeDayStart(marketDate: string): Date {
  return zonedDateTimeToUtc({
    marketDate: previousWeekdayOrSame(marketDate),
    hour: 0,
    minute: 0,
  });
}

function shadowPositionDayChangeDayStart(
  _position: Pick<ShadowPositionRow, "positionKey" | "asOf" | "updatedAt">,
  now = new Date(),
): Date {
  return shadowDayChangeDayStart(marketDateKey(now));
}

function shadowQuoteMarkPrice(
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
): number | null {
  const record = quote as Record<string, unknown> | undefined;
  const bid = readPositiveNumber(record?.bid);
  const ask = readPositiveNumber(record?.ask);
  if (bid != null && ask != null) {
    return (bid + ask) / 2;
  }
  return (
    readPositiveNumber(record?.mark) ??
    readPositiveNumber(record?.price) ??
    readPositiveNumber(record?.last)
  );
}

function shadowQuoteText(
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  const record = quote as Record<string, unknown> | undefined;
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

// Backstop for the freshness LABEL: a quote can carry a "live" label yet be
// minutes old (the stale durable-chain class). A valuation that drives stops must
// also clear a WALL-CLOCK age bound, not just a string. Generous (5 min) so it
// never over-blocks genuinely-live quotes — it only catches egregious staleness
// the labels missed. Undated quotes are left to the label/mode checks (we can't
// time them); they no longer get a fabricated "now" for valuation purposes.
const SHADOW_OPTION_QUOTE_MAX_AGE_MS = 300_000;

function shadowOptionQuoteRealAgeMs(
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
  now: Date,
): number | null {
  const record = quote as Record<string, unknown> | null | undefined;
  const raw =
    record?.updatedAt ?? record?.quoteUpdatedAt ?? record?.dataUpdatedAt ?? null;
  let timestampMs: number | null = null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    timestampMs = raw.getTime();
  } else if (typeof raw === "string" && raw.trim()) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      timestampMs = parsed;
    }
  }
  return timestampMs == null ? null : now.getTime() - timestampMs;
}

function shadowOptionQuoteValuationBlockReason(
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
): string | null {
  if (!quote) {
    return "quote_unavailable";
  }
  const freshness = shadowQuoteText(quote, "freshness", "quoteFreshness")?.toLowerCase() ?? null;
  if (
    freshness &&
    ["metadata", "pending", "stale", "unavailable", "frozen", "delayed", "delayed_frozen"].includes(
      freshness,
    )
  ) {
    return `quote_${freshness}`;
  }
  const marketDataMode = shadowQuoteText(quote, "marketDataMode")?.toLowerCase() ?? null;
  if (marketDataMode && marketDataMode !== "live") {
    return `market_data_${marketDataMode}`;
  }
  const ageMs = shadowOptionQuoteRealAgeMs(quote, new Date());
  if (ageMs != null && ageMs > SHADOW_OPTION_QUOTE_MAX_AGE_MS) {
    return "quote_stale_age";
  }
  return null;
}

function buildShadowOptionPricingPolicy(input: {
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined;
  fallbackMark: number | null | undefined;
  fallbackSource?: string;
  quoteSource?: string;
  requireTwoSidedQuote?: boolean;
}): ShadowOptionPricingPolicy {
  const quoteRecord = input.quote as Record<string, unknown> | null | undefined;
  const quoteBid = toNumber(quoteRecord?.bid);
  const quoteAsk = toNumber(quoteRecord?.ask);
  const positiveBid = readPositiveNumber(quoteRecord?.bid);
  const positiveAsk = readPositiveNumber(quoteRecord?.ask);
  const quoteMid =
    positiveBid != null && positiveAsk != null ? (positiveBid + positiveAsk) / 2 : null;
  const quoteMark = shadowQuoteMarkPrice(input.quote);
  const fallbackMark = toNumber(input.fallbackMark);
  const fallback =
    fallbackMark != null && fallbackMark >= 0 ? fallbackMark : null;
  const blockReason = shadowOptionQuoteValuationBlockReason(input.quote);
  const twoSidedRequired = input.requireTwoSidedQuote !== false;
  const twoSidedQuote = positiveBid != null && positiveAsk != null;
  const missingPriceReason =
    quoteMark == null
      ? "quote_mark_unavailable"
      : twoSidedRequired && !twoSidedQuote
        ? "quote_not_two_sided"
        : null;
  const valuationEligible = !blockReason && !missingPriceReason;
  const valuationMark = valuationEligible ? quoteMark : fallback;
  const quoteSource = input.quoteSource ?? "option_quote";
  const fallbackSource = input.fallbackSource ?? "shadow_ledger";
  return {
    valuationMark,
    valuationEligible,
    valuationSource: valuationEligible ? quoteSource : fallbackSource,
    valuationReason:
      valuationEligible
        ? "quote_eligible"
        : blockReason ?? missingPriceReason ?? "fallback_mark",
    quoteMark,
    quoteBid,
    quoteAsk,
    quoteMid,
    quoteSource,
    quoteFreshness: shadowQuoteText(input.quote, "freshness", "quoteFreshness"),
    marketDataMode: shadowQuoteText(input.quote, "marketDataMode"),
    quoteAsOf: input.quote ? shadowOptionQuoteTimestamp(quoteRecord ?? {}) : null,
  };
}

function computeSignalOptionsShadowMarkExitDecision(input: {
  contract: ShadowOptionContract;
  entryPrice: number;
  markPrice: number;
  peakPrice: number;
  profile: SignalOptionsExecutionProfile;
  pricing: ShadowOptionPricingPolicy;
  markAt: Date;
  signalQuality?: SignalOptionsEntryQuality | null;
}) {
  if (!isShadowOptionTradingSession(input.markAt, input.contract)) {
    return {
      exitReason: null,
      exitPrice: null,
      skipReason: "option_session_closed",
      stop: null,
    };
  }
  if (
    !input.pricing.valuationEligible ||
    input.pricing.valuationSource !== "option_quote"
  ) {
    return {
      exitReason: null,
      exitPrice: null,
      skipReason: "mark_not_actionable",
      stop: null,
    };
  }
  const stop = computeSignalOptionsPositionStop({
    entryPrice: input.entryPrice,
    peakPrice: input.peakPrice,
    markPrice: input.markPrice,
    profile: input.profile,
    signalQuality: input.signalQuality ?? null,
  });
  if (!isSignalOptionsShadowMarkStopExitReason(stop.exitReason)) {
    return {
      exitReason: null,
      exitPrice: null,
      skipReason: null,
      stop,
    };
  }
  const exitPrice =
    input.pricing.quoteBid != null && input.pricing.quoteMid != null
      ? Number(
          (
            input.pricing.quoteMid -
            (input.pricing.quoteMid - input.pricing.quoteBid) * 0.9
          ).toFixed(2),
        )
      : Number(input.markPrice.toFixed(2));
  return {
    exitReason: stop.exitReason,
    exitPrice,
    skipReason: null,
    stop,
  };
}

function shadowQuotePreviousMark(
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
  mark: number | null,
): number | null {
  const record = quote as Record<string, unknown> | undefined;
  const prevClose = toNumber(record?.prevClose);
  if (prevClose != null && prevClose > 0) {
    return prevClose;
  }
  const change = toNumber(record?.change);
  if (mark != null && change != null) {
    const previous = mark - change;
    return previous > 0 ? previous : null;
  }
  return null;
}

function buildShadowPositionDayChangeFromQuote(
  input: ShadowQuoteDayChangeInput,
): ShadowPositionDayChange {
  const quoteRecord = input.quote as Record<string, unknown> | undefined;
  const quoteSource = readString(quoteRecord?.source);
  const quoteFreshness = readString(
    quoteRecord?.freshness ?? quoteRecord?.quoteFreshness,
  );
  const historicalOptionDayChange =
    quoteSource === "massive-option-aggregates" ||
    quoteFreshness === "historical_option_bars";
  const pricing = buildShadowOptionPricingPolicy({
    quote: input.quote,
    fallbackMark: null,
    requireTwoSidedQuote: false,
  });
  if (!pricing.valuationEligible && !historicalOptionDayChange) {
    return { dayChange: null, dayChangePercent: null };
  }
  const mark = historicalOptionDayChange
    ? shadowQuoteMarkPrice(input.quote)
    : pricing.valuationMark;
  const previousMark = shadowQuotePreviousMark(input.quote, mark);
  const perContractChange =
    mark != null && previousMark != null
      ? mark - previousMark
      : toNumber(quoteRecord?.change);
  if (
    perContractChange == null ||
    input.quantity === 0 ||
    !Number.isFinite(input.multiplier) ||
    input.multiplier <= 0
  ) {
    return { dayChange: null, dayChangePercent: null };
  }
  const quotePercent = toNumber(quoteRecord?.changePercent);
  return {
    dayChange: perContractChange * input.quantity * input.multiplier,
    dayChangePercent:
      previousMark != null && previousMark > 0
        ? (perContractChange / Math.abs(previousMark)) * 100
        : quotePercent,
  };
}

function shadowMassiveOptionTicker(contract: ShadowOptionContract) {
  const underlying = normalizeSymbol(contract.underlying)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!underlying || !Number.isFinite(contract.strike) || contract.strike <= 0) {
    return null;
  }
  const expirationDate = dateOrNull(contract.expirationDate);
  if (!expirationDate) {
    return null;
  }
  const yy = String(expirationDate.getUTCFullYear()).slice(-2);
  const mm = String(expirationDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(expirationDate.getUTCDate()).padStart(2, "0");
  const side = contract.right === "put" ? "P" : "C";
  const strike = String(Math.round(contract.strike * 1000)).padStart(8, "0");
  return `O:${underlying}${yy}${mm}${dd}${side}${strike}`;
}

function latestPositiveCloseBarForMarketDate(
  bars: BrokerBarSnapshot[],
  marketDate: string,
) {
  return bars
    .filter((bar) => {
      const timestamp = dateOrNull(bar.timestamp);
      return (
        timestamp &&
        marketDateKey(timestamp) === marketDate &&
        readPositiveNumber(bar.close) !== null
      );
    })
    .sort(
      (left, right) =>
        (dateOrNull(right.timestamp)?.getTime() ?? 0) -
        (dateOrNull(left.timestamp)?.getTime() ?? 0),
    )[0] ?? null;
}

function shadowMassiveOptionDayChangeQuote(input: {
  contract: ShadowOptionContract;
  providerContractId: string;
  bars: BrokerBarSnapshot[];
}): Partial<QuoteSnapshot> | Record<string, unknown> | null {
  const sortedBars = input.bars
    .filter((bar) => readPositiveNumber(bar.close) !== null && dateOrNull(bar.timestamp))
    .sort(
      (left, right) =>
        (dateOrNull(left.timestamp)?.getTime() ?? 0) -
        (dateOrNull(right.timestamp)?.getTime() ?? 0),
    );
  const latest = sortedBars.at(-1) ?? null;
  const latestAt = dateOrNull(latest?.timestamp);
  const latestClose = readPositiveNumber(latest?.close);
  if (!latest || !latestAt || latestClose === null) {
    return null;
  }
  const latestMarketDate = marketDateKey(latestAt);
  const previousMarketDate = addWeekdaysToMarketDate(latestMarketDate, -1);
  const previous = latestPositiveCloseBarForMarketDate(
    sortedBars,
    previousMarketDate,
  );
  const previousClose = readPositiveNumber(previous?.close);
  if (previousClose === null || previousClose <= 0) {
    return null;
  }
  const change = latestClose - previousClose;
  const updatedAt = latestAt.toISOString();
  return {
    symbol: input.contract.underlying,
    providerContractId: input.providerContractId,
    price: latestClose,
    mark: latestClose,
    last: latestClose,
    prevClose: previousClose,
    change,
    changePercent: (change / Math.abs(previousClose)) * 100,
    volume: toNumber(latest.volume),
    freshness: "historical_option_bars",
    marketDataMode: "historical",
    source: "massive-option-aggregates",
    transport: "rest",
    delayed: true,
    updatedAt,
    dataUpdatedAt: updatedAt,
  };
}

function shadowOptionQuoteCanBuildDayChange(
  quote: Partial<QuoteSnapshot> | Record<string, unknown> | null | undefined,
) {
  const dayChange = buildShadowPositionDayChangeFromQuote({
    quantity: 1,
    multiplier: 1,
    quote,
  });
  return dayChange.dayChange !== null && dayChange.dayChangePercent !== null;
}

async function fetchShadowMassiveOptionDayChangeQuotes(
  positions: Array<{
    symbol: string;
    optionContract?: unknown;
  }>,
): Promise<Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>> {
  if (!getMassiveRuntimeConfig()) {
    return new Map();
  }
  const now = new Date();
  const to = now;
  const from = zonedDateTimeToUtc({
    marketDate: addWeekdaysToMarketDate(
      previousWeekdayOrSame(marketDateKey(now)),
      -SHADOW_OPTION_DAY_CHANGE_BAR_LOOKBACK_WEEKDAYS,
    ),
    hour: 0,
    minute: 0,
  });
  const requests = new Map<
    string,
    {
      contract: ShadowOptionContract;
      providerContractId: string;
      optionTicker: string;
    }
  >();
  positions.forEach((position) => {
    const contract = asOptionContract(position.optionContract);
    const providerContractId = shadowOptionQuoteIdentifier(contract);
    if (!contract || !providerContractId || isPriorOptionExpiration(contract)) {
      return;
    }
    const optionTicker = shadowMassiveOptionTicker(contract);
    if (!optionTicker || requests.has(providerContractId)) {
      return;
    }
    requests.set(providerContractId, {
      contract,
      providerContractId,
      optionTicker,
    });
  });
  if (!requests.size) {
    return new Map();
  }

  const quotes = new Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>();
  const results = await Promise.allSettled(
    Array.from(requests.values()).map(async (request) => {
      const result = await getOptionChartBarsWithDebug({
        underlying: request.contract.underlying,
        expirationDate: request.contract.expirationDate,
        strike: request.contract.strike,
        right: request.contract.right,
        optionTicker: request.optionTicker,
        skipBrokerContractResolution: true,
        timeframe: "1m",
        from,
        to,
        limit: SHADOW_OPTION_DAY_CHANGE_BAR_LIMIT,
        outsideRth: false,
      });
      const quote = shadowMassiveOptionDayChangeQuote({
        contract: request.contract,
        providerContractId: request.providerContractId,
        bars: result.bars,
      });
      if (!quote) {
        return;
      }
      quotes.set(request.providerContractId, quote);
      rememberShadowOptionQuote(request.providerContractId, quote);
    }),
  );
  results.forEach((result) => {
    if (result.status === "rejected") {
      logger.debug?.(
        { err: result.reason },
        "Shadow Massive option day-change quote fallback failed",
      );
    }
  });
  return quotes;
}

function isOpraOptionTicker(value: string): boolean {
  return value.startsWith("O:");
}

function shadowOptionContractsMatch(
  chainContract: OptionChainContract["contract"],
  shadowContract: ShadowOptionContract,
) {
  return (
    normalizeSymbol(chainContract.underlying).toUpperCase() ===
      normalizeSymbol(shadowContract.underlying).toUpperCase() &&
    optionDateKey(chainContract.expirationDate) ===
      optionDateKey(shadowContract.expirationDate) &&
    chainContract.right === shadowContract.right &&
    chainContract.strike === shadowContract.strike
  );
}

type ShadowOptionProviderResolutionGroup = {
  underlying: string;
  expirationDate: Date;
  right: ShadowOptionContract["right"];
  contracts: ShadowOptionContract[];
};

async function resolveShadowIbkrOptionProviderIds(
  groups: ShadowOptionProviderResolutionGroup[],
): Promise<Map<string, string>> {
  const resolvedByOptionTicker = new Map<string, string>();
  await Promise.allSettled(
    groups.map(async (group) => {
      const result = await batchOptionChains({
        underlying: group.underlying,
        expirationDates: [group.expirationDate],
        contractType: group.right,
        strikeCoverage: "full",
        quoteHydration: "metadata",
        allowDelayedSnapshotHydration: false,
        recordBridgeFailure: false,
      }).catch(() => null);
      const contracts =
        result?.results.flatMap((entry) => entry.contracts) ?? [];
      group.contracts.forEach((shadowContract) => {
        const optionTicker = shadowOptionQuoteIdentifier(shadowContract);
        if (!optionTicker || !isOpraOptionTicker(optionTicker)) {
          return;
        }
        const matched = contracts.find((candidate) =>
          shadowOptionContractsMatch(candidate.contract, shadowContract),
        );
        const providerContractId = matched?.contract.providerContractId?.trim();
        if (!providerContractId || isOpraOptionTicker(providerContractId)) {
          return;
        }
        rememberShadowOptionProviderContractId(optionTicker, providerContractId);
        resolvedByOptionTicker.set(optionTicker, providerContractId);
      });
    }),
  );
  return resolvedByOptionTicker;
}

async function fetchShadowOptionDayChangeQuotes(
  positions: Array<{
    symbol: string;
    optionContract?: unknown;
  }>,
  options: {
    intent?: MarketDataIntent;
    ownerPrefix?: string;
    taskMaxWaitMs?: number;
    requiresGreeks?: boolean;
  } = {},
): Promise<Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>> {
  const idsByUnderlying = new Map<string, Set<string>>();
  const aliasesByProviderContractId = new Map<string, Set<string>>();
  const resolutionGroupsByKey = new Map<string, ShadowOptionProviderResolutionGroup>();
  const addProviderContractId = (
    underlying: string,
    providerContractId: string,
    alias?: string | null,
  ) => {
    if (!idsByUnderlying.has(underlying)) {
      idsByUnderlying.set(underlying, new Set());
    }
    idsByUnderlying.get(underlying)!.add(providerContractId);
    if (alias) {
      const aliases =
        aliasesByProviderContractId.get(providerContractId) ?? new Set<string>();
      aliases.add(alias);
      aliasesByProviderContractId.set(providerContractId, aliases);
    }
  };
  positions.forEach((position) => {
    const contract = asOptionContract(position.optionContract);
    const quoteIdentifier = shadowOptionQuoteIdentifier(contract);
    const underlying = normalizeSymbol(contract?.underlying || position.symbol).toUpperCase();
    if (
      !contract ||
      !quoteIdentifier ||
      !underlying ||
      isPriorOptionExpiration(contract)
    ) {
      return;
    }
    const providerContractId = shadowOptionProviderContractIdForContract(contract);
    if (providerContractId) {
      addProviderContractId(
        underlying,
        providerContractId,
        isOpraOptionTicker(quoteIdentifier) ? quoteIdentifier : null,
      );
      return;
    }
    const groupKey = [
      underlying,
      optionDateKey(contract.expirationDate),
      contract.right,
    ].join("|");
    const group =
      resolutionGroupsByKey.get(groupKey) ??
      {
        underlying,
        expirationDate: contract.expirationDate,
        right: contract.right,
        contracts: [],
      };
    group.contracts.push(contract);
    resolutionGroupsByKey.set(groupKey, group);
  });

  const quoteByProviderContractId = new Map<
    string,
    Partial<QuoteSnapshot> | Record<string, unknown>
  >();
  const resolvedProviderIds = await resolveShadowIbkrOptionProviderIds(
    Array.from(resolutionGroupsByKey.values()),
  );
  positions.forEach((position) => {
    const contract = asOptionContract(position.optionContract);
    const quoteIdentifier = shadowOptionQuoteIdentifier(contract);
    if (!contract || !quoteIdentifier || !isOpraOptionTicker(quoteIdentifier)) {
      return;
    }
    const providerContractId = resolvedProviderIds.get(quoteIdentifier);
    if (!providerContractId) {
      return;
    }
    const underlying = normalizeSymbol(contract.underlying || position.symbol).toUpperCase();
    if (!underlying) {
      return;
    }
    addProviderContractId(underlying, providerContractId, quoteIdentifier);
  });
  const allProviderContractIds = Array.from(
    new Set(
      Array.from(idsByUnderlying.values()).flatMap((ids) => Array.from(ids)),
    ),
  );
  const quoteUnderlying =
    idsByUnderlying.size === 1 ? Array.from(idsByUnderlying.keys())[0] : null;
  const quoteTasks: Array<() => Promise<void>> = [];
  if (allProviderContractIds.length) {
    quoteTasks.push(async () => {
      const owner = options.ownerPrefix ?? "shadow-position:ledger:day-change";
      declareIbkrLiveDemand({
        underlying: quoteUnderlying ?? undefined,
        providerContractIds: allProviderContractIds,
        owner,
        intent: options.intent ?? "account-monitor-live",
        fallbackProvider: "cache",
        requiresGreeks: options.requiresGreeks ?? false,
        ttlMs: SHADOW_OPTION_QUOTE_CACHE_TTL_MS,
      });
      readIbkrLiveDemandState({
        underlying: quoteUnderlying ?? undefined,
        providerContractIds: allProviderContractIds,
        owner,
        requiresGreeks: options.requiresGreeks ?? false,
      }).states.flatMap((state) => (state.quote ? [state.quote] : [])).forEach((quote) => {
        const providerContractId = String(quote.providerContractId || "").trim();
        if (providerContractId) {
          quoteByProviderContractId.set(providerContractId, quote);
          rememberShadowOptionQuote(providerContractId, quote);
          if (options.requiresGreeks) {
            rememberShadowOptionGreekQuote(providerContractId, quote);
          }
          (aliasesByProviderContractId.get(providerContractId) ?? new Set()).forEach(
            (alias) => {
              quoteByProviderContractId.set(alias, quote);
              rememberShadowOptionQuote(alias, quote);
              if (options.requiresGreeks) {
                rememberShadowOptionGreekQuote(alias, quote);
              }
            },
          );
        }
      });
    });
  }
  const taskMaxWaitMs =
    options.taskMaxWaitMs ?? SHADOW_DAY_CHANGE_QUOTE_TASK_MAX_WAIT_MS;
  await Promise.allSettled(
    quoteTasks.map((task) => {
      const request = task().catch((error) => {
        logger.debug?.(
          { err: error },
          "Shadow position day-change quote task failed",
        );
      });
      return Promise.race([
        request,
        sleep(taskMaxWaitMs).then(() => undefined),
      ]);
    }),
  );
  const missingMassiveQuotePositions = positions.filter((position) => {
    const quoteIdentifier = shadowOptionQuoteIdentifier(
      asOptionContract(position.optionContract),
    );
    const quote = quoteIdentifier
      ? quoteByProviderContractId.get(quoteIdentifier)
      : null;
    return Boolean(
      quoteIdentifier && !shadowOptionQuoteCanBuildDayChange(quote),
    );
  });
  if (missingMassiveQuotePositions.length > 0) {
    const massiveQuotes = await fetchShadowMassiveOptionDayChangeQuotes(
      missingMassiveQuotePositions,
    ).catch((error) => {
      logger.debug?.(
        { err: error },
        "Shadow Massive option day-change quote fallback failed",
      );
      return new Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>();
    });
    massiveQuotes.forEach((quote, providerContractId) => {
      if (!quoteByProviderContractId.has(providerContractId)) {
        quoteByProviderContractId.set(providerContractId, quote);
      }
    });
  }
  return quoteByProviderContractId;
}

async function waitForShadowOptionDayChangeQuotes(
  request: Promise<Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>>,
  maxWaitMs = SHADOW_DAY_CHANGE_QUOTE_MAX_WAIT_MS,
) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      request,
      new Promise<Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>>(
        (resolve) => {
          timeout = setTimeout(
            () => resolve(new Map()),
            maxWaitMs,
          );
          timeout.unref?.();
        },
      ),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function selectLatestShadowPositionMarksByPositionId<
  T extends Pick<ShadowPositionMarkRow, "positionId" | "asOf">,
>(marks: T[]): Map<string, T> {
  const byPositionId = new Map<string, T>();
  marks.forEach((mark) => {
    const current = byPositionId.get(mark.positionId);
    if (!current || mark.asOf.getTime() > current.asOf.getTime()) {
      byPositionId.set(mark.positionId, mark);
    }
  });
  return byPositionId;
}

function groupShadowPositionMarksByPositionId<
  T extends Pick<ShadowPositionMarkRow, "positionId" | "asOf">,
>(marks: T[]): Map<string, T[]> {
  const byPositionId = new Map<string, T[]>();
  marks.forEach((mark) => {
    byPositionId.set(mark.positionId, [
      ...(byPositionId.get(mark.positionId) ?? []),
      mark,
    ]);
  });
  byPositionId.forEach((positionMarks) => {
    positionMarks.sort((left, right) => right.asOf.getTime() - left.asOf.getTime());
  });
  return byPositionId;
}

async function readLatestShadowPositionBaselineMarks(
  positionIds: string[],
  maxDayStart: Date,
): Promise<ShadowPositionMarkRow[]> {
  const uniquePositionIds = Array.from(new Set(positionIds.filter(Boolean)));
  if (!uniquePositionIds.length) {
    return [];
  }

  const result = await pool.query<ShadowPositionMarkRow>(
    `
      select
        mark.id,
        mark.account_id as "accountId",
        mark.position_id as "positionId",
        mark.mark,
        mark.market_value as "marketValue",
        mark.unrealized_pnl as "unrealizedPnl",
        mark.source,
        mark.as_of as "asOf",
        mark.created_at as "createdAt",
        mark.updated_at as "updatedAt"
      from unnest($2::uuid[]) as requested(position_id)
      join lateral (
        select *
        from shadow_position_marks
        where account_id = $1
          and position_id = requested.position_id
          and as_of <= $3
        order by as_of desc, created_at desc
        limit 1
      ) mark on true
    `,
    [currentShadowAccountId(), uniquePositionIds, maxDayStart],
  );
  return result.rows;
}

function shadowPositionNeedsDayChangeQuote(input: {
  position: ShadowPositionRow;
  baselineMarksByPositionId: Map<string, ShadowPositionMarkRow[]>;
  dayStartByPositionId: Map<string, Date>;
  now: Date;
}) {
  const { position, baselineMarksByPositionId, dayStartByPositionId, now } = input;
  const providerContractId = shadowOptionQuoteIdentifier(
    asOptionContract(position.optionContract),
  );
  if (!providerContractId) {
    return false;
  }
  const currentAsOf = position.asOf ?? position.updatedAt ?? now;
  const dayStart =
    dayStartByPositionId.get(position.id) ??
    shadowPositionDayChangeDayStart(position, now);
  const quantity = toNumber(position.quantity) ?? 0;
  if (quantity === 0) {
    return false;
  }

  const averageCost = toNumber(position.averageCost) ?? 0;
  const currentMarketValue = toNumber(position.marketValue);
  const contract = asOptionContract(position.optionContract);
  const multiplier = marketMultiplier({
    assetClass: position.assetClass as ShadowAssetClass,
    optionContract: contract,
  });
  const baselineMark = (baselineMarksByPositionId.get(position.id) ?? []).find(
    (mark) => mark.asOf.getTime() <= dayStart.getTime(),
  );
  const openedAt = position.openedAt ?? currentAsOf;
  const baselineMarketValue = shadowPositionDayChangeBaselineMarketValue({
    baselineMarkMarketValue: toNumber(baselineMark?.marketValue),
    openedAt,
    dayStart,
    averageCost,
    quantity,
    multiplier,
  });
  const baselineDayChange = buildShadowPositionDayChange({
    currentMarketValue,
    baselineMarketValue,
  });
  const currentMarkStale = currentAsOf.getTime() < dayStart.getTime();
  return baselineDayChange.dayChange == null || currentMarkStale;
}

async function readShadowPositionDayChanges(
  positions: ShadowPositionRow[],
  now = new Date(),
  preloadedOptionQuoteByProviderContractId:
    | Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>
    | null = null,
  options: {
    fetchMissingOptionQuotes?: boolean;
    fetchOptionQuoteOptions?: Parameters<
      typeof fetchShadowOptionDayChangeQuotes
    >[1];
  } = {},
): Promise<Map<string, ShadowPositionDayChange>> {
  const changes = new Map<string, ShadowPositionDayChange>();
  const dayStartByPositionId = new Map(
    positions.map((position) => [
      position.id,
      shadowPositionDayChangeDayStart(position, now),
    ]),
  );
  const maxDayStart = Array.from(dayStartByPositionId.values()).reduce<Date | null>(
    (latest, dayStart) =>
      latest === null || dayStart.getTime() > latest.getTime() ? dayStart : latest,
    null,
  );
  const positionIds = positions.map((position) => position.id);
  const baselineMarks =
    positionIds.length && maxDayStart
      ? await readLatestShadowPositionBaselineMarks(positionIds, maxDayStart)
      : [];
  const baselineMarksByPositionId =
    groupShadowPositionMarksByPositionId(baselineMarks);
  let optionQuoteByProviderContractId:
    | Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>
    | null = preloadedOptionQuoteByProviderContractId
      ? new Map(preloadedOptionQuoteByProviderContractId)
      : null;
  let fetchedOptionQuotes = false;
  let quoteCandidatePositions: ShadowPositionRow[] | null = null;
  const getOptionQuoteByProviderContractId = async () => {
    quoteCandidatePositions ??= positions.filter((position) =>
      shadowPositionNeedsDayChangeQuote({
        position,
        baselineMarksByPositionId,
        dayStartByPositionId,
        now,
      }),
    );
    const missingQuotePositions = optionQuoteByProviderContractId
      ? quoteCandidatePositions.filter((position) => {
          const quoteIdentifier = shadowOptionQuoteIdentifier(
            asOptionContract(position.optionContract),
          );
          const quote = quoteIdentifier
            ? optionQuoteByProviderContractId?.get(quoteIdentifier)
            : null;
          return (
            quoteIdentifier &&
            !shadowOptionQuoteCanBuildDayChange(quote)
          );
        })
      : quoteCandidatePositions;
    if (
      options.fetchMissingOptionQuotes !== false &&
      !fetchedOptionQuotes &&
      missingQuotePositions.length > 0
    ) {
      const fetched = await waitForShadowOptionDayChangeQuotes(
        fetchShadowOptionDayChangeQuotes(
          missingQuotePositions,
          options.fetchOptionQuoteOptions,
        ).catch(() => new Map()),
      );
      optionQuoteByProviderContractId = new Map([
        ...(optionQuoteByProviderContractId ?? new Map()),
        ...fetched,
      ]);
      fetchedOptionQuotes = true;
    }
    return optionQuoteByProviderContractId ?? new Map();
  };

  for (const position of positions) {
    const currentAsOf = position.asOf ?? position.updatedAt ?? now;
    const dayStart =
      dayStartByPositionId.get(position.id) ??
      shadowPositionDayChangeDayStart(position, now);
    const quantity = toNumber(position.quantity) ?? 0;
    const averageCost = toNumber(position.averageCost) ?? 0;
    const currentMarketValue = toNumber(position.marketValue);
    const contract = asOptionContract(position.optionContract);
    const multiplier = marketMultiplier({
      assetClass: position.assetClass as ShadowAssetClass,
      optionContract: contract,
    });

    if (quantity === 0) {
      changes.set(position.id, { dayChange: null, dayChangePercent: null });
      continue;
    }

    const baselineMark = (baselineMarksByPositionId.get(position.id) ?? []).find(
      (mark) => mark.asOf.getTime() <= dayStart.getTime(),
    );
    const openedAt = position.openedAt ?? currentAsOf;
    const baselineMarketValue = shadowPositionDayChangeBaselineMarketValue({
      baselineMarkMarketValue: toNumber(baselineMark?.marketValue),
      openedAt,
      dayStart,
      averageCost,
      quantity,
      multiplier,
    });
    const baselineDayChange = buildShadowPositionDayChange({
      currentMarketValue,
      baselineMarketValue,
    });
    const providerContractId = shadowOptionQuoteIdentifier(contract);
    const currentMarkStale = currentAsOf.getTime() < dayStart.getTime();
    if (
      (baselineDayChange.dayChange == null || currentMarkStale) &&
      providerContractId
    ) {
      const quotes = await getOptionQuoteByProviderContractId();
      const quote = quotes.get(providerContractId);
      if (quote) {
        changes.set(
          position.id,
          buildShadowPositionDayChangeFromQuote({
            quantity,
            multiplier,
            quote,
          }),
        );
        continue;
      }
    }

    if (currentMarkStale) {
      changes.set(position.id, { dayChange: null, dayChangePercent: null });
      continue;
    }

    changes.set(position.id, baselineDayChange);
  }

  return changes;
}

function metric(
  value: number | null | undefined,
  currency: string | null,
  field: string,
  updatedAt: Date | null,
) {
  return {
    value: Number.isFinite(Number(value)) ? Number(value) : null,
    currency,
    source: "SHADOW_LEDGER",
    field,
    updatedAt,
  };
}

type ShadowAccountSummaryReturnMetrics = {
  dayPnl: number | null;
  dayPnlField: string;
  dayPnlCapitalBase: number | null;
};

function calculateLatestShadowMarketDayPnlFromHistory(
  points: ShadowAccountEquityPoint[],
): {
  value: number;
  capitalBase: number | null;
  marketDate: string;
} | null {
  const sorted = points
    .map((point) => {
      const timestamp =
        point.timestamp instanceof Date
          ? point.timestamp
          : new Date(point.timestamp);
      const netLiquidation = Number(point.netLiquidation);
      return {
        ...point,
        timestamp,
        netLiquidation,
        marketDate: marketDateKey(timestamp),
      };
    })
    .filter(
      (
        point,
      ): point is ShadowAccountEquityPoint & {
        timestamp: Date;
        netLiquidation: number;
        marketDate: string;
      } =>
        !Number.isNaN(point.timestamp.getTime()) &&
        Number.isFinite(point.netLiquidation) &&
        Boolean(point.marketDate),
    )
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const latest = sorted[sorted.length - 1];
  if (!latest) {
    return null;
  }
  const dayPoints = sorted.filter((point) => point.marketDate === latest.marketDate);
  const first = dayPoints[0];
  const last = dayPoints[dayPoints.length - 1];
  if (!first || !last || first.timestamp.getTime() === last.timestamp.getTime()) {
    return null;
  }
  const transfersAfterFirst = dayPoints.reduce(
    (sum, point) =>
      point.timestamp.getTime() > first.timestamp.getTime()
        ? sum + externalTransferAmount(point)
        : sum,
    0,
  );
  const value = last.netLiquidation - first.netLiquidation - transfersAfterFirst;
  if (!Number.isFinite(value)) {
    return null;
  }

  return {
    value,
    capitalBase:
      Number.isFinite(first.netLiquidation) && first.netLiquidation !== 0
        ? Math.abs(first.netLiquidation)
        : null,
    marketDate: latest.marketDate,
  };
}

function emptyShadowAccountSummaryReturnMetrics(): ShadowAccountSummaryReturnMetrics {
  return {
    dayPnl: null,
    dayPnlField: "EquityHistoryMarketDayPnl",
    dayPnlCapitalBase: null,
  };
}

function shadowAccountSummaryReturnMetricsFromHistory(
  history: ShadowAccountEquityHistory,
): ShadowAccountSummaryReturnMetrics {
  const dayPnl = calculateLatestShadowMarketDayPnlFromHistory(history.points);
  return {
    dayPnl: dayPnl?.value ?? null,
    dayPnlField: dayPnl
      ? `EquityHistoryMarketDayPnl:${dayPnl.marketDate}`
      : "EquityHistoryMarketDayPnl",
    dayPnlCapitalBase: dayPnl?.capitalBase ?? null,
  };
}

async function resolveShadowAccountSummaryReturnMetrics(input: {
  source?: string | null;
}): Promise<ShadowAccountSummaryReturnMetrics> {
  const cached = readFreshCachedShadowEquityHistoryReturnMetrics({
    source: input.source,
  });
  if (cached) {
    return cached;
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const historyRequest = getShadowAccountEquityHistory({
    range: "1D",
    source: input.source,
  });
  historyRequest.catch((error) => {
    logger.debug?.(
      { err: error, source: input.source ?? null },
      "Shadow account summary background equity-history P&L refresh failed",
    );
  });

  try {
    const history = await Promise.race([
      historyRequest,
      new Promise<ShadowAccountEquityHistory | null>((resolve) => {
        timeout = setTimeout(
          () => resolve(null),
          SHADOW_SUMMARY_EQUITY_HISTORY_MAX_WAIT_MS,
        );
        timeout.unref?.();
      }),
    ]);
    return history
      ? shadowAccountSummaryReturnMetricsFromHistory(history)
      : emptyShadowAccountSummaryReturnMetrics();
  } catch (error) {
    logger.debug?.(
      { err: error, source: input.source ?? null },
      "Shadow account summary equity-history P&L unavailable",
    );
    return emptyShadowAccountSummaryReturnMetrics();
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function buildShadowAccountSummaryResponse(input: {
  totals: ShadowTotals;
  returnMetrics?: ShadowAccountSummaryReturnMetrics;
  degraded?: boolean;
}) {
  const { totals } = input;
  const dayPnl = input.returnMetrics?.dayPnl ?? null;
  const dayPnlPercentDenominator =
    input.returnMetrics?.dayPnlCapitalBase &&
    input.returnMetrics.dayPnlCapitalBase !== 0
      ? Math.abs(input.returnMetrics.dayPnlCapitalBase)
      : Math.abs(totals.netLiquidation);
  const totalPnl = totals.netLiquidation - totals.startingBalance;
  return {
    accountId: SHADOW_ACCOUNT_ID,
    isCombined: false,
    mode: "shadow",
    currency: SHADOW_CURRENCY,
    degraded: Boolean(input.degraded),
    reason: input.degraded ? SHADOW_ACCOUNT_DB_FALLBACK_REASON : null,
    accounts: [
      {
        id: SHADOW_ACCOUNT_ID,
        displayName: SHADOW_ACCOUNT_DISPLAY_NAME,
        currency: SHADOW_CURRENCY,
        live: false,
        accountType: "Shadow",
        updatedAt: totals.updatedAt,
      },
    ],
    updatedAt: totals.updatedAt,
    fx: {
      baseCurrency: SHADOW_CURRENCY,
      timestamp: totals.updatedAt,
      rates: { [SHADOW_CURRENCY]: 1 },
      warning: null,
    },
    badges: {
      accountTypes: ["Shadow", "Cash"],
      pdt: {
        isPatternDayTrader: null,
        dayTradesRemainingThisWeek: null,
      },
    },
    metrics: {
      netLiquidation: metric(totals.netLiquidation, SHADOW_CURRENCY, "NetLiquidation", totals.updatedAt),
      totalCash: metric(totals.cash, SHADOW_CURRENCY, "Cash", totals.updatedAt),
      buyingPower: metric(totals.cash, SHADOW_CURRENCY, "BuyingPower", totals.updatedAt),
      marginUsed: metric(0, SHADOW_CURRENCY, "MarginUsed", totals.updatedAt),
      maintenanceMargin: metric(0, SHADOW_CURRENCY, "MaintenanceMargin", totals.updatedAt),
      maintenanceMarginCushionPercent: metric(null, null, "CashAccount", totals.updatedAt),
      dayPnl: metric(
        dayPnl,
        SHADOW_CURRENCY,
        input.returnMetrics?.dayPnlField ?? "EquityHistoryMarketDayPnl",
        totals.updatedAt,
      ),
      dayPnlPercent: metric(
        dayPnlPercentDenominator && dayPnl !== null
          ? (dayPnl / dayPnlPercentDenominator) * 100
          : null,
        null,
        "EquityHistoryMarketDayPnl/MarketDayCapitalBase",
        totals.updatedAt,
      ),
      totalPnl: metric(totalPnl, SHADOW_CURRENCY, "ChangeInNAV", totals.updatedAt),
      totalPnlPercent: metric(
        totals.startingBalance ? (totalPnl / totals.startingBalance) * 100 : null,
        null,
        "ChangeInNAV/InitialNAV",
        totals.updatedAt,
      ),
      settledCash: metric(totals.cash, SHADOW_CURRENCY, "SettledCash", totals.updatedAt),
      unsettledCash: metric(0, SHADOW_CURRENCY, "UnsettledCash", totals.updatedAt),
      sma: metric(null, SHADOW_CURRENCY, "SMA", totals.updatedAt),
      dayTradingBuyingPower: metric(totals.cash, SHADOW_CURRENCY, "DayTradingBuyingPower", totals.updatedAt),
      regTInitialMargin: metric(0, SHADOW_CURRENCY, "RegTMargin", totals.updatedAt),
      leverage: metric(
        totals.netLiquidation ? totals.marketValue / totals.netLiquidation : 0,
        null,
        "Leverage",
        totals.updatedAt,
      ),
      grossPositionValue: metric(totals.marketValue, SHADOW_CURRENCY, "GrossPositionValue", totals.updatedAt),
    },
  };
}

export async function getShadowAccountSummary(input: { source?: string | null } = {}) {
  const source = normalizeShadowSourceScope(input.source);
  kickSignalOptionsAutomationMirrorRepairForRead(source);
  return withShadowReadCache(
    `summary:${shadowSourceCacheKey(source)}`,
    async () => {
      try {
        const totals = source
          ? await computeShadowTotalsForSource(source)
          : await ensureFreshShadowState(true);
        const degraded = isShadowAccountDbBackoffActive();
        const returnMetrics = degraded
          ? undefined
          : await resolveShadowAccountSummaryReturnMetrics({ source });
        return buildShadowAccountSummaryResponse({
          totals,
          returnMetrics,
          degraded,
        });
      } catch (error) {
        if (isTransientPostgresError(error)) {
          markShadowAccountDbUnavailable(error);
          return buildShadowAccountSummaryResponse({
            totals: buildFallbackShadowTotals(),
            degraded: true,
          });
        }
        throw error;
      }
    },
    {
      staleStrategy: "immediate",
      ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    },
  );
}

function isWatchlistBacktestRunSnapshotSource(source: string | null | undefined) {
  return Boolean(
    source?.startsWith(`${WATCHLIST_BACKTEST_SOURCE}:`) ||
      source?.startsWith("watchlist_bt:"),
  );
}

function isWatchlistBacktestSnapshotSource(source: string | null | undefined) {
  return (
    isWatchlistBacktestRunSnapshotSource(source) ||
    source === WATCHLIST_BACKTEST_MARK_SOURCE
  );
}

function isSignalOptionsReplaySnapshotSource(source: string | null | undefined) {
  return (
    source === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    source === SIGNAL_OPTIONS_REPLAY_MARK_SOURCE
  );
}

function shadowBenchmarkBarsCacheKey(input: {
  symbol: string;
  timeframe: ReturnType<typeof accountBenchmarkTimeframeForRange>;
  from: Date;
  to: Date;
  limit: number;
}) {
  return [
    normalizeSymbol(input.symbol).toUpperCase(),
    input.timeframe,
    input.from.toISOString(),
    input.to.toISOString(),
    input.limit,
  ].join(":");
}

function normalizeShadowBenchmarkSymbol(raw: string | null | undefined) {
  const symbol = typeof raw === "string" ? normalizeSymbol(raw).toUpperCase() : "";
  return symbol || null;
}

async function waitForShadowBenchmarkBars(
  request: Promise<ShadowBenchmarkBars | null>,
) {
  return await new Promise<ShadowBenchmarkBars | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, SHADOW_BENCHMARK_BARS_MAX_WAIT_MS);
    timeout.unref?.();

    request.then((bars) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(bars);
      }
    });
  });
}

async function resolveShadowBenchmarkBars(input: {
  symbol: string;
  range: AccountRange;
  from: Date;
  to: Date;
}) {
  const timeframe = accountBenchmarkTimeframeForRange(input.range);
  const limit = accountBenchmarkLimitForRange(input.range);
  const cacheKey = shadowBenchmarkBarsCacheKey({
    symbol: input.symbol,
    timeframe,
    from: input.from,
    to: input.to,
    limit,
  });
  const now = Date.now();
  const cached = shadowBenchmarkBarsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.bars;
  }

  let request = shadowBenchmarkBarsInFlight.get(cacheKey);
  if (!request) {
    request = getBars({
      symbol: input.symbol,
      timeframe,
      from: input.from,
      to: input.to,
      limit,
      outsideRth: true,
      allowHistoricalSynthesis: true,
    })
      .then((bars) => {
        const sortedBars = [...bars.bars].sort(
          (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
        );
        shadowBenchmarkBarsCache.set(cacheKey, {
          bars: sortedBars,
          expiresAt: Date.now() + SHADOW_BENCHMARK_BARS_CACHE_TTL_MS,
        });
        return sortedBars;
      })
      .catch((error) => {
        logger.debug?.(
          { err: error, benchmark: input.symbol },
          "Shadow benchmark overlay unavailable",
        );
        return null;
      })
      .finally(() => {
        if (shadowBenchmarkBarsInFlight.get(cacheKey) === request) {
          shadowBenchmarkBarsInFlight.delete(cacheKey);
        }
      });
    shadowBenchmarkBarsInFlight.set(cacheKey, request);
  }

  return (await waitForShadowBenchmarkBars(request)) ?? cached?.bars ?? null;
}

async function resolveShadowBenchmarkPercents(input: {
  benchmark: string | null | undefined;
  range: AccountRange;
  start: Date | null;
  points: Array<{ timestamp: Date }>;
}): Promise<Array<number | null>> {
  if (!input.benchmark || input.points.length < 2) {
    return input.points.map(() => null);
  }

  try {
    const bars = await resolveShadowBenchmarkBars({
      symbol: input.benchmark,
      range: input.range,
      from:
        input.start ??
        input.points[0]?.timestamp ??
        new Date(Date.now() - 365 * 86_400_000),
      to: input.points[input.points.length - 1]?.timestamp ?? new Date(),
    });
    if (!bars?.length) {
      return input.points.map(() => null);
    }

    const base = toNumber(bars[0]?.close);
    if (base == null || base === 0) {
      return input.points.map(() => null);
    }

    let cursor = 0;
    return input.points.map((point) => {
      while (
        cursor + 1 < bars.length &&
        bars[cursor + 1]!.timestamp.getTime() <= point.timestamp.getTime()
      ) {
        cursor += 1;
      }

      const close = toNumber(bars[cursor]?.close);
      return close != null ? ((close - base) / base) * 100 : null;
    });
  } catch (error) {
    logger.debug?.(
      { err: error, benchmark: input.benchmark },
      "Shadow benchmark overlay unavailable",
    );
    return input.points.map(() => null);
  }
}

function latestShadowBacktestSnapshotSource<
  T extends Pick<ShadowBalanceSnapshotRow, "source" | "asOf" | "createdAt">,
>(rows: T[]) {
  return rows
    .filter((row) => isWatchlistBacktestRunSnapshotSource(row.source))
    .sort((left, right) => {
      const leftCreated = left.createdAt?.getTime() ?? 0;
      const rightCreated = right.createdAt?.getTime() ?? 0;
      if (leftCreated !== rightCreated) {
        return rightCreated - leftCreated;
      }
      return right.asOf.getTime() - left.asOf.getTime();
    })[0]?.source ?? null;
}

function selectShadowEquityHistoryRows<
  T extends Pick<ShadowBalanceSnapshotRow, "source" | "asOf" | "createdAt">,
>(rows: T[], input: { source?: string | null } = {}) {
  const source = normalizeShadowSourceScope(input.source);
  if (source === SIGNAL_OPTIONS_REPLAY_SOURCE) {
    return {
      scope: SIGNAL_OPTIONS_REPLAY_SOURCE,
      selectedSource: SIGNAL_OPTIONS_REPLAY_SOURCE,
      includeInitialPoint: true,
      includeLiveTerminal: true,
      rows: rows.filter((row) => isSignalOptionsReplaySnapshotSource(row.source)),
    };
  }
  if (source === WATCHLIST_BACKTEST_SOURCE) {
    const selectedSource = latestShadowBacktestSnapshotSource(rows);
    return {
      scope: WATCHLIST_BACKTEST_SOURCE,
      selectedSource,
      includeInitialPoint: true,
      includeLiveTerminal: true,
      rows: selectedSource
        ? rows.filter(
            (row) =>
              row.source === selectedSource ||
              row.source === WATCHLIST_BACKTEST_MARK_SOURCE,
          )
        : [],
    };
  }
  return {
    scope: "ledger" as const,
    selectedSource: null,
    includeInitialPoint: true,
    includeLiveTerminal: true,
    rows: rows.filter((row) => !isWatchlistBacktestSnapshotSource(row.source)),
  };
}

const SHADOW_LEDGER_SNAPSHOT_TOLERANCE = 0.05;

function nearlyEqualMoney(left: number, right: number) {
  return Math.abs(left - right) <= SHADOW_LEDGER_SNAPSHOT_TOLERANCE;
}

function buildLiveShadowLedgerTotalsCursor(input: {
  account: Pick<ShadowAccountRow, "startingBalance">;
  fills: ShadowFillRow[];
}) {
  const startingBalance = toNumber(input.account.startingBalance) ?? SHADOW_STARTING_BALANCE;
  const fills = input.fills
    .map((fill) => ({
      occurredAtMs: fill.occurredAt.getTime(),
      cashDelta: toNumber(fill.cashDelta) ?? 0,
      realizedPnl: toNumber(fill.realizedPnl) ?? 0,
      fees: toNumber(fill.fees) ?? 0,
    }))
    .sort((left, right) => left.occurredAtMs - right.occurredAtMs);
  const totals = { cash: startingBalance, realizedPnl: 0, fees: 0 };
  let cursor = 0;

  return (asOf: Date) => {
    const asOfMs = asOf.getTime();
    while (cursor < fills.length && fills[cursor]!.occurredAtMs <= asOfMs) {
      const fill = fills[cursor]!;
      totals.cash += fill.cashDelta;
      totals.realizedPnl += fill.realizedPnl;
      totals.fees += fill.fees;
      cursor += 1;
    }
    return { ...totals };
  };
}

function filterShadowEquityHistoryRowsToLiveLedger<
  T extends Pick<
    ShadowBalanceSnapshotRow,
    "asOf" | "source" | "cash" | "realizedPnl" | "fees"
  >,
>(
  rows: T[],
  input: {
    account: Pick<ShadowAccountRow, "startingBalance">;
    fills: ShadowFillRow[];
  },
) {
  const totalsAt = buildLiveShadowLedgerTotalsCursor(input);
  const keep = new Set<number>();
  rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => left.row.asOf.getTime() - right.row.asOf.getTime())
    .forEach(({ row, index }) => {
      const expected = totalsAt(row.asOf);
      if (
      nearlyEqualMoney(toNumber(row.cash) ?? 0, expected.cash) &&
      nearlyEqualMoney(toNumber(row.realizedPnl) ?? 0, expected.realizedPnl) &&
      nearlyEqualMoney(toNumber(row.fees) ?? 0, expected.fees)
      ) {
        keep.add(index);
      }
    });

  return rows.filter((_, index) => keep.has(index));
}

type ShadowEquityHistoryLedgerRow = Pick<
  ShadowBalanceSnapshotRow,
  "asOf" | "source" | "cash" | "realizedPnl" | "fees" | "netLiquidation" | "createdAt"
>;

function buildDefaultShadowEquityHistoryRows<T extends ShadowEquityHistoryLedgerRow>(
  rows: T[],
  input: {
    account: Pick<ShadowAccountRow, "startingBalance">;
    fills: ShadowFillRow[];
    terminalTotals: Pick<ShadowTotals, "netLiquidation"> | null;
  },
) {
  void input.terminalTotals;
  const replayRows = rows.filter((row) => row.source === SIGNAL_OPTIONS_REPLAY_SOURCE);
  const latestReplayAt = replayRows.reduce<Date | null>(
    (latest, row) =>
      !latest || row.asOf.getTime() > latest.getTime() ? row.asOf : latest,
    null,
  );
  const ledgerRows = filterShadowEquityHistoryRowsToLiveLedger(
    rows.filter(
      (row) =>
        row.source !== SIGNAL_OPTIONS_REPLAY_SOURCE &&
        (!latestReplayAt || row.asOf.getTime() > latestReplayAt.getTime()),
    ),
    {
      account: input.account,
      fills: input.fills,
    },
  );
  return [...replayRows, ...ledgerRows].sort(
    (left, right) => left.asOf.getTime() - right.asOf.getTime(),
  );
}

async function computeShadowEquityHistoryTerminalTotals(
  source: ShadowSourceScope | null = null,
): Promise<ShadowTotals> {
  await ensureShadowAccount();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  await Promise.race([
    kickShadowPositionMarkRefresh().then(() => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(
        resolve,
        SHADOW_EQUITY_HISTORY_MARK_REFRESH_MAX_WAIT_MS,
      );
    }),
  ]);
  if (timeout) {
    clearTimeout(timeout);
  }
  return computeShadowTotalsForSource(source, {
    useCurrentTimestampForOpenPositions: true,
  });
}

function compactShadowEquityHistoryRows<
  T extends Pick<ShadowBalanceSnapshotRow, "asOf" | "createdAt">,
>(rows: T[]) {
  // Dedup by asOf instant. The key only groups rows (it never surfaces in the
  // output), so a numeric getTime() key is 1:1 with the prior toISOString() key
  // and skips the per-row Date formatting — a measurable event-loop cost on the
  // universe-wide history read.
  return Array.from(
    rows
      .reduce((map, row) => {
        const key = row.asOf.getTime();
        const current = map.get(key);
        if (
          !current ||
          (row.createdAt?.getTime() ?? 0) >= (current.createdAt?.getTime() ?? 0)
        ) {
          map.set(key, row);
        }
        return map;
      }, new Map<number, T>())
      .values(),
  ).sort((left, right) => left.asOf.getTime() - right.asOf.getTime());
}

function bucketShadowEquityHistoryRows<
  T extends Pick<ShadowBalanceSnapshotRow, "asOf">,
>(rows: T[], bucketSizeMs: number | null) {
  if (!bucketSizeMs || rows.length <= 1) {
    return rows;
  }

  const MS_PER_DAY = 86_400_000;
  const byBucket = new Map<number, T>();
  const firstByDay = new Map<number, T>();
  rows.forEach((row) => {
    const asOfMs = row.asOf.getTime();
    byBucket.set(Math.floor(asOfMs / bucketSizeMs), row);

    // UTC-day key as a number (whole days since epoch) is 1:1 with the prior
    // toISOString().slice(0,10) date string, without the per-row Date formatting.
    const dayKey = Math.floor(asOfMs / MS_PER_DAY);
    const currentFirst = firstByDay.get(dayKey);
    if (!currentFirst || asOfMs < currentFirst.asOf.getTime()) {
      firstByDay.set(dayKey, row);
    }
  });

  // Union keyed by the asOf instant. getTime() is 1:1 with the prior toISOString()
  // key at ms resolution, so dedup is identical; keys never surface in output.
  const byTimestamp = new Map<number, T>();
  byBucket.forEach((row) => byTimestamp.set(row.asOf.getTime(), row));
  firstByDay.forEach((row) => byTimestamp.set(row.asOf.getTime(), row));

  return Array.from(byTimestamp.values()).sort(
    (left, right) => left.asOf.getTime() - right.asOf.getTime(),
  );
}

function shadowEquityHistoryBucketSizeMs<
  T extends Pick<ShadowBalanceSnapshotRow, "asOf">,
>(range: AccountRange, rows: T[]) {
  const defaultBucketSizeMs = accountSnapshotBucketSizeMs(range);
  if (!defaultBucketSizeMs || rows.length <= 1) {
    return defaultBucketSizeMs;
  }

  const first = rows[0]?.asOf;
  const last = rows[rows.length - 1]?.asOf;
  if (!first || !last) {
    return defaultBucketSizeMs;
  }

  const spanMs = last.getTime() - first.getTime();
  const detailedHistoryMs = 370 * 24 * 60 * 60_000;
  if (
    spanMs > 0 &&
    spanMs <= detailedHistoryMs &&
    ["3M", "6M", "YTD", "1Y", "ALL"].includes(range)
  ) {
    return 5 * 60_000;
  }

  return defaultBucketSizeMs;
}

export async function backfillSignalOptionsReplayEquitySnapshotsFromRun(input: {
  runId: string;
  replace?: boolean;
}) {
  const points = await db
    .select()
    .from(backtestRunPointsTable)
    .where(eq(backtestRunPointsTable.runId, input.runId))
    .orderBy(asc(backtestRunPointsTable.occurredAt));
  if (!points.length) {
    return {
      inserted: 0,
      deleted: 0,
      firstAsOf: null,
      lastAsOf: null,
    };
  }

  const firstAsOf = points[0]!.occurredAt;
  const lastAsOf = points[points.length - 1]!.occurredAt;
  let deleted = 0;
  await db.transaction(async (tx) => {
    if (input.replace !== false) {
      const removed = await tx
        .delete(shadowBalanceSnapshotsTable)
        .where(
          and(
            eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
            eq(shadowBalanceSnapshotsTable.source, SIGNAL_OPTIONS_REPLAY_SOURCE),
            gte(shadowBalanceSnapshotsTable.asOf, firstAsOf),
            lte(shadowBalanceSnapshotsTable.asOf, lastAsOf),
          ),
        )
        .returning({ id: shadowBalanceSnapshotsTable.id });
      deleted = removed.length;
    }
  });
  invalidateShadowFreshStateCache();
  notifyShadowAccountChanged();
  return {
    inserted: 0,
    deleted,
    firstAsOf,
    lastAsOf,
  };
}

function buildFallbackShadowAccountEquityHistory(input: {
  range: AccountRange;
  benchmark?: string | null;
  now?: Date;
}): ShadowAccountEquityHistory {
  const now = input.now ?? new Date();
  return {
    accountId: SHADOW_ACCOUNT_ID,
    range: input.range,
    currency: SHADOW_CURRENCY,
    flexConfigured: true,
    lastFlexRefreshAt: null,
    benchmark: input.benchmark || null,
    asOf: now,
    latestSnapshotAt: null,
    isStale: true,
    staleReason: SHADOW_ACCOUNT_DB_FALLBACK_REASON,
    degraded: true,
    reason: SHADOW_ACCOUNT_DB_FALLBACK_REASON,
    terminalPointSource: "runtime_fallback",
    liveTerminalIncluded: true,
    sourceScope: "runtime_fallback",
    selectedSnapshotSource: null,
    points: [
      {
        timestamp: now,
        netLiquidation: SHADOW_STARTING_BALANCE,
        currency: SHADOW_CURRENCY,
        source: "SHADOW_RUNTIME_FALLBACK",
        deposits: SHADOW_STARTING_BALANCE,
        withdrawals: 0,
        dividends: 0,
        fees: 0,
        returnPercent: 0,
        benchmarkPercent: null,
      },
    ],
    events: [
      {
        timestamp: now,
        type: "deposit",
        amount: SHADOW_STARTING_BALANCE,
        currency: SHADOW_CURRENCY,
        source: "SHADOW_RUNTIME_FALLBACK",
      },
    ],
  };
}

type ShadowAccountEquityPoint = {
  timestamp: Date;
  netLiquidation: number;
  currency: string;
  source: string;
  deposits: number;
  withdrawals: number;
  dividends: number;
  fees: number;
  returnPercent: number;
  benchmarkPercent: number | null;
};

type ShadowAccountEquityEvent = {
  id?: string;
  timestamp: Date | string;
  type: string;
  amount: number;
  currency: string;
  source: string;
  symbol?: string;
  side?: string;
  quantity?: number;
  price?: number;
  fees?: number;
  realizedPnl?: number;
  sourceType?: string;
  strategyLabel?: string | null;
  candidateId?: string | null;
};

type ShadowAccountEquityHistory = {
  accountId: string;
  range: AccountRange;
  currency: string;
  flexConfigured: boolean;
  lastFlexRefreshAt: Date | null;
  benchmark: string | null;
  asOf: Date | null;
  latestSnapshotAt: Date | null;
  isStale: boolean;
  staleReason: string | null;
  degraded?: boolean;
  stale?: boolean;
  reason?: string | null;
  terminalPointSource: string;
  liveTerminalIncluded: boolean;
  sourceScope: string;
  selectedSnapshotSource: string | null;
  points: ShadowAccountEquityPoint[];
  events: ShadowAccountEquityEvent[];
};

function shadowReusableEquityHistoryRange(range: AccountRange): AccountRange | null {
  return range === "1M" || range === "3M" || range === "6M" || range === "YTD"
    ? "1Y"
    : null;
}

function shadowEquityEventTimestampMs(event: ShadowAccountEquityEvent) {
  const timestamp =
    event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp);
  const time = timestamp.getTime();
  return Number.isFinite(time) ? time : null;
}

function sliceShadowAccountEquityHistoryToRange(
  base: ShadowAccountEquityHistory,
  range: AccountRange,
  now = new Date(),
): ShadowAccountEquityHistory {
  const start = accountRangeStart(range, now);
  if (!start) {
    return { ...base, range };
  }

  const startMs = start.getTime();
  const points = base.points.filter(
    (point) => point.timestamp.getTime() >= startMs,
  );
  const adjustedReturns = calculateTransferAdjustedReturnSeries(points);
  const rebasedPoints = points.map((point, index) => ({
    ...point,
    returnPercent: adjustedReturns[index]?.returnPercent ?? 0,
    benchmarkPercent: null,
  }));
  const lastPoint = rebasedPoints[rebasedPoints.length - 1] ?? null;
  const endMs = lastPoint?.timestamp.getTime() ?? Number.POSITIVE_INFINITY;
  const events = base.events.filter((event) => {
    if (event.type === "deposit") {
      return true;
    }
    const eventMs = shadowEquityEventTimestampMs(event);
    return eventMs != null && eventMs >= startMs && eventMs <= endMs;
  });

  return {
    ...base,
    range,
    benchmark: null,
    asOf: lastPoint?.timestamp ?? null,
    points: rebasedPoints,
    events,
  };
}

export async function getShadowAccountEquityHistory(input: {
  range?: AccountRange;
  benchmark?: string | null;
  source?: string | null;
}): Promise<ShadowAccountEquityHistory> {
  const range = normalizeAccountRange(input.range);
  const source = normalizeShadowSourceScope(input.source);
  const benchmark = normalizeShadowBenchmarkSymbol(input.benchmark);
  if (benchmark) {
    return withShadowReadCache(
      `equity-history:${range}:${benchmark}:${shadowSourceCacheKey(source)}`,
      async () => {
        const base = await getShadowAccountEquityHistory({
          range,
          source,
        });
        const benchmarkPercents = await resolveShadowBenchmarkPercents({
          benchmark,
          range,
          start: accountRangeStart(range),
          points: base.points,
        });
        return {
          ...base,
          benchmark,
          points: base.points.map((point, index) => ({
            ...point,
            benchmarkPercent: benchmarkPercents[index] ?? null,
          })),
          events: base.events.filter((event) => event.type === "deposit"),
        };
      },
      {
        staleStrategy: "immediate",
        ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
      },
    );
  }
  const reusableBaseRange = shadowReusableEquityHistoryRange(range);
  if (reusableBaseRange) {
    return withShadowReadCache(
      `equity-history:${range}::${shadowSourceCacheKey(source)}`,
      async () =>
        sliceShadowAccountEquityHistoryToRange(
          await getShadowAccountEquityHistory({
            range: reusableBaseRange,
            source,
          }),
          range,
        ),
      {
        staleStrategy: "immediate",
        ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
      },
    );
  }
  return withShadowReadCache(
    `equity-history:${range}::${shadowSourceCacheKey(source)}`,
    async () => {
      if (isShadowAccountDbBackoffActive()) {
        return buildFallbackShadowAccountEquityHistory({
          range,
          benchmark: null,
        });
      }
      try {
        const account =
          (await readShadowAccount()) ?? (await ensureShadowAccount());
        const start = accountRangeStart(range);
        const conditions: SQL<unknown>[] = [
          eq(shadowBalanceSnapshotsTable.accountId, currentShadowAccountId()),
        ];
        if (start) {
          conditions.push(gte(shadowBalanceSnapshotsTable.asOf, start));
        }
        const rows = await db
          .select()
          .from(shadowBalanceSnapshotsTable)
          .where(and(...conditions))
          .orderBy(shadowBalanceSnapshotsTable.asOf);
        const selection = selectShadowEquityHistoryRows(rows, { source });
        const totals = selection.includeLiveTerminal
          ? await computeShadowEquityHistoryTerminalTotals(source)
          : null;
        const { fills, ordersById } = await readShadowDashboardFillsWithOrders();
        const ledgerFills = source
          ? fills.filter((fill) =>
              shadowOrderMatchesSource(ordersById.get(fill.orderId), source),
            )
          : fills.filter((fill) =>
              isDefaultShadowLedgerAnalyticsOrder(ordersById.get(fill.orderId)),
            );
        const sourceUsesSimulationSnapshots =
          source === SIGNAL_OPTIONS_REPLAY_SOURCE ||
          source === WATCHLIST_BACKTEST_SOURCE;
        const liveLedgerRows = sourceUsesSimulationSnapshots
          ? selection.rows
          : source
            ? filterShadowEquityHistoryRowsToLiveLedger(selection.rows, {
                account,
                fills: ledgerFills,
              })
            : buildDefaultShadowEquityHistoryRows(selection.rows, {
                account,
                fills: ledgerFills,
                terminalTotals: totals,
              });
        const historyRows = selection.includeInitialPoint
          ? liveLedgerRows.filter((row) => row.source !== "initial")
          : liveLedgerRows;
        const compactHistoryRows = compactShadowEquityHistoryRows(historyRows);
        const compacted = bucketShadowEquityHistoryRows(
          compactHistoryRows,
          shadowEquityHistoryBucketSizeMs(range, compactHistoryRows),
        );
        const latestCompactedAt = compacted[compacted.length - 1]?.asOf ?? null;
        const includeLiveTerminal =
          totals &&
          (!latestCompactedAt ||
            totals.updatedAt.getTime() > latestCompactedAt.getTime()) &&
          (!start || totals.updatedAt.getTime() >= start.getTime());
        const firstHistoryAt = compactHistoryRows[0]?.asOf ?? null;
        const initialPointTimestamp =
          firstHistoryAt && account.createdAt.getTime() > firstHistoryAt.getTime()
            ? new Date(firstHistoryAt.getTime() - 1)
            : account.createdAt;
        const accountStartingBalance =
          toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE;
        const initialPoint = {
          timestamp: initialPointTimestamp,
          netLiquidation: accountStartingBalance,
          currency: SHADOW_CURRENCY,
          source:
            source === SIGNAL_OPTIONS_REPLAY_SOURCE
              ? "SHADOW_OPTIONS_REPLAY"
              : source === WATCHLIST_BACKTEST_SOURCE
                ? "SHADOW_BACKTEST"
                : "SHADOW_LEDGER",
          deposits: accountStartingBalance,
          withdrawals: 0,
          dividends: 0,
          fees: 0,
        };
        const rawSeedPoints = [
          ...(selection.includeInitialPoint &&
          (!start || initialPoint.timestamp >= start)
            ? [initialPoint]
            : []),
          ...compacted.map((row) => ({
            timestamp: row.asOf,
            netLiquidation: toNumber(row.netLiquidation) ?? 0,
            currency: row.currency,
            source:
              source === SIGNAL_OPTIONS_REPLAY_SOURCE
                ? "SHADOW_OPTIONS_REPLAY"
                : source === WATCHLIST_BACKTEST_SOURCE
                  ? "SHADOW_BACKTEST"
                  : "SHADOW_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: toNumber(row.fees) ?? 0,
          })),
          ...(includeLiveTerminal
            ? [
                {
                  timestamp: totals.updatedAt,
                  netLiquidation: totals.netLiquidation,
                  currency: SHADOW_CURRENCY,
                  source:
                    source === SIGNAL_OPTIONS_REPLAY_SOURCE
                      ? "SHADOW_OPTIONS_REPLAY"
                      : source === WATCHLIST_BACKTEST_SOURCE
                        ? "SHADOW_BACKTEST"
                        : "SHADOW_LEDGER",
                  deposits: 0,
                  withdrawals: 0,
                  dividends: 0,
                  fees: totals.fees,
                },
              ]
            : []),
        ];
        const seedPoints = Array.from(
          rawSeedPoints
            .reduce((map, point) => {
              map.set(point.timestamp.toISOString(), point);
              return map;
            }, new Map<string, (typeof rawSeedPoints)[number]>())
            .values(),
        ).sort(
          (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
        );
        const adjustedReturns = calculateTransferAdjustedReturnSeries(seedPoints);
        const lastPoint = seedPoints[seedPoints.length - 1] ?? null;
        const tradeEvents = await getShadowTradeEquityEvents({
          start,
          end: lastPoint?.timestamp ?? new Date(),
          sources: source ? [source] : undefined,
        });
        const benchmarkPercents = await resolveShadowBenchmarkPercents({
          benchmark: null,
          range,
          start,
          points: seedPoints,
        });

        return {
          accountId: SHADOW_ACCOUNT_ID,
          range,
          currency: SHADOW_CURRENCY,
          flexConfigured: true,
          lastFlexRefreshAt: null,
          benchmark: null,
          asOf: lastPoint?.timestamp ?? null,
          latestSnapshotAt: latestCompactedAt,
          isStale: false,
          staleReason: null,
          terminalPointSource:
            source === SIGNAL_OPTIONS_REPLAY_SOURCE
              ? "shadow_options_replay"
              : source === WATCHLIST_BACKTEST_SOURCE
                ? "shadow_watchlist_backtest"
                : "shadow_ledger",
          liveTerminalIncluded: Boolean(includeLiveTerminal),
          sourceScope: selection.scope,
          selectedSnapshotSource: selection.selectedSource,
          points: seedPoints.map((point, index) => ({
            ...point,
            returnPercent: adjustedReturns[index]?.returnPercent ?? 0,
            benchmarkPercent: benchmarkPercents[index] ?? null,
          })),
          events: [
            {
              timestamp: account.createdAt,
              type: "deposit",
              amount: accountStartingBalance,
              currency: SHADOW_CURRENCY,
              source: "SHADOW_LEDGER",
            },
            ...tradeEvents,
          ],
        };
      } catch (error) {
        if (isTransientPostgresError(error)) {
          markShadowAccountDbUnavailable(error);
          return buildFallbackShadowAccountEquityHistory({
            range,
            benchmark: null,
          });
        }
        throw error;
      }
    },
    {
      staleStrategy: "immediate",
      ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    },
  );
}

function buildShadowAccountAllocationResponse(input: {
  totals: ShadowTotals;
  positions: ShadowPositionRow[];
  degraded?: boolean;
}) {
  const { totals, positions } = input;
  const assetBuckets = new Map<string, number>();
  const sectorBuckets = new Map<string, number>();
  positions.forEach((position) => {
    const value = toNumber(position.marketValue) ?? 0;
    assetBuckets.set(assetClassLabel(position), (assetBuckets.get(assetClassLabel(position)) ?? 0) + value);
    sectorBuckets.set("Shadow Holdings", (sectorBuckets.get("Shadow Holdings") ?? 0) + value);
  });
  assetBuckets.set("Cash", (assetBuckets.get("Cash") ?? 0) + totals.cash);

  const bucketRows = (buckets: Map<string, number>) =>
    Array.from(buckets.entries())
      .map(([label, value]) => ({
        label,
        value,
        weightPercent: weightPercent(value, totals.netLiquidation),
        source: label === "Cash" ? "SHADOW_CASH" : "SHADOW_LEDGER",
      }))
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));

  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    degraded: Boolean(input.degraded),
    reason: input.degraded ? SHADOW_ACCOUNT_DB_FALLBACK_REASON : null,
    assetClass: bucketRows(assetBuckets),
    sector: bucketRows(sectorBuckets),
    exposure: {
      grossLong: totals.marketValue,
      grossShort: 0,
      netExposure: totals.marketValue,
    },
    updatedAt: totals.updatedAt,
  };
}

export async function getShadowAccountAllocation(input: { source?: string | null } = {}) {
  const source = normalizeShadowSourceScope(input.source);
  kickSignalOptionsAutomationMirrorRepairForRead(source);
  const reusableFromPositions = readReusableShadowAllocationFromPositions({
    source,
  });
  if (reusableFromPositions) {
    return reusableFromPositions;
  }
  return withShadowReadCache(
    `allocation:${shadowSourceCacheKey(source)}`,
    async () => {
      try {
        const totals = source
          ? await computeShadowTotalsForSource(source)
          : await ensureFreshShadowState(true);
        const degraded = isShadowAccountDbBackoffActive();
        const positions = degraded
          ? []
          : await readOpenShadowPositionsForSourceCached(source);
        return buildShadowAccountAllocationResponse({
          totals,
          positions,
          degraded,
        });
      } catch (error) {
        if (isTransientPostgresError(error)) {
          markShadowAccountDbUnavailable(error);
          return buildShadowAccountAllocationResponse({
            totals: buildFallbackShadowTotals(),
            positions: [],
            degraded: true,
          });
        }
        throw error;
      }
    },
    {
      staleStrategy: "immediate",
      ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    },
  );
}

type ShadowAccountPositionFallbackRow = {
  id: string;
  symbol: string;
  assetClass: string;
  marketValue: number;
  weightPercent: number | null;
  unrealizedPnl: number;
  dayChange: number | null;
  sector: string;
  description?: unknown;
};

function buildEmptyShadowAccountPositionsResponse(input: {
  totals: ShadowTotals;
  degraded?: boolean;
}) {
  const { totals } = input;
  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    degraded: Boolean(input.degraded),
    reason: input.degraded ? SHADOW_ACCOUNT_DB_FALLBACK_REASON : null,
    positions: [] as ShadowAccountPositionFallbackRow[],
    totals: {
      weightPercent: 0,
      unrealizedPnl: 0,
      grossLong: totals.marketValue,
      grossShort: 0,
      netExposure: totals.marketValue,
      cash: totals.cash,
      totalCash: totals.cash,
      buyingPower: Math.max(0, totals.cash),
      netLiquidation: totals.netLiquidation,
    },
    updatedAt: totals.updatedAt,
  };
}

type ShadowAccountPositionsResponseRow = Record<string, unknown> & {
  id: string;
  symbol: string;
  assetClass: string;
  description?: unknown;
  sector?: string;
  quantity?: number;
  averageCost?: number;
  mark?: number;
  dayChange?: number | null;
  dayChangePercent?: number | null;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent?: number | null;
  weightPercent: number | null;
  accountWeightPercent?: number | null;
  scopedWeightPercent?: number | null;
  optionContract?: unknown;
  underlyingMarket?: unknown;
  optionQuote?: unknown;
};

type ShadowAccountPositionsResponseShape = Record<string, unknown> & {
  accountId: string;
  currency: string;
  degraded: boolean;
  reason: string | null;
  positions: ShadowAccountPositionsResponseRow[];
  totals: Record<string, unknown> & {
    weightPercent: number | null;
    unrealizedPnl: number;
    grossLong: number;
    grossShort: number;
    netExposure: number;
    cash: number;
    totalCash: number;
    buyingPower: number;
    netLiquidation: number;
  };
  updatedAt: Date | string;
};

type ShadowAccountPositionWeightRow = Record<string, unknown> & {
  marketValue?: unknown;
  weightPercent?: number | null;
  accountWeightPercent?: number | null;
  scopedWeightPercent?: number | null;
};

function applyShadowAccountPositionWeights<T extends ShadowAccountPositionWeightRow>(
  rows: readonly T[],
  input: {
    accountNetLiquidation: number | null;
    scopedNetLiquidation: number | null;
  },
): Array<
  T & {
    weightPercent: number | null;
    accountWeightPercent: number | null;
    scopedWeightPercent: number | null;
  }
> {
  return rows.map((row) => {
    const marketValue = toNumber(row.marketValue) ?? 0;
    const scopedWeightPercent = weightPercent(
      marketValue,
      input.scopedNetLiquidation,
    );
    return {
      ...row,
      weightPercent: scopedWeightPercent,
      accountWeightPercent: weightPercent(
        marketValue,
        input.accountNetLiquidation,
      ),
      scopedWeightPercent,
    };
  });
}

function shadowPositionsReadCacheKey(input: {
  assetClassFilter: ShadowPositionTypeFilter;
  source: ShadowSourceScope | null;
  includeLiveQuotes: boolean;
}): string {
  const quoteMode = input.includeLiveQuotes ? "live-quotes" : "cached-quotes";
  return `positions:${input.assetClassFilter || "all"}:${shadowSourceCacheKey(
    input.source,
  )}:${quoteMode}`;
}

function isShadowAccountPositionsResponseShape(
  value: unknown,
): value is ShadowAccountPositionsResponseShape {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as { positions?: unknown }).positions) &&
      (value as { positions: unknown[] }).positions.every(
        (position) =>
          position &&
          typeof position === "object" &&
          typeof (position as { id?: unknown }).id === "string" &&
          typeof (position as { symbol?: unknown }).symbol === "string" &&
          typeof (position as { assetClass?: unknown }).assetClass === "string",
      ) &&
      (value as { totals?: unknown }).totals &&
      typeof (value as { totals?: unknown }).totals === "object",
  );
}

function filterShadowAccountPositionsResponseForAssetClass(
  response: ShadowAccountPositionsResponseShape,
  assetClassFilter: Exclude<ShadowPositionTypeFilter, "all" | null>,
): ShadowAccountPositionsResponseShape {
  const rows = response.positions.filter((position) =>
    shadowPositionMatchesAssetClass(
      {
        symbol: position.symbol,
        assetClass: position.assetClass,
        positionType: (position as { positionType?: string | null }).positionType,
        optionContract: (position as { optionContract?: unknown }).optionContract,
      },
      assetClassFilter,
    ),
  );
  const cash = toNumber(response.totals.cash) ?? 0;
  const accountNetLiquidation =
    toNumber(response.totals.netLiquidation) ?? null;
  const responseMarketValue = rows.reduce(
    (sum, row) => sum + (toNumber(row.marketValue) ?? 0),
    0,
  );
  const responseNetLiquidation = cash + responseMarketValue;
  const weightedRows = applyShadowAccountPositionWeights(rows, {
    accountNetLiquidation,
    scopedNetLiquidation: responseNetLiquidation,
  });

  return {
    ...response,
    positions: weightedRows,
    totals: {
      ...response.totals,
      weightPercent: weightedRows.reduce(
        (sum, row) => sum + (toNumber(row.weightPercent) ?? 0),
        0,
      ),
      unrealizedPnl: weightedRows.reduce(
        (sum, row) => sum + (toNumber(row.unrealizedPnl) ?? 0),
        0,
      ),
      grossLong: responseMarketValue,
      grossShort: 0,
      netExposure: responseMarketValue,
      cash,
      totalCash: cash,
      buyingPower: Math.max(0, cash),
      netLiquidation: responseNetLiquidation,
    },
  };
}

function readReusableShadowPositionsResponseForAssetClass(input: {
  assetClassFilter: ShadowPositionTypeFilter;
  source: ShadowSourceScope | null;
  includeLiveQuotes: boolean;
}): ShadowAccountPositionsResponseShape | null {
  if (!input.assetClassFilter || input.assetClassFilter === "all") {
    return null;
  }

  const now = Date.now();
  const cached = shadowReadCache.get(
    shadowPositionsReadCacheKey({
      assetClassFilter: "all",
      source: input.source,
      includeLiveQuotes: input.includeLiveQuotes,
    }),
  );
  if (!cached || cached.staleExpiresAt <= now) {
    return null;
  }
  const cacheIsFresh = cached.expiresAt > now;
  if (!cacheIsFresh) {
    const pressureLevel = getApiResourcePressureSnapshot().resourceLevel;
    if (pressureLevel !== "high") {
      return null;
    }
  }
  if (!isShadowAccountPositionsResponseShape(cached.value)) {
    return null;
  }

  const baseResponse = cacheIsFresh
    ? cached.value
    : markShadowReadValueStale(cached.value, {
        cachedAt: cached.cachedAt,
        now,
      });
  recordShadowReadDiagnostic({
    key: shadowPositionsReadCacheKey({
      assetClassFilter: input.assetClassFilter,
      source: input.source,
      includeLiveQuotes: input.includeLiveQuotes,
    }),
    status: "cache_hit",
    startedAt: now,
    servedStale: !cacheIsFresh,
    cacheAgeMs: now - cached.cachedAt,
  });
  return filterShadowAccountPositionsResponseForAssetClass(
    baseResponse,
    input.assetClassFilter,
  );
}

function readReusableLiveQuotedShadowPositionsResponse(input: {
  assetClassFilter: ShadowPositionTypeFilter;
  source: ShadowSourceScope | null;
  includeLiveQuotes: boolean;
}): ShadowAccountPositionsResponseShape | null {
  if (input.includeLiveQuotes) {
    return null;
  }

  const now = Date.now();
  const cached = shadowReadCache.get(
    shadowPositionsReadCacheKey({
      assetClassFilter: input.assetClassFilter ?? "all",
      source: input.source,
      includeLiveQuotes: true,
    }),
  );
  if (!cached || cached.staleExpiresAt <= now) {
    return null;
  }
  const cacheIsFresh = cached.expiresAt > now;
  if (!cacheIsFresh) {
    const pressureLevel = getApiResourcePressureSnapshot().resourceLevel;
    if (pressureLevel !== "high") {
      return null;
    }
  }
  if (!isShadowAccountPositionsResponseShape(cached.value)) {
    return null;
  }

  const baseResponse = cacheIsFresh
    ? cached.value
    : markShadowReadValueStale(cached.value, {
        cachedAt: cached.cachedAt,
        now,
      });
  recordShadowReadDiagnostic({
    key: shadowPositionsReadCacheKey({
      assetClassFilter: input.assetClassFilter ?? "all",
      source: input.source,
      includeLiveQuotes: false,
    }),
    status: "cache_hit",
    startedAt: now,
    servedStale: !cacheIsFresh,
    cacheAgeMs: now - cached.cachedAt,
  });

  if (input.assetClassFilter && input.assetClassFilter !== "all") {
    return filterShadowAccountPositionsResponseForAssetClass(
      baseResponse,
      input.assetClassFilter,
    );
  }
  return baseResponse;
}

function readReusableShadowAllocationFromPositions(input: {
  source: ShadowSourceScope | null;
}) {
  const now = Date.now();
  const allocationKey = `allocation:${shadowSourceCacheKey(input.source)}`;
  for (const includeLiveQuotes of [true, false]) {
    const cached = shadowReadCache.get(
      shadowPositionsReadCacheKey({
        assetClassFilter: "all",
        source: input.source,
        includeLiveQuotes,
      }),
    );
    if (!cached || cached.staleExpiresAt <= now) {
      continue;
    }
    const cacheIsFresh = cached.expiresAt > now;
    if (!cacheIsFresh && getApiResourcePressureSnapshot().resourceLevel !== "high") {
      continue;
    }
    if (!isShadowAccountPositionsResponseShape(cached.value)) {
      continue;
    }
    const positionsResponse = cacheIsFresh
      ? cached.value
      : markShadowReadValueStale(cached.value, {
          cachedAt: cached.cachedAt,
          now,
        });
    recordShadowReadDiagnostic({
      key: allocationKey,
      status: "cache_hit",
      startedAt: now,
      servedStale: !cacheIsFresh,
      cacheAgeMs: now - cached.cachedAt,
    });
    return getShadowAccountAllocationFromPositions({ positionsResponse });
  }
  return null;
}

function shouldServeFastShadowPositionsForPressure(): boolean {
  // Gate the heavy canonical shadow build on genuine server SATURATION only.
  // `level` folds in request latency (inflated by slow broker routes) and trips
  // to `watch` on a borderline event-loop (e.g. 61ms vs the 60ms watch line), so
  // gating on `level !== "normal"` served the degraded fast-fallback almost
  // constantly — blanking SL/TRL and starving the canonical path that computes
  // them. Per ApiResourcePressureSnapshot's contract, real work gates on
  // `resourceLevel` (rss+heap+event-loop, NOT latency); only shed under `high`.
  return getApiResourcePressureSnapshot().resourceLevel === "high";
}

// Last-known canonical SL/TRL per shadow position id. The pressure fast-fallback
// (served when resource pressure != normal) skips the heavy automation-context
// build and would otherwise blank stopLoss/takeProfit/riskOverlay. Instead it
// serves the most recent good canonical value recorded here (the response is
// still flagged degraded/stale). Bounded to LAST_KNOWN_SHADOW_STOPS_CAP entries.
const LAST_KNOWN_SHADOW_STOPS_CAP = 1000;
const lastKnownShadowPositionStops = new Map<
  string,
  {
    stopLoss: number | null;
    takeProfit: number | null;
    riskOverlay: ReturnType<typeof buildShadowPositionRiskOverlay>;
  }
>();

function recordLastKnownShadowPositionStops(
  positionId: string,
  value: {
    stopLoss: number | null;
    takeProfit: number | null;
    riskOverlay: ReturnType<typeof buildShadowPositionRiskOverlay>;
  },
): void {
  if (
    lastKnownShadowPositionStops.size >= LAST_KNOWN_SHADOW_STOPS_CAP &&
    !lastKnownShadowPositionStops.has(positionId)
  ) {
    const oldest = lastKnownShadowPositionStops.keys().next().value;
    if (oldest) {
      lastKnownShadowPositionStops.delete(oldest);
    }
  }
  lastKnownShadowPositionStops.set(positionId, value);
}

// Last-known canonical day change per shadow position id. Same rationale as the stops
// cache: the pressure fast-fallback skips the heavy canonical build and would otherwise
// blank dayChange/dayChangePercent (rendering $0 in the positions table). Instead it
// serves the most recent good canonical value recorded by the full path, decoupling the
// day-change display from resource pressure. Bounded to LAST_KNOWN_SHADOW_STOPS_CAP.
const lastKnownShadowPositionDayChange = new Map<string, ShadowPositionDayChange>();

function recordLastKnownShadowPositionDayChange(
  positionId: string,
  value: ShadowPositionDayChange,
): void {
  if (value.dayChange == null && value.dayChangePercent == null) {
    return;
  }
  if (
    lastKnownShadowPositionDayChange.size >= LAST_KNOWN_SHADOW_STOPS_CAP &&
    !lastKnownShadowPositionDayChange.has(positionId)
  ) {
    const oldest = lastKnownShadowPositionDayChange.keys().next().value;
    if (oldest) {
      lastKnownShadowPositionDayChange.delete(oldest);
    }
  }
  lastKnownShadowPositionDayChange.set(positionId, value);
}

function buildFastShadowPositionsResponseFromRows(input: {
  positions: ShadowPositionRow[];
  account: ShadowAccountRow | null;
  assetClassFilter: ShadowPositionTypeFilter;
  source: ShadowSourceScope | null;
  observedAt?: Date;
  dayChangesByPositionId?: Map<string, ShadowPositionDayChange> | null;
}): ShadowAccountPositionsResponseShape {
  const observedAt = input.observedAt ?? new Date();
  const sourceFiltered = input.positions.filter((position) =>
    input.source
      ? positionMatchesShadowSource(position, input.source)
      : isDefaultShadowLedgerAnalyticsPosition(position),
  );
  const filtered =
    input.assetClassFilter && input.assetClassFilter !== "all"
      ? sourceFiltered.filter((position) =>
          shadowPositionMatchesAssetClass(position, input.assetClassFilter),
        )
      : sourceFiltered;
  const accountCash =
    toNumber(input.account?.cash) ??
    toNumber(input.account?.startingBalance) ??
    SHADOW_STARTING_BALANCE;
  const rows = filtered.map((position) => {
    const quantity = toNumber(position.quantity) ?? 0;
    const averageCost = toNumber(position.averageCost) ?? 0;
    const contract = asOptionContract(position.optionContract);
    const multiplier = marketMultiplier({
      assetClass: position.assetClass as ShadowAssetClass,
      optionContract: contract,
    });
    const storedMark = toNumber(position.mark);
    const mark = storedMark ?? averageCost;
    const marketValue =
      toNumber(position.marketValue) ??
      (Number.isFinite(quantity) &&
      Number.isFinite(mark) &&
      Number.isFinite(multiplier)
        ? quantity * mark * multiplier
        : 0);
    const unrealizedPnl =
      toNumber(position.unrealizedPnl) ??
      (Number.isFinite(mark) &&
      Number.isFinite(averageCost) &&
      Number.isFinite(quantity) &&
      Number.isFinite(multiplier)
        ? (mark - averageCost) * quantity * multiplier
        : 0);
    const openedAt = position.openedAt ?? position.asOf ?? observedAt;
    const positionType = shadowPositionType(position);
    const lastKnownStops = lastKnownShadowPositionStops.get(position.id);
    // Decouple day change from resource pressure: prefer the freshly-computed baseline
    // day change, else the last canonical value, so the fast-fallback doesn't blank it to
    // $0 (see recordLastKnownShadowPositionDayChange).
    const freshDayChange = input.dayChangesByPositionId?.get(position.id) ?? null;
    if (freshDayChange) {
      recordLastKnownShadowPositionDayChange(position.id, freshDayChange);
    }
    const lastKnownDayChange =
      freshDayChange ?? lastKnownShadowPositionDayChange.get(position.id) ?? null;

    return {
      id: position.id,
      accountId: SHADOW_ACCOUNT_ID,
      accounts: [SHADOW_ACCOUNT_ID],
      symbol: position.symbol,
      marketDataSymbol: shadowPositionMarketDataSymbol(position),
      description: positionDescription(position),
      assetClass: assetClassLabel(position),
      positionType,
      optionContract: optionPayload(contract),
      underlyingMarket: null,
      sector: "Shadow Holdings",
      quantity,
      averageCost,
      mark,
      dayChange: lastKnownDayChange?.dayChange ?? null,
      dayChangePercent: lastKnownDayChange?.dayChangePercent ?? null,
      unrealizedPnl,
      unrealizedPnlPercent: averageCost
        ? ((mark - averageCost) / averageCost) * 100
        : null,
      marketValue,
      weightPercent: null,
      accountWeightPercent: null,
      scopedWeightPercent: null,
      betaWeightedDelta: null,
      lots: [
        {
          accountId: SHADOW_ACCOUNT_ID,
          symbol: position.symbol,
          quantity,
          averageCost,
          marketPrice: mark,
          marketValue,
          unrealizedPnl,
          asOf: position.asOf,
          source: "SHADOW_LEDGER",
        },
      ],
      openOrders: [],
      source: "SHADOW_LEDGER",
      openedAt,
      openedAtSource: "shadow_position",
      pricingPolicy: "shadow_pressure_fallback",
      valuationEligible: false,
      valuationSource: "shadow_ledger",
      valuationReason: "shadow_positions_pressure_fallback",
      quote: null,
      optionQuote: null,
      // Pressure fast-fallback: serve the last-known canonical stop/trail
      // (still flagged degraded/stale on the response) instead of blanking.
      stopLoss: lastKnownStops?.stopLoss ?? null,
      takeProfit: lastKnownStops?.takeProfit ?? null,
      riskOverlay: lastKnownStops?.riskOverlay ?? null,
    };
  });
  const responseMarketValue = rows.reduce(
    (sum, row) => sum + (toNumber(row.marketValue) ?? 0),
    0,
  );
  const responseNetLiquidation = accountCash + responseMarketValue;
  const weightedRows = applyShadowAccountPositionWeights(rows, {
    accountNetLiquidation: responseNetLiquidation,
    scopedNetLiquidation: responseNetLiquidation,
  });

  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    degraded: true,
    stale: true,
    reason: "shadow_positions_pressure_fallback",
    positions: weightedRows,
    totals: {
      weightPercent: weightedRows.reduce(
        (sum, row) => sum + (toNumber(row.weightPercent) ?? 0),
        0,
      ),
      unrealizedPnl: weightedRows.reduce(
        (sum, row) => sum + row.unrealizedPnl,
        0,
      ),
      grossLong: responseMarketValue,
      grossShort: 0,
      netExposure: responseMarketValue,
      cash: accountCash,
      totalCash: accountCash,
      buyingPower: Math.max(0, accountCash),
      netLiquidation: responseNetLiquidation,
    },
    updatedAt: observedAt,
  };
}

async function buildFastShadowPositionsResponse(input: {
  assetClassFilter: ShadowPositionTypeFilter;
  source: ShadowSourceScope | null;
}): Promise<ShadowAccountPositionsResponseShape> {
  return withShadowReadCache(
    `positions-fast:${input.assetClassFilter || "all"}:${shadowSourceCacheKey(
      input.source,
    )}`,
    async () => {
      const [account, positions] = await Promise.all([
        readShadowAccount(),
        readOpenShadowPositions(),
      ]);
      // Decouple day change from resource pressure without deepening it: serve the
      // last-known cache for free, and only run the (baseline-marks-only, no option-quote
      // fetch) day-change query to bootstrap positions not yet in the cache. Once warm,
      // this adds zero DB load under pressure. Failures fall back to the cache.
      const needsDayChangeBootstrap = positions.some(
        (position) => !lastKnownShadowPositionDayChange.has(position.id),
      );
      const dayChangesByPositionId = needsDayChangeBootstrap
        ? await readShadowPositionDayChanges(positions, new Date(), null, {
            fetchMissingOptionQuotes: false,
          }).catch(() => null)
        : null;
      return buildFastShadowPositionsResponseFromRows({
        account,
        positions,
        assetClassFilter: input.assetClassFilter,
        source: input.source,
        dayChangesByPositionId,
      });
    },
    {
      allowStale: isShadowAccountPositionsResponseShape,
      staleStrategy: "immediate",
      ttlMs: 2_500,
      staleTtlMs: 30_000,
    },
  );
}

export async function getShadowAccountPositions(input: {
  assetClass?: string | null;
  source?: string | null;
  liveQuotes?: boolean;
}): Promise<ShadowAccountPositionsResponseShape> {
  const source = normalizeShadowSourceScope(input.source);
  const assetClassFilter = normalizePositionAssetClass(input.assetClass);
  const includeLiveQuotes = input.liveQuotes !== false;
  const reusableLiveQuoted = readReusableLiveQuotedShadowPositionsResponse({
    assetClassFilter,
    source,
    includeLiveQuotes,
  });
  if (reusableLiveQuoted) {
    return reusableLiveQuoted;
  }
  const reusableFiltered = readReusableShadowPositionsResponseForAssetClass({
    assetClassFilter,
    source,
    includeLiveQuotes,
  });
  if (reusableFiltered) {
    return reusableFiltered;
  }
  const cacheKey = shadowPositionsReadCacheKey({
    assetClassFilter,
    source,
    includeLiveQuotes,
  });
  const readFullPositions = async () => {
      kickSignalOptionsAutomationMirrorRepairForRead(source);
      try {
        void kickShadowPositionMarkRefresh();
        const ledgerBundle = await readShadowLedgerBundleForSource(source);
        const totals = ledgerBundle.totals;
        const accountTotals = source
          ? (await readShadowLedgerBundleForSource(null)).totals
          : totals;
        clearShadowAccountDbBackoff();
        const orders = (source
          ? ledgerBundle.selectedOrders
          : Array.from(ledgerBundle.ordersById.values()))
          .sort((left, right) => right.placedAt.getTime() - left.placedAt.getTime())
          .slice(0, 1000);
        const positions = ledgerBundle.positions;
        const filtered =
          assetClassFilter && assetClassFilter !== "all"
            ? positions.filter((position) =>
                shadowPositionMatchesAssetClass(position, assetClassFilter),
              )
            : positions;
        const ordersByPositionKey = shadowOrdersByPositionKey(orders);
        const automationManagementEvents =
          await latestShadowAutomationManagementEvents(
            filtered,
            ordersByPositionKey,
          );
        const cachedOptionQuotes = readCachedShadowOptionQuotes(filtered);
        const hasOptionPositions = filtered.some(
          (position) =>
            position.assetClass === "option" &&
            Boolean(asOptionContract(position.optionContract)),
        );
        const positionQuoteOwnerPrefix = `shadow-position:${shadowSourceCacheKey(source)}`;
        if (hasOptionPositions && includeLiveQuotes) {
          declareShadowPositionOptionQuoteDemands(filtered, {
            intent: "visible-live",
            ownerPrefix: `${positionQuoteOwnerPrefix}:option-visible`,
            requiresGreeks: true,
          });
        }
        const [equityQuoteBySymbol, underlyingMarkets] = includeLiveQuotes
          ? await Promise.all([
              fetchShadowEquityPositionQuotes(filtered, {
                owner: `${positionQuoteOwnerPrefix}:equity-visible`,
              }),
              fetchShadowOptionUnderlyingMarkets(filtered),
            ])
          : [
              new Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>(),
              new Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>(),
            ];
        const optionQuoteByProviderContractId = new Map(cachedOptionQuotes);
        const observedAt = new Date();
        // Fetch visible option quotes (batched per underlying) before computing
        // day changes so day-change values reuse those quotes instead of firing
        // a second, per-position missing-quote fetch in the same request. See
        // session 019e8366: the second fetch was the cold-read latency/pressure
        // root cause; cached quotes, visible quotes, and ledger marks already
        // give a valid degraded response.
        if (includeLiveQuotes) {
          readCachedShadowOptionQuotes(filtered).forEach(
            (quote, providerContractId) => {
              optionQuoteByProviderContractId.set(providerContractId, quote);
            },
          );
          if (hasOptionPositions) {
            const visibleOptionQuotes = await fetchVisibleShadowOptionQuotes(
              filtered,
              {
                intent: "visible-live",
                ownerPrefix: `${positionQuoteOwnerPrefix}:option-visible`,
                requiresGreeks: true,
              },
            );
            visibleOptionQuotes.forEach((quote, providerContractId) => {
              optionQuoteByProviderContractId.set(providerContractId, quote);
            });
          }
          readCachedShadowOptionQuotes(filtered, { allowStale: true }).forEach(
            (quote, providerContractId) => {
              const current = optionQuoteByProviderContractId.get(providerContractId);
              if (shadowOptionQuoteHasDisplayMarketData(current)) {
                return;
              }
              if (shadowOptionQuoteHasDisplayMarketData(quote)) {
                optionQuoteByProviderContractId.set(providerContractId, quote);
              }
            },
          );
        }
        const dayChanges = await readShadowPositionDayChanges(
          filtered,
          observedAt,
          optionQuoteByProviderContractId,
          {
            fetchMissingOptionQuotes: false,
            fetchOptionQuoteOptions: includeLiveQuotes
              ? {
                  intent: "visible-live",
                  ownerPrefix: `${positionQuoteOwnerPrefix}:option-visible`,
                }
              : undefined,
          },
        );
        const peakMarkByPositionId =
          await readShadowPositionPeakMarkPrices(filtered);
        const rows = filtered.map((position) => {
          const quantity = toNumber(position.quantity) ?? 0;
          const averageCost = toNumber(position.averageCost) ?? 0;
          const contract = asOptionContract(position.optionContract);
          const symbolKey = normalizeSymbol(position.symbol).toUpperCase();
          const rawEquityQuote = contract
            ? null
            : equityQuoteBySymbol.get(symbolKey) ?? null;
          const equityQuote =
            shadowQuoteText(rawEquityQuote, "source") === "massive"
              ? rawEquityQuote
              : null;
          const underlyingSymbol = normalizeSymbol(
            String(contract?.underlying ?? position.symbol),
          ).toUpperCase();
          const multiplier = marketMultiplier({
            assetClass: position.assetClass as ShadowAssetClass,
            optionContract: contract,
          });
          const quoteIdentifier = shadowOptionQuoteIdentifier(contract);
          const rawOptionQuote = quoteIdentifier
            ? optionQuoteByProviderContractId.get(quoteIdentifier)
            : null;
          const fallbackProviderContractId =
            contract && !isPriorOptionExpiration(contract)
              ? shadowOptionProviderContractIdForContract(contract)
              : null;
          const responseProviderContractId =
            shadowOptionQuoteProviderContractId(rawOptionQuote, quoteIdentifier) ??
            fallbackProviderContractId;
          const optionTradingSessionOpen =
            !contract || isShadowOptionTradingSession(observedAt, contract);
          const valuationOptionQuote =
            responseProviderContractId &&
            rawOptionQuote &&
            optionTradingSessionOpen
              ? rawOptionQuote
              : null;
          const pricing = buildShadowOptionPricingPolicy({
            quote: contract ? valuationOptionQuote : equityQuote,
            fallbackMark: toNumber(position.mark) ?? 0,
            fallbackSource: "shadow_ledger",
            quoteSource: contract ? "option_quote" : "massive",
            requireTwoSidedQuote: contract ? undefined : false,
          });
          const mark = pricing.valuationMark ?? toNumber(position.mark) ?? 0;
          const automationContext = buildShadowAutomationContext({
            position,
            sourceOrder: ordersByPositionKey.get(position.positionKey),
            latestEvent: automationManagementEvents.get(position.positionKey),
            peakMarkPrice: peakMarkByPositionId.get(position.id) ?? null,
          });
          const displayOptionQuote =
            responseProviderContractId &&
            rawOptionQuote &&
            shadowOptionQuoteHasDisplayMarketData(rawOptionQuote)
              ? rawOptionQuote
              : null;
          const displayOptionQuoteSource = displayOptionQuote
            ? "option_quote"
            : "shadow_ledger";
          const marketValue =
            Number.isFinite(mark) &&
            Number.isFinite(quantity) &&
            Number.isFinite(multiplier)
              ? quantity * mark * multiplier
              : toNumber(position.marketValue) ?? 0;
          const unrealizedPnl =
            Number.isFinite(mark) &&
            Number.isFinite(averageCost) &&
            Number.isFinite(quantity) &&
            Number.isFinite(multiplier)
              ? (mark - averageCost) * quantity * multiplier
              : toNumber(position.unrealizedPnl) ?? 0;
          const displayDayChangeQuote = contract
            ? valuationOptionQuote
            : equityQuote;
          const quoteDayChange =
            displayDayChangeQuote && pricing.valuationEligible
              ? buildShadowPositionDayChangeFromQuote({
                  quantity,
                  multiplier,
                  quote: displayDayChangeQuote,
                })
              : null;
          const storedDayChange = dayChanges.get(position.id) ?? {
            dayChange: null,
            dayChangePercent: null,
          };
          const openedAt = position.openedAt ?? position.asOf;
          const dayStart = shadowPositionDayChangeDayStart(position, observedAt);
          const sameDayPosition =
            openedAt instanceof Date &&
            openedAt.getTime() >= dayStart.getTime();
          const hasFiniteValuationMark =
            Number.isFinite(mark) && Number.isFinite(averageCost);
          const valuationDayChange =
            sameDayPosition && hasFiniteValuationMark
              ? {
                  dayChange: unrealizedPnl,
                  dayChangePercent: averageCost
                    ? ((mark - averageCost) / Math.abs(averageCost)) * 100
                    : null,
                }
              : quoteDayChange;
          const dayChange = selectShadowPositionDayChange({
            sameDayPosition,
            valuationEligible: pricing.valuationEligible,
            valuationDayChange,
            storedDayChange,
            quoteDayChange,
          });
          // Cache the canonical day change so the pressure fast-fallback can serve it
          // instead of blanking day change to $0 under load.
          recordLastKnownShadowPositionDayChange(position.id, dayChange);
          const attribution = buildPositionSourceAttribution(position, orders);
          const optionQuoteSnapshot =
            displayOptionQuote && responseProviderContractId
              ? shadowQuoteSnapshotFromOptionRecord({
                  symbol: position.symbol,
                  providerContractId: responseProviderContractId,
                  quote: displayOptionQuote,
                })
              : null;
          const positionQuoteSnapshot =
            optionQuoteSnapshot ?? (equityQuote as QuoteSnapshot | null);
          const rawPositionQuote = buildPositionQuoteFromSnapshot(
            positionQuoteSnapshot,
            mark,
            optionQuoteSnapshot
              ? "option_quote"
              : equityQuote
                ? "massive"
                : "shadow_ledger",
          );
          const optionQuoteHasTwoSidedQuote =
            optionQuoteSnapshot?.bid != null && optionQuoteSnapshot.ask != null;
          const marketPositionQuote =
            rawPositionQuote && optionQuoteSnapshot && !optionQuoteHasTwoSidedQuote
              ? {
                  ...rawPositionQuote,
                  bid: null,
                  ask: null,
                  mid: null,
                  spread: null,
                  spreadPercent: null,
                  bidSize: null,
                  askSize: null,
                  mark,
                }
              : rawPositionQuote;
          const positionQuote =
            marketPositionQuote && !pricing.valuationEligible
              ? {
                  ...marketPositionQuote,
                  mark,
                  spreadPercent:
                    marketPositionQuote.spread != null && mark > 0
                      ? (marketPositionQuote.spread / mark) * 100
                      : marketPositionQuote.spreadPercent,
                }
              : marketPositionQuote;
          const positionType = shadowPositionType(position);
          const optionUnderlyingQuote = contract
            ? shadowUnderlyingQuoteFromOptionQuote(
                underlyingSymbol,
                displayOptionQuote,
              )
            : null;
          const riskOverlay = buildShadowPositionRiskOverlay({
            automationContext,
            openedAt,
          });
          const stopLoss =
            riskOverlay?.activeStopPrice ??
            automationContext?.activeStopPrice ??
            automationContext?.stopPrice ??
            automationContext?.stopLossPrice ??
            null;
          const takeProfit =
            automationContext?.takeProfitPrice ??
            automationContext?.targetPrice ??
            null;
          recordLastKnownShadowPositionStops(position.id, {
            stopLoss,
            takeProfit,
            riskOverlay,
          });
          return {
            id: position.id,
            accountId: SHADOW_ACCOUNT_ID,
            accounts: [SHADOW_ACCOUNT_ID],
            symbol: position.symbol,
            marketDataSymbol: shadowPositionMarketDataSymbol(position),
            description: positionDescription(position),
            assetClass: assetClassLabel(position),
            positionType,
            optionContract: optionPayload(
              asOptionContract(position.optionContract),
              responseProviderContractId,
            ),
            underlyingMarket: contract
              ? shadowUnderlyingMarketPayload({
                  symbol: underlyingSymbol,
                  // Merge (don't replace): the option quote's embedded underlying price is
                  // fresher, but it is price-only — keep the full Massive underlying quote's
                  // previousClose/changePercent so the Spot day-change % isn't dropped.
                  quote: {
                    ...underlyingMarkets.get(underlyingSymbol),
                    ...optionUnderlyingQuote,
                  },
                })
              : null,
            sector: "Shadow Holdings",
            quantity,
            averageCost,
            mark,
            dayChange: dayChange.dayChange,
            dayChangePercent: dayChange.dayChangePercent,
            unrealizedPnl,
            unrealizedPnlPercent: averageCost
              ? ((mark - averageCost) / averageCost) * 100
              : null,
            marketValue,
            weightPercent: weightPercent(marketValue, totals.netLiquidation),
            betaWeightedDelta: null,
            lots: [
              {
                accountId: SHADOW_ACCOUNT_ID,
                symbol: position.symbol,
                quantity,
                averageCost,
                marketPrice: mark,
                marketValue,
                unrealizedPnl,
                asOf: position.asOf,
                source: "SHADOW_LEDGER",
              },
            ],
            openOrders: [],
            source: "SHADOW_LEDGER",
            openedAt,
            openedAtSource: "shadow_position",
            pricingPolicy: "shadow_canonical",
            valuationEligible: pricing.valuationEligible,
            valuationSource: pricing.valuationSource,
            valuationReason: pricing.valuationReason,
            quote: positionQuote,
            optionQuote:
              displayOptionQuote && responseProviderContractId
                ? shadowOptionQuotePayload({
                    symbol: position.symbol,
                    providerContractId: responseProviderContractId,
                    quote: displayOptionQuote,
                    fallbackMark: mark,
                    source: displayOptionQuoteSource,
                    pricing,
                  })
                : null,
            stopLoss,
            takeProfit,
            riskOverlay,
            ...(automationContext ? { automationContext } : {}),
            ...attribution,
          };
        });

        const responseMarketValue = rows.reduce(
          (sum, row) => sum + (toNumber(row.marketValue) ?? 0),
          0,
        );
        const responseNetLiquidation = totals.cash + responseMarketValue;
        const weightedRows = applyShadowAccountPositionWeights(rows, {
          accountNetLiquidation: accountTotals.netLiquidation,
          scopedNetLiquidation: responseNetLiquidation,
        });

        return {
          accountId: SHADOW_ACCOUNT_ID,
          currency: SHADOW_CURRENCY,
          degraded: false,
          reason: null,
          positions: weightedRows,
          totals: {
            weightPercent: weightedRows.reduce(
              (sum, row) => sum + (row.weightPercent ?? 0),
              0,
            ),
            unrealizedPnl: weightedRows.reduce(
              (sum, row) => sum + row.unrealizedPnl,
              0,
            ),
            grossLong: responseMarketValue,
            grossShort: 0,
            netExposure: responseMarketValue,
            cash: totals.cash,
            totalCash: totals.cash,
            buyingPower: Math.max(0, totals.cash),
            netLiquidation: responseNetLiquidation,
          },
          updatedAt: totals.updatedAt,
        };
      } catch (error) {
        if (isTransientPostgresError(error)) {
          markShadowAccountDbUnavailable(error);
          return buildEmptyShadowAccountPositionsResponse({
            totals: buildFallbackShadowTotals(),
            degraded: true,
          });
        }
        throw error;
      }
    };
  const cacheOptions = {
    allowStale: shadowReadCacheValueHasRows,
    staleStrategy: "immediate" as const,
    ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
  };
  if (shouldServeFastShadowPositionsForPressure()) {
    return buildFastShadowPositionsResponse({
      assetClassFilter,
      source,
    });
  }
  return withShadowReadCache(
    cacheKey,
    readFullPositions,
    cacheOptions,
  );
}

function dateFromShadowPositionResponse(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

async function shadowStartingBalanceForFastSummary(): Promise<number> {
  try {
    const account = await readShadowAccount();
    return toNumber(account?.startingBalance) ?? SHADOW_STARTING_BALANCE;
  } catch (error) {
    logger.debug?.(
      { err: error },
      "Shadow account starting balance unavailable for fast summary",
    );
    return SHADOW_STARTING_BALANCE;
  }
}

function shadowTotalsFromPositionsResponse(input: {
  positionsResponse: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  startingBalance: number;
}): ShadowTotals {
  const totals = input.positionsResponse.totals;
  const marketValue =
    toNumber(totals.netExposure) ??
    toNumber(totals.grossLong) ??
    input.positionsResponse.positions.reduce(
      (sum, position) => sum + (toNumber(position.marketValue) ?? 0),
      0,
    );
  const cash = toNumber(totals.cash) ?? 0;
  const netLiquidation = toNumber(totals.netLiquidation) ?? cash + marketValue;
  const unrealizedPnl =
    toNumber(totals.unrealizedPnl) ??
    input.positionsResponse.positions.reduce(
      (sum, position) => sum + (toNumber(position.unrealizedPnl) ?? 0),
      0,
    );
  const realizedPnl = netLiquidation - input.startingBalance - unrealizedPnl;
  return {
    cash,
    startingBalance: input.startingBalance,
    realizedPnl,
    unrealizedPnl,
    fees: 0,
    marketValue,
    netLiquidation,
    updatedAt: dateFromShadowPositionResponse(input.positionsResponse.updatedAt),
  };
}

function readFreshCachedShadowEquityHistoryReturnMetrics(input: {
  source?: string | null;
}): ShadowAccountSummaryReturnMetrics | undefined {
  const source = normalizeShadowSourceScope(input.source);
  const cacheKey = `equity-history:1D::${shadowSourceCacheKey(source)}`;
  const cached = shadowReadCache.get(cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    return undefined;
  }
  const history = cached.value as Partial<ShadowAccountEquityHistory>;
  if (!Array.isArray(history.points)) {
    return undefined;
  }
  const dayPnl = calculateLatestShadowMarketDayPnlFromHistory(history.points);
  return {
    dayPnl: dayPnl?.value ?? null,
    dayPnlField: dayPnl
      ? `EquityHistoryMarketDayPnl:${dayPnl.marketDate}`
      : "EquityHistoryMarketDayPnl",
    dayPnlCapitalBase: dayPnl?.capitalBase ?? null,
  };
}

export async function getShadowAccountSummaryFromPositions(input: {
  positionsResponse: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  source?: string | null;
}) {
  const startingBalance = await shadowStartingBalanceForFastSummary();
  return buildShadowAccountSummaryResponse({
    totals: shadowTotalsFromPositionsResponse({
      positionsResponse: input.positionsResponse,
      startingBalance,
    }),
    returnMetrics: readFreshCachedShadowEquityHistoryReturnMetrics({
      source: input.source,
    }),
    degraded: Boolean(input.positionsResponse.degraded),
  });
}

function shadowResponseAssetClassLabel(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "Other";
  }
  if (raw.toLowerCase() === "stock" || raw.toLowerCase() === "stocks") {
    return "Stocks";
  }
  if (raw.toLowerCase() === "option" || raw.toLowerCase() === "options") {
    return "Options";
  }
  return raw;
}

export function getShadowAccountAllocationFromPositions(input: {
  positionsResponse: Awaited<ReturnType<typeof getShadowAccountPositions>>;
}) {
  const { positionsResponse } = input;
  const totals = positionsResponse.totals;
  const cash = toNumber(totals.cash) ?? 0;
  const netLiquidation =
    toNumber(totals.netLiquidation) ??
    cash + (toNumber(totals.netExposure) ?? toNumber(totals.grossLong) ?? 0);
  const marketValue =
    toNumber(totals.netExposure) ??
    toNumber(totals.grossLong) ??
    positionsResponse.positions.reduce(
      (sum, position) => sum + (toNumber(position.marketValue) ?? 0),
      0,
    );
  const assetBuckets = new Map<string, number>();
  const sectorBuckets = new Map<string, number>();
  positionsResponse.positions.forEach((position) => {
    const value = toNumber(position.marketValue) ?? 0;
    const assetClass = shadowResponseAssetClassLabel(position.assetClass);
    const sector =
      typeof position.sector === "string" && position.sector.trim()
        ? position.sector.trim()
        : "Shadow Holdings";
    assetBuckets.set(assetClass, (assetBuckets.get(assetClass) ?? 0) + value);
    sectorBuckets.set(sector, (sectorBuckets.get(sector) ?? 0) + value);
  });
  assetBuckets.set("Cash", (assetBuckets.get("Cash") ?? 0) + cash);

  const bucketRows = (buckets: Map<string, number>) =>
    Array.from(buckets.entries())
      .map(([label, value]) => ({
        label,
        value,
        weightPercent: weightPercent(value, netLiquidation),
        source: label === "Cash" ? "SHADOW_CASH" : "SHADOW_LEDGER",
      }))
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));

  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    degraded: Boolean(positionsResponse.degraded),
    reason: positionsResponse.degraded ? positionsResponse.reason : null,
    assetClass: bucketRows(assetBuckets),
    sector: bucketRows(sectorBuckets),
    exposure: {
      grossLong: marketValue,
      grossShort: 0,
      netExposure: marketValue,
    },
    updatedAt: dateFromShadowPositionResponse(positionsResponse.updatedAt),
  };
}

export async function getShadowAccountPositionsAtDate(input: {
  date: string | Date;
  assetClass?: string | null;
  source?: string | null;
}) {
  const source = normalizeShadowSourceScope(input.source);
  const window = shadowDateWindowUtc(input.date);
  const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
  const rawFills = await db
    .select()
    .from(shadowFillsTable)
    .where(
      and(
        eq(shadowFillsTable.accountId, currentShadowAccountId()),
        lte(shadowFillsTable.occurredAt, window.end),
      ),
    )
    .orderBy(shadowFillsTable.occurredAt);
  const ordersById = await readShadowOrdersByFillOrderId(rawFills);
  const fills = source
    ? rawFills.filter((fill) => shadowOrderMatchesSource(ordersById.get(fill.orderId), source))
    : rawFills.filter((fill) =>
        isDefaultShadowLedgerAnalyticsOrder(ordersById.get(fill.orderId)),
      );
  const books = new Map<
    string,
    {
      symbol: string;
      assetClass: ShadowAssetClass;
      optionContract: ShadowOptionContract | null;
      quantity: number;
      totalCost: number;
      mark: number;
      sourceType: string;
      strategyLabel: string | null;
    }
  >();

  fills.forEach((fill) => {
    const order = ordersById.get(fill.orderId);
    const contract = asOptionContract(fill.optionContract);
    const assetClass = fill.assetClass as ShadowAssetClass;
    const payload = readRecord(order?.payload) ?? {};
    const metadataPayload = readRecord(payload.metadata) ?? {};
    const key =
      readString(metadataPayload.positionKey) ??
      positionKey({
        symbol: fill.symbol,
        assetClass,
        optionContract: contract,
      });
    const multiplier = marketMultiplier({ assetClass, optionContract: contract });
    const quantity = Math.abs(toNumber(fill.quantity) ?? 0);
    const price = toNumber(fill.price) ?? 0;
    const metadata = shadowSourceMetadata(order);
    const current = books.get(key) ?? {
      symbol: fill.symbol,
      assetClass,
      optionContract: contract,
      quantity: 0,
      totalCost: 0,
      mark: price,
      sourceType: metadata.sourceType,
      strategyLabel: metadata.strategyLabel,
    };
    if (fill.side === "buy") {
      current.quantity += quantity;
      current.totalCost += quantity * price * multiplier;
    } else {
      const closeQuantity = Math.min(quantity, Math.abs(current.quantity));
      const averageCost =
        Math.abs(current.quantity) > 0
          ? current.totalCost / Math.abs(current.quantity)
          : price * multiplier;
      current.quantity -= closeQuantity;
      current.totalCost = Math.max(0, current.totalCost - averageCost * closeQuantity);
    }
    current.mark = price;
    current.sourceType = metadata.sourceType;
    current.strategyLabel = metadata.strategyLabel;
    books.set(key, current);
  });

  const cash =
    (toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE) +
    fills.reduce((sum, fill) => sum + (toNumber(fill.cashDelta) ?? 0), 0);
  const rawPositions = Array.from(books.entries()).filter(
    ([, book]) => Math.abs(book.quantity) > 1e-8,
  );
  const assetClassFilter = normalizePositionAssetClass(input.assetClass);
  const filteredPositions =
    assetClassFilter && assetClassFilter !== "all"
      ? rawPositions.filter(([, book]) =>
          shadowPositionMatchesAssetClass(book, assetClassFilter),
        )
      : rawPositions;
  const marketValueTotal = filteredPositions.reduce((sum, [, book]) => {
    const multiplier = marketMultiplier({
      assetClass: book.assetClass,
      optionContract: book.optionContract,
    });
    return sum + book.quantity * book.mark * multiplier;
  }, 0);
  const nav = cash + marketValueTotal;
  const isScopedHistoricalResponse =
    Boolean(source) || Boolean(input.assetClass && input.assetClass !== "all");
  const accountNetLiquidation = isScopedHistoricalResponse
    ? (await computeShadowSnapshotTotalsAt(null, window.end)).netLiquidation
    : nav;
  const positions = filteredPositions.map(([key, book]) => {
    const multiplier = marketMultiplier({
      assetClass: book.assetClass,
      optionContract: book.optionContract,
    });
    const averageCost =
      Math.abs(book.quantity) > 0 ? book.totalCost / Math.abs(book.quantity) / multiplier : 0;
    const marketValue = book.quantity * book.mark * multiplier;
    const unrealizedPnl = marketValue - book.totalCost;
    const scopedWeightPercent = weightPercent(marketValue, nav);
    const positionType = shadowPositionType(book);
    return {
      id: `SHADOW:${key}:${window.date}`,
      accountId: SHADOW_ACCOUNT_ID,
      accounts: [SHADOW_ACCOUNT_ID],
      symbol: book.symbol,
      marketDataSymbol: shadowPositionMarketDataSymbol({
        symbol: book.symbol,
        optionContract: book.optionContract,
        positionKey: key,
      }),
      description: book.optionContract
        ? `${book.optionContract.underlying} ${optionDateKey(book.optionContract.expirationDate)} ${book.optionContract.strike} ${String(book.optionContract.right).toUpperCase()}`
        : book.symbol,
      assetClass: assetClassLabel(book),
      positionType,
      optionContract: optionPayload(book.optionContract),
      sector: "Shadow Holdings",
      quantity: book.quantity,
      averageCost,
      mark: book.mark,
      dayChange: null,
      dayChangePercent: null,
      unrealizedPnl,
      unrealizedPnlPercent:
        book.totalCost > 0 ? (unrealizedPnl / Math.abs(book.totalCost)) * 100 : 0,
      marketValue,
      weightPercent: scopedWeightPercent,
      accountWeightPercent: weightPercent(marketValue, accountNetLiquidation),
      scopedWeightPercent,
      betaWeightedDelta: null,
      lots: [
        {
          accountId: SHADOW_ACCOUNT_ID,
          symbol: book.symbol,
          quantity: book.quantity,
          averageCost,
          marketPrice: book.mark,
          marketValue,
          unrealizedPnl,
          asOf: window.end,
          source: "SHADOW_LEDGER",
        },
      ],
      openOrders: [],
      source: "SHADOW_LEDGER",
      sourceType: book.sourceType,
      strategyLabel: book.strategyLabel,
      attributionStatus: book.sourceType ? "attributed" : "unknown",
      sourceAttribution: [],
    };
  });
  const dayFills = fills.filter(
    (fill) =>
      fill.occurredAt.getTime() >= window.start.getTime() &&
      fill.occurredAt.getTime() < window.end.getTime(),
  );
  const activity = [
    ...(account.createdAt.getTime() >= window.start.getTime() &&
    account.createdAt.getTime() < window.end.getTime()
      ? [
          {
            id: "shadow-starting-balance",
            timestamp: account.createdAt,
            type: "deposit",
            symbol: null,
            side: null,
            amount: toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE,
            quantity: null,
            price: null,
            realizedPnl: null,
            fees: null,
            currency: SHADOW_CURRENCY,
            source: "SHADOW_LEDGER",
          },
        ]
      : []),
    ...dayFills.map((fill) => {
      const metadata = shadowSourceMetadata(ordersById.get(fill.orderId));
      return {
        id: fill.id,
        timestamp: fill.occurredAt,
        type: fill.side === "buy" ? "trade_buy" : "trade_sell",
        symbol: fill.symbol,
        side: fill.side,
        amount: toNumber(fill.cashDelta),
        quantity: Math.abs(toNumber(fill.quantity) ?? 0),
        price: toNumber(fill.price),
        realizedPnl: toNumber(fill.realizedPnl),
        fees: toNumber(fill.fees),
        currency: SHADOW_CURRENCY,
        source: metadata.strategyLabel || metadata.sourceType || "SHADOW_LEDGER",
      };
    }),
  ].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  return {
    accountId: SHADOW_ACCOUNT_ID,
    date: window.date,
    currency: SHADOW_CURRENCY,
    status: positions.length || activity.length ? "historical" : "unavailable",
    snapshotDate: positions.length ? window.end : null,
    message:
      positions.length || activity.length
        ? null
        : "No shadow account positions or activity exist for this date.",
    positions,
    activity,
    totals: {
      weightPercent: positions.reduce((sum, row) => sum + (row.weightPercent ?? 0), 0),
      unrealizedPnl: positions.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      grossLong: positions
        .filter((row) => row.marketValue > 0)
        .reduce((sum, row) => sum + row.marketValue, 0),
      grossShort: positions
        .filter((row) => row.marketValue < 0)
        .reduce((sum, row) => sum + Math.abs(row.marketValue), 0),
      netExposure: positions.reduce((sum, row) => sum + row.marketValue, 0),
    },
    updatedAt: new Date(),
  };
}

function shadowClosedTradesDateCachePart(value: Date | null | undefined): string {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value.toISOString()
    : "";
}

function shadowClosedTradesStringCachePart(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function shadowClosedTradesSymbolCachePart(value: string | null | undefined): string {
  return typeof value === "string" ? normalizeSymbol(value).toUpperCase() : "";
}

function shadowClosedTradesReadCacheKey(input: {
  source: ShadowSourceScope | null;
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  assetClassFilter: ShadowPositionTypeFilter;
  pnlSign?: string | null;
}): string {
  return [
    "closed-trades:v2",
    shadowSourceCacheKey(input.source),
    shadowClosedTradesDateCachePart(input.from),
    shadowClosedTradesDateCachePart(input.to),
    shadowClosedTradesSymbolCachePart(input.symbol),
    input.assetClassFilter ?? "",
    shadowClosedTradesStringCachePart(input.pnlSign),
  ].join(":");
}

export async function getShadowAccountClosedTrades(input: {
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  assetClass?: string | null;
  pnlSign?: string | null;
  source?: string | null;
}) {
  const source = normalizeShadowSourceScope(input.source);
  const assetClassFilter = normalizePositionAssetClass(input.assetClass);
  return withShadowReadCache(
    shadowClosedTradesReadCacheKey({
      source,
      from: input.from,
      to: input.to,
      symbol: input.symbol,
      assetClassFilter,
      pnlSign: input.pnlSign,
    }),
    async () => {
      if (isShadowAccountDbBackoffActive()) {
        return {
          accountId: SHADOW_ACCOUNT_ID,
          currency: SHADOW_CURRENCY,
          degraded: true,
          reason: SHADOW_ACCOUNT_DB_FALLBACK_REASON,
          trades: [],
          summary: {
            count: 0,
            winners: 0,
            losers: 0,
            realizedPnl: 0,
            commissions: 0,
          },
          updatedAt: new Date(),
        };
      }
      try {
        await ensureShadowAccount();
        // Closed-trades is the all-time P&L consumer; keep it on the raw ledger
        // reader instead of the dashboard-capped stream reader.
        const toBound = input.to;
        const { fills: allFills, ordersById } =
          await readShadowFillsWithOrders();
        const rawFills = (
          toBound
            ? allFills.filter((fill) => fill.occurredAt <= toBound)
            : [...allFills]
        ).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        const fills = source
          ? rawFills.filter((fill) =>
              shadowOrderMatchesSource(ordersById.get(fill.orderId), source),
            )
          : rawFills.filter((fill) =>
              isDefaultShadowLedgerAnalyticsOrder(ordersById.get(fill.orderId)),
            );
        const events = fills.map((fill) =>
          shadowAnalysisTradeEvent(fill, ordersById.get(fill.orderId)),
        );
        const { roundTrips } = buildShadowAnalysisRoundTrips(events);
        const closedTrades = roundTrips
          .map(shadowRoundTripToClosedTrade)
          .filter((trade) =>
            shadowTradeMatchesClosedTradeInput(trade, {
              ...input,
              assetClassFilter,
            }),
          )
          .sort((left, right) => {
            const leftTime = left.closeDate
              ? new Date(left.closeDate).getTime()
              : 0;
            const rightTime = right.closeDate
              ? new Date(right.closeDate).getTime()
              : 0;
            return rightTime - leftTime;
          });
        const trades = mergeShadowActivityTrades(
          closedTrades,
          events,
          roundTrips,
          { ...input, assetClassFilter },
        );
        return {
          accountId: SHADOW_ACCOUNT_ID,
          currency: SHADOW_CURRENCY,
          degraded: false,
          reason: null,
          trades,
          summary: {
            count: trades.length,
            winners: trades.filter((trade) => (trade.realizedPnl ?? 0) > 0)
              .length,
            losers: trades.filter((trade) => (trade.realizedPnl ?? 0) < 0)
              .length,
            realizedPnl: trades.reduce(
              (sum, trade) => sum + (trade.realizedPnl ?? 0),
              0,
            ),
            commissions: trades.reduce(
              (sum, trade) => sum + (trade.commissions ?? 0),
              0,
            ),
          },
          updatedAt: new Date(),
        };
      } catch (error) {
        if (isTransientPostgresError(error)) {
          markShadowAccountDbUnavailable(error);
          return {
            accountId: SHADOW_ACCOUNT_ID,
            currency: SHADOW_CURRENCY,
            degraded: true,
            reason: SHADOW_ACCOUNT_DB_FALLBACK_REASON,
            trades: [],
            summary: {
              count: 0,
              winners: 0,
              losers: 0,
              realizedPnl: 0,
              commissions: 0,
            },
            updatedAt: new Date(),
          };
        }
        throw error;
      }
    },
    {
      staleStrategy: "immediate",
      ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    },
  );
}

function buildDeferredShadowClosedTradesForFastRisk() {
  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    degraded: false,
    reason: null,
    trades: [],
    summary: {
      count: 0,
      winners: 0,
      losers: 0,
      realizedPnl: 0,
      commissions: 0,
    },
    updatedAt: new Date(),
  };
}

type ShadowAnalysisTradeEvent = {
  id: string;
  orderId: string;
  accountId: string;
  symbol: string;
  side: ShadowSide;
  assetClass: string;
  positionType: ReturnType<typeof classifyAccountPositionType>;
  positionKey: string;
  quantity: number;
  price: number;
  grossAmount: number;
  fees: number;
  realizedPnl: number;
  cashDelta: number;
  occurredAt: string;
  occurredAtDate: Date;
  sourceType: ShadowAttributionSource;
  strategyLabel: string | null;
  candidateId: string | null;
  deploymentId: string | null;
  deploymentName: string | null;
  sourceEventId: string | null;
  metadata: Record<string, unknown>;
};

type ShadowAnalysisRoundTrip = {
  id: string;
  entryIds: string[];
  symbol: string;
  assetClass: string;
  positionType: ReturnType<typeof classifyAccountPositionType>;
  positionKey: string;
  quantity: number;
  openDate: string | null;
  closeDate: string;
  avgOpen: number | null;
  avgClose: number;
  realizedPnl: number;
  realizedPnlPercent: number | null;
  fees: number;
  holdDurationMinutes: number | null;
  sourceType: ShadowAnalysisTradeEvent["sourceType"];
  strategyLabel: string | null;
  candidateId: string | null;
  entryMetadata: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

type ShadowAnalysisOpenLot = {
  id: string;
  symbol: string;
  assetClass: string;
  positionType: ReturnType<typeof classifyAccountPositionType>;
  positionKey: string;
  quantity: number;
  entryPrice: number;
  entryAt: Date;
  fees: number;
  sourceType: ShadowAnalysisTradeEvent["sourceType"];
  strategyLabel: string | null;
  candidateId: string | null;
  metadata: Record<string, unknown>;
};

const SHADOW_ANALYSIS_VERSION = 1;

function shadowAnalysisRangeWindow(range: AccountRange) {
  const windowEnd = new Date();
  return {
    windowStart: accountRangeStart(range, windowEnd),
    windowEnd,
  };
}

function shadowAnalysisJsonDate(date: Date | null | undefined) {
  return date ? date.toISOString() : null;
}

function shadowAnalysisEventMetadata(order?: ShadowOrderRow | null) {
  const payload = readRecord(order?.payload) ?? {};
  return {
    payload,
    metadata: readRecord(payload.metadata) ?? {},
    candidate: readRecord(payload.candidate) ?? readRecord(payload.automationCandidate) ?? {},
    position: readRecord(payload.position) ?? {},
  };
}

function shadowAnalysisTradeEvent(
  fill: ShadowFillRow,
  order?: ShadowOrderRow | null,
): ShadowAnalysisTradeEvent {
  const sourceMetadata = shadowSourceMetadata(order);
  const payloadParts = shadowAnalysisEventMetadata(order);
  const payloadSelectedContract =
    readRecord(payloadParts.payload.selectedContract) ??
    readRecord(payloadParts.position.selectedContract) ??
    readRecord(payloadParts.candidate.selectedContract) ??
    {};
  const contract = asOptionContract(fill.optionContract) ?? asOptionContract(payloadSelectedContract);
  const positionType = shadowPositionType({
    symbol: fill.symbol,
    assetClass: fill.assetClass,
    positionType: fill.positionType,
    optionContract: contract,
  });
  const payload = readRecord(order?.payload) ?? {};
  const payloadMetadata = readRecord(payload.metadata) ?? {};
  const attributedPositionKey =
    readString(payloadMetadata.positionKey) ??
    readString(payload.positionKey) ??
    positionKey({
      symbol: fill.symbol,
      assetClass: fill.assetClass as ShadowAssetClass,
      optionContract: contract,
    });
  const metadata = normalizeLegacyAlgoBranding({
    ...payloadParts.metadata,
    reason:
      readString(payloadParts.payload.reason) ??
      readString(payloadParts.metadata.reason) ??
      null,
    signal: readRecord(payloadParts.payload.signal) ?? {},
    action: readRecord(payloadParts.payload.action) ?? {},
    selectedContract: payloadSelectedContract,
    selectedExpiration: readRecord(payloadParts.payload.selectedExpiration) ?? {},
    orderPlan:
      readRecord(payloadParts.payload.orderPlan) ??
      readRecord(payloadParts.candidate.orderPlan) ??
      {},
    profile: readRecord(payloadParts.payload.profile) ?? {},
    liquidity:
      readRecord(payloadParts.payload.liquidity) ??
      readRecord(payloadParts.candidate.liquidity) ??
      {},
    quote:
      readRecord(payloadParts.payload.quote) ??
      readRecord(payloadParts.candidate.quote) ??
      {},
    stop: readRecord(payloadParts.payload.stop) ?? {},
    candidate: payloadParts.candidate,
    position: payloadParts.position,
  });
  return {
    id: fill.id,
    orderId: fill.orderId,
    accountId: fill.accountId,
    symbol: normalizeSymbol(fill.symbol).toUpperCase(),
    side: fill.side as ShadowSide,
    assetClass: fill.assetClass,
    positionType,
    positionKey: attributedPositionKey,
    quantity: Math.abs(toNumber(fill.quantity) ?? 0),
    price: toNumber(fill.price) ?? 0,
    grossAmount: toNumber(fill.grossAmount) ?? 0,
    fees: toNumber(fill.fees) ?? 0,
    realizedPnl: toNumber(fill.realizedPnl) ?? 0,
    cashDelta: toNumber(fill.cashDelta) ?? 0,
    occurredAt: fill.occurredAt.toISOString(),
    occurredAtDate: fill.occurredAt,
    sourceType: sourceMetadata.sourceType,
    strategyLabel: sourceMetadata.strategyLabel,
    candidateId: sourceMetadata.candidateId,
    deploymentId: sourceMetadata.deploymentId,
    deploymentName: sourceMetadata.deploymentName,
    sourceEventId: sourceMetadata.sourceEventId,
    metadata,
  };
}

function isDateInShadowAnalysisWindow(
  date: Date,
  input: { windowStart: Date | null; windowEnd: Date },
) {
  return (!input.windowStart || date >= input.windowStart) && date <= input.windowEnd;
}

function sourceStatKey(value: Pick<ShadowAnalysisTradeEvent, "sourceType" | "strategyLabel">) {
  return `${value.sourceType}:${value.strategyLabel ?? value.sourceType}`;
}

function profitFactorFromValues(values: number[]) {
  const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(
    values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0),
  );
  if (!losses) {
    return gains > 0 ? null : 0;
  }
  return gains / losses;
}

function summarizeRoundTrips(roundTrips: ShadowAnalysisRoundTrip[]) {
  const pnls = roundTrips.map((trade) => trade.realizedPnl);
  const winners = pnls.filter((value) => value > 0);
  const losers = pnls.filter((value) => value < 0);
  return {
    closedTrades: roundTrips.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRatePercent: roundTrips.length ? (winners.length / roundTrips.length) * 100 : null,
    realizedPnl: pnls.reduce((sum, value) => sum + value, 0),
    fees: roundTrips.reduce((sum, trade) => sum + trade.fees, 0),
    averageWin: winners.length
      ? winners.reduce((sum, value) => sum + value, 0) / winners.length
      : null,
    averageLoss: losers.length
      ? losers.reduce((sum, value) => sum + value, 0) / losers.length
      : null,
    expectancy: roundTrips.length
      ? pnls.reduce((sum, value) => sum + value, 0) / roundTrips.length
      : null,
    profitFactor: profitFactorFromValues(pnls),
    payoffRatio:
      winners.length && losers.length
        ? (winners.reduce((sum, value) => sum + value, 0) / winners.length) /
          Math.abs(losers.reduce((sum, value) => sum + value, 0) / losers.length)
        : null,
    averageHoldMinutes: averageWatchlistBacktestValues(
      roundTrips
        .map((trade) => trade.holdDurationMinutes)
        .filter((value): value is number => value != null),
    ),
  };
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const record = readRecord(value);
    if (record && Object.keys(record).length) {
      return record;
    }
  }
  return {};
}

function numberArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry))
    : [];
}

function roundTripFilterState(trade: ShadowAnalysisRoundTrip) {
  const entryCandidate = readRecord(trade.entryMetadata.candidate) ?? {};
  const exitCandidate = readRecord(trade.metadata.candidate) ?? {};
  const entrySignal = readRecord(entryCandidate.signal) ?? {};
  const exitSignal = readRecord(exitCandidate.signal) ?? {};
  const signal = firstRecord(trade.entryMetadata.signal, trade.metadata.signal, entrySignal, exitSignal);
  return firstRecord(signal.filterState, entrySignal.filterState, exitSignal.filterState);
}

function roundTripSelectedContract(trade: ShadowAnalysisRoundTrip) {
  const entryCandidate = readRecord(trade.entryMetadata.candidate) ?? {};
  const exitCandidate = readRecord(trade.metadata.candidate) ?? {};
  const entryPosition = readRecord(trade.entryMetadata.position) ?? {};
  const exitPosition = readRecord(trade.metadata.position) ?? {};
  return firstRecord(
    trade.metadata.selectedContract,
    trade.entryMetadata.selectedContract,
    exitPosition.selectedContract,
    entryPosition.selectedContract,
    exitCandidate.selectedContract,
    entryCandidate.selectedContract,
  );
}

function roundTripCandidate(trade: ShadowAnalysisRoundTrip) {
  return firstRecord(trade.entryMetadata.candidate, trade.metadata.candidate);
}

function roundTripProfile(trade: ShadowAnalysisRoundTrip) {
  return firstRecord(trade.entryMetadata.profile, trade.metadata.profile);
}

function roundTripSelectedExpiration(trade: ShadowAnalysisRoundTrip) {
  return firstRecord(trade.entryMetadata.selectedExpiration, trade.metadata.selectedExpiration);
}

function roundTripDte(input: {
  expirationDate: string | null;
  openDate: string | null;
  selectedExpiration: Record<string, unknown>;
}) {
  const explicit = toNumber(input.selectedExpiration.dte);
  if (explicit != null) return explicit;
  if (!input.expirationDate || !input.openDate) return null;
  const open = new Date(input.openDate);
  const expiration = new Date(`${input.expirationDate}T00:00:00.000Z`);
  if (Number.isNaN(open.getTime()) || Number.isNaN(expiration.getTime())) return null;
  const openDay = Date.UTC(open.getUTCFullYear(), open.getUTCMonth(), open.getUTCDate());
  const expirationDay = Date.UTC(
    expiration.getUTCFullYear(),
    expiration.getUTCMonth(),
    expiration.getUTCDate(),
  );
  return Math.max(0, Math.round((expirationDay - openDay) / 86_400_000));
}

function roundTripStrikeSlot(input: {
  right: string | null;
  profile: Record<string, unknown>;
}) {
  const optionSelection = readRecord(input.profile.optionSelection) ?? {};
  return input.right === "put"
    ? toNumber(optionSelection.putStrikeSlot)
    : toNumber(optionSelection.callStrikeSlot);
}

function shadowRoundTripToClosedTrade(trade: ShadowAnalysisRoundTrip) {
  const selectedContract = roundTripSelectedContract(trade);
  const contract = asOptionContract(selectedContract);
  const positionType = shadowPositionType({
    symbol: trade.symbol,
    assetClass: trade.assetClass,
    positionType: trade.positionType,
    optionContract: contract,
  });
  const candidate = roundTripCandidate(trade);
  const profile = roundTripProfile(trade);
  const selectedExpiration = roundTripSelectedExpiration(trade);
  const filterState = roundTripFilterState(trade);
  const position = firstRecord(trade.metadata.position, trade.entryMetadata.position);
  const signalPrice = toNumber(candidate.signalPrice);
  const strike = toNumber(contract?.strike ?? selectedContract.strike);
  const optionRight =
    readString(contract?.right) ??
    readString(selectedContract.right) ??
    readString(candidate.optionRight);
  const expirationDate =
    contract?.expirationDate == null
      ? readString(selectedContract.expirationDate)
      : optionDateKey(contract.expirationDate);
  const dte = roundTripDte({
    expirationDate,
    openDate: trade.openDate,
    selectedExpiration,
  });
  const peakPrice = toNumber(position.peakPrice);
  const entryPrice = trade.avgOpen;
  const exitPrice = trade.avgClose;
  const mfePercent =
    entryPrice != null && entryPrice > 0 && peakPrice != null
      ? ((peakPrice - entryPrice) / entryPrice) * 100
      : null;
  const givebackPercent =
    entryPrice != null && entryPrice > 0 && peakPrice != null && exitPrice != null
      ? ((peakPrice - exitPrice) / entryPrice) * 100
      : null;
  const mtfDirections = numberArray(filterState.mtfDirections);
  const adx = toNumber(filterState.adx);

  return {
    id: trade.id,
    source: "SHADOW",
    accountId: SHADOW_ACCOUNT_ID,
    symbol: trade.symbol,
    side: "sell",
    assetClass: accountPositionTypeDisplayLabel(positionType),
    positionType,
    quantity: trade.quantity,
    openDate: trade.openDate,
    closeDate: trade.closeDate,
    avgOpen: trade.avgOpen,
    avgClose: trade.avgClose,
    realizedPnl: trade.realizedPnl,
    realizedPnlPercent: trade.realizedPnlPercent,
    holdDurationMinutes: trade.holdDurationMinutes,
    fees: trade.fees,
    commissions: trade.fees,
    currency: SHADOW_CURRENCY,
    sourceType: trade.sourceType,
    strategyLabel: trade.strategyLabel,
    candidateId: trade.candidateId,
    exitReason: readString(trade.metadata.reason),
    selectedContract: Object.keys(selectedContract).length
      ? selectedContract
      : optionPayload(contract),
    optionContract: optionPayload(contract),
    optionRight,
    expirationDate,
    dte,
    strike,
    strikeSlot: roundTripStrikeSlot({ right: optionRight, profile }),
    strikeDistancePct:
      signalPrice != null && signalPrice > 0 && strike != null
        ? ((strike - signalPrice) / signalPrice) * 100
        : null,
    signalPrice,
    filterState,
    adx,
    mtfDirections,
    filterDirection: toNumber(filterState.direction),
    peakPrice,
    mfePercent,
    givebackPercent,
    premiumAtRisk: toNumber(position.premiumAtRisk),
    metadata: {
      entry: trade.entryMetadata,
      exit: trade.metadata,
    },
  };
}

function shadowTradeEventToActivityTrade(event: ShadowAnalysisTradeEvent) {
  const position = readRecord(event.metadata.position) ?? {};
  const candidate = readRecord(event.metadata.candidate) ?? {};
  const selectedContract = firstRecord(
    event.metadata.selectedContract,
    position.selectedContract,
    candidate.selectedContract,
  );
  const contract = asOptionContract(selectedContract);
  const positionType = shadowPositionType({
    symbol: event.symbol,
    assetClass: event.assetClass,
    positionType: event.positionType,
    optionContract: contract,
  });
  const optionRight =
    readString(contract?.right) ??
    readString(selectedContract.right) ??
    readString(candidate.optionRight);
  const expirationDate =
    contract?.expirationDate == null
      ? readString(selectedContract.expirationDate)
      : optionDateKey(contract.expirationDate);
  const selectedExpiration =
    readRecord(event.metadata.selectedExpiration) ?? {};
  const realizedPnl = event.realizedPnl === 0 ? null : event.realizedPnl;

  return {
    id: event.id,
    source: "SHADOW_ACTIVITY",
    accountId: SHADOW_ACCOUNT_ID,
    symbol: event.symbol,
    side: event.side,
    assetClass: accountPositionTypeDisplayLabel(positionType),
    positionType,
    quantity: event.quantity,
    openDate: event.side === "buy" ? event.occurredAt : null,
    closeDate: event.occurredAt,
    avgOpen: event.side === "buy" ? event.price : null,
    avgClose: event.price,
    realizedPnl,
    realizedPnlPercent: null,
    holdDurationMinutes: null,
    fees: event.fees,
    commissions: event.fees,
    currency: SHADOW_CURRENCY,
    sourceType: event.sourceType,
    strategyLabel: event.strategyLabel,
    candidateId: event.candidateId,
    deploymentId: event.deploymentId,
    deploymentName: event.deploymentName,
    sourceEventId: event.sourceEventId,
    selectedContract: Object.keys(selectedContract).length
      ? selectedContract
      : optionPayload(contract),
    optionContract: optionPayload(contract),
    optionRight,
    expirationDate,
    dte: roundTripDte({
      expirationDate,
      openDate: event.occurredAt,
      selectedExpiration,
    }),
    strike: toNumber(contract?.strike ?? selectedContract.strike),
    metadata: {
      activity: event.metadata,
    },
  };
}

function shadowTradeMatchesClosedTradeInput(
  trade: ReturnType<typeof shadowRoundTripToClosedTrade> | ReturnType<typeof shadowTradeEventToActivityTrade>,
  input: {
    from?: Date | null;
    to?: Date | null;
    symbol?: string | null;
    assetClassFilter: ShadowPositionTypeFilter;
    pnlSign?: string | null;
  },
) {
  const closeDate = trade.closeDate ? new Date(trade.closeDate) : null;
  if (!closeDate || Number.isNaN(closeDate.getTime())) return false;
  if (input.from && closeDate < input.from) return false;
  if (input.to && closeDate > input.to) return false;
  if (
    input.symbol &&
    normalizeSymbol(trade.symbol).toUpperCase() !==
      normalizeSymbol(input.symbol).toUpperCase()
  ) {
    return false;
  }
  if (
    input.assetClassFilter &&
    input.assetClassFilter !== "all" &&
    !shadowPositionMatchesAssetClass(
      {
        symbol: trade.symbol,
        assetClass: trade.assetClass,
        positionType: trade.positionType,
        optionContract: trade.optionContract,
      },
      input.assetClassFilter,
    )
  ) {
    return false;
  }
  if (input.pnlSign === "winners" && (trade.realizedPnl ?? 0) <= 0) {
    return false;
  }
  if (input.pnlSign === "losers" && (trade.realizedPnl ?? 0) >= 0) {
    return false;
  }
  return true;
}

function mergeShadowActivityTrades(
  closedTrades: ReturnType<typeof shadowRoundTripToClosedTrade>[],
  events: ShadowAnalysisTradeEvent[],
  roundTrips: ShadowAnalysisRoundTrip[],
  input: {
    from?: Date | null;
    to?: Date | null;
    symbol?: string | null;
    assetClassFilter: ShadowPositionTypeFilter;
    pnlSign?: string | null;
  },
) {
  const representedFillIds = new Set<string>();
  roundTrips.forEach((trade) => {
    representedFillIds.add(trade.id);
    trade.entryIds.forEach((id) => representedFillIds.add(id));
  });
  const activityTrades = events
    .filter((event) => !representedFillIds.has(event.id))
    .map(shadowTradeEventToActivityTrade)
    .filter((trade) => shadowTradeMatchesClosedTradeInput(trade, input));

  if (!activityTrades.length) return closedTrades;
  return [...closedTrades, ...activityTrades].sort((left, right) => {
    const leftTime = left.closeDate ? new Date(left.closeDate).getTime() : 0;
    const rightTime = right.closeDate ? new Date(right.closeDate).getTime() : 0;
    return rightTime - leftTime;
  });
}

function buildShadowAnalysisRoundTrips(events: ShadowAnalysisTradeEvent[]) {
  const lotsByKey = new Map<string, ShadowAnalysisOpenLot[]>();
  const roundTrips: ShadowAnalysisRoundTrip[] = [];
  const anomalies: Array<Record<string, unknown>> = [];

  for (const event of events) {
    const key = event.positionKey || `${event.positionType}:${event.symbol}`;
    const lots = lotsByKey.get(key) ?? [];
    lotsByKey.set(key, lots);
    if (event.side === "buy") {
      lots.push({
        id: event.id,
        symbol: event.symbol,
        assetClass: event.assetClass,
        positionType: event.positionType,
        positionKey: event.positionKey,
        quantity: event.quantity,
        entryPrice: event.price,
        entryAt: event.occurredAtDate,
        fees: event.fees,
        sourceType: event.sourceType,
        strategyLabel: event.strategyLabel,
        candidateId: event.candidateId,
        metadata: event.metadata,
      });
      continue;
    }

    let remaining = event.quantity;
    let matchedQuantity = 0;
    let entryValue = 0;
    let entryFees = 0;
    let earliestEntry: Date | null = null;
    let entryMetadata: Record<string, unknown> | null = null;
    const entryIds: string[] = [];
    while (remaining > 0.000001 && lots.length) {
      const lot = lots[0]!;
      const closeQuantity = Math.min(remaining, lot.quantity);
      const closeRatio = lot.quantity > 0 ? closeQuantity / lot.quantity : 0;
      matchedQuantity += closeQuantity;
      entryValue += closeQuantity * lot.entryPrice;
      entryFees += lot.fees * closeRatio;
      entryMetadata ??= lot.metadata;
      if (!entryIds.includes(lot.id)) {
        entryIds.push(lot.id);
      }
      if (!earliestEntry || lot.entryAt.getTime() < earliestEntry.getTime()) {
        earliestEntry = lot.entryAt;
      }
      lot.quantity -= closeQuantity;
      lot.fees -= lot.fees * closeRatio;
      remaining -= closeQuantity;
      if (lot.quantity <= 0.000001) {
        lots.shift();
      }
    }

    if (remaining > 0.000001) {
      anomalies.push({
        type: "sell_without_open_lot",
        symbol: event.symbol,
        quantity: remaining,
        occurredAt: event.occurredAt,
        fillId: event.id,
      });
    }

    const avgOpen = matchedQuantity > 0 ? entryValue / matchedQuantity : null;
    const realizedPnlPercent =
      avgOpen && event.price
        ? ((event.price - avgOpen) / Math.abs(avgOpen)) * 100
        : null;
    roundTrips.push({
      id: event.id,
      entryIds,
      symbol: event.symbol,
      assetClass: event.assetClass,
      positionType: event.positionType,
      positionKey: event.positionKey,
      quantity: event.quantity,
      openDate: shadowAnalysisJsonDate(earliestEntry),
      closeDate: event.occurredAt,
      avgOpen,
      avgClose: event.price,
      realizedPnl: event.realizedPnl,
      realizedPnlPercent,
      fees: event.fees + entryFees,
      holdDurationMinutes: earliestEntry
        ? (event.occurredAtDate.getTime() - earliestEntry.getTime()) / 60_000
        : null,
      sourceType: event.sourceType,
      strategyLabel: event.strategyLabel,
      candidateId: event.candidateId,
      entryMetadata: entryMetadata ?? {},
      metadata: event.metadata,
    });
  }

  const openLots = Array.from(lotsByKey.values()).flat();
  return { roundTrips, openLots, anomalies };
}

function weekdayForShadowAnalysis(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: WATCHLIST_BACKTEST_TIME_ZONE,
    weekday: "short",
  }).format(date);
}

function buildShadowAnalysisGroupStats(
  roundTrips: ShadowAnalysisRoundTrip[],
  events: ShadowAnalysisTradeEvent[],
  openLots: ShadowAnalysisOpenLot[],
) {
  const eventsBySymbol = new Map<string, ShadowAnalysisTradeEvent[]>();
  events.forEach((event) => {
    const list = eventsBySymbol.get(event.symbol) ?? [];
    list.push(event);
    eventsBySymbol.set(event.symbol, list);
  });

  const tradesBySymbol = new Map<string, ShadowAnalysisRoundTrip[]>();
  roundTrips.forEach((trade) => {
    const list = tradesBySymbol.get(trade.symbol) ?? [];
    list.push(trade);
    tradesBySymbol.set(trade.symbol, list);
  });

  const tickerStats = Array.from(
    new Set([...eventsBySymbol.keys(), ...tradesBySymbol.keys(), ...openLots.map((lot) => lot.symbol)]),
  )
    .map((symbol) => {
      const symbolTrades = tradesBySymbol.get(symbol) ?? [];
      const symbolEvents = eventsBySymbol.get(symbol) ?? [];
      const summary = summarizeRoundTrips(symbolTrades);
      const symbolOpenLots = openLots.filter((lot) => lot.symbol === symbol);
      const bestTrade = [...symbolTrades].sort((left, right) => right.realizedPnl - left.realizedPnl)[0] ?? null;
      const worstTrade = [...symbolTrades].sort((left, right) => left.realizedPnl - right.realizedPnl)[0] ?? null;
      return {
        symbol,
        tradeEvents: symbolEvents.length,
        buyEvents: symbolEvents.filter((event) => event.side === "buy").length,
        sellEvents: symbolEvents.filter((event) => event.side === "sell").length,
        openQuantity: symbolOpenLots.reduce((sum, lot) => sum + lot.quantity, 0),
        openLots: symbolOpenLots.length,
        ...summary,
        bestTrade,
        worstTrade,
      };
    })
    .sort((left, right) => right.realizedPnl - left.realizedPnl);

  const sourceMap = new Map<string, ShadowAnalysisRoundTrip[]>();
  roundTrips.forEach((trade) => {
    const key = sourceStatKey(trade);
    const list = sourceMap.get(key) ?? [];
    list.push(trade);
    sourceMap.set(key, list);
  });
  const sourceStats = Array.from(sourceMap.entries())
    .map(([key, trades]) => {
      const [sourceType, ...labelParts] = key.split(":");
      return {
        key,
        sourceType,
        label: labelParts.join(":") || sourceType,
        ...summarizeRoundTrips(trades),
      };
    })
    .sort((left, right) => right.realizedPnl - left.realizedPnl);

  const byHour = new Map<string, ShadowAnalysisRoundTrip[]>();
  const byWeekday = new Map<string, ShadowAnalysisRoundTrip[]>();
  roundTrips.forEach((trade) => {
    const closeDate = new Date(trade.closeDate);
    const parts = timeZoneParts(closeDate);
    const hourKey = String(parts.hour).padStart(2, "0");
    const hourRows = byHour.get(hourKey) ?? [];
    hourRows.push(trade);
    byHour.set(hourKey, hourRows);
    const weekday = weekdayForShadowAnalysis(closeDate);
    const weekdayRows = byWeekday.get(weekday) ?? [];
    weekdayRows.push(trade);
    byWeekday.set(weekday, weekdayRows);
  });

  return {
    tickerStats,
    sourceStats,
    timeStats: {
      byHour: Array.from(byHour.entries()).map(([hour, trades]) => ({
        hour,
        ...summarizeRoundTrips(trades),
      })),
      byWeekday: Array.from(byWeekday.entries()).map(([weekday, trades]) => ({
        weekday,
        ...summarizeRoundTrips(trades),
      })),
    },
  };
}

function buildShadowEquityAnnotations(events: ShadowAnalysisTradeEvent[]) {
  return events.map((event) => ({
    id: event.id,
    timestamp: event.occurredAt,
    type: event.side === "buy" ? "trade_buy" : "trade_sell",
    amount: event.cashDelta,
    currency: SHADOW_CURRENCY,
    source: event.strategyLabel || event.sourceType,
    symbol: event.symbol,
    side: event.side,
    quantity: event.quantity,
    price: event.price,
    fees: event.fees,
    realizedPnl: event.realizedPnl,
    sourceType: event.sourceType,
    strategyLabel: event.strategyLabel,
    candidateId: event.candidateId,
  }));
}

function buildShadowTradeDiagnosticsFromRows(input: {
  range: AccountRange;
  windowStart: Date | null;
  windowEnd: Date;
  fills: ShadowFillRow[];
  ordersById: Map<string, ShadowOrderRow>;
  snapshot?: {
    id: string | null;
    persisted: boolean;
    createdAt: Date | null;
  };
}) {
  const allEvents = input.fills
    .map((fill) => shadowAnalysisTradeEvent(fill, input.ordersById.get(fill.orderId)))
    .sort((left, right) => left.occurredAtDate.getTime() - right.occurredAtDate.getTime());
  const { roundTrips, openLots, anomalies } = buildShadowAnalysisRoundTrips(allEvents);
  const tradeEvents = allEvents.filter((event) =>
    isDateInShadowAnalysisWindow(event.occurredAtDate, input),
  );
  const closedRoundTrips = roundTrips.filter((trade) =>
    isDateInShadowAnalysisWindow(new Date(trade.closeDate), input),
  );
  const groupStats = buildShadowAnalysisGroupStats(
    closedRoundTrips,
    tradeEvents,
    openLots,
  );
  const summary = {
    version: SHADOW_ANALYSIS_VERSION,
    accountId: SHADOW_ACCOUNT_ID,
    range: input.range,
    windowStart: shadowAnalysisJsonDate(input.windowStart),
    windowEnd: input.windowEnd.toISOString(),
    symbolsTraded: groupStats.tickerStats.length,
    tradeEvents: tradeEvents.length,
    buyEvents: tradeEvents.filter((event) => event.side === "buy").length,
    sellEvents: tradeEvents.filter((event) => event.side === "sell").length,
    openLots: openLots.length,
    anomalies: anomalies.length,
    ...summarizeRoundTrips(closedRoundTrips),
    bestTicker: groupStats.tickerStats[0] ?? null,
    worstTicker:
      [...groupStats.tickerStats].sort((left, right) => left.realizedPnl - right.realizedPnl)[0] ??
      null,
    bestTrade:
      [...closedRoundTrips].sort((left, right) => right.realizedPnl - left.realizedPnl)[0] ??
      null,
    worstTrade:
      [...closedRoundTrips].sort((left, right) => left.realizedPnl - right.realizedPnl)[0] ??
      null,
  };
  const equityAnnotations = buildShadowEquityAnnotations(tradeEvents);
  const packet = {
    snapshot: {
      id: input.snapshot?.id ?? null,
      persisted: input.snapshot?.persisted ?? false,
      createdAt: shadowAnalysisJsonDate(input.snapshot?.createdAt ?? null),
    },
    context: {
      accountId: SHADOW_ACCOUNT_ID,
      currency: SHADOW_CURRENCY,
      range: input.range,
      sourceScope: "shadow",
      windowStart: shadowAnalysisJsonDate(input.windowStart),
      windowEnd: input.windowEnd.toISOString(),
      generatedAt: new Date().toISOString(),
    },
    summary,
    tickerStats: groupStats.tickerStats,
    sourceStats: groupStats.sourceStats,
    timeStats: groupStats.timeStats,
    equityAnnotations,
    tradeEvents,
    roundTrips: closedRoundTrips,
    openLots,
    anomalies,
    fullPacketIncluded: true,
  };
  return packet;
}

async function loadShadowAnalysisRows() {
  const fills = await db
    .select()
    .from(shadowFillsTable)
    .where(eq(shadowFillsTable.accountId, currentShadowAccountId()))
    .orderBy(shadowFillsTable.occurredAt);
  const orderIds = Array.from(new Set(fills.map((fill) => fill.orderId)));
  const orders = orderIds.length
    ? await db
        .select()
        .from(shadowOrdersTable)
        .where(inArray(shadowOrdersTable.id, orderIds))
    : [];
  return {
    fills,
    ordersById: new Map(orders.map((order) => [order.id, order])),
  };
}

export async function computeShadowTradeDiagnostics(input: {
  range?: AccountRange | string | null;
} = {}) {
  const range = normalizeAccountRange(input.range);
  return withShadowReadCache(
    `trade-diagnostics:${range}`,
    async () => {
      await ensureShadowAccount();
      const window = shadowAnalysisRangeWindow(range);
      const rows = await loadShadowAnalysisRows();
      return buildShadowTradeDiagnosticsFromRows({
        range,
        ...window,
        fills: rows.fills,
        ordersById: rows.ordersById,
      });
    },
    {
      staleStrategy: "immediate",
      ttlMs: SHADOW_TRADE_DIAGNOSTICS_CACHE_TTL_MS,
      staleTtlMs: SHADOW_TRADE_DIAGNOSTICS_CACHE_STALE_TTL_MS,
    },
  );
}

async function getShadowTradeEquityEvents(input: {
  start?: Date | null;
  end?: Date | null;
  sources?: string[];
}) {
  const conditions: SQL<unknown>[] = [
    eq(shadowFillsTable.accountId, currentShadowAccountId()),
  ];
  if (input.start) {
    conditions.push(gte(shadowFillsTable.occurredAt, input.start));
  }
  if (input.end) {
    conditions.push(lte(shadowFillsTable.occurredAt, input.end));
  }
  const fills = await db
    .select()
    .from(shadowFillsTable)
    .where(and(...conditions))
    .orderBy(shadowFillsTable.occurredAt);
  const ordersById = await readShadowOrdersByFillOrderId(fills);
  const selectedFills = input.sources?.length
    ? fills.filter((fill) => {
        const order = ordersById.get(fill.orderId);
        return Boolean(
          order &&
            input.sources?.some((source) => shadowOrderMatchesSource(order, source)),
        );
      })
    : fills.filter((fill) =>
        isDefaultShadowLedgerAnalyticsOrder(ordersById.get(fill.orderId)),
      );
  return buildShadowEquityAnnotations(
    selectedFills.map((fill) =>
      shadowAnalysisTradeEvent(fill, ordersById.get(fill.orderId)),
    ),
  );
}

export async function getShadowAccountOrders(input: {
  tab?: OrderTab;
  source?: string | null;
}) {
  const tab = normalizeOrderTab(input.tab);
  const source = normalizeShadowSourceScope(input.source);
  return withShadowReadCache(
    `orders:${tab}:${shadowSourceCacheKey(source)}`,
    async () => {
      if (isShadowAccountDbBackoffActive()) {
        return {
          accountId: SHADOW_ACCOUNT_ID,
          tab,
          currency: SHADOW_CURRENCY,
          degraded: true,
          reason: SHADOW_ACCOUNT_DB_FALLBACK_REASON,
          stale: false,
          debug: null,
          orders: [],
          updatedAt: new Date(),
        };
      }
      try {
        const terminalStatuses = ["filled", "canceled", "rejected", "expired"];
        const sourceOrders = await readShadowOrdersForDisplay(source);
        const filtered = sourceOrders.filter((order) =>
          tab === "working"
            ? !terminalStatuses.includes(order.status)
            : terminalStatuses.includes(order.status),
        );
        return {
          accountId: SHADOW_ACCOUNT_ID,
          tab,
          currency: SHADOW_CURRENCY,
          degraded: false,
          reason: null,
          stale: false,
          debug: null,
          orders: filtered.map(orderRowToResponse),
          updatedAt: new Date(),
        };
      } catch (error) {
        if (isTransientPostgresError(error)) {
          markShadowAccountDbUnavailable(error);
          return {
            accountId: SHADOW_ACCOUNT_ID,
            tab,
            currency: SHADOW_CURRENCY,
            degraded: true,
            reason: SHADOW_ACCOUNT_DB_FALLBACK_REASON,
            stale: false,
            debug: null,
            orders: [],
            updatedAt: new Date(),
          };
        }
        throw error;
      }
    },
    {
      staleStrategy: "immediate",
      ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    },
  );
}

function readShadowOrdersForDisplay(source: ShadowSourceScope | null) {
  return withShadowReadCache(
    `orders:all:${shadowSourceCacheKey(source)}`,
    async () => {
      await ensureShadowAccount();
      const orders = await db
        .select()
        .from(shadowOrdersTable)
        .where(eq(shadowOrdersTable.accountId, currentShadowAccountId()))
        .orderBy(desc(shadowOrdersTable.placedAt))
        .limit(SHADOW_ORDER_HISTORY_LIMIT);
      return source
        ? orders.filter((order) => shadowOrderMatchesSource(order, source))
        : orders.filter(isLiveShadowOrder);
    },
    {
      staleStrategy: "immediate",
      ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    },
  );
}

function shadowResponseReason(value: unknown): string | null {
  const reason = readRecord(value)?.["reason"];
  return typeof reason === "string" && reason.trim() ? reason : null;
}

export async function getShadowAccountRisk(input: {
  source?: string | null;
  totals?: Awaited<ReturnType<typeof ensureFreshShadowState>>;
  positionsResponse?: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  closedTrades?: Awaited<ReturnType<typeof getShadowAccountClosedTrades>>;
  detail?: "full" | "fast";
} = {}) {
  const source = normalizeShadowSourceScope(input.source);
  const detail = input.detail === "full" ? "full" : "fast";
  const hasInjectedInputs = Boolean(
    input.totals || input.positionsResponse || input.closedTrades,
  );
  if (!hasInjectedInputs) {
    const cacheKey = `risk:${shadowSourceCacheKey(source)}:${detail}`;
    return withShadowReadCache(
      cacheKey,
      () => buildShadowAccountRisk({ source, detail }),
      {
        staleStrategy: "immediate",
        ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
      },
    );
  }
  return buildShadowAccountRisk({ ...input, source, detail });
}

async function buildShadowAccountRisk(input: {
  source?: ShadowSourceScope | null;
  totals?: Awaited<ReturnType<typeof ensureFreshShadowState>>;
  positionsResponse?: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  closedTrades?: Awaited<ReturnType<typeof getShadowAccountClosedTrades>>;
  detail?: "full" | "fast";
}) {
  const source = input.source ?? null;
  const fastDetail = input.detail === "fast";
  const diagnosticsKey = `risk-build:${shadowSourceCacheKey(source)}:${
    fastDetail ? "fast" : "full"
  }:${input.totals || input.positionsResponse || input.closedTrades ? "injected" : "self"}`;
  const diagnosticsStartedAt = Date.now();
  try {
    const positionsResponse =
      input.positionsResponse ??
      (await getShadowAccountPositions({ source, liveQuotes: false }));
    const totals =
      input.totals ??
      (input.positionsResponse
        ? shadowTotalsFromPositionsResponse({
            positionsResponse: input.positionsResponse,
            startingBalance: await shadowStartingBalanceForFastSummary(),
          })
        : source
          ? await computeShadowTotalsForSource(source)
          : await ensureFreshShadowState(true));
    const closedTrades =
      input.closedTrades ??
      (fastDetail
        ? buildDeferredShadowClosedTradesForFastRisk()
        : await getShadowAccountClosedTrades({ source }));
    const backoffActive = isShadowAccountDbBackoffActive();
    const degraded = Boolean(
      backoffActive || positionsResponse.degraded || closedTrades.degraded,
    );
    // Propagate the accurate upstream cause rather than relabeling an inherited
    // resource-pressure / stale-cache condition as "database unavailable". Only a
    // genuine DB-availability backoff warrants the DB-unavailable reason.
    const degradedReason = !degraded
      ? null
      : backoffActive
        ? SHADOW_ACCOUNT_DB_FALLBACK_REASON
        : (shadowResponseReason(positionsResponse) ??
          shadowResponseReason(closedTrades) ??
          SHADOW_ACCOUNT_DB_FALLBACK_REASON);
    const positionRows = positionsResponse.positions.map((position) => ({
      symbol: position.symbol,
      marketValue: position.marketValue,
      weightPercent: position.weightPercent,
      unrealizedPnl: position.unrealizedPnl,
      dayChange: position.dayChange,
      sector: position.sector,
    }));
    const realizedRows = closedTrades.trades.map((trade) => ({
      symbol: trade.symbol,
      marketValue: trade.realizedPnl ?? 0,
      weightPercent: null,
      unrealizedPnl: trade.realizedPnl ?? 0,
      sector: "Shadow Holdings",
    }));
    const notionalPositions = positionsResponse.positions.map((position) =>
      shadowPositionForNotionalRisk(position),
    );
    const underlyingPrices =
      shadowUnderlyingPricesFromPositionRows(positionsResponse.positions);
    const missingUnderlyingPrice = notionalPositions.some((position) => {
      const underlying = normalizeSymbol(
        position.optionContract?.underlying ?? "",
      ).toUpperCase();
      return (
        position.assetClass === "option" &&
        Boolean(underlying) &&
        !underlyingPrices.has(underlying)
      );
    });
    if (missingUnderlyingPrice && !fastDetail) {
      for (const [symbol, price] of await hydrateShadowOptionUnderlyingPrices(
        notionalPositions,
      )) {
        underlyingPrices.set(symbol, price);
      }
    }
    const cachedGreekQuoteByProviderContractId =
      readCachedShadowOptionGreekQuotes(positionsResponse.positions);
    const liveGreekQuoteByProviderContractId = fastDetail
      ? new Map<string, Partial<QuoteSnapshot> | Record<string, unknown>>()
      : await fetchShadowOptionDayChangeQuotes(
          positionsResponse.positions,
          {
            intent: "account-monitor-live",
            ownerPrefix: "shadow-risk-greek",
            taskMaxWaitMs: SHADOW_GREEK_QUOTE_TASK_MAX_WAIT_MS,
            requiresGreeks: true,
          },
        ).catch(() => new Map());
    const greekQuoteByProviderContractId = mergeShadowGreekQuoteMaps(
      cachedGreekQuoteByProviderContractId,
      liveGreekQuoteByProviderContractId,
    );
    const greekByPositionId = shadowGreekSnapshotsFromPositionRows(
      positionsResponse.positions,
      notionalPositions,
      greekQuoteByProviderContractId,
      underlyingPrices,
    );
    const notional = fastDetail
      ? buildNotionalExposure(notionalPositions, {
          nav: totals.netLiquidation,
          greekByPositionId,
          underlyingPrices,
        })
      : (
          await resolveAccountPortfolioRisk({
            positions: notionalPositions,
            nav: totals.netLiquidation,
            greekByPositionId,
            underlyingPrices,
          })
        ).notional;
    const greekScenarios = fastDetail
      ? buildDeferredShadowGreekScenarios()
      : await resolveAccountGreekScenarios({
          positions: notionalPositions,
          greekByPositionId,
          underlyingPrices,
        });
    const totalOptionPositions = positionsResponse.positions.filter(
      (position) => shadowPositionType(position) === "option",
    ).length;
    const matchedOptionPositions = Array.from(greekByPositionId.values()).filter(
      (greek) => greek.matched,
    ).length;
    const shadowGreekWarning =
      totalOptionPositions > matchedOptionPositions
        ? `Matched ${matchedOptionPositions} of ${totalOptionPositions} shadow option positions to option greek snapshots.`
        : null;
    const expiryConcentration = buildShadowExpiryConcentration(
      positionsResponse.positions,
    );
    const riskRecommendations = buildAccountRiskRecommendations({
      positions: notionalPositions,
      nav: totals.netLiquidation,
      greekByPositionId,
      greekScenarios,
      notional,
      expiryConcentration,
    });

    const response = {
      accountId: SHADOW_ACCOUNT_ID,
      currency: SHADOW_CURRENCY,
      degraded,
      reason: degradedReason,
      concentration: {
        topPositions: positionRows.slice(0, 5),
        sectors: [
          {
            sector: "Shadow Holdings",
            value: totals.marketValue,
            weightPercent: weightPercent(
              totals.marketValue,
              totals.netLiquidation,
            ),
          },
        ],
      },
      winnersLosers: {
        todayWinners: positionRows
          .filter((row) => (row.dayChange ?? 0) > 0)
          .sort((a, b) => (b.dayChange ?? 0) - (a.dayChange ?? 0))
          .slice(0, 5),
        todayLosers: positionRows
          .filter((row) => (row.dayChange ?? 0) < 0)
          .sort((a, b) => (a.dayChange ?? 0) - (b.dayChange ?? 0))
          .slice(0, 5),
        allTimeWinners: realizedRows
          .filter((row) => row.unrealizedPnl > 0)
          .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl)
          .slice(0, 5),
        allTimeLosers: realizedRows
          .filter((row) => row.unrealizedPnl < 0)
          .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)
          .slice(0, 5),
      },
      margin: {
        leverageRatio: totals.netLiquidation
          ? totals.marketValue / totals.netLiquidation
          : 0,
        marginUsed: 0,
        marginAvailable: totals.cash,
        maintenanceMargin: 0,
        maintenanceCushionPercent: null,
        dayTradingBuyingPower: totals.cash,
        sma: null,
        regTInitialMargin: 0,
        pdtDayTradeCount: null,
        providerFields: {
          marginUsed: "Shadow cash account",
          marginAvailable: "Cash",
          maintenanceMargin: "None",
          maintenanceCushionPercent: "Cash account",
          dayTradingBuyingPower: "Cash",
          sma: "N/A",
          regTInitialMargin: "None",
        },
      },
      greeks: {
        delta: sumNullableValues(
          positionsResponse.positions.map(
            (position) => greekByPositionId.get(position.id)?.delta,
          ),
        ),
        betaWeightedDelta: sumNullableValues(
          positionsResponse.positions.map(
            (position) => greekByPositionId.get(position.id)?.betaWeightedDelta,
          ),
        ),
        gamma: sumNullableValues(
          positionsResponse.positions.map(
            (position) => greekByPositionId.get(position.id)?.gamma,
          ),
        ),
        theta: sumNullableValues(
          positionsResponse.positions.map(
            (position) => greekByPositionId.get(position.id)?.theta,
          ),
        ),
        vega: sumNullableValues(
          positionsResponse.positions.map(
            (position) => greekByPositionId.get(position.id)?.vega,
          ),
        ),
        source: "SHADOW_OPTION_QUOTE",
        coverage: {
          optionPositions: totalOptionPositions,
          matchedOptionPositions,
        },
        perUnderlying: positionsResponse.positions.map((position) => ({
          underlying: position.symbol,
          exposure: position.marketValue,
          delta: greekByPositionId.get(position.id)?.delta ?? null,
          betaWeightedDelta:
            greekByPositionId.get(position.id)?.betaWeightedDelta ?? null,
          gamma: greekByPositionId.get(position.id)?.gamma ?? null,
          theta: greekByPositionId.get(position.id)?.theta ?? null,
          vega: greekByPositionId.get(position.id)?.vega ?? null,
          positionCount: 1,
          optionPositionCount:
            shadowPositionType(position) === "option" ? 1 : 0,
        })),
        warning: shadowGreekWarning,
      },
      notional,
      greekScenarios,
      riskRecommendations,
      expiryConcentration,
      updatedAt: totals.updatedAt,
    };
    recordShadowReadDiagnostic({
      key: diagnosticsKey,
      status: "operation",
      startedAt: diagnosticsStartedAt,
      servedStale: shadowReadValueIsMarkedStale(response),
    });
    return response;
  } catch (error) {
    recordShadowReadDiagnostic({
      key: diagnosticsKey,
      status: "error",
      startedAt: diagnosticsStartedAt,
    });
    throw error;
  }
}

function buildDeferredShadowGreekScenarios(): AccountGreekScenarios {
  return {
    enabled: false,
    status: "disabled",
    source: "python_compute",
    warning: "Deferred during the account-page primary read.",
    coverage: null,
    result: null,
    pythonJob: {
      jobId: null,
      jobType: "greek_scenario_matrix",
      durationMs: null,
      warnings: [],
      error: null,
    },
  };
}

function shadowGreekSnapshotsFromPositionRows(
  positionRows: Array<{
    id: string;
    symbol: string;
    optionQuote?: unknown;
  }>,
  positions: BrokerPositionSnapshot[],
  greekQuoteByProviderContractId = new Map<
    string,
    Partial<QuoteSnapshot> | Record<string, unknown>
  >(),
  underlyingPrices = new Map<string, number>(),
): Map<string, PositionGreekSnapshot> {
  const rowsById = new Map(positionRows.map((row) => [row.id, row]));
  const snapshots = new Map<string, PositionGreekSnapshot>();

  positions.filter(hasOptionContract).forEach((position) => {
    const quoteIdentifier = shadowOptionQuoteIdentifier(position.optionContract);
    const greekQuote = quoteIdentifier
      ? readRecord(greekQuoteByProviderContractId.get(quoteIdentifier))
      : null;
    const rowQuote = readRecord(rowsById.get(position.id)?.optionQuote);
    const quote = shadowQuoteHasAnyGreek(greekQuote) ? greekQuote : rowQuote;
    const estimatedGreeks = estimateShadowOptionGreeks(position, underlyingPrices);
    const delta = scaleOptionGreek(
      readOptionalShadowGreekNumber(quote?.delta) ?? estimatedGreeks?.delta ?? null,
      position,
    );
    const gamma = scaleOptionGreek(
      readOptionalShadowGreekNumber(quote?.gamma) ?? estimatedGreeks?.gamma ?? null,
      position,
    );
    const theta = scaleOptionGreek(
      readOptionalShadowGreekNumber(quote?.theta) ?? estimatedGreeks?.theta ?? null,
      position,
    );
    const vega = scaleOptionGreek(
      readOptionalShadowGreekNumber(quote?.vega) ?? estimatedGreeks?.vega ?? null,
      position,
    );
    const impliedVolatility =
      readOptionalShadowGreekNumber(quote?.impliedVolatility) ??
      estimatedGreeks?.impliedVolatility ??
      null;
    const hasAnyGreek =
      delta !== null || gamma !== null || theta !== null || vega !== null;
    const underlying = normalizeSymbol(position.optionContract.underlying);
    const usedEstimate = Boolean(
      estimatedGreeks &&
        [
          readOptionalShadowGreekNumber(quote?.delta),
          readOptionalShadowGreekNumber(quote?.gamma),
          readOptionalShadowGreekNumber(quote?.theta),
          readOptionalShadowGreekNumber(quote?.vega),
        ].some((value) => value === null),
    );

    snapshots.set(position.id, {
      positionId: position.id,
      symbol: position.symbol,
      underlying,
      delta,
      betaWeightedDelta: delta === null ? null : delta * betaForSymbol(underlying),
      gamma,
      theta,
      vega,
      impliedVolatility,
      source: "SHADOW_OPTION_QUOTE",
      matched: hasAnyGreek,
      warning: hasAnyGreek
        ? usedEstimate
          ? `Shadow option Greeks for ${position.symbol} include mark-derived estimates.`
          : null
        : `Shadow option quote for ${position.symbol} did not include greek values.`,
    });
  });

  return snapshots;
}

function estimateShadowOptionGreeks(
  position: BrokerPositionSnapshot & { optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]> },
  underlyingPrices: Map<string, number>,
  now = new Date(),
): {
  impliedVolatility: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
} | null {
  const contract = position.optionContract;
  const underlying = normalizeSymbol(contract.underlying);
  const spot = underlyingPrices.get(underlying);
  const strike = toNumber(contract.strike);
  const mark = toNumber(position.marketPrice);
  if (
    spot === undefined ||
    !Number.isFinite(spot) ||
    spot <= 0 ||
    strike === null ||
    strike <= 0 ||
    mark === null ||
    mark <= 0
  ) {
    return null;
  }
  const days = Math.max(
    1 / 24,
    (contract.expirationDate.getTime() - now.getTime()) / 86_400_000,
  );
  const years = Math.max(days / 365, 1 / 365);
  const right = contract.right === "put" ? "put" : "call";
  const rate = 0.045;
  const volatility = impliedVolatilityFromOptionMark({
    spot,
    strike,
    years,
    rate,
    right,
    mark,
  });
  if (volatility === null) {
    return null;
  }
  return {
    impliedVolatility: volatility,
    ...blackScholesGreeks({ spot, strike, years, rate, volatility, right }),
  };
}

function impliedVolatilityFromOptionMark(input: {
  spot: number;
  strike: number;
  years: number;
  rate: number;
  right: "call" | "put";
  mark: number;
}): number | null {
  let low = 0.01;
  let high = 5;
  const lowPrice = blackScholesPrice({ ...input, volatility: low });
  const highPrice = blackScholesPrice({ ...input, volatility: high });
  if (!Number.isFinite(lowPrice) || !Number.isFinite(highPrice)) {
    return null;
  }
  if (input.mark <= lowPrice) {
    return low;
  }
  if (input.mark >= highPrice) {
    return high;
  }
  for (let index = 0; index < 48; index += 1) {
    const mid = (low + high) / 2;
    const price = blackScholesPrice({ ...input, volatility: mid });
    if (price < input.mark) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function blackScholesPrice(input: {
  spot: number;
  strike: number;
  years: number;
  rate: number;
  volatility: number;
  right: "call" | "put";
}): number {
  const { d1, d2 } = blackScholesD1D2(input);
  const discountedStrike =
    input.strike * Math.exp(-input.rate * input.years);
  if (input.right === "put") {
    return discountedStrike * normalCdf(-d2) - input.spot * normalCdf(-d1);
  }
  return input.spot * normalCdf(d1) - discountedStrike * normalCdf(d2);
}

function blackScholesGreeks(input: {
  spot: number;
  strike: number;
  years: number;
  rate: number;
  volatility: number;
  right: "call" | "put";
}): { delta: number; gamma: number; theta: number; vega: number } {
  const { d1, d2 } = blackScholesD1D2(input);
  const pdf = normalPdf(d1);
  const sqrtYears = Math.sqrt(input.years);
  const discountedStrike =
    input.strike * Math.exp(-input.rate * input.years);
  const delta =
    input.right === "put" ? normalCdf(d1) - 1 : normalCdf(d1);
  const gamma = pdf / (input.spot * input.volatility * sqrtYears);
  const thetaAnnual =
    -(input.spot * pdf * input.volatility) / (2 * sqrtYears) +
    (input.right === "put"
      ? input.rate * discountedStrike * normalCdf(-d2)
      : -input.rate * discountedStrike * normalCdf(d2));
  return {
    delta,
    gamma,
    theta: thetaAnnual / 365,
    vega: (input.spot * pdf * sqrtYears) / 100,
  };
}

function blackScholesD1D2(input: {
  spot: number;
  strike: number;
  years: number;
  rate: number;
  volatility: number;
}): { d1: number; d2: number } {
  const sqrtYears = Math.sqrt(input.years);
  const denominator = input.volatility * sqrtYears;
  const d1 =
    (Math.log(input.spot / input.strike) +
      (input.rate + (input.volatility ** 2) / 2) * input.years) /
    denominator;
  return { d1, d2: d1 - denominator };
}

function normalPdf(value: number): number {
  return Math.exp(-(value ** 2) / 2) / Math.sqrt(2 * Math.PI);
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x));
  return sign * y;
}

function shadowQuoteHasAnyGreek(quote: Record<string, unknown> | null): boolean {
  return Boolean(
    quote &&
      [quote.delta, quote.gamma, quote.theta, quote.vega].some(
        (value) => readOptionalShadowGreekNumber(value) !== null,
      ),
  );
}

function readOptionalShadowGreekNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" && !value.trim()) {
    return null;
  }
  return toNumber(value);
}

function shadowPositionForNotionalRisk(position: {
  id: string;
  symbol: string;
  assetClass: string;
  quantity?: unknown;
  averageCost?: unknown;
  mark?: unknown;
  marketValue?: unknown;
  unrealizedPnl?: unknown;
  unrealizedPnlPercent?: unknown;
  positionType?: string | null;
  optionContract?: unknown;
}): BrokerPositionSnapshot {
  const optionContract = asOptionContract(position.optionContract);
  const riskOptionContract = optionContract
    ? { ...optionContract, providerContractId: optionContract.providerContractId ?? null }
    : null;
  const positionType = shadowPositionType({
    symbol: position.symbol,
    assetClass: position.assetClass,
    positionType: position.positionType,
    optionContract: riskOptionContract,
  });
  return {
    id: position.id,
    accountId: SHADOW_ACCOUNT_ID,
    symbol: position.symbol,
    assetClass: positionType === "option" ? "option" : "equity",
    quantity: toNumber(position.quantity) ?? 0,
    averagePrice: toNumber(position.averageCost) ?? 0,
    marketPrice: toNumber(position.mark) ?? 0,
    marketValue: toNumber(position.marketValue) ?? 0,
    unrealizedPnl: toNumber(position.unrealizedPnl) ?? 0,
    unrealizedPnlPercent: toNumber(position.unrealizedPnlPercent) ?? 0,
    optionContract: riskOptionContract,
  };
}

function shadowUnderlyingPricesFromPositionRows(
  positions: Array<{
    symbol?: unknown;
    underlyingMarket?: unknown;
    optionContract?: unknown;
  }>,
): Map<string, number> {
  const prices = new Map<string, number>();
  positions.forEach((position) => {
    const contract = asOptionContract(position.optionContract);
    if (!contract) {
      return;
    }
    const market = readRecord(position.underlyingMarket) ?? {};
    const symbol = normalizeSymbol(
      String(market.symbol ?? contract.underlying ?? position.symbol ?? ""),
    ).toUpperCase();
    const price =
      readPositiveNumber(market.price) ?? readPositiveNumber(market.mark);
    if (symbol && price != null) {
      prices.set(symbol, price);
    }
  });
  return prices;
}

async function hydrateShadowOptionUnderlyingPrices(
  positions: BrokerPositionSnapshot[],
): Promise<Map<string, number>> {
  const symbols = Array.from(
    new Set(
      positions
        .filter((position) => position.assetClass === "option" && position.optionContract)
        .map((position) => normalizeSymbol(position.optionContract?.underlying ?? ""))
        .filter(Boolean),
    ),
  );

  if (!symbols.length) {
    return new Map();
  }

  const payload = await getBoundedShadowUnderlyingQuoteSnapshots(
    symbols.join(","),
  );
  return new Map(
    (payload.quotes || [])
      .map((quote) => [normalizeSymbol(quote.symbol), toNumber(quote.price)] as const)
      .filter((entry): entry is readonly [string, number] => Boolean(entry[0]) && entry[1] !== null),
  );
}

function buildShadowExpiryConcentration(
  positions: Array<{
    assetClass: string;
    positionType?: string | null;
    id: string;
    symbol: string;
    optionContract?: unknown;
    description?: unknown;
    marketValue?: unknown;
  }>,
) {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const month = now + 30 * 86_400_000;
  const ninety = now + 90 * 86_400_000;
  const buckets = { thisWeek: 0, thisMonth: 0, next90Days: 0 };
  positions.forEach((position) => {
    if (shadowPositionType(position) !== "option") {
      return;
    }
    const expiryMatch = String(position.description ?? "").match(/\d{4}-\d{2}-\d{2}/);
    const expiry = expiryMatch ? new Date(`${expiryMatch[0]}T00:00:00.000Z`).getTime() : null;
    const value = Math.abs(Number(position.marketValue) || 0);
    if (!expiry) {
      return;
    }
    if (expiry <= week) buckets.thisWeek += value;
    if (expiry <= month) buckets.thisMonth += value;
    if (expiry <= ninety) buckets.next90Days += value;
  });
  return buckets;
}

export async function getShadowAccountCashActivity(input: { source?: string | null } = {}) {
  const source = normalizeShadowSourceScope(input.source);
  const buildFallback = () => ({
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    degraded: true,
    reason: SHADOW_ACCOUNT_DB_FALLBACK_REASON,
    settledCash: SHADOW_STARTING_BALANCE,
    unsettledCash: 0,
    totalCash: SHADOW_STARTING_BALANCE,
    dividendsMonth: 0,
    dividendsYtd: 0,
    interestPaidEarnedYtd: 0,
    feesYtd: 0,
    activities: [
      {
        id: "shadow-runtime-fallback-starting-balance",
        accountId: SHADOW_ACCOUNT_ID,
        date: new Date(),
        type: "Deposit",
        description: "Shadow account starting balance",
        amount: SHADOW_STARTING_BALANCE,
        currency: SHADOW_CURRENCY,
        source: "SHADOW_RUNTIME_FALLBACK",
      },
    ],
    dividends: [],
    updatedAt: new Date(),
  });
  if (isShadowAccountDbBackoffActive()) {
    return buildFallback();
  }
  return withShadowReadCache(
    `cash-activity:${shadowSourceCacheKey(source)}`,
    async () => {
      try {
        const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
        // Share the dashboard fills+orders read (readShadowDashboardFillsWithOrders)
        // instead of a separate query; replicate `order by occurred_at desc limit
        // 200` in memory on a copy (never mutate the shared cached array).
        const { fills: allFills, ordersById } =
          await readShadowDashboardFillsWithOrders();
        const rawFills = [...allFills]
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
          .slice(0, 200);
        const fills = source
          ? rawFills.filter((fill) => shadowOrderMatchesSource(ordersById.get(fill.orderId), source))
          : rawFills.filter((fill) =>
              isDefaultShadowLedgerAnalyticsOrder(ordersById.get(fill.orderId)),
            );
        const feesYtd = fills.reduce((sum, fill) => sum + Math.abs(toNumber(fill.fees) ?? 0), 0);
        const totals = await resolveShadowCashActivityTotals({ source, account });
        return {
          accountId: SHADOW_ACCOUNT_ID,
          currency: SHADOW_CURRENCY,
          settledCash: totals.cash,
          unsettledCash: 0,
          totalCash: totals.cash,
          dividendsMonth: 0,
          dividendsYtd: 0,
          interestPaidEarnedYtd: 0,
          feesYtd,
          activities: [
            {
              id: "shadow-initial-deposit",
              accountId: SHADOW_ACCOUNT_ID,
              date: account.createdAt,
              type: "Deposit",
              description: "Shadow account starting balance",
              amount: SHADOW_STARTING_BALANCE,
              currency: SHADOW_CURRENCY,
              source: "SHADOW_LEDGER",
            },
            ...fills.map((fill) => {
              const metadata = shadowSourceMetadata(ordersById.get(fill.orderId));
              return {
                id: fill.id,
                accountId: SHADOW_ACCOUNT_ID,
                date: fill.occurredAt,
                type: "Trade",
                description: `${fill.side.toUpperCase()} ${toNumber(fill.quantity) ?? 0} ${fill.symbol}`,
                amount: toNumber(fill.cashDelta) ?? 0,
                currency: SHADOW_CURRENCY,
                source: metadata.strategyLabel || "SHADOW_LEDGER",
                sourceType: metadata.sourceType,
                strategyLabel: metadata.strategyLabel,
              };
            }),
          ],
          dividends: [],
          updatedAt: new Date(),
        };
      } catch (error) {
        if (isTransientPostgresError(error)) {
          markShadowAccountDbUnavailable(error);
          return buildFallback();
        }
        throw error;
      }
    },
    {
      staleStrategy: "immediate",
      ttlMs: SHADOW_DERIVED_READ_CACHE_TTL_MS,
    },
  );
}

// Building an Intl.DateTimeFormat loads ICU locale/timezone data and is one of
// the most expensive operations in V8. This runs per-call across shadow
// mark/equity paths and showed as 6.1% of main-thread self-time in a live CPU
// profile (event-loop-starvation workstream). The formatter is stateless and
// reusable, so cache one per timeZone. Behavior-preserving.
const timeZonePartsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function timeZonePartsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = timeZonePartsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    timeZonePartsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function timeZoneParts(date: Date, timeZone = WATCHLIST_BACKTEST_TIME_ZONE) {
  const formatter = timeZonePartsFormatter(timeZone);
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function marketDateKey(date: Date) {
  const parts = timeZoneParts(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseMarketDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new HttpError(400, "Shadow watchlist backtest date must be YYYY-MM-DD.", {
      code: "shadow_backtest_date_invalid",
      expose: true,
    });
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function addDaysToMarketDate(value: string, days: number) {
  const parsed = parseMarketDateKey(value);
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return date.toISOString().slice(0, 10);
}

function previousWeekdayOrSame(value: string) {
  // Holiday-aware now (not just Sat/Sun): a weekday holiday like 2026-07-03
  // resolves back to the prior trading day 2026-07-02. parseMarketDateKey first
  // preserves the HttpError(400) on malformed input that user-facing callers
  // (resolveWatchlistBacktestWindow) rely on.
  parseMarketDateKey(value);
  return previousTradingDayOrSame(value);
}

function previousCalendarMonthRange(now: Date) {
  const parts = timeZoneParts(now);
  const firstOfPreviousMonth = new Date(Date.UTC(parts.year, parts.month - 2, 1));
  const year = firstOfPreviousMonth.getUTCFullYear();
  const month = firstOfPreviousMonth.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const normalizedMonth = String(month).padStart(2, "0");
  return {
    from: `${String(year).padStart(4, "0")}-${normalizedMonth}-01`,
    to: `${String(year).padStart(4, "0")}-${normalizedMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

function yearToDateRange(now: Date) {
  const parts = timeZoneParts(now);
  const year = String(parts.year).padStart(4, "0");
  return {
    from: `${year}-01-01`,
    to: previousWeekdayOrSame(marketDateKey(now)),
  };
}

function addWeekdaysToMarketDate(value: string, days: number) {
  // Holiday-aware trading-day step (skips full holidays, not just weekends), so a
  // "past_week" (-4) window spans four real trading days. parseMarketDateKey
  // preserves the HttpError(400) on malformed input.
  parseMarketDateKey(value);
  return addTradingDays(value, days);
}

function marketDatesBetween(from: string, to: string) {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDaysToMarketDate(cursor, 1);
  }
  return dates;
}

function timeZoneOffsetMs(timeZone: string, date: Date) {
  const parts = timeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return localAsUtc - date.getTime();
}

function zonedDateTimeToUtc(input: {
  marketDate: string;
  hour: number;
  minute: number;
  second?: number;
}) {
  const parsed = parseMarketDateKey(input.marketDate);
  const localAsUtc = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    input.hour,
    input.minute,
    input.second ?? 0,
  );
  const firstPass = new Date(
    localAsUtc - timeZoneOffsetMs(WATCHLIST_BACKTEST_TIME_ZONE, new Date(localAsUtc)),
  );
  return new Date(
    localAsUtc - timeZoneOffsetMs(WATCHLIST_BACKTEST_TIME_ZONE, firstPass),
  );
}

function resolveWatchlistBacktestWindow(input: {
  marketDate?: string | null;
  marketDateFrom?: string | null;
  marketDateTo?: string | null;
  range?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const today = previousWeekdayOrSame(marketDateKey(now));
  const range = String(input.range || "").trim().toLowerCase();
  const monthRange =
    range === "last_month" || range === "month"
      ? previousCalendarMonthRange(now)
      : null;
  const ytdRange =
    range === "ytd" || range === "year_to_date" || range === "since_2026"
      ? yearToDateRange(now)
      : null;
  const rangeToDate =
    input.marketDateTo?.trim() ||
    input.marketDate?.trim() ||
    ytdRange?.to ||
    monthRange?.to ||
    today;
  const resolvedToDate = previousWeekdayOrSame(rangeToDate);
  const resolvedFromDate =
    input.marketDateFrom?.trim() ||
    ytdRange?.from ||
    monthRange?.from ||
    (range === "past_week" || range === "week"
      ? addWeekdaysToMarketDate(resolvedToDate, -4)
      : input.marketDate?.trim() || resolvedToDate);
  parseMarketDateKey(resolvedFromDate);
  parseMarketDateKey(resolvedToDate);
  if (resolvedFromDate > resolvedToDate) {
    throw new HttpError(400, "Shadow watchlist backtest date range is inverted.", {
      code: "shadow_backtest_date_range_invalid",
      expose: true,
    });
  }
  const start = zonedDateTimeToUtc({
    marketDate: resolvedFromDate,
    hour: 9,
    minute: 30,
  });
  const nextMarketDate = addDaysToMarketDate(resolvedToDate, 1);
  const dayEnd = zonedDateTimeToUtc({
    marketDate: nextMarketDate,
    hour: 0,
    minute: 0,
  });
  const end =
    marketDateKey(now) === resolvedToDate && now > start
      ? now
      : dayEnd;
  const rangeKey =
    resolvedFromDate === resolvedToDate
      ? resolvedToDate
      : `${resolvedFromDate}:${resolvedToDate}`;
  return {
    marketDate: resolvedToDate,
    marketDateFrom: resolvedFromDate,
    marketDateTo: resolvedToDate,
    rangeKey,
    start,
    end,
    cleanupEnd: dayEnd,
  };
}

function normalizeWatchlistBacktestTimeframe(
  value: unknown,
): ShadowWatchlistBacktestTimeframe {
  return ["1m", "5m", "15m", "1h", "1d"].includes(String(value))
    ? (String(value) as ShadowWatchlistBacktestTimeframe)
    : "15m";
}

function normalizeRiskOverlayPercent(value: unknown) {
  const parsed = readNumber(value);
  if (!Number.isFinite(parsed) || parsed === null || parsed <= 0) {
    return null;
  }
  return Math.min(parsed, 99);
}

function normalizeWatchlistBacktestRiskOverlay(
  value: unknown,
): WatchlistBacktestRiskOverlay | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  const stopLossPercent = normalizeRiskOverlayPercent(record.stopLossPercent);
  const trailingStopPercent = normalizeRiskOverlayPercent(record.trailingStopPercent);
  const sellSignalTrailingStopPercent = normalizeRiskOverlayPercent(
    record.sellSignalTrailingStopPercent,
  );
  if (
    !stopLossPercent &&
    !trailingStopPercent &&
    !sellSignalTrailingStopPercent
  ) {
    return null;
  }
  const pieces = [
    stopLossPercent ? `SL${stopLossPercent}` : null,
    trailingStopPercent ? `TR${trailingStopPercent}` : null,
    sellSignalTrailingStopPercent ? `SIG${sellSignalTrailingStopPercent}` : null,
  ].filter(Boolean);
  return {
    label: readString(record.label) || pieces.join("_"),
    stopLossPercent,
    trailingStopPercent,
    sellSignalTrailingStopPercent,
  };
}

function normalizeWatchlistBacktestProxySymbols(
  value: unknown,
): WatchlistBacktestProxySymbol[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const symbols = Array.from(
    new Set(
      value.flatMap((entry) => {
        const symbol = normalizeSymbol(String(entry ?? "")).toUpperCase();
        return WATCHLIST_BACKTEST_PROXY_SYMBOLS.includes(
          symbol as WatchlistBacktestProxySymbol,
        )
          ? [symbol as WatchlistBacktestProxySymbol]
          : [];
      }),
    ),
  );
  return symbols.length ? symbols : null;
}

function normalizeWatchlistBacktestExcludedSymbols(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const symbols = Array.from(
    new Set(
      value.flatMap((entry) => {
        const symbol = normalizeSymbol(String(entry ?? "")).toUpperCase();
        return symbol ? [symbol] : [];
      }),
    ),
  );
  return symbols.length ? symbols : null;
}

function normalizeWatchlistBacktestSizingOverlay(
  value: unknown,
): WatchlistBacktestSizingOverlay {
  const record = readRecord(value);
  if (!record) {
    return DEFAULT_WATCHLIST_BACKTEST_SIZING;
  }
  const maxPositionFractionInput =
    readNumber(record.maxPositionFraction) ??
    (readNumber(record.maxPositionPercent) ?? 0) / 100;
  const maxPositionFraction =
    Number.isFinite(maxPositionFractionInput) && maxPositionFractionInput > 0
      ? Math.min(1, Math.max(0.01, maxPositionFractionInput))
      : DEFAULT_WATCHLIST_BACKTEST_SIZING.maxPositionFraction;
  const maxOpenPositionsInput = readNumber(record.maxOpenPositions);
  const maxOpenPositions =
    Number.isFinite(maxOpenPositionsInput) && maxOpenPositionsInput !== null
      ? Math.min(25, Math.max(1, Math.floor(maxOpenPositionsInput)))
      : DEFAULT_WATCHLIST_BACKTEST_SIZING.maxOpenPositions;
  return {
    label:
      readString(record.label) ||
      `P${Math.round(maxPositionFraction * 1000) / 10}x${maxOpenPositions}`,
    maxPositionFraction,
    maxOpenPositions,
    cashOnly: true,
  };
}

function normalizeWatchlistBacktestSelectionOverlay(
  value: unknown,
): WatchlistBacktestSelectionOverlay {
  const record = readRecord(value);
  if (!record) {
    return DEFAULT_WATCHLIST_BACKTEST_SELECTION;
  }
  const mode =
    record.mode === "ranked_rebalance"
      ? "ranked_rebalance"
      : record.mode === "ranked_batch"
        ? "ranked_batch"
        : "first_signal";
  const minScoreEdgeInput = readNumber(record.minScoreEdge);
  const minScoreEdge =
    Number.isFinite(minScoreEdgeInput) && minScoreEdgeInput !== null
      ? clampNumber(minScoreEdgeInput, 0, 50)
      : mode === "ranked_rebalance"
        ? 1
        : 0;
  return {
    label:
      readString(record.label) ||
      (mode === "ranked_rebalance"
        ? `RANK${minScoreEdge}`
        : mode === "ranked_batch"
          ? "RANKB"
          : "FIFO"),
    mode,
    minScoreEdge,
  };
}

function normalizeWatchlistBacktestEntryGateOverlay(
  value: unknown,
): WatchlistBacktestEntryGateOverlay | null {
  const record = readRecord(value);
  if (!record || record.enabled === false) {
    return null;
  }
  const fastWindowInput =
    readNumber(record.emaFastWindow) ??
    readNumber(record.fastWindow) ??
    readNumber(record.emaFast);
  const fastWindow =
    Number.isFinite(fastWindowInput) && fastWindowInput !== null
      ? clampNumber(Math.floor(fastWindowInput), 2, 200)
      : 21;
  const slowWindowInput =
    readNumber(record.emaSlowWindow) ??
    readNumber(record.slowWindow) ??
    readNumber(record.emaSlow);
  const slowWindow =
    Number.isFinite(slowWindowInput) && slowWindowInput !== null
      ? clampNumber(Math.floor(slowWindowInput), fastWindow + 1, 400)
      : Math.max(55, fastWindow + 1);
  const minConfirmationsInput =
    readNumber(record.minConfirmations) ?? readNumber(record.minCount);
  const minConfirmations =
    Number.isFinite(minConfirmationsInput) && minConfirmationsInput !== null
      ? clampNumber(Math.floor(minConfirmationsInput), 1, 5)
      : 2;
  const adxMinInput = readNumber(record.adxMin);
  const adxMin =
    Number.isFinite(adxMinInput) && adxMinInput !== null
      ? clampNumber(adxMinInput, 0, 100)
      : DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.adxMin;
  const rawVolatilityScoreMin =
    readNumber(record.volatilityScoreMin) ??
    readNumber(record.volScoreMin) ??
    DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.volScoreMin;
  const rawVolatilityScoreMax =
    readNumber(record.volatilityScoreMax) ??
    readNumber(record.volScoreMax) ??
    DEFAULT_PYRUS_SIGNALS_SIGNAL_SETTINGS.volScoreMax;
  const volatilityScoreMin = clampNumber(
    Math.min(rawVolatilityScoreMin, rawVolatilityScoreMax),
    0,
    100,
  );
  const volatilityScoreMax = clampNumber(
    Math.max(rawVolatilityScoreMin, rawVolatilityScoreMax),
    0,
    100,
  );
  return {
    label:
      readString(record.label) ||
      `EMA${fastWindow}_${slowWindow}_C${minConfirmations}`,
    emaFastWindow: fastWindow,
    emaSlowWindow: slowWindow,
    minConfirmations,
    adxMin,
    volatilityScoreMin,
    volatilityScoreMax,
  };
}

function normalizeWatchlistBacktestDrawdownLimitPercent(value: unknown) {
  const parsed = readNumber(value);
  if (!Number.isFinite(parsed) || parsed === null || parsed <= 0) {
    return null;
  }
  return Math.min(99, parsed);
}

function normalizeWatchlistBacktestTargetMultiple(value: unknown) {
  const parsed = readNumber(value);
  if (!Number.isFinite(parsed) || parsed === null || parsed <= 0) {
    return WATCHLIST_BACKTEST_TARGET_OUTPERFORMANCE_MULTIPLE;
  }
  return Math.min(10, parsed);
}

function isWatchlistBacktestProxySymbol(
  value: string,
): value is WatchlistBacktestProxySymbol {
  return WATCHLIST_BACKTEST_PROXY_SYMBOLS.includes(
    value as WatchlistBacktestProxySymbol,
  );
}

function normalizeWatchlistBacktestRegimeAction(
  value: unknown,
): WatchlistBacktestRegimeAction | null {
  const normalized = String(value || "").trim();
  return WATCHLIST_BACKTEST_REGIME_ACTIONS.includes(
    normalized as WatchlistBacktestRegimeAction,
  )
    ? (normalized as WatchlistBacktestRegimeAction)
    : null;
}

function normalizeWatchlistBacktestRegimeExpiration(
  value: unknown,
): WatchlistBacktestRegimeExpiration | null {
  const normalized = String(value || "").trim();
  return WATCHLIST_BACKTEST_REGIME_EXPIRATIONS.includes(
    normalized as WatchlistBacktestRegimeExpiration,
  )
    ? (normalized as WatchlistBacktestRegimeExpiration)
    : null;
}

function normalizeWatchlistBacktestRegimeOverlay(
  value: unknown,
): WatchlistBacktestRegimeOverlay | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  const proxySymbol = normalizeSymbol(String(record.proxySymbol || "")).toUpperCase();
  if (!isWatchlistBacktestProxySymbol(proxySymbol)) {
    return null;
  }
  const signalTimeframe = normalizeWatchlistBacktestTimeframe(record.signalTimeframe);
  if (!WATCHLIST_BACKTEST_PROXY_TIMEFRAMES.includes(signalTimeframe as never)) {
    return null;
  }
  const action = normalizeWatchlistBacktestRegimeAction(record.action);
  const expiration = normalizeWatchlistBacktestRegimeExpiration(record.expiration);
  if (!action || !expiration) {
    return null;
  }
  const fixedBars =
    Math.max(1, Math.floor(readNumber(record.fixedBars) ?? 0)) ||
    WATCHLIST_BACKTEST_FIXED_REGIME_BARS;
  const scaleDownFraction = Math.min(
    0.95,
    Math.max(
      0.05,
      readNumber(record.scaleDownFraction) ?? WATCHLIST_BACKTEST_SCALE_DOWN_FRACTION,
    ),
  );
  return {
    label:
      readString(record.label) ||
      [
        proxySymbol,
        signalTimeframe,
        action.replace(/_/g, "-"),
        expiration.replace(/_/g, "-"),
      ].join(":"),
    proxySymbol,
    signalTimeframe,
    action,
    expiration,
    fixedBars,
    scaleDownFraction,
  };
}

function isBacktestBarComplete(input: {
  timestamp: Date;
  timeframe: ShadowWatchlistBacktestTimeframe;
  evaluatedAt: Date;
}) {
  return (
    input.timestamp.getTime() +
      WATCHLIST_BACKTEST_TIMEFRAME_MS[input.timeframe] +
      WATCHLIST_BACKTEST_COMPLETED_BAR_SAFETY_MS <=
    input.evaluatedAt.getTime()
  );
}

function isWatchlistBacktestRegularSessionTime(
  date: Date,
  options: { allowClosePrint?: boolean } = {},
) {
  const parts = timeZoneParts(date);
  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return false;
  }
  const minutes = parts.hour * 60 + parts.minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return options.allowClosePrint
    ? minutes >= open && minutes <= close
    : minutes >= open && minutes < close;
}

function watchlistBacktestBarLimit(input: {
  timeframe: ShadowWatchlistBacktestTimeframe;
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
}) {
  const timeframeMs = WATCHLIST_BACKTEST_TIMEFRAME_MS[input.timeframe];
  const requestedWindowBars = Math.ceil(
    Math.max(0, input.window.end.getTime() - input.window.start.getTime()) / timeframeMs,
  );
  return Math.min(
    WATCHLIST_BACKTEST_MAX_BAR_LIMIT,
    Math.max(
      PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
      requestedWindowBars + PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
    ),
  );
}

function watchlistBacktestHydrationStart(input: {
  timeframe: ShadowWatchlistBacktestTimeframe;
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
}) {
  // "Warm up N bars" means N *session* bars, not N × interval of continuous
  // wall-clock. The old wall-clock reach fell short of a full prior session for
  // 1m — 1000 min ≈ 16.7h < the 17.5h overnight gap — so 1m warmed up with ZERO
  // prior-session bars and diverged from the live monitor (which fetches warmup
  // by count). Step WARMUP_BARS whole regular-session bars back, crossing
  // overnight/weekend/holiday gaps.
  const timeframeMs = WATCHLIST_BACKTEST_TIMEFRAME_MS[input.timeframe];
  if (input.timeframe === "1d") {
    // Daily bars are one-per-trading-day, so RTH-bar counting (a fraction of each
    // session) does not apply — rthBarsBack would exhaust its scan cap. Step back
    // WARMUP_BARS trading days instead; the resulting NY date key at UTC midnight
    // is a safe lower bound for the stored-bar `from` query.
    return new Date(
      `${addTradingDays(input.window.start, -PYRUS_SIGNALS_SIGNAL_WARMUP_BARS)}T00:00:00.000Z`,
    );
  }
  return rthBarsBack(
    timeframeMs,
    input.window.start,
    PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
  );
}

function watchlistBacktestHistorySourceNames() {
  const configuredSource = getMassiveRuntimeConfig()?.baseUrl.includes("massive.com")
    ? "massive-history"
    : "massive-history";
  return Array.from(
    new Set([configuredSource, "massive-history"]),
  );
}

async function loadStoredWatchlistBacktestBars(input: {
  symbol: string;
  timeframe: ShadowWatchlistBacktestTimeframe;
  limit: number;
  from: Date;
  to: Date;
}) {
  for (const sourceName of watchlistBacktestHistorySourceNames()) {
    const bars = await loadStoredMarketBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      limit: input.limit,
      from: input.from,
      to: input.to,
      assetClass: "equity",
      outsideRth: WATCHLIST_BACKTEST_OUTSIDE_RTH,
      source: "trades",
      recentWindowMinutes: 0,
      sourceName,
    });
    if (bars.length) {
      return bars;
    }
  }
  return [] as BrokerBarSnapshot[];
}

async function getHydratedWatchlistBacktestBars(input: {
  symbol: string;
  timeframe: ShadowWatchlistBacktestTimeframe;
  limit: number;
  from: Date;
  to: Date;
}) {
  const storedBars = await loadStoredWatchlistBacktestBars(input);
  if (storedBars.length) {
    return { bars: storedBars, error: null };
  }
  let lastError: unknown = null;
  const request = {
    symbol: input.symbol,
    timeframe: input.timeframe,
    limit: input.limit,
    from: input.from,
    to: input.to,
    assetClass: "equity" as const,
    outsideRth: WATCHLIST_BACKTEST_OUTSIDE_RTH,
    source: "trades" as const,
    allowHistoricalSynthesis: true,
    brokerRecentWindowMinutes: 0,
  };
  const first = await getBars(request).catch((error: unknown) => {
    lastError = error;
    return null;
  });
  const canonicalStoredBars = await loadStoredWatchlistBacktestBars(input);
  if (canonicalStoredBars.length) {
    return { bars: canonicalStoredBars, error: null };
  }
  if (first?.bars.length) {
    return { bars: first.bars, error: null };
  }

  for (const delayMs of WATCHLIST_BACKTEST_HYDRATION_RETRY_DELAYS_MS) {
    await sleep(delayMs);
    const storedBars = await loadStoredWatchlistBacktestBars(input);
    if (storedBars.length) {
      return { bars: storedBars, error: null };
    }
  }

  return { bars: [] as BrokerBarSnapshot[], error: lastError };
}

function barsToBacktestPyrusSignalsBars(
  inputBars: Awaited<ReturnType<typeof getBars>>["bars"],
  timeframe: ShadowWatchlistBacktestTimeframe,
  evaluatedAt: Date,
) {
  return inputBars
    .map((bar): PyrusSignalsBar | null => {
      const timestamp = dateOrNull(bar.timestamp);
      if (
        !timestamp ||
        bar.partial === true ||
        !isBacktestBarComplete({ timestamp, timeframe, evaluatedAt })
      ) {
        return null;
      }
      const open = Number(bar.open);
      const high = Number(bar.high);
      const low = Number(bar.low);
      const close = Number(bar.close);
      const volume = Number(bar.volume);
      if (![open, high, low, close].every(Number.isFinite)) {
        return null;
      }
      return {
        time: Math.floor(timestamp.getTime() / 1000),
        ts: timestamp.toISOString(),
        o: open,
        h: high,
        l: low,
        c: close,
        v: Number.isFinite(volume) ? volume : 0,
      };
    })
    .filter((bar): bar is PyrusSignalsBar => Boolean(bar))
    .sort((left, right) => left.time - right.time);
}

function collectWatchlistBacktestUniverse(
  watchlists: Awaited<ReturnType<typeof listWatchlists>>["watchlists"],
  options: {
    excludedSymbols?: string[] | null;
  } = {},
) {
  const excludedSymbols = new Set(options.excludedSymbols ?? []);
  const bySymbol = new Map<
    string,
    {
      symbol: string;
      watchlists: Array<{ id: string; name: string }>;
    }
  >();
  for (const watchlist of watchlists) {
    for (const item of watchlist.items) {
      const symbol = normalizeSymbol(item.symbol).toUpperCase();
      if (!symbol || excludedSymbols.has(symbol)) {
        continue;
      }
      const current = bySymbol.get(symbol) ?? { symbol, watchlists: [] };
      if (!current.watchlists.some((candidate) => candidate.id === watchlist.id)) {
        current.watchlists.push({ id: watchlist.id, name: watchlist.name });
      }
      bySymbol.set(symbol, current);
    }
  }
  return Array.from(bySymbol.values()).sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

function withWatchlistBacktestProxyUniverse(
  universe: ReturnType<typeof collectWatchlistBacktestUniverse>,
  options: {
    proxySymbols?: WatchlistBacktestProxySymbol[] | null;
  } = {},
) {
  const bySymbol = new Map(universe.map((item) => [item.symbol, item]));
  const proxySymbols = options.proxySymbols?.length
    ? options.proxySymbols
    : Array.from(WATCHLIST_BACKTEST_PROXY_SYMBOLS);
  for (const proxySymbol of proxySymbols) {
    if (!bySymbol.has(proxySymbol)) {
      bySymbol.set(proxySymbol, {
        symbol: proxySymbol,
        watchlists: [{ id: "regime-proxy", name: "Regime Proxy" }],
      });
    }
  }
  return Array.from(bySymbol.values()).sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function signalDirection(signal: PyrusSignalsSignalEvent): ShadowSide {
  return signal.eventType === "buy_signal" ? "buy" : "sell";
}

function fillForSignal(input: {
  signal: PyrusSignalsSignalEvent;
  bars: PyrusSignalsBar[];
  windowEnd: Date;
}) {
  const nextBar = input.bars[input.signal.barIndex + 1] ?? null;
  const nextBarTime = nextBar ? new Date(nextBar.time * 1000) : null;
  if (nextBar && nextBarTime && nextBarTime <= input.windowEnd) {
    return {
      price: cents(nextBar.o),
      placedAt: nextBarTime,
      source: "next_bar_open",
    };
  }
  return {
    price: cents(input.signal.close),
    placedAt: new Date(input.signal.time * 1000),
    source: "signal_close",
  };
}

function averageWatchlistBacktestValues(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) {
    return 0;
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function watchlistBacktestPercentChange(input: {
  bars: PyrusSignalsBar[];
  index: number;
  lookback: number;
  directionSign: number;
}) {
  const current = input.bars[input.index];
  const previous = input.bars[input.index - input.lookback];
  if (!current || !previous || current.c <= 0 || previous.c <= 0) {
    return 0;
  }
  return (current.c / previous.c - 1) * 100 * input.directionSign;
}

function scoreWatchlistBacktestSignal(input: {
  signal: PyrusSignalsSignalEvent;
  bars: PyrusSignalsBar[];
  evaluation: ReturnType<typeof evaluatePyrusSignalsSignals>;
}) {
  const index = input.signal.barIndex;
  const current = input.bars[index];
  if (!current || !Number.isFinite(current.c) || current.c <= 0) {
    return { score: 0, details: {} };
  }

  const directionSign = input.signal.direction === "long" ? 1 : -1;
  const shortMomentumPct = watchlistBacktestPercentChange({
    bars: input.bars,
    index,
    lookback: 6,
    directionSign,
  });
  const mediumMomentumPct = watchlistBacktestPercentChange({
    bars: input.bars,
    index,
    lookback: 20,
    directionSign,
  });
  const longMomentumPct = watchlistBacktestPercentChange({
    bars: input.bars,
    index,
    lookback: 78,
    directionSign,
  });

  const rangeBars = input.bars.slice(Math.max(0, index - 19), index + 1);
  const rangeHigh = Math.max(...rangeBars.map((bar) => bar.h));
  const rangeLow = Math.min(...rangeBars.map((bar) => bar.l));
  const rangePosition =
    Number.isFinite(rangeHigh) && Number.isFinite(rangeLow) && rangeHigh > rangeLow
      ? directionSign === 1
        ? (current.c - rangeLow) / (rangeHigh - rangeLow)
        : (rangeHigh - current.c) / (rangeHigh - rangeLow)
      : 0.5;

  const priorVolumeAverage = averageWatchlistBacktestValues(
    input.bars
      .slice(Math.max(0, index - 20), index)
      .map((bar) => readNumber(bar.v) ?? 0),
  );
  const currentVolume = readNumber(current.v) ?? 0;
  const volumeRatio =
    priorVolumeAverage > 0 && currentVolume > 0 ? currentVolume / priorVolumeAverage : 1;

  const filterState = input.signal.filterState;
  const adx = readNumber(filterState?.adx) ?? 0;
  const volatilityScore = readNumber(filterState?.volatilityScore) ?? 0;
  const mtfDirections = Array.isArray(filterState?.mtfDirections)
    ? filterState.mtfDirections
    : [];
  const mtfAlignment =
    mtfDirections.filter((direction) => direction === directionSign).length -
    mtfDirections.filter((direction) => direction === -directionSign).length * 0.5;

  const atr = readNumber(input.evaluation.atrSmoothed[index]) ?? 0;
  const atrPct = atr > 0 ? (atr / current.c) * 100 : 0;
  const signalPrice = readNumber(input.signal.price) ?? current.c;
  const signalDiscountPct =
    current.c > 0 ? ((current.c - signalPrice) / current.c) * 100 * directionSign : 0;
  const riskAdjustedMomentum =
    mediumMomentumPct / Math.max(0.25, atrPct || 0.25);

  const components = {
    shortMomentumPct,
    mediumMomentumPct,
    longMomentumPct,
    riskAdjustedMomentum,
    rangeComponent: (clampNumber(rangePosition, 0, 1) - 0.5) * 4,
    volumeExpansion: clampNumber(volumeRatio - 1, -1, 2),
    adxComponent: clampNumber((adx - 18) / 12, -1, 2.5),
    volatilityComponent: clampNumber(1 - Math.abs(volatilityScore - 6) / 6, -0.5, 1),
    mtfAlignment,
    signalDiscountPct: clampNumber(signalDiscountPct, -2, 2),
    atrPct,
  };

  const score =
    components.shortMomentumPct * 0.9 +
    components.mediumMomentumPct * 0.7 +
    components.longMomentumPct * 0.25 +
    components.riskAdjustedMomentum * 0.8 +
    components.rangeComponent * 0.9 +
    components.volumeExpansion * 1.2 +
    components.adxComponent * 0.8 +
    components.volatilityComponent * 0.6 +
    components.mtfAlignment * 0.8 +
    components.signalDiscountPct * 0.2 -
    components.atrPct * 0.12;

  return {
    score: Number(score.toFixed(6)),
    details: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [
        key,
        Number(value.toFixed(6)),
      ]),
    ),
  };
}

function computeWatchlistBacktestEma(values: number[], window: number) {
  const multiplier = 2 / (window + 1);
  const result = new Array<number>(values.length).fill(Number.NaN);
  let ema: number | null = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!Number.isFinite(value)) {
      continue;
    }
    ema = ema === null ? value : value * multiplier + ema * (1 - multiplier);
    result[index] = ema;
  }
  return result;
}

function roundedWatchlistBacktestDetail(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : 0;
}

function evaluateWatchlistBacktestEntryGate(input: {
  candidate: WatchlistBacktestSignalCandidate;
  bars: PyrusSignalsBar[];
  emaFast: number[];
  emaSlow: number[];
  overlay: WatchlistBacktestEntryGateOverlay;
}): {
  passed: boolean;
  reason: string | null;
  detail: string | null;
  signalScoreDetails: Record<string, number>;
} {
  if (input.candidate.side !== "buy") {
    return { passed: true, reason: null, detail: null, signalScoreDetails: {} };
  }
  const index = input.candidate.signal.barIndex;
  const current = input.bars[index];
  const close = readNumber(current?.c);
  const emaFast = readNumber(input.emaFast[index]);
  const emaSlow = readNumber(input.emaSlow[index]);
  if (
    !current ||
    index < input.overlay.emaSlowWindow - 1 ||
    close === null ||
    emaFast === null ||
    emaSlow === null
  ) {
    return {
      passed: false,
      reason: "entry_gate_missing_ema",
      detail: `EMA${input.overlay.emaFastWindow}/${input.overlay.emaSlowWindow} was not available at the signal bar.`,
      signalScoreDetails: {},
    };
  }

  const emaTrendPass = close > emaFast && emaFast > emaSlow;
  const filterState = input.candidate.signal.filterState;
  const mtfDirections = Array.isArray(filterState?.mtfDirections)
    ? filterState.mtfDirections
    : [];
  const mtfPasses = [0, 1, 2].map((mtfIndex) => {
    const direction = readNumber(mtfDirections[mtfIndex]);
    return direction !== null && Math.sign(direction) === 1;
  });
  const adx = readNumber(filterState?.adx);
  const volatilityScore = readNumber(filterState?.volatilityScore);
  const adxPass = adx !== null && adx >= input.overlay.adxMin;
  const volatilityPass =
    volatilityScore !== null &&
    volatilityScore >= input.overlay.volatilityScoreMin &&
    volatilityScore <= input.overlay.volatilityScoreMax;
  const confirmationCount = [
    ...mtfPasses,
    adxPass,
    volatilityPass,
  ].filter(Boolean).length;
  const confirmationPass = confirmationCount >= input.overlay.minConfirmations;
  const details = {
    entryGateEmaFast: roundedWatchlistBacktestDetail(emaFast),
    entryGateEmaSlow: roundedWatchlistBacktestDetail(emaSlow),
    entryGateEmaTrendPass: emaTrendPass ? 1 : 0,
    entryGateConfirmationCount: confirmationCount,
    entryGateMtf1Pass: mtfPasses[0] ? 1 : 0,
    entryGateMtf2Pass: mtfPasses[1] ? 1 : 0,
    entryGateMtf3Pass: mtfPasses[2] ? 1 : 0,
    entryGateAdx: roundedWatchlistBacktestDetail(adx ?? 0),
    entryGateAdxPass: adxPass ? 1 : 0,
    entryGateVolatilityScore: roundedWatchlistBacktestDetail(volatilityScore ?? 0),
    entryGateVolatilityPass: volatilityPass ? 1 : 0,
  };

  if (!emaTrendPass) {
    return {
      passed: false,
      reason: "entry_gate_ema_trend",
      detail: `Close ${close.toFixed(2)} did not satisfy close > EMA${input.overlay.emaFastWindow} ${emaFast.toFixed(2)} > EMA${input.overlay.emaSlowWindow} ${emaSlow.toFixed(2)}.`,
      signalScoreDetails: details,
    };
  }
  if (!confirmationPass) {
    return {
      passed: false,
      reason: "entry_gate_confirmation_quorum",
      detail: `Only ${confirmationCount}/5 confirmations passed; ${input.overlay.label} requires ${input.overlay.minConfirmations}/5.`,
      signalScoreDetails: details,
    };
  }
  return { passed: true, reason: null, detail: null, signalScoreDetails: details };
}

function applyWatchlistBacktestEntryGate(input: {
  signalScan: Awaited<ReturnType<typeof collectWatchlistBacktestSignals>>;
  entryGateOverlay: WatchlistBacktestEntryGateOverlay | null;
}) {
  if (!input.entryGateOverlay) {
    return input.signalScan;
  }
  const emaBySymbol = new Map<string, { fast: number[]; slow: number[] }>();
  const candidates: WatchlistBacktestSignalCandidate[] = [];
  const skipped: WatchlistBacktestSkip[] = [];

  for (const candidate of input.signalScan.candidates) {
    const bars = input.signalScan.barsBySymbol.get(candidate.symbol) ?? [];
    let ema = emaBySymbol.get(candidate.symbol);
    if (!ema) {
      const closes = bars.map((bar) => readNumber(bar.c) ?? Number.NaN);
      ema = {
        fast: computeWatchlistBacktestEma(
          closes,
          input.entryGateOverlay.emaFastWindow,
        ),
        slow: computeWatchlistBacktestEma(
          closes,
          input.entryGateOverlay.emaSlowWindow,
        ),
      };
      emaBySymbol.set(candidate.symbol, ema);
    }
    const evaluation = evaluateWatchlistBacktestEntryGate({
      candidate,
      bars,
      emaFast: ema.fast,
      emaSlow: ema.slow,
      overlay: input.entryGateOverlay,
    });
    if (!evaluation.passed) {
      skipped.push({
        symbol: candidate.symbol,
        reason: evaluation.reason ?? "entry_gate",
        detail: evaluation.detail ?? `${input.entryGateOverlay.label} rejected the signal.`,
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      continue;
    }
    candidates.push({
      ...candidate,
      signalScoreDetails: {
        ...candidate.signalScoreDetails,
        ...evaluation.signalScoreDetails,
      },
    });
  }

  return {
    ...input.signalScan,
    candidates,
    skipped: [...input.signalScan.skipped, ...skipped],
  };
}

async function collectWatchlistBacktestSignals(input: {
  universe: ReturnType<typeof collectWatchlistBacktestUniverse>;
  timeframe: ShadowWatchlistBacktestTimeframe;
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
}) {
  const settings = resolvePyrusSignalsSignalSettings({});
  const skipped: WatchlistBacktestSkip[] = [];
  const barLimit = watchlistBacktestBarLimit(input);
  const hydrationStart = watchlistBacktestHydrationStart({
    timeframe: input.timeframe,
    window: input.window,
  });
  const barsBySymbol = new Map<string, PyrusSignalsBar[]>();
  const candidates = await mapWithConcurrency(input.universe, 4, async (item) => {
    const barsResult = await getHydratedWatchlistBacktestBars({
      symbol: item.symbol,
      timeframe: input.timeframe,
      limit: barLimit,
      from: hydrationStart,
      to: input.window.end,
    });
    if (barsResult.error) {
      skipped.push({
        symbol: item.symbol,
        reason: "bars_unavailable",
        detail:
          barsResult.error instanceof Error
            ? barsResult.error.message
            : "No historical bars were available.",
        watchlists: item.watchlists,
      });
    }

    const chartBars = barsToBacktestPyrusSignalsBars(
      barsResult.bars,
      input.timeframe,
      input.window.end,
    );
    barsBySymbol.set(item.symbol, chartBars);
    if (!chartBars.length) {
      skipped.push({
        symbol: item.symbol,
        reason: "no_completed_bars",
        detail: "No completed bars were available in the requested window.",
        watchlists: item.watchlists,
      });
      return [];
    }

    const evaluation = evaluatePyrusSignalsSignals({
      chartBars,
      settings,
      includeProvisionalSignals: false,
    });
    return evaluation.signalEvents
      .filter((signal) => {
        const signalAt = new Date(signal.time * 1000);
        return (
          signalAt >= input.window.start &&
          signalAt <= input.window.end &&
          isWatchlistBacktestRegularSessionTime(signalAt)
        );
      })
      .map((signal): WatchlistBacktestSignalCandidate | null => {
        const fill = fillForSignal({
          signal,
          bars: chartBars,
          windowEnd: input.window.end,
        });
        if (
          !isWatchlistBacktestRegularSessionTime(fill.placedAt, {
            allowClosePrint: true,
          })
        ) {
          return null;
        }
        const signalScore = scoreWatchlistBacktestSignal({
          signal,
          bars: chartBars,
          evaluation,
        });
        return {
          symbol: item.symbol,
          side: signalDirection(signal),
          signal,
          signalAt: new Date(signal.time * 1000),
          signalPrice: readNumber(signal.price),
          signalClose: readNumber(signal.close),
          fillPrice: fill.price,
          placedAt: fill.placedAt,
          fillSource: fill.source,
          timeframe: input.timeframe,
          watchlists: item.watchlists,
          signalScore: signalScore.score,
          signalScoreDetails: signalScore.details,
        };
      })
      .filter((candidate): candidate is WatchlistBacktestSignalCandidate => candidate !== null);
  });
  return {
    candidates: candidates.flat().sort((left, right) => {
      const timeDelta = left.placedAt.getTime() - right.placedAt.getTime();
      return timeDelta || left.symbol.localeCompare(right.symbol);
    }),
    barsBySymbol,
    skipped,
  };
}

function quantityForCash(input: {
  cash: number;
  price: number;
  targetNotional: number;
}) {
  let quantity = Math.floor(Math.min(input.cash, input.targetNotional) / input.price);
  while (quantity > 0) {
    const fees = computeShadowOrderFees({
      assetClass: "equity",
      quantity,
      price: input.price,
    });
    if (quantity * input.price + fees <= input.cash + 0.000001) {
      return { quantity, fees };
    }
    quantity -= 1;
  }
  return { quantity: 0, fees: 0 };
}

const watchlistBacktestRegularBarsCache = new WeakMap<
  PyrusSignalsBar[],
  WatchlistBacktestPreparedBar[]
>();

function watchlistBacktestRegularBars(bars: PyrusSignalsBar[]) {
  const cached = watchlistBacktestRegularBarsCache.get(bars);
  if (cached) {
    return cached;
  }
  const prepared = bars
    .map((bar): WatchlistBacktestPreparedBar => {
      const at = new Date(bar.time * 1000);
      return { bar, at, atMs: at.getTime() };
    })
    .filter((entry) =>
      isWatchlistBacktestRegularSessionTime(entry.at, {
        allowClosePrint: true,
      }),
    );
  watchlistBacktestRegularBarsCache.set(bars, prepared);
  return prepared;
}

export function buildWatchlistBacktestFills(input: {
  runId: string;
  candidates: WatchlistBacktestSignalCandidate[];
  regimeCandidates?: WatchlistBacktestSignalCandidate[];
  barsBySymbol?: Map<string, PyrusSignalsBar[]>;
  riskOverlay?: WatchlistBacktestRiskOverlay | null;
  sizingOverlay?: WatchlistBacktestSizingOverlay | null;
  selectionOverlay?: WatchlistBacktestSelectionOverlay | null;
  regimeOverlay?: WatchlistBacktestRegimeOverlay | null;
  startingTotals: ShadowTotals;
  baseMarketValue: number;
  baselineOpenPositionCount?: number;
  baselineOpenSymbols?: string[];
  marketDate: string;
  windowEnd?: Date;
}) {
  const fills: WatchlistBacktestFill[] = [];
  const snapshots: Array<{
    asOf: Date;
    cash: number;
    netLiquidation: number;
    realizedPnl: number;
    unrealizedPnl: number;
    fees: number;
  }> = [];
  const skipped: WatchlistBacktestSkip[] = [];
  const open = new Map<
    string,
    {
      quantity: number;
      averageCost: number;
      lastMark: number;
      highestMark: number;
      activeTrailingStopPercent: number | null;
      lastStopCheckedAt: Date;
      nextBarIndex: number;
      positionKey: string;
      watchlists: Array<{ id: string; name: string }>;
      entryScore: number;
      regime?: Record<string, unknown> | null;
    }
  >();
  let cash = input.startingTotals.cash;
  let syntheticRealizedPnl = 0;
  let syntheticFees = 0;
  const sizingOverlay = input.sizingOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SIZING;
  const selectionOverlay =
    input.selectionOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SELECTION;
  const targetNotional =
    input.startingTotals.netLiquidation * sizingOverlay.maxPositionFraction;
  const baselineOpenPositionCount = Math.max(
    0,
    Math.floor(input.baselineOpenPositionCount ?? 0),
  );
  const baselineOpenSymbols = new Set(
    (input.baselineOpenSymbols ?? []).map((symbol) =>
      normalizeSymbol(symbol).toUpperCase(),
    ),
  );
  const riskOverlay = input.riskOverlay ?? null;
  const regimeOverlay = input.regimeOverlay ?? null;
  const proxySymbolSet = new Set<string>(
    regimeOverlay
      ? [regimeOverlay.proxySymbol]
      : Array.from(WATCHLIST_BACKTEST_PROXY_SYMBOLS),
  );
  let activeRegime:
    | {
        proxySymbol: WatchlistBacktestProxySymbol;
        signalTimeframe: ShadowWatchlistBacktestTimeframe;
        action: WatchlistBacktestRegimeAction;
        expiration: WatchlistBacktestRegimeExpiration;
        activatedAt: Date;
        expiresAt: Date | null;
        label: string;
      }
    | null = null;
  const getActiveRegime = () => activeRegime;

  const pushSnapshot = (asOf: Date) => {
    let syntheticMarketValue = 0;
    let syntheticUnrealizedPnl = 0;
    for (const position of open.values()) {
      syntheticMarketValue += position.quantity * position.lastMark;
      syntheticUnrealizedPnl +=
        (position.lastMark - position.averageCost) * position.quantity;
    }
    snapshots.push({
      asOf,
      cash,
      netLiquidation: cash + input.baseMarketValue + syntheticMarketValue,
      realizedPnl: input.startingTotals.realizedPnl + syntheticRealizedPnl,
      unrealizedPnl: input.startingTotals.unrealizedPnl + syntheticUnrealizedPnl,
      fees: input.startingTotals.fees + syntheticFees,
    });
  };

  const sellOpenPosition = (sellInput: {
    symbol: string;
    current: NonNullable<ReturnType<typeof open.get>>;
    price: number;
    quantity?: number | null;
    placedAt: Date;
    signalAt: Date;
    signalPrice: number | null;
    signalClose: number | null;
    signalScore?: number | null;
    signalScoreDetails?: Record<string, number> | null;
    watchlists: Array<{ id: string; name: string }>;
    fillSource: string;
    regime?: Record<string, unknown> | null;
  }) => {
    const quantity = Math.min(
      sellInput.current.quantity,
      Math.max(0, Math.floor(sellInput.quantity ?? sellInput.current.quantity)),
    );
    if (quantity <= 0) {
      return;
    }
    const fees = computeShadowOrderFees({
      assetClass: "equity",
      quantity,
      price: sellInput.price,
    });
    const grossAmount = quantity * sellInput.price;
    const realizedPnl =
      (sellInput.price - sellInput.current.averageCost) * quantity - fees;
    const cashDelta = grossAmount - fees;
    cash += cashDelta;
    syntheticFees += fees;
    syntheticRealizedPnl += realizedPnl;
    sellInput.current.lastMark = sellInput.price;
    if (quantity >= sellInput.current.quantity) {
      open.delete(sellInput.symbol);
    } else {
      sellInput.current.quantity -= quantity;
    }
    fills.push({
      symbol: sellInput.symbol,
      side: "sell",
      quantity,
      price: sellInput.price,
      fees,
      grossAmount,
      cashDelta,
      realizedPnl,
      positionKey: sellInput.current.positionKey,
      placedAt: sellInput.placedAt,
      signalAt: sellInput.signalAt,
      signalPrice: sellInput.signalPrice,
      signalClose: sellInput.signalClose,
      signalScore: sellInput.signalScore ?? null,
      signalScoreDetails: sellInput.signalScoreDetails ?? null,
      watchlists: sellInput.watchlists,
      fillSource: sellInput.fillSource,
      regime: sellInput.regime ?? sellInput.current.regime ?? null,
    });
    pushSnapshot(sellInput.placedAt);
  };

  const sellProxyIfOpen = (placedAt: Date, source: string) => {
    if (!activeRegime) {
      return;
    }
    const current = open.get(activeRegime.proxySymbol);
    if (!current) {
      return;
    }
    sellOpenPosition({
      symbol: activeRegime.proxySymbol,
      current,
      price: cents(current.lastMark),
      placedAt,
      signalAt: placedAt,
      signalPrice: cents(current.lastMark),
      signalClose: cents(current.lastMark),
      watchlists: current.watchlists,
      fillSource: source,
      regime: {
        label: activeRegime.label,
        proxySymbol: activeRegime.proxySymbol,
        signalTimeframe: activeRegime.signalTimeframe,
        action: activeRegime.action,
        expiration: activeRegime.expiration,
      },
    });
  };

  const firstBarIndexAfter = (symbol: string, after: Date) => {
    const bars = watchlistBacktestRegularBars(input.barsBySymbol?.get(symbol) ?? []);
    const afterMs = after.getTime();
    let low = 0;
    let high = bars.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((bars[mid]?.atMs ?? 0) <= afterMs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  };

  const flushBarsUntil = (until: Date) => {
    if (!input.barsBySymbol) {
      return;
    }
    for (const [symbol, position] of Array.from(open.entries())) {
      const bars = watchlistBacktestRegularBars(input.barsBySymbol.get(symbol) ?? []);
      while (position.nextBarIndex < bars.length) {
        if (!open.has(symbol)) {
          break;
        }
        const { bar, at: barAt } = bars[position.nextBarIndex]!;
        if (barAt <= position.lastStopCheckedAt) {
          position.nextBarIndex += 1;
          continue;
        }
        if (barAt > until) {
          break;
        }
        position.nextBarIndex += 1;

        const triggered: Array<{ price: number; source: string }> = [];
        if (riskOverlay?.stopLossPercent) {
          const stopPrice =
            position.averageCost * (1 - riskOverlay.stopLossPercent / 100);
          if (bar.l <= stopPrice) {
            triggered.push({ price: stopPrice, source: "stop_loss" });
          }
        }
        if (position.activeTrailingStopPercent) {
          const trailingStopPrice =
            position.highestMark * (1 - position.activeTrailingStopPercent / 100);
          if (bar.l <= trailingStopPrice) {
            triggered.push({
              price: trailingStopPrice,
              source: "trailing_stop",
            });
          }
        }

        if (triggered.length) {
          const activeRiskOverlay = riskOverlay;
          if (!activeRiskOverlay) {
            continue;
          }
          const selected = triggered.sort((left, right) => right.price - left.price)[0]!;
          position.lastStopCheckedAt = barAt;
          sellOpenPosition({
            symbol,
            current: position,
            price: cents(selected.price),
            placedAt: barAt,
            signalAt: barAt,
            signalPrice: cents(selected.price),
            signalClose: cents(bar.c),
            watchlists: position.watchlists,
            fillSource: `risk_${selected.source}:${activeRiskOverlay.label}`,
            regime: position.regime ?? null,
          });
          break;
        }

        position.highestMark = Math.max(position.highestMark, bar.h, bar.c);
        position.lastMark = cents(bar.c);
        position.lastStopCheckedAt = barAt;
      }
    }
  };

  const expireRegimeIfNeeded = (at: Date) => {
    if (!activeRegime?.expiresAt || activeRegime.expiresAt > at) {
      return;
    }
    if (activeRegime.action === "exit_longs_buy_proxy") {
      sellProxyIfOpen(activeRegime.expiresAt, `regime_expire:${activeRegime.label}`);
    }
    activeRegime = null;
  };

  const sessionCloseFor = (date: Date) =>
    zonedDateTimeToUtc({
      marketDate: marketDateKey(date),
      hour: 16,
      minute: 0,
    });

  const regimeRecord = (extra: Record<string, unknown> = {}) =>
    activeRegime
      ? {
          label: activeRegime.label,
          proxySymbol: activeRegime.proxySymbol,
          signalTimeframe: activeRegime.signalTimeframe,
          action: activeRegime.action,
          expiration: activeRegime.expiration,
          activatedAt: activeRegime.activatedAt.toISOString(),
          ...extra,
        }
      : extra;

  const candidateScore = (candidate: WatchlistBacktestSignalCandidate) => {
    const score = readNumber(candidate.signalScore);
    return Number.isFinite(score) && score !== null ? score : 0;
  };

  const replaceWeakestOpenPosition = (
    candidate: WatchlistBacktestSignalCandidate,
    reason: "max_open_positions" | "insufficient_cash",
  ) => {
    if (selectionOverlay.mode !== "ranked_rebalance") {
      return false;
    }
    const incomingScore = candidateScore(candidate);
    let weakest:
      | {
          symbol: string;
          position: NonNullable<ReturnType<typeof open.get>>;
          effectiveScore: number;
        }
      | null = null;

    for (const [symbol, position] of open.entries()) {
      if (symbol === candidate.symbol) {
        continue;
      }
      if (activeRegime && proxySymbolSet.has(symbol)) {
        continue;
      }
      const unrealizedPercent =
        position.averageCost > 0
          ? ((position.lastMark - position.averageCost) / position.averageCost) * 100
          : 0;
      const effectiveScore = position.entryScore + unrealizedPercent * 0.25;
      if (!weakest || effectiveScore < weakest.effectiveScore) {
        weakest = { symbol, position, effectiveScore };
      }
    }

    if (!weakest) {
      return false;
    }
    if (incomingScore < weakest.effectiveScore + selectionOverlay.minScoreEdge) {
      skipped.push({
        symbol: candidate.symbol,
        reason: `ranked_rebalance_${reason}_hurdle`,
        detail: `Incoming score ${incomingScore.toFixed(2)} did not clear weakest open effective score ${weakest.effectiveScore.toFixed(2)} by ${selectionOverlay.minScoreEdge.toFixed(2)}.`,
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return false;
    }

    sellOpenPosition({
      symbol: weakest.symbol,
      current: weakest.position,
      price: cents(weakest.position.lastMark),
      placedAt: candidate.placedAt,
      signalAt: candidate.signalAt,
      signalPrice: candidate.signalPrice,
      signalClose: candidate.signalClose,
      signalScore: candidate.signalScore ?? null,
      signalScoreDetails: candidate.signalScoreDetails ?? null,
      watchlists: weakest.position.watchlists,
      fillSource: `selection_rebalance:${selectionOverlay.label}:${reason}`,
      regime: weakest.position.regime ?? null,
    });
    return true;
  };

  const buyCandidate = (
    candidate: WatchlistBacktestSignalCandidate,
    options: {
      targetNotionalMultiplier?: number;
      fillSource?: string;
      regime?: Record<string, unknown> | null;
    } = {},
  ) => {
    const price = candidate.fillPrice;
    if (!Number.isFinite(price) || price <= 0) {
      skipped.push({
        symbol: candidate.symbol,
        reason: "invalid_fill_price",
        detail: "The signal did not have a usable fill price.",
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return;
    }
    const current = open.get(candidate.symbol);
    if (current || baselineOpenSymbols.has(candidate.symbol)) {
      skipped.push({
        symbol: candidate.symbol,
        reason: "same_symbol_position_open",
        detail: current
          ? "A synthetic position for this symbol was already open."
          : "The Shadow baseline book already has an open position for this symbol.",
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return;
    }
    if (open.size + baselineOpenPositionCount >= sizingOverlay.maxOpenPositions) {
      if (replaceWeakestOpenPosition(candidate, "max_open_positions")) {
        return buyCandidate(candidate, options);
      }
      skipped.push({
        symbol: candidate.symbol,
        reason: "max_open_positions",
        detail: `Synthetic backtest is capped at ${sizingOverlay.maxOpenPositions} total open positions including ${baselineOpenPositionCount} Shadow baseline positions.`,
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return;
    }
    let { quantity, fees } = quantityForCash({
      cash,
      price,
      targetNotional: targetNotional * (options.targetNotionalMultiplier ?? 1),
    });
    if (quantity <= 0) {
      if (replaceWeakestOpenPosition(candidate, "insufficient_cash")) {
        const replacementQuantity = quantityForCash({
          cash,
          price,
          targetNotional: targetNotional * (options.targetNotionalMultiplier ?? 1),
        });
        quantity = replacementQuantity.quantity;
        fees = replacementQuantity.fees;
      }
    }
    if (quantity <= 0) {
      skipped.push({
        symbol: candidate.symbol,
        reason: "insufficient_cash",
        detail: "Available Shadow cash could not buy one whole share after fees.",
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return;
    }
    const grossAmount = quantity * price;
    const cashDelta = -(grossAmount + fees);
    const positionKey = `${WATCHLIST_BACKTEST_SOURCE}:${input.runId}:equity:${candidate.symbol}`;
    cash += cashDelta;
    syntheticFees += fees;
    open.set(candidate.symbol, {
      quantity,
      averageCost: price,
      lastMark: price,
      highestMark: price,
      activeTrailingStopPercent: riskOverlay?.trailingStopPercent ?? null,
      lastStopCheckedAt: candidate.placedAt,
      nextBarIndex: firstBarIndexAfter(candidate.symbol, candidate.placedAt),
      positionKey,
      watchlists: candidate.watchlists,
      entryScore: candidateScore(candidate),
      regime: options.regime ?? null,
    });
    fills.push({
      symbol: candidate.symbol,
      side: "buy",
      quantity,
      price,
      fees,
      grossAmount,
      cashDelta,
      realizedPnl: 0,
      positionKey,
      placedAt: candidate.placedAt,
      signalAt: candidate.signalAt,
      signalPrice: candidate.signalPrice,
      signalClose: candidate.signalClose,
      signalScore: candidate.signalScore ?? null,
      signalScoreDetails: candidate.signalScoreDetails ?? null,
      watchlists: candidate.watchlists,
      fillSource: options.fillSource ?? candidate.fillSource,
      regime: options.regime ?? null,
    });
    pushSnapshot(candidate.placedAt);
  };

  const tightenSellSignalTrail = (
    candidate: WatchlistBacktestSignalCandidate,
    current: NonNullable<ReturnType<typeof open.get>>,
  ) => {
    const sellSignalTrailingStopPercent =
      riskOverlay?.sellSignalTrailingStopPercent ?? null;
    if (
      !sellSignalTrailingStopPercent ||
      proxySymbolSet.has(candidate.symbol) ||
      candidate.fillPrice <= current.averageCost
    ) {
      return false;
    }
    current.highestMark = Math.max(current.highestMark, candidate.fillPrice, current.lastMark);
    current.lastMark = candidate.fillPrice;
    current.lastStopCheckedAt = candidate.placedAt;
    current.activeTrailingStopPercent =
      current.activeTrailingStopPercent === null
        ? sellSignalTrailingStopPercent
        : Math.min(current.activeTrailingStopPercent, sellSignalTrailingStopPercent);
    return true;
  };

  const activateRegime = (candidate: WatchlistBacktestSignalCandidate) => {
    if (!regimeOverlay || candidate.side !== "buy") {
      return;
    }
    activeRegime = {
      proxySymbol: regimeOverlay.proxySymbol,
      signalTimeframe: regimeOverlay.signalTimeframe,
      action: regimeOverlay.action,
      expiration: regimeOverlay.expiration,
      activatedAt: candidate.placedAt,
      expiresAt:
        regimeOverlay.expiration === "fixed_12_5m_bars"
          ? new Date(
              candidate.placedAt.getTime() +
                regimeOverlay.fixedBars * WATCHLIST_BACKTEST_TIMEFRAME_MS["5m"],
            )
          : regimeOverlay.expiration === "session_close"
            ? sessionCloseFor(candidate.placedAt)
            : null,
      label: regimeOverlay.label,
    };
    const regime = regimeRecord({ trigger: "proxy_buy" });
    if (
      regimeOverlay.action === "exit_longs_buy_proxy" ||
      regimeOverlay.action === "scale_down_longs"
    ) {
      for (const [symbol, position] of Array.from(open.entries())) {
        if (proxySymbolSet.has(symbol)) {
          continue;
        }
        const quantity =
          regimeOverlay.action === "scale_down_longs"
            ? Math.floor(position.quantity * regimeOverlay.scaleDownFraction)
            : position.quantity;
        sellOpenPosition({
          symbol,
          current: position,
          quantity,
          price: cents(position.lastMark),
          placedAt: candidate.placedAt,
          signalAt: candidate.signalAt,
          signalPrice: cents(position.lastMark),
          signalClose: cents(position.lastMark),
          watchlists: position.watchlists,
          fillSource: `regime_${regimeOverlay.action}:${regimeOverlay.label}`,
          regime,
        });
      }
    }
    if (regimeOverlay.action === "exit_longs_buy_proxy") {
      buyCandidate(candidate, {
        fillSource: `regime_proxy_entry:${regimeOverlay.label}`,
        regime,
      });
    }
  };

  const handleRegimeSignal = (candidate: WatchlistBacktestSignalCandidate) => {
    if (!regimeOverlay || candidate.symbol !== regimeOverlay.proxySymbol) {
      return;
    }
    if (candidate.side === "buy") {
      activateRegime(candidate);
      return;
    }
    if (
      candidate.side === "sell" &&
      activeRegime?.proxySymbol === candidate.symbol &&
      activeRegime.signalTimeframe === candidate.timeframe
    ) {
      if (activeRegime.action === "exit_longs_buy_proxy") {
        const current = open.get(candidate.symbol);
        if (current) {
          sellOpenPosition({
            symbol: candidate.symbol,
            current,
            price: candidate.fillPrice,
            placedAt: candidate.placedAt,
            signalAt: candidate.signalAt,
            signalPrice: candidate.signalPrice,
            signalClose: candidate.signalClose,
            watchlists: current.watchlists,
            fillSource: `regime_proxy_exit:${activeRegime.label}`,
            regime: regimeRecord({ trigger: "proxy_sell" }),
          });
        }
      }
      activeRegime = null;
    }
  };

  const events = [
    ...input.candidates.map((candidate) => ({ kind: "trade" as const, candidate })),
    ...(regimeOverlay
      ? (input.regimeCandidates ?? []).map((candidate) => ({
          kind: "regime" as const,
          candidate,
        }))
      : []),
  ].sort((left, right) => {
    const timeDelta =
      left.candidate.placedAt.getTime() - right.candidate.placedAt.getTime();
    if (timeDelta) return timeDelta;
    if (left.kind !== right.kind) return left.kind === "regime" ? -1 : 1;
    if (
      left.kind === "trade" &&
      right.kind === "trade" &&
      selectionOverlay.mode !== "first_signal"
    ) {
      if (left.candidate.side !== right.candidate.side) {
        return left.candidate.side === "sell" ? -1 : 1;
      }
      if (left.candidate.side === "buy") {
        const scoreDelta =
          candidateScore(right.candidate) - candidateScore(left.candidate);
        if (scoreDelta) {
          return scoreDelta;
        }
      }
    }
    return left.candidate.symbol.localeCompare(right.candidate.symbol);
  });

  for (const event of events) {
    const candidate = event.candidate;
    flushBarsUntil(candidate.placedAt);
    expireRegimeIfNeeded(candidate.placedAt);
    if (event.kind === "regime") {
      handleRegimeSignal(candidate);
      continue;
    }

    const isProxySymbol = proxySymbolSet.has(candidate.symbol);
    if (regimeOverlay && isProxySymbol) {
      continue;
    }
    if (
      candidate.side === "buy" &&
      getActiveRegime() &&
      !isProxySymbol &&
      getActiveRegime()!.action === "pause_new_longs"
    ) {
      const currentRegime = getActiveRegime()!;
      skipped.push({
        symbol: candidate.symbol,
        reason: "defensive_regime",
        detail: `Defensive regime ${currentRegime.label} paused ordinary long entries.`,
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      continue;
    }
    if (candidate.side === "buy") {
      const currentRegime = getActiveRegime();
      buyCandidate(candidate, {
        targetNotionalMultiplier:
          currentRegime && !isProxySymbol && currentRegime.action === "scale_down_longs"
            ? 1 - regimeOverlay!.scaleDownFraction
            : 1,
        regime: currentRegime && !isProxySymbol ? regimeRecord() : null,
      });
      continue;
    }

    const current = open.get(candidate.symbol);
    if (!current) {
      skipped.push({
        symbol: candidate.symbol,
        reason: "no_synthetic_position",
        detail: "Sell signal skipped because this run had no synthetic long position open.",
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      continue;
    }
    if (tightenSellSignalTrail(candidate, current)) {
      continue;
    }
    sellOpenPosition({
      symbol: candidate.symbol,
      current,
      price: candidate.fillPrice,
      placedAt: candidate.placedAt,
      signalAt: candidate.signalAt,
      signalPrice: candidate.signalPrice,
      signalClose: candidate.signalClose,
      watchlists: candidate.watchlists,
      fillSource: candidate.fillSource,
      regime: current.regime ?? null,
    });
  }

  if (input.windowEnd) {
    flushBarsUntil(input.windowEnd);
    expireRegimeIfNeeded(input.windowEnd);
    pushSnapshot(input.windowEnd);
  }

  return { fills, snapshots, skipped };
}

export async function recomputeShadowAccountFromLedger(
  tx: ShadowTransaction,
  updatedAt: Date,
) {
  const [account] = await tx
    .select()
    .from(shadowAccountsTable)
    .where(eq(shadowAccountsTable.id, currentShadowAccountId()))
    .limit(1);
  if (!account) {
    throw new HttpError(500, "Shadow account is missing.", {
      code: "shadow_account_missing",
      expose: true,
    });
  }
  // Distinct order ids referenced by the ledger — small, instead of transferring
  // every fill row into JS. The analytics filter stays in JS (it reads
  // order.payload / clientOrderId, deliberately NOT duplicated into SQL), and the
  // cash/realizedPnl/fees fold is then done set-based in SQL. This keeps the
  // recompute from pulling the whole fill ledger across the wire and folding it in
  // JS inside the held write transaction — a cost that grew unbounded with ledger
  // size. Behavior-equal: same qualifying fills; SQL SUM over numeric(20,6) values
  // equals the JS float reduce at money()'s 6-decimal rounding.
  const orderIdRows = await tx
    .selectDistinct({ orderId: shadowFillsTable.orderId })
    .from(shadowFillsTable)
    .where(eq(shadowFillsTable.accountId, currentShadowAccountId()));
  const orderIds = orderIdRows.map((row) => row.orderId);
  // Memoized classification: fetch only orders not yet classified, and only
  // the three columns the classifier reads. Steady state is one new small row
  // per event instead of the whole order history's jsonb payloads (see memo
  // comment at shadowLedgerAnalyticsOrderMemo).
  const generationAtFetch = shadowLedgerAnalyticsMemoGeneration;
  const unknownOrderIds = orderIds.filter(
    (orderId) => !shadowLedgerAnalyticsOrderMemo.has(orderId),
  );
  const freshClassifications = new Map<string, boolean>();
  if (unknownOrderIds.length) {
    const rows = await tx
      .select({
        id: shadowOrdersTable.id,
        source: shadowOrdersTable.source,
        clientOrderId: shadowOrdersTable.clientOrderId,
        payload: shadowOrdersTable.payload,
      })
      .from(shadowOrdersTable)
      .where(inArray(shadowOrdersTable.id, unknownOrderIds));
    for (const row of rows) {
      freshClassifications.set(row.id, isDefaultShadowLedgerAnalyticsOrder(row));
    }
    // Skip memoization when a classification-input update raced this fetch —
    // the fresh values still serve THIS recompute; the next one re-reads.
    // Rows missing from the fetch (e.g. another tx's uncommitted order) stay
    // unmemoized so they are re-fetched once committed.
    if (generationAtFetch === shadowLedgerAnalyticsMemoGeneration) {
      for (const [orderId, qualifies] of freshClassifications) {
        if (
          shadowLedgerAnalyticsOrderMemo.size >= SHADOW_LEDGER_ANALYTICS_MEMO_MAX
        ) {
          const oldest = shadowLedgerAnalyticsOrderMemo.keys().next().value;
          if (oldest !== undefined) {
            shadowLedgerAnalyticsOrderMemo.delete(oldest);
          }
        }
        shadowLedgerAnalyticsOrderMemo.set(orderId, qualifies);
      }
    }
  }
  const ledgerOrderIds = orderIds.filter(
    (orderId) =>
      freshClassifications.get(orderId) ??
      shadowLedgerAnalyticsOrderMemo.get(orderId) ??
      false,
  );
  const startingBalance = toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE;
  let cashDelta = 0;
  let realizedPnl = 0;
  let fees = 0;
  if (ledgerOrderIds.length) {
    const [totals] = await tx
      .select({
        cashDelta: sql<string>`coalesce(sum(${shadowFillsTable.cashDelta}), 0)`,
        realizedPnl: sql<string>`coalesce(sum(${shadowFillsTable.realizedPnl}), 0)`,
        fees: sql<string>`coalesce(sum(${shadowFillsTable.fees}), 0)`,
      })
      .from(shadowFillsTable)
      .where(
        and(
          eq(shadowFillsTable.accountId, currentShadowAccountId()),
          inArray(shadowFillsTable.orderId, ledgerOrderIds),
        ),
      );
    cashDelta = toNumber(totals?.cashDelta) ?? 0;
    realizedPnl = toNumber(totals?.realizedPnl) ?? 0;
    fees = toNumber(totals?.fees) ?? 0;
  }
  await tx
    .update(shadowAccountsTable)
    .set({
      cash: money(startingBalance + cashDelta),
      realizedPnl: money(realizedPnl),
      fees: money(fees),
      updatedAt,
    })
    .where(eq(shadowAccountsTable.id, currentShadowAccountId()));
}

function compactMarketDateForSource(value: string) {
  return value.replaceAll("-", "");
}

function watchlistBacktestSnapshotSource(rangeKey: string) {
  const [from, to] = rangeKey.split(":");
  if (from && to) {
    return `watchlist_bt:${compactMarketDateForSource(from)}:${compactMarketDateForSource(to)}`;
  }
  return `${WATCHLIST_BACKTEST_SOURCE}:${rangeKey}`;
}

function watchlistBacktestSnapshotSourcesForRange(input: {
  marketDateFrom: string;
  marketDateTo: string;
  rangeKey: string;
}) {
  return Array.from(
    new Set(
      [
        input.rangeKey,
        ...marketDatesBetween(input.marketDateFrom, input.marketDateTo),
      ].map(watchlistBacktestSnapshotSource),
    ),
  );
}

function watchlistBacktestOrderMatchesRange(
  payload: unknown,
  input: {
    marketDateFrom: string;
    marketDateTo: string;
    rangeKey: string;
    replaceAll?: boolean;
  },
) {
  if (input.replaceAll) {
    return true;
  }
  const payloadRecord = readRecord(payload) ?? {};
  const metadata = readRecord(payloadRecord.metadata) ?? {};
  const marketDate = readString(metadata.marketDate);
  const rangeKey = readString(metadata.rangeKey);
  return (
    rangeKey === input.rangeKey ||
    Boolean(
      marketDate &&
        marketDate >= input.marketDateFrom &&
        marketDate <= input.marketDateTo,
    )
  );
}

async function deleteWatchlistBacktestRowsForRange(
  tx: ShadowTransaction,
  input: {
    marketDateFrom: string;
    marketDateTo: string;
    rangeKey: string;
    windowStart: Date;
    cleanupEnd: Date;
    replaceAll?: boolean;
  },
) {
  const orders = await tx
    .select()
    .from(shadowOrdersTable)
    .where(
      and(
        eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowOrdersTable.source, WATCHLIST_BACKTEST_SOURCE),
      ),
    );
  const matchingOrders = orders.filter((order) => {
    return watchlistBacktestOrderMatchesRange(order.payload, input);
  });
  const orderIds = matchingOrders.map((order) => order.id);
  const positionKeys = Array.from(
    new Set(
      matchingOrders
        .map((order) => {
          const payload = readRecord(order.payload) ?? {};
          const metadata = readRecord(payload.metadata) ?? {};
          return readString(metadata.positionKey) ?? readString(payload.positionKey);
        })
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (positionKeys.length) {
    const positions = await tx
      .select({ id: shadowPositionsTable.id })
      .from(shadowPositionsTable)
      .where(
        and(
          eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
          inArray(shadowPositionsTable.positionKey, positionKeys),
        ),
      );
    const positionIds = positions.map((position) => position.id);
    if (positionIds.length) {
      await tx
        .delete(shadowPositionMarksTable)
        .where(inArray(shadowPositionMarksTable.positionId, positionIds));
    }
    await tx
      .delete(shadowPositionsTable)
      .where(
        and(
          eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
          inArray(shadowPositionsTable.positionKey, positionKeys),
        ),
      );
  }

  if (orderIds.length) {
    await tx
      .delete(shadowFillsTable)
      .where(
        and(
          eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID),
          inArray(shadowFillsTable.orderId, orderIds),
        ),
      );
    await tx
      .delete(shadowOrdersTable)
      .where(
        and(
          eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID),
          inArray(shadowOrdersTable.id, orderIds),
        ),
      );
  }

  if (input.replaceAll) {
    await tx
      .delete(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
          eq(shadowBalanceSnapshotsTable.source, WATCHLIST_BACKTEST_MARK_SOURCE),
        ),
      );
    await tx
      .delete(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
          sql`${shadowBalanceSnapshotsTable.source} like ${`${WATCHLIST_BACKTEST_SOURCE}:%`}`,
        ),
      );
    await tx
      .delete(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
          sql`${shadowBalanceSnapshotsTable.source} like ${"watchlist_bt:%"}`,
        ),
      );
  } else {
    for (const source of watchlistBacktestSnapshotSourcesForRange(input)) {
      await tx
        .delete(shadowBalanceSnapshotsTable)
        .where(
          and(
            eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
            eq(shadowBalanceSnapshotsTable.source, source),
          ),
        );
    }
    await tx
      .delete(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
          eq(shadowBalanceSnapshotsTable.source, WATCHLIST_BACKTEST_MARK_SOURCE),
          gte(shadowBalanceSnapshotsTable.asOf, input.windowStart),
          lte(shadowBalanceSnapshotsTable.asOf, input.cleanupEnd),
        ),
      );
  }

  return {
    deletedOrders: orderIds.length,
    deletedPositionKeys: positionKeys.length,
  };
}

async function resetWatchlistBacktestRowsForRange(input: {
  marketDateFrom: string;
  marketDateTo: string;
  rangeKey: string;
  windowStart: Date;
  cleanupEnd: Date;
  replaceAll?: boolean;
}) {
  await db.transaction(async (tx) => {
    await deleteWatchlistBacktestRowsForRange(tx, input);
    await recomputeShadowAccountFromLedger(tx, new Date());
  });
}

function signalOptionsReplayOrderMatchesDate(
  payload: unknown,
  input: { deploymentId: string; marketDate: string },
) {
  return signalOptionsReplayOrderMatchesRange(payload, {
    deploymentId: input.deploymentId,
    marketDateFrom: input.marketDate,
    marketDateTo: input.marketDate,
  });
}

function isDateKeyInRange(
  value: string | null,
  input: { marketDateFrom: string; marketDateTo: string },
) {
  return Boolean(
    value &&
      value >= input.marketDateFrom &&
      value <= input.marketDateTo,
  );
}

function signalOptionsReplayPayloadMatchesDeployment(
  payload: unknown,
  input: { deploymentId: string },
) {
  const payloadRecord = readRecord(payload) ?? {};
  const replay = readRecord(payloadRecord.replay) ?? {};
  const metadata = readRecord(payloadRecord.metadata) ?? {};
  return (
    readString(replay.source) === SIGNAL_OPTIONS_REPLAY_SOURCE &&
    (readString(replay.deploymentId) ?? readString(metadata.deploymentId)) ===
      input.deploymentId
  );
}

function signalOptionsReplayOrderMatchesRange(
  payload: unknown,
  input: {
    deploymentId: string;
    marketDateFrom: string;
    marketDateTo: string;
  },
) {
  if (!signalOptionsReplayPayloadMatchesDeployment(payload, input)) {
    return false;
  }
  const payloadRecord = readRecord(payload) ?? {};
  const replay = readRecord(payloadRecord.replay) ?? {};
  const metadata = readRecord(payloadRecord.metadata) ?? {};
  return (
    isDateKeyInRange(readString(replay.marketDate), input) ||
    isDateKeyInRange(readString(metadata.marketDate), input) ||
    isDateKeyInRange(readString(metadata.positionMarketDate), input)
  );
}

function isDateInClosedRange(value: Date, start: Date, end: Date) {
  const time = value.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function signalOptionsReplayOrderSourceMatchesRange(
  order: ShadowOrderRow,
  input: { windowStart: Date; cleanupEnd: Date },
) {
  return (
    order.source === SIGNAL_OPTIONS_REPLAY_SOURCE &&
    isDateInClosedRange(order.placedAt, input.windowStart, input.cleanupEnd)
  );
}

export async function resetSignalOptionsReplayRowsForDate(input: {
  deploymentId: string;
  marketDate: string;
}) {
  const dayStart = new Date(`${input.marketDate}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  return resetSignalOptionsReplayRowsForRange({
    deploymentId: input.deploymentId,
    marketDateFrom: input.marketDate,
    marketDateTo: input.marketDate,
    windowStart: dayStart,
    cleanupEnd: dayEnd,
  });
}

export async function resetSignalOptionsReplayRowsForRange(input: {
  deploymentId: string;
  marketDateFrom: string;
  marketDateTo: string;
  windowStart: Date;
  cleanupEnd: Date;
}) {
  const matchingEvents = (
    await db
      .select()
      .from(executionEventsTable)
      .where(eq(executionEventsTable.deploymentId, input.deploymentId))
  ).filter(
    (event) =>
      signalOptionsReplayPayloadMatchesDeployment(event.payload, input) &&
      (signalOptionsReplayOrderMatchesRange(event.payload, input) ||
        isDateInClosedRange(event.occurredAt, input.windowStart, input.cleanupEnd)),
  );
  const matchingEventIds = matchingEvents.map((event) => event.id);

  await db.transaction(async (tx) => {
    const replayCandidateOrders = await tx
      .select()
      .from(shadowOrdersTable)
      .where(
        eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID),
      );
    const matchingOrders = replayCandidateOrders.filter(
      (order) =>
        (signalOptionsReplayPayloadMatchesDeployment(order.payload, input) &&
          (signalOptionsReplayOrderMatchesRange(order.payload, input) ||
            isDateInClosedRange(order.placedAt, input.windowStart, input.cleanupEnd))) ||
        signalOptionsReplayOrderSourceMatchesRange(order, input),
    );
    const orderIds = matchingOrders.map((order) => order.id);
    const positionKeys = Array.from(
      new Set(
        matchingOrders
          .map((order) => {
            const payload = readRecord(order.payload) ?? {};
            const metadata = readRecord(payload.metadata) ?? {};
            return readString(metadata.positionKey) ?? readString(payload.positionKey);
          })
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (positionKeys.length) {
      const positions = await tx
        .select({ id: shadowPositionsTable.id })
        .from(shadowPositionsTable)
        .where(
          and(
            eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
            inArray(shadowPositionsTable.positionKey, positionKeys),
          ),
        );
      const positionIds = positions.map((position) => position.id);
      if (positionIds.length) {
        await tx
          .delete(shadowPositionMarksTable)
          .where(inArray(shadowPositionMarksTable.positionId, positionIds));
      }
      await tx
        .delete(shadowPositionsTable)
        .where(
          and(
            eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
            inArray(shadowPositionsTable.positionKey, positionKeys),
          ),
        );
    }

    if (orderIds.length) {
      await tx
        .delete(shadowFillsTable)
        .where(
          and(
            eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID),
            inArray(shadowFillsTable.orderId, orderIds),
          ),
        );
      await tx
        .delete(shadowOrdersTable)
        .where(
          and(
            eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID),
            inArray(shadowOrdersTable.id, orderIds),
          ),
        );
    }

    await tx
      .delete(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
          inArray(shadowBalanceSnapshotsTable.source, [
            SIGNAL_OPTIONS_REPLAY_SOURCE,
            SIGNAL_OPTIONS_REPLAY_MARK_SOURCE,
          ]),
          gte(shadowBalanceSnapshotsTable.asOf, input.windowStart),
          lte(shadowBalanceSnapshotsTable.asOf, input.cleanupEnd),
        ),
      );

    if (matchingEventIds.length) {
      await tx
        .delete(executionEventsTable)
        .where(inArray(executionEventsTable.id, matchingEventIds));
    }

    await recomputeShadowAccountFromLedger(tx, new Date());
  });
  invalidateShadowFreshStateCache();
  notifyShadowAccountChanged();
  return {
    deletedEvents: matchingEventIds.length,
  };
}

async function insertWatchlistBacktestFills(input: {
  runId: string;
  marketDateFrom: string;
  marketDateTo: string;
  rangeKey: string;
  windowStart: Date;
  cleanupEnd: Date;
  replaceAll?: boolean;
  riskOverlay?: WatchlistBacktestRiskOverlay | null;
  sizingOverlay?: WatchlistBacktestSizingOverlay | null;
  selectionOverlay?: WatchlistBacktestSelectionOverlay | null;
  entryGateOverlay?: WatchlistBacktestEntryGateOverlay | null;
  fills: WatchlistBacktestFill[];
  snapshots: ReturnType<typeof buildWatchlistBacktestFills>["snapshots"];
}) {
  await db.transaction(async (tx) => {
    await deleteWatchlistBacktestRowsForRange(tx, input);

    for (let index = 0; index < input.fills.length; index += 1) {
      const fill = input.fills[index]!;
      const orderId = randomUUID();
      const fillId = randomUUID();
      const fillMarketDate = marketDateKey(fill.placedAt);
      const positionType = classifyAccountPositionType({
        symbol: fill.symbol,
        assetClass: "equity",
      });
      const payload = {
        metadata: {
          source: WATCHLIST_BACKTEST_SOURCE,
          runId: input.runId,
          rangeKey: input.rangeKey,
          marketDate: fillMarketDate,
          marketDateFrom: input.marketDateFrom,
          marketDateTo: input.marketDateTo,
          riskOverlay: input.riskOverlay ?? null,
          sizingOverlay: input.sizingOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SIZING,
          selectionOverlay:
            input.selectionOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SELECTION,
          entryGateOverlay: input.entryGateOverlay ?? null,
          positionKey: fill.positionKey,
          signalAt: fill.signalAt.toISOString(),
          signalPrice: fill.signalPrice,
          signalClose: fill.signalClose,
          signalScore: fill.signalScore ?? null,
          signalScoreDetails: fill.signalScoreDetails ?? null,
          fillSource: fill.fillSource,
          watchlists: fill.watchlists,
          regime: fill.regime ?? null,
        },
      };
      await tx.insert(shadowOrdersTable).values({
        id: orderId,
        accountId: SHADOW_ACCOUNT_ID,
        source: WATCHLIST_BACKTEST_SOURCE,
        sourceEventId: null,
        clientOrderId: `shadow-watchlist-backtest-${input.rangeKey}-${input.runId}-${index + 1}`,
        symbol: fill.symbol,
        assetClass: "equity",
        positionType,
        side: fill.side,
        type: "market",
        timeInForce: "day",
        status: "filled",
        quantity: money(fill.quantity),
        filledQuantity: money(fill.quantity),
        averageFillPrice: money(fill.price),
        fees: money(fill.fees),
        optionContract: null,
        payload,
        placedAt: fill.placedAt,
        filledAt: fill.placedAt,
      });
      await tx.insert(shadowFillsTable).values({
        id: fillId,
        accountId: SHADOW_ACCOUNT_ID,
        orderId,
        sourceEventId: null,
        symbol: fill.symbol,
        assetClass: "equity",
        positionType,
        side: fill.side,
        quantity: money(fill.quantity),
        price: money(fill.price),
        grossAmount: money(fill.grossAmount),
        fees: money(fill.fees),
        realizedPnl: money(fill.realizedPnl),
        cashDelta: money(fill.cashDelta),
        optionContract: null,
        occurredAt: fill.placedAt,
      });
      await upsertPositionForFill(tx, {
        symbol: fill.symbol,
        assetClass: "equity",
        optionContract: null,
        positionKey: fill.positionKey,
        side: fill.side,
        quantity: fill.quantity,
        price: fill.price,
        fees: fill.fees,
        realizedPnl: fill.realizedPnl,
        multiplier: 1,
        occurredAt: fill.placedAt,
      });
    }
    await recomputeShadowAccountFromLedger(tx, new Date());
  });
}

export const __shadowWatchlistBacktestInternalsForTests = {
  invalidateShadowFreshStateCache,
  invalidateShadowReadCachesAfterBackgroundMarkRefresh,
  setShadowReadCacheWindowsForTests(input: {
    ttlMs?: number | null;
    staleTtlMs?: number | null;
    staleWaitMs?: number | null;
  }) {
    shadowReadCacheTtlMsForTests =
      typeof input.ttlMs === "number" ? Math.max(0, input.ttlMs) : null;
    shadowReadCacheStaleTtlMsForTests =
      typeof input.staleTtlMs === "number"
        ? Math.max(0, input.staleTtlMs)
        : null;
    shadowReadCacheStaleWaitMsForTests =
      typeof input.staleWaitMs === "number"
        ? Math.max(0, input.staleWaitMs)
        : null;
  },
  setShadowOptionQuoteCacheWindowsForTests(input: {
    ttlMs?: number | null;
    staleTtlMs?: number | null;
  }) {
    shadowOptionQuoteCacheTtlMsForTests =
      typeof input.ttlMs === "number" ? Math.max(0, input.ttlMs) : null;
    shadowOptionQuoteCacheStaleTtlMsForTests =
      typeof input.staleTtlMs === "number"
        ? Math.max(0, input.staleTtlMs)
        : null;
  },
  clearShadowOptionQuoteCachesForTests() {
    shadowOptionQuoteCache.clear();
    shadowOptionGreekQuoteCache.clear();
  },
  setResolveEquityMarkForTests(resolver: typeof resolveEquityMarkForTests) {
    resolveEquityMarkForTests = resolver;
  },
  rememberShadowOptionQuoteForTests: rememberShadowOptionQuote,
  readCachedShadowOptionQuotesForTests: readCachedShadowOptionQuotes,
  readShadowDashboardFillsWithOrdersForTests: readShadowDashboardFillsWithOrders,
  withShadowReadCache,
  getShadowAccountReadDiagnostics,
  resetShadowAccountReadDiagnosticsForTests,
  buildFastShadowPositionsResponseFromRows,
  shadowClosedTradesReadCacheKey,
  buildShadowAnalysisRoundTrips,
  shadowRoundTripToClosedTrade,
  shadowTradeEventToActivityTrade,
  shadowTradeMatchesClosedTradeInput,
  readReusableShadowPositionsResponseForAssetClass,
  filterShadowAccountPositionsResponseForAssetClass,
  applyShadowAccountPositionWeights,
  trackShadowFreshStateRefresh,
  getShadowFreshStateInFlight: () =>
    shadowFreshStateInFlight.get(currentShadowAccountId()) ?? null,
  getShadowFreshStateCache: () =>
    shadowFreshStateCache.get(currentShadowAccountId()) ?? null,
  resolveWatchlistBacktestWindow,
  isWatchlistBacktestRegularSessionTime,
  watchlistBacktestHydrationStart,
  previousWeekdayOrSame,
  addWeekdaysToMarketDate,
  watchlistBacktestOrderMatchesRange,
  signalOptionsReplayOrderMatchesDate,
  signalOptionsReplayOrderMatchesRange,
  signalOptionsReplayOrderSourceMatchesRange,
  isSimulationShadowOrderSource,
  shadowOrderEffectiveSource,
  shadowBalanceSnapshotSourceForOrder,
  shadowPositionMarketDataSymbol,
  latestHistoricalShadowTotalsDate,
  isLiveShadowOrder,
  isDefaultShadowLedgerAnalyticsOrder,
  mergeShadowActivityTrades,
  isLiveShadowPosition,
  isDefaultShadowLedgerAnalyticsPosition,
  isExpiredHistoricalShadowOptionPosition,
  readOpenShadowPositionsForSource,
  shouldCloseOptionForShadowMaintenance,
  isShadowOptionTradingSession,
  enforceSignalOptionsTrailingStopFromShadowMarkSafely,
  getSignalOptionsTrailingStopEnforcementFailureDiagnostics,
  resetSignalOptionsTrailingStopEnforcementFailureDiagnosticsForTests,
  isLiveShadowAutomationPayload,
  isHistoricalSignalOptionsShadowOrder,
  isSignalOptionsBackfillShadowOrder,
  isHistoricalSignalOptionsShadowEvent,
  isSignalOptionsAutomationMirrorEvent,
  shouldRepairSignalOptionsAutomationMirrors,
  repairSignalOptionsAutomationMirrorsForRead,
  buildShadowAutomationContext,
  buildShadowPositionRiskOverlay,
  estimateShadowOptionGreeks,
  resolveHistoricalBackfillExpirationExitPrice,
  shadowPositionKeyForOrder,
  shadowPositionKeysForOrders,
  shadowMarkSnapshotSourceForPosition,
  isExpiredOptionContractForShadowClose,
  withCurrentOpenPositionTerminalTimestamp,
  watchlistBacktestSnapshotSource,
  watchlistBacktestSnapshotSourcesForRange,
  collectWatchlistBacktestUniverse,
  withWatchlistBacktestProxyUniverse,
  computeWatchlistBacktestStartingBook,
  selectShadowEquityHistoryRows,
  filterShadowEquityHistoryRowsToLiveLedger,
  buildDefaultShadowEquityHistoryRows,
  compactShadowEquityHistoryRows,
  shadowReusableEquityHistoryRange,
  sliceShadowAccountEquityHistoryToRange,
  shadowEquityHistoryBucketSizeMs,
  bucketShadowEquityHistoryRows,
  selectLatestShadowPositionMarksByPositionId,
  buildShadowPositionDayChange,
  shadowPositionDayChangeBaselineMarketValue,
  shadowPositionDayChangeDayStart,
  buildShadowPositionDayChangeFromQuote,
  shadowMassiveOptionTicker,
  shadowMassiveOptionDayChangeQuote,
  calculateLatestShadowMarketDayPnlFromHistory,
  shadowQuoteMarkPrice,
  buildShadowOptionPricingPolicy,
  computeSignalOptionsShadowMarkExitDecision,
  signalOptionsShadowExitEventIsDuplicate,
  shadowOptionQuoteValuationBlockReason,
  shadowOptionQuoteIdentifier,
  isPriorOptionExpiration,
  buildShadowTradeDiagnosticsFromRows,
  summarizeWatchlistBacktestClosedTrades,
  summarizeWatchlistBacktestBuyHoldBenchmark,
  buildWatchlistBacktestSweepVariants,
  normalizeWatchlistBacktestEntryGateOverlay,
  applyWatchlistBacktestEntryGate,
  markShadowAccountDbUnavailable,
  isShadowAccountDbBackoffActive,
  clearShadowAccountDbBackoff,
};

function watchlistBacktestOpenSymbols(fills: WatchlistBacktestFill[]) {
  return new Set(
    fills.reduce<string[]>((symbols, fill) => {
      if (fill.side === "buy") {
        symbols.push(fill.symbol);
      } else {
        const index = symbols.lastIndexOf(fill.symbol);
        if (index >= 0) {
          symbols.splice(index, 1);
        }
      }
      return symbols;
    }, []),
  );
}

function watchlistBacktestMaxDrawdownPercent(
  snapshots: ReturnType<typeof buildWatchlistBacktestFills>["snapshots"],
  startingNetLiquidation: number,
) {
  let highWaterMark = Math.max(startingNetLiquidation, 0);
  let maxDrawdownPercent = 0;
  for (const snapshot of snapshots) {
    const nav = snapshot.netLiquidation;
    if (!Number.isFinite(nav) || nav <= 0) {
      continue;
    }
    highWaterMark = Math.max(highWaterMark, nav);
    if (highWaterMark > 0) {
      maxDrawdownPercent = Math.min(
        maxDrawdownPercent,
        ((nav - highWaterMark) / highWaterMark) * 100,
      );
    }
  }
  return maxDrawdownPercent;
}

function watchlistBacktestLastMarkAtOrBefore(input: {
  symbol: string;
  barsBySymbol?: Map<string, PyrusSignalsBar[]>;
  windowEnd?: Date | null;
}) {
  const bars = watchlistBacktestRegularBars(
    input.barsBySymbol?.get(input.symbol) ?? [],
  );
  if (!bars.length) {
    return null;
  }
  const endMs = input.windowEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const entry = bars[index]!;
    if (entry.atMs <= endMs && Number.isFinite(entry.bar.c) && entry.bar.c > 0) {
      return cents(entry.bar.c);
    }
  }
  return null;
}

function watchlistBacktestFirstMarkAtOrAfter(input: {
  symbol: string;
  barsBySymbol?: Map<string, PyrusSignalsBar[]>;
  windowStart?: Date | null;
}) {
  const bars = watchlistBacktestRegularBars(
    input.barsBySymbol?.get(input.symbol) ?? [],
  );
  if (!bars.length) {
    return null;
  }
  const startMs = input.windowStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  for (const entry of bars) {
    if (entry.atMs >= startMs && Number.isFinite(entry.bar.c) && entry.bar.c > 0) {
      return cents(entry.bar.c);
    }
  }
  return null;
}

function summarizeWatchlistBacktestClosedTrades(
  fills: WatchlistBacktestFill[],
) {
  const closedTradePnls = fills
    .filter((fill) => fill.side === "sell")
    .map((fill) => fill.realizedPnl)
    .filter(Number.isFinite);
  const winners = closedTradePnls.filter((pnl) => pnl > 0);
  const losers = closedTradePnls.filter((pnl) => pnl < 0);
  const grossProfit = winners.reduce((sum, value) => sum + value, 0);
  const grossLoss = losers.reduce((sum, value) => sum + value, 0);
  const closedTrades = closedTradePnls.length;
  return {
    closedTrades,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRatePercent: closedTrades ? (winners.length / closedTrades) * 100 : null,
    averageWin: winners.length ? grossProfit / winners.length : null,
    averageLoss: losers.length ? grossLoss / losers.length : null,
    expectancy: closedTrades
      ? closedTradePnls.reduce((sum, value) => sum + value, 0) / closedTrades
      : null,
    profitFactor:
      grossLoss < 0
        ? grossProfit / Math.abs(grossLoss)
        : grossProfit > 0
          ? null
          : null,
  };
}

function summarizeWatchlistBacktestBuyHoldBenchmark(input: {
  fills: WatchlistBacktestFill[];
  barsBySymbol?: Map<string, PyrusSignalsBar[]>;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  benchmarkCapital: number;
  strategyPnl: number;
  targetMultiple: number;
}) {
  const tradedSymbols = Array.from(
    new Set(
      input.fills
        .filter((fill) => fill.side === "buy")
        .map((fill) => normalizeSymbol(fill.symbol).toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
  let matchedBuyHoldPnl = 0;
  let benchmarkableSymbols = 0;
  const benchmarkCapital = Math.max(0, input.benchmarkCapital);
  const perSymbolCapital = tradedSymbols.length
    ? benchmarkCapital / tradedSymbols.length
    : 0;

  for (const symbol of tradedSymbols) {
    const startMark = watchlistBacktestFirstMarkAtOrAfter({
      symbol,
      barsBySymbol: input.barsBySymbol,
      windowStart: input.windowStart,
    });
    const finalMark = watchlistBacktestLastMarkAtOrBefore({
      symbol,
      barsBySymbol: input.barsBySymbol,
      windowEnd: input.windowEnd,
    });
    if (startMark === null || finalMark === null || startMark <= 0) {
      continue;
    }
    benchmarkableSymbols += 1;
    matchedBuyHoldPnl += perSymbolCapital * (finalMark / startMark - 1);
  }

  const targetBuyHoldPnl =
    matchedBuyHoldPnl > 0 ? matchedBuyHoldPnl * input.targetMultiple : 0;
  const alphaVsBuyHold = input.strategyPnl - matchedBuyHoldPnl;
  return {
    strategyMatchedPnl: input.strategyPnl,
    matchedBuyHoldPnl,
    alphaVsBuyHold,
    outperformanceMultiple:
      matchedBuyHoldPnl > 0 ? input.strategyPnl / matchedBuyHoldPnl : null,
    targetOutperformanceMultiple: input.targetMultiple,
    targetBuyHoldPnl,
    targetPnlDelta: input.strategyPnl - targetBuyHoldPnl,
    benchmarkCapital,
    tradedSymbols: tradedSymbols.length,
    benchmarkableSymbols,
    benchmarkSkippedSymbols: tradedSymbols.length - benchmarkableSymbols,
  };
}

function summarizeWatchlistBacktestSimulation(input: {
  simulation: ReturnType<typeof buildWatchlistBacktestFills>;
  startingTotals: ShadowTotals;
  finalTotals?: ShadowTotals | null;
  commonSkippedCount: number;
  barsBySymbol?: Map<string, PyrusSignalsBar[]>;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  targetOutperformanceMultiple?: number;
}) {
  const realizedPnl = input.simulation.fills.reduce(
    (sum, fill) => sum + fill.realizedPnl,
    0,
  );
  const fees = input.simulation.fills.reduce((sum, fill) => sum + fill.fees, 0);
  const buys = input.simulation.fills.filter((fill) => fill.side === "buy");
  const sells = input.simulation.fills.filter((fill) => fill.side === "sell");
  const proxyFills = input.simulation.fills.filter((fill) =>
    WATCHLIST_BACKTEST_PROXY_SYMBOLS.includes(fill.symbol as never),
  );
  const ordinaryLongFills = input.simulation.fills.length - proxyFills.length;
  const openSyntheticSymbols = watchlistBacktestOpenSymbols(input.simulation.fills);
  const lastSnapshot = input.simulation.snapshots.at(-1) ?? null;
  const endingNetLiquidation =
    lastSnapshot?.netLiquidation ?? input.startingTotals.netLiquidation;
  const totalPnl = endingNetLiquidation - input.startingTotals.netLiquidation;
  const closedTradeMetrics = summarizeWatchlistBacktestClosedTrades(
    input.simulation.fills,
  );
  const benchmarkMetrics = summarizeWatchlistBacktestBuyHoldBenchmark({
    fills: input.simulation.fills,
    barsBySymbol: input.barsBySymbol,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    benchmarkCapital: input.startingTotals.cash,
    strategyPnl: totalPnl,
    targetMultiple:
      input.targetOutperformanceMultiple ??
      WATCHLIST_BACKTEST_TARGET_OUTPERFORMANCE_MULTIPLE,
  });
  return {
    ordersCreated: input.simulation.fills.length,
    entries: buys.length,
    exits: sells.length,
    ...closedTradeMetrics,
    openSyntheticPositions: openSyntheticSymbols.size,
    skippedSignals: input.commonSkippedCount + input.simulation.skipped.length,
    realizedPnl,
    fees,
    endingNetLiquidation,
    endingCash: lastSnapshot?.cash ?? input.startingTotals.cash,
    maxDrawdownPercent: watchlistBacktestMaxDrawdownPercent(
      input.simulation.snapshots,
      input.startingTotals.netLiquidation,
    ),
    proxyFills: proxyFills.length,
    ordinaryLongFills,
    totalPnl,
    benchmark: benchmarkMetrics,
  };
}

function watchlistBacktestFillResponse(fill: WatchlistBacktestFill) {
  return {
    symbol: fill.symbol,
    side: fill.side,
    quantity: fill.quantity,
    price: fill.price,
    fees: fill.fees,
    realizedPnl: fill.realizedPnl,
    placedAt: fill.placedAt,
    signalAt: fill.signalAt,
    signalScore: fill.signalScore ?? null,
    signalScoreDetails: fill.signalScoreDetails ?? null,
    watchlists: fill.watchlists,
    regime: fill.regime ?? null,
  };
}

function buildWatchlistBacktestRunResponse(input: {
  runId: string;
  persisted: boolean;
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
  timeframe: ShadowWatchlistBacktestTimeframe;
  riskOverlay: WatchlistBacktestRiskOverlay | null;
  sizingOverlay: WatchlistBacktestSizingOverlay;
  selectionOverlay: WatchlistBacktestSelectionOverlay;
  entryGateOverlay: WatchlistBacktestEntryGateOverlay | null;
  regimeOverlay: WatchlistBacktestRegimeOverlay | null;
  targetOutperformanceMultiple: number;
  startingTotals: ShadowTotals;
  startingBook?: Pick<
    WatchlistBacktestStartingBook,
    "existingOpenPositionCount" | "existingOpenSymbols"
  > | null;
  watchlists: Awaited<ReturnType<typeof listWatchlists>>["watchlists"];
  universe: ReturnType<typeof collectWatchlistBacktestUniverse>;
  signalScan: Awaited<ReturnType<typeof collectWatchlistBacktestSignals>>;
  simulation: ReturnType<typeof buildWatchlistBacktestFills>;
  finalTotals?: ShadowTotals | null;
  sweep?: Record<string, unknown> | null;
}) {
  const metrics = summarizeWatchlistBacktestSimulation({
    simulation: input.simulation,
    startingTotals: input.startingTotals,
    finalTotals: input.finalTotals,
    commonSkippedCount: input.signalScan.skipped.length,
    barsBySymbol: input.signalScan.barsBySymbol,
    windowStart: input.window.start,
    windowEnd: input.window.end,
    targetOutperformanceMultiple: input.targetOutperformanceMultiple,
  });
  return {
    runId: input.runId,
    source: WATCHLIST_BACKTEST_SOURCE,
    persisted: input.persisted,
    marketDate: input.window.marketDate,
    marketDateFrom: input.window.marketDateFrom,
    marketDateTo: input.window.marketDateTo,
    rangeKey: input.window.rangeKey,
    timeframe: input.timeframe,
    riskOverlay: input.riskOverlay,
    sizingOverlay: input.sizingOverlay,
    selectionOverlay: input.selectionOverlay,
    entryGateOverlay: input.entryGateOverlay,
    regimeOverlay: input.regimeOverlay,
    window: {
      start: input.window.start,
      end: input.window.end,
      timezone: WATCHLIST_BACKTEST_TIME_ZONE,
    },
    sizing: {
      label: input.sizingOverlay.label,
      maxPositionFraction: input.sizingOverlay.maxPositionFraction,
      maxOpenPositions: input.sizingOverlay.maxOpenPositions,
      cashOnly: input.sizingOverlay.cashOnly,
      wholeSharesOnly: true,
      startingNetLiquidation: input.startingTotals.netLiquidation,
      startingCash: input.startingTotals.cash,
      existingOpenPositions: input.startingBook?.existingOpenPositionCount ?? 0,
      existingOpenSymbols: input.startingBook?.existingOpenSymbols ?? [],
    },
    selection: {
      label: input.selectionOverlay.label,
      mode: input.selectionOverlay.mode,
      minScoreEdge: input.selectionOverlay.minScoreEdge,
    },
    entryGate: input.entryGateOverlay,
    universe: {
      watchlistCount: input.watchlists.length,
      symbolCount: input.universe.length,
      watchlists: input.watchlists.map((watchlist) => ({
        id: watchlist.id,
        name: watchlist.name,
        symbolCount: watchlist.items.length,
      })),
    },
    summary: {
      signals: input.signalScan.candidates.length,
      ...metrics,
    },
    sweep: input.sweep ?? null,
    fills: input.simulation.fills.map(watchlistBacktestFillResponse),
    skipped: [...input.signalScan.skipped, ...input.simulation.skipped],
    updatedAt: new Date(),
  };
}

function buildWatchlistBacktestSweepVariants(input: {
  exploratory?: boolean;
  baseSizingOverlay?: WatchlistBacktestSizingOverlay | null;
  baseSelectionOverlay?: WatchlistBacktestSelectionOverlay | null;
  proxySymbols?: WatchlistBacktestProxySymbol[] | null;
} = {}) {
  const baselineRiskOverlays: Array<WatchlistBacktestRiskOverlay | null> = [
    null,
    {
      label: "TR3",
      stopLossPercent: null,
      trailingStopPercent: 3,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR5",
      stopLossPercent: null,
      trailingStopPercent: 5,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR8",
      stopLossPercent: null,
      trailingStopPercent: 8,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL6",
      stopLossPercent: 6,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL10",
      stopLossPercent: 10,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
  ];
  const exploratoryRiskOverlays: Array<WatchlistBacktestRiskOverlay | null> = [
    ...baselineRiskOverlays,
    {
      label: "TR10",
      stopLossPercent: null,
      trailingStopPercent: 10,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR12",
      stopLossPercent: null,
      trailingStopPercent: 12,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR15",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR20",
      stopLossPercent: null,
      trailingStopPercent: 20,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL8",
      stopLossPercent: 8,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL12",
      stopLossPercent: 12,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL15",
      stopLossPercent: 15,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL8_TR15",
      stopLossPercent: 8,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR12_SIG8",
      stopLossPercent: null,
      trailingStopPercent: 12,
      sellSignalTrailingStopPercent: 8,
    },
    {
      label: "TR15_SIG10",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: 10,
    },
    {
      label: "TR15_SIG8",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: 8,
    },
    {
      label: "TR15_SIG5",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: 5,
    },
  ];
  const riskOverlays = input.exploratory
    ? exploratoryRiskOverlays
    : baselineRiskOverlays;
  const defaultSizing = input.baseSizingOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SIZING;
  const defaultSelection =
    input.baseSelectionOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SELECTION;
  const sizingOverlays: WatchlistBacktestSizingOverlay[] = input.exploratory
    ? [
        defaultSizing,
        {
          label: "P12.5x8",
          maxPositionFraction: 0.125,
          maxOpenPositions: 8,
          cashOnly: true,
        },
        {
          label: "P15x6",
          maxPositionFraction: 0.15,
          maxOpenPositions: 6,
          cashOnly: true,
        },
        {
          label: "P20x5",
          maxPositionFraction: 0.2,
          maxOpenPositions: 5,
          cashOnly: true,
        },
        {
          label: "P25x4",
          maxPositionFraction: 0.25,
          maxOpenPositions: 4,
          cashOnly: true,
        },
      ]
    : [defaultSizing];
  const selectionOverlays: WatchlistBacktestSelectionOverlay[] = input.exploratory
    ? [
        defaultSelection,
        {
          label: "RANKB",
          mode: "ranked_batch",
          minScoreEdge: 0,
        },
      ]
    : [defaultSelection];
  const variantId = (
    baseId: string,
    sizingOverlay: WatchlistBacktestSizingOverlay,
    selectionOverlay: WatchlistBacktestSelectionOverlay,
  ) =>
    input.exploratory
      ? [
          baseId,
          sizingOverlay.label,
          selectionOverlay.mode !== "first_signal" ? selectionOverlay.label : null,
        ]
          .filter(Boolean)
          .join(":")
      : baseId;
  const variants: Array<{
    id: string;
    riskOverlay: WatchlistBacktestRiskOverlay | null;
    sizingOverlay: WatchlistBacktestSizingOverlay;
    selectionOverlay: WatchlistBacktestSelectionOverlay;
    regimeOverlay: WatchlistBacktestRegimeOverlay | null;
  }> = [];
  for (const sizingOverlay of sizingOverlays) {
    for (const selectionOverlay of selectionOverlays) {
      for (const riskOverlay of riskOverlays) {
        const baseId = riskOverlay ? riskOverlay.label : "baseline";
        variants.push({
          id: variantId(baseId, sizingOverlay, selectionOverlay),
          riskOverlay,
          sizingOverlay,
          selectionOverlay,
          regimeOverlay: null,
        });
      }
    }
  }
  const proxySymbols = input.proxySymbols?.length
    ? input.proxySymbols
    : Array.from(WATCHLIST_BACKTEST_PROXY_SYMBOLS);
  const proxySymbolSet = new Set(proxySymbols);
  const regimeInputs = (input.exploratory
    ? [
        ["VXX", "1h", "exit_longs_buy_proxy", "session_close"],
        ["VXX", "1h", "exit_longs_buy_proxy", "fixed_12_5m_bars"],
        ["VXX", "1h", "exit_longs_buy_proxy", "until_proxy_sell"],
        ["VXX", "15m", "pause_new_longs", "session_close"],
        ["VXX", "15m", "pause_new_longs", "until_proxy_sell"],
        ["SQQQ", "1h", "exit_longs_buy_proxy", "session_close"],
        ["SQQQ", "1h", "exit_longs_buy_proxy", "fixed_12_5m_bars"],
        ["SQQQ", "1h", "exit_longs_buy_proxy", "until_proxy_sell"],
        ["SQQQ", "1h", "scale_down_longs", "session_close"],
        ["SQQQ", "1h", "scale_down_longs", "fixed_12_5m_bars"],
        ["SQQQ", "15m", "scale_down_longs", "session_close"],
        ["SQQQ", "15m", "scale_down_longs", "fixed_12_5m_bars"],
        ["SQQQ", "1h", "pause_new_longs", "session_close"],
        ["SQQQ", "1h", "pause_new_longs", "fixed_12_5m_bars"],
      ]
    : proxySymbols.flatMap((proxySymbol) =>
        WATCHLIST_BACKTEST_PROXY_TIMEFRAMES.flatMap((signalTimeframe) =>
          WATCHLIST_BACKTEST_REGIME_ACTIONS.flatMap((action) =>
            WATCHLIST_BACKTEST_REGIME_EXPIRATIONS.map((expiration) => [
              proxySymbol,
              signalTimeframe,
              action,
              expiration,
            ]),
          ),
        ),
      )) as Array<
    [
      WatchlistBacktestProxySymbol,
      ShadowWatchlistBacktestTimeframe,
      WatchlistBacktestRegimeAction,
      WatchlistBacktestRegimeExpiration,
    ]
  >;
  const filteredRegimeInputs = regimeInputs.filter(([proxySymbol]) =>
    proxySymbolSet.has(proxySymbol),
  );
  for (const [proxySymbol, signalTimeframe, action, expiration] of filteredRegimeInputs) {
    for (const sizingOverlay of sizingOverlays) {
      for (const selectionOverlay of selectionOverlays) {
        for (const riskOverlay of riskOverlays) {
          const regimeOverlay = normalizeWatchlistBacktestRegimeOverlay({
            proxySymbol,
            signalTimeframe,
            action,
            expiration,
            fixedBars: WATCHLIST_BACKTEST_FIXED_REGIME_BARS,
            scaleDownFraction: WATCHLIST_BACKTEST_SCALE_DOWN_FRACTION,
          });
          if (!regimeOverlay) {
            continue;
          }
          const baseId = [
            proxySymbol,
            signalTimeframe,
            action,
            expiration,
            riskOverlay?.label ?? "no-risk",
          ].join(":");
          variants.push({
            id: variantId(baseId, sizingOverlay, selectionOverlay),
            riskOverlay,
            sizingOverlay,
            selectionOverlay,
            regimeOverlay,
          });
        }
      }
    }
  }
  return variants;
}

async function collectWatchlistBacktestRegimeSignals(input: {
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
  proxySymbols?: WatchlistBacktestProxySymbol[] | null;
}) {
  const byKey = new Map<string, Awaited<ReturnType<typeof collectWatchlistBacktestSignals>>>();
  const proxySymbols = input.proxySymbols?.length
    ? input.proxySymbols
    : Array.from(WATCHLIST_BACKTEST_PROXY_SYMBOLS);
  for (const proxySymbol of proxySymbols) {
    for (const timeframe of WATCHLIST_BACKTEST_PROXY_TIMEFRAMES) {
      const scan = await collectWatchlistBacktestSignals({
        universe: [
          {
            symbol: proxySymbol,
            watchlists: [{ id: "regime-proxy", name: "Regime Proxy" }],
          },
        ],
        timeframe,
        window: input.window,
      });
      byKey.set(`${proxySymbol}:${timeframe}`, scan);
    }
  }
  return byKey;
}

export async function runShadowWatchlistBacktest(input: {
  marketDate?: string | null;
  marketDateFrom?: string | null;
  marketDateTo?: string | null;
  range?: string | null;
  timeframe?: string | null;
  riskOverlay?: unknown;
  sizingOverlay?: unknown;
  selectionOverlay?: unknown;
  entryGateOverlay?: unknown;
  regimeOverlay?: unknown;
  proxySymbols?: unknown;
  excludedSymbols?: unknown;
  persist?: unknown;
  sweep?: unknown;
  exploratorySweep?: unknown;
  maxDrawdownLimitPercent?: unknown;
  targetOutperformanceMultiple?: unknown;
} = {}) {
  await ensureShadowAccount();
  const runId = randomUUID();
  const timeframe = normalizeWatchlistBacktestTimeframe(input.timeframe);
  const riskOverlay = normalizeWatchlistBacktestRiskOverlay(input.riskOverlay);
  const sizingOverlay = normalizeWatchlistBacktestSizingOverlay(input.sizingOverlay);
  const selectionOverlay = normalizeWatchlistBacktestSelectionOverlay(
    input.selectionOverlay,
  );
  const entryGateOverlay = normalizeWatchlistBacktestEntryGateOverlay(
    input.entryGateOverlay,
  );
  const regimeOverlay = normalizeWatchlistBacktestRegimeOverlay(input.regimeOverlay);
  const proxySymbols = normalizeWatchlistBacktestProxySymbols(input.proxySymbols);
  const excludedSymbols = normalizeWatchlistBacktestExcludedSymbols(
    input.excludedSymbols,
  );
  const persist = input.persist !== false;
  const sweep = input.sweep === true;
  const exploratorySweep = input.exploratorySweep === true;
  const maxDrawdownLimitPercent = normalizeWatchlistBacktestDrawdownLimitPercent(
    input.maxDrawdownLimitPercent,
  );
  const targetOutperformanceMultiple = normalizeWatchlistBacktestTargetMultiple(
    input.targetOutperformanceMultiple,
  );
  const window = resolveWatchlistBacktestWindow({
    marketDate: input.marketDate,
    marketDateFrom: input.marketDateFrom,
    marketDateTo: input.marketDateTo,
    range: input.range,
  });

  await refreshShadowPositionMarks().catch((error) => {
    logger.debug?.({ err: error }, "Shadow mark refresh before watchlist backtest failed");
  });
  const { watchlists } = await listWatchlists();
  const universe = withWatchlistBacktestProxyUniverse(
    collectWatchlistBacktestUniverse(watchlists, { excludedSymbols }),
    { proxySymbols },
  );
  const signalScanStartedAt = Date.now();
  const signalScan = await collectWatchlistBacktestSignals({
    universe,
    timeframe,
    window,
  });
  const effectiveSignalScan = applyWatchlistBacktestEntryGate({
    signalScan,
    entryGateOverlay,
  });
  logger.info(
    {
      runId,
      timeframe,
      rangeKey: window.rangeKey,
      symbolCount: universe.length,
      rawSignals: signalScan.candidates.length,
      signals: effectiveSignalScan.candidates.length,
      skipped: effectiveSignalScan.skipped.length,
      entryGateOverlay,
      elapsedMs: Date.now() - signalScanStartedAt,
    },
    "Shadow watchlist backtest signal hydration completed",
  );

  if (sweep) {
    const regimeScanStartedAt = Date.now();
    const regimeSignalsByKey = await collectWatchlistBacktestRegimeSignals({
      window,
      proxySymbols,
    });
    logger.info(
      {
        runId,
        rangeKey: window.rangeKey,
        proxyScans: regimeSignalsByKey.size,
        signals: Array.from(regimeSignalsByKey.values()).reduce(
          (sum, scan) => sum + scan.candidates.length,
          0,
        ),
        elapsedMs: Date.now() - regimeScanStartedAt,
      },
      "Shadow watchlist backtest regime hydration completed",
    );
    if (persist) {
      await resetWatchlistBacktestRowsForRange({
        marketDateFrom: window.marketDateFrom,
        marketDateTo: window.marketDateTo,
        rangeKey: window.rangeKey,
        windowStart: window.start,
        cleanupEnd: window.cleanupEnd,
        replaceAll: true,
      });
      await refreshShadowPositionMarks().catch((error) => {
        logger.debug?.({ err: error }, "Shadow mark refresh before watchlist sweep failed");
      });
    }
    const startingBook = await computeWatchlistBacktestStartingBook();
    const startingTotals = startingBook.totals;
    const baseMarketValue = startingBook.baseMarketValue;
    const simulationStartedAt = Date.now();
    const variants = buildWatchlistBacktestSweepVariants({
      exploratory: exploratorySweep,
      baseSizingOverlay: sizingOverlay,
      baseSelectionOverlay: selectionOverlay,
      proxySymbols,
    }).map((variant) => {
      const variantRunId = randomUUID();
      const regimeCandidates = variant.regimeOverlay
        ? regimeSignalsByKey.get(
            `${variant.regimeOverlay.proxySymbol}:${variant.regimeOverlay.signalTimeframe}`,
          )?.candidates ?? []
        : [];
      const simulation = buildWatchlistBacktestFills({
        runId: variantRunId,
        candidates: effectiveSignalScan.candidates,
        regimeCandidates,
        barsBySymbol: effectiveSignalScan.barsBySymbol,
        riskOverlay: variant.riskOverlay,
        sizingOverlay: variant.sizingOverlay,
        selectionOverlay: variant.selectionOverlay,
        regimeOverlay: variant.regimeOverlay,
        startingTotals,
        baseMarketValue,
        baselineOpenPositionCount: startingBook.existingOpenPositionCount,
        baselineOpenSymbols: startingBook.existingOpenSymbols,
        marketDate: window.rangeKey,
        windowEnd: window.end,
      });
      const summary = summarizeWatchlistBacktestSimulation({
        simulation,
        startingTotals,
        commonSkippedCount: effectiveSignalScan.skipped.length,
        barsBySymbol: effectiveSignalScan.barsBySymbol,
        windowStart: window.start,
        windowEnd: window.end,
        targetOutperformanceMultiple,
      });
      return {
        ...variant,
        runId: variantRunId,
        simulation,
        summary,
      };
    });
    const ranked = variants.sort((left, right) => {
      if (maxDrawdownLimitPercent !== null) {
        const leftEligible =
          Math.abs(left.summary.maxDrawdownPercent) <= maxDrawdownLimitPercent;
        const rightEligible =
          Math.abs(right.summary.maxDrawdownPercent) <= maxDrawdownLimitPercent;
        if (leftEligible !== rightEligible) {
          return leftEligible ? -1 : 1;
        }
      }
      const navDelta =
        right.summary.endingNetLiquidation - left.summary.endingNetLiquidation;
      return navDelta || left.id.localeCompare(right.id);
    });
    const winner = ranked[0]!;
    logger.info(
      {
        runId,
        rangeKey: window.rangeKey,
        variantCount: ranked.length,
        winnerId: winner.id,
        elapsedMs: Date.now() - simulationStartedAt,
      },
      "Shadow watchlist backtest sweep simulation completed",
    );

    let finalTotals: ShadowTotals | null = null;
    if (persist) {
      await insertWatchlistBacktestFills({
        runId: winner.runId,
        marketDateFrom: window.marketDateFrom,
        marketDateTo: window.marketDateTo,
        rangeKey: window.rangeKey,
        windowStart: window.start,
        cleanupEnd: window.cleanupEnd,
        replaceAll: true,
        riskOverlay: winner.riskOverlay,
        sizingOverlay: winner.sizingOverlay,
        selectionOverlay: winner.selectionOverlay,
        entryGateOverlay,
        fills: winner.simulation.fills,
        snapshots: winner.simulation.snapshots,
      });
      finalTotals = await ensureFreshShadowState(true);
    }
    return buildWatchlistBacktestRunResponse({
      runId: winner.runId,
      persisted: persist,
      window,
      timeframe,
      riskOverlay: winner.riskOverlay,
      sizingOverlay: winner.sizingOverlay,
      selectionOverlay: winner.selectionOverlay,
      entryGateOverlay,
      regimeOverlay: winner.regimeOverlay,
      targetOutperformanceMultiple,
      startingTotals,
      startingBook,
      watchlists,
      universe,
      signalScan: effectiveSignalScan,
      simulation: winner.simulation,
      finalTotals,
      sweep: {
        ranking:
          maxDrawdownLimitPercent !== null
            ? `highest_ending_nav_under_${maxDrawdownLimitPercent}_pct_max_dd`
            : "highest_ending_nav",
        exploratory: exploratorySweep,
        maxDrawdownLimitPercent,
        targetOutperformanceMultiple,
        variantCount: ranked.length,
        winnerId: winner.id,
        variants: ranked.map((variant, index) => ({
          rank: index + 1,
          id: variant.id,
          runId: variant.runId,
          riskOverlay: variant.riskOverlay,
          sizingOverlay: variant.sizingOverlay,
          selectionOverlay: variant.selectionOverlay,
          regimeOverlay: variant.regimeOverlay,
          summary: variant.summary,
        })),
      },
    });
  }

  const regimeCandidates = regimeOverlay
    ? (
        await collectWatchlistBacktestSignals({
          universe: [
            {
              symbol: regimeOverlay.proxySymbol,
              watchlists: [{ id: "regime-proxy", name: "Regime Proxy" }],
            },
          ],
          timeframe: regimeOverlay.signalTimeframe,
          window,
        })
      ).candidates
    : [];
  if (persist) {
    await resetWatchlistBacktestRowsForRange({
      marketDateFrom: window.marketDateFrom,
      marketDateTo: window.marketDateTo,
      rangeKey: window.rangeKey,
      windowStart: window.start,
      cleanupEnd: window.cleanupEnd,
      replaceAll: true,
    });
    await refreshShadowPositionMarks().catch((error) => {
      logger.debug?.({ err: error }, "Shadow mark refresh before watchlist backtest persist failed");
    });
  }
  const startingBook = await computeWatchlistBacktestStartingBook();
  const startingTotals = startingBook.totals;
  const baseMarketValue = startingBook.baseMarketValue;
  const simulation = buildWatchlistBacktestFills({
    runId,
    candidates: effectiveSignalScan.candidates,
    regimeCandidates,
    barsBySymbol: effectiveSignalScan.barsBySymbol,
    riskOverlay,
    sizingOverlay,
    selectionOverlay,
    regimeOverlay,
    startingTotals,
    baseMarketValue,
    baselineOpenPositionCount: startingBook.existingOpenPositionCount,
    baselineOpenSymbols: startingBook.existingOpenSymbols,
    marketDate: window.rangeKey,
    windowEnd: window.end,
  });

  let finalTotals: ShadowTotals | null = null;
  if (persist) {
    await insertWatchlistBacktestFills({
      runId,
      marketDateFrom: window.marketDateFrom,
      marketDateTo: window.marketDateTo,
      rangeKey: window.rangeKey,
      windowStart: window.start,
      cleanupEnd: window.cleanupEnd,
      replaceAll: true,
      riskOverlay,
      sizingOverlay,
      selectionOverlay,
      entryGateOverlay,
      fills: simulation.fills,
      snapshots: simulation.snapshots,
    });
    finalTotals = await ensureFreshShadowState(true);
  }

  return buildWatchlistBacktestRunResponse({
    runId,
    persisted: persist,
    window,
    timeframe,
    riskOverlay,
    sizingOverlay,
    selectionOverlay,
    entryGateOverlay,
    regimeOverlay,
    targetOutperformanceMultiple,
    startingTotals,
    startingBook,
    watchlists,
    universe,
    signalScan: effectiveSignalScan,
    simulation,
    finalTotals,
  });
}

export function isShadowAccountId(accountId: string | null | undefined): boolean {
  return String(accountId ?? "").toLowerCase() === SHADOW_ACCOUNT_ID;
}

type ShadowAutomationMirrorOptions = {
  source?: "automation" | "signal_options_replay";
  markSource?: string;
};

function shadowAutomationPayloadPositionKey(payload: Record<string, unknown>) {
  const metadata = readRecord(payload.metadata) ?? {};
  return readString(metadata.positionKey);
}

function isLiveShadowAutomationPayload(payload: Record<string, unknown>) {
  const metadata = readRecord(payload.metadata) ?? {};
  const backfill = readRecord(payload.backfill) ?? {};
  const replay = readRecord(payload.replay) ?? {};
  const runMode = readString(metadata.runMode);
  const runSource = readString(metadata.runSource);
  const sourceType = readString(metadata.sourceType);
  return (
    runMode !== "historical_backfill" &&
    runMode !== "replay" &&
    runSource !== SIGNAL_OPTIONS_BACKFILL_SOURCE &&
    runSource !== SIGNAL_OPTIONS_REPLAY_SOURCE &&
    sourceType !== SIGNAL_OPTIONS_REPLAY_SOURCE &&
    readString(backfill.source) !== SIGNAL_OPTIONS_BACKFILL_SOURCE &&
    readString(backfill.source) !== SIGNAL_OPTIONS_REPLAY_SOURCE &&
    readString(replay.source) !== SIGNAL_OPTIONS_REPLAY_SOURCE
  );
}

export async function recordShadowAutomationEvent(
  event: ExecutionEvent,
  options: ShadowAutomationMirrorOptions = {},
) {
  if (event.eventType === "signal_options_shadow_entry") {
    return recordShadowAutomationEntry(event, options);
  }
  if (event.eventType === "signal_options_shadow_exit") {
    return recordShadowAutomationExit(event, options);
  }
  if (event.eventType === "signal_options_shadow_mark") {
    return recordShadowAutomationMark(event, options);
  }
  return null;
}

async function recordShadowAutomationEntry(
  event: ExecutionEvent,
  options: ShadowAutomationMirrorOptions,
) {
  const payload = readRecord(event.payload) ?? {};
  const position = readRecord(payload.position);
  const orderPlan = readRecord(payload.orderPlan) ?? {};
  const contract = asOptionContract(payload.selectedContract ?? position?.selectedContract);
  const symbol = normalizeSymbol(String(event.symbol ?? position?.symbol ?? contract?.underlying ?? ""));
  const price =
    toNumber(orderPlan.simulatedFillPrice) ??
    toNumber(position?.entryPrice) ??
    toNumber(payload.fillPrice);
  const quantity = toNumber(orderPlan.quantity) ?? toNumber(position?.quantity);
  if (!symbol || !contract || price == null || !quantity) {
    return null;
  }
  if (
    isLiveShadowAutomationPayload(payload) &&
    !isShadowOptionTradingSession(event.occurredAt, contract)
  ) {
    return null;
  }
  return placeShadowOrder({
    accountId: SHADOW_ACCOUNT_ID,
    mode: "shadow",
    symbol,
    assetClass: "option",
    side: "buy",
    type: "limit",
    quantity,
    limitPrice: price,
    stopPrice: null,
    timeInForce: "day",
    optionContract: contract,
    source: options.source ?? "automation",
    sourceEventId: event.id,
    clientOrderId: `shadow-auto-entry-${event.id}`,
    positionKey: shadowAutomationPayloadPositionKey(payload),
    requestedFillPrice: price,
    payload,
    placedAt: event.occurredAt,
  });
}

async function recordShadowAutomationExit(
  event: ExecutionEvent,
  options: ShadowAutomationMirrorOptions,
) {
  const payload = readRecord(event.payload) ?? {};
  const position = readRecord(payload.position);
  const contract = asOptionContract(payload.selectedContract ?? position?.selectedContract);
  const symbol = normalizeSymbol(String(event.symbol ?? position?.symbol ?? contract?.underlying ?? ""));
  const price = toNumber(payload.exitPrice) ?? toNumber(position?.lastMarkPrice);
  const quantity = toNumber(position?.quantity);
  if (!symbol || !contract || price == null || !quantity) {
    return null;
  }
  if (
    isLiveShadowAutomationPayload(payload) &&
    !isShadowOptionTradingSession(event.occurredAt, contract)
  ) {
    return null;
  }
  try {
    return await placeShadowOrder({
      accountId: SHADOW_ACCOUNT_ID,
      mode: "shadow",
      symbol,
      assetClass: "option",
      side: "sell",
      type: "limit",
      quantity,
      limitPrice: price,
      stopPrice: null,
      timeInForce: "day",
      optionContract: contract,
      source: options.source ?? "automation",
      sourceEventId: event.id,
      clientOrderId: `shadow-auto-exit-${event.id}`,
      positionKey: shadowAutomationPayloadPositionKey(payload),
      requestedFillPrice: price,
      payload,
      placedAt: event.occurredAt,
    });
  } catch (error) {
    // The shadow position is already flat — its entry was never mirrored (e.g. skipped
    // outside a trading session) or it was already closed — so this exit has nothing to
    // sell and the mirror is already in the exit's intended state. Treat as a benign
    // no-op instead of throwing on every read-triggered repair pass.
    if (
      error instanceof HttpError &&
      error.code === "shadow_long_only_position_required"
    ) {
      logger.debug?.(
        { eventId: event.id, symbol },
        "Skipped signal-options Shadow exit mirror: position already flat",
      );
      return null;
    }
    throw error;
  }
}

async function recordShadowAutomationMark(
  event: ExecutionEvent,
  options: ShadowAutomationMirrorOptions,
) {
  await ensureShadowAccount();
  const payload = readRecord(event.payload) ?? {};
  const position = readRecord(payload.position);
  const quote = readRecord(payload.quote);
  const contract = asOptionContract(payload.selectedContract ?? position?.selectedContract);
  const symbol = normalizeSymbol(String(event.symbol ?? position?.symbol ?? contract?.underlying ?? ""));
  const markPrice =
    toNumber(position?.lastMarkPrice) ??
    toNumber(payload.markPrice) ??
    toNumber(quote?.mark);
  if (!symbol || !contract || markPrice == null || markPrice <= 0) {
    return null;
  }
  if (
    isLiveShadowAutomationPayload(payload) &&
    !isShadowOptionTradingSession(event.occurredAt, contract)
  ) {
    return null;
  }
  const key =
    shadowAutomationPayloadPositionKey(payload) ??
    positionKey({ symbol, assetClass: "option", optionContract: contract });
  const [row] = await db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.positionKey, key),
        eq(shadowPositionsTable.status, "open"),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  const quantity = toNumber(row.quantity) ?? 0;
  const averageCost = toNumber(row.averageCost) ?? 0;
  const multiplier = marketMultiplier({ assetClass: "option", optionContract: contract });
  const marketValue = quantity * markPrice * multiplier;
  const unrealizedPnl = (markPrice - averageCost) * quantity * multiplier;
  const [updated] = await db
    .update(shadowPositionsTable)
    .set({
      mark: money(markPrice),
      marketValue: money(marketValue),
      unrealizedPnl: money(unrealizedPnl),
      asOf: event.occurredAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shadowPositionsTable.id, row.id),
        eq(shadowPositionsTable.status, "open"),
      ),
    )
    .returning({ id: shadowPositionsTable.id });
  if (!updated) {
    return null;
  }
  await db.insert(shadowPositionMarksTable).values({
    accountId: SHADOW_ACCOUNT_ID,
    positionId: row.id,
    mark: money(markPrice),
    marketValue: money(marketValue),
    unrealizedPnl: money(unrealizedPnl),
    source: "automation",
    asOf: event.occurredAt,
  });
  await writeShadowBalanceSnapshot(
    options.markSource ?? "automation_mark",
    event.occurredAt,
    { changeReason: "mark_refresh" },
  );
  return row.id;
}
