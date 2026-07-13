import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  parseArgs as parseNodeArgs,
  stripVTControlCharacters,
} from "node:util";

type CliOptions = {
  apiBaseUrl: string;
  symbols: string[];
  durationMs: number;
  pollIntervalMs: number;
  gapThresholdMs: number;
  stallThresholdMs: number;
  requestTimeoutMs: number;
};

type JsonRecord = Record<string, unknown>;

type StreamStats = {
  label: string;
  eventName: string;
  events: number;
  payloadItems: number;
  gaps: number;
  reconnects: number;
  errors: number;
  maxGapMs: number;
  lastGapMs: number | null;
  lastAt: number | null;
  lastEvent: string | null;
  lastError: string | null;
};

const DEFAULT_SYMBOLS = [
  "SPY",
  "QQQ",
  "IWM",
  "AAPL",
  "MSFT",
  "NVDA",
  "TSLA",
  "AMZN",
  "META",
];
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8080/api";
const DEFAULT_DURATION_MS = 6 * 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_GAP_THRESHOLD_MS = 5_000;
const DEFAULT_STALL_THRESHOLD_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_JSON_RESPONSE_BYTES = 1024 * 1024;
const MAX_SSE_BUFFER_BYTES = 1024 * 1024;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_LOG_STRING_LENGTH = 1_000;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9./_-]{0,63}$/u;
const USAGE =
  "Usage: pnpm --filter @workspace/scripts run ibkr:soak -- [--api-base-url=HTTP_URL] [--symbols=SYMBOLS] [--duration-ms=POSITIVE_INTEGER] [--poll-interval-ms=POSITIVE_INTEGER] [--gap-threshold-ms=POSITIVE_INTEGER] [--stall-threshold-ms=POSITIVE_INTEGER] [--request-timeout-ms=POSITIVE_INTEGER]";

function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  try {
    const parsed = parseNodeArgs({
      args,
      allowPositionals: false,
      strict: true,
      tokens: true,
      options: {
        "api-base-url": { type: "string" },
        symbols: { type: "string" },
        "duration-ms": { type: "string" },
        "poll-interval-ms": { type: "string" },
        "gap-threshold-ms": { type: "string" },
        "stall-threshold-ms": { type: "string" },
        "request-timeout-ms": { type: "string" },
      },
    });
    const counts = new Map<string, number>();
    for (const token of parsed.tokens) {
      if (token.kind !== "option") continue;
      counts.set(token.name, (counts.get(token.name) ?? 0) + 1);
    }
    if ([...counts.values()].some((count) => count > 1)) {
      throw new Error("Duplicate options are not allowed.");
    }

    return {
      apiBaseUrl: parseApiBaseUrl(
        parsed.values["api-base-url"] ??
          env["API_BASE_URL"] ??
          DEFAULT_API_BASE_URL,
      ),
      symbols:
        parsed.values.symbols === undefined
          ? [...DEFAULT_SYMBOLS]
          : parseSymbols(parsed.values.symbols),
      durationMs: parsePositiveInteger(
        "duration-ms",
        parsed.values["duration-ms"],
        DEFAULT_DURATION_MS,
      ),
      pollIntervalMs: parsePositiveInteger(
        "poll-interval-ms",
        parsed.values["poll-interval-ms"],
        DEFAULT_POLL_INTERVAL_MS,
      ),
      gapThresholdMs: parsePositiveInteger(
        "gap-threshold-ms",
        parsed.values["gap-threshold-ms"],
        DEFAULT_GAP_THRESHOLD_MS,
      ),
      stallThresholdMs: parsePositiveInteger(
        "stall-threshold-ms",
        parsed.values["stall-threshold-ms"],
        DEFAULT_STALL_THRESHOLD_MS,
      ),
      requestTimeoutMs: parsePositiveInteger(
        "request-timeout-ms",
        parsed.values["request-timeout-ms"],
        DEFAULT_REQUEST_TIMEOUT_MS,
      ),
    };
  } catch (error) {
    throw new Error(`${USAGE}\n${rawErrorMessage(error)}`);
  }
}

function parseApiBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "--api-base-url must be a credential-free HTTP(S) URL without a query or fragment.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
  return url.toString().replace(/\/$/u, "");
}

function parseSymbols(raw: string): string[] {
  const values = raw.split(",").map((symbol) => symbol.trim().toUpperCase());
  if (!values.length || values.some((symbol) => !SYMBOL_PATTERN.test(symbol))) {
    throw new Error("--symbols must contain valid comma-separated symbols.");
  }
  return [...new Set(values)];
}

function parsePositiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(raw)) {
    throw new Error(`--${name} must be a canonical positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`--${name} is outside the supported range.`);
  }
  return value;
}

function buildUrl(
  baseUrl: string,
  path: string,
  params: Record<string, string | number | boolean | null | undefined> = {},
): URL {
  const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const basePath = url.pathname.replace(/\/+$/, "");
  const nextPath = path.replace(/^\/+/, "");
  url.pathname = `${basePath}/${nextPath}`.replace(/\/{2,}/g, "/");

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    url.searchParams.set(key, String(value));
  });

  return url;
}

function log(type: string, payload: JsonRecord = {}): void {
  process.stdout.write(
    `${JSON.stringify(
      { at: new Date().toISOString(), type, ...payload },
      (_key, value) => (typeof value === "string" ? safeText(value) : value),
    )}\n`,
  );
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error);
}

function safeText(value: unknown): string {
  const withoutCredentials = String(value ?? "")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(/\s+/gu, " ");
  const cleaned = stripVTControlCharacters(withoutCredentials)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (cleaned.length <= MAX_LOG_STRING_LENGTH) return cleaned;
  return `${cleaned.slice(0, MAX_LOG_STRING_LENGTH - 1)}…`;
}

function errorMessage(error: unknown): string {
  return safeText(rawErrorMessage(error)) || "Unknown soak error";
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    const record = asRecord(current);
    current = record[key];
  }
  return current;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pick(input: unknown, keys: string[]): JsonRecord {
  const record = asRecord(input);
  const output: JsonRecord = {};
  keys.forEach((key) => {
    if (record[key] !== undefined) {
      output[key] = record[key];
    }
  });
  return output;
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const data: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }

  if (!data.length) {
    return null;
  }

  return { event, data: data.join("\n") };
}

function findSseBoundary(
  buffer: string,
): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");

  if (lf === -1 && crlf === -1) {
    return null;
  }
  if (lf === -1) {
    return { index: crlf, length: 4 };
  }
  if (crlf === -1 || lf < crlf) {
    return { index: lf, length: 2 };
  }
  return { index: crlf, length: 4 };
}

function payloadItemCount(data: string, eventName: string): number {
  try {
    const parsed = JSON.parse(data);
    const record = asRecord(parsed);
    if (eventName === "quotes") {
      const quotes = record["quotes"];
      return Array.isArray(quotes) ? quotes.length : 1;
    }
    return 1;
  } catch {
    return 1;
  }
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

function abortAfter(controller: AbortController, ms: number): () => void {
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}

async function requestJson(
  name: string,
  url: URL,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<JsonRecord> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal,
    });
    const text = await readResponseText(response, MAX_JSON_RESPONSE_BYTES);
    const ms = Math.round(performance.now() - startedAt);
    const base = {
      name,
      ok: response.ok,
      status: response.status,
      ms,
      bytes: Buffer.byteLength(text),
      headers: {
        cache: response.headers.get("x-pyrus-cache-status"),
        requestMs: response.headers.get("x-pyrus-request-ms"),
        upstreamMs: response.headers.get("x-pyrus-upstream-ms"),
        gapFilled: response.headers.get("x-pyrus-gap-filled"),
        degraded: response.headers.get("x-pyrus-degraded"),
        degradedReason: response.headers.get("x-pyrus-degraded-reason"),
        stale: response.headers.get("x-pyrus-cache-stale"),
      },
    };

    if (!response.ok) {
      return { ...base, error: text.slice(0, 500) };
    }

    return { ...base, data: text ? JSON.parse(text) : null };
  } catch (error) {
    return {
      name,
      ok: false,
      ms: Math.round(performance.now() - startedAt),
      error: errorMessage(error),
    };
  }
}

async function readResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`JSON response exceeded the ${maxBytes}-byte limit.`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error(`JSON response exceeded the ${maxBytes}-byte limit.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function summarizeRuntime(data: unknown): JsonRecord {
  const ibkr = readPath(data, ["ibkr"]);
  const bridgeQuote = readPath(data, [
    "ibkr",
    "bridgeDiagnostics",
    "subscriptions",
  ]);
  const streamBridgeQuote = readPath(data, ["ibkr", "streams", "bridgeQuote"]);
  const stockAggregates = readPath(data, [
    "ibkr",
    "streams",
    "stockAggregates",
  ]);
  const governor = readPath(data, ["ibkr", "governor"]);
  const scheduler = readPath(data, ["ibkr", "bridgeDiagnostics", "scheduler"]);

  return {
    ibkr: pick(ibkr, [
      "reachable",
      "connected",
      "authenticated",
      "healthFresh",
      "healthAgeMs",
      "bridgeReachable",
      "socketConnected",
      "accountsLoaded",
      "marketDataMode",
      "liveMarketDataAvailable",
      "streamFresh",
      "streamState",
      "streamStateReason",
      "lastStreamEventAgeMs",
      "strictReady",
      "strictReason",
      "lastError",
      "healthError",
    ]),
    subscriptions: pick(bridgeQuote, [
      "activeQuoteSubscriptions",
      "activeEquitySubscriptions",
      "activeOptionSubscriptions",
      "quoteListenerCount",
      "barStreamCount",
      "cachedQuoteCount",
      "quoteEventCount",
      "lastQuoteAgeMs",
      "lastAggregateSourceAgeMs",
    ]),
    bridgeQuoteStream: pick(streamBridgeQuote, [
      "activeConsumerCount",
      "unionSymbolCount",
      "eventCount",
      "reconnectCount",
      "streamGapCount",
      "recentGapCount",
      "maxGapMs",
      "recentMaxGapMs",
      "lastGapMs",
      "lastGapAt",
      "lastEventAgeMs",
      "lastSignalAgeMs",
      "streamActive",
      "reconnectScheduled",
      "pressure",
      "lastError",
    ]),
    stockAggregates: pick(stockAggregates, [
      "activeConsumerCount",
      "unionSymbolCount",
      "eventCount",
      "gapCount",
      "maxGapMs",
      "lastAggregateAgeMs",
      "quoteSubscriptionActive",
    ]),
    governor: {
      health: pick(readPath(governor, ["health"]), [
        "circuitOpen",
        "failureCount",
        "backoffRemainingMs",
        "lastFailure",
      ]),
      orders: pick(readPath(governor, ["orders"]), [
        "circuitOpen",
        "failureCount",
        "backoffRemainingMs",
        "lastFailure",
      ]),
      options: pick(readPath(governor, ["options"]), [
        "circuitOpen",
        "failureCount",
        "backoffRemainingMs",
        "lastFailure",
      ]),
    },
    schedulerPressure: pick(scheduler, [
      "control",
      "account",
      "market-subscriptions",
      "historical",
      "options-meta",
      "option-quotes",
    ]),
    memoryMb: readPath(data, ["api", "memoryMb"]),
    eventLoopDelayMs: readPath(data, ["api", "eventLoopDelayMs"]),
  };
}

function summarizeSession(data: unknown): JsonRecord {
  const bridge = readPath(data, ["ibkrBridge"]);
  return {
    environment: readPath(data, ["environment"]),
    brokerProvider: readPath(data, ["brokerProvider"]),
    marketDataProvider: readPath(data, ["marketDataProvider"]),
    bridge: pick(bridge, [
      "configured",
      "connected",
      "authenticated",
      "competing",
      "connectionTarget",
      "sessionMode",
      "clientId",
      "marketDataMode",
      "liveMarketDataAvailable",
      "healthFresh",
      "healthAgeMs",
      "streamFresh",
      "streamState",
      "streamStateReason",
      "lastStreamEventAgeMs",
      "strictReady",
      "strictReason",
      "lastTickleAt",
      "lastError",
      "lastRecoveryAttemptAt",
      "lastRecoveryError",
    ]),
  };
}

function summarizeLatest(data: unknown): JsonRecord {
  const events = readPath(data, ["events"]);
  return {
    status: readPath(data, ["status"]),
    severity: readPath(data, ["severity"]),
    summary: readPath(data, ["summary"]),
    openEvents: Array.isArray(events)
      ? events
          .filter((event) => readPath(event, ["status"]) === "open")
          .slice(0, 10)
          .map((event) => ({
            subsystem: readPath(event, ["subsystem"]),
            severity: readPath(event, ["severity"]),
            code: readPath(event, ["code"]),
            message: readPath(event, ["message"]),
            eventCount: readPath(event, ["eventCount"]),
          }))
      : [],
  };
}

function summarizeQuoteSnapshot(data: unknown): JsonRecord {
  const quotes = readPath(data, ["quotes"]);
  const quoteRecords = Array.isArray(quotes) ? quotes : [];
  const ages = quoteRecords
    .map((quote) => readNumber(readPath(quote, ["freshnessAgeMs"])))
    .filter((age): age is number => age !== null);
  return {
    quoteCount: quoteRecords.length,
    delayedCount: quoteRecords.filter(
      (quote) => readPath(quote, ["delayed"]) === true,
    ).length,
    maxFreshnessAgeMs: ages.length ? Math.max(...ages) : null,
  };
}

function createStreamStats(label: string, eventName: string): StreamStats {
  return {
    label,
    eventName,
    events: 0,
    payloadItems: 0,
    gaps: 0,
    reconnects: 0,
    errors: 0,
    maxGapMs: 0,
    lastGapMs: null,
    lastAt: null,
    lastEvent: null,
    lastError: null,
  };
}

async function monitorSse(input: {
  url: URL;
  stats: StreamStats;
  signal: AbortSignal;
  gapThresholdMs: number;
  stallThresholdMs: number;
  requestTimeoutMs?: number;
  emit?: typeof log;
}): Promise<void> {
  const emit = input.emit ?? log;
  let lastStallBucket = 0;
  let connectionAttempts = 0;

  while (!input.signal.aborted) {
    connectionAttempts += 1;
    if (connectionAttempts > 1) input.stats.reconnects += 1;
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    input.signal.addEventListener("abort", relayAbort, { once: true });
    let stallTimer: NodeJS.Timeout | null = null;
    const connectTimer = setTimeout(
      () => controller.abort(),
      input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    connectTimer.unref?.();

    try {
      const response = await fetch(input.url, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      clearTimeout(connectTimer);
      emit("sse-open", {
        label: input.stats.label,
        status: response.status,
        ok: response.ok,
        reconnects: input.stats.reconnects,
        connectionAttempts,
        url: `${input.url.origin}${input.url.pathname}`,
      });

      if (!response.ok || !response.body) {
        input.stats.errors += 1;
        input.stats.lastError = `HTTP ${response.status}`;
        await response.body?.cancel();
        await wait(5_000, input.signal);
        continue;
      }

      const mediaType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (mediaType !== "text/event-stream") {
        input.stats.errors += 1;
        input.stats.lastError = `Unexpected SSE content type: ${safeText(mediaType ?? "missing")}`;
        await response.body.cancel();
        await wait(5_000, input.signal);
        continue;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const connectionOpenedAt = Date.now();
      lastStallBucket = 0;
      stallTimer = setInterval(() => {
        const referenceAt = Math.max(
          input.stats.lastAt ?? 0,
          connectionOpenedAt,
        );
        const ageMs = Date.now() - referenceAt;
        const bucket = Math.floor(ageMs / input.stallThresholdMs);
        if (bucket <= lastStallBucket) return;
        lastStallBucket = bucket;
        emit("sse-stall", {
          label: input.stats.label,
          ageMs,
          events: input.stats.events,
          lastEvent: input.stats.lastEvent,
        });
      }, input.stallThresholdMs);
      stallTimer.unref?.();

      while (!input.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          emit("sse-closed", {
            label: input.stats.label,
            events: input.stats.events,
            gaps: input.stats.gaps,
          });
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let boundary = findSseBoundary(buffer);
        while (boundary) {
          const rawBlock = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          const message = parseSseBlock(rawBlock);

          if (message) {
            input.stats.lastEvent = message.event;
          }

          if (message?.event === input.stats.eventName) {
            const eventAt = Date.now();
            if (input.stats.lastAt !== null) {
              const gapMs = eventAt - input.stats.lastAt;
              input.stats.maxGapMs = Math.max(input.stats.maxGapMs, gapMs);
              if (gapMs >= input.gapThresholdMs) {
                input.stats.gaps += 1;
                input.stats.lastGapMs = gapMs;
                emit("sse-gap", {
                  label: input.stats.label,
                  event: message.event,
                  gapMs,
                  events: input.stats.events,
                  thresholdMs: input.gapThresholdMs,
                });
              }
            }

            input.stats.events += 1;
            input.stats.payloadItems += payloadItemCount(
              message.data,
              message.event,
            );
            input.stats.lastAt = eventAt;
            lastStallBucket = 0;

            if (input.stats.events % 1_000 === 0) {
              emit("sse-events", {
                label: input.stats.label,
                events: input.stats.events,
                payloadItems: input.stats.payloadItems,
                gaps: input.stats.gaps,
                maxGapMs: input.stats.maxGapMs,
              });
            }
          }

          boundary = findSseBoundary(buffer);
        }
        if (Buffer.byteLength(buffer) > MAX_SSE_BUFFER_BYTES) {
          throw new Error(
            `SSE buffer exceeded the ${MAX_SSE_BUFFER_BYTES}-byte limit without a message boundary.`,
          );
        }
      }
    } catch (error) {
      if (!input.signal.aborted) {
        input.stats.errors += 1;
        input.stats.lastError = errorMessage(error);
        emit("sse-error", {
          label: input.stats.label,
          error: input.stats.lastError,
          errors: input.stats.errors,
        });
      }
    } finally {
      clearTimeout(connectTimer);
      if (stallTimer) clearInterval(stallTimer);
      input.signal.removeEventListener("abort", relayAbort);
      controller.abort();
    }

    await wait(5_000, input.signal);
  }
}

async function pollLoop(input: {
  options: CliOptions;
  signal: AbortSignal;
  streams: StreamStats[];
}): Promise<void> {
  let iteration = 0;
  let lastStreamState: string | null = null;
  let lastConnected: boolean | null = null;
  let lastRuntimeBridgeGapCount: number | null = null;
  let lastRuntimeStockGapCount: number | null = null;

  while (!input.signal.aborted) {
    iteration += 1;
    const startedAt = Date.now();
    const symbols = input.options.symbols.join(",");
    log("poll-start", { iteration });

    const [runtime, session, latest, quoteSnapshot] = await Promise.all([
      requestJson(
        "runtime",
        buildUrl(input.options.apiBaseUrl, "diagnostics/runtime"),
        input.options.requestTimeoutMs,
        input.signal,
      ),
      requestJson(
        "session",
        buildUrl(input.options.apiBaseUrl, "session"),
        input.options.requestTimeoutMs,
        input.signal,
      ),
      requestJson(
        "diagnostics-latest",
        buildUrl(input.options.apiBaseUrl, "diagnostics/latest"),
        input.options.requestTimeoutMs,
        input.signal,
      ),
      requestJson(
        "quotes-snapshot",
        buildUrl(input.options.apiBaseUrl, "quotes/snapshot", { symbols }),
        input.options.requestTimeoutMs,
        input.signal,
      ),
    ]);

    const runtimeBrief = runtime["ok"]
      ? summarizeRuntime(runtime["data"])
      : { error: runtime["error"], ms: runtime["ms"] };
    const sessionBrief = session["ok"]
      ? summarizeSession(session["data"])
      : { error: session["error"], ms: session["ms"] };
    const latestBrief = latest["ok"]
      ? summarizeLatest(latest["data"])
      : { error: latest["error"], ms: latest["ms"] };
    const quoteBrief = quoteSnapshot["ok"]
      ? summarizeQuoteSnapshot(quoteSnapshot["data"])
      : { error: quoteSnapshot["error"], ms: quoteSnapshot["ms"] };

    log("poll", {
      iteration,
      runtime: { ...runtime, data: undefined, brief: runtimeBrief },
      session: { ...session, data: undefined, brief: sessionBrief },
      diagnosticsLatest: { ...latest, data: undefined, brief: latestBrief },
      quoteSnapshot: { ...quoteSnapshot, data: undefined, brief: quoteBrief },
    });

    const connected = readPath(runtimeBrief, ["ibkr", "connected"]);
    if (typeof connected === "boolean" && connected !== lastConnected) {
      log("gateway-state-change", {
        connected,
        previousConnected: lastConnected,
        streamState: readPath(runtimeBrief, ["ibkr", "streamState"]),
        healthFresh: readPath(runtimeBrief, ["ibkr", "healthFresh"]),
        healthAgeMs: readPath(runtimeBrief, ["ibkr", "healthAgeMs"]),
      });
      lastConnected = connected;
    }

    const streamState = readPath(runtimeBrief, ["ibkr", "streamState"]);
    if (typeof streamState === "string" && streamState !== lastStreamState) {
      log("stream-state-change", {
        streamState,
        previousStreamState: lastStreamState,
        reason: readPath(runtimeBrief, ["ibkr", "streamStateReason"]),
        lastStreamEventAgeMs: readPath(runtimeBrief, [
          "ibkr",
          "lastStreamEventAgeMs",
        ]),
      });
      lastStreamState = streamState;
    }

    const bridgeGapCount = readNumber(
      readPath(runtimeBrief, ["bridgeQuoteStream", "streamGapCount"]),
    );
    if (
      bridgeGapCount !== null &&
      lastRuntimeBridgeGapCount !== null &&
      bridgeGapCount > lastRuntimeBridgeGapCount
    ) {
      log("diagnostic-gap-counter", {
        stream: "bridgeQuote",
        previous: lastRuntimeBridgeGapCount,
        current: bridgeGapCount,
        maxGapMs: readPath(runtimeBrief, ["bridgeQuoteStream", "maxGapMs"]),
        recentMaxGapMs: readPath(runtimeBrief, [
          "bridgeQuoteStream",
          "recentMaxGapMs",
        ]),
      });
    }
    if (bridgeGapCount !== null) {
      lastRuntimeBridgeGapCount = bridgeGapCount;
    }

    const stockGapCount = readNumber(
      readPath(runtimeBrief, ["stockAggregates", "gapCount"]),
    );
    if (
      stockGapCount !== null &&
      lastRuntimeStockGapCount !== null &&
      stockGapCount > lastRuntimeStockGapCount
    ) {
      log("diagnostic-gap-counter", {
        stream: "stockAggregates",
        previous: lastRuntimeStockGapCount,
        current: stockGapCount,
        maxGapMs: readPath(runtimeBrief, ["stockAggregates", "maxGapMs"]),
      });
    }
    if (stockGapCount !== null) {
      lastRuntimeStockGapCount = stockGapCount;
    }

    const down =
      connected === false || runtime["ok"] === false || session["ok"] === false;
    const healthFresh = readPath(runtimeBrief, ["ibkr", "healthFresh"]);
    const runtimeStreamState = readPath(runtimeBrief, ["ibkr", "streamState"]);
    if (
      down ||
      healthFresh === false ||
      runtimeStreamState === "stale" ||
      runtimeStreamState === "reconnect_needed" ||
      runtimeStreamState === "reconnecting"
    ) {
      log("gateway-issue", {
        connected,
        healthFresh,
        streamState: runtimeStreamState,
        streamStateReason: readPath(runtimeBrief, [
          "ibkr",
          "streamStateReason",
        ]),
        healthError: readPath(runtimeBrief, ["ibkr", "healthError"]),
        lastError: readPath(runtimeBrief, ["ibkr", "lastError"]),
      });
    }

    log("summary", {
      iteration,
      elapsedMs: Date.now() - startedAt,
      streams: input.streams.map((stream) => ({
        label: stream.label,
        events: stream.events,
        payloadItems: stream.payloadItems,
        gaps: stream.gaps,
        reconnects: stream.reconnects,
        errors: stream.errors,
        maxGapMs: stream.maxGapMs,
        lastGapMs: stream.lastGapMs,
        lastAgeMs: stream.lastAt === null ? null : Date.now() - stream.lastAt,
        lastEvent: stream.lastEvent,
        lastError: stream.lastError,
      })),
    });

    const sleepMs = Math.max(
      0,
      input.options.pollIntervalMs - (Date.now() - startedAt),
    );
    await wait(sleepMs, input.signal);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const controller = new AbortController();
  const clearDurationTimer = abortAfter(controller, options.durationMs);
  const abort = () => controller.abort();

  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  const symbols = options.symbols.join(",");
  const quoteStream = createStreamStats("quotes", "quotes");
  const streams = [quoteStream];

  log("start", {
    apiBaseUrl: options.apiBaseUrl,
    symbols: options.symbols,
    durationMs: options.durationMs,
    pollIntervalMs: options.pollIntervalMs,
    gapThresholdMs: options.gapThresholdMs,
    stallThresholdMs: options.stallThresholdMs,
  });

  try {
    await Promise.all([
      monitorSse({
        url: buildUrl(options.apiBaseUrl, "streams/quotes", { symbols }),
        stats: quoteStream,
        signal: controller.signal,
        gapThresholdMs: options.gapThresholdMs,
        stallThresholdMs: options.stallThresholdMs,
        requestTimeoutMs: options.requestTimeoutMs,
      }),
      pollLoop({ options, signal: controller.signal, streams }),
    ]);
  } finally {
    clearDurationTimer();
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }

  log("complete", {
    streams: streams.map((stream) => ({
      label: stream.label,
      events: stream.events,
      payloadItems: stream.payloadItems,
      gaps: stream.gaps,
      reconnects: stream.reconnects,
      errors: stream.errors,
      maxGapMs: stream.maxGapMs,
      lastGapMs: stream.lastGapMs,
      lastError: stream.lastError,
    })),
  });
}

export const __ibkrConnectionSoakInternalsForTests = {
  buildUrl,
  createStreamStats,
  errorMessage,
  monitorSse,
  parseArgs,
  requestJson,
  summarizeRuntime,
  wait,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main().catch((error) => {
    log("fatal", { error: errorMessage(error) });
    process.exitCode = 1;
  });
}
