import { Router, type IRouter, type Request, type Response } from "express";
import { once } from "node:events";
import {
  GetBarsQueryParams,
  GetBarsResponse,
  GetNewsQueryParams,
  GetNewsResponse,
  GetOptionChainQueryParams,
  GetOptionChainResponse,
  GetQuoteSnapshotsQueryParams,
  GetQuoteSnapshotsResponse,
  SearchUniverseTickersQueryParams,
  SearchUniverseTickersResponse,
  GetSessionResponse,
  ListAccountsQueryParams,
  ListAccountsResponse,
  ListBrokerConnectionsResponse,
  ListFlowEventsQueryParams,
  ListFlowEventsResponse,
  ListOrdersQueryParams,
  ListOrdersResponse,
  ListPositionsQueryParams,
  ListPositionsResponse,
  PlaceOrderBody,
  ReplaceOrderBody,
  CancelOrderBody,
} from "@workspace/api-zod";
import {
  cancelOrder,
  createWatchlist,
  deleteWatchlist,
  getBars,
  getMarketDepth,
  getNews,
  getOptionChain,
  getQuoteSnapshots,
  getSession,
  listAccounts,
  listBrokerConnections,
  listExecutions,
  listFlowEvents,
  listOrders,
  listPositions,
  listWatchlists,
  addWatchlistSymbol,
  placeOrder,
  previewOrder,
  removeWatchlistSymbol,
  reorderWatchlistSymbols,
  replaceOrder,
  searchUniverseTickers,
  submitRawOrders,
  updateWatchlist,
} from "../services/platform";
import {
  fetchAccountSnapshotPayload,
  fetchExecutionSnapshotPayload,
  fetchMarketDepthSnapshotPayload,
  fetchOptionChainSnapshotPayload,
  fetchOrderSnapshotPayload,
  fetchQuoteSnapshotPayload,
  subscribeAccountSnapshots,
  subscribeExecutionSnapshots,
  subscribeMarketDepthSnapshots,
  subscribeOptionChains,
  subscribeOrderSnapshots,
  subscribeQuoteSnapshots,
} from "../services/bridge-streams";
import {
  getCurrentStockMinuteAggregates,
  isStockAggregateStreamingAvailable,
  subscribeStockMinuteAggregates,
} from "../services/stock-aggregate-stream";

const router: IRouter = Router();

function readOptionalString(value: unknown, maxLength = 160): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, maxLength);
}

function parseWatchlistSymbolBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid watchlist symbol payload.");
  }

  const symbol = readOptionalString((body as Record<string, unknown>).symbol, 64);
  if (!symbol) {
    throw new Error("Symbol is required.");
  }

  return {
    symbol,
    name: readOptionalString((body as Record<string, unknown>).name, 160),
  };
}

function parseCreateWatchlistBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid watchlist payload.");
  }

  const payload = body as Record<string, unknown>;
  const name = readOptionalString(payload.name, 80);
  if (!name) {
    throw new Error("Watchlist name is required.");
  }

  return {
    name,
    isDefault: payload.isDefault === true,
    symbols: Array.isArray(payload.symbols)
      ? payload.symbols.map(parseWatchlistSymbolBody)
      : undefined,
  };
}

function parseUpdateWatchlistBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid watchlist payload.");
  }

  const payload = body as Record<string, unknown>;
  const name = readOptionalString(payload.name, 80);
  return {
    name,
    isDefault:
      typeof payload.isDefault === "boolean" ? payload.isDefault : undefined,
  };
}

function parseReorderWatchlistSymbolsBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid reorder payload.");
  }

  const payload = body as Record<string, unknown>;
  const rawItemIds = payload.itemIds;
  const itemIds = Array.isArray(rawItemIds)
    ? rawItemIds
        .map((itemId: unknown) => readOptionalString(itemId, 128))
        .filter((itemId): itemId is string => Boolean(itemId))
    : [];

  if (!itemIds.length) {
    throw new Error("itemIds are required.");
  }

  return { itemIds };
}

