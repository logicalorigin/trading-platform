import { randomUUID } from "node:crypto";
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
  shadowPositionMarksTable,
  shadowPositionsTable,
  type ExecutionEvent,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { asRecord as readRecord, normalizeSymbol } from "../lib/values";
import type { RuntimeMode } from "../lib/runtime";
import type { PlaceOrderInput } from "../providers/ibkr/client";
import { fetchOptionQuoteSnapshotPayload } from "./bridge-streams";
import {
  assertIbkrGatewayTradingAvailable,
  getBars,
  getQuoteSnapshots,
  listWatchlists,
} from "./platform";
import {
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
const WATCHLIST_BACKTEST_MAX_BAR_LIMIT = 15_000;
const WATCHLIST_BACKTEST_MAX_POSITION_FRACTION = 0.1;
const WATCHLIST_BACKTEST_MAX_OPEN_POSITIONS = 10;
const WATCHLIST_BACKTEST_TIME_ZONE = "America/New_York";
const WATCHLIST_BACKTEST_OUTSIDE_RTH = false;
const SHADOW_ORDER_HISTORY_LIMIT = 5_000;

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
type ShadowAccountRow = typeof shadowAccountsTable.$inferSelect;
type ShadowFillRow = typeof shadowFillsTable.$inferSelect;
type ShadowOrderRow = typeof shadowOrdersTable.$inferSelect;

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
  watchlists: Array<{ id: string; name: string }>;
  fillSource: string;
};

type WatchlistBacktestSkip = {
  symbol: string;
  reason: string;
  detail: string;
  signalAt?: Date | null;
  watchlists?: Array<{ id: string; name: string }>;
};

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

