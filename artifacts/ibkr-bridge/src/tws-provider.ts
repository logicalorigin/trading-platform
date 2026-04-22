import { randomUUID } from "node:crypto";
import {
  BarSizeSetting,
  ConnectionState,
  IBApiNext,
  IBApiTickType as TickType,
  type Contract,
  type ContractDetails,
  MarketDataType as TwsMarketDataType,
  Option,
  OptionType,
  OrderAction,
  OrderType as TwsOrderType,
  SecType,
  Stock,
  TimeInForce,
  WhatToShow,
  type OpenOrder,
  type Order,
  type OrderBook,
  type MarketDataTicks,
} from "@stoqey/ib";
import { HttpError } from "../../api-server/src/lib/errors";
import {
  asNumber,
  asRecord,
  asString,
  compact,
  firstDefined,
  normalizeSymbol,
  toDate,
} from "../../api-server/src/lib/values";
import type {
  IbkrTwsRuntimeConfig,
  RuntimeMode,
} from "../../api-server/src/lib/runtime";
import type {
  BrokerAccountSnapshot,
  BrokerBarSnapshot,
  BrokerExecutionSnapshot,
  BrokerMarketDepthLevel,
  BrokerMarketDepthSnapshot,
  BrokerOrderSnapshot,
  BrokerPositionSnapshot,
  CancelOrderSnapshot,
  HistoryBarTimeframe,
  HistoryDataSource,
  OptionChainContract,
  OrderPreviewSnapshot,
  PlaceOrderInput,
  QuoteSnapshot,
  ReplaceOrderSnapshot,
  ResolvedIbkrContract,
  SessionStatusSnapshot,
} from "../../api-server/src/providers/ibkr/client";
import type { BridgeHealth, IbkrBridgeProvider } from "./provider";

const HISTORY_BAR_SIZE: Record<HistoryBarTimeframe, BarSizeSetting> = {
  "1m": BarSizeSetting.MINUTES_ONE,
  "5m": BarSizeSetting.MINUTES_FIVE,
  "15m": BarSizeSetting.MINUTES_FIFTEEN,
  "1h": BarSizeSetting.HOURS_ONE,
  "1d": BarSizeSetting.DAYS_ONE,
};

const HISTORY_STEP_MS: Record<HistoryBarTimeframe, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};

const HISTORY_SOURCE_TO_TWS: Record<
  HistoryDataSource,
  (typeof WhatToShow)[keyof typeof WhatToShow]
> = {
  trades: WhatToShow.TRADES,
  midpoint: WhatToShow.MIDPOINT,
  bid_ask: WhatToShow.BID_ASK,
};

const ACCOUNT_SUMMARY_TAGS = [
  "NetLiquidation",
  "BuyingPower",
  "TotalCashValue",
  "SettledCash",
  "CashBalance",
] as const;

const ACCOUNT_SUMMARY_REQUEST = ACCOUNT_SUMMARY_TAGS.join(",");
const CONTRACT_CACHE_TTL_MS = 5 * 60_000;

type SummarySnapshot = {
  buyingPower: number;
  cash: number;
  currency: string;
  netLiquidation: number;
  updatedAt: Date;
};

type CachedStockContract = {
  resolved: ResolvedIbkrContract;
  contract: Contract;
  cachedAt: number;
};

type CachedOptionContract = {
  contract: Contract;
  optionContract: NonNullable<BrokerPositionSnapshot["optionContract"]>;
  cachedAt: number;
};

type QuoteSubscription = {
  contract: Contract;
  stop(): void;
};

type DepthSubscription = {
  contract: Contract;
  stop(): void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDepthKey(
  accountId: string,
  providerContractId: string,
  exchange: string,
): string {
  return `${accountId}:${providerContractId}:${exchange}`;
}

function formatOptionExpiry(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatExecutionFilterTime(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  const second = String(value.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day} ${hour}:${minute}:${second}`;
}

function formatHistoryEndDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  const second = String(value.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day} ${hour}:${minute}:${second} UTC`;
}

function buildHistoryDuration(timeframe: HistoryBarTimeframe, barCount: number): string {
  const desiredBars = Math.max(1, Math.min(1_000, Math.ceil(barCount)));
  const totalMs = desiredBars * HISTORY_STEP_MS[timeframe];
  const secondMs = 1_000;
  const dayMs = 86_400_000;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;
  const yearMs = 365 * dayMs;

  const totalSeconds = Math.ceil(totalMs / secondMs);
  if (totalSeconds <= 86_400) {
    return `${Math.max(1, totalSeconds)} S`;
  }

  const totalDays = Math.ceil(totalMs / dayMs);
  if (totalDays <= 365) {
    return `${Math.max(1, totalDays)} D`;
  }

  const totalWeeks = Math.ceil(totalMs / weekMs);
  if (totalWeeks <= 104) {
    return `${Math.max(1, totalWeeks)} W`;
  }

  const totalMonths = Math.ceil(totalMs / monthMs);
  if (totalMonths <= 60) {
    return `${Math.max(1, totalMonths)} M`;
  }

  return `${Math.max(1, Math.ceil(totalMs / yearMs))} Y`;
}

function resolveRequestedHistoryBars(input: {
  timeframe: HistoryBarTimeframe;
  limit?: number;
  from?: Date;
  to?: Date;
}): number {
  const requestedLimit = Math.max(1, input.limit ?? 200);
  if (!input.from || !input.to) {
    return requestedLimit;
  }

  const durationMs = Math.max(0, input.to.getTime() - input.from.getTime());
  return Math.max(
    requestedLimit,
    Math.ceil(durationMs / HISTORY_STEP_MS[input.timeframe]) + 1,
  );
}

function parseHistoricalBarTime(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const numericDate = toDate(value);
  if (numericDate) {
    return numericDate;
  }

  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/,
  );
  if (!match) {
    return null;
  }

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function parseExecutionTime(value: string | undefined): Date {
  const direct = toDate(value);
  if (direct) {
    return direct;
  }

  const text = asString(value);
  if (!text) {
    return new Date();
  }

  const normalized = text.replace(/\s+/, "-");
  const match = normalized.match(
    /^(\d{4})(\d{2})(\d{2})-(\d{2}):(\d{2}):(\d{2})$/,
  );

  if (!match) {
    return new Date();
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ),
  );
}

function pickSummaryValue(
  summary:
    | ReadonlyMap<string, ReadonlyMap<string, { value: string; ingressTm: number }>>
    | undefined,
  tags: readonly string[],
): { value: number | null; currency: string | null } {
  if (!summary) {
    return {
      value: null,
      currency: null,
    };
  }

  for (const tag of tags) {
    const values = summary.get(tag);
    if (!values) {
      continue;
    }

    for (const [currency, entry] of values.entries()) {
      const numeric = asNumber(entry.value);
      if (numeric !== null) {
        return {
          value: numeric,
          currency,
        };
      }
    }
  }

  return {
    value: null,
    currency: null,
  };
}

function normalizeAssetClassFromSecType(
  value: string | undefined,
): "equity" | "option" | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "OPT") {
    return "option";
  }

  if (normalized === "STK" || normalized === "ETF") {
    return "equity";
  }

  return null;
}

