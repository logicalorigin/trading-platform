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
import {
  PolygonMarketDataClient,
  computeUnusualMetrics,
} from "../providers/polygon/market-data";

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
  const [bridgeHealth, ibkrQuotes] = await Promise.all([
    bridgeClient.getHealth().catch(() => null),
    bridgeClient
      .getQuoteSnapshots(symbols)
      .catch(
        (): Awaited<ReturnType<IbkrBridgeClient["getQuoteSnapshots"]>> => [],
      ),
  ]);

  return {
    quotes: ibkrQuotes.map((quote) => ({
      ...quote,
      providerContractId: quote.providerContractId ?? null,
      source: "ibkr" as const,
    })),
    transport: bridgeHealth?.transport ?? null,
    delayed: ibkrQuotes.some((quote) => quote.delayed),
    fallbackUsed: false,
  };
}

export async function getNews(input: { ticker?: string; limit?: number }) {
  // IBKR is the primary news source (user has Reuters subscription via IBKR).
  // We only fall back to Polygon when IBKR returns no headlines — typically
  // for tickerless requests, since IBKR's /iserver/news requires a conid.
  const ibkrClient = getIbkrClient();
  let articles: Awaited<ReturnType<IbkrBridgeClient["getNews"]>> = [];
  try {
    articles = await ibkrClient.getNews(input);
  } catch {
    articles = [];
  }

  if (articles.length === 0 && getPolygonRuntimeConfig()) {
    try {
      const polygonArticles = await getPolygonClient().getNews(input);
      return { articles: polygonArticles };
    } catch {
      // fall through to empty IBKR result
    }
  }

  return { articles };
}

