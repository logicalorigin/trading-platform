import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  instrumentsTable,
  watchlistItemsTable,
  watchlistsTable,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import {
  getIbkrRuntimeConfig,
  getPolygonRuntimeConfig,
  getProviderConfiguration,
  getRuntimeMode,
} from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import {
  IbkrClient,
  type PlaceOrderInput,
} from "../providers/ibkr/client";
import { PolygonMarketDataClient } from "../providers/polygon/market-data";

const DEFAULT_WATCHLIST = [
  { symbol: "SPY", name: "SPDR S&P 500" },
  { symbol: "QQQ", name: "Invesco QQQ" },
  { symbol: "IWM", name: "iShares Russell 2000" },
  { symbol: "AAPL", name: "Apple Inc" },
  { symbol: "NVDA", name: "NVIDIA Corp" },
  { symbol: "AMD", name: "Advanced Micro Devices" },
  { symbol: "TSLA", name: "Tesla Inc" },
  { symbol: "META", name: "Meta Platforms" },
] as const;

async function ensureDefaultWatchlistSeeded(): Promise<void> {
  const existing = await db
    .select({ id: watchlistsTable.id })
    .from(watchlistsTable)
    .limit(1);

  if (existing.length > 0) {
    return;
  }

  await db
    .insert(instrumentsTable)
    .values(
      DEFAULT_WATCHLIST.map((item) => ({
        symbol: item.symbol,
        assetClass: "equity" as const,
        name: item.name,
      })),
    )
    .onConflictDoNothing();

  const instruments = await db
    .select({
      id: instrumentsTable.id,
      symbol: instrumentsTable.symbol,
    })
    .from(instrumentsTable)
    .where(
      inArray(
        instrumentsTable.symbol,
        DEFAULT_WATCHLIST.map((item) => item.symbol),
      ),
    );

  const instrumentBySymbol = new Map(
    instruments.map((instrument) => [instrument.symbol, instrument]),
  );
  const [watchlist] = await db
    .insert(watchlistsTable)
    .values({
      name: "Core",
      isDefault: true,
    })
    .returning({ id: watchlistsTable.id });

  await db
    .insert(watchlistItemsTable)
    .values(
      DEFAULT_WATCHLIST.flatMap((item, index) => {
        const instrument = instrumentBySymbol.get(item.symbol);
        return instrument
          ? [
              {
                watchlistId: watchlist.id,
                instrumentId: instrument.id,
                sortOrder: index,
              },
            ]
          : [];
      }),
    )
    .onConflictDoNothing();
}

async function listWatchlistsFromDb() {
  await ensureDefaultWatchlistSeeded();

  const rows = await db
    .select({
      watchlistId: watchlistsTable.id,
      watchlistName: watchlistsTable.name,
      isDefault: watchlistsTable.isDefault,
      watchlistUpdatedAt: watchlistsTable.updatedAt,
      itemId: watchlistItemsTable.id,
      symbol: instrumentsTable.symbol,
      sortOrder: watchlistItemsTable.sortOrder,
      addedAt: watchlistItemsTable.createdAt,
    })
    .from(watchlistsTable)
    .leftJoin(watchlistItemsTable, eq(watchlistsTable.id, watchlistItemsTable.watchlistId))
    .leftJoin(instrumentsTable, eq(watchlistItemsTable.instrumentId, instrumentsTable.id))
    .orderBy(asc(watchlistsTable.name), asc(watchlistItemsTable.sortOrder));

  const grouped = new Map();

  rows.forEach((row) => {
    const existing = grouped.get(row.watchlistId) ?? {
      id: row.watchlistId,
      name: row.watchlistName,
      isDefault: row.isDefault,
      items: [],
      updatedAt: row.watchlistUpdatedAt,
    };

    if (row.itemId && row.symbol) {
      existing.items.push({
        id: row.itemId,
        symbol: row.symbol,
        sortOrder: row.sortOrder ?? 0,
        addedAt: row.addedAt ?? row.watchlistUpdatedAt,
      });
    }

    grouped.set(row.watchlistId, existing);
  });

  return {
    watchlists: Array.from(grouped.values()),
  };
}

function getPolygonClient(): PolygonMarketDataClient {
  const config = getPolygonRuntimeConfig();

  if (!config) {
    throw new HttpError(503, "Polygon/Massive market data is not configured.", {
      code: "polygon_not_configured",
      detail:
        "Set one of POLYGON_API_KEY, POLYGON_KEY, MASSIVE_API_KEY, or MASSIVE_MARKET_DATA_API_KEY.",
    });
  }

  return new PolygonMarketDataClient(config);
}

function getMarketDataConnectionName() {
  const config = getPolygonRuntimeConfig();
  return config?.baseUrl.includes("massive.com") ? "Massive Market Data" : "Polygon Market Data";
}

function getIbkrClient(): IbkrClient {
  const config = getIbkrRuntimeConfig();

  if (!config) {
    throw new HttpError(503, "Interactive Brokers is not configured.", {
      code: "ibkr_not_configured",
      detail:
        "Set IBKR_API_BASE_URL or IB_GATEWAY_URL and provide any required auth secrets for the reachable IBKR Web API session.",
    });
  }

  return new IbkrClient(config);
}

