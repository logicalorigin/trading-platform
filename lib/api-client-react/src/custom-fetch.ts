export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
  timeoutMs?: number | null;
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";
const HEAVY_GET_PRIORITY_HEADER = "x-rayalgo-fetch-priority";
const TRANSIENT_API_GET_STATUS_CODES = new Set([502, 503, 504]);
const DEFAULT_TRANSIENT_API_GET_RETRY_DELAYS_MS = [250, 750, 1_500, 2_500];
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

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _heavyActiveCount = 0;
let _heavySequence = 0;
let _transientApiGetRetryDelaysMs: readonly number[] =
  DEFAULT_TRANSIENT_API_GET_RETRY_DELAYS_MS;
type HeavyQueueEntry = {
  run: () => void;
  reject: (error: unknown) => void;
  priority: number;
  sequence: number;
  started: boolean;
  canceled: boolean;
};
const _heavyQueue: HeavyQueueEntry[] = [];
const _heavyInFlight = new Map<string, Promise<unknown>>();

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

export function setCustomFetchTransientRetryDelaysForTests(
  delaysMs: readonly number[] | null,
): void {
  _transientApiGetRetryDelaysMs =
    delaysMs ?? DEFAULT_TRANSIENT_API_GET_RETRY_DELAYS_MS;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
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
      normalized: query ? `${url.pathname}?${query}` : url.pathname,
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

function headersFingerprint(headers: Headers): string {
  const entries: Array<[string, string]> = [];
  headers.forEach((value, key) => {
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

  headers.delete(HEAVY_GET_PRIORITY_HEADER);
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
}): string | null {
  if (input.method !== "GET") {
    return null;
  }

  const normalizedUrl = normalizeUrlForDedupe(input.requestInput);
  if (!normalizedUrl || !HEAVY_GET_PATHS.has(normalizedUrl.pathname)) {
    return null;
  }

  return JSON.stringify({
    method: input.method,
    url: normalizedUrl.normalized,
    responseType: input.responseType ?? "auto",
    headers: headersFingerprint(input.headers),
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

function shouldDetachCallerAbort(input: RequestInfo | URL, method: string): boolean {
  if (method !== "GET") {
    return false;
  }

  const normalizedUrl = normalizeUrlForDedupe(input);
  if (!normalizedUrl) {
    return false;
  }

  return normalizedUrl.pathname === "/api/options/chains";
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

function resolveDefaultRequestTimeoutMs(
  input: RequestInfo | URL,
  method: string,
): number | null {
  void input;
  void method;
  return null;
}

function isApiPath(input: RequestInfo | URL): boolean {
  const normalizedUrl = normalizeUrlForDedupe(input);
  if (!normalizedUrl) {
    return false;
  }

  return (
    normalizedUrl.pathname === "/api" ||
    normalizedUrl.pathname.startsWith("/api/")
  );
}

function shouldRetryTransientApiGet(input: {
  requestInput: RequestInfo | URL;
  method: string;
  response: Response;
  attemptIndex: number;
}): boolean {
  if (input.method !== "GET") {
    return false;
  }
  if (input.attemptIndex >= _transientApiGetRetryDelaysMs.length) {
    return false;
  }
  if (!TRANSIENT_API_GET_STATUS_CODES.has(input.response.status)) {
    return false;
  }

  return isApiPath(input.requestInput);
}

async function discardRetryResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only. The retry is more important than draining an
    // already-failed proxy response.
  }
}

function waitForRetryDelay(
  delayMs: number,
  signal?: AbortSignal | null,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }
  if (delayMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cleanup = () => {};
    const handleAbort = () => {
      cleanup();
      reject(createAbortError());
    };
    cleanup = () => {
      if (timeoutId != null) {
        clearTimeout(timeoutId);
      }
      signal?.removeEventListener("abort", handleAbort);
    };

    timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
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

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
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

function takeNextHeavyRequest(): (() => void) | null {
  if (!_heavyQueue.length) {
    return null;
  }

  let nextIndex = 0;
  for (let index = 1; index < _heavyQueue.length; index += 1) {
    const current = _heavyQueue[index];
    if (current.canceled) {
      continue;
    }
    const next = _heavyQueue[nextIndex];
    if (
      next.canceled ||
      current.priority > next.priority ||
      (current.priority === next.priority && current.sequence < next.sequence)
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
      reject(createAbortError());
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
      task().then(resolve, reject).finally(() => {
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
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
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

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
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
            "Use responseType \"json\" or \"text\" instead.",
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
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    const timed = withRequestTimeout(input.init, input.timeoutMs);

    try {
      const response = await fetch(input.requestInput, {
        ...timed.init,
        method: input.method,
        headers: input.headers,
      });

      if (!response.ok) {
        if (
          shouldRetryTransientApiGet({
            requestInput: input.requestInput,
            method: input.method,
            response,
            attemptIndex,
          })
        ) {
          const delayMs = _transientApiGetRetryDelaysMs[attemptIndex] ?? 0;
          await discardRetryResponseBody(response);
          timed.cleanup();
          await waitForRetryDelay(delayMs, input.init.signal);
          continue;
        }

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
      throw error;
    } finally {
      timed.cleanup();
    }
  }
}

export function resetCustomFetchDedupeForTests(): void {
  _heavyActiveCount = 0;
  _heavySequence = 0;
  _heavyQueue.splice(0, _heavyQueue.length);
  _heavyInFlight.clear();
  setCustomFetchTransientRetryDelaysForTests(null);
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const {
    responseType = "auto",
    headers: headersInit,
    timeoutMs: timeoutOption,
    ...init
  } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

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

  const explicitHeavyPriority = readHeavyGetPriorityHeader(headers);
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
  });

  if (heavyKey) {
    const callerSignal = init.signal;
    const existing = _heavyInFlight.get(heavyKey);
    if (existing) {
      return waitForCaller(existing as Promise<T>, callerSignal);
    }

    const detachCallerAbort = shouldDetachCallerAbort(input, method);
    const { signal: _callerSignal, ...initWithoutSignal } = init;
    const upstreamInit = detachCallerAbort ? initWithoutSignal : init;
    const priority =
      explicitHeavyPriority ?? getHeavyGetPriority(input, method);
    const sharedRequest = runQueuedHeavyRequest(() =>
      executeFetch<T>({
        requestInput: input,
        init: upstreamInit,
        method,
        headers,
        responseType,
        requestInfo,
        timeoutMs,
      }),
      priority,
      detachCallerAbort ? undefined : callerSignal,
    ).finally(() => {
      _heavyInFlight.delete(heavyKey);
    });
    _heavyInFlight.set(heavyKey, sharedRequest);
    sharedRequest.catch(() => {});
    return waitForCaller(sharedRequest, callerSignal);
  }

  return executeFetch<T>({
    requestInput: input,
    init,
    method,
    headers,
    responseType,
    requestInfo,
    timeoutMs,
  });
}