function coerceDateQueryFields<T extends Record<string, unknown>>(
  input: T,
  keys: string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input };

  keys.forEach((key) => {
    const value = output[key];

    if (typeof value === "string" && value.trim()) {
      output[key] = new Date(value);
    }
  });

  return output;
}

async function startSse(
  req: Request,
  res: Response,
  setup: (controls: {
    writeEvent: (event: string, payload: unknown) => Promise<void>;
    writeComment: (comment: string) => Promise<void>;
    lastEventId: string | null;
  }) => Promise<() => void> | (() => void),
) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let cleanedUp = false;
  let nextEventId = 1;
  let writeQueue = Promise.resolve();
  let unsubscribe: () => void = () => {};
  const lastEventId =
    typeof req.headers["last-event-id"] === "string" &&
    req.headers["last-event-id"].trim()
      ? req.headers["last-event-id"].trim()
      : null;

  const enqueueChunk = (chunk: string): Promise<void> => {
    writeQueue = writeQueue
      .then(async () => {
        if (cleanedUp) {
          return;
        }

        if (res.write(chunk)) {
          return;
        }

        await once(res, "drain");
      })
      .catch(() => {});

    return writeQueue;
  };

  const writeComment = (comment: string): Promise<void> =>
    enqueueChunk(`: ${comment.replace(/\r?\n/g, " ")}\n\n`);

  const writeEvent = (event: string, payload: unknown): Promise<void> => {
    const eventId = String(nextEventId);
    nextEventId += 1;

    return enqueueChunk(
      `id: ${eventId}\n` +
        `event: ${event}\n` +
        `data: ${JSON.stringify(payload)}\n\n`,
    );
  };

  await enqueueChunk("retry: 5000\n\n");

  const heartbeat = setInterval(() => {
    void writeComment(`ping ${new Date().toISOString()}`);
  }, 15_000);

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
    unsubscribe =
      (await setup({
        writeEvent,
        writeComment,
        lastEventId,
      })) ?? (() => {});
  } catch (error) {
    if (!res.headersSent) {
      res.status(500);
    }

    await writeEvent("error", {
      title: "Stream setup failed",
      status: 500,
      detail: error instanceof Error ? error.message : "Unknown stream error.",
    }).catch(() => {});
    cleanup();
  }
}

router.get("/session", async (_req, res) => {
  const data = GetSessionResponse.parse(await getSession());

  res.json(data);
});

router.get("/broker-connections", async (_req, res) => {
  const data = ListBrokerConnectionsResponse.parse(await listBrokerConnections());

  res.json(data);
});

router.get("/accounts", async (req, res) => {
  const query = ListAccountsQueryParams.parse(req.query);
  const data = ListAccountsResponse.parse(await listAccounts(query));

  res.json(data);
});

router.get("/watchlists", async (_req, res) => {
  res.json(await listWatchlists());
});

router.post("/watchlists", async (req, res) => {
  const body = parseCreateWatchlistBody(req.body);
  res.status(201).json(await createWatchlist(body));
});

router.patch("/watchlists/:watchlistId", async (req, res) => {
  const body = parseUpdateWatchlistBody(req.body);
  res.json(await updateWatchlist(req.params.watchlistId, body));
});

router.delete("/watchlists/:watchlistId", async (req, res) => {
  res.json(await deleteWatchlist(req.params.watchlistId));
});

router.post("/watchlists/:watchlistId/items", async (req, res) => {
  const body = parseWatchlistSymbolBody(req.body);
  res.status(201).json(await addWatchlistSymbol(req.params.watchlistId, body));
});

router.delete("/watchlists/:watchlistId/items/:itemId", async (req, res) => {
  res.json(
    await removeWatchlistSymbol(req.params.watchlistId, req.params.itemId),
  );
});

router.put("/watchlists/:watchlistId/items/reorder", async (req, res) => {
  const body = parseReorderWatchlistSymbolsBody(req.body);
  res.json(await reorderWatchlistSymbols(req.params.watchlistId, body.itemIds));
});

