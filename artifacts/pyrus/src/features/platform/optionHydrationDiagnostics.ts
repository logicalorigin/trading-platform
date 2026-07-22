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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isPersistedSession = (value: unknown): value is PersistedSession => {
  if (!isRecord(value) || !isRecord(value.rollups)) return false;
  const validRollups = Object.values(value.rollups).every(
    (rollup) =>
      isRecord(rollup) &&
      isFiniteNumber(rollup.count) &&
      isFiniteNumber(rollup.min) &&
      isFiniteNumber(rollup.max) &&
      (rollup.p50 === null || isFiniteNumber(rollup.p50)) &&
      (rollup.p95 === null || isFiniteNumber(rollup.p95)),
  );
  return Boolean(
    typeof value.id === "string" &&
      value.id.trim() &&
      isFiniteNumber(value.startedAt) &&
      isFiniteNumber(value.updatedAt) &&
      validRollups &&
      Array.isArray(value.transportStates) &&
      value.transportStates.every((entry) => typeof entry === "string") &&
      isFiniteNumber(value.failureCount),
  );
};

export const OPTION_HYDRATION_DIAGNOSTICS_STORAGE_KEY =
  "pyrus.optionHydrationDiagnostics.v1";
const STORAGE_KEY = OPTION_HYDRATION_DIAGNOSTICS_STORAGE_KEY;
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
let emitScheduled = false;
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const sessionStartedAt = Date.now();

const emit = () => {
  storeVersion += 1;
  if (emitScheduled) return;
  emitScheduled = true;
  const notify = () => {
    emitScheduled = false;
    listeners.forEach((listener) => listener());
  };
  if (typeof queueMicrotask === "function") {
    queueMicrotask(notify);
  } else {
    setTimeout(notify, 0);
  }
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

const removeStoredHistory = (storage?: Storage | null): void => {
  if (typeof window === "undefined") return;
  try {
    (storage ?? window.localStorage)?.removeItem(STORAGE_KEY);
  } catch {
    // Diagnostics cleanup must never interrupt trading UI.
  }
};

const readHistory = (): PersistedSession[] => {
  if (typeof window === "undefined") return [];
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
    if (!storage) return [];
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isPersistedSession)) {
      return parsed;
    }
  } catch {
    // Fall through and evict malformed or unreadable persisted diagnostics.
  }
  removeStoredHistory(storage);
  return [];
};

const writeHistory = (history: PersistedSession[]) => {
  if (typeof window === "undefined") return;
  let nextHistory = history;
  let serialized = JSON.stringify(nextHistory);
  while (serialized.length * 2 > STORAGE_MAX_BYTES && nextHistory.length > 1) {
    nextHistory = nextHistory.slice(1);
    serialized = JSON.stringify(nextHistory);
  }
  try {
    window.localStorage?.setItem(STORAGE_KEY, serialized);
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
  removeStoredHistory();
  emit();
};

export const useOptionHydrationDiagnostics = (enabled = true) => {
  useSyncExternalStore(
    enabled ? subscribe : () => () => {},
    enabled ? getSnapshot : () => 0,
    () => 0,
  );
  return {
    state,
    metrics: Object.fromEntries(
      (Object.keys(samples) as MetricKey[]).map((key) => [key, summarize(samples[key])]),
    ) as Record<MetricKey, ReturnType<typeof summarize>>,
    history: readHistory(),
  };
};
