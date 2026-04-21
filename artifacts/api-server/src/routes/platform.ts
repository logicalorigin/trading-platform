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

export default router;
