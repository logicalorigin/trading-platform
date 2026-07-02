import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  barCacheTable,
  marketDataIngestJobsTable,
  providerRequestLogTable,
  signalMonitorBreadthSnapshotsTable,
  signalMonitorEventsTable,
  signalMonitorProfilesTable,
  signalMonitorSymbolStatesTable,
  signalUniverseRankingsTable,
  universeCatalogListingsTable,
  type SignalMonitorEvent as DbSignalMonitorEvent,
  type SignalMonitorProfile as DbSignalMonitorProfile,
  type SignalMonitorSymbolState as DbSignalMonitorSymbolState,
} from "@workspace/db";
import {
  aggregatePyrusSignalsBarsForTimeframe,
  evaluatePyrusSignalsSignals,
  PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
  resolvePyrusSignalsSignalSettings,
  resolvePyrusSignalsTrendDirection,
  type PyrusSignalsBar,
  type PyrusSignalsFilterState,
  type PyrusSignalsSignalEvent,
} from "@workspace/pyrus-signals-core";
import { resolveUsEquityMarketStatus } from "@workspace/market-calendar";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  getRuntimeMode,
  isMassiveStocksRealtimeConfigured,
  type RuntimeMode,
} from "../lib/runtime";
import {
  createTransientPostgresBackoff,
  isStatementTimeoutError,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import { normalizeSymbol } from "../lib/values";
import {
  normalizeLegacyAlgoBranding,
  normalizeLegacyAlgoBrandText,
} from "./algo-branding";
import {
  getBars,
  getBarsWithDebug,
  getOptionsFlowUniverse,
  listWatchlists,
  listWatchlistsRuntimeFallback,
} from "./platform";
import {
  getHighBetaUniverseAvailabilityStatus,
  getHighBetaUniversePreview,
} from "./high-beta-universe";
import { notifyAlgoCockpitChanged } from "./algo-cockpit-events";
import {
  buildSignalMonitorActionability,
  signalMonitorFresh,
} from "./signal-monitor-actionability";
import { recordSignalMonitorDbFallback } from "./signal-monitor-diagnostics";
import {
  getApiResourcePressureSnapshot,
  type ApiResourcePressureLevel,
} from "./resource-pressure";
import {
  resolvePythonComputeLaneDefinitions,
  routePythonComputeJobType,
  runPythonComputeJob,
  type PythonComputeJobResult,
  type PythonComputeJobType,
} from "./python-compute";
import {
  getCurrentStockMinuteAggregates,
  getRecentStockMinuteAggregateHistory,
  getStockAggregateStreamDiagnostics,
  isBackgroundStockAggregateStreamingEnabled,
  isForegroundSignalMatrixStockAggregateStreamingEnabled,
  isStockAggregateStreamingAvailable,
  subscribeMutableStockMinuteAggregates,
  type StockMinuteAggregateSource,
  type StockMinuteAggregateSubscription,
  type StockMinuteAggregateMessage,
} from "./stock-aggregate-stream";
import {
  loadSignalMonitorLocalBarCache,
  mapWithConcurrency,
  primeSignalMonitorLocalBarCache,
  runWithSignalMonitorStoredBarsPrefetch,
  storeSourceNames,
} from "./signal-monitor-local-bar-cache";

export type SignalMonitorTimeframe = "1m" | "2m" | "5m" | "15m" | "1h" | "1d";
export type SignalMonitorMatrixTimeframe = SignalMonitorTimeframe;
export type SignalMonitorDirection = "buy" | "sell";
export type SignalMonitorBreadthHistoryRange = "hour" | "day" | "week" | "month";
type SignalMonitorStatus =
  | "ok"
  | "idle"
  | "stale"
  | "unavailable"
  | "error"
  | "unknown";
type SignalMonitorMatrixCacheStatus = "hit" | "stale" | "inflight" | "miss";
type SignalMonitorEventsSourceStatus = "database" | "runtime-fallback";
type SignalMonitorMatrixClientRole =
  | "leader"
  | "follower"
  | "manual"
  | "test";
type SignalMonitorMatrixRequestOrigin =
  | "startup"
  | "poll"
  | "manual"
  | "test";
type SignalMonitorMatrixCellRequest = {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
};
const SIGNAL_MONITOR_CELL_KEY_SEPARATOR = "\u0000";
export type SignalMonitorCanonicalEventCandidate = {
  signal: PyrusSignalsSignalEvent;
  signalAt: Date;
  signalBarAt: Date;
  latestBarAt: Date;
  latestBarAnchorAt: Date;
  sourceBarPartial: boolean;
  sourceIntegrity: SignalMonitorSourceIntegrityDecision;
};
export type SignalMonitorLatestTrustedSignalEvent = {
  id: string;
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  direction: SignalMonitorDirection;
  signalAt: Date;
  signalPrice: number | null;
  close: number | null;
  filterState: unknown;
  signalBarAt: Date | null;
};
type SignalMonitorLatestTrustedBar = {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  latestBarAt: Date;
  latestBarClose: number | null;
};
export type SignalMonitorCurrentCellParityField =
  | "currentSignalDirection"
  | "currentSignalAt"
  | "currentSignalPrice"
  | "currentSignalClose"
  | "currentSignalMfePercent"
  | "currentSignalMaePercent"
  | "filterState"
  | "latestBarAt"
  | "latestBarClose"
  | "barsSinceSignal"
  | "fresh"
  | "status"
  | "active"
  | "trendDirection"
  | "lastEvaluatedAt"
  | "lastError";
export type SignalMonitorCurrentCellParityMismatchReason =
  | "value_mismatch"
  | "stored_missing"
  | "derived_missing"
  | "not_inferable";
export type SignalMonitorCurrentCellParityMismatch = {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  field: SignalMonitorCurrentCellParityField;
  stored: unknown;
  derived: unknown;
  reason: SignalMonitorCurrentCellParityMismatchReason;
};
export type SignalMonitorCurrentCellParityCounts = {
  comparedCells: number;
  missingStoredCells: number;
  missingDerivedCells: number;
  mismatches: number;
};
export type SignalMonitorCurrentCellParityReport = {
  profileId: string;
  environment: RuntimeMode;
  generatedAt: Date;
  requested: {
    symbols: string[];
    timeframes: SignalMonitorMatrixTimeframe[];
  };
  counts: SignalMonitorCurrentCellParityCounts;
  mismatches: SignalMonitorCurrentCellParityMismatch[];
};
type SignalMonitorSourceIntegrityReason =
  | "trusted-source"
  | "within-reference-band"
  | "missing-reference"
  | "non-physical-price"
  | "deviates-from-reference";
type SignalMonitorSourceIntegrityDecision = {
  trusted: boolean;
  reason: SignalMonitorSourceIntegrityReason;
  source: string | null;
  close: number | null;
  timestamp: string | null;
  referenceClose: number | null;
  referenceTimestamp: string | null;
  referenceSource: string | null;
  deviationPercent: number | null;
};
export type SignalMonitorMatrixStreamSource =
  | StockMinuteAggregateSource
  | "none";
type SignalMonitorMatrixStreamSourceState =
  | "streaming"
  | "bootstrap"
  | "unavailable";
export type SignalMonitorMatrixStreamScope = {
  environment: RuntimeMode;
  symbols: string[];
  timeframes: SignalMonitorMatrixTimeframe[];
  cells: SignalMonitorMatrixCellRequest[];
  exactCells: boolean;
  requestedSymbolCount: number;
  skippedSymbols: string[];
  truncated: boolean;
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
};
export type SignalMonitorMatrixStreamCoverage = {
  requestedSymbols: number;
  activeScopeSymbols: number;
  timeframes: number;
  taskCount: number;
  source: SignalMonitorMatrixStreamSource;
  delayed: boolean;
  eventCount: number;
  stateCount: number;
  skippedSymbols: number;
  truncated: boolean;
  lastEventAt: string | null;
  lastEventAgeMs: number | null;
};
export type SignalMonitorMatrixStreamState = {
  id: string;
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  currentSignalDirection: SignalMonitorDirection | null;
  currentSignalAt: Date | null;
  currentSignalPrice: number | null;
  currentSignalClose: number | null;
  currentSignalMfePercent: number | null;
  currentSignalMaePercent: number | null;
  latestBarAt: Date | null;
  latestBarClose: number | null;
  barsSinceSignal: number | null;
  fresh: boolean;
  status: SignalMonitorStatus;
  active: boolean;
  lastEvaluatedAt: Date | null;
  lastError: string | null;
  filterState?: unknown;
  indicatorSnapshot?: unknown;
  // Always-defined current trend (bullish/bearish), mirrored from the
  // indicator snapshot at the wire boundary so the matrix stream carries the
  // same trend source the REST SignalMonitorSymbolState exposes (and that the
  // backend entry gate trades on). Optional so internal eval results can omit
  // it, but every emitted stream state carries it.
  trendDirection?: SignalMonitorIndicatorDirection | null;
  // Authored at the wire boundary (delta emit / stored bootstrap) by
  // buildSignalMonitorActionability — optional so internal eval results can
  // omit them, but every emitted stream state carries them.
  actionEligible?: boolean;
  actionBlocker?: string | null;
};
export type SignalMonitorMatrixStreamStatusEvent = {
  stream: "signal-matrix";
  event: "stream-status";
  state: "open" | "degraded" | "unavailable";
  source: SignalMonitorMatrixStreamSource;
  provider: SignalMonitorMatrixStreamSource;
  activeProvider: SignalMonitorMatrixStreamSource | null;
  delayed: boolean;
  activeScopeSymbols: number;
  activeScopeCells: number;
  skippedSymbols: number;
  truncated: boolean;
  eventCount: number;
  lastEventAt: string | null;
  lastEventAgeMs: number | null;
  sourceState: SignalMonitorMatrixStreamSourceState;
};
export type SignalMonitorMatrixStreamBootstrapEvent = {
  stream: "signal-matrix";
  event: "bootstrap";
  profile: ReturnType<typeof profileToResponse>;
  states: SignalMonitorMatrixStreamState[];
  evaluatedAt: Date;
  timeframes: SignalMonitorMatrixTimeframe[];
  coverage: SignalMonitorMatrixStreamCoverage;
};
export type SignalMonitorMatrixStreamStateDeltaEvent = {
  stream: "signal-matrix";
  event: "state-delta";
  states: SignalMonitorMatrixStreamState[];
  evaluatedAt: Date;
  timeframes: SignalMonitorMatrixTimeframe[];
  coverage: SignalMonitorMatrixStreamCoverage;
};
export type SignalMonitorMatrixStreamErrorEvent = {
  stream: "signal-matrix";
  event: "error";
  code: string;
  detail: string;
  cooldownMs: number | null;
};
export type SignalMonitorMatrixStreamEvent =
  | SignalMonitorMatrixStreamBootstrapEvent
  | SignalMonitorMatrixStreamStateDeltaEvent
  | SignalMonitorMatrixStreamStatusEvent
  | SignalMonitorMatrixStreamErrorEvent;
export type SignalMonitorMatrixStreamSubscription = {
  scope: SignalMonitorMatrixStreamScope;
  profile: ReturnType<typeof profileToResponse>;
  recordSnapshot(states: SignalMonitorMatrixStreamState[]): void;
  unsubscribe(): void;
};
type SignalMonitorMatrixStreamSubscriber = {
  id: number;
  scope: SignalMonitorMatrixStreamScope;
  profile: DbSignalMonitorProfile;
  onEvent: (event: SignalMonitorMatrixStreamEvent) => void | Promise<void>;
  lastStateSignatures: Map<string, string>;
  // Last state emitted per cell: the wire-side signal latch. A directionless
  // re-evaluation must not erase a latched buy/sell on the stream any more
  // than it may in the DB (the DB latch lives in upsertSymbolState).
  lastStates: Map<string, SignalMonitorMatrixStreamState>;
};
type SignalMonitorBarSourcePolicy = "mixed" | "ibkr-only";
type SignalMonitorSignalStabilityPolicy =
  | "stable-only"
  | "allow-partial-live-edge";
type SignalMonitorProfileSymbolEvaluationPressureCapMode =
  | "capped"
  | "bypass-soft";
type SignalMonitorUniverseMode =
  | "selected_watchlist"
  | "all_watchlists"
  | "all_watchlists_plus_universe"
  | "high_beta_500";
type SignalMonitorUniverseSource =
  | "selected_watchlist"
  | "all_watchlists"
  | "watchlists_plus_ranked_universe"
  | "high_beta_500";
export type EvaluationMode = "hydrate" | "incremental";

export type SignalMonitorBarSnapshot = Awaited<
  ReturnType<typeof getBars>
>["bars"][number];
export type SignalMonitorCompletedBarsSnapshot = {
  bars: SignalMonitorBarSnapshot[];
  latestBarAt: Date | null;
};

class SignalMonitorLiveEdgeHistoryUnavailableError extends Error {
  constructor(input: {
    symbol: string;
    timeframe: SignalMonitorMatrixTimeframe;
  }) {
    super(
      `Cached ${input.timeframe} signal history for ${input.symbol} is not warm enough for live-edge evaluation without REST fallback.`,
    );
    this.name = "SignalMonitorLiveEdgeHistoryUnavailableError";
  }
}

function isSignalMonitorLiveEdgeHistoryUnavailableError(
  error: unknown,
): error is SignalMonitorLiveEdgeHistoryUnavailableError {
  return error instanceof SignalMonitorLiveEdgeHistoryUnavailableError;
}

type WatchlistRecord = Awaited<
  ReturnType<typeof listWatchlists>
>["watchlists"][number];

function throwIfSignalMonitorAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error("Signal monitor evaluation aborted.");
}

const SIGNAL_MONITOR_TIMEFRAMES: readonly SignalMonitorTimeframe[] = [
  "1m",
  "2m",
  "5m",
  "15m",
  "1h",
  "1d",
];
const SIGNAL_MONITOR_MATRIX_TIMEFRAMES: readonly SignalMonitorMatrixTimeframe[] =
  SIGNAL_MONITOR_TIMEFRAMES;
const DEFAULT_SIGNAL_MONITOR_TIMEFRAME: SignalMonitorTimeframe = "15m";
const SIGNAL_MONITOR_DB_UNAVAILABLE_MESSAGE =
  "Postgres is unavailable; signal monitor data is temporarily degraded.";
const SIGNAL_MONITOR_RUNTIME_FALLBACK_MESSAGE =
  "Postgres is unavailable; using runtime-only signal monitor evaluation.";
const SIGNAL_MONITOR_PASSIVE_SIGNAL_SOURCE_MESSAGE =
  "Signal monitor is passive; signals must be received as ticker-emitted events before Signal Monitor/STA consume them.";
const SIGNAL_MONITOR_DB_UNAVAILABLE_CODE = "signal_monitor_db_unavailable";
const SIGNAL_MONITOR_RUNTIME_EVALUATION_CACHE_TTL_MS = 0;
const SIGNAL_MONITOR_RUNTIME_EVALUATION_CACHE_MAX_ENTRIES = 64;
const SIGNAL_MONITOR_MATRIX_CACHE_TTL_MS = 0;
const SIGNAL_MONITOR_MATRIX_STALE_TTL_MS = 0;
const SIGNAL_MONITOR_MATRIX_EVALUATION_CACHE_MAX_ENTRIES = 64;
const SIGNAL_MONITOR_MATRIX_AUTOMATIC_DEBOUNCE_MS = 0;
const SIGNAL_MONITOR_STATE_UNAVAILABLE_MESSAGE =
  "Signal monitor state is temporarily unavailable; returning fallback unavailable coverage.";
// Re-enabled (was 30s before 2026-06-12; zeroed as collateral during the state-model
// repair, which is orthogonal to raw bar data — signal STATE is still recomputed fresh
// every eval). Freshness is guaranteed NOT by this TTL but by the serve-side bar-behind
// check in shouldBypassSignalMonitorCompletedBarsCache, so the TTL only controls re-fetch
// frequency within a bucket (the ELU win), never staleness.
const SIGNAL_MONITOR_COMPLETED_BARS_CACHE_TTL_MS = 30_000;
const SIGNAL_MONITOR_COMPLETED_BARS_STALE_TTL_MS = 30_000;
// Serve-side freshness margin: a cached snapshot is refused (re-fetched) once a full
// timeframe + this margin has elapsed since its newest bar's close — i.e. a newer
// completed bar must exist. Alignment-agnostic (works for epoch- and session-aligned
// bars); bounds any cache-served staleness to <= this margin, replacing the old
// one-full-timeframe serve tolerance. Small value absorbs clock/timestamp skew.
const SIGNAL_MONITOR_COMPLETED_BARS_SERVE_MARGIN_MS = 2_000;
// Must be >= live cell count (universe symbols x timeframes) or the cache evicts in
// steady state and the barsToPyrusSignalsBarEntries WeakMap memo (which keys on the
// cache's array identity) misses with it. Current universe: 500 symbols x 6 timeframes
// = 3000 cells, so 2048 was ~30% under-sized. 3072 covers today's universe; scaling
// past ~500 symbols needs a bounded-active-set model, NOT a bigger number here (an
// entry holds up to ~1000 bars, so full-universe in-process caching is infeasible).
const SIGNAL_MONITOR_COMPLETED_BARS_CACHE_MAX_ENTRIES = 3072;
const SIGNAL_MONITOR_MARKET_SESSION_CONTEXT_CACHE_MAX_ENTRIES = 128;
const SIGNAL_MONITOR_STALE_RETRY_BROKER_WINDOW_MINUTES = 240;
const SIGNAL_MONITOR_STALE_RETRY_BARS = 64;
const SIGNAL_MONITOR_MATRIX_BARS_LIMIT = 240;
const SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY =
  "native_timeframes_live_retry_exact_backfill";
const SIGNAL_MONITOR_MATRIX_STREAM_KEEPALIVE_MS = 5 * 60_000;
// The Signal-Matrix live-edge stream is a UI display (the signal-options trade
// engine never reads it). Re-evaluating the whole universe every 150ms (~6.7x/s)
// far exceeds perceptible smoothness and is pure excess CPU on the shared event
// loop. 300ms (~3.3x/s) is still smooth for a live grid and roughly halves the
// continuous matrix-eval cost. This is a permanent baseline reduction of excess
// work — NOT a pressure-reactive backoff.
const SIGNAL_MONITOR_MATRIX_STREAM_FLUSH_MS = 300;
const SIGNAL_MONITOR_LOCAL_BAR_CACHE_REFRESH_MS = 60_000;
const SIGNAL_MONITOR_PYTHON_SIGNAL_MATRIX_CONCURRENCY = 2;
const DEFAULT_SIGNAL_MONITOR_BAR_SOURCE_POLICY: SignalMonitorBarSourcePolicy =
  "mixed";
const SIGNAL_MONITOR_BARS_PRIORITY = 8;
const SIGNAL_MONITOR_MATRIX_BARS_PRIORITY = 5;
const SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY = 9;
const SIGNAL_MONITOR_BARS_FAMILY = "signal-matrix";
const SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY = "__signalMonitorUniverseScope";
const SIGNAL_MONITOR_UNIVERSE_SCOPE_DEFAULT_VERSION_KEY =
  "__signalMonitorUniverseScopeDefaultVersion";
const SIGNAL_MONITOR_UNIVERSE_SCOPE_DEFAULT_VERSION = 2;
const DEFAULT_SIGNAL_MONITOR_UNIVERSE_SCOPE: SignalMonitorUniverseMode =
  "all_watchlists_plus_universe";
// Hard ceiling on the evaluated universe. Raised 500 -> 2000 for the 2000-name
// expansion. The caches (LRU) + serve-strictness above are sized for this; scaling
// further needs a bounded-active-set model + the pg-decode worker-offload, not a
// larger number here (memory + the 12-conn DB pool are the walls past ~2000).
const SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT = 2000;
// Max rows per signal_monitor_symbol_states upsert statement, to stay under Postgres'
// 65535 bind-parameter ceiling for a full-universe (symbols x timeframes) persist.
const SIGNAL_MONITOR_STATE_UPSERT_MAX_ROWS = 1000;
const SIGNAL_MONITOR_EVALUATION_CONCURRENCY_LIMIT = 10;
// The price-trace diagnostic issues ~3 serial db reads per row; bound the per-row
// fan-out so a single GET (default 20, operator-settable to 100 rows) can never
// demand more than this many of the 12 shared pool connections at once.
const PRICE_TRACE_ROW_CONCURRENCY = 4;
const DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS = SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT;
const DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY = 6;
const DEFAULT_SIGNAL_MONITOR_POLL_SECONDS = 60;
const SIGNAL_MONITOR_MATRIX_SOFT_BYPASS_MAX_SYMBOLS = 12;
const runtimeSignalMonitorProfiles = new Map<
  RuntimeMode,
  DbSignalMonitorProfile
>();
const TIMEFRAME_MS: Record<SignalMonitorMatrixTimeframe, number> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
const SIGNAL_MONITOR_MARKET_CLOSE_LOOKBACK_DAYS = 10;
const MARKET_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const MARKET_DATE_TIME_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export type SignalMonitorProfileRow = DbSignalMonitorProfile;

function resolveEnvironment(environment?: RuntimeMode): RuntimeMode {
  return environment ?? getRuntimeMode();
}

// Signals are ONE universal upstream source — NOT scoped to a deployment/runtime
// environment (shadow/paper/live is a downstream execution concern). Every
// signal reader (the page + all deployments) resolves to this single canonical
// signal profile so they all see the same feed. The canonical key is the
// "shadow" environment (renamed from the former "paper"); the producer already
// generates it. (resolveEnvironment above remains for legacy per-env read paths
// until they are migrated in later stages.)
const CANONICAL_SIGNAL_ENVIRONMENT: RuntimeMode = "shadow";

export function resolveSignalSourceEnvironment(): RuntimeMode {
  return CANONICAL_SIGNAL_ENVIRONMENT;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function signalMonitorFilterStateOrNull(
  value: unknown,
): Record<string, unknown> | null {
  const record = asRecord(value);
  return Object.keys(record).length ? record : null;
}

export function resolveSignalMonitorTimeframe(
  value: unknown,
  fallback = DEFAULT_SIGNAL_MONITOR_TIMEFRAME,
): SignalMonitorTimeframe {
  const resolved = String(value || "").trim() as SignalMonitorTimeframe;
  return SIGNAL_MONITOR_TIMEFRAMES.includes(resolved) ? resolved : fallback;
}

const resolveSignalMonitorActiveTimeframes = (): SignalMonitorMatrixTimeframe[] =>
  [...SIGNAL_MONITOR_MATRIX_TIMEFRAMES];

export function withSignalMonitorUniverseScope(
  settings: Record<string, unknown>,
  universeScope: string,
): Record<string, unknown> {
  return {
    ...asRecord(settings),
    [SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY]: universeScope,
    [SIGNAL_MONITOR_UNIVERSE_SCOPE_DEFAULT_VERSION_KEY]:
      SIGNAL_MONITOR_UNIVERSE_SCOPE_DEFAULT_VERSION,
  };
}

function resolveSignalMonitorUniverseScope(
  settings: Record<string, unknown>,
): SignalMonitorUniverseMode {
  const raw = String(
    settings[SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY] ??
      settings["universeScope"] ??
      "",
  ).trim();
  if (
    raw === "selected_watchlist" ||
    raw === "all_watchlists_plus_universe" ||
    raw === "high_beta_500"
  ) {
    return raw;
  }
  if (raw === "all_watchlists_only") {
    return "all_watchlists";
  }
  if (raw === "all_watchlists") {
    return "all_watchlists";
  }
  return DEFAULT_SIGNAL_MONITOR_UNIVERSE_SCOPE;
}

function resolveSignalMonitorProfileUpdateDefaults(input: {
  currentMaxSymbols: number;
  currentPyrusSignalsSettings: Record<string, unknown>;
  inputMaxSymbols?: number;
  inputPyrusSignalsSettings?: Record<string, unknown>;
}) {
  const pyrusSignalsSettings =
    input.inputPyrusSignalsSettings === undefined
      ? asRecord(input.currentPyrusSignalsSettings)
      : asRecord(input.inputPyrusSignalsSettings);
  const universeScope = resolveSignalMonitorUniverseScope(pyrusSignalsSettings);
  const explicitMaxSymbols =
    input.inputMaxSymbols === undefined
      ? undefined
      : positiveInteger(
          input.inputMaxSymbols,
          DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
          1,
          SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
        );
  const highBetaRequested = universeScope === "high_beta_500";
  const maxSymbols =
    explicitMaxSymbols ??
    (highBetaRequested
      ? SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT
      : positiveInteger(
          input.currentMaxSymbols,
          DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
          1,
          SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
        ));

  return {
    pyrusSignalsSettings: withSignalMonitorUniverseScope(
      pyrusSignalsSettings,
      universeScope,
    ),
    universeScope,
    maxSymbols,
    highBetaRequested,
  };
}

function signalMonitorUniverseScopeDefaultVersion(
  settings: Record<string, unknown>,
): number {
  const value = Number(settings[SIGNAL_MONITOR_UNIVERSE_SCOPE_DEFAULT_VERSION_KEY]);
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

function signalMonitorRawUniverseScope(settings: Record<string, unknown>) {
  return String(
    settings[SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY] ??
      settings["universeScope"] ??
      "",
  ).trim();
}

function buildSignalMonitorLegacyDefaultsPatch(
  profile: DbSignalMonitorProfile,
): Partial<typeof signalMonitorProfilesTable.$inferInsert> | null {
  const settings = asRecord(profile.pyrusSignalsSettings);
  const rawUniverseScope = signalMonitorRawUniverseScope(settings);
  const universeScope = resolveSignalMonitorUniverseScope(settings);
  const defaultVersion = signalMonitorUniverseScopeDefaultVersion(settings);
  const patch: Partial<typeof signalMonitorProfilesTable.$inferInsert> = {};

  if (
    universeScope !== "selected_watchlist" &&
    positiveInteger(
      profile.maxSymbols,
      DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
      1,
      SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
    ) < DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS
  ) {
    patch.maxSymbols = DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS;
  }

  if (
    defaultVersion < SIGNAL_MONITOR_UNIVERSE_SCOPE_DEFAULT_VERSION &&
    (rawUniverseScope === "" ||
      rawUniverseScope === "all_watchlists" ||
      rawUniverseScope === "all_watchlists_only")
  ) {
    patch.pyrusSignalsSettings = withSignalMonitorUniverseScope(
      settings,
      DEFAULT_SIGNAL_MONITOR_UNIVERSE_SCOPE,
    );
  }

  if (
    patch.maxSymbols === undefined &&
    patch.pyrusSignalsSettings === undefined
  ) {
    return null;
  }

  return {
    ...patch,
    updatedAt: new Date(),
  };
}

async function assertHighBetaSignalMonitorUniverseAvailable(input: {
  universeScope: SignalMonitorUniverseMode;
}) {
  if (input.universeScope !== "high_beta_500") {
    return;
  }

  const status = await getHighBetaUniverseAvailabilityStatus({
    limit: SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
  });
  if (status.available) {
    return;
  }

  throw new HttpError(409, "High Beta 500 universe is unavailable.", {
    code: "high_beta_universe_unavailable",
    detail:
      status.unavailableDetail ??
      "High Beta 500 requires a configured research provider or a cached high-beta universe.",
    data: {
      highBetaUniverse: status,
    },
  });
}

function parseSignalTimeframe(value: unknown): SignalMonitorTimeframe {
  const resolved = String(value || "").trim() as SignalMonitorTimeframe;
  if (!SIGNAL_MONITOR_TIMEFRAMES.includes(resolved)) {
    throw new HttpError(400, "Unsupported signal monitor timeframe.", {
      code: "signal_monitor_timeframe_invalid",
      detail: `Use one of ${SIGNAL_MONITOR_TIMEFRAMES.join(", ")}.`,
    });
  }
  return resolved;
}

function parseSignalMatrixTimeframes(
  value: unknown,
): SignalMonitorMatrixTimeframe[] {
  const input = Array.isArray(value) ? value : SIGNAL_MONITOR_MATRIX_TIMEFRAMES;
  const normalized = input
    .map((item) => String(item || "").trim() as SignalMonitorMatrixTimeframe)
    .filter((item) => SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(item));
  return Array.from(new Set(normalized)).length
    ? Array.from(new Set(normalized))
    : [...SIGNAL_MONITOR_MATRIX_TIMEFRAMES];
}

function normalizeSignalMonitorMatrixCells(
  value: unknown,
): SignalMonitorMatrixCellRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const cells = new Map<string, SignalMonitorMatrixCellRequest>();
  value.forEach((item) => {
    const record = asRecord(item);
    const symbol = normalizeSymbol(record["symbol"] as string).toUpperCase();
    const timeframe = String(
      record["timeframe"] || "",
    ).trim() as SignalMonitorMatrixTimeframe;
    if (!symbol || !SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(timeframe)) {
      return;
    }
    cells.set(`${symbol}:${timeframe}`, { symbol, timeframe });
  });
  return Array.from(cells.values()).sort((left, right) =>
    left.symbol === right.symbol
      ? SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(left.timeframe) -
        SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(right.timeframe)
      : left.symbol.localeCompare(right.symbol),
  );
}

function normalizeSignalMonitorMatrixSymbols(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((symbol) => normalizeSymbol(symbol as string).toUpperCase())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function normalizeSignalMonitorMatrixStreamScope(input: {
  environment?: RuntimeMode;
  symbols?: string[];
  timeframes?: string[];
  cells?: SignalMonitorMatrixCellRequest[];
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
}): SignalMonitorMatrixStreamScope {
  const environment = resolveEnvironment(input.environment);
  const cells = normalizeSignalMonitorMatrixCells(input.cells);
  const exactCells = cells.length > 0;
  const requestedSymbols = exactCells
    ? Array.from(new Set(cells.map((cell) => cell.symbol))).sort((left, right) =>
        left.localeCompare(right),
      )
    : normalizeSignalMonitorMatrixSymbols(input.symbols);
  const truncated = requestedSymbols.length > SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT;
  const symbols = requestedSymbols.slice(0, SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT);
  const allowedSymbols = new Set(symbols);
  const scopedCells = exactCells
    ? cells.filter((cell) => allowedSymbols.has(cell.symbol))
    : [];
  const skippedSymbols = requestedSymbols.slice(symbols.length);
  const timeframes = exactCells
    ? Array.from(new Set(scopedCells.map((cell) => cell.timeframe))).sort(
        (left, right) =>
          SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(left) -
          SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(right),
      )
    : parseSignalMatrixTimeframes(input.timeframes);

  return {
    environment,
    symbols,
    timeframes,
    cells: scopedCells,
    exactCells,
    requestedSymbolCount: requestedSymbols.length,
    skippedSymbols,
    truncated,
    clientRole: input.clientRole,
    requestOrigin: input.requestOrigin,
  };
}

export async function resolveSignalMonitorMatrixStreamScope(input: {
  environment?: RuntimeMode;
  symbols?: string[];
  timeframes?: string[];
  cells?: SignalMonitorMatrixCellRequest[];
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
  universe?: "profile" | null;
  resolveProfileUniverseSymbols?: (environment: RuntimeMode) => Promise<string[]>;
}): Promise<SignalMonitorMatrixStreamScope> {
  const scope = normalizeSignalMonitorMatrixStreamScope(input);
  if (scope.exactCells || scope.symbols.length || input.universe !== "profile") {
    return scope;
  }

  const symbols = input.resolveProfileUniverseSymbols
    ? await input.resolveProfileUniverseSymbols(scope.environment)
    : await resolveSignalMonitorMatrixStreamProfileUniverseSymbols(
        scope.environment,
      );
  return normalizeSignalMonitorMatrixStreamScope({
    ...input,
    environment: scope.environment,
    symbols,
    cells: [],
  });
}

function signalMonitorMatrixCellsBySymbol(
  cells: readonly SignalMonitorMatrixCellRequest[],
): Map<string, SignalMonitorMatrixTimeframe[]> {
  const bySymbol = new Map<string, SignalMonitorMatrixTimeframe[]>();
  cells.forEach((cell) => {
    const timeframes = bySymbol.get(cell.symbol) ?? [];
    timeframes.push(cell.timeframe);
    bySymbol.set(cell.symbol, timeframes);
  });
  return bySymbol;
}

function signalMonitorMatrixCellKeys(
  cells: readonly SignalMonitorMatrixCellRequest[],
): Set<string> {
  return new Set(cells.map((cell) => `${cell.symbol}:${cell.timeframe}`));
}

function isForegroundExactCellLeaderSignalMonitorMatrixRequest(input: {
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
  cells?: readonly SignalMonitorMatrixCellRequest[];
}) {
  const foregroundLeader =
    input.clientRole === "leader" &&
    (input.requestOrigin === "startup" || input.requestOrigin === "poll");
  if (!foregroundLeader) {
    return false;
  }
  return Array.isArray(input.cells) && input.cells.length > 0;
}

function resolveSignalMonitorMatrixExactCellCap(input: {
  pressure: ApiResourcePressureLevel;
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
  cells?: readonly SignalMonitorMatrixCellRequest[];
}) {
  void input;
  return null;
}

function shouldAwaitSignalMonitorMatrixExactCellRefresh(input: {
  exactCells: boolean;
  pressure: ApiResourcePressureLevel;
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
}) {
  void input.pressure;
  void input.clientRole;
  void input.requestOrigin;
  return input.exactCells;
}

function shouldAllowSignalMonitorMatrixHistoricalFallback(input: {
  exactCells: boolean;
}): boolean {
  return input.exactCells;
}

function resolveSignalMonitorMatrixExactCells(input: {
  cells?: SignalMonitorMatrixCellRequest[];
  allowedSymbols: string[];
  pressure: ApiResourcePressureLevel;
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
}) {
  const normalizedCells = normalizeSignalMonitorMatrixCells(input.cells);
  if (!normalizedCells.length) {
    return {
      exact: false,
      cells: [] as SignalMonitorMatrixCellRequest[],
      timeframes: null as SignalMonitorMatrixTimeframe[] | null,
      cacheKeyPart: null as string | null,
    };
  }
  const allowedSymbols = new Set(input.allowedSymbols);
  const cells = normalizedCells.filter((cell) => allowedSymbols.has(cell.symbol));
  const cap = resolveSignalMonitorMatrixExactCellCap(input);
  if (cap != null && cells.length > cap) {
    throw new HttpError(400, "Signal monitor matrix exact-cell request is too large.", {
      code: "signal_monitor_matrix_cells_limit_exceeded",
      detail: `At ${input.pressure} pressure, request at most ${cap} matrix cells.`,
      data: { pressure: input.pressure, requestedCells: cells.length, maxCells: cap },
    });
  }
  const timeframes = Array.from(new Set(cells.map((cell) => cell.timeframe)));
  const cacheKeyPart = cells
    .map((cell) => `${cell.symbol}:${cell.timeframe}`)
    .join(",");
  return { exact: true, cells, timeframes, cacheKeyPart };
}

function cappedSignalMatrixSettings(
  profile: SignalMonitorProfileRow,
  pressureLevel?: ApiResourcePressureLevel,
  options: {
    automatic?: boolean;
    request?: {
      clientRole?: SignalMonitorMatrixClientRole;
      requestOrigin?: SignalMonitorMatrixRequestOrigin;
      cells?: SignalMonitorMatrixCellRequest[];
    };
  } = {},
) {
  const resourcePressureLevel =
    pressureLevel ?? getApiResourcePressureSnapshot().resourceLevel;
  void options;
  const configuredMaxSymbols = positiveInteger(
    profile.maxSymbols,
    DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
    1,
    SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
  );
  const configuredConcurrency = positiveInteger(
    profile.evaluationConcurrency,
    DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY,
    1,
    SIGNAL_MONITOR_EVALUATION_CONCURRENCY_LIMIT,
  );
  return {
    pressure: resourcePressureLevel,
    maxSymbols: configuredMaxSymbols,
    concurrency: configuredConcurrency,
  };
}

function shouldBypassSoftSignalMonitorMatrixPressure(input: {
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
  symbols?: string[];
  cells?: SignalMonitorMatrixCellRequest[];
}) {
  return (
    input.clientRole === "leader" &&
    (input.requestOrigin === "startup" || input.requestOrigin === "poll") &&
    ((Array.isArray(input.symbols) && input.symbols.length > 0) ||
      (Array.isArray(input.cells) && input.cells.length > 0))
  );
}

function resolveSignalMonitorMatrixConcurrency(input: {
  matrixSettings: ReturnType<typeof cappedSignalMatrixSettings>;
  request: {
    clientRole?: SignalMonitorMatrixClientRole;
    requestOrigin?: SignalMonitorMatrixRequestOrigin;
    symbols?: string[];
    cells?: SignalMonitorMatrixCellRequest[];
  };
  symbolCount: number;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}) {
  let concurrency = input.matrixSettings.concurrency;
  if (
    (input.matrixSettings.pressure === "normal" ||
      input.matrixSettings.pressure === "watch") &&
    shouldBypassSoftSignalMonitorMatrixPressure(input.request) &&
    input.symbolCount <= SIGNAL_MONITOR_MATRIX_SOFT_BYPASS_MAX_SYMBOLS
  ) {
    concurrency = Math.max(input.matrixSettings.concurrency, input.symbolCount);
  }
  const env = input.env ?? process.env;
  if (pythonComputeEnabledForSignalMatrix(env)) {
    const pythonLimit = readSignalMonitorPositiveInteger(
      env["PYRUS_PYTHON_SIGNAL_MATRIX_CONCURRENCY"] ??
        env["PYRUS_PYTHON_COMPUTE_MAX_JOBS"],
      SIGNAL_MONITOR_PYTHON_SIGNAL_MATRIX_CONCURRENCY,
    );
    return Math.max(1, Math.min(concurrency, pythonLimit));
  }
  return concurrency;
}

export function cappedSignalMonitorEvaluationProfile(
  profile: DbSignalMonitorProfile,
  pressureLevel?: ApiResourcePressureLevel,
) {
  const resourcePressureLevel =
    pressureLevel ?? getApiResourcePressureSnapshot().resourceLevel;
  const configuredMaxSymbols = positiveInteger(
    profile.maxSymbols,
    DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
    1,
    SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
  );
  const configuredConcurrency = positiveInteger(
    profile.evaluationConcurrency,
    DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY,
    1,
    SIGNAL_MONITOR_EVALUATION_CONCURRENCY_LIMIT,
  );

  return {
    pressure: resourcePressureLevel,
    capped: false,
    profile: {
      ...profile,
      maxSymbols: configuredMaxSymbols,
      evaluationConcurrency: configuredConcurrency,
    },
  };
}

function positiveInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const resolved = Number(value);
  return Number.isFinite(resolved)
    ? Math.min(max, Math.max(min, Math.round(resolved)))
    : fallback;
}

function numericValueOrNull(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericStringOrNull(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(6)
    : null;
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

function signalMonitorBarAnchorAt(
  bar: SignalMonitorBarSnapshot | undefined,
): Date | null {
  return dateOrNull(bar?.timestamp);
}

function signalMonitorBarClosedAt(
  bar: SignalMonitorBarSnapshot | undefined,
): Date | null {
  return dateOrNull(bar?.dataUpdatedAt) ?? signalMonitorBarAnchorAt(bar);
}

function stockMinuteAggregateClosedAtMs(
  aggregate: StockMinuteAggregateMessage,
): number {
  const startMs = Number(aggregate.startMs);
  const endMs = Number(aggregate.endMs);
  const expectedExclusiveEndMs = startMs + TIMEFRAME_MS["1m"];
  if (
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    Math.abs(endMs - expectedExclusiveEndMs) <= 1
  ) {
    return expectedExclusiveEndMs;
  }
  return endMs;
}

function profileToResponse(profile: DbSignalMonitorProfile) {
  return {
    id: profile.id,
    environment: profile.environment,
    enabled: profile.enabled,
    watchlistId: profile.watchlistId ?? null,
    timeframe: resolveSignalMonitorTimeframe(profile.timeframe),
    pyrusSignalsSettings: asRecord(profile.pyrusSignalsSettings),
    freshWindowBars: profile.freshWindowBars,
    pollIntervalSeconds: profile.pollIntervalSeconds,
    maxSymbols: profile.maxSymbols,
    evaluationConcurrency: profile.evaluationConcurrency,
    lastEvaluatedAt: profile.lastEvaluatedAt ?? null,
    lastError: profile.lastError ?? null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function trendDirectionToSignalDirection(
  trendDirection: unknown,
): SignalMonitorDirection | null {
  if (trendDirection === "bullish") {
    return "buy";
  }
  if (trendDirection === "bearish") {
    return "sell";
  }
  return null;
}

function stateToResponse(state: DbSignalMonitorSymbolState) {
  const status: SignalMonitorStatus = [
    "ok",
    "idle",
    "stale",
    "unavailable",
    "error",
    "unknown",
  ].includes(state.status)
    ? (state.status as SignalMonitorStatus)
    : "unknown";
  const current = status === "ok";
  const storedDirection =
    (state.currentSignalDirection === "buy" ||
      state.currentSignalDirection === "sell")
      ? state.currentSignalDirection
      : null;
  const displayDirection =
    storedDirection ?? trendDirectionToSignalDirection(state.trendDirection);
  const hasStoredSignal = Boolean(storedDirection && state.currentSignalAt);
  // Backend-authored actionability on REST, mirroring the SSE matrix stream,
  // so every transport carries the same verdict. freshWindowBars only feeds
  // the (discarded) fresh recompute — eligibility does not use it.
  const actionability = buildSignalMonitorActionability({
    direction: storedDirection,
    signalAt: hasStoredSignal ? (state.currentSignalAt ?? null) : null,
    barsSinceSignal: hasStoredSignal ? (state.barsSinceSignal ?? null) : null,
    stale: status !== "ok",
    staleBlocker: signalMonitorActionBlockerForStatus(status),
    freshWindowBars: 0,
  });

  return {
    id: state.id,
    profileId: state.profileId,
    symbol: state.symbol,
    timeframe: resolveSignalMonitorTimeframe(state.timeframe),
    currentSignalDirection: displayDirection,
    currentSignalAt: hasStoredSignal ? (state.currentSignalAt ?? null) : null,
    currentSignalPrice: hasStoredSignal
      ? numericValueOrNull(state.currentSignalPrice)
      : null,
    currentSignalClose: hasStoredSignal
      ? numericValueOrNull(state.currentSignalClose)
      : null,
    currentSignalMfePercent: hasStoredSignal
      ? numericValueOrNull(state.currentSignalMfePercent)
      : null,
    currentSignalMaePercent: hasStoredSignal
      ? numericValueOrNull(state.currentSignalMaePercent)
      : null,
    filterState: hasStoredSignal
      ? signalMonitorFilterStateOrNull(state.filterState)
      : null,
    latestBarAt: state.latestBarAt ?? null,
    // Current price as of the last evaluation. Independent of signal identity,
    // so it is carried even when there is no stored signal (it powers the Move
    // column's "current" side regardless of direction/freshness).
    latestBarClose: numericValueOrNull(state.latestBarClose),
    barsSinceSignal: hasStoredSignal ? (state.barsSinceSignal ?? null) : null,
    fresh: current && hasStoredSignal ? state.fresh : false,
    status,
    active: state.active,
    lastEvaluatedAt: state.lastEvaluatedAt ?? null,
    lastError: state.lastError ?? null,
    // Always-defined current trend (bullish/bearish), persisted alongside the
    // sparse crossover so the bootstrap can surface a direction for every symbol.
    trendDirection: state.trendDirection ?? null,
    actionEligible: actionability.actionEligible,
    actionBlocker: actionability.actionBlocker,
  };
}

function stateToResponseForSnapshot(
  state: DbSignalMonitorSymbolState,
  input: {
    timeframe: SignalMonitorMatrixTimeframe;
    evaluatedAt: Date;
    markNonCurrentStale?: boolean;
  },
) {
  const response = {
    ...stateToResponse(state),
    timeframe: input.timeframe,
  };
  // The live aggregate ring keeps streaming (incl. extended hours) even when the
  // producer has stopped refreshing this cell, so a current ring bar must rescue
  // a lane whose persisted bar age would otherwise trip the stale relabel below.
  const streamLatestBarAt = signalMonitorStreamLaneLatestCompletedBarAt({
    symbol: state.symbol,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
  });
  if (
    !input.markNonCurrentStale ||
    isSignalMonitorStateCurrentForLane({
      state,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
      streamLatestBarAt,
    })
  ) {
    return response;
  }

  const nonCurrentStatus = signalMonitorNonCurrentStatus({
    latestBarAt: response.latestBarAt,
    evaluatedAt: input.evaluatedAt,
  });
  const staleDirection = response.latestBarAt
    ? response.currentSignalDirection
    : null;
  const staleSignalAt = response.latestBarAt ? response.currentSignalAt : null;
  const staleBarsSinceSignal = response.latestBarAt
    ? response.barsSinceSignal
    : null;
  // The lane relabel changes status/identity, so actionability re-authors on
  // the rewritten values (always ineligible: the lane is stale or unavailable).
  const staleActionability = buildSignalMonitorActionability({
    direction: staleDirection,
    signalAt: staleSignalAt,
    barsSinceSignal: staleBarsSinceSignal,
    stale: true,
    staleBlocker: signalMonitorActionBlockerForStatus(nonCurrentStatus),
    freshWindowBars: 0,
  });
  return {
    ...response,
    currentSignalDirection: staleDirection,
    currentSignalAt: staleSignalAt,
    currentSignalPrice: response.latestBarAt
      ? response.currentSignalPrice
      : null,
    currentSignalClose: response.latestBarAt
      ? response.currentSignalClose
      : null,
    currentSignalMfePercent: response.latestBarAt
      ? response.currentSignalMfePercent
      : null,
    currentSignalMaePercent: response.latestBarAt
      ? response.currentSignalMaePercent
      : null,
    filterState: response.latestBarAt ? response.filterState : null,
    barsSinceSignal: staleBarsSinceSignal,
    fresh: false,
    status: nonCurrentStatus,
    lastError:
      response.lastError ??
      (response.latestBarAt
        ? null
      : "Signal monitor state has no latest bar; using persisted state without live bar refresh."),
    actionEligible: staleActionability.actionEligible,
    actionBlocker: staleActionability.actionBlocker,
  };
}

type SignalMonitorStateSnapshotState = ReturnType<typeof stateToResponse>;

function buildUnavailableSignalMonitorSnapshotState(input: {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}): SignalMonitorStateSnapshotState {
  return {
    id: `${input.profileId}:${input.symbol}:${input.timeframe}:unavailable`,
    profileId: input.profileId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    currentSignalDirection: null,
    currentSignalAt: null,
    currentSignalPrice: null,
    currentSignalClose: null,
    currentSignalMfePercent: null,
    currentSignalMaePercent: null,
    filterState: null,
    latestBarAt: null,
    latestBarClose: null,
    barsSinceSignal: null,
    fresh: false,
    status: "unavailable",
    active: true,
    lastEvaluatedAt: input.evaluatedAt,
    lastError: "No signal monitor state is available for this symbol/timeframe.",
    trendDirection: null,
    actionEligible: false,
    actionBlocker: "no_signal",
  };
}

function completeSignalMonitorStateSnapshotCoverage<
  T extends {
    profile: { id: string };
    states: SignalMonitorStateSnapshotState[];
    evaluatedAt: Date | string;
    universeSymbols: string[];
  },
>(snapshot: T): T {
  const universeSymbols = Array.from(
    new Set(
      (Array.isArray(snapshot.universeSymbols) ? snapshot.universeSymbols : [])
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
  if (!universeSymbols.length) {
    return snapshot;
  }

  const timeframes = resolveSignalMonitorActiveTimeframes();
  const existingCells = new Set(
    (Array.isArray(snapshot.states) ? snapshot.states : []).map(
      (state) =>
        `${normalizeSymbol(state.symbol).toUpperCase()}:${String(
          state.timeframe || "",
        )}`,
    ),
  );
  const evaluatedAt = dateOrNull(snapshot.evaluatedAt) ?? new Date();
  const missingStates: SignalMonitorStateSnapshotState[] = [];
  for (const symbol of universeSymbols) {
    for (const timeframe of timeframes) {
      const key = `${symbol}:${timeframe}`;
      if (existingCells.has(key)) {
        continue;
      }
      existingCells.add(key);
      missingStates.push(
        buildUnavailableSignalMonitorSnapshotState({
          profileId: snapshot.profile.id,
          symbol,
          timeframe,
          evaluatedAt,
        }),
      );
    }
  }

  if (!missingStates.length) {
    return snapshot;
  }
  return {
    ...snapshot,
    states: [...snapshot.states, ...missingStates],
  };
}

function eventToResponse(event: DbSignalMonitorEvent) {
  return {
    id: event.id,
    profileId: event.profileId,
    environment: event.environment,
    symbol: event.symbol,
    timeframe: resolveSignalMonitorTimeframe(event.timeframe),
    direction: event.direction as SignalMonitorDirection,
    signalAt: event.signalAt,
    signalPrice: numericValueOrNull(event.signalPrice),
    close: numericValueOrNull(event.close),
    emittedAt: event.emittedAt,
    source: normalizeLegacyAlgoBrandText(event.source),
    payload: normalizeLegacyAlgoBranding(asRecord(event.payload)),
  };
}

type SignalMonitorEventResponse = ReturnType<typeof eventToResponse>;

const SIGNAL_MONITOR_EVENTS_DEFAULT_PAGE_SIZE = 100;
const SIGNAL_MONITOR_EVENTS_MAX_PAGE_SIZE = 1_000;
const SIGNAL_MONITOR_EVENTS_DB_FALLBACK_BACKOFF_MS = 15_000;
const SIGNAL_MONITOR_EVENTS_DB_FALLBACK_WARNING_COOLDOWN_MS = 60_000;
const SIGNAL_MONITOR_BREADTH_HISTORY_RANGES: readonly SignalMonitorBreadthHistoryRange[] =
  ["hour", "day", "week", "month"];
const SIGNAL_MONITOR_BREADTH_HISTORY_BUCKET_MINUTES: Record<
  SignalMonitorBreadthHistoryRange,
  number
> = {
  hour: 2,
  day: 15,
  week: 120,
  month: 1440,
};

type SignalMonitorEventsCursor = {
  signalAt: Date;
  id: string;
};

type SignalMonitorBreadthHistorySourceRow = {
  symbol?: string | null;
  timeframe?: string | null;
  direction?: string | null;
  signalAt?: Date | string | null;
  at?: Date | string | null;
};

type SignalMonitorBreadthSeedRow = {
  symbol?: string | null;
  timeframe?: string | null;
  direction?: string | null;
};

type SignalMonitorBreadthPoint = {
  at: Date;
  buy: number;
  sell: number;
  net: number;
  total: number;
};

type SignalMonitorBreadthHistoryPayload = {
  range: SignalMonitorBreadthHistoryRange;
  from: Date;
  to: Date;
  generatedAt: Date;
  bucketMinutes: number;
  points: SignalMonitorBreadthPoint[];
  timeframes: Array<{
    timeframe: string;
    points: SignalMonitorBreadthPoint[];
  }>;
};

export type SignalMonitorBreadthParityField =
  | "point"
  | "buy"
  | "sell"
  | "net"
  | "total";

export type SignalMonitorBreadthParityMismatchReason =
  | "value_mismatch"
  | "snapshot_missing"
  | "event_missing";

export type SignalMonitorBreadthParityMismatch = {
  range: SignalMonitorBreadthHistoryRange;
  timeframe: string;
  at: string;
  field: SignalMonitorBreadthParityField;
  reason: SignalMonitorBreadthParityMismatchReason;
  snapshot: number | null;
  event: number | null;
};

type SignalMonitorBreadthParityCounts = {
  comparedPoints: number;
  missingSnapshotPoints: number;
  missingEventPoints: number;
  mismatches: number;
};

export type SignalMonitorBreadthEventAnchorCoverage = {
  activeCells: number;
  cellsWithEvent: number;
  cellsMissingEvent: number;
  cellsDirectionMismatch: number;
};

export type SignalMonitorBreadthParityRangeReport = {
  range: SignalMonitorBreadthHistoryRange;
  from: string;
  to: string;
  bucketMinutes: number;
  snapshotRows: number;
  seedRows: number;
  eventRows: number;
  snapshotsCoverWindow: boolean;
  counts: SignalMonitorBreadthParityCounts;
};

export type SignalMonitorBreadthParityReport = {
  environment: RuntimeMode;
  generatedAt: string;
  ranges: SignalMonitorBreadthParityRangeReport[];
  counts: SignalMonitorBreadthParityCounts & {
    ranges: number;
  };
  eventAnchorCoverage: SignalMonitorBreadthEventAnchorCoverage;
  mismatchSummary: {
    byRange: Record<string, number>;
    byTimeframe: Record<string, number>;
    byField: Record<string, number>;
    byReason: Record<string, number>;
  };
  mismatches: SignalMonitorBreadthParityMismatch[];
};

export type SignalMonitorEventAnchorBackfillReason =
  | "missing_event_anchor"
  | "latest_direction_mismatch";

export type SignalMonitorEventAnchorBackfillCandidate = {
  reason: SignalMonitorEventAnchorBackfillReason;
  profileId: string;
  environment: RuntimeMode;
  symbol: string;
  timeframe: string;
  direction: SignalMonitorDirection;
  signalAt: string;
  signalPrice: number | null;
  close: number | null;
  eventKey: string;
  source: "state-anchor-backfill";
  latestEventDirection: SignalMonitorDirection | null;
  latestEventAt: string | null;
  payload: Record<string, unknown>;
};

export type SignalMonitorEventAnchorBackfillSkipped = {
  reason: "missing_signal_at";
  profileId: string;
  environment: RuntimeMode;
  symbol: string;
  timeframe: string;
  direction: SignalMonitorDirection;
  latestEventDirection: SignalMonitorDirection | null;
  latestEventAt: string | null;
};

export type SignalMonitorEventAnchorBackfillPlan = {
  environment: RuntimeMode;
  generatedAt: string;
  dryRun: boolean;
  counts: {
    activeCellsNeedingAnchor: number;
    candidateEvents: number;
    skippedNoSignalAt: number;
    sampledCandidates: number;
    sampledSkipped: number;
  };
  applied: {
    attemptedEvents: number;
    insertedEvents: number;
    skippedExistingEvents: number;
  };
  candidates: SignalMonitorEventAnchorBackfillCandidate[];
  skipped: SignalMonitorEventAnchorBackfillSkipped[];
};

const normalizeBreadthDirection = (value: unknown): "buy" | "sell" | null => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : null;
};

function resolveSignalMonitorBreadthHistoryRange(
  value: unknown,
): SignalMonitorBreadthHistoryRange {
  const normalized = String(value || "").trim();
  return SIGNAL_MONITOR_BREADTH_HISTORY_RANGES.includes(
    normalized as SignalMonitorBreadthHistoryRange,
  )
    ? (normalized as SignalMonitorBreadthHistoryRange)
    : "day";
}

function marketDateTimeParts(date: Date) {
  const parts = Object.fromEntries(
    MARKET_DATE_TIME_PARTS_FORMATTER.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: Number(parts.year) || date.getUTCFullYear(),
    month: Number(parts.month) || date.getUTCMonth() + 1,
    day: Number(parts.day) || date.getUTCDate(),
    hour: Number(parts.hour) || 0,
    minute: Number(parts.minute) || 0,
    second: Number(parts.second) || 0,
  };
}

function marketZonedDateTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
}) {
  const desiredUtcMs = Date.UTC(
    input.year,
    input.month - 1,
    input.day,
    input.hour ?? 0,
    input.minute ?? 0,
    input.second ?? 0,
  );
  let utcMs = desiredUtcMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = marketDateTimeParts(new Date(utcMs));
    const renderedUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const delta = desiredUtcMs - renderedUtcMs;
    if (delta === 0) {
      break;
    }
    utcMs += delta;
  }
  return new Date(utcMs);
}

function startOfMarketDate(now: Date) {
  const parts = marketDateTimeParts(now);
  return marketZonedDateTimeToUtc({
    year: parts.year,
    month: parts.month,
    day: parts.day,
  });
}

function resolveSignalMonitorBreadthHistoryWindow(input: {
  range?: unknown;
  now?: Date;
}) {
  const range = resolveSignalMonitorBreadthHistoryRange(input.range);
  const to = input.now && Number.isFinite(input.now.getTime())
    ? input.now
    : new Date();
  const from =
    range === "hour"
      ? new Date(to.getTime() - 60 * 60_000)
      : range === "week"
        ? new Date(to.getTime() - 7 * 24 * 60 * 60_000)
        : range === "month"
          ? new Date(to.getTime() - 30 * 24 * 60 * 60_000)
          : startOfMarketDate(to);
  const bucketMinutes =
    SIGNAL_MONITOR_BREADTH_HISTORY_BUCKET_MINUTES[range];
  return {
    range,
    from,
    to,
    generatedAt: to,
    bucketMinutes,
  };
}

const alignSignalMonitorBreadthBucketMs = (
  value: Date | string,
  bucketMs: number,
) => {
  const date = dateOrNull(value);
  if (!date) {
    return null;
  }
  return Math.floor(date.getTime() / bucketMs) * bucketMs;
};

// Standing breadth over time: replay signal-flip events to count how many
// symbols are *on buy* vs *on sell* at each bucket (so buy + sell compete and
// add up to the tracked universe). State carries forward between flips and is
// seeded from the latest direction before the window so short ranges are full.
function buildSignalMonitorBreadthHistoryResponse(
  events: SignalMonitorBreadthHistorySourceRow[],
  seedRows: SignalMonitorBreadthSeedRow[],
  input: {
    range: SignalMonitorBreadthHistoryRange;
    from: Date;
    to: Date;
    generatedAt: Date;
    bucketMinutes: number;
  },
) {
  const bucketMs = Math.max(1, input.bucketMinutes) * 60_000;
  const fromBucketMs =
    alignSignalMonitorBreadthBucketMs(input.from, bucketMs) ??
    input.from.getTime();
  const toBucketMs =
    alignSignalMonitorBreadthBucketMs(input.to, bucketMs) ??
    input.to.getTime();

  // Standing direction per symbol+timeframe cell (drives the per-timeframe
  // series) and per symbol across timeframes (drives the aggregate readout).
  const cellState = new Map<string, "buy" | "sell">();
  const symbolState = new Map<string, { direction: "buy" | "sell"; at: number }>();
  const timeframeKeys = new Set<string>();

  for (const row of Array.isArray(seedRows) ? seedRows : []) {
    const direction = normalizeBreadthDirection(row.direction);
    const symbol = String(row.symbol || "").trim();
    const timeframe = String(row.timeframe || "").trim().toLowerCase();
    if (!direction || !symbol || !timeframe) {
      continue;
    }
    cellState.set(
      `${symbol}${SIGNAL_MONITOR_CELL_KEY_SEPARATOR}${timeframe}`,
      direction,
    );
    timeframeKeys.add(timeframe);
    if (!symbolState.has(symbol)) {
      symbolState.set(symbol, { direction, at: Number.NEGATIVE_INFINITY });
    }
  }

  const sortedEvents = (Array.isArray(events) ? events : [])
    .map((row) => {
      const direction = normalizeBreadthDirection(row.direction);
      const symbol = String(row.symbol || "").trim();
      const timeframe = String(row.timeframe || "").trim().toLowerCase();
      const at = dateOrNull(row.signalAt ?? row.at)?.getTime() ?? null;
      if (!direction || !symbol || !timeframe || at == null) {
        return null;
      }
      return { direction, symbol, timeframe, at };
    })
    .filter(
      (
        row,
      ): row is { direction: "buy" | "sell"; symbol: string; timeframe: string; at: number } =>
        row != null,
    )
    .sort((a, b) => a.at - b.at);

  for (const event of sortedEvents) {
    timeframeKeys.add(event.timeframe);
  }

  type BreadthPoint = {
    at: Date;
    buy: number;
    sell: number;
    net: number;
    total: number;
  };
  const aggregatePoints: BreadthPoint[] = [];
  const timeframePoints = new Map<string, BreadthPoint[]>();
  for (const timeframe of timeframeKeys) {
    timeframePoints.set(timeframe, []);
  }

  let eventIndex = 0;
  for (let bucket = fromBucketMs; bucket <= toBucketMs; bucket += bucketMs) {
    const bucketEnd = bucket + bucketMs;
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex].at < bucketEnd) {
      const event = sortedEvents[eventIndex];
      cellState.set(
        `${event.symbol}${SIGNAL_MONITOR_CELL_KEY_SEPARATOR}${event.timeframe}`,
        event.direction,
      );
      const existing = symbolState.get(event.symbol);
      if (!existing || event.at >= existing.at) {
        symbolState.set(event.symbol, { direction: event.direction, at: event.at });
      }
      eventIndex += 1;
    }

    const at = new Date(bucket);
    const timeframeCounts = new Map<string, { buy: number; sell: number }>();
    for (const [key, direction] of cellState) {
      const timeframe = key.slice(
        key.indexOf(SIGNAL_MONITOR_CELL_KEY_SEPARATOR) + 1,
      );
      const counts = timeframeCounts.get(timeframe) ?? { buy: 0, sell: 0 };
      counts[direction] += 1;
      timeframeCounts.set(timeframe, counts);
    }
    for (const timeframe of timeframeKeys) {
      const counts = timeframeCounts.get(timeframe) ?? { buy: 0, sell: 0 };
      timeframePoints.get(timeframe)?.push({
        at,
        buy: counts.buy,
        sell: counts.sell,
        net: counts.buy - counts.sell,
        total: counts.buy + counts.sell,
      });
    }

    let aggregateBuy = 0;
    let aggregateSell = 0;
    for (const { direction } of symbolState.values()) {
      if (direction === "buy") {
        aggregateBuy += 1;
      } else {
        aggregateSell += 1;
      }
    }
    aggregatePoints.push({
      at,
      buy: aggregateBuy,
      sell: aggregateSell,
      net: aggregateBuy - aggregateSell,
      total: aggregateBuy + aggregateSell,
    });
  }

  const timeframes = Array.from(timeframeKeys)
    .sort()
    .map((timeframe) => ({
      timeframe,
      points: timeframePoints.get(timeframe) ?? [],
    }));

  return {
    range: input.range,
    from: input.from,
    to: input.to,
    generatedAt: input.generatedAt,
    bucketMinutes: input.bucketMinutes,
    points: aggregatePoints,
    timeframes,
  };
}

const SIGNAL_MONITOR_BREADTH_AGGREGATE_TIMEFRAME = "all";
const SIGNAL_MONITOR_BREADTH_SNAPSHOT_INTERVAL_MS = 5 * 60_000;

type SignalMonitorBreadthSnapshotRow = {
  timeframe: string;
  capturedAt: Date | string | null;
  buy: number;
  sell: number;
};

// Build the breadth response from recorded snapshots: carry the latest snapshot
// forward across buckets so the line is continuous between captures.
function buildSignalMonitorBreadthFromSnapshots(
  rows: SignalMonitorBreadthSnapshotRow[],
  input: {
    range: SignalMonitorBreadthHistoryRange;
    from: Date;
    to: Date;
    generatedAt: Date;
    bucketMinutes: number;
  },
) {
  const bucketMs = Math.max(1, input.bucketMinutes) * 60_000;
  const fromBucketMs =
    alignSignalMonitorBreadthBucketMs(input.from, bucketMs) ?? input.from.getTime();
  const toBucketMs =
    alignSignalMonitorBreadthBucketMs(input.to, bucketMs) ?? input.to.getTime();

  const byTimeframe = new Map<string, Array<{ at: number; buy: number; sell: number }>>();
  for (const row of rows) {
    const timeframe = String(row.timeframe || "").trim().toLowerCase();
    const at = dateOrNull(row.capturedAt)?.getTime() ?? null;
    if (!timeframe || at == null) {
      continue;
    }
    const series = byTimeframe.get(timeframe) ?? [];
    series.push({ at, buy: Math.max(0, Number(row.buy) || 0), sell: Math.max(0, Number(row.sell) || 0) });
    byTimeframe.set(timeframe, series);
  }
  for (const series of byTimeframe.values()) {
    series.sort((a, b) => a.at - b.at);
  }

  const buildPoints = (series: Array<{ at: number; buy: number; sell: number }>) => {
    const points = [];
    let index = 0;
    let last = series.length ? { buy: series[0].buy, sell: series[0].sell } : { buy: 0, sell: 0 };
    for (let bucket = fromBucketMs; bucket <= toBucketMs; bucket += bucketMs) {
      const bucketEnd = bucket + bucketMs;
      while (index < series.length && series[index].at < bucketEnd) {
        last = { buy: series[index].buy, sell: series[index].sell };
        index += 1;
      }
      points.push({
        at: new Date(bucket),
        buy: last.buy,
        sell: last.sell,
        net: last.buy - last.sell,
        total: last.buy + last.sell,
      });
    }
    return points;
  };

  const timeframes = Array.from(byTimeframe.keys())
    .filter((timeframe) => timeframe !== SIGNAL_MONITOR_BREADTH_AGGREGATE_TIMEFRAME)
    .sort()
    .map((timeframe) => ({ timeframe, points: buildPoints(byTimeframe.get(timeframe) ?? []) }));

  return {
    range: input.range,
    from: input.from,
    to: input.to,
    generatedAt: input.generatedAt,
    bucketMinutes: input.bucketMinutes,
    points: buildPoints(byTimeframe.get(SIGNAL_MONITOR_BREADTH_AGGREGATE_TIMEFRAME) ?? []),
    timeframes,
  };
}

function signalMonitorBreadthSnapshotsCoverWindow(
  rows: SignalMonitorBreadthSnapshotRow[],
  input: { from: Date; bucketMinutes: number },
) {
  const earliestSnapshotMs = rows.length
    ? dateOrNull(rows[0]?.capturedAt)?.getTime() ?? null
    : null;
  return (
    earliestSnapshotMs != null &&
    earliestSnapshotMs <= input.from.getTime() + input.bucketMinutes * 60_000 * 2
  );
}

async function listSignalMonitorBreadthSnapshotRowsForWindow(
  environment: RuntimeMode,
  window: ReturnType<typeof resolveSignalMonitorBreadthHistoryWindow>,
): Promise<Array<SignalMonitorBreadthSnapshotRow & { total?: number }>> {
  return db
    .select({
      timeframe: signalMonitorBreadthSnapshotsTable.timeframe,
      capturedAt: signalMonitorBreadthSnapshotsTable.capturedAt,
      buy: signalMonitorBreadthSnapshotsTable.buy,
      sell: signalMonitorBreadthSnapshotsTable.sell,
      total: signalMonitorBreadthSnapshotsTable.total,
    })
    .from(signalMonitorBreadthSnapshotsTable)
    .where(
      and(
        eq(signalMonitorBreadthSnapshotsTable.environment, environment),
        gte(signalMonitorBreadthSnapshotsTable.capturedAt, window.from),
        lte(signalMonitorBreadthSnapshotsTable.capturedAt, window.to),
      ),
    )
    .orderBy(signalMonitorBreadthSnapshotsTable.capturedAt);
}

async function listSignalMonitorBreadthSeedRowsForWindow(
  environment: RuntimeMode,
  window: ReturnType<typeof resolveSignalMonitorBreadthHistoryWindow>,
): Promise<SignalMonitorBreadthSeedRow[]> {
  const seedResult = await db.execute(sql`
    SELECT DISTINCT ON (e.symbol, e.timeframe)
      e.symbol, e.timeframe, e.direction
    FROM signal_monitor_events e
    JOIN signal_monitor_profiles p ON e.profile_id = p.id
    JOIN signal_monitor_symbol_states s
      ON s.profile_id = p.id
      AND s.symbol = e.symbol
      AND s.timeframe = e.timeframe
    WHERE e.environment = ${environment}
      AND p.environment = ${environment}
      AND p.enabled = true
      AND s.active = true
      AND s.current_signal_direction IN ('buy', 'sell')
      AND e.signal_at < ${window.from}
      AND e.direction IN ('buy', 'sell')
    ORDER BY e.symbol, e.timeframe, e.signal_at DESC
  `);
  return (seedResult.rows ?? []) as SignalMonitorBreadthSeedRow[];
}

async function listSignalMonitorBreadthEventRowsForWindow(
  environment: RuntimeMode,
  window: ReturnType<typeof resolveSignalMonitorBreadthHistoryWindow>,
): Promise<SignalMonitorBreadthHistorySourceRow[]> {
  const eventResult = await db.execute(sql`
    SELECT e.symbol, e.timeframe, e.direction, e.signal_at AS "signalAt"
    FROM signal_monitor_events e
    JOIN signal_monitor_profiles p ON e.profile_id = p.id
    JOIN signal_monitor_symbol_states s
      ON s.profile_id = p.id
      AND s.symbol = e.symbol
      AND s.timeframe = e.timeframe
    WHERE e.environment = ${environment}
      AND p.environment = ${environment}
      AND p.enabled = true
      AND s.active = true
      AND s.current_signal_direction IN ('buy', 'sell')
      AND e.signal_at >= ${window.from}
      AND e.signal_at <= ${window.to}
      AND e.direction IN ('buy', 'sell')
    ORDER BY e.signal_at
  `);
  return (eventResult.rows ?? []) as SignalMonitorBreadthHistorySourceRow[];
}

async function getSignalMonitorBreadthEventAnchorCoverage(
  environment: RuntimeMode,
): Promise<SignalMonitorBreadthEventAnchorCoverage> {
  const result = await db.execute(sql`
    WITH active_cells AS (
      SELECT
        s.profile_id,
        s.symbol,
        s.timeframe,
        s.current_signal_direction AS state_direction
      FROM signal_monitor_symbol_states s
      JOIN signal_monitor_profiles p ON s.profile_id = p.id
      WHERE p.environment = ${environment}
        AND p.enabled = true
        AND s.active = true
        AND s.current_signal_direction IN ('buy', 'sell')
    ),
    latest_events AS (
      SELECT DISTINCT ON (e.profile_id, e.symbol, e.timeframe)
        e.profile_id,
        e.symbol,
        e.timeframe,
        e.direction
      FROM signal_monitor_events e
      JOIN signal_monitor_profiles p ON e.profile_id = p.id
      WHERE e.environment = ${environment}
        AND p.environment = ${environment}
        AND p.enabled = true
        AND e.direction IN ('buy', 'sell')
      ORDER BY e.profile_id, e.symbol, e.timeframe, e.signal_at DESC
    )
    SELECT
      count(*)::int AS "activeCells",
      count(latest_events.symbol)::int AS "cellsWithEvent",
      count(*) FILTER (WHERE latest_events.symbol IS NULL)::int AS "cellsMissingEvent",
      count(*) FILTER (
        WHERE latest_events.symbol IS NOT NULL
          AND latest_events.direction <> active_cells.state_direction
      )::int AS "cellsDirectionMismatch"
    FROM active_cells
    LEFT JOIN latest_events
      ON latest_events.profile_id = active_cells.profile_id
      AND latest_events.symbol = active_cells.symbol
      AND latest_events.timeframe = active_cells.timeframe
  `);
  const row = (result.rows?.[0] ?? {}) as Record<string, unknown>;
  return {
    activeCells: Number(row["activeCells"]) || 0,
    cellsWithEvent: Number(row["cellsWithEvent"]) || 0,
    cellsMissingEvent: Number(row["cellsMissingEvent"]) || 0,
    cellsDirectionMismatch: Number(row["cellsDirectionMismatch"]) || 0,
  };
}

export async function buildSignalMonitorEventAnchorBackfillPlan(input: {
  environment?: RuntimeMode;
  generatedAt?: Date;
  candidateLimit?: number;
  apply?: boolean;
} = {}): Promise<SignalMonitorEventAnchorBackfillPlan> {
  const environment = resolveEnvironment(input.environment);
  const generatedAt =
    input.generatedAt && Number.isFinite(input.generatedAt.getTime())
      ? input.generatedAt
      : new Date();
  const candidateLimit = positiveInteger(input.candidateLimit, 50, 0, 10_000);
  const apply = input.apply === true;
  const result = await db.execute(sql`
    WITH active_cells AS (
      SELECT
        p.id AS profile_id,
        p.environment,
        s.id AS state_id,
        s.symbol,
        s.timeframe,
        s.current_signal_direction,
        s.current_signal_at,
        s.current_signal_price,
        s.current_signal_close,
        s.filter_state
      FROM signal_monitor_symbol_states s
      JOIN signal_monitor_profiles p ON s.profile_id = p.id
      WHERE p.environment = ${environment}
        AND p.enabled = true
        AND s.active = true
        AND s.current_signal_direction IN ('buy', 'sell')
    ),
    latest_events AS (
      SELECT DISTINCT ON (e.profile_id, e.symbol, e.timeframe)
        e.profile_id,
        e.symbol,
        e.timeframe,
        e.direction,
        e.signal_at
      FROM signal_monitor_events e
      JOIN signal_monitor_profiles p ON e.profile_id = p.id
      WHERE e.environment = ${environment}
        AND p.environment = ${environment}
        AND p.enabled = true
        AND e.direction IN ('buy', 'sell')
      ORDER BY e.profile_id, e.symbol, e.timeframe, e.signal_at DESC
    )
    SELECT
      active_cells.profile_id AS "profileId",
      active_cells.environment AS "environment",
      active_cells.state_id AS "stateId",
      active_cells.symbol AS "symbol",
      active_cells.timeframe AS "timeframe",
      active_cells.current_signal_direction AS "direction",
      active_cells.current_signal_at AS "signalAt",
      active_cells.current_signal_price AS "signalPrice",
      active_cells.current_signal_close AS "close",
      active_cells.filter_state AS "filterState",
      latest_events.direction AS "latestEventDirection",
      latest_events.signal_at AS "latestEventAt",
      CASE
        WHEN latest_events.symbol IS NULL THEN 'missing_event_anchor'
        ELSE 'latest_direction_mismatch'
      END AS "reason"
    FROM active_cells
    LEFT JOIN latest_events
      ON latest_events.profile_id = active_cells.profile_id
      AND latest_events.symbol = active_cells.symbol
      AND latest_events.timeframe = active_cells.timeframe
    WHERE latest_events.symbol IS NULL
      OR latest_events.direction <> active_cells.current_signal_direction
    ORDER BY active_cells.symbol, active_cells.timeframe
  `);
  const rows = (result.rows ?? []) as Record<string, unknown>[];
  const counts: SignalMonitorEventAnchorBackfillPlan["counts"] = {
    activeCellsNeedingAnchor: rows.length,
    candidateEvents: 0,
    skippedNoSignalAt: 0,
    sampledCandidates: 0,
    sampledSkipped: 0,
  };
  const candidates: SignalMonitorEventAnchorBackfillCandidate[] = [];
  const applyCandidates: SignalMonitorEventAnchorBackfillCandidate[] = [];
  const skipped: SignalMonitorEventAnchorBackfillSkipped[] = [];
  const generatedAtIso = generatedAt.toISOString();

  for (const row of rows) {
    const profileId = String(row["profileId"] || "");
    const symbol = normalizeSymbol(String(row["symbol"] || ""));
    const timeframe = String(row["timeframe"] || "").trim();
    const direction = normalizeBreadthDirection(row["direction"]);
    const latestEventDirection = normalizeBreadthDirection(row["latestEventDirection"]);
    const latestEventAt = dateOrNull(row["latestEventAt"])?.toISOString() ?? null;
    const signalAt = dateOrNull(row["signalAt"]);
    const reason =
      row["reason"] === "latest_direction_mismatch"
        ? "latest_direction_mismatch"
        : "missing_event_anchor";

    if (!profileId || !symbol || !timeframe || !direction) {
      continue;
    }

    if (!signalAt) {
      counts.skippedNoSignalAt += 1;
      if (skipped.length < candidateLimit) {
        skipped.push({
          reason: "missing_signal_at",
          profileId,
          environment,
          symbol,
          timeframe,
          direction,
          latestEventDirection,
          latestEventAt,
        });
      }
      continue;
    }

    counts.candidateEvents += 1;
    const signalAtIso = signalAt.toISOString();
    const filterState = signalMonitorFilterStateOrNull(row["filterState"]);
    const payload: Record<string, unknown> = {
      stateAnchorBackfill: {
        reason,
        stateId: row["stateId"] ? String(row["stateId"]) : null,
        latestEventDirection,
        latestEventAt,
        plannedAt: generatedAtIso,
      },
    };
    if (filterState) {
      payload.filterState = filterState;
    }
    const candidate: SignalMonitorEventAnchorBackfillCandidate = {
      reason,
      profileId,
      environment,
      symbol,
      timeframe,
      direction,
      signalAt: signalAtIso,
      signalPrice: numericValueOrNull(row["signalPrice"]),
      close: numericValueOrNull(row["close"]),
      eventKey: [
        "state-anchor",
        profileId,
        symbol,
        timeframe,
        signalAtIso,
        direction,
      ].join(":"),
      source: "state-anchor-backfill",
      latestEventDirection,
      latestEventAt,
      payload,
    };
    if (apply) {
      applyCandidates.push(candidate);
    }
    if (candidates.length < candidateLimit) {
      candidates.push(candidate);
    }
  }

  counts.sampledCandidates = candidates.length;
  counts.sampledSkipped = skipped.length;
  const applied = apply
    ? await insertSignalMonitorEventAnchorBackfillCandidates(applyCandidates)
    : {
        attemptedEvents: 0,
        insertedEvents: 0,
        skippedExistingEvents: 0,
      };

  return {
    environment,
    generatedAt: generatedAtIso,
    dryRun: !apply,
    counts,
    applied,
    candidates,
    skipped,
  };
}

async function insertSignalMonitorEventAnchorBackfillCandidates(
  candidates: SignalMonitorEventAnchorBackfillCandidate[],
): Promise<SignalMonitorEventAnchorBackfillPlan["applied"]> {
  let insertedEvents = 0;
  for (const candidate of candidates) {
    const signalAt = dateOrNull(candidate.signalAt);
    if (!signalAt) {
      continue;
    }
    const inserted = await db
      .insert(signalMonitorEventsTable)
      .values({
        profileId: candidate.profileId,
        eventKey: candidate.eventKey,
        environment: candidate.environment,
        symbol: candidate.symbol,
        timeframe: candidate.timeframe,
        direction: candidate.direction,
        signalAt,
        signalPrice: numericStringOrNull(candidate.signalPrice),
        close: numericStringOrNull(candidate.close),
        source: candidate.source,
        payload: candidate.payload,
        emittedAt: signalAt,
      })
      .onConflictDoNothing()
      .returning({ id: signalMonitorEventsTable.id });
    insertedEvents += inserted.length;
  }
  return {
    attemptedEvents: candidates.length,
    insertedEvents,
    skippedExistingEvents: candidates.length - insertedEvents,
  };
}

function signalMonitorBreadthSeriesByTimeframe(
  payload: SignalMonitorBreadthHistoryPayload,
): Map<string, SignalMonitorBreadthPoint[]> {
  const series = new Map<string, SignalMonitorBreadthPoint[]>();
  series.set(SIGNAL_MONITOR_BREADTH_AGGREGATE_TIMEFRAME, payload.points);
  for (const timeframe of payload.timeframes) {
    series.set(timeframe.timeframe, timeframe.points);
  }
  return series;
}

function signalMonitorBreadthPointIso(point: SignalMonitorBreadthPoint): string | null {
  const at = dateOrNull(point.at);
  return at ? at.toISOString() : null;
}

function compareSignalMonitorBreadthPayloads(input: {
  range: SignalMonitorBreadthHistoryRange;
  snapshotPayload: SignalMonitorBreadthHistoryPayload;
  eventPayload: SignalMonitorBreadthHistoryPayload;
  mismatchLimit: number;
}) {
  const counts: SignalMonitorBreadthParityCounts = {
    comparedPoints: 0,
    missingSnapshotPoints: 0,
    missingEventPoints: 0,
    mismatches: 0,
  };
  const summary = emptySignalMonitorBreadthParitySummary();
  const mismatches: SignalMonitorBreadthParityMismatch[] = [];
  const snapshotSeries = signalMonitorBreadthSeriesByTimeframe(input.snapshotPayload);
  const eventSeries = signalMonitorBreadthSeriesByTimeframe(input.eventPayload);
  const timeframes = Array.from(
    new Set([...snapshotSeries.keys(), ...eventSeries.keys()]),
  ).sort((left, right) => left.localeCompare(right));

  const pushMismatch = (mismatch: SignalMonitorBreadthParityMismatch) => {
    counts.mismatches += 1;
    addSignalMonitorBreadthParityMismatchToSummary(summary, mismatch);
    if (mismatches.length < input.mismatchLimit) {
      mismatches.push(mismatch);
    }
  };

  for (const timeframe of timeframes) {
    const snapshotPoints = new Map(
      (snapshotSeries.get(timeframe) ?? [])
        .map((point) => [signalMonitorBreadthPointIso(point), point] as const)
        .filter((entry): entry is readonly [string, SignalMonitorBreadthPoint] =>
          Boolean(entry[0]),
        ),
    );
    const eventPoints = new Map(
      (eventSeries.get(timeframe) ?? [])
        .map((point) => [signalMonitorBreadthPointIso(point), point] as const)
        .filter((entry): entry is readonly [string, SignalMonitorBreadthPoint] =>
          Boolean(entry[0]),
        ),
    );
    const pointTimes = Array.from(
      new Set([...snapshotPoints.keys(), ...eventPoints.keys()]),
    ).sort();

    for (const at of pointTimes) {
      const snapshotPoint = snapshotPoints.get(at) ?? null;
      const eventPoint = eventPoints.get(at) ?? null;
      if (!snapshotPoint) {
        counts.missingSnapshotPoints += 1;
        pushMismatch({
          range: input.range,
          timeframe,
          at,
          field: "point",
          reason: "snapshot_missing",
          snapshot: null,
          event: null,
        });
        continue;
      }
      if (!eventPoint) {
        counts.missingEventPoints += 1;
        pushMismatch({
          range: input.range,
          timeframe,
          at,
          field: "point",
          reason: "event_missing",
          snapshot: null,
          event: null,
        });
        continue;
      }
      counts.comparedPoints += 1;
      for (const field of ["buy", "sell", "net", "total"] as const) {
        if (snapshotPoint[field] !== eventPoint[field]) {
          pushMismatch({
            range: input.range,
            timeframe,
            at,
            field,
            reason: "value_mismatch",
            snapshot: snapshotPoint[field],
            event: eventPoint[field],
          });
        }
      }
    }
  }

  return { counts, summary, mismatches };
}

function emptySignalMonitorBreadthParitySummary(): SignalMonitorBreadthParityReport["mismatchSummary"] {
  return {
    byRange: {},
    byTimeframe: {},
    byField: {},
    byReason: {},
  };
}

function addSignalMonitorBreadthParityMismatchToSummary(
  summary: SignalMonitorBreadthParityReport["mismatchSummary"],
  mismatch: SignalMonitorBreadthParityMismatch,
) {
  summary.byRange[mismatch.range] = (summary.byRange[mismatch.range] ?? 0) + 1;
  summary.byTimeframe[mismatch.timeframe] =
    (summary.byTimeframe[mismatch.timeframe] ?? 0) + 1;
  summary.byField[mismatch.field] = (summary.byField[mismatch.field] ?? 0) + 1;
  summary.byReason[mismatch.reason] =
    (summary.byReason[mismatch.reason] ?? 0) + 1;
}

function addSignalMonitorBreadthParitySummary(
  target: SignalMonitorBreadthParityReport["mismatchSummary"],
  source: SignalMonitorBreadthParityReport["mismatchSummary"],
) {
  for (const key of ["byRange", "byTimeframe", "byField", "byReason"] as const) {
    for (const [name, value] of Object.entries(source[key])) {
      target[key][name] = (target[key][name] ?? 0) + value;
    }
  }
}

export async function buildSignalMonitorBreadthParityReport(input: {
  environment?: RuntimeMode;
  ranges?: SignalMonitorBreadthHistoryRange[];
  now?: Date;
  mismatchLimit?: number;
} = {}): Promise<SignalMonitorBreadthParityReport> {
  const environment = resolveEnvironment(input.environment);
  const generatedAt =
    input.now && Number.isFinite(input.now.getTime()) ? input.now : new Date();
  const ranges = Array.from(
    new Set(
      (input.ranges?.length ? input.ranges : SIGNAL_MONITOR_BREADTH_HISTORY_RANGES)
        .map((range) => resolveSignalMonitorBreadthHistoryRange(range)),
    ),
  );
  const mismatchLimit = positiveInteger(input.mismatchLimit, 50, 0, 10_000);
  const counts: SignalMonitorBreadthParityReport["counts"] = {
    ranges: 0,
    comparedPoints: 0,
    missingSnapshotPoints: 0,
    missingEventPoints: 0,
    mismatches: 0,
  };
  const mismatchSummary = emptySignalMonitorBreadthParitySummary();
  const rangeReports: SignalMonitorBreadthParityRangeReport[] = [];
  const mismatches: SignalMonitorBreadthParityMismatch[] = [];
  const eventAnchorCoverage =
    await getSignalMonitorBreadthEventAnchorCoverage(environment);

  for (const range of ranges) {
    const window = resolveSignalMonitorBreadthHistoryWindow({
      range,
      now: generatedAt,
    });
    const [snapshotRows, seedRows, eventRows] = await Promise.all([
      listSignalMonitorBreadthSnapshotRowsForWindow(environment, window),
      listSignalMonitorBreadthSeedRowsForWindow(environment, window),
      listSignalMonitorBreadthEventRowsForWindow(environment, window),
    ]);
    const snapshotPayload = buildSignalMonitorBreadthFromSnapshots(
      snapshotRows,
      window,
    ) as SignalMonitorBreadthHistoryPayload;
    const eventPayload = buildSignalMonitorBreadthHistoryResponse(
      eventRows,
      seedRows,
      window,
    ) as SignalMonitorBreadthHistoryPayload;
    const comparison = compareSignalMonitorBreadthPayloads({
      range,
      snapshotPayload,
      eventPayload,
      mismatchLimit: Math.max(0, mismatchLimit - mismatches.length),
    });
    counts.ranges += 1;
    counts.comparedPoints += comparison.counts.comparedPoints;
    counts.missingSnapshotPoints += comparison.counts.missingSnapshotPoints;
    counts.missingEventPoints += comparison.counts.missingEventPoints;
    counts.mismatches += comparison.counts.mismatches;
    for (const mismatch of comparison.mismatches) {
      mismatches.push(mismatch);
    }
    addSignalMonitorBreadthParitySummary(mismatchSummary, comparison.summary);
    rangeReports.push({
      range,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      bucketMinutes: window.bucketMinutes,
      snapshotRows: snapshotRows.length,
      seedRows: seedRows.length,
      eventRows: eventRows.length,
      snapshotsCoverWindow: signalMonitorBreadthSnapshotsCoverWindow(
        snapshotRows,
        window,
      ),
      counts: comparison.counts,
    });
  }

  return {
    environment,
    generatedAt: generatedAt.toISOString(),
    ranges: rangeReports,
    counts,
    eventAnchorCoverage,
    mismatchSummary,
    mismatches,
  };
}

// Capture current standing breadth (symbols on buy vs sell) per environment and
// timeframe, plus an aggregate row, into the snapshots table.
export async function recordSignalMonitorBreadthSnapshot(now: Date = new Date()) {
  const perTimeframe = await db
    .select({
      environment: signalMonitorProfilesTable.environment,
      timeframe: signalMonitorSymbolStatesTable.timeframe,
      direction: signalMonitorSymbolStatesTable.currentSignalDirection,
      value: sql<number>`count(*)::int`,
    })
    .from(signalMonitorSymbolStatesTable)
    .innerJoin(
      signalMonitorProfilesTable,
      eq(signalMonitorSymbolStatesTable.profileId, signalMonitorProfilesTable.id),
    )
    .where(
      and(
        // Only enabled profiles contribute breadth. A disabled/orphaned profile would
        // otherwise replay its frozen-stale states as phantom env rows every cycle.
        eq(signalMonitorProfilesTable.enabled, true),
        eq(signalMonitorSymbolStatesTable.active, true),
        inArray(signalMonitorSymbolStatesTable.currentSignalDirection, ["buy", "sell"]),
      ),
    )
    .groupBy(
      signalMonitorProfilesTable.environment,
      signalMonitorSymbolStatesTable.timeframe,
      signalMonitorSymbolStatesTable.currentSignalDirection,
    );

  // Aggregate: each symbol's latest direction across timeframes.
  const aggregateResult = await db.execute(sql`
    SELECT environment, direction, count(*)::int AS value
    FROM (
      SELECT DISTINCT ON (p.environment, s.symbol)
        p.environment AS environment,
        s.current_signal_direction AS direction
      FROM signal_monitor_symbol_states s
      JOIN signal_monitor_profiles p ON s.profile_id = p.id
      WHERE p.enabled = true
        AND s.active = true
        AND s.current_signal_direction IN ('buy', 'sell')
      ORDER BY p.environment, s.symbol, s.current_signal_at DESC NULLS LAST
    ) latest
    GROUP BY environment, direction
  `);
  const aggregateRows = (aggregateResult.rows ?? []) as Array<{
    environment: string;
    direction: string;
    value: number;
  }>;

  const counts = new Map<string, { environment: string; timeframe: string; buy: number; sell: number }>();
  const bump = (environment: string, timeframe: string, direction: unknown, value: unknown) => {
    const normalized = normalizeBreadthDirection(direction);
    if (!normalized || (environment !== "shadow" && environment !== "live") || !timeframe) {
      return;
    }
    const key = `${environment} ${timeframe}`;
    const entry = counts.get(key) ?? { environment, timeframe, buy: 0, sell: 0 };
    entry[normalized] += Math.max(0, Number(value) || 0);
    counts.set(key, entry);
  };
  for (const row of perTimeframe) {
    bump(String(row.environment), String(row.timeframe).toLowerCase(), row.direction, row.value);
  }
  for (const row of aggregateRows) {
    bump(String(row.environment), SIGNAL_MONITOR_BREADTH_AGGREGATE_TIMEFRAME, row.direction, row.value);
  }

  const inserts = Array.from(counts.values()).map((entry) => ({
    environment: entry.environment as "shadow" | "live",
    timeframe: entry.timeframe,
    capturedAt: now,
    buy: entry.buy,
    sell: entry.sell,
    total: entry.buy + entry.sell,
  }));
  if (inserts.length > 0) {
    await db.insert(signalMonitorBreadthSnapshotsTable).values(inserts);
  }
  return inserts.length;
}

let signalMonitorBreadthSnapshotTimer: ReturnType<typeof setInterval> | null = null;

export function startSignalMonitorBreadthSnapshotWorker() {
  if (signalMonitorBreadthSnapshotTimer) {
    return;
  }
  const run = () => {
    void recordSignalMonitorBreadthSnapshot().catch((error) => {
      if (isTransientPostgresError(error)) {
        return;
      }
      logger.warn({ err: error }, "Failed to record signal monitor breadth snapshot");
    });
  };
  signalMonitorBreadthSnapshotTimer = setInterval(
    run,
    SIGNAL_MONITOR_BREADTH_SNAPSHOT_INTERVAL_MS,
  );
  if (typeof signalMonitorBreadthSnapshotTimer.unref === "function") {
    signalMonitorBreadthSnapshotTimer.unref();
  }
  run();
}

function resolveSignalMonitorEventsPageSize(limit: unknown): number {
  return positiveInteger(
    limit,
    SIGNAL_MONITOR_EVENTS_DEFAULT_PAGE_SIZE,
    1,
    SIGNAL_MONITOR_EVENTS_MAX_PAGE_SIZE,
  );
}

function parseSignalMonitorEventsDate(
  value: unknown,
  field: "from" | "to",
): Date | null {
  if (value == null || value === "") {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isFinite(date.getTime())) {
    return date;
  }
  throw new HttpError(400, `Invalid signal monitor events ${field} date.`, {
    code: `invalid_signal_monitor_events_${field}`,
  });
}

function encodeSignalMonitorEventsCursor(event: {
  signalAt: Date | string;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      signalAt:
        event.signalAt instanceof Date
          ? event.signalAt.toISOString()
          : new Date(event.signalAt).toISOString(),
      id: event.id,
    }),
    "utf8",
  ).toString("base64url");
}

function decodeSignalMonitorEventsCursor(
  cursor: unknown,
): SignalMonitorEventsCursor | null {
  if (cursor == null || cursor === "") {
    return null;
  }
  try {
    const decoded = JSON.parse(
      Buffer.from(String(cursor), "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const id = String(decoded.id || "").trim();
    const signalAt = new Date(String(decoded.signalAt || ""));
    if (id && Number.isFinite(signalAt.getTime())) {
      return { id, signalAt };
    }
  } catch {
    // Fall through to the public validation error below.
  }
  throw new HttpError(400, "Invalid signal monitor events cursor.", {
    code: "invalid_signal_monitor_events_cursor",
  });
}

function compareSignalMonitorEventsDesc(
  left: { signalAt: Date | string; id: string },
  right: { signalAt: Date | string; id: string },
): number {
  const leftMs = new Date(left.signalAt).getTime();
  const rightMs = new Date(right.signalAt).getTime();
  return rightMs - leftMs || String(right.id).localeCompare(String(left.id));
}

function signalMonitorEventIsAfterCursor(
  event: { signalAt: Date | string; id: string },
  cursor: SignalMonitorEventsCursor,
): boolean {
  const eventMs = new Date(event.signalAt).getTime();
  const cursorMs = cursor.signalAt.getTime();
  if (eventMs < cursorMs) {
    return true;
  }
  return eventMs === cursorMs && String(event.id) < cursor.id;
}

function paginateSignalMonitorEventResponses(
  events: SignalMonitorEventResponse[],
  limit: number,
  sourceStatus: SignalMonitorEventsSourceStatus = "database",
) {
  const page = events.slice(0, limit);
  const hasMore = events.length > limit;
  return {
    events: page,
    nextCursor:
      hasMore && page.length
        ? encodeSignalMonitorEventsCursor(page[page.length - 1])
        : null,
    hasMore,
    sourceStatus,
  };
}

function filterSignalMonitorEventResponses(
  events: SignalMonitorEventResponse[],
  input: {
    symbol?: string;
    from?: Date | string;
    to?: Date | string;
    cursor?: string;
    limit?: number;
    sourceStatus?: SignalMonitorEventsSourceStatus;
  } = {},
) {
  const symbol = normalizeSymbol(input.symbol ?? "").toUpperCase();
  const from = parseSignalMonitorEventsDate(input.from, "from");
  const to = parseSignalMonitorEventsDate(input.to, "to");
  const cursor = decodeSignalMonitorEventsCursor(input.cursor);
  const limit = resolveSignalMonitorEventsPageSize(input.limit);
  const filtered = events
    .filter((event) => {
      if (symbol && event.symbol !== symbol) {
        return false;
      }
      const signalAtMs = event.signalAt.getTime();
      if (from && signalAtMs < from.getTime()) {
        return false;
      }
      if (to && signalAtMs > to.getTime()) {
        return false;
      }
      return !cursor || signalMonitorEventIsAfterCursor(event, cursor);
    })
    .sort(compareSignalMonitorEventsDesc);
  return paginateSignalMonitorEventResponses(
    filtered,
    limit,
    input.sourceStatus ?? "database",
  );
}

const runtimeSignalMonitorEvents = new Map<
  RuntimeMode,
  SignalMonitorEventResponse[]
>();
const signalMonitorEventsReadDbBackoff = createTransientPostgresBackoff({
  backoffMs: SIGNAL_MONITOR_EVENTS_DB_FALLBACK_BACKOFF_MS,
  warningCooldownMs: SIGNAL_MONITOR_EVENTS_DB_FALLBACK_WARNING_COOLDOWN_MS,
});
const runtimeSignalMonitorEvaluationCache = new Map<
  string,
  { expiresAt: number; value: unknown }
>();
const runtimeSignalMonitorEvaluationInFlight = new Map<
  string,
  Promise<unknown>
>();
const signalMonitorMatrixEvaluationCache = new Map<
  string,
  { freshUntil: number; staleUntil: number; value: unknown }
>();
const signalMonitorMatrixEvaluationInFlight = new Map<
  string,
  Promise<unknown>
>();
const signalMonitorMatrixAutomaticRequestSeenAt = new Map<string, number>();
const signalMonitorCompletedBarsCache = new Map<
  string,
  {
    value: SignalMonitorCompletedBarsSnapshot;
    cachedAt: number;
    expiresAt: number;
    staleExpiresAt: number;
  }
>();
const signalMonitorCompletedBarsInFlight = new Map<
  string,
  Promise<SignalMonitorCompletedBarsSnapshot>
>();
let signalMonitorMatrixStockAggregateSubscription: StockMinuteAggregateSubscription | null =
  null;
let signalMonitorMatrixStockAggregateReleaseTimer: ReturnType<
  typeof setTimeout
> | null = null;
const signalMonitorMatrixStreamSubscribers = new Map<
  number,
  SignalMonitorMatrixStreamSubscriber
>();
let nextSignalMonitorMatrixStreamSubscriberId = 1;
const pendingSignalMonitorMatrixStreamSymbolsByEnvironment = new Map<
  RuntimeMode,
  Set<string>
>();
let signalMonitorMatrixStreamFlushTimer: ReturnType<typeof setTimeout> | null =
  null;
let signalMonitorMatrixStreamFlushInFlight = false;
let signalMonitorMatrixStreamAggregateEventCount = 0;
let signalMonitorMatrixStreamLastAggregateAt: Date | null = null;
let signalMonitorLocalBarCacheWarmupStarted = false;
let signalMonitorLocalBarCacheWarmupTimer: ReturnType<typeof setInterval> | null =
  null;
let signalMonitorLocalBarCacheWarmupInFlight = false;
const signalMonitorCompletedBarsCounters = {
  hit: 0,
  staleHit: 0,
  miss: 0,
  inFlightJoin: 0,
};

function trimRuntimeSignalMonitorEvaluationCache(nowMs = Date.now()): void {
  for (const [key, entry] of runtimeSignalMonitorEvaluationCache.entries()) {
    if (entry.expiresAt <= nowMs) {
      runtimeSignalMonitorEvaluationCache.delete(key);
    }
  }
  if (
    runtimeSignalMonitorEvaluationCache.size <=
    SIGNAL_MONITOR_RUNTIME_EVALUATION_CACHE_MAX_ENTRIES
  ) {
    return;
  }
  const oldest = [...runtimeSignalMonitorEvaluationCache.entries()].sort(
    (left, right) => left[1].expiresAt - right[1].expiresAt,
  );
  for (
    let index = 0;
    runtimeSignalMonitorEvaluationCache.size >
      SIGNAL_MONITOR_RUNTIME_EVALUATION_CACHE_MAX_ENTRIES &&
    index < oldest.length;
    index += 1
  ) {
    runtimeSignalMonitorEvaluationCache.delete(oldest[index][0]);
  }
}

function trimSignalMonitorMatrixEvaluationCache(nowMs = Date.now()): void {
  for (const [key, entry] of signalMonitorMatrixEvaluationCache.entries()) {
    if (entry.staleUntil <= nowMs) {
      signalMonitorMatrixEvaluationCache.delete(key);
    }
  }
  if (
    signalMonitorMatrixEvaluationCache.size <=
    SIGNAL_MONITOR_MATRIX_EVALUATION_CACHE_MAX_ENTRIES
  ) {
    return;
  }
  const oldest = [...signalMonitorMatrixEvaluationCache.entries()].sort(
    (left, right) => left[1].staleUntil - right[1].staleUntil,
  );
  for (
    let index = 0;
    signalMonitorMatrixEvaluationCache.size >
      SIGNAL_MONITOR_MATRIX_EVALUATION_CACHE_MAX_ENTRIES &&
    index < oldest.length;
    index += 1
  ) {
    signalMonitorMatrixEvaluationCache.delete(oldest[index][0]);
  }
}

function getRuntimeSignalMonitorEvaluationCacheValue<T>(
  key: string,
  nowMs = Date.now(),
): { value: T; cacheStatus: SignalMonitorMatrixCacheStatus } | null {
  trimRuntimeSignalMonitorEvaluationCache(nowMs);
  const cached = runtimeSignalMonitorEvaluationCache.get(key);
  if (!cached || cached.expiresAt <= nowMs) {
    return null;
  }
  return { value: cached.value as T, cacheStatus: "hit" };
}

async function withRuntimeSignalMonitorEvaluationCache<T>(
  key: string,
  factory: () => Promise<T>,
  options: {
    onCacheStatus?: (status: SignalMonitorMatrixCacheStatus) => void;
  } = {},
): Promise<T> {
  const nowMs = Date.now();
  trimRuntimeSignalMonitorEvaluationCache(nowMs);
  const cached = runtimeSignalMonitorEvaluationCache.get(key);
  if (cached && cached.expiresAt > nowMs) {
    options.onCacheStatus?.("hit");
    return cached.value as T;
  }

  const inFlight = runtimeSignalMonitorEvaluationInFlight.get(key);
  if (inFlight) {
    options.onCacheStatus?.("inflight");
    return inFlight as Promise<T>;
  }

  const request = factory().then((value) => {
    runtimeSignalMonitorEvaluationCache.set(key, {
      value,
      expiresAt: Date.now() + SIGNAL_MONITOR_RUNTIME_EVALUATION_CACHE_TTL_MS,
    });
    trimRuntimeSignalMonitorEvaluationCache();
    return value;
  });
  runtimeSignalMonitorEvaluationInFlight.set(key, request);
  options.onCacheStatus?.("miss");
  try {
    return await request;
  } finally {
    if (runtimeSignalMonitorEvaluationInFlight.get(key) === request) {
      runtimeSignalMonitorEvaluationInFlight.delete(key);
    }
  }
}

function clearRuntimeSignalMonitorEvaluationCache(
  environment: RuntimeMode,
): void {
  const prefix = `runtime-signal:${environment}:`;
  for (const key of runtimeSignalMonitorEvaluationCache.keys()) {
    if (key.startsWith(prefix)) {
      runtimeSignalMonitorEvaluationCache.delete(key);
    }
  }
  for (const key of runtimeSignalMonitorEvaluationInFlight.keys()) {
    if (key.startsWith(prefix)) {
      runtimeSignalMonitorEvaluationInFlight.delete(key);
    }
  }
}

function clearSignalMonitorMatrixEvaluationCache(
  environment?: RuntimeMode,
): void {
  const prefixes = environment
    ? [
        `signal-matrix:${SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY}:${environment}:`,
        `signal-matrix:${environment}:`,
      ]
    : null;
  const shouldClearKey = (key: string) =>
    !prefixes || prefixes.some((prefix) => key.startsWith(prefix));
  for (const key of signalMonitorMatrixEvaluationCache.keys()) {
    if (shouldClearKey(key)) {
      signalMonitorMatrixEvaluationCache.delete(key);
    }
  }
  for (const key of signalMonitorMatrixEvaluationInFlight.keys()) {
    if (shouldClearKey(key)) {
      signalMonitorMatrixEvaluationInFlight.delete(key);
    }
  }
  for (const key of signalMonitorMatrixAutomaticRequestSeenAt.keys()) {
    if (shouldClearKey(key)) {
      signalMonitorMatrixAutomaticRequestSeenAt.delete(key);
    }
  }
  signalMonitorCompletedBarsCache.clear();
  signalMonitorCompletedBarsInFlight.clear();
}

function isAutomaticSignalMonitorMatrixRequest(input: {
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
}) {
  return (
    (input.clientRole === "leader" || input.clientRole === "follower") &&
    (input.requestOrigin === "startup" || input.requestOrigin === "poll")
  );
}

function markAutomaticSignalMonitorMatrixRequest(
  key: string,
  input: {
    clientRole?: SignalMonitorMatrixClientRole;
    requestOrigin?: SignalMonitorMatrixRequestOrigin;
  },
  nowMs = Date.now(),
) {
  if (!isAutomaticSignalMonitorMatrixRequest(input)) {
    return { automatic: false, debounced: false };
  }

  const previousSeenAt = signalMonitorMatrixAutomaticRequestSeenAt.get(key);
  const debounced =
    Number.isFinite(previousSeenAt) &&
    nowMs - Number(previousSeenAt) <
      SIGNAL_MONITOR_MATRIX_AUTOMATIC_DEBOUNCE_MS;
  signalMonitorMatrixAutomaticRequestSeenAt.set(key, nowMs);

  return { automatic: true, debounced };
}

function getDebouncedSignalMonitorMatrixCacheValue<T>(
  key: string,
  nowMs = Date.now(),
): { value: T; cacheStatus: SignalMonitorMatrixCacheStatus } | null {
  trimSignalMonitorMatrixEvaluationCache(nowMs);
  const cached = signalMonitorMatrixEvaluationCache.get(key);
  if (!cached || cached.staleUntil <= nowMs) {
    return null;
  }
  return {
    value: cached.value as T,
    cacheStatus: cached.freshUntil > nowMs ? "hit" : "stale",
  };
}

function shouldCacheSignalMonitorMatrixEvaluationValue(
  value: unknown,
): boolean {
  const states = Array.isArray((value as { states?: unknown })?.states)
    ? (value as { states: unknown[] }).states
    : [];
  return !states.some((state) => {
    if (!state || typeof state !== "object") {
      return false;
    }
    const record = state as { status?: unknown; lastError?: unknown };
    const status = String(record.status || "ok").trim().toLowerCase();
    return (
      status === "error" ||
      (typeof record.lastError === "string" && status !== "unavailable")
    );
  });
}

async function withSignalMonitorMatrixEvaluationCache<T>(
  key: string,
  factory: () => Promise<T>,
  options: {
    nowMs?: number;
    onCacheStatus?: (status: SignalMonitorMatrixCacheStatus) => void;
  } = {},
): Promise<T> {
  const nowMs = options.nowMs ?? Date.now();
  trimSignalMonitorMatrixEvaluationCache(nowMs);
  const cached = signalMonitorMatrixEvaluationCache.get(key);
  if (cached && cached.freshUntil > nowMs) {
    options.onCacheStatus?.("hit");
    return cached.value as T;
  }

  const inFlight = signalMonitorMatrixEvaluationInFlight.get(key);
  if (inFlight) {
    options.onCacheStatus?.("inflight");
    return inFlight as Promise<T>;
  }

  const request = factory()
    .then((value) => {
      const completedAt = Date.now();
      if (shouldCacheSignalMonitorMatrixEvaluationValue(value)) {
        signalMonitorMatrixEvaluationCache.set(key, {
          value,
          freshUntil: completedAt + SIGNAL_MONITOR_MATRIX_CACHE_TTL_MS,
          staleUntil: completedAt + SIGNAL_MONITOR_MATRIX_STALE_TTL_MS,
        });
        trimSignalMonitorMatrixEvaluationCache(completedAt);
      }
      return value;
    })
    .finally(() => {
      if (signalMonitorMatrixEvaluationInFlight.get(key) === request) {
        signalMonitorMatrixEvaluationInFlight.delete(key);
      }
    });
  signalMonitorMatrixEvaluationInFlight.set(key, request);

  options.onCacheStatus?.(
    cached && cached.staleUntil > nowMs ? "inflight" : "miss",
  );
  return request;
}

function warnSignalMonitorDbUnavailable(
  error: unknown,
  input: {
    operation?: string;
    environment?: RuntimeMode;
    sourceStatus?: string;
  } = {},
): void {
  const diagnostic = recordSignalMonitorDbFallback(error, input);
  logger.warn(
    {
      err: error,
      dbError: diagnostic.dbError,
      operation: diagnostic.operation,
      environment: diagnostic.environment,
      sourceStatus: diagnostic.sourceStatus,
      transient: diagnostic.transient,
      poolContention: diagnostic.poolContention,
    },
    "Signal monitor database unavailable; serving degraded response",
  );
}

export function buildSignalMonitorDbUnavailableProfile(
  environment: RuntimeMode,
  now = new Date(),
) {
  return {
    id: `db-unavailable-${environment}`,
    environment,
    enabled: false,
    watchlistId: null,
    timeframe: DEFAULT_SIGNAL_MONITOR_TIMEFRAME,
    pyrusSignalsSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: DEFAULT_SIGNAL_MONITOR_POLL_SECONDS,
    maxSymbols: DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
    evaluationConcurrency: DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY,
    lastEvaluatedAt: null,
    lastError: SIGNAL_MONITOR_DB_UNAVAILABLE_MESSAGE,
    createdAt: now,
    updatedAt: now,
  };
}

function buildSignalMonitorRuntimeFallbackProfile(
  environment: RuntimeMode,
  now = new Date(),
): DbSignalMonitorProfile {
  return {
    id: `runtime-fallback-${environment}`,
    environment,
    enabled: true,
    watchlistId: null,
    timeframe: DEFAULT_SIGNAL_MONITOR_TIMEFRAME,
    pyrusSignalsSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: DEFAULT_SIGNAL_MONITOR_POLL_SECONDS,
    maxSymbols: DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
    evaluationConcurrency: DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY,
    lastEvaluatedAt: null,
    lastError: SIGNAL_MONITOR_RUNTIME_FALLBACK_MESSAGE,
    createdAt: now,
    updatedAt: now,
  } as DbSignalMonitorProfile;
}

function getRuntimeSignalMonitorProfile(environment: RuntimeMode) {
  const existing = runtimeSignalMonitorProfiles.get(environment);
  if (existing) {
    return existing;
  }

  const profile = buildSignalMonitorRuntimeFallbackProfile(environment);
  runtimeSignalMonitorProfiles.set(environment, profile);
  return profile;
}

async function updateRuntimeSignalMonitorProfile(input: {
  environment: RuntimeMode;
  enabled?: boolean;
  watchlistId?: string | null;
  timeframe?: string;
  pyrusSignalsSettings?: Record<string, unknown>;
  freshWindowBars?: number;
  pollIntervalSeconds?: number;
  maxSymbols?: number;
  evaluationConcurrency?: number;
}) {
  const profile = getRuntimeSignalMonitorProfile(input.environment);
  const updated: DbSignalMonitorProfile = {
    ...profile,
    updatedAt: new Date(),
    lastError: SIGNAL_MONITOR_RUNTIME_FALLBACK_MESSAGE,
  };
  const profileUpdateDefaults = resolveSignalMonitorProfileUpdateDefaults({
    currentMaxSymbols: Math.min(
      profile.maxSymbols,
      SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
    ),
    currentPyrusSignalsSettings: asRecord(profile.pyrusSignalsSettings),
    inputMaxSymbols: input.maxSymbols,
    inputPyrusSignalsSettings: input.pyrusSignalsSettings,
  });
  const nextEnabled =
    typeof input.enabled === "boolean" ? input.enabled : profile.enabled;
  if (nextEnabled) {
    await assertHighBetaSignalMonitorUniverseAvailable({
      universeScope: profileUpdateDefaults.universeScope,
    });
  }

  if (typeof input.enabled === "boolean") {
    updated.enabled = input.enabled;
  }
  if (Object.hasOwn(input, "watchlistId")) {
    if (input.watchlistId) {
      const { watchlists } = listWatchlistsRuntimeFallback();
      if (!watchlists.some((watchlist) => watchlist.id === input.watchlistId)) {
        throw new HttpError(404, "Watchlist not found.", {
          code: "watchlist_not_found",
        });
      }
    }
    updated.watchlistId = input.watchlistId ?? null;
  }
  if (input.timeframe !== undefined) {
    updated.timeframe = parseSignalTimeframe(input.timeframe);
  }
  if (input.pyrusSignalsSettings !== undefined) {
    updated.pyrusSignalsSettings = profileUpdateDefaults.pyrusSignalsSettings;
  }
  if (input.freshWindowBars !== undefined) {
    updated.freshWindowBars = positiveInteger(input.freshWindowBars, 3, 1, 20);
  }
  if (input.pollIntervalSeconds !== undefined) {
    updated.pollIntervalSeconds = positiveInteger(
      input.pollIntervalSeconds,
      60,
      15,
      3600,
    );
  }
  if (input.maxSymbols !== undefined || profileUpdateDefaults.highBetaRequested) {
    updated.maxSymbols = profileUpdateDefaults.maxSymbols;
  }
  if (input.evaluationConcurrency !== undefined) {
    updated.evaluationConcurrency = positiveInteger(
      input.evaluationConcurrency,
      DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY,
      1,
      10,
    );
  }

  runtimeSignalMonitorProfiles.set(input.environment, updated);
  clearRuntimeSignalMonitorEvaluationCache(input.environment);
  clearSignalMonitorMatrixEvaluationCache(input.environment);
  return updated;
}

export function createSignalMonitorDbUnavailableError(
  error?: unknown,
): HttpError {
  return new HttpError(503, SIGNAL_MONITOR_DB_UNAVAILABLE_MESSAGE, {
    code: SIGNAL_MONITOR_DB_UNAVAILABLE_CODE,
    detail:
      "Signal monitor database reads are timing out or disconnected. Retry after Postgres connectivity recovers.",
    expose: true,
    ...(error === undefined ? {} : { cause: error }),
  });
}

async function resolveDefaultWatchlistId(): Promise<string | null> {
  const { watchlists } = await listWatchlists();
  return (
    watchlists.find((watchlist) => watchlist.isDefault)?.id ??
    watchlists[0]?.id ??
    null
  );
}

async function selectProfile(environment: RuntimeMode) {
  const [profile] = await db
    .select()
    .from(signalMonitorProfilesTable)
    .where(eq(signalMonitorProfilesTable.environment, environment))
    .limit(1);
  return profile ?? null;
}

async function getOrCreateProfile(environment: RuntimeMode) {
  const existing = await selectProfile(environment);
  if (existing) {
    return ensureSignalMonitorProfileDefaults(existing);
  }

  const watchlistId = await resolveDefaultWatchlistId();
  const [created] = await db
    .insert(signalMonitorProfilesTable)
    .values({
      environment,
      watchlistId,
      timeframe: DEFAULT_SIGNAL_MONITOR_TIMEFRAME,
      pyrusSignalsSettings: withSignalMonitorUniverseScope(
        {},
        DEFAULT_SIGNAL_MONITOR_UNIVERSE_SCOPE,
      ),
      pollIntervalSeconds: DEFAULT_SIGNAL_MONITOR_POLL_SECONDS,
      maxSymbols: DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
      evaluationConcurrency: DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY,
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return created;
  }

  const fallback = await selectProfile(environment);
  if (!fallback) {
    throw new HttpError(500, "Unable to create signal monitor profile.", {
      code: "signal_monitor_profile_unavailable",
    });
  }
  return ensureSignalMonitorProfileDefaults(fallback);
}

async function ensureSignalMonitorProfileDefaults(
  profile: DbSignalMonitorProfile,
) {
  const patch = buildSignalMonitorLegacyDefaultsPatch(profile);
  if (!patch) {
    return profile;
  }

  const [updated] = await db
    .update(signalMonitorProfilesTable)
    .set(patch)
    .where(eq(signalMonitorProfilesTable.id, profile.id))
    .returning();
  return updated ?? {
    ...profile,
    ...patch,
  };
}

export async function getSignalMonitorProfileRow(input: {
  environment?: RuntimeMode;
  ensureWatchlist?: boolean;
}) {
  const profile = await getOrCreateProfile(
    resolveEnvironment(input.environment),
  );
  return input.ensureWatchlist === false
    ? profile
    : ensureProfileWatchlist(profile);
}

async function assertWatchlistExists(watchlistId: string) {
  const { watchlists } = await listWatchlists();
  if (!watchlists.some((watchlist) => watchlist.id === watchlistId)) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }
}

async function ensureProfileWatchlist(profile: DbSignalMonitorProfile) {
  if (profile.watchlistId) {
    return profile;
  }

  const watchlistId = await resolveDefaultWatchlistId();
  if (!watchlistId) {
    return profile;
  }

  const [updated] = await db
    .update(signalMonitorProfilesTable)
    .set({ watchlistId, updatedAt: new Date() })
    .where(eq(signalMonitorProfilesTable.id, profile.id))
    .returning();
  return updated ?? profile;
}

type ResolvedSignalMonitorUniverse = {
  symbols: string[];
  watchlistSymbols: string[];
  skippedSymbols: string[];
  truncated: boolean;
  fallbackWatchlists?: boolean;
  fallbackUsed?: boolean;
  universe: SignalMonitorUniverseSummary;
};

type ResolvedSymbolUniverse = Pick<
  ResolvedSignalMonitorUniverse,
  "symbols" | "skippedSymbols" | "truncated"
>;

type SignalMonitorEvaluationBatch = ResolvedSymbolUniverse & {
  nextCursor: number;
};

type SignalMonitorExpansionUniverse = {
  symbols: string[];
  fallbackUsed: boolean;
  degradedReason: string | null;
  rankedAt: Date | null;
};

type SignalMonitorUniverseSummary = {
  mode: SignalMonitorUniverseMode;
  configuredMaxSymbols: number;
  resolvedSymbols: number;
  pinnedSymbols: number;
  expansionSymbols: number;
  shortfall: number;
  source: SignalMonitorUniverseSource;
  fallbackUsed: boolean;
  degradedReason: string | null;
  rankedAt: Date | null;
};

function signalMonitorUniverseSourceForMode(
  universeScope: SignalMonitorUniverseMode,
): SignalMonitorUniverseSource {
  return universeScope === "selected_watchlist"
    ? "selected_watchlist"
    : universeScope === "all_watchlists"
      ? "all_watchlists"
      : universeScope === "high_beta_500"
        ? "high_beta_500"
        : "watchlists_plus_ranked_universe";
}

function resolveSymbolUniverse(
  sourceSymbols: string[],
  maxSymbols: number,
): ResolvedSymbolUniverse {
  const uniqueSymbols = Array.from(
    new Set(
      sourceSymbols
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
  return {
    symbols: uniqueSymbols.slice(0, maxSymbols),
    skippedSymbols: uniqueSymbols.slice(maxSymbols),
    truncated: uniqueSymbols.length > maxSymbols,
  };
}

const signalMonitorEvaluationRotationCursors = new Map<string, number>();

export function resolveSignalMonitorEvaluationBatch(input: {
  sourceSymbols: string[];
  maxSymbols: number;
  cursor?: number;
  prioritySymbols?: string[];
}): SignalMonitorEvaluationBatch {
  const allSymbols = resolveSymbolUniverse(
    input.sourceSymbols,
    Number.MAX_SAFE_INTEGER,
  ).symbols;
  const prioritySymbols = resolveSymbolUniverse(
    input.prioritySymbols ?? [],
    Number.MAX_SAFE_INTEGER,
  ).symbols.filter((symbol) => allSymbols.includes(symbol));
  const maxSymbols = Math.max(0, Math.floor(Number(input.maxSymbols) || 0));
  if (!allSymbols.length) {
    return {
      symbols: [],
      skippedSymbols: [],
      truncated: false,
      nextCursor: 0,
    };
  }
  if (maxSymbols <= 0) {
    const cursor = Math.max(0, Math.floor(Number(input.cursor) || 0));
    return {
      symbols: [],
      skippedSymbols: allSymbols,
      truncated: true,
      nextCursor: cursor % allSymbols.length,
    };
  }
  if (allSymbols.length <= maxSymbols) {
    return {
      symbols: allSymbols,
      skippedSymbols: [],
      truncated: false,
      nextCursor: 0,
    };
  }
  if (prioritySymbols.length) {
    const cursor = Math.max(0, Math.floor(Number(input.cursor) || 0));
    if (prioritySymbols.length > maxSymbols) {
      const startIndex = cursor % prioritySymbols.length;
      const symbols: string[] = [];
      for (let offset = 0; offset < maxSymbols; offset += 1) {
        const symbol =
          prioritySymbols[(startIndex + offset) % prioritySymbols.length];
        if (symbol) {
          symbols.push(symbol);
        }
      }
      const selected = new Set(symbols);
      return {
        symbols,
        skippedSymbols: allSymbols.filter((symbol) => !selected.has(symbol)),
        truncated: true,
        nextCursor: (startIndex + symbols.length) % prioritySymbols.length,
      };
    }
    const priorityBatch = prioritySymbols;
    const prioritySet = new Set(priorityBatch);
    const remainingLimit = Math.max(0, maxSymbols - priorityBatch.length);
    const backgroundSymbols = allSymbols.filter((symbol) => !prioritySet.has(symbol));
    const startIndex = backgroundSymbols.length
      ? cursor % backgroundSymbols.length
      : 0;
    const rotatedBackground: string[] = [];
    for (
      let offset = 0;
      offset < remainingLimit && offset < backgroundSymbols.length;
      offset += 1
    ) {
      const symbol =
        backgroundSymbols[(startIndex + offset) % backgroundSymbols.length];
      if (symbol) {
        rotatedBackground.push(symbol);
      }
    }
    const symbols = [...priorityBatch, ...rotatedBackground];
    const selected = new Set(symbols);
    return {
      symbols,
      skippedSymbols: allSymbols.filter((symbol) => !selected.has(symbol)),
      truncated: symbols.length < allSymbols.length,
      nextCursor: backgroundSymbols.length
        ? (startIndex + rotatedBackground.length) % backgroundSymbols.length
        : cursor % allSymbols.length,
    };
  }

  const cursor = Math.max(0, Math.floor(Number(input.cursor) || 0));
  const startIndex = cursor % allSymbols.length;
  const symbols: string[] = [];
  for (let offset = 0; offset < maxSymbols; offset += 1) {
    const symbol = allSymbols[(startIndex + offset) % allSymbols.length];
    if (symbol) {
      symbols.push(symbol);
    }
  }
  const selected = new Set(symbols);
  return {
    symbols,
    skippedSymbols: allSymbols.filter((symbol) => !selected.has(symbol)),
    truncated: true,
    nextCursor: (startIndex + symbols.length) % allSymbols.length,
  };
}

function resolveSignalMonitorUniverseSymbols(input: {
  symbols?: string[];
  watchlistSymbols?: string[];
  skippedSymbols?: string[];
}) {
  return Array.from(
    new Set(
      [
        ...(input.watchlistSymbols ?? []),
        ...(input.symbols ?? []),
        ...(input.skippedSymbols ?? []),
      ]
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
}

function resolveSignalMonitorActiveUniverseSymbols(input: {
  symbols?: string[];
}): string[] {
  return Array.from(
    new Set(
      (input.symbols ?? [])
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
}

function signalMonitorMatrixStreamProfileSymbols(input: {
  symbols?: string[];
}): string[] {
  return resolveSignalMonitorActiveUniverseSymbols(input);
}

async function resolveSignalMonitorMatrixStreamProfileUniverseSymbols(
  environment: RuntimeMode,
): Promise<string[]> {
  if (!isSignalMonitorBarEvaluationEnabled()) {
    const snapshot = await getSignalMonitorStoredState({
      environment,
      markNonCurrentStale: true,
    });
    return resolveSignalMonitorActiveUniverseSymbols({
      symbols: snapshot.universeSymbols,
    });
  }

  return signalMonitorMatrixStreamProfileSymbols(
    await resolveSignalMonitorProfileUniverse(
      await resolveSignalMonitorMatrixStreamProfile(environment),
    ),
  );
}

function signalMonitorEvaluationRotationKey(input: {
  profile: Pick<DbSignalMonitorProfile, "id" | "environment" | "timeframe">;
  timeframe: SignalMonitorTimeframe;
}) {
  return [input.profile.environment, input.profile.id, input.timeframe].join(
    ":",
  );
}

function resolveSignalMonitorUniverseFromWatchlists(input: {
  profile: Pick<
    DbSignalMonitorProfile,
    "watchlistId" | "maxSymbols" | "pyrusSignalsSettings"
  >;
  watchlists: WatchlistRecord[];
  ensureWatchlist?: boolean;
  expansionUniverse?: SignalMonitorExpansionUniverse | null;
}): ResolvedSignalMonitorUniverse {
  const settings = asRecord(input.profile.pyrusSignalsSettings);
  const universeScope = resolveSignalMonitorUniverseScope(settings);
  const fallbackWatchlists = input.watchlists.some((watchlist) =>
    String(watchlist.id || "").startsWith("built-in-"),
  );
  const allWatchlistSymbols = input.watchlists.flatMap((watchlist) =>
    watchlist.items.map((item) => item.symbol),
  );
  const resolvedWatchlistSymbols = resolveSymbolUniverse(
    allWatchlistSymbols,
    Number.MAX_SAFE_INTEGER,
  ).symbols;
  const selectedWatchlist = input.profile.watchlistId
    ? (input.watchlists.find(
        (candidate) => candidate.id === input.profile.watchlistId,
      ) ?? null)
    : input.ensureWatchlist === false
      ? null
      : (input.watchlists.find((candidate) => candidate.isDefault) ??
        input.watchlists[0] ??
        null);
  const selectedWatchlistSymbols = selectedWatchlist
    ? selectedWatchlist.items.map((item) => item.symbol)
    : [];
  const pinnedSourceSymbols =
    universeScope === "selected_watchlist"
      ? selectedWatchlistSymbols
      : universeScope === "high_beta_500"
        ? []
        : allWatchlistSymbols;
  const sourceSymbols =
    universeScope === "high_beta_500"
      ? (input.expansionUniverse?.symbols ?? [])
      : universeScope === "all_watchlists_plus_universe"
      ? [...pinnedSourceSymbols, ...(input.expansionUniverse?.symbols ?? [])]
      : pinnedSourceSymbols;
  const resolved = resolveSymbolUniverse(
    sourceSymbols,
    input.profile.maxSymbols,
  );
  const pinnedSet = new Set(
    resolveSymbolUniverse(pinnedSourceSymbols, Number.MAX_SAFE_INTEGER).symbols,
  );
  const expansionSymbols = resolved.symbols.filter(
    (symbol) => !pinnedSet.has(symbol),
  ).length;
  const fallbackUsed = Boolean(
    fallbackWatchlists || input.expansionUniverse?.fallbackUsed,
  );
  const source = signalMonitorUniverseSourceForMode(universeScope);

  return {
    ...resolved,
    watchlistSymbols: resolvedWatchlistSymbols,
    ...(fallbackWatchlists ? { fallbackWatchlists } : {}),
    fallbackUsed,
    universe: {
      mode: universeScope,
      configuredMaxSymbols: input.profile.maxSymbols,
      resolvedSymbols: resolved.symbols.length,
      pinnedSymbols: pinnedSet.size,
      expansionSymbols,
      shortfall: Math.max(
        0,
        input.profile.maxSymbols - resolved.symbols.length,
      ),
      source,
      fallbackUsed,
      degradedReason:
        input.expansionUniverse?.degradedReason ??
        (fallbackWatchlists
          ? "Signal monitor watchlists are using runtime fallback data."
          : null),
      rankedAt: input.expansionUniverse?.rankedAt ?? null,
    },
  };
}

async function loadSignalMonitorCatalogExpansionSymbols(input: {
  seedSymbols: string[];
  maxSymbols: number;
}): Promise<{ symbols: string[]; rankedAt: Date | null }> {
  const maxSymbols = Math.min(
    SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
    Math.max(1, Math.floor(input.maxSymbols || 1)),
  );
  const seedSymbols = resolveSymbolUniverse(
    input.seedSymbols,
    maxSymbols,
  ).symbols;
  if (seedSymbols.length >= maxSymbols) {
    return { symbols: seedSymbols, rankedAt: null };
  }

  // Curated order (signal-universe-ranking.ts): symbols carrying a ranking row
  // sort by the hysteresis-stable member flag, then rank; rows the curation
  // excluded (bond ETFs, SPACs, preferreds, OTC, insufficient data) drop out
  // via their persisted excluded_reason. Symbols with no ranking row keep the
  // historical alphabetical order through the trailing tie-break — which is
  // also the whole-query fallback when the rankings table is empty or the
  // refresh has not run yet.
  const rows = await db
    .select({
      symbol: universeCatalogListingsTable.normalizedTicker,
      rankedAt: signalUniverseRankingsTable.rankedAt,
    })
    .from(universeCatalogListingsTable)
    .leftJoin(
      signalUniverseRankingsTable,
      eq(
        signalUniverseRankingsTable.symbol,
        universeCatalogListingsTable.normalizedTicker,
      ),
    )
    .where(sql`
      ${universeCatalogListingsTable.active} = true
      and (
        coalesce(${universeCatalogListingsTable.contractMeta}->>'derivativeSecTypes', '') ~* '(^|,)\\s*OPT\\s*(,|$)'
        or ${universeCatalogListingsTable.contractMeta}->>'optionabilityStatus' = 'verified'
        or ${universeCatalogListingsTable.contractMeta}->'optionability'->>'status' = 'verified'
      )
      and ${signalUniverseRankingsTable.excludedReason} is null
    `)
    .orderBy(
      sql`${signalUniverseRankingsTable.member} desc nulls last`,
      sql`${signalUniverseRankingsTable.rank} asc nulls last`,
      asc(universeCatalogListingsTable.normalizedTicker),
    )
    .limit(maxSymbols + seedSymbols.length);

  const rankedAt = rows.find((row) => row.rankedAt)?.rankedAt ?? null;
  return {
    symbols: resolveSymbolUniverse(
      [...seedSymbols, ...rows.map((row) => row.symbol)],
      maxSymbols,
    ).symbols,
    rankedAt,
  };
}

async function loadSignalMonitorExpansionUniverse(
  maxSymbols: number,
): Promise<SignalMonitorExpansionUniverse> {
  try {
    const universe = getOptionsFlowUniverse();
    const coverage = universe.coverage ?? {};
    const sourceSymbols = Array.isArray(universe.symbols)
      ? universe.symbols
      : Array.isArray(universe.sources?.flowUniverseSymbols)
        ? universe.sources.flowUniverseSymbols
        : [];
    const expansion = await loadSignalMonitorCatalogExpansionSymbols({
      seedSymbols: sourceSymbols,
      maxSymbols,
    });
    const symbols = expansion.symbols;
    const expectedSymbols = Math.min(
      SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
      Math.max(1, Math.floor(maxSymbols || 1)),
    );
    return {
      symbols,
      fallbackUsed: Boolean(coverage.fallbackUsed),
      degradedReason:
        coverage.degradedReason ??
        (symbols.length < expectedSymbols
          ? `Signal monitor expansion universe resolved ${symbols.length}/${expectedSymbols} symbols.`
          : null),
      rankedAt:
        expansion.rankedAt ??
        dateOrNull(coverage.rankedAt ?? coverage.lastGoodAt ?? null),
    };
  } catch (error) {
    logger.warn(
      { err: error },
      "Signal monitor ranked universe expansion unavailable",
    );
    return {
      symbols: [],
      fallbackUsed: true,
      degradedReason:
        error instanceof Error
          ? error.message
          : "Signal monitor ranked universe expansion unavailable.",
      rankedAt: null,
    };
  }
}

async function loadSignalMonitorHighBetaUniverse(
  maxSymbols: number,
): Promise<SignalMonitorExpansionUniverse> {
  try {
    const preview = await getHighBetaUniversePreview({
      limit: Math.min(SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT, Math.max(1, maxSymbols)),
      dryRun: true,
    });
    return {
      symbols: preview.accepted.map((row) => row.symbol),
      fallbackUsed: false,
      degradedReason:
        preview.acceptedCount < Math.min(maxSymbols, SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT)
          ? `High-beta universe accepted ${preview.acceptedCount} of ${preview.limit} requested symbols.`
          : null,
      rankedAt: preview.generatedAt,
    };
  } catch (error) {
    logger.warn(
      { err: error },
      "Signal monitor high-beta universe expansion unavailable",
    );
    return {
      symbols: [],
      fallbackUsed: true,
      degradedReason:
        error instanceof Error
          ? error.message
          : "Signal monitor high-beta universe expansion unavailable.",
      rankedAt: null,
    };
  }
}

async function loadSignalMonitorExpansionUniverseForScope(input: {
  universeScope: SignalMonitorUniverseMode;
  maxSymbols: number;
}): Promise<SignalMonitorExpansionUniverse | null> {
  if (input.universeScope === "all_watchlists_plus_universe") {
    return loadSignalMonitorExpansionUniverse(input.maxSymbols);
  }
  if (input.universeScope === "high_beta_500") {
    return loadSignalMonitorHighBetaUniverse(input.maxSymbols);
  }
  return null;
}

export async function resolveSignalMonitorProfileUniverse(
  profile: DbSignalMonitorProfile,
  options: { ensureWatchlist?: boolean } = {},
) {
  const hydratedProfile =
    options.ensureWatchlist === false
      ? profile
      : await ensureProfileWatchlist(profile);
  const { watchlists } = await listWatchlists();
  const settings = asRecord(hydratedProfile.pyrusSignalsSettings);
  const universeScope = resolveSignalMonitorUniverseScope(settings);
  const expansionUniverse = await loadSignalMonitorExpansionUniverseForScope({
    universeScope,
    maxSymbols: hydratedProfile.maxSymbols,
  });
  const universe = resolveSignalMonitorUniverseFromWatchlists({
    profile: hydratedProfile,
    watchlists,
    ensureWatchlist: options.ensureWatchlist,
    expansionUniverse,
  });

  return {
    profile: hydratedProfile,
    ...universe,
  };
}

export function getSignalMonitorTimeframeMs(
  timeframe: SignalMonitorMatrixTimeframe,
): number {
  return TIMEFRAME_MS[timeframe];
}

function marketDateKey(value: Date): string {
  const parts = MARKET_DATE_FORMATTER.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

function utcDateKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dailyBarDateKey(value: Date): string {
  const marketKey = marketDateKey(value);
  const utcKey = utcDateKey(value);
  const isUtcMidnight =
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;

  return isUtcMidnight && utcKey > marketKey ? utcKey : marketKey;
}

type SignalMonitorMarketSessionContext = {
  evaluatedAtMs: number;
  quiet: boolean;
  marketIdle: boolean;
  previousMarketCloseAt: Date | null;
};

const SIGNAL_MONITOR_MARKET_IDLE_SESSION_KEYS = new Set([
  "overnight",
  "pre",
  "after",
]);

const signalMonitorMarketSessionContextCache = new Map<
  number,
  SignalMonitorMarketSessionContext
>();

function pruneSignalMonitorMarketSessionContextCache(): void {
  if (
    signalMonitorMarketSessionContextCache.size <=
    SIGNAL_MONITOR_MARKET_SESSION_CONTEXT_CACHE_MAX_ENTRIES
  ) {
    return;
  }
  const overflow =
    signalMonitorMarketSessionContextCache.size -
    SIGNAL_MONITOR_MARKET_SESSION_CONTEXT_CACHE_MAX_ENTRIES;
  Array.from(signalMonitorMarketSessionContextCache.keys())
    .slice(0, overflow)
    .forEach((key) => signalMonitorMarketSessionContextCache.delete(key));
}

function resolveSignalMonitorPreviousMarketCloseAtUncached(
  evaluatedAt: Date,
): Date | null {
  const evaluatedMs = evaluatedAt.getTime();
  for (
    let offset = 0;
    offset <= SIGNAL_MONITOR_MARKET_CLOSE_LOOKBACK_DAYS;
    offset += 1
  ) {
    const status = resolveUsEquityMarketStatus(
      new Date(evaluatedMs - offset * TIMEFRAME_MS["1d"]),
    );
    const closeAt = status.calendarDay?.regularCloseAt;
    if (!status.calendarDay?.tradingDay || !closeAt) {
      continue;
    }
    const closeDate = new Date(closeAt);
    if (
      !Number.isNaN(closeDate.getTime()) &&
      closeDate.getTime() <= evaluatedMs
    ) {
      return closeDate;
    }
  }
  return null;
}

function getSignalMonitorMarketSessionContext(
  evaluatedAt: Date,
): SignalMonitorMarketSessionContext {
  const evaluatedAtMs = evaluatedAt.getTime();
  const cached = signalMonitorMarketSessionContextCache.get(evaluatedAtMs);
  if (cached) {
    return cached;
  }

  const status = resolveUsEquityMarketStatus(evaluatedAt);
  const sessionKey = status.session.key;
  const quiet = sessionKey === "closed" || !status.calendarDay?.tradingDay;
  const context: SignalMonitorMarketSessionContext = {
    evaluatedAtMs,
    quiet,
    marketIdle:
      !quiet && SIGNAL_MONITOR_MARKET_IDLE_SESSION_KEYS.has(sessionKey),
    previousMarketCloseAt: quiet
      ? resolveSignalMonitorPreviousMarketCloseAtUncached(evaluatedAt)
      : null,
  };
  signalMonitorMarketSessionContextCache.set(evaluatedAtMs, context);
  pruneSignalMonitorMarketSessionContextCache();
  return context;
}

function isSignalMonitorQuietMarketSession(evaluatedAt: Date): boolean {
  return getSignalMonitorMarketSessionContext(evaluatedAt).quiet;
}

function isSignalMonitorMarketIdleSession(evaluatedAt: Date): boolean {
  return getSignalMonitorMarketSessionContext(evaluatedAt).marketIdle;
}

function resolveSignalMonitorPreviousMarketCloseAt(
  evaluatedAt: Date,
): Date | null {
  return getSignalMonitorMarketSessionContext(evaluatedAt).previousMarketCloseAt;
}

function quietMarketSignalMonitorCompletedBarsQueryTo(input: {
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}): Date | null {
  if (input.timeframe === "1d") {
    return null;
  }
  if (!isSignalMonitorQuietMarketSession(input.evaluatedAt)) {
    return null;
  }
  return resolveSignalMonitorPreviousMarketCloseAt(input.evaluatedAt);
}

export function isSignalMonitorBarComplete(input: {
  timestamp: Date;
  dataUpdatedAt?: Date | null;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}): boolean {
  if (input.timeframe === "1d") {
    return dailyBarDateKey(input.timestamp) < marketDateKey(input.evaluatedAt);
  }

  const completedAt = input.dataUpdatedAt ?? input.timestamp;
  return completedAt.getTime() <= input.evaluatedAt.getTime();
}

export function signalMonitorCompletedBarsQueryTo(input: {
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}): Date {
  if (input.timeframe === "1d") {
    const [year, month, day] = marketDateKey(input.evaluatedAt)
      .split("-")
      .map((part) => Number.parseInt(part, 10));
    return new Date(Date.UTC(year, month - 1, day));
  }

  const quietMarketQueryTo = quietMarketSignalMonitorCompletedBarsQueryTo(input);
  if (quietMarketQueryTo) {
    return quietMarketQueryTo;
  }

  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  const completedBoundaryMs =
    Math.floor(input.evaluatedAt.getTime() / timeframeMs) * timeframeMs;
  return new Date(Math.max(0, completedBoundaryMs));
}

function filterCompletedBars(
  inputBars: Awaited<ReturnType<typeof getBars>>["bars"],
  timeframe: SignalMonitorMatrixTimeframe,
  evaluatedAt: Date,
) {
  return inputBars.filter((bar) => {
    if (bar.partial === true) {
      return false;
    }

    const timestamp = dateOrNull(bar.timestamp);
    const dataUpdatedAt = dateOrNull(bar.dataUpdatedAt);
    return timestamp
      ? isSignalMonitorBarComplete({
          timestamp,
          dataUpdatedAt,
          timeframe,
          evaluatedAt,
        })
      : false;
  });
}

function mergeCompletedBars(
  baseBars: SignalMonitorBarSnapshot[],
  liveEdgeBars: SignalMonitorBarSnapshot[],
  limit: number,
) {
  const byTimestamp = new Map<number, SignalMonitorBarSnapshot>();
  [...baseBars, ...liveEdgeBars].forEach((bar) => {
    const timestamp = dateOrNull(bar.timestamp);
    if (!timestamp) {
      return;
    }
    const key = timestamp.getTime();
    const current = byTimestamp.get(key);
    // Same-bucket collision: a delayed replay must not displace a live copy.
    // The OHLC matches either way, but the delayed flag would propagate and
    // pause evaluation behind the delayed-latest-bar gate.
    if (current && current.delayed !== true && bar.delayed === true) {
      return;
    }
    byTimestamp.set(key, bar);
  });
  return Array.from(byTimestamp.entries())
    .sort(([left], [right]) => left - right)
    .map(([, bar]) => bar)
    .slice(-limit);
}

const SIGNAL_MONITOR_LIVE_EDGE_REFERENCE_MAX_DEVIATION = 0.15;
const SIGNAL_MONITOR_LIVE_EDGE_SOURCES = new Set<string>([
  "ibkr-websocket-derived",
  "massive-websocket",
  "massive-delayed-websocket",
]);

function signalMonitorBarTimestampMs(
  bar: SignalMonitorBarSnapshot | undefined,
): number | null {
  const timestamp = dateOrNull(bar?.timestamp);
  const timestampMs = timestamp?.getTime();
  return typeof timestampMs === "number" && Number.isFinite(timestampMs)
    ? timestampMs
    : null;
}

function signalMonitorBarTimestampIso(
  bar: SignalMonitorBarSnapshot | undefined,
): string | null {
  const timestamp = dateOrNull(bar?.timestamp);
  return timestamp ? timestamp.toISOString() : null;
}

function signalMonitorBarSource(
  bar: SignalMonitorBarSnapshot | undefined,
): string | null {
  const source = String(bar?.source ?? "").trim().toLowerCase();
  return source || null;
}

function isSignalMonitorLiveEdgeBar(
  bar: SignalMonitorBarSnapshot | undefined,
): boolean {
  const source = signalMonitorBarSource(bar);
  return source ? SIGNAL_MONITOR_LIVE_EDGE_SOURCES.has(source) : false;
}

function signalMonitorBarClose(
  bar: SignalMonitorBarSnapshot | undefined,
): number | null {
  const close = numericValueOrNull(bar?.close);
  return close != null && close > 0 ? close : null;
}

function resolveSignalMonitorReferenceBar(input: {
  bar: SignalMonitorBarSnapshot;
  referenceBars: SignalMonitorBarSnapshot[];
}): SignalMonitorBarSnapshot | null {
  const barMs = signalMonitorBarTimestampMs(input.bar);
  if (barMs == null) {
    return null;
  }
  const references = input.referenceBars
    .filter((reference) => reference !== input.bar)
    .filter((reference) => !isSignalMonitorLiveEdgeBar(reference))
    .filter((reference) => signalMonitorBarClose(reference) != null)
    .map((reference) => ({
      reference,
      timestampMs: signalMonitorBarTimestampMs(reference),
    }))
    .filter(
      (entry): entry is { reference: SignalMonitorBarSnapshot; timestampMs: number } =>
        entry.timestampMs != null,
    )
    .sort((left, right) => left.timestampMs - right.timestampMs);
  if (!references.length) {
    return null;
  }
  const prior = references.filter((entry) => entry.timestampMs <= barMs).at(-1);
  if (prior) {
    return prior.reference;
  }
  return references
    .map((entry) => ({
      ...entry,
      distanceMs: Math.abs(entry.timestampMs - barMs),
    }))
    .sort((left, right) => left.distanceMs - right.distanceMs)[0]?.reference ?? null;
}

function resolveSignalMonitorSourceIntegrity(input: {
  bar: SignalMonitorBarSnapshot | null | undefined;
  referenceBars: SignalMonitorBarSnapshot[];
}): SignalMonitorSourceIntegrityDecision {
  const bar = input.bar;
  const close = signalMonitorBarClose(bar ?? undefined);
  const source = signalMonitorBarSource(bar ?? undefined);
  const timestamp = signalMonitorBarTimestampIso(bar ?? undefined);
  const base = {
    source,
    close,
    timestamp,
    referenceClose: null,
    referenceTimestamp: null,
    referenceSource: null,
    deviationPercent: null,
  };
  if (!bar || !isSignalMonitorLiveEdgeBar(bar)) {
    return {
      ...base,
      trusted: true,
      reason: "trusted-source",
    };
  }
  if (close == null) {
    return {
      ...base,
      trusted: false,
      reason: "non-physical-price",
    };
  }
  const reference = resolveSignalMonitorReferenceBar({
    bar,
    referenceBars: input.referenceBars,
  });
  const referenceClose = signalMonitorBarClose(reference ?? undefined);
  if (!reference || referenceClose == null) {
    return {
      ...base,
      trusted: false,
      reason: "missing-reference",
    };
  }
  const deviation = Math.abs(close - referenceClose) / referenceClose;
  const deviationPercent = Number((deviation * 100).toFixed(4));
  const trusted = deviation <= SIGNAL_MONITOR_LIVE_EDGE_REFERENCE_MAX_DEVIATION;
  return {
    ...base,
    trusted,
    reason: trusted ? "within-reference-band" : "deviates-from-reference",
    referenceClose,
    referenceTimestamp: signalMonitorBarTimestampIso(reference),
    referenceSource: signalMonitorBarSource(reference),
    deviationPercent,
  };
}

function filterSignalMonitorLiveEdgeBarsForTrustedMove(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  baseBars: SignalMonitorBarSnapshot[];
  liveEdgeBars: SignalMonitorBarSnapshot[];
}): SignalMonitorBarSnapshot[] {
  const decisions = input.liveEdgeBars.map((bar) => ({
    bar,
    integrity: resolveSignalMonitorSourceIntegrity({
      bar,
      referenceBars: input.baseBars,
    }),
  }));
  const rejected = decisions.filter(
    (entry) =>
      entry.integrity.reason === "deviates-from-reference" ||
      entry.integrity.reason === "non-physical-price",
  );
  if (rejected.length) {
    logger.warn(
      {
        symbol: normalizeSymbol(input.symbol).toUpperCase(),
        timeframe: input.timeframe,
        rejectedCount: rejected.length,
        samples: rejected.slice(0, 5).map((entry) => entry.integrity),
      },
      "Signal monitor rejected untrusted live-edge bars",
    );
  }
  return decisions
    .filter((entry) => !rejected.includes(entry))
    .map((entry) => entry.bar);
}

function traceSignalMonitorLiveEdgeIntegrity(input: {
  baseBars: SignalMonitorBarSnapshot[];
  liveEdgeBars: SignalMonitorBarSnapshot[];
}) {
  const decisions = input.liveEdgeBars
    .filter(isSignalMonitorLiveEdgeBar)
    .map((bar) =>
      resolveSignalMonitorSourceIntegrity({
        bar,
        referenceBars: input.baseBars,
      }),
    );
  return decisions.reduce(
    (acc, decision) => {
      acc.checkedCount += 1;
      if (!decision.trusted) {
        acc.untrustedCount += 1;
        if (decision.reason === "missing-reference") {
          acc.missingReferenceCount += 1;
        }
        if (decision.reason === "deviates-from-reference") {
          acc.deviationRejectedCount += 1;
        }
        if (acc.samples.length < 5) {
          acc.samples.push(decision);
        }
      }
      acc.maxDeviationPercent =
        decision.deviationPercent == null
          ? acc.maxDeviationPercent
          : Math.max(acc.maxDeviationPercent ?? 0, decision.deviationPercent);
      return acc;
    },
    {
      checkedCount: 0,
      untrustedCount: 0,
      missingReferenceCount: 0,
      deviationRejectedCount: 0,
      maxDeviationPercent: null as number | null,
      samples: [] as SignalMonitorSourceIntegrityDecision[],
    },
  );
}

function stockMinuteAggregateToSignalMonitorBar(
  aggregate: StockMinuteAggregateMessage,
  evaluatedAt: Date,
): SignalMonitorBarSnapshot | null {
  const values = [
    aggregate.open,
    aggregate.high,
    aggregate.low,
    aggregate.close,
  ];
  if (
    !values.every((value) => Number.isFinite(value)) ||
    !Number.isFinite(aggregate.startMs) ||
    !Number.isFinite(aggregate.endMs)
  ) {
    return null;
  }
  const volume = Number(aggregate.volume);
  const dataUpdatedAt = new Date(stockMinuteAggregateClosedAtMs(aggregate));
  return {
    timestamp: new Date(aggregate.startMs),
    open: aggregate.open,
    high: aggregate.high,
    low: aggregate.low,
    close: aggregate.close,
    volume: Number.isFinite(volume) ? volume : 0,
    bid: null,
    ask: null,
    mid: null,
    quoteAsOf: null,
    source: aggregate.source,
    providerContractId: null,
    outsideRth: true,
    partial: false,
    transport: "tws",
    delayed: aggregate.delayed,
    freshness: aggregate.delayed ? "delayed" : "live",
    marketDataMode: aggregate.delayed ? "delayed" : "live",
    dataUpdatedAt,
    ageMs: Math.max(0, evaluatedAt.getTime() - dataUpdatedAt.getTime()),
  };
}

function aggregateStockMinuteBarsForTimeframe(input: {
  bars: SignalMonitorBarSnapshot[];
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  limit: number;
  includeProvisional?: boolean;
}): SignalMonitorBarSnapshot[] {
  if (input.timeframe === "1d") {
    return [];
  }
  const completedMinuteBars = filterCompletedBars(
    input.bars,
    "1m",
    input.evaluatedAt,
  );
  const provisionalMinuteBars = input.includeProvisional
    ? input.bars.filter((bar) => {
        const timestamp = dateOrNull(bar.timestamp);
        if (!timestamp || timestamp.getTime() > input.evaluatedAt.getTime()) {
          return false;
        }
        return !completedMinuteBars.some((completed) => {
          const completedAt = dateOrNull(completed.timestamp);
          return completedAt?.getTime() === timestamp.getTime();
        });
      })
    : [];
  const minuteBars = [...completedMinuteBars, ...provisionalMinuteBars].sort(
    (left, right) => {
      const leftTime = dateOrNull(left.timestamp)?.getTime() ?? 0;
      const rightTime = dateOrNull(right.timestamp)?.getTime() ?? 0;
      return leftTime - rightTime;
    },
  );
  if (input.timeframe === "1m") {
    return minuteBars
      .map((bar) => {
        const timestamp = dateOrNull(bar.timestamp);
        if (!timestamp) {
          return bar;
        }
        const completed = isSignalMonitorBarComplete({
          timestamp,
          dataUpdatedAt: dateOrNull(bar.dataUpdatedAt),
          timeframe: "1m",
          evaluatedAt: input.evaluatedAt,
        });
        return completed
          ? bar
          : {
              ...bar,
              partial: true,
              dataUpdatedAt: input.evaluatedAt,
              ageMs: 0,
            };
      })
      .slice(-input.limit);
  }

  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  const requiredChildBars = Math.floor(timeframeMs / TIMEFRAME_MS["1m"]);
  if (requiredChildBars <= 1) {
    return completedMinuteBars.slice(-input.limit);
  }

  const grouped = new Map<number, SignalMonitorBarSnapshot[]>();
  minuteBars.forEach((bar) => {
    const timestamp = dateOrNull(bar.timestamp);
    if (!timestamp) {
      return;
    }
    const bucket = Math.floor(timestamp.getTime() / timeframeMs) * timeframeMs;
    const existing = grouped.get(bucket) ?? [];
    existing.push(bar);
    grouped.set(bucket, existing);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucket, bars]): SignalMonitorBarSnapshot | null => {
      const sorted = [...bars].sort((left, right) => {
        const leftTime = dateOrNull(left.timestamp)?.getTime() ?? 0;
        const rightTime = dateOrNull(right.timestamp)?.getTime() ?? 0;
        return leftTime - rightTime;
      });
      const childBuckets = new Set(
        sorted
          .map((bar) => dateOrNull(bar.timestamp)?.getTime())
          .filter((time): time is number => typeof time === "number")
          .map((time) => Math.floor(time / TIMEFRAME_MS["1m"])),
      );
      const bucketEndMs = bucket + timeframeMs;
      const bucketStarted = bucket <= input.evaluatedAt.getTime();
      const bucketComplete = bucketEndMs <= input.evaluatedAt.getTime();
      const provisional = Boolean(
        input.includeProvisional &&
        bucketStarted &&
        !bucketComplete &&
        childBuckets.size > 0,
      );
      if (childBuckets.size < requiredChildBars && !provisional) {
        return null;
      }

      const first = sorted[0];
      const last = sorted.at(-1);
      const open = Number(first?.open);
      const close = Number(last?.close);
      const highValues = sorted
        .map((bar) => Number(bar.high))
        .filter(Number.isFinite);
      const lowValues = sorted
        .map((bar) => Number(bar.low))
        .filter(Number.isFinite);
      if (
        !first ||
        !last ||
        !Number.isFinite(open) ||
        !Number.isFinite(close) ||
        !highValues.length ||
        !lowValues.length
      ) {
        return null;
      }

      const rawDataUpdatedAt =
        sorted
          .map((bar) => dateOrNull(bar.dataUpdatedAt))
          .filter((value): value is Date => Boolean(value))
          .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
      const dataUpdatedAt =
        provisional && rawDataUpdatedAt
          ? new Date(
              Math.min(rawDataUpdatedAt.getTime(), input.evaluatedAt.getTime()),
            )
          : new Date(bucketEndMs);
      const delayed = sorted.some((bar) => isSignalMonitorDelayedBar(bar));

      return {
        ...last,
        timestamp: new Date(bucket),
        open,
        high: Math.max(...highValues),
        low: Math.min(...lowValues),
        close,
        volume: sorted.reduce((sum, bar) => {
          const volume = Number(bar.volume);
          return sum + (Number.isFinite(volume) ? volume : 0);
        }, 0),
        partial: provisional,
        delayed,
        freshness: delayed ? "delayed" : "live",
        marketDataMode: delayed ? "delayed" : "live",
        dataUpdatedAt,
        ageMs: dataUpdatedAt
          ? Math.max(0, input.evaluatedAt.getTime() - dataUpdatedAt.getTime())
          : null,
      };
    })
    .filter((bar): bar is SignalMonitorBarSnapshot => {
      if (!bar) return false;
      if (bar.partial === true && input.includeProvisional) {
        return true;
      }
      const timestamp = dateOrNull(bar.timestamp);
      const dataUpdatedAt = dateOrNull(bar.dataUpdatedAt);
      return timestamp
        ? isSignalMonitorBarComplete({
            timestamp,
            dataUpdatedAt,
            timeframe: input.timeframe,
            evaluatedAt: input.evaluatedAt,
          })
        : false;
    })
    .slice(-input.limit);
}

function aggregateStockMinuteAggregatesForSignalMonitorBars(input: {
  aggregates: StockMinuteAggregateMessage[];
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  limit: number;
  includeProvisional?: boolean;
}): SignalMonitorBarSnapshot[] {
  const minuteBars = input.aggregates
    .map((aggregate) =>
      stockMinuteAggregateToSignalMonitorBar(aggregate, input.evaluatedAt),
    )
    .filter((bar): bar is SignalMonitorBarSnapshot => Boolean(bar));

  return aggregateStockMinuteBarsForTimeframe({
    bars: minuteBars,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
    limit: input.limit,
    includeProvisional: input.includeProvisional,
  });
}

function mergeSignalMonitorStockMinuteAggregates(
  aggregates: StockMinuteAggregateMessage[],
  limit = Number.MAX_SAFE_INTEGER,
): StockMinuteAggregateMessage[] {
  const byMinute = new Map<string, StockMinuteAggregateMessage>();
  aggregates.forEach((aggregate) => {
    const symbol = normalizeSymbol(aggregate?.symbol);
    const startMs = Number(aggregate?.startMs);
    if (!symbol || !Number.isFinite(startMs)) {
      return;
    }
    byMinute.set(`${symbol}:${startMs}`, {
      ...aggregate,
      symbol,
      startMs,
    });
  });
  const normalizedLimit = positiveInteger(
    limit,
    Number.MAX_SAFE_INTEGER,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  return Array.from(byMinute.values())
    .sort((left, right) => left.startMs - right.startMs)
    .slice(-normalizedLimit);
}

function loadSignalMonitorStreamCompletedBars(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  limit: number;
  includeProvisional?: boolean;
}): SignalMonitorBarSnapshot[] {
  if (input.timeframe === "1d") {
    return [];
  }

  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  const childBarsPerOutput = Math.max(
    1,
    Math.floor(timeframeMs / TIMEFRAME_MS["1m"]),
  );
  const historyLimit = Math.max(
    120,
    Math.min(300, input.limit * childBarsPerOutput),
  );
  const sinceMs =
    input.evaluatedAt.getTime() -
    Math.min(4 * 60 * 60_000, historyLimit * TIMEFRAME_MS["1m"]);
  const untilMs = input.evaluatedAt.getTime();
  const historyAggregates = getRecentStockMinuteAggregateHistory({
    symbol: input.symbol,
    sinceMs,
    untilMs,
    limit: historyLimit,
  });
  const currentAggregates = getCurrentStockMinuteAggregates([input.symbol])
    .filter((aggregate) => {
      const startMs = Number(aggregate?.startMs);
      return Number.isFinite(startMs) && startMs >= sinceMs && startMs <= untilMs;
    });
  const aggregates = mergeSignalMonitorStockMinuteAggregates(
    [...historyAggregates, ...currentAggregates],
    historyLimit,
  );

  return aggregateStockMinuteAggregatesForSignalMonitorBars({
    aggregates,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
    limit: input.limit,
    includeProvisional: input.includeProvisional,
  });
}

// Closed-at of the freshest COMPLETED bar the live in-memory aggregate ring can
// produce for a lane right now, or null when the ring carries nothing usable
// (e.g. an illiquid symbol with no recent prints, or 1d which never streams).
//
// The stored-state read path relabels lanes stale purely on the persisted
// `latestBarAt` age. That age freezes whenever the producer stops re-evaluating
// a cell, even though Massive keeps streaming extended-hours aggregates for it —
// so a lane whose live data is current (e.g. an ETF still printing after RTH)
// gets falsely marked idle/stale. This lets the read path consult the same live
// ring the producer evaluates off, so a current ring bar rescues the lane. An
// empty ring (genuinely no recent print) returns null and the lane stays
// legitimately stale/idle.
function signalMonitorStreamLaneLatestCompletedBarAt(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}): Date | null {
  if (input.timeframe === "1d") {
    return null;
  }
  const streamBars = loadSignalMonitorStreamCompletedBars({
    symbol: input.symbol,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
    limit: SIGNAL_MONITOR_STALE_RETRY_BARS,
  });
  return signalMonitorBarClosedAt(streamBars.at(-1));
}

async function refreshSignalMonitorLocalBarCacheWarmup(): Promise<void> {
  if (signalMonitorLocalBarCacheWarmupInFlight) {
    return;
  }
  signalMonitorLocalBarCacheWarmupInFlight = true;
  try {
    const environment = getRuntimeMode();
    const profile = getRuntimeSignalMonitorProfile(environment);
    const resolved = await resolveSignalMonitorProfileUniverse(profile, {
      ensureWatchlist: false,
    });
    const symbols = resolveSignalMonitorActiveUniverseSymbols(resolved);
    if (symbols.length) {
      primeSignalMonitorLocalBarCache(symbols);
      void refreshSignalMonitorBackfilledBaseBars({
        symbols,
        timeframes: [...SIGNAL_MONITOR_MATRIX_TIMEFRAMES],
        evaluatedAt: new Date(),
      });
    }
  } catch (error) {
    logger.warn(
      { err: error },
      "Signal monitor local bar cache warmup failed",
    );
  } finally {
    signalMonitorLocalBarCacheWarmupInFlight = false;
  }
}

export function startSignalMonitorLocalBarCacheWarmup(): void {
  if (signalMonitorLocalBarCacheWarmupStarted) {
    return;
  }
  signalMonitorLocalBarCacheWarmupStarted = true;
  void refreshSignalMonitorLocalBarCacheWarmup();
  signalMonitorLocalBarCacheWarmupTimer = setInterval(() => {
    void refreshSignalMonitorLocalBarCacheWarmup();
  }, SIGNAL_MONITOR_LOCAL_BAR_CACHE_REFRESH_MS);
  signalMonitorLocalBarCacheWarmupTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Backfilled base-bar cache for the server-owned SSE producer.
//
// The producer evaluates synchronously off the live aggregate ring, which is
// only a few minutes deep — far short of the pyrus indicator's warmup window,
// so once the producer became the sole signal source the aggregated frames
// (2m/15m/1h/1d) stopped producing signals. This cache holds a deep, backfilled
// completed-bar base per (symbol, timeframe), sourced from stored + provider
// history via loadSignalMonitorCompletedBars and refreshed asynchronously on a
// per-timeframe cadence OFF the synchronous evaluation path. The producer merges
// this base with the live edge each tick (mergeCompletedBars), so the indicator
// sees a full current series with no await/DB read on the hot path. An empty
// base (cold start / disabled) falls back to the prior live-ring behavior.
type SignalMonitorBackfilledBaseEntry = {
  bars: SignalMonitorBarSnapshot[];
  refreshedAt: number;
};
const signalMonitorBackfilledBaseByCell = new Map<
  string,
  SignalMonitorBackfilledBaseEntry
>();
// The base is deep warmup history (slowly changing); the per-tick live-edge
// merge in evaluateSignalMonitorMatrixStateFromStreamBars supplies freshness, so
// the base is refreshed far less often than the 60s warmup tick. The live ring /
// live edge bridges the gap between refreshes.
const SIGNAL_MONITOR_BACKFILL_REFRESH_MS: Record<
  SignalMonitorMatrixTimeframe,
  number
> = {
  "1m": 5 * 60_000,
  "2m": 5 * 60_000,
  "5m": 5 * 60_000,
  "15m": 10 * 60_000,
  "1h": 30 * 60_000,
  "1d": 4 * 60 * 60_000,
};
// Dedicated, intentionally small concurrency budget for the refresher's
// loadSignalMonitorCompletedBars calls. Kept independent of (and far below)
// SIGNAL_MONITOR_EVALUATION_CONCURRENCY_LIMIT so the off-path backfill cannot
// crowd out evaluation / chart-serving bar loads.
const SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT = 3;
// Cap warmed-cell refreshes per invocation so steady-state upkeep does not fire
// a repeating whole-universe refresh. Cold cells are not coverage-capped: every
// never-warmed cell must be selected on startup so all six frames become
// producer-ready; concurrency/yielding below is the pressure control.
const SIGNAL_MONITOR_BACKFILL_MAX_CELLS_PER_CYCLE = 64;
const SIGNAL_MONITOR_BACKFILL_RECENT_AGGREGATE_GRACE_MS = (() => {
  const parsed = Number(process.env.SIGNAL_MONITOR_BACKFILL_RECENT_AGGREGATE_GRACE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5 * 60_000;
})();
let signalMonitorBackfillRefreshInFlight = false;

// Shared background DB-acquisition budget for the producer's two un-awaited
// fan-outs (deep-history backfill reads + best-effort state-persistence reads).
// Each fan-out is locally bounded, but those local limits do NOT compose: a
// backfill batch (3) running while a persist batch (evaluationConcurrency, 6)
// drains held up to 9 of the hard-capped 12 pool connections at once, leaving
// almost no headroom for interactive HTTP / reconciliation reads and producing
// the observed active:12/waiting:4 saturation. This single process-wide
// semaphore caps the COMBINED in-flight background DB reads so they can never
// consume more than this budget, permanently reserving the rest of the pool for
// foreground work. Background work yields to interactive reads instead of
// racing them. Override with SIGNAL_MONITOR_BACKGROUND_DB_CONCURRENCY.
const SIGNAL_MONITOR_BACKGROUND_DB_CONCURRENCY = (() => {
  const parsed = Number(process.env.SIGNAL_MONITOR_BACKGROUND_DB_CONCURRENCY);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6;
})();

function createSignalMonitorBackgroundDbGate(limit: number) {
  let available = Math.max(1, limit);
  const waiters: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (available > 0) {
      available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiters.push(resolve));
  };
  const release = (): void => {
    const next = waiters.shift();
    if (next) {
      next();
      return;
    }
    available += 1;
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}

// Single shared gate instance: both background fan-outs acquire from it, so their
// combined DB-connection demand is bounded by one budget rather than summing.
const runSignalMonitorBackgroundDbRead = createSignalMonitorBackgroundDbGate(
  SIGNAL_MONITOR_BACKGROUND_DB_CONCURRENCY,
);

function signalMonitorBackfillCellKey(
  symbol: string,
  timeframe: string,
): string {
  return `${normalizeSymbol(symbol).toUpperCase()}:${timeframe}`;
}

function getSignalMonitorBackfilledBaseBars(
  symbol: string,
  timeframe: SignalMonitorMatrixTimeframe,
): SignalMonitorBarSnapshot[] {
  return (
    signalMonitorBackfilledBaseByCell.get(
      signalMonitorBackfillCellKey(symbol, timeframe),
    )?.bars ?? []
  );
}

// Pure: the backfill refresher backs OFF rather than adding to pressure, so it
// skips a whole cycle once the API is at "high" resource pressure. "watch" and
// "normal" keep running.
function shouldSkipSignalMonitorBackfillForPressure(
  resourceLevel: ApiResourcePressureLevel,
): boolean {
  return resourceLevel === "high";
}

function shouldSkipSignalMonitorBackfillForQuietProducer(input: {
  evaluatedAt: Date;
  eventCount: number;
  lastAggregateAt: Date | null;
  recentAggregateGraceMs?: number;
}): boolean {
  const session = getSignalMonitorMarketSessionContext(input.evaluatedAt);
  if (!session.quiet && !session.marketIdle) {
    return false;
  }
  if (input.eventCount <= 0 || !input.lastAggregateAt) {
    return true;
  }
  const graceMs = Math.max(
    0,
    input.recentAggregateGraceMs ?? SIGNAL_MONITOR_BACKFILL_RECENT_AGGREGATE_GRACE_MS,
  );
  return input.evaluatedAt.getTime() - input.lastAggregateAt.getTime() > graceMs;
}

type SignalMonitorBackfillCandidate = {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  refreshedAt: number | null;
};

// Pure selection used by refreshSignalMonitorBackfilledBaseBars: keep only cells
// whose per-timeframe cadence has elapsed, order the most-overdue first, and cap
// to maxCells. Never-refreshed cells (refreshedAt == null) are maximally overdue.
// Capping + recency ordering gives round-robin coverage across cycles instead of
// a single thundering-herd refresh of the whole universe.
function selectSignalMonitorBackfillDueCells(input: {
  candidates: SignalMonitorBackfillCandidate[];
  nowMs: number;
  maxCells: number;
}): Array<{ symbol: string; timeframe: SignalMonitorMatrixTimeframe }> {
  const due = input.candidates
    .map((candidate) => {
      const interval =
        SIGNAL_MONITOR_BACKFILL_REFRESH_MS[candidate.timeframe] ?? 5 * 60_000;
      const overdueBy =
        candidate.refreshedAt === null
          ? Number.POSITIVE_INFINITY
          : input.nowMs - candidate.refreshedAt - interval;
      return { candidate, overdueBy };
    })
    .filter((entry) => entry.overdueBy >= 0)
    .sort((left, right) => right.overdueBy - left.overdueBy);
  const cap = Math.max(0, input.maxCells);
  if (cap <= 0) {
    return [];
  }

  const coldEntries = due.filter(
    (entry) => entry.candidate.refreshedAt === null,
  );
  const refreshEntries = due.filter(
    (entry) => entry.candidate.refreshedAt !== null,
  );
  const selected = [
    ...coldEntries,
    ...refreshEntries.slice(0, Math.max(0, cap - coldEntries.length)),
  ];

  return selected.map(({ candidate }) => ({
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
  }));
}

async function refreshSignalMonitorBackfilledBaseBars(input: {
  symbols: string[];
  timeframes: SignalMonitorMatrixTimeframe[];
  evaluatedAt: Date;
}): Promise<void> {
  if (signalMonitorBackfillRefreshInFlight) {
    return;
  }
  // The legacy bar-eval flag does NOT gate this backfill: it is the
  // server-owned SSE producer's own deep-history bar supply — what the
  // aggregated 2m/5m/15m/1h/1d frames need to warm the pyrus indicator — not
  // the legacy scan. It must keep running while
  // PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED is off so the producer stays
  // self-sufficient. (Only the native 1m frame needs no backfill, which is why
  // it alone kept generating after this supply was switched off.)
  // Back OFF under pressure: the backfill is the very kind of universe-wide
  // getBars load that feeds resource pressure, so skip this cycle entirely once
  // the API is at "high". The live ring / per-tick live edge keeps evaluation
  // running until pressure subsides.
  if (
    shouldSkipSignalMonitorBackfillForPressure(
      getApiResourcePressureSnapshot().resourceLevel,
    ) ||
    shouldSkipSignalMonitorBackfillForQuietProducer({
      evaluatedAt: input.evaluatedAt,
      eventCount: signalMonitorMatrixStreamAggregateEventCount,
      lastAggregateAt: signalMonitorMatrixStreamLastAggregateAt,
    })
  ) {
    return;
  }
  signalMonitorBackfillRefreshInFlight = true;
  const nowMs = input.evaluatedAt.getTime();
  try {
    const candidates: SignalMonitorBackfillCandidate[] = [];
    for (const symbol of input.symbols) {
      const normalized = normalizeSymbol(symbol).toUpperCase();
      if (!normalized) {
        continue;
      }
      for (const timeframe of input.timeframes) {
        const existing = signalMonitorBackfilledBaseByCell.get(
          signalMonitorBackfillCellKey(normalized, timeframe),
        );
        candidates.push({
          symbol: normalized,
          timeframe,
          refreshedAt: existing?.refreshedAt ?? null,
        });
      }
    }
    const dueCells = selectSignalMonitorBackfillDueCells({
      candidates,
      nowMs,
      maxCells: SIGNAL_MONITOR_BACKFILL_MAX_CELLS_PER_CYCLE,
    });
    if (!dueCells.length) {
      return;
    }
    // Batch-prefetch all due cells' stored bars in a few set-based reads so the
    // per-cell readStoredBars calls below serve from the prefetch instead of one
    // pooled connection per (symbol, source). This producer backfill is a
    // dominant bar_cache pool load (up to MAX_CELLS_PER_CYCLE × sources pooled
    // reads/cycle). Behavior-equal: readStoredBars falls back to the per-symbol
    // read on any miss, mismatched evaluatedAt/limit, or under DB pressure.
    const dueSymbols = Array.from(new Set(dueCells.map((cell) => cell.symbol)));
    const dueTimeframes = Array.from(
      new Set(dueCells.map((cell) => cell.timeframe)),
    );
    await runWithSignalMonitorStoredBarsPrefetch(
      {
        symbols: dueSymbols,
        timeframes: dueTimeframes,
        evaluatedAt: input.evaluatedAt,
        limit: SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
      },
      async () => {
        for (
          let index = 0;
          index < dueCells.length;
          index += SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT
        ) {
          const batch = dueCells.slice(
            index,
            index + SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT,
          );
          await Promise.all(
            batch.map(async ({ symbol, timeframe }) => {
              try {
                const snapshot = await runSignalMonitorBackgroundDbRead(() =>
                  loadSignalMonitorCompletedBars({
                    symbol,
                    timeframe,
                    evaluatedAt: input.evaluatedAt,
                    limit: SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
                    priority: SIGNAL_MONITOR_MATRIX_BARS_PRIORITY,
                    includeProvisionalLiveEdge: false,
                    allowHistoricalFallback: true,
                    // Producer-owned backfill: allowed to load provider history
                    // even while the legacy bar-eval flag is off (this is the
                    // producer's bar supply, not the legacy scan).
                    bypassPassiveSourceGate: true,
                  }),
                );
                if (snapshot.bars.length) {
                  signalMonitorBackfilledBaseByCell.set(
                    signalMonitorBackfillCellKey(symbol, timeframe),
                    {
                      bars: snapshot.bars.slice(
                        -SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
                      ),
                      refreshedAt: input.evaluatedAt.getTime(),
                    },
                  );
                }
              } catch {
                // Best-effort warmup; keep any prior base for this cell.
              }
            }),
          );
          await yieldSignalMonitorEventLoop();
        }
      },
    );
  } finally {
    signalMonitorBackfillRefreshInFlight = false;
  }
}

function signalMonitorMatrixStockAggregateSymbols(symbols: string[]): string[] {
  const normalizedSymbols = new Set(
    symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  signalMonitorMatrixStreamSubscribers.forEach((subscriber) => {
    subscriber.scope.symbols.forEach((symbol) => normalizedSymbols.add(symbol));
  });
  return Array.from(normalizedSymbols).sort((left, right) =>
    left.localeCompare(right),
  );
}

function primeSignalMonitorMatrixStockAggregateStream(symbols: string[]): void {
  const normalizedSymbols = signalMonitorMatrixStockAggregateSymbols(symbols);
  if (!normalizedSymbols.length) {
    return;
  }

  primeSignalMonitorLocalBarCache(normalizedSymbols);
  if (
    !isBackgroundStockAggregateStreamingEnabled() &&
    !isForegroundSignalMatrixStockAggregateStreamingEnabled()
  ) {
    return;
  }

  if (signalMonitorMatrixStockAggregateReleaseTimer) {
    clearTimeout(signalMonitorMatrixStockAggregateReleaseTimer);
    signalMonitorMatrixStockAggregateReleaseTimer = null;
  }
  if (signalMonitorMatrixStockAggregateSubscription) {
    signalMonitorMatrixStockAggregateSubscription.setSymbols(normalizedSymbols);
  } else {
    signalMonitorMatrixStockAggregateSubscription =
      subscribeMutableStockMinuteAggregates(
        normalizedSymbols,
        queueSignalMonitorMatrixStreamAggregate,
      );
  }
  signalMonitorMatrixStockAggregateReleaseTimer = setTimeout(() => {
    signalMonitorMatrixStockAggregateReleaseTimer = null;
    signalMonitorMatrixStockAggregateSubscription?.unsubscribe();
    signalMonitorMatrixStockAggregateSubscription = null;
  }, SIGNAL_MONITOR_MATRIX_STREAM_KEEPALIVE_MS);
  signalMonitorMatrixStockAggregateReleaseTimer.unref?.();
}

export function aggregateCompletedMinuteBars(
  inputBars: Awaited<ReturnType<typeof getBars>>["bars"],
  timeframe: SignalMonitorMatrixTimeframe,
  evaluatedAt: Date,
) {
  if (timeframe !== "2m") {
    return inputBars;
  }

  const grouped = new Map<
    number,
    Awaited<ReturnType<typeof getBars>>["bars"]
  >();
  filterCompletedBars(inputBars, "1m", evaluatedAt).forEach((bar) => {
    const timestamp = dateOrNull(bar.timestamp);
    if (!timestamp) return;
    const bucket =
      Math.floor(timestamp.getTime() / TIMEFRAME_MS["2m"]) * TIMEFRAME_MS["2m"];
    const existing = grouped.get(bucket) ?? [];
    existing.push(bar);
    grouped.set(bucket, existing);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucket, bars]) => {
      const sorted = [...bars].sort((left, right) => {
        const leftTime = dateOrNull(left.timestamp)?.getTime() ?? 0;
        const rightTime = dateOrNull(right.timestamp)?.getTime() ?? 0;
        return leftTime - rightTime;
      });
      const childBuckets = new Set(
        sorted
          .map((bar) => dateOrNull(bar.timestamp)?.getTime())
          .filter((time): time is number => typeof time === "number")
          .map((time) => Math.floor(time / TIMEFRAME_MS["1m"])),
      );
      if (childBuckets.size < 2) {
        return null;
      }
      const first = sorted[0];
      const last = sorted.at(-1);
      const open = Number(first?.open);
      const close = Number(last?.close);
      const highValues = sorted
        .map((bar) => Number(bar.high))
        .filter(Number.isFinite);
      const lowValues = sorted
        .map((bar) => Number(bar.low))
        .filter(Number.isFinite);
      if (
        !first ||
        !last ||
        !Number.isFinite(open) ||
        !Number.isFinite(close) ||
        !highValues.length ||
        !lowValues.length
      ) {
        return null;
      }
      return {
        ...last,
        timestamp: new Date(bucket),
        open,
        high: Math.max(...highValues),
        low: Math.min(...lowValues),
        close,
        volume: sorted.reduce((sum, bar) => {
          const volume = Number(bar.volume);
          return sum + (Number.isFinite(volume) ? volume : 0);
        }, 0),
        partial: false,
      };
    })
    .filter((bar): bar is SignalMonitorBarSnapshot => {
      if (!bar) return false;
      const timestamp = dateOrNull(bar.timestamp);
      const dataUpdatedAt = dateOrNull(bar.dataUpdatedAt);
      return timestamp
        ? isSignalMonitorBarComplete({
            timestamp,
            dataUpdatedAt,
            timeframe: "2m",
            evaluatedAt,
          })
        : false;
    });
}

export function aggregateCompletedFiveMinuteBars(
  inputBars: Awaited<ReturnType<typeof getBars>>["bars"],
  timeframe: SignalMonitorMatrixTimeframe,
  evaluatedAt: Date,
) {
  if (timeframe !== "15m") {
    return inputBars;
  }

  const grouped = new Map<
    number,
    Awaited<ReturnType<typeof getBars>>["bars"]
  >();
  filterCompletedBars(inputBars, "5m", evaluatedAt).forEach((bar) => {
    const timestamp = dateOrNull(bar.timestamp);
    if (!timestamp) return;
    const bucket =
      Math.floor(timestamp.getTime() / TIMEFRAME_MS["15m"]) *
      TIMEFRAME_MS["15m"];
    const existing = grouped.get(bucket) ?? [];
    existing.push(bar);
    grouped.set(bucket, existing);
  });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left - right)
    .map(([bucket, bars]) => {
      const sorted = [...bars].sort((left, right) => {
        const leftTime = dateOrNull(left.timestamp)?.getTime() ?? 0;
        const rightTime = dateOrNull(right.timestamp)?.getTime() ?? 0;
        return leftTime - rightTime;
      });
      const childBuckets = new Set(
        sorted
          .map((bar) => dateOrNull(bar.timestamp)?.getTime())
          .filter((time): time is number => typeof time === "number")
          .map((time) => Math.floor(time / TIMEFRAME_MS["5m"])),
      );
      if (childBuckets.size < 3) {
        return null;
      }
      const first = sorted[0];
      const last = sorted.at(-1);
      const open = Number(first?.open);
      const close = Number(last?.close);
      const highValues = sorted
        .map((bar) => Number(bar.high))
        .filter(Number.isFinite);
      const lowValues = sorted
        .map((bar) => Number(bar.low))
        .filter(Number.isFinite);
      if (
        !first ||
        !last ||
        !Number.isFinite(open) ||
        !Number.isFinite(close) ||
        !highValues.length ||
        !lowValues.length
      ) {
        return null;
      }
      return {
        ...last,
        timestamp: new Date(bucket),
        open,
        high: Math.max(...highValues),
        low: Math.min(...lowValues),
        close,
        volume: sorted.reduce((sum, bar) => {
          const volume = Number(bar.volume);
          return sum + (Number.isFinite(volume) ? volume : 0);
        }, 0),
        partial: false,
      };
    })
    .filter((bar): bar is SignalMonitorBarSnapshot => {
      if (!bar) return false;
      const timestamp = dateOrNull(bar.timestamp);
      const dataUpdatedAt = dateOrNull(bar.dataUpdatedAt);
      return timestamp
        ? isSignalMonitorBarComplete({
            timestamp,
            dataUpdatedAt,
            timeframe: "15m",
            evaluatedAt,
          })
        : false;
    });
}

type SignalMonitorPyrusBarEntry = {
  chartBar: PyrusSignalsBar;
  sourceBar: SignalMonitorBarSnapshot;
  anchorAt: Date;
  closedAt: Date;
};

// Identity memo for the completedBars → entries conversion (a top event-loop hotspot,
// ~12.9% self-time, re-run every per-cell eval). Keyed on the input ARRAY IDENTITY, not
// content: the completed-bars cache serves the same array object across the many re-evals
// within a bucket (read-side clone removed), and a genuine data refresh manufactures a NEW
// array (writes clone), so identity is a self-invalidating, fingerprint-free key. Safe
// because the mutation sweep proved nothing writes the input bars, and consumers read the
// derived entries only via .map/.filter (never mutate them), so the shared result is inert.
const signalMonitorBarEntriesMemo = new WeakMap<
  object,
  SignalMonitorPyrusBarEntry[]
>();

function barsToPyrusSignalsBarEntries(
  inputBars: Awaited<ReturnType<typeof getBars>>["bars"],
): SignalMonitorPyrusBarEntry[] {
  const memoized = signalMonitorBarEntriesMemo.get(inputBars);
  if (memoized) {
    return memoized;
  }
  const entries = inputBars
    .map((bar): SignalMonitorPyrusBarEntry | null => {
      const anchorAt = signalMonitorBarAnchorAt(bar);
      const closedAt = signalMonitorBarClosedAt(bar);
      if (!anchorAt || !closedAt) {
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
        chartBar: {
          time: Math.floor(anchorAt.getTime() / 1000),
          ts: anchorAt.toISOString(),
          o: open,
          h: high,
          l: low,
          c: close,
          v: Number.isFinite(volume) ? volume : 0,
        },
        sourceBar: bar,
        anchorAt,
        closedAt,
      };
    })
    .filter((entry): entry is SignalMonitorPyrusBarEntry => Boolean(entry))
    .sort((left, right) => left.chartBar.time - right.chartBar.time);
  signalMonitorBarEntriesMemo.set(inputBars, entries);
  return entries;
}

function stableSignalMonitorPyrusBarEntries(
  entries: SignalMonitorPyrusBarEntry[],
): SignalMonitorPyrusBarEntry[] {
  return entries.filter((entry) => entry.sourceBar.partial !== true);
}

// True when the final series bar provably closed: it carries a provider close
// stamp (dataUpdatedAt) and is not partial. filterCompletedBars already
// guarantees completedAt <= evaluatedAt for every bar it passes, so presence of
// the close stamp is the only missing proof. Passed to the engine as
// lastBarClosed so a signal on the final completed bar fires at its own bar
// close instead of one full bar later (waitForBarClose's forming-bar guard is
// for chart series where the last bar is live). Bars lacking dataUpdatedAt
// (closedAt falls back to the bar OPEN time) cannot prove closure and keep the
// conservative one-bar wait.
function signalMonitorLastBarClosed(
  chartBarEntries: SignalMonitorPyrusBarEntry[],
): boolean {
  const last = chartBarEntries.at(-1);
  if (!last) {
    return false;
  }
  return (
    last.sourceBar.partial !== true &&
    dateOrNull(last.sourceBar.dataUpdatedAt) != null
  );
}

function selectSignalMonitorPyrusBarEntries(
  entries: SignalMonitorPyrusBarEntry[],
  policy: SignalMonitorSignalStabilityPolicy = "stable-only",
): SignalMonitorPyrusBarEntry[] {
  return policy === "allow-partial-live-edge"
    ? entries
    : stableSignalMonitorPyrusBarEntries(entries);
}

function selectSignalMonitorSignalEvent(
  signalEvents: PyrusSignalsSignalEvent[],
  chartBarEntries: SignalMonitorPyrusBarEntry[],
  policy: SignalMonitorSignalStabilityPolicy = "stable-only",
): PyrusSignalsSignalEvent | null {
  for (let index = signalEvents.length - 1; index >= 0; index -= 1) {
    const signal = signalEvents[index];
    if (!signal) {
      continue;
    }
    const signalBarEntry = chartBarEntries[signal.barIndex];
    if (
      !signalBarEntry ||
      (policy === "stable-only" && signalBarEntry.sourceBar.partial === true)
    ) {
      continue;
    }
    return signal;
  }
  return null;
}

function selectStableSignalMonitorSignalEvent(
  signalEvents: PyrusSignalsSignalEvent[],
  chartBarEntries: SignalMonitorPyrusBarEntry[],
): PyrusSignalsSignalEvent | null {
  return selectSignalMonitorSignalEvent(
    signalEvents,
    chartBarEntries,
    "stable-only",
  );
}

type SignalMonitorIndicatorDirection = "bullish" | "bearish";
type SignalMonitorIndicatorStrength = "strong" | "weak";
type SignalMonitorTrendAgeBucket = "new" | "mature" | "old";
type SignalMonitorIndicatorSnapshot = {
  trendDirection: SignalMonitorIndicatorDirection | null;
  trendAgeBars: number | null;
  trendAgeBucket: SignalMonitorTrendAgeBucket | null;
  adx: number | null;
  strength: SignalMonitorIndicatorStrength | null;
  volatilityScore: number | null;
  mtf: Array<{
    timeframe: string;
    direction: SignalMonitorIndicatorDirection | null;
    required: boolean;
    pass: boolean;
  }>;
  filterState: Record<string, unknown> | null;
};

const normalizedIndicatorDirection = (
  value: unknown,
): SignalMonitorIndicatorDirection | null => {
  const numeric = Number(value);
  if (numeric === 1) return "bullish";
  if (numeric === -1) return "bearish";
  return null;
};

// String-form (already-resolved) indicator direction, e.g. as carried on a
// serialized indicatorSnapshot. Unlike normalizedIndicatorDirection this does
// not reinterpret numeric codes.
const signalMonitorIndicatorDirectionOrNull = (
  value: unknown,
): SignalMonitorIndicatorDirection | null =>
  value === "bullish" || value === "bearish" ? value : null;

const normalizedIndicatorDirectionNumber = (value: unknown): 1 | -1 | null => {
  const numeric = Number(value);
  if (numeric === 1) return 1;
  if (numeric === -1) return -1;
  return null;
};

const finiteRoundedValue = (value: unknown, digits = 1): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
};

function trendAgeBucket(
  value: number | null,
): SignalMonitorTrendAgeBucket | null {
  if (value == null) return null;
  if (value > 50) return "old";
  if (value > 20) return "mature";
  return "new";
}

function resolveTrendAgeBars(
  directions: number[],
  currentDirection: 1 | -1 | null,
): number | null {
  if (!directions.length || currentDirection == null) {
    return null;
  }
  const lastIndex = directions.length - 1;
  let flipIndex = 0;
  for (let index = lastIndex - 1; index >= 0; index -= 1) {
    const direction = normalizedIndicatorDirectionNumber(directions[index]);
    if (direction != null && direction !== currentDirection) {
      flipIndex = index + 1;
      break;
    }
  }
  return Math.max(0, lastIndex - flipIndex);
}

type SignalMonitorIndicatorSnapshotBase = Omit<
  SignalMonitorIndicatorSnapshot,
  "filterState"
>;

function computeSignalMonitorIndicatorSnapshotBase(input: {
  chartBars: PyrusSignalsBar[];
  evaluation: ReturnType<typeof evaluatePyrusSignalsSignals>;
  settings: ReturnType<typeof resolvePyrusSignalsSignalSettings>;
}): SignalMonitorIndicatorSnapshotBase | null {
  const lastBarIndex = input.chartBars.length - 1;
  if (lastBarIndex < 0) {
    return null;
  }
  const currentDirection =
    normalizedIndicatorDirectionNumber(
      input.evaluation.regimeDirection[lastBarIndex],
    ) ??
    normalizedIndicatorDirectionNumber(
      input.evaluation.trendDirection[lastBarIndex],
    );
  const trendAgeBars = resolveTrendAgeBars(
    input.evaluation.regimeDirection,
    currentDirection,
  );
  const adx = finiteRoundedValue(input.evaluation.adx[lastBarIndex]);
  const volatilityScore = finiteRoundedValue(
    input.evaluation.volatilityScore[lastBarIndex],
    0,
  );
  const mtfSettings = [
    { timeframe: input.settings.mtf1, required: input.settings.requireMtf1 },
    { timeframe: input.settings.mtf2, required: input.settings.requireMtf2 },
    { timeframe: input.settings.mtf3, required: input.settings.requireMtf3 },
  ];

  return {
    trendDirection: normalizedIndicatorDirection(currentDirection),
    trendAgeBars,
    trendAgeBucket: trendAgeBucket(trendAgeBars),
    adx,
    strength: adx == null ? null : adx >= 25 ? "strong" : "weak",
    volatilityScore,
    mtf: mtfSettings.map(({ timeframe, required }) => {
      const mtfBars = aggregatePyrusSignalsBarsForTimeframe(
        input.chartBars,
        timeframe,
      );
      const direction = normalizedIndicatorDirectionNumber(
        resolvePyrusSignalsTrendDirection(mtfBars, input.settings.basisLength),
      );
      return {
        timeframe,
        direction: normalizedIndicatorDirection(direction),
        required,
        pass:
          !required || (direction != null && direction === currentDirection),
      };
    }),
  };
}

// The indicator-snapshot BASE (trend/adx/volatility + the ×3 MTF re-aggregation)
// is a pure function of (settings, completed-bar OHLCV) — the same inputs as the
// heavy evaluation memo — so it is cached on the same (settingsSignature, symbol,
// timeframe) + completed-bars fingerprint key. Only `filterState` depends on the
// live-selected signal (which can change on partial→stable transitions even when
// the OHLCV fingerprint is unchanged), so it is attached fresh on every call and
// never cached. This removes the per-tick MTF re-aggregation from the hot loop.
function buildSignalMonitorIndicatorSnapshot(input: {
  chartBars: PyrusSignalsBar[];
  evaluation: ReturnType<typeof evaluatePyrusSignalsSignals>;
  settings: ReturnType<typeof resolvePyrusSignalsSignalSettings>;
  signal: PyrusSignalsSignalEvent | null;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
}): SignalMonitorIndicatorSnapshot | null {
  const fingerprint = fingerprintSignalMonitorMatrixCompletedBars(
    input.chartBars,
  );
  const key = [
    signalMonitorPyrusSettingsSignature(input.settings),
    input.symbol,
    input.timeframe,
  ].join("\0");
  const cached = lruCacheTouch(signalMonitorIndicatorSnapshotBaseCache, key);
  let base: SignalMonitorIndicatorSnapshotBase | null;
  if (cached && cached.fingerprint === fingerprint) {
    signalMonitorIndicatorSnapshotBaseCacheHits += 1;
    base = cached.value;
  } else {
    signalMonitorIndicatorSnapshotBaseCacheMisses += 1;
    base = computeSignalMonitorIndicatorSnapshotBase({
      chartBars: input.chartBars,
      evaluation: input.evaluation,
      settings: input.settings,
    });
    lruCacheSet(
      signalMonitorIndicatorSnapshotBaseCache,
      key,
      { fingerprint, value: base },
      SIGNAL_MONITOR_MATRIX_EVAL_CACHE_MAX,
    );
  }
  if (!base) {
    return null;
  }
  return { ...base, filterState: input.signal?.filterState ?? null };
}

function signalMonitorLatestBarStaleWindowMs(
  timeframe: SignalMonitorMatrixTimeframe,
): number {
  const timeframeMs = TIMEFRAME_MS[timeframe];
  const minimumWindowMs =
    timeframe === "1d" ? 4 * TIMEFRAME_MS["1d"] : 15 * 60_000;
  return Math.max(timeframeMs * 4, minimumWindowMs);
}

function signalMonitorEvaluationWindowMs(
  timeframe: SignalMonitorMatrixTimeframe,
): number {
  const timeframeMs = TIMEFRAME_MS[timeframe];
  const minimumWindowMs =
    timeframe === "1d" ? 4 * TIMEFRAME_MS["1d"] : 30 * 60_000;
  return Math.max(timeframeMs * 6, minimumWindowMs);
}

function isLatestBarStale(input: {
  latestBarAt: Date;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}) {
  if (isSignalMonitorLatestBarAtExpectedEdge(input)) {
    return false;
  }
  const staleWindowMs = signalMonitorLatestBarStaleWindowMs(input.timeframe);
  const referenceAt = isSignalMonitorQuietMarketSession(input.evaluatedAt)
    ? signalMonitorCompletedBarsQueryTo({
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
      })
    : input.evaluatedAt;
  return (
    referenceAt.getTime() - input.latestBarAt.getTime() > staleWindowMs
  );
}

function isSignalMonitorStateCurrentForLane(input: {
  state: Pick<
    DbSignalMonitorSymbolState,
    "latestBarAt" | "lastEvaluatedAt" | "status"
  >;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  // Closed-at of the freshest completed bar the live aggregate ring can produce
  // for this lane right now (null when the ring is empty). When the persisted
  // `latestBarAt` has frozen but Massive is still streaming current bars, this
  // rescues the lane from a false stale relabel. Read paths supply it; the
  // producer-internal trace omits it and keeps the pure stored-age semantics.
  streamLatestBarAt?: Date | null;
}) {
  if (input.state.status !== "ok") {
    return false;
  }
  const latestBarAt = dateOrNull(input.state.latestBarAt);
  const lastEvaluatedAt = dateOrNull(input.state.lastEvaluatedAt);
  if (!latestBarAt || !lastEvaluatedAt) {
    return false;
  }
  // Use the fresher of the persisted bar and the live ring's latest completed
  // bar for the age check. A current ring bar means the data feed is alive even
  // when the producer hasn't refreshed this cell, so the lane is not stale.
  const streamLatestBarAt = dateOrNull(input.streamLatestBarAt ?? null);
  const effectiveLatestBarAt =
    streamLatestBarAt && streamLatestBarAt.getTime() > latestBarAt.getTime()
      ? streamLatestBarAt
      : latestBarAt;
  if (
    isLatestBarStale({
      latestBarAt: effectiveLatestBarAt,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    })
  ) {
    return false;
  }
  if (
    isSignalMonitorQuietMarketSession(input.evaluatedAt) &&
    isSignalMonitorLatestBarAtExpectedEdge({
      latestBarAt,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    })
  ) {
    return true;
  }

  const evaluationWindowMs = signalMonitorEvaluationWindowMs(input.timeframe);
  return (
    input.evaluatedAt.getTime() - lastEvaluatedAt.getTime() <=
    evaluationWindowMs
  );
}

function traceSignalMonitorLaneCurrentness(input: {
  state: Pick<
    DbSignalMonitorSymbolState,
    "latestBarAt" | "lastEvaluatedAt" | "status"
  >;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}) {
  const latestBarAt = dateOrNull(input.state.latestBarAt);
  const lastEvaluatedAt = dateOrNull(input.state.lastEvaluatedAt);
  const quietMarket = isSignalMonitorQuietMarketSession(input.evaluatedAt);
  const completedBarsQueryTo = signalMonitorCompletedBarsQueryTo({
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
  });
  const expectedLatestBarAt = expectedLatestCompletedIntradayBarAt({
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
  });
  const staleReferenceAt = quietMarket
    ? completedBarsQueryTo
    : input.evaluatedAt;
  const latestBarStale =
    latestBarAt != null
      ? isLatestBarStale({
          latestBarAt,
          timeframe: input.timeframe,
          evaluatedAt: input.evaluatedAt,
        })
      : false;
  const current = isSignalMonitorStateCurrentForLane(input);
  let reason:
    | "current"
    | "stored_status_not_ok"
    | "missing_latest_bar"
    | "missing_last_evaluated_at"
    | "latest_bar_age_exceeds_policy_window"
    | "last_evaluated_at_age_exceeds_policy_window";
  if (current) {
    reason = "current";
  } else if (input.state.status !== "ok") {
    reason = "stored_status_not_ok";
  } else if (!latestBarAt) {
    reason = "missing_latest_bar";
  } else if (!lastEvaluatedAt) {
    reason = "missing_last_evaluated_at";
  } else if (latestBarStale) {
    reason = "latest_bar_age_exceeds_policy_window";
  } else {
    reason = "last_evaluated_at_age_exceeds_policy_window";
  }

  return {
    current,
    reason,
    quietMarket,
    completedBarsQueryTo: completedBarsQueryTo.toISOString(),
    expectedLatestBarAt: expectedLatestBarAt?.toISOString() ?? null,
    staleReferenceAt: staleReferenceAt.toISOString(),
    latestBarAgeMs:
      latestBarAt == null
        ? null
        : Math.max(0, staleReferenceAt.getTime() - latestBarAt.getTime()),
    latestBarStaleWindowMs: signalMonitorLatestBarStaleWindowMs(input.timeframe),
    lastEvaluatedAgeMs:
      lastEvaluatedAt == null
        ? null
        : Math.max(0, input.evaluatedAt.getTime() - lastEvaluatedAt.getTime()),
    lastEvaluatedWindowMs: signalMonitorEvaluationWindowMs(input.timeframe),
  };
}

function isSignalMonitorIntradayTimeframe(
  timeframe: SignalMonitorMatrixTimeframe,
) {
  return timeframe !== "1d";
}

function isSignalMonitorDelayedBar(bar: SignalMonitorBarSnapshot | undefined) {
  if (!bar) {
    return false;
  }
  const freshness = String(bar.freshness ?? "").toLowerCase();
  const marketDataMode = String(bar.marketDataMode ?? "").toLowerCase();
  return (
    bar.delayed === true ||
    freshness === "delayed" ||
    marketDataMode === "delayed"
  );
}

function isSignalMonitorIbkrBar(bar: SignalMonitorBarSnapshot | undefined) {
  const source = String(bar?.source ?? "").toLowerCase();
  return (
    source === "ibkr-history" ||
    source === "ibkr-overnight-history" ||
    source.startsWith("ibkr-")
  );
}

function filterSignalMonitorBarsForSourcePolicy(
  bars: Awaited<ReturnType<typeof getBars>>["bars"],
  policy: SignalMonitorBarSourcePolicy,
) {
  return policy === "ibkr-only" ? bars.filter(isSignalMonitorIbkrBar) : bars;
}

function shouldAllowSignalMonitorBrokerLiveEdgeRetry(
  policy: SignalMonitorBarSourcePolicy,
) {
  return policy === "ibkr-only" || !isMassiveStocksRealtimeConfigured();
}

function resolveSignalMonitorBrokerRecentWindowMinutes(input: {
  mode: "primary" | "full-retry" | "live-edge";
}): number | null {
  return input.mode === "primary"
    ? null
    : SIGNAL_MONITOR_STALE_RETRY_BROKER_WINDOW_MINUTES;
}

function isSignalMonitorDelayedLatestBar(input: {
  latestBar: SignalMonitorBarSnapshot | undefined;
  timeframe: SignalMonitorMatrixTimeframe;
}) {
  return (
    isSignalMonitorIntradayTimeframe(input.timeframe) &&
    isSignalMonitorDelayedBar(input.latestBar)
  );
}

function shouldRetrySignalMonitorCompletedBars(input: {
  completedBars: SignalMonitorBarSnapshot[];
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}) {
  const latestBar = input.completedBars.at(-1);
  const latestBarAt = signalMonitorBarClosedAt(latestBar);
  if (!latestBarAt) {
    return true;
  }
  if (
    isLatestBarStale({
      latestBarAt,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    })
  ) {
    return true;
  }
  if (
    !isSignalMonitorQuietMarketSession(input.evaluatedAt) &&
    isSignalMonitorMissingExpectedLiveEdge({
      latestBarAt,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    })
  ) {
    return true;
  }
  return isSignalMonitorDelayedLatestBar({
    latestBar,
    timeframe: input.timeframe,
  });
}

function isSignalMonitorLatestBarUnavailable(input: {
  latestBarAt: Date;
  latestBar: SignalMonitorBarSnapshot | undefined;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}) {
  return (
    isLatestBarStale({
      latestBarAt: input.latestBarAt,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    }) ||
    isSignalMonitorDelayedLatestBar({
      latestBar: input.latestBar,
      timeframe: input.timeframe,
    })
  );
}

function signalMonitorActionBlockerForStatus(
  status: SignalMonitorStatus,
): "market_idle" | "data_stale" | null {
  if (status === "ok") {
    return null;
  }
  return status === "idle" ? "market_idle" : "data_stale";
}

function signalMonitorNonCurrentStatus(input: {
  latestBarAt: Date | string | null | undefined;
  evaluatedAt: Date;
}): SignalMonitorStatus {
  if (!dateOrNull(input.latestBarAt)) {
    return "unavailable";
  }
  return isSignalMonitorMarketIdleSession(input.evaluatedAt) ? "idle" : "stale";
}

function signalMonitorLatestBarAvailabilityStatus(input: {
  stale: boolean;
  latestBarAt: Date | string | null | undefined;
  evaluatedAt: Date;
}): "ok" | "idle" | "stale" | "unavailable" {
  if (!input.stale) {
    return "ok";
  }
  return signalMonitorNonCurrentStatus({
    latestBarAt: input.latestBarAt,
    evaluatedAt: input.evaluatedAt,
  }) as "idle" | "stale" | "unavailable";
}

function directionFromSignal(
  signal: PyrusSignalsSignalEvent,
): SignalMonitorDirection {
  return signal.eventType === "buy_signal" ? "buy" : "sell";
}

function isSignalMonitorUuidLike(value: string | null | undefined): boolean {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}

function buildSignalMonitorEventKey(input: {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorTimeframe | SignalMonitorMatrixTimeframe;
  direction: SignalMonitorDirection;
  signalBarAt: Date;
}) {
  return [
    input.profileId,
    normalizeSymbol(input.symbol).toUpperCase(),
    input.timeframe,
    input.direction,
    Math.floor(input.signalBarAt.getTime() / 1000),
  ].join(":");
}

export function resolveSignalMonitorEventLookupKeys(input: {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorTimeframe | SignalMonitorMatrixTimeframe;
  direction: SignalMonitorDirection;
  signalAt: Date | string | null | undefined;
  signalBarAt?: Date | string | null;
}): string[] {
  const signalAt = dateOrNull(input.signalAt);
  const signalBarAt = dateOrNull(input.signalBarAt);
  const timeframeMs = TIMEFRAME_MS[input.timeframe] ?? 0;
  const anchors: Date[] = [];
  const seenAnchorMs = new Set<number>();

  const addAnchor = (value: Date | null) => {
    if (!value) {
      return;
    }
    const anchorMs = value.getTime();
    if (!Number.isFinite(anchorMs) || seenAnchorMs.has(anchorMs)) {
      return;
    }
    seenAnchorMs.add(anchorMs);
    anchors.push(new Date(anchorMs));
  };

  addAnchor(signalBarAt);
  if (signalAt) {
    if (input.timeframe !== "1d" && timeframeMs > 0) {
      const signalAtMs = signalAt.getTime();
      const bucketMs = Math.floor(signalAtMs / timeframeMs) * timeframeMs;
      if (signalAtMs === bucketMs) {
        addAnchor(new Date(bucketMs - timeframeMs));
      }
      addAnchor(new Date(bucketMs));
    }
    addAnchor(signalAt);
  }

  return anchors.map((signalBarAt) =>
    buildSignalMonitorEventKey({
      profileId: input.profileId,
      symbol: input.symbol,
      timeframe: input.timeframe,
      direction: input.direction,
      signalBarAt,
    }),
  );
}

async function insertSignalEvent(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  signal: PyrusSignalsSignalEvent;
  signalAt: Date;
  signalBarAt: Date;
  latestBarAt: Date;
  latestBarAnchorAt: Date;
  sourceIntegrity?: SignalMonitorSourceIntegrityDecision | null;
  emittedAt?: Date | null;
}) {
  const direction = directionFromSignal(input.signal);
  const eventKey = buildSignalMonitorEventKey({
    profileId: input.profile.id,
    symbol: input.symbol,
    timeframe: input.timeframe,
    direction,
    signalBarAt: input.signalBarAt,
  });

  const inserted = await db
    .insert(signalMonitorEventsTable)
    .values({
      profileId: input.profile.id,
      eventKey,
      environment: input.profile.environment,
      symbol: input.symbol,
      timeframe: input.timeframe,
      direction,
      signalAt: input.signalAt,
      signalPrice: numericStringOrNull(input.signal.price),
      close: numericStringOrNull(input.signal.close),
      ...(input.emittedAt ? { emittedAt: input.emittedAt } : {}),
      source: "pyrus-signals",
      payload: {
        signalId: input.signal.id,
        barIndex: input.signal.barIndex,
        signalBarAt: input.signalBarAt.toISOString(),
        latestBarAt: input.latestBarAt.toISOString(),
        latestBarAnchorAt: input.latestBarAnchorAt.toISOString(),
        sourceIntegrity: input.sourceIntegrity ?? null,
        filterState: input.signal.filterState,
      },
    })
    .onConflictDoNothing()
    .returning({ id: signalMonitorEventsTable.id });
  if (inserted.length > 0) {
    notifyAlgoCockpitChanged({
      mode: input.profile.environment,
      reason: "signal_monitor_event_created",
    });
  }
}

async function insertSignalEventBestEffort(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  signal: PyrusSignalsSignalEvent;
  signalAt: Date;
  signalBarAt: Date;
  latestBarAt: Date;
  latestBarAnchorAt: Date;
  sourceIntegrity?: SignalMonitorSourceIntegrityDecision | null;
  emittedAt?: Date | null;
}) {
  try {
    await insertSignalEvent(input);
  } catch (error) {
    const diagnostic = recordSignalMonitorDbFallback(error, {
      operation: "persist_signal_monitor_event",
      environment: input.profile.environment,
      sourceStatus: "persistence-failed",
    });
    logger.warn(
      {
        err: error,
        dbError: diagnostic.dbError,
        operation: diagnostic.operation,
        environment: diagnostic.environment,
        sourceStatus: diagnostic.sourceStatus,
        transient: diagnostic.transient,
        poolContention: diagnostic.poolContention,
        symbol: input.symbol,
        timeframe: input.timeframe,
        profileId: input.profile.id,
      },
      "Signal monitor event persistence failed",
    );
  }
}

function shouldPersistCanonicalSignalMonitorEvent(input: {
  fresh: boolean;
  barsSinceSignal: number;
  freshWindowBars?: number | null;
  signalAt: Date;
  evaluatedAt: Date;
  sourceBarPartial?: boolean;
  sourceBarTrusted?: boolean;
}) {
  const lagMs = input.evaluatedAt.getTime() - input.signalAt.getTime();
  const freshWindowBars = positiveInteger(input.freshWindowBars, 0, 0, 20);
  return (
    input.fresh &&
    Number.isFinite(input.barsSinceSignal) &&
    input.barsSinceSignal >= 0 &&
    input.barsSinceSignal <= freshWindowBars &&
    input.sourceBarPartial !== true &&
    input.sourceBarTrusted !== false &&
    lagMs >= 0
  );
}

function shouldPersistSignalMonitorStateEvent(input: {
  mode: EvaluationMode;
  fresh: boolean;
  barsSinceSignal: number;
  freshWindowBars?: number | null;
  signalAt: Date;
  evaluatedAt: Date;
  sourceBarPartial?: boolean;
  sourceBarTrusted?: boolean;
}) {
  return (
    input.mode === "incremental" &&
    shouldPersistCanonicalSignalMonitorEvent(input)
  );
}

// Latch the cached signal direction. The signal matrix is a memory: once a
// buy/sell signal is received for a cell it must stay until an opposite signal
// replaces it. A re-evaluation that found no new signal (direction null) must
// not erase the cached direction; it only refreshes freshness/bar metadata.
// A cell that has never received a signal (e.g. a brand-new ticker) stays null
// until its first signal.
function resolveLatchedSignalBarsSinceSignal(input: {
  timeframe: SignalMonitorMatrixTimeframe;
  currentSignalAt: Date | null;
  latestBarAt: Date | null;
  existingBarsSinceSignal: number | null | undefined;
  candidateBarsSinceSignal: number | null | undefined;
}): number | null {
  const presentBarsSinceSignal =
    matrixBarsSinceSignalOrNull(input.existingBarsSinceSignal) ??
    matrixBarsSinceSignalOrNull(input.candidateBarsSinceSignal);
  if (!input.currentSignalAt || !input.latestBarAt) {
    return presentBarsSinceSignal ?? null;
  }
  if (input.timeframe === "1d" && presentBarsSinceSignal == null) {
    return null;
  }
  return signalMonitorBarsSinceSignal({
    timeframe: input.timeframe,
    signalAt: input.currentSignalAt,
    latestBarAt: input.latestBarAt,
    presentBarsSinceSignal: presentBarsSinceSignal ?? 0,
  });
}

function applyStoredSignalDirectionLatch<
  V extends {
    timeframe: SignalMonitorMatrixTimeframe;
    currentSignalDirection: SignalMonitorDirection | null;
    currentSignalAt: Date | null;
    currentSignalPrice: string | null;
    currentSignalClose: string | null;
    currentSignalMfePercent: string | null;
    currentSignalMaePercent: string | null;
    filterState: unknown;
    latestBarAt: Date | null;
    barsSinceSignal: number | null;
    fresh: boolean;
  },
>(input: {
  existing: Pick<
    DbSignalMonitorSymbolState,
    | "currentSignalDirection"
    | "currentSignalAt"
    | "currentSignalPrice"
    | "currentSignalClose"
    | "currentSignalMfePercent"
    | "currentSignalMaePercent"
    | "filterState"
    | "barsSinceSignal"
  > | null;
  values: V;
}): V {
  if (input.values.currentSignalDirection) {
    // A real signal this evaluation: replace (flip on opposite, refresh on same).
    return input.values;
  }
  const existingDirection =
    input.existing?.currentSignalDirection === "buy" ||
    input.existing?.currentSignalDirection === "sell"
      ? input.existing.currentSignalDirection
      : null;
  if (!existingDirection) {
    return input.values;
  }
  const currentSignalAt =
    input.existing?.currentSignalAt ?? input.values.currentSignalAt;
  return {
    ...input.values,
    currentSignalDirection: existingDirection,
    currentSignalAt,
    currentSignalPrice:
      input.existing?.currentSignalPrice ?? input.values.currentSignalPrice,
    currentSignalClose:
      input.existing?.currentSignalClose ?? input.values.currentSignalClose,
    currentSignalMfePercent:
      input.existing?.currentSignalMfePercent ??
      input.values.currentSignalMfePercent,
    currentSignalMaePercent:
      input.existing?.currentSignalMaePercent ??
      input.values.currentSignalMaePercent,
    filterState:
      signalMonitorFilterStateOrNull(input.existing?.filterState) ??
      input.values.filterState,
    barsSinceSignal: resolveLatchedSignalBarsSinceSignal({
      timeframe: input.values.timeframe,
      currentSignalAt,
      latestBarAt: input.values.latestBarAt,
      existingBarsSinceSignal: input.existing?.barsSinceSignal,
      candidateBarsSinceSignal: input.values.barsSinceSignal,
    }),
    fresh: false,
  };
}

type SignalMonitorSymbolStateUpsertInput = {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  direction: SignalMonitorDirection | null;
  signalAt: Date | null;
  signalBarAt?: Date | null;
  signalPrice: number | null;
  signalClose?: number | null;
  signalMfePercent?: number | null;
  signalMaePercent?: number | null;
  filterState?: unknown;
  latestBarAt: Date | null;
  latestBarClose?: number | null;
  barsSinceSignal: number | null;
  fresh: boolean;
  status: SignalMonitorStatus;
  evaluatedAt: Date;
  lastError?: string | null;
  trendDirection?: string | null;
  allowStoredSignalLatch?: boolean;
};

// When the preserve rule keeps the stored row's (newer) signal identity, the
// candidate still carries fresher bar metadata (a newer completed bar). Skipping
// the whole write froze latestBarAt/lastEvaluatedAt for any cell holding a
// directional signal with no fresher crossover, so the lane stopped advancing
// even while fresh completed bars arrived every interval. Carry the candidate's
// bar metadata forward onto the preserved signal columns when, and only when, the
// candidate's bar edge genuinely advances past the stored one. Returns the merged
// insert row, or null when there is nothing fresher to write (keep the stored row
// untouched). Signal-identity columns always come from `existing`; bars-since is
// recomputed against the PRESERVED signal and the fresh bar so it stays coherent.
function mergeFreshBarMetadataOntoPreservedSignalRow(
  existing: DbSignalMonitorSymbolState,
  candidate: typeof signalMonitorSymbolStatesTable.$inferInsert,
): typeof signalMonitorSymbolStatesTable.$inferInsert | null {
  const existingLatestBarMs = dateOrNull(existing.latestBarAt)?.getTime() ?? null;
  const candidateLatestBarMs =
    dateOrNull(candidate.latestBarAt)?.getTime() ?? null;
  // Only advance on a strictly newer bar edge. Equal/older candidates have no
  // fresher bar metadata, so preserving the stored row as-is avoids no-op writes
  // and keeps the prior behavior for those cycles.
  if (
    candidateLatestBarMs == null ||
    (existingLatestBarMs != null && candidateLatestBarMs <= existingLatestBarMs)
  ) {
    return null;
  }
  const preservedSignalAt = dateOrNull(existing.currentSignalAt);
  const timeframe = resolveSignalMonitorTimeframe(existing.timeframe);
  const barsSinceSignal = resolveLatchedSignalBarsSinceSignal({
    timeframe,
    currentSignalAt: preservedSignalAt,
    latestBarAt: dateOrNull(candidate.latestBarAt),
    existingBarsSinceSignal: existing.barsSinceSignal,
    candidateBarsSinceSignal: candidate.barsSinceSignal,
  });
  return {
    ...candidate,
    // Preserve the stored row's signal identity (it outranks the candidate).
    currentSignalDirection: existing.currentSignalDirection,
    currentSignalAt: existing.currentSignalAt,
    currentSignalPrice: existing.currentSignalPrice,
    currentSignalClose: existing.currentSignalClose,
    currentSignalMfePercent: existing.currentSignalMfePercent,
    currentSignalMaePercent: existing.currentSignalMaePercent,
    filterState: existing.filterState,
    trendDirection: existing.trendDirection,
    // A preserved (older) signal is by definition not inside the fresh window.
    fresh: false,
    // Advance the bar metadata from the candidate (latestBarAt/Close, status,
    // lastEvaluatedAt, updatedAt all come through the candidate spread above).
    barsSinceSignal,
  };
}

// Resolves the read-modify portion of a symbol-state persist (event-anchored
// signalAt lookup, the stored-direction latch, and the identity/recency preserve
// rule). Returns the row to upsert, or `{ preserved }` when the stored row
// outranks the candidate and the write must be skipped. The write is left to the
// caller so the per-cycle matrix persist can collapse many rows into one bulk
// statement; per-symbol callers still write individually via `upsertSymbolState`.
async function resolveSignalMonitorSymbolStateUpsert(
  input: SignalMonitorSymbolStateUpsertInput,
  // When the caller has already batch-fetched the stored row (persist hot path),
  // it passes it here so we skip the per-cell read. Semantics are identical: the
  // same `existing` row drives the latch/preserve rules below.
  prefetched?: { existing: DbSignalMonitorSymbolState | null },
): Promise<
  | { effectiveValues: typeof signalMonitorSymbolStatesTable.$inferInsert }
  | { preserved: DbSignalMonitorSymbolState }
> {
  const currentSignalAt = await resolveStoredSignalMonitorSignalAt(input);
  const values = {
    profileId: input.profileId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    currentSignalDirection: input.direction,
    currentSignalAt,
    currentSignalPrice: numericStringOrNull(input.signalPrice),
    currentSignalClose: numericStringOrNull(input.signalClose ?? null),
    currentSignalMfePercent: numericStringOrNull(input.signalMfePercent ?? null),
    currentSignalMaePercent: numericStringOrNull(input.signalMaePercent ?? null),
    filterState: signalMonitorFilterStateOrNull(input.filterState),
    latestBarAt: input.latestBarAt,
    latestBarClose: numericStringOrNull(input.latestBarClose ?? null),
    barsSinceSignal: input.barsSinceSignal,
    fresh: input.fresh,
    status: input.status,
    active: true,
    lastEvaluatedAt: input.evaluatedAt,
    lastError: input.lastError ?? null,
    trendDirection: input.trendDirection ?? null,
    updatedAt: input.evaluatedAt,
  };
  const existing = prefetched
    ? prefetched.existing
    : await readStoredSignalMonitorSymbolState({
        profileId: input.profileId,
        symbol: input.symbol,
        timeframe: input.timeframe,
      });
  const effectiveValues = applyStoredSignalDirectionLatch({
    existing: input.allowStoredSignalLatch === false ? null : existing,
    values,
  });
  if (
    input.allowStoredSignalLatch !== false &&
    existing &&
    shouldPreserveExistingSignalMonitorSymbolState(existing, effectiveValues)
  ) {
    // The stored row outranks the candidate on signal identity (a newer real
    // signal must not be displaced by an older one), so its signal columns are
    // preserved. But bar-metadata recency is independent of signal identity:
    // discarding the whole write freezes latestBarAt/lastEvaluatedAt whenever a
    // cell holds a directional signal but no fresher crossover arrives, so the
    // lane stops advancing even though fresh completed bars exist. Carry the
    // candidate's fresher bar metadata forward onto the preserved signal row
    // when it genuinely advances the bar edge; otherwise keep the stored row
    // untouched (no-op write avoidance).
    const merged = mergeFreshBarMetadataOntoPreservedSignalRow(
      existing,
      effectiveValues,
    );
    return merged ? { effectiveValues: merged } : { preserved: existing };
  }
  return { effectiveValues };
}

// Updatable columns for the symbol-state upsert. In a multi-row bulk insert the
// `set` clause must reference each conflicting row's own incoming value via
// `excluded.<column>` (a single literal object would write the same values to
// every conflicting row); the conflict keys (profile_id, symbol, timeframe) are
// excluded from the set. This mirrors the prior per-symbol `set: effectiveValues`
// exactly: every updatable column resolves to that row's incoming value.
const signalMonitorSymbolStateUpsertSet = {
  currentSignalDirection: sql`excluded.current_signal_direction`,
  currentSignalAt: sql`excluded.current_signal_at`,
  currentSignalPrice: sql`excluded.current_signal_price`,
  currentSignalClose: sql`excluded.current_signal_close`,
  currentSignalMfePercent: sql`excluded.current_signal_mfe_percent`,
  currentSignalMaePercent: sql`excluded.current_signal_mae_percent`,
  filterState: sql`excluded.filter_state`,
  latestBarAt: sql`excluded.latest_bar_at`,
  latestBarClose: sql`excluded.latest_bar_close`,
  barsSinceSignal: sql`excluded.bars_since_signal`,
  fresh: sql`excluded.fresh`,
  status: sql`excluded.status`,
  active: sql`excluded.active`,
  lastEvaluatedAt: sql`excluded.last_evaluated_at`,
  lastError: sql`excluded.last_error`,
  trendDirection: sql`excluded.trend_direction`,
  updatedAt: sql`excluded.updated_at`,
};

async function upsertSymbolState(input: SignalMonitorSymbolStateUpsertInput) {
  const resolved = await resolveSignalMonitorSymbolStateUpsert(input);
  if ("preserved" in resolved) {
    return resolved.preserved;
  }

  const [state] = await db
    .insert(signalMonitorSymbolStatesTable)
    .values(resolved.effectiveValues)
    .onConflictDoUpdate({
      target: [
        signalMonitorSymbolStatesTable.profileId,
        signalMonitorSymbolStatesTable.symbol,
        signalMonitorSymbolStatesTable.timeframe,
      ],
      set: resolved.effectiveValues,
    })
    .returning();

  return state;
}

async function readStoredSignalMonitorSymbolState(input: {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
}): Promise<DbSignalMonitorSymbolState | null> {
  const [state] = await db
    .select()
    .from(signalMonitorSymbolStatesTable)
    .where(
      and(
        eq(signalMonitorSymbolStatesTable.profileId, input.profileId),
        eq(signalMonitorSymbolStatesTable.symbol, normalizeSymbol(input.symbol)),
        eq(signalMonitorSymbolStatesTable.timeframe, input.timeframe),
        eq(signalMonitorSymbolStatesTable.active, true),
      ),
    )
    .limit(1);
  return state ?? null;
}

// Batched sibling of readStoredSignalMonitorSymbolState: fetch the stored rows for
// many (symbol, timeframe) cells in ONE query, keyed identically to the per-row
// read's filter (normalizeSymbol(symbol) + timeframe + active=true). The persist
// hot path uses this to resolve the latch in memory instead of issuing one gated
// read per cell (~symbols x timeframes round-trips collapsed to a single query),
// which is what let 1m persistence fall minutes behind under pool saturation.
function signalMonitorSymbolStateKey(symbol: string, timeframe: string): string {
  return `${normalizeSymbol(symbol)}:${timeframe}`;
}

async function readStoredSignalMonitorSymbolStateMap(input: {
  profileId: string;
  cells: Array<{ symbol: string; timeframe: SignalMonitorMatrixTimeframe }>;
}): Promise<Map<string, DbSignalMonitorSymbolState>> {
  const map = new Map<string, DbSignalMonitorSymbolState>();
  if (!isSignalMonitorUuidLike(input.profileId) || input.cells.length === 0) {
    return map;
  }
  const symbols = Array.from(
    new Set(input.cells.map((cell) => normalizeSymbol(cell.symbol))),
  );
  const timeframes = Array.from(
    new Set(input.cells.map((cell) => cell.timeframe)),
  );
  if (!symbols.length || !timeframes.length) {
    return map;
  }
  const rows = await db
    .select()
    .from(signalMonitorSymbolStatesTable)
    .where(
      and(
        eq(signalMonitorSymbolStatesTable.profileId, input.profileId),
        inArray(signalMonitorSymbolStatesTable.symbol, symbols),
        inArray(signalMonitorSymbolStatesTable.timeframe, timeframes),
        eq(signalMonitorSymbolStatesTable.active, true),
      ),
    );
  for (const row of rows) {
    map.set(signalMonitorSymbolStateKey(row.symbol, row.timeframe), row);
  }
  return map;
}

async function resolveStoredSignalMonitorSignalAt(input: {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  direction: SignalMonitorDirection | null;
  signalAt: Date | null;
  signalBarAt?: Date | null;
}): Promise<Date | null> {
  if (
    !input.direction ||
    !input.signalAt ||
    !isSignalMonitorUuidLike(input.profileId)
  ) {
    return input.signalAt;
  }

  const eventKeys = resolveSignalMonitorEventLookupKeys({
    profileId: input.profileId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    direction: input.direction,
    signalAt: input.signalAt,
    signalBarAt: input.signalBarAt,
  });
  if (eventKeys.length === 0) {
    return input.signalAt;
  }

  const events = await db
    .select({
      eventKey: signalMonitorEventsTable.eventKey,
      signalAt: signalMonitorEventsTable.signalAt,
    })
    .from(signalMonitorEventsTable)
    .where(inArray(signalMonitorEventsTable.eventKey, eventKeys));
  const eventSignalAtByKey = new Map(
    events.map((event) => [event.eventKey, event.signalAt]),
  );
  for (const eventKey of eventKeys) {
    const signalAt = eventSignalAtByKey.get(eventKey);
    if (signalAt) {
      return signalAt;
    }
  }

  return input.signalAt;
}

export async function getLatestCompletedSignalMonitorBarAt(input: {
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  evaluatedAt: Date;
}): Promise<Date | null> {
  const completedBars = await loadSignalMonitorCompletedBars({
    ...input,
    limit: 3,
  });
  return completedBars.latestBarAt;
}

function cloneCompletedBarsSnapshot(
  snapshot: SignalMonitorCompletedBarsSnapshot,
): SignalMonitorCompletedBarsSnapshot {
  return {
    bars: [...snapshot.bars],
    latestBarAt: snapshot.latestBarAt ? new Date(snapshot.latestBarAt) : null,
  };
}

function pruneSignalMonitorCompletedBarsCache(nowMs = Date.now()): void {
  for (const [key, entry] of signalMonitorCompletedBarsCache) {
    if (entry.staleExpiresAt <= nowMs) {
      signalMonitorCompletedBarsCache.delete(key);
    }
  }
  if (
    signalMonitorCompletedBarsCache.size <=
    SIGNAL_MONITOR_COMPLETED_BARS_CACHE_MAX_ENTRIES
  ) {
    return;
  }
  const overflow =
    signalMonitorCompletedBarsCache.size -
    SIGNAL_MONITOR_COMPLETED_BARS_CACHE_MAX_ENTRIES;
  Array.from(signalMonitorCompletedBarsCache.entries())
    .sort((left, right) => left[1].cachedAt - right[1].cachedAt)
    .slice(0, overflow)
    .forEach(([key]) => signalMonitorCompletedBarsCache.delete(key));
}

function buildSignalMonitorCompletedBarsCacheKey(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  providerTimeframe: SignalMonitorMatrixTimeframe;
  providerLimit: number;
  completedLimit: number;
  queryTo: Date;
  barSourcePolicy: SignalMonitorBarSourcePolicy;
}): string {
  return JSON.stringify({
    symbol: normalizeSymbol(input.symbol),
    timeframe: input.timeframe,
    providerTimeframe: input.providerTimeframe,
    providerLimit: input.providerLimit,
    completedLimit: input.completedLimit,
    queryTo: input.queryTo.getTime(),
    assetClass: "equity",
    outsideRth: true,
    source: "trades",
    barSourcePolicy: input.barSourcePolicy,
    retryWindowMinutes: SIGNAL_MONITOR_STALE_RETRY_BROKER_WINDOW_MINUTES,
  });
}

function readSignalMonitorCompletedBarsCache(
  key: string,
  nowMs = Date.now(),
): SignalMonitorCompletedBarsSnapshot | null {
  const cached = signalMonitorCompletedBarsCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt > nowMs) {
    signalMonitorCompletedBarsCounters.hit += 1;
    // No read-side clone: the mutation sweep proved no path writes completedBars or
    // its bars, so consumers may share the cached array. This gives the array a STABLE
    // identity across the many per-cell re-evals within a bucket, which the identity
    // memo in barsToPyrusSignalsBarEntries keys on. Writes clone
    // (writeSignalMonitorCompletedBarsCache), so a genuine data refresh yields a fresh
    // array identity => automatic memo miss. Also removes a deep clone per cache hit.
    return cached.value;
  }
  if (cached.staleExpiresAt > nowMs) {
    signalMonitorCompletedBarsCounters.staleHit += 1;
    return cached.value;
  }
  signalMonitorCompletedBarsCache.delete(key);
  return null;
}

function writeSignalMonitorCompletedBarsCache(
  key: string,
  value: SignalMonitorCompletedBarsSnapshot,
  nowMs = Date.now(),
): void {
  signalMonitorCompletedBarsCache.set(key, {
    value: cloneCompletedBarsSnapshot(value),
    cachedAt: nowMs,
    expiresAt: nowMs + SIGNAL_MONITOR_COMPLETED_BARS_CACHE_TTL_MS,
    staleExpiresAt: nowMs + SIGNAL_MONITOR_COMPLETED_BARS_STALE_TTL_MS,
  });
  pruneSignalMonitorCompletedBarsCache(nowMs);
}

// Serve-side strictness (does NOT affect write-accept, which keeps its tolerant
// shouldRetrySignalMonitorCompletedBars). A fresh fetch would include every bar that has
// already closed, so if a full timeframe + the serve margin has elapsed since the cached
// snapshot's newest bar, a newer completed bar exists that the cache is missing — re-fetch
// instead of serving stale bars. Elapsed-since-latest is alignment-agnostic (correct for
// epoch-aligned 5m AND session-aligned 1h); quiet sessions close no new bars.
function isSignalMonitorCachedCompletedBarsBarBehind(input: {
  completedBars: SignalMonitorBarSnapshot[];
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}): boolean {
  if (isSignalMonitorQuietMarketSession(input.evaluatedAt)) {
    return false;
  }
  const latestBarAt = signalMonitorBarClosedAt(input.completedBars.at(-1));
  if (!latestBarAt) {
    return true;
  }
  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  return (
    input.evaluatedAt.getTime() - latestBarAt.getTime() >=
    timeframeMs + SIGNAL_MONITOR_COMPLETED_BARS_SERVE_MARGIN_MS
  );
}

function shouldBypassSignalMonitorCompletedBarsCache(input: {
  cached: SignalMonitorCompletedBarsSnapshot;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  retryStale?: boolean;
}): boolean {
  return (
    input.retryStale !== false &&
    (shouldRetrySignalMonitorCompletedBars({
      completedBars: input.cached.bars,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    }) ||
      isSignalMonitorCachedCompletedBarsBarBehind({
        completedBars: input.cached.bars,
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
      }))
  );
}

function expectedLatestCompletedIntradayBarAt(input: {
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}): Date | null {
  if (input.timeframe === "1d") {
    return null;
  }
  const queryTo = signalMonitorCompletedBarsQueryTo({
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
  });
  return queryTo;
}

function isSignalMonitorMissingExpectedLiveEdge(input: {
  latestBarAt: Date;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}) {
  const expectedLatestBarAt = expectedLatestCompletedIntradayBarAt(input);
  return Boolean(
    expectedLatestBarAt &&
      !isSignalMonitorLatestBarAtExpectedEdge({
        ...input,
        expectedLatestBarAt,
      }),
  );
}

function isSignalMonitorLatestBarAtExpectedEdge(input: {
  latestBarAt: Date;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  expectedLatestBarAt?: Date | null;
}) {
  const expectedLatestBarAt =
    input.expectedLatestBarAt ?? expectedLatestCompletedIntradayBarAt(input);
  if (!expectedLatestBarAt) {
    return false;
  }
  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  return (
    input.latestBarAt.getTime() >= expectedLatestBarAt.getTime() - timeframeMs
  );
}

export async function loadSignalMonitorCompletedBars(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  limit?: number;
  retryStale?: boolean;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
  priority?: number;
  liveEdgePriority?: number;
  includeProvisionalLiveEdge?: boolean;
  allowHistoricalFallback?: boolean;
  signal?: AbortSignal;
  // When true, this load runs even while the legacy bar-eval flag is off. Used
  // only by the server-owned producer's deep-history backfill — the producer's
  // own bar supply, not the legacy scan/on-demand evaluate paths (which stay
  // gated so scan-deprecation holds).
  bypassPassiveSourceGate?: boolean;
}): Promise<SignalMonitorCompletedBarsSnapshot> {
  throwIfSignalMonitorAborted(input.signal);
  if (!input.bypassPassiveSourceGate && !isSignalMonitorBarEvaluationEnabled()) {
    throw new HttpError(503, SIGNAL_MONITOR_PASSIVE_SIGNAL_SOURCE_MESSAGE, {
      code: "signal_monitor_passive_signal_source",
    });
  }
  const barSourcePolicy =
    input.barSourcePolicy ?? DEFAULT_SIGNAL_MONITOR_BAR_SOURCE_POLICY;
  const completedLimit = input.limit ?? PYRUS_SIGNALS_SIGNAL_WARMUP_BARS;
  if (input.includeProvisionalLiveEdge && input.timeframe !== "1d") {
    const streamBars = filterSignalMonitorBarsForSourcePolicy(
      loadSignalMonitorStreamCompletedBars({
        symbol: input.symbol,
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
        limit: Math.min(completedLimit, SIGNAL_MONITOR_STALE_RETRY_BARS),
        includeProvisional: true,
      }),
      barSourcePolicy,
    );
    if (input.retryStale !== false && streamBars.length) {
      const providerTimeframe = input.timeframe;
      const providerLimit = completedLimit;
      const queryTo = signalMonitorCompletedBarsQueryTo({
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
      });
      const timeframeMs = TIMEFRAME_MS[input.timeframe];
      for (let offset = 0; offset <= 2; offset += 1) {
        const cachedQueryTo = new Date(queryTo.getTime() - timeframeMs * offset);
        const cached = readSignalMonitorCompletedBarsCache(
          buildSignalMonitorCompletedBarsCacheKey({
            symbol: input.symbol,
            timeframe: input.timeframe,
            providerTimeframe,
            providerLimit,
            completedLimit,
            queryTo: cachedQueryTo,
            barSourcePolicy,
          }),
        );
        if (!cached?.bars.length) {
          continue;
        }
        const previousLatestAt =
          dateOrNull(cached.latestBarAt) ??
          signalMonitorBarClosedAt(cached.bars.at(-1));
        const bars = mergeCompletedBars(cached.bars, streamBars, completedLimit);
        const latestBarAt = signalMonitorBarClosedAt(bars.at(-1));
        const streamLatestBarAt = signalMonitorBarClosedAt(streamBars.at(-1));
        if (
          latestBarAt &&
          streamLatestBarAt &&
          latestBarAt.getTime() >= streamLatestBarAt.getTime() &&
          (!previousLatestAt ||
            latestBarAt.getTime() > previousLatestAt.getTime())
        ) {
          return {
            bars,
            latestBarAt,
          };
        }
      }
    }
    if (input.allowHistoricalFallback === false) {
      if (streamBars.length >= completedLimit) {
        return {
          bars: streamBars.slice(-completedLimit),
          latestBarAt: signalMonitorBarClosedAt(streamBars.at(-1)),
        };
      }
      throw new SignalMonitorLiveEdgeHistoryUnavailableError({
        symbol: input.symbol,
        timeframe: input.timeframe,
      });
    }
    const base = await loadSignalMonitorCompletedBars({
      ...input,
      includeProvisionalLiveEdge: false,
    });
    throwIfSignalMonitorAborted(input.signal);
    if (!streamBars.length) {
      return base;
    }
    const bars = mergeCompletedBars(base.bars, streamBars, completedLimit);
    return {
      bars,
      latestBarAt: signalMonitorBarClosedAt(bars.at(-1)),
    };
  }
  const providerTimeframe = input.timeframe;
  const providerLimit = completedLimit;
  const liveEdgeLimit = Math.min(
    completedLimit,
    SIGNAL_MONITOR_STALE_RETRY_BARS,
  );
  const queryTo = signalMonitorCompletedBarsQueryTo({
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
  });
  const cacheKey = buildSignalMonitorCompletedBarsCacheKey({
    symbol: input.symbol,
    timeframe: input.timeframe,
    providerTimeframe,
    providerLimit,
    completedLimit,
    queryTo,
    barSourcePolicy,
  });
  const cached = readSignalMonitorCompletedBarsCache(cacheKey);
  if (cached) {
    if (
      !shouldBypassSignalMonitorCompletedBarsCache({
        cached,
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
        retryStale: input.retryStale,
      })
    ) {
      return cached;
    }
    signalMonitorCompletedBarsCache.delete(cacheKey);
  }
  const fetchBars = (mode: "primary" | "full-retry" | "live-edge") => {
    const priority =
      mode === "live-edge"
        ? (input.liveEdgePriority ?? SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY)
        : (input.priority ?? SIGNAL_MONITOR_BARS_PRIORITY);
    return getBarsWithDebug(
      {
        symbol: input.symbol,
        timeframe: providerTimeframe,
        limit: mode === "live-edge" ? liveEdgeLimit : providerLimit,
        to: queryTo,
        assetClass: "equity",
        outsideRth: true,
        source: "trades",
        allowHistoricalSynthesis:
          barSourcePolicy === "ibkr-only" ? false : mode !== "live-edge",
        brokerRecentWindowMinutes:
          resolveSignalMonitorBrokerRecentWindowMinutes({
            mode,
          }),
      },
      {
        priority,
        family: SIGNAL_MONITOR_BARS_FAMILY,
        signal: input.signal,
      },
    );
  };
  const allowBrokerLiveEdgeRetry =
    shouldAllowSignalMonitorBrokerLiveEdgeRetry(barSourcePolicy);
  let completedBars: SignalMonitorBarSnapshot[] = [];
  const acceptNewerBars = (
    retryCompletedBars: SignalMonitorBarSnapshot[],
    merge: boolean,
  ) => {
    const currentLatestBar = completedBars.at(-1);
    const currentLatestBarAt = currentLatestBar
      ? dateOrNull(currentLatestBar.timestamp)
      : null;
    const retryLatestBar = retryCompletedBars.at(-1);
    const retryLatestBarAt = retryLatestBar
      ? dateOrNull(retryLatestBar.timestamp)
      : null;
    const retryReplacesDelayedLatest =
      currentLatestBarAt &&
      retryLatestBarAt &&
      currentLatestBarAt.getTime() === retryLatestBarAt.getTime() &&
      isSignalMonitorDelayedBar(currentLatestBar) &&
      !isSignalMonitorDelayedBar(retryLatestBar);
    const retryReplacesNonIbkrLatest =
      allowBrokerLiveEdgeRetry &&
      currentLatestBarAt &&
      retryLatestBarAt &&
      currentLatestBarAt.getTime() === retryLatestBarAt.getTime() &&
      !isSignalMonitorIbkrBar(currentLatestBar) &&
      isSignalMonitorIbkrBar(retryLatestBar);
    if (
      retryLatestBarAt &&
      (!currentLatestBarAt ||
        retryLatestBarAt.getTime() > currentLatestBarAt.getTime() ||
        retryReplacesDelayedLatest ||
        retryReplacesNonIbkrLatest)
    ) {
      completedBars = merge
        ? mergeCompletedBars(completedBars, retryCompletedBars, completedLimit)
        : retryCompletedBars;
    }
  };
  const buildCompletedBars = (
    bars: Awaited<ReturnType<typeof getBars>>["bars"],
  ) => {
    const sourceFilteredBars = filterSignalMonitorBarsForSourcePolicy(
      bars,
      barSourcePolicy,
    );
    return filterCompletedBars(
      sourceFilteredBars,
      input.timeframe,
      input.evaluatedAt,
    );
  };
  const readLocalCacheCompletedBars = async () => {
    if (barSourcePolicy === "ibkr-only") {
      return [];
    }
    const bars = await loadSignalMonitorLocalBarCache({
      symbol: input.symbol,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
      limit: completedLimit,
    });
    return buildCompletedBars(bars);
  };
  const readFreshLocalCacheSnapshot = async () => {
    const localBars = await readLocalCacheCompletedBars();
    if (!localBars.length) {
      return null;
    }
    const snapshot = {
      bars: localBars.slice(-completedLimit),
      latestBarAt: signalMonitorBarClosedAt(localBars.at(-1)),
    };
    if (
      localBars.length >= completedLimit &&
      !shouldRetrySignalMonitorCompletedBars({
        completedBars: snapshot.bars,
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
      })
    ) {
      return snapshot;
    }
    return null;
  };
  const readPreviousCacheWithLiveEdge = () => {
    if (
      input.retryStale === false ||
      input.timeframe === "1d" ||
      !isStockAggregateStreamingAvailable()
    ) {
      return null;
    }
    const streamCompletedBars = filterSignalMonitorBarsForSourcePolicy(
      loadSignalMonitorStreamCompletedBars({
        symbol: input.symbol,
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
        limit: liveEdgeLimit,
      }),
      barSourcePolicy,
    );
    if (!streamCompletedBars.length) {
      return null;
    }

    const timeframeMs = TIMEFRAME_MS[input.timeframe];
    for (let offset = 1; offset <= 2; offset += 1) {
      const previousQueryTo = new Date(queryTo.getTime() - timeframeMs * offset);
      const previousCacheKey = buildSignalMonitorCompletedBarsCacheKey({
        symbol: input.symbol,
        timeframe: input.timeframe,
        providerTimeframe,
        providerLimit,
        completedLimit,
        queryTo: previousQueryTo,
        barSourcePolicy,
      });
      const previous = readSignalMonitorCompletedBarsCache(previousCacheKey);
      if (!previous?.bars.length) {
        continue;
      }
      const previousLatestAt = previous.latestBarAt
        ? dateOrNull(previous.latestBarAt)
        : null;
      const mergedBars = mergeCompletedBars(
        previous.bars,
        streamCompletedBars,
        completedLimit,
      );
      const latestBar = mergedBars.at(-1);
      const latestBarAt = signalMonitorBarClosedAt(latestBar);
      if (
        !latestBarAt ||
        (previousLatestAt &&
          latestBarAt.getTime() <= previousLatestAt.getTime()) ||
        shouldRetrySignalMonitorCompletedBars({
          completedBars: mergedBars,
          timeframe: input.timeframe,
          evaluatedAt: input.evaluatedAt,
        })
      ) {
        continue;
      }
      const snapshot = {
        bars: mergedBars,
        latestBarAt,
      };
      writeSignalMonitorCompletedBarsCache(cacheKey, snapshot);
      return snapshot;
    }

    return null;
  };
  const fetchCompletedBars = async (
    mode: "primary" | "full-retry" | "live-edge",
  ) => {
    throwIfSignalMonitorAborted(input.signal);
    const result = buildCompletedBars((await fetchBars(mode)).bars);
    throwIfSignalMonitorAborted(input.signal);
    return result;
  };

  const liveEdgeCached = readPreviousCacheWithLiveEdge();
  if (liveEdgeCached) {
    return cloneCompletedBarsSnapshot(liveEdgeCached);
  }
  const localCacheSnapshot = await readFreshLocalCacheSnapshot();
  throwIfSignalMonitorAborted(input.signal);
  if (localCacheSnapshot) {
    writeSignalMonitorCompletedBarsCache(cacheKey, localCacheSnapshot);
    return cloneCompletedBarsSnapshot(localCacheSnapshot);
  }
  const inFlight = signalMonitorCompletedBarsInFlight.get(cacheKey);
  if (inFlight) {
    signalMonitorCompletedBarsCounters.inFlightJoin += 1;
    const snapshot = await inFlight;
    throwIfSignalMonitorAborted(input.signal);
    return cloneCompletedBarsSnapshot(snapshot);
  }
  signalMonitorCompletedBarsCounters.miss += 1;

  const request = (async () => {
    completedBars = await fetchCompletedBars("primary");
    throwIfSignalMonitorAborted(input.signal);
    let latestBar = completedBars.at(-1);
    if (
      input.retryStale !== false &&
      shouldRetrySignalMonitorCompletedBars({
        completedBars,
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
      })
    ) {
      acceptNewerBars(await fetchCompletedBars("full-retry"), false);
      throwIfSignalMonitorAborted(input.signal);
      latestBar = completedBars.at(-1);
    }
    if (
      allowBrokerLiveEdgeRetry &&
      input.retryStale !== false &&
      shouldRetrySignalMonitorCompletedBars({
        completedBars,
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
      })
    ) {
      acceptNewerBars(await fetchCompletedBars("live-edge"), true);
      throwIfSignalMonitorAborted(input.signal);
      latestBar = completedBars.at(-1);
    }
    acceptNewerBars(await readLocalCacheCompletedBars(), true);
    throwIfSignalMonitorAborted(input.signal);
    acceptNewerBars(
      filterSignalMonitorBarsForSourcePolicy(
        loadSignalMonitorStreamCompletedBars({
          symbol: input.symbol,
          timeframe: input.timeframe,
          evaluatedAt: input.evaluatedAt,
          limit: liveEdgeLimit,
        }),
        barSourcePolicy,
      ),
      true,
    );
    throwIfSignalMonitorAborted(input.signal);
    latestBar = completedBars.at(-1);
    const snapshot = {
      bars: completedBars,
      latestBarAt: signalMonitorBarClosedAt(latestBar),
    };
    writeSignalMonitorCompletedBarsCache(cacheKey, snapshot);
    return snapshot;
  })().finally(() => {
    if (signalMonitorCompletedBarsInFlight.get(cacheKey) === request) {
      signalMonitorCompletedBarsInFlight.delete(cacheKey);
    }
  });
  signalMonitorCompletedBarsInFlight.set(cacheKey, request);
  return cloneCompletedBarsSnapshot(await request);
}

export async function evaluateSignalMonitorSymbolFromCompletedBars(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  mode: EvaluationMode;
  evaluatedAt: Date;
  completedBars: SignalMonitorBarSnapshot[];
  signalStabilityPolicy?: SignalMonitorSignalStabilityPolicy;
}) {
  try {
    const signalStabilityPolicy =
      input.signalStabilityPolicy ?? "stable-only";
    const chartBarEntries = selectSignalMonitorPyrusBarEntries(
      barsToPyrusSignalsBarEntries(input.completedBars),
      signalStabilityPolicy,
    );
    const chartBars = chartBarEntries.map((entry) => entry.chartBar);
    const latestBar = chartBars.at(-1);
    const latestBarEntry = chartBarEntries.at(-1);

    if (!latestBar || !latestBarEntry) {
      return upsertSymbolState({
        profileId: input.profile.id,
        symbol: input.symbol,
        timeframe: input.timeframe,
        direction: null,
        signalAt: null,
        signalPrice: null,
        signalClose: null,
        latestBarAt: null,
        barsSinceSignal: null,
        fresh: false,
        status: "unavailable",
        evaluatedAt: input.evaluatedAt,
        lastError: "No broker history bars were available for this symbol.",
      });
    }

    const settings = resolvePyrusSignalsSignalSettings(
      asRecord(input.profile.pyrusSignalsSettings),
    );
    const evaluation = evaluatePyrusSignalsSignals({
      chartBars,
      settings,
      includeProvisionalSignals: !settings.waitForBarClose,
      lastBarClosed: signalMonitorLastBarClosed(chartBarEntries),
    });
    const signal = selectSignalMonitorSignalEvent(
      evaluation.signalEvents,
      chartBarEntries,
      signalStabilityPolicy,
    );
    const latestBarAt = latestBarEntry.closedAt;
    const latestBarAnchorAt = latestBarEntry.anchorAt;
    const latestSourceBar = latestBarEntry.sourceBar;
    const latestSourceIntegrity = resolveSignalMonitorSourceIntegrity({
      bar: latestSourceBar,
      referenceBars: input.completedBars,
    });
    const latestBarTrusted =
      isSignalMonitorLatestBarSourceIntegrityTrusted(latestSourceIntegrity);
    const delayedLatestBar = isSignalMonitorDelayedLatestBar({
      latestBar: latestSourceBar,
      timeframe: input.timeframe,
    });
    const stale = isSignalMonitorLatestBarUnavailable({
      latestBarAt,
      latestBar: latestSourceBar,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    });
    const delayedLatestBarError = delayedLatestBar
      ? "Latest signal monitor bar is delayed; waiting for live broker history."
      : null;

    if (!signal) {
      const status = latestBarTrusted
        ? signalMonitorLatestBarAvailabilityStatus({
            stale,
            latestBarAt,
            evaluatedAt: input.evaluatedAt,
          })
        : "stale";
      return upsertSymbolState({
        profileId: input.profile.id,
        symbol: input.symbol,
        timeframe: input.timeframe,
        direction: null,
        signalAt: null,
        signalPrice: null,
        signalClose: null,
        latestBarAt: latestBarTrusted ? latestBarAt : null,
        latestBarClose: latestBarTrusted
          ? numericValueOrNull(latestBar.c)
          : null,
        barsSinceSignal: null,
        fresh: false,
        status,
        evaluatedAt: input.evaluatedAt,
        lastError: delayedLatestBarError,
        allowStoredSignalLatch: latestBarTrusted,
      });
    }

    const presentBarsSinceSignal = Math.max(
      0,
      chartBars.length - 1 - signal.barIndex,
    );
    const signalBarEntry = chartBarEntries[signal.barIndex] ?? null;
    const signalBarAt = signalBarEntry?.anchorAt ?? new Date(signal.time * 1000);
    const signalAt = signalBarEntry?.closedAt ?? signalBarAt;
    const sourceBarPartial = signalBarEntry?.sourceBar.partial === true;
    const sourceIntegrity = resolveSignalMonitorSourceIntegrity({
      bar: signalBarEntry?.sourceBar,
      referenceBars: input.completedBars,
    });
    const barsSinceSignal = signalMonitorBarsSinceSignal({
      timeframe: input.timeframe,
      signalAt,
      latestBarAt,
      presentBarsSinceSignal,
    });
    const fresh = signalMonitorFresh({
      barsSinceSignal,
      freshWindowBars: input.profile.freshWindowBars,
      stale,
    });
    const direction = directionFromSignal(signal);
    const excursion = resolveSignalMonitorCurrentSignalExcursion({
      direction,
      signalClose: numericValueOrNull(signal.close),
      signalAt,
      barEntries: chartBarEntries,
    });

    if (
      shouldPersistSignalMonitorStateEvent({
        mode: input.mode,
        fresh,
        barsSinceSignal,
        freshWindowBars: input.profile.freshWindowBars,
        signalAt,
        evaluatedAt: input.evaluatedAt,
        sourceBarPartial,
        sourceBarTrusted: sourceIntegrity.trusted,
      })
    ) {
      await insertSignalEventBestEffort({
        profile: input.profile,
        symbol: input.symbol,
        timeframe: input.timeframe,
        signal,
        signalAt,
        signalBarAt,
        latestBarAt,
        latestBarAnchorAt,
        sourceIntegrity,
      });
    }

    // Staleness is reported via status only; the signal identity stays on the
    // row (and on the wire) so the latched memory is never erased by a data
    // gap. fresh is already false when stale.
    const trustedSignalIdentity = sourceIntegrity.trusted;
    const status = latestBarTrusted
      ? signalMonitorLatestBarAvailabilityStatus({
          stale,
          latestBarAt,
          evaluatedAt: input.evaluatedAt,
        })
      : "stale";
    return upsertSymbolState({
      profileId: input.profile.id,
      symbol: input.symbol,
      timeframe: input.timeframe,
      direction: trustedSignalIdentity ? direction : null,
      signalAt: trustedSignalIdentity ? signalAt : null,
      signalBarAt,
      signalPrice: trustedSignalIdentity ? signal.price : null,
      signalClose: trustedSignalIdentity ? signal.close : null,
      signalMfePercent: trustedSignalIdentity ? excursion.mfePercent : null,
      signalMaePercent: trustedSignalIdentity ? excursion.maePercent : null,
      filterState: trustedSignalIdentity
        ? signalMonitorFilterStateOrNull(signal.filterState)
        : null,
      latestBarAt: latestBarTrusted ? latestBarAt : null,
      latestBarClose: latestBarTrusted
        ? numericValueOrNull(latestBar.c)
        : null,
      barsSinceSignal: trustedSignalIdentity ? barsSinceSignal : null,
      fresh: trustedSignalIdentity ? fresh : false,
      status,
      evaluatedAt: input.evaluatedAt,
      lastError: delayedLatestBarError,
      allowStoredSignalLatch: trustedSignalIdentity,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Signal evaluation failed.";
    return upsertSymbolState({
      profileId: input.profile.id,
      symbol: input.symbol,
      timeframe: input.timeframe,
      direction: null,
      signalAt: null,
      signalPrice: null,
      signalClose: null,
      latestBarAt: null,
      barsSinceSignal: null,
      fresh: false,
      status: "error",
      evaluatedAt: input.evaluatedAt,
      lastError: message,
    });
  }
}

export async function evaluateSignalMonitorSymbol(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  mode: EvaluationMode;
  evaluatedAt: Date;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
  includeProvisionalLiveEdge?: boolean;
  allowHistoricalFallback?: boolean;
  signalStabilityPolicy?: SignalMonitorSignalStabilityPolicy;
  signal?: AbortSignal;
}) {
  try {
    throwIfSignalMonitorAborted(input.signal);
    const completedBars = await loadSignalMonitorCompletedBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
      barSourcePolicy: input.barSourcePolicy,
      includeProvisionalLiveEdge: input.includeProvisionalLiveEdge,
      allowHistoricalFallback: input.allowHistoricalFallback,
      signal: input.signal,
    });
    throwIfSignalMonitorAborted(input.signal);

    return evaluateSignalMonitorSymbolFromCompletedBars({
      ...input,
      completedBars: completedBars.bars,
      signalStabilityPolicy: input.signalStabilityPolicy,
    });
  } catch (error) {
    throwIfSignalMonitorAborted(input.signal);
    if (isSignalMonitorLiveEdgeHistoryUnavailableError(error)) {
      const currentState = await readStoredSignalMonitorSymbolState({
        profileId: input.profile.id,
        symbol: input.symbol,
        timeframe: input.timeframe,
      });
      if (currentState) {
        return currentState;
      }
    }
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Signal evaluation failed.";
    return upsertSymbolState({
      profileId: input.profile.id,
      symbol: input.symbol,
      timeframe: input.timeframe,
      direction: null,
      signalAt: null,
      signalPrice: null,
      latestBarAt: null,
      barsSinceSignal: null,
      fresh: false,
      status: "error",
      evaluatedAt: input.evaluatedAt,
      lastError: message,
    });
  }
}

// barsSinceSignal must reflect how long ago the signal fired in timeframe bars.
// The raw `chartBars.length - 1 - signal.barIndex` counts only the bars PRESENT
// in the series, which under-reports for thin/gappy intraday feeds: quiet minutes
// produce no aggregate, so a 35-minute-old 5m signal can read "1 bar" (the ADBG
// defect) while a liquid symbol with the same signal time reads the true count.
// Count trading-day (Mon–Fri) boundaries strictly after the signal's UTC day
// through the latest bar's UTC day. Daily bars only form on trading days, so
// this approximates elapsed daily bars without over-counting weekends (calendar
// elapsed / 1d would). Holidays are not subtracted — a negligible over-count
// that never flips the tight actionable age gate (barsSinceSignal <= 1) and only
// matters for large, already-stale spans. Used to age latched 1d cells whose
// persisted barsSinceSignal would otherwise stay frozen.
function tradingWeekdaysBetween(signalAt: Date, latestBarAt: Date): number {
  const startMs = signalAt.getTime();
  const endMs = latestBarAt.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }
  const dayMs = 86_400_000;
  const startDay = Math.floor(startMs / dayMs);
  const endDay = Math.floor(endMs / dayMs);
  let count = 0;
  for (let day = startDay + 1; day <= endDay; day += 1) {
    // Day index 0 (1970-01-01) is a Thursday, so (day + 4) % 7 gives 0=Sun..6=Sat.
    const weekday = (day + 4) % 7;
    if (weekday !== 0 && weekday !== 6) {
      count += 1;
    }
  }
  return count;
}

// For intraday timeframes we take the larger of the present-bar distance and the
// wall-clock interval distance, so a stale signal can never read fresher than it
// actually is (the safe direction for freshness/eligibility). 1d ages by the
// trading-weekday span above (with the present-bar count as a floor) so a latched
// daily cell can no longer freeze inside the actionable window.
function signalMonitorBarsSinceSignal(input: {
  timeframe: SignalMonitorMatrixTimeframe;
  signalAt: Date;
  latestBarAt: Date;
  presentBarsSinceSignal: number;
}): number {
  const presentBars = Math.max(0, input.presentBarsSinceSignal);
  if (input.timeframe === "1d") {
    // Age daily cells by trading-day (weekday) span, not just the persisted
    // count. The matrix latch feeds the stored barsSinceSignal back in on every
    // no-crossover re-eval, and this branch used to return it verbatim, so a
    // weeks-old daily signal stayed frozen at its original 0/1 and never left the
    // actionable age window (barsSinceSignal <= 1). Elapsed-calendar-time / 1d
    // would over-count weekends (daily bars only form on trading days), so count
    // weekdays; the stored/window count remains a floor so a genuinely fresh
    // crossover is never under-counted.
    return Math.max(
      presentBars,
      tradingWeekdaysBetween(input.signalAt, input.latestBarAt),
    );
  }
  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    return presentBars;
  }
  const elapsedMs = input.latestBarAt.getTime() - input.signalAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return presentBars;
  }
  return Math.max(presentBars, Math.round(elapsedMs / timeframeMs));
}

function resolveSignalMonitorCurrentSignalExcursion(input: {
  direction: SignalMonitorDirection | null;
  signalClose: number | null | undefined;
  signalAt: Date | null | undefined;
  barEntries: Pick<SignalMonitorPyrusBarEntry, "chartBar" | "closedAt">[];
}): { mfePercent: number | null; maePercent: number | null } {
  const signalClose = numericValueOrNull(input.signalClose);
  const signalAtMs = input.signalAt?.getTime();
  if (
    (input.direction !== "buy" && input.direction !== "sell") ||
    signalClose == null ||
    signalClose <= 0 ||
    typeof signalAtMs !== "number" ||
    !Number.isFinite(signalAtMs)
  ) {
    return { mfePercent: null, maePercent: null };
  }

  const postSignalBars = input.barEntries
    .filter((entry) => {
      const closedAtMs = entry.closedAt.getTime();
      return Number.isFinite(closedAtMs) && closedAtMs > signalAtMs;
    })
    .map((entry) => ({
      high: numericValueOrNull(entry.chartBar.h),
      low: numericValueOrNull(entry.chartBar.l),
    }))
    .filter(
      (entry): entry is { high: number; low: number } =>
        entry.high != null && entry.low != null,
    );
  if (!postSignalBars.length) {
    return { mfePercent: null, maePercent: null };
  }

  const highest = Math.max(...postSignalBars.map((entry) => entry.high));
  const lowest = Math.min(...postSignalBars.map((entry) => entry.low));
  if (input.direction === "sell") {
    return {
      mfePercent: ((signalClose - lowest) / signalClose) * 100,
      maePercent: ((signalClose - highest) / signalClose) * 100,
    };
  }
  return {
    mfePercent: ((highest - signalClose) / signalClose) * 100,
    maePercent: ((lowest - signalClose) / signalClose) * 100,
  };
}

// --- Signal-matrix heavy-evaluation memoization -----------------------------
// evaluatePyrusSignalsSignals (WMA/ATR/SMA/ADX/volatility + an O(n) structure/
// CHoCH scan over the full ~240-bar series) is the dominant CPU cost on the
// signal-matrix stream hot-path. It was being recomputed for every
// (symbol,timeframe) on every intra-minute aggregate tick AND once per connected
// subscriber, even though its output is a pure function of (resolved signal
// settings, completed bars) — it reads no clock and no mutable global, so the
// signal cannot change between bar closes. Memoize that pure result keyed by
// (settingsSignature, symbol, timeframe) with a completed-bars fingerprint:
//   - across ticks: the heavy pass now runs once per NEW completed bar instead of
//     ~10x/sec/symbol (this is what pins the loop at ~102% CPU even at idle), and
//   - within a flush: once across all same-settings subscribers instead of N×.
// The time-dependent fields (stale/fresh/status/lastEvaluatedAt/canonicalSignalEvent)
// are intentionally NOT cached — the caller recomputes them every evaluation with
// the live evaluatedAt, so staleness/age stay correct on a cache hit.
// Cache ONLY the output of evaluatePyrusSignalsSignals: it is a pure function of
// (settings, completed-bar OHLCV) and the dominant CPU cost. Signal selection and
// the indicator snapshot are deliberately NOT cached — they depend on the live
// chartBarEntries (partial/stable filtering) and are cheaply recomputed by the
// caller every evaluation, so the cache can never serve a stale signal.
type SignalMonitorMatrixHeavyEvaluation = ReturnType<
  typeof evaluatePyrusSignalsSignals
>;
// Sized to cover a 2000-symbol universe (2000 x 6 timeframes = 12000 cells) with
// headroom. Entries here are small (eval results / indicator base), so full coverage is
// cheap; the bar-holding stream cache below is kept smaller and LRU-bounded for memory.
const SIGNAL_MONITOR_MATRIX_EVAL_CACHE_MAX = 12_288;
const signalMonitorMatrixHeavyEvaluationCache = new Map<
  string,
  { fingerprint: string; value: SignalMonitorMatrixHeavyEvaluation }
>();
let signalMonitorMatrixHeavyEvaluationCacheHits = 0;
let signalMonitorMatrixHeavyEvaluationCacheMisses = 0;

// Memo for the indicator-snapshot BASE (signal-independent), keyed like the heavy
// eval on (settingsSignature, symbol, timeframe) + completed-bars fingerprint.
// Bounded by the same clear-on-overflow policy as the heavy-eval cache.
const signalMonitorIndicatorSnapshotBaseCache = new Map<
  string,
  { fingerprint: string; value: SignalMonitorIndicatorSnapshotBase | null }
>();
let signalMonitorIndicatorSnapshotBaseCacheHits = 0;
let signalMonitorIndicatorSnapshotBaseCacheMisses = 0;

// #2 upstream dirty-track. The heavy-eval memo above only guards the downstream
// indicator math, AFTER the per-(symbol,timeframe) bar aggregation+merge has
// already run every flush. That aggregation is the dominant hot-path cost, yet
// its output (the merged completedBars) is a pure function of just three inputs:
//   1. the completed-bucket boundary for the timeframe (clock-driven; advances
//      once per minute for 1m, every 5m for 5m, etc. — see signalMonitorCompletedBarsQueryTo),
//   2. the async backfilled base for the cell (signalMonitorBackfilledBaseByCell.refreshedAt),
//   3. any out-of-order aggregate that corrects an already-completed minute (revision below).
// When none changed since the last evaluation, the merged bars cannot have
// changed, so we reuse them and skip load/filter/merge. We still run the
// downstream eval every cycle, so the time-dependent staleness/age fields keep
// recomputing from the live evaluatedAt (a cache hit can never freeze staleness).
// The cache is keyed by cell (not subscriber) — the merged bars are
// subscriber-independent, so this also collapses the per-subscriber duplication.
const SIGNAL_MONITOR_STREAM_COMPLETED_BARS_CACHE_MAX = 8_000;
const signalMonitorStreamCompletedBarsCache = new Map<
  string,
  { key: string; bars: SignalMonitorBarSnapshot[] }
>();
let signalMonitorStreamCompletedBarsCacheHits = 0;
let signalMonitorStreamCompletedBarsCacheMisses = 0;

// Graceful LRU eviction for the signal-monitor working-set caches. Replaces the
// clear()-on-overflow cliff (which wiped the ENTIRE cache when it filled — forcing every
// cell to recompute at once, a periodic ELU spike) with one-at-a-time eviction of the
// least-recently-used entry. Essential once the live cell count (universe symbols x
// timeframes) exceeds a cache's max (e.g. a 2000-symbol universe = 12000 cells > 8000).
function lruCacheSet<K, V>(cache: Map<K, V>, key: K, value: V, max: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

// Mark an existing key most-recently-used so a frequently-hit but stable entry (same
// fingerprint every cycle, so never re-set) is not evicted as "oldest" while colder
// cells churn through the cache. Returns the entry (or undefined on miss).
function lruCacheTouch<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

// Per-symbol revision that bumps ONLY when an aggregate arrives out-of-order
// (startMs older than the newest seen for the symbol) — i.e. a correction to an
// already-completed minute. Forward minute advances are captured by the completed
// boundary, and forming-minute updates never change completed bars, so neither
// bumps this. Maintained from queueSignalMonitorMatrixStreamAggregate.
const signalMonitorAggregateRevisionBySymbol = new Map<
  string,
  { maxStartMs: number; revision: number }
>();
function recordSignalMonitorAggregateRevision(
  symbol: string,
  startMs: number,
): void {
  if (!Number.isFinite(startMs)) {
    return;
  }
  const entry = signalMonitorAggregateRevisionBySymbol.get(symbol);
  if (!entry) {
    signalMonitorAggregateRevisionBySymbol.set(symbol, {
      maxStartMs: startMs,
      revision: 0,
    });
  } else if (startMs > entry.maxStartMs) {
    entry.maxStartMs = startMs;
  } else if (startMs < entry.maxStartMs) {
    entry.revision += 1;
  }
}
function getSignalMonitorAggregateRevision(symbol: string): number {
  return signalMonitorAggregateRevisionBySymbol.get(symbol)?.revision ?? 0;
}
function getSignalMonitorStreamCompletedBarsCacheStats() {
  return {
    size: signalMonitorStreamCompletedBarsCache.size,
    hits: signalMonitorStreamCompletedBarsCacheHits,
    misses: signalMonitorStreamCompletedBarsCacheMisses,
  };
}

function signalMonitorPyrusSettingsSignature(
  settings: ReturnType<typeof resolvePyrusSignalsSignalSettings>,
): string {
  // Resolved settings is a small flat config object with a fixed key order, so a
  // JSON serialization is a stable, content-addressed signature: identical
  // settings (incl. content-equal profiles on different subscribers) share a
  // cache entry; any settings difference forks it.
  return JSON.stringify(settings);
}

function fingerprintSignalMonitorMatrixCompletedBars(
  chartBars: PyrusSignalsBar[],
): string {
  // Hash the whole completed-bar series so corrected historical bars cannot hit a
  // cache entry whose first/last edge still matches. This is still much cheaper
  // than the indicator/structure evaluation it guards.
  const n = chartBars.length;
  if (!n) {
    return "0";
  }
  let hash = 2166136261;
  for (const bar of chartBars) {
    const fields = [bar.time, bar.o, bar.h, bar.l, bar.c, bar.v];
    for (const field of fields) {
      const value = Number.isFinite(Number(field)) ? Number(field) : 0;
      // Fold the integer and fractional parts separately so the fingerprint is
      // lossless to 1e-8 — finer than any real OHLCV/price tick — instead of the
      // old Math.trunc(value*1000) that ignored sub-0.001 bar corrections.
      const whole = Math.trunc(value);
      const frac = Math.round((value - whole) * 1e8);
      hash = Math.imul(hash ^ (whole | 0), 16777619) >>> 0;
      hash = Math.imul(hash ^ (frac | 0), 16777619) >>> 0;
    }
  }
  return `${n}:${hash}`;
}

function evaluateSignalMonitorMatrixHeavyEvaluation(input: {
  settings: ReturnType<typeof resolvePyrusSignalsSignalSettings>;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  chartBars: PyrusSignalsBar[];
  lastBarClosed: boolean;
}): SignalMonitorMatrixHeavyEvaluation {
  // lastBarClosed is part of the evaluation's identity (it decides whether the
  // final bar's signal event exists), so it joins the fingerprint — a cached
  // result computed under one closure state can never serve the other.
  const fingerprint = `${fingerprintSignalMonitorMatrixCompletedBars(input.chartBars)}:${
    input.lastBarClosed ? "lc1" : "lc0"
  }`;
  const key = [
    signalMonitorPyrusSettingsSignature(input.settings),
    input.symbol,
    input.timeframe,
  ].join("\u0000");
  const cached = lruCacheTouch(signalMonitorMatrixHeavyEvaluationCache, key);
  if (cached && cached.fingerprint === fingerprint) {
    signalMonitorMatrixHeavyEvaluationCacheHits += 1;
    return cached.value;
  }
  signalMonitorMatrixHeavyEvaluationCacheMisses += 1;
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars: input.chartBars,
    settings: input.settings,
    includeProvisionalSignals: !input.settings.waitForBarClose,
    lastBarClosed: input.lastBarClosed,
  });
  // The live key set is (distinct settings × universe symbols × timeframes); when it
  // exceeds the max, LRU evicts the least-recently-used cell one at a time instead of
  // wiping the whole cache (which forced the entire universe to recompute at once).
  lruCacheSet(
    signalMonitorMatrixHeavyEvaluationCache,
    key,
    { fingerprint, value: evaluation },
    SIGNAL_MONITOR_MATRIX_EVAL_CACHE_MAX,
  );
  return evaluation;
}

function getSignalMonitorMatrixHeavyEvaluationCacheStats() {
  return {
    size: signalMonitorMatrixHeavyEvaluationCache.size,
    hits: signalMonitorMatrixHeavyEvaluationCacheHits,
    misses: signalMonitorMatrixHeavyEvaluationCacheMisses,
  };
}

function getSignalMonitorIndicatorSnapshotBaseCacheStats() {
  return {
    size: signalMonitorIndicatorSnapshotBaseCache.size,
    hits: signalMonitorIndicatorSnapshotBaseCacheHits,
    misses: signalMonitorIndicatorSnapshotBaseCacheMisses,
  };
}

function resetSignalMonitorMatrixHeavyEvaluationCache() {
  signalMonitorMatrixHeavyEvaluationCache.clear();
  signalMonitorMatrixHeavyEvaluationCacheHits = 0;
  signalMonitorMatrixHeavyEvaluationCacheMisses = 0;
  signalMonitorIndicatorSnapshotBaseCache.clear();
  signalMonitorIndicatorSnapshotBaseCacheHits = 0;
  signalMonitorIndicatorSnapshotBaseCacheMisses = 0;
  signalMonitorStreamCompletedBarsCache.clear();
  signalMonitorStreamCompletedBarsCacheHits = 0;
  signalMonitorStreamCompletedBarsCacheMisses = 0;
  signalMonitorAggregateRevisionBySymbol.clear();
}

export function evaluateSignalMonitorMatrixStateFromCompletedBars(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  completedBars: SignalMonitorBarSnapshot[];
}) {
  const base = {
    id: `${input.profile.id}:${input.symbol}:${input.timeframe}`,
    profileId: input.profile.id,
    symbol: input.symbol,
    timeframe: input.timeframe,
    active: true,
    lastEvaluatedAt: input.evaluatedAt,
    lastError: null as string | null,
    filterState: null as Record<string, unknown> | null,
    indicatorSnapshot: null as SignalMonitorIndicatorSnapshot | null,
    canonicalSignalEvent: null as SignalMonitorCanonicalEventCandidate | null,
    latestBarSourceIntegrity: null as SignalMonitorSourceIntegrityDecision | null,
  };
  const chartBarEntries = stableSignalMonitorPyrusBarEntries(
    barsToPyrusSignalsBarEntries(input.completedBars),
  );
  const chartBars = chartBarEntries.map((entry) => entry.chartBar);
  const latestBar = chartBars.at(-1);
  const latestBarEntry = chartBarEntries.at(-1);

  if (!latestBar || !latestBarEntry) {
    return {
      ...base,
      currentSignalDirection: null,
      currentSignalAt: null,
      currentSignalPrice: null,
      currentSignalClose: null,
      currentSignalMfePercent: null,
      currentSignalMaePercent: null,
      latestBarAt: null,
      latestBarClose: null,
      barsSinceSignal: null,
      fresh: false,
      status: "unavailable" as SignalMonitorStatus,
      lastError: "No broker history bars were available for this symbol.",
    };
  }

  const settings = resolvePyrusSignalsSignalSettings(
    asRecord(input.profile.pyrusSignalsSettings),
  );
  // Only the heavy indicator pass (evaluatePyrusSignalsSignals) is memoized — it is
  // a pure function of (settings, completed-bar OHLCV). Signal selection and the
  // snapshot are recomputed every call so they always reflect the live
  // chartBarEntries (partial/stable filtering); staleness/age below likewise
  // recompute from input.evaluatedAt, so a cache hit never serves a stale field.
  const evaluation = evaluateSignalMonitorMatrixHeavyEvaluation({
    settings,
    symbol: input.symbol,
    timeframe: input.timeframe,
    chartBars,
    lastBarClosed: signalMonitorLastBarClosed(chartBarEntries),
  });
  const signal = selectStableSignalMonitorSignalEvent(
    evaluation.signalEvents,
    chartBarEntries,
  );
  const indicatorSnapshot = buildSignalMonitorIndicatorSnapshot({
    chartBars,
    evaluation,
    settings,
    signal,
    symbol: input.symbol,
    timeframe: input.timeframe,
  });
  const latestBarAt = latestBarEntry.closedAt;
  const latestSourceBar = latestBarEntry.sourceBar;
  const latestBarSourceIntegrity = resolveSignalMonitorSourceIntegrity({
    bar: latestSourceBar,
    referenceBars: input.completedBars,
  });
  const delayedLatestBar = isSignalMonitorDelayedLatestBar({
    latestBar: latestSourceBar,
    timeframe: input.timeframe,
  });
  const stale = isSignalMonitorLatestBarUnavailable({
    latestBarAt,
    latestBar: latestSourceBar,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
  });
  const availabilityStatus = signalMonitorLatestBarAvailabilityStatus({
    stale,
    latestBarAt,
    evaluatedAt: input.evaluatedAt,
  });
  const delayedLatestBarError = delayedLatestBar
    ? "Latest signal monitor bar is delayed; waiting for live broker history."
    : null;

  if (!signal) {
    return {
      ...base,
      currentSignalDirection: null,
      currentSignalAt: null,
      currentSignalPrice: null,
      currentSignalClose: null,
      currentSignalMfePercent: null,
      currentSignalMaePercent: null,
      latestBarAt,
      latestBarClose: numericValueOrNull(latestBar.c),
      barsSinceSignal: null,
      fresh: false,
      status: availabilityStatus,
      lastError: delayedLatestBarError,
      indicatorSnapshot,
      latestBarSourceIntegrity,
    };
  }

  const presentBarsSinceSignal = Math.max(
    0,
    chartBars.length - 1 - signal.barIndex,
  );
  const signalBarEntry = chartBarEntries[signal.barIndex] ?? null;
  const signalBarAt = signalBarEntry?.anchorAt ?? new Date(signal.time * 1000);
  const signalAt = signalBarEntry?.closedAt ?? signalBarAt;
  const sourceBarPartial = signalBarEntry?.sourceBar.partial === true;
  const sourceIntegrity = resolveSignalMonitorSourceIntegrity({
    bar: signalBarEntry?.sourceBar,
    referenceBars: input.completedBars,
  });
  const direction = directionFromSignal(signal);
  const barsSinceSignal = signalMonitorBarsSinceSignal({
    timeframe: input.timeframe,
    signalAt,
    latestBarAt,
    presentBarsSinceSignal,
  });
  const excursion = resolveSignalMonitorCurrentSignalExcursion({
    direction,
    signalClose: numericValueOrNull(signal.close),
    signalAt,
    barEntries: chartBarEntries,
  });

  // Staleness is reported via status only; the signal identity stays on the
  // state so a data gap never erases the latched memory. Canonical events are
  // still only recorded for non-stale evaluations.
  return {
    ...base,
    currentSignalDirection: direction,
    currentSignalAt: signalAt,
    currentSignalPrice: signal.price,
    currentSignalClose: numericValueOrNull(signal.close),
    currentSignalMfePercent: excursion.mfePercent,
    currentSignalMaePercent: excursion.maePercent,
    latestBarAt,
    latestBarClose: numericValueOrNull(latestBar.c),
    barsSinceSignal,
    fresh: signalMonitorFresh({
      barsSinceSignal,
      freshWindowBars: input.profile.freshWindowBars,
      stale,
    }),
    status: availabilityStatus,
    lastError: delayedLatestBarError,
    filterState: signalMonitorFilterStateOrNull(signal.filterState),
    indicatorSnapshot,
    latestBarSourceIntegrity,
    canonicalSignalEvent: stale
      ? null
      : {
          signal,
          signalAt,
          signalBarAt,
          latestBarAt,
          latestBarAnchorAt: latestBarEntry.anchorAt,
          sourceBarPartial,
          sourceIntegrity,
        },
  };
}

type SignalMonitorMatrixStateResult = ReturnType<
  typeof evaluateSignalMonitorMatrixStateFromCompletedBars
>;

type SignalMonitorMatrixLoadedCell = {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  completedBars: SignalMonitorBarSnapshot[];
};

type SignalMonitorPythonMatrixSignal = {
  direction: "long" | "short";
  barIndex: number;
  time: number;
  price: number;
};

type SignalMonitorPythonMatrixState = {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  status: "ok" | "unavailable";
  signal: SignalMonitorPythonMatrixSignal | null;
  barsSinceSignal: number | null;
  fresh: boolean;
  indicatorSnapshot: SignalMonitorIndicatorSnapshot | null;
  warning: string | null;
};

function truthySignalMonitorEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

export function isSignalMonitorBarEvaluationEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return truthySignalMonitorEnv(
    env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] ??
      env["SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"],
  );
}

function readSignalMonitorPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pythonComputeEnabledForSignalMatrix(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const jobType: PythonComputeJobType = "signal_matrix";
  const laneId = routePythonComputeJobType(jobType);
  return (
    truthySignalMonitorEnv(env["PYRUS_PYTHON_SIGNAL_MATRIX_ENABLED"]) &&
    resolvePythonComputeLaneDefinitions({ env }).find(
      (definition) => definition.id === laneId,
    )?.config.enabled === true
  );
}

function signalMonitorMatrixCellKey(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
}): string {
  return `${normalizeSymbol(input.symbol).toUpperCase()}:${input.timeframe}`;
}

function normalizePythonSignalMatrixIndicatorSnapshot(
  value: unknown,
): SignalMonitorIndicatorSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const trendDirection =
    record.trendDirection === "bullish" || record.trendDirection === "bearish"
      ? record.trendDirection
      : null;
  const trendAgeBars = matrixBarsSinceSignalOrNull(record.trendAgeBars);
  const trendAgeBucket =
    record.trendAgeBucket === "new" ||
    record.trendAgeBucket === "mature" ||
    record.trendAgeBucket === "old"
      ? record.trendAgeBucket
      : null;
  const strength =
    record.strength === "strong" || record.strength === "weak"
      ? record.strength
      : null;
  const mtf: SignalMonitorIndicatorSnapshot["mtf"] = Array.isArray(record.mtf)
    ? record.mtf
        .map((entry) => {
          const mtfRecord = asRecord(entry);
          const direction: SignalMonitorIndicatorDirection | null =
            mtfRecord.direction === "bullish" || mtfRecord.direction === "bearish"
              ? mtfRecord.direction
              : null;
          return {
            timeframe: String(mtfRecord.timeframe ?? ""),
            direction,
            required: mtfRecord.required === true,
            pass: mtfRecord.pass === true,
          };
        })
        .filter((entry) => entry.timeframe)
    : [];
  return {
    trendDirection,
    trendAgeBars,
    trendAgeBucket,
    adx: finiteRoundedValue(record.adx),
    strength,
    volatilityScore: finiteRoundedValue(record.volatilityScore, 0),
    mtf,
    filterState:
      record.filterState && typeof record.filterState === "object"
        ? (record.filterState as PyrusSignalsFilterState)
        : null,
  };
}

function normalizePythonSignalMatrixState(
  value: unknown,
): SignalMonitorPythonMatrixState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const symbol = normalizeSymbol(record.symbol as string).toUpperCase();
  const timeframe = String(record.timeframe || "") as SignalMonitorMatrixTimeframe;
  if (!symbol || !SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(timeframe)) {
    return null;
  }
  const signalRecord = asRecord(record.signal);
  let signal: SignalMonitorPythonMatrixSignal | null = null;
  if (signalRecord.direction === "long" || signalRecord.direction === "short") {
    const barIndex = Number(signalRecord.barIndex);
    const time = Number(signalRecord.time);
    const price = Number(signalRecord.price);
    if (
      Number.isFinite(barIndex) &&
      Number.isFinite(time) &&
      Number.isFinite(price)
    ) {
      signal = {
        direction: signalRecord.direction,
        barIndex: Math.max(0, Math.floor(barIndex)),
        time,
        price,
      };
    }
  }
  return {
    symbol,
    timeframe,
    status: record.status === "unavailable" ? "unavailable" : "ok",
    signal,
    barsSinceSignal: matrixBarsSinceSignalOrNull(record.barsSinceSignal),
    fresh: record.fresh === true,
    indicatorSnapshot: normalizePythonSignalMatrixIndicatorSnapshot(
      record.indicatorSnapshot,
    ),
    warning: typeof record.warning === "string" ? record.warning : null,
  };
}

function signalMonitorMatrixStateFromPython(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  completedBars: SignalMonitorBarSnapshot[];
  pythonState: SignalMonitorPythonMatrixState;
}): SignalMonitorMatrixStateResult | null {
  const chartBarEntries = stableSignalMonitorPyrusBarEntries(
    barsToPyrusSignalsBarEntries(input.completedBars),
  );
  const latestBarEntry = chartBarEntries.at(-1);
  const latestBar = latestBarEntry?.chartBar ?? null;
  if (!latestBar || !latestBarEntry) {
    return null;
  }
  const latestBarAt = latestBarEntry.closedAt;
  const latestSourceBar = latestBarEntry.sourceBar;
  const latestBarSourceIntegrity = resolveSignalMonitorSourceIntegrity({
    bar: latestSourceBar,
    referenceBars: input.completedBars,
  });
  const delayedLatestBar = isSignalMonitorDelayedLatestBar({
    latestBar: latestSourceBar,
    timeframe: input.timeframe,
  });
  const stale = isSignalMonitorLatestBarUnavailable({
    latestBarAt,
    latestBar: latestSourceBar,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
  });
  const availabilityStatus = signalMonitorLatestBarAvailabilityStatus({
    stale,
    latestBarAt,
    evaluatedAt: input.evaluatedAt,
  });
  const delayedLatestBarError = delayedLatestBar
    ? "Latest signal monitor bar is delayed; waiting for live broker history."
    : null;
  const base = {
    id: `${input.profile.id}:${input.symbol}:${input.timeframe}`,
    profileId: input.profile.id,
    symbol: input.symbol,
    timeframe: input.timeframe,
    active: true,
    lastEvaluatedAt: input.evaluatedAt,
    lastError: delayedLatestBarError,
    filterState: input.pythonState.indicatorSnapshot?.filterState ?? null,
    indicatorSnapshot: input.pythonState.indicatorSnapshot,
    canonicalSignalEvent: null as SignalMonitorCanonicalEventCandidate | null,
    latestBarSourceIntegrity,
  };
  const signal = input.pythonState.signal;
  if (!signal) {
    return {
      ...base,
      currentSignalDirection: null,
      currentSignalAt: null,
      currentSignalPrice: null,
      currentSignalClose: null,
      currentSignalMfePercent: null,
      currentSignalMaePercent: null,
      latestBarAt,
      latestBarClose: numericValueOrNull(latestBar.c),
      barsSinceSignal: null,
      fresh: false,
      status: availabilityStatus,
    };
  }
  const signalBarEntry = chartBarEntries[signal.barIndex] ?? null;
  if (!signalBarEntry) {
    return null;
  }
  const signalBarAt = signalBarEntry.anchorAt ?? new Date(signal.time * 1000);
  const signalAt = signalBarEntry.closedAt ?? signalBarAt;
  const sourceIntegrity = resolveSignalMonitorSourceIntegrity({
    bar: signalBarEntry.sourceBar,
    referenceBars: input.completedBars,
  });
  const eventType =
    signal.direction === "long" ? "buy_signal" : "sell_signal";
  const presentBarsSinceSignal = Math.max(
    0,
    chartBarEntries.length - 1 - signal.barIndex,
  );
  const elapsedBarsSinceSignal = signalMonitorBarsSinceSignal({
    timeframe: input.timeframe,
    signalAt,
    latestBarAt,
    presentBarsSinceSignal,
  });
  const pythonBarsSinceSignal = input.pythonState.barsSinceSignal;
  const barsSinceSignal =
    pythonBarsSinceSignal == null
      ? elapsedBarsSinceSignal
      : Math.max(elapsedBarsSinceSignal, pythonBarsSinceSignal);
  const pyrusSignalEvent: PyrusSignalsSignalEvent = {
    id: [
      "python-matrix",
      input.profile.id,
      input.symbol,
      input.timeframe,
      eventType,
      signalBarAt.getTime(),
    ].join(":"),
    eventType,
    direction: signal.direction,
    barIndex: signal.barIndex,
    time: Math.floor(signalBarAt.getTime() / 1000),
    ts: signalBarAt.toISOString(),
    price: signal.price,
    close: signalBarEntry.chartBar.c,
    actionable: true,
    filtered: false,
    filterState:
      (input.pythonState.indicatorSnapshot?.filterState ??
        {}) as PyrusSignalsFilterState,
  };
  const direction = directionFromSignal(pyrusSignalEvent);
  const excursion = resolveSignalMonitorCurrentSignalExcursion({
    direction,
    signalClose: numericValueOrNull(signalBarEntry.chartBar.c),
    signalAt,
    barEntries: chartBarEntries,
  });
  return {
    ...base,
    currentSignalDirection: direction,
    currentSignalAt: signalAt,
    currentSignalPrice: signal.price,
    currentSignalClose: numericValueOrNull(signalBarEntry.chartBar.c),
    currentSignalMfePercent: excursion.mfePercent,
    currentSignalMaePercent: excursion.maePercent,
    latestBarAt,
    latestBarClose: numericValueOrNull(latestBar.c),
    barsSinceSignal,
    fresh: signalMonitorFresh({
      barsSinceSignal,
      freshWindowBars: input.profile.freshWindowBars,
      stale,
    }),
    status: availabilityStatus,
    canonicalSignalEvent: stale
      ? null
      : {
          signal: pyrusSignalEvent,
          signalAt,
          signalBarAt,
          latestBarAt,
          latestBarAnchorAt: latestBarEntry.anchorAt,
          sourceBarPartial: signalBarEntry.sourceBar.partial === true,
          sourceIntegrity,
        },
  };
}

async function resolveSignalMonitorMatrixPythonStates(input: {
  profile: DbSignalMonitorProfile;
  evaluatedAt: Date;
  cells: SignalMonitorMatrixLoadedCell[];
  runJob?: typeof runPythonComputeJob;
}): Promise<Map<string, SignalMonitorMatrixStateResult>> {
  if (!input.cells.length || !pythonComputeEnabledForSignalMatrix()) {
    return new Map();
  }
  const settings = resolvePyrusSignalsSignalSettings(
    asRecord(input.profile.pyrusSignalsSettings),
  );
  const cells = input.cells
    .map((cell) => {
      const entries = stableSignalMonitorPyrusBarEntries(
        barsToPyrusSignalsBarEntries(cell.completedBars),
      );
      if (!entries.length) {
        return null;
      }
      return {
        symbol: cell.symbol,
        timeframe: cell.timeframe,
        freshWindowBars: input.profile.freshWindowBars,
        settings,
        bars: entries.map((entry) => entry.chartBar),
      };
    })
    .filter((cell): cell is NonNullable<typeof cell> => Boolean(cell));
  if (!cells.length) {
    return new Map();
  }
  const timeoutMs = readSignalMonitorPositiveInteger(
    process.env["PYRUS_PYTHON_SIGNAL_MATRIX_TIMEOUT_MS"],
    2_500,
  );
  let result: PythonComputeJobResult;
  try {
    result = await (input.runJob ?? runPythonComputeJob)(
      {
        jobType: "signal_matrix",
        input: {
          evaluatedAt: input.evaluatedAt.toISOString(),
          cells,
        },
        options: { timeoutMs },
      },
      {
        timeoutMs,
        pollIntervalMs: 75,
      },
    );
  } catch (error) {
    logger.debug({ err: error }, "Signal monitor Python matrix job unavailable");
    return new Map();
  }
  if (result.status !== "completed" || !result.result) {
    return new Map();
  }
  const rawStates = Array.isArray(result.result.states)
    ? result.result.states
    : [];
  const pythonStateByKey = new Map<string, SignalMonitorPythonMatrixState>();
  rawStates.forEach((rawState) => {
    const state = normalizePythonSignalMatrixState(rawState);
    if (state) {
      pythonStateByKey.set(signalMonitorMatrixCellKey(state), state);
    }
  });
  const resolved = new Map<string, SignalMonitorMatrixStateResult>();
  input.cells.forEach((cell) => {
    const pythonState = pythonStateByKey.get(signalMonitorMatrixCellKey(cell));
    if (!pythonState) {
      return;
    }
    const state = signalMonitorMatrixStateFromPython({
      profile: input.profile,
      symbol: cell.symbol,
      timeframe: cell.timeframe,
      evaluatedAt: input.evaluatedAt,
      completedBars: cell.completedBars,
      pythonState,
    });
    if (state) {
      resolved.set(signalMonitorMatrixCellKey(cell), state);
    }
  });
  return resolved;
}

function matrixBarsSinceSignalOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
}

function signalMonitorStoredStateActivityMs(input: {
  currentSignalAt?: Date | string | null;
  latestBarAt?: Date | string | null;
}): number {
  return Math.max(
    dateOrNull(input.currentSignalAt)?.getTime() ?? 0,
    dateOrNull(input.latestBarAt)?.getTime() ?? 0,
  );
}

function signalMonitorStoredStateSignalMs(input: {
  currentSignalAt?: Date | string | null;
  currentSignalDirection?: string | null;
}): number {
  if (
    input.currentSignalDirection !== "buy" &&
    input.currentSignalDirection !== "sell"
  ) {
    return 0;
  }
  return dateOrNull(input.currentSignalAt)?.getTime() ?? 0;
}

function signalMonitorStoredStateQuality(input: {
  currentSignalAt?: Date | string | null;
  currentSignalDirection?: string | null;
  status?: string | null;
}): number {
  const status = String(input.status || "unknown").trim().toLowerCase();
  const statusScore =
    status === "ok"
      ? 4
      : status === "idle"
        ? 3
      : status === "stale"
        ? 3
        : status === "unavailable"
          ? 2
          : 1;
  const signalScore =
    input.currentSignalDirection === "buy" ||
    input.currentSignalDirection === "sell" ||
    dateOrNull(input.currentSignalAt)
      ? 1
      : 0;
  return statusScore + signalScore;
}

function shouldPreserveExistingSignalMonitorSymbolState(
  existing: {
    currentSignalAt?: Date | string | null;
    currentSignalDirection?: string | null;
    latestBarAt?: Date | string | null;
    status?: string | null;
  } | null,
  incoming: {
    currentSignalAt?: Date | string | null;
    currentSignalDirection?: string | null;
    latestBarAt?: Date | string | null;
    status?: string | null;
  },
): boolean {
  if (!existing) {
    return false;
  }
  // Signal identity outranks bar-metadata recency: a row carrying a newer real
  // signal must never lose to a row whose only claim is a newer latestBarAt
  // (and an older signal must never displace a newer one). Activity recency
  // only breaks ties between rows with the same signal identity.
  const existingSignalMs = signalMonitorStoredStateSignalMs(existing);
  const incomingSignalMs = signalMonitorStoredStateSignalMs(incoming);
  if (existingSignalMs !== incomingSignalMs) {
    return existingSignalMs > incomingSignalMs;
  }
  const existingActivityMs = signalMonitorStoredStateActivityMs(existing);
  const incomingActivityMs = signalMonitorStoredStateActivityMs(incoming);
  if (existingActivityMs > incomingActivityMs) {
    return true;
  }
  if (existingActivityMs < incomingActivityMs) {
    return false;
  }
  return (
    signalMonitorStoredStateQuality(existing) >
    signalMonitorStoredStateQuality(incoming)
  );
}

function shouldPersistSignalMonitorMatrixState(
  state: SignalMonitorMatrixStateResult,
): boolean {
  const symbol = normalizeSymbol(state.symbol);
  const timeframe = String(state.timeframe || "") as SignalMonitorMatrixTimeframe;
  const status = String(state.status || "ok").trim().toLowerCase();
  return Boolean(
    symbol &&
      SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(timeframe) &&
      state.active !== false &&
      (status === "ok" || status === "idle" || status === "stale") &&
      !state.lastError &&
      (dateOrNull(state.latestBarAt) || dateOrNull(state.currentSignalAt)),
  );
}

function isSignalMonitorStateSignalIdentityTrusted(
  state: SignalMonitorMatrixStateResult,
): boolean {
  return state.canonicalSignalEvent?.sourceIntegrity.trusted !== false;
}

function isSignalMonitorLatestBarSourceIntegrityTrusted(
  integrity: SignalMonitorSourceIntegrityDecision | null | undefined,
): boolean {
  if (!integrity) {
    return true;
  }
  // A missing non-live reference means the latest live edge cannot be trusted to
  // author a canonical signal identity, but the bar's own timestamp/close still
  // reflects the freshest market-data point we have for display/currentness.
  return integrity.trusted !== false || integrity.reason === "missing-reference";
}

function isSignalMonitorStateLatestBarTrusted(
  state: SignalMonitorMatrixStateResult,
): boolean {
  return isSignalMonitorLatestBarSourceIntegrityTrusted(
    state.latestBarSourceIntegrity,
  );
}

async function persistSignalMonitorMatrixStateEventBestEffort(input: {
  profile: DbSignalMonitorProfile;
  state: SignalMonitorMatrixStateResult;
  evaluatedAt: Date;
  seenEventKeys: Set<string>;
}) {
  const candidate = input.state.canonicalSignalEvent;
  if (!candidate) {
    return;
  }
  const barsSinceSignal = matrixBarsSinceSignalOrNull(
    input.state.barsSinceSignal,
  );
  if (barsSinceSignal == null) {
    return;
  }
  if (
    !shouldPersistCanonicalSignalMonitorEvent({
      fresh: input.state.fresh === true,
      barsSinceSignal,
      freshWindowBars: input.profile.freshWindowBars,
      signalAt: candidate.signalAt,
      evaluatedAt: input.evaluatedAt,
      sourceBarPartial: candidate.sourceBarPartial,
      sourceBarTrusted: candidate.sourceIntegrity.trusted,
    })
  ) {
    return;
  }
  const eventKey = buildSignalMonitorEventKey({
    profileId: input.profile.id,
    symbol: input.state.symbol,
    timeframe: input.state.timeframe,
    direction: directionFromSignal(candidate.signal),
    signalBarAt: candidate.signalBarAt,
  });
  if (input.seenEventKeys.has(eventKey)) {
    return;
  }
  input.seenEventKeys.add(eventKey);
  await insertSignalEventBestEffort({
    profile: input.profile,
    symbol: normalizeSymbol(input.state.symbol).toUpperCase(),
    timeframe: input.state.timeframe,
    signal: candidate.signal,
    signalAt: candidate.signalAt,
    signalBarAt: candidate.signalBarAt,
    latestBarAt: candidate.latestBarAt,
    latestBarAnchorAt: candidate.latestBarAnchorAt,
    sourceIntegrity: candidate.sourceIntegrity,
  });
}

async function persistSignalMonitorMatrixStatesBestEffort(input: {
  profile: DbSignalMonitorProfile;
  states: SignalMonitorMatrixStateResult[];
  evaluatedAt: Date;
}) {
  if (!isSignalMonitorUuidLike(input.profile.id)) {
    return;
  }
  const states = input.states.filter((state) =>
    shouldPersistSignalMonitorMatrixState(state),
  );
  if (!states.length) {
    return;
  }

  try {
    const concurrency = Math.min(
      SIGNAL_MONITOR_EVALUATION_CONCURRENCY_LIMIT,
      Math.max(1, input.profile.evaluationConcurrency || 1),
    );
    const seenEventKeys = new Set<string>();
    // Latest effective row per (symbol, timeframe). The reads and per-row latch/
    // preserve decisions still run per symbol (bounded by `concurrency`), but the
    // INSERTs are collapsed into a single bulk upsert below instead of one
    // pool round-trip per symbol - the write storm this path used to emit.
    const upsertRows = new Map<
      string,
      typeof signalMonitorSymbolStatesTable.$inferInsert
    >();
    // Batch-fetch every cell's stored row in ONE query up front, so the latch
    // below resolves in memory instead of one gated per-cell read. This is the
    // fix for 1m persistence falling minutes behind under pool saturation.
    const existingStateByKey = await readStoredSignalMonitorSymbolStateMap({
      profileId: input.profile.id,
      cells: states.map((state) => ({
        symbol: normalizeSymbol(state.symbol).toUpperCase(),
        timeframe: state.timeframe,
      })),
    });
    for (let index = 0; index < states.length; index += concurrency) {
      const batch = states.slice(index, index + concurrency);
      await Promise.all(
        batch.map((state) =>
          runSignalMonitorBackgroundDbRead(async () => {
          const normalizedStatus = String(state.status || "ok")
            .trim()
            .toLowerCase();
          const status =
            normalizedStatus === "idle" || normalizedStatus === "stale"
              ? normalizedStatus
              : "ok";
          // Signal identity persists regardless of status; staleness only
          // gates freshness. The upsert latch and identity-ranked preserve
          // rule guard against regressions.
          const signalIdentityTrusted =
            isSignalMonitorStateSignalIdentityTrusted(state);
          const latestBarTrusted = isSignalMonitorStateLatestBarTrusted(state);
          const direction =
            signalIdentityTrusted &&
            (state.currentSignalDirection === "buy" ||
              state.currentSignalDirection === "sell")
              ? state.currentSignalDirection
              : null;
          const signalAt = direction ? dateOrNull(state.currentSignalAt) : null;
          const resolved = await resolveSignalMonitorSymbolStateUpsert({
            profileId: input.profile.id,
            symbol: normalizeSymbol(state.symbol).toUpperCase(),
            timeframe: state.timeframe,
            direction,
            signalAt,
            signalPrice: direction
              ? numericValueOrNull(state.currentSignalPrice)
              : null,
            signalClose: direction
              ? numericValueOrNull(state.currentSignalClose)
              : null,
            signalMfePercent: direction
              ? numericValueOrNull(state.currentSignalMfePercent)
              : null,
            signalMaePercent: direction
              ? numericValueOrNull(state.currentSignalMaePercent)
              : null,
            filterState: direction
              ? signalMonitorFilterStateOrNull(
                  state.filterState ??
                    asRecord(state.indicatorSnapshot).filterState,
                )
              : null,
            latestBarAt: latestBarTrusted ? dateOrNull(state.latestBarAt) : null,
            latestBarClose: latestBarTrusted
              ? numericValueOrNull(state.latestBarClose)
              : null,
            barsSinceSignal: direction
              ? matrixBarsSinceSignalOrNull(state.barsSinceSignal)
              : null,
            fresh: latestBarTrusted && status === "ok" && Boolean(state.fresh),
            status: latestBarTrusted ? status : "stale",
            evaluatedAt: dateOrNull(state.lastEvaluatedAt) ?? input.evaluatedAt,
            lastError: null,
            // Persist the always-defined current trend so the bootstrap can show
            // a buy/sell direction on load; rides with the crossover, not actionable.
            trendDirection: state.indicatorSnapshot?.trendDirection ?? null,
            allowStoredSignalLatch: signalIdentityTrusted,
          }, {
            existing:
              existingStateByKey.get(
                signalMonitorSymbolStateKey(
                  normalizeSymbol(state.symbol).toUpperCase(),
                  state.timeframe,
                ),
              ) ?? null,
          });
          if ("effectiveValues" in resolved) {
            // Last write wins on a duplicate (symbol, timeframe), matching the
            // prior per-symbol serialization and avoiding a duplicate conflict
            // target within one bulk INSERT ... ON CONFLICT statement.
            upsertRows.set(
              `${resolved.effectiveValues.symbol}:${resolved.effectiveValues.timeframe}`,
              resolved.effectiveValues,
            );
          }
          await persistSignalMonitorMatrixStateEventBestEffort({
            profile: input.profile,
            state,
            evaluatedAt: dateOrNull(state.lastEvaluatedAt) ?? input.evaluatedAt,
            seenEventKeys,
          });
          }),
        ),
      );
    }

    const rows = Array.from(upsertRows.values());
    // Postgres caps bind parameters per statement at 65535 (Int16). A full-universe
    // upsert (up to ~12000 rows at 2000 symbols x 6 timeframes, ~18 columns each = >200k
    // params) far exceeds that and THROWS — silently, via the best-effort catch below —
    // so signal_monitor_symbol_states would stop persisting entirely at scale (bootstrap /
    // STA / breadth silently go stale). Chunk into param-bounded slices; 1000 rows keeps
    // even a wide row well under 65535 and stays within the 12-conn pool (awaited serially).
    for (
      let offset = 0;
      offset < rows.length;
      offset += SIGNAL_MONITOR_STATE_UPSERT_MAX_ROWS
    ) {
      await db
        .insert(signalMonitorSymbolStatesTable)
        .values(rows.slice(offset, offset + SIGNAL_MONITOR_STATE_UPSERT_MAX_ROWS))
        .onConflictDoUpdate({
          target: [
            signalMonitorSymbolStatesTable.profileId,
            signalMonitorSymbolStatesTable.symbol,
            signalMonitorSymbolStatesTable.timeframe,
          ],
          set: signalMonitorSymbolStateUpsertSet,
        });
    }
    if (rows.length) {
      bustSignalMonitorStateRowsCache();
    }
  } catch (error) {
    const diagnostic = recordSignalMonitorDbFallback(error, {
      operation: "persist_signal_monitor_matrix_states",
      environment: input.profile.environment,
      sourceStatus: "persistence-failed",
    });
    logger.warn(
      {
        err: error,
        dbError: diagnostic.dbError,
        operation: diagnostic.operation,
        environment: diagnostic.environment,
        sourceStatus: diagnostic.sourceStatus,
        transient: diagnostic.transient,
        poolContention: diagnostic.poolContention,
        profileId: input.profile.id,
        stateCount: states.length,
      },
      "Signal monitor matrix state persistence failed",
    );
  }
}

// Coalescing single-flight for state persistence. The 150ms stream-flush delta
// and the request/runtime-driven full-matrix persist both fire un-awaited; under
// load they stacked, each holding up to `evaluationConcurrency` of the
// hard-capped 12 DB connections and cascading into pool-acquire timeouts that
// surface as flapping "degraded"/error reads in the UI. This caps persistence to
// ONE in-flight run per profile: concurrent requests merge into a pending set
// (latest state per symbol/timeframe wins) that drains after the in-flight run
// completes. Persistence stays best-effort and idempotent — coalescing only
// delays durability slightly and the live stream is unaffected.
const signalMonitorPersistInFlight = new Set<string>();
const signalMonitorPersistPending = new Map<
  string,
  {
    profile: DbSignalMonitorProfile;
    states: Map<string, SignalMonitorMatrixStateResult>;
    evaluatedAt: Date;
  }
>();

function schedulePersistSignalMonitorMatrixStatesBestEffort(input: {
  profile: DbSignalMonitorProfile;
  states: SignalMonitorMatrixStateResult[];
  evaluatedAt: Date;
}) {
  const key = input.profile.id;
  const merged = signalMonitorPersistPending.get(key) ?? {
    profile: input.profile,
    states: new Map<string, SignalMonitorMatrixStateResult>(),
    evaluatedAt: input.evaluatedAt,
  };
  for (const state of input.states) {
    merged.states.set(
      `${state.symbol}${SIGNAL_MONITOR_CELL_KEY_SEPARATOR}${state.timeframe}`,
      state,
    );
  }
  merged.profile = input.profile;
  merged.evaluatedAt = input.evaluatedAt;
  signalMonitorPersistPending.set(key, merged);

  if (signalMonitorPersistInFlight.has(key)) {
    return;
  }
  signalMonitorPersistInFlight.add(key);
  void (async () => {
    try {
      let next = signalMonitorPersistPending.get(key);
      while (next) {
        signalMonitorPersistPending.delete(key);
        await persistSignalMonitorMatrixStatesBestEffort({
          profile: next.profile,
          states: Array.from(next.states.values()),
          evaluatedAt: next.evaluatedAt,
        });
        next = signalMonitorPersistPending.get(key);
      }
    } finally {
      signalMonitorPersistInFlight.delete(key);
    }
  })();
}

function buildSignalMonitorMatrixErrorState(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  error: unknown;
}): SignalMonitorMatrixStateResult {
  const message =
    input.error instanceof Error && input.error.message
      ? input.error.message
      : "Signal evaluation failed.";
  return {
    id: `${input.profile.id}:${input.symbol}:${input.timeframe}`,
    profileId: input.profile.id,
    symbol: input.symbol,
    timeframe: input.timeframe,
    currentSignalDirection: null,
    currentSignalAt: null,
    currentSignalPrice: null,
    currentSignalClose: null,
    currentSignalMfePercent: null,
    currentSignalMaePercent: null,
    latestBarAt: null,
    latestBarClose: null,
    barsSinceSignal: null,
    fresh: false,
    status: "error" as SignalMonitorStatus,
    active: true,
    lastEvaluatedAt: input.evaluatedAt,
    lastError: message,
    filterState: null,
    indicatorSnapshot: null,
    canonicalSignalEvent: null,
    latestBarSourceIntegrity: null,
  };
}

function evaluateSignalMonitorMatrixStateFromStreamBars(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}): SignalMonitorMatrixStateResult | null {
  // #2 upstream dirty-track (see signalMonitorStreamCompletedBarsCache above):
  // the merged completedBars are a pure function of the completed-bucket boundary,
  // the backfilled base refresh, and any out-of-order completed-minute correction.
  // Skip the load/filter/merge when none changed; ALWAYS run the downstream eval
  // so staleness/age recompute from the live evaluatedAt.
  const cellKey = signalMonitorBackfillCellKey(input.symbol, input.timeframe);
  const baseEntry = signalMonitorBackfilledBaseByCell.get(cellKey);
  const dirtyKey = `${signalMonitorCompletedBarsQueryTo({
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
  }).getTime()}:${baseEntry?.refreshedAt ?? 0}:${getSignalMonitorAggregateRevision(
    input.symbol,
  )}`;
  let completedBars: SignalMonitorBarSnapshot[];
  const cachedCell = lruCacheTouch(signalMonitorStreamCompletedBarsCache, cellKey);
  if (cachedCell && cachedCell.key === dirtyKey) {
    signalMonitorStreamCompletedBarsCacheHits += 1;
    completedBars = cachedCell.bars;
  } else {
    signalMonitorStreamCompletedBarsCacheMisses += 1;
    const streamBars = loadSignalMonitorStreamCompletedBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
      limit: SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
    });
    // The live stream ring is only a few minutes deep — too short for the pyrus
    // indicator to warm up on the aggregated frames. Merge the asynchronously
    // backfilled base (deep stored/provider history) under the live edge so the
    // indicator evaluates a full current series. mergeCompletedBars lets the live
    // edge win on same-timestamp collisions; an empty base preserves the prior
    // live-only behavior. This is also what lets 1d evaluate on this path, since
    // loadSignalMonitorStreamCompletedBars returns [] for 1d.
    const baseBars = baseEntry?.bars ?? [];
    const trustedStreamBars = baseBars.length
      ? filterSignalMonitorLiveEdgeBarsForTrustedMove({
          symbol: input.symbol,
          timeframe: input.timeframe,
          baseBars,
          liveEdgeBars: streamBars,
        })
      : streamBars;
    const mergedBars = baseBars.length
      ? mergeCompletedBars(baseBars, trustedStreamBars, SIGNAL_MONITOR_MATRIX_BARS_LIMIT)
      : trustedStreamBars;
    // Single slice (mergeCompletedBars already applies the limit, but the
    // empty-base branch does not) so the cached array is the exact series the
    // eval consumes — also removes the prior double-slice on the hot path.
    completedBars = mergedBars.slice(-SIGNAL_MONITOR_MATRIX_BARS_LIMIT);
    lruCacheSet(
      signalMonitorStreamCompletedBarsCache,
      cellKey,
      { key: dirtyKey, bars: completedBars },
      SIGNAL_MONITOR_STREAM_COMPLETED_BARS_CACHE_MAX,
    );
  }
  if (!completedBars.length) {
    return null;
  }
  return evaluateSignalMonitorMatrixStateFromCompletedBars({
    profile: input.profile,
    symbol: input.symbol,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
    completedBars,
  });
}

function isFreshSignalMonitorMatrixStreamState(
  state:
    | Pick<
        SignalMonitorMatrixStateResult,
        "status" | "fresh" | "currentSignalDirection" | "currentSignalAt"
      >
    | null
    | undefined,
): state is SignalMonitorMatrixStateResult {
  return Boolean(
    state &&
      state.status === "ok" &&
      state.fresh &&
      (state.currentSignalDirection === "buy" ||
        state.currentSignalDirection === "sell") &&
      state.currentSignalAt,
  );
}

type SignalMonitorMatrixStreamEvaluateState = (input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}) => SignalMonitorMatrixStateResult | null;

function signalMonitorMatrixStreamLastEventAgeMs(nowMs = Date.now()) {
  return signalMonitorMatrixStreamLastAggregateAt
    ? Math.max(0, nowMs - signalMonitorMatrixStreamLastAggregateAt.getTime())
    : null;
}

function signalMonitorMatrixStreamSourceFromDiagnostics(
  value: unknown,
): SignalMonitorMatrixStreamSource {
  if (
    value === "massive-websocket" ||
    value === "massive-delayed-websocket" ||
    value === "ibkr-websocket-derived"
  ) {
    return value;
  }
  return "none";
}

function signalMonitorMatrixStreamTimeframesForSymbol(
  scope: SignalMonitorMatrixStreamScope,
  symbol: string,
): SignalMonitorMatrixTimeframe[] {
  const normalizedSymbol = normalizeSymbol(symbol).toUpperCase();
  if (!normalizedSymbol || !scope.symbols.includes(normalizedSymbol)) {
    return [];
  }
  if (!scope.exactCells) {
    return scope.timeframes;
  }
  return scope.cells
    .filter((cell) => cell.symbol === normalizedSymbol)
    .map((cell) => cell.timeframe);
}

function signalMonitorMatrixStreamCellCount(
  scope: SignalMonitorMatrixStreamScope,
) {
  return scope.exactCells
    ? scope.cells.length
    : scope.symbols.length * scope.timeframes.length;
}

function signalMonitorMatrixStreamStateKey(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
}) {
  return `${normalizeSymbol(input.symbol).toUpperCase()}:${input.timeframe}`;
}

function signalMonitorMatrixStreamStateSignature(
  state: SignalMonitorMatrixStreamState,
) {
  return JSON.stringify({
    symbol: normalizeSymbol(state.symbol).toUpperCase(),
    timeframe: state.timeframe,
    currentSignalDirection: state.currentSignalDirection ?? null,
    currentSignalAt: dateOrNull(state.currentSignalAt)?.toISOString() ?? null,
    currentSignalPrice: state.currentSignalPrice ?? null,
    currentSignalClose: state.currentSignalClose ?? null,
    latestBarClose: state.latestBarClose ?? null,
    currentSignalMfePercent: state.currentSignalMfePercent ?? null,
    currentSignalMaePercent: state.currentSignalMaePercent ?? null,
    filterState:
      signalMonitorFilterStateOrNull(
        state.filterState ?? asRecord(state.indicatorSnapshot).filterState,
      ) ?? null,
    latestBarAt: dateOrNull(state.latestBarAt)?.toISOString() ?? null,
    barsSinceSignal: state.barsSinceSignal ?? null,
    fresh: Boolean(state.fresh),
    status: state.status,
    lastError: state.lastError ?? null,
    actionEligible: state.actionEligible ?? null,
    actionBlocker: state.actionBlocker ?? null,
  });
}

function withSignalMonitorMatrixStreamActionability<
  T extends SignalMonitorMatrixStreamState,
>(state: T, profile: { freshWindowBars: number }): T {
  const actionability = buildSignalMonitorActionability({
    direction: state.currentSignalDirection,
    signalAt: state.currentSignalAt,
    barsSinceSignal: state.barsSinceSignal,
    stale: state.status !== "ok",
    staleBlocker: signalMonitorActionBlockerForStatus(state.status),
    freshWindowBars: profile.freshWindowBars,
  });
  // fresh stays as authored by the eval/latch path: a latched refresh is
  // deliberately not fresh even when its bar age is inside the fresh window.
  return {
    ...state,
    trendDirection:
      state.trendDirection ??
      signalMonitorIndicatorDirectionOrNull(
        asRecord(state.indicatorSnapshot).trendDirection,
      ),
    actionEligible: actionability.actionEligible,
    actionBlocker: actionability.actionBlocker,
  } as T;
}

// Wire-side variant of applyStoredSignalDirectionLatch for stream emission
// (evaluation-result shape, number prices). Same semantics: a directionless
// re-evaluation must not erase a latched buy/sell on the stream any more than
// it may in the DB.
function latchSignalMonitorMatrixStreamState(
  existing: SignalMonitorMatrixStreamState | null,
  state: SignalMonitorMatrixStateResult,
): SignalMonitorMatrixStateResult {
  const existingDirection =
    existing?.currentSignalDirection === "buy" ||
    existing?.currentSignalDirection === "sell"
      ? existing.currentSignalDirection
      : null;
  const existingSignalAt = dateOrNull(existing?.currentSignalAt);
  const incomingDirection =
    state.currentSignalDirection === "buy" ||
    state.currentSignalDirection === "sell"
      ? state.currentSignalDirection
      : null;
  const incomingSignalAt = dateOrNull(state.currentSignalAt);
  if (
    incomingDirection &&
    (!existingDirection ||
      !existingSignalAt ||
      (incomingSignalAt &&
        incomingSignalAt.getTime() >= existingSignalAt.getTime()))
  ) {
    return state;
  }
  if (!existingDirection) {
    return state;
  }
  const currentSignalAt = existingSignalAt ?? incomingSignalAt;
  return {
    ...state,
    currentSignalDirection: existingDirection,
    currentSignalAt,
    currentSignalPrice:
      existing?.currentSignalPrice ?? state.currentSignalPrice,
    currentSignalClose:
      existing?.currentSignalClose ?? state.currentSignalClose,
    currentSignalMfePercent:
      existing?.currentSignalMfePercent ?? state.currentSignalMfePercent,
    currentSignalMaePercent:
      existing?.currentSignalMaePercent ?? state.currentSignalMaePercent,
    filterState:
      signalMonitorFilterStateOrNull(
        existing?.filterState ?? asRecord(existing?.indicatorSnapshot).filterState,
      ) ??
      signalMonitorFilterStateOrNull(
        state.filterState ?? asRecord(state.indicatorSnapshot).filterState,
      ),
    barsSinceSignal: resolveLatchedSignalBarsSinceSignal({
      timeframe: state.timeframe,
      currentSignalAt,
      latestBarAt: state.latestBarAt,
      existingBarsSinceSignal: existing?.barsSinceSignal,
      candidateBarsSinceSignal: state.barsSinceSignal,
    }),
    fresh: false,
    // The eval-result union has no branch for "latched identity on a
    // directionless evaluation"; the merged shape is structurally valid.
  } as SignalMonitorMatrixStateResult;
}

function recordSignalMonitorMatrixStreamSnapshot(
  subscriber: SignalMonitorMatrixStreamSubscriber,
  states: SignalMonitorMatrixStreamState[],
) {
  states.forEach((state) => {
    const key = signalMonitorMatrixStreamStateKey(state);
    subscriber.lastStateSignatures.set(
      key,
      signalMonitorMatrixStreamStateSignature(state),
    );
    subscriber.lastStates.set(key, state);
  });
}

function changedSignalMonitorMatrixStreamStates<
  T extends SignalMonitorMatrixStreamState,
>(
  subscriber: SignalMonitorMatrixStreamSubscriber,
  states: T[],
) {
  return states.filter((state) => {
    const key = signalMonitorMatrixStreamStateKey(state);
    const signature = signalMonitorMatrixStreamStateSignature(state);
    if (subscriber.lastStateSignatures.get(key) === signature) {
      return false;
    }
    subscriber.lastStateSignatures.set(key, signature);
    subscriber.lastStates.set(key, state);
    return true;
  });
}

function signalMonitorMatrixStreamActiveScope() {
  const symbols = new Set<string>();
  let cells = 0;
  signalMonitorMatrixStreamSubscribers.forEach((subscriber) => {
    subscriber.scope.symbols.forEach((symbol) => symbols.add(symbol));
    cells += signalMonitorMatrixStreamCellCount(subscriber.scope);
  });
  return {
    symbols: symbols.size,
    cells,
  };
}

export function getSignalMonitorMatrixStreamStatus(
  scope?: SignalMonitorMatrixStreamScope,
): SignalMonitorMatrixStreamStatusEvent {
  // The server-owned producer generates matrix signals independent of the
  // legacy bar-eval flag (its deep-history backfill is producer-driven, not the
  // legacy scan), so stream availability must reflect the real stock-aggregate
  // stream — NOT isSignalMonitorBarEvaluationEnabled() — otherwise the header
  // reports "unavailable" while signals are actually flowing.
  const diagnostics = getStockAggregateStreamDiagnostics();
  const diagnosticSource = signalMonitorMatrixStreamSourceFromDiagnostics(
    diagnostics.provider,
  );
  const source = diagnosticSource;
  const activeProvider = diagnostics.activeProvider
    ? signalMonitorMatrixStreamSourceFromDiagnostics(diagnostics.activeProvider)
    : null;
  const activeScope = scope
    ? {
        symbols: scope.symbols.length,
        cells: signalMonitorMatrixStreamCellCount(scope),
      }
    : signalMonitorMatrixStreamActiveScope();
  const available = source !== "none" && isStockAggregateStreamingAvailable();
  const streaming = Boolean(diagnostics.quoteSubscriptionActive);
  const state = available ? "open" : "unavailable";
  const sourceState: SignalMonitorMatrixStreamSourceState = !available
    ? "unavailable"
    : streaming
      ? "streaming"
      : "bootstrap";

  return {
    stream: "signal-matrix",
    event: "stream-status",
    state,
    source,
    provider: source,
    activeProvider,
    delayed:
      source === "massive-delayed-websocket" ||
      activeProvider === "massive-delayed-websocket",
    activeScopeSymbols: activeScope.symbols,
    activeScopeCells: activeScope.cells,
    skippedSymbols: scope?.skippedSymbols.length ?? 0,
    truncated: Boolean(scope?.truncated),
    eventCount: signalMonitorMatrixStreamAggregateEventCount,
    lastEventAt: signalMonitorMatrixStreamLastAggregateAt?.toISOString() ?? null,
    lastEventAgeMs: signalMonitorMatrixStreamLastEventAgeMs(),
    sourceState,
  };
}

export function buildSignalMonitorMatrixStreamCoverage(input: {
  scope: SignalMonitorMatrixStreamScope;
  states: SignalMonitorMatrixStreamState[];
}): SignalMonitorMatrixStreamCoverage {
  const status = getSignalMonitorMatrixStreamStatus(input.scope);
  return {
    requestedSymbols: input.scope.requestedSymbolCount,
    activeScopeSymbols: input.scope.symbols.length,
    timeframes: input.scope.timeframes.length,
    taskCount: signalMonitorMatrixStreamCellCount(input.scope),
    source: status.source,
    delayed: status.delayed,
    eventCount: status.eventCount,
    stateCount: input.states.length,
    skippedSymbols: input.scope.skippedSymbols.length,
    truncated: input.scope.truncated,
    lastEventAt: status.lastEventAt,
    lastEventAgeMs: status.lastEventAgeMs,
  };
}

export function buildSignalMonitorMatrixStreamBootstrapEvent(
  response: {
    profile: ReturnType<typeof profileToResponse>;
    states: SignalMonitorMatrixStreamState[];
    evaluatedAt: Date;
    timeframes: SignalMonitorMatrixTimeframe[];
  },
  scope: SignalMonitorMatrixStreamScope,
): SignalMonitorMatrixStreamBootstrapEvent {
  return {
    stream: "signal-matrix",
    event: "bootstrap",
    profile: response.profile,
    states: response.states,
    evaluatedAt: response.evaluatedAt,
    timeframes: response.timeframes,
    coverage: buildSignalMonitorMatrixStreamCoverage({
      scope,
      states: response.states,
    }),
  };
}

export function buildSignalMonitorMatrixStreamBootstrapEventFromStoredState(
  snapshot: {
    profile: ReturnType<typeof profileToResponse>;
    states: ReturnType<typeof stateToResponseForSnapshot>[];
    evaluatedAt: Date | string;
    stateSource?: SignalMonitorStateSource;
  },
  scope: SignalMonitorMatrixStreamScope,
): SignalMonitorMatrixStreamBootstrapEvent {
  if (snapshot.stateSource === "runtime-fallback") {
    return buildSignalMonitorMatrixStreamBootstrapEvent(
      {
        profile: snapshot.profile,
        states: [],
        evaluatedAt: dateOrNull(snapshot.evaluatedAt) ?? new Date(),
        timeframes: scope.timeframes,
      },
      scope,
    );
  }

  const hydrated = hydrateSignalMonitorMatrixStatesFromStoredStates(
    {
      states: [] as SignalMonitorMatrixStateResult[],
      timeframes: scope.timeframes,
    },
    {
      storedStates: snapshot.states,
      requestedSymbols: scope.symbols,
      requestedCells: scope.exactCells ? scope.cells : undefined,
    },
  );

  return buildSignalMonitorMatrixStreamBootstrapEvent(
    {
      profile: snapshot.profile,
      states: hydrated.states.map((state) =>
        withSignalMonitorMatrixStreamActionability(state, snapshot.profile),
      ),
      evaluatedAt: dateOrNull(snapshot.evaluatedAt) ?? new Date(),
      timeframes: scope.timeframes,
    },
    scope,
  );
}

// SSE bootstrap snapshot single-flight. Every matrix stream subscriber needs
// the same environment-wide stored-state snapshot (scope filtering happens in
// memory in buildSignalMonitorMatrixStreamBootstrapEventFromStoredState), but
// each connection used to run its own full-universe read (~12k rows at the
// 2000-symbol cap). At boot, connections arrive back-to-back — the initial
// connect plus the timeframe-widen re-key, multiplied by tabs — so duplicate
// reads queued on the saturated 12-connection pool and could trip the 15s DB
// statement timeout (observed as a 500 on the stream). Sharing one read per
// environment for a short TTL collapses that. Staleness is safe: the client
// merges per cell by authority/freshness (preferSignalMatrixCellState), so a
// snapshot up to TTL old can never displace fresher stream deltas.
//
// 30s, not 15s: the widen re-key fires 1.5s after the client finishes
// receiving bootstrap frames, and under boot congestion frame delivery alone
// takes ~20s+ (measured snapshot-build -> re-key gap: 23-27s). A 15s TTL
// expired right before the re-key and the reopen re-ran the full read at the
// congestion peak; 30s covers the measured gap with margin.
export const SIGNAL_MONITOR_MATRIX_BOOTSTRAP_SNAPSHOT_TTL_MS = 30_000;

type SignalMonitorStreamBootstrapSnapshot = Awaited<
  ReturnType<typeof getSignalMonitorStoredState>
>;

export const createSignalMonitorStreamBootstrapSnapshotReader = ({
  read,
  ttlMs = SIGNAL_MONITOR_MATRIX_BOOTSTRAP_SNAPSHOT_TTL_MS,
  now = () => Date.now(),
}: {
  read: (
    environment?: RuntimeMode,
  ) => Promise<SignalMonitorStreamBootstrapSnapshot>;
  ttlMs?: number;
  now?: () => number;
}) => {
  const cache = new Map<
    string,
    { snapshot: SignalMonitorStreamBootstrapSnapshot; expiresAtMs: number }
  >();
  const inFlight = new Map<
    string,
    Promise<SignalMonitorStreamBootstrapSnapshot>
  >();
  return async (environment?: RuntimeMode) => {
    const key = resolveEnvironment(environment);
    const cached = cache.get(key);
    if (cached && cached.expiresAtMs > now()) {
      return cached.snapshot;
    }
    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }
    const compute = read(environment)
      .then((snapshot) => {
        // Never cache degraded fallback snapshots: a transient DB blip must
        // not pin empty bootstraps on every reconnect for a full TTL.
        if (snapshot.stateSource !== "runtime-fallback") {
          cache.set(key, { snapshot, expiresAtMs: now() + ttlMs });
        }
        return snapshot;
      })
      .finally(() => {
        if (inFlight.get(key) === compute) {
          inFlight.delete(key);
        }
      });
    inFlight.set(key, compute);
    return compute;
  };
};

const readSignalMonitorStreamBootstrapSnapshot =
  createSignalMonitorStreamBootstrapSnapshotReader({
    read: (environment) =>
      getSignalMonitorStoredState({
        environment,
        markNonCurrentStale: true,
      }),
  });

export async function buildSignalMonitorMatrixStreamStoredBootstrapEvent(
  scope: SignalMonitorMatrixStreamScope,
): Promise<SignalMonitorMatrixStreamBootstrapEvent> {
  const snapshot = await readSignalMonitorStreamBootstrapSnapshot(
    scope.environment,
  );
  return buildSignalMonitorMatrixStreamBootstrapEventFromStoredState(
    snapshot,
    scope,
  );
}

function buildSignalMonitorMatrixStreamDeltaEvent(input: {
  scope: SignalMonitorMatrixStreamScope;
  states: SignalMonitorMatrixStreamState[];
  evaluatedAt: Date;
}): SignalMonitorMatrixStreamStateDeltaEvent {
  return {
    stream: "signal-matrix",
    event: "state-delta",
    states: input.states,
    evaluatedAt: input.evaluatedAt,
    timeframes: Array.from(
      new Set(input.states.map((state) => state.timeframe)),
    ).sort(
      (left, right) =>
        SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(left) -
        SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(right),
    ),
    coverage: buildSignalMonitorMatrixStreamCoverage({
      scope: input.scope,
      states: input.states,
    }),
  };
}

function emitSignalMonitorMatrixStreamError(input: {
  subscriber: SignalMonitorMatrixStreamSubscriber;
  code: string;
  detail: string;
  cooldownMs?: number | null;
}) {
  void input.subscriber.onEvent({
    stream: "signal-matrix",
    event: "error",
    code: input.code,
    detail: input.detail,
    cooldownMs: input.cooldownMs ?? null,
  });
}

export function evaluateSignalMonitorMatrixStreamScopeDelta(input: {
  scope: SignalMonitorMatrixStreamScope;
  profile: DbSignalMonitorProfile;
  symbol: string;
  evaluatedAt: Date;
  evaluateState?: SignalMonitorMatrixStreamEvaluateState;
}): SignalMonitorMatrixStateResult[] {
  const symbol = normalizeSymbol(input.symbol).toUpperCase();
  const timeframes = signalMonitorMatrixStreamTimeframesForSymbol(
    input.scope,
    symbol,
  );
  if (!symbol || !timeframes.length) {
    return [];
  }

  const evaluateState =
    input.evaluateState ?? evaluateSignalMonitorMatrixStateFromStreamBars;
  return timeframes
    .map((timeframe) =>
      evaluateState({
        profile: input.profile,
        symbol,
        timeframe,
        evaluatedAt: input.evaluatedAt,
      }),
    )
    .filter((state): state is SignalMonitorMatrixStateResult =>
      Boolean(state),
    );
}

export function emitSignalMonitorMatrixStreamAggregateDelta(input: {
  message: Pick<StockMinuteAggregateMessage, "symbol">;
  environment?: RuntimeMode;
  evaluatedAt?: Date;
  evaluateState?: SignalMonitorMatrixStreamEvaluateState;
}) {
  const symbol = normalizeSymbol(input.message.symbol).toUpperCase();
  if (!symbol || !signalMonitorMatrixStreamSubscribers.size) {
    return;
  }
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const persistByProfile = new Map<
    string,
    { profile: DbSignalMonitorProfile; states: SignalMonitorMatrixStateResult[] }
  >();

  for (const subscriber of signalMonitorMatrixStreamSubscribers.values()) {
    if (
      input.environment &&
      subscriber.scope.environment !== input.environment
    ) {
      continue;
    }
    let states: SignalMonitorMatrixStateResult[];
    try {
      states = evaluateSignalMonitorMatrixStreamScopeDelta({
        scope: subscriber.scope,
        profile: subscriber.profile,
        symbol,
        evaluatedAt,
        evaluateState: input.evaluateState,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Signal Matrix stream evaluation failed.";
      logger.warn(
        { err: error, symbol, subscriberId: subscriber.id },
        "Signal Matrix stream evaluation failed",
      );
      emitSignalMonitorMatrixStreamError({
        subscriber,
        code: "signal_monitor_matrix_stream_evaluation_failed",
        detail: message,
      });
      continue;
    }
    if (!states.length) {
      continue;
    }
    const latchedStates = states.map((state) =>
      withSignalMonitorMatrixStreamActionability(
        latchSignalMonitorMatrixStreamState(
          subscriber.lastStates.get(
            signalMonitorMatrixStreamStateKey(state),
          ) ?? null,
          state,
        ),
        subscriber.profile,
      ),
    );
    const changedStates = changedSignalMonitorMatrixStreamStates(
      subscriber,
      latchedStates,
    );
    if (!changedStates.length) {
      continue;
    }

    if (isSignalMonitorUuidLike(subscriber.profile.id)) {
      const persisted = persistByProfile.get(subscriber.profile.id) ?? {
        profile: subscriber.profile,
        states: [],
      };
      persisted.states.push(...changedStates);
      persistByProfile.set(subscriber.profile.id, persisted);
    }
    void subscriber.onEvent(
      buildSignalMonitorMatrixStreamDeltaEvent({
        scope: subscriber.scope,
        states: changedStates,
        evaluatedAt,
      }),
    );
  }

  persistByProfile.forEach((entry) => {
    schedulePersistSignalMonitorMatrixStatesBestEffort({
      profile: entry.profile,
      states: entry.states,
      evaluatedAt,
    });
  });
}

// Signal evaluation is synchronous CPU work; many symbols evaluated back-to-back
// block the single event loop and starve HTTP. These helpers chunk the work and
// yield the loop between chunks so requests interleave instead of queueing behind
// one long burst.
const SIGNAL_MONITOR_EVAL_YIELD_EVERY = 8;

function yieldSignalMonitorEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function flushSignalMonitorMatrixStreamAggregates(): Promise<void> {
  if (signalMonitorMatrixStreamFlushInFlight) {
    return;
  }
  const pending = new Map<RuntimeMode, Set<string>>();
  pendingSignalMonitorMatrixStreamSymbolsByEnvironment.forEach(
    (symbols, environment) => {
      pending.set(environment, new Set(symbols));
    },
  );
  pendingSignalMonitorMatrixStreamSymbolsByEnvironment.clear();
  if (!pending.size) {
    return;
  }

  signalMonitorMatrixStreamFlushInFlight = true;
  try {
    const evaluatedAt = new Date();
    // Bar closes arrive for the whole universe on the same minute boundary, so a
    // single flush can evaluate hundreds of symbols. Yield every few symbols so
    // the event loop stays responsive instead of blocking for the whole burst.
    let sinceYield = 0;
    for (const [environment, symbols] of pending) {
      for (const symbol of symbols) {
        emitSignalMonitorMatrixStreamAggregateDelta({
          message: {
            symbol,
          },
          environment,
          evaluatedAt,
        });
        sinceYield += 1;
        if (sinceYield >= SIGNAL_MONITOR_EVAL_YIELD_EVERY) {
          sinceYield = 0;
          await yieldSignalMonitorEventLoop();
        }
      }
    }
  } finally {
    signalMonitorMatrixStreamFlushInFlight = false;
    if (pendingSignalMonitorMatrixStreamSymbolsByEnvironment.size) {
      scheduleSignalMonitorMatrixStreamFlush();
    }
  }
}

function scheduleSignalMonitorMatrixStreamFlush() {
  if (signalMonitorMatrixStreamFlushTimer) {
    return;
  }
  signalMonitorMatrixStreamFlushTimer = setTimeout(() => {
    signalMonitorMatrixStreamFlushTimer = null;
    void flushSignalMonitorMatrixStreamAggregates();
  }, SIGNAL_MONITOR_MATRIX_STREAM_FLUSH_MS);
  signalMonitorMatrixStreamFlushTimer.unref?.();
}

function queueSignalMonitorMatrixStreamAggregate(
  message: StockMinuteAggregateMessage,
) {
  const symbol = normalizeSymbol(message.symbol).toUpperCase();
  if (!symbol || !signalMonitorMatrixStreamSubscribers.size) {
    return;
  }

  signalMonitorMatrixStreamAggregateEventCount += 1;
  signalMonitorMatrixStreamLastAggregateAt = new Date();
  // Feed the #2 dirty-track: only out-of-order corrections to already-completed
  // minutes bump the revision (forward minute advances are caught by the completed
  // boundary; forming-minute updates never change completed bars).
  recordSignalMonitorAggregateRevision(symbol, Number(message.startMs));
  for (const subscriber of signalMonitorMatrixStreamSubscribers.values()) {
    if (
      subscriber.scope.symbols.includes(symbol) &&
      signalMonitorMatrixStreamTimeframesForSymbol(subscriber.scope, symbol)
        .length
    ) {
      const pending =
        pendingSignalMonitorMatrixStreamSymbolsByEnvironment.get(
          subscriber.scope.environment,
        ) ?? new Set<string>();
      pending.add(symbol);
      pendingSignalMonitorMatrixStreamSymbolsByEnvironment.set(
        subscriber.scope.environment,
        pending,
      );
    }
  }
  scheduleSignalMonitorMatrixStreamFlush();
}

async function resolveSignalMonitorMatrixStreamProfile(
  environment: RuntimeMode,
): Promise<DbSignalMonitorProfile> {
  try {
    return await getOrCreateProfile(environment);
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error, {
        operation: "resolve_signal_monitor_matrix_stream_profile",
        environment,
      });
      return getRuntimeSignalMonitorProfile(environment);
    }
    throw error;
  }
}

function refreshSignalMonitorMatrixStockAggregateStreamScope() {
  if (!signalMonitorMatrixStockAggregateSubscription) {
    return;
  }
  const symbols = signalMonitorMatrixStockAggregateSymbols([]);
  if (symbols.length) {
    signalMonitorMatrixStockAggregateSubscription.setSymbols(symbols);
  }
}

function createSignalMonitorMatrixStreamSubscriptionForTests(input: {
  scope: SignalMonitorMatrixStreamScope;
  profile: DbSignalMonitorProfile;
  onEvent: (event: SignalMonitorMatrixStreamEvent) => void | Promise<void>;
  prime?: boolean;
}): SignalMonitorMatrixStreamSubscription {
  const subscriberId = nextSignalMonitorMatrixStreamSubscriberId;
  nextSignalMonitorMatrixStreamSubscriberId += 1;
  const subscriber: SignalMonitorMatrixStreamSubscriber = {
    id: subscriberId,
    scope: input.scope,
    profile: input.profile,
    onEvent: input.onEvent,
    lastStateSignatures: new Map(),
    lastStates: new Map(),
  };
  signalMonitorMatrixStreamSubscribers.set(subscriberId, subscriber);
  if (input.prime !== false) {
    primeSignalMonitorMatrixStockAggregateStream(input.scope.symbols);
  }

  return {
    scope: input.scope,
    profile: profileToResponse(input.profile),
    recordSnapshot(states: SignalMonitorMatrixStreamState[]) {
      recordSignalMonitorMatrixStreamSnapshot(subscriber, states);
    },
    unsubscribe() {
      signalMonitorMatrixStreamSubscribers.delete(subscriberId);
      refreshSignalMonitorMatrixStockAggregateStreamScope();
    },
  };
}

// ---------------------------------------------------------------------------
// Server-owned signal-matrix producer
//
// The live matrix producer (evaluate Massive bar-close ticks -> persist
// canonical signalMonitorEventsTable rows) historically only ran while a UI SSE
// client was connected: emit/queue bail when there are no subscribers and the
// eval+persist loop is keyed on subscriber scopes, so the STA table went stale
// whenever no browser was open (the keystone gap).
//
// This registers a server-owned synthetic subscriber per enabled profile whose
// scope is the profile's (capped) universe and whose onEvent is a no-op. The
// existing loop then evaluates + persists on every bar-close with no UI client,
// while real client deltas still only push to real subscribers. A keepalive
// interval re-resolves the universe and re-primes the Massive subscription so it
// is not dropped by the idle keepalive release timer. Gated on aggregate
// streaming availability; when streaming is unavailable the legacy REST/flag
// path still covers signal refresh.
// ---------------------------------------------------------------------------
const SIGNAL_MONITOR_SERVER_OWNED_PRODUCER_REFRESH_MS = 60_000;
const signalMonitorServerOwnedProducers = new Map<
  RuntimeMode,
  { subscription: SignalMonitorMatrixStreamSubscription; symbolKey: string }
>();
let signalMonitorServerOwnedProducerTimer: ReturnType<typeof setInterval> | null =
  null;
let signalMonitorServerOwnedProducerStarted = false;
let signalMonitorServerOwnedProducerRefreshInFlight = false;

function buildSignalMonitorServerOwnedProducerScope(input: {
  environment: RuntimeMode;
  symbols: string[];
  timeframes: SignalMonitorMatrixTimeframe[];
  truncated?: boolean;
}): SignalMonitorMatrixStreamScope {
  const symbols = Array.from(
    new Set(
      input.symbols
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
  return {
    environment: input.environment,
    symbols,
    timeframes: input.timeframes,
    cells: [],
    exactCells: false,
    requestedSymbolCount: symbols.length,
    skippedSymbols: [],
    truncated: Boolean(input.truncated),
  };
}

function registerSignalMonitorServerOwnedProducer(input: {
  environment: RuntimeMode;
  profile: DbSignalMonitorProfile;
  scope: SignalMonitorMatrixStreamScope;
}): void {
  const symbolKey = input.scope.symbols.join(",");
  const existing = signalMonitorServerOwnedProducers.get(input.environment);
  if (existing && existing.symbolKey === symbolKey) {
    // Universe unchanged: just re-prime to defeat the idle keepalive release.
    primeSignalMonitorMatrixStockAggregateStream(input.scope.symbols);
    return;
  }
  existing?.subscription.unsubscribe();
  const subscription = createSignalMonitorMatrixStreamSubscriptionForTests({
    scope: input.scope,
    profile: input.profile,
    onEvent: () => {},
  });
  signalMonitorServerOwnedProducers.set(input.environment, {
    subscription,
    symbolKey,
  });
}

function clearSignalMonitorServerOwnedProducers(): void {
  signalMonitorServerOwnedProducers.forEach((entry) => {
    entry.subscription.unsubscribe();
  });
  signalMonitorServerOwnedProducers.clear();
}

async function refreshSignalMonitorServerOwnedProducers(): Promise<void> {
  if (signalMonitorServerOwnedProducerRefreshInFlight) {
    return;
  }
  signalMonitorServerOwnedProducerRefreshInFlight = true;
  try {
    if (!isStockAggregateStreamingAvailable()) {
      clearSignalMonitorServerOwnedProducers();
      return;
    }
    const timeframes = resolveSignalMonitorActiveTimeframes();
    if (!timeframes.length) {
      clearSignalMonitorServerOwnedProducers();
      return;
    }
    let profiles: DbSignalMonitorProfile[];
    try {
      profiles = await listEnabledSignalMonitorProfiles();
    } catch (error) {
      logger.warn(
        { err: error },
        "Server-owned signal matrix producer profile load failed",
      );
      return;
    }
    const activeEnvironments = new Set<RuntimeMode>();
    for (const profile of profiles) {
      try {
        const universe = await resolveSignalMonitorProfileUniverse(profile, {
          ensureWatchlist: false,
        });
        const capped = cappedSignalMonitorEvaluationProfile(universe.profile);
        const maxSymbols = positiveInteger(
          capped.profile.maxSymbols,
          SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
          1,
          SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
        );
        const universeSymbols = Array.from(
          new Set(
            universe.symbols
              .map((symbol) => normalizeSymbol(symbol).toUpperCase())
              .filter(Boolean),
          ),
        );
        const symbols = universeSymbols.slice(0, maxSymbols);
        if (!symbols.length) {
          continue;
        }
        const scope = buildSignalMonitorServerOwnedProducerScope({
          environment: universe.profile.environment,
          symbols,
          timeframes,
          truncated:
            universe.truncated || universeSymbols.length > symbols.length,
        });
        registerSignalMonitorServerOwnedProducer({
          environment: universe.profile.environment,
          profile: universe.profile,
          scope,
        });
        // Keep the producer self-sufficient: refresh the deep-history backfill
        // the aggregated frames (2m/5m/15m/1h/1d) need to warm the indicator.
        // This was previously driven by startSignalMonitorLocalBarCacheWarmup
        // (removed from backgroundWorkers during scan-deprecation, which dropped
        // the producer's deep-history supply and stopped generation for every
        // frame except native 1m). Driving it from the producer ties the bar
        // supply to the consumer and keeps it independent of the legacy scan.
        void refreshSignalMonitorBackfilledBaseBars({
          symbols,
          timeframes,
          evaluatedAt: new Date(),
        });
        activeEnvironments.add(universe.profile.environment);
      } catch (error) {
        logger.warn(
          { err: error, profileId: profile.id },
          "Server-owned signal matrix producer universe resolution failed",
        );
      }
    }
    // Drop producers for environments that are no longer enabled.
    signalMonitorServerOwnedProducers.forEach((entry, environment) => {
      if (!activeEnvironments.has(environment)) {
        entry.subscription.unsubscribe();
        signalMonitorServerOwnedProducers.delete(environment);
      }
    });
  } finally {
    signalMonitorServerOwnedProducerRefreshInFlight = false;
  }
}

export function startSignalMonitorServerOwnedProducer(): void {
  if (signalMonitorServerOwnedProducerStarted) {
    return;
  }
  signalMonitorServerOwnedProducerStarted = true;
  void refreshSignalMonitorServerOwnedProducers();
  signalMonitorServerOwnedProducerTimer = setInterval(() => {
    void refreshSignalMonitorServerOwnedProducers();
  }, SIGNAL_MONITOR_SERVER_OWNED_PRODUCER_REFRESH_MS);
  signalMonitorServerOwnedProducerTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Stored-state reconciliation against canonical events
//
// signal_monitor_symbol_states is the live view; signal_monitor_events is the
// durable record of received signals. Historical producer bugs left rows whose
// signal identity lags the latest canonical event and rows whose
// bars_since_signal undercounts elapsed timeframe bars (sparse feeds). One
// set-based pass per enabled profile repairs both; the (now identity-safe)
// live producers keep rows correct from then on. This supersedes the old
// 5-minute direction seed, which only filled null directions.
//
// Safety directions: identity normally moves FORWARD to a newer canonical event.
// A stored identity that came from an uncorroborated raw event is the exception:
// it rolls back to the latest bar-cache-corroborated event, or clears when no
// trusted event exists. Bar age only INCREASES; fresh only turns OFF. Adopted
// identities get bars_since_signal reset to null first so the elapsed recompute
// does not inherit the previous signal's bar count.
//
// 1d contract (deliberate, user-confirmed): the bar-age recompute is
// intraday-only because daily bar age counts trading days, not wall-clock
// days. An adopted 1d identity therefore keeps bars_since_signal NULL —
// honestly "unknown", action-blocked via signal_age_unavailable — until the
// next daily evaluation writes a computed age. Fails safe: blocks action,
// never enables it.
// ---------------------------------------------------------------------------
export type SignalMonitorStateReconciliationCounts = {
  profileId: string;
  identityAdopted: number;
  signalCloseBackfilled: number;
  filterStateBackfilled: number;
  latestCloseBackfilled: number;
  latestBarAdvanced: number;
  untrustedIdentityCleared: number;
  barsRecomputed: number;
  freshCleared: number;
};

const SIGNAL_MONITOR_INTRADAY_BAR_SECONDS_SQL = sql`
  CASE s.timeframe
    WHEN '1m' THEN 60
    WHEN '2m' THEN 120
    WHEN '5m' THEN 300
    WHEN '15m' THEN 900
    WHEN '1h' THEN 3600
  END`;

const SIGNAL_MONITOR_TRUSTED_EVENT_CLOSE_TOLERANCE = 0.02;
const SIGNAL_MONITOR_TRUSTED_BAR_CACHE_SOURCES_SQL = sql`(
  'massive-history',
  'massive-websocket',
  'massive-delayed-websocket',
  'ibkr-websocket-derived'
)`;

const SIGNAL_MONITOR_EVENT_SIGNAL_BAR_AT_SQL = sql`
  COALESCE(
    NULLIF(signal_monitor_events.payload->>'signalBarAt', '')::timestamptz,
    CASE signal_monitor_events.timeframe
      WHEN '1m' THEN signal_monitor_events.signal_at - interval '1 minute'
      WHEN '2m' THEN signal_monitor_events.signal_at - interval '2 minutes'
      WHEN '5m' THEN signal_monitor_events.signal_at - interval '5 minutes'
      WHEN '15m' THEN signal_monitor_events.signal_at - interval '15 minutes'
      WHEN '1h' THEN signal_monitor_events.signal_at - interval '1 hour'
      ELSE signal_monitor_events.signal_at
    END
  )`;

function trustedSignalMonitorCanonicalEventsSql(
  profileId: string,
  input: {
    symbols?: string[];
    timeframes?: SignalMonitorMatrixTimeframe[];
    corroborateOnlyUntrusted?: boolean;
    eventOnlyTrusted?: boolean;
  } = {},
) {
  const symbols = Array.from(
    new Set((input.symbols ?? []).map((symbol) => normalizeSymbol(symbol).toUpperCase())),
  ).filter(Boolean);
  const timeframes = Array.from(new Set(input.timeframes ?? [])).filter((timeframe) =>
    SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(timeframe),
  );
  const symbolFilter = symbols.length
    ? sql`AND signal_monitor_events.symbol IN (${sql.join(
        symbols.map((symbol) => sql`${symbol}`),
        sql`, `,
      )})`
    : sql``;
  const timeframeFilter = timeframes.length
    ? sql`AND signal_monitor_events.timeframe IN (${sql.join(
        timeframes.map((timeframe) => sql`${timeframe}`),
        sql`, `,
      )})`
    : sql``;
  const trustedBarLookupFilter = input.corroborateOnlyUntrusted
    ? sql`
          AND signal_monitor_events.payload->'sourceIntegrity' IS NOT NULL
          AND jsonb_typeof(signal_monitor_events.payload->'sourceIntegrity') <> 'null'
          AND signal_monitor_events.payload->'sourceIntegrity'->>'trusted' IS DISTINCT FROM 'true'`
    : sql``;
  const trustedCloseSql = input.eventOnlyTrusted
    ? sql`signal_monitor_events.close`
    : sql`COALESCE(trusted_signal_bar.close, signal_monitor_events.close)`;
  const trustedSignalBarJoinSql = input.eventOnlyTrusted
    ? sql``
    : sql`
      LEFT JOIN LATERAL (
        SELECT bar_cache.close
        FROM bar_cache
        WHERE bar_cache.symbol = signal_monitor_events.symbol
          AND bar_cache.timeframe = signal_monitor_events.timeframe
          AND bar_cache.source IN ${SIGNAL_MONITOR_TRUSTED_BAR_CACHE_SOURCES_SQL}
          AND bar_cache.starts_at = ${SIGNAL_MONITOR_EVENT_SIGNAL_BAR_AT_SQL}
          AND bar_cache.close IS NOT NULL
          ${trustedBarLookupFilter}
        ORDER BY
          CASE bar_cache.source
            WHEN 'massive-history' THEN 0
            WHEN 'massive-websocket' THEN 1
            WHEN 'ibkr-websocket-derived' THEN 2
            WHEN 'massive-delayed-websocket' THEN 3
            ELSE 9
          END
        LIMIT 1
      ) AS trusted_signal_bar ON true`;
  const sourceIntegrityTrustedWhereSql = input.eventOnlyTrusted
    ? sql`
        AND (
          signal_monitor_events.payload->'sourceIntegrity'->>'trusted' = 'true'
          OR signal_monitor_events.payload->'sourceIntegrity' IS NULL
          OR jsonb_typeof(signal_monitor_events.payload->'sourceIntegrity') = 'null'
        )`
    : sql`
        AND (
          signal_monitor_events.payload->'sourceIntegrity'->>'trusted' = 'true'
          OR signal_monitor_events.payload->'sourceIntegrity' IS NULL
          OR jsonb_typeof(signal_monitor_events.payload->'sourceIntegrity') = 'null'
          OR (
            trusted_signal_bar.close IS NOT NULL
            AND ABS(
              (signal_monitor_events.close::numeric - trusted_signal_bar.close::numeric) /
              NULLIF(trusted_signal_bar.close::numeric, 0)
            ) <= ${SIGNAL_MONITOR_TRUSTED_EVENT_CLOSE_TOLERANCE}
          )
        )`;
  return sql`
    (
      SELECT
        signal_monitor_events.id,
        signal_monitor_events.profile_id,
        signal_monitor_events.symbol,
        signal_monitor_events.timeframe,
        signal_monitor_events.direction,
        signal_monitor_events.signal_at,
        signal_monitor_events.signal_price,
        signal_monitor_events.payload->'filterState' AS filter_state,
        ${trustedCloseSql} AS close,
        ${SIGNAL_MONITOR_EVENT_SIGNAL_BAR_AT_SQL} AS signal_bar_at
      FROM signal_monitor_events
      ${trustedSignalBarJoinSql}
      WHERE signal_monitor_events.profile_id = ${profileId}
        AND signal_monitor_events.direction IN ('buy', 'sell')
        AND signal_monitor_events.close IS NOT NULL
        ${symbolFilter}
        ${timeframeFilter}
        ${sourceIntegrityTrustedWhereSql}
    )`;
}

export function buildEmptySignalMonitorCurrentCellParityReport(input: {
  profile: Pick<DbSignalMonitorProfile, "id" | "environment">;
  generatedAt?: Date;
  symbols?: string[];
  timeframes?: SignalMonitorMatrixTimeframe[];
}): SignalMonitorCurrentCellParityReport {
  return {
    profileId: input.profile.id,
    environment: input.profile.environment,
    generatedAt: input.generatedAt ?? new Date(),
    requested: {
      symbols: normalizeSignalMonitorMatrixSymbols(input.symbols),
      timeframes: parseSignalMatrixTimeframes(input.timeframes),
    },
    counts: {
      comparedCells: 0,
      missingStoredCells: 0,
      missingDerivedCells: 0,
      mismatches: 0,
    },
    mismatches: [],
  };
}

export async function listLatestTrustedSignalMonitorEventsForProfile(input: {
  profile: Pick<DbSignalMonitorProfile, "id" | "environment">;
  symbols?: string[];
  timeframes?: SignalMonitorMatrixTimeframe[];
}): Promise<SignalMonitorLatestTrustedSignalEvent[]> {
  const symbols = normalizeSignalMonitorMatrixSymbols(input.symbols);
  const timeframes = parseSignalMatrixTimeframes(input.timeframes);
  const trustedEvents = trustedSignalMonitorCanonicalEventsSql(input.profile.id, {
    symbols,
    timeframes,
    eventOnlyTrusted: true,
  });
  const result = await db.execute(sql`
    SELECT
      latest.id,
      latest.profile_id,
      latest.symbol,
      latest.timeframe,
      latest.direction,
      latest.signal_at,
      latest.signal_price,
      latest.filter_state,
      latest.close,
      latest.signal_bar_at
    FROM (
      SELECT DISTINCT ON (symbol, timeframe)
        id,
        profile_id,
        symbol,
        timeframe,
        direction,
        signal_at,
        signal_price,
        filter_state,
        close,
        signal_bar_at
      FROM ${trustedEvents} AS trusted_signal_monitor_events
      ORDER BY symbol, timeframe, signal_at DESC, id DESC
    ) AS latest
    WHERE true
    ORDER BY latest.symbol, latest.timeframe
  `);

  const events: SignalMonitorLatestTrustedSignalEvent[] = [];
  for (const row of result.rows as Record<string, unknown>[]) {
    const direction = row["direction"];
    const timeframe = String(row["timeframe"] || "").trim();
    const signalAt = dateOrNull(row["signal_at"]);
    if (
      (direction !== "buy" && direction !== "sell") ||
      !SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(
        timeframe as SignalMonitorMatrixTimeframe,
      ) ||
      !signalAt
    ) {
      continue;
    }
    events.push({
      id: String(row["id"]),
      profileId: String(row["profile_id"]),
      symbol: normalizeSymbol(String(row["symbol"] || "")).toUpperCase(),
      timeframe: timeframe as SignalMonitorMatrixTimeframe,
      direction,
      signalAt,
      signalPrice: numericValueOrNull(row["signal_price"]),
      close: numericValueOrNull(row["close"]),
      filterState: row["filter_state"] ?? null,
      signalBarAt: dateOrNull(row["signal_bar_at"]),
    });
  }
  return events;
}

function signalMonitorCurrentCellParityKey(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
}): string {
  return `${input.symbol}${SIGNAL_MONITOR_CELL_KEY_SEPARATOR}${input.timeframe}`;
}

async function listLatestTrustedSignalMonitorBarsForCells(
  cells: Array<{
    symbol: string;
    timeframe: SignalMonitorMatrixTimeframe;
  }>,
): Promise<Map<string, SignalMonitorLatestTrustedBar>> {
  if (!cells.length) {
    return new Map();
  }
  const requestedCells = Array.from(
    new Map(
      cells
        .map((cell) => ({
          symbol: normalizeSymbol(cell.symbol).toUpperCase(),
          timeframe: cell.timeframe,
        }))
        .filter(
          (cell) =>
            cell.symbol && SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(cell.timeframe),
        )
        .map((cell) => [signalMonitorCurrentCellParityKey(cell), cell]),
    ).values(),
  ).sort((left, right) =>
    left.symbol.localeCompare(right.symbol) ||
    SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(left.timeframe) -
      SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(right.timeframe),
  );
  if (!requestedCells.length) {
    return new Map();
  }
  const requestedCellsSql = sql.join(
    requestedCells.map((cell) => sql`(${cell.symbol}, ${cell.timeframe})`),
    sql`, `,
  );

  const result = await db.execute(sql`
    SELECT
      requested.symbol,
      requested.timeframe,
      trusted_latest.starts_at,
      trusted_latest.close
    FROM (VALUES ${requestedCellsSql}) AS requested(symbol, timeframe)
    JOIN LATERAL (
      SELECT starts_at, close
      FROM (
        (
          SELECT starts_at, close, 0 AS source_rank
          FROM bar_cache
          WHERE bar_cache.symbol = requested.symbol
            AND bar_cache.timeframe = requested.timeframe
            AND bar_cache.source = 'massive-history'
            AND bar_cache.close IS NOT NULL
          ORDER BY bar_cache.starts_at DESC
          LIMIT 1
        )
        UNION ALL
        (
          SELECT starts_at, close, 1 AS source_rank
          FROM bar_cache
          WHERE bar_cache.symbol = requested.symbol
            AND bar_cache.timeframe = requested.timeframe
            AND bar_cache.source = 'massive-websocket'
            AND bar_cache.close IS NOT NULL
          ORDER BY bar_cache.starts_at DESC
          LIMIT 1
        )
        UNION ALL
        (
          SELECT starts_at, close, 2 AS source_rank
          FROM bar_cache
          WHERE bar_cache.symbol = requested.symbol
            AND bar_cache.timeframe = requested.timeframe
            AND bar_cache.source = 'ibkr-websocket-derived'
            AND bar_cache.close IS NOT NULL
          ORDER BY bar_cache.starts_at DESC
          LIMIT 1
        )
        UNION ALL
        (
          SELECT starts_at, close, 3 AS source_rank
          FROM bar_cache
          WHERE bar_cache.symbol = requested.symbol
            AND bar_cache.timeframe = requested.timeframe
            AND bar_cache.source = 'massive-delayed-websocket'
            AND bar_cache.close IS NOT NULL
          ORDER BY bar_cache.starts_at DESC
          LIMIT 1
        )
      ) AS latest_by_source
      ORDER BY starts_at DESC, source_rank ASC
      LIMIT 1
    ) AS trusted_latest ON true
    ORDER BY requested.symbol, requested.timeframe
  `);
  const bars = new Map<string, SignalMonitorLatestTrustedBar>();
  for (const row of result.rows as Record<string, unknown>[]) {
    const symbol = normalizeSymbol(String(row["symbol"] || "")).toUpperCase();
    const timeframe = String(
      row["timeframe"] || "",
    ).trim() as SignalMonitorMatrixTimeframe;
    const latestBarAt = dateOrNull(row["starts_at"]);
    if (
      !symbol ||
      !SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(timeframe) ||
      !latestBarAt
    ) {
      continue;
    }
    const key = signalMonitorCurrentCellParityKey({ symbol, timeframe });
    bars.set(key, {
      symbol,
      timeframe,
      latestBarAt,
      latestBarClose: numericValueOrNull(row["close"]),
    });
  }
  return bars;
}

function signalMonitorParityDirection(
  value: unknown,
): SignalMonitorDirection | null {
  return value === "buy" || value === "sell" ? value : null;
}

function stableSignalMonitorParityValue(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => stableSignalMonitorParityValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [
          key,
          stableSignalMonitorParityValue(
            (value as Record<string, unknown>)[key],
          ),
        ]),
    );
  }
  return value ?? null;
}

function signalMonitorParityValuesEqual(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(stableSignalMonitorParityValue(left)) ===
    JSON.stringify(stableSignalMonitorParityValue(right))
  );
}

function signalMonitorStoredStateHasSignalIdentity(
  state: DbSignalMonitorSymbolState,
): boolean {
  return Boolean(
    signalMonitorParityDirection(state.currentSignalDirection) ||
      dateOrNull(state.currentSignalAt) ||
      numericValueOrNull(state.currentSignalPrice) !== null ||
      numericValueOrNull(state.currentSignalClose) !== null ||
      signalMonitorFilterStateOrNull(state.filterState),
  );
}

function deriveSignalMonitorParityBarsSinceSignal(input: {
  timeframe: SignalMonitorMatrixTimeframe;
  signalAt: Date;
  latestBarAt: Date;
}): number | null {
  if (input.timeframe === "1d") {
    return null;
  }
  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    return null;
  }
  const elapsedMs = input.latestBarAt.getTime() - input.signalAt.getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(elapsedMs / timeframeMs));
}

export async function buildSignalMonitorCurrentCellParityReport(input: {
  profile: Pick<DbSignalMonitorProfile, "id" | "environment"> &
    Partial<Pick<DbSignalMonitorProfile, "freshWindowBars">>;
  generatedAt?: Date;
  symbols?: string[];
  timeframes?: SignalMonitorMatrixTimeframe[];
  includeInactive?: boolean;
}): Promise<SignalMonitorCurrentCellParityReport> {
  const report = buildEmptySignalMonitorCurrentCellParityReport(input);
  const symbols = report.requested.symbols;
  const timeframes = report.requested.timeframes;
  const conditions = [
    eq(signalMonitorSymbolStatesTable.profileId, input.profile.id),
    inArray(signalMonitorSymbolStatesTable.timeframe, timeframes),
  ];
  if (symbols.length) {
    conditions.push(inArray(signalMonitorSymbolStatesTable.symbol, symbols));
  }
  if (!input.includeInactive) {
    conditions.push(eq(signalMonitorSymbolStatesTable.active, true));
  }

  const [storedStates, latestEvents] = await Promise.all([
    db
      .select()
      .from(signalMonitorSymbolStatesTable)
      .where(and(...conditions)),
    listLatestTrustedSignalMonitorEventsForProfile({
      profile: input.profile,
      symbols,
      timeframes,
    }),
  ]);
  const storedByKey = new Map<string, DbSignalMonitorSymbolState>();
  for (const state of storedStates) {
    const symbol = normalizeSymbol(state.symbol).toUpperCase();
    const timeframe = String(
      state.timeframe || "",
    ).trim() as SignalMonitorMatrixTimeframe;
    if (!symbol || !SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(timeframe)) {
      continue;
    }
    storedByKey.set(signalMonitorCurrentCellParityKey({ symbol, timeframe }), {
      ...state,
      symbol,
      timeframe,
    });
  }
  const derivedByKey = new Map<string, SignalMonitorLatestTrustedSignalEvent>();
  latestEvents.forEach((event) => {
    derivedByKey.set(signalMonitorCurrentCellParityKey(event), event);
  });
  const cellKeys = new Set([...storedByKey.keys(), ...derivedByKey.keys()]);
  report.counts.comparedCells = cellKeys.size;
  const latestBarsByKey = await listLatestTrustedSignalMonitorBarsForCells(
    Array.from(cellKeys).map((key) => {
      const [symbol, timeframe] = key.split(SIGNAL_MONITOR_CELL_KEY_SEPARATOR);
      return {
        symbol,
        timeframe: timeframe as SignalMonitorMatrixTimeframe,
      };
    }),
  );

  const addMismatch = (input: {
    symbol: string;
    timeframe: SignalMonitorMatrixTimeframe;
    field: SignalMonitorCurrentCellParityField;
    stored: unknown;
    derived: unknown;
    reason: SignalMonitorCurrentCellParityMismatchReason;
  }) => {
    report.mismatches.push({
      profileId: report.profileId,
      symbol: input.symbol,
      timeframe: input.timeframe,
      field: input.field,
      stored: stableSignalMonitorParityValue(input.stored),
      derived: stableSignalMonitorParityValue(input.derived),
      reason: input.reason,
    });
  };
  const compareField = (input: {
    symbol: string;
    timeframe: SignalMonitorMatrixTimeframe;
    field: SignalMonitorCurrentCellParityField;
    stored: unknown;
    derived: unknown;
  }) => {
    if (signalMonitorParityValuesEqual(input.stored, input.derived)) {
      return;
    }
    addMismatch({ ...input, reason: "value_mismatch" });
  };

  for (const key of Array.from(cellKeys).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const [symbol, timeframeValue] = key.split(
      SIGNAL_MONITOR_CELL_KEY_SEPARATOR,
    );
    const timeframe = timeframeValue as SignalMonitorMatrixTimeframe;
    const stored = storedByKey.get(key);
    const derived = derivedByKey.get(key);

    if (!stored && derived) {
      report.counts.missingStoredCells += 1;
      addMismatch({
        symbol: derived.symbol,
        timeframe: derived.timeframe,
        field: "currentSignalDirection",
        stored: null,
        derived: derived.direction,
        reason: "stored_missing",
      });
      continue;
    }
    if (stored && !derived) {
      if (signalMonitorStoredStateHasSignalIdentity(stored)) {
        report.counts.missingDerivedCells += 1;
        addMismatch({
          symbol,
          timeframe,
          field: "currentSignalDirection",
          stored: signalMonitorParityDirection(stored.currentSignalDirection),
          derived: null,
          reason: "derived_missing",
        });
      }
      continue;
    }
    if (!stored || !derived) {
      continue;
    }
    const latestBar = latestBarsByKey.get(key);

    compareField({
      symbol,
      timeframe,
      field: "currentSignalDirection",
      stored: signalMonitorParityDirection(stored.currentSignalDirection),
      derived: derived.direction,
    });
    compareField({
      symbol,
      timeframe,
      field: "currentSignalAt",
      stored: dateOrNull(stored.currentSignalAt)?.toISOString() ?? null,
      derived: derived.signalAt.toISOString(),
    });
    compareField({
      symbol,
      timeframe,
      field: "currentSignalPrice",
      stored: numericValueOrNull(stored.currentSignalPrice),
      derived: derived.signalPrice,
    });
    compareField({
      symbol,
      timeframe,
      field: "currentSignalClose",
      stored: numericValueOrNull(stored.currentSignalClose),
      derived: derived.close,
    });
    compareField({
      symbol,
      timeframe,
      field: "filterState",
      stored: signalMonitorFilterStateOrNull(stored.filterState),
      derived: signalMonitorFilterStateOrNull(derived.filterState),
    });
    if (latestBar) {
      const storedLatestBarAt = dateOrNull(stored.latestBarAt);
      const trustedBarCatchesUpToStored =
        !storedLatestBarAt || latestBar.latestBarAt >= storedLatestBarAt;
      if (!trustedBarCatchesUpToStored) {
        continue;
      }
      const derivedBarsSinceSignal = deriveSignalMonitorParityBarsSinceSignal({
        timeframe,
        signalAt: derived.signalAt,
        latestBarAt: latestBar.latestBarAt,
      });
      compareField({
        symbol,
        timeframe,
        field: "latestBarAt",
        stored: dateOrNull(stored.latestBarAt)?.toISOString() ?? null,
        derived: latestBar.latestBarAt.toISOString(),
      });
      compareField({
        symbol,
        timeframe,
        field: "latestBarClose",
        stored: numericValueOrNull(stored.latestBarClose),
        derived: latestBar.latestBarClose,
      });
      if (derivedBarsSinceSignal != null) {
        compareField({
          symbol,
          timeframe,
          field: "barsSinceSignal",
          stored: stored.barsSinceSignal ?? null,
          derived: derivedBarsSinceSignal,
        });
        if (
          input.profile.freshWindowBars != null &&
          (stored.status === "ok" || stored.status === "stale")
        ) {
          compareField({
            symbol,
            timeframe,
            field: "fresh",
            stored: Boolean(stored.fresh),
            derived: signalMonitorFresh({
              barsSinceSignal: derivedBarsSinceSignal,
              freshWindowBars: positiveInteger(
                input.profile.freshWindowBars,
                0,
                0,
                20,
              ),
              stale: false,
            }),
          });
        }
      }
      if (
        stored.status === "stale" &&
        (!storedLatestBarAt || latestBar.latestBarAt > storedLatestBarAt)
      ) {
        compareField({
          symbol,
          timeframe,
          field: "status",
          stored: stored.status,
          derived: "ok",
        });
      }
    }
  }

  report.counts.mismatches = report.mismatches.length;
  return report;
}

async function reconcileSignalMonitorSymbolStatesForProfile(
  profile: DbSignalMonitorProfile,
  dryRun: boolean,
): Promise<SignalMonitorStateReconciliationCounts> {
  const countOf = async (query: ReturnType<typeof sql>): Promise<number> => {
    const result = await db.execute(query);
    return Number(result.rows?.[0]?.["count"] ?? 0);
  };
  const countReturnedRows = (
    result: Awaited<ReturnType<typeof db.execute>>,
  ): number => {
    if (Array.isArray(result.rows)) {
      return result.rows.length;
    }
    const rowCount = Number((result as { rowCount?: unknown }).rowCount);
    return Number.isFinite(rowCount) ? rowCount : 0;
  };

  const trustedEvents = trustedSignalMonitorCanonicalEventsSql(profile.id);
  const identityLagJoin = sql`
    (
      SELECT DISTINCT ON (symbol, timeframe)
        symbol, timeframe, direction, signal_at, signal_price, filter_state, close
      FROM ${trustedEvents} AS trusted_signal_monitor_events
      ORDER BY symbol, timeframe, signal_at DESC, id DESC
    ) AS e
    WHERE s.profile_id = ${profile.id}
      AND s.symbol = e.symbol
      AND s.timeframe = e.timeframe
      AND s.active = true
      AND (s.current_signal_at IS NULL
        OR s.current_signal_direction IS NULL
        OR s.current_signal_direction = ''
        OR e.signal_at > s.current_signal_at
        OR (
          EXISTS (
            SELECT 1
            FROM signal_monitor_events AS raw_event
            WHERE raw_event.profile_id = s.profile_id
              AND raw_event.symbol = s.symbol
              AND raw_event.timeframe = s.timeframe
              AND raw_event.direction = s.current_signal_direction
              AND raw_event.signal_at = s.current_signal_at
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ${trustedEvents} AS current_event
            WHERE current_event.symbol = s.symbol
              AND current_event.timeframe = s.timeframe
              AND current_event.direction = s.current_signal_direction
              AND current_event.signal_at = s.current_signal_at
          )
        ))`;
  const identityAdopted = dryRun
    ? await countOf(
        sql`SELECT count(*) AS count FROM signal_monitor_symbol_states AS s, ${identityLagJoin}`,
      )
    : countReturnedRows(
        await db.execute(sql`
      UPDATE signal_monitor_symbol_states AS s
      SET current_signal_direction = e.direction,
          current_signal_at = e.signal_at,
          current_signal_price = e.signal_price,
          current_signal_close = e.close,
          current_signal_mfe_percent = NULL,
          current_signal_mae_percent = NULL,
          filter_state = e.filter_state,
          bars_since_signal = NULL,
          fresh = false,
          updated_at = now()
      FROM ${identityLagJoin}
      RETURNING 1
    `),
      );

  const signalCloseBackfillJoin = sql`
    (
      SELECT DISTINCT ON (symbol, timeframe)
        symbol, timeframe, direction, signal_at, filter_state, close
      FROM ${trustedEvents} AS trusted_signal_monitor_events
      ORDER BY symbol, timeframe, signal_at DESC, id DESC
    ) AS e
    WHERE s.profile_id = ${profile.id}
      AND s.symbol = e.symbol
      AND s.timeframe = e.timeframe
      AND s.active = true
      AND s.current_signal_direction = e.direction
      AND s.current_signal_at = e.signal_at
      AND s.current_signal_close IS DISTINCT FROM e.close`;
  const signalCloseBackfilled = dryRun
    ? await countOf(
        sql`SELECT count(*) AS count FROM signal_monitor_symbol_states AS s, ${signalCloseBackfillJoin}`,
      )
    : countReturnedRows(
        await db.execute(sql`
      UPDATE signal_monitor_symbol_states AS s
      SET current_signal_close = e.close,
          current_signal_mfe_percent = NULL,
          current_signal_mae_percent = NULL,
          filter_state = e.filter_state,
          updated_at = now()
      FROM ${signalCloseBackfillJoin}
      RETURNING 1
    `),
      );

  const filterStateBackfillJoin = sql`
    (
      SELECT DISTINCT ON (symbol, timeframe)
        symbol, timeframe, direction, signal_at, filter_state
      FROM ${trustedEvents} AS trusted_signal_monitor_events
      WHERE filter_state IS NOT NULL
      ORDER BY symbol, timeframe, signal_at DESC, id DESC
    ) AS e
    WHERE s.profile_id = ${profile.id}
      AND s.symbol = e.symbol
      AND s.timeframe = e.timeframe
      AND s.active = true
      AND s.current_signal_direction = e.direction
      AND s.current_signal_at = e.signal_at
      AND s.filter_state IS DISTINCT FROM e.filter_state`;
  const filterStateBackfilled = dryRun
    ? await countOf(
        sql`SELECT count(*) AS count FROM signal_monitor_symbol_states AS s, ${filterStateBackfillJoin}`,
      )
    : countReturnedRows(
        await db.execute(sql`
      UPDATE signal_monitor_symbol_states AS s
      SET filter_state = e.filter_state,
          updated_at = now()
      FROM ${filterStateBackfillJoin}
      RETURNING 1
    `),
      );

  const latestCloseBackfillJoin = sql`
    bar_cache AS trusted_latest
    WHERE s.profile_id = ${profile.id}
      AND s.active = true
      AND s.latest_bar_at IS NOT NULL
      AND s.latest_bar_close IS NOT NULL
	      AND trusted_latest.symbol = s.symbol
	      AND trusted_latest.timeframe = s.timeframe
	      AND trusted_latest.source IN ${SIGNAL_MONITOR_TRUSTED_BAR_CACHE_SOURCES_SQL}
	      AND trusted_latest.starts_at = s.latest_bar_at
      AND trusted_latest.close IS NOT NULL
      AND ABS(
        (s.latest_bar_close::numeric - trusted_latest.close::numeric) /
        NULLIF(trusted_latest.close::numeric, 0)
      ) > ${SIGNAL_MONITOR_TRUSTED_EVENT_CLOSE_TOLERANCE}`;
  const latestCloseBackfilled = dryRun
    ? await countOf(
        sql`SELECT count(*) AS count FROM signal_monitor_symbol_states AS s, ${latestCloseBackfillJoin}`,
      )
    : countReturnedRows(
        await db.execute(sql`
      UPDATE signal_monitor_symbol_states AS s
      SET latest_bar_close = trusted_latest.close,
          fresh = false,
          updated_at = now()
      FROM ${latestCloseBackfillJoin}
      RETURNING 1
    `),
      );

  const latestBarAdvanceCandidates = sql`
    (
      SELECT
        s.id,
        trusted_latest.starts_at,
        trusted_latest.close
      FROM signal_monitor_symbol_states AS s
      JOIN LATERAL (
        SELECT starts_at, close
        FROM (
          (
            SELECT starts_at, close, 0 AS source_rank
            FROM bar_cache
            WHERE bar_cache.symbol = s.symbol
              AND bar_cache.timeframe = s.timeframe
              AND bar_cache.source = 'massive-history'
              AND bar_cache.close IS NOT NULL
            ORDER BY bar_cache.starts_at DESC
            LIMIT 1
          )
          UNION ALL
          (
            SELECT starts_at, close, 1 AS source_rank
            FROM bar_cache
            WHERE bar_cache.symbol = s.symbol
              AND bar_cache.timeframe = s.timeframe
              AND bar_cache.source = 'massive-websocket'
              AND bar_cache.close IS NOT NULL
            ORDER BY bar_cache.starts_at DESC
            LIMIT 1
          )
          UNION ALL
          (
            SELECT starts_at, close, 2 AS source_rank
            FROM bar_cache
            WHERE bar_cache.symbol = s.symbol
              AND bar_cache.timeframe = s.timeframe
              AND bar_cache.source = 'ibkr-websocket-derived'
              AND bar_cache.close IS NOT NULL
            ORDER BY bar_cache.starts_at DESC
            LIMIT 1
          )
          UNION ALL
          (
            SELECT starts_at, close, 3 AS source_rank
            FROM bar_cache
            WHERE bar_cache.symbol = s.symbol
              AND bar_cache.timeframe = s.timeframe
              AND bar_cache.source = 'massive-delayed-websocket'
              AND bar_cache.close IS NOT NULL
            ORDER BY bar_cache.starts_at DESC
            LIMIT 1
          )
        ) AS latest_by_source
        ORDER BY starts_at DESC, source_rank ASC
        LIMIT 1
      ) AS trusted_latest ON true
      WHERE s.profile_id = ${profile.id}
        AND s.active = true
        AND s.timeframe IN ('1m', '2m', '5m', '15m', '1h', '1d')
        AND (s.latest_bar_at IS NULL OR trusted_latest.starts_at > s.latest_bar_at)
    ) AS latest_bar_candidates`;
  const latestBarAdvanced = dryRun
    ? await countOf(
        sql`SELECT count(*) AS count FROM ${latestBarAdvanceCandidates}`,
      )
    : countReturnedRows(
        await db.execute(sql`
      UPDATE signal_monitor_symbol_states AS s
      SET latest_bar_at = latest_bar_candidates.starts_at,
          latest_bar_close = latest_bar_candidates.close,
          status = CASE WHEN s.status = 'stale' THEN 'ok' ELSE s.status END,
          fresh = false,
          updated_at = now()
      FROM ${latestBarAdvanceCandidates}
      WHERE s.id = latest_bar_candidates.id
      RETURNING 1
    `),
      );

  const untrustedIdentityWhere = sql`
    WHERE s.profile_id = ${profile.id}
      AND s.active = true
      AND s.current_signal_direction IN ('buy', 'sell')
      AND s.current_signal_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM ${trustedEvents} AS current_event
        WHERE current_event.symbol = s.symbol
          AND current_event.timeframe = s.timeframe
          AND current_event.direction = s.current_signal_direction
          AND current_event.signal_at = s.current_signal_at
      )
      AND EXISTS (
        SELECT 1
        FROM signal_monitor_events AS raw_event
        WHERE raw_event.profile_id = s.profile_id
          AND raw_event.symbol = s.symbol
          AND raw_event.timeframe = s.timeframe
          AND raw_event.direction = s.current_signal_direction
          AND raw_event.signal_at = s.current_signal_at
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ${trustedEvents} AS replacement_event
        WHERE replacement_event.symbol = s.symbol
          AND replacement_event.timeframe = s.timeframe
      )`;
  const untrustedIdentityCleared = dryRun
    ? await countOf(
        sql`SELECT count(*) AS count FROM signal_monitor_symbol_states AS s ${untrustedIdentityWhere}`,
      )
    : countReturnedRows(
        await db.execute(sql`
      UPDATE signal_monitor_symbol_states AS s
      SET current_signal_direction = NULL,
          current_signal_at = NULL,
          current_signal_price = NULL,
          current_signal_close = NULL,
          current_signal_mfe_percent = NULL,
          current_signal_mae_percent = NULL,
          filter_state = NULL,
          bars_since_signal = NULL,
          fresh = false,
          updated_at = now()
      ${untrustedIdentityWhere}
      RETURNING 1
    `),
      );

  const elapsedBars = sql`
    ROUND(
      EXTRACT(EPOCH FROM (s.latest_bar_at - s.current_signal_at)) /
        ${SIGNAL_MONITOR_INTRADAY_BAR_SECONDS_SQL}
    )::int`;
  const barsUndercountWhere = sql`
    WHERE s.profile_id = ${profile.id}
      AND s.active = true
      AND s.timeframe IN ('1m', '2m', '5m', '15m', '1h')
      AND s.current_signal_direction IN ('buy', 'sell')
      AND s.current_signal_at IS NOT NULL
      AND s.latest_bar_at IS NOT NULL
      AND s.latest_bar_at > s.current_signal_at
      AND GREATEST(COALESCE(s.bars_since_signal, 0), ${elapsedBars})
        IS DISTINCT FROM s.bars_since_signal`;
  const barsRecomputed = dryRun
    ? await countOf(
        sql`SELECT count(*) AS count FROM signal_monitor_symbol_states AS s ${barsUndercountWhere}`,
      )
    : countReturnedRows(
        await db.execute(sql`
      UPDATE signal_monitor_symbol_states AS s
      SET bars_since_signal =
            GREATEST(COALESCE(s.bars_since_signal, 0), ${elapsedBars}),
          updated_at = now()
      ${barsUndercountWhere}
      RETURNING 1
    `),
      );

  const freshClearWhere = sql`
    WHERE s.profile_id = ${profile.id}
      AND s.fresh = true
      AND (s.status <> 'ok'
        OR s.bars_since_signal IS NULL
        OR s.bars_since_signal > ${profile.freshWindowBars})`;
  const freshCleared = dryRun
    ? await countOf(
        sql`SELECT count(*) AS count FROM signal_monitor_symbol_states AS s ${freshClearWhere}`,
      )
    : countReturnedRows(
        await db.execute(sql`
      UPDATE signal_monitor_symbol_states AS s
      SET fresh = false, updated_at = now()
      ${freshClearWhere}
      RETURNING 1
    `),
      );

  return {
    profileId: profile.id,
    identityAdopted,
    signalCloseBackfilled,
    filterStateBackfilled,
    latestCloseBackfilled,
    latestBarAdvanced,
    untrustedIdentityCleared,
    barsRecomputed,
    freshCleared,
  };
}

export async function reconcileSignalMonitorSymbolStatesFromCanonicalEvents(
  input: { dryRun?: boolean } = {},
): Promise<SignalMonitorStateReconciliationCounts[]> {
  const dryRun = input.dryRun === true;
  let profiles: DbSignalMonitorProfile[];
  try {
    profiles = await listEnabledSignalMonitorProfiles();
  } catch (error) {
    logger.warn(
      { err: error },
      "Signal monitor state reconciliation: profile load failed",
    );
    return [];
  }
  const results: SignalMonitorStateReconciliationCounts[] = [];
  for (const profile of profiles) {
    try {
      results.push(
        await reconcileSignalMonitorSymbolStatesForProfile(profile, dryRun),
      );
    } catch (error) {
      logger.warn(
        { err: error, profileId: profile.id },
        "Signal monitor state reconciliation failed",
      );
    }
  }
  return results;
}

let signalMonitorStateReconciliationStarted = false;

function signalMonitorStateReconciliationOnStartupEnabled(): boolean {
  const value = String(
    process.env.PYRUS_SIGNAL_MONITOR_STATE_RECONCILE_ON_STARTUP ?? "",
  )
    .trim()
    .toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

export function startSignalMonitorStateReconciliation(): void {
  if (!signalMonitorStateReconciliationOnStartupEnabled()) {
    logger.info(
      "Signal monitor stored-state reconciliation skipped on startup; set PYRUS_SIGNAL_MONITOR_STATE_RECONCILE_ON_STARTUP=1 to run maintenance.",
    );
    return;
  }
  if (signalMonitorStateReconciliationStarted) {
    return;
  }
  signalMonitorStateReconciliationStarted = true;
  void reconcileSignalMonitorSymbolStatesFromCanonicalEvents().then(
    (results) => {
      logger.info(
        { results },
        "Signal monitor stored-state reconciliation complete",
      );
    },
  );
}

export async function subscribeSignalMonitorMatrixStream(input: {
  scope: SignalMonitorMatrixStreamScope;
  onEvent: (event: SignalMonitorMatrixStreamEvent) => void | Promise<void>;
}): Promise<SignalMonitorMatrixStreamSubscription> {
  const profile = await resolveSignalMonitorMatrixStreamProfile(
    input.scope.environment,
  );
  return createSignalMonitorMatrixStreamSubscriptionForTests({
    scope: input.scope,
    profile,
    onEvent: input.onEvent,
  });
}

function resetSignalMonitorMatrixStreamForTests() {
  signalMonitorMatrixStreamSubscribers.clear();
  signalMonitorServerOwnedProducers.clear();
  pendingSignalMonitorMatrixStreamSymbolsByEnvironment.clear();
  if (signalMonitorMatrixStreamFlushTimer) {
    clearTimeout(signalMonitorMatrixStreamFlushTimer);
    signalMonitorMatrixStreamFlushTimer = null;
  }
  signalMonitorMatrixStreamFlushInFlight = false;
  signalMonitorMatrixStreamAggregateEventCount = 0;
  signalMonitorMatrixStreamLastAggregateAt = null;
  nextSignalMonitorMatrixStreamSubscriberId = 1;
  resetSignalMonitorMatrixHeavyEvaluationCache();
}

async function evaluateSymbolsInBatches(input: {
  profile: DbSignalMonitorProfile;
  symbols: string[];
  timeframe: SignalMonitorTimeframe;
  mode: EvaluationMode;
  evaluatedAt: Date;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
  includeProvisionalLiveEdge?: boolean;
  allowHistoricalFallback?: boolean;
  signalStabilityPolicy?: SignalMonitorSignalStabilityPolicy;
  signal?: AbortSignal;
}) {
  const concurrency = positiveInteger(
    input.profile.evaluationConcurrency,
    3,
    1,
    10,
  );
  const states: DbSignalMonitorSymbolState[] = [];

  for (let index = 0; index < input.symbols.length; index += concurrency) {
    throwIfSignalMonitorAborted(input.signal);
    const batch = input.symbols.slice(index, index + concurrency);
    // Batch-prefetch this batch's stored bars (one set-based read per source) so
    // the per-symbol readStoredBars calls inside serve from the prefetch instead
    // of one pooled connection each. This whole-universe refresh is the dominant
    // bar-cache pool load. Behavior-equal — falls back per-symbol on any miss.
    const batchStates = await runWithSignalMonitorStoredBarsPrefetch(
      {
        symbols: batch,
        timeframes: [input.timeframe],
        evaluatedAt: input.evaluatedAt,
        limit: PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
      },
      () =>
        Promise.all(
          batch.map((symbol) =>
            evaluateSignalMonitorSymbol({
              profile: input.profile,
              symbol,
              timeframe: input.timeframe,
              mode: input.mode,
              evaluatedAt: input.evaluatedAt,
              barSourcePolicy: input.barSourcePolicy,
              includeProvisionalLiveEdge: input.includeProvisionalLiveEdge,
              allowHistoricalFallback: input.allowHistoricalFallback,
              signalStabilityPolicy: input.signalStabilityPolicy,
              signal: input.signal,
            }),
          ),
        ),
    );
    throwIfSignalMonitorAborted(input.signal);
    states.push(...batchStates);
    if (index + concurrency < input.symbols.length) {
      // Yield between batches so the whole-universe refresh doesn't hold the
      // event loop across consecutive cache-hit batches.
      await yieldSignalMonitorEventLoop();
    }
  }

  return states;
}

export async function listEnabledSignalMonitorProfiles(): Promise<
  DbSignalMonitorProfile[]
> {
  return db
    .select()
    .from(signalMonitorProfilesTable)
    .where(eq(signalMonitorProfilesTable.enabled, true));
}

export async function updateSignalMonitorProfileEvaluationMetadata(input: {
  profile: DbSignalMonitorProfile;
  evaluatedAt: Date;
  states: DbSignalMonitorSymbolState[];
}): Promise<DbSignalMonitorProfile> {
  const errorCount = input.states.filter(
    (state) => state.status === "error",
  ).length;
  const lastError =
    errorCount > 0 && errorCount === input.states.length
      ? "All signal monitor symbol evaluations failed."
      : null;

  const [updatedProfile] = await db
    .update(signalMonitorProfilesTable)
    .set({
      lastEvaluatedAt: input.evaluatedAt,
      lastError,
      updatedAt: input.evaluatedAt,
    })
    .where(eq(signalMonitorProfilesTable.id, input.profile.id))
    .returning();

  notifyAlgoCockpitChanged({
    mode: input.profile.environment,
    reason: "signal_monitor_state_refreshed",
  });

  return updatedProfile ?? input.profile;
}

export async function evaluateSignalMonitorProfileUniverse(input: {
  profile: DbSignalMonitorProfile;
  mode?: EvaluationMode;
  evaluatedAt?: Date;
  symbols?: string[];
  ensureWatchlist?: boolean;
  deactivateMissing?: boolean;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
}) {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const mode = input.mode ?? "incremental";
  const evaluationSettings = cappedSignalMonitorEvaluationProfile(
    input.profile,
  );
  const timeframes = resolveSignalMonitorActiveTimeframes();
  const rotationTimeframe = resolveSignalMonitorTimeframe(
    evaluationSettings.profile.timeframe,
  );
  const universe = await resolveSignalMonitorProfileUniverse(
    evaluationSettings.profile,
    {
      ensureWatchlist: input.ensureWatchlist,
    },
  );
  if (!evaluationSettings.profile.enabled) {
      return disabledSignalMonitorProfileEvaluationResponse({
        profile: universe.profile,
        evaluatedAt,
        universeSymbols: resolveSignalMonitorActiveUniverseSymbols(universe),
        universe: universe.universe,
        skippedSymbols: universe.skippedSymbols,
        truncated: universe.truncated,
    });
  }
  if (!isSignalMonitorBarEvaluationEnabled()) {
      return disabledSignalMonitorProfileEvaluationResponse({
        profile: universe.profile,
        evaluatedAt,
        universeSymbols: resolveSignalMonitorActiveUniverseSymbols(universe),
        universe: {
          ...universe.universe,
          degradedReason: SIGNAL_MONITOR_PASSIVE_SIGNAL_SOURCE_MESSAGE,
      },
      skippedSymbols: universe.skippedSymbols,
      truncated: universe.truncated,
    });
  }
  const requestedSymbols = input.symbols
    ? new Set(
        input.symbols.map((symbol) => normalizeSymbol(symbol).toUpperCase()),
      )
    : null;
  const resolvedBatch = requestedSymbols
    ? {
        ...resolveExplicitSignalMonitorSymbols({
          symbols: universe.symbols.filter((symbol) =>
            requestedSymbols.has(symbol),
          ),
          maxSymbols: evaluationSettings.profile.maxSymbols,
        }),
        nextCursor: 0,
      }
    : resolveSignalMonitorEvaluationBatch({
        sourceSymbols: universe.symbols,
        maxSymbols: evaluationSettings.profile.maxSymbols,
        cursor: signalMonitorEvaluationRotationCursors.get(
          signalMonitorEvaluationRotationKey({
            profile: universe.profile,
            timeframe: rotationTimeframe,
          }),
        ),
        prioritySymbols: universe.symbols.slice(
          0,
          Math.max(0, universe.universe.pinnedSymbols),
        ),
      });
  if (!requestedSymbols) {
    signalMonitorEvaluationRotationCursors.set(
      signalMonitorEvaluationRotationKey({
        profile: universe.profile,
        timeframe: rotationTimeframe,
      }),
      resolvedBatch.nextCursor,
    );
  }
  const symbols = resolvedBatch.symbols;
  primeSignalMonitorMatrixStockAggregateStream(symbols);
  const shouldDeactivateMissing =
    input.deactivateMissing !== false &&
    !evaluationSettings.capped &&
    !resolvedBatch.truncated &&
    !universe.fallbackWatchlists &&
    !universe.fallbackUsed &&
    !requestedSymbols;

  const evaluatedStates = [];
  for (const timeframe of timeframes) {
    evaluatedStates.push(
      ...(await evaluateSymbolsInBatches({
        profile: universe.profile,
        symbols,
        timeframe,
        mode,
        evaluatedAt,
        barSourcePolicy: input.barSourcePolicy,
      })),
    );
  }
  if (shouldDeactivateMissing) {
    const inactivePatch = { active: false, updatedAt: evaluatedAt };
    await db
      .update(signalMonitorSymbolStatesTable)
      .set(inactivePatch)
      .where(
        symbols.length
          ? and(
              eq(signalMonitorSymbolStatesTable.profileId, universe.profile.id),
              notInArray(signalMonitorSymbolStatesTable.symbol, symbols),
            )
          : eq(signalMonitorSymbolStatesTable.profileId, universe.profile.id),
      );
  }
  const updatedProfile = await updateSignalMonitorProfileEvaluationMetadata({
    profile: universe.profile,
    evaluatedAt,
    states: evaluatedStates,
  });

  return {
    profile: profileToResponse(updatedProfile),
    states: evaluatedStates.map(stateToResponse),
    evaluatedAt,
    truncated: resolvedBatch.truncated,
    skippedSymbols: resolvedBatch.skippedSymbols,
    universeSymbols: resolveSignalMonitorActiveUniverseSymbols(universe),
    universe: universe.universe,
  };
}

function resolveExplicitSignalMonitorSymbols(input: {
  symbols: string[];
  maxSymbols: number;
}) {
  const normalized = Array.from(
    new Set(
      input.symbols
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
  const maxSymbols = Math.max(0, Math.floor(input.maxSymbols));

  return {
    symbols: normalized.slice(0, maxSymbols),
    skippedSymbols: normalized.slice(maxSymbols),
    truncated: normalized.length > maxSymbols,
  };
}

function resolveSignalMonitorProfileSymbolEvaluationSettings(input: {
  profile: DbSignalMonitorProfile;
  maxSymbolsOverride?: number;
  pressureCapMode?: SignalMonitorProfileSymbolEvaluationPressureCapMode;
  evaluationConcurrencyOverride?: number;
  pressureLevel?: ApiResourcePressureLevel;
}) {
  const pressureCapMode = input.pressureCapMode ?? "capped";
  const cappedSettings = cappedSignalMonitorEvaluationProfile(
    input.profile,
    input.pressureLevel,
  );

  if (pressureCapMode === "bypass-soft") {
    const maxSymbols =
      input.maxSymbolsOverride === undefined
        ? SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT
        : Math.max(
            0,
            Math.min(
              SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
              Math.floor(Number(input.maxSymbolsOverride) || 0),
            ),
          );
    return {
      ...cappedSettings,
      capped: false,
      pressureCapMode,
      profile: {
        ...input.profile,
        maxSymbols,
        evaluationConcurrency: positiveInteger(
          input.evaluationConcurrencyOverride ??
            input.profile.evaluationConcurrency,
          DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY,
          1,
          10,
        ),
      },
    };
  }

  const maxSymbols =
    input.maxSymbolsOverride === undefined
      ? cappedSettings.profile.maxSymbols
      : Math.max(
          0,
          Math.min(
            cappedSettings.profile.maxSymbols,
            SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
            Math.floor(Number(input.maxSymbolsOverride) || 0),
          ),
        );
  return {
    ...cappedSettings,
    pressureCapMode,
    profile: {
      ...cappedSettings.profile,
      maxSymbols,
    },
  };
}

export async function evaluateSignalMonitorProfileSymbols(input: {
  profile: DbSignalMonitorProfile;
  mode?: EvaluationMode;
  evaluatedAt?: Date;
  symbols: string[];
  maxSymbolsOverride?: number;
  pressureCapMode?: SignalMonitorProfileSymbolEvaluationPressureCapMode;
  evaluationConcurrencyOverride?: number;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
  includeProvisionalLiveEdge?: boolean;
  allowHistoricalFallback?: boolean;
  signalStabilityPolicy?: SignalMonitorSignalStabilityPolicy;
  signal?: AbortSignal;
}) {
  throwIfSignalMonitorAborted(input.signal);
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const mode = input.mode ?? "incremental";
  const evaluationSettings =
    resolveSignalMonitorProfileSymbolEvaluationSettings({
      profile: input.profile,
      maxSymbolsOverride: input.maxSymbolsOverride,
      pressureCapMode: input.pressureCapMode,
      evaluationConcurrencyOverride: input.evaluationConcurrencyOverride,
    });
  const evaluationProfile = evaluationSettings.profile;
  const timeframe = resolveSignalMonitorTimeframe(evaluationProfile.timeframe);
  const resolved = resolveExplicitSignalMonitorSymbols({
    symbols: input.symbols,
    maxSymbols: evaluationProfile.maxSymbols,
  });
  if (!evaluationProfile.enabled) {
      return disabledSignalMonitorProfileEvaluationResponse({
        profile: evaluationProfile,
        evaluatedAt,
        universeSymbols: resolveSignalMonitorActiveUniverseSymbols(resolved),
        universe: {
          mode: "selected_watchlist",
          configuredMaxSymbols: evaluationProfile.maxSymbols,
        resolvedSymbols: resolved.symbols.length,
        pinnedSymbols: resolved.symbols.length,
        expansionSymbols: 0,
        shortfall: 0,
        source: "selected_watchlist",
        fallbackUsed: false,
        degradedReason: "Signal monitor profile is disabled.",
        rankedAt: null,
      },
      skippedSymbols: resolved.skippedSymbols,
      truncated: resolved.truncated,
    });
  }
  if (!isSignalMonitorBarEvaluationEnabled()) {
    return disabledSignalMonitorProfileEvaluationResponse({
      profile: evaluationProfile,
      evaluatedAt,
      universeSymbols: resolveSignalMonitorActiveUniverseSymbols(resolved),
      universe: {
        mode: "selected_watchlist",
        configuredMaxSymbols: evaluationProfile.maxSymbols,
        resolvedSymbols: resolved.symbols.length,
        pinnedSymbols: resolved.symbols.length,
        expansionSymbols: 0,
        shortfall: 0,
        source: "selected_watchlist",
        fallbackUsed: false,
        degradedReason: SIGNAL_MONITOR_PASSIVE_SIGNAL_SOURCE_MESSAGE,
        rankedAt: null,
      },
      skippedSymbols: resolved.skippedSymbols,
      truncated: resolved.truncated,
    });
  }
  primeSignalMonitorMatrixStockAggregateStream(resolved.symbols);

  const evaluatedStates = await evaluateSymbolsInBatches({
    profile: evaluationProfile,
    symbols: resolved.symbols,
    timeframe,
    mode,
    evaluatedAt,
    barSourcePolicy: input.barSourcePolicy,
    includeProvisionalLiveEdge: input.includeProvisionalLiveEdge,
    allowHistoricalFallback: input.allowHistoricalFallback,
    signalStabilityPolicy: input.signalStabilityPolicy,
    signal: input.signal,
  });
  throwIfSignalMonitorAborted(input.signal);
  const updatedProfile = await updateSignalMonitorProfileEvaluationMetadata({
    profile: evaluationProfile,
    evaluatedAt,
    states: evaluatedStates,
  });

  return {
    profile: profileToResponse(updatedProfile),
    states: evaluatedStates.map(stateToResponse),
    evaluatedAt,
    truncated: resolved.truncated,
    skippedSymbols: resolved.skippedSymbols,
    universeSymbols: resolveSignalMonitorActiveUniverseSymbols(resolved),
    universe: {
      mode: "selected_watchlist",
      configuredMaxSymbols: evaluationProfile.maxSymbols,
      resolvedSymbols: resolved.symbols.length,
      pinnedSymbols: resolved.symbols.length,
      expansionSymbols: 0,
      shortfall: 0,
      source: "selected_watchlist",
      fallbackUsed: false,
      degradedReason: null,
      rankedAt: null,
    },
  };
}

function resolveSignalMonitorMatrixSymbols(input: {
  watchlists: WatchlistRecord[];
  watchlistId?: string | null;
  symbols?: string[];
  maxSymbols: number;
}) {
  const requestedWatchlist = input.watchlistId
    ? (input.watchlists.find(
        (watchlist) => watchlist.id === input.watchlistId,
      ) ?? null)
    : null;
  const sourceSymbols = requestedWatchlist
    ? requestedWatchlist.items.map((item) => item.symbol)
    : (input.symbols ?? []);
  const uniqueSymbols = Array.from(
    new Set(
      sourceSymbols
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );

  return {
    symbols: uniqueSymbols.slice(0, input.maxSymbols),
    skippedSymbols: uniqueSymbols.slice(input.maxSymbols),
    truncated: uniqueSymbols.length > input.maxSymbols,
  };
}

async function evaluateSignalMonitorMatrixSymbol(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframes: SignalMonitorMatrixTimeframe[];
  evaluatedAt: Date;
  includeProvisionalLiveEdge?: boolean;
  allowHistoricalFallback?: boolean;
}) {
  const timeframes = parseSignalMatrixTimeframes(input.timeframes);
  type MatrixTimeframeEvaluationResult =
    | { kind: "state"; state: SignalMonitorMatrixStateResult | null }
    | { kind: "loaded"; cell: SignalMonitorMatrixLoadedCell };
  const results = await Promise.all(
    timeframes.map(async (timeframe): Promise<MatrixTimeframeEvaluationResult> => {
      const liveEdgeStreamState = input.includeProvisionalLiveEdge
        ? evaluateSignalMonitorMatrixStateFromStreamBars({
            profile: input.profile,
            symbol: input.symbol,
            timeframe,
            evaluatedAt: input.evaluatedAt,
          })
        : null;
      if (isFreshSignalMonitorMatrixStreamState(liveEdgeStreamState)) {
        return { kind: "state", state: liveEdgeStreamState };
      }

      try {
        const completedBars = await loadSignalMonitorCompletedBars({
          symbol: input.symbol,
          timeframe,
          evaluatedAt: input.evaluatedAt,
          limit: SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
          priority: SIGNAL_MONITOR_MATRIX_BARS_PRIORITY,
          includeProvisionalLiveEdge: input.includeProvisionalLiveEdge,
          allowHistoricalFallback: input.allowHistoricalFallback,
        });
        return {
          kind: "loaded",
          cell: {
            symbol: input.symbol,
            timeframe,
            completedBars: completedBars.bars.slice(
              -SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
            ),
          },
        };
      } catch (error) {
        if (isSignalMonitorLiveEdgeHistoryUnavailableError(error)) {
          return { kind: "state", state: null };
        }
        return {
          kind: "state",
          state: buildSignalMonitorMatrixErrorState({
            profile: input.profile,
            symbol: input.symbol,
            timeframe,
            evaluatedAt: input.evaluatedAt,
            error,
          }),
        };
      }
    }),
  );

  const loadedCells = results.flatMap((result) =>
    result.kind === "loaded" ? [result.cell] : [],
  );
  const pythonStates = await resolveSignalMonitorMatrixPythonStates({
    profile: input.profile,
    evaluatedAt: input.evaluatedAt,
    cells: loadedCells,
  });
  const states = results
    .map((result) => {
      if (result.kind === "state") {
        return result.state;
      }
      return (
        pythonStates.get(signalMonitorMatrixCellKey(result.cell)) ??
        evaluateSignalMonitorMatrixStateFromCompletedBars({
          profile: input.profile,
          symbol: result.cell.symbol,
          timeframe: result.cell.timeframe,
          evaluatedAt: input.evaluatedAt,
          completedBars: result.cell.completedBars,
        })
      );
    })
    .filter((state): state is SignalMonitorMatrixStateResult =>
      Boolean(state),
    );
  const stateByTimeframe = new Map(
    states.map((state) => [state.timeframe, state]),
  );
  return {
    states: timeframes
      .map((timeframe) => stateByTimeframe.get(timeframe))
      .filter((state): state is SignalMonitorMatrixStateResult =>
        Boolean(state),
      ),
    sourceRequestCount: timeframes.length,
  };
}

function isHydratedSignalMonitorMatrixStateForCoverage(
  state: unknown,
  timeframes: readonly SignalMonitorMatrixTimeframe[],
): state is {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
} {
  if (!state || typeof state !== "object") {
    return false;
  }
  const record = state as {
    active?: unknown;
    currentSignalAt?: unknown;
    lastError?: unknown;
    lastEvaluatedAt?: unknown;
    latestBarAt?: unknown;
    status?: unknown;
    symbol?: unknown;
    timeframe?: unknown;
  };
  const symbol = normalizeSymbol(record.symbol as string);
  const timeframe = String(record.timeframe || "") as SignalMonitorMatrixTimeframe;
  const status = String(record.status || "ok").trim().toLowerCase();
  const latestBarAt = dateOrNull(record.latestBarAt);
  const currentSignalAt = dateOrNull(record.currentSignalAt);
  const lastEvaluatedAt = dateOrNull(record.lastEvaluatedAt);
  return Boolean(
    symbol &&
      timeframes.includes(timeframe) &&
      record.active !== false &&
      (((status === "ok" || status === "idle" || status === "stale") &&
        (latestBarAt || currentSignalAt)) ||
        (status === "unavailable" &&
          lastEvaluatedAt &&
          typeof record.lastError === "string")),
  );
}

function signalMonitorMatrixStateActivityMs(state: {
  currentSignalAt?: unknown;
  lastEvaluatedAt?: unknown;
  latestBarAt?: unknown;
} | null | undefined): number {
  return Math.max(
    dateOrNull(state?.currentSignalAt)?.getTime() ?? 0,
    dateOrNull(state?.lastEvaluatedAt)?.getTime() ?? 0,
    dateOrNull(state?.latestBarAt)?.getTime() ?? 0,
  );
}

function isUsableSignalMonitorMatrixState(state: unknown): boolean {
  return isHydratedSignalMonitorMatrixStateForCoverage(
    state,
    SIGNAL_MONITOR_MATRIX_TIMEFRAMES,
  );
}

function isRenderableStoredSignalMonitorMatrixState(
  state: unknown,
  timeframes: readonly SignalMonitorMatrixTimeframe[],
): boolean {
  if (!state || typeof state !== "object") {
    return false;
  }
  const record = state as {
    active?: unknown;
    currentSignalAt?: unknown;
    lastError?: unknown;
    lastEvaluatedAt?: unknown;
    latestBarAt?: unknown;
    status?: unknown;
    symbol?: unknown;
    timeframe?: unknown;
  };
  const symbol = normalizeSymbol(record.symbol as string);
  const timeframe = String(record.timeframe || "") as SignalMonitorMatrixTimeframe;
  const status = String(record.status || "ok").trim().toLowerCase();
  const latestBarAt = dateOrNull(record.latestBarAt);
  const currentSignalAt = dateOrNull(record.currentSignalAt);
  const lastEvaluatedAt = dateOrNull(record.lastEvaluatedAt);
  return Boolean(
    symbol &&
      timeframes.includes(timeframe) &&
      record.active !== false &&
      (((status === "ok" || status === "idle" || status === "stale") &&
        !record.lastError &&
        (latestBarAt || currentSignalAt)) ||
        (status === "unavailable" &&
          lastEvaluatedAt &&
          typeof record.lastError === "string")),
  );
}

function hasCompleteSignalMonitorMatrixCoverage(input: {
  states: unknown[];
  timeframes: readonly SignalMonitorMatrixTimeframe[];
  requestedSymbols: string[];
  requestedCells?: SignalMonitorMatrixCellRequest[];
}): boolean {
  const requestedCellKeys =
    input.requestedCells && input.requestedCells.length
      ? signalMonitorMatrixCellKeys(input.requestedCells)
      : new Set(
          input.requestedSymbols.flatMap((rawSymbol) => {
            const symbol = normalizeSymbol(rawSymbol);
            return symbol
              ? input.timeframes.map((timeframe) => `${symbol}:${timeframe}`)
              : [];
          }),
        );
  if (!requestedCellKeys.size) {
    return true;
  }

  const hydratedCellKeys = new Set<string>();
  input.states.forEach((state) => {
    if (!isHydratedSignalMonitorMatrixStateForCoverage(state, input.timeframes)) {
      return;
    }
    const record = state as { symbol?: unknown; timeframe?: unknown };
    const symbol = normalizeSymbol(record.symbol as string);
    const timeframe = String(
      record.timeframe || "",
    ) as SignalMonitorMatrixTimeframe;
    const key = `${symbol}:${timeframe}`;
    if (requestedCellKeys.has(key)) {
      hydratedCellKeys.add(key);
    }
  });

  return Array.from(requestedCellKeys).every((key) => hydratedCellKeys.has(key));
}

function buildSignalMonitorMatrixPendingCells(input: {
  states: unknown[];
  timeframes: readonly SignalMonitorMatrixTimeframe[];
  requestedSymbols: string[];
  requestedCells?: SignalMonitorMatrixCellRequest[];
}): SignalMonitorMatrixCellRequest[] {
  if (!input.requestedCells?.length) {
    return [];
  }
  const requestedCells = new Map<string, SignalMonitorMatrixCellRequest>();
  const appendCell = (rawSymbol: string, timeframe: SignalMonitorMatrixTimeframe) => {
    const symbol = normalizeSymbol(rawSymbol).toUpperCase();
    if (!symbol || !input.timeframes.includes(timeframe)) {
      return;
    }
    const key = `${symbol}:${timeframe}`;
    if (!requestedCells.has(key)) {
      requestedCells.set(key, { symbol, timeframe });
    }
  };

  input.requestedCells.forEach((cell) => appendCell(cell.symbol, cell.timeframe));

  if (!requestedCells.size) {
    return [];
  }

  const hydratedCellKeys = new Set<string>();
  input.states.forEach((state) => {
    if (!isHydratedSignalMonitorMatrixStateForCoverage(state, input.timeframes)) {
      return;
    }
    const record = state as { symbol?: unknown; timeframe?: unknown };
    const symbol = normalizeSymbol(record.symbol as string).toUpperCase();
    const timeframe = String(
      record.timeframe || "",
    ) as SignalMonitorMatrixTimeframe;
    const key = `${symbol}:${timeframe}`;
    if (requestedCells.has(key)) {
      hydratedCellKeys.add(key);
    }
  });

  return Array.from(requestedCells.entries())
    .filter(([key]) => !hydratedCellKeys.has(key))
    .map(([, cell]) => cell);
}

function storedSignalStateToMatrixState(
  state: ReturnType<typeof stateToResponseForSnapshot>,
): SignalMonitorMatrixStateResult {
  const direction =
    state.currentSignalDirection === "buy" || state.currentSignalDirection === "sell"
      ? state.currentSignalDirection
      : null;
  return {
    id: state.id,
    profileId: state.profileId,
    symbol: state.symbol,
    timeframe: state.timeframe,
    currentSignalDirection: direction,
    currentSignalAt: state.currentSignalAt,
    currentSignalPrice: state.currentSignalPrice,
    currentSignalClose: state.currentSignalClose,
    currentSignalMfePercent: state.currentSignalMfePercent,
    currentSignalMaePercent: state.currentSignalMaePercent,
    filterState: state.filterState,
    latestBarAt: state.latestBarAt,
    latestBarClose: state.latestBarClose,
    barsSinceSignal: state.barsSinceSignal,
    fresh: state.fresh,
    status: state.status,
    active: state.active,
    lastEvaluatedAt:
      dateOrNull(state.lastEvaluatedAt) ??
      dateOrNull(state.latestBarAt) ??
      new Date(0),
    lastError: state.lastError,
    // Surface the persisted current trend so the DB-sourced bootstrap carries a
    // buy/sell direction for every symbol on load (live deltas already do).
    indicatorSnapshot:
      state.trendDirection === "bullish" || state.trendDirection === "bearish"
        ? {
            trendDirection: state.trendDirection,
            trendAgeBars: null,
            trendAgeBucket: null,
            adx: null,
            strength: null,
            volatilityScore: null,
            mtf: [],
            filterState: signalMonitorFilterStateOrNull(state.filterState),
          }
        : null,
    canonicalSignalEvent: null,
  } as SignalMonitorMatrixStateResult;
}

function hydrateSignalMonitorMatrixStatesFromStoredStates<
  T extends {
    states: SignalMonitorMatrixStateResult[];
    timeframes: SignalMonitorMatrixTimeframe[];
  },
>(
  value: T,
  input: {
    storedStates: ReturnType<typeof stateToResponseForSnapshot>[];
    requestedSymbols: string[];
    requestedCells?: SignalMonitorMatrixCellRequest[];
  },
): T {
  const requestedSymbols = new Set(
    input.requestedSymbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean),
  );
  const requestedCellKeys =
    input.requestedCells && input.requestedCells.length
      ? signalMonitorMatrixCellKeys(input.requestedCells)
      : null;
  const stateByKey = new Map<string, SignalMonitorMatrixStateResult>();
  value.states.forEach((state) => {
    const symbol = normalizeSymbol(state.symbol);
    const timeframe = String(state.timeframe || "") as SignalMonitorMatrixTimeframe;
    const key = `${symbol}:${timeframe}`;
    if (!symbol || !timeframe || (requestedCellKeys && !requestedCellKeys.has(key))) {
      return;
    }
    stateByKey.set(key, state);
  });

  input.storedStates.forEach((storedState) => {
    const symbol = normalizeSymbol(storedState.symbol);
    const timeframe = String(
      storedState.timeframe || "",
    ) as SignalMonitorMatrixTimeframe;
    const key = `${symbol}:${timeframe}`;
    if (
      !symbol ||
      !requestedSymbols.has(symbol) ||
      !value.timeframes.includes(timeframe) ||
      (requestedCellKeys && !requestedCellKeys.has(key)) ||
      !isRenderableStoredSignalMonitorMatrixState(storedState, value.timeframes)
    ) {
      return;
    }
    const current = stateByKey.get(key) ?? null;
    if (
      isUsableSignalMonitorMatrixState(current) &&
      signalMonitorMatrixStateActivityMs(current) >=
        signalMonitorMatrixStateActivityMs(storedState)
    ) {
      return;
    }
    stateByKey.set(key, storedSignalStateToMatrixState(storedState));
  });

  const hydratedStates = Array.from(stateByKey.values());
  if (hydratedStates.length === value.states.length) {
    let unchanged = true;
    for (let index = 0; index < hydratedStates.length; index += 1) {
      if (hydratedStates[index] !== value.states[index]) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) {
      return value;
    }
  }

  return {
    ...value,
    states: hydratedStates,
  };
}

function withSignalMonitorMatrixMetadata<
  T extends {
    states: unknown[];
    timeframes: SignalMonitorMatrixTimeframe[];
    skippedSymbols: string[];
    truncated: boolean;
    sourceRequestCount?: number;
  },
>(
  value: T,
  input: {
    cacheStatus: SignalMonitorMatrixCacheStatus;
    requestedSymbols: string[];
    requestedCells?: SignalMonitorMatrixCellRequest[];
    totalSymbols: number;
    taskCount: number;
    startedAt: number;
    automaticRequest?: { automatic: boolean; debounced: boolean };
  },
) {
  const evaluatedSymbols = new Set(
    value.states
      .map((state) =>
        state && typeof state === "object" && "symbol" in state
          ? normalizeSymbol((state as { symbol?: unknown }).symbol as string)
          : "",
      )
      .filter(Boolean),
  );
  const requestedSymbols = Array.from(
    new Set(input.requestedSymbols.map((symbol) => normalizeSymbol(symbol))),
  ).filter(Boolean);
  const requestedCellKeys =
    input.requestedCells && input.requestedCells.length
      ? signalMonitorMatrixCellKeys(input.requestedCells)
      : null;
  const stateBySymbol = new Map<string, Set<SignalMonitorMatrixTimeframe>>();
  value.states.forEach((state) => {
    if (!isHydratedSignalMonitorMatrixStateForCoverage(state, value.timeframes)) {
      return;
    }
    const symbol = normalizeSymbol(
      (state as { symbol?: unknown }).symbol as string,
    );
    const timeframe = String(
      (state as { timeframe?: unknown }).timeframe || "",
    ) as SignalMonitorMatrixTimeframe;
    const key = `${symbol}:${timeframe}`;
    if (
      !symbol ||
      !value.timeframes.includes(timeframe) ||
      (requestedCellKeys && !requestedCellKeys.has(key))
    ) {
      return;
    }
    const set =
      stateBySymbol.get(symbol) ?? new Set<SignalMonitorMatrixTimeframe>();
    set.add(timeframe);
    stateBySymbol.set(symbol, set);
  });
  const hydratedSymbols = requestedSymbols.filter((symbol) => {
    const hydratedTimeframes = stateBySymbol.get(symbol);
    const requiredTimeframes =
      input.requestedCells && input.requestedCells.length
        ? input.requestedCells
            .filter((cell) => cell.symbol === symbol)
            .map((cell) => cell.timeframe)
        : value.timeframes;
    return requiredTimeframes.every((timeframe) => hydratedTimeframes?.has(timeframe));
  }).length;
  const pendingCells = buildSignalMonitorMatrixPendingCells({
    states: value.states,
    timeframes: value.timeframes,
    requestedSymbols,
    requestedCells: input.requestedCells,
  });
  const warming = Boolean(
    pendingCells.length ||
      input.cacheStatus === "stale" ||
      input.cacheStatus === "inflight",
  );

  return {
    ...value,
    cacheStatus: input.cacheStatus,
    refreshing:
      input.cacheStatus === "stale" || input.cacheStatus === "inflight",
    warming,
    pendingCells,
    coverage: {
      requestedSymbols: requestedSymbols.length,
      evaluatedSymbols: evaluatedSymbols.size,
      pendingSymbols: Math.max(0, input.totalSymbols - evaluatedSymbols.size),
      totalSymbols: input.totalSymbols,
      timeframes: value.timeframes.length,
      taskCount: input.taskCount,
      sourceStrategy: SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY,
      sourceRequestCount: value.sourceRequestCount ?? input.taskCount,
      hydratedSymbols,
      missingSymbols: Math.max(0, input.totalSymbols - hydratedSymbols),
      pendingCellCount: pendingCells.length,
      estimatedFullCycleMs: null as number | null,
      cacheStatus: input.cacheStatus,
      durationMs: Math.max(0, Date.now() - input.startedAt),
      skippedSymbols: value.skippedSymbols.length,
      truncated: value.truncated,
      automaticRequest: Boolean(input.automaticRequest?.automatic),
      debounced: Boolean(input.automaticRequest?.debounced),
    },
  };
}

function disabledSignalMonitorMatrixResponse(input: {
  profile: DbSignalMonitorProfile;
  timeframes: SignalMonitorMatrixTimeframe[];
  startedAt: number;
}) {
  return withSignalMonitorMatrixMetadata(
    {
      profile: profileToResponse(input.profile),
      states: [] as SignalMonitorMatrixStateResult[],
      evaluatedAt: new Date(),
      timeframes: input.timeframes,
      truncated: false,
      skippedSymbols: [] as string[],
      sourceRequestCount: 0,
    },
    {
      cacheStatus: "miss",
      requestedSymbols: [],
      totalSymbols: 0,
      taskCount: 0,
      startedAt: input.startedAt,
      automaticRequest: { automatic: false, debounced: false },
    },
  );
}

function signalMonitorMatrixDisabled(input: {
  profile: DbSignalMonitorProfile;
  timeframes: SignalMonitorMatrixTimeframe[];
  startedAt: number;
}) {
  return !input.profile.enabled
    ? disabledSignalMonitorMatrixResponse(input)
    : null;
}

function disabledSignalMonitorProfileEvaluationResponse(input: {
  profile: DbSignalMonitorProfile;
  evaluatedAt: Date;
  universeSymbols: string[];
  universe: SignalMonitorUniverseSummary;
  skippedSymbols?: string[];
  truncated?: boolean;
}) {
  return {
    profile: profileToResponse(input.profile),
    states: [] as ReturnType<typeof stateToResponse>[],
    evaluatedAt: input.evaluatedAt,
    truncated: input.truncated ?? false,
    skippedSymbols: input.skippedSymbols ?? [],
    universeSymbols: input.universeSymbols,
    universe: input.universe,
  };
}

async function readCurrentSignalMonitorMatrixStates(input: {
  profile: DbSignalMonitorProfile;
  requestedSymbols: string[];
  timeframes: SignalMonitorMatrixTimeframe[];
  evaluatedAt: Date;
}): Promise<ReturnType<typeof stateToResponseForSnapshot>[]> {
  const timeframes = parseSignalMatrixTimeframes(input.timeframes);
  if (!timeframes.length) {
    return [];
  }
  const requestedSymbols = Array.from(
    new Set(
      input.requestedSymbols
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
  if (!requestedSymbols.length) {
    return [];
  }
  const states = await db
    .select()
    .from(signalMonitorSymbolStatesTable)
    .where(
      and(
        eq(signalMonitorSymbolStatesTable.profileId, input.profile.id),
        inArray(signalMonitorSymbolStatesTable.symbol, requestedSymbols),
        inArray(signalMonitorSymbolStatesTable.timeframe, timeframes),
        eq(signalMonitorSymbolStatesTable.active, true),
      ),
    );
  const requestedSymbolSet = new Set(requestedSymbols);

  return states
    .filter((state) => {
      const symbol = normalizeSymbol(state.symbol);
      const timeframe = String(
        state.timeframe || "",
      ) as SignalMonitorMatrixTimeframe;
      return (
        requestedSymbolSet.has(symbol) &&
        timeframes.includes(timeframe) &&
        isRenderableStoredSignalMonitorMatrixState(state, timeframes)
      );
    })
    .map((state) => {
      const timeframe = String(
        state.timeframe || "",
      ) as SignalMonitorMatrixTimeframe;
      return stateToResponseForSnapshot(state, {
        timeframe,
        evaluatedAt: input.evaluatedAt,
        markNonCurrentStale: true,
      });
    });
}

async function hydrateSignalMonitorMatrixResponseFromStoredStates<
  T extends {
    states: SignalMonitorMatrixStateResult[];
    timeframes: SignalMonitorMatrixTimeframe[];
  },
>(
  value: T,
  input: {
    profile: DbSignalMonitorProfile;
    requestedSymbols: string[];
    requestedCells?: SignalMonitorMatrixCellRequest[];
    evaluatedAt: Date;
  },
): Promise<T> {
  try {
    const storedStates = await readCurrentSignalMonitorMatrixStates({
      profile: input.profile,
      requestedSymbols: input.requestedSymbols,
      timeframes: value.timeframes,
      evaluatedAt: input.evaluatedAt,
    });
    return hydrateSignalMonitorMatrixStatesFromStoredStates(value, {
      storedStates,
      requestedSymbols: input.requestedSymbols,
      requestedCells: input.requestedCells,
    });
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error, {
        operation: "hydrate_signal_monitor_matrix_from_stored_states",
        environment: input.profile.environment,
      });
      return value;
    }
    throw error;
  }
}

function filterRuntimeSignalMonitorEvents(input: {
  environment: RuntimeMode;
  symbol?: string;
  from?: Date | string;
  to?: Date | string;
  cursor?: string;
  limit?: number;
}) {
  return filterSignalMonitorEventResponses(
    runtimeSignalMonitorEvents.get(input.environment) ?? [],
    { ...input, sourceStatus: "runtime-fallback" },
  );
}

async function evaluateSignalMonitorMatrixRuntime(input: {
  environment: RuntimeMode;
  watchlistId?: string | null;
  cells?: SignalMonitorMatrixCellRequest[];
  symbols?: string[];
  timeframes?: string[];
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
}) {
  const profile = getRuntimeSignalMonitorProfile(input.environment);
  const { watchlists } = listWatchlistsRuntimeFallback();
  if (
    input.watchlistId &&
    !watchlists.some((watchlist) => watchlist.id === input.watchlistId)
  ) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const automaticMatrixRequest = isAutomaticSignalMonitorMatrixRequest(input);
  const matrixSettings = cappedSignalMatrixSettings(profile, undefined, {
    automatic: automaticMatrixRequest,
    request: input,
  });
  const requestedExactCells = normalizeSignalMonitorMatrixCells(input.cells);
  const { symbols, skippedSymbols, truncated } =
    resolveSignalMonitorMatrixSymbols({
      watchlists,
      watchlistId: input.watchlistId ?? null,
      symbols: requestedExactCells.length
        ? requestedExactCells.map((cell) => cell.symbol)
        : input.symbols,
      maxSymbols: matrixSettings.maxSymbols,
    });
  const exactCells = resolveSignalMonitorMatrixExactCells({
    cells: requestedExactCells,
    allowedSymbols: symbols,
    pressure: matrixSettings.pressure,
    clientRole: input.clientRole,
    requestOrigin: input.requestOrigin,
  });
  const timeframes = exactCells.exact
    ? exactCells.timeframes ?? []
    : parseSignalMatrixTimeframes(input.timeframes);
  const cellsBySymbol = exactCells.exact
    ? signalMonitorMatrixCellsBySymbol(exactCells.cells)
    : null;
  const allowHistoricalFallback =
    shouldAllowSignalMonitorMatrixHistoricalFallback({
      exactCells: exactCells.exact,
    });
  const startedAt = Date.now();
  const concurrency = resolveSignalMonitorMatrixConcurrency({
    matrixSettings,
    request: input,
    symbolCount: symbols.length,
  });
  let cacheStatus: SignalMonitorMatrixCacheStatus = "miss";
  const cacheKey = [
    "runtime-signal",
    input.environment,
    "matrix",
    SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY,
    profile.id,
    input.watchlistId ?? "default",
    exactCells.cacheKeyPart ?? [...symbols].sort().join(","),
    exactCells.cacheKeyPart ? "cells" : timeframes.join(","),
    concurrency,
    matrixSettings.pressure,
    profile.freshWindowBars,
    JSON.stringify(asRecord(profile.pyrusSignalsSettings)),
  ].join(":");
  const automaticRequest = markAutomaticSignalMonitorMatrixRequest(
    cacheKey,
    input,
  );
  const disabledResponse = signalMonitorMatrixDisabled({
    profile,
    timeframes,
    startedAt,
  });
  if (disabledResponse) {
    return disabledResponse;
  }
  if (!isSignalMonitorBarEvaluationEnabled()) {
    return withSignalMonitorMatrixMetadata(
      {
        profile: profileToResponse(profile),
        states: [],
        evaluatedAt: new Date(),
        timeframes,
        truncated,
        skippedSymbols,
        sourceRequestCount: 0,
      },
      {
        cacheStatus: "miss",
        requestedSymbols: symbols,
        requestedCells: exactCells.exact ? exactCells.cells : undefined,
        totalSymbols: symbols.length + skippedSymbols.length,
        taskCount: exactCells.exact
          ? exactCells.cells.length
          : symbols.length * timeframes.length,
        startedAt,
        automaticRequest,
      },
    );
  }
  primeSignalMonitorMatrixStockAggregateStream(symbols);
  type MatrixRuntimeResponse = {
    profile: ReturnType<typeof profileToResponse>;
    states: SignalMonitorMatrixStateResult[];
    evaluatedAt: Date;
    timeframes: SignalMonitorMatrixTimeframe[];
    truncated: boolean;
    skippedSymbols: string[];
    sourceRequestCount: number;
  };
  const buildFreshRuntimeMatrixResponse =
    async (): Promise<MatrixRuntimeResponse> => {
      const evaluatedAt = new Date();
      const states: SignalMonitorMatrixStateResult[] = [];
      let sourceRequestCount = 0;

      const step = Math.min(
        Math.max(1, concurrency),
        SIGNAL_MONITOR_EVAL_YIELD_EVERY,
      );
      for (let index = 0; index < symbols.length; index += step) {
        const batch = symbols.slice(index, index + step);
        // Batch-prefetch this batch's stored bars (symbols × timeframes × sources)
        // in a few set-based queries so the per-symbol readStoredBars calls inside
        // serve from the prefetch instead of issuing one pooled connection each.
        // Behavior-equal to the un-prefetched evaluation (the prefetch falls back
        // per-symbol on any miss); see runWithSignalMonitorStoredBarsPrefetch.
        const batchResults = await runWithSignalMonitorStoredBarsPrefetch(
          {
            symbols: batch,
            timeframes,
            evaluatedAt,
            limit: SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
          },
          () =>
            Promise.all(
              batch.map((symbol) => {
                const requestedTimeframes =
                  cellsBySymbol?.get(symbol) ?? timeframes;
                if (!requestedTimeframes.length) {
                  return Promise.resolve({
                    states: [] as SignalMonitorMatrixStateResult[],
                    sourceRequestCount: 0,
                  });
                }
                return evaluateSignalMonitorMatrixSymbol({
                  profile,
                  symbol,
                  timeframes: requestedTimeframes,
                  evaluatedAt,
                  includeProvisionalLiveEdge: true,
                  allowHistoricalFallback,
                });
              }),
            ),
        );
        batchResults.forEach((result) => {
          states.push(...result.states);
          sourceRequestCount += result.sourceRequestCount;
        });
        if (index + step < symbols.length) {
          await yieldSignalMonitorEventLoop();
        }
      }

      return {
        profile: profileToResponse(profile),
        states,
        evaluatedAt,
        timeframes,
        truncated,
        skippedSymbols,
        sourceRequestCount,
      };
    };
  const response = await withRuntimeSignalMonitorEvaluationCache(
    cacheKey,
    buildFreshRuntimeMatrixResponse,
    {
      onCacheStatus: (status) => {
        cacheStatus = status;
      },
    },
  );
  return withSignalMonitorMatrixMetadata(response, {
    cacheStatus,
    requestedSymbols: symbols,
    requestedCells: exactCells.exact ? exactCells.cells : undefined,
    totalSymbols: symbols.length + skippedSymbols.length,
    taskCount: exactCells.exact ? exactCells.cells.length : symbols.length * timeframes.length,
    startedAt,
    automaticRequest,
  });
}

export async function evaluateSignalMonitorMatrix(input: {
  environment?: RuntimeMode;
  watchlistId?: string | null;
  cells?: SignalMonitorMatrixCellRequest[];
  symbols?: string[];
  timeframes?: string[];
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
}) {
  const environment = resolveEnvironment(input.environment);
  let profile: DbSignalMonitorProfile;
  let watchlists: WatchlistRecord[];
  try {
    profile = await getOrCreateProfile(environment);
    ({ watchlists } = await listWatchlists());
    if (
      input.watchlistId &&
      !watchlists.some((watchlist) => watchlist.id === input.watchlistId)
    ) {
      throw new HttpError(404, "Watchlist not found.", {
        code: "watchlist_not_found",
      });
    }
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error, {
        operation: "evaluate_signal_monitor_matrix",
        environment,
      });
      return evaluateSignalMonitorMatrixRuntime({ ...input, environment });
    }
    throw error;
  }

  const automaticMatrixRequest = isAutomaticSignalMonitorMatrixRequest(input);
  const matrixSettings = cappedSignalMatrixSettings(profile, undefined, {
    automatic: automaticMatrixRequest,
    request: input,
  });
  const requestedExactCells = normalizeSignalMonitorMatrixCells(input.cells);
  const { symbols, skippedSymbols, truncated } =
    resolveSignalMonitorMatrixSymbols({
      watchlists,
      watchlistId: input.watchlistId ?? null,
      symbols: requestedExactCells.length
        ? requestedExactCells.map((cell) => cell.symbol)
        : input.symbols,
      maxSymbols: matrixSettings.maxSymbols,
    });
  const exactCells = resolveSignalMonitorMatrixExactCells({
    cells: requestedExactCells,
    allowedSymbols: symbols,
    pressure: matrixSettings.pressure,
    clientRole: input.clientRole,
    requestOrigin: input.requestOrigin,
  });
  const timeframes = exactCells.exact
    ? exactCells.timeframes ?? []
    : parseSignalMatrixTimeframes(input.timeframes);
  const cellsBySymbol = exactCells.exact
    ? signalMonitorMatrixCellsBySymbol(exactCells.cells)
    : null;
  const allowHistoricalFallback =
    shouldAllowSignalMonitorMatrixHistoricalFallback({
      exactCells: exactCells.exact,
    });
  const evaluatedAt = new Date();
  const concurrency = resolveSignalMonitorMatrixConcurrency({
    matrixSettings,
    request: input,
    symbolCount: symbols.length,
  });
  const startedAt = Date.now();
  let cacheStatus: SignalMonitorMatrixCacheStatus = "miss";
  const cacheKey = [
    "signal-matrix",
    SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY,
    environment,
    profile.id,
    input.watchlistId ?? "default",
    exactCells.cacheKeyPart ?? [...symbols].sort().join(","),
    exactCells.cacheKeyPart ? "cells" : timeframes.join(","),
    concurrency,
    matrixSettings.pressure,
    profile.freshWindowBars,
    JSON.stringify(asRecord(profile.pyrusSignalsSettings)),
  ].join(":");
  const automaticRequest = markAutomaticSignalMonitorMatrixRequest(
    cacheKey,
    input,
  );
  type MatrixResponse = {
    profile: ReturnType<typeof profileToResponse>;
    states: SignalMonitorMatrixStateResult[];
    evaluatedAt: Date;
    timeframes: SignalMonitorMatrixTimeframe[];
    truncated: boolean;
    skippedSymbols: string[];
    sourceRequestCount: number;
  };
  const buildFreshMatrixResponse = async (): Promise<MatrixResponse> => {
    primeSignalMonitorMatrixStockAggregateStream(symbols);
    const states: SignalMonitorMatrixStateResult[] = [];
    let sourceRequestCount = 0;

    // Bound the synchronous batch so a high (soft-bypass) concurrency doesn't run
    // the whole universe's CPU-bound eval in one event-loop-blocking burst; yield
    // between chunks so HTTP stays responsive.
    const step = Math.min(Math.max(1, concurrency), SIGNAL_MONITOR_EVAL_YIELD_EVERY);
    for (let index = 0; index < symbols.length; index += step) {
      const batch = symbols.slice(index, index + step);
      // Keep the normal database-backed matrix path on the same stored-bars
      // prefetch as runtime fallback. This is the hot universe path; without the
      // wrapper each symbol/timeframe falls back to its own bar_cache read.
      const batchResults = await runWithSignalMonitorStoredBarsPrefetch(
        {
          symbols: batch,
          timeframes,
          evaluatedAt,
          limit: SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
        },
        () =>
          Promise.all(
            batch.map((symbol) => {
              const requestedTimeframes = cellsBySymbol?.get(symbol) ?? timeframes;
              if (!requestedTimeframes.length) {
                return Promise.resolve({
                  states: [] as SignalMonitorMatrixStateResult[],
                  sourceRequestCount: 0,
                });
              }
              return evaluateSignalMonitorMatrixSymbol({
                profile,
                symbol,
                timeframes: requestedTimeframes,
                evaluatedAt,
                includeProvisionalLiveEdge: true,
                allowHistoricalFallback,
              });
            }),
          ),
      );
      batchResults.forEach((result) => {
        states.push(...result.states);
        sourceRequestCount += result.sourceRequestCount;
      });
      if (index + step < symbols.length) {
        await yieldSignalMonitorEventLoop();
      }
    }

    const response = {
      profile: profileToResponse(profile),
      states,
      evaluatedAt,
      timeframes,
      truncated,
      skippedSymbols,
      sourceRequestCount,
    };
    schedulePersistSignalMonitorMatrixStatesBestEffort({
      profile,
      states,
      evaluatedAt,
    });
    return response;
  };
  const buildEmptyMatrixResponse = (): MatrixResponse => ({
    profile: profileToResponse(profile),
    states: [],
    evaluatedAt,
    timeframes,
    truncated,
    skippedSymbols,
    sourceRequestCount: 0,
  });
  const hydrateFromStoredStates = (response: MatrixResponse) =>
    hydrateSignalMonitorMatrixResponseFromStoredStates(response, {
      profile,
      requestedSymbols: symbols,
      requestedCells: exactCells.exact ? exactCells.cells : undefined,
      evaluatedAt,
    });

  if (!profile.enabled) {
    const storedResponse = await hydrateFromStoredStates(buildEmptyMatrixResponse());
    return withSignalMonitorMatrixMetadata(storedResponse, {
      cacheStatus: storedResponse.states.length ? "stale" : "miss",
      requestedSymbols: symbols,
      requestedCells: exactCells.exact ? exactCells.cells : undefined,
      totalSymbols: symbols.length + skippedSymbols.length,
      taskCount: exactCells.exact
        ? exactCells.cells.length
        : symbols.length * timeframes.length,
      startedAt,
      automaticRequest,
    });
  }
  if (!isSignalMonitorBarEvaluationEnabled()) {
    const storedResponse = await hydrateFromStoredStates(buildEmptyMatrixResponse());
    return withSignalMonitorMatrixMetadata(storedResponse, {
      cacheStatus: storedResponse.states.length ? "stale" : "miss",
      requestedSymbols: symbols,
      requestedCells: exactCells.exact ? exactCells.cells : undefined,
      totalSymbols: symbols.length + skippedSymbols.length,
      taskCount: exactCells.exact
        ? exactCells.cells.length
        : symbols.length * timeframes.length,
      startedAt,
      automaticRequest,
    });
  }

  const cachedMatrix =
    getDebouncedSignalMonitorMatrixCacheValue<MatrixResponse>(cacheKey);
  if (
    cachedMatrix &&
    cachedMatrix.cacheStatus === "hit"
  ) {
    const hydratedResponse = await hydrateFromStoredStates(cachedMatrix.value);
    return withSignalMonitorMatrixMetadata(hydratedResponse, {
      cacheStatus: cachedMatrix.cacheStatus,
      requestedSymbols: symbols,
      requestedCells: exactCells.exact ? exactCells.cells : undefined,
      totalSymbols: symbols.length + skippedSymbols.length,
      taskCount: exactCells.exact
        ? exactCells.cells.length
        : symbols.length * timeframes.length,
      startedAt,
      automaticRequest,
    });
  }

  const response = await withSignalMonitorMatrixEvaluationCache(
    cacheKey,
    buildFreshMatrixResponse,
        {
          onCacheStatus: (status) => {
            cacheStatus = status;
          },
        },
  );
  const hydratedResponse = await hydrateFromStoredStates(response);
  return withSignalMonitorMatrixMetadata(hydratedResponse, {
    cacheStatus,
    requestedSymbols: symbols,
    requestedCells: exactCells.exact ? exactCells.cells : undefined,
    totalSymbols: symbols.length + skippedSymbols.length,
    taskCount: exactCells.exact
      ? exactCells.cells.length
      : symbols.length * timeframes.length,
    startedAt,
    automaticRequest,
  });
}

export async function getSignalMonitorProfile(input: {
  environment?: RuntimeMode;
}) {
  const environment = resolveEnvironment(input.environment);
  try {
    const profile = await getOrCreateProfile(environment);
    return profileToResponse(await ensureProfileWatchlist(profile));
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error, {
        operation: "get_signal_monitor_profile",
        environment,
      });
      return profileToResponse(getRuntimeSignalMonitorProfile(environment));
    }
    throw error;
  }
}

export async function updateSignalMonitorProfile(input: {
  environment?: RuntimeMode;
  enabled?: boolean;
  watchlistId?: string | null;
  timeframe?: string;
  pyrusSignalsSettings?: Record<string, unknown>;
  freshWindowBars?: number;
  pollIntervalSeconds?: number;
  maxSymbols?: number;
  evaluationConcurrency?: number;
}) {
  const environment = resolveEnvironment(input.environment);
  try {
    const profile = await getOrCreateProfile(environment);
    const profileUpdateDefaults = resolveSignalMonitorProfileUpdateDefaults({
      currentMaxSymbols: Math.min(
        profile.maxSymbols,
        SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
      ),
      currentPyrusSignalsSettings: asRecord(profile.pyrusSignalsSettings),
      inputMaxSymbols: input.maxSymbols,
      inputPyrusSignalsSettings: input.pyrusSignalsSettings,
    });
    const nextEnabled =
      typeof input.enabled === "boolean" ? input.enabled : profile.enabled;
    if (nextEnabled) {
      await assertHighBetaSignalMonitorUniverseAvailable({
        universeScope: profileUpdateDefaults.universeScope,
      });
    }
    const patch: Partial<typeof signalMonitorProfilesTable.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (typeof input.enabled === "boolean") {
      patch.enabled = input.enabled;
    }
    if (Object.hasOwn(input, "watchlistId")) {
      if (input.watchlistId) {
        await assertWatchlistExists(input.watchlistId);
      }
      patch.watchlistId = input.watchlistId ?? null;
    }
    if (input.timeframe !== undefined) {
      patch.timeframe = parseSignalTimeframe(input.timeframe);
    }
    if (input.pyrusSignalsSettings !== undefined) {
      patch.pyrusSignalsSettings = profileUpdateDefaults.pyrusSignalsSettings;
    }
    if (input.freshWindowBars !== undefined) {
      patch.freshWindowBars = positiveInteger(input.freshWindowBars, 3, 1, 20);
    }
    if (input.pollIntervalSeconds !== undefined) {
      patch.pollIntervalSeconds = positiveInteger(
        input.pollIntervalSeconds,
        60,
        15,
        3600,
      );
    }
    if (
      input.maxSymbols !== undefined ||
      profileUpdateDefaults.highBetaRequested
    ) {
      patch.maxSymbols = profileUpdateDefaults.maxSymbols;
    }
    if (input.evaluationConcurrency !== undefined) {
      patch.evaluationConcurrency = positiveInteger(
        input.evaluationConcurrency,
        DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY,
        1,
        10,
      );
    }

    const [updated] = await db
      .update(signalMonitorProfilesTable)
      .set(patch)
      .where(eq(signalMonitorProfilesTable.id, profile.id))
      .returning();

    clearSignalMonitorMatrixEvaluationCache(environment);
    const response = profileToResponse(updated ?? profile);
    notifyAlgoCockpitChanged({
      mode: environment,
      reason: "signal_monitor_profile_updated",
    });
    return response;
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error, {
        operation: "update_signal_monitor_profile",
        environment,
      });
      const response = profileToResponse(
        await updateRuntimeSignalMonitorProfile({
          ...input,
          environment,
        }),
      );
      notifyAlgoCockpitChanged({
        mode: environment,
        reason: "signal_monitor_profile_updated",
      });
      return response;
    }
    throw error;
  }
}

export const __signalMonitorInternalsForTests = {
  resolveSignalMonitorUniverseFromWatchlists,
  resolveSignalMonitorUniverseSymbols,
  resolveSignalMonitorActiveUniverseSymbols,
  resolveSignalMonitorEvaluationBatch,
  resolveExplicitSignalMonitorSymbols,
  resolveSignalMonitorProfileSymbolEvaluationSettings,
  cappedSignalMonitorEvaluationProfile,
  cappedSignalMatrixSettings,
  normalizeSignalMonitorMatrixCells,
  resolveSignalMonitorMatrixExactCells,
  resolveSignalMonitorMatrixExactCellCap,
  shouldAwaitSignalMonitorMatrixExactCellRefresh,
  shouldAllowSignalMonitorMatrixHistoricalFallback,
  resolveSignalMonitorProfileUpdateDefaults,
  resolveSignalMonitorMatrixConcurrency,
  shouldBypassSoftSignalMonitorMatrixPressure,
  buildSignalMonitorLegacyDefaultsPatch,
  isForegroundExactCellLeaderSignalMonitorMatrixRequest,
  buildSignalMonitorCompletedBarsCacheKey,
  filterSignalMonitorBarsForSourcePolicy,
  isSignalMonitorIbkrBar,
  isSignalMonitorDelayedBar,
  aggregateStockMinuteAggregatesForSignalMonitorBars,
  mergeSignalMonitorStockMinuteAggregates,
  hydrateSignalMonitorMatrixStatesFromStoredStates,
  hasCompleteSignalMonitorMatrixCoverage,
  buildSignalMonitorMatrixPendingCells,
  completeSignalMonitorStateSnapshotCoverage,
  buildSignalMonitorStateUnavailableResult,
  shouldPersistSignalMonitorMatrixState,
  shouldPersistCanonicalSignalMonitorEvent,
  shouldPersistSignalMonitorStateEvent,
  shouldPreserveExistingSignalMonitorSymbolState,
  mergeFreshBarMetadataOntoPreservedSignalRow,
  isSignalMonitorStateLatestBarTrusted,
  loadSignalMonitorStreamCompletedBars,
  mergeCompletedBars,
  filterSignalMonitorLiveEdgeBarsForTrustedMove,
  resolveSignalMonitorSourceIntegrity,
  traceSignalMonitorLiveEdgeIntegrity,
  selectSignalMonitorBackfillDueCells,
  shouldSkipSignalMonitorBackfillForPressure,
  shouldSkipSignalMonitorBackfillForQuietProducer,
  SIGNAL_MONITOR_BACKFILL_REFRESH_MS,
  SIGNAL_MONITOR_BACKFILL_MAX_CELLS_PER_CYCLE,
  SIGNAL_MONITOR_BACKFILL_CONCURRENCY_LIMIT,
  signalMonitorBarsSinceSignal,
  resolveSignalMonitorCurrentSignalExcursion,
  stableSignalMonitorPyrusBarEntries,
  selectSignalMonitorSignalEvent,
  selectStableSignalMonitorSignalEvent,
  applyStoredSignalDirectionLatch,
  signalMonitorMatrixStateFromPython,
  evaluateSignalMonitorMatrixStateFromStreamBars,
  isFreshSignalMonitorMatrixStreamState,
  normalizeSignalMonitorMatrixStreamScope,
  signalMonitorMatrixStreamProfileSymbols,
  resolveSignalMonitorMatrixStreamProfileUniverseSymbols,
  resolveSignalMonitorMatrixStreamScope,
  evaluateSignalMonitorMatrixStreamScopeDelta,
  emitSignalMonitorMatrixStreamAggregateDelta,
  evaluateSignalMonitorMatrixStateFromCompletedBars,
  getSignalMonitorMatrixHeavyEvaluationCacheStats,
  getSignalMonitorIndicatorSnapshotBaseCacheStats,
  buildSignalMonitorIndicatorSnapshot,
  barsToPyrusSignalsBarEntries,
  isSignalMonitorCachedCompletedBarsBarBehind,
  lruCacheSet,
  lruCacheTouch,
  getSignalMonitorStreamCompletedBarsCacheStats,
  recordSignalMonitorAggregateRevision,
  getSignalMonitorAggregateRevision,
  resetSignalMonitorMatrixHeavyEvaluationCache,
  createSignalMonitorMatrixStreamSubscriptionForTests,
  buildSignalMonitorServerOwnedProducerScope,
  registerSignalMonitorServerOwnedProducer,
  buildSignalMonitorMatrixStreamBootstrapEvent,
  buildSignalMonitorMatrixStreamBootstrapEventFromStoredState,
  getSignalMonitorMatrixStreamStatus,
  resetSignalMonitorMatrixStreamForTests,
  resolveSignalMonitorBrokerRecentWindowMinutes,
  isSignalMonitorStateCurrentForLane,
  signalMonitorStreamLaneLatestCompletedBarAt,
  traceSignalMonitorLaneCurrentness,
  stateToResponseForSnapshot,
  shouldBypassSignalMonitorCompletedBarsCache,
  shouldRetrySignalMonitorCompletedBars,
  expectedLatestCompletedIntradayBarAt,
  isSignalMonitorMissingExpectedLiveEdge,
  clearSignalMonitorMatrixEvaluationCache,
  pythonComputeEnabledForSignalMatrix,
  normalizePythonSignalMatrixState,
  resolveSignalMonitorMatrixPythonStates,
  withSignalMonitorMatrixEvaluationCache,
  withSignalMonitorMatrixMetadata,
  markAutomaticSignalMonitorMatrixRequest,
  isSignalMonitorBarEvaluationEnabled,
  SIGNAL_MONITOR_PASSIVE_SIGNAL_SOURCE_MESSAGE,
  getDebouncedSignalMonitorMatrixCacheValue,
  shouldCacheSignalMonitorMatrixEvaluationValue,
  buildSignalMonitorEventKey,
  resolveSignalMonitorEventLookupKeys,
  resolveSignalMonitorBreadthHistoryRange,
  resolveSignalMonitorBreadthHistoryWindow,
  buildSignalMonitorBreadthHistoryResponse,
  buildEmptySignalMonitorCurrentCellParityReport,
  buildSignalMonitorCurrentCellParityReport,
  listLatestTrustedSignalMonitorEventsForProfile,
  encodeSignalMonitorEventsCursor,
  decodeSignalMonitorEventsCursor,
  filterSignalMonitorEventResponses,
  filterRuntimeSignalMonitorEvents,
  paginateSignalMonitorEventResponses,
  buildSignalMonitorEventsRuntimeFallbackResponse,
  shouldServeSignalMonitorEventsRuntimeFallback,
  markSignalMonitorEventsReadFallbackForTests(input: {
    error: unknown;
    environment: RuntimeMode;
    nowMs?: number;
  }) {
    return markSignalMonitorEventsReadFallback({ ...input, suppressLog: true });
  },
  resetSignalMonitorEventsReadFallbackBackoffForTests() {
    signalMonitorEventsReadDbBackoff.resetForTest();
  },
  getRuntimeSignalMonitorEvaluationCacheValue,
  disabledSignalMonitorMatrixResponse,
  getSignalMonitorCompletedBarsCacheDiagnostics() {
    return {
      entries: signalMonitorCompletedBarsCache.size,
      inFlight: signalMonitorCompletedBarsInFlight.size,
      counters: { ...signalMonitorCompletedBarsCounters },
    };
  },
  seedSignalMonitorMatrixCache(
    key: string,
    value: unknown,
    bounds: { freshUntil: number; staleUntil: number },
  ) {
    signalMonitorMatrixEvaluationCache.set(key, {
      value,
      freshUntil: bounds.freshUntil,
      staleUntil: bounds.staleUntil,
    });
  },
};

type SignalMonitorStateSource =
  | "database"
  | "runtime-fallback"
  | "memory-cache";
type SignalMonitorStateValue = {
  profile: ReturnType<typeof profileToResponse>;
  states: SignalMonitorStateSnapshotState[];
  evaluatedAt: Date | string;
  truncated: boolean;
  skippedSymbols: string[];
  universeSymbols: string[];
  universe: SignalMonitorUniverseSummary;
};
type SignalMonitorStateReadResult = {
  value: SignalMonitorStateValue;
  stateSource: SignalMonitorStateSource;
};

// The snapshot header "evaluatedAt" should reflect the freshest per-row
// evaluation, not the profile row's lastEvaluatedAt. The producer persists
// per-cell lastEvaluatedAt every tick but never bumps the profile column, so
// using the profile value stuck the header days in the past and made a live
// table look stale. Falls back to the caller's value only when no row carries a
// usable timestamp.
function resolveSignalMonitorSnapshotEvaluatedAt(
  states: ReadonlyArray<{ lastEvaluatedAt?: Date | string | null }>,
  fallback: Date,
): Date {
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const state of states) {
    const at = state.lastEvaluatedAt ? new Date(state.lastEvaluatedAt) : null;
    const ms = at ? at.getTime() : Number.NaN;
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
    }
  }
  return latestMs > Number.NEGATIVE_INFINITY ? new Date(latestMs) : fallback;
}

// Short-TTL cache for the full-profile active-states read. Every state
// snapshot consumer funnels through this identical (universe x timeframes)
// select: the /state route (on its own 15s cache miss), every matrix-stream
// bootstrap (per SSE connect), and the signal-options worker/cockpit readers.
// At a 2000-symbol universe that is a ~12k-row decode against the hard-capped
// 12-connection pool per caller. Rows change at bar cadence (>=1m) and the
// bulk persist busts on write, so the TTL only collapses concurrent readers —
// a snapshot can never trail the last persisted evaluation by more than the
// TTL. Rows are shared by reference and treated as immutable, matching the
// other snapshot read paths.
const SIGNAL_MONITOR_STATE_ROWS_CACHE_TTL_MS = 5_000;
const signalMonitorStateRowsCache = new Map<
  string,
  { rows: DbSignalMonitorSymbolState[]; at: number }
>();
const signalMonitorStateRowsInFlight = new Map<
  string,
  Promise<DbSignalMonitorSymbolState[]>
>();

function bustSignalMonitorStateRowsCache(): void {
  signalMonitorStateRowsCache.clear();
}

async function loadSignalMonitorActiveStateRows(input: {
  profileId: string;
  timeframes: ReturnType<typeof resolveSignalMonitorActiveTimeframes>;
}): Promise<DbSignalMonitorSymbolState[]> {
  const key = `${input.profileId}|${input.timeframes.join(",")}`;
  const cached = signalMonitorStateRowsCache.get(key);
  if (
    cached &&
    Date.now() - cached.at < SIGNAL_MONITOR_STATE_ROWS_CACHE_TTL_MS
  ) {
    return cached.rows;
  }
  let pending = signalMonitorStateRowsInFlight.get(key);
  if (!pending) {
    const compute = (async () => {
      const rows = await db
        .select()
        .from(signalMonitorSymbolStatesTable)
        .where(
          and(
            eq(signalMonitorSymbolStatesTable.profileId, input.profileId),
            inArray(signalMonitorSymbolStatesTable.timeframe, input.timeframes),
            eq(signalMonitorSymbolStatesTable.active, true),
          ),
        )
        .orderBy(
          desc(signalMonitorSymbolStatesTable.fresh),
          desc(signalMonitorSymbolStatesTable.currentSignalAt),
          desc(signalMonitorSymbolStatesTable.latestBarAt),
        );
      signalMonitorStateRowsCache.set(key, { rows, at: Date.now() });
      return rows;
    })();
    pending = compute;
    signalMonitorStateRowsInFlight.set(key, compute);
    // Errors are not cached (next read retries); this cleanup chain swallows
    // the rejection so it cannot surface as unhandled — callers still get the
    // real error via `await pending`.
    void compute
      .catch(() => {})
      .finally(() => {
        if (signalMonitorStateRowsInFlight.get(key) === compute) {
          signalMonitorStateRowsInFlight.delete(key);
        }
      });
  }
  return pending;
}

async function readSignalMonitorPassiveStoredStateFresh(input: {
  profile: DbSignalMonitorProfile;
  includeNonCurrent?: boolean;
  markNonCurrentStale?: boolean;
}): Promise<SignalMonitorStateReadResult> {
  const timeframes = resolveSignalMonitorActiveTimeframes();
  const evaluatedAt = new Date();
  const states = await loadSignalMonitorActiveStateRows({
    profileId: input.profile.id,
    timeframes,
  });
  const { watchlists } = await listWatchlists();
  const universeScope = resolveSignalMonitorUniverseScope(
    asRecord(input.profile.pyrusSignalsSettings),
  );
  const selectedWatchlist = input.profile.watchlistId
    ? (watchlists.find(
        (candidate) => candidate.id === input.profile.watchlistId,
      ) ?? null)
    : (watchlists.find((candidate) => candidate.isDefault) ??
      watchlists[0] ??
      null);
  const allWatchlistSymbols = watchlists.flatMap((watchlist) =>
    watchlist.items.map((item) => item.symbol),
  );
  const selectedWatchlistSymbols = selectedWatchlist
    ? selectedWatchlist.items.map((item) => item.symbol)
    : [];
  const pinnedSourceSymbols =
    universeScope === "selected_watchlist"
      ? selectedWatchlistSymbols
      : universeScope === "high_beta_500"
        ? []
        : allWatchlistSymbols;
  const stateSymbols = states.map((state) => state.symbol);
  const universeSymbols = resolveSymbolUniverse(
    [...pinnedSourceSymbols, ...stateSymbols],
    input.profile.maxSymbols,
  ).symbols;
  const universeSymbolSet = new Set(universeSymbols);
  const pinnedSet = new Set(
    resolveSymbolUniverse(pinnedSourceSymbols, Number.MAX_SAFE_INTEGER).symbols,
  );
  const universeStates = states.filter((state) =>
    universeSymbolSet.has(normalizeSymbol(state.symbol).toUpperCase()),
  );
  // Only the non-current-excluding path consumes the per-lane currentness verdict,
  // and that per-cell check calls the in-memory aggregate ring — the dominant CPU on
  // this hot route. When includeNonCurrent is set (the served /signal-monitor/state
  // poll), every universe state is returned regardless, so computing — then discarding
  // — that ~3000-cell ring pass is pure waste. Compute it lazily, only when it filters.
  const visibleStates = input.includeNonCurrent
    ? universeStates
    : universeStates.filter((state) => {
        const symbol = normalizeSymbol(state.symbol).toUpperCase();
        const timeframe = String(
          state.timeframe || "",
        ) as SignalMonitorMatrixTimeframe;
        return (
          universeSymbolSet.has(symbol) &&
          isSignalMonitorStateCurrentForLane({
            state,
            timeframe,
            evaluatedAt,
            streamLatestBarAt: signalMonitorStreamLaneLatestCompletedBarAt({
              symbol: state.symbol,
              timeframe,
              evaluatedAt,
            }),
          })
        );
      });
  const responseStates = visibleStates.map((state) =>
    stateToResponseForSnapshot(state, {
      timeframe: String(
        state.timeframe || "",
      ) as SignalMonitorMatrixTimeframe,
      evaluatedAt,
      markNonCurrentStale: input.markNonCurrentStale,
    }),
  );
  const value = completeSignalMonitorStateSnapshotCoverage({
    profile: profileToResponse(input.profile),
    states: responseStates,
    evaluatedAt: resolveSignalMonitorSnapshotEvaluatedAt(
      responseStates,
      input.profile.lastEvaluatedAt ?? evaluatedAt,
    ),
    truncated: false,
    skippedSymbols: [] as string[],
    universeSymbols,
    universe: {
      mode: universeScope,
      configuredMaxSymbols: input.profile.maxSymbols,
      resolvedSymbols: universeSymbols.length,
      pinnedSymbols: Array.from(pinnedSet).filter((symbol) =>
        universeSymbolSet.has(symbol),
      ).length,
      expansionSymbols: universeSymbols.filter((symbol) => !pinnedSet.has(symbol))
        .length,
      shortfall: Math.max(
        0,
        input.profile.maxSymbols - universeSymbols.length,
      ),
      source: signalMonitorUniverseSourceForMode(universeScope),
      fallbackUsed: false,
      degradedReason: SIGNAL_MONITOR_PASSIVE_SIGNAL_SOURCE_MESSAGE,
      rankedAt: null,
    },
  });

  return {
    value: {
      ...value,
      profile: profileToResponse(input.profile),
    },
    stateSource: "database" as const,
  };
}

async function readSignalMonitorStateFresh(input: {
  environment: RuntimeMode;
  includeNonCurrent?: boolean;
  markNonCurrentStale?: boolean;
}): Promise<SignalMonitorStateReadResult> {
  const environment = resolveEnvironment(input.environment);
  try {
    const profile = await getOrCreateProfile(environment);
    if (!isSignalMonitorBarEvaluationEnabled()) {
      return readSignalMonitorPassiveStoredStateFresh({
        profile,
        includeNonCurrent: input.includeNonCurrent,
        markNonCurrentStale: input.markNonCurrentStale,
      });
    }
    const {
      profile: hydratedProfile,
      symbols,
      skippedSymbols,
      truncated,
      universe,
    } = await resolveSignalMonitorProfileUniverse(profile);
    const timeframes = resolveSignalMonitorActiveTimeframes();
    const currentUniverseSymbols = new Set(
      symbols
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    );
    const evaluatedAt = new Date();
    const states = await loadSignalMonitorActiveStateRows({
      profileId: hydratedProfile.id,
      timeframes,
    });
    const universeStates = states.filter((state) => {
      const symbol = normalizeSymbol(state.symbol).toUpperCase();
      return currentUniverseSymbols.has(symbol);
    });
    const currentStates = universeStates.filter((state) => {
      const symbol = normalizeSymbol(state.symbol).toUpperCase();
      const timeframe = String(
        state.timeframe || "",
      ) as SignalMonitorMatrixTimeframe;
      return (
        currentUniverseSymbols.has(symbol) &&
        isSignalMonitorStateCurrentForLane({
          state,
          timeframe,
          evaluatedAt,
          streamLatestBarAt: signalMonitorStreamLaneLatestCompletedBarAt({
            symbol: state.symbol,
            timeframe,
            evaluatedAt,
          }),
        })
      );
    });
    const visibleStates = input.includeNonCurrent
      ? universeStates
      : currentStates;

    const responseStates = visibleStates.map((state) =>
      stateToResponseForSnapshot(state, {
        timeframe: String(
          state.timeframe || "",
        ) as SignalMonitorMatrixTimeframe,
        evaluatedAt,
        markNonCurrentStale: input.markNonCurrentStale,
      }),
    );
    const value = completeSignalMonitorStateSnapshotCoverage({
      profile: profileToResponse(hydratedProfile),
      states: responseStates,
      evaluatedAt: resolveSignalMonitorSnapshotEvaluatedAt(
        responseStates,
        hydratedProfile.lastEvaluatedAt ?? new Date(),
      ),
      truncated,
      skippedSymbols,
      universeSymbols: resolveSignalMonitorActiveUniverseSymbols({ symbols }),
      universe,
    });

    return {
      value: {
        ...value,
        profile: profileToResponse(hydratedProfile),
      },
      stateSource: "database" as const,
    };
  } catch (error) {
    if (isTransientPostgresError(error) || isStatementTimeoutError(error)) {
      warnSignalMonitorDbUnavailable(error, {
        operation: "read_signal_monitor_state",
        environment,
      });
      return buildSignalMonitorStateUnavailableResult(environment);
    }
    throw error;
  }
}

export async function getSignalMonitorStoredState(input: {
  environment?: RuntimeMode;
  markNonCurrentStale?: boolean;
}) {
  const environment = resolveEnvironment(input.environment);
  const snapshot = await readSignalMonitorStateFresh({
    environment,
    includeNonCurrent: true,
    markNonCurrentStale: input.markNonCurrentStale,
  });
  return {
    ...snapshot.value,
    stateSource: snapshot.stateSource,
  };
}

function buildSignalMonitorStateUnavailableResult(
  environment: RuntimeMode,
  evaluatedAt = new Date(),
): SignalMonitorStateReadResult {
  const profile: DbSignalMonitorProfile = {
    ...getRuntimeSignalMonitorProfile(environment),
    id: `state-unavailable-${environment}`,
    lastError: SIGNAL_MONITOR_STATE_UNAVAILABLE_MESSAGE,
    updatedAt: evaluatedAt,
  };
  const maxSymbols = positiveInteger(
    profile.maxSymbols,
    DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
    1,
    SIGNAL_MONITOR_MAX_SYMBOLS_LIMIT,
  );
  const fallbackUniverse = resolveSignalMonitorUniverseFromWatchlists({
    profile,
    watchlists: listWatchlistsRuntimeFallback().watchlists,
    expansionUniverse: {
      symbols: [],
      fallbackUsed: true,
      degradedReason: SIGNAL_MONITOR_STATE_UNAVAILABLE_MESSAGE,
      rankedAt: null,
    },
  });
  const universeSymbols = resolveSignalMonitorActiveUniverseSymbols(fallbackUniverse);
  const value = completeSignalMonitorStateSnapshotCoverage({
    profile: profileToResponse(profile),
    states: [],
    evaluatedAt,
    truncated: true,
    skippedSymbols: fallbackUniverse.skippedSymbols,
    universeSymbols,
    universe: {
      ...fallbackUniverse.universe,
      configuredMaxSymbols: maxSymbols,
      fallbackUsed: true,
      degradedReason: SIGNAL_MONITOR_STATE_UNAVAILABLE_MESSAGE,
    },
  });

  return {
    value,
    stateSource: "runtime-fallback" as const,
  };
}

export async function getSignalMonitorState(input: {
  environment?: RuntimeMode;
}) {
  const environment = resolveEnvironment(input.environment);
  const fresh = await readSignalMonitorStateFresh({
    environment,
    includeNonCurrent: true,
    markNonCurrentStale: true,
  });
  return {
    ...fresh.value,
    stateSource: fresh.stateSource,
  };
}

type SignalMonitorPriceTraceInput = {
  environment?: RuntimeMode;
  symbols?: string[];
  timeframes?: string[];
  limit?: number;
  evaluatedAt?: Date;
};

function isoDateOrNull(value: unknown): string | null {
  const date = dateOrNull(value);
  return date ? date.toISOString() : null;
}

function sortSignalMonitorPriceTraceRows(
  left: {
    response: ReturnType<typeof stateToResponseForSnapshot>;
    currentness: ReturnType<typeof traceSignalMonitorLaneCurrentness>;
  },
  right: {
    response: ReturnType<typeof stateToResponseForSnapshot>;
    currentness: ReturnType<typeof traceSignalMonitorLaneCurrentness>;
  },
): number {
  const severityRank = (entry: typeof left): number =>
    entry.response.status === "unavailable"
      ? 0
      : entry.response.status === "idle"
        ? 1
      : entry.response.status === "stale"
        ? 2
      : !entry.currentness.current
          ? 3
          : 4;
  const severity = severityRank(left) - severityRank(right);
  if (severity !== 0) {
    return severity;
  }
  const timeframe =
    SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(left.response.timeframe) -
    SIGNAL_MONITOR_MATRIX_TIMEFRAMES.indexOf(right.response.timeframe);
  if (timeframe !== 0) {
    return timeframe;
  }
  const leftLatest = Date.parse(String(left.response.latestBarAt ?? ""));
  const rightLatest = Date.parse(String(right.response.latestBarAt ?? ""));
  const latest =
    (Number.isFinite(leftLatest) ? leftLatest : 0) -
    (Number.isFinite(rightLatest) ? rightLatest : 0);
  return latest || left.response.symbol.localeCompare(right.response.symbol);
}

export async function traceSignalMonitorPriceFreshness(
  input: SignalMonitorPriceTraceInput = {},
) {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  // Restrict the persisted-bars read to the sources the signal-monitor actually
  // reads (the websocket stream + massive-history). This makes the per-symbol query
  // a fast index seek on (symbol, timeframe, source, starts_at) instead of scanning a
  // symbol's full multi-source history — which trips the 15s statement_timeout — and
  // it is also the semantically correct scope for a signal-monitor freshness trace.
  const persistedBarSources = storeSourceNames();
  const environment = resolveEnvironment(
    input.environment ?? resolveSignalSourceEnvironment(),
  );
  const limit = positiveInteger(input.limit, 20, 1, 100);
  const requestedSymbols = Array.from(
    new Set(
      (input.symbols ?? [])
        .map((symbol) => normalizeSymbol(symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
  const requestedTimeframes = parseSignalMatrixTimeframes(input.timeframes);
  const profile = await getOrCreateProfile(environment);
  const conditions = [
    eq(signalMonitorSymbolStatesTable.profileId, profile.id),
    eq(signalMonitorSymbolStatesTable.active, true),
    inArray(signalMonitorSymbolStatesTable.timeframe, requestedTimeframes),
  ];
  if (requestedSymbols.length) {
    conditions.push(inArray(signalMonitorSymbolStatesTable.symbol, requestedSymbols));
  }
  const storedStates = await db
    .select()
    .from(signalMonitorSymbolStatesTable)
    .where(and(...conditions))
    .orderBy(
      desc(signalMonitorSymbolStatesTable.fresh),
      desc(signalMonitorSymbolStatesTable.currentSignalAt),
      desc(signalMonitorSymbolStatesTable.latestBarAt),
    );
  const rows = storedStates.map((state) => {
    const timeframe = String(state.timeframe || "") as SignalMonitorMatrixTimeframe;
    const response = stateToResponseForSnapshot(state, {
      timeframe,
      evaluatedAt,
      markNonCurrentStale: true,
    });
    return {
      state,
      response,
      currentness: traceSignalMonitorLaneCurrentness({
        state,
        timeframe,
        evaluatedAt,
      }),
    };
  });
  const staleRows = rows.filter(
    (row) => row.response.status !== "ok" || row.response.fresh === false,
  );
  const selected = (requestedSymbols.length ? rows : staleRows.length ? staleRows : rows)
    .sort(sortSignalMonitorPriceTraceRows)
    .slice(0, limit);

  const traced = await mapWithConcurrency(
    selected,
    PRICE_TRACE_ROW_CONCURRENCY,
    async ({ state, response, currentness }) => {
      const symbol = normalizeSymbol(state.symbol).toUpperCase();
      const timeframe = response.timeframe;
      let persistedBars: Array<{
        source: string;
        startsAt: Date;
        close: string;
        updatedAt: Date;
      }> = [];
      let persistedBarsError: "timeout" | "error" | null = null;
      try {
        persistedBars = await db
          .select({
            source: barCacheTable.source,
            startsAt: barCacheTable.startsAt,
            close: barCacheTable.close,
            updatedAt: barCacheTable.updatedAt,
          })
          .from(barCacheTable)
          .where(
            and(
              eq(barCacheTable.symbol, symbol),
              eq(barCacheTable.timeframe, timeframe),
              inArray(barCacheTable.source, persistedBarSources),
            ),
          )
          .orderBy(desc(barCacheTable.startsAt))
          .limit(3);
      } catch (error) {
        // One symbol's slow/timed-out bar_cache read must not fail the whole
        // diagnostic (the fan-out rejects on first error) — surface it per-row
        // and keep tracing the rest.
        persistedBarsError = isStatementTimeoutError(error) ? "timeout" : "error";
      }
      const providerRequests = await db
        .select({
          endpointFamily: providerRequestLogTable.endpointFamily,
          status: providerRequestLogTable.status,
          httpStatus: providerRequestLogTable.httpStatus,
          durationMs: providerRequestLogTable.durationMs,
          rowCount: providerRequestLogTable.rowCount,
          errorCode: providerRequestLogTable.errorCode,
          errorMessage: providerRequestLogTable.errorMessage,
          createdAt: providerRequestLogTable.createdAt,
        })
        .from(providerRequestLogTable)
        .where(eq(providerRequestLogTable.symbol, symbol))
        .orderBy(desc(providerRequestLogTable.createdAt))
        .limit(5);
      const jobs = await db
        .select({
          kind: marketDataIngestJobsTable.kind,
          timeframe: marketDataIngestJobsTable.timeframe,
          status: marketDataIngestJobsTable.status,
          attemptCount: marketDataIngestJobsTable.attemptCount,
          nextRunAt: marketDataIngestJobsTable.nextRunAt,
          updatedAt: marketDataIngestJobsTable.updatedAt,
          lastError: marketDataIngestJobsTable.lastError,
        })
        .from(marketDataIngestJobsTable)
        .where(
          and(
            eq(marketDataIngestJobsTable.symbol, symbol),
            or(
              eq(marketDataIngestJobsTable.timeframe, timeframe),
              isNull(marketDataIngestJobsTable.timeframe),
            ),
          ),
        )
        .orderBy(desc(marketDataIngestJobsTable.updatedAt))
        .limit(5);
      const baseBars = getSignalMonitorBackfilledBaseBars(symbol, timeframe);
      const streamBars = loadSignalMonitorStreamCompletedBars({
        symbol,
        timeframe,
        evaluatedAt,
        limit: SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
      });
      const liveEdgeIntegrity = traceSignalMonitorLiveEdgeIntegrity({
        baseBars,
        liveEdgeBars: streamBars,
      });
      return {
        symbol,
        timeframe,
        api: {
          status: response.status,
          fresh: response.fresh,
          latestBarAt: isoDateOrNull(response.latestBarAt),
          latestBarClose: response.latestBarClose,
          lastEvaluatedAt: isoDateOrNull(response.lastEvaluatedAt),
          actionBlocker: response.actionBlocker,
          lastError: response.lastError,
        },
        storedState: {
          status: state.status,
          fresh: state.fresh,
          latestBarAt: isoDateOrNull(state.latestBarAt),
          latestBarClose: numericValueOrNull(state.latestBarClose),
          lastEvaluatedAt: isoDateOrNull(state.lastEvaluatedAt),
          updatedAt: isoDateOrNull(state.updatedAt),
          lastError: state.lastError ?? null,
        },
        currentness,
        persistedBars: {
          countSampled: persistedBars.length,
          traceError: persistedBarsError,
          latest:
            persistedBars[0] == null
              ? null
              : {
                  source: persistedBars[0].source,
                  startsAt: isoDateOrNull(persistedBars[0].startsAt),
                  close: numericValueOrNull(persistedBars[0].close),
                  updatedAt: isoDateOrNull(persistedBars[0].updatedAt),
                },
          recent: persistedBars.map((bar) => ({
            source: bar.source,
            startsAt: isoDateOrNull(bar.startsAt),
            close: numericValueOrNull(bar.close),
            updatedAt: isoDateOrNull(bar.updatedAt),
          })),
        },
        inMemory: {
          backfilledBaseBarCount: baseBars.length,
          backfilledBaseLatestBarAt: isoDateOrNull(baseBars.at(-1)?.timestamp),
          streamBarCount: streamBars.length,
          streamLatestBarAt: isoDateOrNull(streamBars.at(-1)?.timestamp),
          liveEdgeIntegrity,
        },
        providerRequests: providerRequests.map((request) => ({
          endpointFamily: request.endpointFamily,
          status: request.status,
          httpStatus: request.httpStatus,
          durationMs: request.durationMs,
          rowCount: request.rowCount,
          errorCode: request.errorCode,
          errorMessage: request.errorMessage,
          createdAt: isoDateOrNull(request.createdAt),
        })),
        ingestJobs: jobs.map((job) => ({
          kind: job.kind,
          timeframe: job.timeframe,
          status: job.status,
          attemptCount: job.attemptCount,
          nextRunAt: isoDateOrNull(job.nextRunAt),
          updatedAt: isoDateOrNull(job.updatedAt),
          lastError: job.lastError,
        })),
      };
    },
  );

  const counts = rows.reduce(
    (acc, row) => {
      acc.total += 1;
      if (row.response.status === "ok" && row.response.fresh) {
        acc.apiFresh += 1;
      } else if (row.response.status === "idle") {
        acc.apiIdle += 1;
      } else if (row.response.status === "stale") {
        acc.apiStale += 1;
      } else if (row.response.status === "unavailable") {
        acc.apiUnavailable += 1;
      }
      if (row.state.status === "ok" && row.state.fresh) {
        acc.storedFresh += 1;
      }
      return acc;
    },
    {
      total: 0,
      apiFresh: 0,
      apiIdle: 0,
      apiStale: 0,
      apiUnavailable: 0,
      storedFresh: 0,
    },
  );

  return {
    tracedAt: new Date().toISOString(),
    evaluatedAt: evaluatedAt.toISOString(),
    environment,
    profileId: profile.id,
    requested: {
      symbols: requestedSymbols,
      timeframes: requestedTimeframes,
      limit,
    },
    counts,
    rows: traced,
  };
}

// Point-in-time per-timeframe signal direction for a symbol. Returns the signal
// direction in effect at `asOf` for each requested timeframe (the most recent
// stored event with signal_at <= asOf), or null when no signal existed yet.
// The same query serves the live entry gate (asOf = now) and the backfill
// replay (asOf = the historical signal time), so MTF alignment is evaluated
// against the timeframes' real state at the moment the signal fired.
export async function getSignalDirectionsForSymbolAsOf(input: {
  environment?: RuntimeMode;
  symbol: string;
  timeframes: readonly string[];
  asOf: Date;
}): Promise<Record<string, SignalMonitorDirection | null>> {
  const directions: Record<string, SignalMonitorDirection | null> = {};
  const timeframes = input.timeframes.filter(
    (timeframe): timeframe is SignalMonitorTimeframe =>
      SIGNAL_MONITOR_TIMEFRAMES.includes(timeframe as SignalMonitorTimeframe),
  );
  for (const timeframe of timeframes) {
    directions[timeframe] = null;
  }
  const symbol = normalizeSymbol(input.symbol).toUpperCase();
  if (!symbol || !timeframes.length) {
    return directions;
  }
  const environment = resolveEnvironment(input.environment);
  const profile = await getOrCreateProfile(environment);
  // One indexed limit-1 lookup per timeframe (<=6). Each reads the latest event
  // at-or-before asOf; the (profile, signal_at) indexes keep this cheap.
  const resolved = await Promise.all(
    timeframes.map(async (timeframe) => {
      const [row] = await db
        .select({ direction: signalMonitorEventsTable.direction })
        .from(signalMonitorEventsTable)
        .where(
          and(
            eq(signalMonitorEventsTable.profileId, profile.id),
            eq(signalMonitorEventsTable.symbol, symbol),
            eq(signalMonitorEventsTable.timeframe, timeframe),
            lte(signalMonitorEventsTable.signalAt, input.asOf),
          ),
        )
        .orderBy(desc(signalMonitorEventsTable.signalAt))
        .limit(1);
      const direction = row?.direction;
      return [
        timeframe,
        direction === "buy" || direction === "sell" ? direction : null,
      ] as const;
    }),
  );
  for (const [timeframe, direction] of resolved) {
    directions[timeframe] = direction;
  }
  return directions;
}

// Live MTF-alignment source: the per-timeframe *trend* ("stage") direction from
// signal_monitor_symbol_states — the continuously re-evaluated matrix state the
// algo-control panel renders. Unlike getSignalDirectionsForSymbolAsOf (which
// reads the sparse, event-driven signal log that goes stale between discrete
// signals), this reflects each timeframe's standing trend, so the live entry
// gate aligns with what the Signal Matrix shows. bullish->buy, bearish->sell,
// otherwise null (treated as a missing frame by the gate).
export async function getTrendDirectionsForSymbol(input: {
  environment?: RuntimeMode;
  symbol: string;
  timeframes: readonly string[];
}): Promise<Record<string, SignalMonitorDirection | null>> {
  const directions: Record<string, SignalMonitorDirection | null> = {};
  const timeframes = input.timeframes.filter(
    (timeframe): timeframe is SignalMonitorTimeframe =>
      SIGNAL_MONITOR_TIMEFRAMES.includes(timeframe as SignalMonitorTimeframe),
  );
  for (const timeframe of timeframes) {
    directions[timeframe] = null;
  }
  const symbol = normalizeSymbol(input.symbol).toUpperCase();
  if (!symbol || !timeframes.length) {
    return directions;
  }
  const environment = resolveEnvironment(input.environment);
  const profile = await getOrCreateProfile(environment);
  const rows = await db
    .select({
      timeframe: signalMonitorSymbolStatesTable.timeframe,
      trendDirection: signalMonitorSymbolStatesTable.trendDirection,
      status: signalMonitorSymbolStatesTable.status,
    })
    .from(signalMonitorSymbolStatesTable)
    .where(
      and(
        eq(signalMonitorSymbolStatesTable.profileId, profile.id),
        eq(signalMonitorSymbolStatesTable.symbol, symbol),
        eq(signalMonitorSymbolStatesTable.active, true),
        inArray(signalMonitorSymbolStatesTable.timeframe, timeframes),
      ),
    );
  for (const row of rows) {
    if (Object.hasOwn(directions, row.timeframe)) {
      // Staleness guard: this feeds the live signal-options MTF entry gate, so a
      // rotten (stale/unavailable) lane's trend must not drive real entry
      // decisions. Leave it null so the gate treats the frame as non-aligned
      // (fail-safe) rather than acting on a possibly days-old direction.
      directions[row.timeframe] =
        row.status === "ok"
          ? trendDirectionToSignalDirection(row.trendDirection)
          : null;
    }
  }
  return directions;
}

export async function evaluateSignalMonitor(input: {
  environment?: RuntimeMode;
  mode?: EvaluationMode;
  watchlistId?: string | null;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
}) {
  const environment = resolveEnvironment(input.environment);
  try {
    let profile = await getOrCreateProfile(environment);
    if (Object.hasOwn(input, "watchlistId")) {
      profile = await updateSignalMonitorProfile({
        environment,
        watchlistId: input.watchlistId ?? null,
      }).then((response) => ({
        ...profile,
        watchlistId: response.watchlistId,
        updatedAt: response.updatedAt,
      }));
    }
    if (!isSignalMonitorBarEvaluationEnabled()) {
      const stored = await getSignalMonitorStoredState({
        environment,
        markNonCurrentStale: true,
      });
      return {
        ...stored,
        stateSource: stored.stateSource,
      };
    }

    const evaluatedAt = new Date();
    const mode = input.mode ?? "incremental";
    const evaluated = await evaluateSignalMonitorProfileUniverse({
      profile,
      mode,
      evaluatedAt,
      ensureWatchlist: true,
      deactivateMissing: true,
      barSourcePolicy: input.barSourcePolicy,
    });
    return {
      ...evaluated,
      stateSource: "database" as const,
    };
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error, {
        operation: "evaluate_signal_monitor",
        environment,
      });
      const fallback = buildSignalMonitorStateUnavailableResult(environment);
      return {
        ...fallback.value,
        stateSource: fallback.stateSource,
      };
    }
    throw error;
  }
}

export async function listSignalMonitorBreadthHistory(input: {
  environment?: RuntimeMode;
  range?: SignalMonitorBreadthHistoryRange;
  now?: Date;
}) {
  const environment = resolveEnvironment(input.environment);
  const window = resolveSignalMonitorBreadthHistoryWindow({
    range: input.range,
    now: input.now,
  });

  try {
    // Prefer recorded standing-breadth snapshots when the window has them; they
    // are exact and universe-bounded. Wrapped so a missing table (pre-migration)
    // or transient error degrades to event-log reconstruction instead of 500ing.
    let snapshotRows: Array<{
      timeframe: string;
      capturedAt: Date;
      buy: number;
      sell: number;
    }> = [];
    try {
      snapshotRows = await db
        .select({
          timeframe: signalMonitorBreadthSnapshotsTable.timeframe,
          capturedAt: signalMonitorBreadthSnapshotsTable.capturedAt,
          buy: signalMonitorBreadthSnapshotsTable.buy,
          sell: signalMonitorBreadthSnapshotsTable.sell,
        })
        .from(signalMonitorBreadthSnapshotsTable)
        .where(
          and(
            eq(signalMonitorBreadthSnapshotsTable.environment, environment),
            gte(signalMonitorBreadthSnapshotsTable.capturedAt, window.from),
            lte(signalMonitorBreadthSnapshotsTable.capturedAt, window.to),
          ),
        )
        .orderBy(signalMonitorBreadthSnapshotsTable.capturedAt);
    } catch (snapshotError) {
      if (!isTransientPostgresError(snapshotError)) {
        logger.warn(
          { err: snapshotError, environment },
          "Signal monitor breadth snapshot read failed; falling back to reconstruction",
        );
      }
      snapshotRows = [];
    }
    // Only trust snapshots when they actually span the window start; otherwise
    // (e.g. a long range still mostly older than recording) reconstruct so the
    // deep history isn't flat-filled.
    const earliestSnapshotMs = snapshotRows.length
      ? dateOrNull(snapshotRows[0].capturedAt)?.getTime() ?? null
      : null;
    const snapshotsCoverWindow =
      earliestSnapshotMs != null &&
      earliestSnapshotMs <= window.from.getTime() + window.bucketMinutes * 60_000 * 2;
    if (snapshotsCoverWindow) {
      return buildSignalMonitorBreadthFromSnapshots(snapshotRows, window);
    }

    // Seed: the latest standing direction per symbol+timeframe before the
    // window opens, so the first buckets reflect the full breadth, not just
    // flips that happened to land inside the range.
    const seedResult = await db.execute(sql`
      SELECT DISTINCT ON (symbol, timeframe)
        symbol, timeframe, direction
      FROM signal_monitor_events
      WHERE environment = ${environment}
        AND signal_at < ${window.from}
        AND direction IN ('buy', 'sell')
      ORDER BY symbol, timeframe, signal_at DESC
    `);
    const seedRows = (seedResult.rows ?? []) as SignalMonitorBreadthSeedRow[];

    const windowEvents = await db
      .select({
        symbol: signalMonitorEventsTable.symbol,
        timeframe: signalMonitorEventsTable.timeframe,
        direction: signalMonitorEventsTable.direction,
        signalAt: signalMonitorEventsTable.signalAt,
      })
      .from(signalMonitorEventsTable)
      .where(
        and(
          eq(signalMonitorEventsTable.environment, environment),
          gte(signalMonitorEventsTable.signalAt, window.from),
          lte(signalMonitorEventsTable.signalAt, window.to),
        ),
      )
      .orderBy(signalMonitorEventsTable.signalAt);

    return buildSignalMonitorBreadthHistoryResponse(windowEvents, seedRows, window);
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error, {
        operation: "list_signal_monitor_breadth_history",
        environment,
      });
      return buildSignalMonitorBreadthHistoryResponse(
        runtimeSignalMonitorEvents.get(environment) ?? [],
        [],
        window,
      );
    }
    throw error;
  }
}

export async function listSignalMonitorEvents(input: {
  environment?: RuntimeMode;
  symbol?: string;
  from?: Date | string;
  to?: Date | string;
  cursor?: string;
  limit?: number;
}) {
  const environment = resolveEnvironment(input.environment);
  const conditions = [eq(signalMonitorEventsTable.environment, environment)];
  const symbol = normalizeSymbol(input.symbol ?? "").toUpperCase();
  if (symbol) {
    conditions.push(eq(signalMonitorEventsTable.symbol, symbol));
  }
  const from = parseSignalMonitorEventsDate(input.from, "from");
  if (from) {
    conditions.push(gte(signalMonitorEventsTable.signalAt, from));
  }
  const to = parseSignalMonitorEventsDate(input.to, "to");
  if (to) {
    conditions.push(lte(signalMonitorEventsTable.signalAt, to));
  }
  const cursor = decodeSignalMonitorEventsCursor(input.cursor);
  if (cursor) {
    const cursorCondition = or(
      lt(signalMonitorEventsTable.signalAt, cursor.signalAt),
      and(
        eq(signalMonitorEventsTable.signalAt, cursor.signalAt),
        lt(signalMonitorEventsTable.id, cursor.id),
      ),
    );
    if (cursorCondition) {
      conditions.push(cursorCondition);
    }
  }
  const limit = resolveSignalMonitorEventsPageSize(input.limit);
  const fallbackInput = {
    environment,
    symbol: input.symbol,
    from: input.from,
    to: input.to,
    cursor: input.cursor,
    limit: input.limit,
  };
  const nowMs = Date.now();

  if (shouldServeSignalMonitorEventsRuntimeFallback(nowMs)) {
    return buildSignalMonitorEventsRuntimeFallbackResponse(fallbackInput);
  }

  try {
    const events = await db
      .select()
      .from(signalMonitorEventsTable)
      .where(and(...conditions))
      .orderBy(
        desc(signalMonitorEventsTable.signalAt),
        desc(signalMonitorEventsTable.id),
      )
      .limit(limit + 1);
    const page = events.slice(0, limit);
    const responseEvents = page.map(eventToResponse);
    const hasMore = events.length > limit;

    const response = {
      events: responseEvents,
      nextCursor:
        hasMore && responseEvents.length
          ? encodeSignalMonitorEventsCursor(
              responseEvents[responseEvents.length - 1],
            )
          : null,
      hasMore,
      sourceStatus: "database" as const,
    };
    signalMonitorEventsReadDbBackoff.clear();
    return response;
  } catch (error) {
    if (!isTransientPostgresError(error) && !isStatementTimeoutError(error)) {
      throw error;
    }
    markSignalMonitorEventsReadFallback({
      error,
      environment,
      nowMs,
    });
    return buildSignalMonitorEventsRuntimeFallbackResponse(fallbackInput);
  }
}

function shouldServeSignalMonitorEventsRuntimeFallback(
  nowMs = Date.now(),
): boolean {
  return signalMonitorEventsReadDbBackoff.isActive(nowMs);
}

function markSignalMonitorEventsReadFallback(input: {
  error: unknown;
  environment: RuntimeMode;
  nowMs?: number;
  suppressLog?: boolean;
}) {
  const sourceStatus = "runtime-fallback" as const;
  const diagnostic = recordSignalMonitorDbFallback(input.error, {
    operation: "list_signal_monitor_events",
    environment: input.environment,
    sourceStatus,
  });
  signalMonitorEventsReadDbBackoff.markFailure({
    error: input.error,
    logger:
      input.suppressLog === true
        ? { warn() {} }
        : {
            warn(payload, message) {
              logger.warn(
                {
                  ...asRecord(payload),
                  operation: diagnostic.operation,
                  environment: diagnostic.environment,
                  sourceStatus: diagnostic.sourceStatus,
                  transient: diagnostic.transient,
                  poolContention: diagnostic.poolContention,
                },
                message,
              );
            },
          },
    message:
      "Signal monitor events database unavailable; latching runtime fallback",
    nowMs: input.nowMs ?? Date.now(),
  });
  return diagnostic;
}

function buildSignalMonitorEventsRuntimeFallbackResponse(input: {
  environment: RuntimeMode;
  symbol?: string;
  from?: Date | string;
  to?: Date | string;
  cursor?: string;
  limit?: number;
}) {
  return filterRuntimeSignalMonitorEvents(input);
}
