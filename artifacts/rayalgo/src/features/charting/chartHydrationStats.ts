import { useSyncExternalStore } from "react";

export type ChartHydrationMetricKey =
  | "barsRequestMs"
  | "favoritePrewarmRequestMs"
  | "liveFallbackRequestMs"
  | "prependRequestMs"
  | "modelBuildMs"
  | "firstPaintMs"
  | "livePatchToPaintMs"
  | "seriesSyncMs"
  | "deferredOverlayMs";

export type ChartHydrationCounterKey =
  | "payloadShapeError"
  | "chartInstanceCreate"
  | "chartInstanceDispose"
  | "livePatchReceived"
  | "livePatchApplied"
  | "livePatchCoalesced"
  | "livePatchDuplicate"
  | "seriesTailPatch"
  | "seriesTailAppend"
  | "seriesFullReset"
  | "visibleRangeSyncDeferred"
  | "visibleRangeDefaultApplied"
  | "visibleRangeUserPreserved"
  | "visibleRangeRealtimeFollow"
  | "visibleRangePrependAdjusted"
  | "visibleRangeResetSkipped"
  | "liveFallbackFetch"
  | "olderPageFetch"
  | "olderPageDuplicate"
  | "providerCursorPage"
  | "historyCursorPage";

type ScopeHydrationMetrics = Partial<Record<ChartHydrationMetricKey, number>> & {
  updatedAt: number;
};

type ScopeHydrationCounters = Partial<Record<ChartHydrationCounterKey, number>> & {
  updatedAt: number;
};

export type ChartBarScopeState = {
  scope: string;
  timeframe: string;
  role: "mini" | "primary" | "option";
  requestedLimit: number;
  initialLimit: number;
  targetLimit: number;
  maxLimit: number;
  hydratedBaseCount: number;
  renderedBarCount: number;
  livePatchedBarCount: number;
  oldestLoadedAt: string | null;
  isPrependingOlder: boolean;
  hasExhaustedOlderHistory: boolean;
  olderHistoryNextBeforeAt?: string | null;
  emptyOlderHistoryWindowCount?: number;
  olderHistoryPageCount?: number;
  olderHistoryProvider?: string | null;
  olderHistoryExhaustionReason?: string | null;
  olderHistoryProviderCursor?: string | null;
  olderHistoryProviderNextUrl?: string | null;
  olderHistoryProviderPageCount?: number | null;
  olderHistoryProviderPageLimitReached?: boolean;
  olderHistoryCursor?: string | null;
  updatedAt: number;
};

type ChartHydrationScopeSnapshot = Partial<
  ChartBarScopeState &
    ScopeHydrationMetrics &
    ScopeHydrationCounters & {
      hasProviderCursor: boolean;
      hasHistoryCursor: boolean;
    }
> & {
  scope: string;
  updatedAt: number;
};

const SAMPLE_LIMIT = 120;
const hydrationSamples: Record<ChartHydrationMetricKey, number[]> = {
  barsRequestMs: [],
  favoritePrewarmRequestMs: [],
  liveFallbackRequestMs: [],
  prependRequestMs: [],
  modelBuildMs: [],
  firstPaintMs: [],
  livePatchToPaintMs: [],
  seriesSyncMs: [],
  deferredOverlayMs: [],
};
const scopeHydrationMetrics = new Map<string, ScopeHydrationMetrics>();
const hydrationCounters: Record<ChartHydrationCounterKey, number> = {
  payloadShapeError: 0,
  chartInstanceCreate: 0,
  chartInstanceDispose: 0,
  livePatchReceived: 0,
  livePatchApplied: 0,
  livePatchCoalesced: 0,
  livePatchDuplicate: 0,
  seriesTailPatch: 0,
  seriesTailAppend: 0,
  seriesFullReset: 0,
  visibleRangeSyncDeferred: 0,
  visibleRangeDefaultApplied: 0,
  visibleRangeUserPreserved: 0,
  visibleRangeRealtimeFollow: 0,
  visibleRangePrependAdjusted: 0,
  visibleRangeResetSkipped: 0,
  liveFallbackFetch: 0,
  olderPageFetch: 0,
  olderPageDuplicate: 0,
  providerCursorPage: 0,
  historyCursorPage: 0,
};
const scopeHydrationCounters = new Map<string, ScopeHydrationCounters>();
const scopeBarStates = new Map<string, ChartBarScopeState>();
const pendingLivePatchByScope = new Map<string, number>();
const listeners = new Set<() => void>();
let storeVersion = 0;
let emitScheduled = false;

const nowMs = (): number =>
  typeof performance !== "undefined" && Number.isFinite(performance.now())
    ? performance.now()
    : Date.now();

const flushListeners = () => {
  emitScheduled = false;
  storeVersion += 1;
  Array.from(listeners).forEach((listener) => listener());
};