router.get("/positions", async (req, res) => {
  const query = ListPositionsQueryParams.parse(req.query);
  const data = ListPositionsResponse.parse(await listPositions(query));

  res.json(data);
});

router.get("/orders", async (req, res) => {
  const query = ListOrdersQueryParams.parse(req.query);
  const data = ListOrdersResponse.parse(await listOrders(query));

  res.json(data);
});

router.post("/orders", async (req, res) => {
  const body = PlaceOrderBody.parse(req.body);
  res.status(201).json(await placeOrder(body));
});

router.post("/orders/preview", async (req, res) => {
  const body = PlaceOrderBody.parse(req.body);

  res.json(await previewOrder(body));
});

router.post("/orders/submit", async (req, res) => {
  if (Array.isArray(req.body?.ibkrOrders)) {
    res.status(201).json(await submitRawOrders({
      accountId:
        typeof req.body.accountId === "string"
          ? req.body.accountId
          : null,
      mode:
        req.body.mode === "live" || req.body.mode === "paper"
          ? req.body.mode
          : null,
      confirm: req.body.confirm === true,
      ibkrOrders: req.body.ibkrOrders,
    }));
    return;
  }

  const body = PlaceOrderBody.parse(req.body);
  res.status(201).json(await placeOrder(body));
});

router.post("/orders/:orderId/replace", async (req, res) => {
  const body = ReplaceOrderBody.parse(req.body);
  res.json(await replaceOrder({
    accountId: body.accountId,
    orderId: req.params.orderId,
    order: body.order,
    mode: body.mode === "live" ? "live" : "paper",
    confirm: body.confirm ?? false,
  }));
});

router.post("/orders/:orderId/cancel", async (req, res) => {
  const body = CancelOrderBody.parse(req.body);
  res.json(await cancelOrder({
    accountId: body.accountId,
    orderId: req.params.orderId,
    confirm: body.confirm ?? false,
    manualIndicator:
      typeof body.manualIndicator === "boolean"
        ? body.manualIndicator
        : null,
    extOperator:
      typeof body.extOperator === "string"
        ? body.extOperator
        : null,
  }));
});

router.get("/executions", async (req, res) => {
  const query = req.query as Record<string, unknown>;

  res.json(await listExecutions({
    accountId:
      typeof query.accountId === "string" ? query.accountId : undefined,
    days:
      typeof query.days === "string" && query.days.trim()
        ? Number(query.days)
        : undefined,
    limit:
      typeof query.limit === "string" && query.limit.trim()
        ? Number(query.limit)
        : undefined,
    symbol: typeof query.symbol === "string" ? query.symbol : undefined,
    providerContractId:
      typeof query.providerContractId === "string" &&
      query.providerContractId.trim()
        ? query.providerContractId.trim()
        : null,
  }));
});

router.get("/quotes/snapshot", async (req, res) => {
  const query = GetQuoteSnapshotsQueryParams.parse(req.query);
  const data = GetQuoteSnapshotsResponse.parse(await getQuoteSnapshots(query));

  res.json(data);
});

router.get("/news", async (req, res) => {
  const query = GetNewsQueryParams.parse(req.query);
  const data = GetNewsResponse.parse(await getNews(query));

  res.json(data);
});

router.get("/universe/tickers", async (req, res) => {
  const query = SearchUniverseTickersQueryParams.parse(req.query);
  const data = SearchUniverseTickersResponse.parse(await searchUniverseTickers(query));

  res.json(data);
});

router.get("/bars", async (req, res) => {
  const query = GetBarsQueryParams.parse(
    coerceDateQueryFields(req.query as Record<string, unknown>, ["from", "to"]),
  );
  const data = GetBarsResponse.parse(await getBars(query));

  res.json(data);
});

router.get("/options/chains", async (req, res) => {
  const query = GetOptionChainQueryParams.parse(
    coerceDateQueryFields(req.query as Record<string, unknown>, ["expirationDate"]),
  );
  const data = GetOptionChainResponse.parse(await getOptionChain(query));

  res.json(data);
});

