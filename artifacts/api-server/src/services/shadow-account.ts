import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  evaluateRayReplicaSignals,
  RAY_REPLICA_SIGNAL_WARMUP_BARS,
  resolveRayReplicaSignalSettings,
  type RayReplicaBar,
  type RayReplicaSignalEvent,
} from "@workspace/rayreplica-core";
import {
  db,
  shadowAccountsTable,
  shadowBalanceSnapshotsTable,
  shadowFillsTable,
  shadowOrdersTable,
  shadowPortfolioAnalysisSnapshotsTable,
  shadowPositionMarksTable,
  shadowPositionsTable,
  type ExecutionEvent,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { getPolygonRuntimeConfig, type RuntimeMode } from "../lib/runtime";
import { asRecord as readRecord, normalizeSymbol } from "../lib/values";
import type { BrokerBarSnapshot, PlaceOrderInput } from "../providers/ibkr/client";
import { fetchOptionQuoteSnapshotPayload } from "./bridge-streams";
import { loadStoredMarketBars } from "./market-data-store";
import {
  assertIbkrGatewayTradingAvailable,
  getBars,
  getQuoteSnapshots,
  listWatchlists,
} from "./platform";
import {
  accountBenchmarkLimitForRange,
  accountBenchmarkTimeframeForRange,
  accountRangeStart,
  accountSnapshotBucketSizeMs,
  normalizeAccountRange,
  type AccountRange,
} from "./account-ranges";

export const SHADOW_ACCOUNT_ID = "shadow";
export const SHADOW_ACCOUNT_DISPLAY_NAME = "Shadow";
export const SHADOW_STARTING_BALANCE = 30_000;
export const SHADOW_EQUITY_COLOR = "#ec4899";

const SHADOW_CURRENCY = "USD";
const STOCK_FIXED_COMMISSION_PER_SHARE = 0.005;
const STOCK_FIXED_COMMISSION_MIN = 1;
const STOCK_FIXED_COMMISSION_MAX_RATE = 0.01;
const OPTION_FIXED_COMMISSION_PER_CONTRACT = 0.65;
const OPTION_ORF_PER_CONTRACT = 0.02295;
const WATCHLIST_BACKTEST_SOURCE = "watchlist_backtest";
const WATCHLIST_BACKTEST_MARK_SOURCE = "watchlist_backtest_mark";
const WATCHLIST_BACKTEST_TIMEFRAME_MS: Record<ShadowWatchlistBacktestTimeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};
const WATCHLIST_BACKTEST_COMPLETED_BAR_SAFETY_MS = 2_000;
const WATCHLIST_BACKTEST_MAX_BAR_LIMIT = 50_000;
const WATCHLIST_BACKTEST_HYDRATION_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;
const WATCHLIST_BACKTEST_MAX_POSITION_FRACTION = 0.1;
const WATCHLIST_BACKTEST_MAX_OPEN_POSITIONS = 10;
const WATCHLIST_BACKTEST_TARGET_OUTPERFORMANCE_MULTIPLE = 1.5;
const WATCHLIST_BACKTEST_TIME_ZONE = "America/New_York";
const WATCHLIST_BACKTEST_OUTSIDE_RTH = false;
const WATCHLIST_BACKTEST_PROXY_SYMBOLS = ["VXX", "SQQQ"] as const;
const WATCHLIST_BACKTEST_PROXY_TIMEFRAMES = ["5m", "15m", "1h"] as const;
const WATCHLIST_BACKTEST_REGIME_ACTIONS = [
  "pause_new_longs",
  "exit_longs_buy_proxy",
  "scale_down_longs",
] as const;
const WATCHLIST_BACKTEST_REGIME_EXPIRATIONS = [
  "until_proxy_sell",
  "fixed_12_5m_bars",
  "session_close",
] as const;
const WATCHLIST_BACKTEST_SCALE_DOWN_FRACTION = 0.5;
const WATCHLIST_BACKTEST_FIXED_REGIME_BARS = 12;
const SHADOW_ORDER_HISTORY_LIMIT = 5_000;
const SHADOW_STATE_REFRESH_TTL_MS = 2_000;

type OrderTab = "working" | "history";
type ShadowAssetClass = "equity" | "option";
type ShadowSide = "buy" | "sell";
type ShadowOrderSource = "manual" | "automation" | "watchlist_backtest";
type ShadowOptionContract = NonNullable<PlaceOrderInput["optionContract"]>;
type ShadowOrderInput = Omit<PlaceOrderInput, "accountId" | "mode"> & {
  accountId?: string | null;
  mode?: RuntimeMode;
  source?: ShadowOrderSource;
  sourceEventId?: string | null;
  clientOrderId?: string | null;
  requestedFillPrice?: number | null;
  payload?: Record<string, unknown>;
  placedAt?: Date | null;
};

type ShadowPositionRow = typeof shadowPositionsTable.$inferSelect;
type ShadowPositionMarkRow = typeof shadowPositionMarksTable.$inferSelect;
type ShadowAccountRow = typeof shadowAccountsTable.$inferSelect;
type ShadowFillRow = typeof shadowFillsTable.$inferSelect;
type ShadowOrderRow = typeof shadowOrdersTable.$inferSelect;
type ShadowBalanceSnapshotRow = typeof shadowBalanceSnapshotsTable.$inferSelect;
type ShadowPortfolioAnalysisSnapshotRow =
  typeof shadowPortfolioAnalysisSnapshotsTable.$inferSelect;

type ShadowPositionDayChange = {
  dayChange: number | null;
  dayChangePercent: number | null;
};

type ShadowTotals = {
  cash: number;
  startingBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  fees: number;
  marketValue: number;
  netLiquidation: number;
  updatedAt: Date;
};

type WatchlistBacktestStartingBook = {
  totals: ShadowTotals;
  baseMarketValue: number;
  existingOpenPositionCount: number;
  existingOpenSymbols: string[];
};

type ShadowFillPlan = {
  price: number;
  fees: number;
  grossAmount: number;
  cashDelta: number;
  realizedPnl: number;
  multiplier: number;
  positionKey: string;
  markSource: string;
};

type ShadowTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ShadowWatchlistBacktestTimeframe = "1m" | "5m" | "15m" | "1h" | "1d";

type WatchlistBacktestRiskOverlay = {
  label: string;
  stopLossPercent: number | null;
  trailingStopPercent: number | null;
  sellSignalTrailingStopPercent: number | null;
};

type WatchlistBacktestSizingOverlay = {
  label: string;
  maxPositionFraction: number;
  maxOpenPositions: number;
  cashOnly: true;
};

type WatchlistBacktestSelectionMode =
  | "first_signal"
  | "ranked_batch"
  | "ranked_rebalance";

type WatchlistBacktestSelectionOverlay = {
  label: string;
  mode: WatchlistBacktestSelectionMode;
  minScoreEdge: number;
};

const DEFAULT_WATCHLIST_BACKTEST_SIZING: WatchlistBacktestSizingOverlay = {
  label: "P10x10",
  maxPositionFraction: WATCHLIST_BACKTEST_MAX_POSITION_FRACTION,
  maxOpenPositions: WATCHLIST_BACKTEST_MAX_OPEN_POSITIONS,
  cashOnly: true,
};

const DEFAULT_WATCHLIST_BACKTEST_SELECTION: WatchlistBacktestSelectionOverlay = {
  label: "FIFO",
  mode: "first_signal",
  minScoreEdge: 0,
};

type WatchlistBacktestProxySymbol = (typeof WATCHLIST_BACKTEST_PROXY_SYMBOLS)[number];
type WatchlistBacktestRegimeAction =
  (typeof WATCHLIST_BACKTEST_REGIME_ACTIONS)[number];
type WatchlistBacktestRegimeExpiration =
  (typeof WATCHLIST_BACKTEST_REGIME_EXPIRATIONS)[number];

type WatchlistBacktestRegimeOverlay = {
  label: string;
  proxySymbol: WatchlistBacktestProxySymbol;
  signalTimeframe: ShadowWatchlistBacktestTimeframe;
  action: WatchlistBacktestRegimeAction;
  expiration: WatchlistBacktestRegimeExpiration;
  fixedBars: number;
  scaleDownFraction: number;
};

type WatchlistBacktestFill = {
  symbol: string;
  side: ShadowSide;
  quantity: number;
  price: number;
  fees: number;
  grossAmount: number;
  cashDelta: number;
  realizedPnl: number;
  positionKey: string;
  placedAt: Date;
  signalAt: Date;
  signalPrice: number | null;
  signalClose: number | null;
  signalScore?: number | null;
  signalScoreDetails?: Record<string, number> | null;
  watchlists: Array<{ id: string; name: string }>;
  fillSource: string;
  regime?: Record<string, unknown> | null;
};

type WatchlistBacktestSkip = {
  symbol: string;
  reason: string;
  detail: string;
  signalAt?: Date | null;
  watchlists?: Array<{ id: string; name: string }>;
};

type WatchlistBacktestSignalCandidate = {
  symbol: string;
  side: ShadowSide;
  signal: RayReplicaSignalEvent;
  signalAt: Date;
  signalPrice: number | null;
  signalClose: number | null;
  fillPrice: number;
  placedAt: Date;
  fillSource: string;
  timeframe: ShadowWatchlistBacktestTimeframe;
  watchlists: Array<{ id: string; name: string }>;
  signalScore: number;
  signalScoreDetails: Record<string, number>;
};

type WatchlistBacktestPreparedBar = {
  bar: RayReplicaBar;
  at: Date;
  atMs: number;
};

let shadowFreshStateCache:
  | {
      totals: ShadowTotals;
      expiresAt: number;
    }
  | null = null;
let shadowFreshStateInFlight: Promise<ShadowTotals> | null = null;

function invalidateShadowFreshStateCache() {
  shadowFreshStateCache = null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function money(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function cents(value: number): number {
  return Number(value.toFixed(2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOrderTab(raw: unknown): OrderTab {
  return raw === "history" ? "history" : "working";
}

function weightPercent(value: number, nav: number | null): number | null {
  return nav && nav !== 0 ? (value / nav) * 100 : null;
}

function assetClassLabel(position: { assetClass: string; symbol: string }): string {
  if (position.assetClass === "option") {
    return "Options";
  }
  return "Stocks";
}

function marketMultiplier(input: {
  assetClass: ShadowAssetClass;
  optionContract?: ShadowOptionContract | null;
}): number {
  if (input.assetClass === "option") {
    return (
      toNumber(input.optionContract?.sharesPerContract) ??
      toNumber(input.optionContract?.multiplier) ??
      100
    );
  }
  return 1;
}

function optionDateKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function shadowDateWindowUtc(value: string | Date): {
  date: string;
  start: Date;
  end: Date;
} {
  const parsed = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "Invalid inspection date.", {
      code: "invalid_shadow_inspection_date",
      expose: true,
    });
  }
  const start = new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
  return {
    date: start.toISOString().slice(0, 10),
    start,
    end: new Date(start.getTime() + 24 * 60 * 60_000),
  };
}

function positionKey(input: {
  symbol: string;
  assetClass: ShadowAssetClass;
  optionContract?: ShadowOptionContract | null;
}): string {
  if (input.assetClass === "option" && input.optionContract) {
    return [
      "option",
      normalizeSymbol(input.optionContract.underlying || input.symbol).toUpperCase(),
      optionDateKey(input.optionContract.expirationDate),
      input.optionContract.strike,
      input.optionContract.right,
      input.optionContract.providerContractId || input.optionContract.ticker,
    ].join(":");
  }
  return `equity:${normalizeSymbol(input.symbol).toUpperCase()}`;
}

function positionDescription(position: ShadowPositionRow): string {
  const contract = asOptionContract(position.optionContract);
  if (!contract) {
    return position.symbol;
  }
  return `${contract.underlying} ${optionDateKey(contract.expirationDate)} ${contract.strike} ${String(contract.right).toUpperCase()}`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function isWatchlistBacktestPositionKey(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(`${WATCHLIST_BACKTEST_SOURCE}:`);
}

function shadowSourceType(order?: ShadowOrderRow | null): "manual" | "automation" | "watchlist_backtest" {
  if (order?.source === "automation") {
    return "automation";
  }
  if (order?.source === WATCHLIST_BACKTEST_SOURCE) {
    return WATCHLIST_BACKTEST_SOURCE;
  }
  return "manual";
}

function shadowSourceLabel(sourceType: string, fallback: string | null = null) {
  if (sourceType === "automation") {
    return "Signal Options";
  }
  if (sourceType === WATCHLIST_BACKTEST_SOURCE) {
    return "Watchlist Backtest";
  }
  return fallback;
}

function shadowSourceMetadata(order?: ShadowOrderRow | null) {
  const payload = readRecord(order?.payload) ?? {};
  const candidate = readRecord(payload.candidate) ?? readRecord(payload.automationCandidate) ?? {};
  const position = readRecord(payload.position) ?? {};
  const metadata = readRecord(payload.metadata) ?? {};
  const sourceType = shadowSourceType(order);
  const candidateId =
    readString(candidate.id) ??
    readString(position.candidateId) ??
    readString(payload.candidateId) ??
    readString(metadata.runId);
  const deploymentId =
    readString(candidate.deploymentId) ??
    readString(metadata.deploymentId) ??
    readString(payload.deploymentId);
  const deploymentName =
    readString(candidate.deploymentName) ??
    readString(metadata.deploymentName) ??
    readString(payload.deploymentName);

  return {
    sourceType,
    strategyLabel: shadowSourceLabel(sourceType, candidateId ? "Signal Options" : null),
    candidateId,
    deploymentId,
    deploymentName,
    sourceEventId: order?.sourceEventId ?? null,
    attributionStatus:
      candidateId || sourceType === "automation" || sourceType === WATCHLIST_BACKTEST_SOURCE
        ? "attributed"
        : "unknown",
  };
}

function buildPositionSourceAttribution(
  position: ShadowPositionRow,
  orders: ShadowOrderRow[],
) {
  const key = position.positionKey;
  const buckets = new Map<
    string,
    {
      sourceType: "manual" | "automation" | "watchlist_backtest";
      strategyLabel: string | null;
      candidateId: string | null;
      deploymentId: string | null;
      deploymentName: string | null;
      sourceEventId: string | null;
      quantity: number;
    }
  >();

  orders
    .filter(
      (order) => {
        const payload = readRecord(order.payload) ?? {};
        const metadata = readRecord(payload.metadata) ?? {};
        const attributedPositionKey =
          readString(metadata.positionKey) ?? readString(payload.positionKey);
        return (
          attributedPositionKey ??
          positionKey({
          symbol: order.symbol,
          assetClass: order.assetClass as ShadowAssetClass,
          optionContract: asOptionContract(order.optionContract),
          })
        ) === key;
      },
    )
    .forEach((order) => {
      const metadata = shadowSourceMetadata(order);
      const sourceType =
        metadata.sourceType === "automation" ||
        metadata.sourceType === WATCHLIST_BACKTEST_SOURCE
          ? metadata.sourceType
          : "manual";
      const bucketKey = [
        sourceType,
        metadata.strategyLabel ?? "Manual",
        metadata.candidateId ?? "none",
      ].join(":");
      const current =
        buckets.get(bucketKey) ?? {
          sourceType,
          strategyLabel: metadata.strategyLabel,
          candidateId: metadata.candidateId,
          deploymentId: metadata.deploymentId,
          deploymentName: metadata.deploymentName,
          sourceEventId: metadata.sourceEventId,
          quantity: 0,
        };
      const signedQuantity =
        (toNumber(order.filledQuantity) ?? toNumber(order.quantity) ?? 0) *
        (order.side === "sell" ? -1 : 1);
      current.quantity += signedQuantity;
      buckets.set(bucketKey, current);
    });

  const attribution = Array.from(buckets.values())
    .filter((bucket) => Math.abs(bucket.quantity) > 0.000001)
    .map((bucket) => ({
      ...bucket,
      quantity: Number(bucket.quantity.toFixed(6)),
    }));
  const sourceTypes = new Set(attribution.map((bucket) => bucket.sourceType));
  const hasMultipleAutomationCandidates =
    new Set(
      attribution
        .filter((bucket) => bucket.sourceType === "automation")
        .map((bucket) => bucket.candidateId ?? "unknown"),
    ).size > 1;
  const sourceType =
    sourceTypes.size > 1 || hasMultipleAutomationCandidates
      ? "mixed"
      : attribution[0]?.sourceType ?? "manual";

  return {
    sourceType,
    strategyLabel:
      sourceType === "automation"
        ? attribution[0]?.strategyLabel ?? "Signal Options"
        : sourceType === WATCHLIST_BACKTEST_SOURCE
          ? attribution[0]?.strategyLabel ?? "Watchlist Backtest"
        : sourceType === "mixed"
          ? "Mixed"
          : null,
    attributionStatus:
      attribution.length === 0
        ? "unknown"
        : sourceType === "mixed"
          ? "mixed"
          : "attributed",
    sourceAttribution: attribution,
  };
}

function asOptionContract(value: unknown): ShadowOptionContract | null {
  if (!isRecord(value)) {
    return null;
  }
  const expirationDate =
    value.expirationDate instanceof Date
      ? value.expirationDate
      : new Date(String(value.expirationDate ?? ""));
  const right = String(value.right ?? "").toLowerCase();
  const ticker = String(value.ticker ?? "");
  const underlying = normalizeSymbol(String(value.underlying ?? ticker));
  const strike = toNumber(value.strike);
  if (
    !ticker ||
    !underlying ||
    Number.isNaN(expirationDate.getTime()) ||
    strike == null ||
    (right !== "call" && right !== "put")
  ) {
    return null;
  }
  return {
    ticker,
    underlying,
    expirationDate,
    strike,
    right,
    multiplier: toNumber(value.multiplier) ?? 100,
    sharesPerContract: toNumber(value.sharesPerContract) ?? 100,
    providerContractId:
      typeof value.providerContractId === "string" && value.providerContractId.trim()
        ? value.providerContractId.trim()
        : null,
  };
}

function optionPayload(value: ShadowOptionContract | null | undefined) {
  return value
    ? {
        ticker: value.ticker,
        underlying: value.underlying,
        expirationDate: value.expirationDate,
        strike: value.strike,
        right: value.right,
        multiplier: value.multiplier,
        sharesPerContract: value.sharesPerContract,
        providerContractId: value.providerContractId ?? null,
      }
    : null;
}

export function computeShadowOrderFees(input: {
  assetClass: ShadowAssetClass;
  quantity: number;
  price: number;
  multiplier?: number;
}): number {
  const quantity = Math.abs(input.quantity);
  if (!quantity) {
    return 0;
  }
  if (input.assetClass === "option") {
    return cents(quantity * (OPTION_FIXED_COMMISSION_PER_CONTRACT + OPTION_ORF_PER_CONTRACT));
  }
  const gross = Math.abs(input.price * quantity * (input.multiplier ?? 1));
  const perShare = quantity * STOCK_FIXED_COMMISSION_PER_SHARE;
  const capped = gross > 0 ? Math.min(perShare, gross * STOCK_FIXED_COMMISSION_MAX_RATE) : perShare;
  return cents(Math.max(STOCK_FIXED_COMMISSION_MIN, capped));
}

async function ensureShadowAccount(): Promise<ShadowAccountRow> {
  const [inserted] = await db
    .insert(shadowAccountsTable)
    .values({
      id: SHADOW_ACCOUNT_ID,
      displayName: SHADOW_ACCOUNT_DISPLAY_NAME,
      currency: SHADOW_CURRENCY,
      startingBalance: money(SHADOW_STARTING_BALANCE),
      cash: money(SHADOW_STARTING_BALANCE),
      status: "active",
    })
    .onConflictDoUpdate({
      target: shadowAccountsTable.id,
      set: {
        displayName: SHADOW_ACCOUNT_DISPLAY_NAME,
        currency: SHADOW_CURRENCY,
        status: "active",
        updatedAt: new Date(),
      },
    })
    .returning();

  const account = inserted ?? (await readShadowAccount());
  if (!account) {
    throw new HttpError(500, "Shadow account could not be initialized.", {
      code: "shadow_account_init_failed",
      expose: true,
    });
  }

  const [existingSnapshot] = await db
    .select({ id: shadowBalanceSnapshotsTable.id })
    .from(shadowBalanceSnapshotsTable)
    .where(eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID))
    .limit(1);

  if (!existingSnapshot) {
    await writeShadowBalanceSnapshot("initial");
  }

  return account;
}

async function readShadowAccount(): Promise<ShadowAccountRow | null> {
  const [row] = await db
    .select()
    .from(shadowAccountsTable)
    .where(eq(shadowAccountsTable.id, SHADOW_ACCOUNT_ID))
    .limit(1);
  return row ?? null;
}

async function readOpenShadowPositions(): Promise<ShadowPositionRow[]> {
  return db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.status, "open"),
      ),
    )
    .orderBy(desc(shadowPositionsTable.updatedAt));
}

async function computeShadowTotals(): Promise<ShadowTotals> {
  const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
  const positions = await readOpenShadowPositions();
  const cash = toNumber(account.cash) ?? SHADOW_STARTING_BALANCE;
  const startingBalance = toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE;
  const realizedPnl = toNumber(account.realizedPnl) ?? 0;
  const fees = toNumber(account.fees) ?? 0;
  const marketValue = positions.reduce(
    (sum, position) => sum + (toNumber(position.marketValue) ?? 0),
    0,
  );
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + (toNumber(position.unrealizedPnl) ?? 0),
    0,
  );
  const updatedAt = positions.reduce(
    (latest, position) =>
      position.updatedAt && position.updatedAt > latest ? position.updatedAt : latest,
    account.updatedAt ?? new Date(),
  );
  return {
    cash,
    startingBalance,
    realizedPnl,
    unrealizedPnl,
    fees,
    marketValue,
    netLiquidation: cash + marketValue,
    updatedAt,
  };
}

async function computeWatchlistBacktestStartingBook(): Promise<WatchlistBacktestStartingBook> {
  const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
  const startingBalance = toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE;
  const positions = (await readOpenShadowPositions()).filter(
    (position) => !isWatchlistBacktestPositionKey(position.positionKey),
  );
  const fills = await db
    .select()
    .from(shadowFillsTable)
    .where(eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID));
  const orderIds = Array.from(
    new Set(fills.map((fill) => fill.orderId).filter((value): value is string => Boolean(value))),
  );
  const orders = orderIds.length
    ? await db
        .select()
        .from(shadowOrdersTable)
        .where(inArray(shadowOrdersTable.id, orderIds))
    : [];
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const baselineFills = fills.filter(
    (fill) =>
      shadowSourceType(fill.orderId ? ordersById.get(fill.orderId) : null) !==
      WATCHLIST_BACKTEST_SOURCE,
  );
  const cash = baselineFills.reduce(
    (sum, fill) => sum + (toNumber(fill.cashDelta) ?? 0),
    startingBalance,
  );
  const realizedPnl = baselineFills.reduce(
    (sum, fill) => sum + (toNumber(fill.realizedPnl) ?? 0),
    0,
  );
  const fees = baselineFills.reduce((sum, fill) => sum + (toNumber(fill.fees) ?? 0), 0);
  const marketValue = positions.reduce(
    (sum, position) => sum + (toNumber(position.marketValue) ?? 0),
    0,
  );
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + (toNumber(position.unrealizedPnl) ?? 0),
    0,
  );
  const updatedAt = positions.reduce(
    (latest, position) =>
      position.updatedAt && position.updatedAt > latest ? position.updatedAt : latest,
    account.updatedAt ?? new Date(),
  );
  const totals = {
    cash,
    startingBalance,
    realizedPnl,
    unrealizedPnl,
    fees,
    marketValue,
    netLiquidation: cash + marketValue,
    updatedAt,
  };
  return {
    totals,
    baseMarketValue: marketValue,
    existingOpenPositionCount: positions.length,
    existingOpenSymbols: Array.from(
      new Set(positions.map((position) => normalizeSymbol(position.symbol).toUpperCase())),
    ).filter(Boolean),
  };
}

async function writeShadowBalanceSnapshot(source = "ledger") {
  invalidateShadowFreshStateCache();
  const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
  const positions = await readOpenShadowPositions();
  const cash = toNumber(account.cash) ?? SHADOW_STARTING_BALANCE;
  const realizedPnl = toNumber(account.realizedPnl) ?? 0;
  const fees = toNumber(account.fees) ?? 0;
  const marketValue = positions.reduce(
    (sum, position) => sum + (toNumber(position.marketValue) ?? 0),
    0,
  );
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + (toNumber(position.unrealizedPnl) ?? 0),
    0,
  );
  const [snapshot] = await db
    .insert(shadowBalanceSnapshotsTable)
    .values({
      accountId: SHADOW_ACCOUNT_ID,
      currency: SHADOW_CURRENCY,
      cash: money(cash),
      buyingPower: money(cash),
      netLiquidation: money(cash + marketValue),
      realizedPnl: money(realizedPnl),
      unrealizedPnl: money(unrealizedPnl),
      fees: money(fees),
      source,
      asOf: new Date(),
    })
    .returning();
  return snapshot;
}

async function resolveEquityMark(symbol: string): Promise<{
  price: number | null;
  bid: number | null;
  ask: number | null;
  source: string;
  asOf: Date;
}> {
  const normalized = normalizeSymbol(symbol).toUpperCase();
  const quotes = await getQuoteSnapshots({ symbols: normalized }).catch(() => ({
    quotes: [],
  }));
  const quoteList = Array.isArray(quotes.quotes)
    ? (quotes.quotes as Array<Record<string, unknown>>)
    : [];
  const quote = quoteList.find(
    (candidate) => normalizeSymbol(String(candidate.symbol ?? "")).toUpperCase() === normalized,
  );
  if (quote) {
    return {
      price: toNumber(quote.price),
      bid: toNumber(quote.bid),
      ask: toNumber(quote.ask),
      source: "quote",
      asOf: quote.updatedAt instanceof Date ? quote.updatedAt : new Date(),
    };
  }

  const bars = await getBars({
    symbol: normalized,
    timeframe: "1m",
    limit: 1,
    outsideRth: true,
    allowHistoricalSynthesis: true,
  }).catch(() => ({ bars: [] }));
  const bar = bars.bars.at(-1);
  return {
    price: toNumber(bar?.close),
    bid: null,
    ask: null,
    source: "bar_fallback",
    asOf: bar?.timestamp instanceof Date ? bar.timestamp : new Date(),
  };
}

