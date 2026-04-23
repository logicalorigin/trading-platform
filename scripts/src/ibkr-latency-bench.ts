type CliOptions = {
  apiBaseUrl: string;
  bridgeBaseUrl: string;
  symbols: string[];
  durationMs: number;
  firstEventTimeoutMs: number;
  expectedTransport: string | null;
  barsIterations: number;
  optionChainIterations: number;
  barsSymbol: string;
  optionUnderlying: string;
  barsTimeframe: string;
  barsLimit: number;
  label: string | null;
};

type BridgeHealth = {
  configured: boolean;
  authenticated: boolean;
  connected: boolean;
  transport: "client_portal" | "tws" | "ibx";
  selectedAccountId: string | null;
  marketDataMode:
    | "live"
    | "frozen"
    | "delayed"
    | "delayed_frozen"
    | "unknown"
    | null;
  liveMarketDataAvailable: boolean | null;
  lastError: string | null;
  updatedAt: string;
};

type AggregateMessage = {
  symbol: string;
  latency?: {
    bridgeReceivedAt?: string | null;
    bridgeEmittedAt?: string | null;
    apiServerReceivedAt?: string | null;
    apiServerEmittedAt?: string | null;
  } | null;
};

type RequestBenchmark = {
  requestCount: number;
  minMs: number | null;
  maxMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  firstMs: number | null;
  lastMs: number | null;
  responseBytes: number | null;
  cacheHitCount: number;
  cacheMissCount: number;
  cacheInflightCount: number;
  serverTotalP50Ms: number | null;
  serverTotalP95Ms: number | null;
  upstreamP50Ms: number | null;
  upstreamP95Ms: number | null;
  gapFilledCount: number;
};

const DEFAULT_API_BASE_URL = process.env["API_BASE_URL"] ?? "http://127.0.0.1:8080/api";
const DEFAULT_BRIDGE_BASE_URL =
  process.env["IBKR_BRIDGE_BASE_URL"] ?? process.env["BRIDGE_BASE_URL"] ?? "http://127.0.0.1:3002";
const DEFAULT_SYMBOLS = ["SPY", "QQQ", "AAPL"];
const STREAM_GAP_THRESHOLD_MS = 2_500;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    apiBaseUrl: DEFAULT_API_BASE_URL,
    bridgeBaseUrl: DEFAULT_BRIDGE_BASE_URL,
    symbols: DEFAULT_SYMBOLS,
    durationMs: 15_000,
    firstEventTimeoutMs: 7_500,
    expectedTransport: null,
    barsIterations: 3,
    optionChainIterations: 2,
    barsSymbol: DEFAULT_SYMBOLS[0],
    optionUnderlying: DEFAULT_SYMBOLS[0],
    barsTimeframe: "1m",
    barsLimit: 240,
    label: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--api-base-url" && next) {
      options.apiBaseUrl = next;
      index += 1;
      continue;
    }
    if (token === "--bridge-base-url" && next) {
      options.bridgeBaseUrl = next;
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
    if (token === "--first-event-timeout-ms" && next) {
      options.firstEventTimeoutMs = parsePositiveInteger(
        next,
        options.firstEventTimeoutMs,
      );
      index += 1;
      continue;
    }
    if (token === "--expected-transport" && next) {
      options.expectedTransport = next.trim().toLowerCase();
      index += 1;
      continue;
    }
    if (token === "--bars-iterations" && next) {
      options.barsIterations = parsePositiveInteger(next, options.barsIterations);
      index += 1;
      continue;
    }
    if (token === "--option-chain-iterations" && next) {
      options.optionChainIterations = parsePositiveInteger(
        next,
        options.optionChainIterations,
      );
      index += 1;
      continue;
    }
    if (token === "--bars-symbol" && next) {
      options.barsSymbol = normalizeSymbols([next])[0] ?? options.barsSymbol;
      index += 1;
      continue;
    }
    if (token === "--option-underlying" && next) {
      options.optionUnderlying =
        normalizeSymbols([next])[0] ?? options.optionUnderlying;
      index += 1;
      continue;
    }
    if (token === "--bars-timeframe" && next) {
      options.barsTimeframe = next.trim();
      index += 1;
      continue;
    }
    if (token === "--bars-limit" && next) {
      options.barsLimit = parsePositiveInteger(next, options.barsLimit);
      index += 1;
      continue;
    }
    if (token === "--label" && next) {
      options.label = next.trim() || null;
      index += 1;
      continue;
    }
  }

  if (!options.symbols.length) {
    options.symbols = DEFAULT_SYMBOLS;
  }
  if (!options.barsSymbol) {
    options.barsSymbol = options.symbols[0] ?? DEFAULT_SYMBOLS[0];
  }
  if (!options.optionUnderlying) {
    options.optionUnderlying = options.symbols[0] ?? DEFAULT_SYMBOLS[0];
  }

  return options;
}

function normalizeSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol?.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

