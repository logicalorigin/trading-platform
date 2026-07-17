export type CustomFetchOptions = RequestInit & {
  baseUrl?: string | null;
  responseType?: "json" | "text" | "blob" | "auto";
  timeoutMs?: number | null;
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;
export type CsrfTokenGetter = AuthTokenGetter;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";
const HEAVY_GET_PRIORITY_HEADER = "x-pyrus-fetch-priority";
const API_TIMING_EVENT = "pyrus:api-request-timing";
const HEAVY_GET_PATHS = new Set([
  "/api/bars",
  "/api/options/chart-bars",
  "/api/options/chains",
  "/api/flow/events",
]);
const HEAVY_GET_CONCURRENCY = 6;
const HEAVY_GET_PRIORITY: Record<string, number> = {
  "/api/bars": 8,
  "/api/options/chart-bars": 12,
  "/api/options/chains": 10,
};

// Safety-net timeouts for idempotent GETs. An unresponsive backend otherwise
// holds browser connections open indefinitely; under the per-origin connection
// cap that starves every other request — including the JS module loads a screen
// needs to finish rendering — so the UI freezes on a spinner with no error.
// These are generous on purpose: they must not fire on a slow-but-valid
// response, only on a truly hung one. Tunable.
const DEFAULT_API_GET_TIMEOUT_MS = 20_000;
const HEAVY_API_GET_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _csrfTokenGetter: CsrfTokenGetter | null = null;
let _heavyActiveCount = 0;
let _heavySequence = 0;
type HeavyQueueEntry = {
  run: () => void;
  reject: (error: unknown) => void;
  priority: number;
  sequence: number;
  started: boolean;
  canceled: boolean;
  enqueuedAtMs: number;
};
const _heavyQueue: HeavyQueueEntry[] = [];
type SharedHeavyRequest<T = unknown> = {
  promise: Promise<T>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
  deadlineId: ReturnType<typeof setTimeout> | null;
};
const _heavyInFlight = new Map<string, SharedHeavyRequest>();

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

/**
 * Register the current web-session CSRF token getter. Unsafe, same-origin
 * requests receive the token unless the caller already supplied one.
 */
export function setCsrfTokenGetter(getter: CsrfTokenGetter | null): void {
  _csrfTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(
  input: RequestInfo | URL,
  explicitMethod?: string,
): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(
  input: RequestInfo | URL,
  baseUrl: string | null = _baseUrl,
): RequestInfo | URL {
  if (!baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${baseUrl.replace(/\/+$/u, "")}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function isSameOriginWebRequest(input: RequestInfo | URL): boolean {
  const rawUrl = resolveUrl(input);
  if (
    typeof window !== "undefined" &&
    typeof window.location?.href === "string"
  ) {
    try {
      const pageUrl = new URL(window.location.href);
      return new URL(rawUrl, pageUrl).origin === pageUrl.origin;
    } catch {
      return false;
    }
  }

  // CSRF tokens authenticate cookie-backed browser sessions. Without a
  // browser origin, allow only URLs that remain relative after URL parsing.
  try {
    new URL(rawUrl);
    return false;
  } catch {
    try {
      return (
        new URL(rawUrl, "https://pyrus-relative.invalid").origin ===
        "https://pyrus-relative.invalid"
      );
    } catch {
      return false;
    }
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function dispatchApiTiming(input: {
  method: string;
  url: string;
  startedAt: number;
  ok: boolean;
  status?: number | null;
  errorName?: string | null;
}): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function"
  ) {
    return;
  }

  try {
    const parsed = new URL(input.url, window.location.href);
    if (!parsed.pathname.startsWith("/api/")) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(API_TIMING_EVENT, {
        detail: {
          method: input.method,
          path: parsed.pathname,
          url: `${parsed.pathname}${parsed.search}`,
          ok: input.ok,
          status: input.status ?? null,
          errorName: input.errorName ?? null,
          durationMs: Math.max(0, Math.round(nowMs() - input.startedAt)),
          observedAt: new Date().toISOString(),
        },
      }),
    );
  } catch {
    // Browser performance diagnostics must never affect API behavior.
  }
}

function normalizeUrlForDedupe(input: RequestInfo | URL): {
  pathname: string;
  normalized: string;
} | null {
  try {
    const url = new URL(resolveUrl(input), "http://custom-fetch.local");
    const pairs: Array<[string, string]> = [];
    url.searchParams.forEach((value, key) => {
      pairs.push([key, value]);
    });
    pairs.sort((left, right) => {
      const keyComparison = left[0].localeCompare(right[0]);
      return keyComparison || left[1].localeCompare(right[1]);
    });
    const params = new URLSearchParams();
    pairs.forEach(([key, value]) => {
      params.append(key, value);
    });
    const query = params.toString();
    return {
      pathname: url.pathname,
      normalized: `${url.origin}${url.pathname}${query ? `?${query}` : ""}`,
    };
  } catch {
    return null;
  }
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function headersFingerprint(
  headers: Headers,
  ignoredHeaderNames: ReadonlySet<string> = new Set(),
): string {
  const entries: Array<[string, string]> = [];
  headers.forEach((value, key) => {
    if (ignoredHeaderNames.has(key)) {
      return;
    }
    entries.push([key, value]);
  });
  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return JSON.stringify(entries);
}

function readHeavyGetPriorityHeader(headers: Headers): number | null {
  const raw = headers.get(HEAVY_GET_PRIORITY_HEADER);
  if (raw == null) {
    return null;
  }

  const priority = Number(raw);
  return Number.isFinite(priority) ? priority : null;
}

function requestInitFingerprint(
  input: RequestInfo | URL,
  init: RequestInit,
): Record<string, string | null> {
  const request = isRequest(input) ? input : null;
  return {
    cache: init.cache ?? request?.cache ?? null,
    credentials: init.credentials ?? request?.credentials ?? null,
    mode: init.mode ?? request?.mode ?? null,
    redirect: init.redirect ?? request?.redirect ?? null,
    referrerPolicy: init.referrerPolicy ?? request?.referrerPolicy ?? null,
  };
}

function buildHeavyGetKey(input: {
  requestInput: RequestInfo | URL;
  init: RequestInit;
  method: string;
  responseType: CustomFetchOptions["responseType"];
  headers: Headers;
  timeoutMs: number | null;
}): string | null {
  if (input.method !== "GET") {
    return null;
  }

  const normalizedUrl = normalizeUrlForDedupe(input.requestInput);
  if (!normalizedUrl || !isHeavyGetPath(normalizedUrl.pathname)) {
    return null;
  }

  return JSON.stringify({
    method: input.method,
    url: normalizedUrl.normalized,
    responseType: input.responseType ?? "auto",
    timeoutMs: input.timeoutMs,
    headers: headersFingerprint(
      input.headers,
      new Set([HEAVY_GET_PRIORITY_HEADER]),
    ),
    request: requestInitFingerprint(input.requestInput, input.init),
  });
}

function getHeavyGetPriority(input: RequestInfo | URL, method: string): number {
  if (method !== "GET") {
    return 0;
  }

  const normalizedUrl = normalizeUrlForDedupe(input);
  if (!normalizedUrl) {
    return 0;
  }

  return HEAVY_GET_PRIORITY[normalizedUrl.pathname] ?? 0;
}

function isHeavyGetPath(pathname: string): boolean {
  return HEAVY_GET_PATHS.has(pathname);
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }

  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function createTimeoutError(timeoutMs: number): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(
      `The request timed out after ${timeoutMs}ms.`,
      "TimeoutError",
    );
  }

  const error = new Error(`The request timed out after ${timeoutMs}ms.`);
  error.name = "TimeoutError";
  return error;
}

function createNetworkError(cause: unknown): Error & { code: "request_network" } {
  const error = new Error("Network request failed.") as Error & {
    code: "request_network";
    cause?: unknown;
  };
  error.name = "NetworkError";
  error.code = "request_network";
  error.cause = cause;
  return error;
}

function resolveDefaultRequestTimeoutMs(
  input: RequestInfo | URL,
  method: string,
): number | null {
  // Only idempotent GETs get an automatic timeout. Mutations
  // (POST/PUT/PATCH/DELETE) must never be auto-aborted: a timed-out order or
  // write leaves ambiguous server state, so those wait for an explicit response.
  if (method !== "GET") {
    return null;
  }
  const normalizedUrl = normalizeUrlForDedupe(input);
  if (
    !normalizedUrl ||
    !(
      normalizedUrl.pathname === "/api" ||
      normalizedUrl.pathname.startsWith("/api/")
    )
  ) {
    return null;
  }
  // Live streams are long-lived by design. They run over EventSource/WebSocket
  // (not this fetch path), but guard the path anyway so a polling fallback is
  // never capped.
  if (normalizedUrl.pathname.startsWith("/api/streams/")) {
    return null;
  }
  // Heavy data endpoints (bars, option chains, flow) can legitimately run long
  // under load; give them more headroom before the safety net fires.
  if (isHeavyGetPath(normalizedUrl.pathname)) {
    return HEAVY_API_GET_TIMEOUT_MS;
  }
  return DEFAULT_API_GET_TIMEOUT_MS;
}

function withRequestTimeout(
  init: RequestInit,
  timeoutMs: number | null | undefined,
): {
  init: RequestInit;
  cleanup: () => void;
  didTimeout: () => boolean;
} {
  if (!timeoutMs || timeoutMs <= 0 || typeof AbortController === "undefined") {
    return {
      init,
      cleanup: () => {},
      didTimeout: () => false,
    };
  }

  const controller = new AbortController();
  const inputSignal = init.signal;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(createTimeoutError(timeoutMs));
  }, timeoutMs);
  const abortFromInput = () => controller.abort(inputSignal?.reason);

  if (inputSignal?.aborted) {
    controller.abort(inputSignal.reason);
  } else {
    inputSignal?.addEventListener("abort", abortFromInput, { once: true });
  }

  return {
    init: {
      ...init,
      signal: controller.signal,
    },
    cleanup: () => {
      clearTimeout(timeoutId);
      inputSignal?.removeEventListener("abort", abortFromInput);
    },
    didTimeout: () => timedOut,
  };
}