async function resolveOptionMark(contract: ShadowOptionContract): Promise<{
  price: number | null;
  bid: number | null;
  ask: number | null;
  source: string;
  asOf: Date;
}> {
  if (!contract.providerContractId) {
    return { price: null, bid: null, ask: null, source: "missing_contract_id", asOf: new Date() };
  }
  const payload = await fetchOptionQuoteSnapshotPayload({
    underlying: contract.underlying,
    providerContractIds: [contract.providerContractId],
  }).catch(() => null);
  const quote = payload?.quotes?.find(
    (candidate) => candidate.providerContractId === contract.providerContractId,
  );
  if (!quote) {
    return { price: null, bid: null, ask: null, source: "quote_unavailable", asOf: new Date() };
  }
  const quoteRecord = quote as Record<string, unknown>;
  const bid = toNumber(quoteRecord.bid);
  const ask = toNumber(quoteRecord.ask);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
  return {
    price:
      mid ??
      toNumber(quoteRecord.mark) ??
      toNumber(quoteRecord.last) ??
      toNumber(quoteRecord.price),
    bid,
    ask,
    source: "option_quote",
    asOf:
      quoteRecord.updatedAt instanceof Date
        ? quoteRecord.updatedAt
        : quoteRecord.quoteUpdatedAt instanceof Date
          ? quoteRecord.quoteUpdatedAt
          : new Date(),
  };
}

async function resolveFillPrice(input: ShadowOrderInput): Promise<{
  price: number;
  markSource: string;
}> {
  const requestedFillPrice = toNumber(input.requestedFillPrice);
  if (requestedFillPrice != null && requestedFillPrice > 0) {
    return { price: requestedFillPrice, markSource: "requested_fill" };
  }

  if (input.assetClass === "option") {
    const contract = asOptionContract(input.optionContract);
    if (!contract) {
      throw new HttpError(400, "Shadow option orders require a resolved option contract.", {
        code: "shadow_option_contract_required",
        expose: true,
      });
    }
    const mark = await resolveOptionMark(contract);
    const price =
      input.side === "buy"
        ? mark.ask ?? mark.price ?? toNumber(input.limitPrice)
        : mark.bid ?? mark.price ?? toNumber(input.limitPrice);
    if (price == null || price <= 0) {
      throw new HttpError(409, "No option quote is available for the Shadow fill.", {
        code: "shadow_option_quote_unavailable",
        expose: true,
      });
    }
    enforceLimitMarketability(input, price);
    return { price: cents(price), markSource: mark.source };
  }

  const mark = await resolveEquityMark(input.symbol);
  const price =
    input.side === "buy"
      ? mark.ask ?? mark.price ?? toNumber(input.limitPrice)
      : mark.bid ?? mark.price ?? toNumber(input.limitPrice);
  if (price == null || price <= 0) {
    throw new HttpError(409, "No equity quote is available for the Shadow fill.", {
      code: "shadow_equity_quote_unavailable",
      expose: true,
    });
  }
  enforceLimitMarketability(input, price);
  return { price: cents(price), markSource: mark.source };
}

function enforceLimitMarketability(input: ShadowOrderInput, fillPrice: number) {
  const limit = toNumber(input.limitPrice);
  if (input.type !== "limit" || limit == null) {
    return;
  }
  if (input.side === "buy" && limit < fillPrice) {
    throw new HttpError(409, "Shadow buy limit is below the current simulated fill.", {
      code: "shadow_limit_not_marketable",
      expose: true,
      data: { limitPrice: limit, fillPrice },
    });
  }
  if (input.side === "sell" && limit > fillPrice) {
    throw new HttpError(409, "Shadow sell limit is above the current simulated fill.", {
      code: "shadow_limit_not_marketable",
      expose: true,
      data: { limitPrice: limit, fillPrice },
    });
  }
}

async function buildShadowFillPlan(input: ShadowOrderInput): Promise<ShadowFillPlan> {
  const symbol = normalizeSymbol(input.symbol).toUpperCase();
  const quantity = toNumber(input.quantity) ?? 0;
  if (quantity <= 0) {
    throw new HttpError(400, "Shadow orders require a positive quantity.", {
      code: "shadow_invalid_quantity",
      expose: true,
    });
  }
  if (input.assetClass === "option" && !asOptionContract(input.optionContract)) {
    throw new HttpError(400, "Shadow option orders require a resolved option contract.", {
      code: "shadow_option_contract_required",
      expose: true,
    });
  }

  const fill = await resolveFillPrice(input);
  const multiplier = marketMultiplier({
    assetClass: input.assetClass,
    optionContract: asOptionContract(input.optionContract),
  });
  const grossAmount = fill.price * quantity * multiplier;
  const fees = computeShadowOrderFees({
    assetClass: input.assetClass,
    quantity,
    price: fill.price,
    multiplier,
  });
  const key = positionKey({
    symbol,
    assetClass: input.assetClass,
    optionContract: asOptionContract(input.optionContract),
  });
  const [position] = await db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.positionKey, key),
      ),
    )
    .limit(1);

  if (input.side === "buy") {
    const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
    const cash = toNumber(account.cash) ?? SHADOW_STARTING_BALANCE;
    const cashNeeded = grossAmount + fees;
    if (cashNeeded > cash) {
      throw new HttpError(409, "Shadow account has insufficient cash for this fill.", {
        code: "shadow_insufficient_cash",
        expose: true,
        data: { cash, cashNeeded },
      });
    }
    return {
      price: fill.price,
      fees,
      grossAmount,
      cashDelta: -(grossAmount + fees),
      realizedPnl: 0,
      multiplier,
      positionKey: key,
      markSource: fill.markSource,
    };
  }

  const openQuantity =
    position && position.status === "open" ? toNumber(position.quantity) ?? 0 : 0;
  if (openQuantity < quantity) {
    throw new HttpError(409, "Shadow account cannot sell more than the open position.", {
      code: "shadow_long_only_position_required",
      expose: true,
      data: { openQuantity, requestedQuantity: quantity },
    });
  }

  const averageCost = toNumber(position?.averageCost) ?? 0;
  const realizedPnl = (fill.price - averageCost) * quantity * multiplier - fees;
  return {
    price: fill.price,
    fees,
    grossAmount,
    cashDelta: grossAmount - fees,
    realizedPnl,
    multiplier,
    positionKey: key,
    markSource: fill.markSource,
  };
}

export async function previewShadowOrder(input: ShadowOrderInput) {
  await ensureShadowAccount();
  const normalized = normalizeShadowOrderInput(input);
  if (normalized.source !== "automation") {
    await assertIbkrGatewayTradingAvailable();
  }
  const plan = await buildShadowFillPlan(normalized);
  return {
    accountId: SHADOW_ACCOUNT_ID,
    mode: normalized.mode ?? "paper",
    symbol: normalized.symbol,
    assetClass: normalized.assetClass,
    resolvedContractId: Number(
      asOptionContract(normalized.optionContract)?.providerContractId ?? 0,
    ),
    fillPrice: plan.price,
    fees: plan.fees,
    estimatedGrossAmount: plan.grossAmount,
    estimatedCashDelta: plan.cashDelta,
    orderPayload: {
      accountId: SHADOW_ACCOUNT_ID,
      symbol: normalized.symbol,
      assetClass: normalized.assetClass,
      side: normalized.side,
      type: normalized.type,
      quantity: normalized.quantity,
      limitPrice: normalized.limitPrice ?? null,
      stopPrice: normalized.stopPrice ?? null,
      timeInForce: normalized.timeInForce,
      optionContract: optionPayload(asOptionContract(normalized.optionContract)),
      source: normalized.source ?? "manual",
      fillModel: "internal_shadow_ledger",
      feeModel: "ibkr_pro_fixed",
      quoteSource: plan.markSource,
    },
    optionContract: optionPayload(asOptionContract(normalized.optionContract)),
  };
}

export async function placeShadowOrder(input: ShadowOrderInput) {
  await ensureShadowAccount();
  const normalized = normalizeShadowOrderInput(input);
  if (normalized.source !== "automation") {
    await assertIbkrGatewayTradingAvailable();
  }

  if (normalized.sourceEventId) {
    const [existing] = await db
      .select()
      .from(shadowOrdersTable)
      .where(eq(shadowOrdersTable.sourceEventId, normalized.sourceEventId))
      .limit(1);
    if (existing) {
      return orderRowToResponse(existing);
    }
  }

  const plan = await buildShadowFillPlan(normalized);
  const now = normalized.placedAt ?? new Date();
  const orderId = randomUUID();
  const fillId = randomUUID();
  const optionContract = asOptionContract(normalized.optionContract);
  const quantity = toNumber(normalized.quantity) ?? 0;
  const symbol = normalizeSymbol(normalized.symbol).toUpperCase();

  await db.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(shadowAccountsTable)
      .where(eq(shadowAccountsTable.id, SHADOW_ACCOUNT_ID))
      .limit(1);
    if (!account) {
      throw new HttpError(500, "Shadow account is missing.", {
        code: "shadow_account_missing",
        expose: true,
      });
    }

    const currentCash = toNumber(account.cash) ?? SHADOW_STARTING_BALANCE;
    const nextCash = currentCash + plan.cashDelta;
    if (nextCash < -0.000001) {
      throw new HttpError(409, "Shadow account has insufficient cash for this fill.", {
        code: "shadow_insufficient_cash",
        expose: true,
      });
    }

    await tx.insert(shadowOrdersTable).values({
      id: orderId,
      accountId: SHADOW_ACCOUNT_ID,
      source: normalized.source ?? "manual",
      sourceEventId: normalized.sourceEventId ?? null,
      clientOrderId:
        normalized.clientOrderId ??
        `shadow-${normalized.source ?? "manual"}-${orderId}`,
      symbol,
      assetClass: normalized.assetClass,
      side: normalized.side,
      type: normalized.type,
      timeInForce: normalized.timeInForce,
      status: "filled",
      quantity: money(quantity),
      filledQuantity: money(quantity),
      limitPrice: normalized.limitPrice == null ? null : money(normalized.limitPrice),
      stopPrice: normalized.stopPrice == null ? null : money(normalized.stopPrice),
      averageFillPrice: money(plan.price),
      fees: money(plan.fees),
      optionContract: optionPayload(optionContract),
      payload: normalized.payload ?? {},
      placedAt: now,
      filledAt: now,
    });

    await tx.insert(shadowFillsTable).values({
      id: fillId,
      accountId: SHADOW_ACCOUNT_ID,
      orderId,
      sourceEventId: normalized.sourceEventId ?? null,
      symbol,
      assetClass: normalized.assetClass,
      side: normalized.side,
      quantity: money(quantity),
      price: money(plan.price),
      grossAmount: money(plan.grossAmount),
      fees: money(plan.fees),
      realizedPnl: money(plan.realizedPnl),
      cashDelta: money(plan.cashDelta),
      optionContract: optionPayload(optionContract),
      occurredAt: now,
    });

    await upsertPositionForFill(tx, {
      symbol,
      assetClass: normalized.assetClass,
      optionContract,
      positionKey: plan.positionKey,
      side: normalized.side,
      quantity,
      price: plan.price,
      fees: plan.fees,
      realizedPnl: plan.realizedPnl,
      multiplier: plan.multiplier,
      occurredAt: now,
    });

    await tx
      .update(shadowAccountsTable)
      .set({
        cash: money(nextCash),
        realizedPnl: money((toNumber(account.realizedPnl) ?? 0) + plan.realizedPnl),
        fees: money((toNumber(account.fees) ?? 0) + plan.fees),
        updatedAt: now,
      })
      .where(eq(shadowAccountsTable.id, SHADOW_ACCOUNT_ID));
  });

  await writeShadowBalanceSnapshot(normalized.source === "automation" ? "automation" : "ledger");

  const [order] = await db
    .select()
    .from(shadowOrdersTable)
    .where(eq(shadowOrdersTable.id, orderId))
    .limit(1);
  return orderRowToResponse(order);
}

async function upsertPositionForFill(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    symbol: string;
    assetClass: ShadowAssetClass;
    optionContract: ShadowOptionContract | null;
    positionKey: string;
    side: ShadowSide;
    quantity: number;
    price: number;
    fees: number;
    realizedPnl: number;
    multiplier: number;
    occurredAt: Date;
  },
) {
  const [current] = await tx
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.positionKey, input.positionKey),
      ),
    )
    .limit(1);

  const currentQuantity = toNumber(current?.quantity) ?? 0;
  const currentAverageCost = toNumber(current?.averageCost) ?? 0;
  const currentRealized = toNumber(current?.realizedPnl) ?? 0;
  const currentFees = toNumber(current?.fees) ?? 0;

  if (input.side === "buy") {
    const nextQuantity = current?.status === "open" ? currentQuantity + input.quantity : input.quantity;
    const existingCost =
      current?.status === "open" ? currentQuantity * currentAverageCost : 0;
    const nextAverageCost =
      nextQuantity > 0
        ? (existingCost + input.quantity * input.price) / nextQuantity
        : input.price;
    const marketValue = nextQuantity * input.price * input.multiplier;
    if (current) {
      await tx
        .update(shadowPositionsTable)
        .set({
          quantity: money(nextQuantity),
          averageCost: money(nextAverageCost),
          mark: money(input.price),
          marketValue: money(marketValue),
          unrealizedPnl: money((input.price - nextAverageCost) * nextQuantity * input.multiplier),
          fees: money(currentFees + input.fees),
          openedAt:
            current.status === "open" ? current.openedAt : input.occurredAt,
          closedAt: null,
          asOf: input.occurredAt,
          status: "open",
          updatedAt: input.occurredAt,
        })
        .where(eq(shadowPositionsTable.id, current.id));
    } else {
      await tx.insert(shadowPositionsTable).values({
        accountId: SHADOW_ACCOUNT_ID,
        positionKey: input.positionKey,
        symbol: input.symbol,
        assetClass: input.assetClass,
        quantity: money(nextQuantity),
        averageCost: money(nextAverageCost),
        mark: money(input.price),
        marketValue: money(marketValue),
        unrealizedPnl: "0",
        realizedPnl: "0",
        fees: money(input.fees),
        optionContract: optionPayload(input.optionContract),
        openedAt: input.occurredAt,
        asOf: input.occurredAt,
        status: "open",
      });
    }
    return;
  }

  const nextQuantity = Math.max(0, currentQuantity - input.quantity);
  const marketValue = nextQuantity * input.price * input.multiplier;
  await tx
    .update(shadowPositionsTable)
    .set({
      quantity: money(nextQuantity),
      mark: money(input.price),
      marketValue: money(marketValue),
      unrealizedPnl: money((input.price - currentAverageCost) * nextQuantity * input.multiplier),
      realizedPnl: money(currentRealized + input.realizedPnl),
      fees: money(currentFees + input.fees),
      closedAt: nextQuantity <= 0 ? input.occurredAt : current?.closedAt ?? null,
      asOf: input.occurredAt,
      status: nextQuantity <= 0 ? "closed" : "open",
      updatedAt: input.occurredAt,
    })
    .where(eq(shadowPositionsTable.id, current!.id));
}

function normalizeShadowOrderInput(input: ShadowOrderInput): ShadowOrderInput & {
  symbol: string;
  assetClass: ShadowAssetClass;
  side: ShadowSide;
} {
  const symbol = normalizeSymbol(input.symbol).toUpperCase();
  if (!symbol) {
    throw new HttpError(400, "Shadow orders require a symbol.", {
      code: "shadow_symbol_required",
      expose: true,
    });
  }
  if (input.assetClass !== "equity" && input.assetClass !== "option") {
    throw new HttpError(400, "Shadow orders support stocks and options only.", {
      code: "shadow_asset_class_invalid",
      expose: true,
    });
  }
  if (input.side !== "buy" && input.side !== "sell") {
    throw new HttpError(400, "Shadow order side must be buy or sell.", {
      code: "shadow_side_invalid",
      expose: true,
    });
  }
  return {
    ...input,
    accountId: SHADOW_ACCOUNT_ID,
    mode: input.mode ?? "paper",
    symbol,
    assetClass: input.assetClass,
    side: input.side,
    type: input.type ?? "market",
    timeInForce: input.timeInForce ?? "day",
    source: input.source ?? "manual",
  };
}

function orderRowToResponse(order: typeof shadowOrdersTable.$inferSelect | undefined) {
  if (!order) {
    throw new HttpError(500, "Shadow order was not recorded.", {
      code: "shadow_order_missing",
      expose: true,
    });
  }
  const metadata = shadowSourceMetadata(order);
  return {
    id: order.id,
    accountId: order.accountId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    assetClass: order.assetClass,
    quantity: toNumber(order.quantity) ?? 0,
    filledQuantity: toNumber(order.filledQuantity) ?? 0,
    limitPrice: toNumber(order.limitPrice),
    stopPrice: toNumber(order.stopPrice),
    timeInForce: order.timeInForce,
    status: order.status,
    placedAt: order.placedAt,
    filledAt: order.filledAt,
    updatedAt: order.updatedAt,
    averageFillPrice: toNumber(order.averageFillPrice),
    commission: toNumber(order.fees),
    source:
      order.source === "automation"
        ? "SHADOW_AUTO"
        : order.source === WATCHLIST_BACKTEST_SOURCE
          ? "SHADOW_BACKTEST"
          : "SHADOW",
    ...metadata,
  };
}

export async function refreshShadowPositionMarks() {
  await ensureShadowAccount();
  const positions = await readOpenShadowPositions();
  let updatedCount = 0;

  for (const position of positions) {
    const contract = asOptionContract(position.optionContract);
    const mark =
      position.assetClass === "option" && contract
        ? await resolveOptionMark(contract)
        : await resolveEquityMark(position.symbol);
    const price = mark.price;
    if (price == null || price <= 0) {
      continue;
    }
    const quantity = toNumber(position.quantity) ?? 0;
    const averageCost = toNumber(position.averageCost) ?? 0;
    const multiplier = marketMultiplier({
      assetClass: position.assetClass as ShadowAssetClass,
      optionContract: contract,
    });
    const marketValue = quantity * price * multiplier;
    const unrealizedPnl = (price - averageCost) * quantity * multiplier;
    await db
      .update(shadowPositionsTable)
      .set({
        mark: money(price),
        marketValue: money(marketValue),
        unrealizedPnl: money(unrealizedPnl),
        asOf: mark.asOf,
        updatedAt: new Date(),
      })
      .where(eq(shadowPositionsTable.id, position.id));
    await db.insert(shadowPositionMarksTable).values({
      accountId: SHADOW_ACCOUNT_ID,
      positionId: position.id,
      mark: money(price),
      marketValue: money(marketValue),
      unrealizedPnl: money(unrealizedPnl),
      source: mark.source,
      asOf: mark.asOf,
    });
    updatedCount += 1;
  }

  if (updatedCount) {
    await writeShadowBalanceSnapshot(
      positions.some((position) => isWatchlistBacktestPositionKey(position.positionKey))
        ? WATCHLIST_BACKTEST_MARK_SOURCE
        : "mark",
    );
  }

  return { updatedCount };
}

async function ensureFreshShadowState(refreshMarks = false) {
  await ensureShadowAccount();
  if (!refreshMarks) {
    if (shadowFreshStateInFlight) {
      return shadowFreshStateInFlight;
    }
    return computeShadowTotals();
  }

  const now = Date.now();
  if (shadowFreshStateCache && shadowFreshStateCache.expiresAt > now) {
    return shadowFreshStateCache.totals;
  }
  if (shadowFreshStateInFlight) {
    return shadowFreshStateInFlight;
  }

  shadowFreshStateInFlight = (async () => {
    await refreshShadowPositionMarks().catch((error) => {
      logger.debug?.({ err: error }, "Shadow mark refresh failed");
    });
    const totals = await computeShadowTotals();
    shadowFreshStateCache = {
      totals,
      expiresAt: Date.now() + SHADOW_STATE_REFRESH_TTL_MS,
    };
    return totals;
  })();

  try {
    return await shadowFreshStateInFlight;
  } finally {
    shadowFreshStateInFlight = null;
  }
}

function buildShadowPositionDayChange(input: {
  currentMarketValue: number | null;
  baselineMarketValue: number | null;
}): ShadowPositionDayChange {
  if (input.currentMarketValue === null || input.baselineMarketValue === null) {
    return { dayChange: null, dayChangePercent: null };
  }
  const dayChange = input.currentMarketValue - input.baselineMarketValue;
  return {
    dayChange,
    dayChangePercent: input.baselineMarketValue
      ? (dayChange / Math.abs(input.baselineMarketValue)) * 100
      : null,
  };
}

function selectLatestShadowPositionMarksByPositionId<
  T extends Pick<ShadowPositionMarkRow, "positionId" | "asOf">,
>(marks: T[]): Map<string, T> {
  const byPositionId = new Map<string, T>();
  marks.forEach((mark) => {
    const current = byPositionId.get(mark.positionId);
    if (!current || mark.asOf.getTime() > current.asOf.getTime()) {
      byPositionId.set(mark.positionId, mark);
    }
  });
  return byPositionId;
}

async function readShadowPositionDayChanges(
  positions: ShadowPositionRow[],
  now = new Date(),
): Promise<Map<string, ShadowPositionDayChange>> {
  const changes = new Map<string, ShadowPositionDayChange>();
  const marketDate = previousWeekdayOrSame(marketDateKey(now));
  const dayStart = zonedDateTimeToUtc({ marketDate, hour: 0, minute: 0 });
  const positionIds = positions.map((position) => position.id);
  const baselineMarks = positionIds.length
    ? await db
        .select()
        .from(shadowPositionMarksTable)
        .where(
          and(
            inArray(shadowPositionMarksTable.positionId, positionIds),
            lte(shadowPositionMarksTable.asOf, dayStart),
          ),
        )
    : [];
  const baselineMarksByPositionId =
    selectLatestShadowPositionMarksByPositionId(baselineMarks);

  for (const position of positions) {
    const currentAsOf = position.asOf ?? position.updatedAt ?? now;
    const quantity = toNumber(position.quantity) ?? 0;
    const averageCost = toNumber(position.averageCost) ?? 0;
    const currentMarketValue = toNumber(position.marketValue);
    const contract = asOptionContract(position.optionContract);
    const multiplier = marketMultiplier({
      assetClass: position.assetClass as ShadowAssetClass,
      optionContract: contract,
    });

    if (currentAsOf.getTime() < dayStart.getTime() || quantity <= 0) {
      changes.set(position.id, { dayChange: null, dayChangePercent: null });
      continue;
    }

    const baselineMark = baselineMarksByPositionId.get(position.id);
    const openedAt = position.openedAt ?? currentAsOf;
    const baselineMarketValue =
      toNumber(baselineMark?.marketValue) ??
      (openedAt.getTime() >= dayStart.getTime()
        ? averageCost * quantity * multiplier
        : null);

    changes.set(
      position.id,
      buildShadowPositionDayChange({
        currentMarketValue,
        baselineMarketValue,
      }),
    );
  }

  return changes;
}

function metric(
  value: number | null | undefined,
  currency: string | null,
  field: string,
  updatedAt: Date | null,
) {
  return {
    value: Number.isFinite(Number(value)) ? Number(value) : null,
    currency,
    source: "SHADOW_LEDGER",
    field,
    updatedAt,
  };
}

export async function getShadowAccountSummary() {
  const totals = await ensureFreshShadowState(true);
  const positions = await readOpenShadowPositions();
  const dayChanges = await readShadowPositionDayChanges(positions);
  const dayPnl = Array.from(dayChanges.values()).reduce(
    (sum, value) => sum + (value.dayChange ?? 0),
    0,
  );
  const totalPnl = totals.netLiquidation - totals.startingBalance;
  return {
    accountId: SHADOW_ACCOUNT_ID,
    isCombined: false,
    mode: "paper",
    currency: SHADOW_CURRENCY,
    accounts: [
      {
        id: SHADOW_ACCOUNT_ID,
        displayName: SHADOW_ACCOUNT_DISPLAY_NAME,
        currency: SHADOW_CURRENCY,
        live: false,
        accountType: "Shadow",
        updatedAt: totals.updatedAt,
      },
    ],
    updatedAt: totals.updatedAt,
    fx: {
      baseCurrency: SHADOW_CURRENCY,
      timestamp: totals.updatedAt,
      rates: { [SHADOW_CURRENCY]: 1 },
      warning: null,
    },
    badges: {
      accountTypes: ["Shadow", "Cash"],
      pdt: {
        isPatternDayTrader: null,
        dayTradesRemainingThisWeek: null,
      },
    },
    metrics: {
      netLiquidation: metric(totals.netLiquidation, SHADOW_CURRENCY, "NetLiquidation", totals.updatedAt),
      totalCash: metric(totals.cash, SHADOW_CURRENCY, "Cash", totals.updatedAt),
      buyingPower: metric(totals.cash, SHADOW_CURRENCY, "BuyingPower", totals.updatedAt),
      marginUsed: metric(0, SHADOW_CURRENCY, "MarginUsed", totals.updatedAt),
      maintenanceMargin: metric(0, SHADOW_CURRENCY, "MaintenanceMargin", totals.updatedAt),
      maintenanceMarginCushionPercent: metric(null, null, "CashAccount", totals.updatedAt),
      dayPnl: metric(dayPnl, SHADOW_CURRENCY, "DailyMarkChange", totals.updatedAt),
      dayPnlPercent: metric(
        totals.netLiquidation ? (dayPnl / totals.netLiquidation) * 100 : null,
        null,
        "DailyMarkChange/NetLiquidation",
        totals.updatedAt,
      ),
      totalPnl: metric(totalPnl, SHADOW_CURRENCY, "ChangeInNAV", totals.updatedAt),
      totalPnlPercent: metric(
        totals.startingBalance ? (totalPnl / totals.startingBalance) * 100 : null,
        null,
        "ChangeInNAV/InitialNAV",
        totals.updatedAt,
      ),
      settledCash: metric(totals.cash, SHADOW_CURRENCY, "SettledCash", totals.updatedAt),
      unsettledCash: metric(0, SHADOW_CURRENCY, "UnsettledCash", totals.updatedAt),
      sma: metric(null, SHADOW_CURRENCY, "SMA", totals.updatedAt),
      dayTradingBuyingPower: metric(totals.cash, SHADOW_CURRENCY, "DayTradingBuyingPower", totals.updatedAt),
      regTInitialMargin: metric(0, SHADOW_CURRENCY, "RegTMargin", totals.updatedAt),
      leverage: metric(
        totals.netLiquidation ? totals.marketValue / totals.netLiquidation : 0,
        null,
        "Leverage",
        totals.updatedAt,
      ),
      grossPositionValue: metric(totals.marketValue, SHADOW_CURRENCY, "GrossPositionValue", totals.updatedAt),
    },
  };
}

