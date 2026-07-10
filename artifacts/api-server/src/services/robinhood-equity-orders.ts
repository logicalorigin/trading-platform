import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  brokerAccountsTable,
  brokerConnectionsTable,
  db,
} from "@workspace/db";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { RobinhoodMcpSession } from "../providers/robinhood/mcp-client";
import { getRobinhoodAccessToken } from "./robinhood-oauth";
import {
  assertTaxPreflightForOrderSubmission,
  recordTaxPreflightOrderSubmitted,
} from "./tax-planning";
import type { TaxOrderLike } from "./tax-planning-model";

export const ROBINHOOD_EQUITY_ORDER_SIDES = ["BUY", "SELL"] as const;
export const ROBINHOOD_EQUITY_ORDER_TYPES = [
  "Market",
  "Limit",
  "StopMarket",
  "StopLimit",
] as const;
export const ROBINHOOD_EQUITY_TIME_IN_FORCE_VALUES = ["Day", "GTC"] as const;
export const ROBINHOOD_EQUITY_MARKET_HOURS = [
  "regular_hours",
  "extended_hours",
  "all_day_hours",
] as const;

export type RobinhoodEquityOrderSide =
  (typeof ROBINHOOD_EQUITY_ORDER_SIDES)[number];
export type RobinhoodEquityOrderType =
  (typeof ROBINHOOD_EQUITY_ORDER_TYPES)[number];
export type RobinhoodEquityTimeInForce =
  (typeof ROBINHOOD_EQUITY_TIME_IN_FORCE_VALUES)[number];
export type RobinhoodEquityMarketHours =
  (typeof ROBINHOOD_EQUITY_MARKET_HOURS)[number];

export type RobinhoodEquityOrderInput = {
  symbol: string;
  side: RobinhoodEquityOrderSide;
  orderType: RobinhoodEquityOrderType;
  timeInForce: RobinhoodEquityTimeInForce;
  marketHours?: RobinhoodEquityMarketHours | null;
  quantity?: number | null;
  notionalValue?: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
};

export type RobinhoodEquityOrderPlaceInput = RobinhoodEquityOrderInput & {
  confirm?: boolean;
  refId?: string | null;
  taxPreflightToken?: string | null;
  taxAcknowledgements?: string[] | null;
};

