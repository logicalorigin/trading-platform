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
import { logger } from "../lib/logger";
import { normalizeSymbol } from "../lib/values";
import { type PlaceOrderInput } from "../providers/ibkr/client";
import { IbkrBridgeClient } from "../providers/ibkr/bridge-client";
import {
  PolygonMarketDataClient,
  computeUnusualMetrics,
  type MarketDataProvider,
  type UniverseTicker,
  type UniverseMarket,
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

let lastIbkrWatchlistPrewarmSignature: string | null = null;
let pendingIbkrWatchlistPrewarmSignature: string | null = null;
let ibkrWatchlistPrewarmSequence = 0;

function collectWatchlistSymbols(watchlists: WatchlistRecord[]): string[] {
  return Array.from(
    new Set(
      watchlists.flatMap((watchlist) =>
        watchlist.items
          .map((item) => normalizeSymbol(item.symbol).toUpperCase())
          .filter(Boolean),
      ),
    ),
  ).sort();
}

function scheduleIbkrWatchlistPrewarm(
  watchlists: WatchlistRecord[],
  reason: string,
) {
  if (!getProviderConfiguration().ibkr) {
    return;
  }

  const symbols = collectWatchlistSymbols(watchlists);
  const signature = symbols.join(",");

  if (
    signature === lastIbkrWatchlistPrewarmSignature ||
    signature === pendingIbkrWatchlistPrewarmSignature
  ) {
    return;
  }

  const sequence = ibkrWatchlistPrewarmSequence + 1;
  ibkrWatchlistPrewarmSequence = sequence;
  pendingIbkrWatchlistPrewarmSignature = signature;

  void getIbkrClient()
    .prewarmQuoteSubscriptions(symbols)
    .then(() => {
      if (sequence !== ibkrWatchlistPrewarmSequence) {
        return;
      }

      lastIbkrWatchlistPrewarmSignature = signature;
      logger.info(
        { symbols, reason },
        "IBKR bridge watchlist prewarm synced",
      );
    })
    .catch((error) => {
      logger.warn(
        { err: error, symbols, reason },
        "IBKR bridge watchlist prewarm failed",
      );
    })
    .finally(() => {
      if (sequence === ibkrWatchlistPrewarmSequence) {
        pendingIbkrWatchlistPrewarmSignature = null;
      }
    });
}

function scheduleIbkrWatchlistPrewarmFromDb(reason: string) {
  if (!getProviderConfiguration().ibkr) {
    return;
  }

  void listWatchlistsFromDb()
    .then((snapshot) => scheduleIbkrWatchlistPrewarm(snapshot.watchlists, reason))
    .catch((error) => {
      logger.warn(
        { err: error, reason },
        "IBKR bridge watchlist prewarm snapshot failed",
      );
    });
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

type FlowDataProvider = "ibkr" | "polygon";
type FlowSourceProvider = FlowDataProvider | "none";
type FlowSourceStatus = "live" | "fallback" | "empty" | "error";

type FlowEventsSource = {
  provider: FlowSourceProvider;
  status: FlowSourceStatus;
  fallbackUsed: boolean;
  attemptedProviders: FlowDataProvider[];
  errorMessage: string | null;
  fetchedAt: Date;
  unusualThreshold: number;
};

type FlowEventsResult = {
  events: unknown[];
  source: FlowEventsSource;
};

const FLOW_EVENTS_CACHE_TTL_MS = 15_000;
const flowEventsCache = new Map<
  string,
  { value: FlowEventsResult; expiresAt: number }
>();
const flowEventsInFlight = new Map<string, Promise<FlowEventsResult>>();

function flowSource(input: {
  provider: FlowSourceProvider;
  status: FlowSourceStatus;
  fallbackUsed?: boolean;
  attemptedProviders?: FlowDataProvider[];
  errorMessage?: string | null;
  unusualThreshold?: number;
}): FlowEventsSource {
  return {
    provider: input.provider,
    status: input.status,
    fallbackUsed: Boolean(input.fallbackUsed),
    attemptedProviders: input.attemptedProviders ?? [],
    errorMessage: input.errorMessage ?? null,
    fetchedAt: new Date(),
    unusualThreshold:
      Number.isFinite(input.unusualThreshold) &&
      (input.unusualThreshold as number) > 0
        ? (input.unusualThreshold as number)
        : 1,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === "string" && error.trim()
    ? error
    : "Unknown provider error.";
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
  const snapshot = await listWatchlistsFromDb();
  scheduleIbkrWatchlistPrewarm(snapshot.watchlists, "list");
  return snapshot;
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

  const created = await getWatchlistById(watchlist.id);
  scheduleIbkrWatchlistPrewarmFromDb("create");
  return created;
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

  const updated = await getWatchlistById(watchlistId);
  scheduleIbkrWatchlistPrewarmFromDb("update");
  return updated;
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

  scheduleIbkrWatchlistPrewarmFromDb("delete");
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

  const updated = await getWatchlistById(watchlistId);
  scheduleIbkrWatchlistPrewarmFromDb("add-symbol");
  return updated;
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
  const updated = await getWatchlistById(watchlistId);
  scheduleIbkrWatchlistPrewarmFromDb("remove-symbol");
  return updated;
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

  const updated = await getWatchlistById(watchlistId);
  scheduleIbkrWatchlistPrewarmFromDb("reorder");
  return updated;
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

function assertLiveOrderConfirmed(
  mode: "paper" | "live" | null | undefined,
  confirm: boolean | null | undefined,
) {
  if (mode !== "live" || confirm === true) {
    return;
  }

  throw new HttpError(
    409,
    "Live IBKR order actions require explicit confirmation. Retry with confirm=true after the user reviews the order details.",
    {
      code: "ibkr_live_order_confirmation_required",
    },
  );
}

export async function placeOrder(input: PlaceOrderInput) {
  assertLiveOrderConfirmed(input.mode, input.confirm);
  const client = getIbkrClient();
  return client.placeOrder(input);
}

export async function previewOrder(input: PlaceOrderInput) {
  const client = getIbkrClient();
  return client.previewOrder(input);
}

export async function submitRawOrders(input: {
  accountId?: string | null;
  mode?: "paper" | "live" | null;
  confirm?: boolean | null;
  ibkrOrders: Record<string, unknown>[];
}) {
  assertLiveOrderConfirmed(input.mode ?? getRuntimeMode(), input.confirm);
  const client = getIbkrClient();
  return client.submitRawOrders(input);
}

export async function replaceOrder(input: {
  accountId: string;
  orderId: string;
  order: Record<string, unknown>;
  mode?: "paper" | "live";
  confirm?: boolean | null;
}) {
  assertLiveOrderConfirmed(input.mode ?? getRuntimeMode(), input.confirm);
  const client = getIbkrClient();
  return client.replaceOrder({
    accountId: input.accountId,
    orderId: input.orderId,
    order: input.order,
    mode: input.mode ?? getRuntimeMode(),
    confirm: input.confirm,
  });
}

export async function cancelOrder(input: {
  accountId: string;
  orderId: string;
  confirm?: boolean | null;
  manualIndicator?: boolean | null;
  extOperator?: string | null;
}) {
  assertLiveOrderConfirmed(getRuntimeMode(), input.confirm);
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

type SearchUniverseTickersInput = {
  search?: string;
  market?: UniverseMarket;
  markets?: UniverseMarket[];
  type?: string;
  active?: boolean;
  limit?: number;
};

type SearchUniverseTickersOptions = {
  signal?: AbortSignal;
};

type UniverseSearchResponse = { count: number; results: UniverseTicker[] };

const ALL_UNIVERSE_MARKETS: UniverseMarket[] = [
  "stocks",
  "etf",
  "indices",
  "futures",
  "fx",
  "crypto",
  "otc",
];
const POLYGON_SEARCH_MARKETS: UniverseMarket[] = [
  "stocks",
  "etf",
  "indices",
  "fx",
  "crypto",
  "otc",
];
const UNIVERSE_SEARCH_CACHE_TTL_MS = 30_000;
const UNIVERSE_SEARCH_CACHE_MAX = 120;
const UNIVERSE_SEARCH_IBKR_BUDGET_MS = 2_200;
const UNIVERSE_SEARCH_POLYGON_EXACT_BUDGET_MS = 300;
const UNIVERSE_SEARCH_INTERACTIVE_BUDGET_MS = 2_500;
const UNIVERSE_SEARCH_BACKGROUND_BUDGET_MS = 8_000;
const universeSearchCache = new Map<
  string,
  { expiresAt: number; data: UniverseSearchResponse }
>();
const universeSearchInFlight = new Map<
  string,
  {
    controller: AbortController;
    consumers: number;
    settled: boolean;
    promise: Promise<UniverseSearchResponse>;
  }
>();
const universeSearchBackgroundInFlight = new Set<string>();

const EXCHANGE_MIC_ALIASES: Record<string, string> = {
  NASDAQ: "XNAS",
  NASD: "XNAS",
  NMS: "XNAS",
  XNAS: "XNAS",
  NYSE: "XNYS",
  NYS: "XNYS",
  ARCA: "ARCX",
  ARCX: "ARCX",
  XNYS: "XNYS",
  AMEX: "XASE",
  ASE: "XASE",
  XASE: "XASE",
  CME: "XCME",
  GLOBEX: "XCME",
  XCME: "XCME",
  CBOE: "XCBO",
  BATS: "BATS",
  OTC: "OTC",
  OTCM: "OTC",
  PINK: "OTC",
  PINX: "OTC",
  OTCLINK: "OTC",
};
const US_PRIMARY_EXCHANGE_MICS = new Set(["XNAS", "XNYS", "ARCX", "XASE", "BATS"]);
const US_EXCHANGE_PREFERENCE_SCORE: Record<string, number> = {
  XNAS: 680,
  XNYS: 660,
  ARCX: 640,
  XASE: 520,
  BATS: 500,
};

function resolveRequestedUniverseMarkets(input: SearchUniverseTickersInput) {
  const raw = input.markets?.length
    ? input.markets
    : input.market
      ? [input.market]
      : ALL_UNIVERSE_MARKETS;
  const allowed = new Set(ALL_UNIVERSE_MARKETS);
  return Array.from(new Set(raw.filter((market) => allowed.has(market))));
}

function normalizeExchangeMic(exchange: string | null | undefined, market: UniverseMarket) {
  const raw = exchange?.trim().toUpperCase() ?? "";
  if (!raw) {
    if (market === "fx") return "FX";
    if (market === "crypto") return "COIN";
    if (market === "futures") return "FUT";
    return "";
  }
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  return EXCHANGE_MIC_ALIASES[compact] ?? compact;
}

function extractExchangeHintFromText(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  const match = text.match(/\(([A-Z0-9._ -]{2,16})\)\s*$/);
  return match?.[1]?.trim() ?? null;
}

function inferLegacyIbkrUniverseMarket(ticker: UniverseTicker): UniverseMarket {
  if (ticker.provider !== "ibkr" || ticker.market !== "stocks") {
    return ticker.market;
  }

  const type = ticker.type?.trim().toUpperCase() ?? "";
  const name = ticker.name.trim().toUpperCase();

  if (type === "ETF") return "etf";
  if (
    type === "STK" &&
    /\b(ETF|ETN|ETP|UCITS|SPDR|ISHARES|PROSHARES|INVESCO|VANGUARD|DIREXION|WISDOMTREE|GLOBAL X|GRAYSCALE)\b/.test(
      name,
    )
  ) {
    return "etf";
  }

  return ticker.market;
}

function normalizeRootSymbol(ticker: UniverseTicker) {
  const root =
    ticker.rootSymbol?.trim() ||
    normalizeSymbol(ticker.ticker).replace(/^X:/, "").split(/[./:\s-]+/)[0] ||
    normalizeSymbol(ticker.ticker);
  return normalizeSymbol(root);
}

function hydrateUniverseTickerMetadata(ticker: UniverseTicker): UniverseTicker {
  const normalizedTicker = normalizeSymbol(ticker.ticker);
  const market = inferLegacyIbkrUniverseMarket(ticker);
  const exchangeHint =
    ticker.normalizedExchangeMic ??
    ticker.primaryExchange ??
    ticker.exchangeDisplay ??
    extractExchangeHintFromText(ticker.name) ??
    extractExchangeHintFromText(ticker.contractDescription);
  const normalizedExchangeMic = normalizeExchangeMic(
    exchangeHint,
    market,
  );
  const providers = Array.from(
    new Set([
      ...(ticker.providers ?? []),
      ...(ticker.provider ? [ticker.provider] : []),
    ].filter((provider): provider is MarketDataProvider => provider === "ibkr" || provider === "polygon")),
  ).sort((left, right) => (left === "ibkr" ? -1 : right === "ibkr" ? 1 : left.localeCompare(right)));
  const tradeProvider =
    ticker.tradeProvider ??
    (ticker.providerContractId && providers.includes("ibkr") ? "ibkr" : null);

  return {
    ...ticker,
    ticker: normalizedTicker,
    market,
    rootSymbol: ticker.rootSymbol ?? normalizeRootSymbol(ticker),
    normalizedExchangeMic,
    exchangeDisplay: ticker.exchangeDisplay ?? ticker.primaryExchange ?? exchangeHint ?? (normalizedExchangeMic || null),
    logoUrl: ticker.logoUrl ?? null,
    contractDescription: ticker.contractDescription ?? ticker.name,
    contractMeta: ticker.contractMeta ?? null,
    providers,
    provider: tradeProvider ?? ticker.provider ?? providers[0] ?? null,
    tradeProvider,
    dataProviderPreference:
      ticker.dataProviderPreference ??
      (providers.includes("ibkr")
        ? "ibkr"
        : providers.includes("polygon")
          ? "polygon"
          : null),
  };
}

function buildUniverseTickerMergeKey(ticker: UniverseTicker) {
  const hydrated = hydrateUniverseTickerMetadata(ticker);
  return [
    normalizeRootSymbol(hydrated),
    hydrated.market,
    hydrated.normalizedExchangeMic ?? "",
  ].join("|");
}

function buildTickerSearchAliases(ticker: UniverseTicker): string[] {
  const normalizedTicker = normalizeSymbol(ticker.ticker);
  const withoutProviderPrefix = normalizedTicker.replace(/^[A-Z]:/, "");
  const aliases = new Set([
    normalizedTicker,
    withoutProviderPrefix,
    normalizeRootSymbol(ticker),
  ]);

  if (ticker.market === "crypto" && withoutProviderPrefix.endsWith("USD")) {
    aliases.add(withoutProviderPrefix.slice(0, -3));
  }

  return Array.from(aliases).filter(Boolean);
}

function mergeUniverseTicker(
  current: UniverseTicker | undefined,
  incoming: UniverseTicker,
): UniverseTicker {
  const next = hydrateUniverseTickerMetadata(incoming);
  if (!current) return next;

  const existing = hydrateUniverseTickerMetadata(current);
  const providers = Array.from(new Set([...existing.providers, ...next.providers])).sort(
    (left, right) => (left === "ibkr" ? -1 : right === "ibkr" ? 1 : left.localeCompare(right)),
  );
  const ibkrProviderContractId =
    existing.provider === "ibkr" || existing.tradeProvider === "ibkr"
      ? existing.providerContractId
      : next.provider === "ibkr" || next.tradeProvider === "ibkr"
        ? next.providerContractId
        : null;
  const providerContractId =
    ibkrProviderContractId ?? existing.providerContractId ?? next.providerContractId ?? null;
  const tradeProvider = providerContractId && providers.includes("ibkr") ? "ibkr" : null;

  return {
    ...existing,
    ...next,
    name: next.name.length > existing.name.length ? next.name : existing.name,
    rootSymbol: existing.rootSymbol || next.rootSymbol,
    normalizedExchangeMic: existing.normalizedExchangeMic || next.normalizedExchangeMic,
    exchangeDisplay: existing.exchangeDisplay || next.exchangeDisplay,
    logoUrl: existing.logoUrl || next.logoUrl,
    contractDescription:
      next.contractDescription && next.contractDescription.length > (existing.contractDescription ?? "").length
        ? next.contractDescription
        : existing.contractDescription || next.contractDescription,
    contractMeta: {
      ...(existing.contractMeta ?? {}),
      ...(next.contractMeta ?? {}),
    },
    primaryExchange: existing.primaryExchange || next.primaryExchange,
    currencyName: existing.currencyName || next.currencyName,
    cik: existing.cik || next.cik,
    compositeFigi: existing.compositeFigi || next.compositeFigi,
    shareClassFigi: existing.shareClassFigi || next.shareClassFigi,
    lastUpdatedAt: existing.lastUpdatedAt || next.lastUpdatedAt,
    providers,
    provider: tradeProvider ?? (providers.includes("polygon") ? "polygon" : providers[0] ?? null),
    tradeProvider,
    dataProviderPreference: providers.includes("ibkr")
      ? "ibkr"
      : providers.includes("polygon")
        ? "polygon"
        : null,
    providerContractId,
  };
}

function scoreUniverseTicker(
  ticker: UniverseTicker,
  query: string,
  requestedMarkets: Set<UniverseMarket>,
): number {
  const normalizedTicker = normalizeSymbol(ticker.ticker);
  const normalizedName = ticker.name.trim().toLowerCase();
  const queryUpper = query.toUpperCase();
  const queryLower = query.toLowerCase();
  const tickerAliases = buildTickerSearchAliases(ticker);
  let score = 0;

  if (ticker.contractMeta?.identifierMatch) score += 3_000;
  if (ticker.providerContractId === query) score += 2_000;

  if (tickerAliases.includes(queryUpper)) score += 3_000;
  else if (normalizedTicker === queryUpper) score += 3_000;
  else if (normalizedTicker.startsWith(queryUpper)) score += 1_050;
  else if (normalizedTicker.includes(queryUpper)) score += 800;

  if (normalizedName === queryLower) score += 720;
  else if (normalizedName.startsWith(queryLower)) score += 560;
  else if (
    normalizedName
      .split(/[\s./-]+/)
      .some((part) => part.startsWith(queryLower))
  ) {
    score += 500;
  } else if (normalizedName.includes(queryLower)) {
    score += 320;
  }

  if (requestedMarkets.has(ticker.market)) score += 80;
  if (ticker.providers.includes("ibkr")) score += 45;
  if (ticker.providerContractId) score += 30;
  if (ticker.providers.includes("polygon")) score += 12;
  if (ticker.active) score += 10;
  if (
    ticker.normalizedExchangeMic &&
    US_PRIMARY_EXCHANGE_MICS.has(ticker.normalizedExchangeMic)
  ) {
    score +=
      tickerAliases.includes(queryUpper) &&
      (ticker.market === "stocks" || ticker.market === "etf" || ticker.market === "otc")
        ? US_EXCHANGE_PREFERENCE_SCORE[ticker.normalizedExchangeMic] ?? 450
        : 220;
  }
  if (ticker.normalizedExchangeMic || ticker.primaryExchange) score += 5;

  return score;
}

function getUniverseSearchCacheKey(
  input: SearchUniverseTickersInput,
  markets: UniverseMarket[],
  limit: number,
) {
  return JSON.stringify({
    search: input.search?.trim().toUpperCase() ?? "",
    market: input.market ?? null,
    markets: [...markets].sort(),
    type: input.type ?? null,
    active: input.active ?? null,
    limit,
  });
}

function readUniverseSearchCache(key: string) {
  const cached = universeSearchCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    universeSearchCache.delete(key);
    return null;
  }
  universeSearchCache.delete(key);
  universeSearchCache.set(key, cached);
  return sanitizeUniverseSearchResponse(cached.data);
}

function writeUniverseSearchCache(
  key: string,
  data: UniverseSearchResponse,
) {
  const sanitized = sanitizeUniverseSearchResponse(data);
  universeSearchCache.set(key, {
    expiresAt: Date.now() + UNIVERSE_SEARCH_CACHE_TTL_MS,
    data: sanitized,
  });
  while (universeSearchCache.size > UNIVERSE_SEARCH_CACHE_MAX) {
    const oldestKey = universeSearchCache.keys().next().value;
    if (!oldestKey) break;
    universeSearchCache.delete(oldestKey);
  }
}

function createClientAbortedError() {
  return new HttpError(499, "Ticker search request was aborted.", {
    code: "ticker_search_aborted",
  });
}

function throwIfSignalAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createClientAbortedError();
  }
}

async function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  throwIfSignalAborted(signal);

  let abortListener: (() => void) | null = null;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(createClientAbortedError());
    signal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
}

function createBudgetSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(`Ticker search budget exceeded after ${timeoutMs}ms.`));
    }
  }, Math.max(1, timeoutMs));
  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function isTickerLikeSearch(query: string) {
  return /^[A-Z][A-Z0-9.:-]{0,15}$/i.test(query.trim());
}

