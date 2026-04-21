import { Router, type IRouter } from "express";
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
  ListWatchlistsResponse,
  PlaceOrderBody,
  PlaceOrderResponse,
} from "@workspace/api-zod";
import {
  getBars,
  getNews,
  getOptionChain,
  getQuoteSnapshots,
  getSession,
  listAccounts,
  listBrokerConnections,
  listFlowEvents,
  listOrders,
  listPositions,
  listWatchlists,
  placeOrder,
  searchUniverseTickers,
} from "../services/platform";
import {
  isStockAggregateStreamingAvailable,
  subscribeStockMinuteAggregates,
} from "../services/stock-aggregate-stream";

const router: IRouter = Router();

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
  const data = ListWatchlistsResponse.parse(await listWatchlists());

  res.json(data);
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

  const data = PlaceOrderResponse.parse(await placeOrder(body));

  res.status(201).json(data);
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

router.get("/flow/events", async (req, res) => {
  const query = ListFlowEventsQueryParams.parse(req.query);
  const data = ListFlowEventsResponse.parse(await listFlowEvents(query));

  res.json(data);
});

router.get("/streams/stocks/aggregates", (req, res) => {
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
      title: "Massive delayed stock streaming is not configured.",
      status: 503,
      detail: "Set the Massive market data API credentials and base URL before using stock aggregate streams.",
      code: "massive_stock_stream_unavailable",
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write("retry: 5000\n\n");

  const writeEvent = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  writeEvent("ready", {
    symbols,
    delayed: true,
    source: "massive-delayed-websocket",
  });

  const unsubscribe = subscribeStockMinuteAggregates(symbols, (message) => {
    writeEvent("aggregate", message);
  });

  const heartbeat = setInterval(() => {
    writeEvent("ping", { ts: new Date().toISOString() });
  }, 25_000);

  let cleanedUp = false;
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
});

export default router;
