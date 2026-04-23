import { useSyncExternalStore } from "react";

export type ChartHydrationMetricKey =
  | "barsRequestMs"
  | "prependRequestMs"
  | "modelBuildMs"
  | "firstPaintMs"
  | "livePatchToPaintMs";

type ScopeHydrationMetrics = Partial<Record<ChartHydrationMetricKey, number>> & {
  updatedAt: number;
};

const SAMPLE_LIMIT = 120;
const hydrationSamples: Record<ChartHydrationMetricKey, number[]> = {
  barsRequestMs: [],
  prependRequestMs: [],
  modelBuildMs: [],
  firstPaintMs: [],
  livePatchToPaintMs: [],
};
const scopeHydrationMetrics = new Map<string, ScopeHydrationMetrics>();
const pendingLivePatchByScope = new Map<string, number>();
const listeners = new Set<() => void>();
let storeVersion = 0;

const nowMs = (): number =>
  typeof performance !== "undefined" && Number.isFinite(performance.now())
    ? performance.now()
    : Date.now();

const emitChange = () => {
  storeVersion += 1;
  Array.from(listeners).forEach((listener) => listener());
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
});

export const recordChartHydrationMetric = (
  metric: ChartHydrationMetricKey,
  value: number,
  scope?: string | null,
): void => {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }

  pushSample(hydrationSamples[metric], value);

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
  if (deletedPending || deletedScope) {
    emitChange();
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => storeVersion;

export const useChartHydrationStats = () => {
  useSyncExternalStore(subscribe, getSnapshot, () => 0);

  return {
    barsRequestMs: summarizeBucket(hydrationSamples.barsRequestMs),
    prependRequestMs: summarizeBucket(hydrationSamples.prependRequestMs),
    modelBuildMs: summarizeBucket(hydrationSamples.modelBuildMs),
    firstPaintMs: summarizeBucket(hydrationSamples.firstPaintMs),
    livePatchToPaintMs: summarizeBucket(hydrationSamples.livePatchToPaintMs),
    sampleCount: Math.max(
      hydrationSamples.barsRequestMs.length,
      hydrationSamples.prependRequestMs.length,
      hydrationSamples.modelBuildMs.length,
      hydrationSamples.firstPaintMs.length,
      hydrationSamples.livePatchToPaintMs.length,
    ),
    scopes: Array.from(scopeHydrationMetrics.entries())
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, 4)
      .map(([scope, metrics]) => ({
        scope,
        ...metrics,
      })),
  };
};
