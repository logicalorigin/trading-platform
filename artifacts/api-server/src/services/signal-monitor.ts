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
import { getRuntimeMode, type RuntimeMode } from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import { getBars, listWatchlists } from "./platform";

export type SignalMonitorTimeframe = "1m" | "5m" | "15m" | "1h" | "1d";
type SignalMonitorDirection = "buy" | "sell";
type SignalMonitorStatus = "ok" | "stale" | "unavailable" | "error" | "unknown";
type EvaluationMode = "hydrate" | "incremental";

type WatchlistRecord = Awaited<ReturnType<typeof listWatchlists>>["watchlists"][number];

const SIGNAL_MONITOR_TIMEFRAMES: readonly SignalMonitorTimeframe[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "1d",
];
const DEFAULT_SIGNAL_MONITOR_TIMEFRAME: SignalMonitorTimeframe = "15m";
const TIMEFRAME_MS: Record<SignalMonitorTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function resolveEnvironment(environment?: RuntimeMode): RuntimeMode {
  return environment ?? getRuntimeMode();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveSignalTimeframe(
  value: unknown,
  fallback = DEFAULT_SIGNAL_MONITOR_TIMEFRAME,
): SignalMonitorTimeframe {
  const resolved = String(value || "").trim() as SignalMonitorTimeframe;
  return SIGNAL_MONITOR_TIMEFRAMES.includes(resolved) ? resolved : fallback;
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
    timeframe: resolveSignalTimeframe(profile.timeframe),
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
    timeframe: resolveSignalTimeframe(state.timeframe),
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
    timeframe: resolveSignalTimeframe(event.timeframe),
    direction: event.direction as SignalMonitorDirection,
    signalAt: event.signalAt,
    signalPrice: numericValueOrNull(event.signalPrice),
    close: numericValueOrNull(event.close),
    emittedAt: event.emittedAt,
    source: event.source,
    payload: asRecord(event.payload),
  };
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

async function resolveMonitorUniverse(profile: DbSignalMonitorProfile) {
  const hydratedProfile = await ensureProfileWatchlist(profile);
  const { watchlists } = await listWatchlists();
  const watchlist =
    watchlists.find((candidate) => candidate.id === hydratedProfile.watchlistId) ??
    watchlists.find((candidate) => candidate.isDefault) ??
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
  timeframe: SignalMonitorTimeframe;
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

async function evaluateSymbol(input: {
  profile: DbSignalMonitorProfile;
  symbol: string;
  timeframe: SignalMonitorTimeframe;
  mode: EvaluationMode;
  evaluatedAt: Date;
}) {
  try {
    const barsResult = await getBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      limit: RAY_REPLICA_SIGNAL_WARMUP_BARS,
      assetClass: "equity",
      outsideRth: true,
      source: "trades",
      allowHistoricalSynthesis: false,
    });
    const chartBars = barsToRayReplicaBars(barsResult.bars);
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
        evaluateSymbol({
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

export async function getSignalMonitorProfile(input: {
  environment?: RuntimeMode;
}) {
  const profile = await getOrCreateProfile(resolveEnvironment(input.environment));
  return profileToResponse(await ensureProfileWatchlist(profile));
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
}

export async function getSignalMonitorState(input: {
  environment?: RuntimeMode;
}) {
  const profile = await getOrCreateProfile(resolveEnvironment(input.environment));
  const { profile: hydratedProfile, skippedSymbols, truncated } =
    await resolveMonitorUniverse(profile);
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
}

export async function evaluateSignalMonitor(input: {
  environment?: RuntimeMode;
  mode?: EvaluationMode;
  watchlistId?: string | null;
}) {
  const environment = resolveEnvironment(input.environment);
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
  const timeframe = resolveSignalTimeframe(profile.timeframe);
  const universe = await resolveMonitorUniverse(profile);

  await db
    .update(signalMonitorSymbolStatesTable)
    .set({ active: false, updatedAt: evaluatedAt })
    .where(eq(signalMonitorSymbolStatesTable.profileId, universe.profile.id));

  const evaluatedStates = await evaluateSymbolsInBatches({
    profile: universe.profile,
    symbols: universe.symbols,
    timeframe,
    mode,
    evaluatedAt,
  });
  const errorCount = evaluatedStates.filter((state) => state.status === "error").length;
  const lastError =
    errorCount > 0 && errorCount === evaluatedStates.length
      ? "All signal monitor symbol evaluations failed."
      : null;

  const [updatedProfile] = await db
    .update(signalMonitorProfilesTable)
    .set({
      lastEvaluatedAt: evaluatedAt,
      lastError,
      updatedAt: evaluatedAt,
    })
    .where(eq(signalMonitorProfilesTable.id, universe.profile.id))
    .returning();

  return {
    profile: profileToResponse(updatedProfile ?? universe.profile),
    states: evaluatedStates.map(stateToResponse),
    evaluatedAt,
    truncated: universe.truncated,
    skippedSymbols: universe.skippedSymbols,
  };
}

export async function listSignalMonitorEvents(input: {
  environment?: RuntimeMode;
  symbol?: string;
  limit?: number;
}) {
  const environment = resolveEnvironment(input.environment);
  const conditions = [eq(signalMonitorEventsTable.environment, environment)];
  const symbol = normalizeSymbol(input.symbol ?? "").toUpperCase();
  if (symbol) {
    conditions.push(eq(signalMonitorEventsTable.symbol, symbol));
  }

  const events = await db
    .select()
    .from(signalMonitorEventsTable)
    .where(and(...conditions))
    .orderBy(desc(signalMonitorEventsTable.signalAt))
    .limit(positiveInteger(input.limit, 100, 1, 500));

  return {
    events: events.map(eventToResponse),
  };
}
