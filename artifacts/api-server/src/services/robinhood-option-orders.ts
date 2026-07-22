import { randomUUID } from "node:crypto";

import { and, eq, inArray, ne } from "drizzle-orm";

import {
  algoDeploymentTargetsTable,
  algoDeploymentsTable,
  algoTargetExecutionsTable,
  algoTargetPositionsTable,
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { RobinhoodMcpSession } from "../providers/robinhood/mcp-client";
import { getRobinhoodAccessToken } from "./robinhood-oauth";
import {
  robinhoodSubmitReconciliationFailure,
  type RobinhoodSubmitReconciliationReason,
} from "./robinhood-order-submit-reconciliation";
import {
  assertTaxPreflightForOrderSubmission,
  recordTaxPreflightOrderSubmitted,
} from "./tax-planning";
import {
  canonicalOptionTaxSemantics,
  type TaxOptionOrderAction,
  type TaxOrderLike,
} from "./tax-planning-model";
import { requireStandardOptionContractIdentity } from "./standard-option-contract-identity";

export const ROBINHOOD_OPTION_TYPES = ["Call", "Put"] as const;
export const ROBINHOOD_OPTION_ORDER_SIDES = ["Buy", "Sell"] as const;
export const ROBINHOOD_OPTION_POSITION_EFFECTS = ["Open", "Close"] as const;
export const ROBINHOOD_OPTION_ORDER_TYPES = [
  "Limit",
  "Market",
  "StopLimit",
  "StopMarket",
] as const;
export const ROBINHOOD_OPTION_TIME_IN_FORCE_VALUES = ["Day", "GTC"] as const;
export const ROBINHOOD_OPTION_MARKET_HOURS = [
  "regular_hours",
  "regular_curb_hours",
  "regular_curb_overnight_hours",
] as const;
export const ROBINHOOD_OPTION_UNDERLYING_TYPES = ["equity", "index"] as const;

export type RobinhoodOptionType = (typeof ROBINHOOD_OPTION_TYPES)[number];
export type RobinhoodOptionOrderSide =
  (typeof ROBINHOOD_OPTION_ORDER_SIDES)[number];
export type RobinhoodOptionPositionEffect =
  (typeof ROBINHOOD_OPTION_POSITION_EFFECTS)[number];
export type RobinhoodOptionOrderType =
  (typeof ROBINHOOD_OPTION_ORDER_TYPES)[number];
export type RobinhoodOptionTimeInForce =
  (typeof ROBINHOOD_OPTION_TIME_IN_FORCE_VALUES)[number];
export type RobinhoodOptionMarketHours =
  (typeof ROBINHOOD_OPTION_MARKET_HOURS)[number];
export type RobinhoodOptionUnderlyingType =
  (typeof ROBINHOOD_OPTION_UNDERLYING_TYPES)[number];

export type RobinhoodOptionOrderInput = {
  contractSymbol: string;
  multiplier: number;
  sharesPerContract: number;
  chainSymbol: string;
  underlyingType?: RobinhoodOptionUnderlyingType | null;
  expiration: string;
  strike: number;
  optionType: RobinhoodOptionType;
  side: RobinhoodOptionOrderSide;
  positionEffect: RobinhoodOptionPositionEffect;
  orderType: RobinhoodOptionOrderType;
  timeInForce: RobinhoodOptionTimeInForce;
  marketHours?: RobinhoodOptionMarketHours | null;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
};

export type RobinhoodOptionOrderPlaceInput = RobinhoodOptionOrderInput & {
  confirm?: boolean;
  refId?: string | null;
  taxPreflightToken?: string | null;
  taxAcknowledgements?: string[] | null;
};

export type RobinhoodOptionOrderAccount = {
  id: string;
  connectionId: string;
  accountNumberLast4: string | null;
  displayName: string;
  baseCurrency: string;
  mode: "live";
  accountStatus: string | null;
  executionReady: boolean;
  executionBlockers: string[];
  lastSyncedAt: string | null;
};

export type RobinhoodOptionOrderDetails = {
  optionId: string;
  occSymbol: string;
  multiplier: number;
  sharesPerContract: number;
  chainSymbol: string;
  underlyingType: RobinhoodOptionUnderlyingType;
  expiration: string;
  strike: number;
  optionType: RobinhoodOptionType;
  side: RobinhoodOptionOrderSide;
  positionEffect: RobinhoodOptionPositionEffect;
  orderType: RobinhoodOptionOrderType;
  timeInForce: RobinhoodOptionTimeInForce;
  marketHours: RobinhoodOptionMarketHours;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
};

export type RobinhoodOptionQuote = {
  instrumentId: string | null;
  markPrice: number | null;
  adjustedMarkPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  previousClosePrice: number | null;
  impliedVolatility: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  updatedAt: string | null;
};

export type RobinhoodOptionOrderReviewResponse = {
  provider: "robinhood";
  checkedAt: string;
  account: RobinhoodOptionOrderAccount;
  order: RobinhoodOptionOrderDetails;
  review: {
    alerts: string[];
    orderChecks: unknown;
    marketDataDisclosure: string | null;
    quote: RobinhoodOptionQuote | null;
    estimate: {
      premium: number | null;
      totalFee: number | null;
      collateralAmount: number | null;
      collateralDirection: string | null;
      collateralInfinite: boolean;
    };
  };
};

export type RobinhoodOptionOrderPlaceResponse = {
  provider: "robinhood";
  submittedAt: string;
  account: RobinhoodOptionOrderAccount;
  order: RobinhoodOptionOrderDetails & {
    brokerageOrderId: string;
    state: string | null;
    refId: string;
  };
  alerts: string[];
  reconcileRequired?: true;
  reconciliationReason?: "tax_preflight_order_submit_record_failed";
};

export type RobinhoodOptionRecentOrder = {
  id: string | null;
  chainSymbol: string | null;
  state: string | null;
  orderType: string | null;
  quantity: number | null;
  processedQuantity: number | null;
  price: number | null;
  stopPrice: number | null;
  createdAt: string | null;
};

export type RobinhoodOptionRecentOrdersResponse = {
  provider: "robinhood";
  checkedAt: string;
  account: RobinhoodOptionOrderAccount;
  orders: RobinhoodOptionRecentOrder[];
};

export type RobinhoodOptionQuoteResponse = {
  provider: "robinhood";
  checkedAt: string;
  account: RobinhoodOptionOrderAccount;
  optionId: string;
  quote: RobinhoodOptionQuote;
};

export type RobinhoodOptionOrderCancelResponse = {
  provider: "robinhood";
  cancelledAt: string;
  account: RobinhoodOptionOrderAccount;
  orderId: string;
  accepted: boolean;
};

type ServiceOptions = {
  appUserId: string;
  accountId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  mcpUrl?: string;
};

export type ReviewRobinhoodOptionOrderOptions = ServiceOptions & {
  input: RobinhoodOptionOrderInput;
};

export type ReadRobinhoodOptionQuoteOptions = ServiceOptions & {
  input: RobinhoodOptionOrderInput;
};

export type PlaceRobinhoodOptionOrderOptions = ServiceOptions & {
  input: RobinhoodOptionOrderPlaceInput;
};

export type RobinhoodAlgoOptionOrderContext = {
  deploymentId: string;
  targetId: string;
  positionId: string;
  targetExecutionId: string;
};

export type ReviewRobinhoodAlgoOptionOrderOptions =
  ReviewRobinhoodOptionOrderOptions & {
    algoContext: RobinhoodAlgoOptionOrderContext;
  };

export type PlaceRobinhoodAlgoOptionOrderOptions =
  PlaceRobinhoodOptionOrderOptions & {
    algoContext: RobinhoodAlgoOptionOrderContext;
  };

export type ListRobinhoodOptionOrdersOptions = ServiceOptions;

export type CancelRobinhoodOptionOrderOptions = ServiceOptions & {
  input: { orderId: string };
};

type LocalRobinhoodAccount = RobinhoodOptionOrderAccount & {
  accountNumber: string;
  capabilities: string[];
};

type NormalizedOrder = {
  chainSymbol: string;
  occSymbol: string;
  multiplier: number;
  sharesPerContract: number;
  underlyingType: RobinhoodOptionUnderlyingType | null;
  expiration: string;
  strike: number;
  optionType: RobinhoodOptionType;
  side: RobinhoodOptionOrderSide;
  positionEffect: RobinhoodOptionPositionEffect;
  orderType: RobinhoodOptionOrderType;
  timeInForce: RobinhoodOptionTimeInForce;
  marketHours: RobinhoodOptionMarketHours;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
};

type ResolvedInstrument = {
  optionId: string;
  underlyingType: RobinhoodOptionUnderlyingType;
};

const LOCAL_ID_PREFIX = "robinhood:";
const AGENTIC_CAPABILITY = "robinhood-agentic";
const ROBINHOOD_MIN_ORDER_INTERVAL_MS = 1000;
const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const EXPIRATION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROBINHOOD_OPTION_SUBMIT_RECONCILE_CODE =
  "robinhood_option_order_submit_reconcile_required";

const OPTION_TYPES = new Set<string>(ROBINHOOD_OPTION_TYPES);
const SIDES = new Set<string>(ROBINHOOD_OPTION_ORDER_SIDES);
const POSITION_EFFECTS = new Set<string>(ROBINHOOD_OPTION_POSITION_EFFECTS);
const ORDER_TYPES = new Set<string>(ROBINHOOD_OPTION_ORDER_TYPES);
const TIME_IN_FORCE_VALUES = new Set<string>(
  ROBINHOOD_OPTION_TIME_IN_FORCE_VALUES,
);
const MARKET_HOURS = new Set<string>(ROBINHOOD_OPTION_MARKET_HOURS);
const UNDERLYING_TYPES = new Set<string>(ROBINHOOD_OPTION_UNDERLYING_TYPES);

const OPTION_TYPE_TO_MCP: Record<RobinhoodOptionType, "call" | "put"> = {
  Call: "call",
  Put: "put",
};
const SIDE_TO_MCP: Record<RobinhoodOptionOrderSide, string> = {
  Buy: "buy",
  Sell: "sell",
};
const POSITION_EFFECT_TO_MCP: Record<RobinhoodOptionPositionEffect, string> = {
  Open: "open",
  Close: "close",
};
const ORDER_TYPE_TO_MCP: Record<RobinhoodOptionOrderType, string> = {
  Limit: "limit",
  Market: "market",
  StopLimit: "stop_limit",
  StopMarket: "stop_market",
};
const TIF_TO_MCP: Record<RobinhoodOptionTimeInForce, string> = {
  Day: "gfd",
  GTC: "gtc",
};
const TAX_TYPE_BY_ROBINHOOD: Record<
  RobinhoodOptionOrderType,
  TaxOrderLike["type"]
> = {
  Limit: "limit",
  Market: "market",
  StopLimit: "stop_limit",
  StopMarket: "stop",
};
const TAX_TIF_BY_ROBINHOOD: Record<
  RobinhoodOptionTimeInForce,
  TaxOrderLike["timeInForce"]
> = {
  Day: "day",
  GTC: "gtc",
};
const TAX_OPTION_ACTION: Record<
  `${RobinhoodOptionOrderSide}:${RobinhoodOptionPositionEffect}`,
  TaxOptionOrderAction
> = {
  "Buy:Open": "buy_to_open",
  "Buy:Close": "buy_to_close",
  "Sell:Close": "sell_to_close",
  "Sell:Open": "sell_to_open",
};

const lastSubmitAtByAccountKey = new Map<string, number>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = nonEmptyString(record[key]);
    if (value) return value;
  }
  return null;
}