function sanitizeUniverseSearchResponse(response: UniverseSearchResponse): UniverseSearchResponse {
  return {
    count: response.results.length,
    results: response.results.map((ticker) => ({
      ...ticker,
      logoUrl: null,
    })),
  };
}

function finalizeUniverseSearchResponse(input: {
  providerResults: UniverseTicker[];
  requestedMarketSet: Set<UniverseMarket>;
  normalizedSearch: string;
  resultLimit: number;
}): UniverseSearchResponse {
  const merged = new Map<string, UniverseTicker>();

  for (const ticker of input.providerResults) {
    const hydrated = hydrateUniverseTickerMetadata(ticker);
    if (!input.requestedMarketSet.has(hydrated.market)) continue;
    const key = buildUniverseTickerMergeKey(hydrated);
    merged.set(key, mergeUniverseTicker(merged.get(key), hydrated));
  }

  const results = Array.from(merged.values())
    .sort((left, right) => {
      const scoreDiff =
        scoreUniverseTicker(right, input.normalizedSearch, input.requestedMarketSet) -
        scoreUniverseTicker(left, input.normalizedSearch, input.requestedMarketSet);
      if (scoreDiff !== 0) return scoreDiff;
      const tickerDiff = left.ticker.localeCompare(right.ticker);
      if (tickerDiff !== 0) return tickerDiff;
      return (left.normalizedExchangeMic ?? "").localeCompare(right.normalizedExchangeMic ?? "");
    })
    .slice(0, input.resultLimit);

  return sanitizeUniverseSearchResponse({ count: results.length, results });
}

