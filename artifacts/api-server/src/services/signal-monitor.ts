import { and, desc, eq } from "drizzle-orm";
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
  evaluateRayReplicaSignals,
  RAY_REPLICA_SIGNAL_WARMUP_BARS,
  resolveRayReplicaSignalSettings,
  type RayReplicaBar,
  type RayReplicaSignalEvent,
} from "@workspace/rayreplica-core";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { getRuntimeMode, type RuntimeMode } from "../lib/runtime";
import {
  createTransientPostgresBackoff,
  isTransientPostgresError,
} from "../lib/transient-db-error";
import { normalizeSymbol } from "../lib/values";
import { getBars, listWatchlists } from "./platform";

export type SignalMonitorTimeframe = "1m" | "5m" | "15m" | "1h" | "1d";
export type SignalMonitorMatrixTimeframe = SignalMonitorTimeframe | "2m";
type SignalMonitorDirection = "buy" | "sell";
type SignalMonitorStatus = "ok" | "stale" | "unavailable" | "error" | "unknown";
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
    universeScope,
  };
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
    rayReplicaSettings: asRecord(profile.rayReplicaSettings),
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
    source: event.source,
    payload: asRecord(event.payload),
  };
}

type SignalMonitorEventResponse = ReturnType<typeof eventToResponse>;

