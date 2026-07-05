import { lazy, type ComponentType } from "react";

const RETRYABLE_DYNAMIC_IMPORT_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "failed to load module script",
  "networkerror when attempting to fetch resource",
  "chunkloaderror",
  "loading chunk",
  "non-javascript mime type",
];

const DEFAULT_DYNAMIC_IMPORT_RETRIES = 2;
const DEFAULT_DYNAMIC_IMPORT_RETRY_DELAY_MS = 250;
// A dynamic import can stall PENDING forever (never resolves, never rejects)
// when the chunk request queues behind a saturated per-origin connection pool
// (open SSE streams + rate limiting) or a hung dev-server transform. A pending
// import settles neither PreloadableScreen's frameReady nor its loadError path,
// stranding the boot "first-screen" task at 62% and any Suspense fallback
// indefinitely. Racing each attempt against a generous timeout converts the
// stall into a RETRYABLE rejection ("loading chunk … timed out" matches the
// retryable patterns above), so the existing retry -> reload-once -> degraded
// error UI chain applies. Generous on purpose: cold dev transforms of large
// modules legitimately take 20s+.
const DEFAULT_DYNAMIC_IMPORT_TIMEOUT_MS = 25_000;
// After a chunk failure triggers a one-time reload, the document is normally
// replaced long before this elapses. If the reload is blocked or slow (sandboxed
// view, throttled/backgrounded tab, a reload that re-fails) we reject instead of
// hanging, so callers' .catch / Suspense error boundaries can surface a
// recoverable error rather than a spinner that never lifts.
const RELOAD_NAVIGATION_GRACE_MS = 10_000;
const DYNAMIC_IMPORT_RELOAD_KEY_PREFIX = "pyrus:dynamic-import-reload:";

type DynamicImportOptions = {
  label?: string;
  retries?: number;
  retryDelayMs?: number;
  reloadOnFailure?: boolean;
  timeoutMs?: number;
};

const getDynamicImportErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name || "Error"} ${error.message || ""}`.trim();
  }
  return String(error ?? "");
};

export const isRetryableDynamicImportError = (error: unknown): boolean => {
  const message = getDynamicImportErrorMessage(error).toLowerCase();
  return RETRYABLE_DYNAMIC_IMPORT_PATTERNS.some((pattern) =>
    message.includes(pattern),
  );
};

const wait = (delayMs: number) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, delayMs)));

const raceWithTimeout = <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`Loading chunk ${label} timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

const getReloadKey = (label: string) =>
  `${DYNAMIC_IMPORT_RELOAD_KEY_PREFIX}${label || "module"}`;

const clearReloadGuard = (label: string) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getReloadKey(label));
  } catch {
    // Storage can be unavailable in constrained browser contexts.
  }
};

const maybeReloadOnceForDynamicImport = (label: string): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const key = getReloadKey(label);
  try {
    if (window.sessionStorage.getItem(key)) {
      return false;
    }
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    return false;
  }

  window.location.reload();
  return true;
};

export async function retryDynamicImport<T>(
  loader: () => Promise<T>,
  options: DynamicImportOptions = {},
): Promise<T> {
  const label = options.label || "module";
  const retries = options.retries ?? DEFAULT_DYNAMIC_IMPORT_RETRIES;
  const retryDelayMs =
    options.retryDelayMs ?? DEFAULT_DYNAMIC_IMPORT_RETRY_DELAY_MS;
  const reloadOnFailure = options.reloadOnFailure ?? true;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DYNAMIC_IMPORT_TIMEOUT_MS;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const mod = await raceWithTimeout(loader(), timeoutMs, label);
      clearReloadGuard(label);
      return mod;
    } catch (error) {
      lastError = error;
      if (!isRetryableDynamicImportError(error) || attempt >= retries) {
        break;
      }
      await wait(retryDelayMs * (attempt + 1));
    }
  }

  if (
    reloadOnFailure &&
    isRetryableDynamicImportError(lastError) &&
    maybeReloadOnceForDynamicImport(label)
  ) {
    return new Promise<T>((_, reject) => {
      setTimeout(() => reject(lastError), RELOAD_NAVIGATION_GRACE_MS);
    });
  }

  throw lastError;
}

export function preloadDynamicImport<T>(
  loader: () => Promise<T>,
  options: DynamicImportOptions = {},
) {
  return retryDynamicImport(loader, {
    ...options,
    retries: options.retries ?? 1,
    reloadOnFailure: false,
  }).catch(() => undefined);
}

export function lazyWithRetry<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  options: DynamicImportOptions = {},
) {
  return lazy(async () => {
    const mod = await retryDynamicImport(loader, options);
    if (mod?.default == null) {
      throw new Error(
        `Dynamic import ${options.label || "module"} resolved without a default component.`,
      );
    }
    return mod;
  });
}