const emitChange = () => {
  if (emitScheduled) {
    return;
  }
  emitScheduled = true;
  if (typeof queueMicrotask === "function") {
    queueMicrotask(flushListeners);
    return;
  }
  setTimeout(flushListeners, 0);
};

const pushSample = (
  bucket: number[],
  value: number,
) => {
  bucket.push(value);
  if (bucket.length > SAMPLE_LIMIT) {
    bucket.splice(0, bucket.length - SAMPLE_LIMIT);
  }
};

const percentile = (values: number[], pct: number): number | null => {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1),
  );
  return sorted[index];
};

const summarizeBucket = (values: number[]) => ({
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  count: values.length,
});

export const recordChartHydrationMetric = (
  metric: ChartHydrationMetricKey | string,
  value: number,
  scope?: string | null,
): void => {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }

  const bucket = hydrationSamples[metric as ChartHydrationMetricKey];
  if (!bucket) {
    return;
  }

  pushSample(bucket, value);

  if (scope?.trim()) {
    const normalizedScope = scope.trim();
    const current = scopeHydrationMetrics.get(normalizedScope) ?? {
      updatedAt: Date.now(),
    };
    scopeHydrationMetrics.set(normalizedScope, {
      ...current,
      [metric]: value,
      updatedAt: Date.now(),
    });
  }

  emitChange();
};

export const recordChartHydrationCounter = (
  counter: ChartHydrationCounterKey,
  scope?: string | null,
  delta = 1,
): void => {
  if (!Number.isFinite(delta) || delta <= 0) {
    return;
  }

  hydrationCounters[counter] += delta;

  if (scope?.trim()) {
    const normalizedScope = scope.trim();
    const current = scopeHydrationCounters.get(normalizedScope) ?? {
      updatedAt: Date.now(),
    };
    scopeHydrationCounters.set(normalizedScope, {
      ...current,
      [counter]: (current[counter] ?? 0) + delta,
      updatedAt: Date.now(),
    });
  }

  emitChange();
};

export const markChartLivePatchPending = (
  scope?: string | null,
  startedAt = nowMs(),
): void => {
  if (!scope?.trim()) {
    return;
  }

  pendingLivePatchByScope.set(scope.trim(), startedAt);
};

export const consumeChartLivePatchPending = (
  scope?: string | null,
): number | null => {
  if (!scope?.trim()) {
    return null;
  }

  const normalizedScope = scope.trim();
  const startedAt = pendingLivePatchByScope.get(normalizedScope) ?? null;
  if (startedAt !== null) {
    pendingLivePatchByScope.delete(normalizedScope);
  }
  return startedAt;
};

export const clearChartHydrationScope = (
  scope?: string | null,
): void => {
  if (!scope?.trim()) {
    return;
  }

  const normalizedScope = scope.trim();
  const deletedPending = pendingLivePatchByScope.delete(normalizedScope);
  const deletedScope = scopeHydrationMetrics.delete(normalizedScope);
  const deletedCounters = scopeHydrationCounters.delete(normalizedScope);
  const deletedState = scopeBarStates.delete(normalizedScope);
  if (deletedPending || deletedScope || deletedCounters || deletedState) {
    emitChange();
  }
};

export const recordChartBarScopeState = (
  scope: string | null | undefined,
  state: Omit<ChartBarScopeState, "scope" | "updatedAt">,
): void => {
  if (!scope?.trim()) {
    return;
  }

  const normalizedScope = scope.trim();
  const current = scopeBarStates.get(normalizedScope);
  const next: ChartBarScopeState = {
    ...state,
    scope: normalizedScope,
    updatedAt: Date.now(),
  };

  if (
    current &&
    current.timeframe === next.timeframe &&
    current.role === next.role &&
    current.requestedLimit === next.requestedLimit &&
    current.initialLimit === next.initialLimit &&
    current.targetLimit === next.targetLimit &&
    current.maxLimit === next.maxLimit &&
    current.hydratedBaseCount === next.hydratedBaseCount &&
    current.renderedBarCount === next.renderedBarCount &&
    current.livePatchedBarCount === next.livePatchedBarCount &&
    current.oldestLoadedAt === next.oldestLoadedAt &&
    current.isPrependingOlder === next.isPrependingOlder &&
    current.hasExhaustedOlderHistory === next.hasExhaustedOlderHistory &&
    current.olderHistoryNextBeforeAt === next.olderHistoryNextBeforeAt &&
    current.emptyOlderHistoryWindowCount === next.emptyOlderHistoryWindowCount &&
    current.olderHistoryPageCount === next.olderHistoryPageCount &&
    current.olderHistoryProvider === next.olderHistoryProvider &&
    current.olderHistoryExhaustionReason === next.olderHistoryExhaustionReason &&
    current.olderHistoryProviderCursor === next.olderHistoryProviderCursor &&
    current.olderHistoryProviderNextUrl === next.olderHistoryProviderNextUrl &&
    current.olderHistoryProviderPageCount === next.olderHistoryProviderPageCount &&
    current.olderHistoryProviderPageLimitReached ===
      next.olderHistoryProviderPageLimitReached &&
    current.olderHistoryCursor === next.olderHistoryCursor
  ) {
    return;
  }

  scopeBarStates.set(normalizedScope, next);
  emitChange();
};