const runtimeSignalMonitorEvents = new Map<RuntimeMode, SignalMonitorEventResponse[]>();

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
    rayReplicaSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: 60,
    maxSymbols: 50,
    evaluationConcurrency: 3,
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
    rayReplicaSettings: {},
    freshWindowBars: 3,
    pollIntervalSeconds: 60,
    maxSymbols: 50,
    evaluationConcurrency: 3,
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
  rayReplicaSettings?: Record<string, unknown>;
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
      await assertWatchlistExists(input.watchlistId);
    }
    updated.watchlistId = input.watchlistId ?? null;
  }
  if (input.timeframe !== undefined) {
    updated.timeframe = parseSignalTimeframe(input.timeframe);
  }
  if (input.rayReplicaSettings !== undefined) {
    updated.rayReplicaSettings = asRecord(input.rayReplicaSettings);
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
    updated.maxSymbols = positiveInteger(input.maxSymbols, 50, 1, 250);
  }
  if (input.evaluationConcurrency !== undefined) {
    updated.evaluationConcurrency = positiveInteger(
      input.evaluationConcurrency,
      3,
      1,
      10,
    );
  }

  runtimeSignalMonitorProfiles.set(input.environment, updated);
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
  const uniqueSymbols = Array.from(
    new Set(
      watchlist.items
        .map((item) => normalizeSymbol(item.symbol).toUpperCase())
        .filter(Boolean),
    ),
  );
  return {
    symbols: uniqueSymbols.slice(0, maxSymbols),
    skippedSymbols: uniqueSymbols.slice(maxSymbols),
    truncated: uniqueSymbols.length > maxSymbols,
  };
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
  const watchlist =
    hydratedProfile.watchlistId
      ? watchlists.find((candidate) => candidate.id === hydratedProfile.watchlistId) ??
        null
      : options.ensureWatchlist === false
        ? null
        : watchlists.find((candidate) => candidate.isDefault) ??
          watchlists[0] ??
          null;

  if (!watchlist) {
    return {
      profile: hydratedProfile,
      symbols: [] as string[],
      skippedSymbols: [] as string[],
      truncated: false,
    };
  }

  return {
    profile: hydratedProfile,
    ...resolveWatchlistSymbols(watchlist, hydratedProfile.maxSymbols),
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
    const bucket = Math.floor(timestamp.getTime() / TIMEFRAME_MS["2m"]) * TIMEFRAME_MS["2m"];
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
      const first = sorted[0];
      const last = sorted.at(-1);
      const open = Number(first?.open);
      const close = Number(last?.close);
      const highValues = sorted.map((bar) => Number(bar.high)).filter(Number.isFinite);
      const lowValues = sorted.map((bar) => Number(bar.low)).filter(Number.isFinite);
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

function barsToRayReplicaBars(inputBars: Awaited<ReturnType<typeof getBars>>["bars"]) {
  return inputBars
    .map((bar): RayReplicaBar | null => {
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
    .filter((bar): bar is RayReplicaBar => Boolean(bar))
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

function directionFromSignal(signal: RayReplicaSignalEvent): SignalMonitorDirection {
  return signal.eventType === "buy_signal" ? "buy" : "sell";
}

async function insertSignalEvent(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  signal: RayReplicaSignalEvent;
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
      source: "rayreplica",
      payload: {
        signalId: input.signal.id,
        barIndex: input.signal.barIndex,
        latestBarAt: input.latestBarAt.toISOString(),
        filterState: input.signal.filterState,
      },
    })
    .onConflictDoNothing();
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

export async function loadSignalMonitorCompletedBars(input: {
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
  limit?: number;
}): Promise<SignalMonitorCompletedBarsSnapshot> {
  const providerTimeframe: SignalMonitorTimeframe =
    input.timeframe === "2m" ? "1m" : input.timeframe;
  const providerLimit =
    input.timeframe === "2m"
      ? (input.limit ?? RAY_REPLICA_SIGNAL_WARMUP_BARS) * 2 + 4
      : input.limit ?? RAY_REPLICA_SIGNAL_WARMUP_BARS;
  const barsResult = await getBars({
    symbol: input.symbol,
    timeframe: providerTimeframe,
    limit: providerLimit,
    assetClass: "equity",
    outsideRth: true,
    source: "trades",
    allowHistoricalSynthesis: true,
  });
  const completedBars =
    input.timeframe === "2m"
      ? aggregateCompletedMinuteBars(barsResult.bars, "2m", input.evaluatedAt)
      : filterCompletedBars(barsResult.bars, input.timeframe, input.evaluatedAt);
  const latestBar = completedBars.at(-1);
  return {
    bars: completedBars,
    latestBarAt: latestBar ? dateOrNull(latestBar.timestamp) : null,
  };
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
    const chartBars = barsToRayReplicaBars(input.completedBars);
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

    const settings = resolveRayReplicaSignalSettings(
      asRecord(input.profile.rayReplicaSettings),
    );
    const evaluation = evaluateRayReplicaSignals({
      chartBars,
      settings,
      includeProvisionalSignals: false,
    });
    const signal = evaluation.signalEvents.at(-1) ?? null;
    const latestBarAt = new Date(latestBar.time * 1000);
    const stale = isLatestBarStale({
      latestBarAt,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
    });

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
      });
    }

    const barsSinceSignal = Math.max(0, chartBars.length - 1 - signal.barIndex);
    const fresh = barsSinceSignal <= input.profile.freshWindowBars && !stale;
    const signalAt = new Date(signal.time * 1000);

    if (input.mode === "incremental" && fresh) {
      await insertSignalEvent({
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
}) {
  try {
    const completedBars = await loadSignalMonitorCompletedBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
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
  const chartBars = barsToRayReplicaBars(input.completedBars);
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

  const settings = resolveRayReplicaSignalSettings(
    asRecord(input.profile.rayReplicaSettings),
  );
  const evaluation = evaluateRayReplicaSignals({
    chartBars,
    settings,
    includeProvisionalSignals: false,
  });
  const signal = evaluation.signalEvents.at(-1) ?? null;
  const latestBarAt = new Date(latestBar.time * 1000);
  const stale = isLatestBarStale({
    latestBarAt,
    timeframe: input.timeframe,
    evaluatedAt: input.evaluatedAt,
  });

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
  };
}

async function evaluateSymbolsInBatches(input: {
  profile: DbSignalMonitorProfile;
  symbols: string[];
  timeframe: SignalMonitorTimeframe;
  mode: EvaluationMode;
  evaluatedAt: Date;
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
}) {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const mode = input.mode ?? "incremental";
  const timeframe = resolveSignalMonitorTimeframe(input.profile.timeframe);
  const universe = await resolveSignalMonitorProfileUniverse(input.profile, {
    ensureWatchlist: input.ensureWatchlist,
  });
  const requestedSymbols = input.symbols
    ? new Set(input.symbols.map((symbol) => normalizeSymbol(symbol).toUpperCase()))
    : null;
  const symbols = requestedSymbols
    ? universe.symbols.filter((symbol) => requestedSymbols.has(symbol))
    : universe.symbols;

  if (input.deactivateMissing !== false) {
    await db
      .update(signalMonitorSymbolStatesTable)
      .set({ active: false, updatedAt: evaluatedAt })
      .where(eq(signalMonitorSymbolStatesTable.profileId, universe.profile.id));
  }

  const evaluatedStates = await evaluateSymbolsInBatches({
    profile: universe.profile,
    symbols,
    timeframe,
    mode,
    evaluatedAt,
  });
  const updatedProfile = await updateSignalMonitorProfileEvaluationMetadata({
    profile: universe.profile,
    evaluatedAt,
    states: evaluatedStates,
  });

  return {
    profile: profileToResponse(updatedProfile),
    states: evaluatedStates.map(stateToResponse),
    evaluatedAt,
    truncated: universe.truncated,
    skippedSymbols: universe.skippedSymbols,
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

async function evaluateSignalMonitorMatrixItem(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorMatrixTimeframe;
  evaluatedAt: Date;
}) {
  try {
    const completedBars = await loadSignalMonitorCompletedBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
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

async function evaluateSignalMonitorRuntimeSymbol(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  evaluatedAt: Date;
}) {
  try {
    const completedBars = await loadSignalMonitorCompletedBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      evaluatedAt: input.evaluatedAt,
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
  if (input.mode !== "incremental") {
    return;
  }

  const current = runtimeSignalMonitorEvents.get(input.profile.environment) ?? [];
  const events = [...current];
  const existingIds = new Set(events.map((event) => event.id));

  for (const state of input.states) {
    if (
      state.fresh !== true ||
      !state.currentSignalDirection ||
      !state.currentSignalAt
    ) {
      continue;
    }

    const id = [
      "runtime",
      input.profile.id,
      state.symbol,
      state.timeframe,
      state.currentSignalDirection,
      state.currentSignalAt.getTime(),
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
      signalAt: state.currentSignalAt,
      signalPrice: state.currentSignalPrice,
      close: null,
      emittedAt: input.evaluatedAt,
      source: "rayreplica-runtime",
      payload: {
        latestBarAt: state.latestBarAt?.toISOString() ?? null,
        barsSinceSignal: state.barsSinceSignal,
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
  const { watchlists } = await listWatchlists();
  const watchlist =
    profile.watchlistId
      ? watchlists.find((candidate) => candidate.id === profile.watchlistId) ?? null
      : watchlists.find((candidate) => candidate.isDefault) ??
        watchlists[0] ??
        null;

  if (!watchlist) {
    return {
      symbols: [] as string[],
      skippedSymbols: [] as string[],
      truncated: false,
    };
  }

  return resolveWatchlistSymbols(watchlist, profile.maxSymbols);
}

async function evaluateSignalMonitorRuntimeProfileUniverse(input: {
  environment: RuntimeMode;
  mode?: EvaluationMode;
  watchlistId?: string | null;
}) {
  let profile = getRuntimeSignalMonitorProfile(input.environment);
  if (Object.hasOwn(input, "watchlistId")) {
    profile = await updateRuntimeSignalMonitorProfile({
      environment: input.environment,
      watchlistId: input.watchlistId ?? null,
    });
  }

  const evaluatedAt = new Date();
  const mode = input.mode ?? "incremental";
  const timeframe = resolveSignalMonitorTimeframe(profile.timeframe);
  const universe = await resolveRuntimeSignalMonitorProfileUniverse(profile);
  const states = await evaluateRuntimeSymbolsInBatches({
    profile,
    symbols: universe.symbols,
    timeframe,
    evaluatedAt,
  });
  recordRuntimeSignalEvents({ profile, states, evaluatedAt, mode });

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
    truncated: universe.truncated,
    skippedSymbols: universe.skippedSymbols,
  };
}

async function evaluateSignalMonitorMatrixRuntime(input: {
  environment: RuntimeMode;
  watchlistId?: string | null;
  symbols?: string[];
  timeframes?: string[];
}) {
  const profile = getRuntimeSignalMonitorProfile(input.environment);
  const { watchlists } = await listWatchlists();
  if (
    input.watchlistId &&
    !watchlists.some((watchlist) => watchlist.id === input.watchlistId)
  ) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const maxSymbols = positiveInteger(profile.maxSymbols, 50, 1, 250);
  const { symbols, skippedSymbols, truncated } = resolveSignalMonitorMatrixSymbols({
    watchlists,
    watchlistId: input.watchlistId ?? null,
    symbols: input.symbols,
    maxSymbols,
  });
  const timeframes = parseSignalMatrixTimeframes(input.timeframes);
  const evaluatedAt = new Date();
  const concurrency = positiveInteger(profile.evaluationConcurrency, 3, 1, 10);
  const tasks = symbols.flatMap((symbol) =>
    timeframes.map((timeframe) => ({ symbol, timeframe })),
  );
  const states = [];

  for (let index = 0; index < tasks.length; index += concurrency) {
    const batch = tasks.slice(index, index + concurrency);
    const batchStates = await Promise.all(
      batch.map((task) =>
        evaluateSignalMonitorMatrixItem({
          profile,
          symbol: task.symbol,
          timeframe: task.timeframe,
          evaluatedAt,
        }),
      ),
    );
    states.push(...batchStates);
  }

  return {
    profile: profileToResponse(profile),
    states,
    evaluatedAt,
    timeframes,
    truncated,
    skippedSymbols,
  };
}

export async function evaluateSignalMonitorMatrix(input: {
  environment?: RuntimeMode;
  watchlistId?: string | null;
  symbols?: string[];
  timeframes?: string[];
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

  const maxSymbols = positiveInteger(profile.maxSymbols, 50, 1, 250);
  const { symbols, skippedSymbols, truncated } = resolveSignalMonitorMatrixSymbols({
    watchlists,
    watchlistId: input.watchlistId ?? null,
    symbols: input.symbols,
    maxSymbols,
  });
  const timeframes = parseSignalMatrixTimeframes(input.timeframes);
  const evaluatedAt = new Date();
  const concurrency = positiveInteger(profile.evaluationConcurrency, 3, 1, 10);
  const tasks = symbols.flatMap((symbol) =>
    timeframes.map((timeframe) => ({ symbol, timeframe })),
  );
  const states = [];

  for (let index = 0; index < tasks.length; index += concurrency) {
    const batch = tasks.slice(index, index + concurrency);
    const batchStates = await Promise.all(
      batch.map((task) =>
        evaluateSignalMonitorMatrixItem({
          profile,
          symbol: task.symbol,
          timeframe: task.timeframe,
          evaluatedAt,
        }),
      ),
    );
    states.push(...batchStates);
  }

  return {
    profile: profileToResponse(profile),
    states,
    evaluatedAt,
    timeframes,
    truncated,
    skippedSymbols,
  };
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
  rayReplicaSettings?: Record<string, unknown>;
  freshWindowBars?: number;
  pollIntervalSeconds?: number;
  maxSymbols?: number;
  evaluationConcurrency?: number;
}) {
  const environment = resolveEnvironment(input.environment);
  if (isSignalMonitorDbBackoffActive()) {
    return profileToResponse(await updateRuntimeSignalMonitorProfile({
      ...input,
      environment,
    }));
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
    if (input.rayReplicaSettings !== undefined) {
      patch.rayReplicaSettings = asRecord(input.rayReplicaSettings);
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
      patch.maxSymbols = positiveInteger(input.maxSymbols, 50, 1, 250);
    }
    if (input.evaluationConcurrency !== undefined) {
      patch.evaluationConcurrency = positiveInteger(
        input.evaluationConcurrency,
        3,
        1,
        10,
      );
    }

    const [updated] = await db
      .update(signalMonitorProfilesTable)
      .set(patch)
      .where(eq(signalMonitorProfilesTable.id, profile.id))
      .returning();

    return profileToResponse(updated ?? profile);
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error);
      return profileToResponse(await updateRuntimeSignalMonitorProfile({
        ...input,
        environment,
      }));
    }
    throw error;
  }
}

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
    const { profile: hydratedProfile, skippedSymbols, truncated } =
      await resolveSignalMonitorProfileUniverse(profile);
    const states = await db
      .select()
      .from(signalMonitorSymbolStatesTable)
      .where(
        and(
          eq(signalMonitorSymbolStatesTable.profileId, hydratedProfile.id),
          eq(signalMonitorSymbolStatesTable.active, true),
        ),
      )
      .orderBy(
        desc(signalMonitorSymbolStatesTable.fresh),
        desc(signalMonitorSymbolStatesTable.currentSignalAt),
        desc(signalMonitorSymbolStatesTable.latestBarAt),
      );

    return {
      profile: profileToResponse(hydratedProfile),
      states: states.map(stateToResponse),
      evaluatedAt: hydratedProfile.lastEvaluatedAt ?? new Date(),
      truncated,
      skippedSymbols,
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
}) {
  const environment = resolveEnvironment(input.environment);
  if (isSignalMonitorDbBackoffActive()) {
    return evaluateSignalMonitorRuntimeProfileUniverse({
      environment,
      mode: input.mode,
      watchlistId: input.watchlistId,
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
    });
  } catch (error) {
    if (isTransientPostgresError(error)) {
      warnSignalMonitorDbUnavailable(error);
      return evaluateSignalMonitorRuntimeProfileUniverse({
        environment,
        mode: input.mode,
        watchlistId: input.watchlistId,
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
