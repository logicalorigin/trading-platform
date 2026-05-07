import { timingSafeEqual } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { isHttpError } from "@workspace/ibkr-contracts";
import { logger } from "./logger";
import { ibkrBridgeService } from "./service";
import { createSseWriter, type SseWriter } from "./sse-writer";

const app: Express = express();
const HISTORY_BAR_TIMEFRAMES = ["5s", "1m", "5m", "15m", "1h", "1d"] as const;
type RouteHistoryBarTimeframe = (typeof HISTORY_BAR_TIMEFRAMES)[number];

function isHistoryBarTimeframe(
  value: string | null,
): value is RouteHistoryBarTimeframe {
  return Boolean(
    value && HISTORY_BAR_TIMEFRAMES.includes(value as RouteHistoryBarTimeframe),
  );
}

type ZodIssueLike = {
  message?: unknown;
};

type ZodErrorLike = {
  name: string;
  issues?: unknown;
};

function createQuoteSseBatchWriter(
  writer: SseWriter,
  flushIntervalMs = 100,
): {
  enqueue: (quote: unknown) => void;
  close: () => void;
} {
  let pending: unknown[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  const clearFlushTimer = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  const flush = () => {
    flushTimer = null;
    if (!pending.length || writer.isClosed()) {
      pending = [];
      return;
    }

    const quotes = pending;
    pending = [];
    void writer.writeEvent("quotes", { quotes });
  };

  return {
    enqueue(quote: unknown): void {
      if (writer.isClosed()) {
        return;
      }
      pending.push(quote);
      if (flushTimer) {
        return;
      }
      flushTimer = setTimeout(flush, flushIntervalMs);
      flushTimer.unref?.();
    },
    close(): void {
      clearFlushTimer();
      pending = [];
    },
  };
}

function normalizeQuoteStreamSymbols(rawSymbols: unknown): string[] {
  const values = Array.isArray(rawSymbols)
    ? rawSymbols
    : typeof rawSymbols === "string"
      ? rawSymbols.split(",")
      : [];
  return Array.from(
    new Set(
      values
        .map((symbol) => String(symbol).trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

const quoteStreamSessions = new Map<
  string,
  {
    token: symbol;
    setSymbols(symbols: string[]): Promise<Record<string, unknown>>;
  }
>();

function getErrorCode(error: unknown): string | null {
  if (isHttpError(error) && error.code) {
    return error.code;
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : String(error || "Unknown IBKR bridge stream error.");
}

function isStreamCapacityError(error: unknown): boolean {
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();
  return (
    code === "ibkr_bridge_lane_queue_full" ||
    message.includes("ibkr_bridge_lane_queue_full") ||
    message.includes("lane queue is full") ||
    message.includes("market data line") ||
    message.includes("max number of tickers") ||
    message.includes("ticker limit") ||
    message.includes("subscription limit")
  );
}

function streamCapacityState(error: unknown): "backpressure" | "capacity_limited" {
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();
  return code === "ibkr_bridge_lane_queue_full" ||
    message.includes("ibkr_bridge_lane_queue_full") ||
    message.includes("lane queue is full")
    ? "backpressure"
    : "capacity_limited";
}

function nextStreamRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
}

function isZodError(error: unknown): error is ZodErrorLike {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as ZodErrorLike).name === "ZodError" &&
      Array.isArray((error as ZodErrorLike).issues),
  );
}

export function createRequestAbortSignal(
  req: Request,
  res: Response,
): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const abortIfResponseDidNotFinish = () => {
    if (!res.writableEnded) {
      abort();
    }
  };

  if (req.aborted) {
    abort();
  } else {
    req.once("aborted", abort);
    res.once("close", abortIfResponseDidNotFinish);
  }

  return controller.signal;
}

function isTruthyEnv(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function safeTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

const bridgeApiToken =
  process.env["IBKR_BRIDGE_API_TOKEN"]?.trim() ||
  process.env["IBKR_BRIDGE_TOKEN"]?.trim() ||
  "";
const bridgeRequiresAuth =
  Boolean(bridgeApiToken) ||
  isTruthyEnv(process.env["IBKR_BRIDGE_REQUIRE_AUTH"]);
const bridgeCorsOrigins = (process.env["IBKR_BRIDGE_CORS_ORIGINS"] ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, _res, next) => {
  (req as { _startTime?: number })._startTime = Date.now();
  next();
});
app.use(
  pinoHttp({
    logger,
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      const start = (req as { _startTime?: number })._startTime;
      const responseTime = start ? Date.now() - start : 0;
      if (responseTime >= 1000) return "warn";
      if (req.url?.startsWith("/healthz")) return "silent";
      return "info";
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin: bridgeRequiresAuth
      ? bridgeCorsOrigins.length > 0
        ? bridgeCorsOrigins
        : false
      : true,
  }),
);
app.use((req, res, next) => {
  if (
    req.method === "OPTIONS" ||
    req.path === "/healthz" ||
    req.path === "/readyz"
  ) {
    next();
    return;
  }

  if (!bridgeRequiresAuth) {
    next();
    return;
  }

  if (!bridgeApiToken) {
    res.status(503).json({
      title: "IBKR bridge API token is required",
      status: 503,
      code: "ibkr_bridge_api_token_missing",
      detail:
        "Set IBKR_BRIDGE_API_TOKEN before exposing the bridge or running TWS transport.",
    });
    return;
  }

  const requestToken = extractBearerToken(req.header("authorization"));
  if (!requestToken || !safeTokenEquals(requestToken, bridgeApiToken)) {
    res.status(401).json({
      title: "Unauthorized",
      status: 401,
      code: "ibkr_bridge_unauthorized",
      detail: "Provide a valid Bearer token for the IBKR bridge.",
    });
    return;
  }

  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/healthz", async (_req, res) => {
  res.json(await ibkrBridgeService.getHealth());
});

app.get("/readyz", (_req, res) => {
  res.json({
    ok: true,
    service: "ibkr-bridge",
    updatedAt: new Date().toISOString(),
  });
});

app.get("/session", async (_req, res) => {
  res.json(await ibkrBridgeService.refreshSession());
});

app.get("/diagnostics/lanes", async (_req, res) => {
  res.json(await ibkrBridgeService.getLaneDiagnostics());
});

app.put("/diagnostics/lanes", async (req, res) => {
  res.json(await ibkrBridgeService.updateLaneSettings(req.body ?? {}));
});

app.get("/accounts", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  res.json({
    accounts: await ibkrBridgeService.listAccounts(mode),
  });
});

app.get("/positions", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  res.json({
    positions: await ibkrBridgeService.listPositions({ accountId, mode }),
  });
});

