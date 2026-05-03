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
const DYNAMIC_IMPORT_RELOAD_KEY_PREFIX = "rayalgo:dynamic-import-reload:";

type DynamicImportOptions = {
  label?: string;
  retries?: number;
  retryDelayMs?: number;
  reloadOnFailure?: boolean;
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
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const mod = await loader();
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
    return new Promise(() => {});
  }

  throw lastError;
}

export function preloadDynamicImport<T>(
  loader: () => Promise<T>,
  options: DynamicImportOptions = {},
) {
  void retryDynamicImport(loader, {
    ...options,
    retries: options.retries ?? 1,
    reloadOnFailure: false,
  }).catch(() => {});
}

export function lazyWithRetry<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  options: DynamicImportOptions = {},
) {
  return lazy(() => retryDynamicImport(loader, options));
}
