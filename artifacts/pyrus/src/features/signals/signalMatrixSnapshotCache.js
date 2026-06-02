const DEFAULT_SIGNAL_MATRIX_TIMEFRAMES = Object.freeze(["1m", "2m", "5m", "15m", "1h"]);
const DEFAULT_MAX_STATES = 750;

export const SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY = "pyrus:signal-matrix-snapshot:v1";
export const SIGNAL_MATRIX_SNAPSHOT_CACHE_TTL_MS = 15 * 60_000;

const browserStorage = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch (_error) {
    return null;
  }
};

const normalizeSymbol = (value) =>
  String(value || "").trim().toUpperCase();

const normalizeTimeframes = (timeframes = DEFAULT_SIGNAL_MATRIX_TIMEFRAMES) => {
  const allowed = new Set(DEFAULT_SIGNAL_MATRIX_TIMEFRAMES);
  const normalized = (Array.isArray(timeframes) ? timeframes : [])
    .map((timeframe) => String(timeframe || "").trim())
    .filter((timeframe) => allowed.has(timeframe));
  const unique = [...new Set(normalized)];
  return unique.length ? unique : [...DEFAULT_SIGNAL_MATRIX_TIMEFRAMES];
};

const normalizeDirection = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "buy" || normalized === "sell" ? normalized : null;
};

const finiteNumberOrNull = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const readTimestamp = (value) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? String(value) : null;
};

const sanitizeState = (state, allowedTimeframes) => {
  if (!state || typeof state !== "object") return null;
  const symbol = normalizeSymbol(state.symbol);
  const timeframe = String(state.timeframe || "").trim();
  if (!symbol || !allowedTimeframes.has(timeframe)) return null;
  const barsSinceSignal = finiteNumberOrNull(state.barsSinceSignal);
  const currentSignalPrice = finiteNumberOrNull(state.currentSignalPrice);
  return {
    id: state.id || `cached-${symbol}-${timeframe}`,
    profileId: state.profileId || null,
    symbol,
    timeframe,
    currentSignalDirection: normalizeDirection(state.currentSignalDirection),
    currentSignalAt: readTimestamp(state.currentSignalAt),
    currentSignalPrice,
    latestBarAt: readTimestamp(state.latestBarAt),
    barsSinceSignal,
    fresh: Boolean(state.fresh),
    status: String(state.status || "ok").trim().toLowerCase() || "ok",
    active: state.active === false ? false : true,
    lastEvaluatedAt: readTimestamp(state.lastEvaluatedAt),
    lastError: state.lastError ? String(state.lastError) : null,
    indicatorSnapshot:
      state.indicatorSnapshot && typeof state.indicatorSnapshot === "object"
        ? state.indicatorSnapshot
        : null,
  };
};

const sanitizeStates = (states, timeframes, maxStates = DEFAULT_MAX_STATES) => {
  const allowedTimeframes = new Set(normalizeTimeframes(timeframes));
  const byKey = new Map();
  (Array.isArray(states) ? states : []).forEach((state) => {
    const sanitized = sanitizeState(state, allowedTimeframes);
    if (!sanitized) return;
    const key = `${sanitized.symbol}:${sanitized.timeframe}`;
    byKey.set(key, sanitized);
  });
  return Array.from(byKey.values())
    .sort((left, right) =>
      left.symbol.localeCompare(right.symbol) ||
      left.timeframe.localeCompare(right.timeframe),
    )
    .slice(0, Math.max(1, maxStates));
};

export const readSignalMatrixSnapshotCache = ({
  storage = browserStorage(),
  nowMs = Date.now(),
  maxAgeMs = SIGNAL_MATRIX_SNAPSHOT_CACHE_TTL_MS,
  timeframes = DEFAULT_SIGNAL_MATRIX_TIMEFRAMES,
} = {}) => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;
    const savedAt = Number(parsed.savedAt);
    if (!Number.isFinite(savedAt) || nowMs - savedAt > maxAgeMs) {
      storage.removeItem(SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY);
      return null;
    }
    const resolvedTimeframes = normalizeTimeframes(parsed.timeframes || timeframes);
    const states = sanitizeStates(parsed.states, resolvedTimeframes);
    if (!states.length) return null;
    return {
      states,
      timeframes: resolvedTimeframes,
      evaluatedAt: readTimestamp(parsed.evaluatedAt),
      cachedAt: savedAt,
      cacheStatus: "warm-start",
    };
  } catch (_error) {
    try {
      storage.removeItem(SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY);
    } catch (_removeError) {}
    return null;
  }
};

export const writeSignalMatrixSnapshotCache = (
  snapshot,
  {
    storage = browserStorage(),
    nowMs = Date.now(),
    maxStates = DEFAULT_MAX_STATES,
    timeframes = DEFAULT_SIGNAL_MATRIX_TIMEFRAMES,
  } = {},
) => {
  if (!storage || !snapshot) return false;
  try {
    const resolvedTimeframes = normalizeTimeframes(snapshot.timeframes || timeframes);
    const states = sanitizeStates(snapshot.states, resolvedTimeframes, maxStates);
    if (!states.length) return false;
    storage.setItem(
      SIGNAL_MATRIX_SNAPSHOT_CACHE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: nowMs,
        evaluatedAt: readTimestamp(snapshot.evaluatedAt),
        timeframes: resolvedTimeframes,
        states,
      }),
    );
    return true;
  } catch (_error) {
    return false;
  }
};