app.get("/orders", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const status =
    typeof req.query.status === "string"
      ? (req.query.status as Parameters<
          typeof ibkrBridgeService.listOrders
        >[0]["status"])
      : undefined;
  res.json(await ibkrBridgeService.listOrders({ accountId, mode, status }));
});

app.get("/executions", async (req, res) => {
  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const symbol =
    typeof req.query.symbol === "string" ? req.query.symbol : undefined;
  const providerContractId =
    typeof req.query.providerContractId === "string" &&
    req.query.providerContractId.trim()
      ? req.query.providerContractId.trim()
      : null;

  res.json({
    executions: await ibkrBridgeService.listExecutions({
      accountId,
      symbol,
      providerContractId,
      days:
        typeof req.query.days === "string" && req.query.days.trim()
          ? Number(req.query.days)
          : undefined,
      limit:
        typeof req.query.limit === "string" && req.query.limit.trim()
          ? Number(req.query.limit)
          : undefined,
    }),
  });
});

app.get("/quotes/snapshot", async (req, res) => {
  const rawSymbols = Array.isArray(req.query.symbols)
    ? req.query.symbols.join(",")
    : typeof req.query.symbols === "string"
      ? req.query.symbols
      : "";
  const symbols = rawSymbols
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  res.json({
    quotes: await ibkrBridgeService.getQuoteSnapshots(symbols),
  });
});

