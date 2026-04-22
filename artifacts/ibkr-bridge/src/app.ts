import express, { type Express } from "express";
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

app.use(
  pinoHttp({
    logger,
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

app.get("/options/chains", async (req, res) => {
  if (typeof req.query.underlying !== "string" || !req.query.underlying.trim()) {
    res.status(400).json({
      error: "underlying query parameter is required",
    });
    return;
  }

  res.json({
    underlying: req.query.underlying.trim().toUpperCase(),
    contracts: await ibkrBridgeService.getOptionChain({
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
    }),
  });
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
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  res.json(
    await ibkrBridgeService.searchTickers({
      search,
      limit: Number.isFinite(limit) ? limit : undefined,
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
