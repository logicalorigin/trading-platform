import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  instrumentsTable,
  watchlistItemsTable,
  watchlistsTable,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import {
  getPolygonRuntimeConfig,
  getProviderConfiguration,
  getRuntimeMode,
} from "../lib/runtime";
import { normalizeSymbol } from "../lib/values";
import { type PlaceOrderInput } from "../providers/ibkr/client";
import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import { PolygonMarketDataClient } from "../providers/polygon/market-data";

const BUILT_IN_WATCHLISTS = [
  {
    name: "Core",
    isDefault: true,
    items: [
      { symbol: "SPY", name: "SPDR S&P 500" },
      { symbol: "QQQ", name: "Invesco QQQ" },
      { symbol: "IWM", name: "iShares Russell 2000" },
      { symbol: "DIA", name: "SPDR Dow Jones Industrial Average ETF" },
      { symbol: "AAPL", name: "Apple Inc" },
      { symbol: "MSFT", name: "Microsoft Corp" },
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "TSLA", name: "Tesla Inc" },
    ],
  },
  {
    name: "Mag 7",
    isDefault: false,
    items: [
      { symbol: "AAPL", name: "Apple Inc" },
      { symbol: "MSFT", name: "Microsoft Corp" },
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "AMZN", name: "Amazon.com Inc" },
      { symbol: "META", name: "Meta Platforms Inc" },
      { symbol: "GOOGL", name: "Alphabet Inc" },
      { symbol: "TSLA", name: "Tesla Inc" },
    ],
  },
  {
    name: "Semis + AI",
    isDefault: false,
    items: [
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "AMD", name: "Advanced Micro Devices" },
      { symbol: "AVGO", name: "Broadcom Inc" },
      { symbol: "TSM", name: "Taiwan Semiconductor" },
      { symbol: "MU", name: "Micron Technology" },
      { symbol: "QCOM", name: "Qualcomm Inc" },
      { symbol: "ARM", name: "Arm Holdings" },
      { symbol: "SOXX", name: "iShares Semiconductor ETF" },
    ],
  },
  {
    name: "Macro",
    isDefault: false,
    items: [
      {
        symbol: "VXX",
        name: "iPath Series B S&P 500 VIX Short-Term Futures ETN",
      },
      { symbol: "VIXY", name: "ProShares VIX Short-Term Futures ETF" },
      { symbol: "TLT", name: "iShares 20+ Year Treasury Bond ETF" },
      { symbol: "IEF", name: "iShares 7-10 Year Treasury Bond ETF" },
      { symbol: "UUP", name: "Invesco DB US Dollar Index Bullish Fund" },
      { symbol: "GLD", name: "SPDR Gold Shares" },
      { symbol: "USO", name: "United States Oil Fund" },
    ],
  },
  {
    name: "High Beta",
    isDefault: false,
    items: [
      { symbol: "TSLA", name: "Tesla Inc" },
      { symbol: "PLTR", name: "Palantir Technologies" },
      { symbol: "COIN", name: "Coinbase Global" },
      { symbol: "HOOD", name: "Robinhood Markets" },
      { symbol: "RBLX", name: "Roblox Corp" },
      { symbol: "RKLB", name: "Rocket Lab USA" },
      { symbol: "SMCI", name: "Super Micro Computer" },
    ],
  },
] as const;

const BUILT_IN_SYMBOLS = [
  ...new Set(
    BUILT_IN_WATCHLISTS.flatMap((watchlist) =>
      watchlist.items.map((item) => item.symbol),
    ),
  ),
];

const BUILT_IN_INSTRUMENT_NAMES = Object.fromEntries(
  BUILT_IN_WATCHLISTS.flatMap((watchlist) =>
    watchlist.items.map((item) => [item.symbol, item.name]),
  ),
);

type WatchlistMutationSymbol = {
  symbol: string;
  name?: string | null;
};

type WatchlistItemRecord = {
  id: string;
  symbol: string;
  name?: string | null;
  sortOrder: number;
  addedAt: Date;
};