app.get("/quotes/option-activity", async (req, res) => {
  const rawSymbols = Array.isArray(req.query.symbols)
    ? req.query.symbols.join(",")
    : typeof req.query.symbols === "string"
      ? req.query.symbols
      : "";
  const symbols = rawSymbols
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  if (!ibkrBridgeService.getOptionActivitySnapshots) {
    res.status(501).json({
      code: "option_activity_not_supported",
      message: "The active IBKR bridge does not support option activity snapshots.",
    });
    return;
  }

  res.json({
    quotes: await ibkrBridgeService.getOptionActivitySnapshots(symbols),
  });
});

app.post("/quotes/prewarm", async (req, res) => {
  const body = req.body as { symbols?: unknown };
  const rawSymbols = Array.isArray(body.symbols)
    ? body.symbols
    : typeof body.symbols === "string"
      ? body.symbols.split(",")
      : [];
  const symbols = Array.from(
    new Set(
      rawSymbols
        .map((symbol) => String(symbol).trim().toUpperCase())
        .filter(Boolean),
    ),
  );

  await ibkrBridgeService.prewarmQuoteSubscriptions(symbols);
  res.json({
    symbols,
    updatedAt: new Date().toISOString(),
  });
});

app.get("/streams/quotes", async (req, res, next) => {
  const rawSymbols = Array.isArray(req.query.symbols)
    ? req.query.symbols.join(",")
    : typeof req.query.symbols === "string"
      ? req.query.symbols
      : "";
  let symbols = normalizeQuoteStreamSymbols(rawSymbols);
  const sessionId =
    typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";

  if (!symbols.length) {
    res.status(400).json({
      error: "symbols query parameter is required",
    });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const writer = createSseWriter(res, {
    route: "/streams/quotes",
    symbols: symbols.length,
  });
  const quoteBatch = createQuoteSseBatchWriter(writer);
  void writer.writeRetry(5_000);

  let cleanedUp = false;
  let unsubscribe: () => void = () => {};
  let retryTimer: NodeJS.Timeout | null = null;
  let retryAttempt = 0;
  let connectVersion = 0;
  const sessionToken = Symbol(sessionId || "quote-stream");
  let streamStatus: Record<string, unknown> = {
    state: "open",
    lastEventAgeMs: null,
    requestedCount: symbols.length,
  };

  const heartbeat = setInterval(() => {
    if (!cleanedUp && !writer.isClosed()) {
      void writer.writeComment(`ping ${new Date().toISOString()}`);
      void writer.writeEvent("stream-status", streamStatus);
    }
  }, 15_000);
  heartbeat.unref?.();

  const clearRetryTimer = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    clearInterval(heartbeat);
    clearRetryTimer();
    quoteBatch.close();
    unsubscribe();
    if (sessionId && quoteStreamSessions.get(sessionId)?.token === sessionToken) {
      quoteStreamSessions.delete(sessionId);
    }
    writer.close();
  };

  res.on("close", cleanup);
  req.on("aborted", cleanup);

  const connect = async () => {
    const requestedSymbols = symbols;
    const requestVersion = ++connectVersion;
    if (cleanedUp || writer.isClosed()) {
      return;
    }

    try {
      const nextUnsubscribe = await ibkrBridgeService.subscribeQuoteStream(
        requestedSymbols,
        (quote) => {
          quoteBatch.enqueue(quote);
        },
      );
      if (cleanedUp || requestVersion !== connectVersion) {
        nextUnsubscribe();
        return;
      }

      retryAttempt = 0;
      streamStatus = {
        state: "open",
        lastEventAgeMs: null,
        requestedCount: requestedSymbols.length,
        admittedCount: requestedSymbols.length,
        rejectedCount: 0,
      };
      unsubscribe();
      unsubscribe = nextUnsubscribe;
      await writer.writeEvent("stream-status", streamStatus);
      await writer.writeEvent("ready", {
        symbols: requestedSymbols,
        source: "ibkr-bridge",
      });
    } catch (error) {
      if (isStreamCapacityError(error) && !cleanedUp && !writer.isClosed()) {
        const retryDelayMs = nextStreamRetryDelayMs(retryAttempt);
        retryAttempt += 1;
        streamStatus = {
          state: streamCapacityState(error),
          reason: getErrorCode(error) ?? "ibkr_stream_capacity_limited",
          message: getErrorMessage(error),
          requestedCount: requestedSymbols.length,
          admittedCount: 0,
          rejectedCount: requestedSymbols.length,
          retryDelayMs,
        };
        await writer.writeEvent("stream-status", streamStatus);
        clearRetryTimer();
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void connect();
        }, retryDelayMs);
        retryTimer.unref?.();
        return;
      }

      cleanup();
      next(error);
    }
  };

  const setSymbols = async (nextSymbols: string[]) => {
    const normalizedSymbols = normalizeQuoteStreamSymbols(nextSymbols);
    if (!normalizedSymbols.length) {
      throw new Error("At least one quote stream symbol is required.");
    }
    const nextSignature = normalizedSymbols.join(",");
    if (nextSignature === symbols.join(",")) {
      return streamStatus;
    }

    symbols = normalizedSymbols;
    clearRetryTimer();
    await connect();
    return streamStatus;
  };

  if (sessionId) {
    quoteStreamSessions.set(sessionId, { token: sessionToken, setSymbols });
  }

  void connect();
});