async function writeShadowBalanceSnapshot(source = "ledger") {
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
  await assertIbkrGatewayTradingAvailable();
  await ensureShadowAccount();
  const normalized = normalizeShadowOrderInput(input);
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
  await assertIbkrGatewayTradingAvailable();
  await ensureShadowAccount();
  const normalized = normalizeShadowOrderInput(input);

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
  if (refreshMarks) {
    await refreshShadowPositionMarks().catch((error) => {
      logger.debug?.({ err: error }, "Shadow mark refresh failed");
    });
  }
  return computeShadowTotals();
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
      dayPnl: metric(totals.unrealizedPnl, SHADOW_CURRENCY, "UnrealizedPnL", totals.updatedAt),
      dayPnlPercent: metric(
        totals.netLiquidation ? (totals.unrealizedPnl / totals.netLiquidation) * 100 : null,
        null,
        "UnrealizedPnL/NetLiquidation",
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

export async function getShadowAccountEquityHistory(input: {
  range?: AccountRange;
  benchmark?: string | null;
}) {
  const range = normalizeAccountRange(input.range);
  const totals = await ensureFreshShadowState(true);
  const account = (await readShadowAccount())!;
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
  const bucketSize = accountSnapshotBucketSizeMs(range);
  const compacted = bucketSize
    ? Array.from(
        rows
          .reduce((map, row) => {
            const bucket = Math.floor(row.asOf.getTime() / bucketSize);
            map.set(bucket, row);
            return map;
          }, new Map<number, (typeof rows)[number]>())
          .values(),
      )
    : rows;
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
    ...(start && initialPoint.timestamp < start ? [] : [initialPoint]),
    ...compacted.map((row) => ({
      timestamp: row.asOf,
      netLiquidation: toNumber(row.netLiquidation) ?? 0,
      currency: row.currency,
      source: "SHADOW_LEDGER",
      deposits: 0,
      withdrawals: 0,
      dividends: 0,
      fees: toNumber(row.fees) ?? 0,
    })),
    ...(!start || totals.updatedAt.getTime() >= start.getTime()
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
    terminalPointSource: "shadow_ledger",
    liveTerminalIncluded: false,
    points: seedPoints.map((point) => ({
      ...point,
      returnPercent: baseline ? ((point.netLiquidation - baseline) / baseline) * 100 : 0,
      benchmarkPercent: null,
    })),
    events: [
      {
        timestamp: account.createdAt,
        type: "deposit",
        amount: SHADOW_STARTING_BALANCE,
        currency: SHADOW_CURRENCY,
        source: "SHADOW_LEDGER",
      },
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
  const rows = filtered.map((position) => {
    const quantity = toNumber(position.quantity) ?? 0;
    const averageCost = toNumber(position.averageCost) ?? 0;
    const mark = toNumber(position.mark) ?? 0;
    const unrealizedPnl = toNumber(position.unrealizedPnl) ?? 0;
    const marketValue = toNumber(position.marketValue) ?? 0;
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
      dayChange: unrealizedPnl,
      dayChangePercent: averageCost ? ((mark - averageCost) / averageCost) * 100 : null,
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

export async function getShadowAccountRisk() {
  const totals = await ensureFreshShadowState(true);
  const positionsResponse = await getShadowAccountPositions({});
  const closedTrades = await getShadowAccountClosedTrades({});
  const positionRows = positionsResponse.positions.map((position) => ({
    symbol: position.symbol,
    marketValue: position.marketValue,
    weightPercent: position.weightPercent,
    unrealizedPnl: position.unrealizedPnl,
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
        .filter((row) => row.unrealizedPnl > 0)
        .sort((a, b) => b.unrealizedPnl - a.unrealizedPnl)
        .slice(0, 5),
      todayLosers: positionRows
        .filter((row) => row.unrealizedPnl < 0)
        .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)
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
  positions: Array<{ assetClass: string; id: string }>,
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
    // Position rows expose option expiry in the description; detailed expiry notional
    // is kept conservative until the UI consumes option metadata directly.
    const source = positions.find((candidate) => candidate.id === position.id);
    if (!source) {
      return;
    }
    const expiryMatch = "description" in source
      ? String(source.description).match(/\d{4}-\d{2}-\d{2}/)
      : null;
    const expiry = expiryMatch ? new Date(`${expiryMatch[0]}T00:00:00.000Z`).getTime() : null;
    const value = "marketValue" in source ? Math.abs(Number(source.marketValue) || 0) : 0;
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
  if (!stopLossPercent && !trailingStopPercent) {
    return null;
  }
  const pieces = [
    stopLossPercent ? `SL${stopLossPercent}` : null,
    trailingStopPercent ? `TR${trailingStopPercent}` : null,
  ].filter(Boolean);
  return {
    label: readString(record.label) || pieces.join("_"),
    stopLossPercent,
    trailingStopPercent,
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
) {
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
      if (!symbol) {
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

async function collectWatchlistBacktestSignals(input: {
  universe: ReturnType<typeof collectWatchlistBacktestUniverse>;
  timeframe: ShadowWatchlistBacktestTimeframe;
  window: ReturnType<typeof resolveWatchlistBacktestWindow>;
}) {
  const settings = resolveRayReplicaSignalSettings({});
  const skipped: WatchlistBacktestSkip[] = [];
  const barLimit = watchlistBacktestBarLimit(input);
  const barsBySymbol = new Map<string, RayReplicaBar[]>();
  const candidates = await mapWithConcurrency(input.universe, 4, async (item) => {
    const barsResult = await getBars({
      symbol: item.symbol,
      timeframe: input.timeframe,
      limit: barLimit,
      to: input.window.end,
      assetClass: "equity",
      outsideRth: WATCHLIST_BACKTEST_OUTSIDE_RTH,
      source: "trades",
      allowHistoricalSynthesis: true,
    }).catch((error: unknown) => {
      skipped.push({
        symbol: item.symbol,
        reason: "bars_unavailable",
        detail: error instanceof Error ? error.message : "No historical bars were available.",
        watchlists: item.watchlists,
      });
      return { bars: [] as Awaited<ReturnType<typeof getBars>>["bars"] };
    });

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
      .map((signal) => {
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
          watchlists: item.watchlists,
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        Boolean(candidate),
      );
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

export function buildWatchlistBacktestFills(input: {
  runId: string;
  candidates: Awaited<ReturnType<typeof collectWatchlistBacktestSignals>>["candidates"];
  barsBySymbol?: Map<string, RayReplicaBar[]>;
  riskOverlay?: WatchlistBacktestRiskOverlay | null;
  startingTotals: ShadowTotals;
  baseMarketValue: number;
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
      lastStopCheckedAt: Date;
      positionKey: string;
      watchlists: Array<{ id: string; name: string }>;
    }
  >();
  let cash = input.startingTotals.cash;
  let syntheticRealizedPnl = 0;
  let syntheticFees = 0;
  const targetNotional =
    input.startingTotals.netLiquidation * WATCHLIST_BACKTEST_MAX_POSITION_FRACTION;
  const riskOverlay = input.riskOverlay ?? null;

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
    placedAt: Date;
    signalAt: Date;
    signalPrice: number | null;
    signalClose: number | null;
    watchlists: Array<{ id: string; name: string }>;
    fillSource: string;
  }) => {
    const quantity = sellInput.current.quantity;
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
    open.delete(sellInput.symbol);
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
      watchlists: sellInput.watchlists,
      fillSource: sellInput.fillSource,
    });
    pushSnapshot(sellInput.placedAt);
  };

  const flushRiskStopsUntil = (until: Date) => {
    if (!riskOverlay || !input.barsBySymbol) {
      return;
    }
    for (const [symbol, position] of Array.from(open.entries())) {
      const bars = input.barsBySymbol.get(symbol) ?? [];
      for (const bar of bars) {
        if (!open.has(symbol)) {
          break;
        }
        const barAt = new Date(bar.time * 1000);
        if (barAt <= position.lastStopCheckedAt || barAt > until) {
          continue;
        }
        if (
          !isWatchlistBacktestRegularSessionTime(barAt, {
            allowClosePrint: true,
          })
        ) {
          position.lastStopCheckedAt = barAt;
          continue;
        }

        const triggered: Array<{ price: number; source: string }> = [];
        if (riskOverlay.stopLossPercent) {
          const stopPrice =
            position.averageCost * (1 - riskOverlay.stopLossPercent / 100);
          if (bar.l <= stopPrice) {
            triggered.push({ price: stopPrice, source: "stop_loss" });
          }
        }
        if (riskOverlay.trailingStopPercent) {
          const trailingStopPrice =
            position.highestMark * (1 - riskOverlay.trailingStopPercent / 100);
          if (bar.l <= trailingStopPrice) {
            triggered.push({
              price: trailingStopPrice,
              source: "trailing_stop",
            });
          }
        }

        if (triggered.length) {
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
            fillSource: `risk_${selected.source}:${riskOverlay.label}`,
          });
          break;
        }

        position.highestMark = Math.max(position.highestMark, bar.h, bar.c);
        position.lastMark = cents(bar.c);
        position.lastStopCheckedAt = barAt;
      }
    }
  };

  for (const candidate of input.candidates) {
    flushRiskStopsUntil(candidate.placedAt);
    const price = candidate.fillPrice;
    if (!Number.isFinite(price) || price <= 0) {
      skipped.push({
        symbol: candidate.symbol,
        reason: "invalid_fill_price",
        detail: "The signal did not have a usable fill price.",
        signalAt: candidate.signalAt,
        watchlists: candidate.watchlists,
      });
      continue;
    }

    const current = open.get(candidate.symbol);
    if (candidate.side === "buy") {
      if (current) {
        skipped.push({
          symbol: candidate.symbol,
          reason: "same_symbol_position_open",
          detail: "A synthetic position for this symbol was already open.",
          signalAt: candidate.signalAt,
          watchlists: candidate.watchlists,
        });
        continue;
      }
      if (open.size >= WATCHLIST_BACKTEST_MAX_OPEN_POSITIONS) {
        skipped.push({
          symbol: candidate.symbol,
          reason: "max_open_positions",
          detail: `Synthetic backtest is capped at ${WATCHLIST_BACKTEST_MAX_OPEN_POSITIONS} open positions.`,
          signalAt: candidate.signalAt,
          watchlists: candidate.watchlists,
        });
        continue;
      }
      const { quantity, fees } = quantityForCash({
        cash,
        price,
        targetNotional,
      });
      if (quantity <= 0) {
        skipped.push({
          symbol: candidate.symbol,
          reason: "insufficient_cash",
          detail: "Available Shadow cash could not buy one whole share after fees.",
          signalAt: candidate.signalAt,
          watchlists: candidate.watchlists,
        });
        continue;
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
        lastStopCheckedAt: candidate.placedAt,
        positionKey,
        watchlists: candidate.watchlists,
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
        watchlists: candidate.watchlists,
        fillSource: candidate.fillSource,
      });
      pushSnapshot(candidate.placedAt);
      continue;
    }

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
    sellOpenPosition({
      symbol: candidate.symbol,
      current,
      price,
      placedAt: candidate.placedAt,
      signalAt: candidate.signalAt,
      signalPrice: candidate.signalPrice,
      signalClose: candidate.signalClose,
      watchlists: candidate.watchlists,
      fillSource: candidate.fillSource,
    });
  }

  if (input.windowEnd) {
    flushRiskStopsUntil(input.windowEnd);
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
          positionKey: fill.positionKey,
          signalAt: fill.signalAt.toISOString(),
          signalPrice: fill.signalPrice,
          signalClose: fill.signalClose,
          fillSource: fill.fillSource,
          watchlists: fill.watchlists,
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
};

export async function runShadowWatchlistBacktest(input: {
  marketDate?: string | null;
  marketDateFrom?: string | null;
  marketDateTo?: string | null;
  range?: string | null;
  timeframe?: string | null;
  riskOverlay?: unknown;
} = {}) {
  await ensureShadowAccount();
  const runId = randomUUID();
  const timeframe = normalizeWatchlistBacktestTimeframe(input.timeframe);
  const riskOverlay = normalizeWatchlistBacktestRiskOverlay(input.riskOverlay);
  const window = resolveWatchlistBacktestWindow({
    marketDate: input.marketDate,
    marketDateFrom: input.marketDateFrom,
    marketDateTo: input.marketDateTo,
    range: input.range,
  });

  await resetWatchlistBacktestRowsForRange({
    marketDateFrom: window.marketDateFrom,
    marketDateTo: window.marketDateTo,
    rangeKey: window.rangeKey,
    windowStart: window.start,
    cleanupEnd: window.cleanupEnd,
    replaceAll: true,
  });
  await refreshShadowPositionMarks().catch((error) => {
    logger.debug?.({ err: error }, "Shadow mark refresh before watchlist backtest failed");
  });
  const startingTotals = await computeShadowTotals();
  const baseMarketValue = startingTotals.marketValue;
  const { watchlists } = await listWatchlists();
  const universe = collectWatchlistBacktestUniverse(watchlists);
  const signalScan = await collectWatchlistBacktestSignals({
    universe,
    timeframe,
    window,
  });
  const simulation = buildWatchlistBacktestFills({
    runId,
    candidates: signalScan.candidates,
    barsBySymbol: signalScan.barsBySymbol,
    riskOverlay,
    startingTotals,
    baseMarketValue,
    marketDate: window.rangeKey,
    windowEnd: window.end,
  });

  await insertWatchlistBacktestFills({
    runId,
    marketDateFrom: window.marketDateFrom,
    marketDateTo: window.marketDateTo,
    rangeKey: window.rangeKey,
    windowStart: window.start,
    cleanupEnd: window.cleanupEnd,
    replaceAll: true,
    riskOverlay,
    fills: simulation.fills,
    snapshots: simulation.snapshots,
  });
  await writeShadowBalanceSnapshot(watchlistBacktestSnapshotSource(window.rangeKey));

  const finalTotals = await ensureFreshShadowState(true);
  const realizedPnl = simulation.fills.reduce(
    (sum, fill) => sum + fill.realizedPnl,
    0,
  );
  const fees = simulation.fills.reduce((sum, fill) => sum + fill.fees, 0);
  const buys = simulation.fills.filter((fill) => fill.side === "buy");
  const sells = simulation.fills.filter((fill) => fill.side === "sell");
  const openSyntheticSymbols = new Set(
    simulation.fills.reduce<string[]>((symbols, fill) => {
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

  return {
    runId,
    source: WATCHLIST_BACKTEST_SOURCE,
    marketDate: window.marketDate,
    marketDateFrom: window.marketDateFrom,
    marketDateTo: window.marketDateTo,
    rangeKey: window.rangeKey,
    timeframe,
    riskOverlay,
    window: {
      start: window.start,
      end: window.end,
      timezone: WATCHLIST_BACKTEST_TIME_ZONE,
    },
    sizing: {
      maxPositionFraction: WATCHLIST_BACKTEST_MAX_POSITION_FRACTION,
      maxOpenPositions: WATCHLIST_BACKTEST_MAX_OPEN_POSITIONS,
      wholeSharesOnly: true,
      startingNetLiquidation: startingTotals.netLiquidation,
      startingCash: startingTotals.cash,
    },
    universe: {
      watchlistCount: watchlists.length,
      symbolCount: universe.length,
      watchlists: watchlists.map((watchlist) => ({
        id: watchlist.id,
        name: watchlist.name,
        symbolCount: watchlist.items.length,
      })),
    },
    summary: {
      signals: signalScan.candidates.length,
      ordersCreated: simulation.fills.length,
      entries: buys.length,
      exits: sells.length,
      openSyntheticPositions: openSyntheticSymbols.size,
      skippedSignals: signalScan.skipped.length + simulation.skipped.length,
      realizedPnl,
      fees,
      endingNetLiquidation: finalTotals.netLiquidation,
      endingCash: finalTotals.cash,
    },
    fills: simulation.fills.map((fill) => ({
      symbol: fill.symbol,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      fees: fill.fees,
      realizedPnl: fill.realizedPnl,
      placedAt: fill.placedAt,
      signalAt: fill.signalAt,
      watchlists: fill.watchlists,
    })),
    skipped: [...signalScan.skipped, ...simulation.skipped],
    updatedAt: new Date(),
  };
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
