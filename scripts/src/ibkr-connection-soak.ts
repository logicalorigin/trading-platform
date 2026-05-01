export {};

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
const DEFAULT_API_BASE_URL =
  process.env["API_BASE_URL"] ?? "http://127.0.0.1:8080/api";
const DEFAULT_DURATION_MS = 6 * 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_GAP_THRESHOLD_MS = 5_000;
const DEFAULT_STALL_THRESHOLD_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    symbols: DEFAULT_SYMBOLS,
    durationMs: DEFAULT_DURATION_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    gapThresholdMs: DEFAULT_GAP_THRESHOLD_MS,
    stallThresholdMs: DEFAULT_STALL_THRESHOLD_MS,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--api-base-url" && next) {
      options.apiBaseUrl = next;
      index += 1;
      continue;
    }
    if (token === "--symbols" && next) {
      options.symbols = normalizeSymbols(next.split(","));
      index += 1;
      continue;
    }
    if (token === "--duration-ms" && next) {
      options.durationMs = parsePositiveInteger(next, options.durationMs);
      index += 1;
      continue;
    }
    if (token === "--poll-interval-ms" && next) {
      options.pollIntervalMs = parsePositiveInteger(next, options.pollIntervalMs);
      index += 1;
      continue;
    }
    if (token === "--gap-threshold-ms" && next) {
      options.gapThresholdMs = parsePositiveInteger(next, options.gapThresholdMs);
      index += 1;
      continue;
    }
    if (token === "--stall-threshold-ms" && next) {
      options.stallThresholdMs = parsePositiveInteger(
        next,
        options.stallThresholdMs,
      );
      index += 1;
      continue;
    }
    if (token === "--request-timeout-ms" && next) {
      options.requestTimeoutMs = parsePositiveInteger(
        next,
        options.requestTimeoutMs,
      );
      index += 1;
      continue;
    }
  }

  if (!options.symbols.length) {
    options.symbols = DEFAULT_SYMBOLS;
  }

  return options;
}

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function parsePositiveInteger(raw: string, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
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
    `${JSON.stringify({ at: new Date().toISOString(), type, ...payload })}\n`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
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

function findSseBoundary(buffer: string): { index: number; length: number } | null {
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

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    const cleanup = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", cleanup, { once: true });
  });
}

function abortAfter(controller: AbortController, ms: number): void {
  const timer = setTimeout(() => controller.abort(), ms);
  timer.unref?.();
}