function readVerbatimString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const numeric = numberOrNull(record[key]);
    if (numeric !== null) return numeric;
  }
  return null;
}

function alertsFromValue(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(alertsFromValue);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, entry]) => {
      if (typeof entry === "string" && entry.trim())
        return [`${key}: ${entry}`];
      const text = readVerbatimString(asRecord(entry), [
        "message",
        "text",
        "detail",
      ]);
      return text ? [`${key}: ${text}`] : [];
    },
  );
}

function readAlerts(record: Record<string, unknown>): string[] {
  const alerts = [
    "order_checks",
    "orderChecks",
    "alerts",
    "warnings",
    "messages",
  ].flatMap((key) => alertsFromValue(record[key]));
  return alerts.filter((alert, index) => alerts.indexOf(alert) === index);
}

function robinhoodAccountNumberFromProviderAccountId(
  value: string,
): string | null {
  return value.startsWith(LOCAL_ID_PREFIX)
    ? value.slice(LOCAL_ID_PREFIX.length).trim() || null
    : null;
}

function lastFour(accountNumber: string): string | null {
  const digits = accountNumber.replace(/\D/gu, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function computeExecutionReady(input: {
  capabilities: string[];
  executionBlockers: string[];
  accountStatus: string | null;
}): boolean {
  return (
    input.capabilities.includes("execution-ready") &&
    input.capabilities.includes(AGENTIC_CAPABILITY) &&
    input.executionBlockers.length === 0 &&
    (input.accountStatus == null || input.accountStatus === "open")
  );
}

async function loadLocalRobinhoodAccount(
  appUserId: string,
  accountId: string,
): Promise<LocalRobinhoodAccount> {
  const [row] = await db
    .select({
      id: brokerAccountsTable.id,
      connectionId: brokerAccountsTable.connectionId,
      providerAccountId: brokerAccountsTable.providerAccountId,
      displayName: brokerAccountsTable.displayName,
      baseCurrency: brokerAccountsTable.baseCurrency,
      accountStatus: brokerAccountsTable.accountStatus,
      capabilities: brokerAccountsTable.capabilities,
      executionBlockers: brokerAccountsTable.executionBlockers,
      lastSyncedAt: brokerAccountsTable.lastSyncedAt,
    })
    .from(brokerAccountsTable)
    .innerJoin(
      brokerConnectionsTable,
      eq(brokerConnectionsTable.id, brokerAccountsTable.connectionId),
    )
    .where(
      and(
        eq(brokerAccountsTable.appUserId, appUserId),
        eq(brokerConnectionsTable.appUserId, appUserId),
        eq(brokerAccountsTable.id, accountId),
        eq(brokerConnectionsTable.brokerProvider, "robinhood"),
        eq(brokerConnectionsTable.status, "connected"),
        eq(brokerAccountsTable.mode, "live"),
        eq(brokerAccountsTable.includedInTrading, true),
      ),
    )
    .limit(1);

  const accountNumber = row
    ? robinhoodAccountNumberFromProviderAccountId(row.providerAccountId)
    : null;
  if (!row || !accountNumber) {
    throw new HttpError(404, "Robinhood account was not found", {
      code: "robinhood_account_not_found",
    });
  }

  const capabilities = [...row.capabilities];
  const executionBlockers = [...row.executionBlockers];
  return {
    id: row.id,
    connectionId: row.connectionId,
    accountNumber,
    accountNumberLast4: lastFour(accountNumber),
    displayName: row.displayName,
    baseCurrency: row.baseCurrency,
    mode: "live",
    accountStatus: row.accountStatus,
    capabilities,
    executionBlockers,
    executionReady: computeExecutionReady({
      capabilities,
      executionBlockers,
      accountStatus: row.accountStatus,
    }),
    lastSyncedAt: row.lastSyncedAt,
  };
}

function publicAccount(
  account: LocalRobinhoodAccount,
): RobinhoodOptionOrderAccount {
  return {
    id: account.id,
    connectionId: account.connectionId,
    accountNumberLast4: account.accountNumberLast4,
    displayName: account.displayName,
    baseCurrency: account.baseCurrency,
    mode: account.mode,
    accountStatus: account.accountStatus,
    executionReady: account.executionReady,
    executionBlockers: account.executionBlockers,
    lastSyncedAt: account.lastSyncedAt,
  };
}

function assertAgenticExecutionReady(account: LocalRobinhoodAccount): void {
  if (!account.capabilities.includes(AGENTIC_CAPABILITY)) {
    throw new HttpError(409, "Robinhood account is not agentic-order enabled", {
      code: "robinhood_account_not_agentic",
      data: { blockers: account.executionBlockers },
    });
  }
  if (account.executionReady) return;
  const blockers = account.executionBlockers.length
    ? account.executionBlockers
    : ["execution_ready_capability_missing"];
  throw new HttpError(409, "Robinhood account is not execution-ready", {
    code: "robinhood_account_execution_blocked",
    data: { blockers },
  });
}

function assertEnum<T extends string>(
  value: string,
  allowed: Set<string>,
  code: string,
  message: string,
): T {
  if (!allowed.has(value)) throw new HttpError(422, message, { code });
  return value as T;
}

function requireChainSymbol(value: string): string {
  const symbol = value?.trim();
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    throw new HttpError(422, "Robinhood option chain symbol is invalid", {
      code: "robinhood_option_chain_symbol_invalid",
    });
  }
  return symbol.toUpperCase();
}

function requireExpiration(value: string): string {
  const expiration = value?.trim();
  const parsed = new Date(`${expiration}T00:00:00.000Z`);
  if (
    !expiration ||
    !EXPIRATION_PATTERN.test(expiration) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== expiration
  ) {
    throw new HttpError(422, "Robinhood option expiration is invalid", {
      code: "robinhood_option_expiration_invalid",
    });
  }
  return expiration;
}

function positiveNumber(value: number, code: string, message: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new HttpError(422, message, { code });
  }
  return value;
}