function normalizeOptionRight(
  value: string | undefined,
): "call" | "put" | null {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "C" || normalized === "CALL") {
    return "call";
  }

  if (normalized === "P" || normalized === "PUT") {
    return "put";
  }

  return null;
}

function normalizeOrderSide(value: string | undefined): "buy" | "sell" {
  return value?.trim().toUpperCase() === "SELL" ? "sell" : "buy";
}

function normalizeOrderType(
  value: string | undefined,
): "market" | "limit" | "stop" | "stop_limit" {
  const normalized = value?.trim().toUpperCase() ?? "MKT";
  if (normalized === "LMT" || normalized === "LIMIT") {
    return "limit";
  }

  if (normalized === "STP" || normalized === "STOP") {
    return "stop";
  }

  if (normalized === "STP LMT" || normalized === "STOP_LIMIT") {
    return "stop_limit";
  }

  return "market";
}

function normalizeTimeInForce(
  value: string | undefined,
): "day" | "gtc" | "ioc" | "fok" {
  const normalized = value?.trim().toUpperCase() ?? "DAY";
  if (normalized === "GTC") {
    return "gtc";
  }

  if (normalized === "IOC") {
    return "ioc";
  }

  if (normalized === "FOK") {
    return "fok";
  }

  return "day";
}

function normalizeOrderStatus(
  value: string | undefined,
  filledQuantity: number,
  remainingQuantity: number,
):
  | "pending_submit"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired" {
  const normalized = (value ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

  if (filledQuantity > 0 && remainingQuantity > 0) {
    return "partially_filled";
  }

  if (normalized.includes("pendingsubmit") || normalized.includes("apipending")) {
    return "pending_submit";
  }

  if (normalized.includes("presubmitted") || normalized.includes("submitted")) {
    return "submitted";
  }

  if (normalized.includes("accepted") || normalized.includes("working")) {
    return "accepted";
  }

  if (normalized.includes("filled")) {
    return "filled";
  }

  if (normalized.includes("cancel")) {
    return "canceled";
  }

  if (normalized.includes("expire")) {
    return "expired";
  }

  if (normalized.includes("inactive") || normalized.includes("reject")) {
    return "rejected";
  }

  return "submitted";
}