function isWatchlistBacktestRunSnapshotSource(source: string | null | undefined) {
  return Boolean(
    source?.startsWith(`${WATCHLIST_BACKTEST_SOURCE}:`) ||
      source?.startsWith("watchlist_bt:"),
  );
}

function isWatchlistBacktestSnapshotSource(source: string | null | undefined) {
  return (
    isWatchlistBacktestRunSnapshotSource(source) ||
    source === WATCHLIST_BACKTEST_MARK_SOURCE
  );
}

function marketDateFromCompactSource(value: string) {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : null;
}

function watchlistBacktestSnapshotSourceBounds(source: string | null | undefined) {
  if (!source) {
    return null;
  }
  const compactRange = /^watchlist_bt:(\d{8}):(\d{8})$/.exec(source);
  const compactFrom = compactRange?.[1]
    ? marketDateFromCompactSource(compactRange[1])
    : null;
  const compactTo = compactRange?.[2]
    ? marketDateFromCompactSource(compactRange[2])
    : null;
  const singleDay = /^watchlist_backtest:(\d{4}-\d{2}-\d{2})$/.exec(source);
  const from = compactFrom ?? singleDay?.[1] ?? null;
  const to = compactTo ?? singleDay?.[1] ?? null;
  if (!from || !to) {
    return null;
  }
  parseMarketDateKey(from);
  parseMarketDateKey(to);
  return {
    start: zonedDateTimeToUtc({ marketDate: from, hour: 9, minute: 30 }),
    end: zonedDateTimeToUtc({
      marketDate: addDaysToMarketDate(to, 1),
      hour: 0,
      minute: 0,
    }),
  };
}

async function resolveShadowBenchmarkPercents(input: {
  benchmark: string | null | undefined;
  range: AccountRange;
  start: Date | null;
  points: Array<{ timestamp: Date }>;
}): Promise<Array<number | null>> {
  if (!input.benchmark || input.points.length < 2) {
    return input.points.map(() => null);
  }

  try {
    const bars = await getBars({
      symbol: input.benchmark,
      timeframe: accountBenchmarkTimeframeForRange(input.range),
      from:
        input.start ??
        input.points[0]?.timestamp ??
        new Date(Date.now() - 365 * 86_400_000),
      to: input.points[input.points.length - 1]?.timestamp ?? new Date(),
      limit: accountBenchmarkLimitForRange(input.range),
      outsideRth: true,
      allowHistoricalSynthesis: true,
    });

    const sortedBars = [...bars.bars].sort(
      (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
    );
    const base = toNumber(sortedBars[0]?.close);
    if (base == null || base === 0) {
      return input.points.map(() => null);
    }

    let cursor = 0;
    return input.points.map((point) => {
      while (
        cursor + 1 < sortedBars.length &&
        sortedBars[cursor + 1]!.timestamp.getTime() <= point.timestamp.getTime()
      ) {
        cursor += 1;
      }

      const close = toNumber(sortedBars[cursor]?.close);
      return close != null ? ((close - base) / base) * 100 : null;
    });
  } catch (error) {
    logger.debug?.(
      { err: error, benchmark: input.benchmark },
      "Shadow benchmark overlay unavailable",
    );
    return input.points.map(() => null);
  }
}

function selectShadowEquityHistoryRows<
  T extends Pick<ShadowBalanceSnapshotRow, "source" | "asOf" | "createdAt">,
>(rows: T[]) {
  const backtestRows = rows.filter((row) =>
    isWatchlistBacktestRunSnapshotSource(row.source),
  );
  if (backtestRows.length) {
    const selectedSource = backtestRows
      .slice()
      .sort((left, right) => {
        const createdDelta =
          (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0);
        if (createdDelta) return createdDelta;
        return right.asOf.getTime() - left.asOf.getTime();
      })[0]!.source;
    const bounds = watchlistBacktestSnapshotSourceBounds(selectedSource);
    return {
      scope: "watchlist_backtest" as const,
      selectedSource,
      includeInitialPoint: false,
      includeLiveTerminal: false,
      rows: rows.filter(
        (row) =>
          row.source === selectedSource &&
          (!bounds || (row.asOf >= bounds.start && row.asOf <= bounds.end)),
      ),
    };
  }

  return {
    scope: "ledger" as const,
    selectedSource: null,
    includeInitialPoint: true,
    includeLiveTerminal: true,
    rows: rows.filter((row) => !isWatchlistBacktestSnapshotSource(row.source)),
  };
}

export async function getShadowAccountEquityHistory(input: {
  range?: AccountRange;
  benchmark?: string | null;
}) {
  const range = normalizeAccountRange(input.range);
  const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
  const start = accountRangeStart(range);
  const conditions: SQL<unknown>[] = [eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID)];
  if (start) {
    conditions.push(gte(shadowBalanceSnapshotsTable.asOf, start));
  }
  const rows = await db
    .select()
    .from(shadowBalanceSnapshotsTable)
    .where(and(...conditions))
    .orderBy(shadowBalanceSnapshotsTable.asOf);
  const selection = selectShadowEquityHistoryRows(rows);
  const totals = selection.includeLiveTerminal
    ? await ensureFreshShadowState(true)
    : null;
  const bucketSize = accountSnapshotBucketSizeMs(range);
  const compacted = bucketSize
    ? Array.from(
        selection.rows
          .reduce((map, row) => {
            const bucket = Math.floor(row.asOf.getTime() / bucketSize);
            map.set(bucket, row);
            return map;
          }, new Map<number, (typeof rows)[number]>())
          .values(),
      )
    : selection.rows;
  const initialPoint = {
    timestamp: account.createdAt,
    netLiquidation: toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE,
    currency: SHADOW_CURRENCY,
    source: "SHADOW_LEDGER",
    deposits: SHADOW_STARTING_BALANCE,
    withdrawals: 0,
    dividends: 0,
    fees: 0,
  };
  const rawSeedPoints = [
    ...(selection.includeInitialPoint && (!start || initialPoint.timestamp >= start)
      ? [initialPoint]
      : []),
    ...compacted.map((row) => ({
      timestamp: row.asOf,
      netLiquidation: toNumber(row.netLiquidation) ?? 0,
      currency: row.currency,
      source:
        selection.scope === "watchlist_backtest"
          ? "SHADOW_WATCHLIST_BACKTEST"
          : "SHADOW_LEDGER",
      deposits: 0,
      withdrawals: 0,
      dividends: 0,
      fees: toNumber(row.fees) ?? 0,
    })),
    ...(totals && (!start || totals.updatedAt.getTime() >= start.getTime())
      ? [
          {
            timestamp: totals.updatedAt,
            netLiquidation: totals.netLiquidation,
            currency: SHADOW_CURRENCY,
            source: "SHADOW_LEDGER",
            deposits: 0,
            withdrawals: 0,
            dividends: 0,
            fees: totals.fees,
          },
        ]
      : []),
  ];
  const seedPoints = Array.from(
    rawSeedPoints
      .reduce((map, point) => {
        map.set(point.timestamp.toISOString(), point);
        return map;
      }, new Map<string, (typeof rawSeedPoints)[number]>())
      .values(),
  ).sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const baseline =
    seedPoints.find((point) => Math.abs(point.netLiquidation) > 0)?.netLiquidation ??
    SHADOW_STARTING_BALANCE;
  const lastPoint = seedPoints[seedPoints.length - 1] ?? null;
  const tradeEvents = input.benchmark
    ? []
    : await getShadowTradeEquityEvents({
        start,
        end: lastPoint?.timestamp ?? new Date(),
      });
  const benchmarkPercents = await resolveShadowBenchmarkPercents({
    benchmark: input.benchmark,
    range,
    start,
    points: seedPoints,
  });

  return {
    accountId: SHADOW_ACCOUNT_ID,
    range,
    currency: SHADOW_CURRENCY,
    flexConfigured: true,
    lastFlexRefreshAt: null,
    benchmark: input.benchmark || null,
    asOf: lastPoint?.timestamp ?? null,
    latestSnapshotAt: compacted[compacted.length - 1]?.asOf ?? null,
    isStale: false,
    staleReason: null,
    terminalPointSource:
      selection.scope === "watchlist_backtest"
        ? "shadow_watchlist_backtest"
        : "shadow_ledger",
    liveTerminalIncluded: Boolean(totals),
    sourceScope: selection.scope,
    selectedSnapshotSource: selection.selectedSource,
    points: seedPoints.map((point, index) => ({
      ...point,
      returnPercent: baseline ? ((point.netLiquidation - baseline) / baseline) * 100 : 0,
      benchmarkPercent: benchmarkPercents[index] ?? null,
    })),
    events:
      selection.scope === "watchlist_backtest"
        ? tradeEvents
        : [
            {
              timestamp: account.createdAt,
              type: "deposit",
              amount: SHADOW_STARTING_BALANCE,
              currency: SHADOW_CURRENCY,
              source: "SHADOW_LEDGER",
            },
            ...tradeEvents,
          ],
  };
}

export async function getShadowAccountAllocation() {
  const totals = await ensureFreshShadowState(true);
  const positions = await readOpenShadowPositions();
  const assetBuckets = new Map<string, number>();
  const sectorBuckets = new Map<string, number>();
  positions.forEach((position) => {
    const value = toNumber(position.marketValue) ?? 0;
    assetBuckets.set(assetClassLabel(position), (assetBuckets.get(assetClassLabel(position)) ?? 0) + value);
    sectorBuckets.set("Shadow Holdings", (sectorBuckets.get("Shadow Holdings") ?? 0) + value);
  });
  assetBuckets.set("Cash", (assetBuckets.get("Cash") ?? 0) + totals.cash);

  const bucketRows = (buckets: Map<string, number>) =>
    Array.from(buckets.entries())
      .map(([label, value]) => ({
        label,
        value,
        weightPercent: weightPercent(value, totals.netLiquidation),
        source: label === "Cash" ? "SHADOW_CASH" : "SHADOW_LEDGER",
      }))
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));

  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    assetClass: bucketRows(assetBuckets),
    sector: bucketRows(sectorBuckets),
    exposure: {
      grossLong: totals.marketValue,
      grossShort: 0,
      netExposure: totals.marketValue,
    },
    updatedAt: totals.updatedAt,
  };
}

export async function getShadowAccountPositions(input: {
  assetClass?: string | null;
}) {
  const totals = await ensureFreshShadowState(true);
  const positions = await readOpenShadowPositions();
  const orders = await db
    .select()
    .from(shadowOrdersTable)
    .where(eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID))
    .orderBy(desc(shadowOrdersTable.placedAt))
    .limit(1000);
  const filtered =
    input.assetClass && input.assetClass !== "all"
      ? positions.filter(
          (position) =>
            assetClassLabel(position).toLowerCase() === input.assetClass?.toLowerCase(),
        )
      : positions;
  const dayChanges = await readShadowPositionDayChanges(filtered);
  const rows = filtered.map((position) => {
    const quantity = toNumber(position.quantity) ?? 0;
    const averageCost = toNumber(position.averageCost) ?? 0;
    const mark = toNumber(position.mark) ?? 0;
    const unrealizedPnl = toNumber(position.unrealizedPnl) ?? 0;
    const marketValue = toNumber(position.marketValue) ?? 0;
    const dayChange = dayChanges.get(position.id) ?? {
      dayChange: null,
      dayChangePercent: null,
    };
    const attribution = buildPositionSourceAttribution(position, orders);
    return {
      id: position.id,
      accountId: SHADOW_ACCOUNT_ID,
      accounts: [SHADOW_ACCOUNT_ID],
      symbol: position.symbol,
      description: positionDescription(position),
      assetClass: assetClassLabel(position),
      optionContract: optionPayload(asOptionContract(position.optionContract)),
      sector: "Shadow Holdings",
      quantity,
      averageCost,
      mark,
      dayChange: dayChange.dayChange,
      dayChangePercent: dayChange.dayChangePercent,
      unrealizedPnl,
      unrealizedPnlPercent: averageCost ? ((mark - averageCost) / averageCost) * 100 : null,
      marketValue,
      weightPercent: weightPercent(marketValue, totals.netLiquidation),
      betaWeightedDelta: null,
      lots: [
        {
          accountId: SHADOW_ACCOUNT_ID,
          symbol: position.symbol,
          quantity,
          averageCost,
          marketPrice: mark,
          marketValue,
          unrealizedPnl,
          asOf: position.asOf,
          source: "SHADOW_LEDGER",
        },
      ],
      openOrders: [],
      source: "SHADOW_LEDGER",
      ...attribution,
    };
  });

  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    positions: rows,
    totals: {
      weightPercent: rows.reduce((sum, row) => sum + (row.weightPercent ?? 0), 0),
      unrealizedPnl: rows.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      grossLong: totals.marketValue,
      grossShort: 0,
      netExposure: totals.marketValue,
    },
    updatedAt: totals.updatedAt,
  };
}

export async function getShadowAccountPositionsAtDate(input: {
  date: string | Date;
  assetClass?: string | null;
}) {
  const window = shadowDateWindowUtc(input.date);
  const account = (await readShadowAccount()) ?? (await ensureShadowAccount());
  const fills = await db
    .select()
    .from(shadowFillsTable)
    .where(
      and(
        eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID),
        lte(shadowFillsTable.occurredAt, window.end),
      ),
    )
    .orderBy(shadowFillsTable.occurredAt);
  const orderIds = Array.from(new Set(fills.map((fill) => fill.orderId)));
  const orders = orderIds.length
    ? await db
        .select()
        .from(shadowOrdersTable)
        .where(inArray(shadowOrdersTable.id, orderIds))
    : [];
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const books = new Map<
    string,
    {
      symbol: string;
      assetClass: ShadowAssetClass;
      optionContract: ShadowOptionContract | null;
      quantity: number;
      totalCost: number;
      mark: number;
      sourceType: string;
      strategyLabel: string | null;
    }
  >();

  fills.forEach((fill) => {
    const contract = asOptionContract(fill.optionContract);
    const assetClass = fill.assetClass as ShadowAssetClass;
    const key = positionKey({
      symbol: fill.symbol,
      assetClass,
      optionContract: contract,
    });
    const multiplier = marketMultiplier({ assetClass, optionContract: contract });
    const quantity = Math.abs(toNumber(fill.quantity) ?? 0);
    const price = toNumber(fill.price) ?? 0;
    const metadata = shadowSourceMetadata(ordersById.get(fill.orderId));
    const current = books.get(key) ?? {
      symbol: fill.symbol,
      assetClass,
      optionContract: contract,
      quantity: 0,
      totalCost: 0,
      mark: price,
      sourceType: metadata.sourceType,
      strategyLabel: metadata.strategyLabel,
    };
    if (fill.side === "buy") {
      current.quantity += quantity;
      current.totalCost += quantity * price * multiplier;
    } else {
      const closeQuantity = Math.min(quantity, Math.abs(current.quantity));
      const averageCost =
        Math.abs(current.quantity) > 0
          ? current.totalCost / Math.abs(current.quantity)
          : price * multiplier;
      current.quantity -= closeQuantity;
      current.totalCost = Math.max(0, current.totalCost - averageCost * closeQuantity);
    }
    current.mark = price;
    current.sourceType = metadata.sourceType;
    current.strategyLabel = metadata.strategyLabel;
    books.set(key, current);
  });

  const cash =
    (toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE) +
    fills.reduce((sum, fill) => sum + (toNumber(fill.cashDelta) ?? 0), 0);
  const rawPositions = Array.from(books.entries()).filter(
    ([, book]) => Math.abs(book.quantity) > 1e-8,
  );
  const filteredPositions =
    input.assetClass && input.assetClass !== "all"
      ? rawPositions.filter(
          ([, book]) =>
            assetClassLabel(book).toLowerCase() === input.assetClass?.toLowerCase(),
        )
      : rawPositions;
  const marketValueTotal = filteredPositions.reduce((sum, [, book]) => {
    const multiplier = marketMultiplier({
      assetClass: book.assetClass,
      optionContract: book.optionContract,
    });
    return sum + book.quantity * book.mark * multiplier;
  }, 0);
  const nav = cash + marketValueTotal;
  const positions = filteredPositions.map(([key, book]) => {
    const multiplier = marketMultiplier({
      assetClass: book.assetClass,
      optionContract: book.optionContract,
    });
    const averageCost =
      Math.abs(book.quantity) > 0 ? book.totalCost / Math.abs(book.quantity) / multiplier : 0;
    const marketValue = book.quantity * book.mark * multiplier;
    const unrealizedPnl = marketValue - book.totalCost;
    return {
      id: `SHADOW:${key}:${window.date}`,
      accountId: SHADOW_ACCOUNT_ID,
      accounts: [SHADOW_ACCOUNT_ID],
      symbol: book.symbol,
      description: book.optionContract
        ? `${book.optionContract.underlying} ${optionDateKey(book.optionContract.expirationDate)} ${book.optionContract.strike} ${String(book.optionContract.right).toUpperCase()}`
        : book.symbol,
      assetClass: assetClassLabel(book),
      optionContract: optionPayload(book.optionContract),
      sector: "Shadow Holdings",
      quantity: book.quantity,
      averageCost,
      mark: book.mark,
      dayChange: null,
      dayChangePercent: null,
      unrealizedPnl,
      unrealizedPnlPercent:
        book.totalCost > 0 ? (unrealizedPnl / Math.abs(book.totalCost)) * 100 : 0,
      marketValue,
      weightPercent: weightPercent(marketValue, nav),
      betaWeightedDelta: null,
      lots: [
        {
          accountId: SHADOW_ACCOUNT_ID,
          symbol: book.symbol,
          quantity: book.quantity,
          averageCost,
          marketPrice: book.mark,
          marketValue,
          unrealizedPnl,
          asOf: window.end,
          source: "SHADOW_LEDGER",
        },
      ],
      openOrders: [],
      source: "SHADOW_LEDGER",
      sourceType: book.sourceType,
      strategyLabel: book.strategyLabel,
      attributionStatus: book.sourceType ? "attributed" : "unknown",
      sourceAttribution: [],
    };
  });
  const dayFills = fills.filter(
    (fill) =>
      fill.occurredAt.getTime() >= window.start.getTime() &&
      fill.occurredAt.getTime() < window.end.getTime(),
  );
  const activity = [
    ...(account.createdAt.getTime() >= window.start.getTime() &&
    account.createdAt.getTime() < window.end.getTime()
      ? [
          {
            id: "shadow-starting-balance",
            timestamp: account.createdAt,
            type: "deposit",
            symbol: null,
            side: null,
            amount: toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE,
            quantity: null,
            price: null,
            realizedPnl: null,
            fees: null,
            currency: SHADOW_CURRENCY,
            source: "SHADOW_LEDGER",
          },
        ]
      : []),
    ...dayFills.map((fill) => {
      const metadata = shadowSourceMetadata(ordersById.get(fill.orderId));
      return {
        id: fill.id,
        timestamp: fill.occurredAt,
        type: fill.side === "buy" ? "trade_buy" : "trade_sell",
        symbol: fill.symbol,
        side: fill.side,
        amount: toNumber(fill.cashDelta),
        quantity: Math.abs(toNumber(fill.quantity) ?? 0),
        price: toNumber(fill.price),
        realizedPnl: toNumber(fill.realizedPnl),
        fees: toNumber(fill.fees),
        currency: SHADOW_CURRENCY,
        source: metadata.strategyLabel || metadata.sourceType || "SHADOW_LEDGER",
      };
    }),
  ].sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  return {
    accountId: SHADOW_ACCOUNT_ID,
    date: window.date,
    currency: SHADOW_CURRENCY,
    status: positions.length || activity.length ? "historical" : "unavailable",
    snapshotDate: positions.length ? window.end : null,
    message:
      positions.length || activity.length
        ? null
        : "No shadow account positions or activity exist for this date.",
    positions,
    activity,
    totals: {
      weightPercent: positions.reduce((sum, row) => sum + (row.weightPercent ?? 0), 0),
      unrealizedPnl: positions.reduce((sum, row) => sum + row.unrealizedPnl, 0),
      grossLong: positions
        .filter((row) => row.marketValue > 0)
        .reduce((sum, row) => sum + row.marketValue, 0),
      grossShort: positions
        .filter((row) => row.marketValue < 0)
        .reduce((sum, row) => sum + Math.abs(row.marketValue), 0),
      netExposure: positions.reduce((sum, row) => sum + row.marketValue, 0),
    },
    updatedAt: new Date(),
  };
}

export async function getShadowAccountClosedTrades(input: {
  from?: Date | null;
  to?: Date | null;
  symbol?: string | null;
  assetClass?: string | null;
  pnlSign?: string | null;
}) {
  await ensureShadowAccount();
  const conditions: SQL<unknown>[] = [
    eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID),
    eq(shadowFillsTable.side, "sell"),
  ];
  if (input.from) conditions.push(gte(shadowFillsTable.occurredAt, input.from));
  if (input.to) conditions.push(lte(shadowFillsTable.occurredAt, input.to));
  if (input.symbol) conditions.push(eq(shadowFillsTable.symbol, normalizeSymbol(input.symbol).toUpperCase()));
  const fills = await db
    .select()
    .from(shadowFillsTable)
    .where(and(...conditions))
    .orderBy(desc(shadowFillsTable.occurredAt))
    .limit(500);
  const orderIds = fills.map((fill) => fill.orderId);
  const orders = orderIds.length
    ? await db
        .select()
        .from(shadowOrdersTable)
        .where(inArray(shadowOrdersTable.id, orderIds))
    : [];
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const trades = fills
    .map((fill) => fillRowToClosedTrade(fill, ordersById.get(fill.orderId)))
    .filter((trade) => {
      if (
        input.assetClass &&
        input.assetClass !== "all" &&
        trade.assetClass.toLowerCase() !== input.assetClass.toLowerCase()
      ) {
        return false;
      }
      if (input.pnlSign === "winners" && (trade.realizedPnl ?? 0) <= 0) return false;
      if (input.pnlSign === "losers" && (trade.realizedPnl ?? 0) >= 0) return false;
      return true;
    });
  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    trades,
    summary: {
      count: trades.length,
      winners: trades.filter((trade) => (trade.realizedPnl ?? 0) > 0).length,
      losers: trades.filter((trade) => (trade.realizedPnl ?? 0) < 0).length,
      realizedPnl: trades.reduce((sum, trade) => sum + (trade.realizedPnl ?? 0), 0),
      commissions: trades.reduce((sum, trade) => sum + (trade.commissions ?? 0), 0),
    },
    updatedAt: new Date(),
  };
}

function fillRowToClosedTrade(fill: ShadowFillRow, order?: ShadowOrderRow) {
  const quantity = toNumber(fill.quantity) ?? 0;
  const price = toNumber(fill.price);
  const realizedPnl = toNumber(fill.realizedPnl);
  const contract = asOptionContract(fill.optionContract);
  const multiplier = marketMultiplier({
    assetClass: fill.assetClass as ShadowAssetClass,
    optionContract: contract,
  });
  const avgOpen =
    price != null && realizedPnl != null && quantity > 0
      ? price - realizedPnl / (quantity * multiplier)
      : null;
  const metadata = shadowSourceMetadata(order);
  return {
    id: fill.id,
    source: "SHADOW",
    accountId: SHADOW_ACCOUNT_ID,
    symbol: fill.symbol,
    side: fill.side,
    assetClass: fill.assetClass === "option" ? "Options" : "Stocks",
    quantity,
    openDate: null,
    closeDate: fill.occurredAt,
    avgOpen,
    avgClose: price,
    realizedPnl,
    realizedPnlPercent: avgOpen && price ? ((price - avgOpen) / avgOpen) * 100 : null,
    holdDurationMinutes: null,
    commissions: toNumber(fill.fees),
    currency: SHADOW_CURRENCY,
    ...metadata,
  };
}

type ShadowAnalysisTradeEvent = {
  id: string;
  orderId: string;
  accountId: string;
  symbol: string;
  side: ShadowSide;
  assetClass: string;
  quantity: number;
  price: number;
  grossAmount: number;
  fees: number;
  realizedPnl: number;
  cashDelta: number;
  occurredAt: string;
  occurredAtDate: Date;
  sourceType: "manual" | "automation" | "watchlist_backtest";
  strategyLabel: string | null;
  candidateId: string | null;
  deploymentId: string | null;
  deploymentName: string | null;
  sourceEventId: string | null;
  metadata: Record<string, unknown>;
};

type ShadowAnalysisRoundTrip = {
  id: string;
  symbol: string;
  assetClass: string;
  quantity: number;
  openDate: string | null;
  closeDate: string;
  avgOpen: number | null;
  avgClose: number;
  realizedPnl: number;
  realizedPnlPercent: number | null;
  fees: number;
  holdDurationMinutes: number | null;
  sourceType: ShadowAnalysisTradeEvent["sourceType"];
  strategyLabel: string | null;
  candidateId: string | null;
  metadata: Record<string, unknown>;
};