function optionalPositiveNumber(
  value: number | null | undefined,
  code: string,
  message: string,
): number | null {
  return value == null ? null : positiveNumber(value, code, message);
}

function normalizeOrder(input: RobinhoodOptionOrderInput): NormalizedOrder {
  const optionType = assertEnum<RobinhoodOptionType>(
    input.optionType,
    OPTION_TYPES,
    "robinhood_option_type_invalid",
    "Robinhood option type is invalid",
  );
  const side = assertEnum<RobinhoodOptionOrderSide>(
    input.side,
    SIDES,
    "robinhood_option_order_side_invalid",
    "Robinhood option order side is invalid",
  );
  const positionEffect = assertEnum<RobinhoodOptionPositionEffect>(
    input.positionEffect,
    POSITION_EFFECTS,
    "robinhood_option_position_effect_invalid",
    "Robinhood option position effect is invalid",
  );
  const orderType = assertEnum<RobinhoodOptionOrderType>(
    input.orderType,
    ORDER_TYPES,
    "robinhood_option_order_type_invalid",
    "Robinhood option order type is invalid",
  );
  const timeInForce = assertEnum<RobinhoodOptionTimeInForce>(
    input.timeInForce,
    TIME_IN_FORCE_VALUES,
    "robinhood_option_time_in_force_invalid",
    "Robinhood option order time in force is invalid",
  );
  const marketHours = assertEnum<RobinhoodOptionMarketHours>(
    input.marketHours ?? "regular_hours",
    MARKET_HOURS,
    "robinhood_option_market_hours_invalid",
    "Robinhood option market hours is invalid",
  );
  const underlyingType =
    input.underlyingType == null
      ? null
      : assertEnum<RobinhoodOptionUnderlyingType>(
          input.underlyingType,
          UNDERLYING_TYPES,
          "robinhood_option_underlying_type_invalid",
          "Robinhood option underlying type is invalid",
        );

  const strike = positiveNumber(
    input.strike,
    "robinhood_option_strike_invalid",
    "Robinhood option strike must be positive",
  );
  const quantity = positiveNumber(
    input.quantity,
    "robinhood_option_quantity_invalid",
    "Robinhood option quantity must be a positive integer",
  );
  if (!Number.isInteger(quantity)) {
    throw new HttpError(
      422,
      "Robinhood option quantity must be a positive integer",
      { code: "robinhood_option_quantity_invalid" },
    );
  }

  const limitPrice = optionalPositiveNumber(
    input.limitPrice,
    "robinhood_option_limit_price_invalid",
    "Robinhood option limit price must be positive",
  );
  const stopPrice = optionalPositiveNumber(
    input.stopPrice,
    "robinhood_option_stop_price_invalid",
    "Robinhood option stop price must be positive",
  );

  if (
    (orderType === "Limit" || orderType === "StopLimit") &&
    limitPrice == null
  ) {
    throw new HttpError(
      422,
      "Robinhood option limit orders require a limit price",
      {
        code: "robinhood_option_limit_price_required",
      },
    );
  }
  if (
    (orderType === "Market" || orderType === "StopMarket") &&
    limitPrice != null
  ) {
    throw new HttpError(
      422,
      "Robinhood option market orders must omit the limit price",
      { code: "robinhood_option_limit_price_unsupported" },
    );
  }
  if (
    (orderType === "StopLimit" || orderType === "StopMarket") &&
    stopPrice == null
  ) {
    throw new HttpError(
      422,
      "Robinhood option stop orders require a stop price",
      {
        code: "robinhood_option_stop_price_required",
      },
    );
  }
  if ((orderType === "Limit" || orderType === "Market") && stopPrice != null) {
    throw new HttpError(
      422,
      "Robinhood option immediate orders must omit the stop price",
      { code: "robinhood_option_stop_price_unsupported" },
    );
  }
  if (
    (orderType === "Market" || orderType === "StopMarket") &&
    timeInForce !== "Day"
  ) {
    throw new HttpError(
      422,
      "Robinhood option market orders require Day time in force",
      { code: "robinhood_option_time_in_force_unsupported" },
    );
  }
  if (marketHours !== "regular_hours" && orderType !== "Limit") {
    throw new HttpError(
      422,
      "Robinhood option extended sessions accept immediate Limit orders only",
      { code: "robinhood_option_market_hours_unsupported" },
    );
  }
  if (
    orderType === "StopMarket" &&
    (side !== "Sell" || positionEffect !== "Close")
  ) {
    throw new HttpError(
      422,
      "Robinhood option stop-market orders must be sell-to-close",
      { code: "robinhood_option_order_leg_invalid" },
    );
  }

  const chainSymbol = requireChainSymbol(input.chainSymbol);
  const expiration = requireExpiration(input.expiration);
  const contractIdentity = requireStandardOptionContractIdentity({
    contractSymbol: input.contractSymbol,
    multiplier: input.multiplier,
    sharesPerContract: input.sharesPerContract,
    underlyingSymbol: chainSymbol,
    expiration,
    strike,
    optionType,
  });

  return {
    chainSymbol,
    occSymbol: contractIdentity.occSymbol,
    multiplier: contractIdentity.multiplier,
    sharesPerContract: contractIdentity.sharesPerContract,
    underlyingType,
    expiration,
    strike,
    optionType,
    side,
    positionEffect,
    orderType,
    timeInForce,
    marketHours,
    quantity,
    limitPrice,
    stopPrice,
  };
}