async function runUniverseSearchTask(
  label: string,
  budgetMs: number,
  signal: AbortSignal | undefined,
  task: (signal: AbortSignal) => Promise<{ count: number; results: UniverseTicker[] }>,
): Promise<{
  label: string;
  elapsedMs: number;
  result: { count: number; results: UniverseTicker[] } | null;
}> {
  const startedAt = Date.now();
  const budgetSignal = createBudgetSignal(signal, budgetMs);

  try {
    const result = await task(budgetSignal.signal);
    return {
      label,
      elapsedMs: Date.now() - startedAt,
      result,
    };
  } catch (error) {
    logger.debug(
      { err: error, provider: label, elapsedMs: Date.now() - startedAt },
      "ticker search provider did not return within interactive budget",
    );
    return {
      label,
      elapsedMs: Date.now() - startedAt,
      result: null,
    };
  } finally {
    budgetSignal.dispose();
  }
}

function deriveCusipCandidates(query: string) {
  const normalized = query.trim().toUpperCase();
  const candidates = new Set<string>();
  if (/^[A-Z0-9]{9}$/.test(normalized)) candidates.add(normalized);
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(normalized) && !normalized.startsWith("BBG")) {
    candidates.add(normalized.slice(2, 11));
  }
  return Array.from(candidates);
}

