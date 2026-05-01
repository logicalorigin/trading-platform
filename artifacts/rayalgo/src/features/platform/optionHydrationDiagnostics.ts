import { useSyncExternalStore } from "react";

type MetricKey =
  | "activeChainMs"
  | "batchChainMs"
  | "fullChainMs"
  | "quoteSnapshotMs"
  | "firstQuoteMs";

type SessionState = {
  updatedAt: number | null;
  ticker?: string | null;
  expiration?: string | null;
  providerMode?: string | null;
  metadataQueueDepth?: number;
  fullQueueDepth?: number;
  wsState?: string;
  quoteMode?: string;
  fallbackMode?: string | null;
  pauseReason?: string | null;
  selectedProviderContractId?: string | null;
  chartHydrationStatus?: string | null;
  quoteFreshness?: string | null;
  barFreshness?: string | null;
  chartEmptyReason?: string | null;
  expirationCacheStatus?: string | null;
  expirationReturnedCount?: number;
  expirationRequestedCount?: number;
  expirationComplete?: boolean;
  expirationCapped?: boolean;
  expirationStale?: boolean;
  expirationDegraded?: boolean;
  expirationReason?: string | null;
  requestedQuotes?: number;
  acceptedQuotes?: number;
  rejectedQuotes?: number;
  pendingQuotes?: number;
  activeQuoteSubscriptions?: number;
  pinnedQuoteSubscriptions?: number;
  rotatingQuoteSubscriptions?: number;
  returnedQuotes?: number;
  bufferedAmount?: number;
  degraded?: boolean;
};

type PersistedSession = {
  id: string;
  startedAt: number;
  updatedAt: number;
  rollups: Record<string, { count: number; min: number; max: number; p50: number | null; p95: number | null }>;
  transportStates: string[];
  failureCount: number;
};

const STORAGE_KEY = "rayalgo.optionHydrationDiagnostics.v1";
const SAMPLE_LIMIT = 120;
const HISTORY_LIMIT = 100;
const HISTORY_TTL_MS = 7 * 24 * 60 * 60_000;
const STORAGE_MAX_BYTES = 128 * 1024;
const listeners = new Set<() => void>();
const samples: Record<MetricKey, number[]> = {
  activeChainMs: [],
  batchChainMs: [],
  fullChainMs: [],
  quoteSnapshotMs: [],
  firstQuoteMs: [],
};
let state: SessionState = { updatedAt: null };
let storeVersion = 0;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const sessionStartedAt = Date.now();

const emit = () => {
  storeVersion += 1;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => storeVersion;

const percentile = (values: number[], pct: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
};

const summarize = (values: number[]) => ({
  count: values.length,
  min: values.length ? Math.min(...values) : 0,
  max: values.length ? Math.max(...values) : 0,
  p50: percentile(values, 50),
  p95: percentile(values, 95),
});

const readHistory = (): PersistedSession[] => {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeHistory = (history: PersistedSession[]) => {
  if (typeof window === "undefined" || !window.localStorage) return;
  let nextHistory = history;
  let serialized = JSON.stringify(nextHistory);
  while (serialized.length * 2 > STORAGE_MAX_BYTES && nextHistory.length > 1) {
    nextHistory = nextHistory.slice(1);
    serialized = JSON.stringify(nextHistory);
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // Diagnostics must never interrupt trading UI.
  }
};

const schedulePersist = () => {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const cutoff = Date.now() - HISTORY_TTL_MS;
    const history = readHistory()
      .filter((entry) => entry.updatedAt >= cutoff)
      .filter((entry) => entry.id !== sessionId);
    const rollups = Object.fromEntries(
      (Object.keys(samples) as MetricKey[]).map((key) => [key, summarize(samples[key])]),
    );
    const transportStates = [
      state.providerMode,
      state.wsState,
      state.quoteMode,
      state.fallbackMode,
      state.degraded ? "degraded" : null,
    ].filter((value): value is string => Boolean(value));
    history.push({
      id: sessionId,
      startedAt: sessionStartedAt,
      updatedAt: Date.now(),
      rollups,
      transportStates,
      failureCount: state.rejectedQuotes || 0,
    });
    writeHistory(history.slice(-HISTORY_LIMIT));
  }, 750);
};

export const recordOptionHydrationMetric = (
  metric: MetricKey,
  value: number,
): void => {
  if (!Number.isFinite(value) || value < 0) return;
  const bucket = samples[metric];
  bucket.push(value);
  if (bucket.length > SAMPLE_LIMIT) {
    bucket.splice(0, bucket.length - SAMPLE_LIMIT);
  }
  state = { ...state, updatedAt: Date.now() };
  schedulePersist();
  emit();
};

export const setOptionHydrationDiagnostics = (
  patch: Partial<SessionState>,
): void => {
  state = {
    ...state,
    ...patch,
    updatedAt: Date.now(),
  };
  schedulePersist();
  emit();
};

export const clearOptionHydrationDiagnosticsHistory = (): void => {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  emit();
};

export const useOptionHydrationDiagnostics = () => {
  useSyncExternalStore(subscribe, getSnapshot, () => 0);
  return {
    state,
    metrics: Object.fromEntries(
      (Object.keys(samples) as MetricKey[]).map((key) => [key, summarize(samples[key])]),
    ) as Record<MetricKey, ReturnType<typeof summarize>>,
    history: readHistory(),
  };
};