async function openSession(options: {
  appUserId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl: typeof fetch;
  now: Date;
  encryptionKey?: string;
  mcpUrl?: string;
}): Promise<RobinhoodMcpSession> {
  const accessToken = await getRobinhoodAccessToken({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl: options.fetchImpl,
    now: options.now,
    encryptionKey: options.encryptionKey,
  });
  return new RobinhoodMcpSession({
    accessToken,
    fetchImpl: options.fetchImpl,
    mcpUrl: options.mcpUrl,
  });
}

function listFromPayload(payload: unknown, key: string): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (Array.isArray(record[key])) return record[key];
  const data = asRecord(record["data"]);
  if (Array.isArray(data[key])) return data[key];
  const result = asRecord(record["result"]);
  return Array.isArray(result[key]) ? result[key] : [];
}

async function resolveOptionInstrument(
  session: RobinhoodMcpSession,
  order: NormalizedOrder,
): Promise<ResolvedInstrument> {
  const payload = await session.callTool({
    name: "get_option_instruments",
    arguments: {
      chain_symbol: order.chainSymbol,
      expiration_dates: order.expiration,
      strike_price: String(order.strike),
      type: OPTION_TYPE_TO_MCP[order.optionType],
      state: "active",
      tradability: "tradable",
    },
  });

  const matches = listFromPayload(payload, "instruments")
    .map(asRecord)
    .filter((instrument) => {
      if (!readString(instrument, ["id", "option_id", "optionId"]))
        return false;
      const symbol = readString(instrument, ["chain_symbol", "chainSymbol"]);
      const expiration = readString(instrument, [
        "expiration_date",
        "expirationDate",
      ]);
      const strike = readNumber(instrument, ["strike_price", "strikePrice"]);
      const type = readString(instrument, [
        "type",
        "option_type",
        "optionType",
      ]);
      const state = readString(instrument, ["state"]);
      const tradability = readString(instrument, ["tradability"]);
      return (
        (!symbol || symbol.toUpperCase() === order.chainSymbol) &&
        (!expiration || expiration === order.expiration) &&
        (strike == null || strike === order.strike) &&
        (!type ||
          type.toLowerCase() === OPTION_TYPE_TO_MCP[order.optionType]) &&
        (!state || state.toLowerCase() === "active") &&
        (!tradability || tradability.toLowerCase() === "tradable")
      );
    });

  if (matches.length === 0) {
    throw new HttpError(404, "No tradable Robinhood option contract matched", {
      code: "robinhood_option_instrument_not_found",
    });
  }
  if (matches.length > 1) {
    throw new HttpError(
      409,
      "More than one tradable Robinhood option contract matched",
      { code: "robinhood_option_instrument_ambiguous" },
    );
  }

  const match = matches[0]!;
  const resolvedUnderlyingType = readString(match, [
    "underlying_type",
    "underlyingType",
  ]);
  if (
    order.underlyingType &&
    resolvedUnderlyingType &&
    order.underlyingType !== resolvedUnderlyingType
  ) {
    throw new HttpError(
      422,
      "Robinhood option underlying type does not match the contract",
      { code: "robinhood_option_underlying_type_mismatch" },
    );
  }

  return {
    optionId: readString(match, ["id", "option_id", "optionId"])!,
    underlyingType:
      order.underlyingType ??
      (resolvedUnderlyingType === "index" ? "index" : "equity"),
  };
}

function toolArguments(
  accountNumber: string,
  order: NormalizedOrder,
  instrument: ResolvedInstrument,
  includeReviewContext: boolean,
  refId?: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    account_number: accountNumber,
    legs: [
      {
        option_id: instrument.optionId,
        side: SIDE_TO_MCP[order.side],
        position_effect: POSITION_EFFECT_TO_MCP[order.positionEffect],
      },
    ],
    type: ORDER_TYPE_TO_MCP[order.orderType],
    quantity: String(order.quantity),
    time_in_force: TIF_TO_MCP[order.timeInForce],
    market_hours: order.marketHours,
  };
  if (order.limitPrice != null) args["price"] = String(order.limitPrice);
  if (order.stopPrice != null) args["stop_price"] = String(order.stopPrice);
  if (includeReviewContext) {
    args["chain_symbol"] = order.chainSymbol;
    args["underlying_type"] = instrument.underlyingType;
  }
  if (refId) args["ref_id"] = refId;
  return args;
}

