import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  BarSizeSetting,
  ConnectionState,
  IBApiNext,
  IBApiTickType as TickType,
  IBApiNextTickType as NextTickType,
  type Contract,
  type ContractDescription,
  type ContractDetails,
  MarketDataType as TwsMarketDataType,
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
import {
  isLiveIbkrMarketDataMode,
  resolveIbkrMarketDataMode,
} from "../../api-server/src/lib/runtime";
import type {
  IbkrMarketDataMode,
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
  IbkrUniverseTicker,
  OptionChainContract,
  OrderPreviewSnapshot,
  PlaceOrderInput,
  QuoteSnapshot,
  ReplaceOrderSnapshot,
  ResolvedIbkrContract,
  SessionStatusSnapshot,
} from "../../api-server/src/providers/ibkr/client";
import { logger } from "./logger";
import type {
  BridgeHealth,
  BridgeLaneDiagnostics,
  BridgeLaneSettingsInput,
  BridgeOrdersResult,
  IbkrBridgeProvider,
} from "./provider";
import { limitValuesByBudget } from "./subscription-budget";
import {
  getBridgeRuntimeLimit,
  getBridgeRuntimeLimitSnapshot,
  setBridgeRuntimeLimitOverrides,
} from "./runtime-limits";
import {
  getBridgePressureState,
  getBridgeSchedulerConfigSnapshot,
  getBridgeSchedulerDiagnostics,
  runBridgeLane,
  setBridgeSchedulerOverrides,
} from "./work-scheduler";

const HISTORY_BAR_SIZE: Record<HistoryBarTimeframe, BarSizeSetting> = {
  "5s": BarSizeSetting.SECONDS_FIVE,
  "1m": BarSizeSetting.MINUTES_ONE,
  "5m": BarSizeSetting.MINUTES_FIVE,
  "15m": BarSizeSetting.MINUTES_FIFTEEN,
  "1h": BarSizeSetting.HOURS_ONE,
  "1d": BarSizeSetting.DAYS_ONE,
};

const HISTORY_STEP_MS: Record<HistoryBarTimeframe, number> = {
  "5s": 5_000,
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
  "AccountType",
  "NetLiquidation",
  "BuyingPower",
  "TotalCashValue",
  "SettledCash",
  "CashBalance",
  "AccruedCash",
  "InitMarginReq",
  "MaintMarginReq",
  "ExcessLiquidity",
  "Cushion",
  "SMA",
  "DayTradesRemaining",
  "DayTradesRemainingT+1",
  "DayTradesRemainingT+2",
  "DayTradesRemainingT+3",
  "DayTradesRemainingT+4",
  "DayTradingBuyingPower",
  "RegTEquity",
  "RegTMargin",
  "GrossPositionValue",
  "Leverage",
] as const;

const ACCOUNT_SUMMARY_REQUEST = ACCOUNT_SUMMARY_TAGS.join(",");
const CONTRACT_CACHE_TTL_MS = 5 * 60_000;

