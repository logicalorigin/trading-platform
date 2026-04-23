import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { isHttpError } from "../../api-server/src/lib/errors";
import { logger } from "./logger";
import { ibkrBridgeService } from "./service";

const app: Express = express();

type ZodIssueLike = {
  message?: unknown;
};

type ZodErrorLike = {
  name: string;
  issues?: unknown;
};

function isZodError(error: unknown): error is ZodErrorLike {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as ZodErrorLike).name === "ZodError" &&
      Array.isArray((error as ZodErrorLike).issues),
  );
}

function createRequestAbortSignal(req: Request, res: Response): AbortSignal {
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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/healthz", async (_req, res) => {
  res.json(await ibkrBridgeService.getHealth());
});

app.get("/session", async (_req, res) => {
  res.json(await ibkrBridgeService.refreshSession());
});

app.get("/accounts", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  res.json({
    accounts: await ibkrBridgeService.listAccounts(mode),
  });
});

app.get("/positions", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  res.json({
    positions: await ibkrBridgeService.listPositions({ accountId, mode }),
  });
});

app.get("/orders", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status as Parameters<typeof ibkrBridgeService.listOrders>[0]["status"] : undefined;
  res.json({
    orders: await ibkrBridgeService.listOrders({ accountId, mode, status }),
  });
});

app.get("/executions", async (req, res) => {
  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
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
  const symbols = rawSymbols.split(",").map((symbol) => symbol.trim()).filter(Boolean);

  res.json({
    quotes: await ibkrBridgeService.getQuoteSnapshots(symbols),
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
  const symbols = Array.from(
    new Set(rawSymbols.split(",").map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)),
  );

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
  res.write("retry: 5000\n\n");

  let cleanedUp = false;
  let unsubscribe: () => void = () => {};
  let eventId = 1;

  const writeEvent = (event: string, payload: unknown) => {
    if (cleanedUp || res.destroyed) {
      return;
    }

    res.write(
      `id: ${eventId}\n` +
        `event: ${event}\n` +
        `data: ${JSON.stringify(payload)}\n\n`,
    );
    eventId += 1;
  };

  const heartbeat = setInterval(() => {
    if (!cleanedUp && !res.destroyed) {
      res.write(`: ping ${new Date().toISOString()}\n\n`);
    }
  }, 15_000);
  heartbeat.unref?.();

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);

  try {
    const nextUnsubscribe = await ibkrBridgeService.subscribeQuoteStream(symbols, (quote) => {
      writeEvent("quotes", { quotes: [quote] });
    });
    if (cleanedUp) {
      nextUnsubscribe();
      return;
    }

    unsubscribe = nextUnsubscribe;
    writeEvent("ready", {
      symbols,
      source: "ibkr-bridge",
    });
  } catch (error) {
    cleanup();
    next(error);
  }
});