function orderDetails(
  order: NormalizedOrder,
  instrument: ResolvedInstrument,
): RobinhoodOptionOrderDetails {
  return {
    optionId: instrument.optionId,
    occSymbol: order.occSymbol,
    multiplier: order.multiplier,
    sharesPerContract: order.sharesPerContract,
    chainSymbol: order.chainSymbol,
    underlyingType: instrument.underlyingType,
    expiration: order.expiration,
    strike: order.strike,
    optionType: order.optionType,
    side: order.side,
    positionEffect: order.positionEffect,
    orderType: order.orderType,
    timeInForce: order.timeInForce,
    marketHours: order.marketHours,
    quantity: order.quantity,
    limitPrice: order.limitPrice,
    stopPrice: order.stopPrice,
  };
}

function robinhoodToTaxOrder(input: {
  accountId: string;
  order: NormalizedOrder;
}): TaxOrderLike {
  const right = OPTION_TYPE_TO_MCP[input.order.optionType];
  const semantics = canonicalOptionTaxSemantics(
    TAX_OPTION_ACTION[`${input.order.side}:${input.order.positionEffect}`],
    right,
  );
  return {
    accountId: input.accountId,
    mode: "live",
    symbol: input.order.chainSymbol,
    assetClass: "option",
    side: SIDE_TO_MCP[input.order.side],
    type: TAX_TYPE_BY_ROBINHOOD[input.order.orderType],
    quantity: input.order.quantity,
    limitPrice: input.order.limitPrice,
    stopPrice: input.order.stopPrice,
    timeInForce: TAX_TIF_BY_ROBINHOOD[input.order.timeInForce],
    optionContract: {
      ticker: input.order.occSymbol,
      underlying: input.order.chainSymbol,
      expirationDate: input.order.expiration,
      strike: input.order.strike,
      right,
      multiplier: input.order.multiplier,
      sharesPerContract: input.order.sharesPerContract,
      providerContractId: input.order.occSymbol,
      brokerContractId: input.order.occSymbol,
    },
    route: "robinhood",
    ...semantics,
  };
}

export function buildRobinhoodOptionTaxOrder(input: {
  accountId: string;
  order: RobinhoodOptionOrderInput;
}): TaxOrderLike {
  return robinhoodToTaxOrder({
    accountId: input.accountId,
    order: normalizeOrder(input.order),
  });
}

function assertDirectPositionContext(order: NormalizedOrder): void {
  if (order.side === "Buy" && order.positionEffect === "Open") return;
  throw new HttpError(
    409,
    "Robinhood direct option orders require account-scoped position and working-order context for this action",
    { code: "robinhood_option_position_context_required" },
  );
}

type ValidatedAlgoCloseContext = {
  clientOrderId: string;
  providerPositionId: string;
};

function algoCloseContextError(code: string, message: string): never {
  throw new HttpError(409, message, { code, expose: true });
}

function snapshotOptionIdentity(value: unknown) {
  const record = asRecord(value);
  const optionTypeValue = readString(record, ["optionType", "right"]);
  const optionType =
    optionTypeValue?.toLowerCase() === "call"
      ? "Call"
      : optionTypeValue?.toLowerCase() === "put"
        ? "Put"
        : null;
  if (!optionType) {
    return algoCloseContextError(
      "algo_target_close_contract_invalid",
      "The algo-owned option contract is invalid.",
    );
  }
  return requireStandardOptionContractIdentity({
    contractSymbol:
      readString(record, ["contractSymbol", "occSymbol", "ticker"]) ?? "",
    multiplier: readNumber(record, ["multiplier"]) ?? Number.NaN,
    sharesPerContract:
      readNumber(record, ["sharesPerContract", "shares_per_contract"]) ??
      Number.NaN,
    underlyingSymbol:
      readString(record, ["chainSymbol", "underlying", "symbol"]) ?? "",
    expiration: readString(record, ["expiration", "expirationDate"]) ?? "",
    strike: readNumber(record, ["strike"]) ?? Number.NaN,
    optionType,
  });
}