function resolveInteractiveIbkrMarkets(
  input: SearchUniverseTickersInput,
  normalizedSearch: string,
  requestedMarkets: UniverseMarket[],
) {
  const hasExplicitMarketFilter = Boolean(input.market || input.markets?.length);
  if (hasExplicitMarketFilter || !isTickerLikeSearch(normalizedSearch)) {
    return requestedMarkets;
  }

  const preferredMarkets: UniverseMarket[] = ["stocks", "etf", "otc"];
  return preferredMarkets.filter((market) => requestedMarkets.includes(market));
}

function hasIbkrTradableResult(response: UniverseSearchResponse) {
  return response.results.some(
    (row) => row.providers.includes("ibkr") && row.tradeProvider === "ibkr" && row.providerContractId,
  );
}

async function runInteractiveUniverseSearch(input: {
  searchInput: SearchUniverseTickersInput;
  normalizedSearch: string;
  requestedMarkets: UniverseMarket[];
  requestedMarketSet: Set<UniverseMarket>;
  resultLimit: number;
  cacheKey: string;
  signal: AbortSignal;
}): Promise<UniverseSearchResponse> {
  const startedAt = Date.now();
  const searchLimit = Math.max(input.resultLimit * 3, 24);
  const polygonConfig = getPolygonRuntimeConfig();
  const polygonClient = polygonConfig ? getPolygonClient() : null;
  const interactiveIbkrMarkets = resolveInteractiveIbkrMarkets(
    input.searchInput,
    input.normalizedSearch,
    input.requestedMarkets,
  );

  const ibkrTask = runUniverseSearchTask(
    "ibkr",
    UNIVERSE_SEARCH_IBKR_BUDGET_MS,
    input.signal,
    (signal) =>
      getIbkrClient().searchTickers({
        search: input.normalizedSearch,
        markets: interactiveIbkrMarkets.length ? interactiveIbkrMarkets : input.requestedMarkets,
        limit: searchLimit,
        signal,
      }),
  );
  const polygonInteractiveTasks: Array<
    Promise<{
      label: string;
      elapsedMs: number;
      result: { count: number; results: UniverseTicker[] } | null;
    }>
  > = [];

  if (polygonClient && isTickerLikeSearch(input.normalizedSearch)) {
    polygonInteractiveTasks.push(
      runUniverseSearchTask(
        "polygon-exact",
        UNIVERSE_SEARCH_POLYGON_EXACT_BUDGET_MS,
        input.signal,
        async (signal) => {
          const ticker = await polygonClient.getUniverseTickerByTicker(
            input.normalizedSearch,
            signal,
          );
          return {
            count: ticker ? 1 : 0,
            results: ticker ? [ticker] : [],
          };
        },
      ),
    );
  }

  if (polygonClient) {
    const polygonMarkets = POLYGON_SEARCH_MARKETS.filter(
      (market) =>
        input.requestedMarketSet.has(market) &&
        (market === "stocks" || market === "etf" || market === "otc"),
    );
    for (const cusip of deriveCusipCandidates(input.normalizedSearch)) {
      for (const market of polygonMarkets) {
        polygonInteractiveTasks.push(
          runUniverseSearchTask(
            `polygon-cusip-${market}`,
            UNIVERSE_SEARCH_POLYGON_EXACT_BUDGET_MS,
            input.signal,
            (signal) =>
              polygonClient.searchUniverseTickers({
                market,
                markets: [market],
                cusip,
                active: input.searchInput.active,
                limit: searchLimit,
                signal,
              }),
          ),
        );
      }
    }
  }

  const [ibkrResult, polygonInteractiveResults] = await Promise.all([
    ibkrTask,
    Promise.all(polygonInteractiveTasks),
  ]);
  const providerResults = [
    ...(ibkrResult.result?.results ?? []),
    ...polygonInteractiveResults.flatMap((result) => result.result?.results ?? []),
  ];
  const response = finalizeUniverseSearchResponse({
    providerResults,
    requestedMarketSet: input.requestedMarketSet,
    normalizedSearch: input.normalizedSearch,
    resultLimit: input.resultLimit,
  });

  if (hasIbkrTradableResult(response)) {
    writeUniverseSearchCache(input.cacheKey, response);
  }
  startUniverseSearchBackgroundEnrichment({
    ...input,
    searchLimit,
    seedResults: providerResults,
    polygonClient,
  });

  logger.debug(
    {
      search: input.normalizedSearch,
      elapsedMs: Date.now() - startedAt,
      ibkrElapsedMs: ibkrResult.elapsedMs,
      polygonInteractiveElapsedMs: polygonInteractiveResults.reduce(
        (max, result) => Math.max(max, result.elapsedMs),
        0,
      ),
      count: response.count,
      firstTicker: response.results[0]?.ticker ?? null,
      firstTradeProvider: response.results[0]?.tradeProvider ?? null,
    },
    "ticker search completed",
  );

  return response;
}