app.post("/streams/quotes/sessions/:sessionId/symbols", async (req, res) => {
  const sessionId = req.params.sessionId?.trim() || "";
  const session = sessionId ? quoteStreamSessions.get(sessionId) : null;
  if (!session) {
    res.status(404).json({
      error: "quote stream session not found",
    });
    return;
  }

  const symbols = normalizeQuoteStreamSymbols(
    (req.body as { symbols?: unknown } | undefined)?.symbols,
  );
  if (!symbols.length) {
    res.status(400).json({
      error: "symbols body field is required",
    });
    return;
  }

  const status = await session.setSymbols(symbols);
  res.json({
    sessionId,
    symbols,
    status,
    updatedAt: new Date().toISOString(),
  });
});

app.get("/bars", async (req, res) => {
  const timeframe =
    typeof req.query.timeframe === "string" ? req.query.timeframe : null;

  if (
    typeof req.query.symbol !== "string" ||
    !req.query.symbol.trim() ||
    !isHistoryBarTimeframe(timeframe)
  ) {
    res.status(400).json({
      error: "symbol and timeframe query parameters are required",
    });
    return;
  }

  res.json({
    symbol: req.query.symbol.trim().toUpperCase(),
    timeframe,
    bars: await ibkrBridgeService.getHistoricalBars({
      symbol: req.query.symbol.trim().toUpperCase(),
      timeframe,
      limit:
        typeof req.query.limit === "string" && req.query.limit.trim()
          ? Number(req.query.limit)
          : undefined,
      from:
        typeof req.query.from === "string" && req.query.from.trim()
          ? new Date(req.query.from)
          : undefined,
      to:
        typeof req.query.to === "string" && req.query.to.trim()
          ? new Date(req.query.to)
          : undefined,
      assetClass:
        req.query.assetClass === "option"
          ? "option"
          : req.query.assetClass === "equity"
            ? "equity"
            : undefined,
      providerContractId:
        typeof req.query.providerContractId === "string" &&
        req.query.providerContractId.trim()
          ? req.query.providerContractId.trim()
          : null,
      outsideRth:
        typeof req.query.outsideRth === "string"
          ? req.query.outsideRth === "true"
          : undefined,
      source:
        req.query.source === "midpoint" || req.query.source === "bid_ask"
          ? req.query.source
          : req.query.source === "trades"
            ? "trades"
            : undefined,
    }),
  });
});