async function assertAlgoClosePositionContext(input: {
  appUserId: string;
  accountId: string;
  context: RobinhoodAlgoOptionOrderContext;
  order: NormalizedOrder;
  executionStatuses: readonly ("pending" | "reviewed" | "submitted")[];
}): Promise<ValidatedAlgoCloseContext> {
  if (
    input.order.side !== "Sell" ||
    input.order.positionEffect !== "Close" ||
    input.order.orderType !== "Limit" ||
    input.order.timeInForce !== "Day" ||
    input.order.marketHours !== "regular_hours"
  ) {
    return algoCloseContextError(
      "algo_target_close_order_unsupported",
      "Automated Robinhood closes require a sell-to-close Day limit order.",
    );
  }

  const [deployment] = await db
    .select({
      appUserId: algoDeploymentsTable.appUserId,
      mode: algoDeploymentsTable.mode,
      isDraft: algoDeploymentsTable.isDraft,
      archivedAt: algoDeploymentsTable.archivedAt,
    })
    .from(algoDeploymentsTable)
    .where(eq(algoDeploymentsTable.id, input.context.deploymentId))
    .limit(1);
  if (!deployment) {
    throw new HttpError(404, "Algorithm deployment not found.", {
      code: "algo_deployment_not_found",
    });
  }
  if (deployment.appUserId !== input.appUserId) {
    throw new HttpError(403, "Algorithm deployment access denied.", {
      code: "algo_deployment_forbidden",
    });
  }
  if (
    deployment.mode !== "live" ||
    deployment.isDraft ||
    deployment.archivedAt
  ) {
    return algoCloseContextError(
      "algo_target_close_deployment_blocked",
      "The deployment cannot submit an automated close.",
    );
  }

  const [target, position, targetExecution, conflictingExecution] =
    await Promise.all([
      db
        .select({
          deploymentId: algoDeploymentTargetsTable.deploymentId,
          brokerAccountId: algoDeploymentTargetsTable.brokerAccountId,
          lifecycle: algoDeploymentTargetsTable.lifecycle,
        })
        .from(algoDeploymentTargetsTable)
        .where(eq(algoDeploymentTargetsTable.id, input.context.targetId))
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(algoTargetPositionsTable)
        .where(eq(algoTargetPositionsTable.id, input.context.positionId))
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(algoTargetExecutionsTable)
        .where(
          eq(algoTargetExecutionsTable.id, input.context.targetExecutionId),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select({ id: algoTargetExecutionsTable.id })
        .from(algoTargetExecutionsTable)
        .where(
          and(
            eq(algoTargetExecutionsTable.targetId, input.context.targetId),
            eq(algoTargetExecutionsTable.action, "exit"),
            inArray(algoTargetExecutionsTable.status, [
              "pending",
              "reviewed",
              "submitted",
              "reconciliation_required",
            ]),
            ne(algoTargetExecutionsTable.id, input.context.targetExecutionId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
    ]);

  if (
    !target ||
    target.deploymentId !== input.context.deploymentId ||
    target.brokerAccountId !== input.accountId ||
    !["active", "draining"].includes(target.lifecycle)
  ) {
    return algoCloseContextError(
      "algo_target_close_target_invalid",
      "The algo-owned target is unavailable for closing.",
    );
  }
  if (
    !position ||
    position.appUserId !== input.appUserId ||
    position.deploymentId !== input.context.deploymentId ||
    position.targetId !== input.context.targetId ||
    position.status !== "open" ||
    !position.providerPositionId ||
    !position.lastReconciledAt
  ) {
    return algoCloseContextError(
      "algo_target_close_position_invalid",
      "The algo-owned option position is not open and reconciled.",
    );
  }
  if (
    !targetExecution ||
    targetExecution.appUserId !== input.appUserId ||
    targetExecution.deploymentId !== input.context.deploymentId ||
    targetExecution.targetId !== input.context.targetId ||
    targetExecution.action !== "exit" ||
    !input.executionStatuses.some((status) => status === targetExecution.status)
  ) {
    return algoCloseContextError(
      "algo_target_close_execution_invalid",
      "The durable close execution is unavailable.",
    );
  }
  if (conflictingExecution) {
    return algoCloseContextError(
      "algo_target_close_conflict",
      "Another target close or reconciliation is still unresolved.",
    );
  }
  if (position.lastReconciledAt < targetExecution.occurredAt) {
    return algoCloseContextError(
      "algo_target_close_position_stale",
      "The algo-owned option position must be reconciled after this decision.",
    );
  }

  const positionQuantity = Number(position.quantity);
  if (
    !Number.isSafeInteger(positionQuantity) ||
    positionQuantity <= 0 ||
    input.order.quantity > positionQuantity ||
    Number(targetExecution.requestedQuantity) !== input.order.quantity
  ) {
    return algoCloseContextError(
      "algo_target_close_quantity_invalid",
      "The close quantity exceeds the reconciled algo-owned position.",
    );
  }

  const positionContract = snapshotOptionIdentity(position.contractSnapshot);
  const executionContract = snapshotOptionIdentity(
    targetExecution.contractSnapshot,
  );
  if (
    positionContract.occSymbol !== input.order.occSymbol ||
    executionContract.occSymbol !== input.order.occSymbol
  ) {
    return algoCloseContextError(
      "algo_target_close_contract_mismatch",
      "The close contract does not match the algo-owned position.",
    );
  }
  const orderSnapshot = asRecord(targetExecution.orderSnapshot);
  if (
    readString(orderSnapshot, ["side"]) !== input.order.side ||
    readString(orderSnapshot, ["positionEffect"]) !==
      input.order.positionEffect ||
    readString(orderSnapshot, ["orderType"]) !== input.order.orderType ||
    readString(orderSnapshot, ["timeInForce"]) !== input.order.timeInForce ||
    readString(orderSnapshot, ["marketHours"]) !== input.order.marketHours ||
    readNumber(orderSnapshot, ["quantity"]) !== input.order.quantity ||
    readNumber(orderSnapshot, ["limitPrice"]) !== input.order.limitPrice ||
    readNumber(orderSnapshot, ["stopPrice"]) !== input.order.stopPrice
  ) {
    return algoCloseContextError(
      "algo_target_close_order_mismatch",
      "The close order does not match the durable target execution.",
    );
  }

  return {
    clientOrderId: targetExecution.clientOrderId,
    providerPositionId: position.providerPositionId,
  };
}

function submitReconcileRequiredError(input: {
  now: Date;
  account: LocalRobinhoodAccount;
  order: NormalizedOrder;
  instrument: ResolvedInstrument;
  refId: string;
  reason: RobinhoodSubmitReconciliationReason;
  sourceCode: string;
}): HttpError {
  return new HttpError(
    409,
    "Robinhood option order outcome is unknown; reconcile before retrying",
    {
      code: ROBINHOOD_OPTION_SUBMIT_RECONCILE_CODE,
      expose: true,
      data: {
        provider: "robinhood",
        submittedAt: input.now.toISOString(),
        account: publicAccount(input.account),
        order: {
          ...orderDetails(input.order, input.instrument),
          brokerageOrderId: null,
          state: null,
          refId: input.refId,
        },
        refId: input.refId,
        status: "reconcile_required",
        outcome: "unknown",
        reason: input.reason,
        reconcileRequired: true,
        retryable: false,
        sourceCode: input.sourceCode,
      },
    },
  );
}

function assertSubmitRateLimit(accountKey: string, now: Date): void {
  const previous = lastSubmitAtByAccountKey.get(accountKey);
  if (
    previous !== undefined &&
    now.getTime() - previous < ROBINHOOD_MIN_ORDER_INTERVAL_MS
  ) {
    throw new HttpError(429, "Robinhood option submission is rate limited", {
      code: "robinhood_option_order_rate_limited",
    });
  }
  lastSubmitAtByAccountKey.set(accountKey, now.getTime());
}

function sanitizeBrokerValue(
  value: unknown,
  account: LocalRobinhoodAccount,
): unknown {
  const masked = account.accountNumberLast4
    ? `••••${account.accountNumberLast4}`
    : "••••";
  if (typeof value === "string") {
    return value.replaceAll(account.accountNumber, masked);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeBrokerValue(entry, account));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      key === "account_number" || key === "accountNumber"
        ? masked
        : sanitizeBrokerValue(entry, account),
    ]),
  );
}

function quoteFromData(
  data: Record<string, unknown>,
  optionId: string,
): RobinhoodOptionQuote | null {
  const quotes = Array.isArray(data["option_quotes"])
    ? data["option_quotes"]
    : Array.isArray(data["optionQuotes"])
      ? data["optionQuotes"]
      : [];
  const records = quotes.map(asRecord);
  const quote =
    records.find(
      (entry) =>
        readString(entry, ["instrument_id", "instrumentId", "option_id"]) ===
        optionId,
    ) ?? records[0];
  if (!quote || Object.keys(quote).length === 0) return null;
  return {
    instrumentId: readString(quote, [
      "instrument_id",
      "instrumentId",
      "option_id",
    ]),
    markPrice: readNumber(quote, ["mark_price", "markPrice"]),
    adjustedMarkPrice: readNumber(quote, [
      "adjusted_mark_price",
      "adjustedMarkPrice",
    ]),
    bidPrice: readNumber(quote, ["bid_price", "bidPrice"]),
    askPrice: readNumber(quote, ["ask_price", "askPrice"]),
    previousClosePrice: readNumber(quote, [
      "previous_close_price",
      "previousClosePrice",
    ]),
    impliedVolatility: readNumber(quote, [
      "implied_volatility",
      "impliedVolatility",
    ]),
    delta: readNumber(quote, ["delta"]),
    gamma: readNumber(quote, ["gamma"]),
    theta: readNumber(quote, ["theta"]),
    vega: readNumber(quote, ["vega"]),
    updatedAt: readString(quote, ["updated_at", "updatedAt"]),
  };
}

function exactQuoteFromPayload(
  payload: unknown,
  optionId: string,
): RobinhoodOptionQuote | null {
  const quotes = listFromPayload(payload, "results")
    .map((entry) => {
      const record = asRecord(entry);
      return asRecord(record["quote"] ?? record);
    })
    .filter(
      (quote) =>
        readString(quote, ["instrument_id", "instrumentId", "option_id"]) ===
        optionId,
    );
  if (quotes.length !== 1) return null;
  return quoteFromData({ option_quotes: quotes }, optionId);
}

function orderRecordFrom(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  const data = asRecord(record["data"]);
  const nested = asRecord(
    data["order"] ?? record["order"] ?? asRecord(record["result"])["order"],
  );
  if (Object.keys(nested).length) return nested;
  return Object.keys(data).length ? data : record;
}

async function reviewRobinhoodOptionOrderInternal(
  options: ReviewRobinhoodOptionOrderOptions,
  algoContext: RobinhoodAlgoOptionOrderContext | null,
): Promise<RobinhoodOptionOrderReviewResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const order = normalizeOrder(options.input);
  const validatedAlgoContext = algoContext
    ? await assertAlgoClosePositionContext({
        appUserId: options.appUserId,
        accountId: options.accountId,
        context: algoContext,
        order,
        executionStatuses: ["pending", "reviewed"],
      })
    : null;
  if (!validatedAlgoContext) assertDirectPositionContext(order);
  const account = await loadLocalRobinhoodAccount(
    options.appUserId,
    options.accountId,
  );
  assertAgenticExecutionReady(account);

  const session = await openSession({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl,
    now,
    encryptionKey: options.encryptionKey,
    mcpUrl: options.mcpUrl,
  });
  const instrument = await resolveOptionInstrument(session, order);
  if (
    validatedAlgoContext &&
    validatedAlgoContext.providerPositionId !== instrument.optionId
  ) {
    return algoCloseContextError(
      "algo_target_close_provider_position_mismatch",
      "The broker option position does not match the selected close contract.",
    );
  }
  const payload = await session.callTool({
    name: "review_option_order",
    arguments: toolArguments(account.accountNumber, order, instrument, true),
  });
  const rawData =
    "data" in asRecord(payload)
      ? asRecord(asRecord(payload)["data"])
      : asRecord(payload);
  const data = asRecord(sanitizeBrokerValue(rawData, account));
  const fees = asRecord(data["fees"]);
  const collateralCash = asRecord(asRecord(data["collateral"])["cash"]);
  const estimate = asRecord(data["estimate"] ?? data["estimated_cost"]);

  return {
    provider: "robinhood",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    order: orderDetails(order, instrument),
    review: {
      alerts: readAlerts(data),
      orderChecks: data["order_checks"] ?? data["orderChecks"] ?? null,
      marketDataDisclosure: readVerbatimString(data, [
        "market_data_disclosure",
        "marketDataDisclosure",
      ]),
      quote: quoteFromData(data, instrument.optionId),
      estimate: {
        premium:
          readNumber(estimate, ["premium", "estimated_premium", "amount"]) ??
          readNumber(data, [
            "estimated_premium",
            "estimatedPremium",
            "premium",
          ]),
        totalFee: readNumber(fees, ["total_fee", "totalFee"]),
        collateralAmount: readNumber(collateralCash, ["amount"]),
        collateralDirection: readString(collateralCash, ["direction"]),
        collateralInfinite: collateralCash["infinite"] === true,
      },
    },
  };
}