function startUniverseSearchBackgroundEnrichment(input: {
  searchInput: SearchUniverseTickersInput;
  normalizedSearch: string;
  requestedMarkets: UniverseMarket[];
  requestedMarketSet: Set<UniverseMarket>;
  resultLimit: number;
  cacheKey: string;
  searchLimit: number;
  seedResults: UniverseTicker[];
  polygonClient: PolygonMarketDataClient | null;
}) {
  if (!input.polygonClient || input.normalizedSearch.length < 2) return;
  if (universeSearchBackgroundInFlight.has(input.cacheKey)) return;

  const polygonClient = input.polygonClient;
  universeSearchBackgroundInFlight.add(input.cacheKey);

  void (async () => {
    const budgetSignal = createBudgetSignal(undefined, UNIVERSE_SEARCH_BACKGROUND_BUDGET_MS);
      const providerResults = [
        ...input.seedResults,
        ...(readUniverseSearchCache(input.cacheKey)?.results ?? []),
      ];

    try {
      const polygonMarkets = POLYGON_SEARCH_MARKETS.filter((market) =>
        input.requestedMarketSet.has(market),
      );
      const tasks: Array<Promise<{ count: number; results: UniverseTicker[] }>> = [];

      if (isTickerLikeSearch(input.normalizedSearch)) {
        tasks.push(
          polygonClient
            .getUniverseTickerByTicker(input.normalizedSearch, budgetSignal.signal)
            .then((ticker) => ({
              count: ticker ? 1 : 0,
              results: ticker ? [ticker] : [],
            })),
        );
      }

      for (const cusip of deriveCusipCandidates(input.normalizedSearch)) {
        for (const market of polygonMarkets.filter((candidate) =>
          candidate === "stocks" || candidate === "etf" || candidate === "otc",
        )) {
          tasks.push(
            polygonClient.searchUniverseTickers({
              market,
              markets: [market],
              cusip,
              active: input.searchInput.active,
              limit: input.searchLimit,
              signal: budgetSignal.signal,
            }),
          );
        }
      }

      for (const market of polygonMarkets) {
        tasks.push(
          polygonClient.searchUniverseTickers({
            search: input.normalizedSearch,
            market,
            markets: [market],
            type: input.searchInput.type,
            active: input.searchInput.active,
            limit: input.searchLimit,
            signal: budgetSignal.signal,
          }),
        );
      }

      const settled = await Promise.allSettled(tasks);
      for (const result of settled) {
        if (result.status === "fulfilled") {
          providerResults.push(...result.value.results);
        }
      }

      const response = finalizeUniverseSearchResponse({
        providerResults,
        requestedMarketSet: input.requestedMarketSet,
        normalizedSearch: input.normalizedSearch,
        resultLimit: input.resultLimit,
      });
      if (hasIbkrTradableResult(response)) {
        writeUniverseSearchCache(input.cacheKey, response);
      }
    } catch (error) {
      logger.debug(
        { err: error, search: input.normalizedSearch },
        "ticker search background enrichment failed",
      );
    } finally {
      budgetSignal.dispose();
      universeSearchBackgroundInFlight.delete(input.cacheKey);
    }
  })();
}