router.get("/market-depth", async (req, res) => {
  const query = req.query as Record<string, unknown>;

  if (typeof query.symbol !== "string" || !query.symbol.trim()) {
    res.status(400).json({
      title: "Invalid request",
      status: 400,
      detail: "symbol query parameter is required.",
    });
    return;
  }

  res.json(await getMarketDepth({
    accountId:
      typeof query.accountId === "string" ? query.accountId : undefined,
    symbol: query.symbol,
    assetClass:
      query.assetClass === "option"
        ? "option"
        : query.assetClass === "equity"
          ? "equity"
          : undefined,
    providerContractId:
      typeof query.providerContractId === "string" &&
      query.providerContractId.trim()
        ? query.providerContractId.trim()
        : null,
    exchange:
      typeof query.exchange === "string" && query.exchange.trim()
        ? query.exchange.trim()
        : null,
  }));
});

router.get("/flow/events", async (req, res) => {
  const query = ListFlowEventsQueryParams.parse(req.query);
  const data = ListFlowEventsResponse.parse(await listFlowEvents(query));

  res.json(data);
});

router.get("/streams/quotes", async (req, res) => {
  const rawSymbols = Array.isArray(req.query.symbols)
    ? req.query.symbols.join(",")
    : typeof req.query.symbols === "string"
      ? req.query.symbols
      : "";
  const symbols = rawSymbols
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (!symbols.length) {
    res.status(400).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/invalid-request",
      title: "Missing symbols",
      status: 400,
      detail: "Provide one or more comma-separated stock symbols in the symbols query parameter.",
    });
    return;
  }

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent("quotes", await fetchQuoteSnapshotPayload(symbols));
    await writeEvent("ready", {
      symbols,
      source: "ibkr-bridge",
    });

    return subscribeQuoteSnapshots(symbols, (payload) => {
      writeEvent("quotes", payload);
    });
  });
});

router.get("/streams/options/chains", async (req, res) => {
  const rawUnderlyings = Array.isArray(req.query.underlyings)
    ? req.query.underlyings.join(",")
    : typeof req.query.underlyings === "string"
      ? req.query.underlyings
      : typeof req.query.underlying === "string"
        ? req.query.underlying
        : "";
  const underlyings = rawUnderlyings
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (!underlyings.length) {
    res.status(400).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/invalid-request",
      title: "Missing underlyings",
      status: 400,
      detail: "Provide one or more comma-separated underlying symbols in the underlyings query parameter.",
    });
    return;
  }

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent(
      "chains",
      await fetchOptionChainSnapshotPayload(underlyings),
    );
    await writeEvent("ready", {
      underlyings,
      source: "ibkr-bridge",
    });

    return subscribeOptionChains(underlyings, (payload) => {
      writeEvent("chains", payload);
    });
  });
});

router.get("/streams/orders", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const status = typeof req.query.status === "string" ? req.query.status as Parameters<typeof subscribeOrderSnapshots>[0]["status"] : undefined;

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent(
      "orders",
      await fetchOrderSnapshotPayload({ accountId, mode, status }),
    );
    await writeEvent("ready", {
      accountId: accountId ?? null,
      mode,
      source: "ibkr-bridge",
    });

    return subscribeOrderSnapshots({ accountId, mode, status }, (payload) => {
      writeEvent("orders", payload);
    });
  });
});