type ShadowAnalysisOpenLot = {
  symbol: string;
  assetClass: string;
  quantity: number;
  entryPrice: number;
  entryAt: Date;
  fees: number;
  sourceType: ShadowAnalysisTradeEvent["sourceType"];
  strategyLabel: string | null;
  candidateId: string | null;
  metadata: Record<string, unknown>;
};

const SHADOW_ANALYSIS_VERSION = 1;

function shadowAnalysisRangeWindow(range: AccountRange) {
  const windowEnd = new Date();
  return {
    windowStart: accountRangeStart(range, windowEnd),
    windowEnd,
  };
}

function shadowAnalysisJsonDate(date: Date | null | undefined) {
  return date ? date.toISOString() : null;
}

function shadowAnalysisEventMetadata(order?: ShadowOrderRow | null) {
  const payload = readRecord(order?.payload) ?? {};
  return {
    payload,
    metadata: readRecord(payload.metadata) ?? {},
    candidate: readRecord(payload.candidate) ?? readRecord(payload.automationCandidate) ?? {},
    position: readRecord(payload.position) ?? {},
  };
}

function shadowAnalysisTradeEvent(
  fill: ShadowFillRow,
  order?: ShadowOrderRow | null,
): ShadowAnalysisTradeEvent {
  const sourceMetadata = shadowSourceMetadata(order);
  const payloadParts = shadowAnalysisEventMetadata(order);
  const metadata = {
    ...payloadParts.metadata,
    candidate: payloadParts.candidate,
    position: payloadParts.position,
  };
  return {
    id: fill.id,
    orderId: fill.orderId,
    accountId: fill.accountId,
    symbol: normalizeSymbol(fill.symbol).toUpperCase(),
    side: fill.side as ShadowSide,
    assetClass: fill.assetClass,
    quantity: Math.abs(toNumber(fill.quantity) ?? 0),
    price: toNumber(fill.price) ?? 0,
    grossAmount: toNumber(fill.grossAmount) ?? 0,
    fees: toNumber(fill.fees) ?? 0,
    realizedPnl: toNumber(fill.realizedPnl) ?? 0,
    cashDelta: toNumber(fill.cashDelta) ?? 0,
    occurredAt: fill.occurredAt.toISOString(),
    occurredAtDate: fill.occurredAt,
    sourceType: sourceMetadata.sourceType,
    strategyLabel: sourceMetadata.strategyLabel,
    candidateId: sourceMetadata.candidateId,
    deploymentId: sourceMetadata.deploymentId,
    deploymentName: sourceMetadata.deploymentName,
    sourceEventId: sourceMetadata.sourceEventId,
    metadata,
  };
}

function isDateInShadowAnalysisWindow(
  date: Date,
  input: { windowStart: Date | null; windowEnd: Date },
) {
  return (!input.windowStart || date >= input.windowStart) && date <= input.windowEnd;
}

function sourceStatKey(value: Pick<ShadowAnalysisTradeEvent, "sourceType" | "strategyLabel">) {
  return `${value.sourceType}:${value.strategyLabel ?? value.sourceType}`;
}

function profitFactorFromValues(values: number[]) {
  const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(
    values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0),
  );
  if (!losses) {
    return gains > 0 ? null : 0;
  }
  return gains / losses;
}

function summarizeRoundTrips(roundTrips: ShadowAnalysisRoundTrip[]) {
  const pnls = roundTrips.map((trade) => trade.realizedPnl);
  const winners = pnls.filter((value) => value > 0);
  const losers = pnls.filter((value) => value < 0);
  return {
    closedTrades: roundTrips.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRatePercent: roundTrips.length ? (winners.length / roundTrips.length) * 100 : null,
    realizedPnl: pnls.reduce((sum, value) => sum + value, 0),
    fees: roundTrips.reduce((sum, trade) => sum + trade.fees, 0),
    averageWin: winners.length
      ? winners.reduce((sum, value) => sum + value, 0) / winners.length
      : null,
    averageLoss: losers.length
      ? losers.reduce((sum, value) => sum + value, 0) / losers.length
      : null,
    expectancy: roundTrips.length
      ? pnls.reduce((sum, value) => sum + value, 0) / roundTrips.length
      : null,
    profitFactor: profitFactorFromValues(pnls),
    payoffRatio:
      winners.length && losers.length
        ? (winners.reduce((sum, value) => sum + value, 0) / winners.length) /
          Math.abs(losers.reduce((sum, value) => sum + value, 0) / losers.length)
        : null,
    averageHoldMinutes: averageWatchlistBacktestValues(
      roundTrips
        .map((trade) => trade.holdDurationMinutes)
        .filter((value): value is number => value != null),
    ),
  };
}

function buildShadowAnalysisRoundTrips(events: ShadowAnalysisTradeEvent[]) {
  const lotsByKey = new Map<string, ShadowAnalysisOpenLot[]>();
  const roundTrips: ShadowAnalysisRoundTrip[] = [];
  const anomalies: Array<Record<string, unknown>> = [];

  for (const event of events) {
    const key = `${event.assetClass}:${event.symbol}`;
    const lots = lotsByKey.get(key) ?? [];
    lotsByKey.set(key, lots);
    if (event.side === "buy") {
      lots.push({
        symbol: event.symbol,
        assetClass: event.assetClass,
        quantity: event.quantity,
        entryPrice: event.price,
        entryAt: event.occurredAtDate,
        fees: event.fees,
        sourceType: event.sourceType,
        strategyLabel: event.strategyLabel,
        candidateId: event.candidateId,
        metadata: event.metadata,
      });
      continue;
    }

    let remaining = event.quantity;
    let matchedQuantity = 0;
    let entryValue = 0;
    let entryFees = 0;
    let earliestEntry: Date | null = null;
    while (remaining > 0.000001 && lots.length) {
      const lot = lots[0]!;
      const closeQuantity = Math.min(remaining, lot.quantity);
      const closeRatio = lot.quantity > 0 ? closeQuantity / lot.quantity : 0;
      matchedQuantity += closeQuantity;
      entryValue += closeQuantity * lot.entryPrice;
      entryFees += lot.fees * closeRatio;
      if (!earliestEntry || lot.entryAt.getTime() < earliestEntry.getTime()) {
        earliestEntry = lot.entryAt;
      }
      lot.quantity -= closeQuantity;
      lot.fees -= lot.fees * closeRatio;
      remaining -= closeQuantity;
      if (lot.quantity <= 0.000001) {
        lots.shift();
      }
    }

    if (remaining > 0.000001) {
      anomalies.push({
        type: "sell_without_open_lot",
        symbol: event.symbol,
        quantity: remaining,
        occurredAt: event.occurredAt,
        fillId: event.id,
      });
    }

    const avgOpen = matchedQuantity > 0 ? entryValue / matchedQuantity : null;
    const realizedPnlPercent =
      avgOpen && event.price
        ? ((event.price - avgOpen) / Math.abs(avgOpen)) * 100
        : null;
    roundTrips.push({
      id: event.id,
      symbol: event.symbol,
      assetClass: event.assetClass,
      quantity: event.quantity,
      openDate: shadowAnalysisJsonDate(earliestEntry),
      closeDate: event.occurredAt,
      avgOpen,
      avgClose: event.price,
      realizedPnl: event.realizedPnl,
      realizedPnlPercent,
      fees: event.fees + entryFees,
      holdDurationMinutes: earliestEntry
        ? (event.occurredAtDate.getTime() - earliestEntry.getTime()) / 60_000
        : null,
      sourceType: event.sourceType,
      strategyLabel: event.strategyLabel,
      candidateId: event.candidateId,
      metadata: event.metadata,
    });
  }

  const openLots = Array.from(lotsByKey.values()).flat();
  return { roundTrips, openLots, anomalies };
}

function weekdayForShadowAnalysis(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: WATCHLIST_BACKTEST_TIME_ZONE,
    weekday: "short",
  }).format(date);
}

function buildShadowAnalysisGroupStats(
  roundTrips: ShadowAnalysisRoundTrip[],
  events: ShadowAnalysisTradeEvent[],
  openLots: ShadowAnalysisOpenLot[],
) {
  const eventsBySymbol = new Map<string, ShadowAnalysisTradeEvent[]>();
  events.forEach((event) => {
    const list = eventsBySymbol.get(event.symbol) ?? [];
    list.push(event);
    eventsBySymbol.set(event.symbol, list);
  });

  const tradesBySymbol = new Map<string, ShadowAnalysisRoundTrip[]>();
  roundTrips.forEach((trade) => {
    const list = tradesBySymbol.get(trade.symbol) ?? [];
    list.push(trade);
    tradesBySymbol.set(trade.symbol, list);
  });

  const tickerStats = Array.from(
    new Set([...eventsBySymbol.keys(), ...tradesBySymbol.keys(), ...openLots.map((lot) => lot.symbol)]),
  )
    .map((symbol) => {
      const symbolTrades = tradesBySymbol.get(symbol) ?? [];
      const symbolEvents = eventsBySymbol.get(symbol) ?? [];
      const summary = summarizeRoundTrips(symbolTrades);
      const symbolOpenLots = openLots.filter((lot) => lot.symbol === symbol);
      const bestTrade = [...symbolTrades].sort((left, right) => right.realizedPnl - left.realizedPnl)[0] ?? null;
      const worstTrade = [...symbolTrades].sort((left, right) => left.realizedPnl - right.realizedPnl)[0] ?? null;
      return {
        symbol,
        tradeEvents: symbolEvents.length,
        buyEvents: symbolEvents.filter((event) => event.side === "buy").length,
        sellEvents: symbolEvents.filter((event) => event.side === "sell").length,
        openQuantity: symbolOpenLots.reduce((sum, lot) => sum + lot.quantity, 0),
        openLots: symbolOpenLots.length,
        ...summary,
        bestTrade,
        worstTrade,
      };
    })
    .sort((left, right) => right.realizedPnl - left.realizedPnl);

  const sourceMap = new Map<string, ShadowAnalysisRoundTrip[]>();
  roundTrips.forEach((trade) => {
    const key = sourceStatKey(trade);
    const list = sourceMap.get(key) ?? [];
    list.push(trade);
    sourceMap.set(key, list);
  });
  const sourceStats = Array.from(sourceMap.entries())
    .map(([key, trades]) => {
      const [sourceType, ...labelParts] = key.split(":");
      return {
        key,
        sourceType,
        label: labelParts.join(":") || sourceType,
        ...summarizeRoundTrips(trades),
      };
    })
    .sort((left, right) => right.realizedPnl - left.realizedPnl);

  const byHour = new Map<string, ShadowAnalysisRoundTrip[]>();
  const byWeekday = new Map<string, ShadowAnalysisRoundTrip[]>();
  roundTrips.forEach((trade) => {
    const closeDate = new Date(trade.closeDate);
    const parts = timeZoneParts(closeDate);
    const hourKey = String(parts.hour).padStart(2, "0");
    const hourRows = byHour.get(hourKey) ?? [];
    hourRows.push(trade);
    byHour.set(hourKey, hourRows);
    const weekday = weekdayForShadowAnalysis(closeDate);
    const weekdayRows = byWeekday.get(weekday) ?? [];
    weekdayRows.push(trade);
    byWeekday.set(weekday, weekdayRows);
  });

  return {
    tickerStats,
    sourceStats,
    timeStats: {
      byHour: Array.from(byHour.entries()).map(([hour, trades]) => ({
        hour,
        ...summarizeRoundTrips(trades),
      })),
      byWeekday: Array.from(byWeekday.entries()).map(([weekday, trades]) => ({
        weekday,
        ...summarizeRoundTrips(trades),
      })),
    },
  };
}

function buildShadowEquityAnnotations(events: ShadowAnalysisTradeEvent[]) {
  return events.map((event) => ({
    id: event.id,
    timestamp: event.occurredAt,
    type: event.side === "buy" ? "trade_buy" : "trade_sell",
    amount: event.cashDelta,
    currency: SHADOW_CURRENCY,
    source: event.strategyLabel || event.sourceType,
    symbol: event.symbol,
    side: event.side,
    quantity: event.quantity,
    price: event.price,
    fees: event.fees,
    realizedPnl: event.realizedPnl,
    sourceType: event.sourceType,
    strategyLabel: event.strategyLabel,
    candidateId: event.candidateId,
    metadata: event.metadata,
  }));
}

function buildShadowTradingPatternsFromRows(input: {
  range: AccountRange;
  windowStart: Date | null;
  windowEnd: Date;
  fills: ShadowFillRow[];
  ordersById: Map<string, ShadowOrderRow>;
  snapshot?: {
    id: string | null;
    persisted: boolean;
    createdAt: Date | null;
  };
}) {
  const allEvents = input.fills
    .map((fill) => shadowAnalysisTradeEvent(fill, input.ordersById.get(fill.orderId)))
    .sort((left, right) => left.occurredAtDate.getTime() - right.occurredAtDate.getTime());
  const { roundTrips, openLots, anomalies } = buildShadowAnalysisRoundTrips(allEvents);
  const tradeEvents = allEvents.filter((event) =>
    isDateInShadowAnalysisWindow(event.occurredAtDate, input),
  );
  const closedRoundTrips = roundTrips.filter((trade) =>
    isDateInShadowAnalysisWindow(new Date(trade.closeDate), input),
  );
  const groupStats = buildShadowAnalysisGroupStats(
    closedRoundTrips,
    tradeEvents,
    openLots,
  );
  const summary = {
    version: SHADOW_ANALYSIS_VERSION,
    accountId: SHADOW_ACCOUNT_ID,
    range: input.range,
    windowStart: shadowAnalysisJsonDate(input.windowStart),
    windowEnd: input.windowEnd.toISOString(),
    symbolsTraded: groupStats.tickerStats.length,
    tradeEvents: tradeEvents.length,
    buyEvents: tradeEvents.filter((event) => event.side === "buy").length,
    sellEvents: tradeEvents.filter((event) => event.side === "sell").length,
    openLots: openLots.length,
    anomalies: anomalies.length,
    ...summarizeRoundTrips(closedRoundTrips),
    bestTicker: groupStats.tickerStats[0] ?? null,
    worstTicker:
      [...groupStats.tickerStats].sort((left, right) => left.realizedPnl - right.realizedPnl)[0] ??
      null,
    bestTrade:
      [...closedRoundTrips].sort((left, right) => right.realizedPnl - left.realizedPnl)[0] ??
      null,
    worstTrade:
      [...closedRoundTrips].sort((left, right) => left.realizedPnl - right.realizedPnl)[0] ??
      null,
  };
  const equityAnnotations = buildShadowEquityAnnotations(tradeEvents);
  const packet = {
    snapshot: {
      id: input.snapshot?.id ?? null,
      persisted: input.snapshot?.persisted ?? false,
      createdAt: shadowAnalysisJsonDate(input.snapshot?.createdAt ?? null),
    },
    context: {
      accountId: SHADOW_ACCOUNT_ID,
      currency: SHADOW_CURRENCY,
      range: input.range,
      sourceScope: "shadow",
      windowStart: shadowAnalysisJsonDate(input.windowStart),
      windowEnd: input.windowEnd.toISOString(),
      generatedAt: new Date().toISOString(),
    },
    summary,
    tickerStats: groupStats.tickerStats,
    sourceStats: groupStats.sourceStats,
    timeStats: groupStats.timeStats,
    equityAnnotations,
    tradeEvents,
    roundTrips: closedRoundTrips,
    openLots,
    anomalies,
    fullPacketIncluded: true,
  };
  return packet;
}

function shadowAnalysisSnapshotToResponse(row: ShadowPortfolioAnalysisSnapshotRow) {
  const packet = readRecord(row.fullPacket) ?? {};
  return {
    ...packet,
    snapshot: {
      ...(readRecord(packet.snapshot) ?? {}),
      id: row.id,
      persisted: true,
      createdAt: row.createdAt.toISOString(),
    },
  };
}

async function loadShadowAnalysisRows() {
  const fills = await db
    .select()
    .from(shadowFillsTable)
    .where(eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID))
    .orderBy(shadowFillsTable.occurredAt);
  const orderIds = Array.from(new Set(fills.map((fill) => fill.orderId)));
  const orders = orderIds.length
    ? await db
        .select()
        .from(shadowOrdersTable)
        .where(inArray(shadowOrdersTable.id, orderIds))
    : [];
  return {
    fills,
    ordersById: new Map(orders.map((order) => [order.id, order])),
  };
}

export async function computeShadowTradingPatterns(input: {
  range?: AccountRange | string | null;
} = {}) {
  await ensureShadowAccount();
  const range = normalizeAccountRange(input.range);
  const window = shadowAnalysisRangeWindow(range);
  const rows = await loadShadowAnalysisRows();
  return buildShadowTradingPatternsFromRows({
    range,
    ...window,
    fills: rows.fills,
    ordersById: rows.ordersById,
  });
}

export async function persistShadowTradingPatternsSnapshot(input: {
  range?: AccountRange | string | null;
} = {}) {
  const packet = await computeShadowTradingPatterns(input);
  const context = readRecord(packet.context) ?? {};
  const summary = readRecord(packet.summary) ?? {};
  const range = normalizeAccountRange(context.range);
  const windowStart = dateOrNull(context.windowStart);
  const windowEnd = dateOrNull(context.windowEnd) ?? new Date();
  const [row] = await db
    .insert(shadowPortfolioAnalysisSnapshotsTable)
    .values({
      accountId: SHADOW_ACCOUNT_ID,
      analysisRange: range,
      sourceScope: "shadow",
      windowStart,
      windowEnd,
      summary,
      tickerStats: Array.isArray(packet.tickerStats) ? packet.tickerStats : [],
      sourceStats: Array.isArray(packet.sourceStats) ? packet.sourceStats : [],
      timeStats: readRecord(packet.timeStats) ?? {},
      equityAnnotations: Array.isArray(packet.equityAnnotations)
        ? packet.equityAnnotations
        : [],
      tradeEvents: Array.isArray(packet.tradeEvents) ? packet.tradeEvents : [],
      fullPacket: packet,
    })
    .returning();
  return row ? shadowAnalysisSnapshotToResponse(row) : packet;
}

export async function getShadowTradingPatterns(input: {
  range?: AccountRange | string | null;
  snapshotId?: string | null;
} = {}) {
  await ensureShadowAccount();
  const range = normalizeAccountRange(input.range);
  const snapshotId = readString(input.snapshotId) ?? "latest";
  if (snapshotId !== "live") {
    const conditions =
      snapshotId === "latest"
        ? and(
            eq(shadowPortfolioAnalysisSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
            eq(shadowPortfolioAnalysisSnapshotsTable.analysisRange, range),
          )
        : and(
            eq(shadowPortfolioAnalysisSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
            eq(shadowPortfolioAnalysisSnapshotsTable.id, snapshotId),
          );
    const [row] = await db
      .select()
      .from(shadowPortfolioAnalysisSnapshotsTable)
      .where(conditions)
      .orderBy(desc(shadowPortfolioAnalysisSnapshotsTable.createdAt))
      .limit(1);
    if (row) {
      return shadowAnalysisSnapshotToResponse(row);
    }
  }
  return computeShadowTradingPatterns({ range });
}

async function getShadowTradeEquityEvents(input: {
  start?: Date | null;
  end?: Date | null;
}) {
  const conditions: SQL<unknown>[] = [
    eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID),
  ];
  if (input.start) {
    conditions.push(gte(shadowFillsTable.occurredAt, input.start));
  }
  if (input.end) {
    conditions.push(lte(shadowFillsTable.occurredAt, input.end));
  }
  const fills = await db
    .select()
    .from(shadowFillsTable)
    .where(and(...conditions))
    .orderBy(shadowFillsTable.occurredAt);
  const orderIds = Array.from(new Set(fills.map((fill) => fill.orderId)));
  const orders = orderIds.length
    ? await db
        .select()
        .from(shadowOrdersTable)
        .where(inArray(shadowOrdersTable.id, orderIds))
    : [];
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  return buildShadowEquityAnnotations(
    fills.map((fill) => shadowAnalysisTradeEvent(fill, ordersById.get(fill.orderId))),
  );
}

export async function getShadowAccountOrders(input: {
  tab?: OrderTab;
}) {
  await ensureShadowAccount();
  const tab = normalizeOrderTab(input.tab);
  const terminalStatuses = ["filled", "canceled", "rejected", "expired"];
  const orders = await db
    .select()
    .from(shadowOrdersTable)
    .where(eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID))
    .orderBy(desc(shadowOrdersTable.placedAt))
    .limit(SHADOW_ORDER_HISTORY_LIMIT);
  const filtered = orders.filter((order) =>
    tab === "working"
      ? !terminalStatuses.includes(order.status)
      : terminalStatuses.includes(order.status),
  );
  return {
    accountId: SHADOW_ACCOUNT_ID,
    tab,
    currency: SHADOW_CURRENCY,
    degraded: false,
    reason: null,
    stale: false,
    debug: null,
    orders: filtered.map(orderRowToResponse),
    updatedAt: new Date(),
  };
}

export async function getShadowAccountRisk(input: {
  totals?: Awaited<ReturnType<typeof ensureFreshShadowState>>;
  positionsResponse?: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  closedTrades?: Awaited<ReturnType<typeof getShadowAccountClosedTrades>>;
} = {}) {
  const totals = input.totals ?? (await ensureFreshShadowState(true));
  const positionsResponse =
    input.positionsResponse ?? (await getShadowAccountPositions({}));
  const closedTrades =
    input.closedTrades ?? (await getShadowAccountClosedTrades({}));
  const positionRows = positionsResponse.positions.map((position) => ({
    symbol: position.symbol,
    marketValue: position.marketValue,
    weightPercent: position.weightPercent,
    unrealizedPnl: position.unrealizedPnl,
    dayChange: position.dayChange,
    sector: position.sector,
  }));
  const realizedRows = closedTrades.trades.map((trade) => ({
    symbol: trade.symbol,
    marketValue: trade.realizedPnl ?? 0,
    weightPercent: null,
    unrealizedPnl: trade.realizedPnl ?? 0,
    sector: "Shadow Holdings",
  }));

  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    concentration: {
      topPositions: positionRows.slice(0, 5),
      sectors: [
        {
          sector: "Shadow Holdings",
          value: totals.marketValue,
          weightPercent: weightPercent(totals.marketValue, totals.netLiquidation),
        },
      ],
    },
    winnersLosers: {
      todayWinners: positionRows
        .filter((row) => (row.dayChange ?? 0) > 0)
        .sort((a, b) => (b.dayChange ?? 0) - (a.dayChange ?? 0))
        .slice(0, 5),
      todayLosers: positionRows
        .filter((row) => (row.dayChange ?? 0) < 0)
        .sort((a, b) => (a.dayChange ?? 0) - (b.dayChange ?? 0))
        .slice(0, 5),
      allTimeWinners: realizedRows
        .filter((row) => row.unrealizedPnl > 0)
        .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl)
        .slice(0, 5),
      allTimeLosers: realizedRows
        .filter((row) => row.unrealizedPnl < 0)
        .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)
        .slice(0, 5),
    },
    margin: {
      leverageRatio: totals.netLiquidation ? totals.marketValue / totals.netLiquidation : 0,
      marginUsed: 0,
      marginAvailable: totals.cash,
      maintenanceMargin: 0,
      maintenanceCushionPercent: null,
      dayTradingBuyingPower: totals.cash,
      sma: null,
      regTInitialMargin: 0,
      pdtDayTradeCount: null,
      providerFields: {
        marginUsed: "Shadow cash account",
        marginAvailable: "Cash",
        maintenanceMargin: "None",
        maintenanceCushionPercent: "Cash account",
        dayTradingBuyingPower: "Cash",
        sma: "N/A",
        regTInitialMargin: "None",
      },
    },
    greeks: {
      delta: null,
      betaWeightedDelta: null,
      gamma: null,
      theta: null,
      vega: null,
      source: "SHADOW_LEDGER",
      coverage: {
        optionPositions: positionsResponse.positions.filter(
          (position) => position.assetClass === "Options",
        ).length,
        matchedOptionPositions: 0,
      },
      perUnderlying: positionsResponse.positions.map((position) => ({
        underlying: position.symbol,
        exposure: position.marketValue,
        delta: null,
        betaWeightedDelta: null,
        gamma: null,
        theta: null,
        vega: null,
        positionCount: 1,
        optionPositionCount: position.assetClass === "Options" ? 1 : 0,
      })),
      warning: positionsResponse.positions.some((position) => position.assetClass === "Options")
        ? "Shadow option Greeks are not sourced from IBKR snapshots."
        : null,
    },
    expiryConcentration: buildShadowExpiryConcentration(positionsResponse.positions),
    updatedAt: totals.updatedAt,
  };
}

function buildShadowExpiryConcentration(
  positions: Array<{
    assetClass: string;
    id: string;
    description?: unknown;
    marketValue?: unknown;
  }>,
) {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const month = now + 30 * 86_400_000;
  const ninety = now + 90 * 86_400_000;
  const buckets = { thisWeek: 0, thisMonth: 0, next90Days: 0 };
  positions.forEach((position) => {
    if (position.assetClass !== "Options") {
      return;
    }
    const expiryMatch = String(position.description ?? "").match(/\d{4}-\d{2}-\d{2}/);
    const expiry = expiryMatch ? new Date(`${expiryMatch[0]}T00:00:00.000Z`).getTime() : null;
    const value = Math.abs(Number(position.marketValue) || 0);
    if (!expiry) {
      return;
    }
    if (expiry <= week) buckets.thisWeek += value;
    if (expiry <= month) buckets.thisMonth += value;
    if (expiry <= ninety) buckets.next90Days += value;
  });
  return buckets;
}