app.get("/streams/bars", async (req, res, next) => {
  const timeframe =
    typeof req.query.timeframe === "string" ? req.query.timeframe : null;

  if (
    typeof req.query.symbol !== "string" ||
    !req.query.symbol.trim() ||
    !isHistoryBarTimeframe(timeframe)
  ) {
    res.status(400).json({
      error: "symbol and timeframe query parameters are required",
    });
    return;
  }

  const input = {
    symbol: req.query.symbol.trim().toUpperCase(),
    timeframe,
    assetClass:
      req.query.assetClass === "option"
        ? "option"
        : req.query.assetClass === "equity"
          ? "equity"
          : undefined,
    providerContractId:
      typeof req.query.providerContractId === "string" &&
      req.query.providerContractId.trim()
        ? req.query.providerContractId.trim()
        : null,
    outsideRth:
      typeof req.query.outsideRth === "string"
        ? req.query.outsideRth === "true"
        : undefined,
    source:
      req.query.source === "midpoint" || req.query.source === "bid_ask"
        ? req.query.source
        : req.query.source === "trades"
          ? "trades"
          : undefined,
  } as const;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const writer = createSseWriter(res, {
    route: "/streams/bars",
    symbol: input.symbol,
    timeframe: input.timeframe,
  });
  void writer.writeRetry(5_000);

  let cleanedUp = false;
  let unsubscribe: () => void = () => {};
  let lastBarSignature: string | null = null;
  const heartbeat = setInterval(() => {
    void writer.writeEvent("heartbeat", { at: new Date().toISOString() });
    void writer.writeEvent("stream-status", {
      state: "open",
      symbol: input.symbol,
      timeframe: input.timeframe,
    });
  }, 15_000);
  heartbeat.unref?.();
  const buildBarSignature = (
    bar: {
      timestamp: Date | string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      [key: string]: unknown;
    } | null,
  ): string | null => {
    if (!bar) {
      return null;
    }

    const timestamp =
      bar.timestamp instanceof Date
        ? bar.timestamp.toISOString()
        : String(bar.timestamp);
    return JSON.stringify({
      timestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    });
  };
  const writeBarEvent = (
    bar: {
      timestamp: Date | string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      [key: string]: unknown;
    } | null,
  ) => {
    const signature = buildBarSignature(bar);
    if (!bar || !signature || signature === lastBarSignature) {
      return;
    }

    lastBarSignature = signature;
    void writer.writeEvent("bar", {
      symbol: input.symbol,
      timeframe: input.timeframe,
      bar,
    });
  };

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
    writer.close();
  };

  res.on("close", cleanup);
  req.on("aborted", cleanup);

  try {
    const initialBars = await ibkrBridgeService.getHistoricalBars({
      ...input,
      limit: 1,
    });
    const initialBar = initialBars[initialBars.length - 1] ?? null;
    if (initialBar) {
      writeBarEvent({
        ...initialBar,
        partial: true,
      });
    }

    const nextUnsubscribe =
      await ibkrBridgeService.subscribeHistoricalBarStream(
        input,
        (bar) => {
          writeBarEvent(bar);
        },
        (error) => {
          logger.warn({ err: error }, "IBKR historical bar stream failed");
          void writer.writeEvent("stream-error", {
            title: "Historical bar stream interrupted",
            detail:
              error instanceof Error ? error.message : "Unknown stream error.",
          });
          cleanup();
        },
      );

    if (cleanedUp) {
      nextUnsubscribe();
      return;
    }

    unsubscribe = nextUnsubscribe;
    await writer.writeEvent("ready", {
      symbol: input.symbol,
      timeframe: input.timeframe,
      assetClass: input.assetClass ?? "equity",
      providerContractId: input.providerContractId,
      source: "ibkr-bridge",
    });
  } catch (error) {
    cleanup();
    next(error);
  }
});