router.get("/streams/executions", async (req, res) => {
  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const days =
    typeof req.query.days === "string" && req.query.days.trim()
      ? Number(req.query.days)
      : undefined;
  const limit =
    typeof req.query.limit === "string" && req.query.limit.trim()
      ? Number(req.query.limit)
      : undefined;
  const symbol = typeof req.query.symbol === "string" ? req.query.symbol : undefined;
  const providerContractId =
    typeof req.query.providerContractId === "string" &&
    req.query.providerContractId.trim()
      ? req.query.providerContractId.trim()
      : null;

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent(
      "executions",
      await fetchExecutionSnapshotPayload({
        accountId,
        days,
        limit,
        symbol,
        providerContractId,
      }),
    );
    await writeEvent("ready", {
      accountId: accountId ?? null,
      symbol: symbol ?? null,
      providerContractId,
      source: "ibkr-bridge",
    });

    return subscribeExecutionSnapshots(
      {
        accountId,
        days,
        limit,
        symbol,
        providerContractId,
      },
      (payload) => {
        writeEvent("executions", payload);
      },
    );
  });
});

router.get("/streams/market-depth", async (req, res) => {
  if (typeof req.query.symbol !== "string" || !req.query.symbol.trim()) {
    res.status(400).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/invalid-request",
      title: "Missing symbol",
      status: 400,
      detail: "Provide a symbol query parameter.",
    });
    return;
  }

  const accountId =
    typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  const assetClass =
    req.query.assetClass === "option"
      ? "option"
      : req.query.assetClass === "equity"
        ? "equity"
        : undefined;
  const providerContractId =
    typeof req.query.providerContractId === "string" &&
    req.query.providerContractId.trim()
      ? req.query.providerContractId.trim()
      : null;
  const exchange =
    typeof req.query.exchange === "string" && req.query.exchange.trim()
      ? req.query.exchange.trim()
      : null;
  const symbol = req.query.symbol.trim().toUpperCase();

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent(
      "depth",
      await fetchMarketDepthSnapshotPayload({
        accountId,
        symbol,
        assetClass,
        providerContractId,
        exchange,
      }),
    );
    await writeEvent("ready", {
      accountId: accountId ?? null,
      symbol,
      providerContractId,
      source: "ibkr-bridge",
    });

    return subscribeMarketDepthSnapshots(
      {
        accountId,
        symbol,
        assetClass,
        providerContractId,
        exchange,
      },
      (payload) => {
        writeEvent("depth", payload);
      },
    );
  });
});

router.get("/streams/accounts", async (req, res) => {
  const mode = req.query.mode === "live" ? "live" : "paper";
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  await startSse(req, res, async ({ writeEvent }) => {
    await writeEvent(
      "accounts",
      await fetchAccountSnapshotPayload({ accountId, mode }),
    );
    await writeEvent("ready", {
      accountId: accountId ?? null,
      mode,
      source: "ibkr-bridge",
    });

    return subscribeAccountSnapshots({ accountId, mode }, (payload) => {
      writeEvent("accounts", payload);
    });
  });
});

router.get("/streams/stocks/aggregates", async (req, res) => {
  const rawSymbols = Array.isArray(req.query.symbols)
    ? req.query.symbols.join(",")
    : typeof req.query.symbols === "string"
      ? req.query.symbols
      : "";
  const symbols = rawSymbols
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (!symbols.length) {
    res.status(400).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/invalid-request",
      title: "Missing symbols",
      status: 400,
      detail: "Provide one or more comma-separated stock symbols in the symbols query parameter.",
    });
    return;
  }

  if (!isStockAggregateStreamingAvailable()) {
    res.status(503).type("application/problem+json").json({
      type: "https://rayalgo.local/problems/upstream",
      title: "IBKR stock streaming is not configured.",
      status: 503,
      detail: "Set the IBKR gateway or bridge configuration before using stock aggregate streams.",
      code: "ibkr_stock_stream_unavailable",
    });
    return;
  }

  await startSse(req, res, async ({ writeEvent }) => {
    const snapshotAggregates = getCurrentStockMinuteAggregates(symbols);
    for (const aggregate of snapshotAggregates) {
      await writeEvent("aggregate", aggregate);
    }

    await writeEvent("ready", {
      symbols,
      delayed: false,
      source: "ibkr-websocket-derived",
    });

    return subscribeStockMinuteAggregates(symbols, (message) => {
      writeEvent("aggregate", message);
    });
  });
});

export default router;