export type RobinhoodEquityOrderAccount = {
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

export type RobinhoodEquityOrderDetails = {
  symbol: string;
  side: RobinhoodEquityOrderSide;
  orderType: RobinhoodEquityOrderType;
  timeInForce: RobinhoodEquityTimeInForce;
  marketHours: RobinhoodEquityMarketHours;
  quantity: number | null;
  notionalValue: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
};

export type RobinhoodEquityOrderReviewResponse = {
  provider: "robinhood";
  checkedAt: string;
  account: RobinhoodEquityOrderAccount;
  order: RobinhoodEquityOrderDetails;
  review: {
    lastTradePrice: number | null;
    bidPrice: number | null;
    askPrice: number | null;
    previousClose: number | null;
    // Compliance quote disclosure — surfaced verbatim for the user per the
    // upstream tool guide whenever the review payload includes it.
    marketDataDisclosure: string | null;
    // Non-empty broker order checks (order_checks) surfaced verbatim.
    alerts: string[];
  };
};

export type RobinhoodEquityOrderPlaceResponse = {
  provider: "robinhood";
  submittedAt: string;
  account: RobinhoodEquityOrderAccount;
  order: RobinhoodEquityOrderDetails & {
    brokerageOrderId: string | null;
    state: string | null;
    refId: string;
  };
  alerts: string[];
  reconcileRequired?: true;
  reconciliationReason?: "tax_preflight_order_submit_record_failed";
};

export type RobinhoodRecentOrder = {
  id: string | null;
  symbol: string | null;
  side: string | null;
  state: string | null;
  quantity: number | null;
  averagePrice: number | null;
  createdAt: string | null;
};

export type RobinhoodRecentOrdersResponse = {
  provider: "robinhood";
  checkedAt: string;
  account: RobinhoodEquityOrderAccount;
  orders: RobinhoodRecentOrder[];
};

export type RobinhoodEquityOrderCancelResponse = {
  provider: "robinhood";
  canceledAt: string;
  account: RobinhoodEquityOrderAccount;
  orderId: string;
  state: string | null;
  status: "canceled";
};

export type ReviewRobinhoodEquityOrderOptions = {
  appUserId: string;
  accountId: string;
  input: RobinhoodEquityOrderInput;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  mcpUrl?: string;
};

export type PlaceRobinhoodEquityOrderOptions = {
  appUserId: string;
  accountId: string;
  input: RobinhoodEquityOrderPlaceInput;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  mcpUrl?: string;
};

export type ListRobinhoodEquityOrdersOptions = {
  appUserId: string;
  accountId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  mcpUrl?: string;
};

export type CancelRobinhoodEquityOrderOptions = {
  appUserId: string;
  accountId: string;
  orderId: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  encryptionKey?: string;
  mcpUrl?: string;
};

type LocalRobinhoodAccount = RobinhoodEquityOrderAccount & {
  accountNumber: string;
  capabilities: string[];
};

type NormalizedOrder = {
  symbol: string;
  side: RobinhoodEquityOrderSide;
  orderType: RobinhoodEquityOrderType;
  timeInForce: RobinhoodEquityTimeInForce;
  marketHours: RobinhoodEquityMarketHours;
  quantity: number | null;
  notionalValue: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
};

const LOCAL_ID_PREFIX = "robinhood:";
const AGENTIC_CAPABILITY = "robinhood-agentic";
const ROBINHOOD_MIN_ORDER_INTERVAL_MS = 1000;
const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SIDES = new Set<string>(ROBINHOOD_EQUITY_ORDER_SIDES);
const ORDER_TYPES = new Set<string>(ROBINHOOD_EQUITY_ORDER_TYPES);
const TIME_IN_FORCE_VALUES = new Set<string>(
  ROBINHOOD_EQUITY_TIME_IN_FORCE_VALUES,
);
const MARKET_HOURS = new Set<string>(ROBINHOOD_EQUITY_MARKET_HOURS);

const SIDE_TO_MCP: Record<RobinhoodEquityOrderSide, string> = {
  BUY: "buy",
  SELL: "sell",
};
const TYPE_TO_MCP: Record<RobinhoodEquityOrderType, string> = {
  Market: "market",
  Limit: "limit",
  StopMarket: "stop_market",
  StopLimit: "stop_limit",
};
const TIF_TO_MCP: Record<RobinhoodEquityTimeInForce, string> = {
  Day: "gfd",
  GTC: "gtc",
};
const TAX_TYPE_BY_ROBINHOOD: Record<RobinhoodEquityOrderType, TaxOrderLike["type"]> = {
  Market: "market",
  Limit: "limit",
  StopMarket: "stop",
  StopLimit: "stop_limit",
};
const TAX_TIF_BY_ROBINHOOD: Record<RobinhoodEquityTimeInForce, TaxOrderLike["timeInForce"]> = {
  Day: "day",
  GTC: "gtc",
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

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = nonEmptyString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const numeric = numberOrNull(record[key]);
    if (numeric !== null) {
      return numeric;
    }
  }
  return null;
}

function alertsFromValue(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry === "string" && entry.trim()) {
        return [entry.trim()];
      }
      const text = readString(asRecord(entry), ["message", "text", "detail"]);
      return text ? [text] : [];
    });
  }
  // order_checks is an object keyed by check name; surface each non-empty entry.
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, entry]) => {
        const text =
          typeof entry === "string" && entry.trim()
            ? entry.trim()
            : readString(asRecord(entry), ["message", "text", "detail"]);
        return text ? [`${key}: ${text}`] : [];
      },
    );
  }
  return [];
}

function readAlerts(record: Record<string, unknown>): string[] {
  const alerts: string[] = [];
  for (const key of ["order_checks", "orderChecks", "alerts", "warnings", "messages"]) {
    alerts.push(...alertsFromValue(record[key]));
  }
  return alerts.filter((alert, index, all) => all.indexOf(alert) === index);
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
        eq(brokerAccountsTable.mode, "live"),
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
): RobinhoodEquityOrderAccount {
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
    throw new HttpError(
      409,
      "Robinhood account is not agentic-order enabled",
      {
        code: "robinhood_account_not_agentic",
        data: { blockers: account.executionBlockers },
      },
    );
  }
  if (account.executionReady) {
    return;
  }
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
  if (!allowed.has(value)) {
    throw new HttpError(422, message, { code });
  }
  return value as T;
}