function parsePositiveInteger(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
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

async function requestJson<T>(url: URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.message ? error.message : String(error);
    throw new Error(`Network request failed for ${url.toString()}: ${detail}`);
  }
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Request failed (${response.status} ${response.statusText}) for ${url.toString()}: ${text.slice(0, 500)}`,
    );
  }

  return (text ? JSON.parse(text) : null) as T;
}

function readTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values: number[], pct: number): number | null {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

function summarizeDurations(values: number[]): RequestBenchmark {
  return {
    requestCount: values.length,
    minMs: values.length ? Math.min(...values) : null,
    maxMs: values.length ? Math.max(...values) : null,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    firstMs: values[0] ?? null,
    lastMs: values[values.length - 1] ?? null,
    responseBytes: null,
    cacheHitCount: 0,
    cacheMissCount: 0,
    cacheInflightCount: 0,
    serverTotalP50Ms: null,
    serverTotalP95Ms: null,
    upstreamP50Ms: null,
    upstreamP95Ms: null,
    gapFilledCount: 0,
  };
}

function readNumberHeader(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
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

  return {
    event,
    data: data.join("\n"),
  };
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

async function benchmarkJsonRequest(
  url: URL,
  iterations: number,
): Promise<RequestBenchmark> {
  const durations: number[] = [];
  const serverTotalDurations: number[] = [];
  const upstreamDurations: number[] = [];
  let responseBytes: number | null = null;
  let cacheHitCount = 0;
  let cacheMissCount = 0;
  let cacheInflightCount = 0;
  let gapFilledCount = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
    } catch (error) {
      const detail =
        error instanceof Error && error.message ? error.message : String(error);
      throw new Error(`Network request failed for ${url.toString()}: ${detail}`);
    }
    const text = await response.text();
    const durationMs = Math.round(performance.now() - startedAt);
    durations.push(durationMs);

    if (!response.ok) {
      throw new Error(
        `Request failed (${response.status} ${response.statusText}) for ${url.toString()}: ${text.slice(0, 500)}`,
      );
    }

    if (responseBytes === null) {
      responseBytes = Buffer.byteLength(text);
    }

    const cacheStatus = response.headers.get("x-rayalgo-cache-status");
    if (cacheStatus === "hit") {
      cacheHitCount += 1;
    } else if (cacheStatus === "miss") {
      cacheMissCount += 1;
    } else if (cacheStatus === "inflight") {
      cacheInflightCount += 1;
    }

    const serverTotalMs = readNumberHeader(response, "x-rayalgo-request-ms");
    if (serverTotalMs !== null) {
      serverTotalDurations.push(serverTotalMs);
    }

    const upstreamMs = readNumberHeader(response, "x-rayalgo-upstream-ms");
    if (upstreamMs !== null) {
      upstreamDurations.push(upstreamMs);
    }

    if (response.headers.get("x-rayalgo-gap-filled") === "1") {
      gapFilledCount += 1;
    }
  }

  return {
    ...summarizeDurations(durations),
    responseBytes,
    cacheHitCount,
    cacheMissCount,
    cacheInflightCount,
    serverTotalP50Ms: percentile(serverTotalDurations, 50),
    serverTotalP95Ms: percentile(serverTotalDurations, 95),
    upstreamP50Ms: percentile(upstreamDurations, 50),
    upstreamP95Ms: percentile(upstreamDurations, 95),
    gapFilledCount,
  };
}

async function benchmarkAggregateStream(input: {
  apiBaseUrl: string;
  symbols: string[];
  durationMs: number;
  firstEventTimeoutMs: number;
}) {
  const url = buildUrl(input.apiBaseUrl, "streams/stocks/aggregates", {
    symbols: input.symbols.join(","),
  });
  const startedAt = performance.now();
  const decoder = new TextDecoder();
  const controller = new AbortController();
  const durationTimer = setTimeout(() => {
    controller.abort();
  }, input.durationMs);
  durationTimer.unref?.();

  let firstEventTimedOut = false;
  const firstEventTimer = setTimeout(() => {
    firstEventTimedOut = true;
    controller.abort();
  }, input.firstEventTimeoutMs);
  firstEventTimer.unref?.();

  let firstEventMs: number | null = null;
  let firstUiRenderableQuoteMs: number | null = null;
  let eventsReceived = 0;
  let readyReceived = false;
  let disconnectCount = 0;
  let streamGapCount = 0;
  let maxGapMs = 0;
  let lastAggregateEventAt: number | null = null;
  const bridgeToApiMs: number[] = [];
  const apiToClientMs: number[] = [];
  const totalQuoteAgeMs: number[] = [];

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw error;
      }

      const detail =
        error instanceof Error && error.message ? error.message : String(error);
      throw new Error(`Aggregate stream request failed for ${url.toString()}: ${detail}`);
    }

    if (!response.ok) {
      throw new Error(
        `Aggregate stream failed (${response.status} ${response.statusText}) for ${url.toString()}`,
      );
    }

    if (!response.body) {
      throw new Error("Aggregate stream response body was empty.");
    }

    const reader = response.body.getReader();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        disconnectCount += 1;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let boundary = findSseBoundary(buffer);
      while (boundary) {
        const rawBlock = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const message = parseSseBlock(rawBlock);

        if (message?.event === "ready") {
          readyReceived = true;
        }

        if (message?.event === "aggregate") {
          const parsed = JSON.parse(message.data) as AggregateMessage;
          const nowMs = Date.now();
          const observedAt = performance.now();
          eventsReceived += 1;

          if (firstEventMs === null) {
            firstEventMs = Math.round(performance.now() - startedAt);
            firstUiRenderableQuoteMs = firstEventMs;
            clearTimeout(firstEventTimer);
          }
          if (lastAggregateEventAt !== null) {
            const gapMs = Math.max(0, Math.round(observedAt - lastAggregateEventAt));
            maxGapMs = Math.max(maxGapMs, gapMs);
            if (gapMs > STREAM_GAP_THRESHOLD_MS) {
              streamGapCount += 1;
            }
          }
          lastAggregateEventAt = observedAt;

          const bridgeEmittedAt = readTimestampMs(parsed.latency?.bridgeEmittedAt);
          const apiServerReceivedAt = readTimestampMs(
            parsed.latency?.apiServerReceivedAt,
          );
          const apiServerEmittedAt = readTimestampMs(
            parsed.latency?.apiServerEmittedAt,
          );
          const bridgeReceivedAt = readTimestampMs(
            parsed.latency?.bridgeReceivedAt,
          );

          if (
            bridgeEmittedAt !== null &&
            apiServerReceivedAt !== null &&
            apiServerReceivedAt >= bridgeEmittedAt
          ) {
            bridgeToApiMs.push(apiServerReceivedAt - bridgeEmittedAt);
          }
          if (apiServerEmittedAt !== null && nowMs >= apiServerEmittedAt) {
            apiToClientMs.push(nowMs - apiServerEmittedAt);
          }
          if (bridgeReceivedAt !== null && nowMs >= bridgeReceivedAt) {
            totalQuoteAgeMs.push(nowMs - bridgeReceivedAt);
          }
        }

        boundary = findSseBoundary(buffer);
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
    if (firstEventTimedOut) {
      throw new Error(
        `Timed out after ${input.firstEventTimeoutMs}ms waiting for the first aggregate event.`,
      );
    }
  } finally {
    clearTimeout(durationTimer);
    clearTimeout(firstEventTimer);
  }

  return {
    firstEventMs,
    firstUiRenderableQuoteMs,
    eventsReceived,
    readyReceived,
    disconnectCount,
    streamGapCount,
    maxGapMs,
    bridgeToApiP50Ms: percentile(bridgeToApiMs, 50),
    bridgeToApiP95Ms: percentile(bridgeToApiMs, 95),
    apiToClientP50Ms: percentile(apiToClientMs, 50),
    apiToClientP95Ms: percentile(apiToClientMs, 95),
    totalQuoteAgeP50Ms: percentile(totalQuoteAgeMs, 50),
    totalQuoteAgeP95Ms: percentile(totalQuoteAgeMs, 95),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const health = await requestJson<BridgeHealth>(
    buildUrl(options.bridgeBaseUrl, "healthz"),
  );

  if (
    options.expectedTransport &&
    health.transport !== options.expectedTransport
  ) {
    throw new Error(
      `Expected bridge transport "${options.expectedTransport}" but got "${health.transport}".`,
    );
  }

  const prewarmStartedAt = performance.now();
  await requestJson(
    buildUrl(options.bridgeBaseUrl, "quotes/prewarm"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ symbols: options.symbols }),
    },
  );
  const prewarmMs = Math.round(performance.now() - prewarmStartedAt);

  const aggregateStream = await benchmarkAggregateStream({
    apiBaseUrl: options.apiBaseUrl,
    symbols: options.symbols,
    durationMs: options.durationMs,
    firstEventTimeoutMs: options.firstEventTimeoutMs,
  });

  const barsBenchmark = await benchmarkJsonRequest(
    buildUrl(options.apiBaseUrl, "bars", {
      symbol: options.barsSymbol,
      timeframe: options.barsTimeframe,
      limit: options.barsLimit,
      outsideRth: options.barsTimeframe !== "1d",
      source: "trades",
      allowHistoricalSynthesis: true,
    }),
    options.barsIterations,
  );

  const optionChainBenchmark = await benchmarkJsonRequest(
    buildUrl(options.apiBaseUrl, "options/chains", {
      underlying: options.optionUnderlying,
    }),
    options.optionChainIterations,
  );

  const summary = {
    label: options.label,
    transport: health.transport,
    symbols: options.symbols,
    health: {
      configured: health.configured,
      connected: health.connected,
      authenticated: health.authenticated,
      selectedAccountId: health.selectedAccountId,
      marketDataMode: health.marketDataMode,
      liveMarketDataAvailable: health.liveMarketDataAvailable,
      lastError: health.lastError,
      updatedAt: health.updatedAt,
    },
    prewarmMs,
    aggregateStream,
    bars: {
      symbol: options.barsSymbol,
      timeframe: options.barsTimeframe,
      limit: options.barsLimit,
      ...barsBenchmark,
    },
    optionChain: {
      underlying: options.optionUnderlying,
      ...optionChainBenchmark,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!health.connected || aggregateStream.eventsReceived === 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