async function requestJson(
  name: string,
  url: URL,
  timeoutMs: number,
): Promise<JsonRecord> {
  const controller = new AbortController();
  abortAfter(controller, timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    const ms = Math.round(performance.now() - startedAt);
    const base = {
      name,
      ok: response.ok,
      status: response.status,
      ms,
      bytes: Buffer.byteLength(text),
      headers: {
        cache: response.headers.get("x-rayalgo-cache-status"),
        requestMs: response.headers.get("x-rayalgo-request-ms"),
        upstreamMs: response.headers.get("x-rayalgo-upstream-ms"),
        gapFilled: response.headers.get("x-rayalgo-gap-filled"),
        degraded: response.headers.get("x-rayalgo-degraded"),
        degradedReason: response.headers.get("x-rayalgo-degraded-reason"),
        stale: response.headers.get("x-rayalgo-cache-stale"),
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

function summarizeRuntime(data: unknown): JsonRecord {
  const ibkr = readPath(data, ["ibkr"]);
  const bridgeQuote = readPath(data, ["ibkr", "bridgeDiagnostics", "subscriptions"]);
  const streamBridgeQuote = readPath(data, ["ibkr", "streams", "bridgeQuote"]);
  const stockAggregates = readPath(data, ["ibkr", "streams", "stockAggregates"]);
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
    delayedCount: quoteRecords.filter((quote) => readPath(quote, ["delayed"]) === true)
      .length,
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
}): Promise<void> {
  const decoder = new TextDecoder();
  let lastStallBucket = 0;

  while (!input.signal.aborted) {
    input.stats.reconnects += 1;
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    input.signal.addEventListener("abort", relayAbort, { once: true });

    try {
      const response = await fetch(input.url, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      log("sse-open", {
        label: input.stats.label,
        status: response.status,
        ok: response.ok,
        reconnects: input.stats.reconnects,
        url: input.url.toString(),
      });

      if (!response.ok || !response.body) {
        input.stats.errors += 1;
        input.stats.lastError = `HTTP ${response.status}`;
        await wait(5_000, input.signal);
        continue;
      }

      const reader = response.body.getReader();
      let buffer = "";

      while (!input.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          log("sse-closed", {
            label: input.stats.label,
            events: input.stats.events,
            gaps: input.stats.gaps,
          });
          break;
        }

        const now = Date.now();
        if (
          input.stats.lastAt !== null &&
          now - input.stats.lastAt >= input.stallThresholdMs
        ) {
          const bucket = Math.floor((now - input.stats.lastAt) / input.stallThresholdMs);
          if (bucket > lastStallBucket) {
            lastStallBucket = bucket;
            log("sse-stall", {
              label: input.stats.label,
              ageMs: now - input.stats.lastAt,
              events: input.stats.events,
              lastEvent: input.stats.lastEvent,
            });
          }
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
                log("sse-gap", {
                  label: input.stats.label,
                  event: message.event,
                  gapMs,
                  events: input.stats.events,
                  thresholdMs: input.gapThresholdMs,
                });
              }
            }

            input.stats.events += 1;
            input.stats.payloadItems += payloadItemCount(message.data, message.event);
            input.stats.lastAt = eventAt;
            lastStallBucket = 0;

            if (input.stats.events % 1_000 === 0) {
              log("sse-events", {
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
      }
    } catch (error) {
      if (!input.signal.aborted) {
        input.stats.errors += 1;
        input.stats.lastError = errorMessage(error);
        log("sse-error", {
          label: input.stats.label,
          error: input.stats.lastError,
          errors: input.stats.errors,
        });
      }
    } finally {
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
      ),
      requestJson(
        "session",
        buildUrl(input.options.apiBaseUrl, "session"),
        input.options.requestTimeoutMs,
      ),
      requestJson(
        "diagnostics-latest",
        buildUrl(input.options.apiBaseUrl, "diagnostics/latest"),
        input.options.requestTimeoutMs,
      ),
      requestJson(
        "quotes-snapshot",
        buildUrl(input.options.apiBaseUrl, "quotes/snapshot", { symbols }),
        input.options.requestTimeoutMs,
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

    const down = connected === false || runtime["ok"] === false || session["ok"] === false;
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
        streamStateReason: readPath(runtimeBrief, ["ibkr", "streamStateReason"]),
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
  abortAfter(controller, options.durationMs);

  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  const symbols = options.symbols.join(",");
  const streams = [
    createStreamStats("quotes", "quotes"),
    createStreamStats("stock-aggregates", "aggregate"),
  ];

  log("start", {
    apiBaseUrl: options.apiBaseUrl,
    symbols: options.symbols,
    durationMs: options.durationMs,
    pollIntervalMs: options.pollIntervalMs,
    gapThresholdMs: options.gapThresholdMs,
    stallThresholdMs: options.stallThresholdMs,
  });

  await Promise.all([
    monitorSse({
      url: buildUrl(options.apiBaseUrl, "streams/quotes", { symbols }),
      stats: streams[0],
      signal: controller.signal,
      gapThresholdMs: options.gapThresholdMs,
      stallThresholdMs: options.stallThresholdMs,
    }),
    monitorSse({
      url: buildUrl(options.apiBaseUrl, "streams/stocks/aggregates", { symbols }),
      stats: streams[1],
      signal: controller.signal,
      gapThresholdMs: options.gapThresholdMs,
      stallThresholdMs: options.stallThresholdMs,
    }),
    pollLoop({ options, signal: controller.signal, streams }),
  ]);

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

main().catch((error) => {
  log("fatal", { error: errorMessage(error) });
  process.exitCode = 1;
});