function requireSymbol(value: string | null | undefined): string {
  const symbol = value?.trim();
  if (!symbol || !SYMBOL_PATTERN.test(symbol)) {
    throw new HttpError(422, "Robinhood order symbol is invalid", {
      code: "robinhood_order_symbol_invalid",
    });
  }
  return symbol.toUpperCase();
}

function positiveNumberOrNull(
  value: number | null | undefined,
  code: string,
  message: string,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new HttpError(422, message, { code });
  }
  return value;
}

function normalizeOrder(input: RobinhoodEquityOrderInput): NormalizedOrder {
  const side = assertEnum<RobinhoodEquityOrderSide>(
    input.side,
    SIDES,
    "robinhood_order_side_invalid",
    "Robinhood order side is invalid",
  );
  const orderType = assertEnum<RobinhoodEquityOrderType>(
    input.orderType,
    ORDER_TYPES,
    "robinhood_order_type_invalid",
    "Robinhood order type is invalid",
  );
  const timeInForce = assertEnum<RobinhoodEquityTimeInForce>(
    input.timeInForce,
    TIME_IN_FORCE_VALUES,
    "robinhood_order_time_in_force_invalid",
    "Robinhood order time in force is invalid",
  );
  const marketHours = assertEnum<RobinhoodEquityMarketHours>(
    input.marketHours ?? "regular_hours",
    MARKET_HOURS,
    "robinhood_order_market_hours_invalid",
    "Robinhood order market hours is invalid",
  );

  // extended_hours / all_day_hours execute limit orders only; market,
  // stop_market and stop_limit are regular_hours-only (upstream schema).
  if (marketHours !== "regular_hours" && orderType !== "Limit") {
    throw new HttpError(
      422,
      "Robinhood extended and overnight sessions accept Limit orders only",
      { code: "robinhood_order_market_hours_unsupported" },
    );
  }

  const quantity = positiveNumberOrNull(
    input.quantity,
    "robinhood_order_quantity_invalid",
    "Robinhood order quantity must be positive",
  );
  const notionalValue = positiveNumberOrNull(
    input.notionalValue,
    "robinhood_order_notional_value_invalid",
    "Robinhood order notional value must be positive",
  );
  if (
    (quantity == null && notionalValue == null) ||
    (quantity != null && notionalValue != null)
  ) {
    throw new HttpError(
      422,
      "Robinhood order must specify exactly one of quantity or notionalValue",
      { code: "robinhood_order_quantity_invalid" },
    );
  }
  if (notionalValue != null && orderType !== "Market") {
    throw new HttpError(
      422,
      "Robinhood notional orders require the Market order type",
      { code: "robinhood_order_notional_unsupported" },
    );
  }

  const limitPrice = positiveNumberOrNull(
    input.limitPrice,
    "robinhood_order_limit_price_invalid",
    "Robinhood order limit price must be positive",
  );
  const stopPrice = positiveNumberOrNull(
    input.stopPrice,
    "robinhood_order_stop_price_invalid",
    "Robinhood order stop price must be positive",
  );
  if ((orderType === "Limit" || orderType === "StopLimit") && limitPrice == null) {
    throw new HttpError(422, "Robinhood limit orders require a limit price", {
      code: "robinhood_order_limit_price_required",
    });
  }
  if (
    (orderType === "StopMarket" || orderType === "StopLimit") &&
    stopPrice == null
  ) {
    throw new HttpError(422, "Robinhood stop orders require a stop price", {
      code: "robinhood_order_stop_price_required",
    });
  }

  return {
    symbol: requireSymbol(input.symbol),
    side,
    orderType,
    timeInForce,
    marketHours,
    quantity,
    notionalValue,
    limitPrice,
    stopPrice,
  };
}

function orderDetails(order: NormalizedOrder): RobinhoodEquityOrderDetails {
  return {
    symbol: order.symbol,
    side: order.side,
    orderType: order.orderType,
    timeInForce: order.timeInForce,
    marketHours: order.marketHours,
    quantity: order.quantity,
    notionalValue: order.notionalValue,
    limitPrice: order.limitPrice,
    stopPrice: order.stopPrice,
  };
}