const collectChartHydrationScopeSnapshots = (): ChartHydrationScopeSnapshot[] => {
  const scopeKeys = new Set([
    ...scopeHydrationMetrics.keys(),
    ...scopeHydrationCounters.keys(),
    ...scopeBarStates.keys(),
  ]);

  return Array.from(scopeKeys)
    .map((scope) => {
      const state = scopeBarStates.get(scope);
      const metrics = scopeHydrationMetrics.get(scope);
      const counters = scopeHydrationCounters.get(scope);
      return {
        ...state,
        ...metrics,
        ...counters,
        scope,
        hasProviderCursor: Boolean(
          state?.olderHistoryProviderCursor || state?.olderHistoryProviderNextUrl,
        ),
        hasHistoryCursor: Boolean(state?.olderHistoryCursor),
        updatedAt: Math.max(
          metrics?.updatedAt ?? 0,
          counters?.updatedAt ?? 0,
          state?.updatedAt ?? 0,
        ),
      };
    })
    .sort((left, right) => right.updatedAt - left.updatedAt);
};

const countScopeRoles = (scopes: ChartHydrationScopeSnapshot[]) =>
  scopes.reduce<Record<string, number>>((result, scope) => {
    const role = scope.role || "unknown";
    result[role] = (result[role] || 0) + 1;
    return result;
  }, {});

const oldestLoadedAtMin = (
  scopes: ChartHydrationScopeSnapshot[],
): string | null => {
  const oldest = scopes
    .map((scope) => Date.parse(String(scope.oldestLoadedAt || "")))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  return Number.isFinite(oldest) ? new Date(oldest).toISOString() : null;
};

const sanitizeScopeForDiagnostics = (scope: ChartHydrationScopeSnapshot) => {
  const {
    olderHistoryProviderCursor,
    olderHistoryProviderNextUrl,
    olderHistoryCursor,
    ...rest
  } = scope;
  return {
    ...rest,
    hasProviderCursor: Boolean(
      scope.hasProviderCursor ||
        olderHistoryProviderCursor ||
        olderHistoryProviderNextUrl,
    ),
    hasHistoryCursor: Boolean(scope.hasHistoryCursor || olderHistoryCursor),
  };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => storeVersion;

export const getChartHydrationStatsSnapshot = () => {
  const scopes = collectChartHydrationScopeSnapshots();
  return {
    barsRequestMs: summarizeBucket(hydrationSamples.barsRequestMs),
    favoritePrewarmRequestMs: summarizeBucket(hydrationSamples.favoritePrewarmRequestMs),
    liveFallbackRequestMs: summarizeBucket(hydrationSamples.liveFallbackRequestMs),
    prependRequestMs: summarizeBucket(hydrationSamples.prependRequestMs),
    modelBuildMs: summarizeBucket(hydrationSamples.modelBuildMs),
    firstPaintMs: summarizeBucket(hydrationSamples.firstPaintMs),
    livePatchToPaintMs: summarizeBucket(hydrationSamples.livePatchToPaintMs),
    seriesSyncMs: summarizeBucket(hydrationSamples.seriesSyncMs),
    deferredOverlayMs: summarizeBucket(hydrationSamples.deferredOverlayMs),
    sampleCount: Math.max(
      hydrationSamples.barsRequestMs.length,
      hydrationSamples.favoritePrewarmRequestMs.length,
      hydrationSamples.liveFallbackRequestMs.length,
      hydrationSamples.prependRequestMs.length,
      hydrationSamples.modelBuildMs.length,
      hydrationSamples.firstPaintMs.length,
      hydrationSamples.livePatchToPaintMs.length,
      hydrationSamples.seriesSyncMs.length,
      hydrationSamples.deferredOverlayMs.length,
    ),
    counters: { ...hydrationCounters },
    activeScopeCount: scopes.length,
    exhaustedScopeCount: scopes.filter(
      (scope) => scope.hasExhaustedOlderHistory,
    ).length,
    prependingScopeCount: scopes.filter((scope) => scope.isPrependingOlder)
      .length,
    oldestLoadedAtMin: oldestLoadedAtMin(scopes),
    scopeRoles: countScopeRoles(scopes),
    scopes: scopes.slice(0, 8),
  };
};

export const sanitizeChartHydrationStatsForDiagnostics = (
  snapshot = getChartHydrationStatsSnapshot(),
) => ({
  ...snapshot,
  scopes: snapshot.scopes.map(sanitizeScopeForDiagnostics),
});

export const useChartHydrationStats = (enabled = true) => {
  useSyncExternalStore(
    enabled ? subscribe : () => () => {},
    enabled ? getSnapshot : () => 0,
    () => 0,
  );

  return getChartHydrationStatsSnapshot();
};