app.get("/options/chains", async (req, res) => {
  if (
    typeof req.query.underlying !== "string" ||
    !req.query.underlying.trim()
  ) {
    res.status(400).json({
      error: "underlying query parameter is required",
    });
    return;
  }

  const signal = createRequestAbortSignal(req, res);

  try {
    const underlying = req.query.underlying.trim().toUpperCase();
    const contracts = await ibkrBridgeService.getOptionChain({
      underlying: req.query.underlying.trim().toUpperCase(),
      expirationDate:
        typeof req.query.expirationDate === "string" &&
        req.query.expirationDate.trim()
          ? new Date(req.query.expirationDate)
          : undefined,
      contractType:
        req.query.contractType === "call" || req.query.contractType === "put"
          ? req.query.contractType
          : null,
      maxExpirations:
        typeof req.query.maxExpirations === "string"
          ? Number(req.query.maxExpirations)
          : undefined,
      strikesAroundMoney:
        typeof req.query.strikesAroundMoney === "string"
          ? Number(req.query.strikesAroundMoney)
          : undefined,
      strikeCoverage:
        req.query.strikeCoverage === "fast" ||
        req.query.strikeCoverage === "standard" ||
        req.query.strikeCoverage === "full"
          ? req.query.strikeCoverage
          : undefined,
      quoteHydration:
        req.query.quoteHydration === "metadata" ||
        req.query.quoteHydration === "snapshot"
          ? req.query.quoteHydration
          : undefined,
      signal,
    });

    if (signal.aborted) {
      return;
    }

    res.json({
      underlying,
      contracts,
    });
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    throw error;
  }
});

app.get("/options/expirations", async (req, res) => {
  if (
    typeof req.query.underlying !== "string" ||
    !req.query.underlying.trim()
  ) {
    res.status(400).json({
      error: "underlying query parameter is required",
    });
    return;
  }

  const signal = createRequestAbortSignal(req, res);

  try {
    const underlying = req.query.underlying.trim().toUpperCase();
    const expirations = await ibkrBridgeService.getOptionExpirations({
      underlying,
      maxExpirations:
        typeof req.query.maxExpirations === "string"
          ? Number(req.query.maxExpirations)
          : undefined,
      signal,
    });

    if (signal.aborted) {
      return;
    }

    res.json({
      underlying,
      expirations: expirations.map((expirationDate) => ({ expirationDate })),
    });
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    throw error;
  }
});

app.get("/options/quotes", async (req, res) => {
  const rawProviderContractIds = Array.isArray(req.query.contracts)
    ? req.query.contracts.join(",")
    : typeof req.query.contracts === "string"
      ? req.query.contracts
      : Array.isArray(req.query.providerContractIds)
        ? req.query.providerContractIds.join(",")
        : typeof req.query.providerContractIds === "string"
          ? req.query.providerContractIds
          : "";
  const providerContractIds = Array.from(
    new Set(
      rawProviderContractIds
        .split(",")
        .map((providerContractId) => providerContractId.trim())
        .filter(Boolean),
    ),
  );

  if (!providerContractIds.length) {
    res.status(400).json({
      error: "contracts query parameter is required",
    });
    return;
  }

  res.json({
    underlying:
      typeof req.query.underlying === "string" && req.query.underlying.trim()
        ? req.query.underlying.trim().toUpperCase()
        : null,
    quotes: await ibkrBridgeService.getOptionQuoteSnapshots({
      underlying:
        typeof req.query.underlying === "string" && req.query.underlying.trim()
          ? req.query.underlying.trim().toUpperCase()
          : null,
      providerContractIds,
    }),
  });
});