export async function searchUniverseTickers(input: {
  search?: string;
  market?: "stocks" | "indices" | "fx" | "crypto" | "otc";
  type?: string;
  active?: boolean;
  limit?: number;
}) {
  // IBKR is the primary universe source so the search box mirrors the
  // contracts the broker can actually trade. Polygon remains the fallback
  // for non-stock markets (indices/fx/crypto/otc) and any IBKR misses.
  const ibkrClient = getIbkrClient();
  if (input.market == null || input.market === "stocks") {
    try {
      const result = await ibkrClient.searchTickers({
        search: input.search,
        limit: input.limit,
      });
      if (result.results.length > 0) return result;
    } catch {
      // fall through to Polygon
    }
  }

  if (getPolygonRuntimeConfig()) {
    return getPolygonClient().searchUniverseTickers(input);
  }
  return { count: 0, results: [] };
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
  allowHistoricalSynthesis?: boolean;
}) {
  const bridgeClient = getIbkrClient();
  const bridgeHealth = await bridgeClient.getHealth().catch(() => null);
  const polygonClient = getPolygonRuntimeConfig() ? getPolygonClient() : null;
  // Default to including extended hours across ALL timeframes so the "last close"
  // a chart shows is consistent regardless of the selected interval. Without this,
  // 1d returned RTH-only bars while 1m/5m/15m/1h returned extended-hours bars,
  // causing the most-recent price to differ depending on which interval was active.
  // Callers (e.g. backtest) can still pass outsideRth=false explicitly for strict RTH.
  const outsideRth =
    typeof input.outsideRth === "boolean" ? input.outsideRth : true;
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
  const allowHistoricalSynthesis = input.allowHistoricalSynthesis === true;
  const needsGapFill =
    allowHistoricalSynthesis &&
    input.assetClass !== "option" &&
    polygonClient &&
    (!isBrokerHistoryTimeframe ||
      (desiredBars > 0 && ibkrBars.length < desiredBars));

  let bars = ibkrBars;
  let gapFilled = false;

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
        transport: "client_portal" | "tws";
        delayed: boolean;
      }
    >();

    // Tag each bar honestly with its actual source so the chart UI / debugging
    // can tell what came from where. IBKR bars always overwrite Polygon bars at
    // the same timestamp because IBKR is the authoritative live broker feed.
    polygonBars.forEach((bar) => {
      gapFilled = true;
      merged.set(bar.timestamp.getTime(), {
        ...bar,
        source: "polygon-history",
        providerContractId: null,
        outsideRth,
        partial: false,
        transport: bridgeHealth?.transport ?? "client_portal",
        delayed: false,
      });
    });
    ibkrBars.forEach((bar) => {
      merged.set(bar.timestamp.getTime(), {
        ...bar,
        source: "ibkr-history",
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
    transport: bars[0]?.transport ?? bridgeHealth?.transport ?? null,
    delayed: bars.some((bar) => bar.delayed),
    gapFilled,
  };
}

export async function getOptionChain(input: {
  underlying: string;
  expirationDate?: Date;
  contractType?: "call" | "put";
}) {
  const bridgeClient = getIbkrClient();
  const ibkrContracts = await bridgeClient
    .getOptionChain({
      ...input,
      maxExpirations: input.expirationDate ? 1 : 3,
      strikesAroundMoney: 12,
    })
    .catch(() => []);

  return {
    underlying: normalizeSymbol(input.underlying),
    expirationDate: input.expirationDate ?? null,
    contracts: ibkrContracts,
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

  // Derive flow events from IBKR option-chain snapshots (the user has OPRA
  // data via IBKR). One event per active contract, ranked by traded volume so
  // the highest-activity contracts surface first. Falls back to Polygon if
  // IBKR returns no contracts.
  const ibkrClient = getIbkrClient();
  let contracts: Awaited<ReturnType<IbkrBridgeClient["getOptionChain"]>> = [];
  try {
    // Keep coverage tight — IBKR snapshots are rate-limited and the flow
    // panel renders the highest-premium contracts first, so a moderate
    // window around the money is plenty.
    contracts = await ibkrClient.getOptionChain({
      underlying: input.underlying,
      maxExpirations: 2,
      strikesAroundMoney: 8,
    });
  } catch {
    contracts = [];
  }

  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  // IBKR snapshots now include OPRA volume (field 7762) and option open
  // interest (field 7638), so flow events can rank by real traded premium.
  // Require both a marked contract and non-zero day volume — this filters
  // out the long tail of contracts with no prints today and matches the
  // Polygon-backed flow ranking semantics.
  const events = contracts
    .filter((c) => c.mark > 0 && c.volume > 0)
    .map((c) => {
      const mid = (c.bid + c.ask) / 2;
      const side: "buy" | "sell" | "unknown" =
        c.bid > 0 && c.ask > 0
          ? c.last >= c.ask
            ? "buy"
            : c.last <= c.bid
              ? "sell"
              : c.last > mid
                ? "buy"
                : c.last < mid
                  ? "sell"
                  : "unknown"
          : "unknown";
      const sentiment: "bullish" | "bearish" | "neutral" =
        side === "unknown"
          ? "neutral"
          : (c.contract.right === "call" && side === "buy") ||
              (c.contract.right === "put" && side === "sell")
            ? "bullish"
            : "bearish";
      const price = c.last > 0 ? c.last : c.mark;
      const size = c.volume;
      const { unusualScore, isUnusual } = computeUnusualMetrics(
        size,
        c.openInterest,
      );
      // Rank by mark-based premium (mark × volume × multiplier) so the
      // ordering is stable even when `last` is stale or zero. The display
      // `price` still prefers the most recent print when available.
      return {
        id: `${c.contract.ticker}-${c.updatedAt.getTime()}`,
        underlying: normalizeSymbol(c.contract.underlying),
        optionTicker: c.contract.ticker,
        strike: c.contract.strike,
        expirationDate: c.contract.expirationDate,
        right: c.contract.right,
        price,
        size,
        premium: c.mark * size * c.contract.sharesPerContract,
        openInterest: c.openInterest,
        impliedVolatility: c.impliedVolatility,
        exchange: "IBKR",
        side,
        sentiment,
        tradeConditions: [] as string[],
        occurredAt: c.updatedAt,
        unusualScore,
        isUnusual,
      };
    })
    // Surface unusual prints (volume > open interest) above routine flow,
    // then fall back to premium so the highest-conviction prints win ties.
    .sort((a, b) => {
      if (a.isUnusual !== b.isUnusual) return a.isUnusual ? -1 : 1;
      if (a.isUnusual && b.isUnusual && a.unusualScore !== b.unusualScore) {
        return b.unusualScore - a.unusualScore;
      }
      return b.premium - a.premium;
    })
    .slice(0, limit);

  if (events.length === 0 && getPolygonRuntimeConfig()) {
    try {
      return {
        events: await getPolygonClient().getDerivedFlowEvents({
          underlying: input.underlying,
          limit: input.limit,
        }),
      };
    } catch {
      return { events: [] };
    }
  }

  return { events };
}