type WatchlistRecord = {
  id: string;
  name: string;
  isDefault: boolean;
  items: WatchlistItemRecord[];
  updatedAt: Date;
};

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
      BUILT_IN_SYMBOLS.map((symbol) => ({
        symbol,
        assetClass: "equity" as const,
        name: BUILT_IN_INSTRUMENT_NAMES[symbol] || symbol,
      })),
    )
    .onConflictDoNothing();

  const instruments = await db
    .select({
      id: instrumentsTable.id,
      symbol: instrumentsTable.symbol,
    })
    .from(instrumentsTable)
    .where(inArray(instrumentsTable.symbol, BUILT_IN_SYMBOLS));

  const instrumentBySymbol = new Map(
    instruments.map((instrument) => [instrument.symbol, instrument]),
  );
  await db.transaction(async (tx) => {
    for (const watchlistSpec of BUILT_IN_WATCHLISTS) {
      const [watchlist] = await tx
        .insert(watchlistsTable)
        .values({
          name: watchlistSpec.name,
          isDefault: watchlistSpec.isDefault,
        })
        .returning({ id: watchlistsTable.id });

      const values = watchlistSpec.items.flatMap((item, index) => {
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
      });

      if (values.length) {
        await tx
          .insert(watchlistItemsTable)
          .values(values)
          .onConflictDoNothing();
      }
    }
  });
}

async function selectWatchlistRows(watchlistId?: string) {
  await ensureDefaultWatchlistSeeded();

  const query = db
    .select({
      watchlistId: watchlistsTable.id,
      watchlistName: watchlistsTable.name,
      isDefault: watchlistsTable.isDefault,
      watchlistUpdatedAt: watchlistsTable.updatedAt,
      itemId: watchlistItemsTable.id,
      symbol: instrumentsTable.symbol,
      instrumentName: instrumentsTable.name,
      sortOrder: watchlistItemsTable.sortOrder,
      addedAt: watchlistItemsTable.createdAt,
    })
    .from(watchlistsTable)
    .leftJoin(
      watchlistItemsTable,
      eq(watchlistsTable.id, watchlistItemsTable.watchlistId),
    )
    .leftJoin(
      instrumentsTable,
      eq(watchlistItemsTable.instrumentId, instrumentsTable.id),
    );

  const filteredQuery = watchlistId
    ? query.where(eq(watchlistsTable.id, watchlistId))
    : query;

  return filteredQuery.orderBy(
    desc(watchlistsTable.isDefault),
    asc(watchlistsTable.name),
    asc(watchlistItemsTable.sortOrder),
  );
}

function mapWatchlistRows(
  rows: Awaited<ReturnType<typeof selectWatchlistRows>>,
) {
  const grouped = new Map<string, WatchlistRecord>();

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
        name: row.instrumentName ?? row.symbol,
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

async function listWatchlistsFromDb() {
  return mapWatchlistRows(await selectWatchlistRows());
}

async function getWatchlistById(
  watchlistId: string,
): Promise<WatchlistRecord | null> {
  const rows = await selectWatchlistRows(watchlistId);
  const [watchlist] = mapWatchlistRows(rows).watchlists;
  return watchlist ?? null;
}

async function ensureInstrumentForSymbol({
  symbol,
  name,
}: WatchlistMutationSymbol) {
  const normalized = normalizeSymbol(symbol).toUpperCase();
  if (!normalized) {
    throw new HttpError(400, "Symbol is required.", {
      code: "watchlist_symbol_required",
    });
  }

  const existing = await db
    .select({
      id: instrumentsTable.id,
      symbol: instrumentsTable.symbol,
    })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, normalized))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const [created] = await db
    .insert(instrumentsTable)
    .values({
      symbol: normalized,
      assetClass: "equity",
      name: name?.trim() || BUILT_IN_INSTRUMENT_NAMES[normalized] || normalized,
    })
    .onConflictDoNothing()
    .returning({
      id: instrumentsTable.id,
      symbol: instrumentsTable.symbol,
    });

  if (created) {
    return created;
  }

  const fallback = await db
    .select({
      id: instrumentsTable.id,
      symbol: instrumentsTable.symbol,
    })
    .from(instrumentsTable)
    .where(eq(instrumentsTable.symbol, normalized))
    .limit(1);

  if (!fallback[0]) {
    throw new HttpError(500, "Unable to create instrument.", {
      code: "watchlist_instrument_unavailable",
    });
  }

  return fallback[0];
}