export async function searchUniverseTickers(
  input: SearchUniverseTickersInput,
  options: SearchUniverseTickersOptions = {},
) {
  const normalizedSearch = input.search?.trim() ?? "";
  if (!normalizedSearch) return { count: 0, results: [] };

  const resultLimit = Math.max(1, Math.min(input.limit ?? 12, 50));
  const requestedMarkets = resolveRequestedUniverseMarkets(input);
  const requestedMarketSet = new Set(requestedMarkets);
  const cacheKey = getUniverseSearchCacheKey(input, requestedMarkets, resultLimit);
  const cached = readUniverseSearchCache(cacheKey);
  if (cached) return cached;

  let flight = universeSearchInFlight.get(cacheKey);
  if (!flight) {
    const controller = new AbortController();
    const interactiveBudget = createBudgetSignal(
      controller.signal,
      UNIVERSE_SEARCH_INTERACTIVE_BUDGET_MS,
    );
    flight = {
      controller,
      consumers: 0,
      settled: false,
      promise: runInteractiveUniverseSearch({
        searchInput: input,
        normalizedSearch,
        requestedMarkets,
        requestedMarketSet,
        resultLimit,
        cacheKey,
        signal: interactiveBudget.signal,
      }).finally(() => {
        interactiveBudget.dispose();
        const current = universeSearchInFlight.get(cacheKey);
        if (current) current.settled = true;
        universeSearchInFlight.delete(cacheKey);
      }),
    };
    universeSearchInFlight.set(cacheKey, flight);
  }

  flight.consumers += 1;
  try {
    return await awaitWithAbort(flight.promise, options.signal);
  } finally {
    flight.consumers -= 1;
    if (flight.consumers <= 0 && !flight.settled) {
      flight.controller.abort();
    }
  }
}

type GetBarsInput = {
  symbol: string;
  timeframe: Parameters<PolygonMarketDataClient["getBars"]>[0]["timeframe"];
  limit?: number;
  from?: Date;
  to?: Date;
  assetClass?: "equity" | "option";
  market?: UniverseMarket;
  providerContractId?: string | null;
  outsideRth?: boolean;
  source?: "trades" | "midpoint" | "bid_ask";
  allowHistoricalSynthesis?: boolean;
};

type GetBarsResult = Awaited<ReturnType<typeof getBarsImpl>>;

const BAR_LIMIT_CAPS_BY_TIMEFRAME: Partial<Record<GetBarsInput["timeframe"], number>> = {
  "1m": 20_000,
  "5m": 20_000,
  "15m": 15_000,
  "1h": 10_000,
  "1d": 5_000,
};
const OPTION_BAR_LIMIT_CAPS_BY_TIMEFRAME: Partial<Record<GetBarsInput["timeframe"], number>> = {
  "1m": 5_000,
  "5m": 5_000,
  "15m": 5_000,
  "1h": 5_000,
  "1d": 1_000,
};
const DEFAULT_BARS_LIMIT = 200;
const BROKER_RECENT_HISTORY_MS = 24 * 60 * 60 * 1_000;
const BROKER_HISTORY_STEP_MS: Partial<Record<GetBarsInput["timeframe"], number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function shouldLimitBrokerHistoryToRecent(input: GetBarsInput): boolean {
  return input.assetClass !== "option" && input.market !== "futures";
}

function sanitizeBarsLimit(input: GetBarsInput): number {
  const rawLimit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.floor(input.limit)
      : DEFAULT_BARS_LIMIT;
  const normalizedLimit = Math.max(1, rawLimit);
  const caps =
    input.assetClass === "option"
      ? OPTION_BAR_LIMIT_CAPS_BY_TIMEFRAME
      : BAR_LIMIT_CAPS_BY_TIMEFRAME;
  const cap = caps[input.timeframe] ?? DEFAULT_BARS_LIMIT;

  return Math.min(normalizedLimit, cap);
}

function sanitizeBarsInput(input: GetBarsInput): GetBarsInput {
  return {
    ...input,
    limit: sanitizeBarsLimit(input),
  };
}

function buildRecentBrokerHistoryInput(
  input: GetBarsInput,
  now: Date,
): GetBarsInput | null {
  if (!shouldLimitBrokerHistoryToRecent(input)) {
    return input;
  }

  const stepMs = BROKER_HISTORY_STEP_MS[input.timeframe];
  if (!stepMs) {
    return input;
  }

  const requestedTo = input.to ?? now;
  const brokerTo = new Date(Math.min(requestedTo.getTime(), now.getTime()));
  const recentBoundaryMs = now.getTime() - BROKER_RECENT_HISTORY_MS;
  if (brokerTo.getTime() < recentBoundaryMs) {
    return null;
  }

  const explicitFromMs = input.from?.getTime();
  const recentFromMs = Math.max(explicitFromMs ?? recentBoundaryMs, recentBoundaryMs);
  const recentFrom = new Date(Math.min(recentFromMs, brokerTo.getTime()));
  if (recentFrom.getTime() > brokerTo.getTime()) {
    return null;
  }

  const expectedRecentBars = Math.max(
    1,
    Math.ceil((brokerTo.getTime() - recentFrom.getTime()) / stepMs) + 1,
  );

  return {
    ...input,
    from: recentFrom,
    to: brokerTo,
    limit: Math.min(input.limit ?? expectedRecentBars, expectedRecentBars),
  };
}