export async function reviewRobinhoodOptionOrder(
  options: ReviewRobinhoodOptionOrderOptions,
): Promise<RobinhoodOptionOrderReviewResponse> {
  return reviewRobinhoodOptionOrderInternal(options, null);
}

export async function readRobinhoodOptionQuote(
  options: ReadRobinhoodOptionQuoteOptions,
): Promise<RobinhoodOptionQuoteResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const order = normalizeOrder(options.input);
  const account = await loadLocalRobinhoodAccount(
    options.appUserId,
    options.accountId,
  );
  assertAgenticExecutionReady(account);
  const session = await openSession({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl,
    now,
    encryptionKey: options.encryptionKey,
    mcpUrl: options.mcpUrl,
  });
  const instrument = await resolveOptionInstrument(session, order);
  const payload = await session.callTool({
    name: "get_option_quotes",
    arguments: { instrument_ids: [instrument.optionId] },
  });
  const quote = exactQuoteFromPayload(payload, instrument.optionId);
  if (!quote) {
    throw new HttpError(503, "Robinhood option quote is unavailable", {
      code: "robinhood_option_quote_unavailable",
      expose: true,
    });
  }
  return {
    provider: "robinhood",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    optionId: instrument.optionId,
    quote,
  };
}

export async function reviewRobinhoodAlgoOptionOrder(
  options: ReviewRobinhoodAlgoOptionOrderOptions,
): Promise<RobinhoodOptionOrderReviewResponse> {
  return reviewRobinhoodOptionOrderInternal(options, options.algoContext);
}