export async function getShadowAccountCashActivity() {
  const account = await ensureShadowAccount();
  const fills = await db
    .select()
    .from(shadowFillsTable)
    .where(eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID))
    .orderBy(desc(shadowFillsTable.occurredAt))
    .limit(200);
  const fillOrderIds = fills.map((fill) => fill.orderId);
  const orders = fillOrderIds.length
    ? await db
        .select()
        .from(shadowOrdersTable)
        .where(inArray(shadowOrdersTable.id, fillOrderIds))
    : [];
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const feesYtd = fills.reduce((sum, fill) => sum + Math.abs(toNumber(fill.fees) ?? 0), 0);
  const totals = await computeShadowTotals();
  return {
    accountId: SHADOW_ACCOUNT_ID,
    currency: SHADOW_CURRENCY,
    settledCash: totals.cash,
    unsettledCash: 0,
    totalCash: totals.cash,
    dividendsMonth: 0,
    dividendsYtd: 0,
    interestPaidEarnedYtd: 0,
    feesYtd,
    activities: [
      {
        id: "shadow-initial-deposit",
        accountId: SHADOW_ACCOUNT_ID,
        date: account.createdAt,
        type: "Deposit",
        description: "Shadow account starting balance",
        amount: SHADOW_STARTING_BALANCE,
        currency: SHADOW_CURRENCY,
        source: "SHADOW_LEDGER",
      },
      ...fills.map((fill) => {
        const metadata = shadowSourceMetadata(ordersById.get(fill.orderId));
        return {
          id: fill.id,
          accountId: SHADOW_ACCOUNT_ID,
          date: fill.occurredAt,
          type: "Trade",
          description: `${fill.side.toUpperCase()} ${toNumber(fill.quantity) ?? 0} ${fill.symbol}`,
          amount: toNumber(fill.cashDelta) ?? 0,
          currency: SHADOW_CURRENCY,
          source: metadata.strategyLabel || "SHADOW_LEDGER",
          sourceType: metadata.sourceType,
          strategyLabel: metadata.strategyLabel,
        };
      }),
    ],
    dividends: [],
    updatedAt: new Date(),
  };
}