app.get("/bars", async (req, res) => {
  const timeframe = typeof req.query.timeframe === "string" ? req.query.timeframe : null;

  if (
    typeof req.query.symbol !== "string" ||
    !req.query.symbol.trim() ||
    !timeframe ||
    !["1m", "5m", "15m", "1h", "1d"].includes(timeframe)
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
      timeframe: timeframe as "1m" | "5m" | "15m" | "1h" | "1d",
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
        typeof req.query.providerContractId === "string" && req.query.providerContractId.trim()
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
  const timeframe = typeof req.query.timeframe === "string" ? req.query.timeframe : null;

  if (
    typeof req.query.symbol !== "string" ||
    !req.query.symbol.trim() ||
    !timeframe ||
    !["1m", "5m", "15m", "1h", "1d"].includes(timeframe)
  ) {
    res.status(400).json({
      error: "symbol and timeframe query parameters are required",
    });
    return;
  }

  const input = {
    symbol: req.query.symbol.trim().toUpperCase(),
    timeframe: timeframe as "1m" | "5m" | "15m" | "1h" | "1d",
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
  res.write("retry: 5000\n\n");

  let cleanedUp = false;
  let unsubscribe: () => void = () => {};
  let eventId = 1;
  let lastBarSignature: string | null = null;

  const writeEvent = (event: string, payload: unknown) => {
    if (cleanedUp || res.destroyed) {
      return;
    }

    res.write(
      `id: ${eventId}\n` +
        `event: ${event}\n` +
        `data: ${JSON.stringify(payload)}\n\n`,
    );
    eventId += 1;
  };
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
      bar.timestamp instanceof Date ? bar.timestamp.toISOString() : String(bar.timestamp);
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
    writeEvent("bar", {
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
    unsubscribe();
  };

  req.on("close", cleanup);
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

    const nextUnsubscribe = await ibkrBridgeService.subscribeHistoricalBarStream(
      input,
      (bar) => {
        writeBarEvent(bar);
      },
    );

    if (cleanedUp) {
      nextUnsubscribe();
      return;
    }

    unsubscribe = nextUnsubscribe;
    writeEvent("ready", {
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
  if (typeof req.query.underlying !== "string" || !req.query.underlying.trim()) {
    res.status(400).json({
      error: "underlying query parameter is required",
    });
    return;
  }

  const abortController = new AbortController();
  const abort = () => abortController.abort();
  req.on("aborted", abort);
  req.on("close", abort);

  try {
    const underlying = req.query.underlying.trim().toUpperCase();
    const contracts = await ibkrBridgeService.getOptionChain({
      underlying: req.query.underlying.trim().toUpperCase(),
      expirationDate:
        typeof req.query.expirationDate === "string" && req.query.expirationDate.trim()
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
      signal: abortController.signal,
    });

    if (abortController.signal.aborted) {
      return;
    }

    res.json({
      underlying,
      contracts,
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    throw error;
  } finally {
    req.off("aborted", abort);
    req.off("close", abort);
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
  res.write("retry: 5000\n\n");

  let cleanedUp = false;
  let unsubscribe: () => void = () => {};
  let eventId = 1;

  const writeEvent = (event: string, payload: unknown) => {
    if (cleanedUp || res.destroyed) {
      return;
    }

    res.write(
      `id: ${eventId}\n` +
        `event: ${event}\n` +
        `data: ${JSON.stringify(payload)}\n\n`,
    );
    eventId += 1;
  };

  const heartbeat = setInterval(() => {
    if (!cleanedUp && !res.destroyed) {
      res.write(`: ping ${new Date().toISOString()}\n\n`);
    }
  }, 15_000);
  heartbeat.unref?.();

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };

  req.on("close", cleanup);
  req.on("aborted", cleanup);

  try {
    writeEvent("quotes", {
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
        writeEvent("quotes", { quotes: [quote] });
      },
    );
    if (cleanedUp) {
      nextUnsubscribe();
      return;
    }

    unsubscribe = nextUnsubscribe;
    writeEvent("ready", {
      underlying,
      providerContractIds,
      source: "ibkr-bridge",
    });
  } catch (error) {
    cleanup();
    next(error);
  }
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
    res.status(201).json(await ibkrBridgeService.submitRawOrders({
      accountId: typeof req.body.accountId === "string" ? req.body.accountId : null,
      mode:
        req.body.mode === "live" || req.body.mode === "paper"
          ? req.body.mode
          : null,
      confirm: req.body.confirm === true,
      orders: req.body.ibkrOrders,
    }));
    return;
  }

  res.status(201).json(await ibkrBridgeService.placeOrder(req.body));
});

app.post("/orders", async (req, res) => {
  if (Array.isArray(req.body?.ibkrOrders)) {
    res.status(201).json(await ibkrBridgeService.submitRawOrders({
      accountId: typeof req.body.accountId === "string" ? req.body.accountId : null,
      mode:
        req.body.mode === "live" || req.body.mode === "paper"
          ? req.body.mode
          : null,
      confirm: req.body.confirm === true,
      orders: req.body.ibkrOrders,
    }));
    return;
  }

  res.status(201).json(await ibkrBridgeService.placeOrder(req.body));
});

app.post("/orders/:orderId/replace", async (req, res) => {
  res.json(await ibkrBridgeService.replaceOrder({
    accountId: req.body.accountId,
    orderId: req.params.orderId,
    order: req.body.order,
    mode: req.body.mode === "live" ? "live" : "paper",
  }));
});

app.post("/orders/:orderId/cancel", async (req, res) => {
  res.json(await ibkrBridgeService.cancelOrder({
    accountId: req.body.accountId,
    orderId: req.params.orderId,
    manualIndicator:
      typeof req.body.manualIndicator === "boolean"
        ? req.body.manualIndicator
        : null,
    extOperator:
      typeof req.body.extOperator === "string"
        ? req.body.extOperator
        : null,
  }));
});

app.get("/news", async (req, res) => {
  const ticker = typeof req.query.ticker === "string" ? req.query.ticker : undefined;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  res.json(
    await ibkrBridgeService.getNews({
      ticker,
      limit: Number.isFinite(limit) ? limit : undefined,
    }),
  );
});

app.get("/universe/search", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const market = typeof req.query.market === "string" ? req.query.market : undefined;
  const marketsRaw = req.query.markets;
  const markets =
    typeof marketsRaw === "string"
      ? marketsRaw.split(",").map((value) => value.trim()).filter(Boolean)
      : Array.isArray(marketsRaw)
        ? marketsRaw.flatMap((value) =>
            typeof value === "string"
              ? value.split(",").map((part) => part.trim()).filter(Boolean)
              : [],
          )
        : undefined;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  res.json(
    await ibkrBridgeService.searchTickers({
      search,
      market: market as Parameters<typeof ibkrBridgeService.searchTickers>[0]["market"],
      markets: markets as Parameters<typeof ibkrBridgeService.searchTickers>[0]["markets"],
      limit: Number.isFinite(limit) ? limit : undefined,
      signal: createRequestAbortSignal(req, res),
    }),
  );
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) {
    return;
  }

  if (isZodError(error)) {
    const issues = (error.issues as unknown[]).map((issue) => issue as ZodIssueLike);

    res.status(400).json({
      title: "Invalid request",
      status: 400,
      detail: issues
        .map((issue) => (typeof issue.message === "string" ? issue.message : "Invalid input"))
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
});

export default app;