function waitForCaller<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function waitForSharedHeavyRequest<T>(
  entry: SharedHeavyRequest<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  entry.waiters += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.waiters = Math.max(0, entry.waiters - 1);
    if (!entry.settled && entry.waiters === 0) {
      entry.controller.abort(createAbortError());
    }
  };
  return waitForCaller(entry.promise, signal).finally(release);
}

const effectiveHeavyPriority = (entry: HeavyQueueEntry, atMs: number): number =>
  entry.priority + Math.max(0, atMs - entry.enqueuedAtMs) / 1_000;

function takeNextHeavyRequest(): (() => void) | null {
  if (!_heavyQueue.length) {
    return null;
  }

  let nextIndex = 0;
  const atMs = nowMs();
  for (let index = 1; index < _heavyQueue.length; index += 1) {
    const current = _heavyQueue[index];
    if (current.canceled) {
      continue;
    }
    const next = _heavyQueue[nextIndex];
    const currentPriority = effectiveHeavyPriority(current, atMs);
    const nextPriority = effectiveHeavyPriority(next, atMs);
    if (
      next.canceled ||
      currentPriority > nextPriority ||
      (currentPriority === nextPriority && current.sequence < next.sequence)
    ) {
      nextIndex = index;
    }
  }

  const [entry] = _heavyQueue.splice(nextIndex, 1);
  if (!entry || entry.canceled) {
    return takeNextHeavyRequest();
  }
  return entry.run;
}