// Every numeric tool parameter is serialized as a string per the Robinhood MCP
// equity-order schema.
function toolArguments(
  accountNumber: string,
  order: NormalizedOrder,
  extra?: Record<string, string>,
): Record<string, string> {
  const args: Record<string, string> = {
    account_number: accountNumber,
    symbol: order.symbol,
    side: SIDE_TO_MCP[order.side],
    type: TYPE_TO_MCP[order.orderType],
    time_in_force: TIF_TO_MCP[order.timeInForce],
    market_hours: order.marketHours,
  };
  if (order.quantity != null) {
    args["quantity"] = String(order.quantity);
  }
  if (order.notionalValue != null) {
    args["dollar_amount"] = order.notionalValue.toFixed(2);
  }
  if (order.limitPrice != null) {
    args["limit_price"] = String(order.limitPrice);
  }
  if (order.stopPrice != null) {
    args["stop_price"] = String(order.stopPrice);
  }
  return { ...args, ...(extra ?? {}) };
}

function robinhoodToTaxOrder(input: {
  accountId: string;
  order: NormalizedOrder;
}): TaxOrderLike {
  return {
    accountId: input.accountId,
    mode: "live",
    symbol: input.order.symbol,
    assetClass: "equity",
    side: input.order.side === "SELL" ? "sell" : "buy",
    type: TAX_TYPE_BY_ROBINHOOD[input.order.orderType],
    quantity: Number(input.order.quantity) || 0,
    limitPrice: input.order.limitPrice ?? null,
    stopPrice: input.order.stopPrice ?? null,
    timeInForce: TAX_TIF_BY_ROBINHOOD[input.order.timeInForce],
    optionContract: null,
    route: "robinhood",
    intent: null,
  };
}

function assertSubmitRateLimit(accountKey: string, now: Date): void {
  const previous = lastSubmitAtByAccountKey.get(accountKey);
  if (
    previous !== undefined &&
    now.getTime() - previous < ROBINHOOD_MIN_ORDER_INTERVAL_MS
  ) {
    throw new HttpError(429, "Robinhood order submission is rate limited", {
      code: "robinhood_order_rate_limited",
    });
  }
  lastSubmitAtByAccountKey.set(accountKey, now.getTime());
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

// The review/place payloads nest the order body under a data/order/result
// envelope depending on the tool; read defensively from the first record that
// carries recognizable order fields.
function orderRecordFrom(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  for (const key of ["order", "data", "result", "equity_order"]) {
    const nested = record[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedRecord = nested as Record<string, unknown>;
      if (
        "id" in nestedRecord ||
        "state" in nestedRecord ||
        "order" in nestedRecord
      ) {
        return "order" in nestedRecord
          ? asRecord(nestedRecord["order"])
          : nestedRecord;
      }
    }
  }
  return record;
}

export async function reviewRobinhoodEquityOrder(
  options: ReviewRobinhoodEquityOrderOptions,
): Promise<RobinhoodEquityOrderReviewResponse> {
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
  const payload = await session.callTool({
    name: "review_equity_order",
    arguments: toolArguments(account.accountNumber, order),
  });
  // review_equity_order returns { data: { quote_data, order_checks,
  // market_data_disclosure, ... }, guide }.
  const data = "data" in asRecord(payload) ? asRecord(asRecord(payload)["data"]) : asRecord(payload);
  const quote = asRecord(data["quote_data"] ?? data["quote"]);

  return {
    provider: "robinhood",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    order: orderDetails(order),
    review: {
      lastTradePrice: readNumber(quote, ["last_trade_price", "lastTradePrice"]),
      bidPrice: readNumber(quote, ["bid_price", "bidPrice"]),
      askPrice: readNumber(quote, ["ask_price", "askPrice"]),
      previousClose: readNumber(quote, [
        "previous_close",
        "previousClose",
        "adjusted_previous_close",
      ]),
      marketDataDisclosure: readString(data, [
        "market_data_disclosure",
        "marketDataDisclosure",
      ]),
      alerts: readAlerts(data),
    },
  };
}

export async function placeRobinhoodEquityOrder(
  options: PlaceRobinhoodEquityOrderOptions,
): Promise<RobinhoodEquityOrderPlaceResponse> {
  if (options.input.confirm !== true) {
    throw new HttpError(409, "Robinhood order submission requires confirmation", {
      code: "robinhood_order_confirmation_required",
    });
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const order = normalizeOrder(options.input);
  const account = await loadLocalRobinhoodAccount(
    options.appUserId,
    options.accountId,
  );
  assertAgenticExecutionReady(account);

  const refId = options.input.refId?.trim() || randomUUID();
  if (!UUID_PATTERN.test(refId)) {
    throw new HttpError(422, "Robinhood order ref id is invalid", {
      code: "robinhood_order_ref_id_invalid",
    });
  }

  const taxPreflight = await assertTaxPreflightForOrderSubmission({
    appUserId: options.appUserId,
    order: robinhoodToTaxOrder({ accountId: options.accountId, order }),
    taxPreflightToken: options.input.taxPreflightToken,
    taxAcknowledgements: options.input.taxAcknowledgements,
    now,
  });
  assertSubmitRateLimit(`${options.appUserId}:${account.id}`, now);

  const session = await openSession({
    appUserId: options.appUserId,
    env: options.env,
    fetchImpl,
    now,
    encryptionKey: options.encryptionKey,
    mcpUrl: options.mcpUrl,
  });
  const payload = await session.callTool({
    name: "place_equity_order",
    arguments: toolArguments(account.accountNumber, order, { ref_id: refId }),
  });
  const record = orderRecordFrom(payload);
  const brokerageOrderId = readString(record, [
    "id",
    "order_id",
    "orderId",
    "brokerage_order_id",
  ]);

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
      "Robinhood equity order placed but tax preflight submit record failed; reconciliation required",
    );
    return {
      provider: "robinhood",
      submittedAt: now.toISOString(),
      account: publicAccount(account),
      order: {
        ...orderDetails(order),
        brokerageOrderId,
        state: readString(record, ["state", "status"]),
        refId,
      },
      alerts: readAlerts(asRecord(payload)),
      reconcileRequired: true,
      reconciliationReason: "tax_preflight_order_submit_record_failed",
    };
  }

  return {
    provider: "robinhood",
    submittedAt: now.toISOString(),
    account: publicAccount(account),
    order: {
      ...orderDetails(order),
      brokerageOrderId,
      state: readString(record, ["state", "status"]),
      refId,
    },
    alerts: readAlerts(asRecord(payload)),
  };
}