// Coalesce identical /api/bars requests so multiple chart panels
// (or refetches racing each other) share a single upstream IBKR/Polygon
// fetch. The bridge can hold an upstream history slot for 7-15s, so even
// a small TTL of a few seconds dramatically reduces request volume.
const BARS_CACHE_TTL_MS = 5_000;
const BARS_CACHE_MAX_ENTRIES = 256;
const barsCache = new Map<
  string,
  { value: GetBarsResult; expiresAt: number }
>();
const barsInFlight = new Map<string, Promise<GetBarsResult>>();

function pruneBarsCache(now: number): void {
  for (const [key, entry] of barsCache) {
    if (entry.expiresAt <= now) {
      barsCache.delete(key);
    }
  }
  if (barsCache.size <= BARS_CACHE_MAX_ENTRIES) {
    return;
  }
  // Map preserves insertion order, so dropping the oldest entries first
  // gives us a simple FIFO bound to keep memory in check on long runs
  // with many unique symbol/timeframe combinations.
  const overflow = barsCache.size - BARS_CACHE_MAX_ENTRIES;
  let removed = 0;
  for (const key of barsCache.keys()) {
    if (removed >= overflow) break;
    barsCache.delete(key);
    removed += 1;
  }
}

function buildBarsCacheKey(input: GetBarsInput): string {
  return JSON.stringify({
    symbol: normalizeSymbol(input.symbol),
    timeframe: input.timeframe,
    limit: input.limit ?? null,
    from: input.from ? input.from.getTime() : null,
    to: input.to ? input.to.getTime() : null,
    assetClass: input.assetClass ?? null,
    market: input.market ?? null,
    providerContractId: input.providerContractId ?? null,
    outsideRth: input.outsideRth ?? null,
    source: input.source ?? null,
    allowHistoricalSynthesis: input.allowHistoricalSynthesis ?? null,
  });
}

export async function getBars(input: GetBarsInput): Promise<GetBarsResult> {
  const sanitizedInput = sanitizeBarsInput(input);
  const key = buildBarsCacheKey(sanitizedInput);
  const now = Date.now();

  const cached = barsCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached) {
    barsCache.delete(key);
  }

  const inFlight = barsInFlight.get(key);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const value = await getBarsImpl(sanitizedInput);
      const settledAt = Date.now();
      barsCache.set(key, {
        value,
        expiresAt: settledAt + BARS_CACHE_TTL_MS,
      });
      pruneBarsCache(settledAt);
      return value;
    } finally {
      barsInFlight.delete(key);
    }
  })();

  barsInFlight.set(key, promise);
  return promise;
}

async function getBarsImpl(input: GetBarsInput) {
  const bridgeClient = getIbkrClient();
  const bridgeHealth = await bridgeClient.getHealth().catch(() => null);
  const polygonConfig = getPolygonRuntimeConfig();
  const polygonClient = polygonConfig ? getPolygonClient() : null;
  const polygonBarsDelayed = polygonConfig?.baseUrl.includes("massive.com") ?? false;
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
      const brokerHistoryInput = buildRecentBrokerHistoryInput(
        input,
        new Date(),
      );
      if (brokerHistoryInput) {
        ibkrBars = await bridgeClient.getHistoricalBars({
          symbol: brokerHistoryInput.symbol,
          timeframe: brokerHistoryInput.timeframe as "1m" | "5m" | "15m" | "1h" | "1d",
          limit: brokerHistoryInput.limit,
          from: brokerHistoryInput.from,
          to: brokerHistoryInput.to,
          assetClass: brokerHistoryInput.assetClass,
          providerContractId: brokerHistoryInput.providerContractId,
          outsideRth,
          source: brokerHistoryInput.source,
        });
      }
    } catch (error) {
      ibkrBars = [];
    }
  }
  const desiredBars = Math.max(input.limit ?? ibkrBars.length ?? 0, 1);
  const allowHistoricalSynthesis = input.allowHistoricalSynthesis !== false;
  const needsGapFill =
    allowHistoricalSynthesis &&
    input.assetClass !== "option" &&
    input.market !== "futures" &&
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
        transport: "client_portal" | "tws" | "ibx";
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
        delayed: polygonBarsDelayed,
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

type IbkrOptionChainInput = {
  underlying: string;
  expirationDate?: Date;
  contractType?: "call" | "put";
  maxExpirations?: number;
  strikesAroundMoney?: number;
};
type IbkrOptionChainContracts = Awaited<ReturnType<IbkrBridgeClient["getOptionChain"]>>;

const OPTION_CHAIN_CACHE_TTL_MS = 15_000;
const OPTION_CHAIN_CACHE_MAX_ENTRIES = 128;
const optionChainCache = new Map<
  string,
  { value: IbkrOptionChainContracts; expiresAt: number }
>();
const optionChainInFlight = new Map<string, Promise<IbkrOptionChainContracts>>();

function pruneOptionChainCache(now: number): void {
  for (const [key, entry] of optionChainCache) {
    if (entry.expiresAt <= now) {
      optionChainCache.delete(key);
    }
  }

  if (optionChainCache.size <= OPTION_CHAIN_CACHE_MAX_ENTRIES) {
    return;
  }

  const overflow = optionChainCache.size - OPTION_CHAIN_CACHE_MAX_ENTRIES;
  let removed = 0;
  for (const key of optionChainCache.keys()) {
    if (removed >= overflow) break;
    optionChainCache.delete(key);
    removed += 1;
  }
}