function runQueuedHeavyRequest<T>(
  task: () => Promise<T>,
  priority = 0,
  signal?: AbortSignal | null,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise((resolve, reject) => {
    let entry: HeavyQueueEntry | null = null;
    const cleanup = () => {
      signal?.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      if (!entry || entry.started) {
        return;
      }

      entry.canceled = true;
      const index = _heavyQueue.indexOf(entry);
      if (index >= 0) {
        _heavyQueue.splice(index, 1);
      }
      cleanup();
      reject(
        signal?.reason instanceof Error ? signal.reason : createAbortError(),
      );
    };
    const run = () => {
      if (entry?.canceled) {
        cleanup();
        reject(createAbortError());
        return;
      }
      if (entry) {
        entry.started = true;
      }
      cleanup();
      _heavyActiveCount += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          _heavyActiveCount = Math.max(0, _heavyActiveCount - 1);
          const next = takeNextHeavyRequest();
          next?.();
        });
    };

    if (_heavyActiveCount < HEAVY_GET_CONCURRENCY) {
      run();
      return;
    }

    entry = {
      run,
      reject,
      priority,
      sequence: _heavySequence,
      started: false,
      canceled: false,
      enqueuedAtMs: nowMs(),
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    _heavyQueue.push(entry);
    _heavySequence += 1;
  });
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return (
    mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"))
  );
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(
  response: Response,
  method: string,
): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function"
      ? response.blob()
      : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            'Use responseType "json" or "text" instead.',
        );
      }
      return response.blob();
  }
}