function timeZoneParts(date: Date, timeZone = WATCHLIST_BACKTEST_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function marketDateKey(date: Date) {
  const parts = timeZoneParts(date);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function parseMarketDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new HttpError(400, "Shadow watchlist backtest date must be YYYY-MM-DD.", {
      code: "shadow_backtest_date_invalid",
      expose: true,
    });
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function addDaysToMarketDate(value: string, days: number) {
  const parsed = parseMarketDateKey(value);
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return date.toISOString().slice(0, 10);
}

function marketDateWeekday(value: string) {
  const parsed = parseMarketDateKey(value);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

function previousWeekdayOrSame(value: string) {
  let cursor = value;
  while (marketDateWeekday(cursor) === 0 || marketDateWeekday(cursor) === 6) {
    cursor = addDaysToMarketDate(cursor, -1);
  }
  return cursor;
}

function previousCalendarMonthRange(now: Date) {
  const parts = timeZoneParts(now);
  const firstOfPreviousMonth = new Date(Date.UTC(parts.year, parts.month - 2, 1));
  const year = firstOfPreviousMonth.getUTCFullYear();
  const month = firstOfPreviousMonth.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const normalizedMonth = String(month).padStart(2, "0");
  return {
    from: `${String(year).padStart(4, "0")}-${normalizedMonth}-01`,
    to: `${String(year).padStart(4, "0")}-${normalizedMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

function yearToDateRange(now: Date) {
  const parts = timeZoneParts(now);
  const year = String(parts.year).padStart(4, "0");
  return {
    from: `${year}-01-01`,
    to: previousWeekdayOrSame(marketDateKey(now)),
  };
}

function addWeekdaysToMarketDate(value: string, days: number) {
  let cursor = value;
  const step = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    cursor = addDaysToMarketDate(cursor, step);
    const weekday = marketDateWeekday(cursor);
    if (weekday !== 0 && weekday !== 6) {
      remaining -= 1;
    }
  }
  return cursor;
}

function marketDatesBetween(from: string, to: string) {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDaysToMarketDate(cursor, 1);
  }
  return dates;
}

function timeZoneOffsetMs(timeZone: string, date: Date) {
  const parts = timeZoneParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return localAsUtc - date.getTime();
}

function zonedDateTimeToUtc(input: {
  marketDate: string;
  hour: number;
  minute: number;
  second?: number;
}) {
  const parsed = parseMarketDateKey(input.marketDate);
  const localAsUtc = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    input.hour,
    input.minute,
    input.second ?? 0,
  );
  const firstPass = new Date(
    localAsUtc - timeZoneOffsetMs(WATCHLIST_BACKTEST_TIME_ZONE, new Date(localAsUtc)),
  );
  return new Date(
    localAsUtc - timeZoneOffsetMs(WATCHLIST_BACKTEST_TIME_ZONE, firstPass),
  );
}

function resolveWatchlistBacktestWindow(input: {
  marketDate?: string | null;
  marketDateFrom?: string | null;
  marketDateTo?: string | null;
  range?: string | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const today = previousWeekdayOrSame(marketDateKey(now));
  const range = String(input.range || "").trim().toLowerCase();
  const monthRange =
    range === "last_month" || range === "month"
      ? previousCalendarMonthRange(now)
      : null;
  const ytdRange =
    range === "ytd" || range === "year_to_date" || range === "since_2026"
      ? yearToDateRange(now)
      : null;
  const rangeToDate =
    input.marketDateTo?.trim() ||
    input.marketDate?.trim() ||
    ytdRange?.to ||
    monthRange?.to ||
    today;
  const resolvedToDate = previousWeekdayOrSame(rangeToDate);
  const resolvedFromDate =
    input.marketDateFrom?.trim() ||
    ytdRange?.from ||
    monthRange?.from ||
    (range === "past_week" || range === "week"
      ? addWeekdaysToMarketDate(resolvedToDate, -4)
      : input.marketDate?.trim() || resolvedToDate);
  parseMarketDateKey(resolvedFromDate);
  parseMarketDateKey(resolvedToDate);
  if (resolvedFromDate > resolvedToDate) {
    throw new HttpError(400, "Shadow watchlist backtest date range is inverted.", {
      code: "shadow_backtest_date_range_invalid",
      expose: true,
    });
  }
  const start = zonedDateTimeToUtc({
    marketDate: resolvedFromDate,
    hour: 9,
    minute: 30,
  });
  const nextMarketDate = addDaysToMarketDate(resolvedToDate, 1);
  const dayEnd = zonedDateTimeToUtc({
    marketDate: nextMarketDate,
    hour: 0,
    minute: 0,
  });
  const end =
    marketDateKey(now) === resolvedToDate && now > start
      ? now
      : dayEnd;
  const rangeKey =
    resolvedFromDate === resolvedToDate
      ? resolvedToDate
      : `${resolvedFromDate}:${resolvedToDate}`;
  return {
    marketDate: resolvedToDate,
    marketDateFrom: resolvedFromDate,
    marketDateTo: resolvedToDate,
    rangeKey,
    start,
    end,
    cleanupEnd: dayEnd,
  };
}

function normalizeWatchlistBacktestTimeframe(
  value: unknown,
): ShadowWatchlistBacktestTimeframe {
  return ["1m", "5m", "15m", "1h", "1d"].includes(String(value))
    ? (String(value) as ShadowWatchlistBacktestTimeframe)
    : "15m";
}

function normalizeRiskOverlayPercent(value: unknown) {
  const parsed = readNumber(value);
  if (!Number.isFinite(parsed) || parsed === null || parsed <= 0) {
    return null;
  }
  return Math.min(parsed, 99);
}

function normalizeWatchlistBacktestRiskOverlay(
  value: unknown,
): WatchlistBacktestRiskOverlay | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  const stopLossPercent = normalizeRiskOverlayPercent(record.stopLossPercent);
  const trailingStopPercent = normalizeRiskOverlayPercent(record.trailingStopPercent);
  const sellSignalTrailingStopPercent = normalizeRiskOverlayPercent(
    record.sellSignalTrailingStopPercent,
  );
  if (
    !stopLossPercent &&
    !trailingStopPercent &&
    !sellSignalTrailingStopPercent
  ) {
    return null;
  }
  const pieces = [
    stopLossPercent ? `SL${stopLossPercent}` : null,
    trailingStopPercent ? `TR${trailingStopPercent}` : null,
    sellSignalTrailingStopPercent ? `SIG${sellSignalTrailingStopPercent}` : null,
  ].filter(Boolean);
  return {
    label: readString(record.label) || pieces.join("_"),
    stopLossPercent,
    trailingStopPercent,
    sellSignalTrailingStopPercent,
  };
}

function normalizeWatchlistBacktestProxySymbols(
  value: unknown,
): WatchlistBacktestProxySymbol[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const symbols = Array.from(
    new Set(
      value.flatMap((entry) => {
        const symbol = normalizeSymbol(String(entry ?? "")).toUpperCase();
        return WATCHLIST_BACKTEST_PROXY_SYMBOLS.includes(
          symbol as WatchlistBacktestProxySymbol,
        )
          ? [symbol as WatchlistBacktestProxySymbol]
          : [];
      }),
    ),
  );
  return symbols.length ? symbols : null;
}

function normalizeWatchlistBacktestExcludedSymbols(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const symbols = Array.from(
    new Set(
      value.flatMap((entry) => {
        const symbol = normalizeSymbol(String(entry ?? "")).toUpperCase();
        return symbol ? [symbol] : [];
      }),
    ),
  );
  return symbols.length ? symbols : null;
}

function normalizeWatchlistBacktestSizingOverlay(
  value: unknown,
): WatchlistBacktestSizingOverlay {
  const record = readRecord(value);
  if (!record) {
    return DEFAULT_WATCHLIST_BACKTEST_SIZING;
  }
  const maxPositionFractionInput =
    readNumber(record.maxPositionFraction) ??
    (readNumber(record.maxPositionPercent) ?? 0) / 100;
  const maxPositionFraction =
    Number.isFinite(maxPositionFractionInput) && maxPositionFractionInput > 0
      ? Math.min(1, Math.max(0.01, maxPositionFractionInput))
      : DEFAULT_WATCHLIST_BACKTEST_SIZING.maxPositionFraction;
  const maxOpenPositionsInput = readNumber(record.maxOpenPositions);
  const maxOpenPositions =
    Number.isFinite(maxOpenPositionsInput) && maxOpenPositionsInput !== null
      ? Math.min(25, Math.max(1, Math.floor(maxOpenPositionsInput)))
      : DEFAULT_WATCHLIST_BACKTEST_SIZING.maxOpenPositions;
  return {
    label:
      readString(record.label) ||
      `P${Math.round(maxPositionFraction * 1000) / 10}x${maxOpenPositions}`,
    maxPositionFraction,
    maxOpenPositions,
    cashOnly: true,
  };
}

function normalizeWatchlistBacktestSelectionOverlay(
  value: unknown,
): WatchlistBacktestSelectionOverlay {
  const record = readRecord(value);
  if (!record) {
    return DEFAULT_WATCHLIST_BACKTEST_SELECTION;
  }
  const mode =
    record.mode === "ranked_rebalance"
      ? "ranked_rebalance"
      : record.mode === "ranked_batch"
        ? "ranked_batch"
        : "first_signal";
  const minScoreEdgeInput = readNumber(record.minScoreEdge);
  const minScoreEdge =
    Number.isFinite(minScoreEdgeInput) && minScoreEdgeInput !== null
      ? clampNumber(minScoreEdgeInput, 0, 50)
      : mode === "ranked_rebalance"
        ? 1
        : 0;
  return {
    label:
      readString(record.label) ||
      (mode === "ranked_rebalance"
        ? `RANK${minScoreEdge}`
        : mode === "ranked_batch"
          ? "RANKB"
          : "FIFO"),
    mode,
    minScoreEdge,
  };
}

function normalizeWatchlistBacktestDrawdownLimitPercent(value: unknown) {
  const parsed = readNumber(value);
  if (!Number.isFinite(parsed) || parsed === null || parsed <= 0) {
    return null;
  }
  return Math.min(99, parsed);
}

function normalizeWatchlistBacktestTargetMultiple(value: unknown) {
  const parsed = readNumber(value);
  if (!Number.isFinite(parsed) || parsed === null || parsed <= 0) {
    return WATCHLIST_BACKTEST_TARGET_OUTPERFORMANCE_MULTIPLE;
  }
  return Math.min(10, parsed);
}

function accountRangeForWatchlistBacktestRange(value: unknown): AccountRange {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ytd") return "YTD";
  if (normalized === "past_week") return "1W";
  if (normalized === "last_month") return "1M";
  return "1D";
}

function isWatchlistBacktestProxySymbol(
  value: string,
): value is WatchlistBacktestProxySymbol {
  return WATCHLIST_BACKTEST_PROXY_SYMBOLS.includes(
    value as WatchlistBacktestProxySymbol,
  );
}

function normalizeWatchlistBacktestRegimeAction(
  value: unknown,
): WatchlistBacktestRegimeAction | null {
  const normalized = String(value || "").trim();
  return WATCHLIST_BACKTEST_REGIME_ACTIONS.includes(
    normalized as WatchlistBacktestRegimeAction,
  )
    ? (normalized as WatchlistBacktestRegimeAction)
    : null;
}

function normalizeWatchlistBacktestRegimeExpiration(
  value: unknown,
): WatchlistBacktestRegimeExpiration | null {
  const normalized = String(value || "").trim();
  return WATCHLIST_BACKTEST_REGIME_EXPIRATIONS.includes(
    normalized as WatchlistBacktestRegimeExpiration,
  )
    ? (normalized as WatchlistBacktestRegimeExpiration)
    : null;
}

function normalizeWatchlistBacktestRegimeOverlay(
  value: unknown,
): WatchlistBacktestRegimeOverlay | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  const proxySymbol = normalizeSymbol(String(record.proxySymbol || "")).toUpperCase();
  if (!isWatchlistBacktestProxySymbol(proxySymbol)) {
    return null;
  }
  const signalTimeframe = normalizeWatchlistBacktestTimeframe(record.signalTimeframe);
  if (!WATCHLIST_BACKTEST_PROXY_TIMEFRAMES.includes(signalTimeframe as never)) {
    return null;
  }
  const action = normalizeWatchlistBacktestRegimeAction(record.action);
  const expiration = normalizeWatchlistBacktestRegimeExpiration(record.expiration);
  if (!action || !expiration) {
    return null;
  }
  const fixedBars =
    Math.max(1, Math.floor(readNumber(record.fixedBars) ?? 0)) ||
    WATCHLIST_BACKTEST_FIXED_REGIME_BARS;
  const scaleDownFraction = Math.min(
    0.95,
    Math.max(
      0.05,
      readNumber(record.scaleDownFraction) ?? WATCHLIST_BACKTEST_SCALE_DOWN_FRACTION,
    ),
  );
  return {
    label:
      readString(record.label) ||
      [
        proxySymbol,
        signalTimeframe,
        action.replace(/_/g, "-"),
        expiration.replace(/_/g, "-"),
      ].join(":"),
    proxySymbol,
    signalTimeframe,
    action,
    expiration,
    fixedBars,
    scaleDownFraction,
  };
}

function isBacktestBarComplete(input: {
  timestamp: Date;
  timeframe: ShadowWatchlistBacktestTimeframe;
  evaluatedAt: Date;
}) {
  return (
    input.timestamp.getTime() +
      WATCHLIST_BACKTEST_TIMEFRAME_MS[input.timeframe] +
      WATCHLIST_BACKTEST_COMPLETED_BAR_SAFETY_MS <=
    input.evaluatedAt.getTime()
  );
}

function isWatchlistBacktestRegularSessionTime(
  date: Date,
  options: { allowClosePrint?: boolean } = {},
) {
  const parts = timeZoneParts(date);
  const weekday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
  if (weekday === 0 || weekday === 6) {
    return false;
  }
  const minutes = parts.hour * 60 + parts.minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return options.allowClosePrint
    ? minutes >= open && minutes <= close
    : minutes >= open && minutes < close;
}

function watchlistBacktestBarLimit(input: {
  timeframe: ShadowWatchlistBacktestTimeframe;
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
}) {
  const timeframeMs = WATCHLIST_BACKTEST_TIMEFRAME_MS[input.timeframe];
  const requestedWindowBars = Math.ceil(
    Math.max(0, input.window.end.getTime() - input.window.start.getTime()) / timeframeMs,
  );
  return Math.min(
    WATCHLIST_BACKTEST_MAX_BAR_LIMIT,
    Math.max(
      RAY_REPLICA_SIGNAL_WARMUP_BARS,
      requestedWindowBars + RAY_REPLICA_SIGNAL_WARMUP_BARS,
    ),
  );
}

function watchlistBacktestHydrationStart(input: {
  timeframe: ShadowWatchlistBacktestTimeframe;
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
}) {
  return new Date(
    Math.max(
      0,
      input.window.start.getTime() -
        WATCHLIST_BACKTEST_TIMEFRAME_MS[input.timeframe] *
          RAY_REPLICA_SIGNAL_WARMUP_BARS,
    ),
  );
}

function watchlistBacktestHistorySourceNames() {
  const configuredSource = getPolygonRuntimeConfig()?.baseUrl.includes("massive.com")
    ? "massive-history"
    : "polygon-history";
  return Array.from(
    new Set([configuredSource, "massive-history", "polygon-history"]),
  );
}

async function loadStoredWatchlistBacktestBars(input: {
  symbol: string;
  timeframe: ShadowWatchlistBacktestTimeframe;
  limit: number;
  from: Date;
  to: Date;
}) {
  for (const sourceName of watchlistBacktestHistorySourceNames()) {
    const bars = await loadStoredMarketBars({
      symbol: input.symbol,
      timeframe: input.timeframe,
      limit: input.limit,
      from: input.from,
      to: input.to,
      assetClass: "equity",
      outsideRth: WATCHLIST_BACKTEST_OUTSIDE_RTH,
      source: "trades",
      recentWindowMinutes: 0,
      sourceName,
    });
    if (bars.length) {
      return bars;
    }
  }
  return [] as BrokerBarSnapshot[];
}

async function getHydratedWatchlistBacktestBars(input: {
  symbol: string;
  timeframe: ShadowWatchlistBacktestTimeframe;
  limit: number;
  from: Date;
  to: Date;
}) {
  const storedBars = await loadStoredWatchlistBacktestBars(input);
  if (storedBars.length) {
    return { bars: storedBars, error: null };
  }
  let lastError: unknown = null;
  const request = {
    symbol: input.symbol,
    timeframe: input.timeframe,
    limit: input.limit,
    from: input.from,
    to: input.to,
    assetClass: "equity" as const,
    outsideRth: WATCHLIST_BACKTEST_OUTSIDE_RTH,
    source: "trades" as const,
    allowHistoricalSynthesis: true,
    brokerRecentWindowMinutes: 0,
  };
  const first = await getBars(request).catch((error: unknown) => {
    lastError = error;
    return null;
  });
  const canonicalStoredBars = await loadStoredWatchlistBacktestBars(input);
  if (canonicalStoredBars.length) {
    return { bars: canonicalStoredBars, error: null };
  }
  if (first?.bars.length) {
    return { bars: first.bars, error: null };
  }

  for (const delayMs of WATCHLIST_BACKTEST_HYDRATION_RETRY_DELAYS_MS) {
    await sleep(delayMs);
    const storedBars = await loadStoredWatchlistBacktestBars(input);
    if (storedBars.length) {
      return { bars: storedBars, error: null };
    }
  }

  return { bars: [] as BrokerBarSnapshot[], error: lastError };
}

function barsToBacktestRayReplicaBars(
  inputBars: Awaited<ReturnType<typeof getBars>>["bars"],
  timeframe: ShadowWatchlistBacktestTimeframe,
  evaluatedAt: Date,
) {
  return inputBars
    .map((bar): RayReplicaBar | null => {
      const timestamp = dateOrNull(bar.timestamp);
      if (
        !timestamp ||
        bar.partial === true ||
        !isBacktestBarComplete({ timestamp, timeframe, evaluatedAt })
      ) {
        return null;
      }
      const open = Number(bar.open);
      const high = Number(bar.high);
      const low = Number(bar.low);
      const close = Number(bar.close);
      const volume = Number(bar.volume);
      if (![open, high, low, close].every(Number.isFinite)) {
        return null;
      }
      return {
        time: Math.floor(timestamp.getTime() / 1000),
        ts: timestamp.toISOString(),
        o: open,
        h: high,
        l: low,
        c: close,
        v: Number.isFinite(volume) ? volume : 0,
      };
    })
    .filter((bar): bar is RayReplicaBar => Boolean(bar))
    .sort((left, right) => left.time - right.time);
}

function collectWatchlistBacktestUniverse(
  watchlists: Awaited<ReturnType<typeof listWatchlists>>["watchlists"],
  options: {
    excludedSymbols?: string[] | null;
  } = {},
) {
  const excludedSymbols = new Set(options.excludedSymbols ?? []);
  const bySymbol = new Map<
    string,
    {
      symbol: string;
      watchlists: Array<{ id: string; name: string }>;
    }
  >();
  for (const watchlist of watchlists) {
    for (const item of watchlist.items) {
      const symbol = normalizeSymbol(item.symbol).toUpperCase();
      if (!symbol || excludedSymbols.has(symbol)) {
        continue;
      }
      const current = bySymbol.get(symbol) ?? { symbol, watchlists: [] };
      if (!current.watchlists.some((candidate) => candidate.id === watchlist.id)) {
        current.watchlists.push({ id: watchlist.id, name: watchlist.name });
      }
      bySymbol.set(symbol, current);
    }
  }
  return Array.from(bySymbol.values()).sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

function withWatchlistBacktestProxyUniverse(
  universe: ReturnType<typeof collectWatchlistBacktestUniverse>,
  options: {
    proxySymbols?: WatchlistBacktestProxySymbol[] | null;
  } = {},
) {
  const bySymbol = new Map(universe.map((item) => [item.symbol, item]));
  const proxySymbols = options.proxySymbols?.length
    ? options.proxySymbols
    : Array.from(WATCHLIST_BACKTEST_PROXY_SYMBOLS);
  for (const proxySymbol of proxySymbols) {
    if (!bySymbol.has(proxySymbol)) {
      bySymbol.set(proxySymbol, {
        symbol: proxySymbol,
        watchlists: [{ id: "regime-proxy", name: "Regime Proxy" }],
      });
    }
  }
  return Array.from(bySymbol.values()).sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function signalDirection(signal: RayReplicaSignalEvent): ShadowSide {
  return signal.eventType === "buy_signal" ? "buy" : "sell";
}

function fillForSignal(input: {
  signal: RayReplicaSignalEvent;
  bars: RayReplicaBar[];
  windowEnd: Date;
}) {
  const nextBar = input.bars[input.signal.barIndex + 1] ?? null;
  const nextBarTime = nextBar ? new Date(nextBar.time * 1000) : null;
  if (nextBar && nextBarTime && nextBarTime <= input.windowEnd) {
    return {
      price: cents(nextBar.o),
      placedAt: nextBarTime,
      source: "next_bar_open",
    };
  }
  return {
    price: cents(input.signal.close),
    placedAt: new Date(input.signal.time * 1000),
    source: "signal_close",
  };
}

function averageWatchlistBacktestValues(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) {
    return 0;
  }
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function watchlistBacktestPercentChange(input: {
  bars: RayReplicaBar[];
  index: number;
  lookback: number;
  directionSign: number;
}) {
  const current = input.bars[input.index];
  const previous = input.bars[input.index - input.lookback];
  if (!current || !previous || current.c <= 0 || previous.c <= 0) {
    return 0;
  }
  return (current.c / previous.c - 1) * 100 * input.directionSign;
}

function scoreWatchlistBacktestSignal(input: {
  signal: RayReplicaSignalEvent;
  bars: RayReplicaBar[];
  evaluation: ReturnType<typeof evaluateRayReplicaSignals>;
}) {
  const index = input.signal.barIndex;
  const current = input.bars[index];
  if (!current || !Number.isFinite(current.c) || current.c <= 0) {
    return { score: 0, details: {} };
  }

  const directionSign = input.signal.direction === "long" ? 1 : -1;
  const shortMomentumPct = watchlistBacktestPercentChange({
    bars: input.bars,
    index,
    lookback: 6,
    directionSign,
  });
  const mediumMomentumPct = watchlistBacktestPercentChange({
    bars: input.bars,
    index,
    lookback: 20,
    directionSign,
  });
  const longMomentumPct = watchlistBacktestPercentChange({
    bars: input.bars,
    index,
    lookback: 78,
    directionSign,
  });

  const rangeBars = input.bars.slice(Math.max(0, index - 19), index + 1);
  const rangeHigh = Math.max(...rangeBars.map((bar) => bar.h));
  const rangeLow = Math.min(...rangeBars.map((bar) => bar.l));
  const rangePosition =
    Number.isFinite(rangeHigh) && Number.isFinite(rangeLow) && rangeHigh > rangeLow
      ? directionSign === 1
        ? (current.c - rangeLow) / (rangeHigh - rangeLow)
        : (rangeHigh - current.c) / (rangeHigh - rangeLow)
      : 0.5;

  const priorVolumeAverage = averageWatchlistBacktestValues(
    input.bars
      .slice(Math.max(0, index - 20), index)
      .map((bar) => readNumber(bar.v) ?? 0),
  );
  const currentVolume = readNumber(current.v) ?? 0;
  const volumeRatio =
    priorVolumeAverage > 0 && currentVolume > 0 ? currentVolume / priorVolumeAverage : 1;

  const filterState = input.signal.filterState;
  const adx = readNumber(filterState?.adx) ?? 0;
  const volatilityScore = readNumber(filterState?.volatilityScore) ?? 0;
  const mtfDirections = Array.isArray(filterState?.mtfDirections)
    ? filterState.mtfDirections
    : [];
  const mtfAlignment =
    mtfDirections.filter((direction) => direction === directionSign).length -
    mtfDirections.filter((direction) => direction === -directionSign).length * 0.5;

  const atr = readNumber(input.evaluation.atrSmoothed[index]) ?? 0;
  const atrPct = atr > 0 ? (atr / current.c) * 100 : 0;
  const signalPrice = readNumber(input.signal.price) ?? current.c;
  const signalDiscountPct =
    current.c > 0 ? ((current.c - signalPrice) / current.c) * 100 * directionSign : 0;
  const riskAdjustedMomentum =
    mediumMomentumPct / Math.max(0.25, atrPct || 0.25);

  const components = {
    shortMomentumPct,
    mediumMomentumPct,
    longMomentumPct,
    riskAdjustedMomentum,
    rangeComponent: (clampNumber(rangePosition, 0, 1) - 0.5) * 4,
    volumeExpansion: clampNumber(volumeRatio - 1, -1, 2),
    adxComponent: clampNumber((adx - 18) / 12, -1, 2.5),
    volatilityComponent: clampNumber(1 - Math.abs(volatilityScore - 6) / 6, -0.5, 1),
    mtfAlignment,
    signalDiscountPct: clampNumber(signalDiscountPct, -2, 2),
    atrPct,
  };

  const score =
    components.shortMomentumPct * 0.9 +
    components.mediumMomentumPct * 0.7 +
    components.longMomentumPct * 0.25 +
    components.riskAdjustedMomentum * 0.8 +
    components.rangeComponent * 0.9 +
    components.volumeExpansion * 1.2 +
    components.adxComponent * 0.8 +
    components.volatilityComponent * 0.6 +
    components.mtfAlignment * 0.8 +
    components.signalDiscountPct * 0.2 -
    components.atrPct * 0.12;

  return {
    score: Number(score.toFixed(6)),
    details: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [
        key,
        Number(value.toFixed(6)),
      ]),
    ),
  };
}

async function collectWatchlistBacktestSignals(input: {
  universe: ReturnType<typeof collectWatchlistBacktestUniverse>;
  timeframe: ShadowWatchlistBacktestTimeframe;
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
}) {
  const settings = resolveRayReplicaSignalSettings({});
  const skipped: WatchlistBacktestSkip[] = [];
  const barLimit = watchlistBacktestBarLimit(input);
  const hydrationStart = watchlistBacktestHydrationStart({
    timeframe: input.timeframe,
    window: input.window,
  });
  const barsBySymbol = new Map<string, RayReplicaBar[]>();
  const candidates = await mapWithConcurrency(input.universe, 4, async (item) => {
    const barsResult = await getHydratedWatchlistBacktestBars({
      symbol: item.symbol,
      timeframe: input.timeframe,
      limit: barLimit,
      from: hydrationStart,
      to: input.window.end,
    });
    if (barsResult.error) {
      skipped.push({
        symbol: item.symbol,
        reason: "bars_unavailable",
        detail:
          barsResult.error instanceof Error
            ? barsResult.error.message
            : "No historical bars were available.",
        watchlists: item.watchlists,
      });
    }

    const chartBars = barsToBacktestRayReplicaBars(
      barsResult.bars,
      input.timeframe,
      input.window.end,
    );
    barsBySymbol.set(item.symbol, chartBars);
    if (!chartBars.length) {
      skipped.push({
        symbol: item.symbol,
        reason: "no_completed_bars",
        detail: "No completed bars were available in the requested window.",
        watchlists: item.watchlists,
      });
      return [];
    }

    const evaluation = evaluateRayReplicaSignals({
      chartBars,
      settings,
      includeProvisionalSignals: false,
    });
    return evaluation.signalEvents
      .filter((signal) => {
        const signalAt = new Date(signal.time * 1000);
        return (
          signalAt >= input.window.start &&
          signalAt <= input.window.end &&
          isWatchlistBacktestRegularSessionTime(signalAt)
        );
      })
      .map((signal): WatchlistBacktestSignalCandidate | null => {
        const fill = fillForSignal({
          signal,
          bars: chartBars,
          windowEnd: input.window.end,
        });
        if (
          !isWatchlistBacktestRegularSessionTime(fill.placedAt, {
            allowClosePrint: true,
          })
        ) {
          return null;
        }
        const signalScore = scoreWatchlistBacktestSignal({
          signal,
          bars: chartBars,
          evaluation,
        });
        return {
          symbol: item.symbol,
          side: signalDirection(signal),
          signal,
          signalAt: new Date(signal.time * 1000),
          signalPrice: readNumber(signal.price),
          signalClose: readNumber(signal.close),
          fillPrice: fill.price,
          placedAt: fill.placedAt,
          fillSource: fill.source,
          timeframe: input.timeframe,
          watchlists: item.watchlists,
          signalScore: signalScore.score,
          signalScoreDetails: signalScore.details,
        };
      })
      .filter((candidate): candidate is WatchlistBacktestSignalCandidate => candidate !== null);
  });
  return {
    candidates: candidates.flat().sort((left, right) => {
      const timeDelta = left.placedAt.getTime() - right.placedAt.getTime();
      return timeDelta || left.symbol.localeCompare(right.symbol);
    }),
    barsBySymbol,
    skipped,
  };
}

function quantityForCash(input: {
  cash: number;
  price: number;
  targetNotional: number;
}) {
  let quantity = Math.floor(Math.min(input.cash, input.targetNotional) / input.price);
  while (quantity > 0) {
    const fees = computeShadowOrderFees({
      assetClass: "equity",
      quantity,
      price: input.price,
    });
    if (quantity * input.price + fees <= input.cash + 0.000001) {
      return { quantity, fees };
    }
    quantity -= 1;
  }
  return { quantity: 0, fees: 0 };
}

const watchlistBacktestRegularBarsCache = new WeakMap<
  RayReplicaBar[],
  WatchlistBacktestPreparedBar[]
>();

function watchlistBacktestRegularBars(bars: RayReplicaBar[]) {
  const cached = watchlistBacktestRegularBarsCache.get(bars);
  if (cached) {
    return cached;
  }
  const prepared = bars
    .map((bar): WatchlistBacktestPreparedBar => {
      const at = new Date(bar.time * 1000);
      return { bar, at, atMs: at.getTime() };
    })
    .filter((entry) =>
      isWatchlistBacktestRegularSessionTime(entry.at, {
        allowClosePrint: true,
      }),
    );
  watchlistBacktestRegularBarsCache.set(bars, prepared);
  return prepared;
}

export function buildWatchlistBacktestFills(input: {
  runId: string;
  candidates: WatchlistBacktestSignalCandidate[];
  regimeCandidates?: WatchlistBacktestSignalCandidate[];
  barsBySymbol?: Map<string, RayReplicaBar[]>;
  riskOverlay?: WatchlistBacktestRiskOverlay | null;
  sizingOverlay?: WatchlistBacktestSizingOverlay | null;
  selectionOverlay?: WatchlistBacktestSelectionOverlay | null;
  regimeOverlay?: WatchlistBacktestRegimeOverlay | null;
  startingTotals: ShadowTotals;
  baseMarketValue: number;
  baselineOpenPositionCount?: number;
  baselineOpenSymbols?: string[];
  marketDate: string;
  windowEnd?: Date;
}) {
  const fills: WatchlistBacktestFill[] = [];
  const snapshots: Array<{
    asOf: Date;
    cash: number;
    netLiquidation: number;
    realizedPnl: number;
    unrealizedPnl: number;
    fees: number;
  }> = [];
  const skipped: WatchlistBacktestSkip[] = [];
  const open = new Map<
    string,
    {
      quantity: number;
      averageCost: number;
      lastMark: number;
      highestMark: number;
      activeTrailingStopPercent: number | null;
      lastStopCheckedAt: Date;
      nextBarIndex: number;
      positionKey: string;
      watchlists: Array<{ id: string; name: string }>;
      entryScore: number;
      regime?: Record<string, unknown> | null;
    }
  >();
  let cash = input.startingTotals.cash;
  let syntheticRealizedPnl = 0;
  let syntheticFees = 0;
  const sizingOverlay = input.sizingOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SIZING;
  const selectionOverlay =
    input.selectionOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SELECTION;
  const targetNotional =
    input.startingTotals.netLiquidation * sizingOverlay.maxPositionFraction;
  const baselineOpenPositionCount = Math.max(
    0,
    Math.floor(input.baselineOpenPositionCount ?? 0),
  );
  const baselineOpenSymbols = new Set(
    (input.baselineOpenSymbols ?? []).map((symbol) =>
      normalizeSymbol(symbol).toUpperCase(),
    ),
  );
  const riskOverlay = input.riskOverlay ?? null;
  const regimeOverlay = input.regimeOverlay ?? null;
  const proxySymbolSet = new Set<string>(
    regimeOverlay
      ? [regimeOverlay.proxySymbol]
      : Array.from(WATCHLIST_BACKTEST_PROXY_SYMBOLS),
  );
  let activeRegime:
    | {
        proxySymbol: WatchlistBacktestProxySymbol;
        signalTimeframe: ShadowWatchlistBacktestTimeframe;
        action: WatchlistBacktestRegimeAction;
        expiration: WatchlistBacktestRegimeExpiration;
        activatedAt: Date;
        expiresAt: Date | null;
        label: string;
      }
    | null = null;
  const getActiveRegime = () => activeRegime;

  const pushSnapshot = (asOf: Date) => {
    let syntheticMarketValue = 0;
    let syntheticUnrealizedPnl = 0;
    for (const position of open.values()) {
      syntheticMarketValue += position.quantity * position.lastMark;
      syntheticUnrealizedPnl +=
        (position.lastMark - position.averageCost) * position.quantity;
    }
    snapshots.push({
      asOf,
      cash,
      netLiquidation: cash + input.baseMarketValue + syntheticMarketValue,
      realizedPnl: input.startingTotals.realizedPnl + syntheticRealizedPnl,
      unrealizedPnl: input.startingTotals.unrealizedPnl + syntheticUnrealizedPnl,
      fees: input.startingTotals.fees + syntheticFees,
    });
  };

  const sellOpenPosition = (sellInput: {
    symbol: string;
    current: NonNullable<ReturnType<typeof open.get>>;
    price: number;
    quantity?: number | null;
    placedAt: Date;
    signalAt: Date;
    signalPrice: number | null;
    signalClose: number | null;
    signalScore?: number | null;
    signalScoreDetails?: Record<string, number> | null;
    watchlists: Array<{ id: string; name: string }>;
    fillSource: string;
    regime?: Record<string, unknown> | null;
  }) => {
    const quantity = Math.min(
      sellInput.current.quantity,
      Math.max(0, Math.floor(sellInput.quantity ?? sellInput.current.quantity)),
    );
    if (quantity <= 0) {
      return;
    }
    const fees = computeShadowOrderFees({
      assetClass: "equity",
      quantity,
      price: sellInput.price,
    });
    const grossAmount = quantity * sellInput.price;
    const realizedPnl =
      (sellInput.price - sellInput.current.averageCost) * quantity - fees;
    const cashDelta = grossAmount - fees;
    cash += cashDelta;
    syntheticFees += fees;
    syntheticRealizedPnl += realizedPnl;
    sellInput.current.lastMark = sellInput.price;
    if (quantity >= sellInput.current.quantity) {
      open.delete(sellInput.symbol);
    } else {
      sellInput.current.quantity -= quantity;
    }
    fills.push({
      symbol: sellInput.symbol,
      side: "sell",
      quantity,
      price: sellInput.price,
      fees,
      grossAmount,
      cashDelta,
      realizedPnl,
      positionKey: sellInput.current.positionKey,
      placedAt: sellInput.placedAt,
      signalAt: sellInput.signalAt,
      signalPrice: sellInput.signalPrice,
      signalClose: sellInput.signalClose,
      signalScore: sellInput.signalScore ?? null,
      signalScoreDetails: sellInput.signalScoreDetails ?? null,
      watchlists: sellInput.watchlists,
      fillSource: sellInput.fillSource,
      regime: sellInput.regime ?? sellInput.current.regime ?? null,
    });
    pushSnapshot(sellInput.placedAt);
  };

  const sellProxyIfOpen = (placedAt: Date, source: string) => {
    if (!activeRegime) {
      return;
    }
    const current = open.get(activeRegime.proxySymbol);
    if (!current) {
      return;
    }
    sellOpenPosition({
      symbol: activeRegime.proxySymbol,
      current,
      price: cents(current.lastMark),
      placedAt,
      signalAt: placedAt,
      signalPrice: cents(current.lastMark),
      signalClose: cents(current.lastMark),
      watchlists: current.watchlists,
      fillSource: source,
      regime: {
        label: activeRegime.label,
        proxySymbol: activeRegime.proxySymbol,
        signalTimeframe: activeRegime.signalTimeframe,
        action: activeRegime.action,
        expiration: activeRegime.expiration,
      },
    });
  };

  const firstBarIndexAfter = (symbol: string, after: Date) => {
    const bars = watchlistBacktestRegularBars(input.barsBySymbol?.get(symbol) ?? []);
    const afterMs = after.getTime();
    let low = 0;
    let high = bars.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((bars[mid]?.atMs ?? 0) <= afterMs) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  };

  const flushBarsUntil = (until: Date) => {
    if (!input.barsBySymbol) {
      return;
    }
    for (const [symbol, position] of Array.from(open.entries())) {
      const bars = watchlistBacktestRegularBars(input.barsBySymbol.get(symbol) ?? []);
      while (position.nextBarIndex < bars.length) {
        if (!open.has(symbol)) {
          break;
        }
        const { bar, at: barAt } = bars[position.nextBarIndex]!;
        if (barAt <= position.lastStopCheckedAt) {
          position.nextBarIndex += 1;
          continue;
        }
        if (barAt > until) {
          break;
        }
        position.nextBarIndex += 1;

        const triggered: Array<{ price: number; source: string }> = [];
        if (riskOverlay?.stopLossPercent) {
          const stopPrice =
            position.averageCost * (1 - riskOverlay.stopLossPercent / 100);
          if (bar.l <= stopPrice) {
            triggered.push({ price: stopPrice, source: "stop_loss" });
          }
        }
        if (position.activeTrailingStopPercent) {
          const trailingStopPrice =
            position.highestMark * (1 - position.activeTrailingStopPercent / 100);
          if (bar.l <= trailingStopPrice) {
            triggered.push({
              price: trailingStopPrice,
              source: "trailing_stop",
            });
          }
        }

        if (triggered.length) {
          const activeRiskOverlay = riskOverlay;
          if (!activeRiskOverlay) {
            continue;
          }
          const selected = triggered.sort((left, right) => right.price - left.price)[0]!;
          position.lastStopCheckedAt = barAt;
          sellOpenPosition({
            symbol,
            current: position,
            price: cents(selected.price),
            placedAt: barAt,
            signalAt: barAt,
            signalPrice: cents(selected.price),
            signalClose: cents(bar.c),
            watchlists: position.watchlists,
            fillSource: `risk_${selected.source}:${activeRiskOverlay.label}`,
            regime: position.regime ?? null,
          });
          break;
        }

        position.highestMark = Math.max(position.highestMark, bar.h, bar.c);
        position.lastMark = cents(bar.c);
        position.lastStopCheckedAt = barAt;
      }
    }
  };

  const expireRegimeIfNeeded = (at: Date) => {
    if (!activeRegime?.expiresAt || activeRegime.expiresAt > at) {
      return;
    }
    if (activeRegime.action === "exit_longs_buy_proxy") {
      sellProxyIfOpen(activeRegime.expiresAt, `regime_expire:${activeRegime.label}`);
    }
    activeRegime = null;
  };

  const sessionCloseFor = (date: Date) =>
    zonedDateTimeToUtc({
      marketDate: marketDateKey(date),
      hour: 16,
      minute: 0,
    });

  const regimeRecord = (extra: Record<string, unknown> = {}) =>
    activeRegime
      ? {
          label: activeRegime.label,
          proxySymbol: activeRegime.proxySymbol,
          signalTimeframe: activeRegime.signalTimeframe,
          action: activeRegime.action,
          expiration: activeRegime.expiration,
          activatedAt: activeRegime.activatedAt.toISOString(),
          ...extra,
        }
      : extra;

  const candidateScore = (candidate: WatchlistBacktestSignalCandidate) => {
    const score = readNumber(candidate.signalScore);
    return Number.isFinite(score) && score !== null ? score : 0;
  };

  const replaceWeakestOpenPosition = (
    candidate: WatchlistBacktestSignalCandidate,
    reason: "max_open_positions" | "insufficient_cash",
  ) => {
    if (selectionOverlay.mode !== "ranked_rebalance") {
      return false;
    }
    const incomingScore = candidateScore(candidate);
    let weakest:
      | {
          symbol: string;
          position: NonNullable<ReturnType<typeof open.get>>;
          effectiveScore: number;
        }
      | null = null;

    for (const [symbol, position] of open.entries()) {
      if (symbol === candidate.symbol) {
        continue;
      }
      if (activeRegime && proxySymbolSet.has(symbol)) {
        continue;
      }
      const unrealizedPercent =
        position.averageCost > 0
          ? ((position.lastMark - position.averageCost) / position.averageCost) * 100
          : 0;
      const effectiveScore = position.entryScore + unrealizedPercent * 0.25;
      if (!weakest || effectiveScore < weakest.effectiveScore) {
        weakest = { symbol, position, effectiveScore };
      }
    }

    if (!weakest) {
      return false;
    }
    if (incomingScore < weakest.effectiveScore + selectionOverlay.minScoreEdge) {
      skipped.push({
        symbol: candidate.symbol,
        reason: `ranked_rebalance_${reason}_hurdle`,
        detail: `Incoming score ${incomingScore.toFixed(2)} did not clear weakest open effective score ${weakest.effectiveScore.toFixed(2)} by ${selectionOverlay.minScoreEdge.toFixed(2)}.`,
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return false;
    }

    sellOpenPosition({
      symbol: weakest.symbol,
      current: weakest.position,
      price: cents(weakest.position.lastMark),
      placedAt: candidate.placedAt,
      signalAt: candidate.signalAt,
      signalPrice: candidate.signalPrice,
      signalClose: candidate.signalClose,
      signalScore: candidate.signalScore ?? null,
      signalScoreDetails: candidate.signalScoreDetails ?? null,
      watchlists: weakest.position.watchlists,
      fillSource: `selection_rebalance:${selectionOverlay.label}:${reason}`,
      regime: weakest.position.regime ?? null,
    });
    return true;
  };

  const buyCandidate = (
    candidate: WatchlistBacktestSignalCandidate,
    options: {
      targetNotionalMultiplier?: number;
      fillSource?: string;
      regime?: Record<string, unknown> | null;
    } = {},
  ) => {
    const price = candidate.fillPrice;
    if (!Number.isFinite(price) || price <= 0) {
      skipped.push({
        symbol: candidate.symbol,
        reason: "invalid_fill_price",
        detail: "The signal did not have a usable fill price.",
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return;
    }
    const current = open.get(candidate.symbol);
    if (current || baselineOpenSymbols.has(candidate.symbol)) {
      skipped.push({
        symbol: candidate.symbol,
        reason: "same_symbol_position_open",
        detail: current
          ? "A synthetic position for this symbol was already open."
          : "The Shadow baseline book already has an open position for this symbol.",
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return;
    }
    if (open.size + baselineOpenPositionCount >= sizingOverlay.maxOpenPositions) {
      if (replaceWeakestOpenPosition(candidate, "max_open_positions")) {
        return buyCandidate(candidate, options);
      }
      skipped.push({
        symbol: candidate.symbol,
        reason: "max_open_positions",
        detail: `Synthetic backtest is capped at ${sizingOverlay.maxOpenPositions} total open positions including ${baselineOpenPositionCount} Shadow baseline positions.`,
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return;
    }
    let { quantity, fees } = quantityForCash({
      cash,
      price,
      targetNotional: targetNotional * (options.targetNotionalMultiplier ?? 1),
    });
    if (quantity <= 0) {
      if (replaceWeakestOpenPosition(candidate, "insufficient_cash")) {
        const replacementQuantity = quantityForCash({
          cash,
          price,
          targetNotional: targetNotional * (options.targetNotionalMultiplier ?? 1),
        });
        quantity = replacementQuantity.quantity;
        fees = replacementQuantity.fees;
      }
    }
    if (quantity <= 0) {
      skipped.push({
        symbol: candidate.symbol,
        reason: "insufficient_cash",
        detail: "Available Shadow cash could not buy one whole share after fees.",
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      return;
    }
    const grossAmount = quantity * price;
    const cashDelta = -(grossAmount + fees);
    const positionKey = `${WATCHLIST_BACKTEST_SOURCE}:${input.runId}:equity:${candidate.symbol}`;
    cash += cashDelta;
    syntheticFees += fees;
    open.set(candidate.symbol, {
      quantity,
      averageCost: price,
      lastMark: price,
      highestMark: price,
      activeTrailingStopPercent: riskOverlay?.trailingStopPercent ?? null,
      lastStopCheckedAt: candidate.placedAt,
      nextBarIndex: firstBarIndexAfter(candidate.symbol, candidate.placedAt),
      positionKey,
      watchlists: candidate.watchlists,
      entryScore: candidateScore(candidate),
      regime: options.regime ?? null,
    });
    fills.push({
      symbol: candidate.symbol,
      side: "buy",
      quantity,
      price,
      fees,
      grossAmount,
      cashDelta,
      realizedPnl: 0,
      positionKey,
      placedAt: candidate.placedAt,
      signalAt: candidate.signalAt,
      signalPrice: candidate.signalPrice,
      signalClose: candidate.signalClose,
      signalScore: candidate.signalScore ?? null,
      signalScoreDetails: candidate.signalScoreDetails ?? null,
      watchlists: candidate.watchlists,
      fillSource: options.fillSource ?? candidate.fillSource,
      regime: options.regime ?? null,
    });
    pushSnapshot(candidate.placedAt);
  };

  const tightenSellSignalTrail = (
    candidate: WatchlistBacktestSignalCandidate,
    current: NonNullable<ReturnType<typeof open.get>>,
  ) => {
    const sellSignalTrailingStopPercent =
      riskOverlay?.sellSignalTrailingStopPercent ?? null;
    if (
      !sellSignalTrailingStopPercent ||
      proxySymbolSet.has(candidate.symbol) ||
      candidate.fillPrice <= current.averageCost
    ) {
      return false;
    }
    current.highestMark = Math.max(current.highestMark, candidate.fillPrice, current.lastMark);
    current.lastMark = candidate.fillPrice;
    current.lastStopCheckedAt = candidate.placedAt;
    current.activeTrailingStopPercent =
      current.activeTrailingStopPercent === null
        ? sellSignalTrailingStopPercent
        : Math.min(current.activeTrailingStopPercent, sellSignalTrailingStopPercent);
    return true;
  };

  const activateRegime = (candidate: WatchlistBacktestSignalCandidate) => {
    if (!regimeOverlay || candidate.side !== "buy") {
      return;
    }
    activeRegime = {
      proxySymbol: regimeOverlay.proxySymbol,
      signalTimeframe: regimeOverlay.signalTimeframe,
      action: regimeOverlay.action,
      expiration: regimeOverlay.expiration,
      activatedAt: candidate.placedAt,
      expiresAt:
        regimeOverlay.expiration === "fixed_12_5m_bars"
          ? new Date(
              candidate.placedAt.getTime() +
                regimeOverlay.fixedBars * WATCHLIST_BACKTEST_TIMEFRAME_MS["5m"],
            )
          : regimeOverlay.expiration === "session_close"
            ? sessionCloseFor(candidate.placedAt)
            : null,
      label: regimeOverlay.label,
    };
    const regime = regimeRecord({ trigger: "proxy_buy" });
    if (
      regimeOverlay.action === "exit_longs_buy_proxy" ||
      regimeOverlay.action === "scale_down_longs"
    ) {
      for (const [symbol, position] of Array.from(open.entries())) {
        if (proxySymbolSet.has(symbol)) {
          continue;
        }
        const quantity =
          regimeOverlay.action === "scale_down_longs"
            ? Math.floor(position.quantity * regimeOverlay.scaleDownFraction)
            : position.quantity;
        sellOpenPosition({
          symbol,
          current: position,
          quantity,
          price: cents(position.lastMark),
          placedAt: candidate.placedAt,
          signalAt: candidate.signalAt,
          signalPrice: cents(position.lastMark),
          signalClose: cents(position.lastMark),
          watchlists: position.watchlists,
          fillSource: `regime_${regimeOverlay.action}:${regimeOverlay.label}`,
          regime,
        });
      }
    }
    if (regimeOverlay.action === "exit_longs_buy_proxy") {
      buyCandidate(candidate, {
        fillSource: `regime_proxy_entry:${regimeOverlay.label}`,
        regime,
      });
    }
  };

  const handleRegimeSignal = (candidate: WatchlistBacktestSignalCandidate) => {
    if (!regimeOverlay || candidate.symbol !== regimeOverlay.proxySymbol) {
      return;
    }
    if (candidate.side === "buy") {
      activateRegime(candidate);
      return;
    }
    if (
      candidate.side === "sell" &&
      activeRegime?.proxySymbol === candidate.symbol &&
      activeRegime.signalTimeframe === candidate.timeframe
    ) {
      if (activeRegime.action === "exit_longs_buy_proxy") {
        const current = open.get(candidate.symbol);
        if (current) {
          sellOpenPosition({
            symbol: candidate.symbol,
            current,
            price: candidate.fillPrice,
            placedAt: candidate.placedAt,
            signalAt: candidate.signalAt,
            signalPrice: candidate.signalPrice,
            signalClose: candidate.signalClose,
            watchlists: current.watchlists,
            fillSource: `regime_proxy_exit:${activeRegime.label}`,
            regime: regimeRecord({ trigger: "proxy_sell" }),
          });
        }
      }
      activeRegime = null;
    }
  };

  const events = [
    ...input.candidates.map((candidate) => ({ kind: "trade" as const, candidate })),
    ...(regimeOverlay
      ? (input.regimeCandidates ?? []).map((candidate) => ({
          kind: "regime" as const,
          candidate,
        }))
      : []),
  ].sort((left, right) => {
    const timeDelta =
      left.candidate.placedAt.getTime() - right.candidate.placedAt.getTime();
    if (timeDelta) return timeDelta;
    if (left.kind !== right.kind) return left.kind === "regime" ? -1 : 1;
    if (
      left.kind === "trade" &&
      right.kind === "trade" &&
      selectionOverlay.mode !== "first_signal"
    ) {
      if (left.candidate.side !== right.candidate.side) {
        return left.candidate.side === "sell" ? -1 : 1;
      }
      if (left.candidate.side === "buy") {
        const scoreDelta =
          candidateScore(right.candidate) - candidateScore(left.candidate);
        if (scoreDelta) {
          return scoreDelta;
        }
      }
    }
    return left.candidate.symbol.localeCompare(right.candidate.symbol);
  });

  for (const event of events) {
    const candidate = event.candidate;
    flushBarsUntil(candidate.placedAt);
    expireRegimeIfNeeded(candidate.placedAt);
    if (event.kind === "regime") {
      handleRegimeSignal(candidate);
      continue;
    }

    const isProxySymbol = proxySymbolSet.has(candidate.symbol);
    if (regimeOverlay && isProxySymbol) {
      continue;
    }
    if (
      candidate.side === "buy" &&
      getActiveRegime() &&
      !isProxySymbol &&
      getActiveRegime()!.action === "pause_new_longs"
    ) {
      const currentRegime = getActiveRegime()!;
      skipped.push({
        symbol: candidate.symbol,
        reason: "defensive_regime",
        detail: `Defensive regime ${currentRegime.label} paused ordinary long entries.`,
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      continue;
    }
    if (candidate.side === "buy") {
      const currentRegime = getActiveRegime();
      buyCandidate(candidate, {
        targetNotionalMultiplier:
          currentRegime && !isProxySymbol && currentRegime.action === "scale_down_longs"
            ? 1 - regimeOverlay!.scaleDownFraction
            : 1,
        regime: currentRegime && !isProxySymbol ? regimeRecord() : null,
      });
      continue;
    }

    const current = open.get(candidate.symbol);
    if (!current) {
      skipped.push({
        symbol: candidate.symbol,
        reason: "no_synthetic_position",
        detail: "Sell signal skipped because this run had no synthetic long position open.",
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      continue;
    }
    if (tightenSellSignalTrail(candidate, current)) {
      continue;
    }
    sellOpenPosition({
      symbol: candidate.symbol,
      current,
      price: candidate.fillPrice,
      placedAt: candidate.placedAt,
      signalAt: candidate.signalAt,
      signalPrice: candidate.signalPrice,
      signalClose: candidate.signalClose,
      watchlists: candidate.watchlists,
      fillSource: candidate.fillSource,
      regime: current.regime ?? null,
    });
  }

  if (input.windowEnd) {
    flushBarsUntil(input.windowEnd);
    expireRegimeIfNeeded(input.windowEnd);
    pushSnapshot(input.windowEnd);
  }

  return { fills, snapshots, skipped };
}

async function recomputeShadowAccountFromLedger(tx: ShadowTransaction, updatedAt: Date) {
  const [account] = await tx
    .select()
    .from(shadowAccountsTable)
    .where(eq(shadowAccountsTable.id, SHADOW_ACCOUNT_ID))
    .limit(1);
  if (!account) {
    throw new HttpError(500, "Shadow account is missing.", {
      code: "shadow_account_missing",
      expose: true,
    });
  }
  const fills = await tx
    .select()
    .from(shadowFillsTable)
    .where(eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID));
  const startingBalance = toNumber(account.startingBalance) ?? SHADOW_STARTING_BALANCE;
  const cash = fills.reduce(
    (sum, fill) => sum + (toNumber(fill.cashDelta) ?? 0),
    startingBalance,
  );
  const realizedPnl = fills.reduce(
    (sum, fill) => sum + (toNumber(fill.realizedPnl) ?? 0),
    0,
  );
  const fees = fills.reduce((sum, fill) => sum + (toNumber(fill.fees) ?? 0), 0);
  await tx
    .update(shadowAccountsTable)
    .set({
      cash: money(cash),
      realizedPnl: money(realizedPnl),
      fees: money(fees),
      updatedAt,
    })
    .where(eq(shadowAccountsTable.id, SHADOW_ACCOUNT_ID));
}

function compactMarketDateForSource(value: string) {
  return value.replaceAll("-", "");
}

function watchlistBacktestSnapshotSource(rangeKey: string) {
  const [from, to] = rangeKey.split(":");
  if (from && to) {
    return `watchlist_bt:${compactMarketDateForSource(from)}:${compactMarketDateForSource(to)}`;
  }
  return `${WATCHLIST_BACKTEST_SOURCE}:${rangeKey}`;
}

function watchlistBacktestSnapshotSourcesForRange(input: {
  marketDateFrom: string;
  marketDateTo: string;
  rangeKey: string;
}) {
  return Array.from(
    new Set(
      [
        input.rangeKey,
        ...marketDatesBetween(input.marketDateFrom, input.marketDateTo),
      ].map(watchlistBacktestSnapshotSource),
    ),
  );
}

function watchlistBacktestOrderMatchesRange(
  payload: unknown,
  input: {
    marketDateFrom: string;
    marketDateTo: string;
    rangeKey: string;
    replaceAll?: boolean;
  },
) {
  if (input.replaceAll) {
    return true;
  }
  const payloadRecord = readRecord(payload) ?? {};
  const metadata = readRecord(payloadRecord.metadata) ?? {};
  const marketDate = readString(metadata.marketDate);
  const rangeKey = readString(metadata.rangeKey);
  return (
    rangeKey === input.rangeKey ||
    Boolean(
      marketDate &&
        marketDate >= input.marketDateFrom &&
        marketDate <= input.marketDateTo,
    )
  );
}

async function deleteWatchlistBacktestRowsForRange(
  tx: ShadowTransaction,
  input: {
    marketDateFrom: string;
    marketDateTo: string;
    rangeKey: string;
    windowStart: Date;
    cleanupEnd: Date;
    replaceAll?: boolean;
  },
) {
  const orders = await tx
    .select()
    .from(shadowOrdersTable)
    .where(
      and(
        eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowOrdersTable.source, WATCHLIST_BACKTEST_SOURCE),
      ),
    );
  const matchingOrders = orders.filter((order) => {
    return watchlistBacktestOrderMatchesRange(order.payload, input);
  });
  const orderIds = matchingOrders.map((order) => order.id);
  const positionKeys = Array.from(
    new Set(
      matchingOrders
        .map((order) => {
          const payload = readRecord(order.payload) ?? {};
          const metadata = readRecord(payload.metadata) ?? {};
          return readString(metadata.positionKey) ?? readString(payload.positionKey);
        })
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (positionKeys.length) {
    const positions = await tx
      .select({ id: shadowPositionsTable.id })
      .from(shadowPositionsTable)
      .where(
        and(
          eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
          inArray(shadowPositionsTable.positionKey, positionKeys),
        ),
      );
    const positionIds = positions.map((position) => position.id);
    if (positionIds.length) {
      await tx
        .delete(shadowPositionMarksTable)
        .where(inArray(shadowPositionMarksTable.positionId, positionIds));
    }
    await tx
      .delete(shadowPositionsTable)
      .where(
        and(
          eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
          inArray(shadowPositionsTable.positionKey, positionKeys),
        ),
      );
  }

  if (orderIds.length) {
    await tx
      .delete(shadowFillsTable)
      .where(
        and(
          eq(shadowFillsTable.accountId, SHADOW_ACCOUNT_ID),
          inArray(shadowFillsTable.orderId, orderIds),
        ),
      );
    await tx
      .delete(shadowOrdersTable)
      .where(
        and(
          eq(shadowOrdersTable.accountId, SHADOW_ACCOUNT_ID),
          inArray(shadowOrdersTable.id, orderIds),
        ),
      );
  }

  if (input.replaceAll) {
    await tx
      .delete(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
          eq(shadowBalanceSnapshotsTable.source, WATCHLIST_BACKTEST_MARK_SOURCE),
        ),
      );
    await tx
      .delete(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
          sql`${shadowBalanceSnapshotsTable.source} like ${`${WATCHLIST_BACKTEST_SOURCE}:%`}`,
        ),
      );
    await tx
      .delete(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
          sql`${shadowBalanceSnapshotsTable.source} like ${"watchlist_bt:%"}`,
        ),
      );
  } else {
    for (const source of watchlistBacktestSnapshotSourcesForRange(input)) {
      await tx
        .delete(shadowBalanceSnapshotsTable)
        .where(
          and(
            eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
            eq(shadowBalanceSnapshotsTable.source, source),
          ),
        );
    }
    await tx
      .delete(shadowBalanceSnapshotsTable)
      .where(
        and(
          eq(shadowBalanceSnapshotsTable.accountId, SHADOW_ACCOUNT_ID),
          eq(shadowBalanceSnapshotsTable.source, WATCHLIST_BACKTEST_MARK_SOURCE),
          gte(shadowBalanceSnapshotsTable.asOf, input.windowStart),
          lte(shadowBalanceSnapshotsTable.asOf, input.cleanupEnd),
        ),
      );
  }

  return {
    deletedOrders: orderIds.length,
    deletedPositionKeys: positionKeys.length,
  };
}

async function resetWatchlistBacktestRowsForRange(input: {
  marketDateFrom: string;
  marketDateTo: string;
  rangeKey: string;
  windowStart: Date;
  cleanupEnd: Date;
  replaceAll?: boolean;
}) {
  await db.transaction(async (tx) => {
    await deleteWatchlistBacktestRowsForRange(tx, input);
    await recomputeShadowAccountFromLedger(tx, new Date());
  });
}

async function insertWatchlistBacktestFills(input: {
  runId: string;
  marketDateFrom: string;
  marketDateTo: string;
  rangeKey: string;
  windowStart: Date;
  cleanupEnd: Date;
  replaceAll?: boolean;
  riskOverlay?: WatchlistBacktestRiskOverlay | null;
  sizingOverlay?: WatchlistBacktestSizingOverlay | null;
  selectionOverlay?: WatchlistBacktestSelectionOverlay | null;
  fills: WatchlistBacktestFill[];
  snapshots: ReturnType<typeof buildWatchlistBacktestFills>["snapshots"];
}) {
  const snapshotSource = watchlistBacktestSnapshotSource(input.rangeKey);
  await db.transaction(async (tx) => {
    await deleteWatchlistBacktestRowsForRange(tx, input);

    for (let index = 0; index < input.fills.length; index += 1) {
      const fill = input.fills[index]!;
      const orderId = randomUUID();
      const fillId = randomUUID();
      const fillMarketDate = marketDateKey(fill.placedAt);
      const payload = {
        metadata: {
          source: WATCHLIST_BACKTEST_SOURCE,
          runId: input.runId,
          rangeKey: input.rangeKey,
          marketDate: fillMarketDate,
          marketDateFrom: input.marketDateFrom,
          marketDateTo: input.marketDateTo,
          riskOverlay: input.riskOverlay ?? null,
          sizingOverlay: input.sizingOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SIZING,
          selectionOverlay:
            input.selectionOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SELECTION,
          positionKey: fill.positionKey,
          signalAt: fill.signalAt.toISOString(),
          signalPrice: fill.signalPrice,
          signalClose: fill.signalClose,
          signalScore: fill.signalScore ?? null,
          signalScoreDetails: fill.signalScoreDetails ?? null,
          fillSource: fill.fillSource,
          watchlists: fill.watchlists,
          regime: fill.regime ?? null,
        },
      };
      await tx.insert(shadowOrdersTable).values({
        id: orderId,
        accountId: SHADOW_ACCOUNT_ID,
        source: WATCHLIST_BACKTEST_SOURCE,
        sourceEventId: null,
        clientOrderId: `shadow-watchlist-backtest-${input.rangeKey}-${input.runId}-${index + 1}`,
        symbol: fill.symbol,
        assetClass: "equity",
        side: fill.side,
        type: "market",
        timeInForce: "day",
        status: "filled",
        quantity: money(fill.quantity),
        filledQuantity: money(fill.quantity),
        averageFillPrice: money(fill.price),
        fees: money(fill.fees),
        optionContract: null,
        payload,
        placedAt: fill.placedAt,
        filledAt: fill.placedAt,
      });
      await tx.insert(shadowFillsTable).values({
        id: fillId,
        accountId: SHADOW_ACCOUNT_ID,
        orderId,
        sourceEventId: null,
        symbol: fill.symbol,
        assetClass: "equity",
        side: fill.side,
        quantity: money(fill.quantity),
        price: money(fill.price),
        grossAmount: money(fill.grossAmount),
        fees: money(fill.fees),
        realizedPnl: money(fill.realizedPnl),
        cashDelta: money(fill.cashDelta),
        optionContract: null,
        occurredAt: fill.placedAt,
      });
      await upsertPositionForFill(tx, {
        symbol: fill.symbol,
        assetClass: "equity",
        optionContract: null,
        positionKey: fill.positionKey,
        side: fill.side,
        quantity: fill.quantity,
        price: fill.price,
        fees: fill.fees,
        realizedPnl: fill.realizedPnl,
        multiplier: 1,
        occurredAt: fill.placedAt,
      });
    }

    if (input.snapshots.length) {
      await tx.insert(shadowBalanceSnapshotsTable).values(
        input.snapshots.map((snapshot) => ({
          accountId: SHADOW_ACCOUNT_ID,
          currency: SHADOW_CURRENCY,
          cash: money(snapshot.cash),
          buyingPower: money(snapshot.cash),
          netLiquidation: money(snapshot.netLiquidation),
          realizedPnl: money(snapshot.realizedPnl),
          unrealizedPnl: money(snapshot.unrealizedPnl),
          fees: money(snapshot.fees),
          source: snapshotSource,
          asOf: snapshot.asOf,
        })),
      );
    }

    await recomputeShadowAccountFromLedger(tx, new Date());
  });
}

export const __shadowWatchlistBacktestInternalsForTests = {
  resolveWatchlistBacktestWindow,
  isWatchlistBacktestRegularSessionTime,
  watchlistBacktestOrderMatchesRange,
  watchlistBacktestSnapshotSource,
  watchlistBacktestSnapshotSourcesForRange,
  collectWatchlistBacktestUniverse,
  withWatchlistBacktestProxyUniverse,
  computeWatchlistBacktestStartingBook,
  selectShadowEquityHistoryRows,
  selectLatestShadowPositionMarksByPositionId,
  buildShadowPositionDayChange,
  buildShadowTradingPatternsFromRows,
  summarizeWatchlistBacktestClosedTrades,
  summarizeWatchlistBacktestBuyHoldBenchmark,
  buildWatchlistBacktestSweepVariants,
};

function watchlistBacktestOpenSymbols(fills: WatchlistBacktestFill[]) {
  return new Set(
    fills.reduce<string[]>((symbols, fill) => {
      if (fill.side === "buy") {
        symbols.push(fill.symbol);
      } else {
        const index = symbols.lastIndexOf(fill.symbol);
        if (index >= 0) {
          symbols.splice(index, 1);
        }
      }
      return symbols;
    }, []),
  );
}

function watchlistBacktestMaxDrawdownPercent(
  snapshots: ReturnType<typeof buildWatchlistBacktestFills>["snapshots"],
  startingNetLiquidation: number,
) {
  let highWaterMark = Math.max(startingNetLiquidation, 0);
  let maxDrawdownPercent = 0;
  for (const snapshot of snapshots) {
    const nav = snapshot.netLiquidation;
    if (!Number.isFinite(nav) || nav <= 0) {
      continue;
    }
    highWaterMark = Math.max(highWaterMark, nav);
    if (highWaterMark > 0) {
      maxDrawdownPercent = Math.min(
        maxDrawdownPercent,
        ((nav - highWaterMark) / highWaterMark) * 100,
      );
    }
  }
  return maxDrawdownPercent;
}

function watchlistBacktestLastMarkAtOrBefore(input: {
  symbol: string;
  barsBySymbol?: Map<string, RayReplicaBar[]>;
  windowEnd?: Date | null;
}) {
  const bars = watchlistBacktestRegularBars(
    input.barsBySymbol?.get(input.symbol) ?? [],
  );
  if (!bars.length) {
    return null;
  }
  const endMs = input.windowEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const entry = bars[index]!;
    if (entry.atMs <= endMs && Number.isFinite(entry.bar.c) && entry.bar.c > 0) {
      return cents(entry.bar.c);
    }
  }
  return null;
}

function watchlistBacktestFirstMarkAtOrAfter(input: {
  symbol: string;
  barsBySymbol?: Map<string, RayReplicaBar[]>;
  windowStart?: Date | null;
}) {
  const bars = watchlistBacktestRegularBars(
    input.barsBySymbol?.get(input.symbol) ?? [],
  );
  if (!bars.length) {
    return null;
  }
  const startMs = input.windowStart?.getTime() ?? Number.NEGATIVE_INFINITY;
  for (const entry of bars) {
    if (entry.atMs >= startMs && Number.isFinite(entry.bar.c) && entry.bar.c > 0) {
      return cents(entry.bar.c);
    }
  }
  return null;
}

function summarizeWatchlistBacktestClosedTrades(
  fills: WatchlistBacktestFill[],
) {
  const closedTradePnls = fills
    .filter((fill) => fill.side === "sell")
    .map((fill) => fill.realizedPnl)
    .filter(Number.isFinite);
  const winners = closedTradePnls.filter((pnl) => pnl > 0);
  const losers = closedTradePnls.filter((pnl) => pnl < 0);
  const grossProfit = winners.reduce((sum, value) => sum + value, 0);
  const grossLoss = losers.reduce((sum, value) => sum + value, 0);
  const closedTrades = closedTradePnls.length;
  return {
    closedTrades,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRatePercent: closedTrades ? (winners.length / closedTrades) * 100 : null,
    averageWin: winners.length ? grossProfit / winners.length : null,
    averageLoss: losers.length ? grossLoss / losers.length : null,
    expectancy: closedTrades
      ? closedTradePnls.reduce((sum, value) => sum + value, 0) / closedTrades
      : null,
    profitFactor:
      grossLoss < 0
        ? grossProfit / Math.abs(grossLoss)
        : grossProfit > 0
          ? null
          : null,
  };
}

function summarizeWatchlistBacktestBuyHoldBenchmark(input: {
  fills: WatchlistBacktestFill[];
  barsBySymbol?: Map<string, RayReplicaBar[]>;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  benchmarkCapital: number;
  strategyPnl: number;
  targetMultiple: number;
}) {
  const tradedSymbols = Array.from(
    new Set(
      input.fills
        .filter((fill) => fill.side === "buy")
        .map((fill) => normalizeSymbol(fill.symbol).toUpperCase())
        .filter(Boolean),
    ),
  ).sort();
  let matchedBuyHoldPnl = 0;
  let benchmarkableSymbols = 0;
  const benchmarkCapital = Math.max(0, input.benchmarkCapital);
  const perSymbolCapital = tradedSymbols.length
    ? benchmarkCapital / tradedSymbols.length
    : 0;

  for (const symbol of tradedSymbols) {
    const startMark = watchlistBacktestFirstMarkAtOrAfter({
      symbol,
      barsBySymbol: input.barsBySymbol,
      windowStart: input.windowStart,
    });
    const finalMark = watchlistBacktestLastMarkAtOrBefore({
      symbol,
      barsBySymbol: input.barsBySymbol,
      windowEnd: input.windowEnd,
    });
    if (startMark === null || finalMark === null || startMark <= 0) {
      continue;
    }
    benchmarkableSymbols += 1;
    matchedBuyHoldPnl += perSymbolCapital * (finalMark / startMark - 1);
  }

  const targetBuyHoldPnl =
    matchedBuyHoldPnl > 0 ? matchedBuyHoldPnl * input.targetMultiple : 0;
  const alphaVsBuyHold = input.strategyPnl - matchedBuyHoldPnl;
  return {
    strategyMatchedPnl: input.strategyPnl,
    matchedBuyHoldPnl,
    alphaVsBuyHold,
    outperformanceMultiple:
      matchedBuyHoldPnl > 0 ? input.strategyPnl / matchedBuyHoldPnl : null,
    targetOutperformanceMultiple: input.targetMultiple,
    targetBuyHoldPnl,
    targetPnlDelta: input.strategyPnl - targetBuyHoldPnl,
    benchmarkCapital,
    tradedSymbols: tradedSymbols.length,
    benchmarkableSymbols,
    benchmarkSkippedSymbols: tradedSymbols.length - benchmarkableSymbols,
  };
}

function summarizeWatchlistBacktestSimulation(input: {
  simulation: ReturnType<typeof buildWatchlistBacktestFills>;
  startingTotals: ShadowTotals;
  finalTotals?: ShadowTotals | null;
  commonSkippedCount: number;
  barsBySymbol?: Map<string, RayReplicaBar[]>;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  targetOutperformanceMultiple?: number;
}) {
  const realizedPnl = input.simulation.fills.reduce(
    (sum, fill) => sum + fill.realizedPnl,
    0,
  );
  const fees = input.simulation.fills.reduce((sum, fill) => sum + fill.fees, 0);
  const buys = input.simulation.fills.filter((fill) => fill.side === "buy");
  const sells = input.simulation.fills.filter((fill) => fill.side === "sell");
  const proxyFills = input.simulation.fills.filter((fill) =>
    WATCHLIST_BACKTEST_PROXY_SYMBOLS.includes(fill.symbol as never),
  );
  const ordinaryLongFills = input.simulation.fills.length - proxyFills.length;
  const openSyntheticSymbols = watchlistBacktestOpenSymbols(input.simulation.fills);
  const lastSnapshot = input.simulation.snapshots.at(-1) ?? null;
  const endingNetLiquidation =
    lastSnapshot?.netLiquidation ?? input.startingTotals.netLiquidation;
  const totalPnl = endingNetLiquidation - input.startingTotals.netLiquidation;
  const closedTradeMetrics = summarizeWatchlistBacktestClosedTrades(
    input.simulation.fills,
  );
  const benchmarkMetrics = summarizeWatchlistBacktestBuyHoldBenchmark({
    fills: input.simulation.fills,
    barsBySymbol: input.barsBySymbol,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    benchmarkCapital: input.startingTotals.cash,
    strategyPnl: totalPnl,
    targetMultiple:
      input.targetOutperformanceMultiple ??
      WATCHLIST_BACKTEST_TARGET_OUTPERFORMANCE_MULTIPLE,
  });
  return {
    ordersCreated: input.simulation.fills.length,
    entries: buys.length,
    exits: sells.length,
    ...closedTradeMetrics,
    openSyntheticPositions: openSyntheticSymbols.size,
    skippedSignals: input.commonSkippedCount + input.simulation.skipped.length,
    realizedPnl,
    fees,
    endingNetLiquidation,
    endingCash: lastSnapshot?.cash ?? input.startingTotals.cash,
    maxDrawdownPercent: watchlistBacktestMaxDrawdownPercent(
      input.simulation.snapshots,
      input.startingTotals.netLiquidation,
    ),
    proxyFills: proxyFills.length,
    ordinaryLongFills,
    totalPnl,
    benchmark: benchmarkMetrics,
  };
}

function watchlistBacktestFillResponse(fill: WatchlistBacktestFill) {
  return {
    symbol: fill.symbol,
    side: fill.side,
    quantity: fill.quantity,
    price: fill.price,
    fees: fill.fees,
    realizedPnl: fill.realizedPnl,
    placedAt: fill.placedAt,
    signalAt: fill.signalAt,
    signalScore: fill.signalScore ?? null,
    signalScoreDetails: fill.signalScoreDetails ?? null,
    watchlists: fill.watchlists,
    regime: fill.regime ?? null,
  };
}

function buildWatchlistBacktestRunResponse(input: {
  runId: string;
  persisted: boolean;
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
  timeframe: ShadowWatchlistBacktestTimeframe;
  riskOverlay: WatchlistBacktestRiskOverlay | null;
  sizingOverlay: WatchlistBacktestSizingOverlay;
  selectionOverlay: WatchlistBacktestSelectionOverlay;
  regimeOverlay: WatchlistBacktestRegimeOverlay | null;
  targetOutperformanceMultiple: number;
  startingTotals: ShadowTotals;
  startingBook?: Pick<
    WatchlistBacktestStartingBook,
    "existingOpenPositionCount" | "existingOpenSymbols"
  > | null;
  watchlists: Awaited<ReturnType<typeof listWatchlists>>["watchlists"];
  universe: ReturnType<typeof collectWatchlistBacktestUniverse>;
  signalScan: Awaited<ReturnType<typeof collectWatchlistBacktestSignals>>;
  simulation: ReturnType<typeof buildWatchlistBacktestFills>;
  finalTotals?: ShadowTotals | null;
  sweep?: Record<string, unknown> | null;
}) {
  const metrics = summarizeWatchlistBacktestSimulation({
    simulation: input.simulation,
    startingTotals: input.startingTotals,
    finalTotals: input.finalTotals,
    commonSkippedCount: input.signalScan.skipped.length,
    barsBySymbol: input.signalScan.barsBySymbol,
    windowStart: input.window.start,
    windowEnd: input.window.end,
    targetOutperformanceMultiple: input.targetOutperformanceMultiple,
  });
  return {
    runId: input.runId,
    source: WATCHLIST_BACKTEST_SOURCE,
    persisted: input.persisted,
    marketDate: input.window.marketDate,
    marketDateFrom: input.window.marketDateFrom,
    marketDateTo: input.window.marketDateTo,
    rangeKey: input.window.rangeKey,
    timeframe: input.timeframe,
    riskOverlay: input.riskOverlay,
    sizingOverlay: input.sizingOverlay,
    selectionOverlay: input.selectionOverlay,
    regimeOverlay: input.regimeOverlay,
    window: {
      start: input.window.start,
      end: input.window.end,
      timezone: WATCHLIST_BACKTEST_TIME_ZONE,
    },
    sizing: {
      label: input.sizingOverlay.label,
      maxPositionFraction: input.sizingOverlay.maxPositionFraction,
      maxOpenPositions: input.sizingOverlay.maxOpenPositions,
      cashOnly: input.sizingOverlay.cashOnly,
      wholeSharesOnly: true,
      startingNetLiquidation: input.startingTotals.netLiquidation,
      startingCash: input.startingTotals.cash,
      existingOpenPositions: input.startingBook?.existingOpenPositionCount ?? 0,
      existingOpenSymbols: input.startingBook?.existingOpenSymbols ?? [],
    },
    selection: {
      label: input.selectionOverlay.label,
      mode: input.selectionOverlay.mode,
      minScoreEdge: input.selectionOverlay.minScoreEdge,
    },
    universe: {
      watchlistCount: input.watchlists.length,
      symbolCount: input.universe.length,
      watchlists: input.watchlists.map((watchlist) => ({
        id: watchlist.id,
        name: watchlist.name,
        symbolCount: watchlist.items.length,
      })),
    },
    summary: {
      signals: input.signalScan.candidates.length,
      ...metrics,
    },
    sweep: input.sweep ?? null,
    fills: input.simulation.fills.map(watchlistBacktestFillResponse),
    skipped: [...input.signalScan.skipped, ...input.simulation.skipped],
    updatedAt: new Date(),
  };
}

function buildWatchlistBacktestSweepVariants(input: {
  exploratory?: boolean;
  baseSizingOverlay?: WatchlistBacktestSizingOverlay | null;
  baseSelectionOverlay?: WatchlistBacktestSelectionOverlay | null;
  proxySymbols?: WatchlistBacktestProxySymbol[] | null;
} = {}) {
  const baselineRiskOverlays: Array<WatchlistBacktestRiskOverlay | null> = [
    null,
    {
      label: "TR3",
      stopLossPercent: null,
      trailingStopPercent: 3,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR5",
      stopLossPercent: null,
      trailingStopPercent: 5,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR8",
      stopLossPercent: null,
      trailingStopPercent: 8,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL6",
      stopLossPercent: 6,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL10",
      stopLossPercent: 10,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
  ];
  const exploratoryRiskOverlays: Array<WatchlistBacktestRiskOverlay | null> = [
    ...baselineRiskOverlays,
    {
      label: "TR10",
      stopLossPercent: null,
      trailingStopPercent: 10,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR12",
      stopLossPercent: null,
      trailingStopPercent: 12,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR15",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR20",
      stopLossPercent: null,
      trailingStopPercent: 20,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL8",
      stopLossPercent: 8,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL12",
      stopLossPercent: 12,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL15",
      stopLossPercent: 15,
      trailingStopPercent: null,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "SL8_TR15",
      stopLossPercent: 8,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: null,
    },
    {
      label: "TR12_SIG8",
      stopLossPercent: null,
      trailingStopPercent: 12,
      sellSignalTrailingStopPercent: 8,
    },
    {
      label: "TR15_SIG10",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: 10,
    },
    {
      label: "TR15_SIG8",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: 8,
    },
    {
      label: "TR15_SIG5",
      stopLossPercent: null,
      trailingStopPercent: 15,
      sellSignalTrailingStopPercent: 5,
    },
  ];
  const riskOverlays = input.exploratory
    ? exploratoryRiskOverlays
    : baselineRiskOverlays;
  const defaultSizing = input.baseSizingOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SIZING;
  const defaultSelection =
    input.baseSelectionOverlay ?? DEFAULT_WATCHLIST_BACKTEST_SELECTION;
  const sizingOverlays: WatchlistBacktestSizingOverlay[] = input.exploratory
    ? [
        defaultSizing,
        {
          label: "P12.5x8",
          maxPositionFraction: 0.125,
          maxOpenPositions: 8,
          cashOnly: true,
        },
        {
          label: "P15x6",
          maxPositionFraction: 0.15,
          maxOpenPositions: 6,
          cashOnly: true,
        },
        {
          label: "P20x5",
          maxPositionFraction: 0.2,
          maxOpenPositions: 5,
          cashOnly: true,
        },
        {
          label: "P25x4",
          maxPositionFraction: 0.25,
          maxOpenPositions: 4,
          cashOnly: true,
        },
      ]
    : [defaultSizing];
  const selectionOverlays: WatchlistBacktestSelectionOverlay[] = input.exploratory
    ? [
        defaultSelection,
        {
          label: "RANKB",
          mode: "ranked_batch",
          minScoreEdge: 0,
        },
      ]
    : [defaultSelection];
  const variantId = (
    baseId: string,
    sizingOverlay: WatchlistBacktestSizingOverlay,
    selectionOverlay: WatchlistBacktestSelectionOverlay,
  ) =>
    input.exploratory
      ? [
          baseId,
          sizingOverlay.label,
          selectionOverlay.mode !== "first_signal" ? selectionOverlay.label : null,
        ]
          .filter(Boolean)
          .join(":")
      : baseId;
  const variants: Array<{
    id: string;
    riskOverlay: WatchlistBacktestRiskOverlay | null;
    sizingOverlay: WatchlistBacktestSizingOverlay;
    selectionOverlay: WatchlistBacktestSelectionOverlay;
    regimeOverlay: WatchlistBacktestRegimeOverlay | null;
  }> = [];
  for (const sizingOverlay of sizingOverlays) {
    for (const selectionOverlay of selectionOverlays) {
      for (const riskOverlay of riskOverlays) {
        const baseId = riskOverlay ? riskOverlay.label : "baseline";
        variants.push({
          id: variantId(baseId, sizingOverlay, selectionOverlay),
          riskOverlay,
          sizingOverlay,
          selectionOverlay,
          regimeOverlay: null,
        });
      }
    }
  }
  const proxySymbols = input.proxySymbols?.length
    ? input.proxySymbols
    : Array.from(WATCHLIST_BACKTEST_PROXY_SYMBOLS);
  const proxySymbolSet = new Set(proxySymbols);
  const regimeInputs = (input.exploratory
    ? [
        ["VXX", "1h", "exit_longs_buy_proxy", "session_close"],
        ["VXX", "1h", "exit_longs_buy_proxy", "fixed_12_5m_bars"],
        ["VXX", "1h", "exit_longs_buy_proxy", "until_proxy_sell"],
        ["VXX", "15m", "pause_new_longs", "session_close"],
        ["VXX", "15m", "pause_new_longs", "until_proxy_sell"],
        ["SQQQ", "1h", "exit_longs_buy_proxy", "session_close"],
        ["SQQQ", "1h", "exit_longs_buy_proxy", "fixed_12_5m_bars"],
        ["SQQQ", "1h", "exit_longs_buy_proxy", "until_proxy_sell"],
        ["SQQQ", "1h", "scale_down_longs", "session_close"],
        ["SQQQ", "1h", "scale_down_longs", "fixed_12_5m_bars"],
        ["SQQQ", "15m", "scale_down_longs", "session_close"],
        ["SQQQ", "15m", "scale_down_longs", "fixed_12_5m_bars"],
        ["SQQQ", "1h", "pause_new_longs", "session_close"],
        ["SQQQ", "1h", "pause_new_longs", "fixed_12_5m_bars"],
      ]
    : proxySymbols.flatMap((proxySymbol) =>
        WATCHLIST_BACKTEST_PROXY_TIMEFRAMES.flatMap((signalTimeframe) =>
          WATCHLIST_BACKTEST_REGIME_ACTIONS.flatMap((action) =>
            WATCHLIST_BACKTEST_REGIME_EXPIRATIONS.map((expiration) => [
              proxySymbol,
              signalTimeframe,
              action,
              expiration,
            ]),
          ),
        ),
      )) as Array<
    [
      WatchlistBacktestProxySymbol,
      ShadowWatchlistBacktestTimeframe,
      WatchlistBacktestRegimeAction,
      WatchlistBacktestRegimeExpiration,
    ]
  >;
  const filteredRegimeInputs = regimeInputs.filter(([proxySymbol]) =>
    proxySymbolSet.has(proxySymbol),
  );
  for (const [proxySymbol, signalTimeframe, action, expiration] of filteredRegimeInputs) {
    for (const sizingOverlay of sizingOverlays) {
      for (const selectionOverlay of selectionOverlays) {
        for (const riskOverlay of riskOverlays) {
          const regimeOverlay = normalizeWatchlistBacktestRegimeOverlay({
            proxySymbol,
            signalTimeframe,
            action,
            expiration,
            fixedBars: WATCHLIST_BACKTEST_FIXED_REGIME_BARS,
            scaleDownFraction: WATCHLIST_BACKTEST_SCALE_DOWN_FRACTION,
          });
          if (!regimeOverlay) {
            continue;
          }
          const baseId = [
            proxySymbol,
            signalTimeframe,
            action,
            expiration,
            riskOverlay?.label ?? "no-risk",
          ].join(":");
          variants.push({
            id: variantId(baseId, sizingOverlay, selectionOverlay),
            riskOverlay,
            sizingOverlay,
            selectionOverlay,
            regimeOverlay,
          });
        }
      }
    }
  }
  return variants;
}

async function collectWatchlistBacktestRegimeSignals(input: {
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
  proxySymbols?: WatchlistBacktestProxySymbol[] | null;
}) {
  const byKey = new Map<string, Awaited<ReturnType<typeof collectWatchlistBacktestSignals>>>();
  const proxySymbols = input.proxySymbols?.length
    ? input.proxySymbols
    : Array.from(WATCHLIST_BACKTEST_PROXY_SYMBOLS);
  for (const proxySymbol of proxySymbols) {
    for (const timeframe of WATCHLIST_BACKTEST_PROXY_TIMEFRAMES) {
      const scan = await collectWatchlistBacktestSignals({
        universe: [
          {
            symbol: proxySymbol,
            watchlists: [{ id: "regime-proxy", name: "Regime Proxy" }],
          },
        ],
        timeframe,
        window: input.window,
      });
      byKey.set(`${proxySymbol}:${timeframe}`, scan);
    }
  }
  return byKey;
}

export async function runShadowWatchlistBacktest(input: {
  marketDate?: string | null;
  marketDateFrom?: string | null;
  marketDateTo?: string | null;
  range?: string | null;
  timeframe?: string | null;
  riskOverlay?: unknown;
  sizingOverlay?: unknown;
  selectionOverlay?: unknown;
  regimeOverlay?: unknown;
  proxySymbols?: unknown;
  excludedSymbols?: unknown;
  persist?: unknown;
  sweep?: unknown;
  exploratorySweep?: unknown;
  maxDrawdownLimitPercent?: unknown;
  targetOutperformanceMultiple?: unknown;
} = {}) {
  await ensureShadowAccount();
  const runId = randomUUID();
  const timeframe = normalizeWatchlistBacktestTimeframe(input.timeframe);
  const riskOverlay = normalizeWatchlistBacktestRiskOverlay(input.riskOverlay);
  const sizingOverlay = normalizeWatchlistBacktestSizingOverlay(input.sizingOverlay);
  const selectionOverlay = normalizeWatchlistBacktestSelectionOverlay(
    input.selectionOverlay,
  );
  const regimeOverlay = normalizeWatchlistBacktestRegimeOverlay(input.regimeOverlay);
  const proxySymbols = normalizeWatchlistBacktestProxySymbols(input.proxySymbols);
  const excludedSymbols = normalizeWatchlistBacktestExcludedSymbols(
    input.excludedSymbols,
  );
  const persist = input.persist !== false;
  const sweep = input.sweep === true;
  const exploratorySweep = input.exploratorySweep === true;
  const maxDrawdownLimitPercent = normalizeWatchlistBacktestDrawdownLimitPercent(
    input.maxDrawdownLimitPercent,
  );
  const targetOutperformanceMultiple = normalizeWatchlistBacktestTargetMultiple(
    input.targetOutperformanceMultiple,
  );
  const analysisSnapshotRange = accountRangeForWatchlistBacktestRange(input.range);
  const window = resolveWatchlistBacktestWindow({
    marketDate: input.marketDate,
    marketDateFrom: input.marketDateFrom,
    marketDateTo: input.marketDateTo,
    range: input.range,
  });

  await refreshShadowPositionMarks().catch((error) => {
    logger.debug?.({ err: error }, "Shadow mark refresh before watchlist backtest failed");
  });
  const { watchlists } = await listWatchlists();
  const universe = withWatchlistBacktestProxyUniverse(
    collectWatchlistBacktestUniverse(watchlists, { excludedSymbols }),
    { proxySymbols },
  );
  const signalScanStartedAt = Date.now();
  const signalScan = await collectWatchlistBacktestSignals({
    universe,
    timeframe,
    window,
  });
  logger.info(
    {
      runId,
      timeframe,
      rangeKey: window.rangeKey,
      symbolCount: universe.length,
      signals: signalScan.candidates.length,
      skipped: signalScan.skipped.length,
      elapsedMs: Date.now() - signalScanStartedAt,
    },
    "Shadow watchlist backtest signal hydration completed",
  );

  if (sweep) {
    const regimeScanStartedAt = Date.now();
    const regimeSignalsByKey = await collectWatchlistBacktestRegimeSignals({
      window,
      proxySymbols,
    });
    logger.info(
      {
        runId,
        rangeKey: window.rangeKey,
        proxyScans: regimeSignalsByKey.size,
        signals: Array.from(regimeSignalsByKey.values()).reduce(
          (sum, scan) => sum + scan.candidates.length,
          0,
        ),
        elapsedMs: Date.now() - regimeScanStartedAt,
      },
      "Shadow watchlist backtest regime hydration completed",
    );
    if (persist) {
      await resetWatchlistBacktestRowsForRange({
        marketDateFrom: window.marketDateFrom,
        marketDateTo: window.marketDateTo,
        rangeKey: window.rangeKey,
        windowStart: window.start,
        cleanupEnd: window.cleanupEnd,
        replaceAll: true,
      });
      await refreshShadowPositionMarks().catch((error) => {
        logger.debug?.({ err: error }, "Shadow mark refresh before watchlist sweep failed");
      });
    }
    const startingBook = await computeWatchlistBacktestStartingBook();
    const startingTotals = startingBook.totals;
    const baseMarketValue = startingBook.baseMarketValue;
    const simulationStartedAt = Date.now();
    const variants = buildWatchlistBacktestSweepVariants({
      exploratory: exploratorySweep,
      baseSizingOverlay: sizingOverlay,
      baseSelectionOverlay: selectionOverlay,
      proxySymbols,
    }).map((variant) => {
      const variantRunId = randomUUID();
      const regimeCandidates = variant.regimeOverlay
        ? regimeSignalsByKey.get(
            `${variant.regimeOverlay.proxySymbol}:${variant.regimeOverlay.signalTimeframe}`,
          )?.candidates ?? []
        : [];
      const simulation = buildWatchlistBacktestFills({
        runId: variantRunId,
        candidates: signalScan.candidates,
        regimeCandidates,
        barsBySymbol: signalScan.barsBySymbol,
        riskOverlay: variant.riskOverlay,
        sizingOverlay: variant.sizingOverlay,
        selectionOverlay: variant.selectionOverlay,
        regimeOverlay: variant.regimeOverlay,
        startingTotals,
        baseMarketValue,
        baselineOpenPositionCount: startingBook.existingOpenPositionCount,
        baselineOpenSymbols: startingBook.existingOpenSymbols,
        marketDate: window.rangeKey,
        windowEnd: window.end,
      });
      const summary = summarizeWatchlistBacktestSimulation({
        simulation,
        startingTotals,
        commonSkippedCount: signalScan.skipped.length,
        barsBySymbol: signalScan.barsBySymbol,
        windowStart: window.start,
        windowEnd: window.end,
        targetOutperformanceMultiple,
      });
      return {
        ...variant,
        runId: variantRunId,
        simulation,
        summary,
      };
    });
    const ranked = variants.sort((left, right) => {
      if (maxDrawdownLimitPercent !== null) {
        const leftEligible =
          Math.abs(left.summary.maxDrawdownPercent) <= maxDrawdownLimitPercent;
        const rightEligible =
          Math.abs(right.summary.maxDrawdownPercent) <= maxDrawdownLimitPercent;
        if (leftEligible !== rightEligible) {
          return leftEligible ? -1 : 1;
        }
      }
      const navDelta =
        right.summary.endingNetLiquidation - left.summary.endingNetLiquidation;
      return navDelta || left.id.localeCompare(right.id);
    });
    const winner = ranked[0]!;
    logger.info(
      {
        runId,
        rangeKey: window.rangeKey,
        variantCount: ranked.length,
        winnerId: winner.id,
        elapsedMs: Date.now() - simulationStartedAt,
      },
      "Shadow watchlist backtest sweep simulation completed",
    );

    let finalTotals: ShadowTotals | null = null;
    if (persist) {
      await insertWatchlistBacktestFills({
        runId: winner.runId,
        marketDateFrom: window.marketDateFrom,
        marketDateTo: window.marketDateTo,
        rangeKey: window.rangeKey,
        windowStart: window.start,
        cleanupEnd: window.cleanupEnd,
        replaceAll: true,
        riskOverlay: winner.riskOverlay,
        sizingOverlay: winner.sizingOverlay,
        selectionOverlay: winner.selectionOverlay,
        fills: winner.simulation.fills,
        snapshots: winner.simulation.snapshots,
      });
      finalTotals = await ensureFreshShadowState(true);
      await persistShadowTradingPatternsSnapshot({ range: analysisSnapshotRange }).catch(
        (error) => {
          logger.warn(
            { err: error, runId: winner.runId, range: analysisSnapshotRange },
            "Shadow trading-pattern snapshot after watchlist sweep failed",
          );
        },
      );
    }
    return buildWatchlistBacktestRunResponse({
      runId: winner.runId,
      persisted: persist,
      window,
      timeframe,
      riskOverlay: winner.riskOverlay,
      sizingOverlay: winner.sizingOverlay,
      selectionOverlay: winner.selectionOverlay,
      regimeOverlay: winner.regimeOverlay,
      targetOutperformanceMultiple,
      startingTotals,
      startingBook,
      watchlists,
      universe,
      signalScan,
      simulation: winner.simulation,
      finalTotals,
      sweep: {
        ranking:
          maxDrawdownLimitPercent !== null
            ? `highest_ending_nav_under_${maxDrawdownLimitPercent}_pct_max_dd`
            : "highest_ending_nav",
        exploratory: exploratorySweep,
        maxDrawdownLimitPercent,
        targetOutperformanceMultiple,
        variantCount: ranked.length,
        winnerId: winner.id,
        variants: ranked.map((variant, index) => ({
          rank: index + 1,
          id: variant.id,
          runId: variant.runId,
          riskOverlay: variant.riskOverlay,
          sizingOverlay: variant.sizingOverlay,
          selectionOverlay: variant.selectionOverlay,
          regimeOverlay: variant.regimeOverlay,
          summary: variant.summary,
        })),
      },
    });
  }

  const regimeCandidates = regimeOverlay
    ? (
        await collectWatchlistBacktestSignals({
          universe: [
            {
              symbol: regimeOverlay.proxySymbol,
              watchlists: [{ id: "regime-proxy", name: "Regime Proxy" }],
            },
          ],
          timeframe: regimeOverlay.signalTimeframe,
          window,
        })
      ).candidates
    : [];
  if (persist) {
    await resetWatchlistBacktestRowsForRange({
      marketDateFrom: window.marketDateFrom,
      marketDateTo: window.marketDateTo,
      rangeKey: window.rangeKey,
      windowStart: window.start,
      cleanupEnd: window.cleanupEnd,
      replaceAll: true,
    });
    await refreshShadowPositionMarks().catch((error) => {
      logger.debug?.({ err: error }, "Shadow mark refresh before watchlist backtest persist failed");
    });
  }
  const startingBook = await computeWatchlistBacktestStartingBook();
  const startingTotals = startingBook.totals;
  const baseMarketValue = startingBook.baseMarketValue;
  const simulation = buildWatchlistBacktestFills({
    runId,
    candidates: signalScan.candidates,
    regimeCandidates,
    barsBySymbol: signalScan.barsBySymbol,
    riskOverlay,
    sizingOverlay,
    selectionOverlay,
    regimeOverlay,
    startingTotals,
    baseMarketValue,
    baselineOpenPositionCount: startingBook.existingOpenPositionCount,
    baselineOpenSymbols: startingBook.existingOpenSymbols,
    marketDate: window.rangeKey,
    windowEnd: window.end,
  });

  let finalTotals: ShadowTotals | null = null;
  if (persist) {
    await insertWatchlistBacktestFills({
      runId,
      marketDateFrom: window.marketDateFrom,
      marketDateTo: window.marketDateTo,
      rangeKey: window.rangeKey,
      windowStart: window.start,
      cleanupEnd: window.cleanupEnd,
      replaceAll: true,
      riskOverlay,
      sizingOverlay,
      selectionOverlay,
      fills: simulation.fills,
      snapshots: simulation.snapshots,
    });
    finalTotals = await ensureFreshShadowState(true);
    await persistShadowTradingPatternsSnapshot({ range: analysisSnapshotRange }).catch(
      (error) => {
        logger.warn(
          { err: error, runId, range: analysisSnapshotRange },
          "Shadow trading-pattern snapshot after watchlist backtest failed",
        );
      },
    );
  }

  return buildWatchlistBacktestRunResponse({
    runId,
    persisted: persist,
    window,
    timeframe,
    riskOverlay,
    sizingOverlay,
    selectionOverlay,
    regimeOverlay,
    targetOutperformanceMultiple,
    startingTotals,
    startingBook,
    watchlists,
    universe,
    signalScan,
    simulation,
    finalTotals,
  });
}

export function isShadowAccountId(accountId: string | null | undefined): boolean {
  return String(accountId ?? "").toLowerCase() === SHADOW_ACCOUNT_ID;
}

export async function recordShadowAutomationEvent(event: ExecutionEvent) {
  if (event.eventType === "signal_options_shadow_entry") {
    return recordShadowAutomationEntry(event);
  }
  if (event.eventType === "signal_options_shadow_exit") {
    return recordShadowAutomationExit(event);
  }
  if (event.eventType === "signal_options_shadow_mark") {
    return recordShadowAutomationMark(event);
  }
  return null;
}

async function recordShadowAutomationEntry(event: ExecutionEvent) {
  const payload = readRecord(event.payload) ?? {};
  const position = readRecord(payload.position);
  const orderPlan = readRecord(payload.orderPlan) ?? {};
  const contract = asOptionContract(payload.selectedContract ?? position?.selectedContract);
  const symbol = normalizeSymbol(String(event.symbol ?? position?.symbol ?? contract?.underlying ?? ""));
  const price =
    toNumber(orderPlan.simulatedFillPrice) ??
    toNumber(position?.entryPrice) ??
    toNumber(payload.fillPrice);
  const quantity = toNumber(orderPlan.quantity) ?? toNumber(position?.quantity);
  if (!symbol || !contract || price == null || !quantity) {
    return null;
  }
  return placeShadowOrder({
    accountId: SHADOW_ACCOUNT_ID,
    mode: "paper",
    symbol,
    assetClass: "option",
    side: "buy",
    type: "limit",
    quantity,
    limitPrice: price,
    stopPrice: null,
    timeInForce: "day",
    optionContract: contract,
    source: "automation",
    sourceEventId: event.id,
    clientOrderId: `shadow-auto-entry-${event.id}`,
    requestedFillPrice: price,
    payload,
    placedAt: event.occurredAt,
  });
}

async function recordShadowAutomationExit(event: ExecutionEvent) {
  const payload = readRecord(event.payload) ?? {};
  const position = readRecord(payload.position);
  const contract = asOptionContract(payload.selectedContract ?? position?.selectedContract);
  const symbol = normalizeSymbol(String(event.symbol ?? position?.symbol ?? contract?.underlying ?? ""));
  const price = toNumber(payload.exitPrice) ?? toNumber(position?.lastMarkPrice);
  const quantity = toNumber(position?.quantity);
  if (!symbol || !contract || price == null || !quantity) {
    return null;
  }
  return placeShadowOrder({
    accountId: SHADOW_ACCOUNT_ID,
    mode: "paper",
    symbol,
    assetClass: "option",
    side: "sell",
    type: "limit",
    quantity,
    limitPrice: price,
    stopPrice: null,
    timeInForce: "day",
    optionContract: contract,
    source: "automation",
    sourceEventId: event.id,
    clientOrderId: `shadow-auto-exit-${event.id}`,
    requestedFillPrice: price,
    payload,
    placedAt: event.occurredAt,
  });
}

async function recordShadowAutomationMark(event: ExecutionEvent) {
  await ensureShadowAccount();
  const payload = readRecord(event.payload) ?? {};
  const position = readRecord(payload.position);
  const quote = readRecord(payload.quote);
  const contract = asOptionContract(payload.selectedContract ?? position?.selectedContract);
  const symbol = normalizeSymbol(String(event.symbol ?? position?.symbol ?? contract?.underlying ?? ""));
  const markPrice =
    toNumber(position?.lastMarkPrice) ??
    toNumber(payload.markPrice) ??
    toNumber(quote?.mark);
  if (!symbol || !contract || markPrice == null || markPrice <= 0) {
    return null;
  }
  const key = positionKey({ symbol, assetClass: "option", optionContract: contract });
  const [row] = await db
    .select()
    .from(shadowPositionsTable)
    .where(
      and(
        eq(shadowPositionsTable.accountId, SHADOW_ACCOUNT_ID),
        eq(shadowPositionsTable.positionKey, key),
        eq(shadowPositionsTable.status, "open"),
      ),
    )
    .limit(1);
  if (!row) {
    return null;
  }
  const quantity = toNumber(row.quantity) ?? 0;
  const averageCost = toNumber(row.averageCost) ?? 0;
  const multiplier = marketMultiplier({ assetClass: "option", optionContract: contract });
  const marketValue = quantity * markPrice * multiplier;
  const unrealizedPnl = (markPrice - averageCost) * quantity * multiplier;
  await db
    .update(shadowPositionsTable)
    .set({
      mark: money(markPrice),
      marketValue: money(marketValue),
      unrealizedPnl: money(unrealizedPnl),
      asOf: event.occurredAt,
      updatedAt: new Date(),
    })
    .where(eq(shadowPositionsTable.id, row.id));
  await db.insert(shadowPositionMarksTable).values({
    accountId: SHADOW_ACCOUNT_ID,
    positionId: row.id,
    mark: money(markPrice),
    marketValue: money(marketValue),
    unrealizedPnl: money(unrealizedPnl),
    source: "automation",
    asOf: event.occurredAt,
  });
  await writeShadowBalanceSnapshot("automation_mark");
  return row.id;
}
