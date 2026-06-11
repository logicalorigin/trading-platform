// Synchronous localStorage record of the last successful boot, used to dismiss
// the full-screen boot overlay immediately on a warm reload instead of waiting
// for the cold `session` + `watchlists` round-trips. Overlay-only: the live
// queries still fetch and all live gates keep using live session state.
//
// Modeled on features/signals/signalMatrixSnapshotCache.js.

export const BOOT_WARM_START_CACHE_KEY = "pyrus:boot-warm-start:v1";
export const BOOT_WARM_START_FRESH_MS = 12 * 60 * 60_000;

const browserStorage = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch (_error) {
    return null;
  }
};

const normalizeEnvironment = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "paper" || normalized === "live" ? normalized : null;
};

export const readBootWarmStart = ({
  storage = browserStorage(),
  nowMs = Date.now(),
  freshAgeMs = BOOT_WARM_START_FRESH_MS,
} = {}) => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(BOOT_WARM_START_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;
    const savedAt = Number(parsed.savedAt);
    if (!Number.isFinite(savedAt) || nowMs - savedAt > freshAgeMs) {
      storage.removeItem(BOOT_WARM_START_CACHE_KEY);
      return null;
    }
    return {
      environment: normalizeEnvironment(parsed.environment),
      savedAt,
    };
  } catch (_error) {
    try {
      storage.removeItem(BOOT_WARM_START_CACHE_KEY);
    } catch (_removeError) {}
    return null;
  }
};

export const writeBootWarmStart = (
  { environment } = {},
  { storage = browserStorage(), nowMs = Date.now() } = {},
) => {
  if (!storage) return false;
  try {
    storage.setItem(
      BOOT_WARM_START_CACHE_KEY,
      JSON.stringify({
        version: 1,
        savedAt: nowMs,
        environment: normalizeEnvironment(environment),
      }),
    );
    return true;
  } catch (_error) {
    return false;
  }
};