async function rebalanceWatchlistSortOrder(watchlistId: string) {
  const items = await db
    .select({
      id: watchlistItemsTable.id,
    })
    .from(watchlistItemsTable)
    .where(eq(watchlistItemsTable.watchlistId, watchlistId))
    .orderBy(
      asc(watchlistItemsTable.sortOrder),
      asc(watchlistItemsTable.createdAt),
    );

  await Promise.all(
    items.map((item, index) =>
      db
        .update(watchlistItemsTable)
        .set({ sortOrder: index })
        .where(eq(watchlistItemsTable.id, item.id)),
    ),
  );
}

async function setDefaultWatchlistIfNeeded(watchlistId: string) {
  await db.update(watchlistsTable).set({ isDefault: false });
  await db
    .update(watchlistsTable)
    .set({ isDefault: true })
    .where(eq(watchlistsTable.id, watchlistId));
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
  return config?.baseUrl.includes("massive.com")
    ? "Massive Market Data"
    : "Polygon Market Data";
}

function getIbkrClient(): IbkrBridgeClient {
  return new IbkrBridgeClient();
}

export async function getSession() {
  const bridgeHealth = await getIbkrClient()
    .getHealth()
    .catch(() => null);
  return {
    environment: getRuntimeMode(),
    brokerProvider: "ibkr" as const,
    marketDataProvider: "ibkr" as const,
    configured: getProviderConfiguration(),
    marketDataProviders: {
      live: "ibkr" as const,
      historical: "ibkr" as const,
      research: "fmp" as const,
    },
    ibkrBridge: bridgeHealth,
    timestamp: new Date(),
  };
}