app.get("/streams/options/quotes", async (req, res, next) => {
  const rawProviderContractIds = Array.isArray(req.query.contracts)
    ? req.query.contracts.join(",")
    : typeof req.query.contracts === "string"
      ? req.query.contracts
      : Array.isArray(req.query.providerContractIds)
        ? req.query.providerContractIds.join(",")
        : typeof req.query.providerContractIds === "string"
          ? req.query.providerContractIds
          : "";
  const providerContractIds = Array.from(
    new Set(
      rawProviderContractIds
        .split(",")
        .map((providerContractId) => providerContractId.trim())
        .filter(Boolean),
    ),
  );

  if (!providerContractIds.length) {
    res.status(400).json({
      error: "contracts query parameter is required",
    });
    return;
  }

  const underlying =
    typeof req.query.underlying === "string" && req.query.underlying.trim()
      ? req.query.underlying.trim().toUpperCase()
      : null;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const writer = createSseWriter(res, {
    route: "/streams/options/quotes",
    underlying,
    contracts: providerContractIds.length,
  });
  const quoteBatch = createQuoteSseBatchWriter(writer);
  void writer.writeRetry(5_000);

  let cleanedUp = false;
  let unsubscribe: () => void = () => {};
  let retryTimer: NodeJS.Timeout | null = null;
  let retryAttempt = 0;
  let streamStatus: Record<string, unknown> = {
    state: "open",
    underlying,
    requestedCount: providerContractIds.length,
    providerContractIds: providerContractIds.length,
  };

  const heartbeat = setInterval(() => {
    if (!cleanedUp && !writer.isClosed()) {
      void writer.writeComment(`ping ${new Date().toISOString()}`);
      void writer.writeEvent("stream-status", streamStatus);
    }
  }, 15_000);
  heartbeat.unref?.();

  const clearRetryTimer = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    clearInterval(heartbeat);
    clearRetryTimer();
    quoteBatch.close();
    unsubscribe();
    writer.close();
  };

  res.on("close", cleanup);
  req.on("aborted", cleanup);

  const connect = async () => {
    if (cleanedUp || writer.isClosed()) {
      return;
    }

    try {
      await writer.writeEvent("quotes", {
        quotes: await ibkrBridgeService.getOptionQuoteSnapshots({
          underlying,
          providerContractIds,
        }),
      });
      const nextUnsubscribe = await ibkrBridgeService.subscribeOptionQuoteStream(
        {
          underlying,
          providerContractIds,
        },
        (quote) => {
          quoteBatch.enqueue(quote);
        },
      );
      if (cleanedUp) {
        nextUnsubscribe();
        return;
      }

      retryAttempt = 0;
      streamStatus = {
        state: "open",
        underlying,
        requestedCount: providerContractIds.length,
        admittedCount: providerContractIds.length,
        rejectedCount: 0,
        providerContractIds: providerContractIds.length,
      };
      unsubscribe();
      unsubscribe = nextUnsubscribe;
      await writer.writeEvent("stream-status", streamStatus);
      await writer.writeEvent("ready", {
        underlying,
        providerContractIds,
        source: "ibkr-bridge",
      });
    } catch (error) {
      if (isStreamCapacityError(error) && !cleanedUp && !writer.isClosed()) {
        const retryDelayMs = nextStreamRetryDelayMs(retryAttempt);
        retryAttempt += 1;
        streamStatus = {
          state: streamCapacityState(error),
          reason: getErrorCode(error) ?? "ibkr_stream_capacity_limited",
          message: getErrorMessage(error),
          underlying,
          requestedCount: providerContractIds.length,
          admittedCount: 0,
          rejectedCount: providerContractIds.length,
          retryDelayMs,
          providerContractIds: providerContractIds.length,
        };
        await writer.writeEvent("stream-status", streamStatus);
        clearRetryTimer();
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void connect();
        }, retryDelayMs);
        retryTimer.unref?.();
        return;
      }

      cleanup();
      next(error);
    }
  };

  void connect();
});

app.get("/market-depth", async (req, res) => {
  if (typeof req.query.symbol !== "string" || !req.query.symbol.trim()) {
    res.status(400).json({
      error: "symbol query parameter is required",
    });
    return;
  }

  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const providerContractId =
    typeof req.query.providerContractId === "string" &&
    req.query.providerContractId.trim()
      ? req.query.providerContractId.trim()
      : null;

  res.json({
    depth: await ibkrBridgeService.getMarketDepth({
      accountId,
      symbol: req.query.symbol.trim().toUpperCase(),
      assetClass:
        req.query.assetClass === "option"
          ? "option"
          : req.query.assetClass === "equity"
            ? "equity"
            : undefined,
      providerContractId,
      exchange:
        typeof req.query.exchange === "string" && req.query.exchange.trim()
          ? req.query.exchange.trim().toUpperCase()
          : null,
    }),
  });
});

app.post("/orders/preview", async (req, res) => {
  res.json(await ibkrBridgeService.previewOrder(req.body));
});