async function executeFetch<T = unknown>(input: {
  requestInput: RequestInfo | URL;
  init: RequestInit;
  method: string;
  headers: Headers;
  responseType: "json" | "text" | "blob" | "auto";
  requestInfo: { method: string; url: string };
  timeoutMs?: number | null;
}): Promise<T> {
  const timed = withRequestTimeout(input.init, input.timeoutMs);
  let responseReceived = false;

  try {
    const response = await fetch(input.requestInput, {
      ...timed.init,
      method: input.method,
      headers: input.headers,
    });
    responseReceived = true;
    dispatchApiPressureHeaderEvent(response, input.requestInfo);

    if (!response.ok) {
      const errorData = await parseErrorBody(response, input.method);
      throw new ApiError(response, errorData, input.requestInfo);
    }

    return (await parseSuccessBody(
      response,
      input.responseType,
      input.requestInfo,
    )) as T;
  } catch (error) {
    if (timed.didTimeout()) {
      throw createTimeoutError(input.timeoutMs ?? 0);
    }
    if ((error as { name?: unknown })?.name === "TimeoutError") {
      throw error;
    }
    if (!responseReceived && (error as { name?: unknown })?.name !== "AbortError") {
      throw createNetworkError(error);
    }
    throw error;
  } finally {
    timed.cleanup();
  }
}

function dispatchApiPressureHeaderEvent(
  response: Response,
  requestInfo: { method: string; url: string },
): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function" ||
    typeof CustomEvent === "undefined"
  ) {
    return;
  }

  const pressureLevel = response.headers.get("x-pyrus-pressure-level");
  const resourceLevel = response.headers.get("x-pyrus-resource-level");
  const routeClass = response.headers.get("x-pyrus-route-class");
  const admissionAction = response.headers.get("x-pyrus-admission-action");
  const admissionReason = response.headers.get("x-pyrus-admission-reason");
  if (
    !pressureLevel &&
    !resourceLevel &&
    !admissionAction &&
    !admissionReason
  ) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("pyrus:api-pressure", {
      detail: {
        pressureLevel,
        resourceLevel,
        routeClass,
        admissionAction,
        admissionReason,
        status: response.status,
        method: requestInfo.method,
        url: requestInfo.url,
        observedAt: new Date().toISOString(),
      },
    }),
  );
}

export function resetCustomFetchDedupeForTests(): void {
  _heavyActiveCount = 0;
  _heavySequence = 0;
  _heavyQueue.splice(0, _heavyQueue.length);
  for (const entry of _heavyInFlight.values()) {
    entry.controller.abort(createAbortError());
    if (entry.deadlineId != null) clearTimeout(entry.deadlineId);
  }
  _heavyInFlight.clear();
}