function parseRecentOrders(payload: unknown): RobinhoodRecentOrder[] {
  const record = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(record["orders"])
      ? record["orders"]
      : Array.isArray(record["results"])
        ? record["results"]
        : Array.isArray(asRecord(record["data"])["orders"])
          ? (asRecord(record["data"])["orders"] as unknown[])
          : [];
  return list.map((entry) => {
    const orderRecord = asRecord(entry);
    return {
      id: readString(orderRecord, ["id", "order_id", "orderId"]),
      symbol: readString(orderRecord, ["symbol", "instrument_symbol"]),
      side: readString(orderRecord, ["side", "direction"]),
      state: readString(orderRecord, ["state", "status"]),
      quantity: readNumber(orderRecord, ["quantity", "shares"]),
      averagePrice: readNumber(orderRecord, [
        "average_price",
        "averagePrice",
        "executed_price",
      ]),
      createdAt: readString(orderRecord, ["created_at", "createdAt", "created"]),
    };
  });
}

export async function listRobinhoodEquityOrders(
  options: ListRobinhoodEquityOrdersOptions,
): Promise<RobinhoodRecentOrdersResponse> {
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
    name: "get_equity_orders",
    arguments: { account_number: account.accountNumber },
  });

  return {
    provider: "robinhood",
    checkedAt: now.toISOString(),
    account: publicAccount(account),
    orders: parseRecentOrders(payload),
  };
}

export async function cancelRobinhoodEquityOrder(
  options: CancelRobinhoodEquityOrderOptions,
): Promise<RobinhoodEquityOrderCancelResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const orderId = options.orderId?.trim();
  if (!orderId) {
    throw new HttpError(422, "Robinhood order id is required", {
      code: "robinhood_order_id_required",
    });
  }
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
    name: "cancel_equity_order",
    arguments: { account_number: account.accountNumber, order_id: orderId },
  });
  const record = orderRecordFrom(payload);

  return {
    provider: "robinhood",
    canceledAt: now.toISOString(),
    account: publicAccount(account),
    orderId,
    state: readString(record, ["state", "status"]),
    status: "canceled",
  };
}