async function placeRobinhoodOptionOrderInternal(
  options: PlaceRobinhoodOptionOrderOptions,
  algoContext: RobinhoodAlgoOptionOrderContext | null,
): Promise<RobinhoodOptionOrderPlaceResponse> {
  if (options.input.confirm !== true) {
    throw new HttpError(
      409,
      "Robinhood option submission requires confirmation",
      { code: "robinhood_option_order_confirmation_required" },
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const order = normalizeOrder(options.input);
  const validatedAlgoContext = algoContext
    ? await assertAlgoClosePositionContext({
        appUserId: options.appUserId,
        accountId: options.accountId,
        context: algoContext,
        order,
        executionStatuses: ["submitted"],
      })
    : null;
  if (!validatedAlgoContext) assertDirectPositionContext(order);
  const account = await loadLocalRobinhoodAccount(
    options.appUserId,
    options.accountId,
  );
  assertAgenticExecutionReady(account);

  const refId = options.input.refId?.trim() || randomUUID();
  if (!UUID_PATTERN.test(refId)) {
    throw new HttpError(422, "Robinhood option ref id is invalid", {
      code: "robinhood_option_order_ref_id_invalid",
    });
  }
  if (validatedAlgoContext?.clientOrderId !== undefined) {
    if (refId !== validatedAlgoContext.clientOrderId) {
      return algoCloseContextError(
        "algo_target_close_ref_id_mismatch",
        "The broker ref id does not match the durable target execution.",
      );
    }
  }

  const taxOrder = robinhoodToTaxOrder({
    accountId: options.accountId,
    order,
  });
  const taxPreflight = await assertTaxPreflightForOrderSubmission({
    appUserId: options.appUserId,
    order: taxOrder,
    taxPreflightToken: options.input.taxPreflightToken,
    taxAcknowledgements: options.input.taxAcknowledgements,
    now,
  });

  const session = await openSession({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl,
    now,
    encryptionKey: options.encryptionKey,
    mcpUrl: options.mcpUrl,
  });
  const instrument = await resolveOptionInstrument(session, order);
  if (
    validatedAlgoContext &&
    validatedAlgoContext.providerPositionId !== instrument.optionId
  ) {
    return algoCloseContextError(
      "algo_target_close_provider_position_mismatch",
      "The broker option position does not match the selected close contract.",
    );
  }
  assertSubmitRateLimit(`${options.appUserId}:${account.id}`, now);

  let payload: unknown;
  try {
    payload = await session.callTool({
      name: "place_option_order",
      arguments: toolArguments(
        account.accountNumber,
        order,
        instrument,
        false,
        refId,
      ),
    });
  } catch (error) {
    const failure = robinhoodSubmitReconciliationFailure(error);
    if (failure) {
      throw submitReconcileRequiredError({
        now,
        account,
        order,
        instrument,
        refId,
        ...failure,
      });
    }
    throw error;
  }
  const record = orderRecordFrom(payload);
  const sanitizedPayload = asRecord(sanitizeBrokerValue(payload, account));
  const alertRecord =
    "data" in sanitizedPayload
      ? asRecord(sanitizedPayload["data"])
      : sanitizedPayload;
  const brokerageOrderId = readString(record, [
    "id",
    "order_id",
    "orderId",
    "brokerage_order_id",
  ]);
  if (!brokerageOrderId) {
    throw submitReconcileRequiredError({
      now,
      account,
      order,
      instrument,
      refId,
      reason: "missing_order_id",
      sourceCode: "robinhood_option_order_submit_invalid_response",
    });
  }

  try {
    await recordTaxPreflightOrderSubmitted({
      appUserId: options.appUserId,
      preflightToken: taxPreflight?.preflightToken,
      submittedOrderId: brokerageOrderId,
      provider: "robinhood",
    });
  } catch (error) {
    logger.warn(
      {
        err: error,
        appUserId: options.appUserId,
        accountId: options.accountId,
        robinhoodAccountId: account.id,
        orderId: brokerageOrderId,
      },
      "Robinhood option order placed but tax preflight submit record failed; reconciliation required",
    );
    return {
      provider: "robinhood",
      submittedAt: now.toISOString(),
      account: publicAccount(account),
      order: {
        ...orderDetails(order, instrument),
        brokerageOrderId,
        state: readString(record, ["state", "status"]),
        refId,
      },
      alerts: readAlerts(alertRecord),
      reconcileRequired: true,
      reconciliationReason: "tax_preflight_order_submit_record_failed",
    };
  }

  return {
    provider: "robinhood",
    submittedAt: now.toISOString(),
    account: publicAccount(account),
    order: {
      ...orderDetails(order, instrument),
      brokerageOrderId,
      state: readString(record, ["state", "status"]),
      refId,
    },
    alerts: readAlerts(alertRecord),
  };
}

export async function placeRobinhoodOptionOrder(
  options: PlaceRobinhoodOptionOrderOptions,
): Promise<RobinhoodOptionOrderPlaceResponse> {
  return placeRobinhoodOptionOrderInternal(options, null);
}

export async function placeRobinhoodAlgoOptionOrder(
  options: PlaceRobinhoodAlgoOptionOrderOptions,
): Promise<RobinhoodOptionOrderPlaceResponse> {
  return placeRobinhoodOptionOrderInternal(options, options.algoContext);
}

function normalizedOrderType(record: Record<string, unknown>): string | null {
  const type = readString(record, ["type"]);
  const trigger = readString(record, ["trigger"]);
  if (!type) return null;
  if (trigger === "stop") return type === "market" ? "StopMarket" : "StopLimit";
  return type === "market" ? "Market" : type === "limit" ? "Limit" : type;
}

function parseRecentOrders(payload: unknown): RobinhoodOptionRecentOrder[] {
  return listFromPayload(payload, "orders")
    .filter(
      (entry) => entry && typeof entry === "object" && !Array.isArray(entry),
    )
    .map((entry) => {
      const record = asRecord(entry);
      return {
        id: readString(record, ["id", "order_id", "orderId"]),
        chainSymbol: readString(record, ["chain_symbol", "chainSymbol"]),
        state: readString(record, ["state", "status"]),
        orderType: normalizedOrderType(record),
        quantity: readNumber(record, ["quantity"]),
        processedQuantity: readNumber(record, [
          "processed_quantity",
          "processedQuantity",
        ]),
        price: readNumber(record, ["price"]),
        stopPrice: readNumber(record, ["stop_price", "stopPrice"]),
        createdAt: readString(record, ["created_at", "createdAt"]),
      };
    });
}

export async function listRobinhoodOptionOrders(
  options: ListRobinhoodOptionOrdersOptions,
): Promise<RobinhoodOptionRecentOrdersResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const account = await loadLocalRobinhoodAccount(
    options.appUserId,
    options.accountId,
  );
  assertAgenticExecutionReady(account);
  const session = await openSession({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl,
    now,
    encryptionKey: options.encryptionKey,
    mcpUrl: options.mcpUrl,
  });
  const payload = await session.callTool({
    name: "get_option_orders",
    arguments: { account_number: account.accountNumber },
  });
  return {
    provider: "robinhood",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    orders: parseRecentOrders(payload),
  };
}

export async function cancelRobinhoodOptionOrder(
  options: CancelRobinhoodOptionOrderOptions,
): Promise<RobinhoodOptionOrderCancelResponse> {
  const orderId = options.input.orderId?.trim();
  if (!orderId) {
    throw new HttpError(422, "Robinhood option order id is invalid", {
      code: "robinhood_option_order_id_invalid",
    });
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const account = await loadLocalRobinhoodAccount(
    options.appUserId,
    options.accountId,
  );
  assertAgenticExecutionReady(account);
  const session = await openSession({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl,
    now,
    encryptionKey: options.encryptionKey,
    mcpUrl: options.mcpUrl,
  });
  const payload = await session.callTool({
    name: "cancel_option_order",
    arguments: {
      account_number: account.accountNumber,
      order_id: orderId,
    },
  });
  const data =
    "data" in asRecord(payload)
      ? asRecord(asRecord(payload)["data"])
      : asRecord(payload);
  return {
    provider: "robinhood",
    cancelledAt: now.toISOString(),
    account: publicAccount(account),
    orderId,
    accepted: data["accepted"] === true,
  };
}