function getTickValue(
  ticks: MarketDataTicks,
  ...candidates: TickType[]
): number | null {
  for (const candidate of candidates) {
    const tick = ticks.get(candidate);
    const value = tick?.value;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function toOptionContractMeta(
  contract: Contract,
): NonNullable<BrokerPositionSnapshot["optionContract"]> | null {
  const underlying = normalizeSymbol(asString(contract.symbol) ?? "");
  const expirationDate = toDate(
    contract.lastTradeDateOrContractMonth ?? contract.lastTradeDate,
  );
  const strike = asNumber(contract.strike);
  const right = normalizeOptionRight(asString(contract.right) ?? undefined);
  const multiplier = asNumber(contract.multiplier) ?? 100;

  if (!underlying || !expirationDate || strike === null || !right) {
    return null;
  }

  return {
    ticker:
      asString(contract.localSymbol)?.replace(/\s+/g, "") ??
      `${underlying}${formatOptionExpiry(expirationDate)}${right === "call" ? "C" : "P"}${String(strike).replace(".", "")}`,
    underlying,
    expirationDate,
    strike,
    right,
    multiplier,
    sharesPerContract: multiplier,
    providerContractId: asString(contract.conId),
  };
}

function toQuoteSnapshot(
  symbol: string,
  providerContractId: string | null,
  ticks: MarketDataTicks,
): QuoteSnapshot {
  const price =
    firstDefined(
      getTickValue(ticks, TickType.LAST, TickType.DELAYED_LAST),
      getTickValue(ticks, TickType.BID, TickType.DELAYED_BID),
      getTickValue(ticks, TickType.ASK, TickType.DELAYED_ASK),
    ) ?? 0;
  const bid =
    firstDefined(getTickValue(ticks, TickType.BID, TickType.DELAYED_BID), price) ?? 0;
  const ask =
    firstDefined(getTickValue(ticks, TickType.ASK, TickType.DELAYED_ASK), bid) ?? bid;
  const bidSize =
    firstDefined(
      getTickValue(ticks, TickType.BID_SIZE, TickType.DELAYED_BID_SIZE),
      0,
    ) ?? 0;
  const askSize =
    firstDefined(
      getTickValue(ticks, TickType.ASK_SIZE, TickType.DELAYED_ASK_SIZE),
      0,
    ) ?? 0;
  const prevClose = getTickValue(ticks, TickType.CLOSE, TickType.DELAYED_CLOSE);
  const open = getTickValue(ticks, TickType.OPEN, TickType.DELAYED_OPEN);
  const high = getTickValue(ticks, TickType.HIGH, TickType.DELAYED_HIGH);
  const low = getTickValue(ticks, TickType.LOW, TickType.DELAYED_LOW);
  const volume = getTickValue(ticks, TickType.VOLUME, TickType.DELAYED_VOLUME);
  const updatedAt = new Date();
  const change = prevClose !== null ? price - prevClose : 0;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;

  return {
    symbol,
    price,
    bid,
    ask,
    bidSize,
    askSize,
    change,
    changePercent,
    open,
    high,
    low,
    prevClose,
    volume,
    updatedAt,
    providerContractId,
  };
}

function toDepthSnapshot(input: {
  accountId: string | null;
  assetClass: "equity" | "option";
  exchange: string | null;
  orderBook: OrderBook;
  providerContractId: string | null;
  symbol: string;
}): BrokerMarketDepthSnapshot {
  const rows = new Map<number, BrokerMarketDepthLevel>();

  input.orderBook.bids.forEach((bidRow, row) => {
    rows.set(row, {
      row,
      price: bidRow.price,
      bidSize: bidRow.size,
      askSize: null,
      totalSize: bidRow.size,
      isLastTrade: false,
    });
  });

  input.orderBook.asks.forEach((askRow, row) => {
    const existing = rows.get(row);
    if (existing) {
      existing.askSize = askRow.size;
      existing.totalSize = (existing.bidSize ?? 0) + askRow.size;
      existing.price = askRow.price;
      return;
    }

    rows.set(row, {
      row,
      price: askRow.price,
      bidSize: null,
      askSize: askRow.size,
      totalSize: askRow.size,
      isLastTrade: false,
    });
  });

  return {
    accountId: input.accountId,
    symbol: input.symbol,
    assetClass: input.assetClass,
    providerContractId: input.providerContractId,
    exchange: input.exchange,
    updatedAt: new Date(),
    levels: Array.from(rows.values()).sort((left, right) => left.row - right.row),
  };
}

export class TwsIbkrBridgeProvider implements IbkrBridgeProvider {
  private readonly api: IBApiNext;
  private readonly tickleIntervalMs = Number(
    process.env["IBKR_BRIDGE_TICKLE_INTERVAL_MS"] ?? "55000",
  );
  private readonly stockContracts = new Map<string, CachedStockContract>();
  private readonly optionContracts = new Map<string, CachedOptionContract>();
  private readonly quoteSubscriptions = new Map<string, QuoteSubscription>();
  private readonly quotesByProviderContractId = new Map<string, QuoteSnapshot>();
  private readonly depthSubscriptions = new Map<string, DepthSubscription>();
  private readonly depthByKey = new Map<string, BrokerMarketDepthSnapshot>();
  private readonly accountSummaries = new Map<string, SummarySnapshot>();
  private readonly positionsByAccount = new Map<string, BrokerPositionSnapshot[]>();
  private readonly orderTimestamps = new Map<
    string,
    { placedAt: Date; updatedAt: Date }
  >();
  private readonly liveOrdersById = new Map<string, BrokerOrderSnapshot>();
  private connectPromise: Promise<void> | null = null;
  private tickleTimer: NodeJS.Timeout | null = null;
  private connectionState = ConnectionState.Disconnected;
  private latestSession: SessionStatusSnapshot | null = null;
  private lastTickleAt: Date | null = null;
  private lastError: string | null = null;
  private managedAccounts: string[] = [];
  private baseSubscriptionsStarted = false;
  private accountSummaryInitialized = false;
  private positionsInitialized = false;

  constructor(private readonly config: IbkrTwsRuntimeConfig) {
    this.api = new IBApiNext({
      host: this.config.host,
      port: this.config.port,
      reconnectInterval: 3_000,
      connectionWatchdogInterval: 30,
      maxReqPerSec: 35,
    });

    this.api.connectionState.subscribe((state) => {
      this.connectionState = state;

      if (state === ConnectionState.Connected) {
        this.lastError = null;
        this.api.setMarketDataType(this.config.marketDataType as TwsMarketDataType);
        void this.refreshManagedAccounts().catch(() => {});
        void this.ensureBaseSubscriptions().catch(() => {});
        return;
      }

      if (state === ConnectionState.Disconnected) {
        this.latestSession = this.buildSessionSnapshot();
      }
    });

    this.api.error.subscribe((error) => {
      this.recordError(error);
    });

    this.ensureTickleLoop();
  }

  private recordError(error: unknown) {
    if (error && typeof error === "object" && "message" in error) {
      const message = asString((error as { message?: unknown }).message);
      this.lastError = message ?? "Unknown IBKR TWS bridge error.";
      return;
    }

    this.lastError = "Unknown IBKR TWS bridge error.";
  }

  private ensureTickleLoop() {
    if (this.tickleTimer) {
      return;
    }

    this.tickleTimer = setInterval(() => {
      void this.tickle().catch(() => {});
    }, Math.max(10_000, this.tickleIntervalMs));
    this.tickleTimer.unref?.();
  }

  private buildSessionSnapshot(): SessionStatusSnapshot {
    const connected = this.connectionState === ConnectionState.Connected;
    const selectedAccountId =
      this.config.defaultAccountId ??
      this.managedAccounts[0] ??
      null;

    return {
      authenticated: connected && this.managedAccounts.length > 0,
      connected,
      competing: Boolean(this.lastError?.toLowerCase().includes("client id")),
      selectedAccountId,
      accounts: this.managedAccounts,
      updatedAt: new Date(),
      raw: {
        transport: "tws",
        host: this.config.host,
        port: this.config.port,
        clientId: this.config.clientId,
        mode: this.config.mode,
        marketDataType: this.config.marketDataType,
      },
    };
  }

  private async waitForCondition(
    predicate: () => boolean,
    timeoutMs = 1_500,
    intervalMs = 50,
  ) {
    const startedAt = Date.now();

    while (!predicate()) {
      if (Date.now() - startedAt >= timeoutMs) {
        break;
      }

      await sleep(intervalMs);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.connectionState === ConnectionState.Connected) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      this.api.connect(this.config.clientId);
      await this.waitForCondition(
        () => this.connectionState === ConnectionState.Connected,
        8_000,
      );

      if (this.connectionState !== ConnectionState.Connected) {
        throw new HttpError(502, "Unable to connect to IB Gateway/TWS.", {
          code: "ibkr_tws_connect_failed",
          detail:
            this.lastError ??
            `No socket connection was established to ${this.config.host}:${this.config.port}.`,
        });
      }

      this.api.setMarketDataType(this.config.marketDataType as TwsMarketDataType);
      await this.loadManagedAccounts();
      await this.ensureBaseSubscriptions();
    })();

    try {
      await this.connectPromise;
    } catch (error) {
      this.recordError(error);
      throw error;
    } finally {
      this.connectPromise = null;
    }
  }

  private async loadManagedAccounts(): Promise<SessionStatusSnapshot> {
    this.managedAccounts = (await this.api.getManagedAccounts()).filter(Boolean);
    this.latestSession = this.buildSessionSnapshot();
    return this.latestSession;
  }

  private async refreshManagedAccounts(): Promise<SessionStatusSnapshot> {
    await this.ensureConnected();
    return this.loadManagedAccounts();
  }

  private async ensureBaseSubscriptions() {
    if (this.baseSubscriptionsStarted) {
      return;
    }

    this.baseSubscriptionsStarted = true;

    this.api.getAccountSummary("All", ACCOUNT_SUMMARY_REQUEST).subscribe({
      next: (update) => {
        update.all.forEach((summary, accountId) => {
          const buyingPower = pickSummaryValue(summary, ["BuyingPower"]);
          const cash = pickSummaryValue(summary, [
            "TotalCashValue",
            "SettledCash",
            "CashBalance",
          ]);
          const netLiquidation = pickSummaryValue(summary, ["NetLiquidation"]);

          this.accountSummaries.set(accountId, {
            buyingPower: buyingPower.value ?? 0,
            cash: cash.value ?? 0,
            netLiquidation: netLiquidation.value ?? 0,
            currency:
              buyingPower.currency ??
              cash.currency ??
              netLiquidation.currency ??
              "USD",
            updatedAt: new Date(),
          });
        });

        this.accountSummaryInitialized = true;
      },
      error: (error) => {
        this.recordError(error);
      },
    });

    this.api.getPositions().subscribe({
      next: (update) => {
        update.all.forEach((positions, accountId) => {
          this.positionsByAccount.set(
            accountId,
            compact(
              positions.map((position) => this.toBrokerPositionSnapshot(position)),
            ),
          );
        });

        this.positionsInitialized = true;
      },
      error: (error) => {
        this.recordError(error);
      },
    });

    this.api.getOpenOrders().subscribe({
      next: (update) => {
        const snapshots = compact(
          update.all.map((order) => this.toBrokerOrderSnapshot(order)),
        );
        this.liveOrdersById.clear();
        snapshots.forEach((snapshot) => {
          this.liveOrdersById.set(snapshot.id, snapshot);
        });
      },
      error: (error) => {
        this.recordError(error);
      },
    });
  }

  private async requireAccountId(accountId?: string | null): Promise<string> {
    const session = await this.refreshManagedAccounts();
    const resolved =
      accountId ??
      session.selectedAccountId ??
      this.config.defaultAccountId ??
      session.accounts[0] ??
      null;

    if (!resolved) {
      throw new HttpError(400, "No IBKR account is active for the TWS bridge.", {
        code: "ibkr_missing_account_id",
      });
    }

    return resolved;
  }

  private toBrokerPositionSnapshot(
    position: {
      account: string;
      contract: Contract;
      pos: number;
      avgCost?: number;
      marketPrice?: number;
      marketValue?: number;
      unrealizedPNL?: number;
    },
  ): BrokerPositionSnapshot | null {
    const symbol = normalizeSymbol(asString(position.contract.symbol) ?? "");
    const assetClass = normalizeAssetClassFromSecType(
      asString(position.contract.secType) ?? undefined,
    );

    if (!symbol || !assetClass) {
      return null;
    }

    return {
      id: `${position.account}:${asString(position.contract.conId) ?? symbol}`,
      accountId: position.account,
      symbol,
      assetClass,
      quantity: position.pos,
      averagePrice: position.avgCost ?? 0,
      marketPrice: position.marketPrice ?? 0,
      marketValue: position.marketValue ?? 0,
      unrealizedPnl: position.unrealizedPNL ?? 0,
      unrealizedPnlPercent:
        position.avgCost && position.pos
          ? ((position.marketPrice ?? position.avgCost) - position.avgCost) /
              position.avgCost *
              100
          : 0,
      optionContract:
        assetClass === "option"
          ? toOptionContractMeta(position.contract)
          : null,
    };
  }

  private toBrokerOrderSnapshot(order: OpenOrder): BrokerOrderSnapshot | null {
    const accountId = asString(order.order.account) ?? this.config.defaultAccountId;
    const symbol = normalizeSymbol(asString(order.contract.symbol) ?? "");
    const assetClass = normalizeAssetClassFromSecType(
      asString(order.contract.secType) ?? undefined,
    );

    if (!accountId || !symbol || !assetClass) {
      return null;
    }

    const id = String(order.orderId);
    const previous = this.orderTimestamps.get(id);
    const now = new Date();
    const timestamps = {
      placedAt: previous?.placedAt ?? now,
      updatedAt: now,
    };
    this.orderTimestamps.set(id, timestamps);

    const filledQuantity = order.orderStatus?.filled ?? 0;
    const totalQuantity = asNumber(order.order.totalQuantity) ?? 0;
    const remainingQuantity =
      order.orderStatus?.remaining ?? Math.max(0, totalQuantity - filledQuantity);

    return {
      id,
      accountId,
      mode: this.config.mode,
      symbol,
      assetClass,
      side: normalizeOrderSide(asString(order.order.action) ?? undefined),
      type: normalizeOrderType(asString(order.order.orderType) ?? undefined),
      timeInForce: normalizeTimeInForce(asString(order.order.tif) ?? undefined),
      status: normalizeOrderStatus(
        asString(order.orderStatus?.status) ??
          asString(order.orderState.status) ??
          undefined,
        filledQuantity,
        remainingQuantity,
      ),
      quantity: totalQuantity,
      filledQuantity,
      limitPrice: asNumber(order.order.lmtPrice),
      stopPrice: asNumber(order.order.auxPrice),
      placedAt: timestamps.placedAt,
      updatedAt: timestamps.updatedAt,
      optionContract:
        assetClass === "option" ? toOptionContractMeta(order.contract) : null,
    };
  }

  private async resolveStockContract(symbol: string): Promise<CachedStockContract> {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cached = this.stockContracts.get(normalizedSymbol);
    if (cached && Date.now() - cached.cachedAt < CONTRACT_CACHE_TTL_MS) {
      return cached;
    }

    await this.ensureConnected();
    const details = await this.api.getContractDetails(
      new Stock(normalizedSymbol, "SMART", "USD"),
    );

    const match =
      details.find(
        (detail) =>
          normalizeSymbol(asString(detail.contract.symbol) ?? "") === normalizedSymbol &&
          asString(detail.contract.secType)?.toUpperCase() === "STK",
      ) ?? details[0];

    const conid = asNumber(match?.contract.conId);
    if (!match || conid === null) {
      throw new HttpError(
        404,
        `Unable to resolve IB Gateway/TWS contract for ${symbol}.`,
        {
          code: "ibkr_contract_not_found",
        },
      );
    }

    const resolved: CachedStockContract = {
      resolved: {
        conid,
        symbol: normalizedSymbol,
        secType: asString(match.contract.secType) ?? "STK",
        listingExchange:
          asString(match.contract.primaryExch) ??
          asString(match.contract.exchange) ??
          "SMART",
        providerContractId: String(conid),
      },
      contract: match.contract,
      cachedAt: Date.now(),
    };

    this.stockContracts.set(normalizedSymbol, resolved);
    return resolved;
  }

  private async resolveOptionContract(input: {
    underlying: string;
    expirationDate: Date;
    strike: number;
    right: "call" | "put";
    providerContractId?: string | null;
  }): Promise<CachedOptionContract> {
    const cacheKey =
      input.providerContractId?.trim() ||
      `${normalizeSymbol(input.underlying)}:${formatOptionExpiry(input.expirationDate)}:${input.strike}:${input.right}`;
    const cached = this.optionContracts.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < CONTRACT_CACHE_TTL_MS) {
      return cached;
    }

    await this.ensureConnected();

    let details: ContractDetails[] = [];
    if (input.providerContractId && /^\d+$/.test(input.providerContractId)) {
      details = await this.api.getContractDetails({
        conId: Number(input.providerContractId),
        secType: SecType.OPT,
        exchange: "SMART",
      });
    } else {
      details = await this.api.getContractDetails(
        new Option(
          normalizeSymbol(input.underlying),
          formatOptionExpiry(input.expirationDate),
          input.strike,
          input.right === "call" ? OptionType.Call : OptionType.Put,
          "SMART",
          "USD",
        ),
      );
    }

    const match =
      details.find((detail) => {
        const optionMeta = toOptionContractMeta(detail.contract);
        return (
          optionMeta?.underlying === normalizeSymbol(input.underlying) &&
          optionMeta.expirationDate.toISOString().slice(0, 10) ===
            input.expirationDate.toISOString().slice(0, 10) &&
          optionMeta.strike === input.strike &&
          optionMeta.right === input.right
        );
      }) ?? details[0];

    const optionContract = match ? toOptionContractMeta(match.contract) : null;
    if (!match || !optionContract) {
      throw new HttpError(404, "Unable to resolve option contract via TWS.", {
        code: "ibkr_option_contract_not_found",
      });
    }

    const resolved: CachedOptionContract = {
      contract: match.contract,
      optionContract,
      cachedAt: Date.now(),
    };
    this.optionContracts.set(cacheKey, resolved);
    if (optionContract.providerContractId) {
      this.optionContracts.set(optionContract.providerContractId, resolved);
    }
    return resolved;
  }

  private async ensureQuoteSubscription(
    resolved: CachedStockContract,
  ): Promise<string> {
    const providerContractId = resolved.resolved.providerContractId;
    if (this.quoteSubscriptions.has(providerContractId)) {
      return providerContractId;
    }

    const subscription = this.api.getMarketData(
      {
        ...resolved.contract,
        conId: resolved.resolved.conid,
        exchange: "SMART",
      },
      "",
      false,
      false,
    ).subscribe({
      next: (update) => {
        this.quotesByProviderContractId.set(
          providerContractId,
          toQuoteSnapshot(
            resolved.resolved.symbol,
            providerContractId,
            update.all,
          ),
        );
      },
      error: (error) => {
        this.recordError(error);
      },
    });

    this.quoteSubscriptions.set(providerContractId, {
      contract: resolved.contract,
      stop: () => subscription.unsubscribe(),
    });

    return providerContractId;
  }

  private async getContractQuoteSnapshot(input: {
    contract: Contract;
    symbol: string;
    providerContractId: string | null;
  }): Promise<QuoteSnapshot | null> {
    await this.ensureConnected();
    try {
      const marketData = await this.api.getMarketDataSnapshot(
        input.contract,
        "",
        false,
      );
      return toQuoteSnapshot(
        input.symbol,
        input.providerContractId,
        marketData,
      );
    } catch (error) {
      this.recordError(error);
      return null;
    }
  }

  private buildOrderContractPayload(
    contract: Contract,
    order: Order,
  ): Record<string, unknown> {
    return JSON.parse(JSON.stringify({ contract, order })) as Record<string, unknown>;
  }

  private async buildStructuredOrder(
    input: PlaceOrderInput,
  ): Promise<{
    accountId: string;
    contract: Contract;
    optionContract: BrokerPositionSnapshot["optionContract"];
    order: Order;
    resolvedContractId: number;
  }> {
    const accountId = await this.requireAccountId(input.accountId);

    if (input.assetClass === "option") {
      if (!input.optionContract) {
        throw new HttpError(400, "Option order is missing contract metadata.", {
          code: "ibkr_option_order_missing_contract",
        });
      }

      const resolvedOption = await this.resolveOptionContract({
        underlying: input.optionContract.underlying,
        expirationDate: input.optionContract.expirationDate,
        strike: input.optionContract.strike,
        right: input.optionContract.right,
        providerContractId: input.optionContract.providerContractId ?? null,
      });

      return {
        accountId,
        contract: {
          ...resolvedOption.contract,
          conId: Number(resolvedOption.optionContract.providerContractId),
          exchange: "SMART",
        },
        optionContract: resolvedOption.optionContract,
        order: this.toTwsOrder(input, accountId),
        resolvedContractId: Number(
          resolvedOption.optionContract.providerContractId ?? "0",
        ),
      };
    }

    const resolvedStock = await this.resolveStockContract(input.symbol);
    return {
      accountId,
      contract: {
        ...resolvedStock.contract,
        conId: resolvedStock.resolved.conid,
        exchange: "SMART",
      },
      optionContract: null,
      order: this.toTwsOrder(input, accountId),
      resolvedContractId: resolvedStock.resolved.conid,
    };
  }

  private toTwsOrder(input: PlaceOrderInput, accountId: string): Order {
    const order: Order = {
      account: accountId,
      action: input.side === "sell" ? OrderAction.SELL : OrderAction.BUY,
      totalQuantity: input.quantity,
      tif:
        input.timeInForce === "gtc"
          ? TimeInForce.GTC
          : input.timeInForce === "ioc"
            ? TimeInForce.IOC
            : input.timeInForce === "fok"
              ? TimeInForce.FOK
              : TimeInForce.DAY,
      orderType:
        input.type === "limit"
          ? TwsOrderType.LMT
          : input.type === "stop"
            ? TwsOrderType.STP
            : input.type === "stop_limit"
              ? TwsOrderType.STP_LMT
              : TwsOrderType.MKT,
      transmit: true,
    };

    if (input.type === "limit" || input.type === "stop_limit") {
      order.lmtPrice = input.limitPrice ?? undefined;
    }

    if (input.type === "stop" || input.type === "stop_limit") {
      order.auxPrice = input.stopPrice ?? undefined;
    }

    return order;
  }

  private parseStructuredRawOrder(
    order: Record<string, unknown>,
    accountId: string,
  ): { contract: Contract; order: Order } {
    const rawContract = asRecord(order["contract"]);
    const rawOrder = asRecord(order["order"]);

    if (!rawContract || !rawOrder) {
      throw new HttpError(
        400,
        "The TWS bridge expects an order payload with contract and order objects.",
        {
          code: "ibkr_tws_order_payload_invalid",
        },
      );
    }

    return {
      contract: rawContract as Contract,
      order: {
        ...(rawOrder as Order),
        account: accountId,
      },
    };
  }

  private async findOpenOrder(orderId: number): Promise<BrokerOrderSnapshot | null> {
    await this.waitForCondition(
      () => this.liveOrdersById.has(String(orderId)),
      1_000,
      100,
    );

    if (this.liveOrdersById.has(String(orderId))) {
      return this.liveOrdersById.get(String(orderId)) ?? null;
    }

    try {
      const openOrders = await this.api.getAllOpenOrders();
      const match = openOrders.find((order) => order.orderId === orderId);
      return match ? this.toBrokerOrderSnapshot(match) : null;
    } catch (error) {
      this.recordError(error);
      return null;
    }
  }

  async refreshSession(): Promise<SessionStatusSnapshot | null> {
    await this.ensureConnected();
    return this.refreshManagedAccounts();
  }

  async tickle(): Promise<void> {
    try {
      await this.ensureConnected();
      await this.api.getCurrentTime();
      await this.refreshManagedAccounts();
      this.lastTickleAt = new Date();
      this.lastError = null;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  async getHealth(): Promise<BridgeHealth> {
    await this.refreshSession().catch(() => this.latestSession);
    const session = this.latestSession ?? this.buildSessionSnapshot();

    return {
      configured: true,
      authenticated: session.authenticated,
      connected: session.connected,
      competing: session.competing,
      selectedAccountId: session.selectedAccountId,
      accounts: session.accounts,
      lastTickleAt: this.lastTickleAt,
      lastError: this.lastError,
      updatedAt: new Date(),
      transport: "tws",
      connectionTarget: `${this.config.host}:${this.config.port}`,
      sessionMode: this.config.mode,
      clientId: this.config.clientId,
    };
  }

  async listAccounts(_mode: RuntimeMode): Promise<BrokerAccountSnapshot[]> {
    await this.refreshSession();
    await this.waitForCondition(() => this.accountSummaryInitialized, 1_500, 100);

    return this.managedAccounts.map((accountId) => {
      const summary = this.accountSummaries.get(accountId);
      return {
        id: accountId,
        providerAccountId: accountId,
        provider: "ibkr",
        mode: this.config.mode,
        displayName: `IBKR ${accountId}`,
        currency: summary?.currency ?? "USD",
        buyingPower: summary?.buyingPower ?? 0,
        cash: summary?.cash ?? 0,
        netLiquidation: summary?.netLiquidation ?? 0,
        updatedAt: summary?.updatedAt ?? new Date(),
      };
    });
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    await this.refreshSession();
    await this.waitForCondition(() => this.positionsInitialized, 1_500, 100);
    const accountId = input.accountId?.trim();

    return Array.from(this.positionsByAccount.entries())
      .flatMap(([currentAccountId, positions]) =>
        accountId && currentAccountId !== accountId ? [] : positions,
      )
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
  }

  async listOrders(input: {
    accountId?: string;
    mode: RuntimeMode;
    status?:
      | "pending_submit"
      | "submitted"
      | "accepted"
      | "partially_filled"
      | "filled"
      | "canceled"
      | "rejected"
      | "expired";
  }): Promise<BrokerOrderSnapshot[]> {
    await this.refreshSession();
    const openOrders = await this.api.getAllOpenOrders().catch(() => []);
    const snapshots = compact(
      openOrders.map((order) => this.toBrokerOrderSnapshot(order)),
    );

    return snapshots
      .filter((order) =>
        (!input.accountId || order.accountId === input.accountId) &&
        (!input.status || order.status === input.status),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  async listExecutions(input: {
    accountId?: string;
    days?: number;
    limit?: number;
    symbol?: string;
    providerContractId?: string | null;
  }): Promise<BrokerExecutionSnapshot[]> {
    await this.refreshSession();
    const filter = {
      acctCode: input.accountId,
      symbol: input.symbol ? normalizeSymbol(input.symbol) : undefined,
      time: formatExecutionFilterTime(
        new Date(
          Date.now() - (Math.max(1, input.days ?? 7) * 86_400_000),
        ),
      ),
    };
    const executions = await this.api.getExecutionDetails(filter);

    return compact(
      executions.map((detail) => {
        const providerContractId = asString(detail.contract.conId);
        if (
          input.providerContractId &&
          providerContractId !== input.providerContractId
        ) {
          return null;
        }

        const symbol = normalizeSymbol(asString(detail.contract.symbol) ?? "");
        const assetClass = normalizeAssetClassFromSecType(
          asString(detail.contract.secType) ?? undefined,
        );
        const accountId =
          asString(detail.execution.acctNumber) ?? input.accountId ?? "";

        if (!symbol || !assetClass || !accountId) {
          return null;
        }

        return {
          id: detail.execution.execId ?? randomUUID(),
          accountId,
          symbol,
          assetClass,
          side:
            asString(detail.execution.side)?.toUpperCase() === "SLD"
              ? "sell"
              : "buy",
          quantity: asNumber(detail.execution.shares) ?? 0,
          price: asNumber(detail.execution.price) ?? 0,
          netAmount: null,
          exchange: asString(detail.execution.exchange),
          executedAt: parseExecutionTime(asString(detail.execution.time) ?? undefined),
          orderDescription: null,
          contractDescription: asString(detail.contract.localSymbol),
          providerContractId,
          orderRef: asString(detail.execution.orderRef),
        } satisfies BrokerExecutionSnapshot;
      }),
    )
      .sort((left, right) => right.executedAt.getTime() - left.executedAt.getTime())
      .slice(0, Math.max(1, input.limit ?? 50));
  }

  async getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    await this.refreshSession();

    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    const results: QuoteSnapshot[] = [];
    for (const symbol of normalizedSymbols) {
      const resolved = await this.resolveStockContract(symbol);
      const providerContractId = await this.ensureQuoteSubscription(resolved);
      await this.waitForCondition(
        () => this.quotesByProviderContractId.has(providerContractId),
        400,
        50,
      );

      const liveQuote = this.quotesByProviderContractId.get(providerContractId);
      if (liveQuote) {
        results.push(liveQuote);
        continue;
      }

      const fallbackQuote = await this.getContractQuoteSnapshot({
        contract: {
          ...resolved.contract,
          conId: resolved.resolved.conid,
          exchange: "SMART",
        },
        symbol,
        providerContractId,
      });

      if (fallbackQuote) {
        this.quotesByProviderContractId.set(providerContractId, fallbackQuote);
        results.push(fallbackQuote);
      }
    }

    return results;
  }

  async getHistoricalBars(input: {
    symbol: string;
    timeframe: HistoryBarTimeframe;
    limit?: number;
    from?: Date;
    to?: Date;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    outsideRth?: boolean;
    source?: HistoryDataSource;
  }): Promise<BrokerBarSnapshot[]> {
    await this.refreshSession();

    let contract: Contract | null = null;
    let providerContractId: string | null = null;

    if (input.assetClass === "option") {
      if (!input.providerContractId) {
        return [];
      }

      contract = {
        conId: Number(input.providerContractId),
        exchange: "SMART",
        secType: SecType.OPT,
      };
      providerContractId = input.providerContractId;
    } else {
      const resolvedStock = await this.resolveStockContract(input.symbol);
      contract = {
        ...resolvedStock.contract,
        conId: resolvedStock.resolved.conid,
        exchange: "SMART",
      };
      providerContractId = resolvedStock.resolved.providerContractId;
    }

    const requestedBars = resolveRequestedHistoryBars(input);
    const bars = await this.api.getHistoricalData(
      contract,
      formatHistoryEndDate(input.to ?? new Date()),
      buildHistoryDuration(input.timeframe, requestedBars),
      HISTORY_BAR_SIZE[input.timeframe],
      HISTORY_SOURCE_TO_TWS[input.source ?? "trades"],
      input.outsideRth ? 0 : 1,
      2,
    );

    return compact(
      bars.map((bar) => {
        const timestamp = parseHistoricalBarTime(bar.time);
        const open = asNumber(bar.open);
        const high = asNumber(bar.high);
        const low = asNumber(bar.low);
        const close = asNumber(bar.close);
        const volume = asNumber(bar.volume) ?? 0;

        if (
          !timestamp ||
          open === null ||
          high === null ||
          low === null ||
          close === null
        ) {
          return null;
        }

        return {
          timestamp,
          open,
          high,
          low,
          close,
          volume,
          source: "ibkr-tws-history",
          providerContractId,
          outsideRth: Boolean(input.outsideRth),
          partial: false,
        } satisfies BrokerBarSnapshot;
      }),
    )
      .filter((bar) =>
        (!input.from || bar.timestamp >= input.from) &&
        (!input.to || bar.timestamp <= input.to),
      )
      .slice(-Math.max(1, input.limit ?? requestedBars));
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put" | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
  }): Promise<OptionChainContract[]> {
    await this.refreshSession();
    const resolvedUnderlying = await this.resolveStockContract(input.underlying);
    const underlyingQuote =
      (await this.getQuoteSnapshots([input.underlying]))[0] ?? null;
    const spotPrice =
      underlyingQuote?.price ??
      underlyingQuote?.bid ??
      underlyingQuote?.ask ??
      0;

    const optionParams = await this.api.getSecDefOptParams(
      resolvedUnderlying.resolved.symbol,
      "",
      SecType.STK,
      resolvedUnderlying.resolved.conid,
    );
    const parameterSet = optionParams[0];

    if (!parameterSet) {
      return [];
    }

    const requestedExpiration = input.expirationDate
      ? input.expirationDate.toISOString().slice(0, 10)
      : null;
    const expirations = parameterSet.expirations
      .map((expiration) => toDate(expiration))
      .filter((expiration): expiration is Date => Boolean(expiration))
      .filter((expiration) =>
        requestedExpiration
          ? expiration.toISOString().slice(0, 10) === requestedExpiration
          : true,
      )
      .sort((left, right) => left.getTime() - right.getTime())
      .slice(0, Math.max(1, input.maxExpirations ?? 3));

    const strikes = Array.from(new Set(parameterSet.strikes))
      .filter((strike) => Number.isFinite(strike))
      .sort((left, right) => left - right);
    const strikesAroundMoney = Math.max(1, input.strikesAroundMoney ?? 12);
    const relevantStrikes =
      spotPrice > 0 && strikes.length > strikesAroundMoney * 2 + 1
        ? (() => {
            const closestIndex = strikes.reduce((bestIndex, strike, index) =>
              Math.abs(strike - spotPrice) < Math.abs(strikes[bestIndex] - spotPrice)
                ? index
                : bestIndex,
            0);
            const start = Math.max(0, closestIndex - strikesAroundMoney);
            const end = Math.min(
              strikes.length,
              closestIndex + strikesAroundMoney + 1,
            );
            return strikes.slice(start, end);
          })()
        : strikes;
    const rights = input.contractType
      ? [input.contractType]
      : (["call", "put"] as const);

    const contracts: OptionChainContract[] = [];
    for (const expirationDate of expirations) {
      for (const strike of relevantStrikes) {
        for (const right of rights) {
          const resolvedOption = await this.resolveOptionContract({
            underlying: resolvedUnderlying.resolved.symbol,
            expirationDate,
            strike,
            right,
          }).catch(() => null);

          if (!resolvedOption) {
            continue;
          }

          const quote =
            (resolvedOption.optionContract.providerContractId &&
            this.quotesByProviderContractId.has(
              resolvedOption.optionContract.providerContractId,
            )
              ? this.quotesByProviderContractId.get(
                  resolvedOption.optionContract.providerContractId,
                )
              : await this.getContractQuoteSnapshot({
                  contract: {
                    ...resolvedOption.contract,
                    exchange: "SMART",
                  },
                  symbol: resolvedOption.optionContract.ticker,
                  providerContractId:
                    resolvedOption.optionContract.providerContractId,
                })) ?? null;

          const bid = quote?.bid ?? 0;
          const ask = quote?.ask ?? bid;
          const last = quote?.price ?? 0;

          contracts.push({
            contract: resolvedOption.optionContract,
            bid,
            ask,
            last,
            mark: bid > 0 && ask > 0 ? (bid + ask) / 2 : last,
            impliedVolatility: null,
            delta: null,
            gamma: null,
            theta: null,
            vega: null,
            openInterest: 0,
            volume: 0,
            updatedAt: quote?.updatedAt ?? new Date(),
          });
        }
      }
    }

    return contracts.sort((left, right) => {
      return (
        left.contract.expirationDate.getTime() -
          right.contract.expirationDate.getTime() ||
        left.contract.strike - right.contract.strike ||
        left.contract.right.localeCompare(right.contract.right)
      );
    });
  }

  async getMarketDepth(input: {
    accountId?: string | null;
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    exchange?: string | null;
  }): Promise<BrokerMarketDepthSnapshot | null> {
    await this.refreshSession();
    const accountId = await this.requireAccountId(input.accountId);
    const exchange = input.exchange?.trim().toUpperCase() || "SMART";
    const assetClass = input.assetClass === "option" ? "option" : "equity";

    let contract: Contract | null = null;
    let providerContractId: string | null = input.providerContractId ?? null;
    let symbol = normalizeSymbol(input.symbol);

    if (assetClass === "option") {
      if (!providerContractId) {
        return null;
      }

      contract = {
        conId: Number(providerContractId),
        secType: SecType.OPT,
        exchange,
      };
    } else {
      const resolvedStock = await this.resolveStockContract(symbol);
      providerContractId = resolvedStock.resolved.providerContractId;
      symbol = resolvedStock.resolved.symbol;
      contract = {
        ...resolvedStock.contract,
        conId: resolvedStock.resolved.conid,
        exchange,
      };
    }

    const key = buildDepthKey(accountId, providerContractId ?? "", exchange);
    if (!providerContractId) {
      return null;
    }

    if (!this.depthSubscriptions.has(key)) {
      const subscription = this.api.getMarketDepth(
        contract,
        10,
        exchange === "SMART",
      ).subscribe({
        next: (update) => {
          this.depthByKey.set(
            key,
            toDepthSnapshot({
              accountId,
              assetClass,
              exchange,
              orderBook: update.all,
              providerContractId,
              symbol,
            }),
          );
        },
        error: (error) => {
          this.recordError(error);
        },
      });

      this.depthSubscriptions.set(key, {
        contract,
        stop: () => subscription.unsubscribe(),
      });
    }

    await this.waitForCondition(() => this.depthByKey.has(key), 600, 50);
    return this.depthByKey.get(key) ?? null;
  }

  async previewOrder(input: PlaceOrderInput): Promise<OrderPreviewSnapshot> {
    await this.refreshSession();
    const structured = await this.buildStructuredOrder(input);

    return {
      accountId: structured.accountId,
      mode: this.config.mode,
      symbol: normalizeSymbol(input.symbol),
      assetClass: input.assetClass,
      resolvedContractId: structured.resolvedContractId,
      orderPayload: this.buildOrderContractPayload(
        structured.contract,
        structured.order,
      ),
      optionContract: structured.optionContract,
    };
  }

  async placeOrder(input: PlaceOrderInput): Promise<BrokerOrderSnapshot> {
    await this.refreshSession();
    const structured = await this.buildStructuredOrder(input);
    const orderId = await this.api.placeNewOrder(
      structured.contract,
      structured.order,
    );

    const snapshot = await this.findOpenOrder(orderId);
    if (snapshot) {
      return snapshot;
    }

    const placedAt = new Date();
    return {
      id: String(orderId),
      accountId: structured.accountId,
      mode: this.config.mode,
      symbol: normalizeSymbol(input.symbol),
      assetClass: input.assetClass,
      side: input.side,
      type: input.type,
      timeInForce: input.timeInForce,
      status: "submitted",
      quantity: input.quantity,
      filledQuantity: 0,
      limitPrice: input.limitPrice ?? null,
      stopPrice: input.stopPrice ?? null,
      placedAt,
      updatedAt: placedAt,
      optionContract: structured.optionContract,
    };
  }

  async submitRawOrders(input: {
    accountId?: string | null;
    orders: Record<string, unknown>[];
  }): Promise<Record<string, unknown>> {
    await this.refreshSession();
    const accountId = await this.requireAccountId(input.accountId);
    const submittedOrderIds: string[] = [];

    for (const rawOrder of input.orders) {
      const structured = this.parseStructuredRawOrder(rawOrder, accountId);
      const orderId = await this.api.placeNewOrder(
        structured.contract,
        structured.order,
      );
      submittedOrderIds.push(String(orderId));
    }

    return {
      submittedOrderIds,
      message: `Submitted ${submittedOrderIds.length} order${submittedOrderIds.length === 1 ? "" : "s"}.`,
    };
  }

  async replaceOrder(input: {
    accountId: string;
    orderId: string;
    order: Record<string, unknown>;
    mode: RuntimeMode;
  }): Promise<ReplaceOrderSnapshot> {
    await this.refreshSession();
    const accountId = await this.requireAccountId(input.accountId);
    const orderId = Number.parseInt(input.orderId, 10);

    if (!Number.isFinite(orderId)) {
      throw new HttpError(400, "Invalid IBKR order id for replace.", {
        code: "ibkr_invalid_order_id",
      });
    }

    const structured = this.parseStructuredRawOrder(input.order, accountId);
    this.api.modifyOrder(orderId, structured.contract, {
      ...structured.order,
      orderId,
      account: accountId,
    });

    const snapshot = await this.findOpenOrder(orderId);
    if (snapshot) {
      return snapshot;
    }

    return {
      id: String(orderId),
      accountId,
      mode: this.config.mode,
      symbol:
        normalizeSymbol(asString(structured.contract.symbol) ?? "") || "UNKNOWN",
      assetClass:
        normalizeAssetClassFromSecType(
          asString(structured.contract.secType) ?? undefined,
        ) ?? "equity",
      side: normalizeOrderSide(asString(structured.order.action) ?? undefined),
      type: normalizeOrderType(asString(structured.order.orderType) ?? undefined),
      timeInForce: normalizeTimeInForce(asString(structured.order.tif) ?? undefined),
      status: "submitted",
      quantity: asNumber(structured.order.totalQuantity) ?? 0,
      filledQuantity: 0,
      limitPrice: asNumber(structured.order.lmtPrice),
      stopPrice: asNumber(structured.order.auxPrice),
      placedAt: new Date(),
      updatedAt: new Date(),
      optionContract: toOptionContractMeta(structured.contract),
    };
  }

  async cancelOrder(input: {
    accountId: string;
    orderId: string;
    manualIndicator?: boolean | null;
    extOperator?: string | null;
  }): Promise<CancelOrderSnapshot> {
    await this.refreshSession();
    const orderId = Number.parseInt(input.orderId, 10);

    if (!Number.isFinite(orderId)) {
      throw new HttpError(400, "Invalid IBKR order id for cancel.", {
        code: "ibkr_invalid_order_id",
      });
    }

    this.api.cancelOrder(orderId);

    return {
      orderId: String(orderId),
      accountId: input.accountId,
      message: "Cancel request submitted",
      submittedAt: new Date(),
    };
  }

  async getNews(_input: {
    ticker?: string;
    limit?: number;
  }): Promise<import("../../api-server/src/providers/ibkr/client").IbkrNewsArticle[]> {
    // TWS doesn't expose news via the IB Gateway API in the same way
    // Client Portal does; the platform service falls back to the secondary
    // provider when this returns empty.
    return [];
  }

  async searchTickers(_input: {
    search?: string;
    limit?: number;
  }): Promise<{
    count: number;
    results: import("../../api-server/src/providers/ibkr/client").IbkrUniverseTicker[];
  }> {
    return { count: 0, results: [] };
  }
}