type SummarySnapshot = {
  accountType: string | null;
  buyingPower: number;
  cash: number;
  currency: string;
  netLiquidation: number;
  totalCashValue: number | null;
  settledCash: number | null;
  accruedCash: number | null;
  initialMargin: number | null;
  maintenanceMargin: number | null;
  excessLiquidity: number | null;
  cushion: number | null;
  sma: number | null;
  dayTradingBuyingPower: number | null;
  regTInitialMargin: number | null;
  grossPositionValue: number | null;
  leverage: number | null;
  dayTradesRemaining: number | null;
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

type StructuredOptionContractIdentity = {
  underlying: string;
  expirationDate: Date;
  strike: number;
  right: "call" | "put";
  exchange: string;
  tradingClass: string | null;
  multiplier: number;
};

type QuoteSubscription = {
  contract: Contract;
  providerContractId: string;
  symbol: string;
  assetClass: "equity" | "option";
  stop(): void;
};

type DepthSubscription = {
  contract: Contract;
  stop(): void;
};

type BarStreamSubscription = {
  key: string;
  listeners: Map<number, (bar: BrokerBarSnapshot) => void>;
  errorListeners: Map<number, (error: unknown) => void>;
  latestSignature: string | null;
  latestBar: BrokerBarSnapshot | null;
  stop(): void;
};

type QuoteStreamListener = {
  id: number;
  symbols: Set<string>;
  providerContractIds: Set<string>;
  onQuote: (quote: QuoteSnapshot) => void;
};

type HistoricalRecoveryContext = {
  operation: string;
  symbol: string;
  timeframe: HistoryBarTimeframe;
  assetClass?: "equity" | "option";
  providerContractId?: string | null;
};

type TwsPositionSnapshot = {
  account: string;
  contract: Contract;
  pos: number;
  avgCost?: number;
  marketPrice?: number;
  marketValue?: number;
  unrealizedPNL?: number;
  realizedPNL?: number;
};

type TwsPositionsMap = ReadonlyMap<string, TwsPositionSnapshot[]>;

type TwsPositionsUpdate = {
  all?: TwsPositionsMap;
  added?: TwsPositionsMap;
  changed?: TwsPositionsMap;
  removed?: TwsPositionsMap;
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

const STRUCTURED_OPTION_PROVIDER_CONTRACT_ID_PREFIX = "twsopt:";

function parseOptionExpiry(value: string): Date | null {
  if (!/^\d{8}$/.test(value)) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildOptionContractTicker(
  identity: StructuredOptionContractIdentity,
): string {
  const strikeText = String(identity.strike).replace(".", "");
  return `${identity.underlying}${formatOptionExpiry(identity.expirationDate)}${identity.right === "call" ? "C" : "P"}${strikeText}`;
}

function buildOptionContractCacheKey(
  identity: Pick<
    StructuredOptionContractIdentity,
    "underlying" | "expirationDate" | "strike" | "right"
  >,
): string {
  return `${normalizeSymbol(identity.underlying)}:${formatOptionExpiry(identity.expirationDate)}:${identity.strike}:${identity.right}`;
}

function normalizeOptionExchange(value: unknown): string {
  return normalizeSymbol(asString(value) ?? "") || "SMART";
}

function normalizeOptionTradingClass(value: unknown): string | null {
  return normalizeSymbol(asString(value) ?? "") || null;
}

function normalizeOptionMultiplier(value: unknown): number {
  const multiplier = asNumber(value);
  return multiplier !== null && Number.isFinite(multiplier) && multiplier > 0
    ? multiplier
    : 100;
}

function buildStructuredOptionProviderContractId(
  identity: StructuredOptionContractIdentity,
): string {
  const payload = {
    v: 1,
    u: normalizeSymbol(identity.underlying),
    e: formatOptionExpiry(identity.expirationDate),
    s: identity.strike,
    r: identity.right === "call" ? "C" : "P",
    x: normalizeOptionExchange(identity.exchange),
    tc: identity.tradingClass,
    m: normalizeOptionMultiplier(identity.multiplier),
  };
  return `${STRUCTURED_OPTION_PROVIDER_CONTRACT_ID_PREFIX}${Buffer.from(
    JSON.stringify(payload),
    "utf8",
  ).toString("base64url")}`;
}

function decodeStructuredOptionProviderContractId(
  providerContractId: string,
): StructuredOptionContractIdentity | null {
  const raw = providerContractId.trim();
  if (!raw.startsWith(STRUCTURED_OPTION_PROVIDER_CONTRACT_ID_PREFIX)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(
        raw.slice(STRUCTURED_OPTION_PROVIDER_CONTRACT_ID_PREFIX.length),
        "base64url",
      ).toString("utf8"),
    ) as Record<string, unknown>;
    if (payload["v"] !== 1) {
      return null;
    }

    const underlying = normalizeSymbol(asString(payload["u"]) ?? "");
    const expirationDate = parseOptionExpiry(asString(payload["e"]) ?? "");
    const strike = asNumber(payload["s"]);
    const rawRight = asString(payload["r"])?.toUpperCase();
    const right =
      rawRight === "C" ? "call" : rawRight === "P" ? "put" : null;

    if (!underlying || !expirationDate || strike === null || !right) {
      return null;
    }

    return {
      underlying,
      expirationDate,
      strike,
      right,
      exchange: normalizeOptionExchange(payload["x"]),
      tradingClass: normalizeOptionTradingClass(payload["tc"]),
      multiplier: normalizeOptionMultiplier(payload["m"]),
    };
  } catch {
    return null;
  }
}

function buildTwsOptionContractFromIdentity(
  identity: StructuredOptionContractIdentity,
): Contract {
  const contract: Contract = {
    symbol: normalizeSymbol(identity.underlying),
    secType: SecType.OPT,
    lastTradeDateOrContractMonth: formatOptionExpiry(identity.expirationDate),
    strike: identity.strike,
    right: identity.right === "call" ? OptionType.Call : OptionType.Put,
    exchange: normalizeOptionExchange(identity.exchange),
    currency: "USD",
    multiplier: normalizeOptionMultiplier(identity.multiplier),
  };

  if (identity.tradingClass) {
    contract.tradingClass = identity.tradingClass;
  }

  return contract;
}

function toOptionContractMetaFromIdentity(
  identity: StructuredOptionContractIdentity,
  providerContractId = buildStructuredOptionProviderContractId(identity),
): NonNullable<BrokerPositionSnapshot["optionContract"]> {
  const multiplier = normalizeOptionMultiplier(identity.multiplier);
  return {
    ticker: buildOptionContractTicker(identity),
    underlying: normalizeSymbol(identity.underlying),
    expirationDate: identity.expirationDate,
    strike: identity.strike,
    right: identity.right,
    multiplier,
    sharesPerContract: multiplier,
    providerContractId,
  };
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

function buildHistoryDuration(
  timeframe: HistoryBarTimeframe,
  barCount: number,
): string {
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

function startOfUtcDay(date = new Date()): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function normalizeFutureExpirationDates(
  expirations: Array<Date | null>,
  maxExpirations?: number,
): Date[] {
  const todayUtc = startOfUtcDay();
  const sortedExpirations = Array.from(
    new Map(
      expirations
        .filter((expiration): expiration is Date => Boolean(expiration))
        .filter((expiration) => expiration.getTime() >= todayUtc)
        .map((expiration) => [
          expiration.toISOString().slice(0, 10),
          expiration,
        ]),
    ).values(),
  ).sort((left, right) => left.getTime() - right.getTime());

  if (typeof maxExpirations !== "number" || !Number.isFinite(maxExpirations)) {
    return sortedExpirations;
  }

  return sortedExpirations.slice(0, Math.max(1, Math.floor(maxExpirations)));
}

type TwsOptionParameterSet = {
  exchange?: unknown;
  tradingClass?: unknown;
  multiplier?: unknown;
  expirations?: Iterable<unknown> | null;
  strikes?: Iterable<unknown> | null;
};

type NormalizedTwsOptionParameterSet = {
  exchange: string;
  tradingClass: string | null;
  multiplier: number;
  expirations: Date[];
  expirationKeys: Set<string>;
  strikes: number[];
  strikeKeys: Set<number>;
};

type ResolvedTwsOptionParameters = {
  resolvedUnderlying: CachedStockContract;
  optionParams: readonly TwsOptionParameterSet[];
  error?: unknown;
};

function toIterableValues(
  value: Iterable<unknown> | null | undefined,
): unknown[] {
  if (!value) {
    return [];
  }

  return Array.from(value);
}

function hasOptionDerivative(description: ContractDescription): boolean {
  return normalizeDerivativeSecTypes(description.derivativeSecTypes).includes(
    "OPT",
  );
}

function scoreOptionableStockDescription(
  description: ContractDescription,
  normalizedSymbol: string,
): number {
  const contract = description.contract;
  if (!contract) {
    return 0;
  }

  const symbol = normalizeSymbol(asString(contract.symbol) ?? "");
  const secType = asString(contract.secType)?.toUpperCase();
  const currency = asString(contract.currency)?.toUpperCase();
  const exchange = (
    asString(contract.primaryExch) ??
    asString(contract.exchange) ??
    ""
  ).toUpperCase();
  let score = 0;

  if (symbol === normalizedSymbol) score += 1_000;
  if (secType === "STK") score += 500;
  if (currency === "USD") score += 300;
  if (hasOptionDerivative(description)) score += 2_000;
  if (/^(ARCA|ARCX|NASDAQ|NYSE|AMEX|BATS|IEX)$/.test(exchange)) {
    score += 100;
  }

  return score;
}

function normalizeDerivativeSecTypes(value: unknown): string[] {
  if (!value) {
    return [];
  }

  const rawValues =
    typeof value === "string"
      ? value.split(/[,\s]+/)
      : typeof (value as Iterable<unknown>)[Symbol.iterator] === "function"
        ? Array.from(value as Iterable<unknown>)
        : [];

  return rawValues
    .map((entry) => asString(entry)?.trim().toUpperCase())
    .filter((entry): entry is string => Boolean(entry));
}

function scoreStockContractDetail(
  detail: { contract?: Contract },
  normalizedSymbol: string,
): number {
  const contract = detail.contract;
  if (!contract) {
    return 0;
  }

  const symbol = normalizeSymbol(asString(contract.symbol) ?? "");
  const secType = asString(contract.secType)?.toUpperCase();
  const currency = asString(contract.currency)?.toUpperCase();
  const exchange = (
    asString(contract.primaryExch) ??
    asString(contract.exchange) ??
    ""
  ).toUpperCase();
  let score = 0;

  if (symbol === normalizedSymbol) score += 1_000;
  if (secType === "STK") score += 500;
  if (currency === "USD") score += 300;
  if (/^(ARCA|ARCX|NASDAQ|NYSE|AMEX|BATS|IEX)$/.test(exchange)) {
    score += 250;
  }
  if (exchange === "SMART") {
    score += 50;
  }
  if (/^(ASX|MEXI|MEXDER|LSE|FWB|TSE|SEHK)$/.test(exchange)) {
    score -= 500;
  }

  return score;
}

function toCachedStockContract(
  contract: Contract | undefined,
  normalizedSymbol: string,
): CachedStockContract | null {
  const conid = asNumber(contract?.conId);
  if (!contract || conid === null) {
    return null;
  }

  return {
    resolved: {
      conid,
      symbol: normalizedSymbol,
      secType: asString(contract.secType) ?? "STK",
      listingExchange:
        asString(contract.primaryExch) ??
        asString(contract.exchange) ??
        "SMART",
      providerContractId: String(conid),
    },
    contract,
    cachedAt: Date.now(),
  };
}

export function collectTwsOptionParameters(
  parameterSets: readonly TwsOptionParameterSet[],
  maxExpirations?: number,
): { expirations: Date[]; strikes: number[] } {
  const expirations = normalizeFutureExpirationDates(
    parameterSets.flatMap((parameterSet) =>
      toIterableValues(parameterSet.expirations).map((expiration) =>
        toDate(expiration),
      ),
    ),
    maxExpirations,
  );
  const strikes = Array.from(
    new Set(
      parameterSets
        .flatMap((parameterSet) => toIterableValues(parameterSet.strikes))
        .map((strike) => asNumber(strike))
        .filter((strike): strike is number => strike !== null),
    ),
  )
    .filter((strike) => Number.isFinite(strike))
    .sort((left, right) => left - right);

  return { expirations, strikes };
}

function normalizeTwsOptionParameterSets(
  parameterSets: readonly TwsOptionParameterSet[],
  normalizedUnderlying: string,
): NormalizedTwsOptionParameterSet[] {
  return parameterSets
    .map((parameterSet): NormalizedTwsOptionParameterSet | null => {
      const expirations = normalizeFutureExpirationDates(
        toIterableValues(parameterSet.expirations).map((expiration) =>
          toDate(expiration),
        ),
      );
      const strikes = Array.from(
        new Set(
          toIterableValues(parameterSet.strikes)
            .map((strike) => asNumber(strike))
            .filter((strike): strike is number => strike !== null),
        ),
      )
        .filter((strike) => Number.isFinite(strike))
        .sort((left, right) => left - right);

      if (!expirations.length || !strikes.length) {
        return null;
      }

      return {
        exchange: normalizeOptionExchange(parameterSet.exchange),
        tradingClass:
          normalizeOptionTradingClass(parameterSet.tradingClass) ??
          normalizedUnderlying,
        multiplier: normalizeOptionMultiplier(parameterSet.multiplier),
        expirations,
        expirationKeys: new Set(
          expirations.map((expiration) => formatOptionExpiry(expiration)),
        ),
        strikes,
        strikeKeys: new Set(strikes),
      };
    })
    .filter(
      (parameterSet): parameterSet is NormalizedTwsOptionParameterSet =>
        parameterSet !== null,
    )
    .sort(
      (left, right) =>
        scoreTwsOptionParameterSet(right, normalizedUnderlying) -
        scoreTwsOptionParameterSet(left, normalizedUnderlying),
    );
}

function buildAggregateTwsOptionParameterSet(
  input: {
    optionParameters: ReturnType<typeof collectTwsOptionParameters>;
    normalizedUnderlying: string;
  },
): NormalizedTwsOptionParameterSet | null {
  if (
    !input.optionParameters.expirations.length ||
    !input.optionParameters.strikes.length
  ) {
    return null;
  }

  return {
    exchange: "SMART",
    tradingClass: input.normalizedUnderlying,
    multiplier: 100,
    expirations: input.optionParameters.expirations,
    expirationKeys: new Set(
      input.optionParameters.expirations.map((expiration) =>
        formatOptionExpiry(expiration),
      ),
    ),
    strikes: input.optionParameters.strikes,
    strikeKeys: new Set(input.optionParameters.strikes),
  };
}

function scoreTwsOptionParameterSet(
  parameterSet: NormalizedTwsOptionParameterSet,
  normalizedUnderlying: string,
): number {
  let score = 0;
  if (parameterSet.exchange === "SMART") score += 5;
  if (parameterSet.tradingClass === normalizedUnderlying) score += 4;
  else if (parameterSet.tradingClass?.startsWith(normalizedUnderlying)) {
    score += 2;
  }
  if (parameterSet.multiplier === 100) score += 1;
  return score;
}

export function selectRelevantOptionStrikes(input: {
  strikes: readonly number[];
  spotPrice: number | null | undefined;
  strikesAroundMoney?: number;
  strikeCoverage?: "fast" | "standard" | "full" | null;
}): number[] {
  const strikes = Array.from(new Set(input.strikes))
    .filter((strike) => Number.isFinite(strike))
    .sort((left, right) => left - right);

  if (input.strikeCoverage === "full") {
    return strikes;
  }

  const strikesAroundMoney = Math.max(
    1,
    Math.floor(input.strikesAroundMoney ?? 12),
  );
  const windowSize = Math.min(strikes.length, strikesAroundMoney * 2 + 1);
  if (strikes.length <= windowSize) {
    return strikes;
  }

  const spotPrice =
    typeof input.spotPrice === "number" && Number.isFinite(input.spotPrice)
      ? input.spotPrice
      : null;
  const anchorIndex =
    spotPrice !== null && spotPrice > 0
      ? strikes.reduce(
          (bestIndex, strike, index) =>
            Math.abs(strike - spotPrice) <
            Math.abs(strikes[bestIndex] - spotPrice)
              ? index
              : bestIndex,
          0,
        )
      : Math.floor(strikes.length / 2);

  let start = anchorIndex - strikesAroundMoney;
  let end = anchorIndex + strikesAroundMoney + 1;

  if (start < 0) {
    end = Math.min(strikes.length, end - start);
    start = 0;
  }
  if (end > strikes.length) {
    start = Math.max(0, start - (end - strikes.length));
    end = strikes.length;
  }

  return strikes.slice(start, end);
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

function toBrokerBarSnapshotFromHistoricalBar(input: {
  bar: {
    time?: string;
    open?: number | string;
    high?: number | string;
    low?: number | string;
    close?: number | string;
    volume?: number | string;
  };
  providerContractId: string | null;
  outsideRth: boolean;
  partial: boolean;
  delayed: boolean;
  marketDataMode?: IbkrMarketDataMode | null;
}): BrokerBarSnapshot | null {
  const timestamp = parseHistoricalBarTime(input.bar.time);
  const open = asNumber(input.bar.open);
  const high = asNumber(input.bar.high);
  const low = asNumber(input.bar.low);
  const close = asNumber(input.bar.close);
  const volume = asNumber(input.bar.volume) ?? 0;

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
    source: "ibkr-history",
    providerContractId: input.providerContractId,
    outsideRth: input.outsideRth,
    partial: input.partial,
    transport: "tws",
    delayed: input.delayed,
    freshness: resolveMarketDataFreshness(
      input.marketDataMode ?? null,
      input.delayed,
    ),
    marketDataMode: input.marketDataMode ?? null,
    dataUpdatedAt: timestamp,
    ageMs: null,
  } satisfies BrokerBarSnapshot;
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
    | ReadonlyMap<
        string,
        ReadonlyMap<string, { value: string; ingressTm: number }>
      >
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

function pickSummaryText(
  summary:
    | ReadonlyMap<
        string,
        ReadonlyMap<string, { value: string; ingressTm: number }>
      >
    | undefined,
  tags: readonly string[],
): string | null {
  if (!summary) {
    return null;
  }

  for (const tag of tags) {
    const values = summary.get(tag);
    if (!values) {
      continue;
    }

    for (const entry of values.values()) {
      if (entry.value.trim()) {
        return entry.value.trim();
      }
    }
  }

  return null;
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

function normalizeTwsSecType(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function isTwsEtfLikeContract(contract: Contract, name: string): boolean {
  const text = [
    asString(contract.description),
    asString(contract.localSymbol),
    asString(contract.tradingClass),
    name,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  return /\b(ETF|ETN|ETP|UCITS|SPDR|ISHARES|PROSHARES|INVESCO|VANGUARD|DIREXION|WISDOMTREE|GLOBAL X|GRAYSCALE)\b/.test(
    text,
  );
}

function inferTwsUniverseMarket(
  contract: Contract,
  name: string,
): IbkrUniverseTicker["market"] | null {
  const secType = normalizeTwsSecType(asString(contract.secType) ?? undefined);
  if (!secType) {
    return null;
  }

  if (secType === "STK" || secType === "ETF") {
    if (secType === "ETF" || isTwsEtfLikeContract(contract, name)) {
      return "etf";
    }

    const exchange = (
      asString(contract.primaryExch) ??
      asString(contract.exchange) ??
      ""
    ).toUpperCase();
    if (/^(OTC|OTCBB|OTCMKTS|PINK|PINX|GREY)$/.test(exchange)) {
      return "otc";
    }

    return "stocks";
  }

  if (secType === "IND") return "indices";
  if (secType === "FUT" || secType === "CONTFUT") return "futures";
  if (secType === "CASH") return "fx";
  if (secType === "CRYPTO") return "crypto";

  return null;
}

function buildTwsContractMeta(
  contract: Contract,
  derivativeSecTypes: ContractDescription["derivativeSecTypes"] | undefined,
): NonNullable<IbkrUniverseTicker["contractMeta"]> {
  const normalizedDerivativeSecTypes =
    normalizeDerivativeSecTypes(derivativeSecTypes);
  const entries: Record<string, string | number | boolean | null | undefined> =
    {
      conid: asNumber(contract.conId),
      secType: asString(contract.secType),
      primaryExchange: asString(contract.primaryExch),
      exchange: asString(contract.exchange),
      currency: asString(contract.currency),
      localSymbol: asString(contract.localSymbol),
      tradingClass: asString(contract.tradingClass),
      derivativeSecTypes: normalizedDerivativeSecTypes.length
        ? normalizedDerivativeSecTypes.join(",")
        : undefined,
    };

  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as NonNullable<IbkrUniverseTicker["contractMeta"]>;
}

export function mapTwsContractDescriptionToUniverseTicker(
  description: ContractDescription,
): IbkrUniverseTicker | null {
  const contract = description.contract;
  if (!contract) {
    return null;
  }

  const rawSymbol =
    asString(contract.symbol) ??
    asString(contract.localSymbol) ??
    asString(contract.tradingClass);
  const ticker = normalizeSymbol(rawSymbol ?? "");
  if (!ticker) {
    return null;
  }

  const contractDescription =
    asString(contract.description) ??
    asString(contract.localSymbol) ??
    asString(contract.tradingClass) ??
    ticker;
  const market = inferTwsUniverseMarket(contract, contractDescription);
  if (!market) {
    return null;
  }

  const secType = normalizeTwsSecType(asString(contract.secType) ?? undefined);
  const primaryExchange =
    asString(contract.primaryExch) ?? asString(contract.exchange);
  const providerContractId = asNumber(contract.conId);

  return {
    ticker,
    name: contractDescription,
    market,
    rootSymbol: ticker.split(/[./:\s-]+/)[0] || ticker,
    normalizedExchangeMic: primaryExchange ?? null,
    exchangeDisplay: primaryExchange ?? null,
    logoUrl: null,
    countryCode: null,
    exchangeCountryCode: null,
    sector: null,
    industry: null,
    contractDescription,
    contractMeta: buildTwsContractMeta(
      contract,
      description.derivativeSecTypes,
    ),
    locale: null,
    type: market === "etf" ? "ETF" : secType,
    active: true,
    primaryExchange: primaryExchange ?? null,
    currencyName: asString(contract.currency),
    cik: null,
    compositeFigi: null,
    shareClassFigi: null,
    lastUpdatedAt: null,
    provider: "ibkr",
    providers: ["ibkr"],
    tradeProvider: "ibkr",
    dataProviderPreference: "ibkr",
    providerContractId:
      providerContractId !== null ? String(providerContractId) : null,
  };
}

function scoreTwsUniverseTicker(
  ticker: IbkrUniverseTicker,
  query: string,
  requestedMarkets: Set<IbkrUniverseTicker["market"]>,
): number {
  const normalizedQuery = normalizeSymbol(query);
  const normalizedTicker = normalizeSymbol(ticker.ticker);
  const normalizedQueryLower = query.trim().toLowerCase();
  const normalizedName = ticker.name.trim().toLowerCase();
  let score = 0;

  if (ticker.providerContractId === query.trim()) score += 4_500;
  if (normalizedTicker === normalizedQuery) score += 3_000;
  else if (normalizedTicker.startsWith(normalizedQuery)) score += 1_050;
  else if (normalizedTicker.includes(normalizedQuery)) score += 780;

  if (normalizedName === normalizedQueryLower) score += 720;
  else if (normalizedName.startsWith(normalizedQueryLower)) score += 560;
  else if (normalizedName.includes(normalizedQueryLower)) score += 320;

  if (requestedMarkets.size && requestedMarkets.has(ticker.market))
    score += 120;
  if (ticker.providerContractId) score += 40;
  if (ticker.primaryExchange || ticker.exchangeDisplay) score += 10;

  return score;
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

  if (
    normalized.includes("pendingsubmit") ||
    normalized.includes("apipending")
  ) {
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
  ...candidates: number[]
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

function resolveMarketDataFreshness(
  marketDataMode: IbkrMarketDataMode | null,
  delayed = false,
):
  | "live"
  | "delayed"
  | "frozen"
  | "delayed_frozen"
  | "stale"
  | "metadata"
  | "unavailable" {
  if (marketDataMode === "frozen") {
    return "frozen";
  }
  if (marketDataMode === "delayed_frozen") {
    return "delayed_frozen";
  }
  if (marketDataMode === "delayed" || delayed) {
    return "delayed";
  }
  if (marketDataMode === "live") {
    return "live";
  }
  return "unavailable";
}

function isLikelyUsEquitySession(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") {
    return false;
  }
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 25 && minutes <= 16 * 60 + 5;
}

// Pick the first option-computation tick that has a usable value, preferring
// the model computation (server-side Black-Scholes) and falling back to the
// last/bid/ask computations. Each variant has a delayed counterpart for
// non-live market data subscriptions.
function getOptionComputationValue(
  ticks: MarketDataTicks,
  variant: "iv" | "delta" | "gamma" | "vega" | "theta",
): number | null {
  const map = {
    iv: [
      NextTickType.MODEL_OPTION_IV,
      NextTickType.DELAYED_MODEL_OPTION_IV,
      NextTickType.LAST_OPTION_IV,
      NextTickType.DELAYED_LAST_OPTION_IV,
      NextTickType.BID_OPTION_IV,
      NextTickType.DELAYED_BID_OPTION_IV,
      NextTickType.ASK_OPTION_IV,
      NextTickType.DELAYED_ASK_OPTION_IV,
    ],
    delta: [
      NextTickType.MODEL_OPTION_DELTA,
      NextTickType.DELAYED_MODEL_OPTION_DELTA,
      NextTickType.LAST_OPTION_DELTA,
      NextTickType.DELAYED_LAST_OPTION_DELTA,
      NextTickType.BID_OPTION_DELTA,
      NextTickType.DELAYED_BID_OPTION_DELTA,
      NextTickType.ASK_OPTION_DELTA,
      NextTickType.DELAYED_ASK_OPTION_DELTA,
    ],
    gamma: [
      NextTickType.MODEL_OPTION_GAMMA,
      NextTickType.DELAYED_MODEL_OPTION_GAMMA,
      NextTickType.LAST_OPTION_GAMMA,
      NextTickType.DELAYED_LAST_OPTION_GAMMA,
      NextTickType.BID_OPTION_GAMMA,
      NextTickType.DELAYED_BID_OPTION_GAMMA,
      NextTickType.ASK_OPTION_GAMMA,
      NextTickType.DELAYED_ASK_OPTION_GAMMA,
    ],
    vega: [
      NextTickType.MODEL_OPTION_VEGA,
      NextTickType.DELAYED_MODEL_OPTION_VEGA,
      NextTickType.LAST_OPTION_VEGA,
      NextTickType.DELAYED_LAST_OPTION_VEGA,
      NextTickType.BID_OPTION_VEGA,
      NextTickType.DELAYED_BID_OPTION_VEGA,
      NextTickType.ASK_OPTION_VEGA,
      NextTickType.DELAYED_ASK_OPTION_VEGA,
    ],
    theta: [
      NextTickType.MODEL_OPTION_THETA,
      NextTickType.DELAYED_MODEL_OPTION_THETA,
      NextTickType.LAST_OPTION_THETA,
      NextTickType.DELAYED_LAST_OPTION_THETA,
      NextTickType.BID_OPTION_THETA,
      NextTickType.DELAYED_BID_OPTION_THETA,
      NextTickType.ASK_OPTION_THETA,
      NextTickType.DELAYED_ASK_OPTION_THETA,
    ],
  } satisfies Record<typeof variant, number[]>;

  return getTickValue(ticks, ...map[variant]);
}

function collectErrorMessages(
  error: unknown,
  seen = new Set<unknown>(),
): string[] {
  if (typeof error === "string") {
    return [error];
  }

  if (!error || typeof error !== "object" || seen.has(error)) {
    return [];
  }

  seen.add(error);
  const record = error as Record<string, unknown>;
  const messages: string[] = [];
  const message = asString(record["message"]);
  if (message) {
    messages.push(message);
  }

  for (const key of ["error", "cause", "detail"]) {
    messages.push(...collectErrorMessages(record[key], seen));
  }

  return Array.from(new Set(messages));
}

export function getErrorMessage(error: unknown): string {
  return collectErrorMessages(error).join(" | ");
}

function collectTwsErrorCodes(
  error: unknown,
  seen = new Set<unknown>(),
): number[] {
  if (!error || typeof error !== "object" || seen.has(error)) {
    return [];
  }

  seen.add(error);
  const record = error as Record<string, unknown>;
  const codes: number[] = [];
  const code = asNumber(record["code"]);
  if (code !== null) {
    codes.push(code);
  }

  for (const key of ["error", "cause", "detail"]) {
    codes.push(...collectTwsErrorCodes(record[key], seen));
  }

  for (const message of collectErrorMessages(error)) {
    const matches = message.match(/\b\d{3,5}\b/g) ?? [];
    matches
      .map((value) => Number.parseInt(value, 10))
      .filter(Number.isFinite)
      .forEach((value) => codes.push(value));
  }

  return Array.from(new Set(codes));
}

export function isSnapshotGenericTickError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("snapshot market data subscription") &&
    message.includes("generic")
  );
}

function hasConnectionLossMessage(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return [
    "connection reset",
    "connection refused",
    "connection closed",
    "connection lost",
    "not connected",
    "disconnected",
    "socket",
    "econnreset",
    "econnrefused",
    "broken pipe",
  ].some((fragment) => message.includes(fragment));
}

export function isHistoricalDataReconnectableError(error: unknown): boolean {
  const codes = collectTwsErrorCodes(error);
  if (codes.includes(2523)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  if (
    message.includes("api historical data query cancelled") ||
    (message.includes("historical market data service") &&
      message.includes("cancelled"))
  ) {
    return true;
  }

  return message.includes("historical") && hasConnectionLossMessage(error);
}

function isRequestScopedTwsError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    isSnapshotGenericTickError(error) ||
    isHistoricalDataReconnectableError(error) ||
    message.includes("no security definition has been found") ||
    (message.includes("can't find eid") && message.includes("tickerid")) ||
    message.includes("ibkr_bridge_lane_timeout") ||
    message.includes("lane timed out after") ||
    (message.includes("error validating request") &&
      message.includes("market data")) ||
    message.includes("max number of tickers") ||
    message.includes("market data line") ||
    message.includes("ticker limit") ||
    message.includes("subscription limit")
  );
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

export function toQuoteSnapshot(
  symbol: string,
  providerContractId: string | null,
  ticks: MarketDataTicks,
  marketDataType: 1 | 2 | 3 | 4,
): QuoteSnapshot {
  const hasLiveTicks =
    getTickValue(ticks, TickType.LAST) !== null ||
    getTickValue(ticks, TickType.BID) !== null ||
    getTickValue(ticks, TickType.ASK) !== null;
  const hasDelayedTicks =
    getTickValue(ticks, TickType.DELAYED_LAST) !== null ||
    getTickValue(ticks, TickType.DELAYED_BID) !== null ||
    getTickValue(ticks, TickType.DELAYED_ASK) !== null;
  const price =
    firstDefined(
      getTickValue(ticks, TickType.LAST, TickType.DELAYED_LAST),
      getTickValue(ticks, TickType.BID, TickType.DELAYED_BID),
      getTickValue(ticks, TickType.ASK, TickType.DELAYED_ASK),
    ) ?? 0;
  const bid =
    firstDefined(
      getTickValue(ticks, TickType.BID, TickType.DELAYED_BID),
      price,
    ) ?? 0;
  const ask =
    firstDefined(
      getTickValue(ticks, TickType.ASK, TickType.DELAYED_ASK),
      bid,
    ) ?? bid;
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
  const volume = getTickValue(
    ticks,
    TickType.OPTION_CALL_VOLUME,
    TickType.OPTION_PUT_VOLUME,
    TickType.VOLUME,
    TickType.DELAYED_VOLUME,
  );
  const openInterest = getTickValue(
    ticks,
    TickType.OPTION_CALL_OPEN_INTEREST,
    TickType.OPTION_PUT_OPEN_INTEREST,
    TickType.OPEN_INTEREST,
  );
  const impliedVolatility = getOptionComputationValue(ticks, "iv");
  const delta = getOptionComputationValue(ticks, "delta");
  const gamma = getOptionComputationValue(ticks, "gamma");
  const theta = getOptionComputationValue(ticks, "theta");
  const vega = getOptionComputationValue(ticks, "vega");
  const updatedAt = new Date();
  const change = prevClose !== null ? price - prevClose : 0;
  const changePercent = prevClose ? (change / prevClose) * 100 : 0;
  const delayed =
    marketDataType === 3 ||
    marketDataType === 4 ||
    (!hasLiveTicks && hasDelayedTicks);
  const marketDataMode = resolveIbkrMarketDataMode(marketDataType);

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
    openInterest,
    impliedVolatility,
    delta,
    gamma,
    theta,
    vega,
    updatedAt,
    providerContractId,
    transport: "tws",
    delayed,
    freshness: resolveMarketDataFreshness(marketDataMode, delayed),
    marketDataMode,
    dataUpdatedAt: updatedAt,
    ageMs: null,
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
    levels: Array.from(rows.values()).sort(
      (left, right) => left.row - right.row,
    ),
  };
}

export class TwsIbkrBridgeProvider implements IbkrBridgeProvider {
  private readonly api: IBApiNext;
  private readonly stockContracts = new Map<string, CachedStockContract>();
  private readonly optionContracts = new Map<string, CachedOptionContract>();
  private readonly quoteSubscriptions = new Map<string, QuoteSubscription>();
  private readonly quotesByProviderContractId = new Map<
    string,
    QuoteSnapshot
  >();
  private readonly prewarmQuoteSymbols = new Set<string>();
  private readonly quoteStreamListeners = new Map<
    number,
    QuoteStreamListener
  >();
  private readonly barStreamSubscriptions = new Map<
    string,
    BarStreamSubscription
  >();
  private readonly depthSubscriptions = new Map<string, DepthSubscription>();
  private readonly depthByKey = new Map<string, BrokerMarketDepthSnapshot>();
  private readonly accountSummaries = new Map<string, SummarySnapshot>();
  private readonly positionsByAccount = new Map<
    string,
    BrokerPositionSnapshot[]
  >();
  private readonly orderTimestamps = new Map<
    string,
    { placedAt: Date; updatedAt: Date }
  >();
  private readonly liveOrdersById = new Map<string, BrokerOrderSnapshot>();
  private readonly baseSubscriptionStops: Array<() => void> = [];
  private connectPromise: Promise<void> | null = null;
  private reconnectPromise: Promise<void> | null = null;
  private tickleTimer: NodeJS.Timeout | null = null;
  private connectionState = ConnectionState.Disconnected;
  private latestSession: SessionStatusSnapshot | null = null;
  private lastTickleAt: Date | null = null;
  private lastError: string | null = null;
  private lastRecoveryAttemptAt: Date | null = null;
  private lastRecoveryError: string | null = null;
  private managedAccounts: string[] = [];
  private baseSubscriptionsStarted = false;
  private accountSummaryInitialized = false;
  private positionsInitialized = false;
  private openOrdersInitialized = false;
  private nextQuoteStreamListenerId = 1;
  private lastEquityBudgetDropSignature: string | null = null;
  private lastOptionBudgetDropSignature: string | null = null;
  private lastCombinedBudgetDropSignature: string | null = null;
  private lastReconnectReason: string | null = null;
  private lastQuoteEventAt: Date | null = null;
  private lastAggregateSourceEventAt: Date | null = null;
  private quoteEventCount = 0;
  private optionQuoteEventCount = 0;
  private readonly optionMetaInFlight = new Map<string, Promise<unknown>>();

  private get tickleIntervalMs(): number {
    return getBridgeRuntimeLimit("tickleIntervalMs");
  }

  private get historicalReconnectMaxRetries(): number {
    return getBridgeRuntimeLimit("historicalReconnectMaxRetries");
  }

  private get maxLiveEquityLines(): number {
    return getBridgeRuntimeLimit("maxLiveEquityLines");
  }

  private get maxLiveOptionLines(): number {
    return getBridgeRuntimeLimit("maxLiveOptionLines");
  }

  private get maxMarketDataLines(): number {
    return getBridgeRuntimeLimit("maxMarketDataLines");
  }

  private get optionQuoteVisibleContractLimit(): number {
    return getBridgeRuntimeLimit("optionQuoteVisibleContractLimit");
  }

  private get genericTickSampleMs(): number {
    return getBridgeRuntimeLimit("genericTickSampleMs");
  }

  private get connectTimeoutMs(): number {
    return getBridgeRuntimeLimit("connectTimeoutMs");
  }

  private get openOrdersRequestTimeoutMs(): number {
    return getBridgeRuntimeLimit("openOrdersRequestTimeoutMs");
  }

  private get postSubmitOrderLookupTimeoutMs(): number {
    return Math.max(1, Math.min(1_000, this.openOrdersRequestTimeoutMs));
  }

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
        this.api.setMarketDataType(
          this.config.marketDataType as TwsMarketDataType,
        );
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
    const message = getErrorMessage(error);
    if (
      this.connectionState === ConnectionState.Connected &&
      (message.includes("ibkr_bridge_lane_queue_full") ||
        message.includes("Lane queue is full"))
    ) {
      logger.debug(
        { err: error },
        "Ignoring bridge lane backpressure for TWS connection health",
      );
      return;
    }
    if (
      this.connectionState === ConnectionState.Connected &&
      isRequestScopedTwsError(error)
    ) {
      logger.debug(
        { err: error },
        "Ignoring request-scoped TWS error for bridge health",
      );
      return;
    }
    this.lastError = message || "Unknown IBKR TWS bridge error.";
  }

  private ensureTickleLoop() {
    if (this.tickleTimer) {
      return;
    }

    this.tickleTimer = setInterval(
      () => {
        void this.tickle().catch(() => {});
      },
      Math.max(10_000, this.tickleIntervalMs),
    );
    this.tickleTimer.unref?.();
  }

  shutdown(): void {
    if (this.tickleTimer) {
      clearInterval(this.tickleTimer);
      this.tickleTimer = null;
    }

    this.baseSubscriptionStops.splice(0).forEach((stop) => {
      try {
        stop();
      } catch (error) {
        logger.warn({ err: error }, "IBKR base subscription shutdown failed");
      }
    });

    this.quoteStreamListeners.clear();
    this.quoteSubscriptions.forEach((subscription) => {
      try {
        subscription.stop();
      } catch (error) {
        logger.warn({ err: error }, "IBKR quote subscription shutdown failed");
      }
    });
    this.quoteSubscriptions.clear();
    this.barStreamSubscriptions.forEach((subscription) => {
      try {
        subscription.stop();
      } catch (error) {
        logger.warn({ err: error }, "IBKR bar subscription shutdown failed");
      }
    });
    this.barStreamSubscriptions.clear();
    this.depthSubscriptions.forEach((subscription) => {
      try {
        subscription.stop();
      } catch (error) {
        logger.warn({ err: error }, "IBKR depth subscription shutdown failed");
      }
    });
    this.depthSubscriptions.clear();

    try {
      this.api.disconnect();
    } catch (error) {
      logger.warn({ err: error }, "IBKR TWS disconnect during shutdown failed");
    }
  }

  private buildSessionSnapshot(): SessionStatusSnapshot {
    const connected = this.connectionState === ConnectionState.Connected;
    const selectedAccountId =
      this.config.defaultAccountId ?? this.managedAccounts[0] ?? null;

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
      if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
        break;
      }

      await sleep(intervalMs);
    }
  }

  private async getAllOpenOrderSnapshots(): Promise<BridgeOrdersResult> {
    const fallback = () => Array.from(this.liveOrdersById.values());
    let timeout: NodeJS.Timeout | null = null;

    if (this.openOrdersInitialized) {
      return { orders: fallback() };
    }

    try {
      const result = await Promise.race<BridgeOrdersResult>([
        this.api.getAllOpenOrders().then((openOrders) => ({
          orders: compact(
            openOrders.map((order) => this.toBrokerOrderSnapshot(order)),
          ),
        })),
        new Promise<BridgeOrdersResult>((resolve) => {
          timeout = setTimeout(
            () =>
              resolve({
                orders: fallback(),
                degraded: true,
                reason: "open_orders_timeout",
                stale: true,
                timeoutMs: this.openOrdersRequestTimeoutMs,
              }),
            Math.max(1, this.openOrdersRequestTimeoutMs),
          );
          timeout.unref?.();
        }),
      ]);

      return result;
    } catch (error) {
      this.recordError(error);
      return {
        orders: fallback(),
        degraded: true,
        reason: "open_orders_error",
        stale: true,
        detail: getErrorMessage(error),
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private getQuoteFreshness(quote: QuoteSnapshot, now = Date.now()) {
    const cacheAgeMs = Math.max(0, now - quote.updatedAt.getTime());
    return {
      freshness: cacheAgeMs <= 5_000 ? ("live" as const) : ("stale" as const),
      cacheAgeMs,
    };
  }

  private withBridgeReceivedLatency(
    quote: QuoteSnapshot,
    bridgeReceivedAt = new Date(),
  ): QuoteSnapshot {
    return {
      ...quote,
      ...this.getQuoteFreshness(quote, bridgeReceivedAt.getTime()),
      latency: {
        ...(quote.latency ?? {}),
        bridgeReceivedAt,
      },
    };
  }

  private decorateQuoteForEmit(
    quote: QuoteSnapshot,
    bridgeEmittedAt = new Date(),
  ): QuoteSnapshot {
    return {
      ...quote,
      ...this.getQuoteFreshness(quote, bridgeEmittedAt.getTime()),
      latency: {
        ...(quote.latency ?? {}),
        bridgeEmittedAt,
      },
    };
  }

  private collectQuotesBySymbol(): Map<string, QuoteSnapshot> {
    const now = Date.now();
    const quotesBySymbol = new Map<string, QuoteSnapshot>();

    this.quotesByProviderContractId.forEach((quote) => {
      const symbol = normalizeSymbol(quote.symbol);
      if (!symbol) {
        return;
      }

      quotesBySymbol.set(symbol, {
        ...quote,
        ...this.getQuoteFreshness(quote, now),
      });
    });

    return quotesBySymbol;
  }

  private collectQuotesByProviderContractId(): Map<string, QuoteSnapshot> {
    const now = Date.now();
    const quotesByProviderContractId = new Map<string, QuoteSnapshot>();

    this.quotesByProviderContractId.forEach((quote, providerContractId) => {
      quotesByProviderContractId.set(providerContractId, {
        ...quote,
        ...this.getQuoteFreshness(quote, now),
      });
    });

    return quotesByProviderContractId;
  }

  private getEffectiveEquityLineBudget(): number {
    return this.maxLiveEquityLines > 0
      ? this.maxLiveEquityLines
      : this.maxMarketDataLines;
  }

  private getEffectiveOptionLineBudget(): number {
    const configured =
      this.maxLiveOptionLines > 0
        ? this.maxLiveOptionLines
        : this.optionQuoteVisibleContractLimit;
    return this.maxMarketDataLines > 0
      ? Math.min(configured, this.maxMarketDataLines)
      : configured;
  }

  private getSubscriptionDiagnostics() {
    const subscriptions = Array.from(this.quoteSubscriptions.values());
    const equitySubscriptions = subscriptions.filter(
      (subscription) => subscription.assetClass === "equity",
    );
    const optionSubscriptions = subscriptions.filter(
      (subscription) => subscription.assetClass === "option",
    );
    const now = Date.now();

    return {
      marketDataLineBudget: this.maxMarketDataLines,
      equityLineBudget: this.getEffectiveEquityLineBudget(),
      optionLineBudget: this.getEffectiveOptionLineBudget(),
      activeQuoteSubscriptions: subscriptions.length,
      marketDataLineBudgetRemaining:
        this.maxMarketDataLines > 0
          ? Math.max(0, this.maxMarketDataLines - subscriptions.length)
          : null,
      activeEquitySubscriptions: equitySubscriptions.length,
      activeOptionSubscriptions: optionSubscriptions.length,
      activeEquitySymbols: equitySubscriptions
        .map((subscription) => subscription.symbol)
        .sort(),
      activeOptionProviderContractIds: optionSubscriptions
        .map((subscription) => subscription.providerContractId)
        .sort(),
      quoteListenerCount: this.quoteStreamListeners.size,
      barStreamCount: this.barStreamSubscriptions.size,
      depthSubscriptionCount: this.depthSubscriptions.size,
      prewarmSymbolCount: this.prewarmQuoteSymbols.size,
      prewarmSymbols: Array.from(this.prewarmQuoteSymbols).sort(),
      cachedQuoteCount: this.quotesByProviderContractId.size,
      quoteEventCount: this.quoteEventCount,
      optionQuoteEventCount: this.optionQuoteEventCount,
      lastQuoteAgeMs: this.lastQuoteEventAt
        ? Math.max(0, now - this.lastQuoteEventAt.getTime())
        : null,
      lastAggregateSourceAgeMs: this.lastAggregateSourceEventAt
        ? Math.max(0, now - this.lastAggregateSourceEventAt.getTime())
        : null,
    };
  }

  private runOptionMetaSingleFlight<T>(
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const existing = this.optionMetaInFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = work().finally(() => {
      this.optionMetaInFlight.delete(key);
    });
    this.optionMetaInFlight.set(key, promise);
    return promise;
  }

  private emitQuote(quote: QuoteSnapshot) {
    const normalizedSymbol = normalizeSymbol(quote.symbol);
    const providerContractId = asString(quote.providerContractId);
    if (!normalizedSymbol) {
      if (!providerContractId) {
        return;
      }
    }

    const emittedQuote = this.decorateQuoteForEmit(quote);
    const subscription = providerContractId
      ? this.quoteSubscriptions.get(providerContractId)
      : null;
    const now = new Date();
    this.lastQuoteEventAt = now;
    this.quoteEventCount += 1;
    if (subscription?.assetClass === "option") {
      this.optionQuoteEventCount += 1;
    } else {
      this.lastAggregateSourceEventAt = now;
    }
    this.quoteStreamListeners.forEach((listener) => {
      if (
        (normalizedSymbol && listener.symbols.has(normalizedSymbol)) ||
        (providerContractId &&
          listener.providerContractIds.has(providerContractId))
      ) {
        listener.onQuote(emittedQuote);
      }
    });
  }

  private getDesiredQuoteSymbols(extraSymbols: string[] = []): Set<string> {
    const desiredSymbols = new Set<string>();

    extraSymbols
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean)
      .forEach((symbol) => desiredSymbols.add(symbol));
    this.quoteStreamListeners.forEach((listener) => {
      listener.symbols.forEach((symbol) => desiredSymbols.add(symbol));
    });
    this.prewarmQuoteSymbols.forEach((symbol) => desiredSymbols.add(symbol));

    return desiredSymbols;
  }

  private getDesiredQuoteProviderContractIds(
    extraProviderContractIds: string[] = [],
  ): Set<string> {
    const desiredProviderContractIds = new Set<string>();

    extraProviderContractIds
      .map((providerContractId) => providerContractId.trim())
      .filter(Boolean)
      .forEach((providerContractId) =>
        desiredProviderContractIds.add(providerContractId),
      );
    this.quoteStreamListeners.forEach((listener) => {
      listener.providerContractIds.forEach((providerContractId) =>
        desiredProviderContractIds.add(providerContractId),
      );
    });

    return desiredProviderContractIds;
  }

  private limitQuoteSymbolsForBudget(
    symbols: string[],
    reason: string,
  ): string[] {
    const maxLiveEquityLines = this.getEffectiveEquityLineBudget();
    const { kept, dropped } = limitValuesByBudget(
      symbols,
      maxLiveEquityLines,
    );

    if (dropped.length > 0) {
      const signature = `${reason}:${dropped.join(",")}`;
      if (signature !== this.lastEquityBudgetDropSignature) {
        this.lastEquityBudgetDropSignature = signature;
        logger.warn(
          {
            reason,
            maxLiveEquityLines,
            requested: symbols.length,
            subscribed: kept.length,
            dropped,
          },
          "IBKR TWS equity quote subscription budget capped",
        );
      }
    }

    return kept;
  }

  private limitOptionProviderContractIdsForBudget(
    providerContractIds: string[],
    reason: string,
  ): string[] {
    const maxLiveOptionLines = this.getEffectiveOptionLineBudget();
    const { kept, dropped } = limitValuesByBudget(
      providerContractIds,
      maxLiveOptionLines,
    );

    if (dropped.length > 0) {
      const signature = `${reason}:${dropped.join(",")}`;
      if (signature !== this.lastOptionBudgetDropSignature) {
        this.lastOptionBudgetDropSignature = signature;
        logger.warn(
          {
            reason,
            maxLiveOptionLines,
            requested: providerContractIds.length,
            subscribed: kept.length,
            dropped,
          },
          "IBKR TWS option quote subscription budget capped",
        );
      }
    }

    return kept;
  }

  private limitQuoteDemandForBudget(
    symbols: string[],
    providerContractIds: string[],
    reason: string,
    prefer: "equity" | "option" = "equity",
  ): {
    symbols: Set<string>;
    providerContractIds: Set<string>;
  } {
    const individuallyBudgetedSymbols = this.limitQuoteSymbolsForBudget(
      symbols,
      reason,
    );
    const individuallyBudgetedProviderContractIds =
      this.limitOptionProviderContractIdsForBudget(providerContractIds, reason);
    const maxMarketDataLines = this.maxMarketDataLines;
    if (maxMarketDataLines <= 0) {
      return {
        symbols: new Set(individuallyBudgetedSymbols),
        providerContractIds: new Set(individuallyBudgetedProviderContractIds),
      };
    }

    const keptSymbols =
      prefer === "equity"
        ? individuallyBudgetedSymbols.slice(0, maxMarketDataLines)
        : individuallyBudgetedSymbols.slice(
            0,
            Math.max(
              0,
              maxMarketDataLines -
                Math.min(
                  individuallyBudgetedProviderContractIds.length,
                  maxMarketDataLines,
                ),
            ),
          );
    const keptProviderContractIds =
      prefer === "option"
        ? individuallyBudgetedProviderContractIds.slice(0, maxMarketDataLines)
        : individuallyBudgetedProviderContractIds.slice(
            0,
            Math.max(0, maxMarketDataLines - keptSymbols.length),
          );
    const optionTrimmedForTotal =
      prefer === "option"
        ? keptProviderContractIds.slice(
            0,
            Math.max(0, maxMarketDataLines - keptSymbols.length),
          )
        : keptProviderContractIds;
    const symbolTrimmedForTotal =
      prefer === "equity"
        ? keptSymbols
        : keptSymbols.slice(
            0,
            Math.max(0, maxMarketDataLines - optionTrimmedForTotal.length),
          );
    const droppedSymbols = individuallyBudgetedSymbols.slice(
      symbolTrimmedForTotal.length,
    );
    const droppedProviderContractIds =
      individuallyBudgetedProviderContractIds.slice(optionTrimmedForTotal.length);
    if (droppedSymbols.length > 0 || droppedProviderContractIds.length > 0) {
      const signature = `${reason}:equity=${droppedSymbols.join(",")}:option=${droppedProviderContractIds.join(",")}`;
      if (signature !== this.lastCombinedBudgetDropSignature) {
        this.lastCombinedBudgetDropSignature = signature;
        logger.warn(
          {
            reason,
            prefer,
            maxMarketDataLines,
            requestedEquities: individuallyBudgetedSymbols.length,
            requestedOptions: individuallyBudgetedProviderContractIds.length,
            subscribedEquities: symbolTrimmedForTotal.length,
            subscribedOptions: optionTrimmedForTotal.length,
            droppedSymbols,
            droppedProviderContractIds,
          },
          "IBKR TWS combined quote subscription budget capped",
        );
      }
    }

    return {
      symbols: new Set(symbolTrimmedForTotal),
      providerContractIds: new Set(optionTrimmedForTotal),
    };
  }

  private trimUnusedQuoteSubscriptions(
    desiredSymbols?: Set<string>,
    desiredProviderContractIds?: Set<string>,
  ) {
    const desired =
      desiredSymbols && desiredProviderContractIds
        ? { symbols: desiredSymbols, providerContractIds: desiredProviderContractIds }
        : this.limitQuoteDemandForBudget(
            Array.from(desiredSymbols ?? this.getDesiredQuoteSymbols()),
            Array.from(
              desiredProviderContractIds ??
                this.getDesiredQuoteProviderContractIds(),
            ),
            "trim",
          );
    for (const [providerContractId, subscription] of this.quoteSubscriptions) {
      if (
        (subscription.assetClass === "equity" &&
          desired.symbols.has(subscription.symbol)) ||
        (subscription.assetClass === "option" &&
          desired.providerContractIds.has(providerContractId))
      ) {
        continue;
      }

      subscription.stop();
      this.quoteSubscriptions.delete(providerContractId);
      this.quotesByProviderContractId.delete(providerContractId);
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
        this.connectTimeoutMs,
      );

      if (this.connectionState !== ConnectionState.Connected) {
        throw new HttpError(502, "Unable to connect to IB Gateway/TWS.", {
          code: "ibkr_tws_connect_failed",
          detail:
            this.lastError ??
            `No socket connection was established to ${this.config.host}:${this.config.port}.`,
        });
      }

      this.api.setMarketDataType(
        this.config.marketDataType as TwsMarketDataType,
      );
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

  private stopConnectionBoundSubscriptions() {
    for (const stop of this.baseSubscriptionStops.splice(0)) {
      try {
        stop();
      } catch (error) {
        logger.debug(
          { error: getErrorMessage(error) },
          "Failed to stop IBKR base subscription",
        );
      }
    }

    this.quoteSubscriptions.forEach((subscription) => {
      try {
        subscription.stop();
      } catch (error) {
        logger.debug(
          {
            error: getErrorMessage(error),
            providerContractId: subscription.providerContractId,
          },
          "Failed to stop IBKR quote subscription",
        );
      }
    });
    this.quoteSubscriptions.clear();

    this.depthSubscriptions.forEach((subscription) => {
      try {
        subscription.stop();
      } catch (error) {
        logger.debug(
          { error: getErrorMessage(error) },
          "Failed to stop IBKR depth subscription",
        );
      }
    });
    this.depthSubscriptions.clear();

    this.baseSubscriptionsStarted = false;
    this.accountSummaryInitialized = false;
    this.positionsInitialized = false;
    this.openOrdersInitialized = false;
  }

  private async restoreQuoteSubscriptionsAfterReconnect(input: {
    symbols: string[];
    providerContractIds: string[];
  }) {
    if (input.symbols.length > 0) {
      await this.ensureQuoteSubscriptionsForSymbols(input.symbols);
    }

    if (input.providerContractIds.length > 0) {
      await this.ensureOptionQuoteSubscriptionsForProviderContractIds(
        input.providerContractIds,
      );
    }
  }

  private async reestablishConnection(
    reason: string,
    sourceError?: unknown,
  ): Promise<void> {
    if (this.reconnectPromise) {
      return this.reconnectPromise;
    }

    this.lastRecoveryAttemptAt = new Date();
    this.lastRecoveryError = null;
    this.lastReconnectReason = reason;
    const desiredSymbols = Array.from(this.getDesiredQuoteSymbols());
    const desiredProviderContractIds = Array.from(
      this.getDesiredQuoteProviderContractIds(),
    );

    this.reconnectPromise = (async () => {
      logger.warn(
        {
          reason,
          error: sourceError ? getErrorMessage(sourceError) : null,
          host: this.config.host,
          port: this.config.port,
          clientId: this.config.clientId,
        },
        "Reestablishing IBKR TWS bridge connection",
      );

      this.stopConnectionBoundSubscriptions();
      this.connectPromise = null;

      try {
        this.api.disconnect();
      } catch (error) {
        logger.debug(
          { error: getErrorMessage(error) },
          "IBKR TWS disconnect during recovery failed",
        );
      }

      await this.waitForCondition(
        () => this.connectionState === ConnectionState.Disconnected,
        2_000,
      );

      this.api.connect(this.config.clientId);
      await this.waitForCondition(
        () => this.connectionState === ConnectionState.Connected,
        8_000,
      );

      if (this.connectionState !== ConnectionState.Connected) {
        throw new HttpError(
          502,
          "Unable to reestablish IB Gateway/TWS connection.",
          {
            code: "ibkr_tws_reconnect_failed",
            detail:
              this.lastError ??
              `No socket connection was reestablished to ${this.config.host}:${this.config.port}.`,
          },
        );
      }

      this.api.setMarketDataType(
        this.config.marketDataType as TwsMarketDataType,
      );
      await this.loadManagedAccounts();
      await this.ensureBaseSubscriptions();
      await this.restoreQuoteSubscriptionsAfterReconnect({
        symbols: desiredSymbols,
        providerContractIds: desiredProviderContractIds,
      });

      this.lastError = null;
      this.lastRecoveryError = null;
    })();

    try {
      await this.reconnectPromise;
    } catch (error) {
      this.lastRecoveryError =
        getErrorMessage(error) || "Unknown IBKR TWS bridge recovery error.";
      this.recordError(error);
      throw error;
    } finally {
      this.reconnectPromise = null;
    }
  }

  private async withHistoricalDataRecovery<T>(
    context: HistoricalRecoveryContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    const maxRetries = Math.max(0, this.historicalReconnectMaxRetries);
    let attempt = 0;

    while (true) {
      try {
        await this.ensureConnected();
        return await operation();
      } catch (error) {
        this.recordError(error);

        if (
          attempt >= maxRetries ||
          !isHistoricalDataReconnectableError(error)
        ) {
          throw error;
        }

        attempt += 1;
        await this.reestablishConnection(
          `${context.operation}:${context.symbol}:${context.timeframe}`,
          error,
        );
        await sleep(Math.min(1_000, 250 * attempt));
      }
    }
  }

  private async loadManagedAccounts(): Promise<SessionStatusSnapshot> {
    this.managedAccounts = (await this.api.getManagedAccounts()).filter(
      Boolean,
    );
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

    const accountSummarySubscription = this.api
      .getAccountSummary("All", ACCOUNT_SUMMARY_REQUEST)
      .subscribe({
        next: (update) => {
          update.all.forEach((summary, accountId) => {
            const buyingPower = pickSummaryValue(summary, ["BuyingPower"]);
            const totalCashValue = pickSummaryValue(summary, [
              "TotalCashValue",
            ]);
            const settledCash = pickSummaryValue(summary, ["SettledCash"]);
            const cashBalance = pickSummaryValue(summary, ["CashBalance"]);
            const cash =
              totalCashValue.value !== null
                ? totalCashValue
                : settledCash.value !== null
                  ? settledCash
                  : cashBalance;
            const netLiquidation = pickSummaryValue(summary, [
              "NetLiquidation",
            ]);
            const initialMargin = pickSummaryValue(summary, ["InitMarginReq"]);
            const maintenanceMargin = pickSummaryValue(summary, [
              "MaintMarginReq",
            ]);
            const dayTradesRemaining = pickSummaryValue(summary, [
              "DayTradesRemaining",
              "DayTradesRemainingT+4",
            ]);

            this.accountSummaries.set(accountId, {
              accountType: pickSummaryText(summary, ["AccountType"]),
              buyingPower: buyingPower.value ?? 0,
              cash: cash.value ?? 0,
              netLiquidation: netLiquidation.value ?? 0,
              currency:
                buyingPower.currency ??
                cash.currency ??
                netLiquidation.currency ??
                "USD",
              totalCashValue: totalCashValue.value,
              settledCash: settledCash.value,
              accruedCash: pickSummaryValue(summary, ["AccruedCash"]).value,
              initialMargin: initialMargin.value,
              maintenanceMargin: maintenanceMargin.value,
              excessLiquidity: pickSummaryValue(summary, ["ExcessLiquidity"])
                .value,
              cushion: pickSummaryValue(summary, ["Cushion"]).value,
              sma: pickSummaryValue(summary, ["SMA"]).value,
              dayTradingBuyingPower: pickSummaryValue(summary, [
                "DayTradingBuyingPower",
              ]).value,
              regTInitialMargin: pickSummaryValue(summary, ["RegTMargin"])
                .value,
              grossPositionValue: pickSummaryValue(summary, [
                "GrossPositionValue",
              ]).value,
              leverage: pickSummaryValue(summary, ["Leverage"]).value,
              dayTradesRemaining: dayTradesRemaining.value,
              updatedAt: new Date(),
            });
          });

          this.accountSummaryInitialized = true;
        },
        error: (error) => {
          this.recordError(error);
        },
      });
    this.baseSubscriptionStops.push(() =>
      accountSummarySubscription.unsubscribe(),
    );

    const positionsSubscription = this.api.getPositions().subscribe({
      next: (update) => {
        this.applyPositionsUpdate(update, {
          preserveExistingMarketData: true,
        });
        this.positionsInitialized = true;
      },
      error: (error) => {
        this.recordError(error);
      },
    });
    this.baseSubscriptionStops.push(() => positionsSubscription.unsubscribe());

    this.managedAccounts.forEach((accountId) => {
      const accountUpdatesSubscription = this.api
        .getAccountUpdates(accountId)
        .subscribe({
          next: (update) => {
            this.applyPositionsUpdate({
              all: update.all.portfolio,
              added: update.added?.portfolio,
              changed: update.changed?.portfolio,
              removed: update.removed?.portfolio,
            });

            if (update.all.portfolio) {
              this.positionsInitialized = true;
            }
          },
          error: (error) => {
            this.recordError(error);
          },
        });
      this.baseSubscriptionStops.push(() =>
        accountUpdatesSubscription.unsubscribe(),
      );
    });

    const openOrdersSubscription = this.api.getOpenOrders().subscribe({
      next: (update) => {
        const snapshots = compact(
          update.all.map((order) => this.toBrokerOrderSnapshot(order)),
        );
        this.liveOrdersById.clear();
        snapshots.forEach((snapshot) => {
          this.liveOrdersById.set(snapshot.id, snapshot);
        });
        this.openOrdersInitialized = true;
      },
      error: (error) => {
        this.recordError(error);
      },
    });
    this.baseSubscriptionStops.push(() => openOrdersSubscription.unsubscribe());
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
      throw new HttpError(
        400,
        "No IBKR account is active for the TWS bridge.",
        {
          code: "ibkr_missing_account_id",
        },
      );
    }

    return resolved;
  }

  private replacePositionsForAccount(
    accountId: string,
    positions: BrokerPositionSnapshot[],
    options: { preserveExistingMarketData?: boolean } = {},
  ): void {
    const currentById = new Map(
      (this.positionsByAccount.get(accountId) ?? []).map((position) => [
        position.id,
        position,
      ]),
    );
    this.positionsByAccount.set(
      accountId,
      positions
        .filter((position) => Math.abs(position.quantity) > 1e-9)
        .map((position) =>
          options.preserveExistingMarketData
            ? this.mergePositionMarketData(position, currentById.get(position.id))
            : position,
        )
        .sort((left, right) => left.symbol.localeCompare(right.symbol)),
    );
  }

  private upsertPositionsForAccount(
    accountId: string,
    positions: TwsPositionSnapshot[] | undefined,
    options: { preserveExistingMarketData?: boolean } = {},
  ): void {
    if (!positions?.length) {
      return;
    }

    const currentById = new Map(
      (this.positionsByAccount.get(accountId) ?? []).map((position) => [
        position.id,
        position,
      ]),
    );

    compact(positions.map((position) => this.toBrokerPositionSnapshot(position)))
      .filter((position) => Math.abs(position.quantity) > 1e-9)
      .forEach((position) => {
        currentById.set(
          position.id,
          options.preserveExistingMarketData
            ? this.mergePositionMarketData(position, currentById.get(position.id))
            : position,
        );
      });

    this.positionsByAccount.set(
      accountId,
      Array.from(currentById.values()).sort((left, right) =>
        left.symbol.localeCompare(right.symbol),
      ),
    );
  }

  private removePositionsForAccount(
    accountId: string,
    positions: TwsPositionSnapshot[] | undefined,
  ): void {
    if (!positions?.length) {
      return;
    }

    const removeIds = new Set(
      positions
        .map((position) => this.positionSnapshotId(position))
        .filter((value): value is string => Boolean(value)),
    );
    if (!removeIds.size) {
      return;
    }

    this.positionsByAccount.set(
      accountId,
      (this.positionsByAccount.get(accountId) ?? []).filter(
        (position) => !removeIds.has(position.id),
      ),
    );
  }

  private applyPositionsUpdate(
    update: TwsPositionsUpdate,
    options: { preserveExistingMarketData?: boolean } = {},
  ): void {
    const hasIncrementalUpdates = Boolean(
      update.added?.size || update.changed?.size || update.removed?.size,
    );

    if (!hasIncrementalUpdates) {
      update.all?.forEach((positions, accountId) => {
        this.replacePositionsForAccount(
          accountId,
          compact(
            positions.map((position) =>
              this.toBrokerPositionSnapshot(position),
            ),
          ),
          options,
        );
      });
      return;
    }

    update.removed?.forEach((positions, accountId) => {
      this.removePositionsForAccount(accountId, positions);
    });
    update.added?.forEach((positions, accountId) => {
      this.upsertPositionsForAccount(accountId, positions, options);
    });
    update.changed?.forEach((positions, accountId) => {
      this.upsertPositionsForAccount(accountId, positions, options);
    });
  }

  private mergePositionMarketData(
    incoming: BrokerPositionSnapshot,
    existing?: BrokerPositionSnapshot,
  ): BrokerPositionSnapshot {
    if (!existing) {
      return incoming;
    }

    const multiplier = incoming.optionContract?.multiplier ?? 1;
    const costBasisValue = incoming.averagePrice * incoming.quantity * multiplier;
    const incomingIsCostBasisFallback =
      incoming.marketPrice === incoming.averagePrice &&
      incoming.unrealizedPnl === 0 &&
      incoming.unrealizedPnlPercent === 0 &&
      Math.abs(incoming.marketValue - costBasisValue) <= 1e-6;
    const incomingHasMarketData =
      !incomingIsCostBasisFallback &&
      (incoming.marketPrice !== 0 ||
        incoming.marketValue !== 0 ||
        incoming.unrealizedPnl !== 0 ||
        incoming.unrealizedPnlPercent !== 0);

    if (incomingHasMarketData) {
      return incoming;
    }

    return {
      ...incoming,
      marketPrice: existing.marketPrice,
      marketValue: existing.marketValue,
      unrealizedPnl: existing.unrealizedPnl,
      unrealizedPnlPercent: existing.unrealizedPnlPercent,
    };
  }

  private positionSnapshotId(position: Pick<TwsPositionSnapshot, "account" | "contract">): string | null {
    const symbol = normalizeSymbol(asString(position.contract.symbol) ?? "");
    if (!symbol) {
      return null;
    }
    return `${position.account}:${asString(position.contract.conId) ?? symbol}`;
  }

  private toBrokerPositionSnapshot(position: TwsPositionSnapshot): BrokerPositionSnapshot | null {
    const symbol = normalizeSymbol(asString(position.contract.symbol) ?? "");
    const assetClass = normalizeAssetClassFromSecType(
      asString(position.contract.secType) ?? undefined,
    );
    const optionContract =
      assetClass === "option" ? toOptionContractMeta(position.contract) : null;

    if (!symbol || !assetClass || Math.abs(position.pos) <= 1e-9) {
      return null;
    }

    const multiplier = optionContract?.multiplier ?? 1;
    const averagePrice = position.avgCost ?? 0;
    const marketPrice = position.marketPrice ?? averagePrice;
    const marketValue =
      position.marketValue ?? marketPrice * position.pos * multiplier;
    const unrealizedPnl = position.unrealizedPNL ?? 0;

    return {
      id: this.positionSnapshotId(position) ?? `${position.account}:${symbol}`,
      accountId: position.account,
      symbol,
      assetClass,
      quantity: position.pos,
      averagePrice,
      marketPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent:
        averagePrice && position.pos
          ? ((marketPrice - averagePrice) /
              averagePrice) *
            100
          : 0,
      optionContract,
    };
  }

  private toBrokerOrderSnapshot(order: OpenOrder): BrokerOrderSnapshot | null {
    const accountId =
      asString(order.order.account) ?? this.config.defaultAccountId;
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
      order.orderStatus?.remaining ??
      Math.max(0, totalQuantity - filledQuantity);

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

  private async resolveStockContract(
    symbol: string,
  ): Promise<CachedStockContract> {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cached = this.stockContracts.get(normalizedSymbol);
    if (cached && Date.now() - cached.cachedAt < CONTRACT_CACHE_TTL_MS) {
      return cached;
    }

    await this.ensureConnected();
    const lookupSymbols = Array.from(
      new Set(
        [
          normalizedSymbol,
          normalizedSymbol.replace(/\./g, " "),
          normalizedSymbol.replace(/\./g, ""),
        ].filter(Boolean),
      ),
    );
    let details: ContractDetails[] = [];
    for (const lookupSymbol of lookupSymbols) {
      details = await this.api.getContractDetails(
        new Stock(lookupSymbol, "SMART", "USD"),
      );
      if (details.length > 0) {
        break;
      }
    }

    const match =
      [...details]
        .filter(
          (detail) =>
            normalizeSymbol(asString(detail.contract.symbol) ?? "") ===
              normalizedSymbol &&
            asString(detail.contract.secType)?.toUpperCase() === "STK",
        )
        .sort(
          (left, right) =>
            scoreStockContractDetail(right, normalizedSymbol) -
            scoreStockContractDetail(left, normalizedSymbol),
        )[0] ?? details[0];

    const resolved = toCachedStockContract(match?.contract, normalizedSymbol);
    if (!resolved) {
      throw new HttpError(
        404,
        `Unable to resolve IB Gateway/TWS contract for ${symbol}.`,
        {
          code: "ibkr_contract_not_found",
        },
      );
    }

    this.stockContracts.set(normalizedSymbol, resolved);
    return resolved;
  }

  private async findOptionableStockContract(
    symbol: string,
    currentConid: number,
  ): Promise<CachedStockContract | null> {
    const normalizedSymbol = normalizeSymbol(symbol);
    const descriptions = await this.api
      .getMatchingSymbols(normalizedSymbol)
      .catch((error) => {
        this.recordError(error);
        return [] as ContractDescription[];
      });
    const optionable = descriptions
      .filter((description) => {
        const contract = description.contract;
        if (!contract) {
          return false;
        }
        const conid = asNumber(contract.conId);
        return (
          conid !== null &&
          conid !== currentConid &&
          normalizeSymbol(asString(contract.symbol) ?? "") ===
            normalizedSymbol &&
          asString(contract.secType)?.toUpperCase() === "STK" &&
          hasOptionDerivative(description)
        );
      })
      .sort(
        (left, right) =>
          scoreOptionableStockDescription(right, normalizedSymbol) -
          scoreOptionableStockDescription(left, normalizedSymbol),
      );

    return toCachedStockContract(optionable[0]?.contract, normalizedSymbol);
  }

  private async getOptionParametersForStock(
    symbol: string,
    resolvedUnderlying: CachedStockContract,
  ): Promise<ResolvedTwsOptionParameters> {
    const loadOptionParams = async (
      attempt: CachedStockContract,
    ): Promise<ResolvedTwsOptionParameters> => {
      const optionParams = await this.api
        .getSecDefOptParams(
          attempt.resolved.symbol,
          "",
          SecType.STK,
          attempt.resolved.conid,
        )
        .catch((error) => {
          this.recordError(error);
          return error;
        });

      if (Array.isArray(optionParams)) {
        return {
          resolvedUnderlying: attempt,
          optionParams,
        };
      }

      return {
        resolvedUnderlying: attempt,
        optionParams: [],
        error: optionParams,
      };
    };

    const primary = await loadOptionParams(resolvedUnderlying);
    const primaryCollected = collectTwsOptionParameters(primary.optionParams);
    if (
      primaryCollected.expirations.length ||
      primaryCollected.strikes.length
    ) {
      return primary;
    }

    const optionable = await this.findOptionableStockContract(
      symbol,
      resolvedUnderlying.resolved.conid,
    );
    if (!optionable) {
      return primary;
    }

    const fallback = await loadOptionParams(optionable);
    const fallbackCollected = collectTwsOptionParameters(fallback.optionParams);
    if (
      fallbackCollected.expirations.length ||
      fallbackCollected.strikes.length
    ) {
      this.stockContracts.set(normalizeSymbol(symbol), optionable);
      return fallback;
    }

    if (fallback.error) {
      throw fallback.error;
    }
    if (primary.error) {
      throw primary.error;
    }

    return fallback;
  }

  private async resolveOptionContract(input: {
    underlying: string;
    expirationDate: Date;
    strike: number;
    right: "call" | "put";
    providerContractId?: string | null;
    exchange?: string | null;
    tradingClass?: string | null;
    multiplier?: number | null;
  }): Promise<CachedOptionContract> {
    const tupleCacheKey = buildOptionContractCacheKey(input);
    const providerCacheKey = input.providerContractId?.trim() || null;
    const cacheKey = providerCacheKey || tupleCacheKey;
    const readCached = () => {
      const cached =
        this.optionContracts.get(cacheKey) ??
        this.optionContracts.get(tupleCacheKey);
      return cached && Date.now() - cached.cachedAt < CONTRACT_CACHE_TTL_MS
        ? cached
        : null;
    };

    const cached = readCached();
    if (cached) {
      return cached;
    }

    return this.runOptionMetaSingleFlight(
      `option-contract:${cacheKey}`,
      async () => {
        const inFlightCached = readCached();
        if (inFlightCached) {
          return inFlightCached;
        }

        await this.ensureConnected();

        let details: ContractDetails[] = [];
        const structuredIdentity = providerCacheKey
          ? decodeStructuredOptionProviderContractId(providerCacheKey)
          : null;
        if (structuredIdentity) {
          return this.cacheStructuredOptionContract(
            structuredIdentity,
            providerCacheKey ?? undefined,
          );
        }

        if (providerCacheKey && /^\d+$/.test(providerCacheKey)) {
          details = await this.api.getContractDetails({
            conId: Number(providerCacheKey),
            secType: SecType.OPT,
            exchange: "SMART",
          });
        } else {
          const contract = buildTwsOptionContractFromIdentity({
            underlying: input.underlying,
            expirationDate: input.expirationDate,
            strike: input.strike,
            right: input.right,
            exchange: input.exchange ?? "SMART",
            tradingClass: input.tradingClass ?? null,
            multiplier: input.multiplier ?? 100,
          });
          details = await this.api.getContractDetails(contract);
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
        const resolvedTupleCacheKey =
          buildOptionContractCacheKey(optionContract);
        this.optionContracts.set(cacheKey, resolved);
        this.optionContracts.set(tupleCacheKey, resolved);
        this.optionContracts.set(resolvedTupleCacheKey, resolved);
        if (optionContract.providerContractId) {
          this.optionContracts.set(optionContract.providerContractId, resolved);
        }
        return resolved;
      },
    );
  }

  private cacheStructuredOptionContract(
    identity: StructuredOptionContractIdentity,
    providerContractId = buildStructuredOptionProviderContractId(identity),
  ): CachedOptionContract {
    const optionContract = toOptionContractMetaFromIdentity(
      identity,
      providerContractId,
    );
    const contract = buildTwsOptionContractFromIdentity(identity);
    const resolved: CachedOptionContract = {
      contract,
      optionContract,
      cachedAt: Date.now(),
    };

    this.optionContracts.set(providerContractId, resolved);
    this.optionContracts.set(buildOptionContractCacheKey(identity), resolved);
    return resolved;
  }

  private async resolveOptionContractByProviderContractId(
    providerContractId: string,
  ): Promise<CachedOptionContract> {
    const normalizedProviderContractId = providerContractId.trim();
    const readCached = () => {
      const cached = this.optionContracts.get(normalizedProviderContractId);
      return cached && Date.now() - cached.cachedAt < CONTRACT_CACHE_TTL_MS
        ? cached
        : null;
    };

    const cached = readCached();
    if (cached) {
      return cached;
    }

    return this.runOptionMetaSingleFlight(
      `option-contract:${normalizedProviderContractId}`,
      async () => {
        const inFlightCached = readCached();
        if (inFlightCached) {
          return inFlightCached;
        }

        const structuredIdentity = decodeStructuredOptionProviderContractId(
          normalizedProviderContractId,
        );
        if (structuredIdentity) {
          return this.cacheStructuredOptionContract(
            structuredIdentity,
            normalizedProviderContractId,
          );
        }

        if (!/^\d+$/.test(normalizedProviderContractId)) {
          throw new HttpError(400, "Option providerContractId must be numeric.", {
            code: "ibkr_option_contract_invalid_conid",
          });
        }

        await this.ensureConnected();
        const details = await this.api.getContractDetails({
          conId: Number(normalizedProviderContractId),
          secType: SecType.OPT,
          exchange: "SMART",
        });
        const match = details[0];
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

        this.optionContracts.set(normalizedProviderContractId, resolved);
        this.optionContracts.set(
          `${optionContract.underlying}:${formatOptionExpiry(optionContract.expirationDate)}:${optionContract.strike}:${optionContract.right}`,
          resolved,
        );
        return resolved;
      },
    );
  }

  private async ensureQuoteSubscription(
    resolved: CachedStockContract,
  ): Promise<string> {
    const providerContractId = resolved.resolved.providerContractId;
    if (this.quoteSubscriptions.has(providerContractId)) {
      return providerContractId;
    }

    const subscription = this.api
      .getMarketData(
        {
          ...resolved.contract,
          conId: resolved.resolved.conid,
          exchange: "SMART",
        },
        "",
        false,
        false,
      )
      .subscribe({
        next: (update) => {
          const quote = this.withBridgeReceivedLatency(
            toQuoteSnapshot(
              resolved.resolved.symbol,
              providerContractId,
              update.all,
              this.config.marketDataType,
            ),
          );
          this.quotesByProviderContractId.set(providerContractId, quote);
          this.emitQuote(quote);
        },
        error: (error) => {
          this.recordError(error);
        },
      });

    this.quoteSubscriptions.set(providerContractId, {
      contract: resolved.contract,
      providerContractId,
      symbol: resolved.resolved.symbol,
      assetClass: "equity",
      stop: () => subscription.unsubscribe(),
    });

    return providerContractId;
  }

  private async ensureOptionQuoteSubscription(
    providerContractId: string,
  ): Promise<string> {
    const normalizedProviderContractId = providerContractId.trim();
    if (!normalizedProviderContractId) {
      throw new HttpError(400, "Option providerContractId is required.", {
        code: "ibkr_option_quote_missing_conid",
      });
    }

    if (this.quoteSubscriptions.has(normalizedProviderContractId)) {
      return normalizedProviderContractId;
    }

    const resolved = await this.resolveOptionContractByProviderContractId(
      normalizedProviderContractId,
    );
    const numericProviderContractId = /^\d+$/.test(normalizedProviderContractId)
      ? Number(normalizedProviderContractId)
      : null;
    const subscription = this.api
      .getMarketData(
        numericProviderContractId === null
          ? {
              ...resolved.contract,
              exchange: resolved.contract.exchange ?? "SMART",
            }
          : {
              ...resolved.contract,
              conId: numericProviderContractId,
              exchange: "SMART",
            },
        "100,101,106",
        false,
        false,
      )
      .subscribe({
        next: (update) => {
          const quote = this.withBridgeReceivedLatency(
            toQuoteSnapshot(
              resolved.optionContract.ticker,
              normalizedProviderContractId,
              update.all,
              this.config.marketDataType,
            ),
          );
          this.quotesByProviderContractId.set(
            normalizedProviderContractId,
            quote,
          );
          this.emitQuote(quote);
        },
        error: (error) => {
          this.recordError(error);
        },
      });

    this.quoteSubscriptions.set(normalizedProviderContractId, {
      contract: resolved.contract,
      providerContractId: normalizedProviderContractId,
      symbol: resolved.optionContract.ticker,
      assetClass: "option",
      stop: () => subscription.unsubscribe(),
    });

    return normalizedProviderContractId;
  }

  private async ensureQuoteSubscriptionsForSymbols(
    symbols: string[],
  ): Promise<Map<string, string>> {
    return runBridgeLane("market-subscriptions", () =>
      this.ensureQuoteSubscriptionsForSymbolsCore(symbols),
    );
  }

  private async ensureQuoteSubscriptionsForSymbolsCore(
    symbols: string[],
  ): Promise<Map<string, string>> {
    await this.refreshSession();

    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );
    const providerContractIdsBySymbol = new Map<string, string>();

    const budgeted = this.limitQuoteDemandForBudget(
      Array.from(this.getDesiredQuoteSymbols(normalizedSymbols)),
      Array.from(this.getDesiredQuoteProviderContractIds()),
      "ensure",
      "equity",
    );
    const allowedSymbols = normalizedSymbols.filter((symbol) =>
      budgeted.symbols.has(symbol),
    );

    for (const symbol of allowedSymbols) {
      const resolved = await this.resolveStockContract(symbol);
      const providerContractId = await this.ensureQuoteSubscription(resolved);
      providerContractIdsBySymbol.set(symbol, providerContractId);
    }

    this.trimUnusedQuoteSubscriptions(budgeted.symbols, budgeted.providerContractIds);

    return providerContractIdsBySymbol;
  }

  private async ensureOptionQuoteSubscriptionsForProviderContractIds(
    providerContractIds: string[],
  ): Promise<string[]> {
    return runBridgeLane("option-quotes", () =>
      this.ensureOptionQuoteSubscriptionsForProviderContractIdsCore(
        providerContractIds,
      ),
    );
  }

  private async ensureOptionQuoteSubscriptionsForProviderContractIdsCore(
    providerContractIds: string[],
  ): Promise<string[]> {
    await this.refreshSession();

    const normalizedProviderContractIds = Array.from(
      new Set(
        providerContractIds
          .map((providerContractId) => providerContractId.trim())
          .filter(Boolean),
      ),
    );

    const resolvedProviderContractIds: string[] = [];
    const budgeted = this.limitQuoteDemandForBudget(
      Array.from(this.getDesiredQuoteSymbols()),
      Array.from(
        this.getDesiredQuoteProviderContractIds(
          normalizedProviderContractIds,
        ),
      ),
      "ensure",
      "option",
    );
    const allowedProviderContractIds = normalizedProviderContractIds.filter(
      (providerContractId) =>
        budgeted.providerContractIds.has(providerContractId),
    );

    for (const providerContractId of allowedProviderContractIds) {
      resolvedProviderContractIds.push(
        await this.ensureOptionQuoteSubscription(providerContractId),
      );
    }

    this.trimUnusedQuoteSubscriptions(budgeted.symbols, budgeted.providerContractIds);

    return resolvedProviderContractIds;
  }

  private async getContractQuoteSnapshot(input: {
    contract: Contract;
    symbol: string;
    providerContractId: string | null;
    genericTickList?: string;
  }): Promise<QuoteSnapshot | null> {
    await this.ensureConnected();
    if (input.genericTickList?.trim()) {
      const genericTickSnapshot = await this.getContractQuoteStreamSample({
        ...input,
        genericTickList: input.genericTickList.trim(),
      });
      if (genericTickSnapshot) {
        return genericTickSnapshot;
      }
    }

    try {
      const marketData = await this.api.getMarketDataSnapshot(
        input.contract,
        "",
        false,
      );
      return this.withBridgeReceivedLatency(
        toQuoteSnapshot(
          input.symbol,
          input.providerContractId,
          marketData,
          this.config.marketDataType,
        ),
      );
    } catch (error) {
      this.recordError(error);
      return null;
    }
  }

  private async getContractQuoteStreamSample(input: {
    contract: Contract;
    symbol: string;
    providerContractId: string | null;
    genericTickList: string;
  }): Promise<QuoteSnapshot | null> {
    return new Promise((resolve) => {
      let latest: QuoteSnapshot | null = null;
      let settled = false;
      let subscription: { unsubscribe(): void } | null = null;

      const finish = (value: QuoteSnapshot | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        subscription?.unsubscribe();
        resolve(value);
      };

      const timeout = setTimeout(() => finish(latest), this.genericTickSampleMs);
      timeout.unref?.();

      try {
        subscription = this.api
          .getMarketData(input.contract, input.genericTickList, false, false)
          .subscribe({
            next: (update) => {
              latest = this.withBridgeReceivedLatency(
                toQuoteSnapshot(
                  input.symbol,
                  input.providerContractId,
                  update.all,
                  this.config.marketDataType,
                ),
              );
            },
            error: (error) => {
              this.recordError(error);
              finish(latest);
            },
          });
      } catch (error) {
        this.recordError(error);
        finish(latest);
      }
    });
  }

  private buildOrderContractPayload(
    contract: Contract,
    order: Order,
  ): Record<string, unknown> {
    return JSON.parse(JSON.stringify({ contract, order })) as Record<
      string,
      unknown
    >;
  }

  private async buildStructuredOrder(input: PlaceOrderInput): Promise<{
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
      const resolvedProviderContractId =
        resolvedOption.optionContract.providerContractId ??
        input.optionContract.providerContractId ??
        null;
      const numericProviderContractId =
        resolvedProviderContractId && /^\d+$/.test(resolvedProviderContractId)
          ? Number(resolvedProviderContractId)
          : null;
      const resolvedContractId =
        numericProviderContractId ??
        asNumber(resolvedOption.contract.conId) ??
        0;

      return {
        accountId,
        contract:
          numericProviderContractId === null
            ? {
                ...resolvedOption.contract,
                exchange: resolvedOption.contract.exchange ?? "SMART",
              }
            : {
                ...resolvedOption.contract,
                conId: numericProviderContractId,
                exchange: "SMART",
              },
        optionContract: resolvedOption.optionContract,
        order: this.toTwsOrder(input, accountId),
        resolvedContractId,
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

  private async findOpenOrder(
    orderId: number,
    timeoutMs = this.postSubmitOrderLookupTimeoutMs,
  ): Promise<BrokerOrderSnapshot | null> {
    const orderKey = String(orderId);
    await this.waitForCondition(
      () => this.liveOrdersById.has(orderKey),
      timeoutMs,
      Math.max(1, Math.min(50, timeoutMs)),
    );

    return this.liveOrdersById.get(orderKey) ?? null;
  }

  async refreshSession(): Promise<SessionStatusSnapshot | null> {
    try {
      return await runBridgeLane("control", async () => {
        await this.ensureConnected();
        return this.refreshManagedAccounts();
      });
    } catch (error) {
      this.recordError(error);
      if (this.latestSession) {
        return this.latestSession;
      }
      throw error;
    }
  }

  async tickle(): Promise<void> {
    await runBridgeLane("control", async () => {
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
    });
  }

  async getHealth(): Promise<BridgeHealth> {
    void this.ensureConnected()
      .then(() => this.refreshManagedAccounts())
      .catch((error) => {
        this.recordError(error);
      });
    const session = this.latestSession ?? this.buildSessionSnapshot();
    const marketDataMode = resolveIbkrMarketDataMode(
      this.config.marketDataType,
    );
    const subscriptionDiagnostics = this.getSubscriptionDiagnostics();
    const lastStreamEventAgeMs = [
      subscriptionDiagnostics.lastQuoteAgeMs,
      subscriptionDiagnostics.lastAggregateSourceAgeMs,
    ]
      .filter((value): value is number => Number.isFinite(value))
      .sort((left, right) => left - right)[0] ?? null;
    const streamFresh =
      lastStreamEventAgeMs !== null &&
      lastStreamEventAgeMs <=
        Math.max(1_000, Number(process.env["IBKR_QUOTE_STREAM_STALL_MS"] ?? 10_000));
    const accountsLoaded = session.accounts.length > 0;
    const configuredLiveMarketDataMode = Boolean(
      isLiveIbkrMarketDataMode(marketDataMode),
    );
    const marketSessionActive = isLikelyUsEquitySession();
    const strictReason = !session.connected
      ? "gateway_socket_disconnected"
      : !session.authenticated
        ? "gateway_login_required"
        : !accountsLoaded
          ? "accounts_unavailable"
          : !configuredLiveMarketDataMode
            ? "live_market_data_not_configured"
            : !streamFresh
              ? marketSessionActive
                ? "stream_not_fresh"
                : "market_session_quiet"
              : null;
    const strictReady = strictReason === null;

    return {
      bridgeRuntimeBuild:
        process.env["IBKR_BRIDGE_RUNTIME_BUILD"]?.trim() || null,
      configured: true,
      authenticated: session.authenticated,
      connected: session.connected,
      competing: session.competing,
      selectedAccountId: session.selectedAccountId,
      accounts: session.accounts,
      lastTickleAt: this.lastTickleAt,
      lastError: this.lastError,
      lastRecoveryAttemptAt: this.lastRecoveryAttemptAt,
      lastRecoveryError: this.lastRecoveryError,
      updatedAt: new Date(),
      transport: "tws",
      connectionTarget: `${this.config.host}:${this.config.port}`,
      sessionMode: this.config.mode,
      clientId: this.config.clientId,
      marketDataMode,
      liveMarketDataAvailable: isLiveIbkrMarketDataMode(marketDataMode),
      healthFresh: true,
      healthAgeMs: 0,
      stale: false,
      bridgeReachable: true,
      socketConnected: session.connected,
      accountsLoaded,
      configuredLiveMarketDataMode,
      streamFresh,
      lastStreamEventAgeMs,
      strictReady,
      strictReason,
      diagnostics: {
        scheduler: getBridgeSchedulerDiagnostics(),
        pressure: getBridgePressureState(),
        subscriptions: subscriptionDiagnostics,
        lastReconnectReason: this.lastReconnectReason,
      },
    };
  }

  getLaneDiagnostics(): BridgeLaneDiagnostics {
    return {
      scheduler: getBridgeSchedulerDiagnostics(),
      schedulerConfig: getBridgeSchedulerConfigSnapshot(),
      limits: getBridgeRuntimeLimitSnapshot(),
      subscriptions: this.getSubscriptionDiagnostics(),
      pressure: getBridgePressureState(),
      updatedAt: new Date(),
    };
  }

  applyLaneSettings(input: BridgeLaneSettingsInput): BridgeLaneDiagnostics {
    const shouldResetTickle =
      input.limits &&
      Object.prototype.hasOwnProperty.call(input.limits, "tickleIntervalMs");

    if (input.scheduler) {
      setBridgeSchedulerOverrides(input.scheduler);
    }
    if (input.limits) {
      setBridgeRuntimeLimitOverrides(input.limits);
      this.trimUnusedQuoteSubscriptions();
    }
    if (shouldResetTickle) {
      if (this.tickleTimer) {
        clearInterval(this.tickleTimer);
        this.tickleTimer = null;
      }
      this.ensureTickleLoop();
    }

    return this.getLaneDiagnostics();
  }

  async listAccounts(_mode: RuntimeMode): Promise<BrokerAccountSnapshot[]> {
    return runBridgeLane("account", async () => {
      await this.refreshSession();
      await this.waitForCondition(
        () => this.accountSummaryInitialized,
        1_500,
        100,
      );

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
          accountType: summary?.accountType ?? null,
          totalCashValue: summary?.totalCashValue ?? null,
          settledCash: summary?.settledCash ?? null,
          accruedCash: summary?.accruedCash ?? null,
          initialMargin: summary?.initialMargin ?? null,
          maintenanceMargin: summary?.maintenanceMargin ?? null,
          excessLiquidity: summary?.excessLiquidity ?? null,
          cushion: summary?.cushion ?? null,
          sma: summary?.sma ?? null,
          dayTradingBuyingPower: summary?.dayTradingBuyingPower ?? null,
          regTInitialMargin: summary?.regTInitialMargin ?? null,
          grossPositionValue: summary?.grossPositionValue ?? null,
          leverage: summary?.leverage ?? null,
          dayTradesRemaining: summary?.dayTradesRemaining ?? null,
          isPatternDayTrader: null,
          updatedAt: summary?.updatedAt ?? new Date(),
        };
      });
    });
  }

  async listPositions(input: {
    accountId?: string;
    mode: RuntimeMode;
  }): Promise<BrokerPositionSnapshot[]> {
    return runBridgeLane("account", async () => {
      await this.refreshSession();
      await this.waitForCondition(() => this.positionsInitialized, 1_500, 100);
      const accountId = input.accountId?.trim();

      return Array.from(this.positionsByAccount.entries())
        .flatMap(([currentAccountId, positions]) =>
          accountId && currentAccountId !== accountId ? [] : positions,
        )
        .sort((left, right) => left.symbol.localeCompare(right.symbol));
    });
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
  }): Promise<BridgeOrdersResult> {
    return runBridgeLane(
      "account",
      async () => {
        await this.refreshSession();
        const result = await this.getAllOpenOrderSnapshots();

        return {
          ...result,
          orders: result.orders
            .filter(
              (order) =>
                (!input.accountId || order.accountId === input.accountId) &&
                (!input.status || order.status === input.status),
            )
            .sort(
              (left, right) =>
                right.updatedAt.getTime() - left.updatedAt.getTime(),
            ),
        };
      },
      { timeoutMs: Math.max(5_000, this.openOrdersRequestTimeoutMs + 3_000) },
    );
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
        new Date(Date.now() - Math.max(1, input.days ?? 7) * 86_400_000),
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
          executedAt: parseExecutionTime(
            asString(detail.execution.time) ?? undefined,
          ),
          orderDescription: null,
          contractDescription: asString(detail.contract.localSymbol),
          providerContractId,
          orderRef: asString(detail.execution.orderRef),
        } satisfies BrokerExecutionSnapshot;
      }),
    )
      .sort(
        (left, right) => right.executedAt.getTime() - left.executedAt.getTime(),
      )
      .slice(0, Math.max(1, input.limit ?? 50));
  }

  async getQuoteSnapshots(symbols: string[]): Promise<QuoteSnapshot[]> {
    await this.refreshSession();

    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    const results: QuoteSnapshot[] = [];
    const liveProviderContractIdsBySymbol =
      await this.ensureQuoteSubscriptionsForSymbols(normalizedSymbols);

    for (const symbol of normalizedSymbols) {
      const resolved = await this.resolveStockContract(symbol);
      const providerContractId =
        liveProviderContractIdsBySymbol.get(symbol) ??
        resolved.resolved.providerContractId;

      if (liveProviderContractIdsBySymbol.has(symbol)) {
        await this.waitForCondition(
          () => this.quotesByProviderContractId.has(providerContractId),
          400,
          50,
        );

        const liveQuote =
          this.quotesByProviderContractId.get(providerContractId);
        if (liveQuote) {
          results.push(this.decorateQuoteForEmit(liveQuote));
          continue;
        }
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
        results.push(this.decorateQuoteForEmit(fallbackQuote));
      }
    }

    return results;
  }

  async prewarmQuoteSubscriptions(symbols: string[]): Promise<void> {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    this.prewarmQuoteSymbols.clear();
    normalizedSymbols.forEach((symbol) => this.prewarmQuoteSymbols.add(symbol));

    if (normalizedSymbols.length === 0) {
      this.trimUnusedQuoteSubscriptions();
      return;
    }

    const providerContractIdsBySymbol =
      await this.ensureQuoteSubscriptionsForSymbols(normalizedSymbols);
    const subscribedSymbols = normalizedSymbols.filter((symbol) =>
      providerContractIdsBySymbol.has(symbol),
    );

    if (subscribedSymbols.length === 0) {
      this.trimUnusedQuoteSubscriptions();
      return;
    }

    await this.waitForCondition(
      () =>
        subscribedSymbols.every((symbol) => {
          const providerContractId = providerContractIdsBySymbol.get(symbol);
          return Boolean(
            providerContractId &&
              this.quotesByProviderContractId.has(providerContractId),
          );
        }),
      600,
      50,
    );

    this.trimUnusedQuoteSubscriptions();
  }

  async subscribeQuoteStream(
    symbols: string[],
    onQuote: (quote: QuoteSnapshot) => void,
  ): Promise<() => void> {
    const normalizedSymbols = Array.from(
      new Set(symbols.map((symbol) => normalizeSymbol(symbol)).filter(Boolean)),
    );

    if (normalizedSymbols.length === 0) {
      return () => {};
    }

    const listenerId = this.nextQuoteStreamListenerId;
    this.nextQuoteStreamListenerId += 1;
    this.quoteStreamListeners.set(listenerId, {
      id: listenerId,
      symbols: new Set(normalizedSymbols),
      providerContractIds: new Set(),
      onQuote,
    });

    try {
      const cachedQuotes = this.collectQuotesBySymbol();
      normalizedSymbols.forEach((symbol) => {
        const quote = cachedQuotes.get(symbol);
        if (quote) {
          onQuote(this.decorateQuoteForEmit(quote));
        }
      });

      await this.ensureQuoteSubscriptionsForSymbols(normalizedSymbols);

      const nextCachedQuotes = this.collectQuotesBySymbol();
      normalizedSymbols.forEach((symbol) => {
        const quote = nextCachedQuotes.get(symbol);
        if (quote) {
          onQuote(this.decorateQuoteForEmit(quote));
        }
      });
    } catch (error) {
      this.quoteStreamListeners.delete(listenerId);
      this.trimUnusedQuoteSubscriptions();
      throw error;
    }

    return () => {
      this.quoteStreamListeners.delete(listenerId);
      this.trimUnusedQuoteSubscriptions();
    };
  }

  async getOptionQuoteSnapshots(input: {
    underlying?: string | null;
    providerContractIds: string[];
  }): Promise<QuoteSnapshot[]> {
    await this.refreshSession();

    const normalizedProviderContractIds = Array.from(
      new Set(
        input.providerContractIds
          .map((providerContractId) => providerContractId.trim())
          .filter(Boolean),
      ),
    );

    const results: QuoteSnapshot[] = [];
    const liveProviderContractIds = new Set(
      await this.ensureOptionQuoteSubscriptionsForProviderContractIds(
        normalizedProviderContractIds,
      ),
    );

    for (const providerContractId of normalizedProviderContractIds) {
      const resolved =
        await this.resolveOptionContractByProviderContractId(
          providerContractId,
        );
      const ensuredProviderContractId = providerContractId.trim();

      if (liveProviderContractIds.has(ensuredProviderContractId)) {
        await this.waitForCondition(
          () => this.quotesByProviderContractId.has(ensuredProviderContractId),
          400,
          50,
        );

        const liveQuote = this.quotesByProviderContractId.get(
          ensuredProviderContractId,
        );
        if (liveQuote) {
          results.push(this.decorateQuoteForEmit(liveQuote));
          continue;
        }
      }

      const fallbackQuote = await this.getContractQuoteSnapshot({
        contract: {
          ...resolved.contract,
          exchange: "SMART",
        },
        symbol: resolved.optionContract.ticker,
        providerContractId: ensuredProviderContractId,
      });

      if (fallbackQuote) {
        this.quotesByProviderContractId.set(
          ensuredProviderContractId,
          fallbackQuote,
        );
        results.push(this.decorateQuoteForEmit(fallbackQuote));
      }
    }

    return results;
  }

  async subscribeOptionQuoteStream(
    input: {
      underlying?: string | null;
      providerContractIds: string[];
    },
    onQuote: (quote: QuoteSnapshot) => void,
  ): Promise<() => void> {
    const normalizedProviderContractIds = Array.from(
      new Set(
        input.providerContractIds
          .map((providerContractId) => providerContractId.trim())
          .filter(Boolean),
      ),
    );

    if (normalizedProviderContractIds.length === 0) {
      return () => {};
    }

    const listenerId = this.nextQuoteStreamListenerId;
    this.nextQuoteStreamListenerId += 1;
    this.quoteStreamListeners.set(listenerId, {
      id: listenerId,
      symbols: new Set(),
      providerContractIds: new Set(normalizedProviderContractIds),
      onQuote,
    });

    try {
      const cachedQuotes = this.collectQuotesByProviderContractId();
      normalizedProviderContractIds.forEach((providerContractId) => {
        const quote = cachedQuotes.get(providerContractId);
        if (quote) {
          onQuote(this.decorateQuoteForEmit(quote));
        }
      });

      await this.ensureOptionQuoteSubscriptionsForProviderContractIds(
        normalizedProviderContractIds,
      );

      const nextCachedQuotes = this.collectQuotesByProviderContractId();
      normalizedProviderContractIds.forEach((providerContractId) => {
        const quote = nextCachedQuotes.get(providerContractId);
        if (quote) {
          onQuote(this.decorateQuoteForEmit(quote));
        }
      });
    } catch (error) {
      this.quoteStreamListeners.delete(listenerId);
      this.trimUnusedQuoteSubscriptions();
      throw error;
    }

    return () => {
      this.quoteStreamListeners.delete(listenerId);
      this.trimUnusedQuoteSubscriptions();
    };
  }

  private buildHistoricalBarStreamKey(input: {
    symbol: string;
    timeframe: HistoryBarTimeframe;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
    outsideRth?: boolean;
    source?: HistoryDataSource;
  }): string {
    return JSON.stringify({
      symbol: normalizeSymbol(input.symbol),
      timeframe: input.timeframe,
      assetClass: input.assetClass ?? "equity",
      providerContractId: input.providerContractId?.trim() || null,
      outsideRth: input.outsideRth !== false,
      source: input.source ?? "trades",
    });
  }

  private async resolveHistoricalBarContract(input: {
    symbol: string;
    assetClass?: "equity" | "option";
    providerContractId?: string | null;
  }): Promise<{ contract: Contract; providerContractId: string | null }> {
    if (input.assetClass === "option") {
      if (!input.providerContractId) {
        throw new HttpError(400, "Option providerContractId is required.", {
          code: "ibkr_option_bars_missing_conid",
        });
      }
      const numericProviderContractId = /^\d+$/.test(input.providerContractId)
        ? Number(input.providerContractId)
        : null;
      if (numericProviderContractId !== null) {
        return {
          contract: {
            conId: numericProviderContractId,
            exchange: "SMART",
            secType: SecType.OPT,
          },
          providerContractId: input.providerContractId,
        };
      }

      const resolvedOption = await this.resolveOptionContractByProviderContractId(
        input.providerContractId,
      );

      return {
        contract: {
          ...resolvedOption.contract,
          exchange: resolvedOption.contract.exchange ?? "SMART",
        },
        providerContractId:
          resolvedOption.optionContract.providerContractId ??
          input.providerContractId,
      };
    }

    const resolvedStock = await this.resolveStockContract(input.symbol);
    return {
      contract: {
        ...resolvedStock.contract,
        conId: resolvedStock.resolved.conid,
        exchange: "SMART",
      },
      providerContractId: resolvedStock.resolved.providerContractId,
    };
  }

  async subscribeHistoricalBarStream(
    input: {
      symbol: string;
      timeframe: HistoryBarTimeframe;
      assetClass?: "equity" | "option";
      providerContractId?: string | null;
      outsideRth?: boolean;
      source?: HistoryDataSource;
    },
    onBar: (bar: BrokerBarSnapshot) => void,
    onError?: (error: unknown) => void,
  ): Promise<() => void> {
    await runBridgeLane("historical", async () => {
      await this.refreshSession();
    });

    const streamKey = this.buildHistoricalBarStreamKey(input);
    let subscription = this.barStreamSubscriptions.get(streamKey);

    if (!subscription) {
      const { contract, providerContractId } =
        await this.resolveHistoricalBarContract(input);
      const listeners = new Map<number, (bar: BrokerBarSnapshot) => void>();
      const errorListeners = new Map<number, (error: unknown) => void>();
      const delayed =
        this.config.marketDataType === 3 || this.config.marketDataType === 4;
      const marketDataMode = resolveIbkrMarketDataMode(
        this.config.marketDataType,
      );
      let rxSubscription: { unsubscribe(): void } | null = null;

      const newSubscription: BarStreamSubscription = {
        key: streamKey,
        listeners,
        errorListeners,
        latestSignature: null,
        latestBar: null,
        stop: () => {
          rxSubscription?.unsubscribe();
        },
      };
      subscription = newSubscription;
      this.barStreamSubscriptions.set(streamKey, subscription);

      try {
        rxSubscription = this.api
          .getHistoricalDataUpdates(
            contract,
            HISTORY_BAR_SIZE[input.timeframe],
            HISTORY_SOURCE_TO_TWS[input.source ?? "trades"],
            2,
          )
          .subscribe({
            next: (bars) => {
              const nextBars = (Array.isArray(bars) ? bars : [bars]) as Array<{
                time?: string;
                open?: number | string;
                high?: number | string;
                low?: number | string;
                close?: number | string;
                volume?: number | string;
              }>;
              const latestBar =
                (compact(
                  nextBars.map((bar) =>
                    toBrokerBarSnapshotFromHistoricalBar({
                      bar,
                      providerContractId,
                      outsideRth: true,
                      partial: true,
                      delayed,
                      marketDataMode,
                    }),
                  ),
                ).slice(-1)[0] as BrokerBarSnapshot | undefined) ?? null;

              if (!latestBar) {
                return;
              }

              const signature = JSON.stringify({
                timestamp: latestBar.timestamp.toISOString(),
                open: latestBar.open,
                high: latestBar.high,
                low: latestBar.low,
                close: latestBar.close,
                volume: latestBar.volume,
              });

              if (newSubscription.latestSignature === signature) {
                return;
              }

              newSubscription.latestSignature = signature;
              newSubscription.latestBar = latestBar;
              newSubscription.listeners.forEach((listener) =>
                listener(latestBar),
              );
            },
            error: (error) => {
              this.recordError(error);
              const activeSubscription =
                this.barStreamSubscriptions.get(streamKey);
              if (activeSubscription) {
                activeSubscription.errorListeners.forEach((listener) =>
                  listener(error),
                );
                activeSubscription.stop();
                this.barStreamSubscriptions.delete(streamKey);
              }
              if (isHistoricalDataReconnectableError(error)) {
                void this.reestablishConnection(
                  `historical_bar_stream:${streamKey}`,
                  error,
                ).catch((recoveryError) => {
                  this.recordError(recoveryError);
                });
              }
            },
          });
      } catch (error) {
        this.barStreamSubscriptions.delete(streamKey);
        throw error;
      }
    }

    const listenerId = this.nextQuoteStreamListenerId;
    this.nextQuoteStreamListenerId += 1;
    subscription.listeners.set(listenerId, onBar);
    if (onError) {
      subscription.errorListeners.set(listenerId, onError);
    }

    if (subscription.latestBar) {
      onBar(subscription.latestBar);
    }

    return () => {
      const activeSubscription = this.barStreamSubscriptions.get(streamKey);
      if (!activeSubscription) {
        return;
      }

      activeSubscription.listeners.delete(listenerId);
      activeSubscription.errorListeners.delete(listenerId);
      if (activeSubscription.listeners.size > 0) {
        return;
      }

      activeSubscription.stop();
      this.barStreamSubscriptions.delete(streamKey);
    };
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
    return runBridgeLane("historical", async () => {
      await this.refreshSession();

      const { contract, providerContractId } =
        await this.resolveHistoricalBarContract(input);

      const requestedBars = resolveRequestedHistoryBars(input);
      const bars = await this.withHistoricalDataRecovery(
        {
          operation: "historical_bars",
          symbol: input.symbol,
          timeframe: input.timeframe,
          assetClass: input.assetClass,
          providerContractId: input.providerContractId,
        },
        () =>
          this.api.getHistoricalData(
            contract,
            formatHistoryEndDate(input.to ?? new Date()),
            buildHistoryDuration(input.timeframe, requestedBars),
            HISTORY_BAR_SIZE[input.timeframe],
            HISTORY_SOURCE_TO_TWS[input.source ?? "trades"],
            input.outsideRth ? 0 : 1,
            2,
          ),
      );

      return compact(
        bars.map((bar) =>
          toBrokerBarSnapshotFromHistoricalBar({
            bar,
            providerContractId,
            outsideRth: Boolean(input.outsideRth),
            partial: false,
            delayed:
              this.config.marketDataType === 3 ||
              this.config.marketDataType === 4,
            marketDataMode: resolveIbkrMarketDataMode(
              this.config.marketDataType,
            ),
          }),
        ),
      )
        .filter(
          (bar) =>
            (!input.from || bar.timestamp >= input.from) &&
            (!input.to || bar.timestamp <= input.to),
        )
        .slice(-Math.max(1, input.limit ?? requestedBars));
    });
  }

  async getOptionChain(input: {
    underlying: string;
    expirationDate?: Date;
    contractType?: "call" | "put" | null;
    maxExpirations?: number;
    strikesAroundMoney?: number;
    strikeCoverage?: "fast" | "standard" | "full";
    quoteHydration?: "metadata" | "snapshot";
    signal?: AbortSignal;
  }): Promise<OptionChainContract[]> {
    const normalizedUnderlying = normalizeSymbol(input.underlying);
    const singleFlightKey = JSON.stringify({
      type: "chain",
      underlying: normalizedUnderlying,
      expirationDate: input.expirationDate?.toISOString().slice(0, 10) ?? null,
      contractType: input.contractType ?? null,
      maxExpirations: input.maxExpirations ?? null,
      strikesAroundMoney: input.strikesAroundMoney ?? null,
      strikeCoverage: input.strikeCoverage ?? null,
      quoteHydration: input.quoteHydration ?? "snapshot",
    });

    return this.runOptionMetaSingleFlight(singleFlightKey, () =>
      runBridgeLane("options-meta", async () => {
        if (input.signal?.aborted) {
          return [];
        }
        await this.refreshSession();
        const resolvedUnderlying =
          await this.resolveStockContract(input.underlying);
        const underlyingQuote =
          (await this.getQuoteSnapshots([input.underlying]))[0] ?? null;
        const spotPrice =
          underlyingQuote?.price ??
          underlyingQuote?.bid ??
          underlyingQuote?.ask ??
          0;

        if (input.signal?.aborted) {
          return [];
        }

        const optionResolution = await this.getOptionParametersForStock(
          input.underlying,
          resolvedUnderlying,
        );
        const optionParameters = collectTwsOptionParameters(
          optionResolution.optionParams,
        );
        const normalizedUnderlying = normalizeSymbol(
          optionResolution.resolvedUnderlying.resolved.symbol,
        );
        const aggregateParameterSet = buildAggregateTwsOptionParameterSet({
          optionParameters,
          normalizedUnderlying,
        });
        const normalizedParameterSets = normalizeTwsOptionParameterSets(
          optionResolution.optionParams,
          normalizedUnderlying,
        );

        if (
          !optionParameters.expirations.length ||
          !optionParameters.strikes.length ||
          (!normalizedParameterSets.length && !aggregateParameterSet)
        ) {
          return [];
        }

        const requestedExpiration = input.expirationDate
          ? input.expirationDate.toISOString().slice(0, 10)
          : null;
        const expirations = optionParameters.expirations
          .filter((expiration) =>
            requestedExpiration
              ? expiration.toISOString().slice(0, 10) === requestedExpiration
              : true,
          )
          .slice(
            0,
            typeof input.maxExpirations === "number" &&
              Number.isFinite(input.maxExpirations)
              ? Math.max(1, Math.floor(input.maxExpirations))
              : optionParameters.expirations.length,
          );

        const rights = input.contractType
          ? [input.contractType]
          : (["call", "put"] as const);
        const quoteHydration = input.quoteHydration ?? "snapshot";

        const contractsByProviderContractId = new Map<string, OptionChainContract>();
        for (const expirationDate of expirations) {
          const expirationKey = formatOptionExpiry(expirationDate);
          const parameterSetsForExpiration = [
            ...normalizedParameterSets.filter((parameterSet) =>
              parameterSet.expirationKeys.has(expirationKey),
            ),
            ...(aggregateParameterSet &&
            aggregateParameterSet.expirationKeys.has(expirationKey) &&
            !normalizedParameterSets.some((parameterSet) =>
              parameterSet.expirationKeys.has(expirationKey),
            )
              ? [aggregateParameterSet]
              : []),
          ];
          if (!parameterSetsForExpiration.length) {
            continue;
          }

          const relevantStrikes = selectRelevantOptionStrikes({
            strikes: Array.from(
              new Set(
                parameterSetsForExpiration.flatMap(
                  (parameterSet) => parameterSet.strikes,
                ),
              ),
            ),
            spotPrice,
            strikesAroundMoney: input.strikesAroundMoney,
            strikeCoverage: input.strikeCoverage,
          });

          for (const strike of relevantStrikes) {
            for (const right of rights) {
              if (input.signal?.aborted) {
                return Array.from(contractsByProviderContractId.values());
              }

              const parameterSet =
                parameterSetsForExpiration.find((candidate) =>
                  candidate.strikeKeys.has(strike),
                ) ?? parameterSetsForExpiration[0];
              if (!parameterSet) {
                continue;
              }

              const identity: StructuredOptionContractIdentity = {
                underlying: optionResolution.resolvedUnderlying.resolved.symbol,
                expirationDate,
                strike,
                right,
                exchange: parameterSet.exchange,
                tradingClass: parameterSet.tradingClass,
                multiplier: parameterSet.multiplier,
              };
              const providerContractId =
                buildStructuredOptionProviderContractId(identity);
              const resolvedOption = this.cacheStructuredOptionContract(
                identity,
                providerContractId,
              );

              const quote =
                quoteHydration === "snapshot"
                  ? ((resolvedOption.optionContract.providerContractId &&
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
                          // 100 = option volume, 101 = option open interest, 106 =
                          // option implied volatility (which also triggers the
                          // server-side option computation ticks carrying delta,
                          // gamma, vega and theta). Without these generic ticks IBKR
                          // omits the values from the snapshot and the option chain
                          // can't surface IV/Greeks.
                          genericTickList: "100,101,106",
                        })) ?? null)
                  : null;

              const bid = quote?.bid ?? null;
              const ask = quote?.ask ?? null;
              const last = quote?.price ?? null;
              const quoteFreshness =
                quote?.freshness ?? (quote ? "live" : "metadata");
              const quoteUpdatedAt =
                quote?.dataUpdatedAt ?? quote?.updatedAt ?? null;

              contractsByProviderContractId.set(providerContractId, {
                contract: resolvedOption.optionContract,
                bid,
                ask,
                last,
                mark:
                  bid != null && ask != null && bid > 0 && ask > 0
                    ? (bid + ask) / 2
                    : last,
                impliedVolatility: quote?.impliedVolatility ?? null,
                delta: quote?.delta ?? null,
                gamma: quote?.gamma ?? null,
                theta: quote?.theta ?? null,
                vega: quote?.vega ?? null,
                openInterest: quote?.openInterest ?? null,
                volume: quote?.volume ?? null,
                updatedAt: quote?.updatedAt ?? new Date(),
                quoteFreshness,
                marketDataMode:
                  quote?.marketDataMode ??
                  resolveIbkrMarketDataMode(this.config.marketDataType),
                quoteUpdatedAt,
                dataUpdatedAt: quoteUpdatedAt,
                ageMs: quote?.ageMs ?? null,
                underlyingPrice: spotPrice > 0 ? spotPrice : null,
              });
            }
          }
        }

        return Array.from(contractsByProviderContractId.values()).sort((left, right) => {
          return (
            left.contract.expirationDate.getTime() -
              right.contract.expirationDate.getTime() ||
            left.contract.strike - right.contract.strike ||
            left.contract.right.localeCompare(right.contract.right)
          );
        });
      }),
    );
  }

  async getOptionExpirations(input: {
    underlying: string;
    maxExpirations?: number;
    signal?: AbortSignal;
  }): Promise<Date[]> {
    const normalizedUnderlying = normalizeSymbol(input.underlying);
    const singleFlightKey = JSON.stringify({
      type: "expiration",
      underlying: normalizedUnderlying,
      maxExpirations: input.maxExpirations ?? null,
    });

    return this.runOptionMetaSingleFlight(singleFlightKey, () =>
      runBridgeLane("options-meta", async () => {
        if (input.signal?.aborted) {
          return [];
        }
        await this.refreshSession();
        const resolvedUnderlying =
          await this.resolveStockContract(input.underlying);
        const optionResolution = await this.getOptionParametersForStock(
          input.underlying,
          resolvedUnderlying,
        );

        if (input.signal?.aborted) {
          return [];
        }

        return collectTwsOptionParameters(
          optionResolution.optionParams,
          input.maxExpirations,
        ).expirations;
      }),
    );
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

      const numericProviderContractId = /^\d+$/.test(providerContractId)
        ? Number(providerContractId)
        : null;
      if (numericProviderContractId !== null) {
        contract = {
          conId: numericProviderContractId,
          secType: SecType.OPT,
          exchange,
        };
      } else {
        const resolvedOption =
          await this.resolveOptionContractByProviderContractId(providerContractId);
        contract = {
          ...resolvedOption.contract,
          exchange: resolvedOption.contract.exchange ?? exchange,
        };
        symbol = resolvedOption.optionContract.ticker;
      }
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
      const subscription = this.api
        .getMarketDepth(contract, 10, exchange === "SMART")
        .subscribe({
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
    const orderId = await this.api.getNextValidOrderId();
    if (!Number.isFinite(orderId) || orderId <= 0) {
      throw new HttpError(502, "TWS did not return a valid order id.", {
        code: "ibkr_tws_invalid_order_id",
      });
    }

    const order = {
      ...structured.order,
      orderId,
      account: structured.accountId,
    } as Order & Record<string, unknown>;
    this.api.placeOrder(orderId, structured.contract, order);

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
	    mode?: RuntimeMode | null;
	    confirm?: boolean | null;
	    orders: Record<string, unknown>[];
	  }): Promise<Record<string, unknown>> {
	    await this.refreshSession();
	    const accountId = await this.requireAccountId(input.accountId);
	    const structuredOrders = input.orders.map((rawOrder) =>
	      this.parseStructuredRawOrder(rawOrder, accountId),
	    );
	    const baseOrderId = await this.api.getNextValidOrderId();
	    if (!Number.isFinite(baseOrderId) || baseOrderId <= 0) {
	      throw new HttpError(502, "TWS did not return a valid order id.", {
	        code: "ibkr_tws_invalid_order_id",
	      });
	    }
	    const submittedOrderIds = structuredOrders.map((_, index) =>
	      String(baseOrderId + index),
	    );

	    structuredOrders.forEach((structured, index) => {
	      const orderId = baseOrderId + index;
	      const order = {
	        ...structured.order,
	        orderId,
	        account: accountId,
	      } as Order & Record<string, unknown>;
	      const parentOrderIndex = asNumber(order["parentOrderIndex"]);

	      delete order["parentOrderIndex"];
	      if (
	        Number.isFinite(parentOrderIndex) &&
	        parentOrderIndex !== null &&
	        parentOrderIndex >= 0 &&
	        parentOrderIndex < structuredOrders.length
	      ) {
	        order.parentId = baseOrderId + parentOrderIndex;
	      }

	      this.api.placeOrder(orderId, structured.contract, order);
	    });

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
    confirm?: boolean | null;
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
        normalizeSymbol(asString(structured.contract.symbol) ?? "") ||
        "UNKNOWN",
      assetClass:
        normalizeAssetClassFromSecType(
          asString(structured.contract.secType) ?? undefined,
        ) ?? "equity",
      side: normalizeOrderSide(asString(structured.order.action) ?? undefined),
      type: normalizeOrderType(
        asString(structured.order.orderType) ?? undefined,
      ),
      timeInForce: normalizeTimeInForce(
        asString(structured.order.tif) ?? undefined,
      ),
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
    confirm?: boolean | null;
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
  }): Promise<
    import("../../api-server/src/providers/ibkr/client").IbkrNewsArticle[]
  > {
    // TWS doesn't expose news via the IB Gateway API in the same way
    // Client Portal does; the platform service falls back to the secondary
    // provider when this returns empty.
    return [];
  }

  async searchTickers(input: {
    search?: string;
    market?: IbkrUniverseTicker["market"];
    markets?: IbkrUniverseTicker["market"][];
    limit?: number;
    signal?: AbortSignal;
  }): Promise<{
    count: number;
    results: IbkrUniverseTicker[];
  }> {
    const search = input.search?.trim();
    if (!search || input.signal?.aborted) {
      return { count: 0, results: [] };
    }

    await this.refreshSession();
    if (input.signal?.aborted) {
      return { count: 0, results: [] };
    }

    const limit = Number.isFinite(input.limit)
      ? Math.max(1, Math.floor(Number(input.limit)))
      : 50;
    const requestedMarkets = new Set(
      input.markets?.length
        ? input.markets
        : input.market
          ? [input.market]
          : [],
    );
    const descriptions = await this.api
      .getMatchingSymbols(search)
      .catch((error) => {
        this.recordError(error);
        return [] as ContractDescription[];
      });

    if (input.signal?.aborted) {
      return { count: 0, results: [] };
    }

    const seen = new Set<string>();
    const mappedResults = compact(
      descriptions.map(mapTwsContractDescriptionToUniverseTicker),
    )
      .filter(
        (ticker) =>
          requestedMarkets.size === 0 || requestedMarkets.has(ticker.market),
      )
      .flatMap((ticker, index) => {
        const key =
          ticker.providerContractId ??
          `${ticker.ticker}:${ticker.market}:${ticker.primaryExchange ?? ""}`;
        if (seen.has(key)) {
          return [];
        }

        seen.add(key);
        return [{ ticker, index }];
      });

    const results = mappedResults
      .sort((left, right) => {
        const scoreDiff =
          scoreTwsUniverseTicker(right.ticker, search, requestedMarkets) -
          scoreTwsUniverseTicker(left.ticker, search, requestedMarkets);
        if (scoreDiff !== 0) return scoreDiff;
        const tickerDiff = left.ticker.ticker.localeCompare(
          right.ticker.ticker,
        );
        return tickerDiff !== 0 ? tickerDiff : left.index - right.index;
      })
      .map(({ ticker }) => ticker)
      .slice(0, limit);

    return { count: results.length, results };
  }
}