export async function listBrokerConnections() {
  const configured = getProviderConfiguration();
  const timestamp = new Date();
  const marketDataName = getMarketDataConnectionName();
  const bridgeHealth = await getIbkrClient()
    .getHealth()
    .catch(() => null);
  const ibkrConnectionName =
    bridgeHealth?.transport === "tws"
      ? "Interactive Brokers Gateway"
      : "Interactive Brokers Client Portal";
  const ibkrStatus = !configured.ibkr
    ? ("disconnected" as const)
    : bridgeHealth?.connected
      ? ("connected" as const)
      : bridgeHealth?.lastError
        ? ("error" as const)
        : ("configured" as const);

  return {
    connections: [
      {
        id: "polygon-paper",
        provider: "polygon" as const,
        name: marketDataName,
        mode: "paper" as const,
        status: configured.polygon
          ? ("configured" as const)
          : ("disconnected" as const),
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
        status: configured.polygon
          ? ("configured" as const)
          : ("disconnected" as const),
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
        name: ibkrConnectionName,
        mode: "paper" as const,
        status: ibkrStatus,
        capabilities: [
          "accounts",
          "positions",
          "orders",
          "executions",
          "market-depth",
          "paper-trading",
          "quotes",
          "bars",
          "options-chain",
          "stock-stream",
        ],
        updatedAt: timestamp,
      },
      {
        id: "ibkr-live",
        provider: "ibkr" as const,
        name: ibkrConnectionName,
        mode: "live" as const,
        status: ibkrStatus,
        capabilities: [
          "accounts",
          "positions",
          "orders",
          "executions",
          "market-depth",
          "live-trading",
          "quotes",
          "bars",
          "options-chain",
          "stock-stream",
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

export async function createWatchlist(input: {
  name: string;
  isDefault?: boolean;
  symbols?: WatchlistMutationSymbol[];
}) {
  const name = input.name.trim();
  if (!name) {
    throw new HttpError(400, "Watchlist name is required.", {
      code: "watchlist_name_required",
    });
  }

  const symbols = Array.from(
    new Map(
      (input.symbols || [])
        .map((item) => ({
          symbol: normalizeSymbol(item.symbol).toUpperCase(),
          name: item.name?.trim() || null,
        }))
        .filter((item) => item.symbol)
        .map((item) => [item.symbol, item]),
    ).values(),
  );

  const [watchlist] = await db
    .insert(watchlistsTable)
    .values({
      name,
      isDefault: Boolean(input.isDefault),
    })
    .returning({ id: watchlistsTable.id });

  if (input.isDefault) {
    await setDefaultWatchlistIfNeeded(watchlist.id);
  }

  for (const [index, symbolInput] of symbols.entries()) {
    const instrument = await ensureInstrumentForSymbol(symbolInput);
    await db.insert(watchlistItemsTable).values({
      watchlistId: watchlist.id,
      instrumentId: instrument.id,
      sortOrder: index,
    });
  }

  return getWatchlistById(watchlist.id);
}

export async function updateWatchlist(
  watchlistId: string,
  input: {
    name?: string;
    isDefault?: boolean;
  },
) {
  const current = await getWatchlistById(watchlistId);
  if (!current) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const patch: { name?: string; isDefault?: boolean } = {};
  if (typeof input.name === "string") {
    const nextName = input.name.trim();
    if (!nextName) {
      throw new HttpError(400, "Watchlist name is required.", {
        code: "watchlist_name_required",
      });
    }
    patch.name = nextName;
  }
  if (typeof input.isDefault === "boolean") {
    patch.isDefault = input.isDefault;
  }

  if (Object.keys(patch).length) {
    await db
      .update(watchlistsTable)
      .set(patch)
      .where(eq(watchlistsTable.id, watchlistId));
  }

  if (input.isDefault) {
    await setDefaultWatchlistIfNeeded(watchlistId);
  }

  return getWatchlistById(watchlistId);
}

export async function deleteWatchlist(watchlistId: string) {
  const current = await getWatchlistById(watchlistId);
  if (!current) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const all = await listWatchlistsFromDb();
  if (all.watchlists.length <= 1) {
    throw new HttpError(400, "At least one watchlist must remain.", {
      code: "watchlist_last_delete_blocked",
    });
  }

  await db
    .delete(watchlistItemsTable)
    .where(eq(watchlistItemsTable.watchlistId, watchlistId));
  await db.delete(watchlistsTable).where(eq(watchlistsTable.id, watchlistId));

  if (current.isDefault) {
    const nextDefault = await db
      .select({ id: watchlistsTable.id })
      .from(watchlistsTable)
      .orderBy(asc(watchlistsTable.name))
      .limit(1);
    if (nextDefault[0]) {
      await setDefaultWatchlistIfNeeded(nextDefault[0].id);
    }
  }

  return { ok: true };
}

export async function addWatchlistSymbol(
  watchlistId: string,
  input: WatchlistMutationSymbol,
) {
  const current = await getWatchlistById(watchlistId);
  if (!current) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const instrument = await ensureInstrumentForSymbol(input);
  const exists = await db
    .select({ id: watchlistItemsTable.id })
    .from(watchlistItemsTable)
    .where(
      and(
        eq(watchlistItemsTable.watchlistId, watchlistId),
        eq(watchlistItemsTable.instrumentId, instrument.id),
      ),
    )
    .limit(1);

  if (exists[0]) {
    return current;
  }

  const [lastItem] = await db
    .select({ sortOrder: watchlistItemsTable.sortOrder })
    .from(watchlistItemsTable)
    .where(eq(watchlistItemsTable.watchlistId, watchlistId))
    .orderBy(desc(watchlistItemsTable.sortOrder))
    .limit(1);

  await db.insert(watchlistItemsTable).values({
    watchlistId,
    instrumentId: instrument.id,
    sortOrder: (lastItem?.sortOrder ?? -1) + 1,
  });

  return getWatchlistById(watchlistId);
}

export async function removeWatchlistSymbol(
  watchlistId: string,
  itemId: string,
) {
  const item = await db
    .select({
      id: watchlistItemsTable.id,
    })
    .from(watchlistItemsTable)
    .where(
      and(
        eq(watchlistItemsTable.id, itemId),
        eq(watchlistItemsTable.watchlistId, watchlistId),
      ),
    )
    .limit(1);

  if (!item[0]) {
    throw new HttpError(404, "Watchlist item not found.", {
      code: "watchlist_item_not_found",
    });
  }

  await db
    .delete(watchlistItemsTable)
    .where(eq(watchlistItemsTable.id, itemId));
  await rebalanceWatchlistSortOrder(watchlistId);
  return getWatchlistById(watchlistId);
}

export async function reorderWatchlistSymbols(
  watchlistId: string,
  itemIds: string[],
) {
  const current = await getWatchlistById(watchlistId);
  if (!current) {
    throw new HttpError(404, "Watchlist not found.", {
      code: "watchlist_not_found",
    });
  }

  const existingIds = current.items.map((item) => item.id);
  const normalizedIds = Array.from(
    new Set(itemIds.filter((itemId) => typeof itemId === "string" && itemId)),
  );
  if (
    normalizedIds.length !== existingIds.length ||
    existingIds.some((itemId) => !normalizedIds.includes(itemId))
  ) {
    throw new HttpError(
      400,
      "Reorder payload must include every watchlist item exactly once.",
      {
        code: "watchlist_reorder_invalid",
      },
    );
  }

  await Promise.all(
    normalizedIds.map((itemId, index) =>
      db
        .update(watchlistItemsTable)
        .set({ sortOrder: index })
        .where(
          and(
            eq(watchlistItemsTable.id, itemId),
            eq(watchlistItemsTable.watchlistId, watchlistId),
          ),
        ),
    ),
  );

  return getWatchlistById(watchlistId);
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

export async function listExecutions(input: {
  accountId?: string;
  days?: number;
  limit?: number;
  symbol?: string;
  providerContractId?: string | null;
}) {
  const client = getIbkrClient();
  return {
    executions: await client.listExecutions(input),
  };
}

export async function placeOrder(input: PlaceOrderInput) {
  const client = getIbkrClient();
  return client.placeOrder(input);
}

export async function previewOrder(input: PlaceOrderInput) {
  const client = getIbkrClient();
  return client.previewOrder(input);
}

export async function submitRawOrders(input: {
  accountId?: string | null;
  ibkrOrders: Record<string, unknown>[];
}) {
  const client = getIbkrClient();
  return client.submitRawOrders(input);
}

export async function replaceOrder(input: {
  accountId: string;
  orderId: string;
  order: Record<string, unknown>;
  mode?: "paper" | "live";
}) {
  const client = getIbkrClient();
  return client.replaceOrder({
    accountId: input.accountId,
    orderId: input.orderId,
    order: input.order,
    mode: input.mode ?? getRuntimeMode(),
  });
}

export async function cancelOrder(input: {
  accountId: string;
  orderId: string;
  manualIndicator?: boolean | null;
  extOperator?: string | null;
}) {
  const client = getIbkrClient();
  return client.cancelOrder(input);
}

export async function getQuoteSnapshots(input: { symbols: string }) {
  const symbols = input.symbols
    .split(",")
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean);
  const bridgeClient = getIbkrClient();
  const polygonClient = getPolygonRuntimeConfig() ? getPolygonClient() : null;

  const [ibkrQuotes, polygonQuotes] = await Promise.all([
    bridgeClient.getQuoteSnapshots(symbols).catch(() => []),
    polygonClient?.getQuoteSnapshots(symbols).catch(() => []) ??
      Promise.resolve([]),
  ]);
  const polygonBySymbol = new Map(
    polygonQuotes.map((quote) => [quote.symbol, quote]),
  );
  const merged = ibkrQuotes.map((quote) => {
    const polygonQuote = polygonBySymbol.get(quote.symbol);

    return {
      ...quote,
      providerContractId: quote.providerContractId ?? null,
      change:
        quote.change !== 0 || quote.prevClose !== null
          ? quote.change
          : (polygonQuote?.change ?? 0),
      changePercent:
        quote.changePercent !== 0 || quote.prevClose !== null
          ? quote.changePercent
          : (polygonQuote?.changePercent ?? 0),
      open: quote.open ?? polygonQuote?.open ?? null,
      high: quote.high ?? polygonQuote?.high ?? null,
      low: quote.low ?? polygonQuote?.low ?? null,
      prevClose: quote.prevClose ?? polygonQuote?.prevClose ?? null,
      volume: quote.volume ?? polygonQuote?.volume ?? null,
      source: "ibkr" as const,
    };
  });

  const missingFromIbkr = symbols.flatMap((symbol) =>
    merged.some((quote) => quote.symbol === symbol)
      ? []
      : polygonBySymbol.get(symbol)
        ? [
            {
              ...polygonBySymbol.get(symbol),
              providerContractId: null,
              source: "polygon" as const,
            },
          ]
        : [],
  );

  return {
    quotes: [...merged, ...missingFromIbkr],
  };
}

export async function getNews(input: { ticker?: string; limit?: number }) {
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
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
}) {
  const bridgeClient = getIbkrClient();
  const polygonClient = getPolygonRuntimeConfig() ? getPolygonClient() : null;
  const outsideRth =
    typeof input.outsideRth === "boolean"
      ? input.outsideRth
      : input.timeframe !== "1d";
  const isBrokerHistoryTimeframe = ["1m", "5m", "15m", "1h", "1d"].includes(
    input.timeframe,
  );
  let ibkrBars: Awaited<ReturnType<IbkrBridgeClient["getHistoricalBars"]>> = [];

  if (isBrokerHistoryTimeframe) {
    try {
      ibkrBars = await bridgeClient.getHistoricalBars({
        symbol: input.symbol,
        timeframe: input.timeframe as "1m" | "5m" | "15m" | "1h" | "1d",
        limit: input.limit,
        from: input.from,
        to: input.to,
        assetClass: input.assetClass,
        providerContractId: input.providerContractId,
        outsideRth,
        source: input.source,
      });
    } catch (error) {
      ibkrBars = [];
    }
  }
  const desiredBars = Math.max(input.limit ?? ibkrBars.length ?? 0, 1);
  const needsGapFill =
    input.assetClass !== "option" &&
    polygonClient &&
    (!isBrokerHistoryTimeframe ||
      (desiredBars > 0 && ibkrBars.length < desiredBars));

  let bars = ibkrBars;

  if (needsGapFill && polygonClient) {
    let polygonBars: Awaited<ReturnType<PolygonMarketDataClient["getBars"]>> =
      [];
    try {
      polygonBars = await polygonClient.getBars({
        symbol: input.symbol,
        timeframe: input.timeframe,
        limit: desiredBars,
        from: input.from,
        to: input.to,
      });
    } catch {
      polygonBars = [];
    }
    const merged = new Map<
      number,
      {
        timestamp: Date;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        providerContractId: string | null;
        outsideRth: boolean;
        partial: boolean;
      }
    >();

    polygonBars.forEach((bar) => {
      merged.set(bar.timestamp.getTime(), {
        ...bar,
        source: "ibkr+massive-gap-fill",
        providerContractId: null,
        outsideRth,
        partial: false,
      });
    });
    ibkrBars.forEach((bar) => {
      merged.set(bar.timestamp.getTime(), {
        ...bar,
        source: "ibkr+massive-gap-fill",
      });
    });
    bars = Array.from(merged.values())
      .sort(
        (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
      )
      .slice(-desiredBars);
  }

  return {
    symbol: normalizeSymbol(input.symbol),
    timeframe: input.timeframe,
    bars,
  };
}

export async function getOptionChain(input: {
  underlying: string;
  expirationDate?: Date;
  contractType?: "call" | "put";
}) {
  const bridgeClient = getIbkrClient();
  const polygonClient = getPolygonRuntimeConfig() ? getPolygonClient() : null;
  const ibkrContracts = await bridgeClient
    .getOptionChain({
      ...input,
      maxExpirations: input.expirationDate ? 1 : 3,
      strikesAroundMoney: 12,
    })
    .catch(() => []);
  const polygonContracts = polygonClient
    ? await polygonClient.getOptionChain(input).catch(() => [])
    : [];

  const mergedContracts =
    ibkrContracts.length > 0 ? ibkrContracts : polygonContracts;

  return {
    underlying: normalizeSymbol(input.underlying),
    expirationDate: input.expirationDate ?? null,
    contracts: mergedContracts,
  };
}

export async function getMarketDepth(input: {
  accountId?: string;
  symbol: string;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
  exchange?: string | null;
}) {
  const client = getIbkrClient();
  return {
    depth: await client.getMarketDepth({
      accountId: input.accountId,
      symbol: normalizeSymbol(input.symbol),
      assetClass: input.assetClass,
      providerContractId: input.providerContractId,
      exchange: input.exchange,
    }),
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