function buildOptionChainCacheKey(input: IbkrOptionChainInput): string {
  return JSON.stringify({
    underlying: normalizeSymbol(input.underlying),
    expirationDate: input.expirationDate
      ? input.expirationDate.toISOString().slice(0, 10)
      : null,
    contractType: input.contractType ?? null,
    maxExpirations: input.maxExpirations ?? null,
    strikesAroundMoney: input.strikesAroundMoney ?? null,
  });
}

async function getCachedIbkrOptionChain(
  input: IbkrOptionChainInput,
): Promise<IbkrOptionChainContracts> {
  const key = buildOptionChainCacheKey(input);
  const now = Date.now();
  const cached = optionChainCache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached) {
    optionChainCache.delete(key);
  }

  const inFlight = optionChainInFlight.get(key);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    try {
      const value = await getIbkrClient().getOptionChain(input);
      const settledAt = Date.now();
      optionChainCache.set(key, {
        value,
        expiresAt: settledAt + OPTION_CHAIN_CACHE_TTL_MS,
      });
      pruneOptionChainCache(settledAt);
      return value;
    } finally {
      optionChainInFlight.delete(key);
    }
  })();

  optionChainInFlight.set(key, promise);
  return promise;
}

export async function getOptionChain(input: {
  underlying: string;
  expirationDate?: Date;
  contractType?: "call" | "put";
}) {
  const ibkrContracts = await getCachedIbkrOptionChain({
    ...input,
    maxExpirations: 1,
    strikesAroundMoney: 6,
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
  unusualThreshold?: number;
}): Promise<FlowEventsResult> {
  const underlying = normalizeSymbol(input.underlying ?? "");
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const unusualThreshold =
    Number.isFinite(input.unusualThreshold) && (input.unusualThreshold ?? 0) > 0
      ? Math.min(100, Math.max(0.1, input.unusualThreshold as number))
      : undefined;

  if (!underlying) {
    return {
      events: [],
      source: flowSource({
        provider: "none",
        status: "empty",
        unusualThreshold: unusualThreshold ?? 1,
      }),
    };
  }

  const cacheKey = `${underlying}:${limit}:${unusualThreshold ?? "default"}`;
  const cached = flowEventsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  if (cached) {
    flowEventsCache.delete(cacheKey);
  }

  const inFlight = flowEventsInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = listFlowEventsUncached({
    underlying,
    limit,
    unusualThreshold,
  }).then((value) => {
    flowEventsCache.set(cacheKey, {
      value,
      expiresAt: Date.now() + FLOW_EVENTS_CACHE_TTL_MS,
    });
    return value;
  });

  flowEventsInFlight.set(cacheKey, request);

  try {
    return await request;
  } finally {
    flowEventsInFlight.delete(cacheKey);
  }
}

async function listFlowEventsUncached(input: {
  underlying: string;
  limit: number;
  unusualThreshold?: number;
}): Promise<FlowEventsResult> {
  // Derive IBKR flow from option-chain snapshots. These are not consolidated
  // time-and-sales events, so callers receive `basis: "snapshot"` and the UI
  // labels them as active/unusual contracts rather than verified sweeps.
  let contracts: IbkrOptionChainContracts = [];
  const attemptedProviders: FlowDataProvider[] = ["ibkr"];
  let ibkrError: string | null = null;
  let polygonError: string | null = null;

  try {
    // Keep coverage tight — IBKR snapshots are rate-limited and the flow
    // panel renders the highest-premium contracts first, so a moderate
    // window around the money is plenty.
    contracts = await getCachedIbkrOptionChain({
      underlying: input.underlying,
      maxExpirations: 1,
      strikesAroundMoney: 6,
    });
  } catch (error) {
    ibkrError = getErrorMessage(error);
    contracts = [];
  }

  // IBKR snapshots now include OPRA volume (field 7762) and option open
  // interest (field 7638), so flow events can rank by real traded premium.
  // Require both a marked contract and non-zero day volume to filter out the
  // inactive long tail.
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
        input.unusualThreshold,
      );
      // Rank by mark-based premium (mark × volume × multiplier) so the
      // ordering is stable even when `last` is stale or zero. The display
      // `price` still prefers the last field when available.
      return {
        id: `${c.contract.ticker}-${c.updatedAt.getTime()}`,
        underlying: normalizeSymbol(c.contract.underlying),
        provider: "ibkr" as const,
        basis: "snapshot" as const,
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
    // Surface unusual contracts (volume > open interest) above routine flow,
    // then fall back to premium so the highest-conviction events win ties.
    .sort((a, b) => {
      if (a.isUnusual !== b.isUnusual) return a.isUnusual ? -1 : 1;
      if (a.isUnusual && b.isUnusual && a.unusualScore !== b.unusualScore) {
        return b.unusualScore - a.unusualScore;
      }
      return b.premium - a.premium;
    })
    .slice(0, input.limit);

  if (events.length > 0) {
    return {
      events,
      source: flowSource({
        provider: "ibkr",
        status: "live",
        attemptedProviders,
        unusualThreshold: input.unusualThreshold ?? 1,
      }),
    };
  }

  if (getPolygonRuntimeConfig()) {
    attemptedProviders.push("polygon");
    try {
      const polygonEvents = await getPolygonClient().getDerivedFlowEvents({
        underlying: input.underlying,
        limit: input.limit,
        unusualThreshold: input.unusualThreshold,
      });

      if (polygonEvents.length > 0) {
        return {
          events: polygonEvents,
          source: flowSource({
            provider: "polygon",
            status: "fallback",
            fallbackUsed: true,
            attemptedProviders,
            errorMessage: ibkrError,
            unusualThreshold: input.unusualThreshold ?? 1,
          }),
        };
      }
    } catch (error) {
      polygonError = getErrorMessage(error);
    }
  }

  const errorMessage = polygonError ?? ibkrError;
  return {
    events: [],
    source: flowSource({
      provider: "none",
      status: errorMessage ? "error" : "empty",
      fallbackUsed: attemptedProviders.includes("polygon"),
      attemptedProviders,
      errorMessage,
      unusualThreshold: input.unusualThreshold ?? 1,
    }),
  };
}
