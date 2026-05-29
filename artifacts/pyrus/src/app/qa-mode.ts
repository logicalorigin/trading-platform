export const PYRUS_QA_MODE_HEADER = "X-Pyrus-QA-Mode";
export const PYRUS_QA_MODE_STORAGE_KEY = "pyrus:qa-mode";
export const PYRUS_QA_SAFE_MODE = "safe";

type PyrusQaMode = typeof PYRUS_QA_SAFE_MODE | null;

declare global {
  interface Window {
    __PYRUS_QA_MODE__?: PyrusQaMode;
    __PYRUS_QA_FETCH_PATCHED__?: boolean;
    __PYRUS_QA_ORIGINAL_FETCH__?: typeof fetch;
    __PYRUS_QA_REQUESTS__?: Array<{
      method: string;
      url: string;
      time: string;
    }>;
  }
}

export const normalizePyrusQaMode = (
  value: string | null | undefined,
): PyrusQaMode => {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === PYRUS_QA_SAFE_MODE ? PYRUS_QA_SAFE_MODE : null;
};

export const resolvePyrusQaModeFromSearch = (
  search: string | null | undefined,
): PyrusQaMode | "off" => {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const rawValue =
    params.get("pyrusQa") ??
    params.get("pyrusQaMode") ??
    params.get("qaMode") ??
    params.get("qa");
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (normalized === "off" || normalized === "0" || normalized === "false") {
    return "off";
  }
  return normalizePyrusQaMode(normalized);
};

const getWindowOrigin = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.location.origin;
  } catch {
    return null;
  }
};

const safeReadSessionStorage = (key: string): string | null => {
  try {
    return window.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const safeWriteSessionStorage = (key: string, value: string | null): void => {
  try {
    if (value === null) {
      window.sessionStorage?.removeItem(key);
    } else {
      window.sessionStorage?.setItem(key, value);
    }
  } catch {
    // QA mode should never block normal app boot.
  }
};

export const isPyrusApiRequestUrl = (
  input: RequestInfo | URL,
  appOrigin = getWindowOrigin(),
): boolean => {
  const rawUrl =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url;
  if (!rawUrl) {
    return false;
  }
  if (rawUrl.startsWith("/api/") || rawUrl === "/api") {
    return true;
  }
  try {
    const parsed = new URL(rawUrl, appOrigin || undefined);
    return Boolean(
      appOrigin &&
        parsed.origin === appOrigin &&
        (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/")),
    );
  } catch {
    return false;
  }
};

export const withPyrusQaHeader = (
  init: RequestInit | undefined,
  mode: PyrusQaMode,
): RequestInit | undefined => {
  if (mode !== PYRUS_QA_SAFE_MODE) {
    return init;
  }
  const headers = new Headers(init?.headers || {});
  headers.set(PYRUS_QA_MODE_HEADER, PYRUS_QA_SAFE_MODE);
  return {
    ...init,
    headers,
  };
};

const rememberQaRequest = (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof window === "undefined") {
    return;
  }
  const requests = window.__PYRUS_QA_REQUESTS__ ?? [];
  requests.push({
    method:
      init?.method ||
      (typeof input === "object" && "method" in input ? input.method : "GET"),
    url: typeof input === "string" || input instanceof URL ? String(input) : input.url,
    time: new Date().toISOString(),
  });
  window.__PYRUS_QA_REQUESTS__ = requests.slice(-200);
};

const installPyrusQaFetchHeader = () => {
  if (
    typeof window === "undefined" ||
    typeof window.fetch !== "function" ||
    window.__PYRUS_QA_FETCH_PATCHED__
  ) {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.__PYRUS_QA_ORIGINAL_FETCH__ = originalFetch;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const mode = window.__PYRUS_QA_MODE__ ?? null;
    if (mode === PYRUS_QA_SAFE_MODE && isPyrusApiRequestUrl(input)) {
      rememberQaRequest(input, init);
      return originalFetch(input, withPyrusQaHeader(init, mode));
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  window.__PYRUS_QA_FETCH_PATCHED__ = true;
};

export const installPyrusQaMode = (): PyrusQaMode => {
  if (typeof window === "undefined") {
    return null;
  }

  const searchMode = resolvePyrusQaModeFromSearch(window.location.search);
  if (searchMode === "off") {
    safeWriteSessionStorage(PYRUS_QA_MODE_STORAGE_KEY, null);
  } else if (searchMode === PYRUS_QA_SAFE_MODE) {
    safeWriteSessionStorage(PYRUS_QA_MODE_STORAGE_KEY, searchMode);
  }

  const mode = normalizePyrusQaMode(
    safeReadSessionStorage(PYRUS_QA_MODE_STORAGE_KEY),
  );
  window.__PYRUS_QA_MODE__ = mode;
  if (mode === PYRUS_QA_SAFE_MODE) {
    document.documentElement.dataset.pyrusQaMode = mode;
  } else {
    delete document.documentElement.dataset.pyrusQaMode;
  }
  installPyrusQaFetchHeader();
  return mode;
};

export const isPyrusSafeQaMode = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.__PYRUS_QA_MODE__ === PYRUS_QA_SAFE_MODE ||
    normalizePyrusQaMode(safeReadSessionStorage(PYRUS_QA_MODE_STORAGE_KEY)) ===
      PYRUS_QA_SAFE_MODE
  );
};