export const __customFetchInternalsForTests = {
  applyBaseUrl,
};

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  const {
    baseUrl = null,
    responseType = "auto",
    headers: headersInit,
    timeoutMs: timeoutOption,
    ...init
  } = options;
  input = applyBaseUrl(input, baseUrl ?? _baseUrl);

  const method = resolveMethod(input, init.method);
  const requestStartedAt = nowMs();

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(
    isRequest(input) ? input.headers : undefined,
    headersInit,
  );

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  if (
    _csrfTokenGetter &&
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    !headers.has("x-csrf-token") &&
    isSameOriginWebRequest(input)
  ) {
    const token = await _csrfTokenGetter();
    if (token) {
      headers.set("x-csrf-token", token);
    }
  }

  const explicitHeavyPriority = readHeavyGetPriorityHeader(headers);
  const defaultHeavyPriority = getHeavyGetPriority(input, method);
  const heavyRequestPriority = explicitHeavyPriority ?? defaultHeavyPriority;
  if (heavyRequestPriority !== 0) {
    headers.set(HEAVY_GET_PRIORITY_HEADER, String(heavyRequestPriority));
  }
  const requestInfo = { method, url: resolveUrl(input) };
  const timeoutMs =
    timeoutOption === undefined
      ? resolveDefaultRequestTimeoutMs(input, method)
      : timeoutOption;
  const heavyKey = buildHeavyGetKey({
    requestInput: input,
    init,
    method,
    responseType,
    headers,
    timeoutMs,
  });

  try {
    if (heavyKey) {
      const callerSignal =
        init.signal ?? (isRequest(input) ? input.signal : undefined);
      const existing = _heavyInFlight.get(heavyKey);
      if (existing) {
        const result = await waitForSharedHeavyRequest(
          existing as SharedHeavyRequest<T>,
          callerSignal,
        );
        dispatchApiTiming({
          method,
          url: requestInfo.url,
          startedAt: requestStartedAt,
          ok: true,
          status: null,
        });
        return result;
      }

      const { signal: _callerSignal, ...initWithoutSignal } = init;
      const controller = new AbortController();
      const upstreamInit = { ...initWithoutSignal, signal: controller.signal };
      const priority = heavyRequestPriority;
      const entry: SharedHeavyRequest<T> = {
        promise: Promise.resolve(undefined as T),
        controller,
        waiters: 0,
        settled: false,
        deadlineId: null,
      };
      if (timeoutMs != null && timeoutMs > 0) {
        entry.deadlineId = setTimeout(
          () => controller.abort(createTimeoutError(timeoutMs)),
          timeoutMs,
        );
      }
      const sharedRequest = runQueuedHeavyRequest(
        () =>
          executeFetch<T>({
            requestInput: input,
            init: upstreamInit,
            method,
            headers,
            responseType,
            requestInfo,
            timeoutMs: null,
          }),
        priority,
        controller.signal,
      ).finally(() => {
        entry.settled = true;
        if (entry.deadlineId != null) {
          clearTimeout(entry.deadlineId);
          entry.deadlineId = null;
        }
        if (_heavyInFlight.get(heavyKey) === entry) {
          _heavyInFlight.delete(heavyKey);
        }
      });
      entry.promise = sharedRequest;
      _heavyInFlight.set(heavyKey, entry);
      sharedRequest.catch(() => {});
      const result = await waitForSharedHeavyRequest(entry, callerSignal);
      dispatchApiTiming({
        method,
        url: requestInfo.url,
        startedAt: requestStartedAt,
        ok: true,
        status: null,
      });
      return result;
    }

    const result = await executeFetch<T>({
      requestInput: input,
      init,
      method,
      headers,
      responseType,
      requestInfo,
      timeoutMs,
    });
    dispatchApiTiming({
      method,
      url: requestInfo.url,
      startedAt: requestStartedAt,
      ok: true,
      status: null,
    });
    return result;
  } catch (error) {
    dispatchApiTiming({
      method,
      url: requestInfo.url,
      startedAt: requestStartedAt,
      ok: false,
      status: error instanceof ApiError ? error.status : null,
      errorName: error instanceof Error ? error.name : "Error",
    });
    throw error;
  }
}
