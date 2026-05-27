import { and, desc, eq, ne, notInArray } from "drizzle-orm";
import {
  db,
  signalMonitorEventsTable,
  signalMonitorProfilesTable,
  signalMonitorSymbolStatesTable,
  type SignalMonitorEvent as DbSignalMonitorEvent,
  type SignalMonitorProfile as DbSignalMonitorProfile,
  type SignalMonitorSymbolState as DbSignalMonitorSymbolState,
} from "@workspace/db";
import {
  evaluatePyrusSignalsSignals,
  PYRUS_SIGNALS_SIGNAL_WARMUP_BARS,
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
  type PyrusSignalsSignalEvent,
} from "@workspace/pyrus-signals-core";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { getRuntimeMode, type RuntimeMode } from "../lib/runtime";
import {
  createTransientPostgresBackoff,
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
import { notifyAlgoCockpitChanged } from "./algo-cockpit-events";
import {
  updateApiResourcePressure,
  type ApiResourcePressureLevel,
} from "./resource-pressure";
import { resolveIbkrLaneSymbols } from "./ibkr-lane-policy";

export type SignalMonitorTimeframe = "1m" | "5m" | "15m" | "1h" | "1d";
export type SignalMonitorMatrixTimeframe = SignalMonitorTimeframe | "2m";
type SignalMonitorDirection = "buy" | "sell";
type SignalMonitorStatus = "ok" | "stale" | "unavailable" | "error" | "unknown";
type SignalMonitorMatrixCacheStatus = "hit" | "stale" | "inflight" | "miss";
type SignalMonitorMatrixClientRole = "leader" | "follower" | "manual" | "test";
type SignalMonitorMatrixRequestOrigin = "startup" | "poll" | "manual" | "test";
type SignalMonitorBarSourcePolicy = "mixed" | "ibkr-only";
type SignalMonitorUniverseMode =
  | "selected_watchlist"
  | "all_watchlists"
  | "all_watchlists_plus_universe";
type SignalMonitorUniverseSource =
  | "selected_watchlist"
  | "all_watchlists"
  | "watchlists_plus_ranked_universe";
export type EvaluationMode = "hydrate" | "incremental";
export type SignalMonitorBarSnapshot =
  Awaited<ReturnType<typeof getBars>>["bars"][number];
export type SignalMonitorCompletedBarsSnapshot = {
  bars: SignalMonitorBarSnapshot[];
  latestBarAt: Date | null;
};

type WatchlistRecord = Awaited<ReturnType<typeof listWatchlists>>["watchlists"][number];

const SIGNAL_MONITOR_TIMEFRAMES: readonly SignalMonitorTimeframe[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "1d",
];
const SIGNAL_MONITOR_MATRIX_TIMEFRAMES: readonly SignalMonitorMatrixTimeframe[] = [
  "2m",
  "5m",
  "15m",
];
const DEFAULT_SIGNAL_MONITOR_TIMEFRAME: SignalMonitorTimeframe = "15m";
const SIGNAL_MONITOR_DB_UNAVAILABLE_MESSAGE =
  "Postgres is unavailable; signal monitor data is temporarily degraded.";
const SIGNAL_MONITOR_RUNTIME_FALLBACK_MESSAGE =
  "Postgres is unavailable; using runtime-only signal monitor evaluation.";
const SIGNAL_MONITOR_DB_UNAVAILABLE_CODE = "signal_monitor_db_unavailable";
const SIGNAL_MONITOR_RUNTIME_EVALUATION_CACHE_TTL_MS = 10_000;
const SIGNAL_MONITOR_MATRIX_CACHE_TTL_MS = 60_000;
const SIGNAL_MONITOR_MATRIX_STALE_TTL_MS = 5 * 60_000;
const SIGNAL_MONITOR_MATRIX_AUTOMATIC_DEBOUNCE_MS = 2_000;
const SIGNAL_MONITOR_COMPLETED_BARS_CACHE_TTL_MS = 30_000;
const SIGNAL_MONITOR_COMPLETED_BARS_STALE_TTL_MS = 2 * 60_000;
const SIGNAL_MONITOR_COMPLETED_BARS_CACHE_MAX_ENTRIES = 512;
const SIGNAL_MONITOR_STALE_RETRY_BROKER_WINDOW_MINUTES = 240;
const SIGNAL_MONITOR_STALE_RETRY_BARS = 64;
const SIGNAL_MONITOR_MATRIX_BARS_LIMIT = 240;
const SIGNAL_MONITOR_MATRIX_5M_SOURCE_LIMIT = PYRUS_SIGNALS_SIGNAL_WARMUP_BARS;
const SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY = "hybrid_1m_5m";
const DEFAULT_SIGNAL_MONITOR_BAR_SOURCE_POLICY: SignalMonitorBarSourcePolicy =
  "mixed";
const SIGNAL_MONITOR_BARS_PRIORITY = 4;
const SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY = 6;
const SIGNAL_MONITOR_BARS_FAMILY = "signal-matrix";
const SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY = "__signalMonitorUniverseScope";
const DEFAULT_SIGNAL_MONITOR_UNIVERSE_SCOPE: SignalMonitorUniverseMode =
  "all_watchlists";
const DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS = 60;
const DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY = 2;
const DEFAULT_SIGNAL_MONITOR_POLL_SECONDS = 60;
const SIGNAL_MONITOR_MATRIX_PRESSURE_CAPS: Record<
  ApiResourcePressureLevel,
  { maxSymbols: number; concurrency: number }
> = {
  normal: { maxSymbols: 8, concurrency: 1 },
  watch: { maxSymbols: 6, concurrency: 1 },
  high: { maxSymbols: 4, concurrency: 1 },
  critical: { maxSymbols: 2, concurrency: 1 },
};
const SIGNAL_MONITOR_EVALUATION_PRESSURE_CAPS: Record<
  ApiResourcePressureLevel,
  { maxSymbols: number; concurrency: number }
> = {
  normal: { maxSymbols: 60, concurrency: 2 },
  watch: { maxSymbols: 40, concurrency: 1 },
  high: { maxSymbols: 20, concurrency: 1 },
  critical: { maxSymbols: 8, concurrency: 1 },
};
const signalMonitorReadDbBackoff = createTransientPostgresBackoff();
const runtimeSignalMonitorProfiles = new Map<RuntimeMode, DbSignalMonitorProfile>();
const TIMEFRAME_MS: Record<SignalMonitorMatrixTimeframe, number> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
const COMPLETED_BAR_SAFETY_MS = 2_000;
const MARKET_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type SignalMonitorProfileRow = DbSignalMonitorProfile;

function resolveEnvironment(environment?: RuntimeMode): RuntimeMode {
  return environment ?? getRuntimeMode();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function resolveSignalMonitorTimeframe(
  value: unknown,
  fallback = DEFAULT_SIGNAL_MONITOR_TIMEFRAME,
): SignalMonitorTimeframe {
  const resolved = String(value || "").trim() as SignalMonitorTimeframe;
  return SIGNAL_MONITOR_TIMEFRAMES.includes(resolved) ? resolved : fallback;
}

export function withSignalMonitorUniverseScope(
  settings: Record<string, unknown>,
  universeScope: string,
): Record<string, unknown> {
  return {
    ...asRecord(settings),
    [SIGNAL_MONITOR_UNIVERSE_SCOPE_KEY]: universeScope,
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
    raw === "all_watchlists_plus_universe"
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

function parseSignalMatrixTimeframes(value: unknown): SignalMonitorMatrixTimeframe[] {
  const input = Array.isArray(value) ? value : SIGNAL_MONITOR_MATRIX_TIMEFRAMES;
  const normalized = input
    .map((item) => String(item || "").trim() as SignalMonitorMatrixTimeframe)
    .filter((item) => SIGNAL_MONITOR_MATRIX_TIMEFRAMES.includes(item));
  return Array.from(new Set(normalized)).length
    ? Array.from(new Set(normalized))
    : [...SIGNAL_MONITOR_MATRIX_TIMEFRAMES];
}

function mbFromBytes(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function cappedSignalMatrixSettings(
  profile: SignalMonitorProfileRow,
  pressureLevel?: ApiResourcePressureLevel,
) {
  const resourcePressureLevel =
    pressureLevel ??
    updateApiResourcePressure({
      rssMb: mbFromBytes(process.memoryUsage().rss),
    }).level;
  const caps = SIGNAL_MONITOR_MATRIX_PRESSURE_CAPS[resourcePressureLevel];
  return {
    pressure: resourcePressureLevel,
    maxSymbols: Math.min(
      positiveInteger(profile.maxSymbols, 8, 1, 250),
      caps.maxSymbols,
    ),
    concurrency: Math.min(
      positiveInteger(profile.evaluationConcurrency, 1, 1, 10),
      caps.concurrency,
    ),
  };
}

export function cappedSignalMonitorEvaluationProfile(
  profile: DbSignalMonitorProfile,
  pressureLevel?: ApiResourcePressureLevel,
) {
  const resourcePressureLevel =
    pressureLevel ??
    updateApiResourcePressure({
      rssMb: mbFromBytes(process.memoryUsage().rss),
    }).level;
  const caps = SIGNAL_MONITOR_EVALUATION_PRESSURE_CAPS[resourcePressureLevel];
  const configuredMaxSymbols = positiveInteger(
    profile.maxSymbols,
    DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
    1,
    250,
  );
  const configuredConcurrency = positiveInteger(
    profile.evaluationConcurrency,
    DEFAULT_SIGNAL_MONITOR_EVALUATION_CONCURRENCY,
    1,
    10,
  );
  const maxSymbols = Math.min(configuredMaxSymbols, caps.maxSymbols);
  const evaluationConcurrency = Math.min(
    configuredConcurrency,
    caps.concurrency,
  );

  return {
    pressure: resourcePressureLevel,
    capped:
      maxSymbols < configuredMaxSymbols ||
      evaluationConcurrency < configuredConcurrency,
    profile: {
      ...profile,
      maxSymbols,
      evaluationConcurrency,
    },
  };
}

function positiveInteger(value: unknown, fallback: number, min: number, max: number) {
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

function stateToResponse(state: DbSignalMonitorSymbolState) {
  const direction =
    state.currentSignalDirection === "buy" ||
    state.currentSignalDirection === "sell"
      ? state.currentSignalDirection
      : null;
  const status: SignalMonitorStatus = [
    "ok",
    "stale",
    "unavailable",
    "error",
    "unknown",
  ].includes(state.status)
    ? (state.status as SignalMonitorStatus)
    : "unknown";

  return {
    id: state.id,
    profileId: state.profileId,
    symbol: state.symbol,
    timeframe: resolveSignalMonitorTimeframe(state.timeframe),
    currentSignalDirection: direction,
    currentSignalAt: state.currentSignalAt ?? null,
    currentSignalPrice: numericValueOrNull(state.currentSignalPrice),
    latestBarAt: state.latestBarAt ?? null,
    barsSinceSignal: state.barsSinceSignal ?? null,
    fresh: state.fresh,
    status,
    active: state.active,
    lastEvaluatedAt: state.lastEvaluatedAt ?? null,
    lastError: state.lastError ?? null,
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

const runtimeSignalMonitorEvents = new Map<RuntimeMode, SignalMonitorEventResponse[]>();
const runtimeSignalMonitorEvaluationCache = new Map<
  string,
  { expiresAt: number; value: unknown }
>();
const runtimeSignalMonitorEvaluationInFlight = new Map<string, Promise<unknown>>();
const signalMonitorMatrixEvaluationCache = new Map<
  string,
  { freshUntil: number; staleUntil: number; value: unknown }
>();
const signalMonitorMatrixEvaluationInFlight = new Map<string, Promise<unknown>>();
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
const signalMonitorCompletedBarsCounters = {
  hit: 0,
  staleHit: 0,
  miss: 0,
  inFlightJoin: 0,
};

async function withRuntimeSignalMonitorEvaluationCache<T>(
  key: string,
  factory: () => Promise<T>,
  options: { onCacheStatus?: (status: SignalMonitorMatrixCacheStatus) => void } = {},
): Promise<T> {
  const nowMs = Date.now();
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

function clearRuntimeSignalMonitorEvaluationCache(environment: RuntimeMode): void {
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

function clearSignalMonitorMatrixEvaluationCache(environment?: RuntimeMode): void {
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
    nowMs - Number(previousSeenAt) < SIGNAL_MONITOR_MATRIX_AUTOMATIC_DEBOUNCE_MS;
  signalMonitorMatrixAutomaticRequestSeenAt.set(key, nowMs);

  return { automatic: true, debounced };
}

function getDebouncedSignalMonitorMatrixCacheValue<T>(
  key: string,
  nowMs = Date.now(),
): { value: T; cacheStatus: SignalMonitorMatrixCacheStatus } | null {
  const cached = signalMonitorMatrixEvaluationCache.get(key);
  if (!cached || cached.staleUntil <= nowMs) {
    return null;
  }
  return {
    value: cached.value as T,
    cacheStatus: cached.freshUntil > nowMs ? "hit" : "stale",
  };
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
  const cached = signalMonitorMatrixEvaluationCache.get(key);
  if (cached && cached.freshUntil > nowMs) {
    options.onCacheStatus?.("hit");
    return cached.value as T;
  }

  const inFlight = signalMonitorMatrixEvaluationInFlight.get(key);
  if (inFlight) {
    if (cached && cached.staleUntil > nowMs) {
      options.onCacheStatus?.("stale");
      return cached.value as T;
    }
    options.onCacheStatus?.("inflight");
    return inFlight as Promise<T>;
  }

  const request = factory()
    .then((value) => {
      const completedAt = Date.now();
      signalMonitorMatrixEvaluationCache.set(key, {
        value,
        freshUntil: completedAt + SIGNAL_MONITOR_MATRIX_CACHE_TTL_MS,
        staleUntil: completedAt + SIGNAL_MONITOR_MATRIX_STALE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      if (signalMonitorMatrixEvaluationInFlight.get(key) === request) {
        signalMonitorMatrixEvaluationInFlight.delete(key);
      }
    });
  signalMonitorMatrixEvaluationInFlight.set(key, request);

  if (cached && cached.staleUntil > nowMs) {
    options.onCacheStatus?.("stale");
    void request.catch((error) => {
      logger.warn({ err: error }, "Signal monitor matrix background refresh failed");
    });
    return cached.value as T;
  }

  options.onCacheStatus?.("miss");
  return request;
}

function warnSignalMonitorDbUnavailable(error: unknown): void {
  signalMonitorReadDbBackoff.markFailure({
    error,
    logger,
    message: "Signal monitor database unavailable; serving degraded response",
    nowMs: Date.now(),
  });
}

function isSignalMonitorDbBackoffActive(): boolean {
  return signalMonitorReadDbBackoff.isActive(Date.now());
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
    updated.pyrusSignalsSettings = asRecord(input.pyrusSignalsSettings);
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
  if (input.maxSymbols !== undefined) {
    updated.maxSymbols = positiveInteger(
      input.maxSymbols,
      DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
      1,
      250,
    );
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

export function createSignalMonitorDbUnavailableError(error?: unknown): HttpError {
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
    return existing;
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
  return fallback;
}

export async function getSignalMonitorProfileRow(input: {
  environment?: RuntimeMode;
  ensureWatchlist?: boolean;
}) {
  const profile = await getOrCreateProfile(resolveEnvironment(input.environment));
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

function resolveWatchlistSymbols(watchlist: WatchlistRecord, maxSymbols: number) {
  return resolveSymbolUniverse(
    watchlist.items.map((item) => item.symbol),
    maxSymbols,
  );
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

function resolveSymbolUniverse(
  sourceSymbols: string[],
  maxSymbols: number,
): ResolvedSymbolUniverse {
  const uniqueSymbols = Array.from(
    new Set(
      sourceSymbols.map((symbol) => normalizeSymbol(symbol).toUpperCase()).filter(Boolean),
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
}): SignalMonitorEvaluationBatch {
  const allSymbols = resolveSymbolUniverse(
    input.sourceSymbols,
    Number.MAX_SAFE_INTEGER,
  ).symbols;
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

function signalMonitorEvaluationRotationKey(input: {
  profile: Pick<DbSignalMonitorProfile, "id" | "environment" | "timeframe">;
  timeframe: SignalMonitorTimeframe;
}) {
  return [
    input.profile.environment,
    input.profile.id,
    input.timeframe,
  ].join(":");
}

function resolveSignalMonitorUniverseFromWatchlists(input: {
  profile: Pick<DbSignalMonitorProfile, "watchlistId" | "maxSymbols" | "pyrusSignalsSettings">;
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
  const selectedWatchlist =
    input.profile.watchlistId
      ? input.watchlists.find((candidate) => candidate.id === input.profile.watchlistId) ??
        null
      : input.ensureWatchlist === false
        ? null
        : input.watchlists.find((candidate) => candidate.isDefault) ??
          input.watchlists[0] ??
          null;
  const selectedWatchlistSymbols = selectedWatchlist
    ? selectedWatchlist.items.map((item) => item.symbol)
    : [];
  const pinnedSourceSymbols =
    universeScope === "selected_watchlist"
      ? selectedWatchlistSymbols
      : allWatchlistSymbols;
  const sourceSymbols =
    universeScope === "all_watchlists_plus_universe"
      ? [
          ...pinnedSourceSymbols,
          ...(input.expansionUniverse?.symbols ?? []),
        ]
      : pinnedSourceSymbols;
  const resolved = resolveSymbolUniverse(sourceSymbols, input.profile.maxSymbols);
  const pinnedSet = new Set(resolveSymbolUniverse(pinnedSourceSymbols, Number.MAX_SAFE_INTEGER).symbols);
  const expansionSymbols = resolved.symbols.filter((symbol) => !pinnedSet.has(symbol)).length;
  const fallbackUsed = Boolean(
    fallbackWatchlists || input.expansionUniverse?.fallbackUsed,
  );
  const source: SignalMonitorUniverseSource =
    universeScope === "selected_watchlist"
      ? "selected_watchlist"
      : universeScope === "all_watchlists"
        ? "all_watchlists"
        : "watchlists_plus_ranked_universe";

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
      shortfall: Math.max(0, input.profile.maxSymbols - resolved.symbols.length),
      source,
      fallbackUsed,
      degradedReason:
        input.expansionUniverse?.degradedReason ??
        (fallbackWatchlists ? "Signal monitor watchlists are using runtime fallback data." : null),
      rankedAt: input.expansionUniverse?.rankedAt ?? null,
    },
  };
}

function applyHistoricalBarsLanePolicy(input: {
  universe: ResolvedSignalMonitorUniverse;
  expansionUniverse?: SignalMonitorExpansionUniverse | null;
}): ResolvedSignalMonitorUniverse {
  const resolution = resolveIbkrLaneSymbols("historical-bars", {
    watchlists: input.universe.watchlistSymbols,
    "flow-universe": input.expansionUniverse?.symbols ?? [],
  });
  if (!resolution.enabled) {
    return {
      ...input.universe,
      symbols: [],
      watchlistSymbols: [],
      skippedSymbols: Array.from(
        new Set([...input.universe.skippedSymbols, ...input.universe.watchlistSymbols]),
      ),
      truncated: true,
      universe: {
        ...input.universe.universe,
        resolvedSymbols: 0,
        shortfall: input.universe.universe.configuredMaxSymbols,
        degradedReason: "Historical Bars lane policy is disabled.",
      },
    };
  }

  const admitted = new Set(resolution.admittedSymbols);
  const filteredWatchlistSymbols = input.universe.watchlistSymbols.filter((symbol) =>
    admitted.has(symbol),
  );
  const filteredSymbols = input.universe.symbols.filter((symbol) => admitted.has(symbol));
  const droppedSymbols = resolution.droppedSymbols
    .filter((entry) => entry.reason === "capacity" || entry.reason === "excluded")
    .map((entry) => entry.symbol);
  const skippedSymbols = Array.from(
    new Set([...input.universe.skippedSymbols, ...droppedSymbols]),
  );
  const truncated = input.universe.truncated || skippedSymbols.length > 0;

  return {
    ...input.universe,
    symbols: filteredSymbols,
    watchlistSymbols: filteredWatchlistSymbols,
    skippedSymbols,
    truncated,
    universe: {
      ...input.universe.universe,
      resolvedSymbols: filteredWatchlistSymbols.length,
      shortfall: Math.max(
        0,
        input.universe.universe.configuredMaxSymbols - filteredWatchlistSymbols.length,
      ),
      degradedReason:
        droppedSymbols.length > 0
          ? `Historical Bars lane is dropping ${droppedSymbols.length} symbol${droppedSymbols.length === 1 ? "" : "s"} at its current policy.`
          : input.universe.universe.degradedReason,
    },
  };
}

function loadSignalMonitorExpansionUniverse(): SignalMonitorExpansionUniverse {
  try {
    const universe = getOptionsFlowUniverse();
    const coverage = universe.coverage ?? {};
    const symbols = Array.isArray(universe.sources?.flowUniverseSymbols)
      ? universe.sources.flowUniverseSymbols
      : universe.symbols ?? [];
    return {
      symbols,
      fallbackUsed: Boolean(coverage.fallbackUsed),
      degradedReason: coverage.degradedReason ?? null,
      rankedAt: dateOrNull(coverage.rankedAt ?? coverage.lastGoodAt ?? null),
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
  const expansionUniverse =
    universeScope === "all_watchlists_plus_universe"
      ? loadSignalMonitorExpansionUniverse()
      : null;
  const universe = resolveSignalMonitorUniverseFromWatchlists({
    profile: hydratedProfile,
    watchlists,
    ensureWatchlist: options.ensureWatchlist,
    expansionUniverse,
  });
  const historicalUniverse = applyHistoricalBarsLanePolicy({
    universe,
    expansionUniverse,
  });

  return {
    profile: hydratedProfile,
    ...historicalUniverse,
  };
}

export function getSignalMonitorTimeframeMs(
  timeframe: SignalMonitorTimeframe,
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

export function isSignalMonitorBarComplete(input: {
  timestamp: Date;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}): boolean {
  if (input.timeframe === "1d") {
    return dailyBarDateKey(input.timestamp) < marketDateKey(input.evaluatedAt);
  }

  return (
    input.timestamp.getTime() +
      TIMEFRAME_MS[input.timeframe] +
      COMPLETED_BAR_SAFETY_MS <=
    input.evaluatedAt.getTime()
  );
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

  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  const completedBoundaryMs =
    Math.floor(
      (input.evaluatedAt.getTime() - COMPLETED_BAR_SAFETY_MS) / timeframeMs,
    ) * timeframeMs;
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
    return timestamp
      ? isSignalMonitorBarComplete({ timestamp, timeframe, evaluatedAt })
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
    if (timestamp) {
      byTimestamp.set(timestamp.getTime(), bar);
    }
  });
  return Array.from(byTimestamp.entries())
    .sort(([left], [right]) => left - right)
    .map(([, bar]) => bar)
    .slice(-limit);
}

export function aggregateCompletedMinuteBars(
  inputBars: Awaited<ReturnType<typeof getBars>>["bars"],
  timeframe: SignalMonitorMatrixTimeframe,
  evaluatedAt: Date,
) {
  if (timeframe !== "2m") {
    return inputBars;
  }

  const grouped = new Map<number, Awaited<ReturnType<typeof getBars>>["bars"]>();
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
      return timestamp
        ? isSignalMonitorBarComplete({ timestamp, timeframe: "2m", evaluatedAt })
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

  const grouped = new Map<number, Awaited<ReturnType<typeof getBars>>["bars"]>();
  filterCompletedBars(inputBars, "5m", evaluatedAt).forEach((bar) => {
    const timestamp = dateOrNull(bar.timestamp);
    if (!timestamp) return;
    const bucket =
      Math.floor(timestamp.getTime() / TIMEFRAME_MS["15m"]) * TIMEFRAME_MS["15m"];
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
      return timestamp
        ? isSignalMonitorBarComplete({ timestamp, timeframe: "15m", evaluatedAt })
        : false;
    });
}

function barsToPyrusSignalsBars(inputBars: Awaited<ReturnType<typeof getBars>>["bars"]) {
  return inputBars
    .map((bar): PyrusSignalsBar | null => {
      const timestamp = dateOrNull(bar.timestamp);
      if (!timestamp) {
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

function isLatestBarStale(input: {
  latestBarAt: Date;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}) {
  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  const minimumWindowMs =
    input.timeframe === "1d" ? 4 * TIMEFRAME_MS["1d"] : 15 * 60_000;
  const staleWindowMs = Math.max(timeframeMs * 4, minimumWindowMs);
  return input.evaluatedAt.getTime() - input.latestBarAt.getTime() > staleWindowMs;
}

function isSignalMonitorStateCurrentForLane(input: {
  state: Pick<
    DbSignalMonitorSymbolState,
    "latestBarAt" | "lastEvaluatedAt" | "status"
  >;
  timeframe: SignalMonitorTimeframe;
  evaluatedAt: Date;
}) {
  if (input.state.status !== "ok") {
    return false;
  }
  const latestBarAt = dateOrNull(input.state.latestBarAt);
  const lastEvaluatedAt = dateOrNull(input.state.lastEvaluatedAt);
  if (!latestBarAt || !lastEvaluatedAt) {
    return false;
  }
  if (
    isLatestBarStale({
      latestBarAt,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    })
  ) {
    return false;
  }

  const timeframeMs = TIMEFRAME_MS[input.timeframe];
  const minimumWindowMs =
    input.timeframe === "1d" ? 4 * TIMEFRAME_MS["1d"] : 30 * 60_000;
  const evaluationWindowMs = Math.max(timeframeMs * 6, minimumWindowMs);
  return (
    input.evaluatedAt.getTime() - lastEvaluatedAt.getTime() <=
    evaluationWindowMs
  );
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
  const source = String(bar.source ?? "").toLowerCase();
  return (
    bar.delayed === true ||
    freshness === "delayed" ||
    marketDataMode === "delayed" ||
    source.includes("massive") ||
    source.includes("polygon")
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
  const latestBarAt = latestBar ? dateOrNull(latestBar.timestamp) : null;
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

function directionFromSignal(signal: PyrusSignalsSignalEvent): SignalMonitorDirection {
  return signal.eventType === "buy_signal" ? "buy" : "sell";
}

async function insertSignalEvent(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  signal: PyrusSignalsSignalEvent;
  latestBarAt: Date;
}) {
  const direction = directionFromSignal(input.signal);
  const eventKey = [
    input.profile.id,
    input.symbol,
    input.timeframe,
    direction,
    input.signal.time,
  ].join(":");

  await db
    .insert(signalMonitorEventsTable)
    .values({
      profileId: input.profile.id,
      eventKey,
      environment: input.profile.environment,
      symbol: input.symbol,
      timeframe: input.timeframe,
      direction,
      signalAt: new Date(input.signal.time * 1000),
      signalPrice: numericStringOrNull(input.signal.price),
      close: numericStringOrNull(input.signal.close),
      source: "pyrus-signals",
      payload: {
        signalId: input.signal.id,
        barIndex: input.signal.barIndex,
        latestBarAt: input.latestBarAt.toISOString(),
        filterState: input.signal.filterState,
      },
    })
    .onConflictDoNothing();
}

async function insertSignalEventBestEffort(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  signal: PyrusSignalsSignalEvent;
  latestBarAt: Date;
}) {
  try {
    await insertSignalEvent(input);
  } catch (error) {
    logger.warn(
      {
        err: error,
        symbol: input.symbol,
        timeframe: input.timeframe,
        profileId: input.profile.id,
      },
      "Signal monitor event persistence failed",
    );
  }
}

async function upsertSymbolState(input: {
  profileId: string;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  direction: SignalMonitorDirection | null;
  signalAt: Date | null;
  signalPrice: number | null;
  latestBarAt: Date | null;
  barsSinceSignal: number | null;
  fresh: boolean;
  status: SignalMonitorStatus;
  evaluatedAt: Date;
  lastError?: string | null;
}) {
  const values = {
    profileId: input.profileId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    currentSignalDirection: input.direction,
    currentSignalAt: input.signalAt,
    currentSignalPrice: numericStringOrNull(input.signalPrice),
    latestBarAt: input.latestBarAt,
    barsSinceSignal: input.barsSinceSignal,
    fresh: input.fresh,
    status: input.status,
    active: true,
    lastEvaluatedAt: input.evaluatedAt,
    lastError: input.lastError ?? null,
    updatedAt: input.evaluatedAt,
  };

  const [state] = await db
    .insert(signalMonitorSymbolStatesTable)
    .values(values)
    .onConflictDoUpdate({
      target: [
        signalMonitorSymbolStatesTable.profileId,
        signalMonitorSymbolStatesTable.symbol,
        signalMonitorSymbolStatesTable.timeframe,
      ],
      set: values,
    })
    .returning();

  return state;
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
  providerTimeframe: SignalMonitorTimeframe;
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
    return cloneCompletedBarsSnapshot(cached.value);
  }
  if (cached.staleExpiresAt > nowMs) {
    signalMonitorCompletedBarsCounters.staleHit += 1;
    return cloneCompletedBarsSnapshot(cached.value);
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

function shouldBypassSignalMonitorCompletedBarsCache(input: {
  cached: SignalMonitorCompletedBarsSnapshot;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  retryStale?: boolean;
}): boolean {
  return (
    input.retryStale !== false &&
    shouldRetrySignalMonitorCompletedBars({
      completedBars: input.cached.bars,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    })
  );
}

export async function loadSignalMonitorCompletedBars(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  limit?: number;
  retryStale?: boolean;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
}): Promise<SignalMonitorCompletedBarsSnapshot> {
  const barSourcePolicy =
    input.barSourcePolicy ?? DEFAULT_SIGNAL_MONITOR_BAR_SOURCE_POLICY;
  const providerTimeframe: SignalMonitorTimeframe =
    input.timeframe === "2m" ? "1m" : input.timeframe;
  const providerLimit =
    input.timeframe === "2m"
      ? (input.limit ?? PYRUS_SIGNALS_SIGNAL_WARMUP_BARS) * 2 + 4
      : input.limit ?? PYRUS_SIGNALS_SIGNAL_WARMUP_BARS;
  const completedLimit = input.limit ?? PYRUS_SIGNALS_SIGNAL_WARMUP_BARS;
  const queryTo = signalMonitorCompletedBarsQueryTo({
    timeframe: providerTimeframe,
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
  const inFlight = signalMonitorCompletedBarsInFlight.get(cacheKey);
  if (inFlight) {
    signalMonitorCompletedBarsCounters.inFlightJoin += 1;
    return cloneCompletedBarsSnapshot(await inFlight);
  }
  signalMonitorCompletedBarsCounters.miss += 1;
  const fetchBars = (mode: "primary" | "full-retry" | "live-edge") => {
    const priority =
      mode === "live-edge"
        ? SIGNAL_MONITOR_LIVE_EDGE_BARS_PRIORITY
        : SIGNAL_MONITOR_BARS_PRIORITY;
    return getBarsWithDebug(
      {
        symbol: input.symbol,
        timeframe: providerTimeframe,
        limit: mode === "live-edge"
          ? Math.min(
              providerLimit,
              input.timeframe === "2m"
                ? SIGNAL_MONITOR_STALE_RETRY_BARS * 2
                : SIGNAL_MONITOR_STALE_RETRY_BARS,
            )
          : providerLimit,
        to: queryTo,
        assetClass: "equity",
        outsideRth: true,
        source: "trades",
        allowHistoricalSynthesis:
          barSourcePolicy === "ibkr-only" ? false : mode !== "live-edge",
        brokerRecentWindowMinutes: mode === "primary"
          ? null
          : SIGNAL_MONITOR_STALE_RETRY_BROKER_WINDOW_MINUTES,
      },
      {
        priority,
        family: SIGNAL_MONITOR_BARS_FAMILY,
      },
    );
  };
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
    return input.timeframe === "2m"
      ? aggregateCompletedMinuteBars(sourceFilteredBars, "2m", input.evaluatedAt)
      : filterCompletedBars(
          sourceFilteredBars,
          input.timeframe,
          input.evaluatedAt,
        );
  };
  const fetchCompletedBars = async (
    mode: "primary" | "full-retry" | "live-edge",
  ) => buildCompletedBars((await fetchBars(mode)).bars);

  const request = (async () => {
    completedBars = await fetchCompletedBars("primary");
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
      latestBar = completedBars.at(-1);
    }
    if (
      input.retryStale !== false &&
      shouldRetrySignalMonitorCompletedBars({
        completedBars,
        timeframe: input.timeframe,
        evaluatedAt: input.evaluatedAt,
      })
    ) {
      acceptNewerBars(await fetchCompletedBars("live-edge"), true);
      latestBar = completedBars.at(-1);
    }
    const snapshot = {
      bars: completedBars,
      latestBarAt: latestBar ? dateOrNull(latestBar.timestamp) : null,
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
}) {
  try {
    const chartBars = barsToPyrusSignalsBars(input.completedBars);
    const latestBar = chartBars.at(-1);

    if (!latestBar) {
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
      includeProvisionalSignals: false,
    });
    const signal = evaluation.signalEvents.at(-1) ?? null;
    const latestBarAt = new Date(latestBar.time * 1000);
    const latestSourceBar = input.completedBars.at(-1);
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
      return upsertSymbolState({
        profileId: input.profile.id,
        symbol: input.symbol,
        timeframe: input.timeframe,
        direction: null,
        signalAt: null,
        signalPrice: null,
        latestBarAt,
        barsSinceSignal: null,
        fresh: false,
        status: stale ? "stale" : "ok",
        evaluatedAt: input.evaluatedAt,
        lastError: delayedLatestBarError,
      });
    }

    const barsSinceSignal = Math.max(0, chartBars.length - 1 - signal.barIndex);
    const fresh = barsSinceSignal <= input.profile.freshWindowBars && !stale;
    const signalAt = new Date(signal.time * 1000);

    if (input.mode === "incremental" && fresh) {
      await insertSignalEventBestEffort({
        profile: input.profile,
        symbol: input.symbol,
        timeframe: input.timeframe,
        signal,
        latestBarAt,
      });
    }

    return upsertSymbolState({
      profileId: input.profile.id,
      symbol: input.symbol,
      timeframe: input.timeframe,
      direction: directionFromSignal(signal),
      signalAt,
      signalPrice: signal.price,
      latestBarAt,
      barsSinceSignal,
      fresh,
      status: stale ? "stale" : "ok",
      evaluatedAt: input.evaluatedAt,
      lastError: delayedLatestBarError,
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
}) {
  try {
    const completedBars = await loadSignalMonitorCompletedBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
      barSourcePolicy: input.barSourcePolicy,
    });

    return evaluateSignalMonitorSymbolFromCompletedBars({
      ...input,
      completedBars: completedBars.bars,
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
      latestBarAt: null,
      barsSinceSignal: null,
      fresh: false,
      status: "error",
      evaluatedAt: input.evaluatedAt,
      lastError: message,
    });
  }
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
  };
  const chartBars = barsToPyrusSignalsBars(input.completedBars);
  const latestBar = chartBars.at(-1);

  if (!latestBar) {
    return {
      ...base,
      currentSignalDirection: null,
      currentSignalAt: null,
      currentSignalPrice: null,
      latestBarAt: null,
      barsSinceSignal: null,
      fresh: false,
      status: "unavailable" as SignalMonitorStatus,
      lastError: "No broker history bars were available for this symbol.",
    };
  }

  const settings = resolvePyrusSignalsSignalSettings(
    asRecord(input.profile.pyrusSignalsSettings),
  );
  const evaluation = evaluatePyrusSignalsSignals({
    chartBars,
    settings,
    includeProvisionalSignals: false,
  });
  const signal = evaluation.signalEvents.at(-1) ?? null;
  const latestBarAt = new Date(latestBar.time * 1000);
  const latestSourceBar = input.completedBars.at(-1);
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
    return {
      ...base,
      currentSignalDirection: null,
      currentSignalAt: null,
      currentSignalPrice: null,
      latestBarAt,
      barsSinceSignal: null,
      fresh: false,
      status: stale ? "stale" as const : "ok" as const,
      lastError: delayedLatestBarError,
    };
  }

  const barsSinceSignal = Math.max(0, chartBars.length - 1 - signal.barIndex);
  return {
    ...base,
    currentSignalDirection: directionFromSignal(signal),
    currentSignalAt: new Date(signal.time * 1000),
    currentSignalPrice: signal.price,
    latestBarAt,
    barsSinceSignal,
    fresh: barsSinceSignal <= input.profile.freshWindowBars && !stale,
    status: stale ? "stale" as const : "ok" as const,
    lastError: delayedLatestBarError,
  };
}

type SignalMonitorMatrixStateResult =
  ReturnType<typeof evaluateSignalMonitorMatrixStateFromCompletedBars>;

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
    latestBarAt: null,
    barsSinceSignal: null,
    fresh: false,
    status: "error" as SignalMonitorStatus,
    active: true,
    lastEvaluatedAt: input.evaluatedAt,
    lastError: message,
  };
}

async function evaluateSymbolsInBatches(input: {
  profile: DbSignalMonitorProfile;
  symbols: string[];
  timeframe: SignalMonitorTimeframe;
  mode: EvaluationMode;
  evaluatedAt: Date;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
}) {
  const concurrency = positiveInteger(
    input.profile.evaluationConcurrency,
    3,
    1,
    10,
  );
  const states: DbSignalMonitorSymbolState[] = [];

  for (let index = 0; index < input.symbols.length; index += concurrency) {
    const batch = input.symbols.slice(index, index + concurrency);
    const batchStates = await Promise.all(
      batch.map((symbol) =>
        evaluateSignalMonitorSymbol({
          profile: input.profile,
          symbol,
          timeframe: input.timeframe,
          mode: input.mode,
          evaluatedAt: input.evaluatedAt,
          barSourcePolicy: input.barSourcePolicy,
        }),
      ),
    );
    states.push(...batchStates);
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
  const errorCount = input.states.filter((state) => state.status === "error").length;
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
  const evaluationSettings = cappedSignalMonitorEvaluationProfile(input.profile);
  const timeframe = resolveSignalMonitorTimeframe(
    evaluationSettings.profile.timeframe,
  );
  const universe = await resolveSignalMonitorProfileUniverse(evaluationSettings.profile, {
    ensureWatchlist: input.ensureWatchlist,
  });
  const requestedSymbols = input.symbols
    ? new Set(input.symbols.map((symbol) => normalizeSymbol(symbol).toUpperCase()))
    : null;
  const resolvedBatch = requestedSymbols
    ? {
        ...resolveExplicitSignalMonitorSymbols({
          symbols: universe.watchlistSymbols.filter((symbol) =>
            requestedSymbols.has(symbol),
          ),
          maxSymbols: evaluationSettings.profile.maxSymbols,
        }),
        nextCursor: 0,
      }
    : resolveSignalMonitorEvaluationBatch({
        sourceSymbols: universe.watchlistSymbols,
        maxSymbols: evaluationSettings.profile.maxSymbols,
        cursor: signalMonitorEvaluationRotationCursors.get(
          signalMonitorEvaluationRotationKey({
            profile: universe.profile,
            timeframe,
          }),
        ),
      });
  if (!requestedSymbols) {
    signalMonitorEvaluationRotationCursors.set(
      signalMonitorEvaluationRotationKey({
        profile: universe.profile,
        timeframe,
      }),
      resolvedBatch.nextCursor,
    );
  }
  const symbols = resolvedBatch.symbols;
  const shouldDeactivateMissing =
    input.deactivateMissing !== false &&
    !evaluationSettings.capped &&
    !resolvedBatch.truncated &&
    !universe.fallbackWatchlists &&
    !universe.fallbackUsed &&
    !requestedSymbols;

  const evaluatedStates = await evaluateSymbolsInBatches({
    profile: universe.profile,
    symbols,
    timeframe,
    mode,
    evaluatedAt,
    barSourcePolicy: input.barSourcePolicy,
  });
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
    if (symbols.length) {
      await db
        .update(signalMonitorSymbolStatesTable)
        .set(inactivePatch)
        .where(
          and(
            eq(signalMonitorSymbolStatesTable.profileId, universe.profile.id),
            ne(signalMonitorSymbolStatesTable.timeframe, timeframe),
          ),
        );
    }
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

export async function evaluateSignalMonitorProfileSymbols(input: {
  profile: DbSignalMonitorProfile;
  mode?: EvaluationMode;
  evaluatedAt?: Date;
  symbols: string[];
  maxSymbolsOverride?: number;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
}) {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const mode = input.mode ?? "incremental";
  const evaluationSettings = cappedSignalMonitorEvaluationProfile(input.profile);
  const maxSymbols =
    input.maxSymbolsOverride === undefined
      ? evaluationSettings.profile.maxSymbols
      : Math.max(
          0,
          Math.min(
            evaluationSettings.profile.maxSymbols,
            250,
            Math.floor(Number(input.maxSymbolsOverride) || 0),
          ),
        );
  const evaluationProfile = {
    ...evaluationSettings.profile,
    maxSymbols,
  };
  const timeframe = resolveSignalMonitorTimeframe(
    evaluationProfile.timeframe,
  );
  const resolved = resolveExplicitSignalMonitorSymbols({
    symbols: input.symbols,
    maxSymbols,
  });

  const evaluatedStates = await evaluateSymbolsInBatches({
    profile: evaluationProfile,
    symbols: resolved.symbols,
    timeframe,
    mode,
    evaluatedAt,
    barSourcePolicy: input.barSourcePolicy,
  });
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
    universe: {
      mode: "selected_watchlist",
      configuredMaxSymbols: maxSymbols,
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
  const requestedWatchlist =
    input.watchlistId
      ? input.watchlists.find((watchlist) => watchlist.id === input.watchlistId) ?? null
      : null;
  const sourceSymbols = requestedWatchlist
    ? requestedWatchlist.items.map((item) => item.symbol)
    : input.symbols ?? [];
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
}) {
  const timeframes = parseSignalMatrixTimeframes(input.timeframes);
  const states: SignalMonitorMatrixStateResult[] = [];
  let sourceRequestCount = 0;

  if (timeframes.includes("2m")) {
    try {
      sourceRequestCount += 1;
      const completedBars = await loadSignalMonitorCompletedBars({
        symbol: input.symbol,
        timeframe: "2m",
        evaluatedAt: input.evaluatedAt,
        limit: SIGNAL_MONITOR_MATRIX_BARS_LIMIT,
        retryStale: false,
      });
      states.push(
        evaluateSignalMonitorMatrixStateFromCompletedBars({
          profile: input.profile,
          symbol: input.symbol,
          timeframe: "2m",
          evaluatedAt: input.evaluatedAt,
          completedBars: completedBars.bars,
        }),
      );
    } catch (error) {
      states.push(
        buildSignalMonitorMatrixErrorState({
          profile: input.profile,
          symbol: input.symbol,
          timeframe: "2m",
          evaluatedAt: input.evaluatedAt,
          error,
        }),
      );
    }
  }

  const needsFiveMinuteSource = timeframes.includes("5m") || timeframes.includes("15m");
  if (needsFiveMinuteSource) {
    try {
      sourceRequestCount += 1;
      const completedBars = await loadSignalMonitorCompletedBars({
        symbol: input.symbol,
        timeframe: "5m",
        evaluatedAt: input.evaluatedAt,
        limit: SIGNAL_MONITOR_MATRIX_5M_SOURCE_LIMIT,
        retryStale: false,
      });
      if (timeframes.includes("5m")) {
        states.push(
          evaluateSignalMonitorMatrixStateFromCompletedBars({
            profile: input.profile,
            symbol: input.symbol,
            timeframe: "5m",
            evaluatedAt: input.evaluatedAt,
            completedBars: completedBars.bars.slice(-SIGNAL_MONITOR_MATRIX_BARS_LIMIT),
          }),
        );
      }
      if (timeframes.includes("15m")) {
        states.push(
          evaluateSignalMonitorMatrixStateFromCompletedBars({
            profile: input.profile,
            symbol: input.symbol,
            timeframe: "15m",
            evaluatedAt: input.evaluatedAt,
            completedBars: aggregateCompletedFiveMinuteBars(
              completedBars.bars,
              "15m",
              input.evaluatedAt,
            ).slice(-SIGNAL_MONITOR_MATRIX_BARS_LIMIT),
          }),
        );
      }
    } catch (error) {
      (["5m", "15m"] as const)
        .filter((timeframe) => timeframes.includes(timeframe))
        .forEach((timeframe) => {
          states.push(
            buildSignalMonitorMatrixErrorState({
              profile: input.profile,
              symbol: input.symbol,
              timeframe,
              evaluatedAt: input.evaluatedAt,
              error,
            }),
          );
        });
    }
  }

  const stateByTimeframe = new Map(states.map((state) => [state.timeframe, state]));
  return {
    states: timeframes
      .map((timeframe) => stateByTimeframe.get(timeframe))
      .filter((state): state is SignalMonitorMatrixStateResult => Boolean(state)),
    sourceRequestCount,
  };
}

function withSignalMonitorMatrixMetadata<T extends {
  states: unknown[];
  timeframes: SignalMonitorMatrixTimeframe[];
  skippedSymbols: string[];
  truncated: boolean;
  sourceRequestCount?: number;
}>(
  value: T,
  input: {
    cacheStatus: SignalMonitorMatrixCacheStatus;
    requestedSymbols: string[];
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
  const stateBySymbol = new Map<string, Set<SignalMonitorMatrixTimeframe>>();
  value.states.forEach((state) => {
    if (!state || typeof state !== "object") {
      return;
    }
    const symbol = normalizeSymbol((state as { symbol?: unknown }).symbol as string);
    const timeframe = String(
      (state as { timeframe?: unknown }).timeframe || "",
    ) as SignalMonitorMatrixTimeframe;
    const latestBarAt = dateOrNull((state as { latestBarAt?: unknown }).latestBarAt);
    if (!symbol || !value.timeframes.includes(timeframe) || !latestBarAt) {
      return;
    }
    const set = stateBySymbol.get(symbol) ?? new Set<SignalMonitorMatrixTimeframe>();
    set.add(timeframe);
    stateBySymbol.set(symbol, set);
  });
  const hydratedSymbols = requestedSymbols.filter((symbol) => {
    const hydratedTimeframes = stateBySymbol.get(symbol);
    return value.timeframes.every((timeframe) => hydratedTimeframes?.has(timeframe));
  }).length;

  return {
    ...value,
    cacheStatus: input.cacheStatus,
    refreshing: input.cacheStatus === "stale" || input.cacheStatus === "inflight",
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

async function evaluateSignalMonitorRuntimeSymbol(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  evaluatedAt: Date;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
}) {
  try {
    const completedBars = await loadSignalMonitorCompletedBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
      barSourcePolicy: input.barSourcePolicy,
    });
    return evaluateSignalMonitorMatrixStateFromCompletedBars({
      ...input,
      completedBars: completedBars.bars,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Signal evaluation failed.";
    return {
      id: `${input.profile.id}:${input.symbol}:${input.timeframe}`,
      profileId: input.profile.id,
      symbol: input.symbol,
      timeframe: input.timeframe,
      currentSignalDirection: null,
      currentSignalAt: null,
      currentSignalPrice: null,
      latestBarAt: null,
      barsSinceSignal: null,
      fresh: false,
      status: "error" as SignalMonitorStatus,
      active: true,
      lastEvaluatedAt: input.evaluatedAt,
      lastError: message,
    };
  }
}

async function evaluateRuntimeSymbolsInBatches(input: {
  profile: DbSignalMonitorProfile;
  symbols: string[];
  timeframe: SignalMonitorTimeframe;
  evaluatedAt: Date;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
}) {
  const concurrency = positiveInteger(
    input.profile.evaluationConcurrency,
    3,
    1,
    10,
  );
  const states = [];

  for (let index = 0; index < input.symbols.length; index += concurrency) {
    const batch = input.symbols.slice(index, index + concurrency);
    const batchStates = await Promise.all(
      batch.map((symbol) =>
        evaluateSignalMonitorRuntimeSymbol({
          profile: input.profile,
          symbol,
          timeframe: input.timeframe,
          evaluatedAt: input.evaluatedAt,
          barSourcePolicy: input.barSourcePolicy,
        }),
      ),
    );
    states.push(...batchStates);
  }

  return states;
}

function recordRuntimeSignalEvents(input: {
  profile: DbSignalMonitorProfile;
  states: Awaited<ReturnType<typeof evaluateRuntimeSymbolsInBatches>>;
  evaluatedAt: Date;
  mode: EvaluationMode;
}) {
  const current = runtimeSignalMonitorEvents.get(input.profile.environment) ?? [];
  const events = [...current];
  const existingIds = new Set(events.map((event) => event.id));

  for (const state of input.states) {
    const signalAt = dateOrNull(state.currentSignalAt);
    if (!state.currentSignalDirection || !signalAt) {
      continue;
    }

    const id = [
      "runtime",
      input.profile.id,
      state.symbol,
      state.timeframe,
      state.currentSignalDirection,
      signalAt.getTime(),
    ].join(":");
    if (existingIds.has(id)) {
      continue;
    }

    events.unshift({
      id,
      profileId: input.profile.id,
      environment: input.profile.environment,
      symbol: state.symbol,
      timeframe: state.timeframe as SignalMonitorTimeframe,
      direction: state.currentSignalDirection,
      signalAt,
      signalPrice: state.currentSignalPrice,
      close: null,
      emittedAt: input.evaluatedAt,
      source: "pyrus-signals-runtime",
      payload: {
        latestBarAt: state.latestBarAt?.toISOString() ?? null,
        barsSinceSignal: state.barsSinceSignal,
        fresh: state.fresh,
        mode: input.mode,
        status: state.status,
        storage: "runtime-only",
      },
    });
    existingIds.add(id);
  }

  runtimeSignalMonitorEvents.set(input.profile.environment, events.slice(0, 500));
}

function filterRuntimeSignalMonitorEvents(input: {
  environment: RuntimeMode;
  symbol?: string;
  limit?: number;
}) {
  const symbol = normalizeSymbol(input.symbol ?? "").toUpperCase();
  const limit = positiveInteger(input.limit, 100, 1, 500);
  return (runtimeSignalMonitorEvents.get(input.environment) ?? [])
    .filter((event) => !symbol || event.symbol === symbol)
    .slice(0, limit);
}

async function resolveRuntimeSignalMonitorProfileUniverse(
  profile: DbSignalMonitorProfile,
) {
  const { watchlists } = listWatchlistsRuntimeFallback();
  return resolveSignalMonitorUniverseFromWatchlists({
    profile,
    watchlists,
  });
}

async function evaluateSignalMonitorRuntimeProfileUniverse(input: {
  environment: RuntimeMode;
  mode?: EvaluationMode;
  watchlistId?: string | null;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
}) {
  let profile = getRuntimeSignalMonitorProfile(input.environment);
  if (Object.hasOwn(input, "watchlistId")) {
    if (input.watchlistId) {
      const { watchlists } = listWatchlistsRuntimeFallback();
      if (!watchlists.some((watchlist) => watchlist.id === input.watchlistId)) {
        throw new HttpError(404, "Watchlist not found.", {
          code: "watchlist_not_found",
        });
      }
    }
    profile = await updateRuntimeSignalMonitorProfile({
      environment: input.environment,
      watchlistId: input.watchlistId ?? null,
    });
  }

  const mode = input.mode ?? "incremental";
  const evaluationSettings = cappedSignalMonitorEvaluationProfile(profile);
  const evaluationProfile = evaluationSettings.profile;
  const cacheKey = [
    "runtime-signal",
    input.environment,
    "profile",
    mode,
    evaluationProfile.id,
    evaluationProfile.watchlistId ?? "default",
    evaluationProfile.timeframe,
    evaluationSettings.pressure,
    evaluationProfile.maxSymbols,
    evaluationProfile.evaluationConcurrency,
    evaluationProfile.freshWindowBars,
    input.barSourcePolicy ?? DEFAULT_SIGNAL_MONITOR_BAR_SOURCE_POLICY,
    JSON.stringify(asRecord(evaluationProfile.pyrusSignalsSettings)),
  ].join(":");

  return withRuntimeSignalMonitorEvaluationCache(cacheKey, async () => {
    const evaluatedAt = new Date();
    const timeframe = resolveSignalMonitorTimeframe(evaluationProfile.timeframe);
    const universe =
      await resolveRuntimeSignalMonitorProfileUniverse(evaluationProfile);
    const rotationKey = signalMonitorEvaluationRotationKey({
      profile: evaluationProfile,
      timeframe,
    });
    const resolvedBatch = resolveSignalMonitorEvaluationBatch({
      sourceSymbols: universe.watchlistSymbols,
      maxSymbols: evaluationProfile.maxSymbols,
      cursor: signalMonitorEvaluationRotationCursors.get(rotationKey),
    });
    signalMonitorEvaluationRotationCursors.set(
      rotationKey,
      resolvedBatch.nextCursor,
    );
    const states = await evaluateRuntimeSymbolsInBatches({
      profile: evaluationProfile,
      symbols: resolvedBatch.symbols,
      timeframe,
      evaluatedAt,
      barSourcePolicy: input.barSourcePolicy,
    });
    recordRuntimeSignalEvents({
      profile: evaluationProfile,
      states,
      evaluatedAt,
      mode,
    });

    const updatedProfile: DbSignalMonitorProfile = {
      ...profile,
      lastEvaluatedAt: evaluatedAt,
      lastError: SIGNAL_MONITOR_RUNTIME_FALLBACK_MESSAGE,
      updatedAt: evaluatedAt,
    };
    runtimeSignalMonitorProfiles.set(input.environment, updatedProfile);

    return {
      profile: profileToResponse(updatedProfile),
      states,
      evaluatedAt,
      truncated: resolvedBatch.truncated,
      skippedSymbols: resolvedBatch.skippedSymbols,
      universe: universe.universe,
    };
  });
}

async function evaluateSignalMonitorMatrixRuntime(input: {
  environment: RuntimeMode;
  watchlistId?: string | null;
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

  const matrixSettings = cappedSignalMatrixSettings(profile);
  const { symbols, skippedSymbols, truncated } = resolveSignalMonitorMatrixSymbols({
    watchlists,
    watchlistId: input.watchlistId ?? null,
    symbols: input.symbols,
    maxSymbols: matrixSettings.maxSymbols,
  });
  const timeframes = parseSignalMatrixTimeframes(input.timeframes);
  const startedAt = Date.now();
  let cacheStatus: SignalMonitorMatrixCacheStatus = "miss";
  const cacheKey = [
    "runtime-signal",
    input.environment,
    "matrix",
    SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY,
    profile.id,
    input.watchlistId ?? "default",
    [...symbols].sort().join(","),
    timeframes.join(","),
    matrixSettings.concurrency,
    matrixSettings.pressure,
    profile.freshWindowBars,
    JSON.stringify(asRecord(profile.pyrusSignalsSettings)),
  ].join(":");
  const automaticRequest = markAutomaticSignalMonitorMatrixRequest(cacheKey, input);

  const response = await withRuntimeSignalMonitorEvaluationCache(cacheKey, async () => {
    const evaluatedAt = new Date();
    const concurrency = matrixSettings.concurrency;
    const states: SignalMonitorMatrixStateResult[] = [];
    let sourceRequestCount = 0;

    for (let index = 0; index < symbols.length; index += concurrency) {
      const batch = symbols.slice(index, index + concurrency);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          evaluateSignalMonitorMatrixSymbol({
            profile,
            symbol,
            timeframes,
            evaluatedAt,
          }),
        ),
      );
      batchResults.forEach((result) => {
        states.push(...result.states);
        sourceRequestCount += result.sourceRequestCount;
      });
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
  }, {
    onCacheStatus: (status) => {
      cacheStatus = status;
    },
  });
  return withSignalMonitorMatrixMetadata(response, {
    cacheStatus,
    requestedSymbols: symbols,
    totalSymbols: symbols.length + skippedSymbols.length,
    taskCount: symbols.length * timeframes.length,
    startedAt,
    automaticRequest,
  });
}

export async function evaluateSignalMonitorMatrix(input: {
  environment?: RuntimeMode;
  watchlistId?: string | null;
  symbols?: string[];
  timeframes?: string[];
  clientRole?: SignalMonitorMatrixClientRole;
  requestOrigin?: SignalMonitorMatrixRequestOrigin;
}) {
  const environment = resolveEnvironment(input.environment);
  if (isSignalMonitorDbBackoffActive()) {
    return evaluateSignalMonitorMatrixRuntime({ ...input, environment });
  }

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
      warnSignalMonitorDbUnavailable(error);
      return evaluateSignalMonitorMatrixRuntime({ ...input, environment });
    }
    throw error;
  }

  const matrixSettings = cappedSignalMatrixSettings(profile);
  const { symbols, skippedSymbols, truncated } = resolveSignalMonitorMatrixSymbols({
    watchlists,
    watchlistId: input.watchlistId ?? null,
    symbols: input.symbols,
    maxSymbols: matrixSettings.maxSymbols,
  });
  const timeframes = parseSignalMatrixTimeframes(input.timeframes);
  const evaluatedAt = new Date();
  const concurrency = matrixSettings.concurrency;
  const startedAt = Date.now();
  let cacheStatus: SignalMonitorMatrixCacheStatus = "miss";
  const cacheKey = [
    "signal-matrix",
    SIGNAL_MONITOR_MATRIX_SOURCE_STRATEGY,
    environment,
    profile.id,
    input.watchlistId ?? "default",
    [...symbols].sort().join(","),
    timeframes.join(","),
    concurrency,
    matrixSettings.pressure,
    profile.freshWindowBars,
    JSON.stringify(asRecord(profile.pyrusSignalsSettings)),
  ].join(":");
  const automaticRequest = markAutomaticSignalMonitorMatrixRequest(cacheKey, input);

  const debouncedCached =
    automaticRequest.debounced
      ? getDebouncedSignalMonitorMatrixCacheValue<{
          profile: ReturnType<typeof profileToResponse>;
          states: SignalMonitorMatrixStateResult[];
          evaluatedAt: Date;
          timeframes: SignalMonitorMatrixTimeframe[];
          truncated: boolean;
          skippedSymbols: string[];
          sourceRequestCount: number;
        }>(cacheKey)
      : null;
  const response =
    debouncedCached?.value ??
    (await withSignalMonitorMatrixEvaluationCache(cacheKey, async () => {
      const states: SignalMonitorMatrixStateResult[] = [];
      let sourceRequestCount = 0;

      for (let index = 0; index < symbols.length; index += concurrency) {
        const batch = symbols.slice(index, index + concurrency);
        const batchResults = await Promise.all(
          batch.map((symbol) =>
            evaluateSignalMonitorMatrixSymbol({
              profile,
              symbol,
              timeframes,
              evaluatedAt,
            }),
          ),
        );
        batchResults.forEach((result) => {
          states.push(...result.states);
          sourceRequestCount += result.sourceRequestCount;
        });
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
    }, {
      onCacheStatus: (status) => {
        cacheStatus = status;
      },
    }));
  if (debouncedCached) {
    cacheStatus = debouncedCached.cacheStatus;
  }
  return withSignalMonitorMatrixMetadata(response, {
    cacheStatus,
    requestedSymbols: symbols,
    totalSymbols: symbols.length + skippedSymbols.length,
    taskCount: symbols.length * timeframes.length,
    startedAt,
    automaticRequest,
  });
}

export async function getSignalMonitorProfile(input: {
  environment?: RuntimeMode;
}) {
  const environment = resolveEnvironment(input.environment);
  if (isSignalMonitorDbBackoffActive()) {
    return profileToResponse(getRuntimeSignalMonitorProfile(environment));
  }

  try {
    const profile = await getOrCreateProfile(environment);
    return profileToResponse(await ensureProfileWatchlist(profile));
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error);
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
  if (isSignalMonitorDbBackoffActive()) {
    const response = profileToResponse(await updateRuntimeSignalMonitorProfile({
      ...input,
      environment,
    }));
    notifyAlgoCockpitChanged({
      mode: environment,
      reason: "signal_monitor_profile_updated",
    });
    return response;
  }

  try {
    const profile = await getOrCreateProfile(environment);
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
      patch.pyrusSignalsSettings = asRecord(input.pyrusSignalsSettings);
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
    if (input.maxSymbols !== undefined) {
      patch.maxSymbols = positiveInteger(
        input.maxSymbols,
        DEFAULT_SIGNAL_MONITOR_MAX_SYMBOLS,
        1,
        250,
      );
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
      warnSignalMonitorDbUnavailable(error);
      const response = profileToResponse(await updateRuntimeSignalMonitorProfile({
        ...input,
        environment,
      }));
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
  resolveSignalMonitorEvaluationBatch,
  resolveExplicitSignalMonitorSymbols,
  cappedSignalMonitorEvaluationProfile,
  cappedSignalMatrixSettings,
  buildSignalMonitorCompletedBarsCacheKey,
  filterSignalMonitorBarsForSourcePolicy,
  isSignalMonitorIbkrBar,
  isSignalMonitorDelayedBar,
  isSignalMonitorStateCurrentForLane,
  shouldBypassSignalMonitorCompletedBarsCache,
  shouldRetrySignalMonitorCompletedBars,
  clearSignalMonitorMatrixEvaluationCache,
  withSignalMonitorMatrixEvaluationCache,
  markAutomaticSignalMonitorMatrixRequest,
  getDebouncedSignalMonitorMatrixCacheValue,
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

export async function getSignalMonitorState(input: {
  environment?: RuntimeMode;
}) {
  const environment = resolveEnvironment(input.environment);
  if (isSignalMonitorDbBackoffActive()) {
    return evaluateSignalMonitorRuntimeProfileUniverse({
      environment,
      mode: "hydrate",
    });
  }

  try {
    const profile = await getOrCreateProfile(environment);
    const {
      profile: hydratedProfile,
      watchlistSymbols,
      skippedSymbols,
      truncated,
      universe,
    } =
      await resolveSignalMonitorProfileUniverse(profile);
    const timeframe = resolveSignalMonitorTimeframe(hydratedProfile.timeframe);
    const currentUniverseSymbols = new Set(watchlistSymbols);
    const evaluatedAt = new Date();
    const states = await db
      .select()
      .from(signalMonitorSymbolStatesTable)
      .where(
        and(
          eq(signalMonitorSymbolStatesTable.profileId, hydratedProfile.id),
          eq(signalMonitorSymbolStatesTable.timeframe, timeframe),
          eq(signalMonitorSymbolStatesTable.active, true),
        ),
      )
      .orderBy(
        desc(signalMonitorSymbolStatesTable.fresh),
        desc(signalMonitorSymbolStatesTable.currentSignalAt),
        desc(signalMonitorSymbolStatesTable.latestBarAt),
      );
    const currentStates = states.filter((state) => {
      const symbol = normalizeSymbol(state.symbol).toUpperCase();
      return (
        currentUniverseSymbols.has(symbol) &&
        isSignalMonitorStateCurrentForLane({
          state,
          timeframe,
          evaluatedAt,
        })
      );
    });

    return {
      profile: profileToResponse(hydratedProfile),
      states: currentStates.map(stateToResponse),
      evaluatedAt: hydratedProfile.lastEvaluatedAt ?? new Date(),
      truncated,
      skippedSymbols,
      universe,
    };
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error);
      return evaluateSignalMonitorRuntimeProfileUniverse({
        environment,
        mode: "hydrate",
      });
    }
    throw error;
  }
}

export async function evaluateSignalMonitor(input: {
  environment?: RuntimeMode;
  mode?: EvaluationMode;
  watchlistId?: string | null;
  barSourcePolicy?: SignalMonitorBarSourcePolicy;
}) {
  const environment = resolveEnvironment(input.environment);
  if (isSignalMonitorDbBackoffActive()) {
    return evaluateSignalMonitorRuntimeProfileUniverse({
      environment,
      mode: input.mode,
      watchlistId: input.watchlistId,
      barSourcePolicy: input.barSourcePolicy,
    });
  }

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

    const evaluatedAt = new Date();
    const mode = input.mode ?? "incremental";
    return evaluateSignalMonitorProfileUniverse({
      profile,
      mode,
      evaluatedAt,
      ensureWatchlist: true,
      deactivateMissing: true,
      barSourcePolicy: input.barSourcePolicy,
    });
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error);
      return evaluateSignalMonitorRuntimeProfileUniverse({
        environment,
        mode: input.mode,
        watchlistId: input.watchlistId,
        barSourcePolicy: input.barSourcePolicy,
      });
    }
    throw error;
  }
}

export async function listSignalMonitorEvents(input: {
  environment?: RuntimeMode;
  symbol?: string;
  limit?: number;
}) {
  const environment = resolveEnvironment(input.environment);
  if (isSignalMonitorDbBackoffActive()) {
    return {
      events: filterRuntimeSignalMonitorEvents({
        environment,
        symbol: input.symbol,
        limit: input.limit,
      }),
    };
  }

  const conditions = [eq(signalMonitorEventsTable.environment, environment)];
  const symbol = normalizeSymbol(input.symbol ?? "").toUpperCase();
  if (symbol) {
    conditions.push(eq(signalMonitorEventsTable.symbol, symbol));
  }

  try {
    const events = await db
      .select()
      .from(signalMonitorEventsTable)
      .where(and(...conditions))
      .orderBy(desc(signalMonitorEventsTable.signalAt))
      .limit(positiveInteger(input.limit, 100, 1, 500));

    return {
      events: events.map(eventToResponse),
    };
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error);
      return {
        events: filterRuntimeSignalMonitorEvents({
          environment,
          symbol: input.symbol,
          limit: input.limit,
        }),
      };
    }
    throw error;
  }
}