export async function getSession() {
  return {
    environment: getRuntimeMode(),
    brokerProvider: "ibkr" as const,
    marketDataProvider: "polygon" as const,
    configured: getProviderConfiguration(),
    timestamp: new Date(),
  };
}

export async function listBrokerConnections() {
  const configured = getProviderConfiguration();
  const timestamp = new Date();
  const marketDataName = getMarketDataConnectionName();

  return {
    connections: [
      {
        id: "polygon-paper",
        provider: "polygon" as const,
        name: marketDataName,
        mode: "paper" as const,
        status: configured.polygon ? ("configured" as const) : ("disconnected" as const),
        capabilities: [
          "quotes",
          "bars",
          "options-chain",
          "stock-stream",
          "options-flow",
        ],
        updatedAt: timestamp,
      },
      {
        id: "polygon-live",
        provider: "polygon" as const,
        name: marketDataName,
        mode: "live" as const,
        status: configured.polygon ? ("configured" as const) : ("disconnected" as const),
        capabilities: [
          "quotes",
          "bars",
          "options-chain",
          "stock-stream",
          "options-flow",
        ],
        updatedAt: timestamp,
      },
      {
        id: "ibkr-paper",
        provider: "ibkr" as const,
        name: "Interactive Brokers",
        mode: "paper" as const,
        status: configured.ibkr ? ("configured" as const) : ("disconnected" as const),
        capabilities: [
          "accounts",
          "positions",
          "orders",
          "executions",
          "paper-trading",
        ],
        updatedAt: timestamp,
      },
      {
        id: "ibkr-live",
        provider: "ibkr" as const,
        name: "Interactive Brokers",
        mode: "live" as const,
        status: configured.ibkr ? ("configured" as const) : ("disconnected" as const),
        capabilities: [
          "accounts",
          "positions",
          "orders",
          "executions",
          "live-trading",
        ],
        updatedAt: timestamp,
      },
    ],
  };
}

export async function listAccounts(input: { mode?: "paper" | "live" }) {
  const client = getIbkrClient();
  return {
    accounts: await client.listAccounts(input.mode ?? getRuntimeMode()),
  };
}

export async function listWatchlists() {
  return listWatchlistsFromDb();
}

export async function listPositions(input: {
  accountId?: string;
  mode?: "paper" | "live";
}) {
  const client = getIbkrClient();
  return {
    positions: await client.listPositions({
      accountId: input.accountId,
      mode: input.mode ?? getRuntimeMode(),
    }),
  };
}

export async function listOrders(input: {
  accountId?: string;
  mode?: "paper" | "live";
  status?:
    | "pending_submit"
    | "submitted"
    | "accepted"
    | "partially_filled"
    | "filled"
    | "canceled"
    | "rejected"
    | "expired";
}) {
  const client = getIbkrClient();
  return {
    orders: await client.listOrders({
      accountId: input.accountId,
      mode: input.mode ?? getRuntimeMode(),
      status: input.status,
    }),
  };
}

export async function placeOrder(input: PlaceOrderInput) {
  const client = getIbkrClient();
  return client.placeOrder(input);
}

export async function getQuoteSnapshots(input: { symbols: string }) {
  const client = getPolygonClient();
  const symbols = input.symbols
    .split(",")
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean);

  return {
    quotes: await client.getQuoteSnapshots(symbols),
  };
}

export async function getNews(input: {
  ticker?: string;
  limit?: number;
}) {
  const client = getPolygonClient();

  return {
    articles: await client.getNews(input),
  };
}

export async function searchUniverseTickers(input: {
  search?: string;
  market?: "stocks" | "indices" | "fx" | "crypto" | "otc";
  type?: string;
  active?: boolean;
  limit?: number;
}) {
  const client = getPolygonClient();

  return client.searchUniverseTickers(input);
}

export async function getBars(input: {
  symbol: string;
  timeframe: Parameters<PolygonMarketDataClient["getBars"]>[0]["timeframe"];
  limit?: number;
  from?: Date;
  to?: Date;
}) {
  const client = getPolygonClient();

  return {
    symbol: normalizeSymbol(input.symbol),
    timeframe: input.timeframe,
    bars: await client.getBars(input),
  };
}

export async function getOptionChain(input: {
  underlying: string;
  expirationDate?: Date;
  contractType?: "call" | "put";
}) {
  const client = getPolygonClient();

  return {
    underlying: normalizeSymbol(input.underlying),
    expirationDate: input.expirationDate ?? null,
    contracts: await client.getOptionChain(input),
  };
}

export async function listFlowEvents(input: {
  underlying?: string;
  limit?: number;
}) {
  if (!input.underlying) {
    return { events: [] };
  }

  const client = getPolygonClient();

  return {
    events: await client.getDerivedFlowEvents({
      underlying: input.underlying,
      limit: input.limit,
    }),
  };
}