app.post("/orders/submit", async (req, res) => {
  if (Array.isArray(req.body?.ibkrOrders)) {
    res.status(201).json(
      await ibkrBridgeService.submitRawOrders({
        accountId:
          typeof req.body.accountId === "string" ? req.body.accountId : null,
        mode:
          req.body.mode === "live" || req.body.mode === "paper"
            ? req.body.mode
            : null,
        confirm: req.body.confirm === true,
        orders: req.body.ibkrOrders,
      }),
    );
    return;
  }

  res.status(201).json(await ibkrBridgeService.placeOrder(req.body));
});

app.post("/orders", async (req, res) => {
  if (Array.isArray(req.body?.ibkrOrders)) {
    res.status(201).json(
      await ibkrBridgeService.submitRawOrders({
        accountId:
          typeof req.body.accountId === "string" ? req.body.accountId : null,
        mode:
          req.body.mode === "live" || req.body.mode === "paper"
            ? req.body.mode
            : null,
        confirm: req.body.confirm === true,
        orders: req.body.ibkrOrders,
      }),
    );
    return;
  }

  res.status(201).json(await ibkrBridgeService.placeOrder(req.body));
});

app.post("/orders/:orderId/replace", async (req, res) => {
  res.json(
    await ibkrBridgeService.replaceOrder({
      accountId: req.body.accountId,
      orderId: req.params.orderId,
      order: req.body.order,
      mode: req.body.mode === "live" ? "live" : "paper",
    }),
  );
});

app.post("/orders/:orderId/cancel", async (req, res) => {
  res.json(
    await ibkrBridgeService.cancelOrder({
      accountId: req.body.accountId,
      orderId: req.params.orderId,
      manualIndicator:
        typeof req.body.manualIndicator === "boolean"
          ? req.body.manualIndicator
          : null,
      extOperator:
        typeof req.body.extOperator === "string" ? req.body.extOperator : null,
    }),
  );
});

app.get("/news", async (req, res) => {
  const ticker =
    typeof req.query.ticker === "string" ? req.query.ticker : undefined;
  const limit =
    typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  res.json(
    await ibkrBridgeService.getNews({
      ticker,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  );
});

app.get("/universe/search", async (req, res) => {
  const search =
    typeof req.query.search === "string" ? req.query.search : undefined;
  const market =
    typeof req.query.market === "string" ? req.query.market : undefined;
  const marketsRaw = req.query.markets;
  const markets =
    typeof marketsRaw === "string"
      ? marketsRaw
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : Array.isArray(marketsRaw)
        ? marketsRaw.flatMap((value) =>
            typeof value === "string"
              ? value
                  .split(",")
                  .map((part) => part.trim())
                  .filter(Boolean)
              : [],
          )
        : undefined;
  const limit =
    typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  res.json(
    await ibkrBridgeService.searchTickers({
      search,
      market: market as Parameters<
        typeof ibkrBridgeService.searchTickers
      >[0]["market"],
      markets: markets as Parameters<
        typeof ibkrBridgeService.searchTickers
      >[0]["markets"],
      limit: Number.isFinite(limit) ? limit : undefined,
      signal: createRequestAbortSignal(req, res),
    }),
  );
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      return;
    }

    if (isZodError(error)) {
      const issues = (error.issues as unknown[]).map(
        (issue) => issue as ZodIssueLike,
      );

      res.status(400).json({
        title: "Invalid request",
        status: 400,
        detail: issues
          .map((issue) =>
            typeof issue.message === "string" ? issue.message : "Invalid input",
          )
          .join("; "),
        errors: issues,
      });
      return;
    }

    if (isHttpError(error)) {
      if (error.statusCode >= 500) {
        logger.error({ err: error }, "Bridge request failed");
      }

      res.status(error.statusCode).json({
        title: error.message,
        status: error.statusCode,
        detail: error.detail,
        code: error.code,
      });
      return;
    }

    logger.error({ err: error }, "Unhandled bridge error");

    res.status(500).json({
      title: "Internal server error",
      status: 500,
      detail: "The IBKR bridge hit an unexpected error.",
    });
  },
);

export default app;
